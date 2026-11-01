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

### Removing, Restoring, moving and favorites

```sh
bookmark rm bk_1 bk_2              # Remove: move to the Trash, and print the ids
bookmark restore bk_1 bk_2         # Restore from the Trash
bookmark favorite bk_1 bk_2        # also: unfavorite
bookmark move bk_1 bk_2 --to Reading   # into a Collection (name or id)
bookmark move bk_1 --to unsorted   # back to Unsorted
bookmark rm --permanent bk_1       # Permanently delete (asks [y/N]; needs the destructive Scope)
bookmark trash list                # what's in the Trash, most recently Removed first (--limit, --cursor)
bookmark trash empty               # Permanently delete everything in the Trash (asks [y/N])
```

- `rm`, `restore`, `favorite`, `unfavorite` and `move` take several ids, or `-` to read them from stdin, one per line. Large lists are sent in batches of 50. `list` prints one page (up to 200 with `--limit 200`), so this removes at most 200; run it again for the rest:

  ```sh
  bookmark list --domain old.example.com --limit 200 --json | jq -r '.data[].id' | bookmark rm -
  ```

- When the API changes fewer Bookmarks than you asked for, the CLI says so, for example "2 of 3 removed (1 not found or unchanged)", and still exits 0. Already-Removed or already-favorite Bookmarks count as unchanged. With `--json`, these commands print `{ "requested": 3, "affected": 2 }`. The API doesn't say which ids it skipped, so `rm` prints every id it sent: all the ones it Removed are there, and skipped ones may be too.
- Remove and Restore never ask for confirmation. `rm --permanent` and `trash empty` can't be undone: they ask `[y/N]` in a terminal, and without a terminal they exit 2 unless you pass `--yes`.
- `trash list` shows the ids to pass to `restore` or `rm --permanent`. With `--json`, each Bookmark also has `trashedAt` and `deletesAt` (30 days after it was Removed).
- `trash empty` Permanently deletes up to 200 Bookmarks at once. When there were more, the rest are deleted in the background, and the CLI tells you to check again later with `trash list`.
- Bulk calls count each id against your rate limit (120 a minute on Pro), so a long list can hit it. The CLI then says how far it got, and exits 5.

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

### Tags

Tags are always named, never by id, and case-insensitively (`AI` and `ai` are the same Tag). Names are up to 25 characters and can use `/` for hierarchy, such as `dev/js`.

```sh
bookmark tags list                      # Tags and how many Bookmarks have each
bookmark tags add dev/js --color yellow
bookmark tags rename dev/js dev/javascript
bookmark tags rm old-tag                # delete the Tag; its Bookmarks are untouched (asks [y/N])
bookmark tags merge js javascript       # re-tag js Bookmarks as javascript, then delete js (asks [y/N])
bookmark tag bk_1 bk_2 reading          # add a Tag to Bookmarks (it's created if needed)
bookmark untag bk_1 bk_2 reading        # remove it
bookmark list --tag reading             # the Bookmarks with a Tag
```

- `tag` and `untag` take several ids, or `-` for stdin, like `rm`: `bookmark list --json | jq -r '.data[].id' | bookmark tag - reading`.
- `tags rm` and `tags merge` ask `[y/N]` in a terminal and need `--yes` otherwise.
- `list --tag` works like any other `list`: it pages with `--cursor` and combines with `--collection`, `--domain`, `--type` and `--favorite`. It sorts by `newest` or `oldest` only.

### Smart folders

A Smart folder is a saved set of rules. It holds no Bookmarks of its own; it matches them.

```sh
bookmark smart-folders list
bookmark smart-folders show "AI reading"                  # by exact name or id
bookmark smart-folders add "AI reading" --rule "tag contains ai" --rule "created-after equals 2026-01-01"
bookmark smart-folders add "Code" --match any --rule "domain equals github.com" --rule "domain equals gitlab.com"
bookmark smart-folders edit "AI reading" --name "AI" --rule "tag equals ai"   # also --icon, --color, --match
bookmark smart-folders bookmarks "AI reading"             # the Bookmarks it matches
bookmark smart-folders rm "AI reading"                    # delete the Smart folder; its Bookmarks are untouched
```

Rules are `"<field> <operator> <value>"`, from 1 to 10 per Smart folder, and `--match all` (the default) or `--match any`:

| Field                             | Operators            | Value                                                  |
| --------------------------------- | -------------------- | ------------------------------------------------------ |
| `tag`                             | `equals`, `contains` | a Tag name                                             |
| `domain`                          | `equals`, `contains` | a domain                                               |
| `type`                            | `equals`             | `link`, `article`, `image`, `video` or `document`      |
| `is-favorite`                     | `equals`             | `true` or `false`                                      |
| `created-after`, `created-before` | `equals`             | a date, such as `2026-01-01` or `2026-01-01T12:00:00Z` |
| `click-count`                     | `gte`, `lte`         | a whole number                                         |

Values can contain spaces (`--rule "tag contains machine learning"`) and are up to 500 characters. Invalid rules are rejected before anything is sent, with the valid options listed.

Agents can pass rules in the API's own JSON format instead, from a file or from stdin with `-`. Dates are then milliseconds since 1970, as strings:

```sh
echo '{"match":"all","conditions":[{"field":"tag","operator":"contains","value":"ai"}]}' \
  | bookmark smart-folders add "AI reading" --rules-json -
```

`smart-folders bookmarks` is limited to 2 calls a minute by the API (shared by all Smart folders), and fetches every page of a Smart folder, so a large one can hit the limit and exit 5.

### Insights

```sh
bookmark stats                  # total, favorites, Unsorted, counts by type, Bookmarks without Tags
bookmark domains                # Bookmarks per domain, most first
bookmark vulnerable             # Bookmarks whose sites have known security issues
bookmark vulnerable --collection Work --domain example.com --type link --limit 20
bookmark security bk_123        # a Bookmark's site security scan: risk, software and findings
bookmark usage                  # plan, Bookmarks against the limit, Trash, storage used
```

- `vulnerable` lists the same columns as `list`, newest first, up to 100 (`--limit` 1–100) with no pages.
- `stats`, `domains`, `search` and `vulnerable` are limited by the API to 30 calls a minute.

### Account

```sh
bookmark whoami          # name, email, plan, Token source (keychain, config file or BOOKMARK_TOKEN), API URL
bookmark whoami --json   # the API's data, unchanged
```

## Using with AI agents

- Authenticate with `BOOKMARK_TOKEN`; nothing is written to disk.
- Add `--json` to get the API's `data` on stdout, and errors as JSON on stderr. Decide what to do next from the exit code.
- The CLI never prompts when stdin isn't a terminal. Commands that can't be undone (`rm --permanent`, `trash empty`) exit 2 unless you pass `--yes`.
- Pipe ids between commands with `-`, for example `... | jq -r '.data[].id' | bookmark rm -`.

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
