// Which Sphinx project a page belongs to.
import { DEFAULT_CONFIG } from '../core/project-config.js';
import { pageFormat, type PageConfig } from '../core/format.js';
import type { ProjectInfo, Project } from './api.js';

// The innermost project whose source directory contains `path` (relative to the
// opened folder), or null for pages outside every project. A page belongs to a
// project of its own format: a Markdown page in an AsciiDoc project isn't one of its
// pages, say.
export function projectFor(projects: Project[], path: string): Project | null {
  const format = pageFormat(path)?.id;
  let best: Project | null = null;
  for (const p of projects) {
    if (format && p.config.format !== format) continue;
    const inside = p.dir === '' || path === p.dir || path.startsWith(p.dir + '/');
    if (inside && (!best || p.dir.length > best.dir.length)) best = p;
  }
  return best;
}

// How to read a page: its format and the project's settings for it.
export function configFor(info: ProjectInfo, path: string): PageConfig {
  return projectFor(info.projects, path)?.config ?? info.defaultConfig ?? DEFAULT_CONFIG;
}

// A path relative to a project's source directory, from one relative to the opened folder.
export function withinProject(project: Project, path: string): string {
  return project.dir ? path.slice(project.dir.length + 1) : path;
}

// The reverse of withinProject.
export function fromProject(project: Project, path: string): string {
  return project.dir ? `${project.dir}/${path}` : path;
}
