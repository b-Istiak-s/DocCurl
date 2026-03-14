# Self-Test API

These examples target DocCurl's own API so you can validate the docs viewer, request runner, and response rendering without launching any external service.

## Recommended Mode

Run these in development mode:

```bash
doccurl serve --dev
```

The self-test curls below assume localhost access is allowed and no password is required.

## `GET /api/auth/status`

Checks whether the current DocCurl app is open or password-protected.

```curl
curl "$DOCCURL_BASE_URL/api/auth/status"
```

## `GET /api/docs/tree`

Returns the Markdown navigation tree that powers the left sidebar.

```curl
curl "$DOCCURL_BASE_URL/api/docs/tree"
```

## `GET /api/docs/content?path=overview.md`

Fetches a rendered document payload, including HTML and raw Markdown.

```curl
curl "$DOCCURL_BASE_URL/api/docs/content?path=overview.md"
```

## `POST /api/run-curl`

Runs a safe nested curl command through DocCurl itself.

```curl
curl -X POST "$DOCCURL_BASE_URL/api/run-curl" \
  -H "Content-Type: application/json" \
  -d '{"command":"curl \"$DOCCURL_BASE_URL/api/auth/status\""}'
```

## Auth Endpoints

`POST /api/auth/login` and `POST /api/auth/logout` are part of the public API, but they are not good playground self-tests today. The current curl subset does not include cookie persistence, so browser-style session flows are better verified through the normal UI or dedicated integration tests.
