import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { FlowtimeSettings, ProjectResult, FrontmatterResult } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Module-level helpers (pure functions)
// ═══════════════════════════════════════════════════════════════════

function _parentDir(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) return "";
  return filePath.substring(0, idx + 1);
}

function _parseFrontmatter(content: string, settings: FlowtimeSettings): FrontmatterResult {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { found: false, name: null };

  const yamlLines = match[1].split("\n");
  const key = settings.projectFrontmatterKey;
  const value = settings.projectFrontmatterValue;
  const nameKey = settings.projectNameKey;

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

async function _resolveFromFrontmatter(
  app: App,
  settings: FlowtimeSettings,
  filePath: string,
): Promise<ProjectResult | null> {
  let dir = _parentDir(filePath);
  const rootSetting = settings.projectsRoot || "";
  const rootPath = rootSetting
    ? rootSetting.endsWith("/") ? rootSetting : rootSetting + "/"
    : "";

  while (dir) {
    if (rootPath && !dir.startsWith(rootPath)) break;

    const dirName = dir.replace(/\/$/, "").split("/").pop();
    if (!dirName) break;

    const candidatePath = dir + dirName + ".md";
    const afile = app.vault.getAbstractFileByPath(candidatePath);

    if (afile instanceof TFile) {
      const content = await app.vault.read(afile);
      const { found, name } = _parseFrontmatter(content, settings);
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

async function _resolveFromFolder(
  settings: FlowtimeSettings,
  filePath: string,
): Promise<ProjectResult> {
  if (!settings.fallbackToFolderName) {
    return { name: null, path: null, source: null };
  }
  const dir = _parentDir(filePath);
  const dirName = dir.replace(/\/$/, "").split("/").pop();
  return { name: dirName || null, path: null, source: "folder" };
}

// ═══════════════════════════════════════════════════════════════════
// Factory — preferred way to create a project engine
// ═══════════════════════════════════════════════════════════════════

export function createProjectEngine(app: App, settings: FlowtimeSettings) {
  const cache = new Map<string, ProjectResult>();

  async function resolve(filePath: string): Promise<ProjectResult> {
    if (cache.has(filePath)) return cache.get(filePath)!;

    const result = await _resolveFromFrontmatter(app, settings, filePath);
    if (result) {
      cache.set(filePath, result);
      return result;
    }

    const fallback = await _resolveFromFolder(settings, filePath);
    cache.set(filePath, fallback);
    return fallback;
  }

  function resolveFromTag(taskText: string, tagPrefix: string): string | null {
    const escaped = tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`#${escaped}(\\S+)`, "i");
    const match = taskText.match(regex);
    return match ? match[1] : null;
  }

  async function getAllProjects(): Promise<Array<{ name: string; path: string }>> {
    const projects = new Map<string, string>();
    const files = app.vault.getMarkdownFiles();
    const key = settings.projectFrontmatterKey;
    const value = settings.projectFrontmatterValue;
    const nameKey = settings.projectNameKey;

    for (const file of files) {
      const parts = file.path.split("/");
      const folder = parts.length > 1 ? parts[parts.length - 2] : null;
      if (!folder || file.basename !== folder) continue;

      try {
        const cache = app.metadataCache.getCache(file.path);
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

  function invalidate(filePath: string): void {
    cache.delete(filePath);
    if (filePath.endsWith("/")) {
      for (const key of cache.keys()) {
        if (key.startsWith(filePath)) {
          cache.delete(key);
        }
      }
    }
  }

  function clear(): void {
    cache.clear();
  }

  return { resolve, getAllProjects, invalidate, clear, resolveFromTag };
}

// ═══════════════════════════════════════════════════════════════════
// Backward-compatible class — delegates to factory under the hood
// ═══════════════════════════════════════════════════════════════════

export class ProjectEngine {
  private _impl: ReturnType<typeof createProjectEngine>;

  constructor(app: App, settings: FlowtimeSettings) {
    this._impl = createProjectEngine(app, settings);
  }

  async resolve(filePath: string): Promise<ProjectResult> {
    return this._impl.resolve(filePath);
  }

  resolveFromTag(taskText: string, tagPrefix: string): string | null {
    return this._impl.resolveFromTag(taskText, tagPrefix);
  }

  async getAllProjects(): Promise<Array<{ name: string; path: string }>> {
    return this._impl.getAllProjects();
  }

  invalidate(filePath: string): void {
    return this._impl.invalidate(filePath);
  }

  clear(): void {
    return this._impl.clear();
  }
}
