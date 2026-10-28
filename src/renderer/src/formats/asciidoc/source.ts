// AsciiDoc in the source view: titles, delimiters, attribute entries and lines,
// lists, comments and code, and inline formatting, links, cross-references and
// attribute references; highlighted as the view's other syntax is (by tag).
import { StreamLanguage, type StringStream } from '@codemirror/language';
import type { SourceSyntax } from '../editing';

interface State {
  verbatim: string | null; // inside a block whose content isn't AsciiDoc: its delimiter
  comment: boolean; // that block is a comment
}

const DELIMITER = /^(-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,}|--|[|!,:]={3,}|`{3,}[\w+#.-]*)[ \t]*$/;
// Delimiters of blocks of literal text (code, literal, passthrough, comment).
const VERBATIM = /^(-{4,}|\.{4,}|\+{4,}|\/{4,}|`{3,})/;

function lineStart(stream: StringStream, state: State): string | null {
  const line = stream.string;
  const delimiter = DELIMITER.exec(line)?.[1];
  if (delimiter) {
    stream.skipToEnd();
    if (VERBATIM.test(delimiter)) {
      const fence = /^`+/.exec(delimiter)?.[0] ?? delimiter;
      state.verbatim = fence;
      state.comment = fence.startsWith('/');
    }
    return 'contentSeparator';
  }
  const heading = /^(={1,6})[ \t]+\S/.exec(line);
  if (heading) {
    stream.skipToEnd();
    return `heading${heading[1].length}`;
  }
  if (/^\/\//.test(line)) {
    stream.skipToEnd();
    return 'comment';
  }
  if (/^\[.*\][ \t]*$/.test(line) || /^(ifdef|ifndef|ifeval|endif|include|image|toc|video|audio)::/.test(line)) {
    stream.skipToEnd();
    return 'processingInstruction';
  }
  if (/^\.[^\s.]/.test(line)) {
    stream.skipToEnd();
    return 'heading6';
  }
  if (stream.match(/^:!?[\w][\w-]*!?:/)) return 'meta';
  if (stream.match(/^[ \t]*(\*{1,5}|-|\.{1,5}|\d+\.|<\d+>)(?=[ \t])/)) return 'processingInstruction';
  if (stream.match(/^(NOTE|TIP|IMPORTANT|CAUTION|WARNING):(?=[ \t])/)) return 'strong';
  return null;
}

function inline(stream: StringStream): string | null {
  if (stream.match(/^\*\*[^*\n]+\*\*/) || stream.match(/^\*[^\s*][^*\n]*\*(?!\w)/)) return 'strong';
  if (stream.match(/^__[^_\n]+__/) || stream.match(/^_[^\s_][^_\n]*_(?!\w)/)) return 'emphasis';
  if (stream.match(/^``[^`\n]+``/) || stream.match(/^`[^\s`][^`\n]*`/)) return 'monospace';
  if (stream.match(/^#[^\s#][^#\n]*#/)) return 'strong';
  if (stream.match(/^<<[^>\n]+>>/) || stream.match(/^xref:[^\s[]*\[[^\]\n]*\]/)) return 'link';
  if (stream.match(/^(https?|ftp|irc|mailto):[^\s[\]<]+(\[[^\]\n]*\])?/) || stream.match(/^link:[^\s[]+\[[^\]\n]*\]/)) return 'url';
  if (stream.match(/^\{[\w][\w-]*\}/)) return 'meta';
  if (stream.match(/^(image|kbd|btn|menu|footnote|pass|stem|latexmath):[^\s[]*\[[^\]\n]*\]/)) return 'processingInstruction';
  if (stream.match(/^ \+$/)) return 'processingInstruction';
  stream.next();
  stream.eatWhile(/[^*_`#<{\s\\a-z]/);
  return null;
}

const asciidoc = StreamLanguage.define<State>({
  name: 'asciidoc',
  startState: () => ({ verbatim: null, comment: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.verbatim) {
      if (stream.sol() && stream.string.trimEnd() === state.verbatim) {
        stream.skipToEnd();
        state.verbatim = null;
        return 'contentSeparator';
      }
      stream.skipToEnd();
      return state.comment ? 'comment' : 'monospace';
    }
    if (stream.sol()) {
      const style = lineStart(stream, state);
      if (style) return style;
    }
    return inline(stream);
  },
});

export const asciidocSource: SourceSyntax = {
  label: 'AsciiDoc',
  extensions: () => [asciidoc],
  image: (path) => `image:${path}[]`,
};
