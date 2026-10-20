// Open documents, autosave and external-change handling, independent of React.
import type { EditorState, Transaction } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../../core/document';
import type { SourceMap } from '../../core/sourcemap';
import type { MystApi, ProjectInfo } from '../../shared/api';
import { configFor } from '../../shared/projects';
import { createEditorState } from './editor/setup';

export type SaveStatus =
  | { kind: 'saved' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  // Saving would change the page in a way the writer didn't make; needs confirmation.
  | { kind: 'unsafe'; problem: string }
  | { kind: 'error'; message: string }
  // Changed on disk while there were unsaved edits here.
  | { kind: 'conflict' };

export interface Session {
  path: string;
  state: EditorState;
  map: SourceMap;
  savedText: string; // the file content as last read or written
  dirty: boolean; // edits not yet written
  status: SaveStatus;
  // In the advanced (Markdown) view the text is the page: saved exactly as typed.
  // Null while the page is edited as formatted content.
  text: string | null;
  // The file's line endings. Pages are edited with \n and saved with these, so a
  // Windows (CRLF) file stays CRLF throughout and an edit changes only its own lines.
  eol: '\n' | '\r\n';
}

// A file mostly written with CRLF is a CRLF file.
export function lineEnding(text: string): '\n' | '\r\n' {
  const crlf = text.split('\r\n').length - 1;
  return crlf > 0 && crlf >= (text.split('\n').length - 1) / 2 ? '\r\n' : '\n';
}

const toLf = (text: string) => text.replace(/\r\n/g, '\n');
const withEol = (text: string, eol: '\n' | '\r\n') => (eol === '\n' ? text : toLf(text).replace(/\n/g, '\r\n'));

const AUTOSAVE_MS = 1000;

export class Workspace {
  private sessions = new Map<string, Session>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private version = 0;
  current: string | null = null;

  constructor(
    readonly api: MystApi,
    public project: ProjectInfo,
  ) {}

  // ---- subscription (for useSyncExternalStore) ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    this.api.setUnsaved([...this.sessions.values()].some((s) => s.dirty));
    this.listeners.forEach((fn) => fn());
  }

  // ---- documents ----

  get(path: string | null): Session | undefined {
    return path ? this.sessions.get(path) : undefined;
  }

  async open(path: string): Promise<Session> {
    const session = await this.session(path);
    this.current = path;
    this.changed();
    return session;
  }

  private async session(path: string): Promise<Session> {
    let session = this.sessions.get(path);
    if (!session) {
      const text = await this.api.readFile(path);
      session = this.load(path, text);
      this.sessions.set(path, session);
    }
    return session;
  }

  // Change a page that may not be open (a parent page's table of contents, say) and
  // save it now. `change` returns null to leave the page as it is. False if the page
  // is being edited as Markdown text, or couldn't be saved.
  async edit(path: string, change: (state: EditorState) => Transaction | null): Promise<boolean> {
    const s = await this.session(path);
    if (s.text !== null) return false;
    const tr = change(s.state);
    if (!tr?.docChanged) return true;
    s.state = s.state.apply(tr);
    s.dirty = true;
    return this.save(path);
  }

  // A page's current state, loading it if it isn't open.
  async stateOf(path: string): Promise<EditorState> {
    return (await this.session(path)).state;
  }

  absorbInto(path: string, map: SourceMap) {
    this.sessions.get(path)?.map.merge(map);
  }

  // Put an earlier version of a page back, and save it. In the Markdown view the text
  // is replaced; otherwise the page is read again from it.
  async restore(path: string, text: string): Promise<boolean> {
    const s = await this.session(path);
    const lf = toLf(text);
    if (s.text !== null) {
      this.setText(path, lf);
    } else {
      const fresh = this.load(path, withEol(lf, s.eol), s.eol);
      this.sessions.set(path, { ...fresh, savedText: s.savedText, dirty: true, status: { kind: 'pending' } });
    }
    return this.save(path);
  }

  // Forget a page (it was deleted).
  close(path: string) {
    clearTimeout(this.timers.get(path));
    this.sessions.delete(path);
    if (this.current === path) this.current = null;
    this.changed();
  }

  // `eol`: keep this line ending instead of the text's own (text from the Markdown view
  // has plain \n).
  private load(path: string, text: string, eol = lineEnding(text)): Session {
    const { doc, map } = loadDocument(toLf(text), configFor(this.project, path));
    return { path, state: createEditorState(doc), map, savedText: text, dirty: false, status: { kind: 'saved' }, text: null, eol };
  }

  update(path: string, state: EditorState, docChanged: boolean) {
    const s = this.sessions.get(path);
    if (!s) return;
    s.state = state;
    if (docChanged) {
      s.dirty = true;
      if (s.status.kind !== 'conflict') s.status = { kind: 'pending' };
      this.schedule(path);
    }
    this.changed();
  }

  absorb(path: string, map: SourceMap) {
    this.sessions.get(path)?.map.merge(map);
  }

  private schedule(path: string) {
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => void this.save(path), AUTOSAVE_MS));
  }

  // Write a session if it has unsaved edits. Returns false if it couldn't be saved.
  async save(path: string, { force = false } = {}): Promise<boolean> {
    clearTimeout(this.timers.get(path));
    const s = this.sessions.get(path);
    if (!s) return true;
    if (!s.dirty && !force) return true;
    if (s.status.kind === 'conflict' && !force) return false;

    // Typed Markdown is saved as it is; formatted edits are serialized and checked.
    const saved = s.text !== null ? { text: s.text, verified: true } : saveDocument(s.state.doc, s.map, configFor(this.project, path));
    const result = { ...saved, text: withEol(saved.text, s.eol) };
    if (!result.verified && !force) {
      s.status = { kind: 'unsafe', problem: result.problem! };
      this.changed();
      return false;
    }
    const state = s.state;
    const typed = s.text;
    if (result.text === s.savedText) {
      s.dirty = false;
      s.status = { kind: 'saved' };
      this.changed();
      return true;
    }
    s.status = { kind: 'saving' };
    this.changed();
    try {
      await this.api.writeFile(path, result.text);
      s.savedText = result.text;
      // Only clean if nothing was typed while writing.
      if (s.state === state && s.text === typed) s.dirty = false;
      s.status = s.dirty ? { kind: 'pending' } : { kind: 'saved' };
      if (s.dirty) this.schedule(path);
    } catch (e) {
      s.status = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    this.changed();
    return s.status.kind !== 'error';
  }

  async saveAll(): Promise<boolean> {
    const results = await Promise.all([...this.sessions.keys()].map((p) => this.save(p)));
    return results.every(Boolean);
  }

  unsavedPaths(): string[] {
    return [...this.sessions.values()].filter((s) => s.dirty).map((s) => s.path);
  }

  // The Markdown the session would save right now (with \n line endings).
  sourceOf(path: string): string {
    const s = this.sessions.get(path)!;
    if (s.text !== null) return s.text;
    return s.dirty ? saveDocument(s.state.doc, s.map, configFor(this.project, path)).text : toLf(s.savedText);
  }

  // ---- the advanced (Markdown) view ----

  // Edit the page as text, starting from what the formatted editor would save.
  enterTextMode(path: string) {
    const s = this.sessions.get(path);
    if (!s || s.text !== null) return;
    s.text = this.sourceOf(path);
    this.changed();
  }

  setText(path: string, text: string) {
    const s = this.sessions.get(path);
    if (!s || s.text === text) return;
    s.text = text;
    s.dirty = withEol(text, s.eol) !== s.savedText;
    if (s.status.kind !== 'conflict') s.status = s.dirty ? { kind: 'pending' } : { kind: 'saved' };
    if (s.dirty) this.schedule(path);
    this.changed();
  }

  // Back to formatted editing: read the text as it now stands.
  leaveTextMode(path: string) {
    const s = this.sessions.get(path);
    if (!s || s.text === null) return;
    const { text, dirty, status } = s;
    const fresh = this.load(path, text, s.eol);
    this.sessions.set(path, { ...fresh, savedText: s.savedText, dirty, status });
    this.changed();
  }

  // ---- changes on disk ----

  async externalChange(changed: string[], files: string[], titles: Record<string, string>) {
    this.project = { ...this.project, files, titles };
    for (const path of changed) {
      const s = this.sessions.get(path);
      if (!s) continue;
      let text: string;
      try {
        text = await this.api.readFile(path);
      } catch {
        continue;
      }
      if (text === s.savedText) continue;
      if (s.dirty) {
        clearTimeout(this.timers.get(path));
        s.status = { kind: 'conflict' };
      } else {
        const reloaded = this.load(path, text);
        this.sessions.set(path, s.text !== null ? { ...reloaded, text } : reloaded);
      }
    }
    this.changed();
  }

  // The projects' settings changed: re-read open pages that have no unsaved edits, so
  // they follow the new settings (pages with edits keep how they were read).
  updateProject(project: ProjectInfo) {
    this.project = { ...project, files: this.project.files, titles: this.project.titles };
    for (const [path, s] of this.sessions) {
      if (!s.dirty) this.sessions.set(path, { ...this.load(path, s.savedText, s.eol), text: s.text });
    }
    this.changed();
  }

  // Resolve a conflict by taking the version on disk.
  async reload(path: string) {
    const text = await this.api.readFile(path);
    const prev = this.sessions.get(path);
    const wasText = !!prev && prev.text !== null;
    const reloaded = this.load(path, text);
    this.sessions.set(path, wasText ? { ...reloaded, text } : reloaded);
    this.changed();
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.listeners.clear();
  }
}
