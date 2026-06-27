/**
 * extract-note — Extract selected text to a new note.
 * Command: Ctrl+G (Mod+G)
 * First selected line → new note title, remaining lines → content, [[wikilink]] replaces selection.
 * If first line already contains a [[wikilink]] to an existing page, appends remaining
 * lines to that page instead of creating a new note.
 */

import { Notice } from "obsidian";
import type { App, Editor, MarkdownView, TFile } from "obsidian";

interface FlowtimePluginRef {
  notify: (msg: string, isError?: boolean) => void;
  _lastExtract: { newFilePath: string; fileName: string; timestamp: number } | null;
}

/* ─── Helpers ─── */

function cleanTitle(line: string): string {
  return line
    .replace(/^\s*[-*+]\s*\[[^\]]*\]\s*/, "")
    .replace(/^\s*[-*+]\s*/, "")
    .replace(/^#+\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/[[\]]/g, "")
    .replace(/@\d{4}-\d{2}-\d{2}/g, "")
    .replace(
      /@(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-week|next-monday)\b/gi,
      "",
    )
    .replace(/@\d+(?:\.\d+)?[hm]/g, "")
    .replace(/@(?:bucket|b):[^\s]+/g, "")
    .replace(/@p:[^\s]+/g, "")
    .replace(/@(?:high|med|low|soon|inbox|snooze)\b/gi, "")
    .replace(/@snooze\s+\d{4}-\d{2}-\d{2}/g, "")
    .replace(/@due:[^\s]+/g, "")
    .replace(/🔁\s*every\s+\d*\s*(?:day|days|week|weeks|month|months|workday|workdays)\b/gi, "")
    .replace(/[🟥🟨🟩]/gu, "")
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(title: string): string {
  let name = title.replace(/[<>:"/\\|?*]/g, "");
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001F]/g, "");
  name = name.replace(/\s+/g, " ").trim();
  if (name.length > 100) name = name.slice(0, 100).trim();
  if (name.endsWith(".")) name = name.slice(0, -1).trim();
  return name || "Untitled";
}

async function ensureUniquePath(
  app: App,
  folderPath: string,
  name: string,
): Promise<{ path: string; name: string }> {
  let finalName = name;
  let counter = 1;
  const buildPath = (n: string): string => {
    let p = folderPath ? `${folderPath}/${n}.md` : `${n}.md`;
    while (p.startsWith("/")) p = p.slice(1);
    return p;
  };

  let path = buildPath(finalName);
  while (await app.vault.adapter.exists(path)) {
    counter++;
    finalName = `${name} ${counter}`;
    path = buildPath(finalName);
  }

  return { path, name: finalName };
}

/* ─── Wikilink helpers ─── */

/** Extract the first `[[wikilink]]` page name from a line, or null. */
function extractWikilink(line: string): string | null {
  const match = line.match(/\[\[([^\]]+)\]\]/);
  if (!match) return null;
  // Strip display text: [[Page|display]] → Page
  return match[1].split("|")[0].trim();
}

/* ─── Main handler ─── */

export async function extractNote(
  app: App,
  editor: Editor,
  view: MarkdownView,
  plugin: FlowtimePluginRef,
): Promise<void> {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");

  if (from.line === to.line && from.ch === to.ch) {
    new Notice("Select text to extract to a new note");
    return;
  }

  const startLine = from.line;
  const endLine = to.line;

  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(editor.getLine(i));
  }

  const firstLine = lines[0].trim();
  if (!firstLine) {
    new Notice("First line cannot be empty");
    return;
  }

  const currentFile = view.file;
  if (!currentFile) {
    new Notice("No active file to extract from");
    return;
  }

  // ── If first line already links to an existing page, append there instead ──
  const wikiPage = extractWikilink(firstLine);
  if (wikiPage) {
    const targetFile = app.metadataCache.getFirstLinkpathDest(wikiPage, currentFile.path);
    if (targetFile) {
      const appendContent = lines.slice(1).join("\n");
      if (appendContent) {
        const existing = await app.vault.read(targetFile);
        const sep = existing.endsWith("\n") ? "" : "\n";
        await app.vault.modify(targetFile, existing + sep + appendContent);
      }
      // Replace selection with just the [[wikilink]]
      const wikiText = firstLine.match(/\[\[[^\]]+\]\]/)![0];
      editor.replaceRange(
        wikiText,
        { line: startLine, ch: 0 },
        { line: endLine, ch: editor.getLine(endLine).length },
      );
      plugin.notify(`\u2705 Appended to "${wikiPage}"`);
      return;
    }
    // Page doesn't exist – fall through to normal creation flow
  }

  const title = cleanTitle(firstLine);
  const safeName = sanitizeFilename(title);
  if (!safeName) {
    new Notice("Could not derive a valid filename from the first line");
    return;
  }

  const rawFolder = currentFile.parent ? currentFile.parent.path : "";
  const folderPath = rawFolder === "/" ? "" : rawFolder;

  const { path: newPath, name: finalName } = await ensureUniquePath(app, folderPath, safeName);

  const newContent = lines.slice(1).join("\n");

  try {
    await app.vault.create(newPath, newContent);
  } catch (e) {
    new Notice("Failed to create note: " + (e as Error).message);
    return;
  }

  const linkText = `[[${finalName}]]`;
  editor.replaceRange(
    linkText,
    { line: startLine, ch: 0 },
    { line: endLine, ch: editor.getLine(endLine).length },
  );

  plugin._lastExtract = {
    newFilePath: newPath,
    fileName: finalName,
    timestamp: Date.now(),
  };

  const newFile = app.vault.getAbstractFileByPath(newPath);
  if (newFile) {
    await app.workspace.getLeaf("tab").openFile(newFile as TFile);
  }

  plugin.notify(`\u2705 Extracted to "${finalName}"`);
}

// ── Backward-compatible class ──
export class ExtractNoteHandler {
  constructor(
    private app: App,
    private editor: Editor,
    private view: MarkdownView,
    private plugin: FlowtimePluginRef,
  ) {}
  run = () => extractNote(this.app, this.editor, this.view, this.plugin);
}
