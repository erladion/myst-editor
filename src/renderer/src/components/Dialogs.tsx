// Modal dialogs, opened imperatively through the EditorUi interface.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import type { EditorUi, Field } from '../editor/context';
import { isCapabilityName, type ConditionsDef, type OptionDef } from '../../../core/editor-config';
import { describe, parseCondition, unknownNames } from '../../../core/conditions';

type Request =
  | { kind: 'source'; title: string; source: string; help?: string; resolve: (v: string | null) => void }
  | { kind: 'fields'; title: string; fields: Field[]; submit?: string; resolve: (v: Record<string, string> | null) => void }
  | { kind: 'options'; title: string; options: [string, string][]; schema?: Record<string, OptionDef>; resolve: (v: [string, string][] | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirm: string; resolve: (v: boolean) => void }
  | { kind: 'text'; title: string; text: string; resolve: (v: null) => void }
  | {
      kind: 'condition';
      title: string;
      expr: string;
      settings: ConditionsDef;
      allowRemove: boolean;
      resolve: (v: { expr: string } | { remove: true } | null) => void;
    };

export interface DialogApi extends EditorUi {
  confirm(opts: { title: string; message: string; confirm: string }): Promise<boolean>;
  showText(opts: { title: string; text: string }): Promise<null>;
}

export const DialogHost = forwardRef<DialogApi>(function DialogHost(_props, ref) {
  const [request, setRequest] = useState<Request | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useImperativeHandle(ref, () => {
    const ask = <T,>(make: (resolve: (v: T) => void) => Request) =>
      new Promise<T>((resolve) => setRequest(make((v) => {
        setRequest(null);
        resolve(v);
      })));
    return {
      editSource: (o) => ask((resolve) => ({ kind: 'source', ...o, resolve })),
      editFields: (o) => ask((resolve) => ({ kind: 'fields', ...o, resolve })),
      editOptions: (o) => ask((resolve) => ({ kind: 'options', ...o, resolve })),
      confirm: (o) => ask((resolve) => ({ kind: 'confirm', ...o, resolve })),
      showText: (o) => ask((resolve) => ({ kind: 'text', ...o, resolve })),
      editCondition: (o) =>
        ask((resolve) => ({ kind: 'condition', title: o.allowRemove ? 'Edit condition' : 'Make conditional', ...o, resolve })),
      notify: (message) => {
        setToast(message);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
      },
    };
  }, []);

  return (
    <>
      {request && <Modal request={request} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
});

function Modal({ request }: { request: Request }) {
  const cancel = () => (request.kind === 'confirm' ? request.resolve(false) : request.resolve(null));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={request.title}>
        <h2>{request.title}</h2>
        {request.kind === 'source' && <SourceForm request={request} cancel={cancel} />}
        {request.kind === 'fields' && <FieldsForm request={request} cancel={cancel} />}
        {request.kind === 'options' && <OptionsForm request={request} cancel={cancel} />}
        {request.kind === 'condition' && <ConditionForm request={request} cancel={cancel} />}
        {request.kind === 'text' && (
          <>
            <pre className="log-text">{request.text}</pre>
            <div className="modal-actions">
              <button type="button" className="primary" autoFocus onClick={cancel}>
                Close
              </button>
            </div>
          </>
        )}
        {request.kind === 'confirm' && (
          <>
            <p className="modal-message">{request.message}</p>
            <div className="modal-actions">
              <button type="button" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="primary" autoFocus onClick={() => request.resolve(true)}>
                {request.confirm}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Actions({ cancel, submit = 'Save' }: { cancel: () => void; submit?: string }) {
  return (
    <div className="modal-actions">
      <button type="button" onClick={cancel}>
        Cancel
      </button>
      <button type="submit" className="primary">
        {submit}
      </button>
    </div>
  );
}

function SourceForm({ request, cancel }: { request: Extract<Request, { kind: 'source' }>; cancel: () => void }) {
  const [value, setValue] = useState(request.source);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    request.resolve(value);
  };
  return (
    <form onSubmit={submit}>
      {request.help && <p className="modal-help">{request.help}</p>}
      <textarea
        className="source-input"
        value={value}
        autoFocus
        spellCheck={false}
        rows={Math.min(24, Math.max(6, value.split('\n').length + 1))}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
        }}
      />
      <Actions cancel={cancel} />
    </form>
  );
}

function FieldsForm({ request, cancel }: { request: Extract<Request, { kind: 'fields' }>; cancel: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(request.fields.map((f) => [f.key, f.value])));
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        request.resolve(values);
      }}
    >
      {request.fields.map((f, i) => (
        <div key={f.key} className="field">
          <label htmlFor={`field-${f.key}`}>{f.label}</label>
          {f.choices ? (
            <select
              id={`field-${f.key}`}
              value={values[f.key]}
              aria-describedby={f.help ? `help-${f.key}` : undefined}
              onChange={(e) => set(f.key, e.target.value)}
              autoFocus={i === 0}
            >
              {f.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <>
              <div className={f.browse ? 'row' : undefined}>
                <input
                  id={`field-${f.key}`}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  autoFocus={i === 0}
                  aria-describedby={f.help ? `help-${f.key}` : undefined}
                  list={f.suggestions ? `suggest-${f.key}` : undefined}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {f.browse && (
                  <button type="button" onClick={async () => {
                    const picked = await f.browse!();
                    if (picked !== null) set(f.key, picked);
                  }}>
                    Choose…
                  </button>
                )}
              </div>
              {f.suggestions && (
                <datalist id={`suggest-${f.key}`}>
                  {(typeof f.suggestions === 'function' ? f.suggestions(values) : f.suggestions).slice(0, 500).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </datalist>
              )}
            </>
          )}
          {f.help && <small id={`help-${f.key}`}>{f.help}</small>}
        </div>
      ))}
      <Actions cancel={cancel} submit={request.submit} />
    </form>
  );
}

function OptionsForm({ request, cancel }: { request: Extract<Request, { kind: 'options' }>; cancel: () => void }) {
  const schema = request.schema ?? {};
  const declared = Object.keys(schema);
  // Declared options get their own fields; any others stay as free name/value rows.
  const [known, setKnown] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(declared.map((k) => [k, request.options.find(([name]) => name === k)?.[1] ?? null])),
  );
  const [rows, setRows] = useState<[string, string][]>(() => {
    const others = request.options.filter(([k]) => !(k in schema));
    return others.length || declared.length ? others : [['', '']];
  });
  const update = (i: number, col: 0 | 1, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? ((col === 0 ? [value, row[1]] : [row[0], value]) as [string, string]) : row)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const free = rows.map(([k, v]) => [k.trim().replace(/^:|:$/g, ''), v.trim()] as [string, string]).filter(([k]) => k);
    const value = (k: string): [string, string] | null => {
      if (k in schema) return known[k] === null ? null : [k, known[k]!.trim()];
      return free.find(([name]) => name === k) ?? null;
    };
    // Keep the original order, so editing a value doesn't reshuffle the header.
    const original = request.options.map(([k]) => k);
    const result: [string, string][] = [];
    for (const k of [...original, ...declared, ...free.map(([k]) => k)]) {
      if (result.some(([name]) => name === k)) continue;
      const v = value(k);
      if (v) result.push(v);
    }
    request.resolve(result);
  };

  return (
    <form onSubmit={submit}>
      {declared.length > 0 ? (
        <div className="known-options">
          {declared.map((k, i) => {
            const def = schema[k];
            const id = `option-${k}`;
            const current = known[k];
            const set = (v: string | null) => setKnown((o) => ({ ...o, [k]: v }));
            return (
              <div className="field" key={k}>
                {def.flag ? (
                  <label className="check">
                    <input type="checkbox" id={id} checked={current !== null} autoFocus={i === 0} onChange={(e) => set(e.target.checked ? '' : null)} />
                    {def.label ?? k}
                  </label>
                ) : (
                  <>
                    <label htmlFor={id}>{def.label ?? k}</label>
                    {def.choices ? (
                      <select id={id} value={current ?? ''} autoFocus={i === 0} onChange={(e) => set(e.target.value === '' ? null : e.target.value)}>
                        <option value="">(not set)</option>
                        {def.choices.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        {current !== null && current !== '' && !def.choices.includes(current) && <option value={current}>{current}</option>}
                      </select>
                    ) : (
                      <input id={id} value={current ?? ''} placeholder="(not set)" autoFocus={i === 0} onChange={(e) => set(e.target.value === '' ? null : e.target.value)} />
                    )}
                  </>
                )}
                {def.help && <small>{def.help}</small>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="modal-help">Options are passed to Sphinx as written, for example <code>width</code> = <code>80%</code>.</p>
      )}
      {(rows.length > 0 || !declared.length) && declared.length > 0 && <div className="modal-help">Other options</div>}
      <div className="options-grid">
        {rows.map(([k, v], i) => (
          <div className="option-row" key={i}>
            <input value={k} placeholder="name" aria-label="Option name" autoFocus={i === 0 && !declared.length} onChange={(e) => update(i, 0, e.target.value)} />
            <input value={v} placeholder="value (optional)" aria-label="Option value" onChange={(e) => update(i, 1, e.target.value)} />
            <button type="button" title="Remove option" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="link-button" onClick={() => setRows((r) => [...r, ['', '']])}>
        + Add {declared.length ? 'another' : ''} option
      </button>
      <Actions cancel={cancel} />
    </form>
  );
}

// Capabilities combined with "or", the common case the checklist can edit.
function orList(expr: string): string[] | null {
  const parsed = parseCondition(expr);
  if (!expr.trim()) return [];
  if (!parsed.ok) return null;
  const names: string[] = [];
  const walk = (e: typeof parsed.expr): boolean => (e.kind === 'name' ? (names.push(e.name), true) : e.kind === 'or' && walk(e.left) && walk(e.right));
  return walk(parsed.expr) ? names : null;
}

function ConditionForm({ request, cancel }: { request: Extract<Request, { kind: 'condition' }>; cancel: () => void }) {
  const [expr, setExpr] = useState(request.expr);
  // Capabilities added to the capabilities file while the dialog is open.
  const [added, setAdded] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null); // the New capability field, when open
  const [addError, setAddError] = useState<string | null>(null);
  const settings = { ...request.settings, capabilities: [...request.settings.capabilities, ...added] };
  const file = settings.capabilitiesFile;
  const canAdd = !!settings.capabilitiesPath;
  const parsed = parseCondition(expr);
  const unknown = parsed.ok ? unknownNames(parsed.names, settings) : [];
  const selected = orList(expr);
  const toggle = (name: string) => {
    const names = selected ?? [];
    const next = names.includes(name) ? names.filter((n) => n !== name) : [...names, name];
    setExpr(next.join(' or '));
  };
  // Into the capabilities file; `tick` it too (when the condition is a list of them).
  const add = async (name: string, tick: boolean) => {
    const result = await window.myst.addCapability(settings.capabilitiesPath!, settings.capabilitiesKey, name);
    if (!result.ok) return setAddError(result.message);
    setAddError(null);
    setAdded((a) => (a.includes(name) ? a : [...a, name]));
    setNewName(null);
    if (tick && selected && !selected.includes(name)) setExpr([...selected, name].join(' or '));
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.ok) request.resolve({ expr: expr.trim() });
      }}
    >
      {(settings.capabilities.length > 0 || canAdd) && (
        <fieldset className="capabilities" disabled={selected === null}>
          <legend>Show when any of these is available</legend>
          {settings.capabilities.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={!!selected?.includes(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
          {selected === null && <small>This condition uses and/not; edit it below.</small>}
        </fieldset>
      )}
      {canAdd &&
        (newName === null ? (
          <button type="button" className="link-button new-capability-open" onClick={() => setNewName('')}>
            New capability…
          </button>
        ) : (
          <div className="new-capability">
            <input
              aria-label="New capability"
              value={newName}
              autoFocus
              spellCheck={false}
              placeholder="CapabilityW"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (isCapabilityName(newName.trim())) void add(newName.trim(), true);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNewName(null);
                }
              }}
            />
            <button type="button" disabled={!isCapabilityName(newName.trim())} onClick={() => void add(newName.trim(), true)}>
              Add to {file}
            </button>
          </div>
        ))}
      <div className="field">
        <label htmlFor="condition-expr">Condition</label>
        <input
          id="condition-expr"
          value={expr}
          autoFocus={!settings.capabilities.length}
          spellCheck={false}
          placeholder="CapabilityX or (CapabilityY and not CapabilityZ)"
          aria-invalid={!parsed.ok}
          aria-describedby="condition-help"
          onChange={(e) => setExpr(e.target.value)}
        />
        <small id="condition-help" className={parsed.ok && !unknown.length ? '' : 'invalid'}>
          {!parsed.ok
            ? parsed.error
            : unknown.length
              ? `Not in ${file}: ${unknown.join(', ')}`
              : `Shown when ${describe(parsed.expr)}. Combine capabilities with and, or, not and parentheses.`}
        </small>
        {canAdd && parsed.ok && unknown.length > 0 && (
          <div className="add-capabilities">
            {unknown.map((name) => (
              <button key={name} type="button" className="link-button" onClick={() => void add(name, false)}>
                Add “{name}” to {file}
              </button>
            ))}
          </div>
        )}
        {addError && (
          <small className="invalid" role="alert">
            {addError}
          </small>
        )}
      </div>
      <div className="modal-actions">
        {request.allowRemove && (
          <button type="button" className="danger-text" onClick={() => request.resolve({ remove: true })}>
            Remove condition
          </button>
        )}
        <span className="spacer" />
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!parsed.ok}>
          {request.allowRemove ? 'Save' : 'Make conditional'}
        </button>
      </div>
    </form>
  );
}
