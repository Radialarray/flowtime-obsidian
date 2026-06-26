import { Notice } from "obsidian";
import type { App, Editor, MarkdownView } from "obsidian";

interface FlowtimePluginRef {
  notify: (msg: string, isError?: boolean) => void;
  _lastExtract: { newFilePath: string; fileName: string; timestamp: number } | null;
}

export class ExtractNoteHandler {
  private app: App;
  private editor: Editor;
  private view: MarkdownView;
  private plugin: FlowtimePluginRef;

  constructor(app: App, editor: Editor, view: MarkdownView, plugin: FlowtimePluginRef) {
    this.app = app;
    this.editor = editor;
    this.view = view;
    this.plugin = plugin;
  }

  async run(): Promise<void> {
    const from = this.editor.getCursor("from");
    const to = this.editor.getCursor("to");

    if (from.line === to.line && from.ch === to.ch) {
      new Notice("Select text to extract to a new note");
      return;
    }

    const startLine = from.line;
    const endLine = to.line;

    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(this.editor.getLine(i));
    }

    const firstLine = lines[0].trim();
    if (!firstLine) {
      new Notice("First line cannot be empty");
      return;
    }

    const currentFile = this.view.file;
    if (!currentFile) {
      new Notice("No active file to extract from");
      return;
    }

    const title = this._cleanTitle(firstLine);
    const safeName = this._sanitizeFilename(title);
    if (!safeName) {
      new Notice("Could not derive a valid filename from the first line");
      return;
    }

    const rawFolder = currentFile.parent ? currentFile.parent.path : "";
    const folderPath = rawFolder === "/" ? "" : rawFolder;

    const { path: newPath, name: finalName } = await this._ensureUniquePath(folderPath, safeName);

    const newContent = lines.slice(1).join("\n");

    try {
      await this.app.vault.create(newPath, newContent);
    } catch (e) {
      new Notice("Failed to create note: " + (e as Error).message);
      return;
    }

    const linkText = `[[${finalName}]]`;
    this.editor.replaceRange(
      linkText,
      { line: startLine, ch: 0 },
      { line: endLine, ch: this.editor.getLine(endLine).length },
    );

    this.plugin._lastExtract = {
      newFilePath: newPath,
      fileName: finalName,
      timestamp: Date.now(),
    };

    const newFile = this.app.vault.getAbstractFileByPath(newPath);
    if (newFile) {
      await this.app.workspace.getLeaf("tab").openFile(newFile as import("obsidian").TFile);
    }

    this.plugin.notify(`\u2705 Extracted to "${finalName}"`);
  }

  private _cleanTitle(line: string): string {
    return line
      .replace(/^\s*[-*+]\s*\[[^\]]*\]\s*/, "")
      .replace(/^\s*[-*+]\s*/, "")
      .replace(/^#+\s*/, "")
      .replace(/^\s*\d+[.)]\s*/, "")
      .replace(/^>\s*/, "")
      .replace(/[\[\]]/g, "")
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

  private _sanitizeFilename(title: string): string {
    let name = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "");
    name = name.replace(/\s+/g, " ").trim();
    if (name.length > 100) name = name.slice(0, 100).trim();
    if (name.endsWith(".")) name = name.slice(0, -1).trim();
    return name || "Untitled";
  }

  private async _ensureUniquePath(
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
    while (await this.app.vault.adapter.exists(path)) {
      counter++;
      finalName = `${name} ${counter}`;
      path = buildPath(finalName);
    }

    return { path, name: finalName };
  }
}
