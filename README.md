# doccurl

Interactive curl documentation site with runnable playgrounds.

`doccurl` lets you write API docs in Markdown and run embedded `curl` commands from a browser UI. It serves docs, replaces placeholder variables (for example `$BASE_URL`), supports generated-file uploads like `@R&{avatar.png}` plus browser-selected multipart uploads like `@/tmp/avatar.png`, and executes requests in a sandboxed Docker/Podman container.

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
- `--password`: Prompts for a hidden password. Required in non-dev mode.

Examples:

```bash
doccurl serve --dev
doccurl serve -p 8080 -d ./documentation
doccurl serve --password
```

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

Each curl playground also includes:

- `Copy`: copies shell-ready `export NAME='value'` lines plus the current curl block exactly as shown.
- `Upload Files`: appears for multipart `-F` requests, lets users attach browser files for non-generated `@...` multipart parts, and keeps generated `@R&{...}` parts on the built-in synthetic-file path.
- `Export Curls`: exports all docs grouped by markdown file as Insomnia, Postman, or Hoppscotch JSON, including current env values.

Browser-selected uploads are limited to `10 MB` per file and `25 MB` total per run.

Starter docs use `$DOCCURL_BASE_URL`. Set it in the environment toolbar to your running DocCurl app URL so the built-in self-test pages can run without another service.

| Name                                                   | Supported | Plans to add                               | Priority |
| ------------------------------------------------------ | --------- | ------------------------------------------ | -------- |
| REST over HTTP/HTTPS                                   | Yes       | No specific change needed                  | x        |
| GraphQL over HTTP                                      | Yes       | No specific change needed                  | x        |
| SOAP over HTTP                                         | Yes       | No specific change needed                  | x        |
| JSON request/response APIs                             | Yes       | No specific change needed                  | x        |
| XML request/response APIs                              | Yes       | No specific change needed                  | x        |
| Query params in URL                                    | Yes       | No specific change needed                  | x        |
| Standard body data via `-d` / `--data-*`               | Yes       | No specific change needed                  | x        |
| Multipart text fields like `-F "field=value"`          | Yes       | No specific change needed                  | x        |
| Generated file uploads like `-F "file=@R&{x.pdf}"`     | Yes       | No specific change needed                  | x        |
| Browser multipart uploads like `-F "file=@/tmp/x.pdf"` | Yes       | No specific change needed                  | x        |
| Auth headers / API keys / Bearer tokens                | Yes       | No specific change needed                  | x        |
| Localhost/private targets in `--dev`                   | Yes       | No specific change needed                  | x        |
| WebSockets                                             | No        | Planned; likely via `websocat`             | high     |
| GraphQL subscriptions                                  | No        | Planned; likely via `graphql-transport-ws` | low      |
| gRPC                                                   | No        | Not planned yet                            | medium   |
| Browser-mapped multipart uploads using `@...` tokens   | Yes       | No specific change needed                  | x        |
| Redirect following with `-L`                           | No        | Not planned yet                            | low      |
| Proxy support                                          | No        | Not planned yet                            | low      |
| Cookie jar / session persistence workflows             | No        | Not planned yet                            | medium   |
| Long-lived streaming / interactive flows               | No        | Not planned yet                            | medium   |
| Client cert / mTLS curl flows                          | No        | Not planned yet                            | low      |
| WebRTC                                                 | No        | Planned;                                   | very low |

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
