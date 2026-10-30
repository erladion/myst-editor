// What the editor needs from a project's builder: where its tables of contents are
// kept, and its rules for cross-references. Sphinx's are in sphinx/.
import type { Project } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/build';
import type { Resolution, Suggestion } from '../build';
import type { Contents } from './contents';
import { sphinxContents } from './sphinx/contents';
import { sphinxReferences } from './sphinx/references';
import { asciidoctorContents } from './asciidoctor/contents';
import { asciidoctorReferences } from './asciidoctor/references';
import { antoraContents, antoraOf } from './antora/contents';
import { antoraReferences } from './antora/references';

export interface References {
  // What a role (`role`, `target`) or a link written in `fromSource` points at.
  role(info: BuildInfo | null, fromSource: string | null, role: string, target: string): Resolution;
  link(info: BuildInfo | null, fromSource: string | null, href: string): Resolution;
  // Targets for a role, for autocomplete.
  suggest(info: BuildInfo | null, fromSource: string | null, role: string): Suggestion[];
}

export interface ProjectBuilder {
  contents: Contents;
  references: References;
  // Whether its builds can show single blocks, for cards' previews.
  fragments: boolean;
}

const SPHINX: ProjectBuilder = { contents: sphinxContents, references: sphinxReferences, fragments: true };
const ASCIIDOCTOR: ProjectBuilder = { contents: asciidoctorContents, references: asciidoctorReferences, fragments: true };

// A project's (pages outside every project: Sphinx's rules, as for a Markdown folder).
// An Antora component's are Asciidoctor's, with its own contents and references.
export function builderFor(project: Project | null): ProjectBuilder {
  if (project?.builder !== 'asciidoctor') return SPHINX;
  const antora = antoraOf(project);
  return antora ? { contents: antoraContents, references: antoraReferences(antora), fragments: true } : ASCIIDOCTOR;
}
