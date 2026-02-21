# DocCurl

**Interactive curl command documentation viewer with live playground**

DocCurl is a web-based tool that allows you to document APIs with markdown files and test curl commands directly in an interactive playground. It features syntax highlighting, environment variable substitution, and secure sandboxed curl execution.

---

## 🚀 Features

- **📝 Markdown Documentation**: Write API documentation in simple markdown files
- **🎮 Interactive Playground**: Test curl commands in real-time with embedded playgrounds
- **🔒 Secure Execution**: Runs curl commands in isolated containers (Docker/Podman)
- **🌐 Environment Variables**: Support for `$APP_URL` and `$TOKEN` placeholders
- **🎨 Syntax Highlighting**: Beautiful code highlighting for curl commands and responses
- **🛡️ Password Protection**: Built-in authentication for production environments
- **📱 Responsive Design**: Works on desktop and mobile devices
- **🌳 Sidebar Navigation**: Hierarchical tree view of documentation with folders-first sorting

---

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Security](#security)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [License](#license)

---

## 📦 Installation

### Prerequisites

- **Node.js** (v14 or higher)
- **Docker** or **Podman** (for running curl commands in containers)

### Install from npm (if published)

```bash
npm install -g doccurl
```

### Install from source

```bash
git clone <repository-url>
cd doccurl
npm install
```

---

## 🏁 Quick Start

### 1. Create a new project

```bash
doccurl init my-api-docs
cd my-api-docs
```

### 2. Add your first markdown documentation

Create `docs/api.md`:

````markdown
# My API

## Get User

```curl
curl -X GET $APP_URL/api/users/123 \
  -H "Authorization: Bearer $TOKEN"
```
````

### 3. Start the server

**Development mode** (allows localhost targets):

```bash
doccurl serve --dev
```

**Production mode** (requires password):

```bash
doccurl serve --password yourSecurePassword123
```

### 4. Open in browser

Navigate to `http://localhost:3000`

---

## 💻 Usage

### Running the Server

```bash
doccurl serve [options]
```

**Options:**

- `-p, --port <port>` - Port number (default: `3000`)
- `-d, --dir <dir>` - Documentation directory (default: `docs`)
- `--dev` - Enable development mode (allows localhost/private IP targets)
- `--password <password>` - Set password for authentication (required in production)

**Examples:**

```bash
# Start on port 8080 with custom docs directory
doccurl serve -p 8080 -d ./documentation

# Development mode on default port
doccurl serve --dev

# Production mode with password
doccurl serve --password mySecret123
```

### Alternatively, use npm scripts

```bash
# Development mode
npm run dev

# Production mode (set password via --password flag in package.json)
npm start
```

---

## 📖 Documentation Format

### Basic Markdown

All documentation files should be `.md` files in your docs directory.

### Embedded Curl Playgrounds

Use fenced code blocks with the `curl` language identifier to create interactive playgrounds:

````markdown
# Example API Call

```curl
curl -X POST $APP_URL/api/data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "test"}'
```
````

### Environment Variables

DocCurl supports two built-in environment variables:

- **`$APP_URL`** - Base URL of your API (e.g., `https://api.example.com`)
- **`$TOKEN`** - Authentication token

Users can set these in the UI, and they persist in localStorage.

### Supported Curl Options

- `-X, --request` - HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD)
- `-H, --header` - HTTP headers
- `-d, --data, --data-raw, --data-binary, --data-urlencode` - Request body
- `--url` - Target URL
- `-I, --head` - Make HEAD request

**Not Supported:**

- `-F, --form` - Multipart form data (not allowed)
- `-L, --location` - Follow redirects (disabled for security)
- File uploads, cookies, authentication flags

---

## ⚙️ Configuration

### Directory Structure

```
my-project/
├── docs/              # Your markdown documentation
│   ├── getting-started.md
│   ├── api/
│   │   ├── users.md
│   │   └── posts.md
│   └── examples/
│       └── curl.md
└── (optional files)
```

### Directory Tree Behavior

The sidebar displays documentation with:

- **Folders first**, then files
- **Alphabetical sorting** within each group
- **Collapsible folders** (collapsed by default)

### Authentication Settings

#### Development Mode (`--dev`)

- Password protection is **optional**
- Allows curl requests to `localhost`, private IPs, and internal networks
- Ideal for local testing

#### Production Mode (default)

- Password protection is **required**
- Blocks requests to localhost, private IPs (10.x.x.x, 192.168.x.x, etc.)
- All `/api/*` routes are protected (except `/api/auth/*`)

### Password Authentication Flow

1. User enters password on login page
2. Server validates and issues session cookie (3-day TTL)
3. Cookie is used for subsequent API requests
4. Logout clears the session cookie

---

## 🔒 Security

### Sandboxed Curl Execution

All curl commands run in **isolated containers** with strict limitations:

- **No network access** to private networks in production
- **Read-only filesystem**
- **Limited memory** (64MB)
- **Limited CPU** (0.5 cores)
- **No privileged operations**
- **Restricted process count** (64 max)
- **Non-root user** (UID 65534)
- **5-second timeout**

### Network Restrictions

In production mode, the following are blocked:

- **Localhost**: `localhost`, `127.0.0.1`, `::1`
- **Private IPv4**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- **Link-local**: `169.254.0.0/16`, `fe80::/10`
- **Internal domains**: `*.localhost`, `*.local`, `*.internal`
- **Cloud metadata**: `metadata.google.internal`, etc.

### Input Validation

- **Command length**: Max 20,000 characters
- **URL length**: Max 2,048 characters
- **Headers**: Max 40 headers, each name ≤128 chars, value ≤2,048 chars
- **Body size**: Max 64KB
- **Output size**: Max 1MB

### Path Traversal Protection

All documentation paths are validated to prevent directory traversal attacks.

---

## 🔌 API Reference

### Authentication Endpoints

#### `GET /api/auth/status`

Check authentication status.

**Response:**

```json
{
  "authEnabled": true,
  "authenticated": false
}
```

#### `POST /api/auth/login`

Login with password.

**Request:**

```json
{
  "password": "yourPassword"
}
```

**Response:**

```json
{
  "success": true,
  "authEnabled": true,
  "authenticated": true
}
```

#### `POST /api/auth/logout`

Logout and clear session.

**Response:**

```json
{
  "success": true
}
```

### Documentation Endpoints

#### `GET /api/docs/tree`

Get the documentation directory tree.

**Response:**

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
    }
  ]
}
```

#### `GET /api/docs/content?path=<file-path>`

Get rendered markdown content.

**Query Parameters:**

- `path` - Relative path to markdown file (e.g., `api/users.md`)

**Response:**

```json
{
  "path": "api/users.md",
  "filename": "users.md",
  "html": "<h1>Users API</h1>...",
  "markdown": "# Users API\n..."
}
```

### Curl Execution Endpoint

#### `POST /api/run-curl`

Execute a curl command in a sandboxed container.

**Request (modern format):**

```json
{
  "command": "curl -X GET https://api.example.com/users"
}
```

**Request (legacy format):**

```json
{
  "url": "https://api.example.com/users",
  "method": "GET",
  "headers": {
    "Authorization": "Bearer token123"
  },
  "body": ""
}
```

**Response (success):**

```json
{
  "success": true,
  "output": "{\"users\": [...]}"
}
```

**Response (error):**

```json
{
  "error": "Execution failed",
  "details": "curl: (6) Could not resolve host"
}
```

---

## 📁 Project Structure

```
doccurl/
├── backend/
│   ├── server.js         # Express server, authentication, docs API
│   └── curl-runner.js    # Curl parsing, validation, container execution
├── frontend/
│   ├── index.html        # Main HTML page
│   ├── app.js            # Frontend logic, playground, navigation
│   └── style.css         # Styling
├── bin/
│   └── doccurl.js        # CLI entry point
├── docs/                 # Default documentation directory
│   └── (your .md files)
├── test/
│   └── curl-runner.test.js
├── package.json
└── README.md
```

---

## 🛠️ Development

### Setup

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

This uses `nodemon` to automatically restart on file changes.

### Run tests

```bash
npm test
```

### Manual Testing

1. Start server: `npm run dev`
2. Open browser: `http://localhost:3000`
3. Create test markdown files in `docs/`
4. Test curl playgrounds with different commands

---

## 🧪 Testing

Run the test suite:

```bash
npm test
```

Tests are located in `test/curl-runner.test.js` and cover:

- Command tokenization
- Curl command parsing
- Request validation
- URL validation
- IP blocking
- Container runtime detection

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Express** - Web framework
- **markdown-it** - Markdown parser
- **highlight.js** - Syntax highlighting (frontend)
- **curlimages/curl** - Official curl Docker image
- **Podman/Docker** - Container runtimes

---

## 📞 Support

For issues, questions, or feature requests, please open an issue on the repository.

---

## 🔮 Roadmap

Future enhancements:

- [ ] Custom theme support
- [ ] Export documentation as PDF
- [ ] OpenAPI/Swagger import
- [ ] Response history
- [ ] Multi-user authentication
- [ ] Rate limiting
- [ ] WebSocket support for long-running requests

---

**Happy documenting! 🎉**
