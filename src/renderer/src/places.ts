// Where the writer was in each folder: the page last open, how far down each page
// was scrolled, and the pages opened lately. A convenience kept in the app's local
// storage; everything works without it.

interface Places {
  page: string | null;
  scroll: Record<string, number>; // by page; the most recently scrolled last
  recent: string[]; // pages, most recent first
}

const MAX_SCROLL = 300;
const MAX_RECENT = 20;
const key = (root: string) => `mysteditor.places:${root}`;

export function loadPlaces(root: string): Places {
  try {
    const raw = JSON.parse(localStorage.getItem(key(root)) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        page: typeof raw.page === 'string' ? raw.page : null,
        scroll: raw.scroll && typeof raw.scroll === 'object' ? raw.scroll : {},
        recent: Array.isArray(raw.recent) ? raw.recent.filter((p: unknown) => typeof p === 'string') : [],
      };
    }
  } catch {
    // unavailable or unreadable: start afresh
  }
  return { page: null, scroll: {}, recent: [] };
}

function save(root: string, places: Places) {
  try {
    localStorage.setItem(key(root), JSON.stringify(places));
  } catch {
    // full or unavailable: not worth bothering the writer about
  }
}

// The page now open: remembered as the folder's last page and the most recent one.
export function rememberPage(root: string, page: string) {
  const places = loadPlaces(root);
  places.page = page;
  places.recent = [page, ...places.recent.filter((p) => p !== page)].slice(0, MAX_RECENT);
  save(root, places);
}

export function rememberScroll(root: string, page: string, top: number) {
  const places = loadPlaces(root);
  delete places.scroll[page];
  places.scroll[page] = Math.round(top);
  const pages = Object.keys(places.scroll);
  for (const old of pages.slice(0, Math.max(0, pages.length - MAX_SCROLL))) delete places.scroll[old];
  save(root, places);
}
