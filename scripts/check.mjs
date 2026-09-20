#!/usr/bin/env node
/**
 * Tests for the parts that can be tested without a browser: hashing, canonical
 * serialisation, determinism, and search ranking. No test framework, because a
 * project meant to be readable in ten years should not depend on npm.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, canonical, cardDigest, baseDigest } from '../app/hash.js';
import { buildIndex, search, parseQuery, facets, reviewState, encodeSearch, decodeSearch } from '../app/search.js';
import { lintCard, lintAll, cardCompleteness, blankCard } from '../app/lint.js';
import {
  paritySummary, statementState, outstanding, lengthSignals,
  citedTerms, statementId, lintStatement,
} from '../app/parity.js';
import {
  xmlEscape, csvCell, toCsv, toTbx, toLossReport, CSV_COLUMNS,
  parseCardsInput, parseStatementInput, statementToMarkdown, filename,
} from '../app/export.js';
import { migrateLegacyStorage, loadDraftCards, loadSettings } from '../app/store.js';
import {
  blankDebate, debateSlug, nextMoveId, lintDebate, debateState, debateToMarkdown,
  moveDigest, termsDigest, transcriptDigest, verifyChain, stampChain,
  contributionFor, mergeContribution, restampAll,
} from '../app/debate.js';
import {
  FORMATS, FORMAT_KEYS, SIDE_KEYS, blankSession, sessionId, suggestBurden,
  phasesFor, currentPhase, formatClock, roomClock, advancePhase, lastPhase,
  pointsRemaining, canRaisePoint, raisePoint, settlePoint,
  addCard, removeCard, roomTally, sessionToDebate, sessionToMarkdown, motionsFor,
} from '../app/room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const nodeDigest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// --------------------------------------------------------------- hashing

check('sha256 of empty string matches Node', sha256Hex('') === nodeDigest(''));
check('sha256 of "abc" matches Node', sha256Hex('abc') === nodeDigest('abc'), sha256Hex('abc'));

const knownVectors = [
  '',
  'a',
  'abc',
  'message digest',
  'abcdefghijklmnopqrstuvwxyz',
  'The quick brown fox jumps over the lazy dog',
];
for (const vector of knownVectors) {
  check(`sha256("${vector.slice(0, 24)}") matches Node`, sha256Hex(vector) === nodeDigest(vector));
}

// Padding boundaries: 55/56/57 and 63/64/65 bytes are where block-padding bugs
// live, and a multibyte character must hash as its UTF-8 bytes.
for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
  const input = 'x'.repeat(length);
  check(`sha256 of ${length} bytes matches Node`, sha256Hex(input) === nodeDigest(input));
}

for (const unicode of ['שָׁלוֹם', 'धर्म', 'حَسَد', '慈悲', '🕊️ peace', 'a\u0000b']) {
  check(`sha256 of UTF-8 ${JSON.stringify(unicode)} matches Node`, sha256Hex(unicode) === nodeDigest(unicode));
}

const megabyte = 'the same word means different things '.repeat(30000);
check('sha256 of ~1MB matches Node', sha256Hex(megabyte) === nodeDigest(megabyte));

// ---------------------------------------------------------- canonical form

check('canonical sorts keys', canonical({ b: 1, a: 2 }) === '{"a":2,"b":1}');
check(
  'canonical is key-order independent',
  canonical({ a: [1, { z: 'z', y: 'y' }], m: null }) === canonical({ m: null, a: [1, { y: 'y', z: 'z' }] })
);
check('canonical distinguishes arrays from objects', canonical([1, 2]) === '[1,2]' && canonical({ 0: 1, 1: 2 }) !== '[1,2]');
check('canonical rejects NaN', (() => { try { canonical({ a: NaN }); return false; } catch { return true; } })());
check('canonical keeps unicode intact', canonical({ a: 'שָׁלוֹם' }) === '{"a":"שָׁלוֹם"}');

// ---------------------------------------------------------------- the cards

const termsDir = path.join(root, 'data', 'terms');
const files = (await readdir(termsDir)).filter((f) => f.endsWith('.json')).sort();
const cards = [];
for (const file of files) {
  cards.push(JSON.parse(await readFile(path.join(termsDir, file), 'utf8')));
}
check('seed cards were found', cards.length >= 2, `found ${cards.length}`);

const index = buildIndex(cards);
const facetData = facets(index);

check('card digest is stable across calls', cardDigest(cards[0]) === cardDigest(cards[0]));
// Key order must not affect the digest, or reformatting a card would silently
// invalidate every citation that names it.
const reordered = Object.fromEntries(Object.entries(cards[0]).reverse());
const reorderedNested = {
  ...cards[0],
  concept: Object.fromEntries(Object.entries(cards[0].concept).reverse()),
};
check('card digest is independent of top-level key order', cardDigest(reordered) === cardDigest(cards[0]));
check('card digest is independent of nested key order', cardDigest(reorderedNested) === cardDigest(cards[0]));
check(
  'mutating a card changes its digest',
  cardDigest({ ...cards[0], provenance_note: 'edited' }) !== cardDigest(cards[0])
);
check('base digest ignores card order', baseDigest(cards) === baseDigest([...cards].reverse()));

// The whole point of the schema's conditional: a loss is mandatory when a
// rendering is not recorded as equivalent.
const shalom = cards.find((c) => c.id === 'shalom');
check(
  'every non-equivalent rendition declares its loss',
  cards.every((card) =>
    card.renditions.every((r) => r.status === 'equivalent' || (typeof r.loss === 'string' && r.loss.length > 10))
  )
);

// ------------------------------------------------------------------ search

check('parseQuery keeps quoted phrases whole', parseQuery('"steadfast love" psalm').phrases[0] === 'steadfast love');
check('parseQuery strips quotes from tokens', !parseQuery('"steadfast love"').tokens.length);

const byLabel = search(index, 'hesed');
check('search finds a card by label', byLabel.some((r) => r.entry.id === 'hesed'));

const byGloss = search(index, 'covenant');
check('search reaches the gloss and renditions', byGloss.length >= 1, `${byGloss.length} results`);

check('search is case insensitive', search(index, 'HESED').length === search(index, 'hesed').length);

check(
  'search reaches inside recorded losses',
  search(index, 'sentiment').some((r) => r.entry.id === 'hesed')
);

const phrase = search(index, '"steadfast love"');
check('phrase search matches', phrase.some((r) => r.entry.id === 'hesed'));

check('every token must match', search(index, 'hesed zzzznotaword').length === 0);
check('empty query returns everything', search(index, '').length === cards.length);

check(
  'label matches outrank gloss matches',
  search(index, 'shalom')[0].entry.id === 'shalom'
);

// Filters are the queries this domain genuinely needs.
const latinResults = search(index, '', { languages: new Set(['la']) });
check(
  'language-of-rendering filter finds exactly the cards with a Latin rendition',
  latinResults.length === 2 && latinResults.every((r) => ['hesed', 'shalom'].includes(r.entry.id)),
  latinResults.map((r) => r.entry.id).join(', ')
);

const hebrewOrigin = search(index, '', { originLanguages: new Set(['he']) });
check(
  'origin-language filter is a different question from rendering language',
  hebrewOrigin.length === 2 && hebrewOrigin.every((r) => ['hesed', 'shalom'].includes(r.entry.id))
);
check(
  'origin-language filter excludes cards whose origin is not Hebrew',
  !search(index, '', { originLanguages: new Set(['sa']) }).some((r) => r.entry.id === 'hesed')
);

const sanskrit = search(index, '', { originLanguages: new Set(['sa']) });
check('origin-language filter finds the Sanskrit card', sanskrit.length === 1 && sanskrit[0].entry.id === 'dharma');

const contested = search(index, '', { statuses: new Set(['contested']) });
check('status filter can surface disputed renderings', contested.length === 0, 'no card is currently contested');

check(
  'status filter finds every card with a recorded-loss rendering',
  search(index, '', { statuses: new Set(['nearest-no-equivalent']) }).length === cards.length
);
check('filters combine as AND', search(index, '', { languages: new Set(['la']), originLanguages: new Set(['he']) }).length === 2);
check(
  'contradictory filters return nothing rather than everything',
  search(index, '', { languages: new Set(['zh']), originLanguages: new Set(['he']) }).length === 0
);

check('facets list languages of rendering', facetData.languages.some(([tag]) => tag === 'la'));
check('facets list origin languages', facetData.originLanguages.some(([tag]) => tag === 'he'));
check('facets list statuses', facetData.statuses.some(([status]) => status === 'nearest-no-equivalent'));
check('facets list traditions', facetData.traditions.length > 0);

check('reviewState reports unreviewed cards honestly', reviewState(shalom).reviewed === false);
check(
  'reviewState detects a named reviewer',
  reviewState({ contributors: [{ name: 'R.', date: '2026-01-01', role: 'reviewer' }] }).reviewed === true
);

// ------------------------------------------------------- lint (shared rules)

const validCard = {
  id: 'sample',
  concept: { label: 'sample', gloss: 'A sufficiently detailed gloss for a test card.' },
  renditions: [
    {
      language: 'en',
      rendering: 'sample',
      status: 'nearest-no-equivalent',
      loss: 'It drops the part that matters most.',
      basis: { citation: 'Some source', language: 'en' },
    },
  ],
  sources: [{ citation: 'Some source', language: 'en' }],
  contributors: [{ name: 'A Reviewer', date: '2026-01-01', role: 'reviewer' }],
};

const errorsOf = (findings) => findings.filter((f) => f.level === 'error');

check('lint accepts a well-formed card', errorsOf(lintCard(validCard, 'sample.json')).length === 0);
check(
  'lint rejects a non-equivalent rendition with no loss',
  errorsOf(lintCard({ ...validCard, renditions: [{ ...validCard.renditions[0], loss: undefined }] }, 'sample.json'))
    .some((f) => f.path === 'renditions[0].loss')
);
check(
  'lint rejects a rendition with no citation',
  errorsOf(lintCard({ ...validCard, renditions: [{ ...validCard.renditions[0], basis: undefined }] }, 'sample.json'))
    .some((f) => f.path === 'renditions[0].basis.citation')
);
check(
  'lint rejects unknown fields, because the schema will',
  errorsOf(lintCard({ ...validCard, extra_thing: 1 }, 'sample.json')).some((f) => f.path === 'extra_thing')
);
check('lint rejects a card with no sources', errorsOf(lintCard({ ...validCard, sources: [] }, 'sample.json')).length > 0);
check(
  'lint flags an id that does not match its filename',
  errorsOf(lintCard(validCard, 'other.json')).some((f) => f.path === 'id')
);
check(
  'lint warns, rather than fails, when no reviewer has signed',
  lintCard({ ...validCard, contributors: [] }, 'sample.json').some((f) => f.level === 'warn' && f.path === 'contributors')
);
check(
  'lint rejects a bad BCP 47 language tag',
  errorsOf(lintCard({ ...validCard, renditions: [{ ...validCard.renditions[0], language: 'English' }] }, 'sample.json'))
    .some((f) => f.path === 'renditions[0].language')
);
check(
  'lint catches duplicate ids across files',
  lintAll([
    { file: 'a.json', card: { ...validCard, id: 'a' } },
    { file: 'b.json', card: { ...validCard, id: 'a' } },
  ]).some((f) => f.message.includes('duplicate'))
);
check('the shipped cards pass their own lint', errorsOf(lintAll(files.map((file, i) => ({ file, card: cards[i] })))).length === 0);

const blank = blankCard();
check('a blank card is not valid yet', errorsOf(lintCard(blank, 'card.json')).length > 0);
check('a blank card reports what is missing', cardCompleteness(blank).missing.length > 3);
check(
  'a non-Latin origin is asked for a transliteration',
  cardCompleteness({ ...validCard, origin: { language: 'he', term: 'חֶסֶד', script: 'Hebr' } })
    .suggested.some((s) => s.includes('transliteration'))
);
check(
  'a Latin-script origin is not nagged for a transliteration',
  !cardCompleteness({ ...validCard, origin: { language: 'la', term: 'pax', script: 'Latn' } })
    .suggested.some((s) => s.includes('transliteration'))
);
check('a complete card reports nothing missing', cardCompleteness(validCard).missing.length === 0);
check('a valid card can still have suggestions', cardCompleteness(validCard).suggested.length > 0);
check(
  'an optional origin is suggested, never required',
  !cardCompleteness(validCard).missing.some((m) => m.includes('origin') || m.includes('own script'))
);

// ------------------------------------------------------------------- parity

const statement = {
  format: 'witness/statement',
  version: 1,
  id: 'joint-river',
  title: 'Joint statement on the river',
  kind: 'declaration',
  created: '2026-01-01',
  parties: [
    { id: 'a', name: 'Community A', role: 'party' },
    { id: 'b', name: 'Community B', role: 'party' },
  ],
  versions: [
    {
      language: 'en',
      status: 'proposed',
      body: 'We affirm the shared stewardship of the river and its whole watershed for everyone who depends on it downstream.',
      approvals: [
        { party: 'a', state: 'approved' },
        { party: 'b', state: 'approved' },
      ],
      divergences: [],
      basis: [],
    },
    {
      language: 'ar',
      status: 'draft',
      body: 'نؤكد.',
      approvals: [{ party: 'a', state: 'pending' }],
      divergences: [{ summary: 'Says much less', raisedBy: 'A. Translator', kind: 'omission', resolved: false }],
      basis: [{ termCard: 'shalom', note: 'rendered as salām' }],
    },
  ],
  retention: { policy: 'delete after 12 months', destroyBy: '2027-01-01' },
  note: '',
};

const summary = paritySummary(statement);
check('a version approved by every party is ratified', summary.find((v) => v.language === 'en').state === 'ratified');
check(
  'a version with an unanswered party is incomplete',
  summary.find((v) => v.language === 'ar').state === 'incomplete'
);
check('the statement is not ratifiable as a whole', statementState(statement).ratified === false);
check('open divergences are counted', statementState(statement).openDivergences === 1);
check('outstanding() names who to ask', outstanding(statement).some((o) => o.party.id === 'b'));
check('outstanding() does not chase parties who have answered', !outstanding(statement).some((o) => o.party.id === 'a' && o.languages.every((l) => l.state === 'approved')));
check('cited term cards are collected', citedTerms(statement)[0].termCard === 'shalom');

// A withheld approval must never count as consent. This is the whole reason
// the state exists rather than reusing "pending".
const withheldStatement = {
  ...statement,
  versions: [
    {
      ...statement.versions[0],
      approvals: [
        { party: 'a', state: 'approved' },
        { party: 'b', state: 'withheld' },
      ],
    },
    statement.versions[1],
  ],
};
const withheldSummary = paritySummary(withheldStatement)[0];
check('a withheld approval blocks ratification', withheldSummary.state === 'withheld');
check('withheld is reported separately from pending', withheldSummary.withheld.length === 1 && withheldSummary.pending.length === 0);
check('statementState refuses to call it ratified', statementState(withheldStatement).ratified === false);

const divergedStatement = {
  ...statement,
  versions: [
    {
      ...statement.versions[0],
      divergences: [{ summary: 'Softer verb', raisedBy: 'B', kind: 'softening', resolved: false }],
    },
  ],
};
check('an open divergence marks a version diverged', paritySummary(divergedStatement)[0].state === 'diverged');
check(
  'resolving a divergence clears it',
  paritySummary({
    ...divergedStatement,
    versions: [{ ...divergedStatement.versions[0], divergences: [{ ...divergedStatement.versions[0].divergences[0], resolved: true }] }],
  })[0].state === 'ratified'
);

const signals = lengthSignals(statement);
check('a materially shorter version raises a length signal', signals.length === 1 && signals[0].language === 'ar');
check('length signals name what they compared against', signals[0].against === 'en');
check('length signals are arithmetic, not a verdict', signals[0].gap > 0.25 && signals[0].words < signals[0].againstWords);

const linted = lintStatement({ ...statement, versions: [...statement.versions, { language: 'ar', body: 'duplicate', approvals: [] }] });
check('two versions in one language is an error', linted.some((f) => f.message.includes('two versions')));
check(
  'an approval naming an unknown party is an error',
  lintStatement({ ...statement, versions: [{ ...statement.versions[0], approvals: [{ party: 'zzz', state: 'approved' }] }] })
    .some((f) => f.message.includes('unknown party'))
);
check(
  'a divergence must name who raised it, because no tool can notice one',
  lintStatement({ ...statement, versions: [{ ...statement.versions[1], divergences: [{ summary: 'x', kind: 'omission' }] }] })
    .some((f) => f.message.includes('named person'))
);
check('a valid statement passes its own lint', errorsOf(lintStatement(statement)).length === 0);
check('statementId derives a slug', statementId({ title: 'Joint Statement on the River!' }) === 'joint-statement-on-the-river');

// ------------------------------------------------------------------- export

check('xmlEscape escapes the ampersand first', xmlEscape('<a & "b">') === '&lt;a &amp; &quot;b&quot;&gt;');
check('csvCell quotes only when needed', csvCell('plain') === 'plain');
check('csvCell quotes commas', csvCell('a,b') === '"a,b"');
check('csvCell doubles embedded quotes', csvCell('say "hi"') === '"say ""hi"""');
check('csvCell quotes newlines', csvCell('a\nb') === '"a\nb"');

const csv = toCsv(cards);
const csvLines = csv.trim().split('\r\n');
check('CSV starts with the declared header', csvLines[0] === CSV_COLUMNS.join(','));
check(
  'CSV has one row per rendition plus the header',
  csvLines.length - 1 === cards.reduce((n, c) => n + c.renditions.length, 0),
  `${csvLines.length - 1} rows`
);
check('CSV uses RFC 4180 line endings', csv.includes('\r\n'));

const tbx = toTbx(cards);
check('TBX declares itself', tbx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
check('TBX has one termEntry per card', (tbx.match(/<termEntry /g) || []).length === cards.length);
check('TBX has a langSet per rendition', (tbx.match(/<langSet /g) || []).length >= cards.reduce((n, c) => n + c.renditions.length, 0));
check('TBX escapes ampersands', !/[^&]&[^a-z#]/.test(tbx.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, '')));
check('TBX carries the loss through', tbx.includes('type="loss"'));
check('TBX is deterministic', toTbx(cards) === tbx);

const hesedCard = cards.find((c) => c.id === 'hesed');
check('single card JSON round-trips', parseCardsInput(JSON.stringify(hesedCard))[0].id === 'hesed');
check('array JSON round-trips', parseCardsInput(JSON.stringify(cards)).length === cards.length);
check(
  'a built bundle round-trips',
  parseCardsInput(JSON.stringify({ format: 'witness/term-base', cards })).length === cards.length
);
check('garbage is rejected with a readable message', (() => {
  try { parseCardsInput('{not json'); return false; } catch (error) { return error.message.includes('not valid JSON'); }
})());
check('a statement round-trips', parseStatementInput(JSON.stringify(statement)).id === 'joint-river');
check('a non-statement is rejected', (() => {
  try { parseStatementInput('{"a":1}'); return false; } catch { return true; }
})());

const markdown = statementToMarkdown(statement);
check('statement Markdown names every language', markdown.includes('## en') && markdown.includes('## ar'));
check('statement Markdown prints approval states', markdown.includes('not yet answered'));
check(
  'statement Markdown never renders withheld as approved',
  statementToMarkdown(withheldStatement).includes('withheld — do not treat as approval')
);
check('statement Markdown states the ratification fact', markdown.includes('Fully ratified in every language: no'));
check('statement Markdown lists open divergences', markdown.includes('Says much less'));
check('statement Markdown cites terms relied on', markdown.includes('`shalom`'));
check('loss report collects the losses', toLossReport(cards).includes('Recorded losses'));
check('filename slugs safely', filename('card', 'My Card!', 'json') === 'witness-card-my-card.json');

// ------------------------------------------------------------------ permalinks

const encoded = encodeSearch({ query: 'covenant "steadfast love"', filters: { languages: new Set(['la', 'en']), statuses: new Set(['contested']) } });
const decoded = decodeSearch(encoded);
check('search query survives a permalink', decoded.query === 'covenant "steadfast love"');
check('filter sets survive a permalink', decoded.filters.languages.has('la') && decoded.filters.languages.has('en'));
check('unset facets decode to empty sets', decoded.filters.traditions.size === 0);
check('an empty search encodes to nothing', encodeSearch({}) === '');
check('an empty string decodes to an empty search', decodeSearch('').query === '');

// ------------------------------------------- storage migration across a rename

// A rename must not be a way to lose somebody's work, so this is exercised
// against a fake localStorage rather than assumed.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
};

memory.set('colophon:v1:cards', JSON.stringify([{ id: 'draft-one', concept: { label: 'draft one' } }]));
memory.set('colophon:v1:settings', JSON.stringify({ theme: 'dark' }));

const migration = migrateLegacyStorage();
check('data stored under the old name is moved', migration.moved === 2, `moved ${migration.moved}`);
check('the new key holds the moved data', JSON.parse(memory.get('witness:v1:cards'))[0].id === 'draft-one');
check('the old key is removed once the new one is verified', !memory.has('colophon:v1:cards'));
check('drafts load normally after the migration', loadDraftCards()[0].id === 'draft-one');
check('settings survive the migration', loadSettings().theme === 'dark');
check('running it again is a no-op', migrateLegacyStorage().moved === 0);

// The dangerous direction: an older value must never overwrite a newer one.
memory.set('witness:v1:cards', JSON.stringify([{ id: 'newer' }]));
memory.set('colophon:v1:cards', JSON.stringify([{ id: 'older' }]));
migrateLegacyStorage();
check('a newer value is never clobbered by an older one', JSON.parse(memory.get('witness:v1:cards'))[0].id === 'newer');

const savedStorage = globalThis.localStorage;
delete globalThis.localStorage;
check(
  'with storage unavailable it reports that rather than throwing',
  migrateLegacyStorage().unavailable === true
);
globalThis.localStorage = savedStorage;

// Nothing should have been renamed in the on-disk cards, because a card's
// digest is what citations name.
check(
  'the seed cards are untouched by the rename',
  baseDigest(cards) === 'd7d20f7e34df8dd4446c9f92bd4d21ce12ed83ec04c11525a317707c2d4eaec9',
  baseDigest(cards)
);

// ------------------------------------------------------------------- debates

const debate = {
  format: 'witness/debate',
  version: 1,
  id: 'hesed-untranslatable',
  motion: 'Rendering hesed as loving-kindness misleads a modern reader.',
  kind: 'disputation',
  created: '2026-01-01',
  terms: [
    { term: 'hesed', card: 'hesed', status: 'contested', note: 'pro reads it as covenant loyalty; con reads it as mercy', agreed: '' },
  ],
  sides: [
    { id: 'pro', name: 'A.', position: 'affirms', burden: 'show a modern reader is misled', languages: ['en'] },
    { id: 'con', name: 'B.', position: 'denies', burden: 'show the rendering carries the sense well enough', languages: ['en'] },
  ],
  moves: [
    { id: 'm1', side: 'pro', kind: 'opening', claim: 'The compound drifts toward sentiment.', warrant: '', evidence: [], targets: [], language: 'en' },
    { id: 'm2', side: 'con', kind: 'argument', claim: 'Readers meet the word and then read commentaries.', warrant: 'Translation is a first step.', evidence: [{ source: 'NRSV preface', card: 'hesed' }], targets: [], language: 'en' },
    {
      id: 'm3', side: 'pro', kind: 'objection',
      claim: 'The commentary only helps those who have it.',
      steelman: 'The objection grants that translations are read alongside commentary, and that the compound is the best single phrase available.',
      targets: ['m2'], evidence: [], language: 'en',
    },
  ],
  concessions: [{ move: 'm2', side: 'pro', state: 'contested', note: '' }],
  adjudication: { state: 'open', adjudicator: '', decision: '', reasons: '' },
  note: '',
};

const debateErrors = (value) => lintDebate(value).filter((f) => f.level === 'error');
const debateWarnings = (value) => lintDebate(value).filter((f) => f.level === 'warn');

check('a well-formed debate passes lint with no errors', debateErrors(debate).length === 0, JSON.stringify(debateErrors(debate)));
check('a blank debate is rejected', debateErrors(blankDebate()).length > 0);
check('a debate with no motion is rejected', debateErrors({ ...debate, motion: '' }).some((f) => f.path === 'motion'));
check('a topic masquerading as a motion is warned about', debateWarnings({ ...debate, motion: 'Translation' }).some((f) => f.path === 'motion'));

// Burden is the rule that separates a debate from two statements.
check(
  'a side with no burden is an error, not a suggestion',
  debateErrors({ ...debate, sides: [{ ...debate.sides[0], burden: '' }, debate.sides[1]] }).some((f) => f.path === 'sides[0].burden')
);
check('an unknown side on a move is an error', debateErrors({ ...debate, moves: [{ ...debate.moves[0], side: 'nobody' }] }).some((f) => f.path.startsWith('moves')));
check('duplicate move ids are an error', debateErrors({ ...debate, moves: [debate.moves[0], { ...debate.moves[1], id: 'm1' }] }).some((f) => f.message.includes('duplicate')));
check('a move answering a move that does not exist is an error', debateErrors({ ...debate, moves: [debate.moves[0], { ...debate.moves[2], targets: ['m9'] }] }).some((f) => f.path === 'moves[1].targets'));

// The rule the whole format exists for: no strawmen.
check(
  'an objection with no restatement of the other side is an error',
  debateErrors({ ...debate, moves: [debate.moves[0], debate.moves[1], { ...debate.moves[2], steelman: '' }] })
    .some((f) => f.path === 'moves[2].steelman')
);
check(
  'a restatement too short to be fair is warned about',
  debateWarnings({ ...debate, moves: [debate.moves[0], debate.moves[1], { ...debate.moves[2], steelman: 'they are wrong' }] })
    .some((f) => f.path === 'moves[2].steelman')
);
check(
  'an objection that answers nothing is an error',
  debateErrors({ ...debate, moves: [debate.moves[0], debate.moves[1], { ...debate.moves[2], targets: [] }] })
    .some((f) => f.message.includes('specific move'))
);

// Argument hygiene is flagged, not blocked.
check(
  'an argument citing nothing is warned about',
  debateWarnings({ ...debate, moves: [debate.moves[0], { ...debate.moves[1], evidence: [] }] }).some((f) => f.message.includes('cites nothing'))
);
check(
  'an argument with no warrant is warned about',
  debateWarnings({ ...debate, moves: [debate.moves[0], { ...debate.moves[1], warrant: '' }] }).some((f) => f.path === 'moves[1].warrant')
);

// Terms.
check(
  'an unpinned term with no explanation is an error',
  debateErrors({ ...debate, terms: [{ term: 'hesed', status: 'contested', note: '' }] }).some((f) => f.path === 'terms[0].note')
);
check(
  'a settled term needs the wording both sides accept',
  debateErrors({ ...debate, terms: [{ term: 'hesed', card: 'hesed', status: 'settled', agreed: '' }] }).some((f) => f.path === 'terms[0].agreed')
);
check('a debate with no terms pinned is warned about', debateWarnings({ ...debate, terms: [] }).some((f) => f.path === 'terms'));

// Adjudication: a human decides, or nobody does.
check(
  'a decision without a named adjudicator is an error',
  debateErrors({ ...debate, adjudication: { state: 'decided', decision: 'pro', reasons: 'because' } })
    .some((f) => f.path === 'adjudication.adjudicator')
);
check(
  'a decision without reasons is an error',
  debateErrors({ ...debate, adjudication: { state: 'decided', adjudicator: 'Someone', decision: 'pro' } })
    .some((f) => f.path === 'adjudication.reasons')
);
check(
  'deciding while a term is unpinned is warned about',
  debateWarnings({ ...debate, adjudication: { state: 'decided', adjudicator: 'Someone', decision: 'pro', reasons: 'reasons' } })
    .some((f) => f.message.includes('unpinned'))
);
check(
  'deciding with objections unanswered is warned about',
  debateWarnings({ ...debate, adjudication: { state: 'decided', adjudicator: 'Someone', decision: 'pro', reasons: 'reasons' } })
    .some((f) => f.message.includes('unanswered'))
);
check('an unresolved debate is a legitimate record', debateErrors({ ...debate, adjudication: { state: 'unresolved', reasons: 'nobody moved', adjudicator: '', decision: '' } }).length === 0);

// State: facts about the record.
const debateStateNow = debateState(debate);
check('an objection with no response is reported unanswered', debateStateNow.unanswered.length === 1);
check(
  'answering an objection clears it',
  debateState({
    ...debate,
    moves: [...debate.moves, { id: 'm4', side: 'con', kind: 'response', claim: 'Fair, but it still travels.', targets: ['m3'], evidence: [], language: 'en' }],
  }).unanswered.length === 0
);
check('moves are counted per side', debateStateNow.bySide.find((s) => s.side.id === 'pro').moves === 2);
check('stated burdens are reported', debateStateNow.bySide.every((entry) => entry.burdensStated));
check('an unpinned term is surfaced', debateStateNow.unpinnedTerms.length === 1);
check('terminologyFirst is false while a term is unpinned', debateStateNow.terminologyFirst === false);
check(
  'terminologyFirst is true once every term is settled',
  debateState({ ...debate, terms: [{ term: 'hesed', status: 'settled', agreed: 'the covenant loyalty of God' }] }).terminologyFirst === true
);
check('concessions are counted per side', debateStateNow.concessions.get('pro').contested === 1);
check('term cards relied on are aggregated from evidence', debateStateNow.reliedOn[0].card === 'hesed');
check('languages of the moves are collected', debateStateNow.languages.includes('en'));

// The rule this format exists to protect: it does not pick a winner.
check(
  'there is no score, points, or winner anywhere in the state',
  !['winner', 'score', 'points', 'verdict', 'ranking'].some((key) => key in debateStateNow)
);
const debateMarkdown = debateToMarkdown(debate);
check('the debate record says the counts are not a verdict', debateMarkdown.includes('not a verdict'));
check('the debate record prints the motion', debateMarkdown.includes('Rendering hesed as loving-kindness'));
check('the debate record prints the burdens', debateMarkdown.includes('must establish'));
check('the debate record marks an unanswered objection', debateMarkdown.includes('Left unanswered'));
check('the debate record prints the restatement', debateMarkdown.includes('Restated at its strongest'));
check('the debate record never claims a side won', !/\bwins\b|\bvictor/i.test(debateMarkdown));

check('nextMoveId increments', nextMoveId(debate) === 'm4');
check('nextMoveId starts at m1', nextMoveId({ moves: [] }) === 'm1');
check('debateSlug derives an id from the motion', debateSlug({ motion: 'Hesed is untranslatable!' }) === 'hesed-is-untranslatable');

// ------------------------------------------------- correspondence protocol

/** A debate both sides start from: same id, same pinned terms, same burdens. */
const sharedOpening = () => ({
  format: 'witness/debate',
  version: 1,
  id: 'hesed-untranslatable',
  motion: 'Rendering hesed as loving-kindness misleads a modern reader.',
  kind: 'disputation',
  created: '2026-01-01',
  terms: [{ term: 'hesed', card: 'hesed', status: 'contested', note: 'covenant loyalty vs mercy', agreed: '' }],
  sides: [
    { id: 'pro', name: 'A.', position: 'affirms', burden: 'show a modern reader is misled' },
    { id: 'con', name: 'B.', position: 'denies', burden: 'show the rendering carries the sense' },
  ],
  moves: [],
  concessions: [],
  adjudication: { state: 'open', adjudicator: '', decision: '', reasons: '' },
  note: '',
});

const move = (id, side, kind, claim, extra = {}) => ({
  id, side, kind, claim, language: 'en', targets: [], evidence: [], ...extra,
});

// Stamping.
const stamped = sharedOpening();
stamped.moves = [
  move('m1', 'pro', 'opening', 'The compound drifts toward sentiment.'),
  move('m2', 'con', 'argument', 'Readers meet the word then read commentaries.'),
];
const stampResult = stampChain(stamped, { at: '2026-01-02T00:00:00.000Z' });
check('stamping assigns a link and a digest to every move', stampResult.ok && stampResult.stamped === 2);
check('a stamped transcript verifies', verifyChain(stamped).state === 'intact');
check('each move records when it was made', stamped.moves[0].at === '2026-01-02T00:00:00.000Z');
check('the second move links to the first', stamped.moves[1].prev !== stamped.moves[0].prev);

// Tamper detection. This is the whole point of the chain.
const edited = structuredClone(stamped);
edited.moves[0].claim = 'The compound is fine actually.';
const editedCheck = verifyChain(edited);
check('editing a move is detected', editedCheck.state === 'broken');
check('the break is reported at the earliest edited move', editedCheck.index === 0);
check('the break names the reason as the contents', editedCheck.reason === 'content');

const editedLater = structuredClone(stamped);
editedLater.moves[1].claim = 'Something else entirely.';
check('editing the last move is detected too', verifyChain(editedLater).index === 1);

const reorderedMoves = structuredClone(stamped);
reorderedMoves.moves = [reorderedMoves.moves[1], reorderedMoves.moves[0]];
check('reordering moves is detected as a broken link', verifyChain(reorderedMoves).reason === 'link');

// A forward chain catches edits, reordering, and removal from the middle. It
// cannot catch that trailing moves were dropped, because a shorter chain still
// verifies. Worth stating as a limit rather than discovering it in the field:
// it is exactly why both sides keep a copy and compare transcript digests.
const threeMoves = sharedOpening();
threeMoves.moves = [
  move('m1', 'pro', 'opening', 'One.'),
  move('m2', 'con', 'argument', 'Two.'),
  move('m3', 'pro', 'response', 'Three.', { targets: ['m2'] }),
];
stampChain(threeMoves, { at: '2026-01-02T00:00:00.000Z' });

const cutMiddle = structuredClone(threeMoves);
cutMiddle.moves.splice(1, 1);
check('removing a move from the middle is detected', verifyChain(cutMiddle).state === 'broken');

const cutTail = structuredClone(threeMoves);
cutTail.moves.pop();
check('dropping trailing moves still verifies — a forward chain cannot see truncation', verifyChain(cutTail).state === 'intact');
check(
  'which is why the transcript digest is compared, not merely verified',
  transcriptDigest(cutTail.moves) !== transcriptDigest(threeMoves.moves)
);

check('an unstamped record is reported as unsigned, not broken', verifyChain(debate).state === 'unsigned');

const halfStamped = structuredClone(stamped);
stampChain(halfStamped);
halfStamped.moves.push(move('m3', 'pro', 'closing', 'Nothing further.'));
check('a half-stamped record is reported as partial', verifyChain(halfStamped).state === 'partial');

// Stamping must not launder an edit.
const laundering = structuredClone(stamped);
laundering.moves[0].claim = 'Rewritten.';
check('stamping refuses to re-stamp an edited move', stampChain(laundering).ok === false);
check('and it names the move', stampChain(laundering).index === 0);

// Digests.
check('a move digest changes when the move changes', moveDigest(stamped.moves[0]) !== moveDigest({ ...stamped.moves[0], claim: 'x' }));
check('a move digest is independent of key order', moveDigest(stamped.moves[0]) === moveDigest(Object.fromEntries(Object.entries(stamped.moves[0]).reverse())));
check('the transcript digest changes with any move', transcriptDigest(stamped.moves) !== transcriptDigest(edited.moves));
check('the transcript digest changes when moves are dropped', transcriptDigest(stamped.moves) !== transcriptDigest([stamped.moves[0]]));
check('the transcript digest is stable', transcriptDigest(stamped.moves) === transcriptDigest(stamped.moves));
check('the empty transcript has its own digest', transcriptDigest([]) !== transcriptDigest(stamped.moves));
check('terms digests agree on identical terms', termsDigest(stamped.terms) === termsDigest(sharedOpening().terms));
check(
  'terms digests differ when a term is reworded',
  termsDigest(stamped.terms) !== termsDigest([{ term: 'hesed', card: 'hesed', status: 'contested', note: 'something else' }])
);

// The exchange itself: A sends, B merges, B replies, A merges.
const sideA = sharedOpening();
sideA.moves = [move('m1', 'pro', 'opening', 'The compound drifts toward sentiment.')];
stampChain(sideA, { at: '2026-01-02T00:00:00.000Z' });

const contributionA = contributionFor(sideA, 'pro', { at: '2026-01-02T00:00:00.000Z' });
check('a contribution carries only its own side\u2019s moves', contributionA.moves.length === 1 && contributionA.moves[0].side === 'pro');
check('a contribution records what it was written against', contributionA.basedOn === transcriptDigest(sideA.moves));
check('a contribution carries the pinned terms', contributionA.format === 'witness/contribution');

const sideB = sharedOpening();
const mergeA = mergeContribution(sideB, contributionA);
check('B merges A\u2019s contribution', mergeA.ok && mergeA.added[0] === 'm1');
check('B now holds A\u2019s move intact', verifyChain(sideB).state === 'intact');
check('merging the same contribution again adds nothing', mergeContribution(sideB, contributionA).added.length === 0);

// B replies, then A merges the reply.
sideB.moves.push(move('m2', 'con', 'objection', 'Commentary reaches few readers.', {
  targets: ['m1'],
  steelman: 'The objection grants that the compound is the best single phrase available in English.',
}));
stampChain(sideB, { at: '2026-01-03T00:00:00.000Z' });
const contributionB = contributionFor(sideB, 'con');
const mergeB = mergeContribution(sideA, contributionB);
check('A merges B\u2019s reply, chained onto A\u2019s own move', mergeB.ok && mergeB.added[0] === 'm2');
check('the full exchange verifies end to end', verifyChain(sideA).state === 'intact');
check('both sides end up holding the same transcript', transcriptDigest(sideA.moves) === transcriptDigest(sideB.moves));
check('the merged debate still passes lint', debateErrors(sideA).length === 0, JSON.stringify(debateErrors(sideA)));

// Refusals. A merge that quietly reorganises somebody's argument is worse than one that fails.
const tampered = structuredClone(contributionA);
tampered.moves[0].claim = 'A said something they did not say.';
const tamperedResult = mergeContribution(sharedOpening(), tampered);
check('a contribution whose move was edited is rejected', !tamperedResult.ok && tamperedResult.conflicts.length === 1);
check('the rejection explains that it was altered after stamping', tamperedResult.conflicts[0].reason.includes('altered'));

const contradictory = structuredClone(contributionA);
contradictory.moves[0].claim = 'Different claim, same id.';
const contradictionResult = mergeContribution(sideA, contradictory);
check('a move contradicting one already held is rejected', !contradictionResult.ok);
check('and the conflict names the move', contradictionResult.conflicts[0].id === 'm1');

// A holds one of its own moves that B has never seen, so B's reply cannot chain
// onto it. Note the fixture is built from A's move as A actually sent it, not
// from a clone of A's current state: mergeContribution mutates the debate it
// merges into, so cloning that would silently include B's reply already.
const ahead = sharedOpening();
ahead.moves = [structuredClone(contributionA.moves[0]), move('m9', 'pro', 'argument', 'A move A never sent.')];
stampChain(ahead);
const joinsBadly = mergeContribution(ahead, contributionB);
check('a contribution written against an unseen transcript is refused', !joinsBadly.ok);
check('and the refusal explains the divergence', joinsBadly.messages.some((m) => m.includes('has not seen')));

check('a file that is not a contribution is refused', !mergeContribution(sharedOpening(), { format: 'nope' }).ok);
check('a contribution for another debate is refused', !mergeContribution({ ...sharedOpening(), id: 'other' }, contributionA).ok);

// Terms divergence is the check worth having: you may not be arguing about the same words.
const drifted = sharedOpening();
drifted.terms = [{ term: 'hesed', card: 'hesed', status: 'settled', agreed: 'mercy, simply' }];
const driftResult = mergeContribution(drifted, contributionA);
check('differing pinned terms are surfaced, not merged', driftResult.termsDiverged === true);
check('the merge still completes so the exchange is not blocked', driftResult.ok);
check('and it says to check the words before arguing further', driftResult.messages.some((m) => m.includes('same words')));
check('the incoming terms are handed back for inspection', driftResult.incomingTerms.length === 1);

// The deliberate escape hatch, for correcting your own unexchanged words.
const brokenThenFixed = structuredClone(stamped);
brokenThenFixed.moves[0].claim = 'Corrected before sending.';
check('a corrected move leaves the record unverifiable', verifyChain(brokenThenFixed).state === 'broken');
restampAll(brokenThenFixed, { at: '2026-01-04T00:00:00.000Z' });
check('re-stamping is the deliberate way out', verifyChain(brokenThenFixed).state === 'intact');
check(
  'and it moves the transcript revision, so a copy held by the other side stops matching',
  transcriptDigest(brokenThenFixed.moves) !== transcriptDigest(stamped.moves)
);
check('re-stamping is never automatic', verifyChain(structuredClone(stamped)).state === 'intact');

// Two rules about who may say what.
check(
  'a side cannot answer its own move',
  debateErrors({
    ...debate,
    moves: [debate.moves[0], { ...debate.moves[2], targets: ['m1'] }],
  }).some((f) => f.message.includes('cannot answer its own move'))
);
check(
  'the same side speaking twice in a row is warned about',
  debateWarnings({ ...debate, moves: [debate.moves[0], { ...debate.moves[1], side: 'pro' }, debate.moves[2]] })
    .some((f) => f.message.includes('previous move'))
);

// -------------------------------------------------------------- debating room

const room = blankSession();
room.motion = 'Rendering hesed as loving-kindness misleads a modern reader.';

check('a new session starts on the first phase with a running clock at zero', room.phaseIndex === 0 && room.elapsed === 0);
check('a motion suggests burdens for both sides', suggestBurden(room.motion, 'a').includes('Establish that'));
check('the denying burden is not just the affirming one reversed', suggestBurden(room.motion, 'a') !== suggestBurden(room.motion, 'b'));
check('every format has phases', FORMAT_KEYS.every((key) => FORMATS[key].phases.length > 0));
check('format keys are stable', FORMAT_KEYS.join(',') === 'freeform,one-on-one,parliamentary');
check('the clock formats minutes and seconds', formatClock(305) === '05:05' && formatClock(0) === '00:00');

// The clock.
room.formatKey = 'parliamentary';
const first = roomClock(room);
check('the room starts in prep, with no floor', first.phase.kind === 'prep' && first.floor === null && first.isOpen);
check('the first phase counts down from its own length', first.remaining === FORMATS.parliamentary.phases[0].seconds);
room.elapsed = 100;
check('the clock counts down as time passes', roomClock(room).remaining === FORMATS.parliamentary.phases[0].seconds - 100);
room.elapsed = FORMATS.parliamentary.phases[0].seconds + 12;
const overrun = roomClock(room);
check('time up is reported rather than silently wrapped', overrun.over === true && overrun.overrun === 12);
check('and it shows how far over', overrun.text === '+00:12');
check('advancing moves to the next phase and resets the clock', advancePhase(room) && room.phaseIndex === 1 && room.elapsed === 0);
check('the floor is now the affirming side', roomClock(room).floor === 'a' && !roomClock(room).isOpen);
check('the second phase in parliamentary debate takes two points', currentPhase(room).pointsAllowed === 2);

// Points of information. The rule that keeps a room listening.
room.elapsed = 5;
check('no point may be raised in the opening seconds', !canRaisePoint(room, 'b').ok);
check('and it says why', canRaisePoint(room, 'b').reason.includes('seconds in'));
check('the side with the floor cannot raise points of information at their own speech', !canRaisePoint(room, 'a').ok);
room.elapsed = 60;
check('once the grace period has passed the opposition may raise one', canRaisePoint(room, 'b').ok);
check('and it knows how many are left', pointsRemaining(room, 'b') === 2);
const raised = raisePoint(room, 'b', { text: 'Is that true of the Septuagint?' });
check('raising a point records it against the phase', raised.ok && room.points.length === 1);
check('a raised point reduces what is left', pointsRemaining(room, 'b') === 1);
raisePoint(room, 'b', { text: 'Second point.' });
raisePoint(room, 'b', { text: 'Third point.' });
check('no more than the phase allows', pointsRemaining(room, 'b') === 0);
check('a further attempt is refused', !raisePoint(room, 'b', { text: 'Fourth.' }).ok);
settlePoint(room, 'poi1', 'accepted');
check('a point can be accepted or declined', room.points[0].state === 'accepted');
check('settling a point that does not exist fails cleanly', !settlePoint(room, 'nope', 'accepted').ok);

// Arguments: two fields, one keystroke.
const noClaim = addCard(room, 'a', { support: 'something' });
check('a card with no claim is refused', !noClaim.ok);
const cardA = addCard(room, 'a', { claim: 'The compound drifts toward sentiment.', support: 'Coverdale coined it in 1535.' });
check('adding an argument takes a claim and a reason', cardA.ok && room.cards.length === 1);
check('the card records which phase it was made in', room.cards[0].phase === currentPhase(room).name);
addCard(room, 'b', { claim: 'Readers meet the word with commentary.' });
check('the tally counts arguments per side', roomTally(room).find((side) => side.key === 'a').cards === 1);
check('and counts which of them had a reason given', roomTally(room).find((side) => side.key === 'b').withSupport === 0);
check('a card can be removed', removeCard(room, cardA.card.id) === 1);

// Conversion: the rules apply here, not in the room.
addCard(room, 'a', { claim: 'The compound drifts toward sentiment.', support: 'Coverdale coined it in 1535.' });
room.sides.a.burden = suggestBurden(room.motion, 'a');
room.sides.b.burden = suggestBurden(room.motion, 'b');
room.ballot = { judge: 'A named judge', decision: 'a', reasons: 'The affirmative showed the drift.' };
const record = sessionToDebate(room);
check('the room becomes a debate record', record.format === 'witness/debate' && record.moves.length === 2);
check('the record has both sides with their burdens', record.sides.length === 2 && record.sides[0].burden.length > 0);
check('arguments become moves in the order they were made', record.moves[1].claim.includes('drifts toward sentiment'));
check('the reason given becomes the warrant', record.moves[1].warrant.includes('Coverdale'));
check('every card becomes an argument, whatever phase it was made in', record.moves.every((move) => move.kind === 'argument'));
check('no evidence is invented', record.moves.every((move) => move.evidence.length === 0));
check('points of information are carried across as procedure, not as arguments', record.procedural.length === 2);
check('the ballot becomes an adjudication by a named person', record.adjudication.state === 'decided' && record.adjudication.adjudicator === 'A named judge');
check('the converted record passes lint with no errors', debateErrors(record).length === 0, JSON.stringify(debateErrors(record)));
check(
  'and it warns that the room cited nothing, which is the honest account',
  debateWarnings(record).some((f) => f.message.includes('cites nothing'))
);

const noBallot = sessionToDebate({ ...blankSession(), motion: room.motion, sides: room.sides, cards: room.cards });
check('a room with no ballot is recorded as unresolved, not decided', noBallot.adjudication.state === 'unresolved');

const roomMarkdown = sessionToMarkdown(room);
check('the session transcript names both sides', roomMarkdown.includes('affirms') && roomMarkdown.includes('denies'));
check('the session transcript lists the points of information', roomMarkdown.includes('Points of information'));
check('the session transcript records the ballot', roomMarkdown.includes('A named judge'));
check('the session transcript refuses to invent a decision when there is none', sessionToMarkdown(blankSession()).includes('No decision recorded'));
check('sessionId derives from the motion', sessionId(room) === 'rendering-hesed-as-loving-kindness-misleads-a-modern-reader');
check('advancePhase stops at the end', (() => {
    const walk = blankSession();
    let steps = 0;
    while (advancePhase(walk) && steps < 50) steps += 1;
    return steps === phasesFor(walk).length - 1 && lastPhase(walk);
  })());

// Motions drawn from the term base: a base is a poor home page and a good
// source of things to argue about.
const suggested = motionsFor(cards);
check('motions are drawn from the cards', suggested.length > 0);
check('a motion is a proposition, not a topic', suggested.every((motion) => motion.includes(' ') && motion.length > 20));
check('a recorded loss becomes a motion about the rendering', suggested.some((motion) => /Rendering/.test(motion)));
check('no raw language codes leak into a motion a person has to read aloud', !suggested.some((motion) => /\binto [a-z]{2}\b|\[(en|he|ar|grc|la)\]/.test(motion)));
check('and each card also offers the untranslatable claim', suggested.some((motion) => /is untranslatable/.test(motion)));
check('motions respect the limit', motionsFor(cards, { limit: 2 }).length === 2);
check('no motions from an empty base', motionsFor([]).length === 0);
check('a card with no label is skipped rather than crashing', motionsFor([{ renditions: [] }]).length === 0);



// ------------------------------------------------------------------ report

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
