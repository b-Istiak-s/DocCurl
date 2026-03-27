# API Documentation Authoring Prompt

## Purpose

Use this prompt when you want an agent to analyze a backend repository and produce first-pass API documentation in Markdown files.

## Inputs

Provide these inputs before the agent begins:

- `REPOSITORY_CONTEXT`: brief description of the codebase, stack, and any relevant conventions
- `TARGET_SCOPE`: the endpoints, modules, resources, or domain area to document
- `DOCS_ROOT`: the root directory where Markdown docs should be created or updated
- `BASE_URL_VARIABLE`: the environment variable to use in curl examples, such as `$APP_URL`
- `AUTH_TOKEN_VARIABLE`: the environment variable to use for authenticated requests, such as `$TOKEN`
- `OUTPUT_CONSTRAINTS`: optional constraints such as naming rules, excluded areas, or style requirements

## Prompt

Act as a senior-level software engineer and API documentation specialist. Your job is to analyze the repository thoroughly and produce accurate API documentation in `.md` files.

You must use subagents to analyze the codebase. Have them inspect the request lifecycle in this order wherever the codebase supports it:

`route -> middleware -> validation -> controller -> service -> repository`

Your documentation must be derived from actual code, schemas, validators, types, and usage paths. Do not guess. If the implementation is ambiguous, say so plainly and document only what is supported by evidence from the repository.

For each endpoint in scope, determine and document:

- HTTP method and path
- what is required and what is optional
- auth requirements
- required and optional headers
- path parameters
- query parameters
- body fields
- field types
- defaults, constraints, and business rules
- what is accepted but ignored or not meaningfully used, if that can be proven from the code
- any important side effects or repository-level persistence behavior that materially affects how the endpoint works

Before writing docs, analyze how the docs should be organized. Keep the Markdown tree clean and predictable.

Use these organization rules:

- Group APIs by domain or resource, not by one-file-per-endpoint by default.
- Keep related CRUD endpoints in the same Markdown file when that produces a clearer doc set.
- If a resource has adjacent behavior such as likes, comments, reactions, bookmarks, attachments, moderation, or workflow actions, place them in a sensible subdirectory or neighboring file structure rather than mixing unrelated concerns.
- Do not dump unrelated endpoints into one flat file.
- Prefer an organization scheme that a human maintainer could continue without rethinking the whole tree.
- Create or update files as needed so the docs structure stays coherent.

For every documented API, use this exact section structure:

````markdown
## API name

## brief description

| field | type | required | description |
| --- | --- | --- | --- |
| example_field | string | yes | Explain what the field does. |

###### API name

```curl
curl \
  -X POST \
  "$APP_URL/api/example" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "example_field": "value"
  }'
```
````

Rules for this format:

- Use `## API name` for every endpoint entry.
- Include `## brief description` only when the API name alone is not sufficiently clear.
- Use a single table with exactly these columns: `field`, `type`, `required`, `description`.
- Add `###### API name` immediately before the curl block. This is a second API-name line for the runnable example section.
- Include only fields that are relevant to using the endpoint. If needed, distinguish fields by location in the `field` column, such as `header.Authorization`, `path.id`, `query.limit`, or `body.title`.
- Make the curl example runnable and realistic for the documented endpoint.
- Use the provided `BASE_URL_VARIABLE` and `AUTH_TOKEN_VARIABLE` placeholders consistently in examples.

Execution requirements:

- Spawn subagents to gather evidence from the relevant code paths.
- Synthesize the findings into final docs yourself instead of copying raw subagent output.
- Reconcile conflicts across route, middleware, validation, controller, service, and repository layers before documenting behavior.
- Prefer concise, high-signal wording over speculative explanation.
- Keep the final Markdown generic and implementation-aware, but readable for humans who did not inspect the code.

Deliverables:

- Create or update Markdown files under `DOCS_ROOT`.
- Organize files by resource and behavior in a maintainable structure.
- Ensure every documented endpoint follows the required section format.
- If something expected is absent from the code, omit it rather than inventing it.
