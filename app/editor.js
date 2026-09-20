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

import { el, block, langName, clear, definitionList } from './dom.js';
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
import {
  MOVE_KINDS, MOVE_KIND_LABELS, SIDE_POSITIONS, TERM_STATES, TERM_STATE_LABELS,
  CONCESSION_STATES, CONCESSION_LABELS, ADJUDICATION_STATES, DEBATE_KINDS,
  debateState, debateSlug, nextMoveId, lintDebate,
  verifyChain, termsDigest,
} from './debate.js';
import { STATUS_LABELS } from './search.js';
import { button, sectionHeading, stat } from './ui.js';

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

export function draftsView({ cards = [], statements = [], debates = [], onEdit, onDelete, onExport, onCreate, onImport }) {
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
      button('New debate', () => onCreate('debate'), { class: 'ghost' }),
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

    sectionHeading('Debates', { note: 'Structured disputation: a motion, terms pinned before argument, burdens, and objections that must restate what they attack.' }),
    list(debates, (debate) => {
      const state = debateState(debate);
      const unpinned = state.unpinnedTerms.length;
      return el('li', { class: 'draft-item' },
        el('div', {},
          block('span', debate.motion || debate.id || 'untitled motion', { class: 'card-title' }),
          el('span', { class: 'lang', text: `${state.moves} move(s)` }),
          state.decided
            ? el('span', { class: 'status status-ok', text: 'decided' })
            : el('span', { class: 'status status-warn', text: 'open' }),
          state.unanswered.length
            ? el('span', { class: 'status status-alert', text: `${state.unanswered.length} objection(s) unanswered` })
            : null,
          unpinned
            ? el('span', { class: 'status status-warn', text: `${unpinned} term(s) unpinned` })
            : null
        ),
        el('div', { class: 'actions' },
          button('Edit', () => onEdit(debate)),
          button('Export JSON', () => onExport('debate', debate), { class: 'ghost' }),
          button('Export Markdown', () => onExport('debate-markdown', debate), { class: 'ghost' }),
          button('Delete', () => onDelete(debate.id), { class: 'ghost danger' })
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

// ----------------------------------------------------------- debate editor

/**
 * The debate editor.
 *
 * Same shape as the statement editor, and the same rule: it records what people
 * declared and computes facts about the record. It has no opinion on who argued
 * better, and there is nowhere in this view to express one.
 */
export function debateEditorView({
  debate, cards, onSave, onExport, onDelete, onReset,
  onExportContribution, onImportContribution, onRestamp,
}) {
  const findingsNode = el('div', { class: 'editor-findings' });
  const stateNode = el('div', { class: 'debate-panel' });
  let timer = null;

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      findingsNode.replaceChildren(findingsPanel(lintDebate(debate), { title: 'Problems in the record' }));
      stateNode.replaceChildren(debatePanel(debate, cards));
    }, 120);
  };
  const touch = () => refresh();

  const termsNode = el('div', { class: 'repeatable-host' });
  const sidesNode = el('div', { class: 'repeatable-host' });
  const movesNode = el('div', { class: 'repeatable-host' });
  const concessionsNode = el('div', { class: 'repeatable-host' });

  // ------------------------------------------------------------------ terms

  const renderTerms = () => {
    const list = repeatable({
      items: (debate.terms = debate.terms || []),
      addLabel: 'Add a contested term',
      emptyLabel: 'No terms pinned. Most interfaith disagreement is disagreement about a word, so this is usually worth doing first.',
      onAdd: () => debate.terms.push({ term: '', card: '', status: 'contested', agreed: '', note: '' }),
      renderItem: (term, index, remove) =>
        el('div', { class: 'repeatable-item' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Term ${index + 1}${term.term ? ` — ${term.term}` : ''}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Word', el('input', {
              id: `term-${index}-term`, type: 'text', dir: 'auto', value: term.term || '', autocomplete: 'off',
              on: { input: (event) => { term.term = event.target.value; touch(); } },
            }), { id: `term-${index}-term`, hint: 'In the language it is disputed in.' }),
            field('Term card', el('input', {
              id: `term-${index}-card`, type: 'text', list: 'term-card-ids', value: term.card || '', autocomplete: 'off',
              on: { input: (event) => { term.card = event.target.value.trim(); touch(); } },
            }), { id: `term-${index}-card`, hint: 'Optional. Bind the term to a card and its recorded losses come with it.' })
          ),
          field('Status', select({
            id: `term-${index}-status`,
            value: term.status,
            options: TERM_STATES.map((state) => [state, TERM_STATE_LABELS[state]]),
            onChange: (value) => { term.status = value; renderTerms(); },
          }), { id: `term-${index}-status` }),
          term.status === 'settled'
            ? field('What both sides accept it to mean here', textArea({
                id: `term-${index}-agreed`, value: term.agreed || '', rows: 2, dir: 'auto',
                onChange: (value) => { term.agreed = value; touch(); },
              }), { id: `term-${index}-agreed` })
            : field('How the sides read it differently', textArea({
                id: `term-${index}-note`, value: term.note || '', rows: 3, dir: 'auto',
                onChange: (value) => { term.note = value; touch(); },
              }), { id: `term-${index}-note`, hint: 'Usually the most useful line in the debate. If the sides cannot pin the word, say so and consider arguing about that instead.' })
        ),
    });
    clear(termsNode).append(list.node);
  };

  // ------------------------------------------------------------------ sides

  const renderSides = () => {
    const list = repeatable({
      items: (debate.sides = debate.sides || []),
      addLabel: 'Add a side',
      emptyLabel: 'A debate needs at least two sides.',
      onAdd: () => debate.sides.push({ id: `side-${debate.sides.length + 1}`, name: '', position: 'undecided', burden: '', languages: [] }),
      onRemove: () => { renderSides(); renderMoves(); },
      renderItem: (side, index, remove) =>
        el('div', { class: 'repeatable-item' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Side ${index + 1}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Name', textInput({
              id: `side-${index}-name`, value: side.name,
              onChange: (value) => { side.name = value; touch(); },
            }), { id: `side-${index}-name`, hint: 'The person, or the community they speak for.' }),
            field('Position', select({
              id: `side-${index}-position`, value: side.position,
              options: SIDE_POSITIONS.map((position) => [position, position]),
              onChange: (value) => { side.position = value; touch(); },
            }), { id: `side-${index}-position` })
          ),
          el('div', { class: 'form-row' },
            field('Id', textInput({
              id: `side-${index}-id`, value: side.id,
              onChange: (value) => { side.id = debateSlug({ motion: value }) || value; touch(); },
            }), { id: `side-${index}-id`, hint: 'Short key that moves refer to. Renaming it after moves exist breaks them.' }),
            field('Languages', textInput({
              id: `side-${index}-languages`, value: (side.languages || []).join(', '), placeholder: 'en, ar',
              onChange: (value) => { side.languages = value.split(',').map((code) => code.trim()).filter(Boolean); touch(); },
            }), { id: `side-${index}-languages` })
          ),
          field('What this side has to establish', textArea({
            id: `side-${index}-burden`, value: side.burden, rows: 2,
            onChange: (value) => { side.burden = value; touch(); },
          }), { id: `side-${index}-burden`, hint: 'Required. This is the sentence that makes the exchange a debate rather than two statements.' })
        ),
    });
    clear(sidesNode).append(list.node);
  };

  // ------------------------------------------------------------------ moves

  const evidenceFor = (move, index) => repeatable({
    items: (move.evidence = move.evidence || []),
    addLabel: 'Add evidence',
    emptyLabel: 'No evidence. An argument that cites nothing is flagged, not blocked: sometimes you reason from a text you have not quoted yet.',
    onAdd: () => move.evidence.push({ source: '', locator: '', card: '' }),
    renderItem: (item, eIndex, removeEvidence) =>
      el('div', { class: 'repeatable-item nested' },
        el('div', { class: 'repeatable-head' },
          el('span', { class: 'repeatable-title', text: `Evidence ${eIndex + 1}` }),
          button('Remove', removeEvidence, { class: 'ghost tiny' })
        ),
        field('Source', textInput({
          id: `move-${index}-evidence-${eIndex}-source`, value: item.source,
          onChange: (value) => { item.source = value; touch(); },
        }), { id: `move-${index}-evidence-${eIndex}-source` }),
        el('div', { class: 'form-row' },
          field('Locator', textInput({
            id: `move-${index}-evidence-${eIndex}-locator`, value: item.locator || '',
            onChange: (value) => { item.locator = value; touch(); },
          }), { id: `move-${index}-evidence-${eIndex}-locator` }),
          field('Term card', el('input', {
            id: `move-${index}-evidence-${eIndex}-card`, type: 'text', list: 'term-card-ids',
            value: item.card || '', autocomplete: 'off',
            on: { input: (event) => { item.card = event.target.value.trim(); touch(); } },
          }), { id: `move-${index}-evidence-${eIndex}-card` })
        )
      ),
  });

  const renderMoves = () => {
    const list = repeatable({
      items: (debate.moves = debate.moves || []),
      addLabel: 'Add a move',
      emptyLabel: 'No moves yet. Openings state the case; arguments carry evidence and a warrant; objections must restate what they attack.',
      onAdd: () => debate.moves.push({
        id: nextMoveId(debate), kind: 'argument', side: debate.sides?.[0]?.id || 'pro',
        language: '', claim: '', warrant: '', impact: '', steelman: '', targets: [], evidence: [],
      }),
      onRemove: () => renderMoves(),
      renderItem: (move, index, remove) => {
        const others = debate.moves.filter((other) => other.id !== move.id);
        move.targets = move.targets || [];

        const targetList = others.length
          ? el('ul', { class: 'target-list' }, others.map((other) => {
              const otherIndex = debate.moves.indexOf(other) + 1;
              const checked = move.targets.includes(other.id);
              return el('li', {},
                el('label', { class: 'facet' },
                  el('input', {
                    type: 'checkbox',
                    checked,
                    on: {
                      change: (event) => {
                        if (event.target.checked) move.targets.push(other.id);
                        else move.targets = move.targets.filter((id) => id !== other.id);
                        touch();
                      },
                    },
                  }),
                  el('span', { text: `${otherIndex}. ${MOVE_KIND_LABELS[other.kind] || other.kind}${other.claim ? ` — ${other.claim.slice(0, 50)}` : ''}` })
                )
              );
            }))
          : el('p', { class: 'empty', text: 'No other moves to answer yet.' });

        const author = (debate.sides || []).find((side) => side.id === move.side);

        return el('div', { class: 'repeatable-item version' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Move ${index + 1} — ${move.id}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('p', { class: 'move-meta' },
            el('span', { auto: author?.name || move.side || 'unattributed' }),
            move.at ? ` · ${String(move.at).slice(0, 16).replace('T', ' ')}` : ' · not stamped',
            move.digest ? ` · ${move.digest.slice(0, 12)}` : ''
          ),
          el('div', { class: 'form-row' },
            field('Kind', select({
              id: `move-${index}-kind`, value: move.kind,
              options: MOVE_KINDS.map((kind) => [kind, MOVE_KIND_LABELS[kind]]),
              onChange: (value) => { move.kind = value; renderMoves(); },
            }), { id: `move-${index}-kind` }),
            field('Side', select({
              id: `move-${index}-side`, value: move.side,
              options: (debate.sides || []).map((side) => [side.id, side.name || side.id]),
              onChange: (value) => { move.side = value; touch(); },
            }), { id: `move-${index}-side` })
          ),
          field('The claim', textArea({
            id: `move-${index}-claim`, value: move.claim || '', rows: 2, dir: 'auto',
            onChange: (value) => { move.claim = value; touch(); },
          }), { id: `move-${index}-claim` }),
          field('Evidence', el('div', {}, evidenceFor(move, index).node), {
            id: `move-${index}-evidence`,
            hint: 'A citation, ideally a term card. Evidence is not proof; it is something the other side can check.',
          }),
          field(move.kind === 'objection' ? 'Restate the move it attacks, at its strongest — required' : 'Restate the move it attacks, at its strongest',
            textArea({
              id: `move-${index}-steelman`, value: move.steelman || '', rows: 3, dir: 'auto',
              onChange: (value) => { move.steelman = value; touch(); },
            }),
            {
              id: `move-${index}-steelman`,
              className: move.kind === 'objection' && (move.steelman || '').trim().length < 40 ? 'field-attention' : '',
              hint: 'Before answering, put the other side\u2019s argument as they would put it. This is the rule that stops two speeches happening instead of a debate.',
            }
          ),
          field('Which moves this answers', el('div', {}, targetList), {
            id: `move-${index}-targets`,
            hint: move.kind === 'objection' || move.kind === 'response'
              ? 'Required for objections and responses.'
              : 'Optional elsewhere.',
          }),
          field('Warrant — why the evidence supports the claim', textArea({
            id: `move-${index}-warrant`, value: move.warrant || '', rows: 2, dir: 'auto',
            onChange: (value) => { move.warrant = value; touch(); },
          }), { id: `move-${index}-warrant`, hint: 'Without this the citation is decoration.' }),
          field('Why it matters', textArea({
            id: `move-${index}-impact`, value: move.impact || '', rows: 2, dir: 'auto',
            onChange: (value) => { move.impact = value; touch(); },
          }), { id: `move-${index}-impact` }),
          field('Language the move was made in', el('input', {
            id: `move-${index}-language`, type: 'text', list: 'lang-codes', value: move.language || '',
            autocomplete: 'off',
            on: { input: (event) => { move.language = event.target.value.trim(); touch(); } },
          }), { id: `move-${index}-language`, hint: 'Recorded, because a debate held in two languages has two records.' })
        );
      },
    });
    clear(movesNode).append(list.node);
  };

  // ------------------------------------------------------------ concessions

  const renderConcessions = () => {
    const list = repeatable({
      items: (debate.concessions = debate.concessions || []),
      addLabel: 'Record where a move stands',
      emptyLabel: 'Nothing recorded. Concessions are what a debate actually turns on, and they are usually unrecorded.',
      onAdd: () => debate.concessions.push({ move: debate.moves?.[0]?.id || '', side: debate.sides?.[0]?.id || '', state: 'contested', note: '' }),
      renderItem: (concession, index, remove) =>
        el('div', { class: 'repeatable-item nested' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Concession ${index + 1}` }),
            button('Remove', remove, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Which move', select({
              id: `concession-${index}-move`, value: concession.move,
              options: (debate.moves || []).map((move) => [move.id, moveOptionLabel(debate, move)]),
              onChange: (value) => { concession.move = value; touch(); },
            }), { id: `concession-${index}-move` }),
            field('Which side says so', select({
              id: `concession-${index}-side`, value: concession.side,
              options: (debate.sides || []).map((side) => [side.id, side.name || side.id]),
              onChange: (value) => { concession.side = value; touch(); },
            }), { id: `concession-${index}-side` })
          ),
          field('Where it stands', select({
            id: `concession-${index}-state`, value: concession.state,
            options: CONCESSION_STATES.map((state) => [state, CONCESSION_LABELS[state]]),
            onChange: (value) => { concession.state = value; touch(); },
          }), { id: `concession-${index}-state`, hint: 'Recording a concession is usually more informative than recording a victory.' }),
          field('Note', textInput({
            id: `concession-${index}-note`, value: concession.note || '',
            onChange: (value) => { concession.note = value; touch(); },
          }), { id: `concession-${index}-note` })
        ),
    });
    clear(concessionsNode).append(list.node);
  };

  // ---------------------------------------------------------- adjudication

  const adjudicationNode = el('div', { class: 'adjudication-fields' });

  /**
   * Only a named person decides.
   *
   * The fields appear when a human is recording their own judgement, and the
   * text inputs deliberately do not re-render on keystroke, so the caret stays
   * where it is while somebody writes their reasons.
   */
  const renderAdjudication = () => {
    const adjudication = (debate.adjudication = debate.adjudication || { state: 'open' });
    const decided = adjudication.state === 'decided';
    const unresolved = adjudication.state === 'unresolved';

    clear(adjudicationNode).append(
      decided
        ? field('Adjudicator', textInput({
            id: 'adjudication-adjudicator',
            value: adjudication.adjudicator || '',
            onChange: (value) => { adjudication.adjudicator = value; touch(); },
          }), {
            id: 'adjudication-adjudicator',
            hint: 'A named person. The tool will not fill this in, because a decision the tool made would be worth nothing.',
          })
        : null,
      decided
        ? field('Decision', textInput({
            id: 'adjudication-decision',
            value: adjudication.decision || '',
            onChange: (value) => { adjudication.decision = value; touch(); },
          }), { id: 'adjudication-decision', hint: 'Which side, or which claim, in one sentence.' })
        : null,
      decided || unresolved
        ? field(decided ? 'Reasons' : 'Why nobody moved', textArea({
            id: 'adjudication-reasons',
            value: adjudication.reasons || '',
            rows: 3,
            onChange: (value) => { adjudication.reasons = value; touch(); },
          }), { id: 'adjudication-reasons' })
        : el('p', { class: 'hint', text: 'Still open. Nothing is implied by that.' })
    );
  };

  // ------------------------------------------------------- correspondence

  const correspondenceNode = el('div', { class: 'correspondence' });
  let mySideId = debate.sides?.[0]?.id || '';

  const chainLine = () => {
    const chain = verifyChain(debate);
    if (chain.state === 'empty') return el('p', { class: 'hint', text: 'No moves yet, so nothing is stamped.' });
    if (chain.state === 'unsigned') {
      return el('p', { class: 'hint', text: `${chain.count} move(s), none stamped yet. They will be stamped when you save.` });
    }
    if (chain.state === 'partial') {
      return el('p', { class: 'hint', text: `Move ${chain.index + 1} is not stamped yet. Save to stamp it.` });
    }
    if (chain.state === 'broken') {
      return el('div', { class: 'message message-error' },
        el('p', {},
          chain.reason === 'content'
            ? `Move ${chain.index + 1} does not match what it was stamped with. It has been edited since.`
            : `The chain breaks at move ${chain.index + 1}: it links to a transcript you do not hold.`
        ),
        el('p', { class: 'hint', text: 'Exporting a contribution will refuse while this is true, because the other side could not tell your correction from a rewrite.' })
      );
    }
    return el('p', { class: 'clean', text: `Chain intact across ${chain.count} move(s).` });
  };

  const renderCorrespondence = () => {
    const sides = debate.sides || [];
    if (!sides.some((side) => side.id === mySideId)) mySideId = sides[0]?.id || '';
    const chain = verifyChain(debate);
    const resultNode = el('div', { class: 'import-result' });
    const input = el('textarea', {
      id: 'contribution-input', rows: 5, spellcheck: 'false',
      placeholder: 'Paste the contribution file your correspondent sent you.',
    });

    clear(correspondenceNode).append(
      el('p', {
        class: 'hint',
        text: 'No server, so the exchange is by file. You write only your own moves and send them; the other side merges them and sends theirs back. Neither of you can alter the other\u2019s words without the digests failing.',
      }),
      field('Which side are you?', select({
        id: 'correspondence-side',
        value: mySideId,
        options: sides.map((side) => [side.id, side.name || side.id]),
        onChange: (value) => { mySideId = value; renderCorrespondence(); },
      }), { id: 'correspondence-side', hint: 'Only this side\u2019s moves are exported. Your drafts and other debates never leave.' }),

      chainLine(),

      definitionList([
        ['Transcript revision', chain.digest ? chain.digest.slice(0, 16) : 'not stamped yet'],
        ['Pinned terms', termsDigest(debate.terms).slice(0, 16)],
      ]),
      el('p', { class: 'hint', text: 'Both sides can read those two lines aloud to each other. If the terms digest differs, you are not arguing about the same words.' }),

      el('div', { class: 'actions' },
        button('Export my moves to send', () => onExportContribution(mySideId), { class: 'ghost' }),
        chain.state === 'broken'
          ? button('Re-stamp everything', () => onRestamp(), { class: 'ghost danger' })
          : null
      ),

      field('Import a contribution', input, {
        id: 'contribution-input',
        hint: 'Nothing is merged if a move contradicts one you already hold, if a digest does not match, or if it was written against a transcript you do not have.',
      }),
      el('div', { class: 'actions' },
        button('Merge it', () => {
          const outcome = onImportContribution(input.value);
          resultNode.replaceChildren(
            ...(outcome?.messages || []).map((message) =>
              el('p', { class: outcome?.ok ? 'clean' : 'field-error', text: message })
            ),
            ...(outcome?.conflicts || []).map((conflict) =>
              el('p', { class: 'field-error', text: `${conflict.id}: ${conflict.reason}` })
            )
          );
          if (outcome?.ok && outcome.added?.length) {
            input.value = '';
            renderMoves();
            renderCorrespondence();
            refresh();
          }
        })
      ),
      resultNode
    );
  };

  renderTerms();
  renderSides();
  renderMoves();
  renderConcessions();
  renderAdjudication();
  renderCorrespondence();

  const node = el('article', { class: 'editor debate-editor' },
    datalists(),
    el('datalist', { id: 'term-card-ids' }, cards.map((card) => el('option', { value: card.id, text: card.concept.label }))),
    el('p', { class: 'crumb' }, el('a', { href: '#/drafts', text: '← Your drafts' })),
    el('h2', { text: debate.motion || 'New debate', tabindex: '-1' }),
    el('p', { class: 'lede' }, 'A structured disputation. Terms are pinned before anyone argues about them, every side states what it has to establish, and an objection must restate what it attacks before answering it. This stays on your device until you export it.'),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'The motion' }),
      field('Motion', textArea({
        id: 'debate-motion', value: debate.motion, rows: 2,
        onChange: (value) => { debate.motion = value; touch(); },
      }), { id: 'debate-motion', hint: 'One sentence that could be affirmed or denied. \u201cHesed is untranslatable\u201d is a motion; \u201ctranslation\u201d is a topic.' }),
      el('div', { class: 'form-row' },
        field('Kind', select({
          id: 'debate-kind', value: debate.kind,
          options: DEBATE_KINDS.map((kind) => [kind, kind]),
          onChange: (value) => { debate.kind = value; touch(); },
        }), { id: 'debate-kind' }),
        field('Opened', textInput({
          id: 'debate-created', value: debate.created, type: 'date',
          onChange: (value) => { debate.created = value; touch(); },
        }), { id: 'debate-created' })
      )
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Terms, pinned before argument' }),
      hint('Most interfaith disagreement about a word is disagreement about the word. Pin it first, or find out that you cannot.'),
      termsNode
    ),

    stateNode,

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Sides and their burdens' }),
      hint('A debate without a stated burden is an argument.'),
      sidesNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'The exchange' }),
      movesNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Where each move stands' }),
      concessionsNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Correspondence' }),
      correspondenceNode
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Adjudication' }),
      hint('The tool does not decide debates and there is nowhere here to make it try. A decision needs a named person and their reasons; leaving it open or unresolved is a legitimate outcome.'),
      field('State', select({
        id: 'adjudication-state', value: debate.adjudication?.state || 'open',
        options: ADJUDICATION_STATES.map((state) => [state, state]),
        onChange: (value) => { setPath(debate, 'adjudication.state', value); renderAdjudication(); },
      }), { id: 'adjudication-state' }),
      adjudicationNode,
    ),

    el('fieldset', { class: 'group' },
      el('legend', { text: 'Note' }),
      textArea({
        id: 'debate-note', value: debate.note || '', rows: 2,
        onChange: (value) => { debate.note = value; touch(); },
      })
    ),

    findingsNode,

    el('div', { class: 'actions sticky-actions' },
      button('Save', () => onSave(debate)),
      button('Export debate JSON', () => onExport('debate', debate), { class: 'ghost' }),
      button('Export for circulation (Markdown)', () => onExport('debate-markdown', debate), { class: 'ghost' }),
      button('Export as an argument graph (AIF)', () => onExport('debate-aif', debate), { class: 'ghost' }),
      button('Publish this debate', () => onExport('debate-publish', debate), { class: 'ghost' }),
      button('Print', () => window.print(), { class: 'ghost' }),
      button('Start over', () => onReset(), { class: 'ghost' }),
      button('Delete', () => onDelete(debate.id), { class: 'ghost danger' })
    )
  );

  refresh();
  return { node, refresh };
}

/** A readable label for a move, for picking one in a select. */
function moveOptionLabel(debate, move) {
  const index = (debate.moves || []).indexOf(move) + 1;
  const kind = MOVE_KIND_LABELS[move.kind] || move.kind;
  return `${index}. ${kind}${move.claim ? ` — ${move.claim.slice(0, 40)}` : ''}`;
}

/** Facts about the record. No score, no winner, and it says so. */
function debatePanel(debate, cards) {
  const state = debateState(debate);

  return el('div', { class: 'panel-block' },
    el('h3', { text: 'Where this stands' }),
    el('p', { class: 'hint', text: 'Facts about the record, not a verdict. This panel does not know who argued better and there is no way to tell it.' }),

    el('ul', { class: 'stats' },
      stat(state.moves, 'moves'),
      stat(state.unanswered.length, 'objections unanswered'),
      stat(state.unsupported.length, 'arguments citing nothing'),
      stat(state.unwarranted.length, 'arguments with no warrant'),
      stat(state.unpinnedTerms.length, 'terms still unpinned')
    ),

    state.terminologyFirst
      ? el('p', { class: 'clean', text: 'Every term was pinned before argument. Whatever the outcome, the sides were arguing about the same thing.' })
      : el('p', { class: 'hint', text: 'At least one term was left unpinned, so some of this may be a disagreement about a word rather than about doctrine.' }),

    el('ul', { class: 'parity-list' }, state.bySide.map((entry) =>
      el('li', { class: 'parity-row' },
        el('span', { auto: entry.side.name || entry.side.id }),
        el('span', { class: 'lang', text: entry.side.position }),
        el('span', { class: 'lang', text: `${entry.moves} moves` }),
        entry.burdensStated
          ? el('span', { class: 'status status-ok', text: 'burden stated' })
          : el('span', { class: 'status status-alert', text: 'no burden stated' }),
        state.concessions.get(entry.side.id)
          ? el('span', { class: 'lang', text: `${state.concessions.get(entry.side.id).conceded || 0} conceded` })
          : null
      )
    )),

    state.vagueSteelman.length
      ? el('div', { class: 'signals' },
          el('h4', { text: 'Thin restatements' }),
          el('ul', {}, state.vagueSteelman.map((move) => el('li', { text: `${move.id}: the other side's argument is restated too briefly to be fair to it` })))
        )
      : null,

    state.unanswered.length
      ? el('div', { class: 'signals' },
          el('h4', { text: 'Objections nobody answered' }),
          el('ul', {}, state.unanswered.map((move) => el('li', { text: move.claim || move.id })))
        )
      : null,

    state.reliedOn.length
      ? el('div', { class: 'cited' },
          el('h4', { text: 'Term cards relied on' }),
          el('ul', {}, state.reliedOn.map((entry) => {
            const card = cards.find((c) => c.id === entry.card);
            return el('li', {},
              card ? el('a', { href: `#/term/${encodeURIComponent(card.id)}`, auto: card.concept.label }) : el('code', { text: entry.card }),
              el('span', { text: ` ×${entry.count}` })
            );
          }))
        )
      : null,

    el('p', { class: 'hint' },
      'Adjudication: ',
      debate.adjudication?.state === 'decided'
        ? el('strong', { text: `decided by ${debate.adjudication.adjudicator || 'an unnamed person'}` })
        : el('strong', { text: debate.adjudication?.state === 'unresolved' ? 'recorded as unresolved' : 'still open' })
    )
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
      el('p', { class: 'hint', text: `Currently on this device: ${counts.cards} draft card(s), ${counts.statements} statement(s), ${counts.debates ?? 0} debate(s). Nothing here has ever been sent anywhere.` }),
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


