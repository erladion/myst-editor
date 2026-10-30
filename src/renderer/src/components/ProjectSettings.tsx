// File → Project Settings: what a project uses, saved in its .wysie.toml (so it
// applies to everyone working on it): conditional content, and the PDF's layout.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CONDITION_PALETTE, type ConditionsDef } from '../../../core/editor-config';
import type { ConditionsPatch } from '../../../core/project-settings';
import type { ProjectSettingsInfo } from '../../../shared/api';
import { conditionColor } from '../editor/conditions';
import { PdfSettings, pdfForm, pdfPatch, variablesProblem, type PdfForm } from './PdfSettings';

const api = window.myst;

// The list on the left: each entry a pane ('pdf' heads the PDF's).
const PANES: [string, string][] = [
  ['conditions', 'Conditional content'],
  ['pdf', 'PDF'],
  ['pdf-pages', 'Pages'],
  ['pdf-cover', 'Cover'],
  ['pdf-fonts', 'Fonts'],
  ['pdf-margins', 'Headers and footers'],
  ['pdf-variables', 'Variables'],
  ['pdf-styles', 'Stylesheets'],
];

const DEFAULTS = { block: ['if', 'endif'], inline: ['if-inline', 'endif-inline'] } as const;
const KEYWORD = /^[\w-]+$/;

interface Props {
  projectId: string | null;
  projectName?: string; // when the folder has more than one project
  confVariables: Record<string, string> | null; // conf.py's {name}s for the PDF, from the last build
  onClose: () => void;
}

export function ProjectSettingsDialog({ projectId, projectName, confVariables, onClose }: Props) {
  const [info, setInfo] = useState<ProjectSettingsInfo | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState('');
  const [key, setKey] = useState('');
  const [block, setBlock] = useState<[string, string]>([...DEFAULTS.block]);
  const [inline, setInline] = useState<[string, string]>([...DEFAULTS.inline]);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [listed, setListed] = useState<{ names: string[] } | { error: string } | null>(null);
  const [pdf, setPdf] = useState<PdfForm | null>(null);
  const [pane, setPane] = useState<string>('conditions');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.projectSettings(projectId).then((i) => {
      setInfo(i);
      setEnabled(i.enabled);
      setPdf(pdfForm(i.pdf));
      const c = i.conditions;
      if (!c) return;
      setFile(c.capabilitiesFile ?? '');
      setKey(c.capabilitiesKey ?? '');
      setBlock(c.block);
      setInline(c.inline);
      setCaseSensitive(c.caseSensitive);
      setColors(c.colors);
    });
  }, [projectId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  // The capabilities the file lists, as it's chosen or typed.
  useEffect(() => {
    if (!file.trim()) return setListed(null);
    let live = true;
    const t = setTimeout(() => void api.readCapabilities(projectId, file.trim(), key.trim() || null).then((r) => live && setListed(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [projectId, file, key]);

  const names = listed && 'names' in listed ? listed.names : (info?.conditions?.capabilities ?? []);
  // Each capability, and the other conditions given a colour, with the colour shown.
  const shown = useMemo(() => {
    const settings: ConditionsDef = { ...(info?.conditions ?? { capabilitiesFile: null, capabilitiesPath: null, capabilitiesKey: null }), block, inline, caseSensitive, capabilities: names, colors };
    return [...new Set([...names, ...Object.keys(colors)])].map((expr) => ({ expr, color: colors[expr] ?? '', swatch: conditionColor(expr, settings), auto: conditionColor(expr, { ...settings, colors: {} }) }));
  }, [info, names, colors, block, inline, caseSensitive]);

  const badKeywords = [...block, ...inline].some((k) => !KEYWORD.test(k.trim())) || new Set([...block, ...inline].map((k) => k.trim())).size < 4;

  const patch = (): ConditionsPatch => {
    const was = info!.conditions;
    const out: ConditionsPatch = {};
    if (enabled !== info!.enabled) out.enabled = enabled;
    if (!enabled) return out;
    const same = (a: readonly string[], b: readonly string[]) => a.join('\n') === b.join('\n');
    if (file.trim() !== (was?.capabilitiesFile ?? '')) out.capabilities = file.trim() || null;
    if (key.trim() !== (was?.capabilitiesKey ?? '')) out.key = key.trim() || null;
    const trimmed = (k: [string, string]): [string, string] => [k[0].trim(), k[1].trim()];
    if (!same(trimmed(block), was?.block ?? DEFAULTS.block)) out.block = trimmed(block);
    if (!same(trimmed(inline), was?.inline ?? DEFAULTS.inline)) out.inline = trimmed(inline);
    if (caseSensitive !== (was?.caseSensitive ?? true)) out.caseSensitive = caseSensitive;
    const changed: Record<string, string | null> = {};
    for (const expr of new Set([...Object.keys(colors), ...Object.keys(was?.colors ?? {})])) {
      if ((colors[expr] ?? '') !== (was?.colors[expr] ?? '')) changed[expr] = colors[expr] || null;
    }
    if (Object.keys(changed).length) out.colors = changed;
    return out;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const conditions = patch();
    const pdfChanges = pdf ? pdfPatch(info!.pdf, pdf) : {};
    if (!Object.keys(conditions).length && !Object.keys(pdfChanges).length) return onClose();
    setBusy(true);
    setError(null);
    const result = await api.saveProjectSettings(projectId, {
      ...(Object.keys(conditions).length ? { conditions } : {}),
      ...(Object.keys(pdfChanges).length ? { pdf: pdfChanges } : {}),
    });
    if (result.ok) return onClose();
    setError(result.message);
    setBusy(false);
  };

  const choose = async (kind: 'capabilities' | 'new-capabilities' | 'image' | 'font' | 'css'): Promise<string | null> => {
    const result = await api.chooseSettingsFile(projectId, kind);
    if (!result) return null;
    if ('error' in result) {
      setError(result.error);
      return null;
    }
    setError(null);
    if (kind === 'capabilities' || kind === 'new-capabilities') setFile(result.path);
    return result.path;
  };

  const keywords = (label: string, value: [string, string], set: (v: [string, string]) => void) => (
    <div className="marker-keywords">
      <span>{label}</span>
      <input aria-label={`${label}: start`} value={value[0]} spellCheck={false} onChange={(e) => set([e.target.value, value[1]])} />
      <input aria-label={`${label}: end`} value={value[1]} spellCheck={false} onChange={(e) => set([value[0], e.target.value])} />
      <code>
        {`<!-- ${value[0].trim()}: X -->`} … {`<!-- ${value[1].trim()} -->`}
      </code>
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal project-settings" role="dialog" aria-modal="true" aria-label="Project settings">
        <h2>Project settings{projectName ? ` — ${projectName}` : ''}</h2>
        {info && (
          <form onSubmit={submit}>
            <p className="modal-help">
              Saved in <code>{info.file}</code>
              {info.exists ? '' : ' (a new file)'}, so they apply to everyone working on the project.
            </p>
            <div className="settings-layout">
              <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings">
                {PANES.map(([id, label]) =>
                  id === 'pdf' ? (
                    <span key={id} className="settings-nav-group">
                      {label}
                    </span>
                  ) : (
                    <button key={id} type="button" role="tab" aria-selected={pane === id} className={pane === id ? 'active' : undefined} onClick={() => setPane(id)}>
                      {label}
                    </button>
                  ),
                )}
              </nav>
              <div className="settings-pane" role="tabpanel">
                <section className="settings-section" hidden={pane !== 'conditions'} aria-label="Conditional content">
                  <label className="settings-switch">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    <strong>Conditional content</strong>
                  </label>
                  <p className="muted">
                    Mark parts of pages, and table rows, as only for some products or capabilities, and see a page as each of them would. The Sphinx build needs an extension that reads the
                    markers.
                  </p>
                  {enabled && (
                    <div className="settings-body">
                      <div className="field">
                        <label htmlFor="caps-file">Capabilities file</label>
                        <div className="row">
                          <input id="caps-file" value={file} spellCheck={false} placeholder="None: any name can be used" onChange={(e) => setFile(e.target.value)} />
                          <button type="button" onClick={() => void choose('capabilities')}>
                            Choose…
                          </button>
                          <button type="button" onClick={() => void choose('new-capabilities')}>
                            New…
                          </button>
                        </div>
                        <small>
                          {!file.trim()
                            ? 'A JSON file listing the capabilities, relative to the settings file. Conditions are checked against it, and View as offers them.'
                            : !listed
                              ? ' '
                              : 'error' in listed
                                ? listed.error
                                : listed.names.length
                                  ? `${listed.names.length} capabilit${listed.names.length === 1 ? 'y' : 'ies'}: ${listed.names.join(', ')}`
                                  : 'No capabilities in it yet. Add them from the condition dialog.'}
                        </small>
                      </div>
                      {file.trim() && (
                        <div className="field">
                          <label htmlFor="caps-key">Where the list is in the file</label>
                          <input id="caps-key" value={key} spellCheck={false} placeholder="At the top, or under “capabilities”" onChange={(e) => setKey(e.target.value)} />
                          <small>Keys with dots between them, like product.capabilities.</small>
                        </div>
                      )}
                      <div className="field">
                        <span className="field-label">Markers</span>
                        {keywords('Blocks', block, setBlock)}
                        {keywords('In a line', inline, setInline)}
                        {badKeywords && <small className="field-error">Each marker needs its own keyword: letters, digits, - or _.</small>}
                      </div>
                      <div className="field">
                        <label className="check">
                          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
                          Capability names are case sensitive
                        </label>
                      </div>
                      {shown.length > 0 && (
                        <div className="field">
                          <span className="field-label">Colours</span>
                          <div className="condition-colors">
                            {shown.map(({ expr, color, swatch, auto }) => (
                              <label key={expr}>
                                <span className="color-swatch" style={{ background: swatch }} />
                                <span className="color-name">{expr}</span>
                                <select aria-label={`Colour of ${expr}`} value={color} onChange={(e) => setColors((c) => ({ ...c, [expr]: e.target.value }))}>
                                  <option value="">Automatic ({auto.replace(/^var\(--cond-(\w+)\)$/, '$1')})</option>
                                  {CONDITION_PALETTE.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                  {color.startsWith('#') && <option value={color}>{color}</option>}
                                </select>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
                {pdf && <PdfSettings pane={pane} projectId={projectId} form={pdf} settingsFile={info.file} onChange={setPdf} choose={choose} confVariables={confVariables} />}
              </div>
            </div>
            {error && (
              <p className="sphinx-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || (enabled && badKeywords) || (!!pdf && !!variablesProblem(pdf.variables))}>
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
