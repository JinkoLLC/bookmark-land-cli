# Manual smoke checklist

Run this before every release, on macOS, Windows and Linux, against a real deployment. These are the things the automated tests can't cover, because they need a real keychain, browser, account or storage service.

Use a test account, never your real library. Point the CLI at a development deployment with `BOOKMARK_API_URL` (never commit that URL).

## Setup

- [ ] `npm ci && npm run build && npm link` works, and `bookmark --version` prints the version.
- [ ] `bookmark --help` lists every command.

## Account

- [ ] With `BOOKMARK_TOKEN` set to a real Token, `bookmark whoami` shows your name, email and plan, and `Token: BOOKMARK_TOKEN`.
- [ ] With an invalid Token, `bookmark whoami` exits 3.
