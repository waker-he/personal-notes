"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const noteEditor_1 = require("./noteEditor");
// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
class NoteStore {
    notes = [];
    storePath;
    constructor(workspaceRoot) {
        this.storePath = path.join(workspaceRoot, '.vscode', 'notes.json');
        this.load();
    }
    load() {
        try {
            const raw = fs.readFileSync(this.storePath, 'utf8');
            this.notes = JSON.parse(raw);
        }
        catch {
            this.notes = [];
        }
    }
    save() {
        const dir = path.dirname(this.storePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.storePath, JSON.stringify(this.notes, null, 2), 'utf8');
    }
    getForFile(relPath) {
        return this.notes.filter(n => n.filePath === relPath);
    }
    add(note) {
        const n = { id: (0, crypto_1.randomUUID)(), ...note, updatedAt: new Date().toISOString() };
        this.notes.push(n);
        this.save();
        return n;
    }
    update(id, body, tags) {
        const note = this.notes.find(n => n.id === id);
        if (note) {
            note.body = body;
            note.tags = tags;
            note.updatedAt = new Date().toISOString();
            this.save();
        }
    }
    delete(id) {
        this.notes = this.notes.filter(n => n.id !== id);
        this.save();
    }
    getById(id) {
        return this.notes.find(n => n.id === id);
    }
    deleteForFile(relPath) {
        const before = this.notes.length;
        this.notes = this.notes.filter(n => n.filePath !== relPath);
        if (this.notes.length !== before) {
            this.save();
        }
        return before - this.notes.length;
    }
    renameFile(oldRelPath, newRelPath) {
        let count = 0;
        for (const note of this.notes) {
            if (note.filePath === oldRelPath) {
                note.filePath = newRelPath;
                count++;
            }
        }
        if (count > 0) {
            this.save();
        }
        return count;
    }
    shiftLinesForFile(relPath, changeStart, changeEnd, delta) {
        let changed = false;
        for (const note of this.notes) {
            if (note.filePath !== relPath) {
                continue;
            }
            if ((note.tags ?? []).includes('orphaned')) {
                continue;
            }
            // If the anchor line (startLine) was deleted, orphan immediately regardless of remaining range
            if (delta < 0 && note.startLine >= changeStart && note.startLine < changeEnd) {
                if (!(note.tags ?? []).includes('orphaned')) {
                    note.tags = [...(note.tags ?? []), 'orphaned'];
                    changed = true;
                }
            }
            else if (note.startLine >= changeEnd) {
                // Change is entirely above the note — shift both ends
                note.startLine += delta;
                note.endLine += delta;
                changed = true;
            }
            else if (changeStart >= note.startLine && changeEnd <= note.endLine && (delta < 0 || changeStart < note.endLine)) {
                // Change is entirely inside the note (anchor intact) — expand/shrink the range.
                // For insertions, only expand when strictly before the last line so that pressing
                // Enter at the end of the note's last line does not pull the new line into the range.
                note.endLine += delta;
                changed = true;
                if (note.endLine < note.startLine) {
                    if (!(note.tags ?? []).includes('orphaned')) {
                        note.tags = [...(note.tags ?? []), 'orphaned'];
                    }
                }
            }
            else if (changeStart >= note.startLine && changeStart <= note.endLine && changeEnd > note.endLine) {
                // Change starts inside the note and extends beyond its end
                // (handles "delete last line": changeEnd = note.endLine + 1)
                note.endLine = changeStart - 1;
                changed = true;
                if (note.endLine < note.startLine) {
                    if (!(note.tags ?? []).includes('orphaned')) {
                        note.tags = [...(note.tags ?? []), 'orphaned'];
                    }
                }
            }
        }
        if (changed) {
            this.save();
        }
        return changed;
    }
    shiftLines(id, delta) {
        const note = this.notes.find(n => n.id === id);
        if (note && delta !== 0) {
            note.startLine += delta;
            note.endLine += delta;
            this.save();
        }
    }
    assignLines(id, startLine, endLine, anchorText) {
        const note = this.notes.find(n => n.id === id);
        if (note) {
            note.startLine = startLine;
            note.endLine = endLine;
            note.anchorText = anchorText;
            note.tags = (note.tags ?? []).filter(t => t !== 'orphaned');
            this.save();
        }
    }
    markOrphaned(id) {
        const note = this.notes.find(n => n.id === id);
        if (note && !(note.tags ?? []).includes('orphaned')) {
            note.tags = [...(note.tags ?? []), 'orphaned'];
            this.save();
        }
    }
    getAllFiles() {
        return [...new Set(this.notes.map(n => n.filePath))].sort();
    }
    getAllTags() {
        const tags = new Set();
        for (const note of this.notes) {
            for (const t of note.tags ?? []) {
                tags.add(t);
            }
        }
        return [...tags].sort();
    }
}
function isOrphaned(note) {
    return (note.tags ?? []).includes('orphaned');
}
// ---------------------------------------------------------------------------
// CodeLens
// ---------------------------------------------------------------------------
class NoteCodeLensProvider {
    getNotesForDoc;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeCodeLenses = this._onDidChange.event;
    constructor(getNotesForDoc) {
        this.getNotesForDoc = getNotesForDoc;
    }
    provideCodeLenses(document) {
        return this.getNotesForDoc(document.uri)
            .filter(note => !isOrphaned(note))
            .map(note => {
            const line = Math.min(note.startLine, document.lineCount - 1);
            const range = document.lineAt(line).range;
            const firstLine = note.body.split('\n')[0].trim();
            const title = `📝 Note: ${firstLine.length > 50 ? firstLine.slice(0, 47) + '…' : firstLine}`;
            return new vscode.CodeLens(range, {
                title,
                command: 'personalNotes._editNoteById',
                arguments: [note.id],
            });
        });
    }
    refresh() { this._onDidChange.fire(); }
}
// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------
function activate(context) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return; // no workspace, nothing to do
    }
    const store = new NoteStore(workspaceRoot);
    const codeLensProvider = new NoteCodeLensProvider(uri => store.getForFile(toRelPath(uri)));
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, codeLensProvider));
    const gutterType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: context.asAbsolutePath('images/note.svg'),
        gutterIconSize: 'contain',
    });
    const notedType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    });
    const activeType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
    });
    context.subscriptions.push(gutterType, notedType, activeType);
    // ── Sidebar tree item types ───────────────────────────────────────────────
    class DirTreeItem extends vscode.TreeItem {
        dirRelPath;
        constructor(dirRelPath, dirName) {
            super(dirName, vscode.TreeItemCollapsibleState.Expanded);
            this.dirRelPath = dirRelPath;
            this.id = `dir:${dirRelPath}`;
            this.tooltip = dirRelPath;
            this.contextValue = 'noteDir';
            this.resourceUri = vscode.Uri.file(path.join(workspaceRoot, dirRelPath));
            this.iconPath = vscode.ThemeIcon.Folder;
        }
    }
    class FileTreeItem extends vscode.TreeItem {
        relPath;
        noteCount;
        constructor(relPath, displayName, noteCount) {
            super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
            this.relPath = relPath;
            this.noteCount = noteCount;
            this.id = `file:${relPath}`;
            this.description = `${noteCount} note${noteCount === 1 ? '' : 's'}`;
            this.tooltip = relPath;
            this.contextValue = 'noteFile';
            this.resourceUri = vscode.Uri.file(path.join(workspaceRoot, relPath));
        }
    }
    class NoteTreeItem extends vscode.TreeItem {
        note;
        fileRelPath;
        constructor(note, fileRelPath) {
            const range = isOrphaned(note)
                ? 'Orphaned'
                : note.startLine === note.endLine
                    ? `L${note.startLine + 1}`
                    : `L${note.startLine + 1}–${note.endLine + 1}`;
            const snippet = note.body.replace(/\s+/g, ' ').trim();
            const label = snippet.length > 60 ? snippet.slice(0, 57) + '…' : snippet || '(empty)';
            super(label, vscode.TreeItemCollapsibleState.None);
            this.note = note;
            this.fileRelPath = fileRelPath;
            this.id = `note:${note.id}`;
            this.description = range;
            this.tooltip = note.body;
            this.iconPath = new vscode.ThemeIcon(isOrphaned(note) ? 'warning' : 'note');
            this.contextValue = isOrphaned(note) ? 'orphanedNote' : 'note';
            this.command = isOrphaned(note)
                ? { command: 'personalNotes.openNotesForFile', title: 'Open Notes', arguments: [fileRelPath] }
                : { command: 'personalNotes._editNoteById', title: 'Open Note', arguments: [note.id, false] };
        }
    }
    class NotesTreeProvider {
        tagFilter = [];
        searchText = '';
        _onDidChangeTreeData = new vscode.EventEmitter();
        onDidChangeTreeData = this._onDidChangeTreeData.event;
        refresh() { this._onDidChangeTreeData.fire(undefined); }
        refreshItem(item) { this._onDidChangeTreeData.fire(item); }
        getTreeItem(element) { return element; }
        getChildren(element) {
            if (element instanceof FileTreeItem) {
                return store.getForFile(element.relPath)
                    .filter(n => this.matches(n))
                    .sort((a, b) => {
                    if (isOrphaned(a) !== isOrphaned(b)) {
                        return isOrphaned(a) ? 1 : -1;
                    }
                    return a.startLine - b.startLine;
                })
                    .map(n => new NoteTreeItem(n, element.relPath));
            }
            const dirRelPath = element instanceof DirTreeItem ? element.dirRelPath : element ? null : '';
            if (dirRelPath === null) {
                return [];
            }
            const matchingFiles = this.getMatchingFiles();
            return this.rawChildrenOf(dirRelPath, matchingFiles).map(item => item instanceof DirTreeItem ? this.collapseDir(item, matchingFiles) : item);
        }
        getMatchingFiles() {
            const result = new Map();
            for (const relPath of store.getAllFiles()) {
                const count = store.getForFile(relPath).filter(n => this.matches(n)).length;
                if (count > 0) {
                    result.set(relPath, count);
                }
            }
            return result;
        }
        rawChildrenOf(dirRelPath, matchingFiles) {
            const dirParts = dirRelPath ? dirRelPath.split(path.sep) : [];
            const seen = new Map();
            for (const [filePath, count] of matchingFiles) {
                const parts = filePath.split(path.sep);
                if (dirParts.length > 0 && !dirParts.every((p, i) => parts[i] === p)) {
                    continue;
                }
                const rest = parts.slice(dirParts.length);
                if (rest.length === 0) {
                    continue;
                }
                const childName = rest[0];
                const childPath = [...dirParts, childName].join(path.sep);
                if (rest.length === 1) {
                    seen.set(childPath, { type: 'file', name: childName, childPath, count });
                }
                else if (!seen.has(childPath)) {
                    seen.set(childPath, { type: 'dir', name: childName, childPath });
                }
            }
            return [...seen.values()]
                .sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === 'dir' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            })
                .map(({ type, name, childPath, count }) => type === 'dir'
                ? new DirTreeItem(childPath, name)
                : new FileTreeItem(childPath, name, count));
        }
        getParent(element) {
            const matchingFiles = this.getMatchingFiles();
            if (element instanceof NoteTreeItem) {
                const count = matchingFiles.get(element.fileRelPath) ?? 0;
                return count > 0 ? new FileTreeItem(element.fileRelPath, path.basename(element.fileRelPath), count) : undefined;
            }
            if (element instanceof FileTreeItem) {
                return this.searchForParent(element.relPath, '', undefined, matchingFiles);
            }
            if (element instanceof DirTreeItem) {
                return this.searchForParent(element.dirRelPath, '', undefined, matchingFiles);
            }
            return undefined;
        }
        // Walk the displayed tree from currentDirRelPath looking for the parent of targetRelPath.
        searchForParent(targetRelPath, currentDirRelPath, currentDirItem, matchingFiles) {
            const children = this.rawChildrenOf(currentDirRelPath, matchingFiles).map(item => item instanceof DirTreeItem ? this.collapseDir(item, matchingFiles) : item);
            for (const child of children) {
                if (child instanceof FileTreeItem && child.relPath === targetRelPath) {
                    return currentDirItem;
                }
                if (child instanceof DirTreeItem) {
                    if (child.dirRelPath === targetRelPath) {
                        return currentDirItem;
                    }
                    if (targetRelPath.startsWith(child.dirRelPath + path.sep)) {
                        return this.searchForParent(targetRelPath, child.dirRelPath, child, matchingFiles);
                    }
                }
            }
            return undefined;
        }
        // Collapse a chain of single-subdirectory nodes into one item (compact folders).
        collapseDir(dirItem, matchingFiles) {
            const rawChildren = this.rawChildrenOf(dirItem.dirRelPath, matchingFiles);
            if (rawChildren.length === 1 && rawChildren[0] instanceof DirTreeItem) {
                const child = rawChildren[0];
                const merged = new DirTreeItem(child.dirRelPath, `${dirItem.label}/${child.label}`);
                return this.collapseDir(merged, matchingFiles);
            }
            return dirItem;
        }
        matches(note) {
            if (this.tagFilter.length > 0) {
                const tags = note.tags ?? [];
                if (!this.tagFilter.every(t => tags.includes(t))) {
                    return false;
                }
            }
            if (this.searchText && !note.body.toLowerCase().includes(this.searchText.toLowerCase())) {
                return false;
            }
            return true;
        }
    }
    const activeSessions = new Map(); // relPath → tmpUri
    let notesTreeProvider;
    let notesTree;
    let searchBarProvider;
    let gutterIconsEnabled = true;
    // ── Helpers ──────────────────────────────────────────────────────────────
    function formatTimestamp(iso) {
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function toRelPath(uri) {
        return path.relative(workspaceRoot, uri.fsPath);
    }
    function notesAtLine(relPath, line) {
        return store.getForFile(relPath).filter(n => !isOrphaned(n) && line >= n.startLine && line <= n.endLine);
    }
    function refreshDecorations(editor) {
        const notes = store.getForFile(toRelPath(editor.document.uri)).filter(n => !isOrphaned(n));
        const lineMap = new Map();
        const notedLines = new Set();
        for (const note of notes) {
            const tagLine = note.tags?.length ? `\n\n*Tags: ${note.tags.join(', ')}*` : '';
            const timestampLine = note.updatedAt ? `\n\n*Last saved: ${formatTimestamp(note.updatedAt)}*` : '';
            const msg = `**Note:** ${note.body}${tagLine}${timestampLine}`;
            for (let l = note.startLine; l <= note.endLine; l++) {
                if (l >= editor.document.lineCount) {
                    continue;
                }
                notedLines.add(l);
                const existing = lineMap.get(l);
                if (existing) {
                    existing.appendMarkdown(`\n\n---\n\n${msg}`);
                }
                else {
                    const md = new vscode.MarkdownString(msg);
                    md.isTrusted = true;
                    lineMap.set(l, md);
                }
            }
        }
        const gutterDecorations = [];
        for (const [line, hoverMessage] of lineMap) {
            gutterDecorations.push({ range: editor.document.lineAt(line).range, hoverMessage });
        }
        editor.setDecorations(gutterType, gutterIconsEnabled ? gutterDecorations : []);
        editor.setDecorations(notedType, [...notedLines].map(l => ({ range: editor.document.lineAt(l).range })));
    }
    function refreshAll() {
        for (const editor of vscode.window.visibleTextEditors) {
            refreshDecorations(editor);
        }
        codeLensProvider.refresh();
        notesTreeProvider?.refresh();
        searchBarProvider?.updateTags(store.getAllTags(), notesTreeProvider?.tagFilter ?? []);
    }
    function toSectionResult(n) {
        return {
            startLine: isOrphaned(n) ? -1 : n.startLine,
            endLine: isOrphaned(n) ? -1 : n.endLine,
            body: n.body,
            tags: n.tags ?? [],
            updatedAt: n.updatedAt,
            orphanedId: isOrphaned(n) ? n.id : undefined,
        };
    }
    async function syncNotes(relPath, originalNotes, sections) {
        // Snapshot identity before any store.assignLines / store.delete mutations
        const originalOrphanedIds = new Set(originalNotes.filter(n => isOrphaned(n)).map(n => n.id));
        const originalRangeById = new Map(originalNotes.filter(n => !isOrphaned(n)).map(n => [n.id, `${n.startLine}:${n.endLine}`]));
        const byRange = new Map(originalNotes.filter(n => !isOrphaned(n)).map(n => [`${n.startLine}:${n.endLine}`, n]));
        const byId = new Map(originalNotes.map(n => [n.id, n]));
        const seenRanges = new Set();
        const seenOrphanIds = new Set();
        for (const s of sections) {
            if (s.orphanedId !== undefined) {
                seenOrphanIds.add(s.orphanedId);
                const note = byId.get(s.orphanedId);
                if (!note) {
                    continue;
                }
                if (s.startLine >= 0) {
                    // User changed ???-??? heading to Lines X-Y → reassign
                    if (!s.body.trim()) {
                        store.delete(note.id);
                    }
                    else {
                        let anchorText = '';
                        try {
                            const sourceDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceRoot, relPath)));
                            if (s.startLine < sourceDoc.lineCount) {
                                anchorText = sourceDoc.lineAt(s.startLine).text.trim();
                            }
                        }
                        catch { /* ignore */ }
                        store.assignLines(note.id, s.startLine, s.endLine, anchorText);
                        const existingUserTags = (note.tags ?? []).filter(t => t !== 'orphaned');
                        if (note.body !== s.body || JSON.stringify(existingUserTags) !== JSON.stringify(s.tags)) {
                            store.update(note.id, s.body, s.tags);
                        }
                    }
                }
                else {
                    // Still orphaned
                    if (!s.body.trim()) {
                        store.delete(note.id);
                    }
                    else {
                        const userTags = s.tags.filter(t => t !== 'orphaned');
                        const existingUserTags = (note.tags ?? []).filter(t => t !== 'orphaned');
                        if (note.body !== s.body || JSON.stringify(existingUserTags) !== JSON.stringify(userTags)) {
                            store.update(note.id, s.body, [...userTags, 'orphaned']);
                        }
                    }
                }
            }
            else {
                const key = `${s.startLine}:${s.endLine}`;
                seenRanges.add(key);
                const existing = byRange.get(key);
                if (existing) {
                    if (!s.body.trim()) {
                        store.delete(existing.id);
                    }
                    else {
                        const bodyChanged = existing.body !== s.body;
                        const tagsChanged = JSON.stringify(existing.tags ?? []) !== JSON.stringify(s.tags);
                        if (bodyChanged || tagsChanged) {
                            store.update(existing.id, s.body, s.tags);
                        }
                    }
                }
                else if (s.body.trim()) {
                    let anchorText = '';
                    try {
                        const sourceDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceRoot, relPath)));
                        if (s.startLine < sourceDoc.lineCount) {
                            anchorText = sourceDoc.lineAt(s.startLine).text.trim();
                        }
                    }
                    catch { /* ignore */ }
                    store.add({ filePath: relPath, startLine: s.startLine, endLine: s.endLine, anchorText, body: s.body, tags: s.tags });
                }
            }
        }
        for (const note of originalNotes) {
            if (originalOrphanedIds.has(note.id)) {
                if (!seenOrphanIds.has(note.id)) {
                    store.delete(note.id);
                }
            }
            else {
                const originalKey = originalRangeById.get(note.id);
                if (!seenRanges.has(originalKey)) {
                    store.delete(note.id);
                }
            }
        }
        refreshAll();
    }
    async function verifyAnchors(relPath, doc) {
        if (activeSessions.has(relPath)) {
            return;
        }
        const notes = store.getForFile(relPath).filter(n => !isOrphaned(n));
        if (!notes.length) {
            return;
        }
        let changed = false;
        for (const note of notes) {
            if (note.startLine >= doc.lineCount) {
                store.markOrphaned(note.id);
                changed = true;
                continue;
            }
            const lineText = doc.lineAt(note.startLine).text.trim();
            if (lineText === note.anchorText) {
                continue;
            }
            // Localized search ±50 lines for the anchor text
            const searchStart = Math.max(0, note.startLine - 50);
            const searchEnd = Math.min(doc.lineCount - 1, note.startLine + 50);
            let found = false;
            for (let l = searchStart; l <= searchEnd; l++) {
                if (doc.lineAt(l).text.trim() === note.anchorText) {
                    store.shiftLines(note.id, l - note.startLine);
                    found = true;
                    changed = true;
                    break;
                }
            }
            if (!found) {
                store.markOrphaned(note.id);
                changed = true;
            }
        }
        if (changed) {
            refreshAll();
        }
    }
    async function reuseEditorSession(relPath, focusStartLine, focusEndLine, newSection) {
        const tmpUri = activeSessions.get(relPath);
        if (!tmpUri) {
            return false;
        }
        const tmpFileName = path.basename(tmpUri.fsPath);
        let tabViewColumn;
        for (const group of vscode.window.tabGroups.all) {
            if (group.tabs.some(t => t.label === tmpFileName)) {
                tabViewColumn = group.viewColumn;
                break;
            }
        }
        if (tabViewColumn === undefined) {
            return false;
        }
        const doc = await vscode.workspace.openTextDocument(tmpUri);
        if (newSection !== undefined) {
            const heading = newSection.startLine === newSection.endLine
                ? `## Lines ${newSection.startLine + 1}`
                : `## Lines ${newSection.startLine + 1}-${newSection.endLine + 1}`;
            const sectionText = `${heading}\n**tags:** \n\n`;
            const lines = doc.getText().split('\n');
            let insertLine = -1;
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^## Lines (\d+)(?:-(\d+))?\s*$/);
                if (m && parseInt(m[1]) - 1 > newSection.startLine) {
                    insertLine = i;
                    break;
                }
            }
            const edit = new vscode.WorkspaceEdit();
            if (insertLine === -1) {
                edit.insert(doc.uri, doc.lineAt(doc.lineCount - 1).range.end, `\n\n${sectionText}`);
            }
            else {
                edit.insert(doc.uri, new vscode.Position(insertLine, 0), `${sectionText}\n\n`);
            }
            await vscode.workspace.applyEdit(edit);
        }
        const cursorLine = (0, noteEditor_1.findSectionCursorLine)(doc.getText(), focusStartLine);
        await vscode.window.showTextDocument(doc, {
            viewColumn: tabViewColumn,
            preview: false,
            selection: new vscode.Range(cursorLine, 0, cursorLine, 0),
        });
        applyActiveDecoration({ startLine: focusStartLine, endLine: focusEndLine }, relPath);
        return true;
    }
    async function pickNote(notes) {
        const items = notes.map(n => ({
            label: n.body.length > 80 ? n.body.slice(0, 77) + '…' : n.body,
            description: `line ${n.startLine + 1}`,
            note: n,
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select note' });
        return picked?.note;
    }
    function revealFileInTree(relPath) {
        if (!notesTree || !notesTreeProvider || !notesTree.visible) {
            return;
        }
        const fileItem = new FileTreeItem(relPath, path.basename(relPath), 0);
        notesTree.reveal(fileItem, { select: true, focus: false, expand: true }).then(undefined, () => { });
    }
    function collapseFileInTree(relPath) {
        if (!notesTree || !notesTreeProvider || !notesTree.visible) {
            return;
        }
        const count = store.getForFile(relPath).filter(n => notesTreeProvider.matches(n)).length;
        const fileItem = new FileTreeItem(relPath, path.basename(relPath), count);
        notesTreeProvider.refreshItem(fileItem);
    }
    function updateTreeViewDescription() {
        if (!notesTree || !notesTreeProvider) {
            return;
        }
        const parts = [];
        if (notesTreeProvider.tagFilter.length > 0) {
            parts.push(`tags: ${notesTreeProvider.tagFilter.join(', ')}`);
        }
        if (notesTreeProvider.searchText) {
            parts.push(`"${notesTreeProvider.searchText}"`);
        }
        notesTree.description = parts.length > 0 ? parts.join(' | ') : undefined;
        vscode.commands.executeCommand('setContext', 'personalNotes.hasActiveFilters', parts.length > 0);
    }
    // ── Inline filter panel (search + tags webview view) ─────────────────────
    class SearchBarViewProvider {
        _view;
        resolveWebviewView(webviewView) {
            this._view = webviewView;
            webviewView.webview.options = { enableScripts: true };
            webviewView.webview.html = this._getHtml();
            webviewView.webview.onDidReceiveMessage(msg => {
                if (!notesTreeProvider) {
                    return;
                }
                if (msg.type === 'search') {
                    notesTreeProvider.searchText = msg.text;
                    notesTreeProvider.refresh();
                    updateTreeViewDescription();
                }
                else if (msg.type === 'tagToggle') {
                    const tag = msg.tag;
                    const active = msg.selected;
                    if (active) {
                        if (!notesTreeProvider.tagFilter.includes(tag)) {
                            notesTreeProvider.tagFilter = [...notesTreeProvider.tagFilter, tag];
                        }
                    }
                    else {
                        notesTreeProvider.tagFilter = notesTreeProvider.tagFilter.filter(t => t !== tag);
                    }
                    notesTreeProvider.refresh();
                    updateTreeViewDescription();
                }
            });
            // Send initial tags once the webview is ready.
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this.updateTags(store.getAllTags(), notesTreeProvider?.tagFilter ?? []);
                }
            });
            this.updateTags(store.getAllTags(), notesTreeProvider?.tagFilter ?? []);
        }
        clearSearch() {
            this._view?.webview.postMessage({ type: 'clear' });
        }
        updateTags(tags, selected) {
            this._view?.webview.postMessage({ type: 'updateTags', tags, selected });
        }
        _getHtml() {
            const nonce = (0, crypto_1.randomUUID)().replace(/-/g, '');
            return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { margin: 0; padding: 4px 8px 8px; background: transparent; }
  .row { display: flex; align-items: center; gap: 4px; }
  input {
    flex: 1;
    min-width: 0;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 3px 6px;
    font-size: var(--vscode-font-size);
    font-family: var(--vscode-font-family);
    outline: none;
    border-radius: 2px;
    box-sizing: border-box;
  }
  input:focus { border-color: var(--vscode-focusBorder); }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  #clear-btn {
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 14px;
    line-height: 1;
    border-radius: 3px;
    opacity: 0.7;
    flex-shrink: 0;
    display: none;
  }
  #clear-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  #clear-btn.visible { display: block; }
  #tags-section { margin-top: 6px; display: none; }
  #tags-section.visible { display: block; }
  .tags-label {
    font-size: 10px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 5px;
  }
  .tags-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    font-family: var(--vscode-font-family);
    font-size: 11px;
    cursor: pointer;
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid var(--vscode-badge-background);
    background: transparent;
    color: var(--vscode-foreground);
    opacity: 0.6;
    transition: opacity 0.1s;
  }
  .chip:hover { opacity: 0.9; }
  .chip.active {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    opacity: 1;
  }
</style>
</head>
<body>
<div class="row">
  <input type="text" id="search" placeholder="Search notes…" autocomplete="off" spellcheck="false" />
  <button id="clear-btn" title="Clear search">✕</button>
</div>
<div id="tags-section">
  <div class="tags-label">Filter by tag</div>
  <div class="tags-list" id="tags-list"></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const input = document.getElementById('search');
  const clearBtn = document.getElementById('clear-btn');
  const tagsSection = document.getElementById('tags-section');
  const tagsList = document.getElementById('tags-list');

  input.addEventListener('input', () => {
    clearBtn.classList.toggle('visible', input.value.length > 0);
    vscode.postMessage({ type: 'search', text: input.value });
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    vscode.postMessage({ type: 'search', text: '' });
    input.focus();
  });

  function renderTags(tags, selected) {
    if (!tags.length) {
      tagsSection.classList.remove('visible');
      return;
    }
    tagsSection.classList.add('visible');
    tagsList.innerHTML = '';
    for (const tag of tags) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (selected.includes(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.addEventListener('click', () => {
        const isActive = chip.classList.toggle('active');
        vscode.postMessage({ type: 'tagToggle', tag, selected: isActive });
      });
      tagsList.appendChild(chip);
    }
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'clear') {
      input.value = '';
      clearBtn.classList.remove('visible');
    } else if (msg.type === 'updateTags') {
      renderTags(msg.tags, msg.selected);
    }
  });
</script>
</body>
</html>`;
        }
    }
    searchBarProvider = new SearchBarViewProvider();
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('personalNotes.searchBar', searchBarProvider));
    // ── Bidirectional highlighting ────────────────────────────────────────────
    // Returns the note range (0-based) that the cursor is inside in the notes doc.
    // Returns undefined for orphaned sections (???-???) — no source highlighting.
    function findSectionAtDocLine(content, cursorLine) {
        const lines = content.split('\n');
        let result;
        for (let i = 0; i <= cursorLine && i < lines.length; i++) {
            const m = lines[i].match(/^## Lines (\d+)(?:-(\d+))?\s*$/);
            if (m) {
                const sl = parseInt(m[1]) - 1;
                result = { startLine: sl, endLine: m[2] !== undefined ? parseInt(m[2]) - 1 : sl };
            }
            else if (/^## Lines \?\?\?-\?\?\?\s*$/.test(lines[i])) {
                result = undefined;
            }
        }
        return result;
    }
    // Returns the vscode.Range of the section block for a note in the notes doc.
    function findSectionDocRange(doc, noteStartLine, noteEndLine) {
        for (let i = 0; i < doc.lineCount; i++) {
            const m = doc.lineAt(i).text.match(/^## Lines (\d+)(?:-(\d+))?\s*$/);
            if (m) {
                const sl = parseInt(m[1]) - 1;
                const el = m[2] !== undefined ? parseInt(m[2]) - 1 : sl;
                if (sl !== noteStartLine || el !== noteEndLine) {
                    continue;
                }
            }
            else {
                continue;
            }
            {
                let end = doc.lineCount - 1;
                for (let j = i + 1; j < doc.lineCount; j++) {
                    if (/^## Lines \d+(?:-\d+)?\s*$/.test(doc.lineAt(j).text)) {
                        end = j - 1;
                        break;
                    }
                }
                while (end > i && doc.lineAt(end).text.trim() === '') {
                    end--;
                }
                return new vscode.Range(i, 0, end, doc.lineAt(end).text.length);
            }
        }
        return undefined;
    }
    function applyActiveDecoration(noteRange, relPath) {
        for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        }
        if (!noteRange || noteRange.startLine < 0) {
            return;
        }
        for (const ed of vscode.window.visibleTextEditors) {
            if (toRelPath(ed.document.uri) === relPath) {
                const opts = [];
                for (let l = noteRange.startLine; l <= noteRange.endLine; l++) {
                    if (l < ed.document.lineCount) {
                        opts.push({ range: ed.document.lineAt(l).range });
                    }
                }
                ed.setDecorations(activeType, opts);
                break;
            }
        }
        const sessionTmpUri = activeSessions.get(relPath);
        if (sessionTmpUri) {
            const notesEd = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === sessionTmpUri.fsPath);
            if (notesEd) {
                const r = findSectionDocRange(notesEd.document, noteRange.startLine, noteRange.endLine);
                notesEd.setDecorations(activeType, r ? [r] : []);
            }
        }
    }
    // ── Context key: drives edit/delete visibility in the context menu ────────
    function updateCursorContext(editor) {
        const hasNote = !!editor &&
            notesAtLine(toRelPath(editor.document.uri), editor.selection.active.line).length > 0;
        vscode.commands.executeCommand('setContext', 'personalNotes.hasNoteAtCursor', hasNote);
    }
    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.addNote', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const sel = editor.selection;
        const startLine = sel.start.line;
        const endLine = sel.end.line;
        const relPath = toRelPath(editor.document.uri);
        const allNotes = store.getForFile(relPath);
        const restoreTarget = { uri: editor.document.uri, viewColumn: editor.viewColumn };
        const sourceBasename = path.basename(relPath);
        const existing = notesAtLine(relPath, startLine);
        if (activeSessions.has(relPath)) {
            if (existing.length > 0) {
                const note = existing.length === 1 ? existing[0] : await pickNote(existing);
                if (!note) {
                    return;
                }
                if (await reuseEditorSession(relPath, note.startLine, note.endLine)) {
                    return;
                }
            }
            else {
                if (await reuseEditorSession(relPath, startLine, endLine, { startLine, endLine })) {
                    return;
                }
            }
        }
        let focusStartLine;
        let sectionsForEditor;
        if (existing.length > 0) {
            const note = existing.length === 1 ? existing[0] : await pickNote(existing);
            if (!note) {
                return;
            }
            focusStartLine = note.startLine;
            sectionsForEditor = allNotes.map(toSectionResult);
        }
        else {
            focusStartLine = startLine;
            sectionsForEditor = [
                ...allNotes.map(toSectionResult),
                { startLine, endLine, body: '', tags: [] },
            ];
        }
        const sections = await (0, noteEditor_1.openConsolidatedEditor)(sectionsForEditor, focusStartLine, relPath, restoreTarget, tmpUri => {
            activeSessions.set(relPath, tmpUri);
            revealFileInTree(relPath);
            const focused = sectionsForEditor.find(s => s.startLine === focusStartLine);
            if (focused) {
                applyActiveDecoration({ startLine: focused.startLine, endLine: focused.endLine }, relPath);
            }
        }, () => { activeSessions.delete(relPath); collapseFileInTree(relPath); for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        } });
        if (sections === undefined) {
            return;
        }
        await syncNotes(relPath, allNotes, sections);
        updateCursorContext(vscode.window.activeTextEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.editNote', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const line = editor.selection.active.line;
        const relPath = toRelPath(editor.document.uri);
        const candidates = notesAtLine(relPath, line);
        if (!candidates.length) {
            vscode.window.showInformationMessage('No note at current line.');
            return;
        }
        const note = candidates.length === 1 ? candidates[0] : await pickNote(candidates);
        if (!note) {
            return;
        }
        if (await reuseEditorSession(relPath, note.startLine, note.endLine)) {
            return;
        }
        const allNotes = store.getForFile(relPath);
        const restoreTarget = { uri: editor.document.uri, viewColumn: editor.viewColumn };
        const sectionsForEditor = allNotes.map(toSectionResult);
        const sections = await (0, noteEditor_1.openConsolidatedEditor)(sectionsForEditor, note.startLine, relPath, restoreTarget, tmpUri => {
            activeSessions.set(relPath, tmpUri);
            revealFileInTree(relPath);
            applyActiveDecoration({ startLine: note.startLine, endLine: note.endLine }, relPath);
        }, () => { activeSessions.delete(relPath); collapseFileInTree(relPath); for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        } });
        if (sections === undefined) {
            return;
        }
        await syncNotes(relPath, allNotes, sections);
        updateCursorContext(editor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.deleteNote', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const line = editor.selection.active.line;
        const candidates = notesAtLine(toRelPath(editor.document.uri), line);
        if (!candidates.length) {
            vscode.window.showInformationMessage('No note at current line.');
            return;
        }
        const note = candidates.length === 1 ? candidates[0] : await pickNote(candidates);
        if (!note) {
            return;
        }
        const preview = note.body.length > 60 ? note.body.slice(0, 57) + '…' : note.body;
        const confirm = await vscode.window.showWarningMessage(`Delete note: "${preview}"?`, { modal: true }, 'Delete');
        if (confirm !== 'Delete') {
            return;
        }
        store.delete(note.id);
        refreshDecorations(editor);
        codeLensProvider.refresh();
        updateCursorContext(editor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.deleteAllInFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const relPath = toRelPath(editor.document.uri);
        const count = store.getForFile(relPath).length;
        if (count === 0) {
            vscode.window.showInformationMessage('No notes in this file.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Delete all ${count} note${count === 1 ? '' : 's'} in this file?`, { modal: true }, 'Delete All');
        if (confirm !== 'Delete All') {
            return;
        }
        store.deleteForFile(relPath);
        refreshDecorations(editor);
        codeLensProvider.refresh();
        updateCursorContext(editor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes._editNoteById', async (noteId, openBeside = true) => {
        const note = store.getById(noteId);
        if (!note || isOrphaned(note)) {
            return;
        }
        const relPath = note.filePath;
        if (await reuseEditorSession(relPath, note.startLine, note.endLine)) {
            return;
        }
        const allNotes = store.getForFile(relPath);
        const editor = vscode.window.activeTextEditor;
        const restoreTarget = editor ? { uri: editor.document.uri, viewColumn: editor.viewColumn } : undefined;
        const sectionsForEditor = allNotes.map(toSectionResult);
        const sections = await (0, noteEditor_1.openConsolidatedEditor)(sectionsForEditor, note.startLine, relPath, restoreTarget, tmpUri => {
            activeSessions.set(relPath, tmpUri);
            revealFileInTree(relPath);
            applyActiveDecoration({ startLine: note.startLine, endLine: note.endLine }, relPath);
        }, () => { activeSessions.delete(relPath); collapseFileInTree(relPath); for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        } }, openBeside ? undefined : vscode.ViewColumn.Active);
        if (sections === undefined) {
            return;
        }
        await syncNotes(relPath, allNotes, sections);
        updateCursorContext(vscode.window.activeTextEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.openNotesForFile', async (arg) => {
        const relPath = arg instanceof FileTreeItem ? arg.relPath : arg;
        const existingTmpUri = activeSessions.get(relPath);
        if (existingTmpUri) {
            const tmpFileName = path.basename(existingTmpUri.fsPath);
            for (const group of vscode.window.tabGroups.all) {
                if (group.tabs.some(t => t.label === tmpFileName)) {
                    const doc = await vscode.workspace.openTextDocument(existingTmpUri);
                    await vscode.window.showTextDocument(doc, { viewColumn: group.viewColumn, preview: false });
                    return;
                }
            }
        }
        const allNotes = store.getForFile(relPath);
        if (!allNotes.length) {
            return;
        }
        const sectionsForEditor = allNotes.map(toSectionResult);
        const sections = await (0, noteEditor_1.openConsolidatedEditor)(sectionsForEditor, undefined, relPath, undefined, tmpUri => {
            activeSessions.set(relPath, tmpUri);
            revealFileInTree(relPath);
            for (const ed of vscode.window.visibleTextEditors) {
                ed.setDecorations(activeType, []);
            }
        }, () => { activeSessions.delete(relPath); collapseFileInTree(relPath); for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        } }, vscode.ViewColumn.Active);
        if (sections === undefined) {
            return;
        }
        await syncNotes(relPath, allNotes, sections);
        updateCursorContext(vscode.window.activeTextEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.clearFilters', () => {
        if (!notesTreeProvider) {
            return;
        }
        notesTreeProvider.tagFilter = [];
        notesTreeProvider.searchText = '';
        notesTreeProvider.refresh();
        updateTreeViewDescription();
        searchBarProvider?.clearSearch();
        searchBarProvider?.updateTags(store.getAllTags(), []);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('personalNotes.toggleGutterIcons', () => {
        gutterIconsEnabled = !gutterIconsEnabled;
        for (const editor of vscode.window.visibleTextEditors) {
            refreshDecorations(editor);
        }
        vscode.window.setStatusBarMessage(`Note gutter icons ${gutterIconsEnabled ? 'enabled' : 'disabled'}`, 2000);
    }));
    // ── Event listeners ───────────────────────────────────────────────────────
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        updateCursorContext(editor);
        for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(activeType, []);
        }
        if (editor) {
            await verifyAnchors(toRelPath(editor.document.uri), editor.document);
            refreshDecorations(editor);
            // Auto-reveal the file in the sidebar when a notes editor gains focus,
            // but only if the notes explorer is already visible (don't steal sidebar focus).
            if (notesTree && notesTreeProvider && notesTree.visible) {
                for (const [sessionRelPath, sessionTmpUri] of activeSessions) {
                    if (editor.document.uri.fsPath === sessionTmpUri.fsPath) {
                        const fileItem = new FileTreeItem(sessionRelPath, path.basename(sessionRelPath), 0);
                        notesTree.reveal(fileItem, { select: true, focus: false, expand: true }).then(undefined, () => { });
                        break;
                    }
                }
            }
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const relPath = toRelPath(event.document.uri);
        if (activeSessions.has(relPath)) {
            return;
        }
        if (!store.getForFile(relPath).some(n => !isOrphaned(n))) {
            return;
        }
        const changes = [...event.contentChanges].sort((a, b) => b.range.start.line - a.range.start.line);
        let shifted = false;
        let lineCountChanged = false;
        for (const change of changes) {
            const delta = (change.text.split('\n').length - 1) - (change.range.end.line - change.range.start.line);
            if (delta !== 0) {
                lineCountChanged = true;
                if (store.shiftLinesForFile(relPath, change.range.start.line, change.range.end.line, delta)) {
                    shifted = true;
                }
            }
        }
        if (shifted) {
            refreshAll();
        }
        else if (lineCountChanged) {
            // Note ranges unchanged, but VS Code stretches whole-line decorations when text
            // is inserted at their boundary — re-apply to snap them back to the correct lines.
            for (const editor of vscode.window.visibleTextEditors) {
                if (toRelPath(editor.document.uri) === relPath) {
                    refreshDecorations(editor);
                    break;
                }
            }
        }
    }));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        const editor = e.textEditor;
        const cursorLine = editor.selection.active.line;
        // Cursor is in the notes temp editor.
        for (const [sessionRelPath, sessionTmpUri] of activeSessions) {
            if (editor.document.uri.fsPath === sessionTmpUri.fsPath) {
                const noteRange = findSectionAtDocLine(editor.document.getText(), cursorLine);
                applyActiveDecoration(noteRange, sessionRelPath);
                return;
            }
        }
        // Cursor is in a source file.
        updateCursorContext(editor);
        const relPath = toRelPath(editor.document.uri);
        const notes = notesAtLine(relPath, cursorLine);
        applyActiveDecoration(notes.length > 0 ? { startLine: notes[0].startLine, endLine: notes[0].endLine } : undefined, relPath);
    }));
    // ── Tree view ─────────────────────────────────────────────────────────────
    notesTreeProvider = new NotesTreeProvider();
    notesTree = vscode.window.createTreeView('personalNotes.notesTree', {
        treeDataProvider: notesTreeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(notesTree);
    // When the notes explorer panel becomes visible, reveal the active notes editor's file.
    context.subscriptions.push(notesTree.onDidChangeVisibility(e => {
        if (!e.visible) {
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        for (const [sessionRelPath, sessionTmpUri] of activeSessions) {
            if (activeEditor.document.uri.fsPath === sessionTmpUri.fsPath) {
                const fileItem = new FileTreeItem(sessionRelPath, path.basename(sessionRelPath), 0);
                notesTree.reveal(fileItem, { select: false, focus: false, expand: true }).then(undefined, () => { });
                break;
            }
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(e => {
        let anyDeleted = false;
        for (const { fsPath } of e.files) {
            const relPath = path.relative(workspaceRoot, fsPath);
            if (store.deleteForFile(relPath) > 0) {
                anyDeleted = true;
            }
        }
        if (anyDeleted) {
            refreshAll();
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(e => {
        let anyRenamed = false;
        for (const { oldUri, newUri } of e.files) {
            const oldRel = path.relative(workspaceRoot, oldUri.fsPath);
            const newRel = path.relative(workspaceRoot, newUri.fsPath);
            if (store.renameFile(oldRel, newRel) > 0) {
                anyRenamed = true;
            }
            // If a notes editor is open for the renamed file, close it (content is stale).
            const tmpUri = activeSessions.get(oldRel);
            if (tmpUri) {
                activeSessions.delete(oldRel);
                const tmpFileName = path.basename(tmpUri.fsPath);
                for (const group of vscode.window.tabGroups.all) {
                    const tab = group.tabs.find(t => t.label === tmpFileName);
                    if (tab) {
                        vscode.window.tabGroups.close(tab);
                    }
                }
            }
        }
        if (anyRenamed) {
            refreshAll();
        }
    }));
    // Initial pass
    refreshAll();
    updateCursorContext(vscode.window.activeTextEditor);
    if (vscode.window.activeTextEditor) {
        void verifyAnchors(toRelPath(vscode.window.activeTextEditor.document.uri), vscode.window.activeTextEditor.document);
    }
}
function deactivate() { }
