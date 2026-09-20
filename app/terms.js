/**
 * Loading the term base.
 *
 * Fetches the built bundle relative to this module, so the app works under any
 * deployment path (/witness/, /, a user page) without configuration.
 */

const BUNDLE_URL = new URL('../data/terms.json', import.meta.url);

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
