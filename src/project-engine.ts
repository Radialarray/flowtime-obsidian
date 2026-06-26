import type { App, TFile } from "obsidian";
import type { FlowtimeSettings, ProjectResult, FrontmatterResult } from "./types";

export class ProjectEngine {
  private app: App;
  private settings: FlowtimeSettings;
  private cache: Map<string, ProjectResult> = new Map();

  constructor(app: App, settings: FlowtimeSettings) {
    this.app = app;
    this.settings = settings;
  }

  async resolve(filePath: string): Promise<ProjectResult> {
    if (this.cache.has(filePath)) return this.cache.get(filePath)!;

    const result = await this._resolveFromFrontmatter(filePath);
    if (result) {
      this.cache.set(filePath, result);
      return result;
    }

    const fallback = await this._resolveFromFolder(filePath);
    this.cache.set(filePath, fallback);
    return fallback;
  }

  private _parentDir(filePath: string): string {
    const idx = filePath.lastIndexOf("/");
    if (idx <= 0) return "";
    return filePath.substring(0, idx + 1);
  }

  private async _resolveFromFrontmatter(filePath: string): Promise<ProjectResult | null> {
    let dir = this._parentDir(filePath);
    const rootSetting = this.settings.projectsRoot || "";
    const rootPath = rootSetting
      ? rootSetting.endsWith("/") ? rootSetting : rootSetting + "/"
      : "";

    while (dir) {
      if (rootPath && !dir.startsWith(rootPath)) break;

      const dirName = dir.replace(/\/$/, "").split("/").pop();
      if (!dirName) break;

      const candidatePath = dir + dirName + ".md";
      const afile = this.app.vault.getAbstractFileByPath(candidatePath);

      if (afile) {
        const file = afile as TFile;
        const content = await this.app.vault.read(file);
        const { found, name } = this._parseFrontmatter(content);
        if (found) {
          return {
            name: name || dirName,
            path: candidatePath,
            source: "frontmatter",
          };
        }
      }

      const trimmed = dir.replace(/\/$/, "");
      const idx = trimmed.lastIndexOf("/");
      if (idx <= 0) break;
      dir = trimmed.substring(0, idx + 1);
    }

    return null;
  }

  private _parseFrontmatter(content: string): FrontmatterResult {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { found: false, name: null };

    const yamlLines = match[1].split("\n");
    const key = this.settings.projectFrontmatterKey;
    const value = this.settings.projectFrontmatterValue;
    const nameKey = this.settings.projectNameKey;

    let isProject = false;
    let name: string | null = null;

    for (const line of yamlLines) {
      const kv = line.match(/^(\w[\w\s-]*?):\s+(.+)$/);
      if (!kv) continue;
      const k = kv[1].trim();
      const v = kv[2].trim();

      if (k === key && v === value) isProject = true;
      if (k === nameKey) name = v;
      if (!name && (k === "title" || k === "alias")) name = v;
    }

    return { found: isProject, name };
  }

  private async _resolveFromFolder(filePath: string): Promise<ProjectResult> {
    if (!this.settings.fallbackToFolderName) {
      return { name: null, path: null, source: null };
    }
    const dir = this._parentDir(filePath);
    const dirName = dir.replace(/\/$/, "").split("/").pop();
    return { name: dirName || null, path: null, source: "folder" };
  }

  resolveFromTag(taskText: string, tagPrefix: string): string | null {
    const escaped = tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`#${escaped}(\\S+)`, "i");
    const match = taskText.match(regex);
    return match ? match[1] : null;
  }

  async getAllProjects(): Promise<Array<{ name: string; path: string }>> {
    const projects = new Map<string, string>();
    const files = this.app.vault.getMarkdownFiles();
    const key = this.settings.projectFrontmatterKey;
    const value = this.settings.projectFrontmatterValue;
    const nameKey = this.settings.projectNameKey;

    for (const file of files) {
      const parts = file.path.split("/");
      const folder = parts.length > 1 ? parts[parts.length - 2] : null;
      if (!folder || file.basename !== folder) continue;

      try {
        const cache = this.app.metadataCache.getCache(file.path);
        const fm = cache?.frontmatter as Record<string, unknown> | undefined;
        if (fm && fm[key] === value) {
          const name = (fm[nameKey] || fm.title || fm.alias || folder) as string;
          if (!projects.has(name)) {
            projects.set(name, file.path);
          }
        }
      } catch (_) { /* skip */ }
    }

    return [...projects.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, path]) => ({ name, path }));
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
    if (filePath.endsWith("/")) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(filePath)) {
          this.cache.delete(key);
        }
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
