# Manual smoke checklist

Run this before every release, on macOS, Windows and Linux, against a real deployment. These are the things the automated tests can't cover, because they need a real keychain, browser, account or storage service.

Use a test account, never your real library. Point the CLI at a development deployment with `BOOKMARK_API_URL` (never commit that URL).

## Setup

- [ ] `npm ci && npm run build && npm link` works, and `bookmark --version` prints the version.
- [ ] `bookmark --help` lists every command.

## Account

- [ ] With `BOOKMARK_TOKEN` set to a real Token, `bookmark whoami` shows your name, email and plan, and `Token: BOOKMARK_TOKEN`.
- [ ] With an invalid Token, `bookmark whoami` exits 3.

## Login

Do these on each OS. Before you start, unset `BOOKMARK_TOKEN` and `BOOKMARK_NO_KEYRING`.

- [ ] `bookmark login` in a terminal shows the User code, and pressing Enter opens the browser at the approval page with the code filled in.
- [ ] Approving in the browser finishes the login on its own, and `bookmark whoami` shows `Token: keychain`.
- [ ] The Token is in the OS keychain under the service `bookmark-land-cli`, with the API host as the account: Keychain Access on macOS, Credential Manager on Windows, Seahorse (Secret Service) on Linux. `credentials.json` has no entry for that host.
- [ ] On Linux without Secret Service (for example a server with no desktop), `login` stores the Token in `~/.config/bookmark-land/credentials.json` with mode 0600, and `whoami` shows `Token: config file`.
- [ ] Denying the request in the browser makes `login` exit 3 with a clear message.
- [ ] With an account without Pro, the approval page and the CLI both say that API access needs Pro.
- [ ] `bookmark login < /dev/null` (no TTY) prints the code and URL without prompting, and finishes after you approve from another device.
- [ ] `bookmark login --scopes destructive` asks for the extra Scope on the approval page.
- [ ] The login is listed in Settings under this computer's hostname, or under the `--client-name` you gave.
- [ ] `echo "$TOKEN" | bookmark login --with-token` stores a Token created in Settings, and a wrong Token exits 3 and stores nothing.
- [ ] `bookmark logout` revokes the Token (it disappears from Settings) and forgets it: it is no longer in the keychain.
