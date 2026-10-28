// AsciiDoc in the source view: titles, delimiters and attribute lines picked out.
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SourceSyntax } from '../editing';

function marks(regexp: RegExp, cls: string) {
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

export const asciidocSource: SourceSyntax = {
  label: 'AsciiDoc',
  extensions: () => [
    marks(/^(={1,6}|#{1,6})[ \t].*$/gm, 'cm-adoc-title'),
    marks(/^(-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,}|--|\|===)[ \t]*$|^\[.*\][ \t]*$|^:!?[\w-]+!?:/gm, 'cm-myst-option'),
    marks(/\{[\w-]+\}|\b[a-z]+:{1,2}[^\s[]*\[/g, 'cm-myst-name'),
    marks(/\[\[[^\]]+\]\]|<<[^>]+>>/g, 'cm-myst-target'),
  ],
  image: (path) => `image:${path}[]`,
};
