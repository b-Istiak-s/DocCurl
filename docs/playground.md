# Playground Guide

The DocCurl playground is intentionally small and safe: it supports the common `curl` pieces you need for docs-driven testing, while rejecting flags that make sandboxing harder.

## Supported Command Shape

DocCurl accepts a safe subset of `curl`, including:

- URL as a positional argument or `--url`
- HTTP method via `-X` or `--request`
- headers via `-H` or `--header`
- request data via `-d`, `--data`, `--data-raw`, `--data-binary`, and `--data-urlencode`
- multipart text fields via `-F "field=value"`
- generated multipart uploads via `-F "field=@R&{filename.ext}"`
- browser-selected multipart uploads via `-F "field=@/tmp/file.pdf"` or `-F "field=@avatar.png"`
- `HEAD` requests via `-I` or `--head`

DocCurl generates a minimal backend file for `@R&{filename.ext}` uploads. Supported extensions are `png`, `jpg`, `jpeg`, `webp`, `gif`, `avif`, `mp4`, `webm`, and `pdf`.

For any other `@...` multipart file value, the playground shows an `Upload Files` toggle beside `Copy`. That panel mirrors the curl multipart file rows, lets users choose browser files for those rows, and sends them only for matching multipart fields. Missing browser files for non-generated `@...` parts block the run. Uploads are limited to `10 MB` per file and `25 MB` total.

Unsupported examples include multipart file modifiers such as `;type=` or `;filename=`, proxy flags, redirect following, and cookie-jar workflows.

## Placeholder Variables

Any `$VARIABLE_NAME` inside a `curl` block is discovered automatically and shown in the environment toolbar above the document.

For the built-in self-test docs, DocCurl pre-fills:

- `$DOCCURL_BASE_URL`: set this to your running DocCurl app URL, for example `http://localhost:3000`

Add it from the UI before running the self-test examples.

## Example Request

```curl
curl -X POST "$DOCCURL_BASE_URL/api/run-curl" \
  -H "Content-Type: application/json" \
  -d '{"command":"curl \"$DOCCURL_BASE_URL/api/auth/status\""}'
```

That request asks DocCurl to run another safe `curl` command and return the nested output as JSON.

## Tips

- Edit the left pane directly; the highlighted overlay stays aligned with the textarea.
- Use `Copy` to copy current env exports plus the exact curl block you are editing.
- Use `Upload Files` for non-generated multipart file fields; generated `@R&{...}` fields still work without browser uploads.
- Use `Export Curls` to export every markdown file’s curl examples as Insomnia, OpenAPI 3.1, Postman, or Hoppscotch JSON.
- Use fullscreen when you want more horizontal space for large JSON bodies or responses.
- Add `--doccurl-request-schema`, `--doccurl-response-schema`, and `--doccurl-field-descriptions` flags to document request/response shapes and surface a **Schema** button for live diffs. See [Schemas](./schemas.md).
- Reset document changes from the environment toolbar if you want to return to the original examples.
