/**
 * Authoring views: the card editor, the statement editor, drafts, and settings.
 *
 * Everything here writes to local storage and to files. Nothing here talks to a
 * server, and nothing here should ever gain the ability to. The material this
 * tool is built to handle includes other people's harm statements, and the site
 * is public.
 *
 * Live validation uses app/lint.js and app/parity.js, the same modules the build
 * and the tests use, so the editor cannot disagree with CI about what is valid.
 */

import { el, block, langName, clear } from './dom.js';
import {
  field, textInput, textArea, select, checkbox, repeatable, findingsPanel,
  progressBar, getPath, setPath, hint,
} from './forms.js';
import { STATUSES, LOSS_REQUIRED, lintCard, cardCompleteness, CONTRIBUTOR_ROLES } from './lint.js';
import {
  APPROVAL_STATES, APPROVAL_LABELS, VERSION_STATES, DIVERGENCE_KINDS, DIVERGENCE_LABELS,
  STATEMENT_KINDS, PARTY_ROLES, statementState, outstanding, lengthSignals,
  citedTerms, lintStatement,
} from './parity.js';
import { STATUS_LABELS } from './search.js';
import { button, sectionHeading } from './ui.js';

const LANGUAGES = [
  'ar', 'bo', 'cop', 'de', 'en', 'es', 'fa', 'fr', 'grc', 'he', 'hi', 'hy', 'id',
  'ja', 'ka', 'ko', 'la', 'ms', 'my', 'ne', 'pi', 'ps', 'pt', 'ru', 'sa', 'si',
  'syc', 'sw', 'ta', 'th', 'ti', 'tr', 'ur', 'vi', 'zh',
];
const SCRIPTS = [
  'Latn', 'Hebr', 'Arab', 'Grek', 'Cyrl', 'Deva', 'Beng', 'Taml', 'Hani', 'Hant',
  'Hans', 'Tibt', 'Thai', 'Khmr', 'Mymr', 'Ethi', 'Armn', 'Geor', 'Syrc', 'Copt', 'XsuX',
];

function datalists() {
  return el('span', { hidden: true },
    el('datalist', { id: 'lang-codes' }, LANGUAGES.map((code) => el('option', { value: code, text: langName(code) }))),
    el('datalist', { id: 'script-codes' }, SCRIPTS.map((code) => el('option', { value: code, text: code })))
  );
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// -------------------------------------------------------------- card editor

/**
 * The card editor.
 *
 * Mutates one plain object. Text fields never trigger a re-render — only
 * structural changes do — because re-rendering a form while somebody types is
 * how you lose their work. Validation and progress refresh on a short debounce
 * into containers that hold no focus.
 */
export function cardEditorView({ draft, onSave, onExport, onDelete, onReset, onImport }) {
  const findingsNode = el('div', { class: 'editor-findings' });
  const progressNode = el('div', { class: 'editor-progress' });
  let refreshTimer = null;

  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      findingsNode.replaceChildren(findingsPanel(lintCard(draft, 'card.json')));
      progressNode.replaceChildren(progressBar(cardCompleteness(draft)));
    }, 120);
  };

  const touch = () => refresh();

  // ------------------------------------------------------------- identity

  const labelField = textInput({
    id: 'concept-label',
    value: getPath(draft, 'concept.label'),
    onChange: (value) => {
      setPath(draft, 'concept.label', value);
      if (!getPath(draft, 'id')) idField.value = slugify(value);
      touch();
    },
  });

  const idField = textInput({
    id: 'card-id',
    value: draft.id,
    onChange: (value) => {
      draft.id = slugify(value);
      idField.value = draft.id;
      touch();
    },
  });

  const identity = el('fieldset', { class: 'group' },
    el('legend', { text: 'What is the concept?' }),
    field('Label', labelField, {
      id: 'concept-label',
      hint: 'The term as it is usually written in Latin letters: hesed, dharma, shalom.',
    }),
    field('Card id', idField, {
      id: 'card-id',
      hint: 'A stable slug. It becomes the filename and the citation key. Never reused for a different concept.',
    }),
    field('Gloss', textArea({
      id: 'concept-gloss',
      value: getPath(draft, 'concept.gloss'),
      rows: 3,
      onChange: (value) => { setPath(draft, 'concept.gloss', value); touch(); },
    }), {
      id: 'concept-gloss',
      hint: 'One or two sentences in plain modern language. This is what a reader sees first.',
    }),
    field('Register', textInput({
      id: 'concept-register',
      value: getPath(draft, 'concept.register'),
      placeholder: 'devotional, juridical, poetic…',
      onChange: (value) => { setPath(draft, 'concept.register', value); touch(); },
    }), { id: 'concept-register' }),
    field('Domains', textInput({
      id: 'concept-domains',
      value: (draft.concept.domains || []).join(', '),
      placeholder: 'covenant, mercy, obligation',
      onChange: (value) => {
        setPath(draft, 'concept.domains', value.split(',').map((d) => d.trim()).filter(Boolean));
        touch();
      },
    }), { id: 'concept-domains', hint: 'Comma separated. Used by the filters.' })
  );

  // ---------------------------------------------------------------- origin

  const origin = el('fieldset', { class: 'group' },
    el('legend', { text: 'Where does it come from?' }),
    hint('Optional, and honestly optional: some concepts have no single origin term. Leave it blank rather than inventing one.'),
    el('div', { class: 'form-row' },
      field('Language', el('input', {
        id: 'origin-language', type: 'text', list: 'lang-codes', value: draft.origin?.language || '',
        autocomplete: 'off',
        on: { input: (event) => { setPath(draft, 'origin.language', event.target.value.trim()); touch(); } },
      }), { id: 'origin-language', hint: 'BCP 47, e.g. he, grc, zh-Hant.' }),
      field('Script', el('input', {
        id: 'origin-script', type: 'text', list: 'script-codes', value: draft.origin?.script || '',
        autocomplete: 'off',
        on: { input: (event) => { setPath(draft, 'origin.script', event.target.value.trim()); touch(); } },
      }), { id: 'origin-script', hint: 'ISO 15924, e.g. Hebr, Arab, Deva.' })
    ),
    field('The term, in its own script',
      el('input', {
        id: 'origin-term',
        type: 'text',
        dir: 'auto',
        value: draft.origin?.term || '',
        autocomplete: 'off',
      }),
      { id: 'origin-term', hint: 'It renders right to left, left to right, or top to bottom depending on the script. The browser decides from the characters.' }),
    el('div', { class: 'form-row' },
      field('Transliteration', textInput({
        id: 'origin-transliteration',
        value: draft.origin?.transliteration || '',
        onChange: (value) => { setPath(draft, 'origin.transliteration', value); touch(); },
      }), { id: 'origin-transliteration', hint: 'So the card is readable when the script will not render.' }),
      field('Pronunciation', textInput({
        id: 'origin-pronunciation',
        value: draft.origin?.pronunciation || '',
        onChange: (value) => { setPath(draft, 'origin.pronunciation', value); touch(); },
      }), { id: 'origin-pronunciation' })
    )
  );

  // Set the script input's dir on input, since it holds non-Latin text.
  origin.querySelector('#origin-term').addEventListener('input', (event) => {
    setPath(draft, 'origin.term', event.target.value);
    touch();
  });

  // ------------------------------------------------------------ renditions

  const renditionItem = (rendition, index, onRemove) => {
    const needsLoss = LOSS_REQUIRED.has(rendition.status);
    const id = (suffix) => `rendition-${index}-${suffix}`;

    const alternatives = repeatable({
      items: (rendition.alternatives = rendition.alternatives || []),
      addLabel: 'Add a rejected rendering',
      emptyLabel: 'No rejected alternatives recorded. Worth adding: it is how the same argument stops being relitigated.',
      onAdd: () => rendition.alternatives.push({ rendering: '', rejected_because: '' }),
      renderItem: (alternative, altIndex, removeAlternative) =>
        el('div', { class: 'repeatable-item nested' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Rejected ${altIndex + 1}` }),
            button('Remove', removeAlternative, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Rendering', textInput({
              id: `${id('alt')}-${altIndex}-rendering`,
              value: alternative.rendering,
              type: 'text',
              onChange: (value) => { alternative.rendering = value; touch(); },
            }), { id: `${id('alt')}-${altIndex}-rendering` }),
            field('Why it was rejected', textInput({
              id: `${id('alt')}-${altIndex}-why`,
              value: alternative.rejected_because,
              onChange: (value) => { alternative.rejected_because = value; touch(); },
            }), { id: `${id('alt')}-${altIndex}-why` })
          )
        ),
    });

    return el('div', { class: 'repeatable-item' },
      el('div', { class: 'repeatable-head' },
        el('span', { class: 'repeatable-title', text: `Rendering ${index + 1}` }),
        button('Remove', onRemove, { class: 'ghost tiny' })
      ),
      el('div', { class: 'form-row' },
        field('Language', el('input', {
          id: id('language'), type: 'text', list: 'lang-codes', value: rendition.language || '',
          autocomplete: 'off',
          on: { input: (event) => { rendition.language = event.target.value.trim(); touch(); } },
        }), { id: id('language') }),
        field('Status', select({
          id: id('status'),
          value: rendition.status,
          options: STATUSES.map((status) => [status, STATUS_LABELS[status] || status]),
          onChange: (value) => {
            rendition.status = value;
            renderRenditions();
          },
        }), { id: id('status'), hint: 'What kind of claim is this rendering making?' })
      ),
      el('div', { class: 'form-row' },
        field('Rendering', el('input', {
          id: id('rendering'), type: 'text', dir: 'auto', value: rendition.rendering || '', autocomplete: 'off',
          on: { input: (event) => { rendition.rendering = event.target.value; touch(); } },
        }), { id: id('rendering') }),
        field('Tradition', textInput({
          id: id('tradition'),
          value: rendition.tradition || '',
          placeholder: 'Anglican, early modern',
          onChange: (value) => { rendition.tradition = value; touch(); },
        }), { id: id('tradition') })
      ),
      field(needsLoss ? 'What this rendering loses — required' : 'What this rendering loses',
        textArea({
          id: id('loss'),
          value: rendition.loss || '',
          rows: 4,
          onChange: (value) => { rendition.loss = value; touch(); },
        }),
        {
          id: id('loss'),
          className: needsLoss && !(rendition.loss || '').trim() ? 'field-attention' : '',
          hint: needsLoss
            ? 'Say what it drops, adds, or distorts. Could a reader who knows neither language decide whether this rendering is fit for their purpose? If not, keep writing.'
            : 'Optional when a rendering is recorded as equivalent.',
        }
      ),
      el('fieldset', { class: 'group nested-group' },
        el('legend', { text: 'Basis' }),
        field('Citation', textInput({
          id: id('citation'),
          value: rendition.basis?.citation || '',
          onChange: (value) => { setPath(rendition, 'basis.citation', value); touch(); },
        }), { id: id('citation'), hint: 'The text or work that establishes this. A machine may suggest a rendering; a machine may never be the basis.' }),
        el('div', { class: 'form-row' },
          field('Citation language', el('input', {
            id: id('basis-language'), type: 'text', list: 'lang-codes', value: rendition.basis?.language || '',
            autocomplete: 'off',
            on: { input: (event) => { setPath(rendition, 'basis.language', event.target.value.trim()); touch(); } },
          }), { id: id('basis-language') }),
          field('Locator', textInput({
            id: id('locator'),
            value: rendition.basis?.locator || '',
            placeholder: 'Psalm 136, p. 44',
            onChange: (value) => { setPath(rendition, 'basis.locator', value); touch(); },
          }), { id: id('locator') })
        )
      ),
      alternatives.node
    );
  };

  const renditionsNode = el('div', { class: 'repeatable-host' });
  const renderRenditions = () => {
    const list = repeatable({
      items: draft.renditions,
      addLabel: 'Add another language',
      emptyLabel: 'At least one rendering is required.',
      onAdd: () => draft.renditions.push({
        language: '', rendering: '', status: 'nearest-no-equivalent', loss: '',
        basis: { citation: '', language: '' }, alternatives: [],
      }),
      onRemove: () => touch(),
      renderItem: renditionItem,
    });
    clear(renditionsNode).append(list.node);
  };
  renderRenditions();

  // ------------------------------------------------- disputes and sources

  const disputes = repeatable({
    items: (draft.disputes = draft.disputes || []),
    addLabel: 'Record a disagreement',
    emptyLabel: 'No disagreement recorded. If there is none, say so in the provenance note; if there is one, it belongs here.',
    onAdd: () => draft.disputes.push({ position: '', held_by: '', response: '', basis: { citation: '', language: '' } }),
    renderItem: (dispute, index, remove) =>
      el('div', { class: 'repeatable-item' },
        el('div', { class: 'repeatable-head' },
          el('span', { class: 'repeatable-title', text: `Disagreement ${index + 1}` }),
          button('Remove', remove, { class: 'ghost tiny' })
        ),
        field('The position', textArea({
          id: `dispute-${index}-position`, value: dispute.position, rows: 3,
          onChange: (value) => { dispute.position = value; touch(); },
        }), { id: `dispute-${index}-position` }),
        field('Held by', textInput({
          id: `dispute-${index}-held`, value: dispute.held_by,
          onChange: (value) => { dispute.held_by = value; touch(); },
        }), { id: `dispute-${index}-held`, hint: 'Who holds it, and in what tradition or school.' }),
        field('In response', textArea({
          id: `dispute-${index}-response`, value: dispute.response || '', rows: 2,
          onChange: (value) => { dispute.response = value; touch(); },
        }), { id: `dispute-${index}-response` }),
        el('div', { class: 'form-row' },
          field('Basis citation', textInput({
            id: `dispute-${index}-citation`, value: dispute.basis?.citation || '',
            onChange: (value) => { setPath(dispute, 'basis.citation', value); touch(); },
          }), { id: `dispute-${index}-citation` }),
          field('Basis language', textInput({
            id: `dispute-${index}-basis-language`, value: dispute.basis?.language || '',
            onChange: (value) => { setPath(dispute, 'basis.language', value); touch(); },
          }), { id: `dispute-${index}-basis-language` })
        )
      ),
  });

  const sources = repeatable({
    items: (draft.sources = draft.sources || []),
    addLabel: 'Add a source',
    emptyLabel: 'At least one source is required. No claim without a source.',
    onAdd: () => draft.sources.push({ citation: '', language: '' }),
    renderItem: (source, index, remove) =>
      el('div', { class: 'repeatable-item' },
        el('div', { class: 'repeatable-head' },
          el('span', { class: 'repeatable-title', text: `Source ${index + 1}` }),
          button('Remove', remove, { class: 'ghost tiny' })
        ),
        field('Citation', textInput({
          id: `source-${index}-citation`, value: source.citation,
          onChange: (value) => { source.citation = value; touch(); },
        }), { id: `source-${index}-citation` }),
        el('div', { class: 'form-row' },
          field('Language', el('input', {
            id: `source-${index}-language`, type: 'text', list: 'lang-codes', value: source.language || '',
            autocomplete: 'off',
            on: { input: (event) => { source.language = event.target.value.trim(); touch(); } },
          }), { id: `source-${index}-language` }),
          field('Locator', textInput({
            id: `source-${index}-locator`, value: source.locator || '',
            onChange: (value) => { source.locator = value; touch(); },
          }), { id: `source-${index}-locator` })
        ),
        el('div', { class: 'form-row' },
          field('Tradition', textInput({
            id: `source-${index}-tradition`, value: source.tradition || '',
            onChange: (value) => { source.tradition = value; touch(); },
          }), { id: `source-${index}-tradition` }),
          field('URL', textInput({
            id: `source-${index}-url`, value: source.url || '', type: 'url',
            onChange: (value) => { source.url = value; touch(); },
          }), { id: `source-${index}-url` })
        )
      ),
  });

  // ------------------------------------------------------------ reviewers

  const contributors = repeatable({
    items: (draft.contributors = draft.contributors || []),
    addLabel: 'Add a contributor',
    emptyLabel: 'At least one author is required.',
    onAdd: () => draft.contributors.push({ name: '', date: new Date().toISOString().slice(0, 10), role: 'author' }),
    renderItem: (contributor, index, remove) =>
      el('div', { class: 'repeatable-item' },
        el('div', { class: 'repeatable-head' },
          el('span', { class: 'repeatable-title', text: `Contributor ${index + 1}` }),
          button('Remove', remove, { class: 'ghost tiny' })
        ),
        el('div', { class: 'form-row' },
          field('Name', textInput({
            id: `contributor-${index}-name`, value: contributor.name,
            onChange: (value) => { contributor.name = value; touch(); },
          }), { id: `contributor-${index}-name` }),
          field('Role', select({
            id: `contributor-${index}-role`,
            value: contributor.role,
            options: CONTRIBUTOR_ROLES.map((role) => [role, role]),
            onChange: (value) => { contributor.role = value; renderContributors(); },
          }), { id: `contributor-${index}-role`, hint: 'A card stops displaying as unreviewed only when a reviewer signs it.' })
        ),
        el('div', { class: 'form-row' },
          field('Date', textInput({
            id: `contributor-${index}-date`, value: contributor.date, type: 'date',
            onChange: (value) => { contributor.date = value; touch(); },
          }), { id: `contributor-${index}-date` }),
          field('Tradition', textInput({
            id: `contributor-${index}-tradition`, value: contributor.tradition || '',
            onChange: (value) => { contributor.tradition = value; touch(); },
          }), { id: `contributor-${index}-tradition` })
        )
      ),
  });

  const contributorsNode = el('div', { class: 'repeatable-host' });
  const renderContributors = () => {
    clear(contributorsNode).append(contributors.node);
  };
  renderContributors();

  const node = el('article', { class: 'editor' },
    datalists(),
    el('p', { class: 'crumb' }, el('a', { href: '#/', text: '← Term base' }), ' · ', el('a', { href: '#/drafts', text: 'Your drafts' })),
    el('h2', { text: draft.id ? `Editing ${draft.concept.label || draft.id}` : 'New card', tabindex: '-1' }),
    el('p', { class: 'lede' }, 'This never leaves your device. When it validates, export the JSON and open a pull request, or paste it into an issue and somebody will do it for you.'),

    progressNode,
    identity,
    origin,

    el('fieldset', { class: 'group' },
      el('legend', { text: 'How is it rendered elsewhere, and what does each rendering lose?' }),
      renditionsNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Recorded disagreement' }),
      disputes.node
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Sources' }),
      sources.node
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Contributors and reviewers' }),
      contributorsNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Provenance' }),
      field('How this card came to exist', textArea({
        id: 'provenance-note',
        value: draft.provenance_note || '',
        rows: 3,
        onChange: (value) => { draft.provenance_note = value; touch(); },
      }), { id: 'provenance-note', hint: 'Including who was not consulted. That sentence is often the most useful one on the card.' }),
      field('Data licence', select({
        id: 'license',
        value: draft.license || 'CC-BY-SA-4.0',
        options: [['CC-BY-SA-4.0', 'CC BY-SA 4.0 — share alike, stays a commons'], ['CC0-1.0', 'CC0 — public domain']],
        onChange: (value) => { draft.license = value; touch(); },
      }), { id: 'license' })
    ),

    findingsNode,

    el('div', { class: 'actions sticky-actions' },
      button('Save draft', () => onSave(draft)),
      button('Export card JSON', () => onExport('card', draft)),
      button('Copy card JSON', () => onExport('card-copy', draft), { class: 'ghost' }),
      button('Import a card to edit', () => onImport(), { class: 'ghost' }),
      button('Start over', () => onReset(), { class: 'ghost' }),
      onDelete ? button('Delete this draft', () => onDelete(draft.id), { class: 'ghost danger' }) : null
    )
  );

  refresh();
  return { node, refresh };
}

// ---------------------------------------------------------------- drafts

export function draftsView({ drafts, onEdit, onDelete, onExport, onCreate, onImport }) {
  const cards = drafts.filter((d) => !d.format || d.format === 'colophon/card' || d.concept);
  const statements = drafts.filter((d) => d.format === 'colophon/statement' || d.versions);

  const list = (items, render) => items.length
    ? el('ul', { class: 'draft-list' }, items.map(render))
    : el('p', { class: 'empty', text: 'Nothing here yet.' });

  return el('article', { class: 'drafts' },
    el('p', { class: 'crumb' }, el('a', { href: '#/', text: '← Term base' })),
    el('h2', { text: 'Your drafts', tabindex: '-1' }),
    el('p', { class: 'lede' }, 'These live in this browser on this device. They are not published and nobody else can see them. Clearing your browser data deletes them, so export anything you would miss.'),

    el('div', { class: 'actions' },
      button('New card', onCreate),
      button('New statement', () => onCreate('statement'), { class: 'ghost' }),
      button('Import JSON', () => onImport(), { class: 'ghost' }),
      button('Export everything', () => onExport('archive'), { class: 'ghost' })
    ),

    sectionHeading('Cards', { note: 'Draft term cards. Export one to contribute it.' }),
    list(cards, (draft) => {
      const completeness = cardCompleteness(draft);
      return el('li', { class: 'draft-item' },
        el('div', {},
          block('span', draft.concept?.label || draft.id || 'untitled', { class: 'card-title' }),
          el('span', { class: 'lang', text: `${completeness.complete}% ready` }),
          completeness.missing.length
            ? el('span', { class: 'status status-warn', text: `${completeness.missing.length} to fix` })
            : el('span', { class: 'status status-ok', text: 'validates' })
        ),
        block('p', draft.concept?.gloss || '', { class: 'card-gloss' }),
        el('div', { class: 'actions' },
          button('Edit', () => onEdit(draft)),
          button('Export JSON', () => onExport('card', draft), { class: 'ghost' }),
          button('Delete', () => onDelete(draft.id), { class: 'ghost danger' })
        )
      );
    }),

    sectionHeading('Statements', { note: 'Multi-language statements with per-party approvals.' }),
    list(statements, (statement) => {
      const state = statementState(statement);
      return el('li', { class: 'draft-item' },
        el('div', {},
          block('span', statement.title || statement.id || 'untitled', { class: 'card-title' }),
          state.ratified
            ? el('span', { class: 'status status-ok', text: 'ratified in every language' })
            : el('span', { class: 'status status-warn', text: `${state.needsAttention} version(s) to settle` }),
          el('span', { class: 'lang', text: `${state.versions} language(s)` })
        ),
        el('div', { class: 'actions' },
          button('Edit', () => onEdit(statement)),
          button('Export JSON', () => onExport('statement', statement), { class: 'ghost' }),
          button('Export Markdown', () => onExport('statement-markdown', statement), { class: 'ghost' }),
          button('Delete', () => onDelete(statement.id), { class: 'ghost danger' })
        )
      );
    })
  );
}

// ----------------------------------------------------------- statement editor

/**
 * The parity tracker.
 *
 * Deliberately not a document editor with translation attached. It is a record
 * of who approved what, in which language, plus the divergences that named
 * people declared. There is no button here that decides two texts agree, because
 * no button could be right.
 */
export function statementEditorView({ statement, cards, onSave, onExport, onDelete, onReset }) {
  const findingsNode = el('div', { class: 'editor-findings' });
  const parityNode = el('div', { class: 'parity-panel' });
  let timer = null;

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      findingsNode.replaceChildren(findingsPanel(lintStatement(statement), { title: 'Problems in the record' }));
      parityNode.replaceChildren(parityPanel(statement, cards));
    }, 120);
  };
  const touch = () => refresh();

  const partiesNode = el('div', { class: 'repeatable-host' });
  const versionsNode = el('div', { class: 'repeatable-host' });

  const renderParties = () => {
    const list = repeatable({
      items: statement.parties,
      addLabel: 'Add a party',
      emptyLabel: 'A statement needs at least two parties.',
      onAdd: () => {
        statement.parties.push({ id: `party-${statement.parties.length + 1}`, name: '', role: 'party', languages: [] });
        renderParties();
        renderVersions();
      },
      onRemove: () => { renderParties(); renderVersions(); },
      renderItem: (party, index, remove) =>
        el('div', { class: 'repeatable-item' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Party ${index + 1}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Name', textInput({
              id: `party-${index}-name`, value: party.name,
              onChange: (value) => { party.name = value; touch(); },
            }), { id: `party-${index}-name` }),
            field('Role', select({
              id: `party-${index}-role`, value: party.role,
              options: PARTY_ROLES.map((role) => [role, role]),
              onChange: (value) => { party.role = value; renderVersions(); },
            }), { id: `party-${index}-role` })
          ),
          el('div', { class: 'form-row' },
            field('Id', textInput({
              id: `party-${index}-id`, value: party.id,
              onChange: (value) => { party.id = slugify(value); touch(); },
            }), { id: `party-${index}-id`, hint: 'Stable key used by approvals. Renaming it after signatures exist breaks them.' }),
            field('Languages', textInput({
              id: `party-${index}-languages`, value: (party.languages || []).join(', '),
              placeholder: 'en, ar',
              onChange: (value) => { party.languages = value.split(',').map((l) => l.trim()).filter(Boolean); touch(); },
            }), { id: `party-${index}-languages` })
          )
        ),
    });
    clear(partiesNode).append(list.node);
  };

  const renderVersions = () => {
    const list = repeatable({
      items: statement.versions,
      addLabel: 'Add a language version',
      emptyLabel: 'No versions yet. A statement needs at least one language of record.',
      onAdd: () => {
        statement.versions.push({
          language: '', status: 'draft', body: '', approvals: [], divergences: [], basis: [],
        });
        renderVersions();
      },
      onRemove: () => { renderVersions(); touch(); },
      renderItem: (version, index, remove) => {
        const approvalRows = statement.parties.map((party) => {
          const existing = (version.approvals || []).find((a) => a.party === party.id);
          if (!existing) version.approvals = [...(version.approvals || []), { party: party.id, state: 'pending' }];
          const approval = version.approvals.find((a) => a.party === party.id);

          return el('div', { class: 'approval-row' },
            el('span', { class: 'approval-party', auto: party.name || party.id }),
            select({
              id: `version-${index}-approval-${party.id}`,
              value: approval.state,
              options: APPROVAL_STATES.map((state) => [state, APPROVAL_LABELS[state]]),
              onChange: (value) => { approval.state = value; refresh(); },
            }),
            textInput({
              id: `version-${index}-approval-${party.id}-note`,
              value: approval.note || '',
              placeholder: 'note, optional',
              onChange: (value) => { approval.note = value; refresh(); },
            })
          );
        });

        const divergences = repeatable({
          items: (version.divergences = version.divergences || []),
          addLabel: 'Record a divergence',
          emptyLabel: 'No divergence recorded. Nobody can notice this by machine, so if there is one, it has to be written down.',
          onAdd: () => version.divergences.push({ kind: 'omission', summary: '', raisedBy: '', resolved: false }),
          renderItem: (divergence, dIndex, removeDivergence) =>
            el('div', { class: 'repeatable-item nested' },
              el('div', { class: 'repeatable-head' },
                el('span', { class: 'repeatable-title', text: `Divergence ${dIndex + 1}` }),
                button('Remove', removeDivergence, { class: 'ghost tiny' })
              ),
              el('div', { class: 'form-row' },
                field('Kind', select({
                  id: `version-${index}-divergence-${dIndex}-kind`,
                  value: divergence.kind,
                  options: DIVERGENCE_KINDS.map((kind) => [kind, DIVERGENCE_LABELS[kind] || kind]),
                  onChange: (value) => { divergence.kind = value; refresh(); },
                }), { id: `version-${index}-divergence-${dIndex}-kind` }),
                field('Raised by', textInput({
                  id: `version-${index}-divergence-${dIndex}-by`,
                  value: divergence.raisedBy,
                  onChange: (value) => { divergence.raisedBy = value; refresh(); },
                }), { id: `version-${index}-divergence-${dIndex}-by`, hint: 'A named person. Never "the system".' })
              ),
              field('What differs', textArea({
                id: `version-${index}-divergence-${dIndex}-summary`,
                value: divergence.summary,
                rows: 2,
                onChange: (value) => { divergence.summary = value; refresh(); },
              }), { id: `version-${index}-divergence-${dIndex}-summary` }),
              checkbox({
                id: `version-${index}-divergence-${dIndex}-resolved`,
                checked: Boolean(divergence.resolved),
                label: 'Resolved',
                onChange: (checked) => { divergence.resolved = checked; refresh(); },
              })
            ),
        });

        const basis = repeatable({
          items: (version.basis = version.basis || []),
          addLabel: 'Cite a term card',
          emptyLabel: 'No term cards cited. Citing them is how a translation choice becomes checkable.',
          onAdd: () => version.basis.push({ termCard: '', note: '' }),
          renderItem: (entry, bIndex, removeBasis) =>
            el('div', { class: 'repeatable-item nested' },
              el('div', { class: 'repeatable-head' },
                el('span', { class: 'repeatable-title', text: `Term ${bIndex + 1}` }),
                button('Remove', removeBasis, { class: 'ghost tiny' })
              ),
              el('div', { class: 'form-row' },
                field('Term card id', el('input', {
                  id: `version-${index}-basis-${bIndex}-card`, type: 'text', list: 'term-card-ids',
                  value: entry.termCard, autocomplete: 'off',
                  on: { input: (event) => { entry.termCard = event.target.value.trim(); refresh(); } },
                }), { id: `version-${index}-basis-${bIndex}-card` }),
                field('Note', textInput({
                  id: `version-${index}-basis-${bIndex}-note`,
                  value: entry.note || '',
                  onChange: (value) => { entry.note = value; refresh(); },
                }), { id: `version-${index}-basis-${bIndex}-note` })
              )
            ),
        });

        return el('div', { class: 'repeatable-item version' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Version ${index + 1}${version.language ? ` — ${version.language}` : ''}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Language', el('input', {
              id: `version-${index}-language`, type: 'text', list: 'lang-codes', value: version.language,
              autocomplete: 'off',
              on: { input: (event) => { version.language = event.target.value.trim(); refresh(); } },
            }), { id: `version-${index}-language` }),
            field('Recorded status', select({
              id: `version-${index}-status`, value: version.status,
              options: VERSION_STATES.map((state) => [state, state]),
              onChange: (value) => { version.status = value; refresh(); },
            }), { id: `version-${index}-status`, hint: 'The status is a claim; the approvals below are the evidence.' })
          ),
          field('The text', textArea({
            id: `version-${index}-body`, value: version.body, rows: 6, dir: 'auto',
            onChange: (value) => { version.body = value; refresh(); },
          }), { id: `version-${index}-body` }),

          el('fieldset', { class: 'group nested-group' },
            el('legend', { text: 'Approvals' }),
            hint('Every party, in every language. "Withheld" is a decision and is never counted as consent.'),
            approvalRows.length ? approvalRows : el('p', { class: 'empty', text: 'Add parties first.' })
          ),

          el('fieldset', { class: 'group nested-group' },
            el('legend', { text: 'Divergences' }),
            divergences.node
          ),

          el('fieldset', { class: 'group nested-group' },
            el('legend', { text: 'Terms relied on' }),
            basis.node
          ),

          el('div', { class: 'form-row' },
            field('Translator', textInput({
              id: `version-${index}-translator-name`, value: version.translator?.name || '',
              onChange: (value) => { setPath(version, 'translator.name', value); refresh(); },
            }), { id: `version-${index}-translator-name` }),
            field('How it was translated', select({
              id: `version-${index}-translator-kind`,
              value: version.translator?.kind || 'human',
              options: [['human', 'by a person'], ['assisted', 'machine-assisted, human-reviewed'], ['machine', 'machine, unreviewed']],
              onChange: (value) => { setPath(version, 'translator.kind', value); refresh(); },
            }), { id: `version-${index}-translator-kind`, hint: 'Recorded, because a reader deserves to know.' })
          )
        );
      },
    });
    clear(versionsNode).append(list.node);
  };

  renderParties();
  renderVersions();

  const node = el('article', { class: 'editor statement-editor' },
    datalists(),
    el('datalist', { id: 'term-card-ids' }, cards.map((card) => el('option', { value: card.id, text: card.concept.label }))),
    el('p', { class: 'crumb' }, el('a', { href: '#/drafts', text: '← Your drafts' })),
    el('h2', { text: statement.title || 'New statement', tabindex: '-1' }),
    el('p', { class: 'lede' }, 'A statement exists in several languages at once, and every language version is equally authentic. This records who has approved which version, and what divergence named people have reported. It stays on this device until you export it.'),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'The statement' }),
      field('Title', textInput({
        id: 'statement-title', value: statement.title,
        onChange: (value) => { statement.title = value; touch(); },
      }), { id: 'statement-title' }),
      el('div', { class: 'form-row' },
        field('Kind', select({
          id: 'statement-kind', value: statement.kind,
          options: STATEMENT_KINDS.map((kind) => [kind, kind]),
          onChange: (value) => { statement.kind = value; touch(); },
        }), { id: 'statement-kind' }),
        field('Created', textInput({
          id: 'statement-created', value: statement.created, type: 'date',
          onChange: (value) => { statement.created = value; touch(); },
        }), { id: 'statement-created' })
      ),
      field('Note', textArea({
        id: 'statement-note', value: statement.note || '', rows: 2,
        onChange: (value) => { statement.note = value; touch(); },
      }), { id: 'statement-note' })
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Parties' }),
      partiesNode
    ),

    parityNode,

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Language versions' }),
      versionsNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Retention' }),
      hint('A statement about people should say when it is destroyed, and by whom. Leave blank if the parties have not agreed yet, and say so in the note.'),
      el('div', { class: 'form-row' },
        field('Policy', textInput({
          id: 'retention-policy', value: statement.retention?.policy || '',
          placeholder: 'destroy after 12 months',
          onChange: (value) => { setPath(statement, 'retention.policy', value); touch(); },
        }), { id: 'retention-policy' }),
        field('Destroy by', textInput({
          id: 'retention-destroy', value: statement.retention?.destroyBy || '', type: 'date',
          onChange: (value) => { setPath(statement, 'retention.destroyBy', value); touch(); },
        }), { id: 'retention-destroy' })
      )
    ),

    findingsNode,

    el('div', { class: 'actions sticky-actions' },
      button('Save', () => onSave(statement)),
      button('Export statement JSON', () => onExport('statement', statement), { class: 'ghost' }),
      button('Export for circulation (Markdown)', () => onExport('statement-markdown', statement), { class: 'ghost' }),
      button('Copy citation', async () => {
        const result = await onExport('statement-cite', statement);
        if (result && !result.ok) return;
      }, { class: 'ghost' }),
      button('Print', () => window.print(), { class: 'ghost' }),
      button('Start over', () => onReset(), { class: 'ghost' }),
      button('Delete', () => onDelete(statement.id), { class: 'ghost danger' })
    )
  );

  refresh();
  return { node, refresh };
}

/** The parity panel: what the record currently says, as facts. */
function parityPanel(statement, cards) {
  const { summary, ratified, openDivergences, needsAttention } = statementState(statement);
  const awaiting = outstanding(statement);
  const signals = lengthSignals(statement);
  const cited = citedTerms(statement);

  if (!summary.length) {
    return el('div', { class: 'panel-block' },
      el('h3', { text: 'Where this stands' }),
      el('p', { class: 'empty', text: 'No language versions yet.' })
    );
  }

  return el('div', { class: 'panel-block' },
    el('h3', { text: 'Where this stands' }),
    el('ul', { class: 'stats' },
      el('li', { class: 'stat' },
        el('span', { class: 'stat-value', text: ratified ? 'yes' : 'no' }),
        el('span', { class: 'stat-label', text: 'ratified in every language' })
      ),
      el('li', { class: 'stat' },
        el('span', { class: 'stat-value', text: openDivergences }),
        el('span', { class: 'stat-label', text: 'open divergences' })
      ),
      el('li', { class: 'stat' },
        el('span', { class: 'stat-value', text: needsAttention }),
        el('span', { class: 'stat-label', text: 'versions to settle' })
      )
    ),

    el('ul', { class: 'parity-list' }, summary.map((version) =>
      el('li', { class: `parity-row parity-${version.state}` },
        el('span', { class: 'lang', text: version.language }),
        el('span', { class: `status status-${version.state === 'ratified' ? 'ok' : version.state === 'rejected' ? 'alert' : 'warn'}`, text: version.state }),
        el('span', { class: 'lang', text: `${version.words} words` }),
        version.openDivergences ? el('span', { class: 'status status-alert', text: `${version.openDivergences} open` }) : null,
        version.withheld.length ? el('span', { class: 'status status-alert', text: `${version.withheld.length} withheld` }) : null
      )
    )),

    awaiting.length ? el('div', { class: 'outstanding' },
      el('h4', { text: 'Who to ask' }),
      el('ul', {}, awaiting.map((entry) =>
        el('li', {},
          el('span', { auto: entry.party.name || entry.party.id }),
          el('span', { text: ': ' }),
          entry.languages.map((l) => el('span', { class: 'lang', text: `${l.language} (${l.state})` }))
        )
      ))
    ) : el('p', { class: 'clean', text: 'Nobody is outstanding.' }),

    signals.length ? el('div', { class: 'signals' },
      el('h4', { text: 'Worth a look' }),
      hint('Counting words is arithmetic, not analysis. A gap this size is a question to ask a human, not a finding.'),
      el('ul', {}, signals.map((signal) =>
        el('li', {},
          el('span', { class: 'lang', text: signal.language }),
          el('span', { text: ` is ${(signal.gap * 100).toFixed(0)}% shorter than ` }),
          el('span', { class: 'lang', text: signal.against }),
          el('span', { text: ` (${signal.words} vs ${signal.againstWords} words)` })
        )
      ))
    ) : null,

    cited.length ? el('div', { class: 'cited' },
      el('h4', { text: 'Terms relied on' }),
      el('ul', {}, cited.map((entry) => {
        const card = cards.find((c) => c.id === entry.termCard);
        return el('li', {},
          card
            ? el('a', { href: `#/term/${encodeURIComponent(card.id)}`, auto: card.concept.label })
            : el('code', { text: entry.termCard }),
          el('span', { text: ` ×${entry.count}` })
        );
      }))
    ) : null
  );
}

// ------------------------------------------------------------------ settings

export function settingsView({ settings, onChange, onExportArchive, onImportArchive, onClearAll, storageOk, counts }) {
  return el('article', { class: 'settings' },
    el('p', { class: 'crumb' }, el('a', { href: '#/', text: '← Term base' })),
    el('h2', { text: 'Settings', tabindex: '-1' }),

    !storageOk ? el('div', { class: 'message message-error' },
      el('h3', { text: 'This browser will not store data' }),
      el('p', { text: 'Private browsing or a storage restriction means drafts will not survive a reload. Export your work rather than relying on drafts.' })
    ) : null,

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Reading' }),
      field('Theme', select({
        id: 'theme', value: settings.theme,
        options: [['system', 'follow the system'], ['light', 'light'], ['dark', 'dark']],
        onChange: (value) => onChange('theme', value),
      }), { id: 'theme' }),
      field('Text size', select({
        id: 'text-scale', value: settings.textScale,
        options: [['0.9', 'smaller'], ['1', 'normal'], ['1.15', 'large'], ['1.3', 'larger']],
        onChange: (value) => onChange('textScale', value),
      }), { id: 'text-scale' }),
      checkbox({
        id: 'transliteration',
        checked: settings.transliteration,
        label: 'Show transliterations',
        hint: 'Turn off only if you read the scripts. A reader who cannot render them loses the card.',
        onChange: (checked) => onChange('transliteration', checked),
      })
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Your data' }),
      el('p', { class: 'hint', text: `Currently on this device: ${counts.cards} draft card(s), ${counts.statements} statement(s). Nothing here has ever been sent anywhere.` }),
      el('div', { class: 'actions' },
        button('Export everything as a file', onExportArchive),
        button('Import an archive', onImportArchive, { class: 'ghost' }),
        button('Delete all local data', onClearAll, { class: 'ghost danger' })
      ),
      el('p', { class: 'hint', text: 'Deleting is immediate and cannot be undone. Export first if you are unsure.' })
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'What this site stores' }),
      el('ul', {},
        el('li', { text: 'Your drafts and statements: in this browser only.' }),
        el('li', { text: 'Your theme and text size: in this browser only.' }),
        el('li', { text: 'Nothing is sent to a server. The site has no server. It is a folder of static files on GitHub Pages.' }),
        el('li', { text: 'Reading the term base writes nothing at all.' })
      )
    )
  );
}

// -------------------------------------------------------------------- import

export function importView({ onImportText, onCancel }) {
  const area = el('textarea', { id: 'import-text', rows: 12, spellcheck: 'false', placeholder: 'Paste a card, an array of cards, or a statement record.' });
  const message = el('p', { class: 'field-hint' });
  const kind = select({
    id: 'import-kind',
    value: 'auto',
    options: [['auto', 'detect automatically'], ['card', 'a term card'], ['statement', 'a statement record'], ['archive', 'a local archive']],
    onChange: () => { message.textContent = ''; },
  });

  return el('article', { class: 'import' },
    el('p', { class: 'crumb' }, el('a', { href: '#/drafts', text: '← Your drafts' })),
    el('h2', { text: 'Import JSON', tabindex: '-1' }),
    el('p', { class: 'lede' }, 'Paste a term card, several cards, a statement record, or an archive you exported earlier. Anything you import lands in your drafts, on this device.'),

    field('What is it?', kind, { id: 'import-kind' }),
    field('JSON', area, { id: 'import-text', hint: 'Nothing is uploaded. The file is read here, in this page.' }),
    message,
    el('div', { class: 'actions' },
      button('Import', () => {
        const result = onImportText(area.value, kind.value);
        message.textContent = result.message;
        message.className = result.ok ? 'field-hint clean' : 'field-error';
      }),
      button('Cancel', onCancel, { class: 'ghost' })
    )
  );
}


