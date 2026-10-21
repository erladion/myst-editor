// The advanced view's bar: back to formatted editing, and what the preview shows.
import type { ConditionsDef } from '../../../core/editor-config';
import { EmacsToggle, ViewAsMenu } from './Toolbar';

interface Props {
  preview: 'live' | 'built' | 'off';
  onPreview: (p: 'live' | 'built' | 'off') => void;
  built: boolean; // a Sphinx build of the page exists
  onRich: () => void;
  conditions: ConditionsDef | null;
  viewAs: string[] | null;
  onViewAs: (v: string[] | null) => void;
  onHistory: () => void; // the page's earlier versions
  emacs: boolean;
  onEmacs: (on: boolean) => void;
}

export function AdvancedBar({ preview, onPreview, built, onRich, conditions, viewAs, onViewAs, onHistory, emacs, onEmacs }: Props) {
  const option = (value: Props['preview'], label: string, title: string, disabled = false) => (
    <button type="button" aria-pressed={preview === value} title={title} disabled={disabled} onClick={() => onPreview(value)}>
      {label}
    </button>
  );
  return (
    <div className="advanced-bar" role="toolbar" aria-label="Markdown view">
      <button type="button" className="tb wide" onClick={onRich} title="Edit the page as formatted content (Ctrl+/)">
        ← Formatted editing
      </button>
      <span className="label">Markdown — saved exactly as typed. Find with Ctrl+F.</span>
      <span className="spacer" />
      {conditions && <ViewAsMenu settings={conditions} viewAs={viewAs} onViewAs={onViewAs} />}
      <span className="label">Preview</span>
      <div className="segmented" role="group" aria-label="Preview">
        {option('live', 'Live', 'Updates as you type')}
        {option('built', 'As built', built ? 'The page as Sphinx built it, after saving' : 'Available once Sphinx has built the project', !built)}
        {option('off', 'Off', 'Hide the preview')}
      </div>
      <span className="tb-sep" />
      <button type="button" className="tb wide" title="Earlier versions of this page, and what changed" onClick={onHistory}>
        History
      </button>
      <span className="tb-sep" />
      <EmacsToggle on={emacs} onChange={onEmacs} />
    </div>
  );
}
