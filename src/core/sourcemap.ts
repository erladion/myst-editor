// Original source text for the blocks of a parsed document.
import type { Node as PMNode } from 'prosemirror-model';

export interface ContainerEntry {
  lead: string; // text before the first child
  trail: string; // text after the last child
}

export interface SourceEntry {
  node: PMNode; // the node as originally parsed
  text: string; // its exact original source
  container?: ContainerEntry; // set for nodes whose children were parsed from inner text
  next?: string; // sid of the sibling that originally followed this node
  gap?: string; // original text between this node and `next`
}

// How the document writes inline syntax, so edited paragraphs match their surroundings.
export interface InlineStyle {
  em: '*' | '_';
  strong: '**' | '__';
  refs: Map<string, { label: string; title: string | null }>; // normalized URL -> reference definition
  autolinks: Set<string>; // URLs the document writes as <url>
}

// Shared by all maps, so nodes from separate parses never collide and a map can
// absorb another (e.g. when the writer edits a block's source and it is re-parsed).
let counter = 0;

export class SourceMap {
  private entries = new Map<string, SourceEntry>();
  root: ContainerEntry = { lead: '', trail: '' };
  style: InlineStyle = { em: '*', strong: '**', refs: new Map(), autolinks: new Set() };

  nextSid(): string {
    return `s${++counter}`;
  }

  merge(other: SourceMap) {
    for (const [sid, entry] of other.entries) this.entries.set(sid, entry);
  }

  record(sid: string, node: PMNode, text: string, container?: ContainerEntry) {
    this.entries.set(sid, { ...this.entries.get(sid), node, text, container });
  }

  newContainer(lead: string, trail: string): ContainerEntry {
    return { lead, trail };
  }

  link(prev: string, next: string, gap: string) {
    const e = this.entries.get(prev);
    if (e) Object.assign(e, { next, gap });
  }

  get(sid: string | null | undefined): SourceEntry | undefined {
    return sid ? this.entries.get(sid) : undefined;
  }

  // The original source of `node`, if it is unchanged since parsing.
  unchanged(node: PMNode): string | undefined {
    const e = this.get(node.attrs.sid);
    if (e && (e.node === node || e.node.eq(node))) return e.text;
    return undefined;
  }

  // The original gap between two siblings, if they were adjacent originally.
  gapBetween(a: PMNode, b: PMNode): string | undefined {
    const e = this.get(a.attrs.sid);
    return e && e.next && e.next === b.attrs.sid ? e.gap : undefined;
  }
}
