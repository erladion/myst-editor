// MyST in the Markdown view: CommonMark highlighting, and marks for MyST's own syntax.
import { markdown } from '@codemirror/lang-markdown';
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SourceSyntax } from '../editing';

// MyST syntax CommonMark highlighting doesn't know: {roles} and {directive} names,
// directive :options:, and (label)= targets.
function mystMarks(regexp: RegExp, cls: string) {
  const decorator = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = decorator.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const mystSource: SourceSyntax = {
  label: 'Markdown',
  extensions: () => [markdown(), mystMarks(/\{[\w:.-]+\}/g, 'cm-myst-name'), mystMarks(/^\s*:[\w.-]+:/g, 'cm-myst-option'), mystMarks(/^\([^()\s]+\)=\s*$/g, 'cm-myst-target')],
  image: (path) => `![](${path})`,
};
