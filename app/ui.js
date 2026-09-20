/**
 * Read views: the term base, a card, the loss ledger, the language matrix, and
 * the comparison view.
 *
 * Authoring views live in editor.js. The split is deliberate: everything here is
 * safe to open for anyone, and everything there can create content.
 *
 * All rendering goes through dom.js, which is where the textContent and
 * dir="auto" rules are enforced.
 */

import { el, bdi, block, langChip, definitionList, languageText, langName, clear } from './dom.js';
import { STATUS_LABELS } from './search.js';

// ------------------------------------------------------------------ shared bits

export function button(label, onClick, props = {}) {
  return el('button', { type: 'button', text: label, on: { click: onClick }, ...props });
}

export function statusBadge(status) {
  const tone = {
    equivalent: 'ok',
    'nearest-no-equivalent': 'warn',
    contested: 'alert',
    undefined: 'muted',
    'transliterate-only': 'muted',
    'do-not-translate': 'muted',
  }[status] || 'muted';
  return el('span', { class: `status status-${tone}`, text: STATUS_LABELS[status] || status });
}

export function sectionHeading(text, { note } = {}) {
  return el('div', { class: 'section-head' },
    el('h3', { text }),
    note ? block('p', note, { class: 'hint' }) : null
  );
}

function actionsBar(...children) {
  return el('div', { class: 'actions' }, ...children);
}

function reviewedChips(card) {
  const reviewers = (card.contributors || []).filter((c) => c.role === 'reviewer');
  return reviewers.length
    ? el('li', { class: 'chip chip-ok', text: `reviewed by ${reviewers.map((r) => r.name).join(', ')}` })
    : el('li', { class: 'chip chip-warn', text: 'unreviewed — no named reviewer has signed this card' });
}

function sourceLine(basis) {
  if (!basis) return null;
  return el('p', { class: 'basis' },
    el('span', { class: 'basis-label', text: 'Basis: ' }),
    block('span', basis.citation, { class: 'citation' }),
    el('span', { class: 'source-meta' },
      basis.locator ? ` · ${basis.locator}` : '',
      basis.tradition ? ` · ${basis.tradition}` : '',
      basis.language ? ` · ${languageText(basis.language)}` : ''
    )
  );
}

// --------------------------------------------------------------- search panel

export function buildSearchPanel({ onQuery, onFilter, onReset, onPermalink, onExport, onPrint }) {
  const input = el('input', {
    id: 'q',
    type: 'search',
    name: 'q',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'hesed, steadfast love, covenant…',
    'aria-describedby': 'q-hint',
    on: { input: (event) => onQuery(event.target.value) },
  });

  const form = el(
    'form',
    { class: 'search', role: 'search', on: { submit: (event) => event.preventDefault() } },
    el('label', { for: 'q', text: 'Search' }),
    input,
    el('p', {
      id: 'q-hint',
      class: 'hint',
      text: 'Every word must match. Use "quotes" to keep a phrase together. Search covers sources and the recorded losses, not just the terms.',
    })
  );

  const filters = el('div', { class: 'filter-groups' });
  const filterBox = el(
    'details',
    { class: 'filters', id: 'filters' },
    el('summary', { text: 'Filter by language, status, or tradition' }),
    filters,
    actionsBar(button('Clear filters', onReset, { class: 'ghost' }))
  );

  const count = el('p', { class: 'count', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'results' });
  const toolbar = el('div', { class: 'actions' },
    button('Copy link to this search', onPermalink, { class: 'ghost' }),
    button('Print these results', onPrint, { class: 'ghost' }),
    button('Export results as CSV', () => onExport('csv'), { class: 'ghost' }),
    button('Export results as TBX', () => onExport('tbx'), { class: 'ghost' })
  );

  const node = el('section', { class: 'panel', 'aria-labelledby': 'search-heading' },
    el('h2', { id: 'search-heading', class: 'visually-hidden', text: 'Search the term base' }),
    form,
    filterBox
  );

  return {
    node,
    input,
    count,
    results,
    toolbar,
    /** Reflect state that came from the URL, without firing the change handler. */
    setQuery(value) {
      input.value = value;
    },
    setFacets(facetData, active) {
      filters.replaceChildren(
        facetFieldset('Language of rendering', 'languages', facetData.languages, active.languages, onFilter, (tag) => `${langName(tag)} (${tag})`),
        facetFieldset('Language the concept came from', 'originLanguages', facetData.originLanguages, active.originLanguages, onFilter, (tag) => `${langName(tag)} (${tag})`),
        facetFieldset('Status', 'statuses', facetData.statuses, active.statuses, onFilter, (s) => STATUS_LABELS[s] || s),
        facetFieldset('Tradition', 'traditions', facetData.traditions, active.traditions, onFilter)
      );
    },
  };
}

function facetFieldset(legend, name, values, activeSet, onFilter, label = (v) => v) {
  const items = values.map(([value, count]) =>
    el('li', {},
      el('label', { class: 'facet' },
        el('input', {
          type: 'checkbox',
          checked: activeSet.has(value),
          on: {
            change: (event) => {
              if (event.target.checked) activeSet.add(value);
              else activeSet.delete(value);
              onFilter(name);
            },
          },
        }),
        el('span', { auto: label(value) }),
        el('span', { class: 'facet-count', text: count })
      )
    )
  );
  return el('fieldset', { class: 'facet-group' },
    el('legend', { text: legend }),
    el('ul', { class: 'facets' }, items)
  );
}

// ------------------------------------------------------------------ list item

export function cardListItem(entry, why) {
  const { card } = entry;
  const review = (card.contributors || []).some((c) => c.role === 'reviewer');
  const losses = card.renditions.filter((r) => r.loss).length;

  return el('li', { class: 'card-item' },
    el('a', { href: `#/term/${encodeURIComponent(card.id)}` },
      el('span', { class: 'card-title', auto: card.concept.label }),
      el('span', { class: 'card-langs' },
        entry.languages.map(langChip),
        el('span', { class: 'lang', text: `${card.renditions.length} rendering${card.renditions.length === 1 ? '' : 's'}` }),
        losses ? el('span', { class: 'lang', text: `${losses} loss${losses === 1 ? '' : 'es'} recorded` }) : null,
        review ? null : el('span', { class: 'status status-warn', text: 'unreviewed' })
      ),
      block('span', card.concept.gloss, { class: 'card-gloss' })
    ),
    why.length ? el('p', { class: 'matched', text: `matched in ${why.join(', ')}` }) : null
  );
}

// ---------------------------------------------------------------- detail view

export function termView(card, { digest, baseRevision, cards, actions }) {
  const renditions = [...card.renditions].sort(
    (a, b) => a.language.localeCompare(b.language) || a.rendering.localeCompare(b.rendering)
  );
  const related = (card.concept.related || [])
    .map((id) => cards.find((c) => c.id === id))
    .filter(Boolean);

  return el('article', { class: 'term' },
    el('p', { class: 'crumb' }, el('a', { href: '#/', text: '← Term base' })),

    el('header', { class: 'term-head' },
      block('h2', card.concept.label, { class: 'term-title', tabindex: '-1' }),
      block('p', card.concept.gloss, { class: 'term-gloss' }),
      el('ul', { class: 'chips' },
        (card.concept.domains || []).map((d) => el('li', { class: 'chip', auto: d })),
        card.concept.register ? el('li', { class: 'chip chip-muted', auto: card.concept.register }) : null,
        reviewedChips(card)
      )
    ),

    card.origin?.term ? el('section', { class: 'section' },
      el('h3', { text: 'Origin' }),
      block('p', card.origin.term, { class: 'origin-term', lang: card.origin.language, dir: 'auto' }),
      definitionList([
        ['Language', card.origin.language ? languageText(card.origin.language) : null],
        ['Script', card.origin.script],
        ['Transliteration', card.origin.transliteration],
        ['Pronunciation', card.origin.pronunciation],
      ])
    ) : null,

    el('section', { class: 'section' },
      el('h3', { text: 'Renditions, and what each one loses' }),
      el('ol', { class: 'renditions' }, renditions.map((rendition) => renditionItem(rendition)))
    ),

    (card.disputes || []).length ? el('section', { class: 'section' },
      el('h3', { text: 'Recorded disagreement' }),
      el('p', { class: 'hint', text: 'Recorded, not resolved. A term base that settles disputes in its own favour is not a commons.' }),
      el('ul', { class: 'disputes' }, card.disputes.map((dispute) =>
        el('li', {},
          block('p', dispute.position, { class: 'dispute-position' }),
          block('p', `Held by: ${dispute.held_by}`, { class: 'dispute-held' }),
          dispute.response ? block('p', `In response: ${dispute.response}`, { class: 'dispute-response' }) : null,
          sourceLine(dispute.basis)
        )
      ))
    ) : null,

    el('section', { class: 'section' },
      el('h3', { text: 'Sources' }),
      el('ul', { class: 'sources' }, card.sources.map((source) =>
        el('li', {},
          block('span', source.citation, { class: 'citation' }),
          el('span', { class: 'source-meta' },
            source.locator ? bdi(source.locator) : null,
            source.tradition ? bdi(` · ${source.tradition}`) : null,
            source.language ? ` · ${languageText(source.language)}` : null,
            source.edition ? bdi(` · ${source.edition}`) : null,
            source.url ? el('a', { href: source.url, rel: 'noreferrer noopener', target: '_blank', text: ' · link' }) : null
          )
        )
      ))
    ),

    related.length ? el('section', { class: 'section' },
      el('h3', { text: 'Related concepts' }),
      el('ul', { class: 'related' }, related.map((other) =>
        el('li', {}, el('a', { href: `#/term/${encodeURIComponent(other.id)}`, auto: other.concept.label }))
      ))
    ) : null,

    card.provenance_note ? el('section', { class: 'section' },
      el('h3', { text: 'How this card came to exist' }),
      block('p', card.provenance_note, { class: 'provenance' })
    ) : null,

    el('section', { class: 'section provenance-block' },
      el('h3', { text: 'Provenance' }),
      el('p', { class: 'hint', text: 'Cite the card revision, not just the id. The id is stable; the contents are not.' }),
      definitionList([
        ['Card id', card.id],
        ['Card revision', digest.slice(0, 16)],
        ['Base revision', baseRevision ? baseRevision.slice(0, 16) : null],
        ['Data licence', card.license || 'CC-BY-SA-4.0'],
      ]),
      actionsBar(
        button('Copy citation', () => actions.cite(card.id)),
        button('Copy as Markdown', () => actions.copyMarkdown(card.id), { class: 'ghost' }),
        button('Copy BibTeX', () => actions.copyBibtex(card.id), { class: 'ghost' }),
        button('Copy link', () => actions.copyLink(`/term/${card.id}`), { class: 'ghost' }),
        button('Download card JSON', () => actions.downloadCard(card.id), { class: 'ghost' }),
        button('Compare with…', () => actions.compare(card.id), { class: 'ghost' }),
        button('Edit as a draft', () => actions.editDraft(card.id), { class: 'ghost' }),
        button('Print this card', () => window.print(), { class: 'ghost' })
      )
    )
  );
}

function renditionItem(rendition) {
  const alternatives = rendition.alternatives || [];
  return el('li', { class: 'rendition' },
    el('div', { class: 'rendition-head' },
      bdi(rendition.rendering, rendition.language),
      langChip(rendition.language),
      statusBadge(rendition.status),
      rendition.tradition ? el('span', { class: 'tradition', auto: rendition.tradition }) : null
    ),
    rendition.transliteration && rendition.transliteration !== rendition.rendering
      ? el('p', { class: 'translit', auto: `transliterated: ${rendition.transliteration}` })
      : null,
    rendition.loss
      ? block('p', rendition.loss, { class: `loss loss-${rendition.status === 'equivalent' ? 'none' : 'real'}` })
      : el('p', { class: 'loss loss-none', text: 'No loss recorded.' }),
    alternatives.length
      ? el('details', { class: 'alternatives' },
          el('summary', { text: `Rejected alternatives (${alternatives.length})` }),
          el('ul', {}, alternatives.map((alt) =>
            el('li', {},
              block('span', alt.rendering, { class: 'rendering' }),
              block('span', alt.rejected_because, { class: 'rejected' })
            )
          ))
        )
      : null,
    sourceLine(rendition.basis)
  );
}

// --------------------------------------------------------------- loss ledger

/**
 * Every recorded loss in one place, so patterns become visible. The recurring
 * finding in this domain is that a whole family of concepts gets flattened into
 * one borrowed word, and you can only see that in aggregate.
 */
export function lossesView(cards, { onExport, actions }) {
  const renditions = cards.flatMap((card) => card.renditions.map((rendition) => ({ card, rendition })));
  const withLoss = renditions.filter(({ rendition }) => rendition.loss);
  const languages = new Set(renditions.map(({ rendition }) => rendition.language));
  const unreviewed = cards.filter((card) => !(card.contributors || []).some((c) => c.role === 'reviewer'));
  const contested = renditions.filter(({ rendition }) => rendition.status === 'contested');

  const byStatus = new Map();
  for (const entry of withLoss) {
    const list = byStatus.get(entry.rendition.status) || [];
    list.push(entry);
    byStatus.set(entry.rendition.status, list);
  }

  return el('article', { class: 'ledger' },
    el('h2', { text: 'Loss ledger', tabindex: '-1' }),
    el('p', { class: 'lede', text: 'What each language does to each concept, according to the source cited for each card. Read together, the losses are the interesting part: the same borrowed word shows up again and again, doing work it cannot do.' }),

    el('ul', { class: 'stats' },
      stat(cards.length, 'concepts'),
      stat(renditions.length, 'renderings'),
      stat(languages.size, 'languages'),
      stat(withLoss.length, 'with a recorded loss'),
      stat(contested.length, 'contested'),
      stat(unreviewed.length, 'cards unreviewed')
    ),

    actionsBar(
      button('Copy the losses as Markdown', () => onExport('markdown')),
      button('Export CSV', () => onExport('csv'), { class: 'ghost' }),
      button('Export TBX for translators', () => onExport('tbx'), { class: 'ghost' }),
      button('Print', () => window.print(), { class: 'ghost' })
    ),

    [...byStatus.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([status, entries]) =>
        el('section', { class: 'section' },
          el('h3', {}, STATUS_LABELS[status] || status, ' ', el('span', { class: 'lang', text: `${entries.length}` })),
          el('ul', { class: 'loss-list' }, entries.map(({ card, rendition }) =>
            el('li', {},
              el('p', { class: 'loss-head' },
                el('a', { href: `#/term/${encodeURIComponent(card.id)}` }, bdi(card.concept.label, card.origin?.language)),
                el('span', { text: ' → ' }),
                bdi(rendition.rendering, rendition.language),
                langChip(rendition.language)
              ),
              block('p', rendition.loss, { class: 'loss' }),
              sourceLine(rendition.basis)
            )
          ))
        )
      ),

    !withLoss.length ? el('p', { class: 'message', text: 'No losses recorded yet.' }) : null
  );
}

export function stat(value, label) {
  return el('li', { class: 'stat' },
    el('span', { class: 'stat-value', text: value }),
    el('span', { class: 'stat-label', text: label })
  );
}

// -------------------------------------------------------------------- matrix

/** Concepts against languages. A quick way to see the shape of the base. */
export function matrixView(cards, actions) {
  const languages = new Map();
  for (const card of cards) {
    for (const rendition of card.renditions) {
      languages.set(rendition.language, (languages.get(rendition.language) || 0) + 1);
    }
  }
  const columns = [...languages.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code]) => code);

  return el('article', { class: 'matrix' },
    el('h2', { text: 'Concepts by language', tabindex: '-1' }),
    el('p', { class: 'lede', text: 'Coverage, not quality. An empty cell means nobody has recorded a rendering in that language, which is usually a statement about the base rather than about the word.' }),

    el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {},
          el('tr', {},
            el('th', { scope: 'col', text: 'Concept' }),
            columns.map((code) => el('th', { scope: 'col', title: langName(code), text: code }))
          )
        ),
        el('tbody', {},
          cards.map((card) =>
            el('tr', {},
              el('th', { scope: 'row' },
                el('a', { href: `#/term/${encodeURIComponent(card.id)}` }, bdi(card.concept.label, card.origin?.language))
              ),
              columns.map((code) => {
                const rendition = card.renditions.find((r) => r.language === code);
                if (!rendition) return el('td', { class: 'cell-empty', text: '·' });
                return el('td', {
                  class: `cell cell-${statusTone(rendition.status)}`,
                  title: `${rendition.rendering} — ${STATUS_LABELS[rendition.status] || rendition.status}`,
                }, bdi(rendition.rendering, code));
              })
            )
          )
        )
      )
    ),

    actionsBar(
      button('Copy link to this table', () => actions.copyLink('/matrix'), { class: 'ghost' }),
      button('Print', () => window.print(), { class: 'ghost' })
    )
  );
}

function statusTone(status) {
  if (status === 'equivalent') return 'ok';
  if (status === 'contested') return 'alert';
  if (status === 'undefined' || status === 'transliterate-only' || status === 'do-not-translate') return 'muted';
  return 'warn';
}

// ------------------------------------------------------------------- compare

/**
 * Two concepts, or two traditions, side by side. This is the preparation screen:
 * it lines up the renderings that share a language so you can see where two
 * traditions reached for the same word, which is usually where the trouble is.
 */
export function compareView(cards, { a, b, actions }) {
  const left = cards.find((c) => c.id === a) || null;
  const right = cards.find((c) => c.id === b) || null;

  const picker = (side, selected, onChange) =>
    el('label', { class: 'compare-picker' },
      el('span', { text: side === 'a' ? 'First' : 'Second' }),
      el('select', { on: { change: (event) => onChange(event.target.value) } },
        el('option', { value: '', text: 'choose a concept…' }),
        cards.map((card) => el('option', {
          value: card.id,
          selected: card.id === selected,
          text: card.concept.label,
        }))
      )
    );

  const sharedLanguages = left && right
    ? [...new Set([
        ...left.renditions.map((r) => r.language),
        ...right.renditions.map((r) => r.language),
      ])].sort()
    : [];

  return el('article', { class: 'compare' },
    el('h2', { text: 'Compare two concepts', tabindex: '-1' }),
    el('p', { class: 'lede', text: 'Where two traditions reached for the same word is usually where the misunderstanding lives. This puts the recorded losses next to each other so you can see it before you are in a room arguing about it.' }),

    el('div', { class: 'compare-controls' },
      picker('a', a, (value) => actions.setCompare('a', value)),
      picker('b', b, (value) => actions.setCompare('b', value))
    ),

    left && right ? el('div', { class: 'compare-grid' },
      compareColumn(left, 'left'),
      compareColumn(right, 'right')
    ) : el('p', { class: 'message', text: 'Pick two concepts to compare.' }),

    left && right && sharedLanguages.length ? el('section', { class: 'section' },
      sectionHeading('By language', { note: 'Only the languages where at least one of the two has a recorded rendering.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'compare-table' },
          el('thead', {},
            el('tr', {},
              el('th', { scope: 'col', text: 'Language' }),
              el('th', { scope: 'col' }, bdi(left.concept.label, left.origin?.language)),
              el('th', { scope: 'col' }, bdi(right.concept.label, right.origin?.language))
            )
          ),
          el('tbody', {}, sharedLanguages.map((code) => {
            const leftRendition = left.renditions.find((r) => r.language === code);
            const rightRendition = right.renditions.find((r) => r.language === code);
            return el('tr', { class: leftRendition && rightRendition ? 'shared' : '' },
              el('th', { scope: 'row' }, langChip(code)),
              el('td', {}, leftRendition
                ? el('div', {}, bdi(leftRendition.rendering, code), ' ', statusBadge(leftRendition.status), leftRendition.loss ? block('p', leftRendition.loss, { class: 'loss loss-small' }) : null)
                : el('span', { class: 'cell-empty', text: '·' })),
              el('td', {}, rightRendition
                ? el('div', {}, bdi(rightRendition.rendering, code), ' ', statusBadge(rightRendition.status), rightRendition.loss ? block('p', rightRendition.loss, { class: 'loss loss-small' }) : null)
                : el('span', { class: 'cell-empty', text: '·' }))
            );
          }))
        )
      )
    ) : null,

    actionsBar(
      left && right ? button('Copy link to this comparison', () => actions.copyLink(`/compare?a=${left.id}&b=${right.id}`), { class: 'ghost' }) : null,
      button('Print', () => window.print(), { class: 'ghost' })
    )
  );
}

function compareColumn(card, side) {
  return el('section', { class: `compare-column ${side}` },
    block('h3', card.concept.label, { tabindex: '-1' }),
    el('p', { class: 'crumb' }, el('a', { href: `#/term/${encodeURIComponent(card.id)}`, text: 'Open the full card →' })),
    block('p', card.concept.gloss, { class: 'term-gloss' }),
    card.origin?.term ? block('p', card.origin.term, { class: 'origin-term small', lang: card.origin.language, dir: 'auto' }) : null,
    el('ul', { class: 'chips' }, reviewedChips(card))
  );
}

// --------------------------------------------------------------------- about

export function aboutView({ count, baseRevision, stats }) {
  return el('article', { class: 'about' },
    el('h2', { text: 'About Witness', tabindex: '-1' }),
    el('p', { text: 'A cited term base for interfaith translation. Every card records how each tradition renders a concept and, more importantly, what each rendering loses. "No equivalent" is a citable claim here, not a failure state.' }),
    el('p', { text: `This deployment carries ${count} card${count === 1 ? '' : 's'} at base revision ${baseRevision ? baseRevision.slice(0, 16) : 'unknown'}${stats ? `, spanning ${stats.languages} languages and ${stats.renditions} renderings` : ''}.` }),

    el('h3', { text: 'What this tool is not' }),
    el('ul', {},
      el('li', { text: 'Not a translator. It never renders your sentence into another language, and it never claims a loss it cannot name.' }),
      el('li', { text: 'Not an authority. Cards state who said what and on what basis. Unreviewed cards say so.' }),
      el('li', { text: 'Not a machine reader. It cannot tell whether two texts mean the same thing, so it never tries: divergences are declared by named people, and the only automatic comparison it makes is counting words.' }),
      el('li', { text: 'Not a place for case data. See below.' })
    ),

    el('h3', { text: 'The line that cannot be crossed' }),
    el('p', { text: 'This site is public and its repository is public. Nothing here is confidential.' }),
    el('ul', {},
      el('li', { text: 'Term cards: public by design. They are a commons.' }),
      el('li', { text: 'Statements: drafts and approvals stay in your browser, on your device. You export a file when you are ready to circulate it.' }),
      el('li', { text: 'Restorative justice case files: never uploaded. Not here, not on any server. Local to the device, exported as files the people involved can hold.' })
    ),
    el('p', { text: 'If a future feature would require uploading a harmed person’s statement to a server, that feature does not get built.' }),

    el('h3', { text: 'Contributing' }),
    el('p', {}, 'You can write a card here without git: use the ', el('a', { href: '#/author', text: 'card editor' }), ', then export the JSON. Or see ', el('code', { text: 'CONTRIBUTING.md' }), ' in the repository.'),

    el('h3', { text: 'Licences' }),
    el('ul', {},
      el('li', { text: 'Code: AGPL-3.0. A closed hosted fork of this is the failure worth preventing.' }),
      el('li', { text: 'Data: CC BY-SA 4.0. The commons should be forkable and must stay a commons.' })
    )
  );
}

// ------------------------------------------------------------------- messages

export function messageView(title, body, { tone = 'info' } = {}) {
  return el('div', { class: `message message-${tone}` },
    el('h2', { text: title, tabindex: '-1' }),
    typeof body === 'string' ? el('p', { text: body }) : body
  );
}

export { clear };
