# Overview

DocCurl turns Markdown API notes into a browsable docs site with runnable `curl` examples.

## What It Does

- Serves a folder of Markdown files as a docs tree.
- Converts fenced `curl` blocks into a request editor and live response viewer.
- Replaces placeholders like `$DOCCURL_BASE_URL` before execution.
- Runs requests through a constrained Docker or Podman container.

## Quick Start

1. Start the docs site in development mode:

```bash
doccurl serve --dev
```

2. Open the app in your browser.
3. Add `DOCCURL_BASE_URL` in the environment bar and set it to your DocCurl app URL, for example `http://localhost:3000`.
4. Run any `curl` block directly from the page.

## First Self-Test

This example calls the running DocCurl app itself, so you can verify the playground without starting a second API.

```curl
curl "$DOCCURL_BASE_URL/api/auth/status"
```

In `--dev` mode without `--password`, the response should show `authEnabled: false` and `authenticated: true`.

## Notes

- Self-test examples are designed for `doccurl serve --dev`.
- In production mode, DocCurl blocks localhost and private-network targets by design.
- Browser auth and curl auth are different contexts. If password protection is enabled, browser login does not automatically authenticate sandboxed curl requests.
