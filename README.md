# doccurl

Interactive API documentation site with runnable `curl` and `soccli` playgrounds.

`doccurl` lets you write API docs in Markdown and run embedded `curl` and `soccli` commands from a browser UI. It serves docs, replaces placeholder variables (for example `$BASE_URL`), supports generated-file uploads like `@R&{avatar.png}` plus browser-selected multipart uploads like `@/tmp/avatar.png`, and executes requests in a sandboxed Docker/Podman container.

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
- `schemas.md` for documenting request/response shapes with `--doccurl-*-schema` flags
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
- `--host <host>`: Host interface to bind. Default `127.0.0.1`.
- `--dev`: Development mode (allows localhost/private targets).
- `--collapse`: Enables the `Focus Curls` toggle in the docs UI.
- `--password`: Prompts for a hidden password.
- `DOCCURL_PASSWORD`: Non-interactive password source for production launches such as PM2 or systemd.

Examples:

```bash
doccurl serve --dev
doccurl serve -p 8080 -d ./documentation
doccurl serve --host 0.0.0.0 -p 8080
doccurl serve --password
DOCCURL_PASSWORD=change-me doccurl serve
```

Reverse proxy note:

- Set `TRUST_PROXY=1` when DocCurl runs behind a trusted reverse proxy such as nginx so auth rate limiting uses the real client IP from `X-Forwarded-For`.
- Only enable `TRUST_PROXY` when the proxy is under your control and is responsible for setting `X-Forwarded-For`.

### `doccurl generate-md <inputFile>`

Generates DocCurl markdown from Postman, Insomnia, or Hoppscotch JSON.

Options:

- `--format <auto|postman|insomnia|hoppscotch>`: Import format. Default `auto`.
- `--out <dir>`: Output directory. Default `docs/imported`.
- `-v, --version`: Print the installed DocCurl version.

Examples:

```bash
doccurl --version
doccurl generate-md postman.json
doccurl generate-md insomnia-export.json --format insomnia --out docs/imported
```

Output rules:

- Each top-level collection or workspace becomes a directory.
- Folders with fewer than 8 requests become one markdown file named after the folder.
- Folders with 8 or more requests become a directory with `index.md` plus one file per request.

## Markdown Playgrounds

Use fenced code blocks with `curl` or `soccli` language:

````markdown
```curl
curl -X POST $BASE_URL/api/data \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_TOKEN" \\
  -d '{"name":"test"}'
```

```soccli
soccli raw connect wss://example.com/ws
```
````

Placeholder variables are discovered from docs and can be managed in the UI. Values are stored in browser `localStorage` under `doccurl.env`. Any script running in this origin can read them, so avoid storing long-lived secrets in shared or untrusted browsers.

Edited playground blocks are stored separately in browser `localStorage` under `doccurl.curlEdits.v1`, scoped by document path and block ID. Users can reset either the current page’s saved edits or all saved playground edits from the docs UI without affecting env vars.

Each playground also includes:

- `Copy`: copies shell-ready `export NAME='value'` lines plus the current curl block exactly as shown.
- `Upload Files`: appears for multipart `-F` requests, lets users attach browser files for non-generated `@...` multipart parts, and keeps generated `@R&{...}` parts on the built-in synthetic-file path.
- `Schema`: appears whenever a curl block attaches at least one `--doccurl-*-schema` flag. Opens a modal with two tabs — a Request docs table describing the request body and a Response docs table with a live diff (matches, type mismatches, missing fields, extras) against the most recent JSON response.
- `Export Curls`: exports all docs grouped by markdown file as Insomnia, OpenAPI 3.1, Postman, or Hoppscotch JSON, including current env values. Schema flags travel with the curl block in every format.

Browser-selected uploads are limited to `10 MB` per file and `25 MB` total per run.

`soccli` sessions stream incremental plain-text output in the browser and default to a `60` second session timeout.

### Documenting Request/Response Shapes

Attach JSON Schema 2020-12 to any curl block with three optional flags. They travel inline with the command, are stripped before `curl` runs, and unlock the Schema button plus the OpenAPI exporter. See [`docs/schemas.md`](docs/schemas.md) for the full vocabulary and authoring rules.

```bash
curl -X POST $BASE_URL/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com"}' \
  --doccurl-request-schema '{"type":"object","properties":{"name":{"type":"string"},"email":{"type":"string","format":"email"}},"required":["name","email"]}' \
  --doccurl-response-schema '{"type":"object","properties":{"id":{"type":"string"},"createdAt":{"type":"string","format":"date-time"}}}' \
  --doccurl-field-descriptions '{"name":"The user display name","email":"The contact email"}'
```

- Request schema: documentation only — never used for validation or auto-fill.
- Response schema: drives the live diff against the most recent response.
- Field descriptions: sidecar map merged into the docs table and the OpenAPI components.

Starter docs use `$DOCCURL_BASE_URL`. Set it in the environment toolbar to your running DocCurl app URL so the built-in self-test pages can run without another service.

| Name                                                   | Supported | Plans to add                          | Priority |
| ------------------------------------------------------ | --------- | ------------------------------------- | -------- |
| REST over HTTP/HTTPS                                   | Yes       | No specific change needed             | x        |
| GraphQL over HTTP                                      | Yes       | No specific change needed             | x        |
| SOAP over HTTP                                         | Yes       | No specific change needed             | x        |
| JSON request/response APIs                             | Yes       | No specific change needed             | x        |
| XML request/response APIs                              | Yes       | No specific change needed             | x        |
| Query params in URL                                    | Yes       | No specific change needed             | x        |
| Standard body data via `-d` / `--data-*`               | Yes       | No specific change needed             | x        |
| Multipart text fields like `-F "field=value"`          | Yes       | No specific change needed             | x        |
| Generated file uploads like `-F "file=@R&{x.pdf}"`     | Yes       | No specific change needed             | x        |
| Browser multipart uploads like `-F "file=@/tmp/x.pdf"` | Yes       | No specific change needed             | x        |
| Auth headers / API keys / Bearer tokens                | Yes       | No specific change needed             | x        |
| Localhost/private targets in `--dev`                   | Yes       | No specific change needed             | x        |
| WebSockets                                             | Yes       | Via `soccli` playground blocks        | x        |
| GraphQL subscriptions over WebSocket                   | Yes       | Via `soccli` (`graphql-transport-ws`) | x        |
| gRPC                                                   | No        | Not planned yet                       | medium   |
| Browser-mapped multipart uploads using `@...` tokens   | Yes       | No specific change needed             | x        |
| JSON Schema 2020-12 via `--doccurl-*-schema` flags     | Yes       | No specific change needed             | x        |
| Sidecar field descriptions via `--doccurl-field-descriptions` | Yes | No specific change needed           | x        |
| OpenAPI 3.1 export                                     | Yes       | No specific change needed             | x        |
| Redirect following with `-L`                           | No        | Not planned yet                       | low      |
| Proxy support                                          | No        | Not planned yet                       | low      |
| Cookie jar / session persistence workflows             | No        | Not planned yet                       | medium   |
| Long-lived streaming / interactive flows               | No        | Not planned yet                       | medium   |
| Client cert / mTLS curl flows                          | No        | Not planned yet                       | low      |
| WebRTC                                                 | No        | Planned;                              | very low |

## Built-in Self-Test Docs

New projects ship with runnable docs that exercise DocCurl against itself in `--dev` mode.

- `GET /api/auth/status`
- `GET /api/docs/tree`
- `GET /api/docs/content?path=overview.md`
- `POST /api/run-curl` with a nested curl command

These self-tests are meant for local development without password protection. Login and logout routes are documented, but not fully runnable from the playground because the safe curl subset does not include cookie persistence.

## Security Model

`/api/run-curl` and `/api/run-soccli` execute commands in locked-down containers.

Key controls:

- Runtime isolation via Docker/Podman.
- In production mode, blocks localhost/private/internal targets.
- Request/response limits (headers/body/output/timeouts). `curl` runs default to `5` seconds; `soccli` sessions default to `60` seconds.
- Authentication for API/docs routes when password is enabled.

Multipart form fields support:

- text parts like `field=value`
- DocCurl-managed generated file parts like `field=@R&{filename.ext}`
- browser-selected file parts like `field=@/tmp/file.pdf` or `field=@avatar.png`

Generated uploads support `png`, `jpg`, `jpeg`, `webp`, `gif`, `avif`, `mp4`, `webm`, and `pdf`. Browser-selected uploads are limited to `10 MB` per file and `25 MB` total per run. Advanced curl multipart file modifiers such as `;type=` and `;filename=` are still unsupported.

## API Endpoints

- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/docs/tree`
- `GET /api/docs/content?path=<file.md>`
- `POST /api/run-curl`
- `POST /api/run-soccli`

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
