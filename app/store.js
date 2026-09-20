/**
 * Local storage.
 *
 * Everything a person creates here stays on their device. There is no upload
 * path in this module and there should never be one: the repository and the
 * site are public, and the material this tool is built to handle includes other
 * people's harm statements.
 *
 * Consequences accepted deliberately:
 *  - Clearing browser data deletes it. Export is therefore not a nicety, it is
 *    the backup, and the UI says so.
 *  - Nothing syncs between devices. That is the point.
 *
 * localStorage rather than IndexedDB: the records are text and small, the API is
 * synchronous, and it survives in private-browsing modes long enough to export.
 * Writes are wrapped because localStorage throws in some privacy modes.
 */

const PREFIX = 'witness:v1:';

/** The prefix this project used before it was renamed. */
const LEGACY_PREFIX = 'colophon:v1:';

const KEYS = {
  cards: `${PREFIX}cards`,
  statements: `${PREFIX}statements`,
  settings: `${PREFIX}settings`,
  recents: `${PREFIX}recents`,
};

/**
 * Move data stored under the old name across, once.
 *
 * A rename should not be a way to lose somebody's work. This runs on every load
 * and is a no-op after the first time. Three rules:
 *
 *  - never overwrite a value that already exists under the new key, so a later
 *    load cannot clobber newer data with older data;
 *  - only delete the old copy after reading the new one back and confirming it
 *    matches, so a failed or partial write never destroys the original;
 *  - swallow failures, because storage can be full or disabled, and leaving the
 *    old data in place is strictly better than losing it.
 */
export function migrateLegacyStorage() {
  const storage = globalThis.localStorage;
  if (!storage) return { moved: 0, unavailable: true };

  let moved = 0;
  for (const name of Object.keys(KEYS)) {
    const to = KEYS[name];
    const from = `${LEGACY_PREFIX}${name}`;
    try {
      if (storage.getItem(to) !== null) continue;
      const raw = storage.getItem(from);
      if (raw === null) continue;
      storage.setItem(to, raw);
      if (storage.getItem(to) === raw) {
        storage.removeItem(from);
        moved += 1;
      }
    } catch {
      // Quota or privacy mode. The old copy stays exactly where it was.
    }
  }

  return { moved, unavailable: false };
}

export const DEFAULT_SETTINGS = {
  theme: 'system',
  textScale: '1',
  transliteration: true,
  showDiff: true,
};

function read(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    // Quota exceeded or storage disabled. Callers must tell the user rather
    // than pretend the work was saved.
    return { ok: false, error: error?.name === 'QuotaExceededError'
      ? 'Local storage is full. Export your work, then delete some drafts.'
      : 'This browser will not let this page store data (private mode, or storage disabled). Export instead of relying on drafts.' };
  }
}

export function storageAvailable() {
  try {
    const probe = `${PREFIX}probe`;
    globalThis.localStorage?.setItem(probe, '1');
    globalThis.localStorage?.removeItem(probe);
    return Boolean(globalThis.localStorage);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------- cards

/** Draft cards, keyed by id. These are never published automatically. */
export function loadDraftCards() {
  const stored = read(KEYS.cards, []);
  return Array.isArray(stored) ? stored : [];
}

export function saveDraftCard(card) {
  const cards = loadDraftCards();
  const index = cards.findIndex((c) => c.id === card.id);
  const record = { ...card, _draft: true, _savedAt: new Date().toISOString() };
  if (index === -1) cards.push(record);
  else cards[index] = record;
  const result = write(KEYS.cards, cards);
  return { ...result, card: record };
}

export function deleteDraftCard(id) {
  return write(KEYS.cards, loadDraftCards().filter((c) => c.id !== id));
}

// ----------------------------------------------------------------- statements

export function loadStatements() {
  const stored = read(KEYS.statements, []);
  return Array.isArray(stored) ? stored : [];
}

export function saveStatement(statement) {
  const statements = loadStatements();
  const record = { ...statement, _savedAt: new Date().toISOString() };
  const index = statements.findIndex((s) => s.id === statement.id);
  if (index === -1) statements.push(record);
  else statements[index] = record;
  const result = write(KEYS.statements, statements);
  return { ...result, statement: record };
}

export function deleteStatement(id) {
  return write(KEYS.statements, loadStatements().filter((s) => s.id !== id));
}

// ------------------------------------------------------------------- settings

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(settings) {
  return write(KEYS.settings, settings);
}

// -------------------------------------------------------------------- recents

export function loadRecents() {
  const stored = read(KEYS.recents, []);
  return Array.isArray(stored) ? stored : [];
}

export function pushRecent(id, { limit = 12 } = {}) {
  const recents = [id, ...loadRecents().filter((r) => r !== id)].slice(0, limit);
  write(KEYS.recents, recents);
  return recents;
}

/** Everything, in one file, so a person can move devices or keep a backup. */
export function exportEverything() {
  return {
    format: 'witness/local-archive',
    version: 1,
    exported: new Date().toISOString(),
    drafts: loadDraftCards(),
    statements: loadStatements(),
    settings: loadSettings(),
  };
}

export function importEverything(archive) {
  if (!archive || typeof archive !== 'object') throw new Error('not a Witness archive');
  if (!Array.isArray(archive.drafts) && !Array.isArray(archive.statements)) {
    throw new Error('archive has neither drafts nor statements');
  }
  const drafts = loadDraftCards();
  const statements = loadStatements();

  for (const card of archive.drafts || []) {
    const index = drafts.findIndex((c) => c.id === card.id);
    if (index === -1) drafts.push(card);
    else drafts[index] = card;
  }
  for (const statement of archive.statements || []) {
    const index = statements.findIndex((s) => s.id === statement.id);
    if (index === -1) statements.push(statement);
    else statements[index] = statement;
  }

  const a = write(KEYS.cards, drafts);
  const b = write(KEYS.statements, statements);
  if (archive.settings) write(KEYS.settings, { ...DEFAULT_SETTINGS, ...archive.settings });

  return { drafts: drafts.length, statements: statements.length, ok: a.ok && b.ok };
}
