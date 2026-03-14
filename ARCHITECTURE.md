# DocCurl Architecture

This document describes the current separation-of-concerns architecture.

## System Overview

DocCurl is a client-server system with a sandboxed curl execution engine:

- Frontend: static HTML/CSS + browser ESM modules.
- Server: Express app composition and HTTP routes.
- Core: pure domain logic (auth/session/docs pathing/tree).
- Engine: curl parsing, validation, URL policy, runtime detection, execution route.
- CLI: command entrypoint for project init and serving docs.

## Repository Layout

```txt
doccurl/
  core/
    auth/
      password.js
      session.js
    docs/
      paths.js
      tree.js

  engine/
    index.js
    curl/
      args.js
      constants.js
      network.js
      parse.js
      route.js
      runtime.js
      tokenize.js
      validate.js

  server/
    index.js
    app.js
    middleware/
      auth-required.js
    routes/
      auth.js
      curl.js
      docs.js

  cli/
    index.js
    commands/
      init.js
      serve.js

  docs/
    overview.md
    playground.md
    self-test-api.md

  frontend/
    index.html
    main.js
    style.css
    modules/
      api.js
      auth.js
      base-path.js
      bootstrap.js
      env.js
      playground.js
      tree.js

  test/
    engine/
      curl-runner.test.js
    server/
      server-auth.test.js
    frontend/
      frontend-env.test.js
```

## Concern Boundaries

### `core/`

Pure logic only. No Express, Commander, Docker/Podman orchestration, or browser DOM concerns.

- `core/auth/password.js`: password hashing and timing-safe verification.
- `core/auth/session.js`: session token signing/validation and cookie helpers.
- `core/docs/tree.js`: markdown file tree building and sorting.
- `core/docs/paths.js`: safe markdown path normalization and traversal protection.

### `engine/`

Execution/security pipeline for curl command handling.

- Parse and normalize incoming command payloads (`command` and legacy payload format).
- Validate request spec shape, methods, headers, and body constraints.
- Enforce URL/network policy (blocked hostnames, private CIDRs in production).
- Resolve container runtime (docker/podman) and optional podman nodocker marker handling.
- Build container/curl args and register `/api/run-curl` route.

### `server/`

HTTP transport and app composition only.

- `server/app.js`: creates an Express app (no listen side effect).
- Route modules register auth/docs/curl endpoints.
- Auth middleware protects `/api/*` (except auth endpoints) when enabled.
- `server/index.js`: start server, resolve dirs, export test-visible helpers.

### `cli/`

Command parsing and process entry only.

- `doccurl init <projectName>` copies starter docs from the packaged `docs/` directory into the new project.
- `doccurl serve` resolves runtime options and delegates to `startServer`.

### `frontend/`

Browser ESM modules by UI responsibility.

- `base-path.js`: mount-path inference and API path helpers.
- `api.js`: API client wrappers and unauthorized error handling.
- `env.js`: environment variable storage, placeholder discovery/replacement, and env toolbar UI.
- `playground.js`: curl editor/formatter/output/fullscreen behavior.
- `tree.js`: docs tree navigation + doc loading flow.
- `auth.js`: auth modal behavior and login submit flow.
- `bootstrap.js`: wiring and app startup orchestration.

## Runtime Flow

1. CLI starts server (`doccurl serve`) or app is started programmatically via `startServer`.
2. Server composes Express app and static frontend.
3. Frontend bootstraps:
   - Fetches `/api/auth/status`.
   - Loads docs tree and first document.
   - Discovers placeholders and renders env toolbar.
   - Converts curl markdown blocks into interactive playgrounds.
4. On run:
   - Frontend resolves placeholders from `doccurl.env` values.
   - Sends command to `/api/run-curl`.
   - Engine parses/validates/policy-checks and executes curl in container.
   - Output is returned and rendered with highlighting.

## Security Model

- Password-protected mode enabled in non-dev mode by default.
- Session cookie uses signed token with TTL and timing-safe checks.
- Docs file reads are path-normalized and traversal-safe.
- Curl execution runs in constrained container:
  - read-only FS
  - resource limits
  - reduced privileges
  - network mode restricted by environment/policy
- Production URL policy blocks local/private/internal destinations.

## Testing Strategy

- `test/engine/`: parser/validator/network/runtime/route behavior.
- `test/server/`: auth/session/docs access and protection flows.
- `test/frontend/`: env placeholder/defaulting + toolbar logic via lightweight DOM mocks.

Starter docs are optimized for self-testing in development mode. They document auth endpoints, but only the routes that work without cookie persistence are runnable from the built-in curl playground.

Tests use deterministic startup waits for HTTP servers to avoid `server.address()` race conditions.
