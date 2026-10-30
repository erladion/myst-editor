// The app's name, in one place, and the names it had before: what it's called in
// windows and messages, its command, and its settings file. Earlier names keep
// working: their settings folders are moved to the app's (see main/previous-names.ts),
// their settings files are still read, and their command still runs it.
export const PRODUCT = {
  name: 'Wysie',
  command: 'wysie',
  // A project's settings, next to its conf.py (or at the top of the opened folder).
  settingsFile: '.wysie.toml',
  previous: [{ name: 'MyST Editor', command: 'mysteditor', settingsFile: '.mysteditor.toml' }],
} as const;

// Settings files a folder may have, the current name first.
export const SETTINGS_FILES: readonly string[] = [PRODUCT.settingsFile, ...PRODUCT.previous.map((p) => p.settingsFile)];

export const isSettingsFile = (name: string) => SETTINGS_FILES.includes(name.slice(name.lastIndexOf('/') + 1));
