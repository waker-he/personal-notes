import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface SectionResult {
  startLine: number;    // 0-based; -1 for orphaned/unassigned
  endLine: number;      // 0-based; -1 for orphaned/unassigned
  body: string;
  tags: string[];
  updatedAt?: string;   // ISO string; display-only, stripped on parse
  orphanedId?: string;  // note ID for orphaned sections
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function closeMarkdownPreview(): void {
  for (const group of vscode.window.tabGroups.all) {
    const tab = group.tabs.find(t => {
      const input = t.input as Record<string, unknown>;
      return typeof input?.viewType === 'string' &&
        (input.viewType === 'mainThreadWebview-markdown.preview' || input.viewType === 'markdown.preview');
    });
    if (tab) {
      vscode.window.tabGroups.close(tab);
      return;
    }
  }
}

function buildConsolidatedContent(sections: SectionResult[], sourceRelPath: string): string {
  // Orphaned sections (startLine < 0) sort first, then by line number
  const sorted = sections.slice().sort((a, b) => {
    if (a.startLine < 0 && b.startLine >= 0) { return -1; }
    if (a.startLine >= 0 && b.startLine < 0) { return 1; }
    return a.startLine - b.startLine;
  });
  const header = `# 📝 Notes — \`${sourceRelPath}\``;
  return header + '\n\n' + sorted
    .map(s => {
      const userTags = s.tags.filter(t => t !== 'orphaned');
      const tsPrefix = s.updatedAt ? `_Last saved: ${formatTimestamp(s.updatedAt)}_, ` : '';
      const metaLine = `${tsPrefix}**tags:** ${userTags.join(', ')}`;
      if (s.orphanedId !== undefined) {
        return `## Lines ???-???\n> Orphaned [${s.orphanedId}] — Change this heading to \`## Lines X\` or \`## Lines X-Y\` to reassign, or delete this section to remove.\n${metaLine}\n\n${s.body.trim()}`;
      }
      const heading = s.startLine === s.endLine
        ? `## Lines ${s.startLine + 1}`
        : `## Lines ${s.startLine + 1}-${s.endLine + 1}`;
      return `${heading}\n${metaLine}\n\n${s.body.trim()}`;
    })
    .join('\n\n');
}

function parseConsolidatedContent(content: string): SectionResult[] {
  const results: SectionResult[] = [];
  const lines = content.split('\n');

  // Collect headings: normal Lines X-Y and orphaned ???-???
  const headings: Array<{ lineIdx: number; startLine: number; endLine: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const mNormal = lines[i].match(/^## Lines (\d+)(?:-(\d+))?\s*$/);
    if (mNormal) {
      const sl = parseInt(mNormal[1]) - 1;
      const el = mNormal[2] !== undefined ? parseInt(mNormal[2]) - 1 : sl;
      if (sl >= 0 && el >= sl) {
        headings.push({ lineIdx: i, startLine: sl, endLine: el });
      }
      continue;
    }
    if (/^## Lines \?\?\?-\?\?\?\s*$/.test(lines[i])) {
      headings.push({ lineIdx: i, startLine: -1, endLine: -1 });
    }
  }

  for (let h = 0; h < headings.length; h++) {
    const { lineIdx, startLine, endLine } = headings[h];
    const nextIdx = h + 1 < headings.length ? headings[h + 1].lineIdx : lines.length;
    const sectionLines = lines.slice(lineIdx + 1, nextIdx);

    while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1].trim() === '') {
      sectionLines.pop();
    }

    // Check for orphaned blockquote line: > Orphaned [<id>] — ...
    let orphanedId: string | undefined;
    let bodyStart = 0;
    if (sectionLines.length > 0 && sectionLines[0].startsWith('> Orphaned [')) {
      const m = sectionLines[0].match(/^> Orphaned \[([^\]]+)\]/);
      if (m) { orphanedId = m[1]; }
      bodyStart = 1;
    }

    // Parse metadata line (timestamp + tags)
    let tags: string[] = [];
    if (bodyStart < sectionLines.length) {
      const meta = sectionLines[bodyStart];
      if (meta.startsWith('_Last saved: ') || meta.startsWith('**tags:** ')) {
        bodyStart++;
        if (bodyStart < sectionLines.length && sectionLines[bodyStart].trim() === '') {
          bodyStart++;
        }
        let tagsStr = '';
        if (meta.startsWith('_Last saved: ')) {
          const idx = meta.indexOf(', **tags:** ');
          tagsStr = idx !== -1 ? meta.slice(idx + 12).trim() : '';
        } else {
          tagsStr = meta.slice(10).trim();
        }
        tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      }
    }

    const body = sectionLines.slice(bodyStart).join('\n').trim();
    results.push({ startLine, endLine, body, tags, ...(orphanedId ? { orphanedId } : {}) });
  }

  return results;
}

// Returns the 0-based line index in the file content where the body of the target section starts.
export function findSectionCursorLine(content: string, targetNoteStartLine: number): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## Lines (\d+)(?:-\d+)?\s*$/);
    if (m && parseInt(m[1]) - 1 === targetNoteStartLine) {
      // If a > Orphaned blockquote follows, body is one line further
      const hasBlockquote = i + 1 < lines.length && lines[i + 1].startsWith('> Orphaned [');
      // heading=i, [blockquote=i+1,] metadata, blank, body
      return Math.min(hasBlockquote ? i + 4 : i + 3, lines.length - 1);
    }
  }
  return 0;
}

export async function openConsolidatedEditor(
  sections: SectionResult[],
  focusNoteStartLine: number | undefined,
  sourceRelPath: string,
  restoreTarget?: { uri: vscode.Uri; viewColumn: vscode.ViewColumn | undefined },
  onOpen?: (tmpUri: vscode.Uri) => void,
  onClose?: () => void,
  viewColumn?: vscode.ViewColumn,
): Promise<SectionResult[] | undefined> {
  const sourceBasename = path.basename(sourceRelPath);
  const tmpFileName = `notes-for-${sourceBasename}-${randomUUID().slice(0, 8)}.md`;
  const tmpPath = path.join(os.tmpdir(), tmpFileName);

  const content = buildConsolidatedContent(sections, sourceRelPath);
  fs.writeFileSync(tmpPath, content, 'utf8');

  const cursorLine = focusNoteStartLine !== undefined
    ? findSectionCursorLine(content, focusNoteStartLine)
    : Math.max(0, content.split('\n').length - 1);
  const cursorPos = new vscode.Range(cursorLine, 0, cursorLine, 0);

  const uri = vscode.Uri.file(tmpPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: viewColumn ?? vscode.ViewColumn.Beside,
    selection: cursorPos,
  });

  onOpen?.(uri);

  async function restoreFocus(): Promise<void> {
    if (!restoreTarget?.viewColumn) { return; }
    try {
      await vscode.window.showTextDocument(restoreTarget.uri, {
        viewColumn: restoreTarget.viewColumn,
        preserveFocus: false,
      });
    } catch { /* source editor may have been closed */ }
  }

  return new Promise(resolve => {
    let resolved = false;

    function finish(raw: string | undefined): void {
      if (resolved) return;
      resolved = true;
      onClose?.();
      saveSub.dispose();
      tabSub.dispose();
      resolve(raw !== undefined ? parseConsolidatedContent(raw) : undefined);
    }

    const saveSub = vscode.workspace.onDidSaveTextDocument(async saved => {
      if (saved.uri.fsPath !== tmpPath) return;
      finish(saved.getText());
      const target = vscode.window.visibleTextEditors.find(
        e => e.document.uri.fsPath === tmpPath,
      );
      if (target) {
        await vscode.window.showTextDocument(target.document, target.viewColumn);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
      closeMarkdownPreview();
      await restoreFocus();
    });

    const tabSub = vscode.window.tabGroups.onDidChangeTabs(async e => {
      const editorClosed = e.closed.some(t => t.label === tmpFileName);
      const previewClosed = e.closed.some(t => {
        const input = t.input as Record<string, unknown>;
        return typeof input?.viewType === 'string' &&
          (input.viewType === 'mainThreadWebview-markdown.preview' ||
           input.viewType === 'markdown.preview') &&
          t.label.includes(tmpFileName);
      });

      if (!editorClosed && !previewClosed) return;

      // A drag-to-new-group fires a "close" for the old group but the tab still
      // exists in the new group.  Check current state before treating as a true close.
      if (editorClosed && vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === tmpFileName))) {
        return;
      }

      finish(undefined);

      if (editorClosed && !previewClosed) {
        try { fs.unlinkSync(tmpPath); } catch { /* gone */ }
        closeMarkdownPreview();
        await restoreFocus();
      } else if (previewClosed && !editorClosed) {
        let editorViewColumn: vscode.ViewColumn | undefined;
        for (const group of vscode.window.tabGroups.all) {
          if (group.tabs.some(t => t.label === tmpFileName)) {
            editorViewColumn = group.viewColumn;
            break;
          }
        }
        if (editorViewColumn !== undefined) {
          await vscode.window.showTextDocument(vscode.Uri.file(tmpPath), {
            preview: false,
            viewColumn: editorViewColumn,
          });
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        }
        try { fs.unlinkSync(tmpPath); } catch { /* gone */ }
        await restoreFocus();
      } else {
        try { fs.unlinkSync(tmpPath); } catch { /* gone */ }
        await restoreFocus();
      }
    });
  });
}
