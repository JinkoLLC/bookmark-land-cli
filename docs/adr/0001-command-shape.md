# Bookmark commands at the top level, everything else grouped by noun

Bookmarks are what people use the CLI for almost every time, so their commands sit at the top level (`bookmark add`, `bookmark list`, `bookmark rm`) and read like a sentence after the program's name. Everything else is grouped under a plural noun followed by a verb (`bookmark collections list`, `bookmark tags merge`, `bookmark smart-folders add`), so the same verbs mean the same thing in every group and new groups never collide with Bookmark commands. A few account-wide commands with no natural group also sit at the top level (`login`, `whoami`, `stats`, `import`, `export`).

## Considered options

- **Everything grouped by noun** (`bookmark bookmarks add`): consistent, but the most common commands get a redundant word.
- **Everything at the top level** (`bookmark add-collection`): short, but the command list grows without structure and verbs stop lining up across nouns.

## Consequences

Command names are a public contract (scripts and agents call them), so a new top-level command must not be a word that could later be wanted as a group name, and a new group must use a plural noun.
