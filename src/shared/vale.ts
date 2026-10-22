// Vale (https://vale.sh), the prose linter, when it's installed and configured.

// An alert as Vale reports it (`vale --output=JSON`), plus the corrections it offers.
export interface ValeAlert {
  Line: number;
  Span: [number, number]; // columns, 1-based and inclusive, in characters
  Check: string; // e.g. Vale.Spelling
  Message: string;
  Severity: 'error' | 'warning' | 'suggestion';
  Match: string; // the text it's about
  Link: string;
  Action: { Name: string; Params: string[] | null };
  Suggestions: string[]; // replacements for Match ('' removes it)
}

export type ValeResult =
  | { status: 'ok'; alerts: ValeAlert[] }
  // Not installed, no .vale.ini for the page, or it failed: the editor carries on without.
  | { status: 'unavailable'; reason: 'not-installed' | 'no-config' | 'failed'; message: string };
