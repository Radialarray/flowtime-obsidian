/**
 * v1.3.0: ListEnhancer — enhances markdown notes with interactive task features
 * when the note has `type: flowtime-list` or `flowtime-mobile` in its frontmatter.
 *
 * The note itself IS the task list. The plugin:
 * - Detects task lines (- [ ]) in the rendered preview
 * - Adds interactive checkboxes, inline timers
 * - Persists all changes back to the source markdown file
 * - Triggers re-aggregation after changes (for mobile markdown view)
 */

import type { App, TFile } from "obsidian";
import type { FlowtimeSettings } from "./types";
import { parseRecurrence, isRecurrenceDue } from "./task-parser";
import { activeDoc } from "./task-utils";

interface FlowtimePluginRef {
  app: App;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  statusTimer?: {
    start(taskName: string, totalSeconds: number): void;
    stop(): void;
    pause(): void;
  };
  /** Called after a change to re-aggregate the mobile file */
  onHeadingDrop?: () => void;
}

export function createListEnhancer(app: App, plugin: FlowtimePluginRef) {
  let _active: boolean = false;
  let _currentPath: string | null = null;
  let _currentFile: TFile | null = null;

  /* ─── DOM Enhancement ─── */

  function _enhance(): void {
    _cleanupDOM();
    const view = app.workspace.activeEditor as { previewEl?: HTMLElement } | null;
    const container =
      view?.previewEl || activeDoc(app).querySelector(".markdown-source-view") as HTMLElement | null;

    if (!container) {
      window.setTimeout(() => _enhance(), 300);
      return;
    }

    const selector = ".task-list-item:not(.ft-list-enhanced), .HyperMD-task-line:not(.ft-list-enhanced)";
    const taskEls = container.querySelectorAll(selector);
    if (taskEls.length === 0) return;

    for (const el of taskEls) {
      _enhanceTaskLine(el as HTMLElement);
    }
  }

  /** Add checkbox click handler and inline timer to a task line element */
  function _enhanceTaskLine(el: HTMLElement): void {
    if (el.classList.contains("ft-list-enhanced")) return;
    el.classList.add("ft-list-enhanced");

    const isPreview = el.classList.contains("task-list-item");

    // ── Checkbox click handler ──
    const checkboxEl = el.querySelector(isPreview
      ? 'input[type="checkbox"]'
      : '.cm-formatting-task') as HTMLElement | null;

    if (checkboxEl && _currentFile) {
      el.addEventListener("click", async (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const isCheckClick = isPreview
          ? target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox"
          : target.classList.contains("cm-formatting-task");

        if (!isCheckClick) return;

        // Extract source file + line from the rendered markdown link
        const linkEl = el.querySelector("a.external-link, a.internal-link");
        const href = linkEl?.getAttribute("href") || "";
        const srcMatch = href.match(/file=([^&]+).*?line=(\d+)/);
        if (!srcMatch) return;

        const srcPath = decodeURIComponent(srcMatch[1]);
        const srcLine = parseInt(srcMatch[2], 10) - 1; // back to 0-indexed

        const srcFile = app.vault.getAbstractFileByPath(srcPath) as TFile | null;
        if (!srcFile) return;

        try {
          const content = await app.vault.read(srcFile);
          const lines = content.split("\n");
          const line = lines[srcLine];
          if (!line) return;

          const isChecked = line.match(/\[x\]/i);
          const newLine = isChecked
            ? line.replace(/\[x\]/i, "[ ]")
            : line.replace(/\[ \]/, "[x]");

          lines[srcLine] = newLine;
          await app.vault.modify(srcFile, lines.join("\n"));

          if (!isChecked) {
            await _handleRecurrence(srcLine, line, srcFile);
          }

          // Trigger re-aggregation so mobile view reflects the change
          if (plugin.onHeadingDrop) {
            window.setTimeout(async () => {
              await plugin.onHeadingDrop?.();
              window.setTimeout(() => _enhance(), 400);
            }, 300);
          }
        } catch (e) {
          console.warn("Flowtime ListEnhancer: toggle error:", (e as Error).message);
        }
      });
    }

    // ── Inline timer button ──
    const timerBtn = activeDoc(app).createElement("span");
    timerBtn.textContent = "\u23F1";
    timerBtn.className = "ft-enhance-timer";
    timerBtn.setAttribute("title", "Start timer");

    let timerActive = false;
    const taskText = (el.textContent || "").replace(/^\s*[-*+]\s*\[[ xX-]\]\s*/, "").trim();

    timerBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      if (!plugin.statusTimer) return;

      if (timerActive) {
        plugin.statusTimer.stop();
        timerActive = false;
        timerBtn.textContent = "\u23F1";
        timerBtn.addClass("ft-op-05");
      } else {
        const durMatch = taskText.match(/@(\d+(?:\.\d+)?)([hm])/);
        const seconds = durMatch
          ? (durMatch[2] === "h" ? parseFloat(durMatch[1]) * 3600 : parseFloat(durMatch[1]) * 60)
          : 1500;
        plugin.statusTimer.start(taskText, Math.round(seconds));
        timerActive = true;
        timerBtn.textContent = "\u23F8";
        timerBtn.removeClass("ft-op-05");
      }
    });

    el.appendChild(timerBtn);
  }

  /* ─── Recurrence ─── */

  async function _handleRecurrence(lineNum: number, line: string, srcFile?: TFile): Promise<void> {
    const targetFile = srcFile || _currentFile;
    if (!targetFile) return;
    const recurrence = parseRecurrence(line);
    if (!recurrence) return;

    const today = new Date().toISOString().split("T")[0];
    if (!isRecurrenceDue(recurrence, today, { workdays: plugin.settings.workdays })) return;

    let nextDate: string | null = null;
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      if (isRecurrenceDue(recurrence, ds, { workdays: plugin.settings.workdays })) {
        nextDate = ds;
        break;
      }
    }

    if (nextDate) {
      const content = await app.vault.read(targetFile);
      const lines = content.split("\n");
      let nl = lines[lineNum];
      if (nl) {
        nl = nl.replace(/\[x\]/i, "[ ]");
        nl = nl.replace(/[@\u23F3\u{1F4C5}]\s*\d{4}-\d{2}-\d{2}/u, "@" + nextDate);
        if (!nl.match(/[@\u23F3\u{1F4C5}]\s*\d{4}-\d{2}-\d{2}/u)) {
          nl = nl.replace(/(\]\s*)/, "$1@" + nextDate + " ");
        }
        lines[lineNum] = nl;
        await app.vault.modify(targetFile, lines.join("\n"));
      }
    }
  }

  /* ─── Cleanup ─── */

  function _cleanupDOM(): void {
    activeDoc(app).querySelectorAll(".ft-list-enhanced").forEach((el) => {
      el.classList.remove("ft-list-enhanced");
      el.querySelectorAll(".ft-enhance-timer").forEach((c) => c.remove());
    });
  }

  /* ─── Public API ─── */

  async function check(): Promise<void> {
    const file = app.workspace.getActiveFile();
    if (!file) return deactivate();

    if (_currentPath === file.path && _active) return;

    const cache = app.metadataCache.getCache(file.path);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const isListNote = fm?.type === "flowtime-list" || fm?.type === "flowtime-mobile";

    if (isListNote) {
      await activate(file);
    } else if (_active) {
      deactivate();
    }
  }

  async function activate(file: TFile): Promise<void> {
    deactivate();
    _active = true;
    _currentPath = file.path;
    _currentFile = file;
    window.setTimeout(() => _enhance(), 500);
  }

  function deactivate(): void {
    _cleanupDOM();
    _active = false;
    _currentPath = null;
    _currentFile = null;
  }

  return { check, activate, deactivate, _enhance, _enhanceTaskLine, _cleanupDOM };
}

// Backward-compatible class wrapper
export class ListEnhancer {
  declare check: ReturnType<typeof createListEnhancer>['check'];
  declare activate: ReturnType<typeof createListEnhancer>['activate'];
  declare deactivate: ReturnType<typeof createListEnhancer>['deactivate'];
  declare _enhance: ReturnType<typeof createListEnhancer>['_enhance'];
  declare _enhanceTaskLine: ReturnType<typeof createListEnhancer>['_enhanceTaskLine'];
  declare _cleanupDOM: ReturnType<typeof createListEnhancer>['_cleanupDOM'];

  constructor(app: App, plugin: FlowtimePluginRef) {
    const impl = createListEnhancer(app, plugin);
    this.check = impl.check;
    this.activate = impl.activate;
    this.deactivate = impl.deactivate;
    this._enhance = impl._enhance;
    this._enhanceTaskLine = impl._enhanceTaskLine;
    this._cleanupDOM = impl._cleanupDOM;
  }
}
