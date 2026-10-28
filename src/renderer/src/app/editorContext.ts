// What the editor's node views need from the app (see editor/context.ts): the dialogs,
// images, links and cross-references of the open page. One context object for the
// lifetime of the app; node views read it lazily, through a ref kept current here.
//
// It also keeps the Sphinx build states, since cross-references resolve against them:
// when a build finishes, node views are told to redraw (refreshViews).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ProjectInfo } from '../../../shared/api';
import type { BuildState } from '../../../shared/build';
import type { SourceMap } from '../../../core/sourcemap';
import { configFor, projectFor } from '../../../shared/projects';
import { DEFAULT_CONFIG } from '../../../core/project-config';
import { pageExtensions } from '../../../core/format';
import type { Workspace } from '../workspace';
import type { EditorContext } from '../editor/context';
import type { DialogApi } from '../components/Dialogs';
import { resolveRef } from '../paths';
import { builderFor } from '../builders/builder';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument } from '../../../core/document';

// Other pages, parsed for the cross-reference dialog: again only when their text changes.
const parsedPages = new Map<string, { text: string; doc: PMNode }>();

const api = window.myst;

// The page a {doc} role or toctree entry refers to, if it exists.
function findPage(info: ProjectInfo, from: string | null, ref: string): string | null {
  const projectDir = from ? (projectFor(info.projects, from)?.dir ?? '') : '';
  const target = resolveRef(from, ref, projectDir);
  if (!target) return null;
  return [target, ...pageExtensions().flatMap((ext) => [`${target}${ext}`, `${target}/index${ext}`])].find((c) => info.files.includes(c)) ?? null;
}

// A name for a picture pasted from the clipboard (browsers call them all image.png).
function imageName(file: File): string {
  const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[file.type] ?? 'png';
  if (file.name && file.name !== 'image.png' && /\.[a-z0-9]+$/i.test(file.name)) return file.name;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `screenshot-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

export function useEditorContext(dialogs: RefObject<DialogApi | null>, ws: Workspace | null, openPage: (path: string) => void) {
  // Build state per Sphinx project id.
  const [buildStates, setBuildStates] = useState<Record<string, BuildState>>({});
  const ctxRef = useRef({ ws, openPage, states: buildStates });
  ctxRef.current = { ws, openPage, states: buildStates };
  const listeners = useRef(new Set<() => void>());
  const refreshViews = useCallback(() => listeners.current.forEach((fn) => fn()), []);

  const ctx = useMemo<EditorContext>(() => {
    const current = () => ctxRef.current.ws;
    const pageProject = () => {
      const w = current();
      return w?.current ? projectFor(w.project.projects, w.current) : null;
    };
    // Cross-references resolve within the open page's own project.
    const build = () => {
      const p = pageProject();
      return (p && ctxRef.current.states[p.id]?.info) || null;
    };
    return {
      ui: {
        editSource: (o) => dialogs.current!.editSource(o),
        editFields: (o) => dialogs.current!.editFields(o),
        editOptions: (o) => dialogs.current!.editOptions(o),
        editCondition: (o) => dialogs.current!.editCondition(o),
        notify: (m) => dialogs.current!.notify(m),
      },
      get config() {
        const w = current();
        return w ? configFor(w.project, w.current ?? '') : DEFAULT_CONFIG;
      },
      get filePath() {
        return current()?.current ?? null;
      },
      chooseImage() {
        const page = current()?.current;
        return page ? api.chooseImage(page) : Promise.resolve(null);
      },
      async addImage(file: File) {
        const page = current()?.current;
        if (!page) throw new Error('No page is open');
        // A file from disk is referenced (or copied in); a picture from the clipboard
        // has no file, so it's saved under a dated name.
        const path = api.filePath(file);
        if (path) return api.addImageFile(page, path);
        return api.addImageData(page, imageName(file), new Uint8Array(await file.arrayBuffer()));
      },
      assetUrl(ref: string) {
        const w = current();
        if (!w || /^(https?:|data:)/.test(ref)) return ref;
        const rel = resolveRef(w.current, ref, pageProject()?.dir ?? '');
        return rel === null ? '' : api.assetUrl(rel);
      },
      openDocument(ref: string) {
        const w = current();
        const found = w && findPage(w.project, w.current, ref);
        if (found) ctxRef.current.openPage(found);
        else dialogs.current?.notify(`No Markdown page found for “${ref}”`);
      },
      pageTitle(ref: string) {
        const w = current();
        const found = w && findPage(w.project, w.current, ref);
        return found ? (w.project.titles[found] ?? null) : null;
      },
      absorb(map: SourceMap) {
        const w = current();
        if (w?.current) w.absorb(w.current, map);
      },
      resolveRole: (role, target) => builderFor(pageProject()).references.role(build(), current()?.current ?? null, role, target),
      resolveLink: (href) => builderFor(pageProject()).references.link(build(), current()?.current ?? null, href),
      suggest: (role) => builderFor(pageProject()).references.suggest(build(), current()?.current ?? null, role),
      async otherPages() {
        const w = current();
        if (!w?.current) return [];
        const own = projectFor(w.project.projects, w.current)?.id ?? null;
        const out: { path: string; title: string; doc: PMNode }[] = [];
        for (const path of w.project.files) {
          if (path === w.current || (projectFor(w.project.projects, path)?.id ?? null) !== own) continue;
          const text = w.get(path) ? w.sourceOf(path) : await api.readFile(path).catch(() => null);
          if (text === null) continue;
          // Parsed once for each text the page has.
          let hit = parsedPages.get(path);
          if (hit?.text !== text) parsedPages.set(path, (hit = { text, doc: loadDocument(text, configFor(w.project, path)).doc }));
          out.push({ path, title: w.project.titles[path] ?? path, doc: hit.doc });
        }
        return out;
      },
      editPage: (path, change) => current()?.edit(path, change) ?? Promise.resolve(false),
      subscribe(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    };
  }, [dialogs]);

  // Build results: keep them, and let node views refresh their cross-references.
  useEffect(() => {
    const refresh = (states: Record<string, BuildState>) => {
      ctxRef.current.states = states;
      setBuildStates(states);
      refreshViews();
    };
    const off = api.onBuildState(({ project, state }) => refresh({ ...ctxRef.current.states, [project]: state }));
    void api.buildStates().then(refresh);
    return off;
  }, [refreshViews]);

  // A folder was opened: its projects' states, as they are now.
  const reloadBuildStates = useCallback(() => {
    void api.buildStates().then((states) => {
      ctxRef.current.states = states;
      setBuildStates(states);
    });
  }, []);

  return { ctx, buildStates, reloadBuildStates, refreshViews };
}
