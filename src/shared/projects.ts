// Which Sphinx project a page belongs to.
import { DEFAULT_CONFIG, type MystConfig } from '../core/project-config.js';
import type { ProjectInfo, SphinxProject } from './api.js';

// The innermost project whose source directory contains `path` (relative to the
// opened folder), or null for pages outside every project.
export function projectFor(projects: SphinxProject[], path: string): SphinxProject | null {
  let best: SphinxProject | null = null;
  for (const p of projects) {
    const inside = p.dir === '' || path === p.dir || path.startsWith(p.dir + '/');
    if (inside && (!best || p.dir.length > best.dir.length)) best = p;
  }
  return best;
}

// The MyST dialect to read a page with.
export function configFor(info: ProjectInfo, path: string): MystConfig {
  return projectFor(info.projects, path)?.config ?? info.defaultConfig ?? DEFAULT_CONFIG;
}

// A path relative to a project's source directory, from one relative to the opened folder.
export function withinProject(project: SphinxProject, path: string): string {
  return project.dir ? path.slice(project.dir.length + 1) : path;
}

// The reverse of withinProject.
export function fromProject(project: SphinxProject, path: string): string {
  return project.dir ? `${project.dir}/${path}` : path;
}
