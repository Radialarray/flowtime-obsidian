/**
 * v1.3.0: ListEnhancer — enhances markdown notes with interactive task features
 * when the note has `type: flowtime-list` in its frontmatter.
 */

import type { App, TFile } from "obsidian";
import type { FlowtimeSettings } from "./types";

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
}

interface NoteSection {
  heading: string | null;
  level: number;
  tasks: NoteTask[];
  startLine?: number;
}

interface NoteTask {
  line: number;
  indent: number;
  checked: boolean;
  text: string;
  raw: string;
}

export class ListEnhancer {
  private app: App;
  private plugin: FlowtimePluginRef;
  private _active: boolean = false;
  private _currentPath: string | null = null;
  private _observedTasks: unknown[] = [];
  private _dispose: (() => void) | null = null;
  private _observer: MutationObserver | null = null;
  private _observeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(app: App, plugin: FlowtimePluginRef) {
    this.app = app;
    this.plugin = plugin;
  }

  async check(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return this.deactivate();

    if (this._currentPath === file.path && this._active) return;

    const cache = this.app.metadataCache.getCache(file.path);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const isListNote = fm?.type === "flowtime-list";

    if (isListNote) {
      await this.activate(file);
    } else if (this._active) {
      this.deactivate();
    }
  }

  async activate(file: TFile): Promise<void> {
    this.deactivate();
    this._active = true;
    this._currentPath = file.path;
    console.log("FT LIST ENHANCER: activated on", file.path);
    setTimeout(() => this._enhance(), 500);
  }

  deactivate(): void {
    if (this._dispose) {
      this._dispose();
      this._dispose = null;
    }
    this._cleanupDOM();
    this._active = false;
    this._currentPath = null;
    this._observedTasks = [];
  }

  _parseNote(content: string): NoteSection[] {
    const lines = content.split("\n");
    const sections: NoteSection[] = [];
    let currentSection: NoteSection = { heading: null, level: 0, tasks: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (currentSection.tasks.length > 0 || currentSection.heading) {
          sections.push(currentSection);
        }
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          tasks: [],
          startLine: i,
        };
        continue;
      }
      const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX\-])\]\s+(.*)$/);
      if (taskMatch) {
        currentSection.tasks.push({
          line: i,
          indent: taskMatch[1].length,
          checked: taskMatch[2] !== " ",
          text: taskMatch[3],
          raw: line,
        });
      }
    }

    if (currentSection.tasks.length > 0 || currentSection.heading) {
      sections.push(currentSection);
    }
    return sections;
  }

  _enhance(): void {
    this._cleanupDOM();
    const view = this.app.workspace.activeEditor as { previewEl?: HTMLElement } | null;

    const container =
      view?.previewEl || document.querySelector(".markdown-source-view") as HTMLElement | null;

    if (!container) {
      setTimeout(() => this._enhance(), 300);
      return;
    }

    const selector = ".task-list-item:not(.ft-list-enhanced), .HyperMD-task-line:not(.ft-list-enhanced)";
    const taskEls = container.querySelectorAll(selector);
    if (taskEls.length === 0) {
      setTimeout(() => this._enhance(), 500);
      return;
    }

    for (const el of taskEls) {
      this._enhanceTaskLine(el as HTMLElement);
    }

    this._setupDragDrop(container);

    if (!this._observer) {
      this._observer = new MutationObserver(() => {
        clearTimeout(this._observeTimer);
        this._observeTimer = setTimeout(() => this._enhance(), 500);
      });
      this._observer.observe(container, { childList: true, subtree: true });
    }
  }

  _enhanceTaskLine(el: HTMLElement): void {
    if (el.classList.contains("ft-list-enhanced")) return;
    el.classList.add("ft-list-enhanced");

    const isPreview = el.classList.contains("task-list-item");
    const insertPoint = isPreview
      ? el.firstChild
      : (el.querySelector(".cm-formatting-task")?.nextSibling || el.firstChild);

    const handle = document.createElement("span");
    handle.textContent = "⠿";
    handle.className = "ft-list-drag ft-enhance-drag";
    handle.setAttribute("title", "Drag to reorder");
    el.insertBefore(handle, insertPoint);

    if (!isPreview) {
      handle.style.position = "absolute";
      handle.style.left = "0";
      handle.style.top = "0";
      handle.style.zIndex = "1";
      el.style.position = "relative";
      el.style.paddingLeft = "22px";
    }
  }

  _cleanupDOM(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    document.querySelectorAll(".ft-list-enhanced").forEach((el) => el.classList.remove("ft-list-enhanced"));
    document.querySelectorAll(".ft-enhance-drag").forEach((el) => el.remove());
  }

  _setupDragDrop(_container: HTMLElement): void {
    // Stub — to be implemented in next iteration
  }
}
