/**
 * Search and filtering over term cards.
 *
 * DOM-free and dependency-free on purpose: this module runs in the browser and
 * in Node, so scripts/check.mjs can test the ranking without a browser.
 *
 * The queries this domain actually needs are not just "find the word". They are
 * things like "every rendering anyone has disputed" and "everything that has
 * been rendered into Latin". So filtering by status, language, and tradition is
 * part of the core, not a power-user feature.
 */

export const STATUS_LABELS = {
  equivalent: 'equivalent',
  'nearest-no-equivalent': 'nearest, no equivalent',
  'transliterate-only': 'transliterate only',
  'do-not-translate': 'do not translate',
  contested: 'contested',
  undefined: 'undefined',
};

/** The filter keys, in the order the UI shows them. */
export const FILTER_NAMES = ['languages', 'originLanguages', 'statuses', 'traditions'];

export const STATUS_ORDER = [
  'equivalent',
  'nearest-no-equivalent',
  'transliterate-only',
  'do-not-translate',
  'contested',
  'undefined',
];

const FIELD_WEIGHTS = {
  label: 100,
  origin: 55,
  domain: 25,
  rendition: 30,
  gloss: 18,
  source: 12,
};

/** Split a query into quoted phrases (kept whole) and loose tokens. */
export function parseQuery(query) {
  const text = (query || '').trim().toLowerCase();
  const phrases = [...text.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const tokens = text
    .replace(/"[^"]*"/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return { tokens, phrases };
}

/** Precompute the lowercase fields we match against, once per card. */
export function buildIndex(cards) {
  return cards.map((card) => ({
    card,
    id: card.id,
    label: card.concept.label.toLowerCase(),
    gloss: card.concept.gloss.toLowerCase(),
    origin: [card.origin?.term, card.origin?.transliteration]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    domains: (card.concept.domains || []).map((d) => d.toLowerCase()),
    renditions: card.renditions.map((r) => ({
      rendering: (r.rendering || '').toLowerCase(),
      transliteration: (r.transliteration || '').toLowerCase(),
      tradition: (r.tradition || '').toLowerCase(),
      loss: (r.loss || '').toLowerCase(),
      language: r.language,
      status: r.status,
    })),
    sources: card.sources.map((s) =>
      [s.citation, s.locator, s.tradition].filter(Boolean).join(' ').toLowerCase()
    ),
    // Two different questions, so two different facets: what language a concept
    // was rendered *into*, and what language it came *from*. "Everything whose
    // origin is Hebrew" is a query this domain needs.
    languages: [...new Set(card.renditions.map((r) => r.language))].sort(),
    originLanguages: card.origin?.language ? [card.origin.language] : [],
    statuses: [...new Set(card.renditions.map((r) => r.status))],
    traditions: [
      ...new Set(
        [...card.renditions.map((r) => r.tradition), ...card.sources.map((s) => s.tradition)]
          .filter(Boolean)
      ),
    ].sort(),
  }));
}

/** Best single-field match for one term, or null. */
function bestMatch(entry, term) {
  let best = null;
  const consider = (field, value, bonus = 0) => {
    if (!value || !value.includes(term)) return;
    const score = FIELD_WEIGHTS[field] + bonus;
    if (!best || score > best.score) best = { score, field };
  };

  if (entry.label === term) consider('label', entry.label, 60);
  else if (entry.label.startsWith(term)) consider('label', entry.label, 30);
  else consider('label', entry.label);

  if (entry.origin.startsWith(term)) consider('origin', entry.origin, 20);
  else consider('origin', entry.origin);

  for (const domain of entry.domains) consider('domain', domain, domain === term ? 20 : 0);

  for (const rendition of entry.renditions) {
    consider('rendition', rendition.rendering, rendition.rendering === term ? 30 : 0);
    consider('rendition', rendition.transliteration, 10);
    consider('rendition', rendition.tradition, -6);
    consider('rendition', rendition.loss, -14);
  }

  consider('gloss', entry.gloss);
  for (const source of entry.sources) consider('source', source);

  if (!best) return null;
  return { score: best.score, fields: [best.field] };
}

/** Does this card survive the active facet filters? Empty sets mean "no filter". */
export function passesFilters(entry, filters = {}) {
  const { languages, originLanguages, statuses, traditions } = filters;
  if (languages?.size && !entry.languages.some((l) => languages.has(l))) return false;
  if (originLanguages?.size && !entry.originLanguages.some((l) => originLanguages.has(l))) return false;
  if (statuses?.size && !entry.statuses.some((s) => statuses.has(s))) return false;
  if (traditions?.size && !entry.traditions.some((t) => traditions.has(t))) return false;
  return true;
}

/**
 * Rank matching cards. Every token and phrase must match something, so adding
 * words narrows rather than widens.
 */
export function search(index, query, filters = {}) {
  const { tokens, phrases } = parseQuery(query);
  const terms = [...phrases, ...tokens];
  const results = [];

  for (const entry of index) {
    if (!passesFilters(entry, filters)) continue;

    let score = 0;
    const why = new Set();
    let matchedAll = true;

    for (const term of terms) {
      const match = bestMatch(entry, term);
      if (!match) {
        matchedAll = false;
        break;
      }
      score += match.score;
      match.fields.forEach((f) => why.add(f));
    }

    if (!matchedAll) continue;
    if (!terms.length) score = 1;

    results.push({ entry, score, why: [...why] });
  }

  results.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return results;
}

/**
 * Searches are state worth keeping. A link that says "every rendering anyone has
 * disputed into Latin" is the thing you paste into a message to a colleague, so
 * query and filters live in the URL.
 */
export function encodeSearch({ query = '', filters = {} } = {}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  for (const name of FILTER_NAMES) {
    const set = filters[name];
    if (set?.size) params.set(name, [...set].sort().join(','));
  }
  return params.toString();
}

export function decodeSearch(searchString = '') {
  const params = new URLSearchParams(searchString);
  const filters = { languages: new Set(), originLanguages: new Set(), statuses: new Set(), traditions: new Set() };
  for (const name of FILTER_NAMES) {
    const raw = params.get(name);
    if (!raw) continue;
    for (const value of raw.split(',').map((v) => v.trim()).filter(Boolean)) filters[name].add(value);
  }
  return { query: params.get('q') || '', filters };
}

/** Available facet values across the whole base, for building the filter UI. */
export function facets(index) {
  const languages = new Map();
  const originLanguages = new Map();
  const traditions = new Map();
  const statuses = new Map();

  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const entry of index) {
    entry.languages.forEach((l) => bump(languages, l));
    entry.originLanguages.forEach((l) => bump(originLanguages, l));
    entry.traditions.forEach((t) => bump(traditions, t));
    entry.statuses.forEach((s) => bump(statuses, s));
  }

  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    languages: sorted(languages),
    originLanguages: sorted(originLanguages),
    traditions: sorted(traditions),
    statuses: sorted(statuses),
  };
}

/** A card counts as reviewed only when someone has signed it as a reviewer. */
export function reviewState(card) {
  const reviewers = (card.contributors || []).filter((c) => c.role === 'reviewer');
  return reviewers.length
    ? { reviewed: true, reviewers: reviewers.map((r) => `${r.name}${r.tradition ? ` (${r.tradition})` : ''}`) }
    : { reviewed: false, reviewers: [] };
}
