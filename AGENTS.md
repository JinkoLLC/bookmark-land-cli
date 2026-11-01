# Agent instructions

`bookmark` is the official command-line client for the bookmark.land public REST API. This repo is public and MIT-licensed.

## Rules

- **Public API only.** Use only the public REST API, as described at https://docs.bookmark.land/docs and in the spec issue (#3). The spec lists where the API behaves differently from the published docs. Write the types in `src/types.ts` by hand. If you find a new difference between the docs and the API, add it to the spec issue.
- **Nothing private.** Never add code, types, deployment names, internal URLs, test accounts or secrets from the private bookmark.land server repo, even in tests, comments or commit messages. Tests use the fake server in `test/fake-server.ts`; a dev API URL is passed at run time through `BOOKMARK_API_URL`, never committed.
- **Use the glossary.** Use the terms in `GLOSSARY.md` in code, help text and docs. In particular, "remove" moves something to the Trash; only "permanently delete" erases it.
- **Stable interface.** Command names, flags, `--json` output (the API's `data`, unchanged) and exit codes are a public contract that scripts and agents rely on. Don't rename or renumber them. See `docs/adr/`.
- **Agent-friendly.** Data goes to stdout, messages go to stderr. Never prompt when stdin isn't a TTY; anything that can't be undone needs `--yes` there.
- **No telemetry**, and no network calls except to the API URL.
- **Dependencies:** standard library first. The only runtime dependency is the optional `@napi-rs/keyring`. Ask before adding another.

## Layout

- `src/cli.ts`: entry point. Parses args, dispatches commands and turns errors into exit codes.
- `src/commands/`: one file per command group.
- `src/api.ts`: HTTP client. `src/auth.ts`: token storage. `src/device-login.ts`: browser login.
- `src/output.ts`: tables, TSV and JSON. `src/config.ts`: paths and API URL.
- `test/`: `node --test` with a fake API server.

## Before opening a PR

Run all of these and make sure they pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on JinkoLLC/bookmark-land-cli (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
