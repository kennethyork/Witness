/**
 * The rules of a term card, in one place.
 *
 * These run in three places and must never disagree:
 *   - scripts/build.mjs, before anything is published
 *   - the in-browser editor, while somebody is writing a card
 *   - scripts/check.mjs, as tests
 *
 * Dependency-free and DOM-free, so all three can use it. This is a lint, not a
 * full JSON Schema implementation: schema/term-card.schema.json remains the
 * contract, and scripts/validate_cards.py enforces it in CI. This catches the
 * same things in a form a contributor can read, and it is the version the
 * browser can run without shipping a schema validator to every visitor.
 */

export const STATUSES = [
  'equivalent',
  'nearest-no-equivalent',
  'transliterate-only',
  'do-not-translate',
  'contested',
  'undefined',
];

/** Statuses where the card must say what the rendering loses. */
export const LOSS_REQUIRED = new Set(['nearest-no-equivalent', 'contested', 'undefined']);

export const ALLOWED_LICENSES = new Set(['CC-BY-SA-4.0', 'CC0-1.0']);

export const CONTRIBUTOR_ROLES = ['author', 'reviewer', 'translator', 'advisor'];

export const CARD_KEYS = [
  'id', 'concept', 'origin', 'renditions', 'disputes',
  'sources', 'contributors', 'license', 'provenance_note',
];

const CONCEPT_KEYS = ['label', 'gloss', 'register', 'domains', 'related'];
const ORIGIN_KEYS = ['language', 'term', 'script', 'transliteration', 'pronunciation'];
const RENDITION_KEYS = [
  'language', 'tradition', 'rendering', 'script', 'transliteration',
  'status', 'loss', 'basis', 'alternatives',
];
const BASIS_KEYS = ['citation', 'url', 'edition', 'tradition', 'language', 'locator', 'accessed'];
const SOURCE_KEYS = BASIS_KEYS;
const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Validate one card. `filename` is only used to label findings, and to check
 * that the id matches the file it lives in.
 */
export function lintCard(card, filename = 'card.json') {
  const findings = [];
  const at = (path, message, level = 'error') => findings.push({ level, file: filename, path, message });

  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    at('', 'card must be a JSON object');
    return findings;
  }

  for (const key of Object.keys(card)) {
    if (!CARD_KEYS.includes(key)) at(key, `unknown field "${key}" (the schema forbids it, so CI would reject this)`);
  }

  if (!isText(card.id) || !ID_SLUG.test(card.id || '')) {
    at('id', 'id must be a lowercase hyphenated slug, e.g. "steadfast-love"');
  } else if (filename !== 'card.json') {
    const stem = filename.replace(/\.json$/, '');
    if (card.id !== stem) at('id', `id "${card.id}" does not match filename "${filename}"`);
  }

  if (!card.concept || typeof card.concept !== 'object') {
    at('concept', 'concept is required');
  } else {
    for (const key of Object.keys(card.concept)) {
      if (!CONCEPT_KEYS.includes(key)) at(`concept.${key}`, `unknown field "${key}"`);
    }
    if (!isText(card.concept.label)) at('concept.label', 'label is required');
    if (!isText(card.concept.gloss)) at('concept.gloss', 'gloss is required');
    else if (card.concept.gloss.trim().length < 20) at('concept.gloss', 'gloss looks too short to be a definition', 'warn');
  }

  if (card.origin !== undefined) {
    if (!card.origin || typeof card.origin !== 'object') {
      at('origin', 'origin must be an object when present');
    } else {
      for (const key of Object.keys(card.origin)) {
        if (!ORIGIN_KEYS.includes(key)) at(`origin.${key}`, `unknown field "${key}"`);
      }
      if (!isText(card.origin.term)) at('origin.term', 'origin.term is required when origin is present');
      if (card.origin.language && !LANG_TAG.test(card.origin.language)) {
        at('origin.language', `"${card.origin.language}" is not a BCP 47 language tag, e.g. "he" or "zh-Hant"`);
      }
    }
  }

  if (!Array.isArray(card.renditions) || card.renditions.length === 0) {
    at('renditions', 'at least one rendition is required');
  } else {
    card.renditions.forEach((rendition, index) => {
      const where = `renditions[${index}]`;
      if (!rendition || typeof rendition !== 'object') {
        at(where, 'rendition must be an object');
        return;
      }
      for (const key of Object.keys(rendition)) {
        if (!RENDITION_KEYS.includes(key)) at(`${where}.${key}`, `unknown field "${key}"`);
      }

      if (!isText(rendition.language)) at(`${where}.language`, 'language is required');
      else if (!LANG_TAG.test(rendition.language)) {
        at(`${where}.language`, `"${rendition.language}" is not a BCP 47 language tag`);
      }

      if (!isText(rendition.rendering)) at(`${where}.rendering`, 'rendering is required');
      if (rendition.rendering && rendition.rendering.trim().length < 1) at(`${where}.rendering`, 'rendering is empty');

      if (!STATUSES.includes(rendition.status)) {
        at(`${where}.status`, `status must be one of: ${STATUSES.join(', ')}`);
      } else if (LOSS_REQUIRED.has(rendition.status) && !isText(rendition.loss)) {
        at(
          `${where}.loss`,
          `a rendition marked "${rendition.status}" must state what it loses. This is the whole point of the card.`
        );
      }

      if (!rendition.basis || !isText(rendition.basis.citation)) {
        at(`${where}.basis.citation`, 'every rendition needs a basis with a citation');
      } else {
        for (const key of Object.keys(rendition.basis)) {
          if (!BASIS_KEYS.includes(key)) at(`${where}.basis.${key}`, `unknown field "${key}"`);
        }
        if (!isText(rendition.basis.language)) at(`${where}.basis.language`, 'basis needs the language it is cited in');
      }

      if (rendition.status === 'equivalent') {
        at(
          `${where}.status`,
          'recorded as equivalent. If this is a judgement rather than a fact, mark it contested and say who disputes it.',
          'warn'
        );
      }

      for (const [altIndex, alternative] of (rendition.alternatives || []).entries()) {
        if (!alternative || typeof alternative !== 'object') {
          at(`${where}.alternatives[${altIndex}]`, 'alternative must be an object');
          continue;
        }
        if (!isText(alternative.rendering) || !isText(alternative.rejected_because)) {
          at(`${where}.alternatives[${altIndex}]`, 'each alternative needs both a rendering and why it was rejected');
        }
      }
    });
  }

  if (!Array.isArray(card.sources) || card.sources.length === 0) {
    at('sources', 'at least one source is required. No claim without a source.');
  } else {
    card.sources.forEach((source, index) => {
      for (const key of Object.keys(source || {})) {
        if (!SOURCE_KEYS.includes(key)) at(`sources[${index}].${key}`, `unknown field "${key}"`);
      }
      if (!isText(source?.citation)) at(`sources[${index}].citation`, 'citation is required');
      if (!isText(source?.language)) at(`sources[${index}].language`, 'source language is required');
      if (source?.language && !LANG_TAG.test(source.language)) {
        at(`sources[${index}].language`, `"${source.language}" is not a BCP 47 language tag`);
      }
    });
  }

  for (const [index, dispute] of (card.disputes || []).entries()) {
    if (!isText(dispute?.position)) at(`disputes[${index}].position`, 'position is required');
    if (!isText(dispute?.held_by)) at(`disputes[${index}].held_by`, 'held_by is required');
    if (!dispute?.basis || !isText(dispute.basis.citation)) {
      at(`disputes[${index}].basis`, 'a recorded dispute needs a basis too');
    }
  }

  for (const [index, contributor] of (card.contributors || []).entries()) {
    if (!isText(contributor?.name)) at(`contributors[${index}].name`, 'name is required');
    if (!isText(contributor?.date)) at(`contributors[${index}].date`, 'date is required, e.g. 2026-09-20');
    if (!CONTRIBUTOR_ROLES.includes(contributor?.role)) {
      at(`contributors[${index}].role`, `role must be one of: ${CONTRIBUTOR_ROLES.join(', ')}`);
    }
  }

  if (card.license && !ALLOWED_LICENSES.has(card.license)) {
    at('license', `licence must be one of: ${[...ALLOWED_LICENSES].join(', ')}`);
  }

  if (!(card.contributors || []).some((c) => c?.role === 'reviewer')) {
    findings.push({
      level: 'warn',
      file: filename,
      path: 'contributors',
      message: 'no reviewer has signed this card. It will display as unreviewed, which is honest but is not finished work.',
    });
  }

  return findings;
}

/** Validate a whole set, and catch ids colliding across files. */
export function lintAll(entries) {
  const findings = [];
  const seen = new Map();

  for (const { file, card } of entries) {
    findings.push(...lintCard(card, file));
    const id = card?.id;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) {
      findings.push({
        level: 'error',
        file,
        path: 'id',
        message: `duplicate id "${id}", already used in ${seen.get(id)}`,
      });
    } else {
      seen.set(id, file);
    }
  }

  return findings;
}

/**
 * What a card still needs. Drives the editor's progress indicator.
 *
 * Two lists, because they are two different kinds of thing:
 *  - `missing` is what the schema will reject, or what the card cannot honestly
 *    claim without. These block.
 *  - `suggested` is what makes a card good rather than merely valid. A concept
 *    genuinely may have no single origin term, so that is a suggestion and not
 *    a failure. The editor must not nag a contributor into inventing one.
 */
export function cardCompleteness(card) {
  const missing = [];
  const suggested = [];
  if (!card) return { missing: ['everything'], suggested: [], complete: 0 };

  const has = (value) => isText(value);

  if (!has(card.concept?.label)) missing.push('concept label');
  if (!has(card.concept?.gloss)) missing.push('gloss');
  if (!has(card.concept?.register)) suggested.push('register (devotional, juridical, poetic…)');
  if (!(card.concept?.domains || []).length) suggested.push('domains');

  if (!has(card.origin?.term)) suggested.push('the term in its own script');
  if (!has(card.origin?.language)) {
    suggested.push('the language the concept came from');
  } else if (!has(card.origin?.script)) {
    suggested.push('script, so it renders in the right typeface');
  } else if (card.origin.script !== 'Latn' && !has(card.origin?.transliteration)) {
    // A reader who cannot render the script, or who cannot read it, needs the
    // transliteration. Latin-script origins do not need one.
    suggested.push('transliteration, so the card is still readable without the script');
  }

  const renditions = card.renditions || [];
  if (!renditions.length) missing.push('at least one rendition');
  renditions.forEach((rendition, index) => {
    const where = `rendition ${index + 1}`;
    if (!has(rendition.language)) missing.push(`${where}: language`);
    if (!has(rendition.rendering)) missing.push(`${where}: rendering`);
    if (!has(rendition.status)) missing.push(`${where}: status`);
    if (LOSS_REQUIRED.has(rendition.status) && !has(rendition.loss)) missing.push(`${where}: what it loses`);
    if (!has(rendition.basis?.citation)) missing.push(`${where}: citation`);
    if (!has(rendition.basis?.language)) missing.push(`${where}: citation language`);
    if (!(rendition.alternatives || []).length && rendition.status !== 'equivalent') {
      suggested.push(`${where}: renderings that were considered and rejected`);
    }
  });

  if (!(card.sources || []).length) missing.push('at least one source');
  if (!(card.sources || []).every((s) => has(s?.citation) && has(s?.language))) missing.push('source citations and languages');
  if (!(card.contributors || []).some((c) => c?.role === 'reviewer')) missing.push('a named reviewer');
  if (!(card.disputes || []).length) suggested.push('any recorded disagreement, even if none');
  if (!has(card.provenance_note)) suggested.push('a note on how this card came to exist, and who was not consulted');

  const total = missing.length ? 100 - Math.min(100, missing.length * 8) : 100;
  return { missing, suggested, complete: Math.max(0, total) };
}

/** The shape a new card starts from, so the editor never begins with nothing. */
export function blankCard() {
  return {
    id: '',
    concept: { label: '', gloss: '', register: '', domains: [] },
    origin: { language: '', term: '', script: '', transliteration: '' },
    renditions: [
      {
        language: 'en',
        rendering: '',
        status: 'nearest-no-equivalent',
        loss: '',
        basis: { citation: '', language: 'en' },
      },
    ],
    disputes: [],
    sources: [{ citation: '', language: '' }],
    contributors: [{ name: '', date: new Date().toISOString().slice(0, 10), role: 'author' }],
    license: 'CC-BY-SA-4.0',
    provenance_note: '',
  };
}
