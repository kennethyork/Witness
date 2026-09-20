/**
 * Loading the term base.
 *
 * Fetches the built bundle relative to this module, so the app works under any
 * deployment path (/witness/, /, a user page) without configuration.
 */

const BUNDLE_URL = new URL('../data/terms.json', import.meta.url);

/**
 * The published debates, read the way the term base is.
 *
 * Published debates are files in the repository, and that is what makes this a
 * platform without a server: the repository already supplies identity,
 * publishing, attribution, history and moderation-by-merge. This supplies the
 * record; git supplies the rest.
 */
export async function loadPublishedDebates(url = new URL('../data/debates.json', import.meta.url)) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    // A missing set of published debates is not a failure: the app works with
    // none, and the home screen simply has nothing published to show.
    return { digest: null, count: 0, debates: [] };
  }
  const bundle = await response.json();
  return Array.isArray(bundle?.debates) ? bundle : { digest: null, count: 0, debates: [] };
}

export async function loadTermBase(url = BUNDLE_URL) {
  if (globalThis.location?.protocol === 'file:') {
    throw new Error(
      'Browsers block module and data loading from file:// URLs. Serve the folder over HTTP instead, for example: python3 -m http.server'
    );
  }

  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not load the term base: HTTP ${response.status} ${response.statusText}`);
  }

  const bundle = await response.json();
  if (!Array.isArray(bundle?.cards)) {
    throw new Error('The term base is malformed: expected a "cards" array.');
  }
  return bundle;
}
