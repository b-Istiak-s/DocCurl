# doccurl

Interactive curl documentation site with runnable playgrounds.

`doccurl` lets you write API docs in Markdown and run embedded `curl` commands from a browser UI. It serves docs, replaces placeholder variables (for example `$BASE_URL`), and executes requests in a sandboxed Docker/Podman container.

## Install

Global CLI install:

```bash
npm install -g doccurl
```

Run without global install:

```bash
npx doccurl --help
```

Requirements:

- Node.js 18+
- Docker or Podman
- ESM-capable runtime (doccurl is now fully ESM)

## Quick Start

1. Create a project:

```bash
doccurl init my-api-docs
cd my-api-docs
```

2. Start the docs site in development mode:

```bash
doccurl serve --dev
```

3. Open `http://localhost:3000`.

4. Use the bundled starter docs:

- `overview.md` for the product tour
- `playground.md` for the supported curl subset
- `self-test-api.md` for runnable examples that target DocCurl itself

5. Add your own docs when you are ready:

````markdown
# Users API

```curl
curl -X GET $BASE_URL/api/users/123 \\
  -H "Authorization: Bearer $API_TOKEN"
```
````

## CLI

### `doccurl init <projectName>`

Creates a project folder, a `docs/` directory, and starter Markdown docs.

### `doccurl serve [options]`

Options:

- `-p, --port <port>`: Server port. Default `3000`.
- `-d, --dir <dir>`: Docs directory. Default `docs`.
- `--dev`: Development mode (allows localhost/private targets).
- `--collapse`: Enables the `Focus Curls` toggle in the docs UI.
- `--password <password>`: Enables auth. Required in non-dev mode.

Examples:

```bash
doccurl serve --dev
doccurl serve -p 8080 -d ./documentation
doccurl serve --password mySecret123
```

## Markdown Playgrounds

Use fenced code blocks with `curl` language:

````markdown
```curl
curl -X POST $BASE_URL/api/data \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_TOKEN" \\
  -d '{"name":"test"}'
```
````

Placeholder variables are discovered from docs and can be managed in the UI. Values are stored in browser `localStorage` under `doccurl.env`.

Edited curl blocks are stored separately in browser `localStorage` under `doccurl.curlEdits.v1`, scoped by document path and curl block ID. Users can reset either the current page’s curl edits or all saved curl edits from the docs UI without affecting env vars.

Starter docs use `$DOCCURL_BASE_URL`. Set it in the environment toolbar to your running DocCurl app URL so the built-in self-test pages can run without another service.

## Built-in Self-Test Docs

New projects ship with runnable docs that exercise DocCurl against itself in `--dev` mode.

- `GET /api/auth/status`
- `GET /api/docs/tree`
- `GET /api/docs/content?path=overview.md`
- `POST /api/run-curl` with a nested curl command

These self-tests are meant for local development without password protection. Login and logout routes are documented, but not fully runnable from the playground because the safe curl subset does not include cookie persistence.

## Security Model

`/api/run-curl` executes curl in a locked-down container.

Key controls:

- Runtime isolation via Docker/Podman.
- In production mode, blocks localhost/private/internal targets.
- Request/response limits (headers/body/output/timeouts).
- Authentication for API/docs routes when password is enabled.

## API Endpoints

- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/docs/tree`
- `GET /api/docs/content?path=<file.md>`
- `POST /api/run-curl`

Example run-curl request:

```json
{
  "command": "curl -X GET https://api.example.com/users"
}
```

## Development

```bash
npm install
npm run dev
npm test
```

## Project Layout

```txt
core/      # pure auth/docs domain logic
engine/    # curl parse/validate/network/runtime/route
server/    # express app composition and API route wiring
cli/       # command entrypoint and commands
frontend/  # browser ESM modules and static UI assets
docs/      # starter docs copied by `doccurl init`
test/      # engine/server/frontend test suites
```

## Links

- npm: https://www.npmjs.com/package/doccurl
- repo: https://github.com/b-Istiak-s/doccurl
- issues: https://github.com/b-Istiak-s/doccurl/issues

## License

MIT
