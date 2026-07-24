# Schemas

DocCurl lets you document the shape of a request and a response inline with the `curl` block itself. The playground surfaces that documentation behind a **Schema** button on the response pane, and the OpenAPI exporter bundles every attached schema into a single OpenAPI 3.1 document.

## Flags

DocCurl understands three flags inside any `curl` block. They are stripped before the request runs, so `curl` never sees them.

| Flag | Purpose |
|---|---|
| `--doccurl-request-schema '<json>'` | JSON Schema 2020-12 describing the request body. Documentation only — never used for validation or auto-fill. |
| `--doccurl-response-schema '<json>'` | JSON Schema 2020-12 describing the response body. Used by the playground to live-diff against the actual response. |
| `--doccurl-field-descriptions '<json>'` | Sidecar map of field path → human-readable description. Merged into the rendered table. |

Both forms are accepted:

```bash
--doccurl-request-schema '{"type":"object","properties":{"name":{"type":"string"}}}'
--doccurl-request-schema='{"type":"object","properties":{"name":{"type":"string"}}}'
```

**Limits**

- 16 KB per schema, 16 KB per sidecar (enforced at parse time).
- Single-line JSON only. Multi-line values are rejected.
- No file references (`@schema.json` is rejected).
- Max one of each flag per block; duplicates are rejected.

## Example

```curl
curl -X POST "$DOCCURL_BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com"}' \
  --doccurl-request-schema '{"type":"object","properties":{"name":{"type":"string"},"email":{"type":"string","format":"email"}},"required":["name","email"]}' \
  --doccurl-response-schema '{"type":"object","properties":{"id":{"type":"string"},"createdAt":{"type":"string","format":"date-time"}}}' \
  --doccurl-field-descriptions '{"name":"The user display name","email":"The contact email","id":"Server-assigned identifier","createdAt":"RFC 3339 timestamp of creation"}'
```

After running, the **Schema** button appears on the response pane. Click it to open a modal with two tabs:

- **Request** — pure documentation table (Field, Type, Presence, Constraints, Description).
- **Response** — documentation table plus a live diff against the most recent run.

## The Live Diff

When a response schema is attached and the API returns JSON, the Response tab overlays the actual fields on top of the declared schema:

- `✓` **Matches** — every declared field present and type-compatible.
- `≠` **Type mismatches** — the field is present but the JSON type differs from the schema declaration.
- `⚠` **Missing from response** — declared in the schema but absent from the response.
- `+` **Extras** — fields present in the response but not in the schema, only shown when the schema has `additionalProperties: false`.

`number` and `integer` are treated as interchangeable; an integer response satisfies a `number` schema and vice versa. `array<…>` responses satisfy an `array` schema.

## Field Descriptions

The sidecar map lets you explain each field without bloating the schema. Keys may be either the dotted path of the field (`user.address.city`, `items[].id`) or just the leaf name (`name`). The renderer prefers the dotted match and falls back to the leaf.

If a field description is set, DocCurl also embeds it inside the deduped OpenAPI components so consumers can render the description directly from the spec.

## Supported Vocabulary (Documentation)

DocCurl renders the entire JSON Schema 2020-12 vocabulary in the table. The most common keywords:

| Keyword | Where it shows |
|---|---|
| `type` | Type column. Unions like `["string","null"]` render as `string · nullable`. |
| `enum`, `const` | Constraints column. |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | Constraints column as `≥ N`, `≤ N`, `> N`, `< N`, `multiple of N`. |
| `minLength`, `maxLength`, `pattern`, `format` | Constraints column. |
| `minItems`, `maxItems`, `uniqueItems` | Constraints column. |
| `items`, `properties` | Drives child rows for arrays of objects and nested objects. |
| `required` | Marks each child row as `Required` or `Optional`. |
| `additionalProperties: false` | `closed object` chip; enables the `+` extras diff. |
| `dependencies`, `dependentRequired`, `dependentSchemas` | Constraints column. |
| `deprecated`, `readOnly`, `writeOnly` | Badges on the row. |
| `default`, `examples` | Default in Constraints; examples in Description. |
| `oneOf`, `anyOf`, `allOf` | Rendered as union rows in the Type column. |
| `$ref` | Resolves and renders the referenced schema. |
| `description` | Used when no sidecar description is supplied. |

The full DocCurl JSON Schema vocabulary is documented in the playground's schema renderer; this table covers the most common keywords.

## Export

The OpenAPI 3.1 exporter bundles every `curl` block in your docs into a single spec:

- Paths are derived from the URL after the protocol and host.
- Numeric or UUID segments become path templates (`/users/{var1}`).
- Each request schema is added to `components.schemas` and referenced from the operation.
- Each response schema is added the same way and attached to the `200` response.
- Field descriptions are merged into the schemas as `description` keywords.

Postman and Insomnia exports also surface the schemas inside `request.description` plus a `meta` object so consumers can round-trip the documentation.

## Limitations

- Diff is one level deep. Nested objects are rendered as documentation but not diffed.
- `oneOf` / `anyOf` / `allOf` are rendered as a union row; the diff considers a field to match if observed type matches **any** branch.
- The request schema is documentation only. The playground does not validate the request against the schema or auto-fill any fields.
- The schema button is hidden for curl blocks that don't attach at least one schema flag.
