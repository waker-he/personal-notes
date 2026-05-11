# Personal Notes

A VS Code extension for attaching personal notes to code without modifying it.

Inspired by [Ghost Note](https://marketplace.visualstudio.com/items?itemName=leytonoday.ghost-note), built for situations where you need to take notes alongside code but can't (or don't want to) add comments to the source — whether that's reading an unfamiliar codebase, recording your understanding while learning, leaving reminders for your future self, or working in a repo where you don't own the code.

Notes are anchored to specific line ranges, never touch the source files, and persist in a single JSON file inside the workspace. Each note can carry tags and is rendered as Markdown, so you can write anything from a one-line reminder to a multi-paragraph explanation with code blocks and links. A consolidated per-file editor lets you read all your notes for a file in one place, with bidirectional highlighting that shows you where each note is anchored. A sidebar explorer gives you workspace-wide search, tag filtering, and quick navigation across every note you've taken.

This extension is designed for personal use — there's no sign-in, no cloud sync, no telemetry, and no network access. Your notes are plain JSON in your workspace, which means you can version-control them, sync them across machines via git, or .gitignore them to keep them private. It works in both local and Remote-SSH workspaces.

## Features

### Adding & Editing Notes

- **Add or edit a note** — press `Cmd+Alt+N` (Mac) / `Ctrl+Alt+N` (Windows/Linux) on any line:
  - If the cursor is on a line that already has a note, it opens that note for editing
  - If there is no note at the cursor, it creates a new one
- **Edit a note** — right-click on a noted line and choose **Notes: Edit Note**, or click the 📝 CodeLens label above the line
- **Delete a note** — right-click on a noted line and choose **Notes: Delete Note**
- **Delete all notes in the current file** — run **Notes: Delete All Notes in Current File** from the command palette

> **Note:** Line ranges of different notes within the same file cannot overlap.

### Editor Integration

- **CodeLens** — a `📝 Note: …` label appears above each noted line; click it to open the notes editor
- **Gutter icon** — a small icon appears in the editor gutter for every noted line
- **Line highlighting** — noted lines are subtly highlighted; the note you are actively editing is highlighted more strongly
- **Toggle gutter icons** — run **Notes: Toggle Gutter Icons** from the command palette (`Cmd+Shift+P`) to show or hide gutter icons

### Notes Editor

Clicking a CodeLens or editing a note opens a temporary Markdown file showing all notes for that file — one section per line range:

```
# 📝 Notes — `src/index.ts`

## Lines 12-15
_Last saved: 2024-01-15 10:30_, **tags:** todo

Remember to handle the edge case here.

## Lines 42
**tags:** bug

Off-by-one error when the list is empty.
```

- the cursor focus will jump to the relevant section when you opens the editor
- **Save** (`Cmd+S`) to apply your changes; **close** the tab to discard
- Edit the body, change tags (comma-separated on the `**tags:**` line), or reassign a note to different lines by editing the `## Lines X` heading
- Only one editor tab per file is allowed — reopening reuses the existing tab

### Orphaned Notes

If the lines a note was attached to are deleted, the note becomes *orphaned* rather than silently lost. Orphaned notes appear at the top of the notes editor with instructions to reassign or remove them.

### Sidebar Explorer

Click the notebook icon in the activity bar to open the **Personal Notes** panel.

**Filter panel** (top section):
- Type in the search box to filter notes by body text in real time
- Click tag chips to filter by tag — multiple tags can be active at once (notes must match all selected tags)
- The **Clear Filters** button (toolbar) resets both search and tag filters at once

**Notes tree** (bottom section):
- Files with notes are shown in a directory hierarchy matching your workspace, with compact single-child folders (like VS Code's file explorer)
- Notes under each file are sorted by line number; orphaned notes appear last
- Click a file to open its notes editor; click a note to jump directly to that note
- When the panel is open and your cursor is in a notes editor, the corresponding file automatically expands in the tree

### File Operations

- **File deleted** — all notes for that file are automatically removed
- **File renamed or moved** — all notes are automatically updated to point to the new path

## Keybindings

| Action | Mac | Windows / Linux |
|---|---|---|
| Add/Edit note | `Cmd+Alt+N` | `Ctrl+Alt+N` |

## Commands

All commands are available via the command palette (`Cmd+Shift+P`):

| Command | Description |
|---|---|
| Notes: Add Note | Add a note at the current cursor position |
| Notes: Edit Note | Edit the note at the current cursor position |
| Notes: Delete Note | Delete the note at the current cursor position |
| Notes: Delete All Notes in Current File | Remove all notes in the active file |
| Notes: Toggle Gutter Icons | Show or hide the gutter icons in the editor |

## Data Storage

Notes are saved to `.vscode/notes.json` in your workspace root. This file can be committed to version control to share notes with your team, or added to `.gitignore` to keep them local.
