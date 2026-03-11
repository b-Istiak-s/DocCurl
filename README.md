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

## Quick Start

1. Create a project:

```bash
doccurl init my-api-docs
cd my-api-docs
```

2. Add `docs/users.md`:

````markdown
# Users API

```curl
curl -X GET $BASE_URL/api/users/123 \\
  -H "Authorization: Bearer $API_TOKEN"
```
````

3. Start in development mode:

```bash
doccurl serve --dev
```

4. Open `http://localhost:3000`.

## CLI

### `doccurl init <projectName>`

Creates a project folder and a `docs/` directory.

### `doccurl serve [options]`

Options:

- `-p, --port <port>`: Server port. Default `3000`.
- `-d, --dir <dir>`: Docs directory. Default `docs`.
- `--dev`: Development mode (allows localhost/private targets).
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

## Links

- npm: https://www.npmjs.com/package/doccurl
- repo: https://github.com/b-Istiak-s/doccurl
- issues: https://github.com/b-Istiak-s/doccurl/issues

## License

MIT
