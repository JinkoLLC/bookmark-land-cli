# bookmark.land CLI

The `bookmark` command-line client for the bookmark.land public API, used by people and their AI agents.

## Language

### Library

**Bookmark**:
A saved URL in a user's library, with its title, description, note, tags and collection.
_Avoid_: Link, item, entry

**Collection**:
A named folder that holds bookmarks and can be nested up to five levels. Names are not unique.
_Avoid_: Folder, list, category

**Unsorted**:
Where a bookmark lives when it belongs to no collection.
_Avoid_: Inbox, uncategorized, root

**Tag**:
A lowercase label attached to bookmarks; names are case-insensitive and may use `/` for hierarchy.
_Avoid_: Label, keyword

**Smart folder**:
A saved set of rules that matches bookmarks; it holds no bookmarks of its own.
_Avoid_: Saved search, filter, view

### Removal

**Trash**:
Where removed bookmarks and collections wait for 30 days before they are deleted for good.
_Avoid_: Bin, recycle bin, archive

**Remove**:
Move a bookmark or collection to the Trash. Reversible with Restore.
_Avoid_: Delete (for this meaning), trash (as a verb)

**Restore**:
Take a bookmark or collection back out of the Trash.
_Avoid_: Undelete, recover

**Permanently delete**:
Erase a bookmark for good. Not reversible, and requires the `destructive` scope.
_Avoid_: Delete (unqualified), purge, destroy

### Access

**Token**:
The secret (`bkl_…`) the CLI sends to the API on the user's behalf.
_Avoid_: API key, password, credential

**Scope**:
A permission granted to a Token, such as `bookmarks:write` or `destructive`.
_Avoid_: Permission, role

**Device login**:
Signing the CLI in by approving a User code in the browser.
_Avoid_: OAuth, web login, browser auth

**User code**:
The short code (`WDJB-MJHT`) the user types or confirms in the browser during Device login.
_Avoid_: One-time code, PIN, device code (that is the CLI's secret, never shown)

**Client name**:
The name a Token is listed under in the user's settings, by default the computer's hostname.
_Avoid_: Device name, token name
