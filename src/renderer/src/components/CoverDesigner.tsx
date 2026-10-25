// The PDF's cover in Project Settings: a preview at scale, with its background, logo,
// texts and graphics. Graphics, and the logo and texts, are placed by dragging them on
// the preview (or with the arrow keys), or by their numbers (mm from the page's
// top-left corner); a part that's never moved stays in its usual place.
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { COVER_PARTS, PAPER_MM, PDF_MARGIN_MM, type CoverPart, type CoverPlace, type PaperSize } from '../../../core/editor-config';
import { ASSET_SCHEME } from '../../../shared/api';

export interface CoverGraphic {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export interface CoverForm {
  paper: string;
  logo: string;
  title: string;
  subtitle: string;
  note: string;
  coverBackground: string;
  coverColor: string;
  coverImages: CoverGraphic[];
  cover: Partial<Record<CoverPart, CoverPlace>>;
}

const PART_NAMES: Record<CoverPart, string> = { logo: 'Logo', title: 'Title', subtitle: 'Under the title', note: 'At the foot' };
const USUAL_SIZE: Record<Exclude<CoverPart, 'logo'>, number> = { title: 30, subtitle: 12, note: 9 }; // pt

// A path relative to the settings file, as one relative to the opened folder.
export function fromSettings(settingsFile: string, path: string): string | null {
  if (!path || /^([a-z]:)?[\\/]/i.test(path)) return null;
  const out: string[] = [];
  for (const part of [...settingsFile.split('/').slice(0, -1), ...path.split(/[\\/]/)]) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const PREVIEW_WIDTH = 210; // px
const PT = 0.3528; // mm

interface Props<F extends CoverForm> {
  form: F;
  settingsFile: string;
  onChange: (form: F) => void;
  chooseImage: () => Promise<string | null>;
  titleFont: string | null; // the cover title's font family
}

export function CoverDesigner<F extends CoverForm>({ form, settingsFile, onChange, chooseImage, titleFont }: Props<F>) {
  const set = <K extends keyof CoverForm>(key: K, value: F[K]) => onChange({ ...form, [key]: value });
  const page = PAPER_MM[(form.paper as PaperSize) in PAPER_MM ? (form.paper as PaperSize) : 'A4'];
  const mm = PREVIEW_WIDTH / page.width; // px per mm
  const asset = (path: string) => {
    const rel = fromSettings(settingsFile, path.trim());
    return rel ? `${ASSET_SCHEME}://project/${rel.split('/').map(encodeURIComponent).join('/')}` : null;
  };
  const background = asset(form.coverBackground);
  const logo = asset(form.logo);
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const sample = (text: string) => text.replace(/\{date\}/g, today).replace(/\{version\}/g, '1.0').replace(/\{title\}/g, form.title || 'Title');

  const place = (i: number, change: Partial<CoverGraphic>) => set('coverImages', form.coverImages.map((g, k) => (k === i ? { ...g, ...change } : g)) as F['coverImages']);
  const setPart = (part: CoverPart, at: CoverPlace | null) => {
    const cover = { ...form.cover };
    if (at) cover[part] = at;
    else delete cover[part];
    set('cover', cover as F['cover']);
  };
  const round = (n: number) => Math.round(n);
  const previewRef = useRef<HTMLDivElement>(null);

  // What's dragged or nudged: a graphic, or a part of the cover.
  type Target = { graphic: number } | { part: CoverPart };
  const where = (t: Target, el: HTMLElement): { x: number; y: number } => {
    if ('graphic' in t) return form.coverImages[t.graphic];
    const at = form.cover[t.part];
    if (at) return at;
    // Not moved yet: where it is now, in its usual place.
    const r = el.getBoundingClientRect();
    const preview = previewRef.current!;
    const p = preview.getBoundingClientRect();
    // From inside the preview's border, where its mm start.
    return { x: round((r.left - p.left - preview.clientLeft) / mm), y: round((r.top - p.top - preview.clientTop) / mm) };
  };
  const moveTo = (t: Target, x: number, y: number) => {
    if ('graphic' in t) place(t.graphic, { x, y });
    else setPart(t.part, { width: null, size: null, align: null, ...form.cover[t.part], x, y });
  };
  const drag = useRef<{ t: Target; x: number; y: number; gx: number; gy: number } | null>(null);
  const down = (t: Target) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation(); // the subtitle, not the title's box around it
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const at = where(t, e.currentTarget);
    drag.current = { t, x: e.clientX, y: e.clientY, gx: at.x, gy: at.y };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = round(d.gx + (e.clientX - d.x) / mm);
    const y = round(d.gy + (e.clientY - d.y) / mm);
    // A part only leaves its usual place once it's really moved, not on a click.
    if ('part' in d.t && !form.cover[d.t.part] && x === d.gx && y === d.gy) return;
    moveTo(d.t, x, y);
  };
  const up = () => (drag.current = null);
  const nudge = (t: Target) => (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    const at = where(t, e.currentTarget);
    moveTo(t, at.x + d[0], at.y + d[1]);
  };
  // Dragging and nudging, for an element of the preview.
  const movable = (t: Target, label: string) => ({
    tabIndex: 0,
    'aria-label': label,
    title: 'Drag to place it (or use the arrow keys)',
    onPointerDown: down(t),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
    onKeyDown: nudge(t),
  });
  // A moved part's place in the preview: as layout.ts puts it in the PDF.
  const partStyle = (part: CoverPart, usual: CSSProperties): CSSProperties => {
    const at = form.cover[part];
    if (!at) return usual;
    const placed: CSSProperties = { ...usual, position: 'absolute', margin: 0, left: at.x * mm, top: at.y * mm };
    if (part === 'logo') return at.width != null ? { ...placed, width: at.width * mm, maxWidth: 'none', maxHeight: 'none', height: 'auto' } : placed;
    return {
      ...placed,
      width: (at.width ?? page.width - at.x - PDF_MARGIN_MM.side) * mm,
      ...(at.size != null ? { fontSize: at.size * PT * mm } : {}),
      ...(at.align ? { textAlign: at.align } : {}),
    };
  };
  const add = async () => {
    const file = await chooseImage();
    if (file) set('coverImages', [...form.coverImages, { file, x: PDF_MARGIN_MM.side, y: PDF_MARGIN_MM.top, width: 40, height: null }] as F['coverImages']);
  };
  const number = (label: string, value: number | null, change: (n: number | null) => void, optional = false, usual = 'auto') => (
    <input
      type="number"
      aria-label={label}
      value={value ?? ''}
      placeholder={optional ? usual : undefined}
      step={1}
      onChange={(e) => change(e.target.value === '' ? (optional ? null : 0) : Number(e.target.value))}
    />
  );

  const { fontSize: _titleSize, ...titleBlock } = partStyle('title', {});
  const subtitle = form.subtitle && (
    <div
      className="cover-preview-subtitle cover-preview-part"
      style={partStyle('subtitle', { fontSize: 12 * PT * mm, marginTop: form.cover.subtitle ? 0 : 6 * mm })}
      {...movable({ part: 'subtitle' }, 'Under the title')}
    >
      {sample(form.subtitle)}
    </div>
  );

  return (
    <div className="cover-designer">
      <div
        ref={previewRef}
        className="cover-preview"
        aria-label="The cover"
        style={{ width: PREVIEW_WIDTH, height: page.height * mm, backgroundImage: background ? `url("${background}")` : undefined, color: form.coverColor || undefined } as CSSProperties}
      >
        <div className="cover-preview-text" style={{ padding: `${PDF_MARGIN_MM.top * mm}px ${PDF_MARGIN_MM.side * mm}px ${PDF_MARGIN_MM.bottom * mm}px` }}>
          {logo && (
            <img
              className="cover-preview-part"
              src={logo}
              draggable={false}
              style={partStyle('logo', { maxHeight: 28 * mm, maxWidth: 90 * mm, alignSelf: 'flex-start' })}
              {...movable({ part: 'logo' }, 'The logo')}
            />
          )}
          {/* The title's box holds the subtitle too, unless that's been moved by itself. */}
          <div className="cover-preview-title-block cover-preview-part" style={titleBlock} {...movable({ part: 'title' }, 'The title')}>
            <div className="cover-preview-title" style={{ fontSize: (form.cover.title?.size ?? 30) * PT * mm, fontFamily: titleFont ? `${JSON.stringify(titleFont)}, sans-serif` : undefined }}>
              {form.title || 'The root page’s title'}
            </div>
            {!form.cover.subtitle && subtitle}
          </div>
          {form.cover.subtitle && subtitle}
          {form.note && (
            <div className="cover-preview-note cover-preview-part" style={partStyle('note', { fontSize: 9 * PT * mm })} {...movable({ part: 'note' }, 'At the foot')}>
              {sample(form.note)}
            </div>
          )}
        </div>
        {form.coverImages.map((g, i) => {
          const src = asset(g.file);
          return (
            src && (
              <img
                key={i}
                className="cover-preview-graphic"
                alt={`Graphic ${i + 1}`}
                src={src}
                draggable={false}
                style={{ left: g.x * mm, top: g.y * mm, width: g.width * mm, height: g.height == null ? 'auto' : g.height * mm }}
                {...movable({ graphic: i }, `Graphic ${i + 1}`)}
              />
            )
          );
        })}
      </div>

      <div className="cover-fields">
        <div className="field">
          <label htmlFor="pdf-title">Title</label>
          <input id="pdf-title" value={form.title} placeholder="The root page’s title" onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pdf-subtitle">Under the title</label>
          <input id="pdf-subtitle" value={form.subtitle} placeholder="Nothing" onChange={(e) => set('subtitle', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pdf-note">At the foot</label>
          <textarea id="pdf-note" rows={2} value={form.note} placeholder="Nothing, or a copyright line" onChange={(e) => set('note', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pdf-logo">Logo</label>
          <div className="row">
            <input id="pdf-logo" value={form.logo} spellCheck={false} placeholder="None" onChange={(e) => set('logo', e.target.value)} />
            <button type="button" aria-label="Choose the logo" onClick={() => void chooseImage().then((f) => f && set('logo', f))}>
              Choose…
            </button>
          </div>
          <small>Also wherever a header or footer says {'{logo}'}.</small>
        </div>
        <div className="field">
          <label htmlFor="pdf-background">Background</label>
          <div className="row">
            <input id="pdf-background" value={form.coverBackground} spellCheck={false} placeholder="None" onChange={(e) => set('coverBackground', e.target.value)} />
            <button type="button" aria-label="Choose the background" onClick={() => void chooseImage().then((f) => f && set('coverBackground', f))}>
              Choose…
            </button>
          </div>
          <small>Fills the page to its edges.</small>
        </div>
        <div className="field">
          <label htmlFor="pdf-cover-color">Text colour</label>
          <div className="row cover-color">
            <input id="pdf-cover-color" type="color" value={form.coverColor && /^#[0-9a-f]{6}$/i.test(form.coverColor) ? form.coverColor : '#1f2328'} onChange={(e) => set('coverColor', e.target.value)} />
            <span className="muted">{form.coverColor || 'The usual'}</span>
            {form.coverColor && (
              <button type="button" className="link-button" onClick={() => set('coverColor', '')}>
                Use the usual
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="field cover-places">
        <span className="field-label">Where things are</span>
        <div className="cover-places-list">
          <span />
          <span>x (mm)</span>
          <span>y (mm)</span>
          <span>width</span>
          <span>size (pt)</span>
          <span>align</span>
          <span />
          {COVER_PARTS.map((part) => {
            const at = form.cover[part];
            const name = PART_NAMES[part];
            return (
              <div key={part} className="cover-place-row">
                <span className="cover-place-name">{name}</span>
                {!at ? (
                  <span className="cover-place-usual muted">The usual place: drag it on the cover to move it</span>
                ) : (
                  <>
                    {number(`${name} x`, at.x, (n) => setPart(part, { ...at, x: n ?? 0 }))}
                    {number(`${name} y`, at.y, (n) => setPart(part, { ...at, y: n ?? 0 }))}
                    {number(`${name} width`, at.width, (n) => setPart(part, { ...at, width: n }), true)}
                    {part === 'logo' ? <span /> : number(`${name} size`, at.size, (n) => setPart(part, { ...at, size: n }), true, String(USUAL_SIZE[part]))}
                    {part === 'logo' ? (
                      <span />
                    ) : (
                      <select aria-label={`${name} alignment`} value={at.align ?? ''} onChange={(e) => setPart(part, { ...at, align: (e.target.value || null) as CoverPlace['align'] })}>
                        <option value="">left</option>
                        <option value="center">centre</option>
                        <option value="right">right</option>
                      </select>
                    )}
                    <button type="button" aria-label={`Put the ${name.toLowerCase()} back in its usual place`} title="Back to its usual place" onClick={() => setPart(part, null)}>
                      ↺
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field cover-graphics">
        <span className="field-label">Graphics</span>
        {form.coverImages.length > 0 && (
          <div className="cover-graphics-list">
            <span />
            <span>x (mm)</span>
            <span>y (mm)</span>
            <span>width</span>
            <span>height</span>
            <span />
            {form.coverImages.map((g, i) => (
              <div key={i} className="cover-graphic-row">
                <input aria-label={`Graphic ${i + 1}`} value={g.file} spellCheck={false} onChange={(e) => place(i, { file: e.target.value })} />
                {number(`Graphic ${i + 1} x`, g.x, (n) => place(i, { x: n ?? 0 }))}
                {number(`Graphic ${i + 1} y`, g.y, (n) => place(i, { y: n ?? 0 }))}
                {number(`Graphic ${i + 1} width`, g.width, (n) => place(i, { width: n ?? 0 }))}
                {number(`Graphic ${i + 1} height`, g.height, (n) => place(i, { height: n }), true)}
                <button type="button" aria-label={`Remove graphic ${i + 1}`} onClick={() => set('coverImages', form.coverImages.filter((_, k) => k !== i) as F['coverImages'])}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div>
          <button type="button" onClick={() => void add()}>
            Add a graphic…
          </button>
        </div>
        <small>Drag a graphic on the cover to place it. Positions are from the page’s top-left corner.</small>
      </div>
    </div>
  );
}
