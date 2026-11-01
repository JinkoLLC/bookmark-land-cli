# bookmark

The official command-line client for [bookmark.land](https://bookmark.land). Manage your Bookmarks, Collections and Tags from a terminal, a script, CI or an AI agent, through the [public REST API](https://docs.bookmark.land/docs).

> **Status:** in development. Nothing is published to npm yet.

## Install

The CLI needs Node.js 26 or later. API access needs a bookmark.land Pro plan.

Until the first release, install from source:

```sh
git clone https://github.com/JinkoLLC/bookmark-land-cli.git
cd bookmark-land-cli
npm ci
npm run build
npm link        # puts `bookmark` on your PATH
bookmark --version
```

## Getting started

```sh
bookmark login     # sign in with your browser
bookmark whoami    # check which account you're using
bookmark --help    # list every command
```

Run `bookmark <command> --help` for a command's flags.

## Login

`bookmark login` signs you in with Device login, the way `gh auth login` does. It shows a User code, and when you press Enter it opens the approval page in your browser with the code already filled in. Approve it there and the CLI finishes on its own.

```sh
bookmark login                                   # default Scopes: read and write Bookmarks, Collections and Tags
bookmark login --scopes destructive,import,export # also allow Permanently deleting, importing and exporting
bookmark login --client-name "work laptop"        # the name this login is listed under in Settings (default: hostname)
echo "$TOKEN" | bookmark login --with-token      # store a Token you created in Settings, after checking it works
bookmark logout                                  # revoke this computer's Token on the server and forget it
```

- Over SSH, or whenever stdin isn't a terminal, `login` never prompts. It prints the User code and the approval URL, so you can approve from another device.
- The Token is stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). Without a keychain, or with `BOOKMARK_NO_KEYRING` set, it goes in `credentials.json` in the config folder, readable only by you.
- Tokens are stored per API host, so logging in to a development server doesn't replace your normal login.
- A command that needs a Scope you don't have tells you the `bookmark login --scopes …` command to run.

### Tokens for CI and agents

Set `BOOKMARK_TOKEN` to a Token you created in Settings. It takes precedence over any stored login, and nothing is written to disk. `bookmark logout` refuses to touch it: unset the variable instead, and revoke the Token in Settings if needed.

## Commands

### Finding Bookmarks

```sh
bookmark list                               # newest first: ID, TITLE, DOMAIN, TAGS
bookmark list --favorite --type article     # filters: --favorite, --domain, --type, --collection <name or id>
bookmark list --sort title --limit 200      # --sort newest|oldest|title|domain, --limit 1–200 (default 50)
bookmark list --cursor eyJwb3MiOjUwfQ       # the next page, from the hint after the table
bookmark search react hooks                 # Bookmarks whose title, description or URL match every word
bookmark show bk_123                        # every field of one Bookmark
bookmark open bk_123                        # print its URL and open it in your browser
```

- `--type` is one of `link`, `article`, `image`, `video`, `document`.
- When there are more results, `list` ends with the `--cursor` for the next page (on stderr). Repeat the same filters with it.
- `search` returns at most about 75 matches and has no pages.
- `open` only opens `http` and `https` URLs. It always prints the URL, so it also works over SSH.

### Saving and editing Bookmarks

```sh
bookmark add https://example.com                      # prints the new Bookmark's id
bookmark add https://example.com --title "Example" --tag dev --tag reading \
  --collection Reading --type article --favorite --note "Read later"
bookmark edit bk_123 --title "Better title"           # also --description, --url, --note
```

- `add` takes `--title`, `--description`, `--note`, `--tag` (repeat it), `--collection` (name or id; leave it out for Unsorted), `--type` and `--favorite`.
- If the URL is in the Trash, `add` Restores that Bookmark instead and says so. If it's already saved, the API saves another copy, and `add` warns you with the new id.
- The API rejects invalid input with a generic error, so the CLI checks the limits first and tells you what's wrong: URLs must be `http` or `https` and up to 2,048 characters, titles up to 100, descriptions and notes up to 500, at most 10 Tags of up to 25 characters each.

### Collections

```sh
bookmark collections list                          # nesting and Bookmark counts
bookmark collections list --trashed                # Collections in the Trash
bookmark collections show Reading                  # details, including notes
bookmark collections add React --parent Frontend --icon atom --color blue
bookmark collections edit Reading --name "To read" --notes "Long reads for the weekend"
bookmark collections rm Reading                    # Remove it, its child Collections and their Bookmarks
bookmark collections restore Reading               # Restore them from the Trash
bookmark collections share Reading                 # whether it's shared, and its public link
```

- Wherever a Collection is expected (including `list --collection` and `add --collection`), you can give its exact name or its id. Names aren't unique: when a name matches more than one Collection, the CLI exits 2 and lists each match with its id, so you can pick one.
- Collection names are up to 50 characters, and notes up to 20,000. Collections nest up to five levels deep.
- `collections rm` and `collections restore` move at most 1,000 Collections and Bookmarks at once. For a larger Collection, do it in parts: Remove or Restore its child Collections first, or move some of its Bookmarks out.
- `collections list --json` prints every Collection, with all pages joined: `{ "collections": [...], "nextCursor": null }`.

### Account

```sh
bookmark whoami          # name, email, plan, Token source (keychain, config file or BOOKMARK_TOKEN), API URL
bookmark whoami --json   # the API's data, unchanged
```

## Output

- On a terminal, lists are tables that fit its width. When stdout is piped, they are tab-separated values with no header, no truncation and no color, so `cut` and `awk` work: `bookmark list | cut -f1` prints the ids.
- Data goes to stdout. Messages, warnings and errors go to stderr.
- `--json` prints the API's `data` unchanged, so it matches the [API docs](https://docs.bookmark.land/docs).
- With `--json`, errors are printed to stderr as `{ "error": { "code", "message", "requestId" } }`.
- Errors include the API's request id. Quote it when you contact support.
- `NO_COLOR` turns colors off.

## Environment variables

| Variable              | Meaning                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOKMARK_TOKEN`      | The Token to use. Takes precedence over a stored login.                                                                                                                            |
| `BOOKMARK_API_URL`    | The API base URL (default `https://api.bookmark.land/v1`). `--api-url` overrides it. It must be an `https` URL (`http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`). |
| `BOOKMARK_NO_KEYRING` | Set to any value to never use the OS keychain: the Token is stored in the config file.                                                                                             |
| `XDG_CONFIG_HOME`     | Config folder base on Linux and macOS (default `~/.config`); the CLI uses `$XDG_CONFIG_HOME/bookmark-land`. On Windows it uses `%APPDATA%\bookmark-land`.                          |
| `NO_COLOR`            | Set to any value to turn colors off.                                                                                                                                               |

## Exit codes

Scripts and agents can rely on these. They never change.

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | Success                                                                        |
| 1    | Other error: network, server error, unexpected response                        |
| 2    | Usage: unknown command or flag, invalid argument                               |
| 3    | Auth: not logged in, invalid Token, no Pro plan, missing Scope                 |
| 4    | Not found                                                                      |
| 5    | Rate limited. The message says when to retry; the CLI never retries by itself. |

## Privacy

The CLI sends no telemetry and never checks for updates. It only contacts the API URL. Every request carries `User-Agent: bookmark-land-cli/<version> (node <version>; <os>)`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
