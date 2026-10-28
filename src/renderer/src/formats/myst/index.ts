// The editor's side of MyST Markdown (see formats/editing.ts).
import { mystConfig } from '../../../../core/project-config';
import type { EditingFormat } from '../editing';
import { ADMONITIONS, CALLOUT_CHOICES, directiveInfo } from './directives';
import { mystInserts } from './inserts';
import { renameMystReferences } from './rename';

export const mystEditing: EditingFormat = {
  inserts: mystInserts,
  renameReferences: renameMystReferences,
  callouts: {
    names: CALLOUT_CHOICES,
    is: (name) => !!ADMONITIONS[name],
    label: (name) => ADMONITIONS[name]?.label ?? name,
    // A callout with a title (admonition) needs one; the others have none.
    change(from, to, args) {
      const patch: Record<string, unknown> = { name: to };
      if (to === 'admonition' && !args) patch.args = 'Title';
      if (from === 'admonition' && to !== 'admonition') patch.args = '';
      return patch;
    },
  },
  block: directiveInfo,
  dialect(config, confPy) {
    const { extensions } = mystConfig(config);
    return confPy
      ? { label: 'Sphinx project', detail: `MyST extensions from ${confPy}: ${extensions.length ? extensions.join(', ') : 'none'}` }
      : { label: 'Markdown folder', detail: 'No conf.py found — all MyST extensions enabled' };
  },
};
