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
  format: 'colophon/statement',
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
  parseCardsInput(JSON.stringify({ format: 'colophon/term-base', cards })).length === cards.length
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
check('filename slugs safely', filename('card', 'My Card!', 'json') === 'colophon-card-my-card.json');

// ------------------------------------------------------------------ permalinks

const encoded = encodeSearch({ query: 'covenant "steadfast love"', filters: { languages: new Set(['la', 'en']), statuses: new Set(['contested']) } });
const decoded = decodeSearch(encoded);
check('search query survives a permalink', decoded.query === 'covenant "steadfast love"');
check('filter sets survive a permalink', decoded.filters.languages.has('la') && decoded.filters.languages.has('en'));
check('unset facets decode to empty sets', decoded.filters.traditions.size === 0);
check('an empty search encodes to nothing', encodeSearch({}) === '');
check('an empty string decodes to an empty search', decodeSearch('').query === '');

// ------------------------------------------------------------------ report

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
