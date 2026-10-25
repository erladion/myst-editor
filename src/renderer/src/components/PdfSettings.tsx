// Project Settings' PDF section ([pdf] in .mysteditor.toml): paper, the cover (see
// CoverDesigner), the headers and footers (on a sketch of a page), numbering and the
// contents' depth.
import { useEffect, useMemo, useState } from 'react';
import { COVER_PARTS, PAPER_SIZES, type PdfDef } from '../../../core/editor-config';
import type { PdfPatch } from '../../../core/project-settings';
import { ASSET_SCHEME, type PdfFonts } from '../../../shared/api';
import { CoverDesigner, fromSettings, type CoverForm } from './CoverDesigner';

const api = window.myst;

export interface PdfForm extends CoverForm {
  font: string;
  headingFont: string;
  codeFont: string;
  fonts: string[]; // font files, relative to the settings file
  header: [string, string, string];
  footer: [string, string, string];
  headersOn: 'numbered' | 'not-cover' | 'all';
  numbering: 'content' | 'cover';
  tocDepth: number;
}

export const pdfForm = (pdf: PdfDef): PdfForm => ({
  paper: pdf.paper,
  logo: pdf.logo ?? '',
  title: pdf.title ?? '',
  subtitle: pdf.subtitle,
  note: pdf.note,
  coverBackground: pdf.coverBackground ?? '',
  coverColor: pdf.coverColor ?? '',
  coverImages: pdf.coverImages.map(({ file, x, y, width, height }) => ({
    file,
    x,
    y,
    width,
    height,
  })),
  cover: { ...pdf.cover },
  font: pdf.font ?? '',
  headingFont: pdf.headingFont ?? '',
  codeFont: pdf.codeFont ?? '',
  fonts: pdf.fonts.map((f) => f.file),
  header: [...pdf.header],
  footer: [...pdf.footer],
  headersOn: pdf.headersOn,
  numbering: pdf.numbering,
  tocDepth: pdf.tocDepth,
});

// What changed from the settings as they are.
export function pdfPatch(was: PdfDef, form: PdfForm): PdfPatch {
  const out: PdfPatch = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const text = (now: string, before: string | null) => (now.trim() !== (before ?? '') ? now.trim() || null : undefined);
  if (form.paper !== was.paper) out.paper = form.paper;
  for (const [key, now, before] of [
    ['logo', form.logo, was.logo],
    ['title', form.title, was.title],
    ['coverBackground', form.coverBackground, was.coverBackground],
    ['coverColor', form.coverColor, was.coverColor],
    ['font', form.font, was.font],
    ['headingFont', form.headingFont, was.headingFont],
    ['codeFont', form.codeFont, was.codeFont],
  ] as const) {
    const v = text(now, before);
    if (v !== undefined) out[key] = v;
  }
  if (form.subtitle !== was.subtitle) out.subtitle = form.subtitle;
  if (form.note !== was.note) out.note = form.note;
  const graphics = form.coverImages.map(({ file, x, y, width, height }) => ({
    file: file.trim(),
    x,
    y,
    width,
    ...(height == null ? {} : { height }),
  }));
  const before = was.coverImages.map(({ file, x, y, width, height }) => ({
    file,
    x,
    y,
    width,
    ...(height == null ? {} : { height }),
  }));
  if (!same(graphics, before)) out.coverImages = graphics.length ? graphics.filter((g) => g.file) : null;
  const moved: NonNullable<PdfPatch['cover']> = {};
  for (const part of COVER_PARTS) if (!same(form.cover[part] ?? null, was.cover[part] ?? null)) moved[part] = form.cover[part] ?? null;
  if (Object.keys(moved).length) out.cover = moved;
  const fonts = form.fonts.map((f) => f.trim()).filter(Boolean);
  if (
    !same(
      fonts,
      was.fonts.map((f) => f.file),
    )
  )
    out.fonts = fonts.length ? fonts : null;
  if (!same(form.header, was.header)) out.header = form.header;
  if (!same(form.footer, was.footer)) out.footer = form.footer;
  if (form.headersOn !== was.headersOn) out.headersOn = form.headersOn;
  if (form.numbering !== was.numbering) out.numbering = form.numbering;
  if (form.tocDepth !== was.tocDepth) out.tocDepth = form.tocDepth;
  return out;
}

const SIDES = ['left', 'centre', 'right'] as const;

export type PdfPane = 'pdf-pages' | 'pdf-cover' | 'pdf-fonts' | 'pdf-margins';

interface Props {
  pane: string; // the one shown (see ProjectSettings' list)
  projectId: string | null;
  form: PdfForm;
  settingsFile: string;
  onChange: (form: PdfForm) => void;
  choose: (kind: 'image' | 'font') => Promise<string | null>;
}

const STYLE_NAMES: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Extra Bold',
  '900': 'Black',
};
const styleName = (weight: string, style: string) =>
  [weight.includes(' ') ? `Variable (${weight.replace(' ', '–')})` : (STYLE_NAMES[weight] ?? weight), style === 'italic' ? 'Italic' : '']
    .filter(Boolean)
    .join(' ')
    .replace(/^Regular Italic$/, 'Italic');

export function PdfSettings({ pane, projectId, form, settingsFile, onChange, choose }: Props) {
  const set = <K extends keyof PdfForm>(key: K, value: PdfForm[K]) => onChange({ ...form, [key]: value });
  // What the font files are, and the fonts on this computer.
  const [fonts, setFonts] = useState<PdfFonts | null>(null);
  const files = form.fonts.join('\n');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void api.pdfFonts(projectId, files ? files.split('\n') : []).then((r) => live && setFonts(r)), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [projectId, files]);
  const described = fonts?.files.filter((f): f is Extract<PdfFonts['files'][number], { family: string }> => 'family' in f) ?? [];
  const projectFamilies = [...new Set(described.map((f) => f.family))];
  // The project's fonts in this window too, for the samples and the cover.
  const faces = useMemo(
    () =>
      described
        .map((f) => {
          const rel = fromSettings(settingsFile, f.file);
          return rel
            ? `@font-face { font-family: ${JSON.stringify(f.family)}; font-weight: ${f.weight}; font-style: ${f.style}; src: url("${ASSET_SCHEME}://project/${rel.split('/').map(encodeURIComponent).join('/')}"); }`
            : '';
        })
        .join('\n'),
    [described, settingsFile],
  );
  const fontField = (key: 'font' | 'headingFont' | 'codeFont', label: string, placeholder: string, sample: string) => {
    const name = form[key].trim();
    // Shown in what the PDF uses: headings without their own font are in the text's.
    const shown = name || (key === 'headingFont' ? form.font.trim() : '');
    const where = !name ? null : projectFamilies.includes(name) ? 'project' : fonts?.installed.includes(name) ? 'here' : fonts ? 'missing' : null;
    return (
      <div className="field">
        <label htmlFor={`pdf-${key}`}>{label}</label>
        <input id={`pdf-${key}`} list="pdf-font-families" value={form[key]} placeholder={placeholder} spellCheck={false} onChange={(e) => set(key, e.target.value)} />
        <small className={where === 'missing' ? 'field-error' : undefined}>
          <span
            className="font-sample"
            style={{
              fontFamily: shown ? `${JSON.stringify(shown)}, ${key === 'codeFont' ? 'monospace' : 'sans-serif'}` : key === 'codeFont' ? 'monospace' : undefined,
            }}
          >
            {sample}
          </span>
          {where === 'here' && ' — only on this computer: on others the PDF may look different. Add its files to the project to be sure.'}
          {where === 'missing' && ' — not found: the usual font is used instead.'}
        </small>
      </div>
    );
  };
  const slots = (row: 'header' | 'footer') => (
    <div className="page-sketch-row">
      {SIDES.map((side, i) => (
        <input
          key={side}
          aria-label={`${row === 'header' ? 'Header' : 'Footer'} ${side}`}
          value={form[row][i]}
          spellCheck={false}
          placeholder={side}
          onChange={(e) => {
            const next = [...form[row]] as [string, string, string];
            next[i] = e.target.value;
            set(row, next);
          }}
        />
      ))}
    </div>
  );
  return (
    <>
      <section className="settings-section" hidden={pane !== 'pdf-pages'} aria-label="PDF pages">
        <h3>Pages</h3>
        <p className="muted">How File → Export PDF… lays out the project.</p>
        <div className="settings-row">
          <div className="field">
            <label htmlFor="pdf-paper">Paper</label>
            <select id="pdf-paper" value={form.paper} onChange={(e) => set('paper', e.target.value)}>
              {PAPER_SIZES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pdf-toc-depth">Levels in the contents</label>
            <select id="pdf-toc-depth" value={form.tocDepth} onChange={(e) => set('tocDepth', Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 (chapters)' : n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pdf-numbering">Page numbers</label>
          <select id="pdf-numbering" value={form.numbering} onChange={(e) => set('numbering', e.target.value as PdfForm['numbering'])}>
            <option value="content">From the first chapter (the pages before it have no headers or footers)</option>
            <option value="cover">From the cover</option>
          </select>
          <small>A chapter is each page in the root page’s table of contents. Each starts on a new page.</small>
        </div>
      </section>

      <section className="settings-section" hidden={pane !== 'pdf-cover'} aria-label="PDF cover">
        <h3>Cover</h3>
        <CoverDesigner
          form={form}
          settingsFile={settingsFile}
          onChange={onChange}
          chooseImage={() => choose('image')}
          titleFont={form.headingFont.trim() || form.font.trim() || null}
        />
        <Placeholders where="cover" />
      </section>

      <section className="settings-section" hidden={pane !== 'pdf-fonts'} aria-label="PDF fonts">
        <h3>Fonts</h3>
        <style>{faces}</style>
        <datalist id="pdf-font-families">
          {[...projectFamilies, ...(fonts?.installed ?? []).filter((f) => !projectFamilies.includes(f))].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <div className="pdf-fonts">
          {fontField('font', 'Text', 'The usual (Noto Sans or DejaVu Sans)', 'The quick brown fox jumps over the lazy dog')}
          {fontField('headingFont', 'Headings and the cover’s title', 'As the text', 'Installing on RHEL 9')}
          {fontField('codeFont', 'Code', 'The usual (DejaVu Sans Mono)', 'harbor deploy --region eu-north')}
        </div>
        <div className="field">
          <span className="field-label">Font files in the project</span>
          <div className="pdf-font-files">
            {form.fonts.map((file, i) => {
              const info = fonts?.files.find((f) => f.file === file);
              return (
                <div key={i} className="pdf-font-file">
                  <code>{file}</code>
                  <span className={info && 'error' in info ? 'field-error' : 'muted'}>
                    {!info ? '' : 'error' in info ? info.error : `${info.family} ${styleName(info.weight, info.style)}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file}`}
                    onClick={() =>
                      set(
                        'fonts',
                        form.fonts.filter((_, k) => k !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div>
              <button type="button" onClick={() => void choose('font').then((f) => f && !form.fonts.includes(f) && set('fonts', [...form.fonts, f]))}>
                Add a font file…
              </button>
            </div>
            <small>Put in the PDF, so it looks the same on every computer (.ttf, .otf, .woff, .woff2). Add each style you use: regular, bold, italic.</small>
          </div>
        </div>
      </section>

      <section className="settings-section" hidden={pane !== 'pdf-margins'} aria-label="PDF headers and footers">
        <h3>Headers and footers</h3>
        <p className="muted">In the text font.</p>
        <div className="field">
          <label htmlFor="pdf-headers-on">Show them on</label>
          <select id="pdf-headers-on" value={form.headersOn} onChange={(e) => set('headersOn', e.target.value as PdfForm['headersOn'])}>
            <option value="numbered">The numbered pages{form.numbering === 'content' ? ' (from the first chapter)' : ' (after the cover)'}</option>
            <option value="not-cover">Every page but the cover</option>
            <option value="all">Every page, the cover too</option>
          </select>
          {form.headersOn !== 'numbered' && form.numbering === 'content' && <small>The cover and the contents have no page numbers: slots with {'{page}'} or {'{pages}'} are left empty there.</small>}
        </div>
        <div className="page-sketch">
          {slots('header')}
          <div className="page-sketch-body" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {slots('footer')}
        </div>
        <Placeholders where="margins" />
      </section>
    </>
  );
}

// What can go in the cover's texts, and in the headers and footers.
const PLACEHOLDERS: {
  name: string;
  what: string;
  where: 'both' | 'margins';
}[] = [
  {
    name: '{title}',
    what: 'The title: the cover’s, or the root page’s',
    where: 'both',
  },
  { name: '{version}', what: 'The version: release in conf.py', where: 'both' },
  { name: '{date}', what: 'The day the PDF is made', where: 'both' },
  {
    name: '{project}',
    what: 'The project’s name: project in conf.py',
    where: 'both',
  },
  { name: '{page}', what: 'The page’s number', where: 'margins' },
  {
    name: '{pages}',
    what: 'The number of pages (counted as the page numbers are)',
    where: 'margins',
  },
  {
    name: '{chapter}',
    what: 'The title of the chapter the page is in',
    where: 'margins',
  },
  { name: '{logo}', what: 'The logo (set on the cover)', where: 'margins' },
];

function Placeholders({ where }: { where: 'cover' | 'margins' }) {
  return (
    <div className="placeholders">
      <span className="field-label">{where === 'cover' ? 'In the title, under the title and at the foot' : 'In each slot: text, and'}</span>
      <table>
        <tbody>
          {PLACEHOLDERS.filter((p) => where === 'margins' || p.where === 'both').map((p) => (
            <tr key={p.name}>
              <td>
                <code>{p.name}</code>
              </td>
              <td>{p.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {where === 'margins' && (
        <small>
          For example: “Page {'{page}'} of {'{pages}'}”, or “{'{title}'} {'{version}'}”.
        </small>
      )}
    </div>
  );
}
