# Contributing

Thanks for helping out.

- **Bugs and ideas:** open an issue first, so we can agree on the approach before you write code.
- **Pull requests:** fork the repo, branch from `main`, and open a PR. Keep it focused on one change.
- **Review:** CodeRabbit reviews every PR automatically. A maintainer gives the final review and merges.

PRs from first-time contributors need a maintainer to approve the CI run before it starts.

## Development

You need Node.js 26 (the version is pinned in `.node-version`).

```sh
npm ci
npm run lint        # Biome: lint and format check (npm run format fixes)
npm run typecheck   # TypeScript, no output
npm test            # node --test against a fake API server
npm run build       # esbuild bundles dist/cli.js
node dist/cli.js --help
```

CI runs all four on Ubuntu, macOS and Windows. Run them before you push.

Run your build against another deployment with `--api-url` or `BOOKMARK_API_URL`. Never commit a development URL or a Token.

## Rules

Read [AGENTS.md](AGENTS.md): it lists the project's rules for people and coding agents alike. In short:

- Use only the public API, and use the words in [GLOSSARY.md](GLOSSARY.md).
- Command names, flags, `--json` output and exit codes are a public contract. See [docs/adr](docs/adr).
- Every test runs the real `bookmark` process against the fake API server in `test/fake-server.ts`. There are no live-API tests.
- Anything a test can't check goes in the manual [smoke checklist](docs/SMOKE.md).
