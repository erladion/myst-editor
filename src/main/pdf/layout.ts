// What the PDF export does to the one-page build (mysteditor_build.py --pdf) before
// Chromium prints it: a cover, one table of contents, each chapter on a new page,
// headers and footers ([pdf] in .mysteditor.toml), and links that work in a single
// document. Runs in the page, as a script.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAPER_MM, PDF_MARGIN_MM, type CoverPart, type CoverPlace, type PaperSize } from '../../core/editor-config.js';

export interface LayoutOptions {
  rootDoc: string;
  paper: PaperSize;
  title: string | null; // the cover's; null: the root page's title
  subtitle: string;
  note: string;
  coverLogo: string | null; // a data: URL
  coverBackground: string | null; // a data: URL, filling the cover page
  coverColor: string | null;
  coverImages: { src: string; x: number; y: number; width: number; height: number | null }[]; // mm from the top left
  coverPlaces: Partial<Record<CoverPart, CoverPlace>>; // parts moved from their usual places
  marginLogo: string | null; // a data: URL of an SVG sized for the margins
  header: [string, string, string];
  footer: [string, string, string];
  // Font families (CSS lists, with fallbacks), and @font-face rules for the project's
  // font files.
  fonts: { text: string; heading: string; code: string; faces: string };
  headersOn: 'numbered' | 'not-cover' | 'all';
  numbering: 'content' | 'cover';
  tocDepth: number; // levels of the contents: 1 is chapters only
  date: string;
  project: string;
  variables: Record<string, string>; // other {name}s: from conf.py, and [pdf.variables]
}

const MARGIN = PDF_MARGIN_MM;

// Returns each heading's text in order (the PDF's outline has the same) and which of
// them starts the first chapter. Leaves window.__pdfNumber(pages) to write the
// contents' page numbers, and window.__pdfMargins(pages) to draw the margins with
// the number of pages known.
export const layoutScript = (opts: LayoutOptions) => `
(async (opts) => {
  const main = document.querySelector('[role="main"]') || document.body;
  // What the website puts around the content (a template's banner, header or footer)
  // isn't printed: anything before the cover would take a page of its own.
  for (let el = main; el !== document.body && el.parentElement; el = el.parentElement) {
    for (const other of el.parentElement.children) if (other !== el) other.classList.add('pdf-hidden');
  }
  const isMarker = (el) => el && el.tagName === 'SPAN' && el.id.startsWith('document-');
  // The page (document) an element came from: the section after a document-… marker.
  const docOf = (el) => {
    for (let s = el.closest('section'); s; s = s.parentElement && s.parentElement.closest('section')) {
      if (isMarker(s.previousElementSibling)) return s.previousElementSibling.id.slice('document-'.length);
    }
    return opts.rootDoc;
  };
  const depth = (el) => {
    let d = 0;
    for (let x = el; x && x !== main; x = x.parentElement) if (x.tagName === 'SECTION') d++;
    return d;
  };
  const headingOf = (s) => [...s.children].find((c) => /^H[1-6]$/.test(c.tagName));
  const textOf = (el) => el.textContent.replace(/\\s+/g, ' ').trim();

  for (const a of main.querySelectorAll('a.headerlink')) a.remove();

  // Ids are unique within a page, not across pages: later ones get a number.
  const ids = new Map(); // "doc#id" → the id now
  const taken = new Set([...main.querySelectorAll('[id^="document-"]')].map((m) => m.id));
  for (const el of main.querySelectorAll('[id]')) {
    if (isMarker(el)) continue;
    const old = el.id;
    let id = old;
    for (let n = 2; taken.has(id); n++) id = old + '-' + n;
    taken.add(id);
    ids.set(docOf(el) + '#' + old, id);
    el.id = id;
  }
  // Links to other pages are written "#document-<page>#<id>" (or "#document-<page>").
  for (const a of main.querySelectorAll('a[href^="#"]')) {
    const href = decodeURIComponent(a.getAttribute('href').slice(1));
    const m = /^document-([^#]+)(?:#(.+))?$/.exec(href);
    const page = m && document.getElementById('document-' + m[1]);
    const start = page && page.nextElementSibling && page.nextElementSibling.id ? page.nextElementSibling.id : 'document-' + (m && m[1]);
    const target = m ? (m[2] ? ids.get(m[1] + '#' + m[2]) || m[2] : start) : ids.get(docOf(a) + '#' + href) || href;
    a.setAttribute('href', '#' + target);
  }

  const sections = [...main.querySelectorAll('section')];
  const root = sections.find((s) => depth(s) === 1);
  // Chapters: the pages in the root page's contents, each from a new PDF page, on a
  // page style of its own (for {chapter} in the margins).
  const chapters = sections.filter((s) => depth(s) === 2 && isMarker(s.previousElementSibling) && headingOf(s));
  chapters.forEach((s, i) => {
    s.classList.add('pdf-chapter');
    s.style.page = 'pdf-c' + i;
  });
  const numbering = chapters.length ? opts.numbering : 'cover';

  // Sphinx's documentation_options.js declares it with const: not on window.
  const version = (typeof DOCUMENTATION_OPTIONS !== 'undefined' && DOCUMENTATION_OPTIONS.VERSION) || '';
  const h1 = root && headingOf(root);
  let manual = opts.title || (h1 ? textOf(h1) : document.title.trim());
  // The PDF's own placeholders, then the project's variables; anything else is left as written.
  const fill = (text, chapter) =>
    text.replace(/\\{(\\w+)\\}/g, (all, name) => {
      const own = { title: manual, date: opts.date, version, project: opts.project, chapter: chapter || '' };
      return Object.hasOwn(own, name) ? own[name] : Object.hasOwn(opts.variables, name) ? opts.variables[name] : all;
    });
  // The title may say {version} or {date} too.
  manual = fill(manual);

  // The cover: the logo, the title, the subtitle and a note at its foot. The root
  // page's title is taken out of the outline, so chapters are its top level.
  const cover = document.createElement('div');
  cover.className = 'pdf-title';
  cover.style.page = 'pdf-cover';
  const paper = opts.paperSize;
  // A part moved from its usual place: where it was put, in mm from the page's corner.
  // (The title's box holds the subtitle too, unless that's been moved by itself; its
  // size is the title's own.)
  const place = (el, part, sized = el) => {
    const at = opts.coverPlaces[part];
    if (!at) return;
    Object.assign(el.style, { position: 'absolute', margin: '0', left: at.x + 'mm', top: at.y + 'mm' });
    if (part === 'logo') {
      if (at.width != null) Object.assign(el.style, { width: at.width + 'mm', maxWidth: 'none', maxHeight: 'none', height: 'auto' });
    } else {
      el.style.width = (at.width ?? paper.width - at.x - ${MARGIN.side}) + 'mm';
      if (at.size != null) sized.style.fontSize = at.size + 'pt';
      if (at.align) el.style.textAlign = at.align;
    }
  };
  if (opts.coverLogo) {
    const img = document.createElement('img');
    img.className = 'pdf-cover-logo';
    img.src = opts.coverLogo;
    place(img, 'logo');
    cover.append(img);
  }
  const text = (cls, content) => {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = content;
    return div;
  };
  const block = document.createElement('div');
  block.className = 'pdf-title-block';
  const title = text('pdf-title-text', manual);
  const subtitle = text('pdf-subtitle', fill(opts.subtitle));
  block.append(title);
  if (opts.coverPlaces.subtitle) {
    place(subtitle, 'subtitle');
    subtitle.style.marginTop = '0';
  } else block.append(subtitle);
  place(block, 'title', title);
  const note = text('pdf-note', fill(opts.note));
  place(note, 'note');
  cover.append(block, ...(opts.coverPlaces.subtitle ? [subtitle] : []), note);
  Object.assign(cover.style, { width: paper.width + 'mm', height: paper.height + 'mm', padding: '${MARGIN.top}mm ${MARGIN.side}mm ${MARGIN.bottom}mm' });
  if (opts.coverBackground) cover.style.backgroundImage = 'url("' + opts.coverBackground + '")';
  if (opts.coverColor) {
    cover.style.color = opts.coverColor;
    cover.classList.add('pdf-title-colored');
  }
  for (const g of opts.coverImages) {
    const img = document.createElement('img');
    img.className = 'pdf-cover-image';
    img.src = g.src;
    Object.assign(img.style, { left: g.x + 'mm', top: g.y + 'mm', width: g.width + 'mm', height: g.height == null ? 'auto' : g.height + 'mm' });
    cover.append(img);
  }
  if (h1) h1.remove();

  // The contents: links to sections, with room for page numbers (filled in after a
  // first print, without changing the layout).
  const toc = document.createElement('nav');
  toc.className = 'pdf-toc';
  toc.style.page = 'pdf-front';
  toc.innerHTML = '<div class="pdf-toc-title">Contents</div>';
  const entries = [];
  for (const s of sections) {
    const level = depth(s) - 1;
    const h = headingOf(s);
    if (level < 1 || level > opts.tocDepth || !h || !s.id) continue;
    const a = document.createElement('a');
    a.className = 'pdf-toc-entry pdf-toc-l' + level;
    a.href = '#' + s.id;
    a.innerHTML = '<span class="pdf-toc-text"></span><span class="pdf-toc-dots"></span><span class="pdf-toc-page"></span>';
    a.firstChild.textContent = textOf(h);
    toc.append(a);
    entries.push({ a, h });
  }
  // The root page's own text, before the chapters, goes with the front pages.
  for (const el of root ? root.children : []) {
    if (chapters.some((c) => el === c || el.contains(c))) break;
    el.style.page = 'pdf-front';
  }
  // The markers between pages (links now go to the pages' sections): on no page
  // style of their own, they'd each get a blank page.
  for (const m of main.querySelectorAll('[id^="document-"]')) if (isMarker(m)) m.style.display = 'none';
  main.prepend(cover, toc);

  // Headers and footers: CSS page margin boxes (the cover has no margins: drawn on it,
  // when it has them). With numbering from the content, the front pages aren't counted
  // or numbered, and slots with {page} or {pages} stay empty there.
  const style = document.createElement('style');
  document.head.append(style);
  const str = (t) => '"' + t.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\A ') + '"';
  const content = (template, chapter, pages) => {
    const parts = [];
    for (const piece of template.split(/(\\{(?:page|pages|logo)\\})/)) {
      if (piece === '{page}') parts.push('counter(page)');
      else if (piece === '{pages}') parts.push(pages == null ? 'counter(pages)' : str(String(pages)));
      else if (piece === '{logo}') opts.marginLogo && parts.push('url("' + opts.marginLogo + '")');
      else if (piece) parts.push(str(fill(piece, chapter)));
    }
    return parts.length ? parts.join(' ') : 'none';
  };
  const SLOTS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  const box = 'font-family: ' + opts.fonts.text + '; font-size: 8.5pt; color: #57606a;';
  const templates = [...opts.header, ...opts.footer];
  const counts = (template) => /\\{pages?\\}/.test(template);
  const boxes = (chapter, pages, unnumbered) =>
    SLOTS.map((slot, i) => '@' + slot + ' { content: ' + (unnumbered && counts(templates[i]) ? 'none' : content(templates[i], chapter, pages)) + '; ' + box + ' }').join(' ');
  const blank = SLOTS.map((slot) => '@' + slot + ' { content: none; }').join(' ');
  const skip = numbering === 'content' ? 'counter-increment: page 0; ' : '';

  // The cover's, drawn on it: its page has no margins (for its background).
  const coverSlots = [];
  if (opts.headersOn === 'all') {
    for (const row of ['top', 'bottom']) {
      const div = document.createElement('div');
      div.className = 'pdf-cover-margin pdf-cover-' + row;
      for (let i = 0; i < 3; i++) coverSlots.push(div.appendChild(document.createElement('span')));
      cover.append(div);
    }
  }
  const drawCover = (pages) =>
    coverSlots.forEach((span, i) => {
      span.replaceChildren();
      if (numbering === 'content' && counts(templates[i])) return;
      for (const piece of templates[i].split(/(\\{(?:page|pages|logo)\\})/)) {
        if (piece === '{logo}') {
          if (!opts.marginLogo) continue;
          const img = document.createElement('img');
          img.src = opts.marginLogo;
          span.append(img);
        } else if (piece) span.append(piece === '{page}' ? '1' : piece === '{pages}' ? (pages == null ? '' : String(pages)) : fill(piece, ''));
      }
    });

  window.__pdfMargins = (pages) => {
    let css = '@page { size: ' + opts.paper + '; margin: ${MARGIN.top}mm ${MARGIN.side}mm ${MARGIN.bottom}mm; ' + boxes('', pages, false) + ' }';
    css += ' @page pdf-cover { margin: 0; ' + skip + blank + ' }';
    const front = numbering === 'content' ? (opts.headersOn === 'numbered' ? blank : boxes('', pages, true)) : boxes('', pages, false);
    css += ' @page pdf-front { ' + skip + front + ' }';
    chapters.forEach((s, i) => (css += ' @page pdf-c' + i + ' { ' + boxes(textOf(headingOf(s)), pages, false) + ' }'));
    style.textContent = css;
    drawCover(pages);
  };
  window.__pdfMargins(null);

  // Fonts: the project's files, and the families chosen.
  const faces = document.createElement('style');
  faces.textContent = opts.fonts.faces;
  document.head.append(faces);
  const vars = document.documentElement.style;
  vars.setProperty('--pdf-font', opts.fonts.text);
  vars.setProperty('--pdf-heading-font', opts.fonts.heading);
  vars.setProperty('--pdf-code-font', opts.fonts.code);

  // Everything loaded: images (lazy ones too), fonts and math.
  for (const img of document.images) img.loading = 'eager';
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  if (window.MathJax && MathJax.startup && MathJax.startup.promise) await Promise.race([MathJax.startup.promise, new Promise((r) => setTimeout(r, 15000))]);

  const headings = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.getClientRects().length);
  window.__pdfNumber = (pages) => {
    for (const { a, h } of entries) {
      const page = pages[headings.indexOf(h)];
      a.lastChild.textContent = page > 0 ? String(page) : '';
    }
  };
  return {
    headings: headings.map(textOf),
    firstChapter: numbering === 'content' ? headings.indexOf(headingOf(chapters[0])) : -1,
  };
})(${JSON.stringify({ ...opts, paperSize: PAPER_MM[opts.paper] })})
`;

// The fonts when none are chosen.
export const TEXT_FONTS = '"Noto Sans", "Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
export const CODE_FONTS = '"DejaVu Sans Mono", "Liberation Mono", Consolas, monospace';

// A stylesheet's references to other files (fonts, images, stylesheets), relative to
// `dir`, as file: URLs: it's added to the page as text, which has no place of its own
// to resolve them against.
export function cssWithFileUrls(css: string, dir: string): string {
  const absolute = (ref: string) => (/^([a-z][\w+.-]*:|#|\/)/i.test(ref) ? ref : pathToFileURL(join(dir, ref)).href);
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, q: string, ref: string) => `url(${q}${absolute(ref.trim())}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/g, (_m, q: string, ref: string) => `@import ${q}${absolute(ref)}${q}`);
}

export const PRINT_CSS = `
:root { --pdf-font: ${TEXT_FONTS}; --pdf-heading-font: var(--pdf-font); --pdf-code-font: ${CODE_FONTS}; }
html { font-size: 10.5pt; }
body {
  margin: 0;
  font-family: var(--pdf-font);
  color: #1f2328;
  background: #fff;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pdf-hidden, div.related, div.sphinxsidebar, div.footer, div.clearer, a.headerlink, #searchbox, nav.contents, div.contents.local { display: none !important; }
div.document, div.documentwrapper, div.bodywrapper, div.body {
  margin: 0 !important; padding: 0 !important; float: none !important; width: auto !important; max-width: none !important; min-width: 0 !important;
}
h1, h2, h3, h4, h5, h6, .pdf-title-text, .pdf-toc-title { font-family: var(--pdf-heading-font); }
h1, h2, h3, h4, h5, h6 { font-weight: 650; line-height: 1.25; margin: 1.4em 0 0.5em; break-after: avoid; }
h1, h2 { font-size: 1.9em; }
h3 { font-size: 1.4em; }
h4 { font-size: 1.15em; }
h5, h6 { font-size: 1em; }
section.pdf-chapter { break-before: page; }
section.pdf-chapter > :is(h1, h2, h3):first-of-type { margin-top: 0; }
p, li, dd { orphans: 3; widows: 3; }
a { color: #0b57d0; text-decoration: none; }
code, pre, kbd, samp { font-family: var(--pdf-code-font); font-size: 0.88em; }
code.literal { background: #f2f3f5; border-radius: 3px; padding: 0.05em 0.3em; }
div.highlight { background: #f6f8fa !important; border: 1px solid #e3e6ea; border-radius: 6px; margin: 0.8em 0; }
pre { margin: 0; padding: 0.7em 0.9em; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; background: transparent !important; border: 0 !important; }
img { max-width: 100%; height: auto; }
figure, div.figure { break-inside: avoid; margin: 1em 0; }
figcaption, .caption { color: #57606a; font-size: 0.92em; }
table.docutils { border-collapse: collapse; margin: 0.8em 0 !important; max-width: 100%; }
table.docutils th, table.docutils td { border: 1px solid #d0d7de !important; padding: 0.35em 0.6em; vertical-align: top; text-align: left; }
table.docutils th { background: #f2f4f7; }
table.docutils td > p, table.docutils th > p { margin: 0; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
div.admonition, aside.admonition { margin: 0.9em 0; padding: 0.6em 0.9em; border-left: 4px solid #8c959f; background: #f6f8fa; border-radius: 4px; break-inside: avoid; }
.admonition p.admonition-title { font-weight: 650; margin: 0 0 0.3em; }
.admonition > :last-child { margin-bottom: 0; }
.admonition.note, .admonition.seealso, .admonition.important { border-color: #0969da; background: #eef5ff; }
.admonition.tip, .admonition.hint { border-color: #1a7f37; background: #eefbf1; }
.admonition.warning, .admonition.caution, .admonition.attention { border-color: #bf8700; background: #fff8e5; }
.admonition.danger, .admonition.error { border-color: #cf222e; background: #fff0f0; }
dl dt { font-weight: 600; }

.pdf-title { break-after: page; display: flex; flex-direction: column; position: relative; box-sizing: border-box; overflow: hidden; background: center / cover no-repeat; }
.pdf-cover-image { position: absolute; }
.pdf-cover-margin { position: absolute; left: 0; right: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; padding: 0 ${PDF_MARGIN_MM.side}mm; font-family: var(--pdf-font); font-size: 8.5pt; color: #57606a; }
.pdf-cover-top { top: 0; height: ${PDF_MARGIN_MM.top}mm; }
.pdf-cover-bottom { bottom: 0; height: ${PDF_MARGIN_MM.bottom}mm; }
.pdf-cover-margin span:nth-child(2) { text-align: center; }
.pdf-cover-margin span:nth-child(3) { text-align: right; }
.pdf-cover-margin img { height: 8mm; vertical-align: middle; }
.pdf-title-colored .pdf-cover-margin { color: inherit; opacity: 0.85; }
.pdf-title-colored .pdf-subtitle, .pdf-title-colored .pdf-note { color: inherit; opacity: 0.85; }
.pdf-cover-logo { align-self: flex-start; max-height: 28mm; max-width: 90mm; }
.pdf-title-block { margin-top: auto; }
.pdf-title-text { font-size: 30pt; font-weight: 700; line-height: 1.15; }
.pdf-subtitle { color: #57606a; margin-top: 6mm; font-size: 12pt; }
.pdf-note { margin-top: auto; color: #57606a; font-size: 9pt; white-space: pre-line; }
.pdf-subtitle:empty, .pdf-note:empty { display: none; }
.pdf-toc { break-after: page; }
.pdf-toc-title { font-size: 1.9em; font-weight: 650; margin-bottom: 0.8em; }
.pdf-toc-entry { display: flex; align-items: baseline; color: inherit; margin: 0.22em 0; break-inside: avoid; }
.pdf-toc-l1 { font-weight: 600; margin-top: 0.7em; }
.pdf-toc-l2 { padding-left: 1.5em; }
.pdf-toc-l3 { padding-left: 3em; }
.pdf-toc-dots { flex: 1; min-width: 1.5em; margin: 0 0.4em; border-bottom: 1px dotted #8c959f; transform: translateY(-0.3em); }
.pdf-toc-page { flex: none; width: 2.6em; text-align: right; font-variant-numeric: tabular-nums; }
`;
