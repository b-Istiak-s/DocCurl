# DocCurl Architecture

This document provides a comprehensive overview of DocCurl's architecture, data flow, and component interactions.

---

## 📐 System Architecture

DocCurl follows a **client-server architecture** with three main layers:

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  (HTML + JavaScript + CSS)                                   │
│  - UI Rendering                                              │
│  - Playground Management                                     │
│  - API Communication                                         │
└─────────────────────────────────────────────────────────────┘
                            ▲ │
                            │ │ HTTP/JSON
                            │ ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Node.js)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              server.js (Express)                     │   │
│  │  - Authentication                                    │   │
│  │  - Session Management                                │   │
│  │  - Documentation API                                 │   │
│  │  - Static File Serving                               │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           curl-runner.js (Curl Handler)              │   │
│  │  - Command Parsing                                   │   │
│  │  - Security Validation                               │   │
│  │  - Container Orchestration                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ▲ │
                            │ │ exec()
                            │ ▼
┌─────────────────────────────────────────────────────────────┐
│                  Container Runtime Layer                     │
│             (Docker / Podman + curlimages/curl)              │
│  - Isolated curl execution                                   │
│  - Network sandboxing                                        │
│  - Resource limits                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS/HTTP
                            ▼
                      External APIs
```

---

## 🗂️ Component Breakdown

### 1. Frontend (`frontend/`)

#### **index.html**

The main HTML structure containing:

- Sidebar for navigation
- Content area for markdown rendering
- Modals for login and fullscreen views
- Embedded playground containers

#### **app.js** (775 lines)

**Key Responsibilities:**

- **UI Management**: Sidebar toggle, modals, responsive behavior
- **Navigation**: Loading and rendering the documentation tree
- **Playground Management**: Creating, managing, and destroying interactive curl playgrounds
- **Environment Variables**: Managing `$APP_URL` and `$TOKEN` via localStorage
- **API Communication**: Fetching docs, authenticating, executing curl commands

**Key Functions:**

| Function                                     | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `loadDocsTree()`                             | Fetches and renders the documentation sidebar tree       |
| `loadDoc(path)`                              | Loads a specific markdown document and renders it        |
| `renderDocTree(nodes, parent)`               | Recursively builds the sidebar tree HTML                 |
| `createPlayground(codeElement, curlCommand)` | Creates an interactive playground from a curl code block |
| `executeCurlCommand(state)`                  | Sends curl command to `/api/run-curl` endpoint           |
| `tokenizeShell(input)`                       | Parses shell commands for placeholder substitution       |
| `replacePlaceholders(text, env)`             | Replaces `$APP_URL` and `$TOKEN` in commands             |
| `formatCurlCommand(command)`                 | Pretty-prints curl commands                              |
| `syncCurlOverlay(state)`                     | Updates syntax highlighting overlay                      |
| `prettifyMarkup(input)`                      | Formats XML/HTML responses                               |
| `showLogin()` / `hideLogin()`                | Manages authentication modal                             |

**Data Flow - Playground Execution:**

1. User clicks "Run" button
2. `executeCurlCommand()` retrieves command from textarea
3. Detects missing environment variables (`detectMissingEnv()`)
4. Replaces `$APP_URL` and `$TOKEN` placeholders
5. Sends POST to `/api/run-curl` with `{ command: "..." }`
6. Displays output or error in result panel
7. Applies syntax highlighting and prettification

#### **style.css**

Responsive styling with:

- CSS Grid/Flexbox layouts
- Mobile-responsive sidebar
- Syntax highlighting themes
- Playground component styles

---

### 2. Backend Server (`backend/server.js`, 327 lines)

#### **Core Responsibilities:**

1. **Authentication & Session Management**
2. **Documentation API**
3. **Static File Serving**
4. **Middleware Configuration**

---

#### **A. Authentication System**

##### **Session Token Format:**

```
<issuedAt>.<expiresAt>.<nonce>.<signature>
```

**Example:**  
`1708531200000.1708790400000.a1b2c3d4e5f6.f8d9e7a6b5c4`

##### **Key Functions:**

| Function                                  | Purpose                                        | Details                                               |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `hashPassword(value)`                     | Hashes passwords using SHA-256                 | Used for constant-time comparison                     |
| `isPasswordValid(input, expected)`        | Validates password with timing-safe comparison | Uses `crypto.timingSafeEqual()`                       |
| `parseCookies(cookieHeader)`              | Parses HTTP cookie header into object          | Splits on `;` and `=`                                 |
| `createSessionToken(secret, now)`         | Generates signed session token                 | Includes timestamp, expiration, nonce, HMAC signature |
| `isSessionTokenValid(token, secret, now)` | Validates session token                        | Checks format, expiration, signature                  |
| `buildSessionCookie(token)`               | Creates Set-Cookie header                      | HttpOnly, SameSite=Lax, 3-day TTL                     |
| `clearSessionCookie()`                    | Creates cookie with Max-Age=0                  | Logs out user                                         |

##### **Authentication Flow:**

```
POST /api/auth/login
  ↓
User sends password
  ↓
hashPassword() + isPasswordValid()
  ↓
createSessionToken(sessionSecret)
  ↓
buildSessionCookie()
  ↓
Set-Cookie header sent
  ↓
Client stores cookie
  ↓
Subsequent requests include cookie
  ↓
parseCookies() + isSessionTokenValid()
  ↓
Access granted or 401 Unauthorized
```

##### **Middleware Protection:**

```javascript
if (authEnabled) {
  app.use("/api", (req, res, next) => {
    if (
      req.path === "/auth/status" ||
      req.path === "/auth/login" ||
      req.path === "/auth/logout"
    ) {
      return next(); // Allow auth endpoints
    }
    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  });
}
```

All `/api/*` routes except authentication endpoints require valid session.

---

#### **B. Documentation API**

##### **File System Operations:**

| Function                                    | Purpose                                        | Security Measure               |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------ |
| `buildDocsTree(docsDir, relativeDir)`       | Recursively builds tree of `.md` files         | Only includes `.md` files      |
| `sortNodes(nodes)`                          | Sorts folders first, then files alphabetically | Consistent UI                  |
| `normalizeDocPath(rawPath)`                 | Normalizes and validates path                  | Prevents `../`, absolute paths |
| `resolveSafeDocPath(docsDir, relativePath)` | Resolves path safely                           | Prevents directory traversal   |

##### **Tree Structure Example:**

```json
{
  "tree": [
    {
      "type": "dir",
      "name": "api",
      "path": "api",
      "children": [
        {
          "type": "file",
          "name": "users.md",
          "path": "api/users.md"
        }
      ]
    },
    {
      "type": "file",
      "name": "getting-started.md",
      "path": "getting-started.md"
    }
  ]
}
```

##### **Content Rendering Flow:**

```
GET /api/docs/content?path=api/users.md
  ↓
normalizeDocPath("api/users.md")
  ↓
resolveSafeDocPath(docsDir, "api/users.md")
  ↓
fs.readFile(filePath, 'utf8')
  ↓
markdown-it.render(markdown)
  ↓
Return { path, filename, html, markdown }
```

---

### 3. Curl Runner (`backend/curl-runner.js`, 824 lines)

This is the **security-critical component** responsible for parsing, validating, and executing curl commands.

---

#### **A. Command Tokenization**

##### **`tokenizeCommand(command)`**

Parses a shell command string into tokens while respecting quotes and escapes.

**Algorithm:**

1. Iterate through each character
2. Track quote state (`'` or `"`)
3. Handle escape sequences (`\`)
4. Handle line continuations (`\\\n`)
5. Split on whitespace outside quotes
6. Return array of tokens

**Example:**

```javascript
tokenizeCommand('curl -H "Content-Type: application/json" https://api.com');
// Returns: ['curl', '-H', 'Content-Type: application/json', 'https://api.com']
```

**Edge Cases:**

- Unterminated quotes → Error
- Escaped newlines → Ignored
- Escaped characters inside double quotes (`\"`, `\\`, `\$`, `` \` ``)

---

#### **B. Curl Command Parsing**

##### **`parseCurlCommand(command)`**

Parses a tokenized curl command into a structured request specification.

**Supported Flags:**

| Flag    | Aliases                                                     | Purpose      |
| ------- | ----------------------------------------------------------- | ------------ |
| `-X`    | `--request`                                                 | HTTP method  |
| `-H`    | `--header`                                                  | HTTP header  |
| `-d`    | `--data`, `--data-raw`, `--data-binary`, `--data-urlencode` | Request body |
| `-I`    | `--head`                                                    | HEAD request |
| `--url` | (none)                                                      | Target URL   |

**Parsing Logic:**

1. First token must be `curl`
2. Iterate through tokens:
   - `-X METHOD` → Set explicit method
   - `-H "Header: Value"` → Add to headers array
   - `-d "body"` → Append to body parts
   - `-I` → Set HEAD method
   - No flag → URL
3. Infer method: `HEAD` if `-I`, `POST` if body present, else `GET`
4. Return `{ method, url, headers, body }`

**Example:**

```javascript
parseCurlCommand('curl -X POST -H "Content-Type: application/json" -d \'{"key":"value"}\' https://api.com')
// Returns:
{
  method: 'POST',
  url: 'https://api.com',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: '{"key":"value"}'
}
```

**Not Supported (throws error):**

- `-F` / `--form` (multipart)
- `-L` / `--location` (redirects)
- Unknown flags

---

#### **C. Request Validation**

##### **`validateRequestSpec(spec)`**

Validates the parsed request against security limits.

**Checks:**

| Field     | Validation                                                                       |
| --------- | -------------------------------------------------------------------------------- |
| `method`  | Must be in `ALLOWED_METHODS` (GET, POST, PUT, PATCH, DELETE, HEAD)               |
| `url`     | Non-empty, max 2048 chars                                                        |
| `headers` | Max 40 headers, each name ≤128 chars, value ≤2048 chars, alphanumeric names only |
| `body`    | Max 64KB, only allowed for POST/PUT/PATCH/DELETE                                 |

**Header Validation:**

- Name must match `/^[A-Za-z0-9-]+$/`
- No newlines (`\r`, `\n`)
- Size limits enforced

---

#### **D. Network Security**

##### **Blocked Networks (Production Mode):**

**IPv4 CIDR Blocks:**

```javascript
BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8], // Invalid/Current network
  ["10.0.0.0", 8], // Private
  ["127.0.0.0", 8], // Loopback
  ["169.254.0.0", 16], // Link-local
  ["172.16.0.0", 12], // Private
  ["192.168.0.0", 16], // Private
  ["224.0.0.0", 4], // Multicast
  ["240.0.0.0", 4], // Reserved
];
```

**IPv6 CIDR Blocks:**

```javascript
BLOCKED_IPV6_CIDRS = [
  ["::", 128], // Unspecified
  ["::1", 128], // Loopback
  ["fc00::", 7], // Unique local
  ["fe80::", 10], // Link-local
  ["ff00::", 8], // Multicast
  ["2001:db8::", 32], // Documentation
  ["::ffff:0:0", 96], // IPv4-mapped
];
```

##### **Blocked Hostnames:**

```javascript
BLOCKED_HOSTNAMES = [
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "docker.internal",
  "metadata.google.internal",
  "metadata",
];
```

Plus patterns:

- `*.localhost`
- `*.local`
- `*.internal`

##### **`validateTargetUrl(url, { isDev, dnsLookup })`**

**Flow:**

```
Parse URL
  ↓
Check protocol (must be http/https)
  ↓
If dev mode → Allow all
  ↓
Check hostname against BLOCKED_HOSTNAMES
  ↓
If IP → Check against BLOCKED_IPV4/6_CIDRS
  ↓
If hostname → DNS lookup
  ↓
Check all resolved IPs against blocked CIDRs
  ↓
Return error or null (allowed)
```

**IP Range Checking:**

- **IPv4**: Converts to 32-bit integer, applies CIDR mask, compares
- **IPv6**: Converts to 128-bit BigInt, applies CIDR shift, compares

**Functions:**

- `ipv4ToInt(ip)` → Converts `"192.168.1.1"` to `3232235777`
- `isIpv4InCidr(ip, base, prefix)` → Checks if IP is in CIDR range
- `ipv6ToBigInt(ip)` → Converts IPv6 to BigInt
- `isIpv6InCidr(ip, base, prefix)` → Checks IPv6 CIDR membership
- `isBlockedIp(ip)` → Checks IP against all blocked ranges

---

#### **E. Container Execution**

##### **Container Runtime Detection**

**`defaultRuntimeResolver(execFileCheck)`**

Auto-detects available container runtime:

1. Check if `podman` is available (`podman --version`)
2. If not, check if `docker` is available (`docker --version`)
3. If neither, throw error

**Podman /etc/containers/nodocker Marker:**

- Podman emulates Docker CLI by default (warns about `docker` command)
- Creating `/etc/containers/nodocker` silences this warning
- `createNoDockerEnsurer()` creates this marker file on first run

##### **`buildCurlArgs(spec)`**

Converts request spec into curl CLI arguments:

```javascript
[
  "-sS", // Silent with errors
  "--proto",
  "=http,https", // Only HTTP/HTTPS
  "--max-redirs",
  "0", // No redirects
  "--connect-timeout",
  "4", // 4s connect timeout
  "--max-time",
  "5", // 5s total timeout
  "-X",
  method, // HTTP method
  url, // Target URL
  "-H",
  "Name: Value", // Headers
  "--data-raw",
  body, // Body (if present)
];
```

##### **Container Security Configuration**

```javascript
const containerArgs = [
  "run",
  "--rm", // Remove after execution
  "--memory=64m", // 64MB RAM limit
  "--cpus=0.5", // 0.5 CPU cores
  "--pids-limit=64", // Max 64 processes
  "--read-only", // Read-only root filesystem
  "--cap-drop=ALL", // Drop all capabilities
  "--security-opt=no-new-privileges", // Prevent privilege escalation
  `--network=${networkMode}`, // 'bridge' or 'host' (dev)
  "--tmpfs=/tmp:rw,noexec,nosuid,size=16m", // 16MB temp storage
  "--user=65534:65534", // Nobody user
  "curlimages/curl", // Official curl image
  ...curlArgs, // Curl arguments
];
```

**Network Modes:**

- **Production**: `--network=bridge` (isolated network)
- **Dev + localhost target**: `--network=host` (access host network)

##### **Execution Flow**

```
POST /api/run-curl { command: "..." }
  ↓
resolveRequestSpec()
  ├─ parseCurlCommand()
  └─ validateRequestSpec()
  ↓
validateTargetUrl()
  ↓
getContainerRuntime() (podman/docker)
  ↓
ensureNoDockerMarker()
  ↓
buildCurlArgs()
  ↓
execFile(runtime, containerArgs, callback)
  ↓
5s timeout, 1MB max output
  ↓
Return { success, output } or { error, details }
```

---

## 🔄 Data Flow Diagrams

### 1. Page Load Flow

````
Browser requests /
  ↓
server.js sends index.html
  ↓
Browser loads app.js, style.css
  ↓
app.js: checkAuthStatus()
  ├─ GET /api/auth/status
  └─ If unauthenticated → showLogin()
  ↓
app.js: loadDocsTree()
  ├─ GET /api/docs/tree
  └─ renderDocTree()
  ↓
User clicks document
  ↓
app.js: loadDoc(path)
  ├─ GET /api/docs/content?path=...
  └─ Render markdown
      ↓
  Scan for ```curl blocks
      ↓
  createPlayground() for each block
````

### 2. Authentication Flow

```
User enters password
  ↓
app.js: POST /api/auth/login { password }
  ↓
server.js: isPasswordValid()
  ├─ hashPassword(input)
  ├─ hashPassword(configured)
  └─ crypto.timingSafeEqual()
  ↓
If valid:
  ├─ createSessionToken(secret)
  ├─ buildSessionCookie(token)
  └─ Set-Cookie header
  ↓
Browser stores cookie
  ↓
Future requests include cookie
  ↓
server.js: isAuthenticated()
  ├─ parseCookies()
  └─ isSessionTokenValid()
```

### 3. Curl Execution Flow

```
User edits curl command in playground
  ↓
User clicks "Run"
  ↓
app.js: executeCurlCommand(state)
  ↓
replacePlaceholders($APP_URL, $TOKEN)
  ↓
POST /api/run-curl { command: "curl ..." }
  ↓
curl-runner.js: resolveRequestSpec()
  ├─ tokenizeCommand()
  ├─ parseCurlCommand()
  └─ validateRequestSpec()
  ↓
validateTargetUrl()
  ├─ URL parse
  ├─ Hostname checks
  └─ DNS lookup + IP checks
  ↓
getContainerRuntime()
  ↓
buildCurlArgs()
  ↓
execFile(podman/docker, containerArgs)
  ↓
Container executes curl with limits
  ↓
Container returns stdout/stderr
  ↓
Return JSON { success, output } or { error, details }
  ↓
app.js: Display result with highlighting
```

---

## 🔐 Security Architecture

### Defense Layers

```
┌─────────────────────────────────────────────┐
│  Layer 1: Input Validation                  │
│  - Command tokenization                     │
│  - Syntax validation                        │
│  - Size limits (20KB command, 64KB body)    │
└─────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────┐
│  Layer 2: Request Validation                │
│  - Method whitelist                         │
│  - Header validation (regex, size)          │
│  - Flag blacklist (-F, -L)                  │
└─────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────┐
│  Layer 3: Network Security                  │
│  - URL validation                           │
│  - Hostname blacklist                       │
│  - IP range blocking (CIDR)                 │
│  - DNS resolution + IP checks               │
└─────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────┐
│  Layer 4: Container Isolation               │
│  - Read-only filesystem                     │
│  - No capabilities                          │
│  - Non-root user (nobody)                   │
│  - Resource limits (CPU, RAM, PIDs)         │
│  - Network isolation (bridge mode)          │
│  - 5s timeout                               │
└─────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────┐
│  Layer 5: Output Sanitization               │
│  - 1MB output limit                         │
│  - Timeout enforcement                      │
└─────────────────────────────────────────────┘
```

### Attack Surface Mitigation

| Attack Vector                          | Mitigation                                              |
| -------------------------------------- | ------------------------------------------------------- |
| **SSRF (Server-Side Request Forgery)** | IP/hostname blocking, DNS resolution checks             |
| **Command Injection**                  | Shell tokenizer, container isolation, flag whitelist    |
| **Path Traversal**                     | Path normalization, prefix checks                       |
| **DoS (Resource Exhaustion)**          | Container limits (CPU, RAM, timeout), input size limits |
| **Credential Theft**                   | HttpOnly cookies, timing-safe password comparison       |
| **Session Hijacking**                  | HMAC-signed tokens, SameSite cookies, 3-day expiry      |
| **Redirect Following**                 | `--max-redirs 0`                                        |
| **File Upload**                        | `-F` flag blacklisted                                   |

---

## 📊 State Management

### Frontend State

| State                 | Storage         | Purpose                              |
| --------------------- | --------------- | ------------------------------------ |
| `playgroundStates`    | Map (memory)    | Manages all active playgrounds by ID |
| `envInputs`           | Object (memory) | References to env input elements     |
| `fullscreenState`     | Object (memory) | Tracks fullscreen playground state   |
| `localStorage.appUrl` | Browser storage | Persists `$APP_URL`                  |
| `localStorage.token`  | Browser storage | Persists `$TOKEN`                    |

### Backend State

| State                | Storage                              | Scope                             |
| -------------------- | ------------------------------------ | --------------------------------- |
| `sessionSecret`      | Memory (randomized per server start) | HMAC signing key                  |
| `docsDir`            | Memory                               | Documentation directory path      |
| `authEnabled`        | Memory                               | Whether auth is required          |
| `configuredPassword` | Memory                               | Hashed password                   |
| `runtimePromise`     | Memory (lazy)                        | Container runtime (podman/docker) |

**Session Tokens:**

- Stored in HTTP-only cookies
- 3-day TTL
- Validated on each protected request
- Invalidated on logout

---

## 🧩 Module Dependencies

### Backend

```
server.js
├── express (HTTP server)
├── markdown-it (Markdown rendering)
├── crypto (Password hashing, HMAC)
├── fs (File operations)
├── path (Path manipulation)
└── curl-runner.js (Curl execution)

curl-runner.js
├── child_process.execFile (Container execution)
├── dns.promises.lookup (DNS resolution)
├── fs/promises (File operations)
└── net (IP validation)
```

### Frontend

```
app.js
├── fetch API (HTTP requests)
├── localStorage (Environment persistence)
├── DOM APIs (UI manipulation)
└── hljs (Optional syntax highlighting)

index.html
├── highlight.js (Syntax highlighting)
└── app.js, style.css
```

---

## 🚦 Error Handling

### Frontend

- **Network errors**: Display "Failed to connect" message
- **401 Unauthorized**: Redirect to login modal
- **Validation errors**: Show inline error in playground
- **Missing env vars**: Warn user before execution

### Backend

- **Authentication errors**: Return 401 with `{ error: "..." }`
- **Validation errors**: Return 400 with `{ error: "..." }`
- **Execution errors**: Return 500 with `{ error, details }`
- **File not found**: Return 404 with `{ error: "..." }`

### Container Execution

- **Timeout**: Kill process after 5 seconds
- **Output overflow**: Truncate at 1MB
- **Runtime unavailable**: Reject with error message

---

## 🎯 Performance Considerations

### Optimizations

- **Lazy container runtime detection**: Only resolves on first `/api/run-curl` request
- **Cached documentation tree**: Built on each request (could be cached)
- **Stateless authentication**: No database, HMAC-signed tokens
- **Container reuse**: `--rm` flag removes containers immediately

### Bottlenecks

- **Markdown rendering**: Synchronous, blocks request (could be async)
- **Container startup**: ~500ms overhead per curl execution
- **DNS lookups**: Can add 100-500ms per validation

---

## 🔧 Extension Points

### Custom Container Images

Pass `dockerImage` option to `setupCurlRoutes()`:

```javascript
setupCurlRoutes(app, {
  dockerImage: "my-custom-curl:latest",
});
```

### Custom DNS Resolver

Pass `dnsLookup` function:

```javascript
setupCurlRoutes(app, {
  dnsLookup: async (hostname) => {
    /* custom logic */
  },
});
```

### Custom Runtime Resolver

Pass `runtimeResolver`:

```javascript
setupCurlRoutes(app, {
  runtimeResolver: async () => "podman",
});
```

---

## 📈 Scalability

### Current Limitations

- **Single-threaded**: Node.js event loop (can handle ~1000 req/s for docs)
- **Container overhead**: Each curl exec spawns a container (~500ms)
- **No caching**: Documentation tree rebuilt on each request
- **No rate limiting**: Vulnerable to DoS

### Scaling Strategies

1. **Horizontal scaling**: Run multiple instances behind load balancer
2. **Container pooling**: Pre-warm containers (complex)
3. **Cache documentation tree**: Update on file change events
4. **Rate limiting**: Use `express-rate-limit` middleware
5. **CDN for static files**: Serve frontend from CDN
6. **Async markdown rendering**: Use worker threads

---

## 🧪 Testing Strategy

### Unit Tests

- `tokenizeCommand()` - Shell parsing edge cases
- `parseCurlCommand()` - Flag handling, body inference
- `validateRequestSpec()` - Limit enforcement
- `isIpv4InCidr()`, `isIpv6InCidr()` - CIDR matching
- `validateTargetUrl()` - DNS resolution, IP blocking

### Integration Tests

- Authentication flow (login, logout, session validation)
- Documentation API (tree, content, path traversal)
- Curl execution (success, validation errors, timeout)

### Security Tests

- Path traversal attempts
- SSRF attempts (private IPs, metadata endpoints)
- Command injection attempts
- Resource exhaustion (large payloads, long-running)

---

## 🔮 Future Architecture Improvements

1. **WebSocket support**: Real-time curl streaming output
2. **Request queuing**: Limit concurrent executions with queue
3. **Distributed caching**: Redis for session storage
4. **Microservices**: Separate curl execution into dedicated service
5. **Metrics & monitoring**: Prometheus, Grafana
6. **Multi-tenancy**: Support multiple projects per instance

---

**This architecture ensures security, scalability, and maintainability while providing a delightful developer experience. 🚀**
