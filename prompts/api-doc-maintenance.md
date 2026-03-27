# API Documentation Maintenance Prompt

## Purpose

Use this prompt when you want an agent to inspect newly added or changed APIs and update an existing Markdown documentation set.

## Inputs

Provide these inputs before the agent begins:

- `REPOSITORY_CONTEXT`: brief description of the codebase, stack, and any relevant conventions
- `DOCS_ROOT`: the root directory that contains the current Markdown API docs
- `CHANGE_SCOPE`: the new or modified endpoints, modules, resources, commits, pull request scope, or feature area to inspect
- `GROUPING_RULES`: any preferred organization rules if they differ from the default domain-based grouping
- `BASE_URL_VARIABLE`: the environment variable to use in curl examples, such as `$APP_URL`
- `AUTH_TOKEN_VARIABLE`: the environment variable to use for authenticated requests, such as `$TOKEN`
- `OUTPUT_CONSTRAINTS`: optional constraints such as files to avoid touching, naming rules, or style requirements

## Prompt

Act as a senior-level software engineer and API documentation maintainer. Your job is to inspect the codebase for new or changed APIs, compare the implementation against the current docs, and then add, update, or reorganize the Markdown documentation as needed.

You must use subagents to gather information from the repository. Have them inspect the request lifecycle in this order wherever the codebase supports it:

`route -> middleware -> validation -> controller -> service -> repository`

Use subagents to discover what changed, but you must perform the final reconciliation yourself before editing docs.

Your documentation updates must be based on actual implementation details from code, schemas, validators, types, and usage paths. Do not guess. If the docs and implementation disagree, treat the code as the source of truth and update the docs accordingly.

For each affected endpoint, determine and reconcile:

- HTTP method and path
- what is required and what is optional
- auth requirements
- required and optional headers
- path parameters
- query parameters
- body fields
- field types
- defaults, constraints, and business rules
- accepted-but-unused or ignored inputs, when that is provable
- side effects or persistence behavior that materially changes how the endpoint should be documented

Maintenance workflow:

- Inspect the existing docs under `DOCS_ROOT` before making changes.
- Reuse current docs style and grouping when it still makes sense.
- Update an existing file when the endpoint belongs there.
- Create a new file or subdirectory when the existing layout no longer fits cleanly.
- Avoid duplicating endpoints that are already documented elsewhere.
- Remove or correct stale fields, outdated required flags, broken curl examples, and obsolete descriptions when they no longer match the implementation.
- Only restructure the docs tree when needed to preserve clarity.

Use these default organization rules unless `GROUPING_RULES` says otherwise:

- Group APIs by domain or resource.
- Keep related CRUD endpoints in the same Markdown file when that remains clear and maintainable.
- Place related behavior such as likes, comments, reactions, moderation, attachments, or workflow actions in a sensible subdirectory or neighboring file structure.
- Do not flatten unrelated endpoints into one file.
- Prefer the smallest change that keeps the docs clean and predictable.

For every documented or updated API, use this exact section structure:

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
- Use one table with exactly these columns: `field`, `type`, `required`, `description`.
- Add `###### API name` immediately before the curl block. This is a second API-name line for the runnable example section.
- Document only fields that matter for using the endpoint. If needed, distinguish location in the `field` column, such as `header.Authorization`, `path.id`, `query.limit`, or `body.title`.
- Ensure curl examples reflect the current implementation and use the provided `BASE_URL_VARIABLE` and `AUTH_TOKEN_VARIABLE`.

Required output behavior:

- Update or create Markdown files under `DOCS_ROOT`.
- Keep the docs tree coherent and maintainable after the update.
- Preserve existing good organization when possible.
- Make new files or directories when required to fit new APIs properly.
- After editing, summarize what changed in the docs, including which APIs were added, updated, corrected, or reorganized.

Do not ship vague or speculative documentation. If a behavior cannot be supported by repository evidence, do not state it as fact.
