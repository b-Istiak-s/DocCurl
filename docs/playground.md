# Playground Guide

The DocCurl playground is intentionally small and safe: it supports the common `curl` pieces you need for docs-driven testing, while rejecting flags that make sandboxing harder.

## Supported Command Shape

DocCurl accepts a safe subset of `curl`, including:

- URL as a positional argument or `--url`
- HTTP method via `-X` or `--request`
- headers via `-H` or `--header`
- request data via `-d`, `--data`, `--data-raw`, `--data-binary`, and `--data-urlencode`
- `HEAD` requests via `-I` or `--head`

Unsupported examples include multipart uploads, proxy flags, redirect following, and cookie-jar workflows.

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
- Use fullscreen when you want more horizontal space for large JSON bodies or responses.
- Reset document changes from the environment toolbar if you want to return to the original examples.
