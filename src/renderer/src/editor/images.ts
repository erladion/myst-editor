// Pictures pasted or dropped into a page: saved next to it and put in the text.
import { insertPoint } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../../../core/schema';
import type { EditorContext } from './context';

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

// The images among pasted or dropped files.
export function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/') || IMAGE.test(f.name));
}

// Save the files and put them in the page at `pos` (or the nearest place an image
// can go: a new paragraph between blocks).
export async function insertImages(view: EditorView, ctx: EditorContext, files: File[], pos: number) {
  const srcs: string[] = [];
  for (const file of files) {
    try {
      srcs.push(await ctx.addImage(file));
    } catch (e) {
      ctx.ui.notify(`Couldn’t add ${file.name || 'the image'}: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    }
  }
  if (!srcs.length || view.isDestroyed) return;
  const images = srcs.map((src) => schema.nodes.image.create({ src, alt: '' }));
  const { state } = view;
  const at = Math.min(pos, state.doc.content.size);
  const inline = insertPoint(state.doc, at, schema.nodes.image);
  const tr =
    inline !== null && state.doc.resolve(inline).parent.inlineContent
      ? state.tr.insert(inline, images)
      : state.tr.insert(insertPoint(state.doc, at, schema.nodes.paragraph) ?? state.doc.content.size, schema.nodes.paragraph.create(null, images));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

// EditorView props: paste a picture (when there's no text with it: copying from a web
// page or a document brings both, and then the text is what's wanted), or drop files.
export function imageInput(ctx: EditorContext) {
  return {
    handlePaste(view: EditorView, event: ClipboardEvent) {
      const files = imageFiles(event.clipboardData);
      if (!files.length || event.clipboardData?.getData('text/plain')) return false;
      void insertImages(view, ctx, files, view.state.selection.from);
      return true;
    },
    handleDrop(view: EditorView, event: DragEvent) {
      const files = imageFiles(event.dataTransfer);
      if (!files.length) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
      void insertImages(view, ctx, files, pos);
      return true;
    },
  };
}
