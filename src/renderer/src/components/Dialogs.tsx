// Modal dialogs, opened imperatively through the EditorUi interface.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import type { EditorUi, Field } from '../editor/context';

type Request =
  | { kind: 'source'; title: string; source: string; help?: string; resolve: (v: string | null) => void }
  | { kind: 'fields'; title: string; fields: Field[]; submit?: string; resolve: (v: Record<string, string> | null) => void }
  | { kind: 'options'; title: string; options: [string, string][]; resolve: (v: [string, string][] | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirm: string; resolve: (v: boolean) => void };

export interface DialogApi extends EditorUi {
  confirm(opts: { title: string; message: string; confirm: string }): Promise<boolean>;
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
        <label key={f.key} className="field">
          <span>{f.label}</span>
          {f.choices ? (
            <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} autoFocus={i === 0}>
              {f.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <input value={values[f.key]} placeholder={f.placeholder} autoFocus={i === 0} onChange={(e) => set(f.key, e.target.value)} />
          )}
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
      <Actions cancel={cancel} submit={request.submit} />
    </form>
  );
}

function OptionsForm({ request, cancel }: { request: Extract<Request, { kind: 'options' }>; cancel: () => void }) {
  const [rows, setRows] = useState<[string, string][]>(() => (request.options.length ? request.options : [['', '']]));
  const update = (i: number, col: 0 | 1, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? ((col === 0 ? [value, row[1]] : [row[0], value]) as [string, string]) : row)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        request.resolve(rows.map(([k, v]) => [k.trim().replace(/^:|:$/g, ''), v.trim()] as [string, string]).filter(([k]) => k));
      }}
    >
      <p className="modal-help">Options are passed to Sphinx as written, for example <code>width</code> = <code>80%</code>.</p>
      <div className="options-grid">
        {rows.map(([k, v], i) => (
          <div className="option-row" key={i}>
            <input value={k} placeholder="name" aria-label="Option name" autoFocus={i === 0} onChange={(e) => update(i, 0, e.target.value)} />
            <input value={v} placeholder="value (optional)" aria-label="Option value" onChange={(e) => update(i, 1, e.target.value)} />
            <button type="button" title="Remove option" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="link-button" onClick={() => setRows((r) => [...r, ['', '']])}>
        + Add option
      </button>
      <Actions cancel={cancel} />
    </form>
  );
}
