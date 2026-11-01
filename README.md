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

Create a Token in your bookmark.land Settings and pass it in `BOOKMARK_TOKEN`:

```sh
export BOOKMARK_TOKEN=bkl_...
bookmark whoami
```

Run `bookmark --help` to list every command, and `bookmark <command> --help` for a command's flags.

## Commands

### Account

```sh
bookmark whoami          # name, email, plan, where the Token came from, and the API URL
bookmark whoami --json   # the API's data, unchanged
```

## Output

- Data goes to stdout. Messages, warnings and errors go to stderr.
- `--json` prints the API's `data` unchanged, so it matches the [API docs](https://docs.bookmark.land/docs).
- With `--json`, errors are printed to stderr as `{ "error": { "code", "message", "requestId" } }`.
- Errors include the API's request id. Quote it when you contact support.
- `NO_COLOR` turns colors off.

## Environment variables

| Variable           | Meaning                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `BOOKMARK_TOKEN`   | The Token to use.                                                                                                         |
| `BOOKMARK_API_URL` | The API base URL (default `https://api.bookmark.land/v1`). `--api-url` overrides it. It must be an `http` or `https` URL. |
| `NO_COLOR`         | Set to any value to turn colors off.                                                                                      |

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
