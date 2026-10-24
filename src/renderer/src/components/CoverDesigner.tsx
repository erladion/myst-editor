// The PDF's cover in Project Settings: a preview at scale, with its background, logo,
// texts and graphics. Graphics are placed by dragging them on the preview (or with
// the arrow keys), or by their numbers (mm from the page's top-left corner).
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { PAPER_MM, PDF_MARGIN_MM, type PaperSize } from '../../../core/editor-config';
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
}

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
  const round = (n: number) => Math.round(n);
  const drag = useRef<{ i: number; x: number; y: number; gx: number; gy: number } | null>(null);
  const down = (i: number) => (e: PointerEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const g = form.coverImages[i];
    drag.current = { i, x: e.clientX, y: e.clientY, gx: g.x, gy: g.y };
  };
  const move = (e: PointerEvent<HTMLImageElement>) => {
    const d = drag.current;
    if (!d) return;
    place(d.i, { x: round(d.gx + (e.clientX - d.x) / mm), y: round(d.gy + (e.clientY - d.y) / mm) });
  };
  const up = () => (drag.current = null);
  const nudge = (i: number) => (e: KeyboardEvent<HTMLImageElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    const g = form.coverImages[i];
    place(i, { x: g.x + d[0], y: g.y + d[1] });
  };
  const add = async () => {
    const file = await chooseImage();
    if (file) set('coverImages', [...form.coverImages, { file, x: PDF_MARGIN_MM.side, y: PDF_MARGIN_MM.top, width: 40, height: null }] as F['coverImages']);
  };
  const number = (label: string, value: number | null, change: (n: number | null) => void, optional = false) => (
    <input
      type="number"
      aria-label={label}
      value={value ?? ''}
      placeholder={optional ? 'auto' : undefined}
      step={1}
      onChange={(e) => change(e.target.value === '' ? (optional ? null : 0) : Number(e.target.value))}
    />
  );

  return (
    <div className="cover-designer">
      <div
        className="cover-preview"
        aria-label="The cover"
        style={{ width: PREVIEW_WIDTH, height: page.height * mm, backgroundImage: background ? `url("${background}")` : undefined, color: form.coverColor || undefined } as CSSProperties}
      >
        <div className="cover-preview-text" style={{ padding: `${PDF_MARGIN_MM.top * mm}px ${PDF_MARGIN_MM.side * mm}px ${PDF_MARGIN_MM.bottom * mm}px` }}>
          {logo && <img alt="" src={logo} style={{ maxHeight: 28 * mm, maxWidth: 90 * mm, alignSelf: 'flex-start' }} />}
          <div className="cover-preview-title" style={{ fontSize: 30 * PT * mm, fontFamily: titleFont ? `${JSON.stringify(titleFont)}, sans-serif` : undefined }}>
            {form.title || 'The root page’s title'}
          </div>
          {form.subtitle && (
            <div className="cover-preview-subtitle" style={{ fontSize: 12 * PT * mm, marginTop: 6 * mm }}>
              {sample(form.subtitle)}
            </div>
          )}
          {form.note && (
            <div className="cover-preview-note" style={{ fontSize: 9 * PT * mm }}>
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
                title="Drag to place it (or use the arrow keys)"
                src={src}
                tabIndex={0}
                draggable={false}
                style={{ left: g.x * mm, top: g.y * mm, width: g.width * mm, height: g.height == null ? 'auto' : g.height * mm }}
                onPointerDown={down(i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={nudge(i)}
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
