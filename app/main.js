/**
 * Wiring: routing, state, and handlers.
 *
 * Two structural decisions worth knowing before reading:
 *
 *  1. The search panel is built once and lives outside the re-render path, so
 *     typing never destroys the input. Only the result list re-renders.
 *  2. Search state is mirrored into the URL with replaceState, so a search is a
 *     link you can send somebody, without filling the back button with every
 *     keystroke.
 *
 * Everything a person writes goes to local storage and to files. There is no
 * request in this file that sends content anywhere.
 */

import { loadTermBase } from './terms.js';
import { buildIndex, search, facets, encodeSearch, decodeSearch } from './search.js';
import { cardDigest } from './hash.js';
import { citeCard, citeCardBibtex, cardToMarkdown, citeStatement, permalink } from './cite.js';
import { toCsv, toTbx, toLossReport, statementToMarkdown, filename, parseCardsInput, parseStatementInput } from './export.js';
import { blankCard, lintCard } from './lint.js';
import { pruneEmpty } from './forms.js';
import { blankStatement, statementId } from './parity.js';
import { el, clear, download, copyText } from './dom.js';
import {
  buildSearchPanel, cardListItem, termView, lossesView, matrixView, compareView,
  aboutView, messageView,
} from './ui.js';
import { cardEditorView, draftsView, statementEditorView, debateEditorView, settingsView, importView } from './editor.js';
import { debateRoomView } from './room-view.js';
import {
  blankSession, sessionToDebate, motionsFor,
} from './room.js';
import {
  blankDebate, debateSlug, lintDebate, debateToMarkdown,
  stampChain, restampAll, contributionFor, mergeContribution,
} from './debate.js';
import {
  loadDraftCards, saveDraftCard, deleteDraftCard,
  loadStatements, saveStatement, deleteStatement,
  loadSettings, saveSettings, pushRecent,
  loadDebates, saveDebate, deleteDebate,
  loadSession, saveSession, clearSession,
  storageAvailable, exportEverything, importEverything, migrateLegacyStorage,
} from './store.js';

// ---------------------------------------------------------------------- state

const state = {
  bundle: null,
  index: [],
  cards: [],
  digests: new Map(),
  facetData: null,
  filters: { languages: new Set(), originLanguages: new Set(), statuses: new Set(), traditions: new Set() },
  query: '',
  route: { name: 'room', params: new URLSearchParams() },
  drafts: [],
  statements: [],
  debates: [],
  session: loadSession() || blankSession(),
  settings: loadSettings(),
  storageOk: storageAvailable(),
  results: [],
};

const main = document.getElementById('main');
const browse = el('section', { class: 'browse', id: 'browse' });
const view = el('div', { class: 'view', id: 'view' });
const toastNode = el('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
let panel = null;
let toastTimer = null;

main.append(browse, view, toastNode);

// -------------------------------------------------------------------- routing

const ROUTES = ['room', 'terms', 'term', 'losses', 'matrix', 'compare', 'drafts', 'author', 'statement', 'debate', 'import', 'settings', 'about'];

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart);
  if (!parts.length) {
    // The room is the front door now, and the term base lives at #/terms. A
    // link to a search, like #/?q=hesed, still belongs to the term base and
    // still works: nothing that was ever cited should break because the home
    // page changed.
    const looksLikeSearch = ['q', 'languages', 'originLanguages', 'statuses', 'traditions']
      .some((key) => params.has(key));
    return { name: looksLikeSearch ? 'terms' : 'room', params };
  }
  const [head, second] = parts;
  if (!ROUTES.includes(head)) return { name: 'notfound', params };
  return { name: head, id: second ? decodeURIComponent(second) : null, params };
}

function go(route) {
  location.hash = route.startsWith('#') ? route : `#${route}`;
}

// -------------------------------------------------------------------- toasts

function toast(message, { sticky = false, node = null, tone = '' } = {}) {
  clearTimeout(toastTimer);
  toastNode.className = `toast ${tone}`.trim();
  toastNode.replaceChildren(node || el('p', { text: message }));
  toastNode.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => { toastNode.hidden = true; }, 4200);
}

async function copyAndSay(text, successMessage) {
  const result = await copyText(text);
  if (result.ok) {
    toast(successMessage);
  } else {
    toast('', {
      sticky: true,
      node: el('div', {},
        el('p', { text: 'The clipboard is unavailable on this origin. Select and copy:' }),
        el('pre', { class: 'citation-block', text })
      ),
    });
  }
  return result;
}

// ------------------------------------------------------------------- settings

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_ICONS = { light: '☀', dark: '☾' };
const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/**
 * Which theme is actually on screen.
 *
 * "Follow the system" is resolved here rather than by a CSS media query, so the
 * dark palette is written down once, in styles/base.css. The header script does
 * the same resolution before the first paint; this is the same rule applied
 * after it.
 */
function effectiveTheme() {
  const chosen = state.settings.theme || 'system';
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return prefersDark() ? 'dark' : 'light';
}

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = effectiveTheme();
  root.style.setProperty('--text-scale', String(state.settings.textScale || '1'));
  root.dataset.translit = state.settings.transliteration === false ? 'off' : 'on';
  syncThemeToggle();
}

/**
 * Keep the header button honest about what it will do next.
 *
 * The title and aria-label carry the full story, including whether the system
 * preference is currently in charge, because a two-state button that cycles
 * through three states is a worse answer than saying plainly what is happening.
 */
function syncThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const chosen = state.settings.theme || 'system';
  const effective = effectiveTheme();
  const following = chosen === 'system' ? ' (following your system)' : '';
  const description =
    `Colour theme: ${THEME_LABELS[effective].toLowerCase()}${following}. ` +
    `Switch to ${effective === 'dark' ? 'light' : 'dark'}.`;

  toggle.title = description;
  toggle.setAttribute('aria-label', description);
  const label = toggle.querySelector('.theme-label');
  if (label) label.textContent = THEME_LABELS[effective];
  const icon = toggle.querySelector('.theme-icon');
  if (icon) icon.textContent = THEME_ICONS[effective];
}

/** Switching is explicit: it stops following the system and records a choice. */
function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  changeSetting('theme', next);
  toast(`Reading in ${next} mode.`);
  if (state.route.name === 'settings') render();
}

function changeSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  const result = saveSettings(state.settings);
  applySettings();
  if (!result.ok) toast(result.error, { sticky: true });
}

// ------------------------------------------------------------------ rendering

function currentResults() {
  return search(state.index, state.query, state.filters);
}

function renderResults() {
  state.results = currentResults();
  const total = state.cards.length;
  const activeFilters = Object.values(state.filters).reduce((sum, set) => sum + set.size, 0);

  panel.count.textContent = state.results.length === total
    ? `All ${total} cards.`
    : `${state.results.length} of ${total} cards${activeFilters ? ' (filters active)' : ''}.`;

  panel.results.replaceChildren(
    state.results.length
      ? el('ul', { class: 'cards' }, state.results.map((result) => cardListItem(result.entry, result.why)))
      : messageView(
          'Nothing matches',
          state.query
            ? `No card matches “${state.query}” with the current filters. Try a single word, or clear the filters.`
            : 'No card matches the current filters.',
          { tone: 'info' }
        )
  );

  // Keep the URL in step so the search is a link, without touching history.
  if (state.route.name === 'terms' && panel) {
    const encoded = encodeSearch({ query: state.query, filters: state.filters });
    const target = `#/${encoded ? `?${encoded}` : ''}`;
    try {
      history.replaceState(null, '', target);
    } catch {
      // replaceState is unavailable on some file:// origins. The search still works.
    }
    panel.input.value = state.query;
  }
}

/**
 * Swap the main view, giving the outgoing view a chance to clean up.
 *
 * The debating room owns a setInterval, and a view that leaks one keeps ticking
 * against a detached DOM. Any future view with a timer, a socket, or an observer
 * gets the same treatment for free.
 */
let disposeView = null;
function setView(next, dispose = null) {
  if (typeof disposeView === 'function') disposeView();
  disposeView = dispose;
  setView(next);
}

function render({ moveFocus = false, replacePanel = false } = {}) {
  if (!state.bundle) return;

  const route = state.route;
  const isTerms = route.name === 'terms';
  browse.hidden = !isTerms;
  view.hidden = isTerms;

  if (isTerms) {
    document.title = 'Witness — no claim without a witness';
    if (replacePanel || !panel) {
      if (panel) panel.node.remove();
      panel = buildSearchPanel({
        onQuery: (value) => { state.query = value; renderResults(); },
        onFilter: () => renderResults(),
        onReset: resetFilters,
        onPermalink: () => copyAndSay(permalink(`/?${encodeSearch({ query: state.query, filters: state.filters })}`), 'Link to this search copied.'),
        onPrint: () => window.print(),
        onExport: exportResults,
      });
      panel.setFacets(state.facetData, state.filters);
      browse.append(panel.node, panel.toolbar, panel.count, panel.results);
    }
    renderResults();
    if (moveFocus) (state.query ? panel.input : panel.input)?.focus();
    return;
  }

  if (panel) panel.input.blur();

  switch (route.name) {
    case 'room': {
      document.title = state.session?.motion
        ? `${state.session.motion} — Witness`
        : 'Debate room — Witness';
      const roomView = debateRoomView({
        session: state.session,
        motions: motionsFor(state.cards),
        cards: state.cards,
        onPersist: (session, message) => {
          state.session = session;
          saveSession(session);
          if (message) toast(message);
        },
        onProduce: produceRecord,
        onReset: () => {
          state.session = blankSession();
          clearSession();
          render();
        },
      });
      setView(roomView.node, roomView.dispose);
      break;
    }
    case 'term': {
      const card = state.cards.find((c) => c.id === route.id);
      if (!card) {
        document.title = 'No such card — Witness';
        setView(messageView(
          'No such card',
          `No card in this revision of the term base has the id “${route.id}”. It may have been renamed, or the link may come from a different base revision.`,
          { tone: 'error' }
        ));
        break;
      }
      document.title = `${card.concept.label} — Witness`;
      pushRecent(card.id);
      setView(termView(card, {
        digest: state.digests.get(card.id),
        baseRevision: state.bundle.digest,
        cards: state.cards,
        actions: cardActions,
      }));
      break;
    }
    case 'losses':
      document.title = 'Loss ledger — Witness';
      setView(lossesView(state.cards, { onExport: exportEverythingFor, actions: cardActions }));
      break;
    case 'matrix':
      document.title = 'Concepts by language — Witness';
      setView(matrixView(state.cards, cardActions));
      break;
    case 'compare':
      document.title = 'Compare — Witness';
      setView(compareView(state.cards, {
        a: route.params.get('a') || '',
        b: route.params.get('b') || '',
        actions: {
          ...cardActions,
          setCompare: (side, value) => {
            const params = new URLSearchParams(state.route.params);
            if (value) params.set(side, value);
            else params.delete(side);
            go(`/compare${params.toString() ? `?${params}` : ''}`);
          },
        },
      }));
      break;
    case 'drafts':
      document.title = 'Your drafts — Witness';
      setView(draftsView({
        cards: state.drafts,
        statements: state.statements,
        debates: state.debates,
        onEdit: openDraft,
        onDelete: removeDraft,
        onExport: exportEverythingFor,
        onCreate: (kind) => go(kind === 'debate' ? '/debate' : kind === 'statement' ? '/statement' : '/author'),
        onImport: () => go('/import'),
      }));
      break;
    case 'author': {
      const draft = route.id ? state.drafts.find((d) => d.id === route.id) : null;
      document.title = draft ? `Editing ${draft.concept.label || draft.id} — Witness` : 'New card — Witness';
      setView(cardEditorView({
        draft: draft || blankCard(),
        onSave: saveCardDraft,
        onExport: exportEverythingFor,
        onDelete: (id) => { removeDraft(id); go('/drafts'); },
        onReset: () => go('/author'),
        onImport: () => go('/import'),
      }).node);
      break;
    }
    case 'statement': {
      const statement = route.id ? state.statements.find((s) => s.id === route.id) : null;
      document.title = statement ? `${statement.title || statement.id} — Witness` : 'New statement — Witness';
      setView(statementEditorView({
        statement: statement || blankStatement(),
        cards: state.cards,
        onSave: saveStatementDraft,
        onExport: exportEverythingFor,
        onDelete: (id) => { removeDraft(id); go('/drafts'); },
        onReset: () => go('/statement'),
      }).node);
      break;
    }
    case 'debate': {
      const openDebate = route.id ? state.debates.find((d) => d.id === route.id) : null;
      const working = openDebate || blankDebate();
      document.title = openDebate ? `${openDebate.motion || openDebate.id} — Witness` : 'New debate — Witness';
      setView(debateEditorView({
        debate: working,
        cards: state.cards,
        onSave: saveDebateDraft,
        onExport: exportEverythingFor,
        onDelete: (id) => { removeDraft(id); go('/drafts'); },
        onReset: () => go('/debate'),
        onExportContribution: (sideId) => exportContribution(working, sideId),
        onImportContribution: (text) => importContribution(working, text),
        onRestamp: () => restampDebate(working),
      }).node);
      break;
    }
    case 'import':
      document.title = 'Import — Witness';
      setView(importView({
        onImportText: importText,
        onCancel: () => go('/drafts'),
      }));
      break;
    case 'settings':
      document.title = 'Settings — Witness';
      setView(settingsView({
        settings: state.settings,
        onChange: changeSetting,
        onExportArchive: () => {
          download(filename('archive', 'local', 'json'), JSON.stringify(exportEverything(), null, 2));
          toast('Archive downloaded. Keep it somewhere you would keep notes you care about.');
        },
        onImportArchive: () => go('/import'),
        onClearAll: clearAllData,
        storageOk: state.storageOk,
        counts: { cards: state.drafts.length, statements: state.statements.length, debates: state.debates.length },
      }));
      break;
    case 'about':
      document.title = 'About — Witness';
      setView(aboutView({
        count: state.cards.length,
        baseRevision: state.bundle.digest,
        stats: statsFor(state.cards),
      }));
      break;
    default:
      document.title = 'Not found — Witness';
      setView(messageView('No such page', 'That route does not exist.', { tone: 'error' }));
  }

  if (moveFocus) view.querySelector('h2')?.focus();
}

function statsFor(cards) {
  const renditions = cards.flatMap((c) => c.renditions);
  return {
    renditions: renditions.length,
    languages: new Set(renditions.map((r) => r.language)).size,
  };
}

// ------------------------------------------------------------------ handlers

function resetFilters() {
  for (const set of Object.values(state.filters)) set.clear();
  panel.setFacets(state.facetData, state.filters);
  renderResults();
}

function saveCardDraft(draft) {
  const findings = lintCard(draft, `${draft.id || 'card'}.json`);
  const errors = findings.filter((f) => f.level === 'error');
  if (!draft.id) {
    toast('Give the card an id first — it becomes the filename and the citation key.', { tone: 'warn' });
    return;
  }
  const result = saveDraftCard(draft);
  state.drafts = loadDraftCards();
  if (!result.ok) {
    toast(result.error, { sticky: true, tone: 'error' });
    return;
  }
  if (errors.length) {
    toast(`Saved as a draft, with ${errors.length} error${errors.length === 1 ? '' : 's'} still to fix. It cannot be published until they are.`, { tone: 'warn' });
  } else {
    toast('Saved on this device. Export the JSON when you are ready to contribute it.');
  }
}

function saveStatementDraft(statement) {
  if (!statement.title) {
    toast('A statement needs a title.', { tone: 'warn' });
    return;
  }
  if (!statement.id) statement.id = statementId(statement);
  // Normalise the record type on save. A statement written before the rename
  // still says the old identifier; the shape is unchanged, so this is metadata
  // catching up rather than content being rewritten.
  statement.format = 'witness/statement';
  const result = saveStatement(statement);
  state.statements = loadStatements();
  if (!result.ok) {
    toast(result.error, { sticky: true, tone: 'error' });
    return;
  }
  toast('Saved on this device. Nothing was uploaded.');
}

/**
 * The room has finished, so it becomes the record.
 *
 * The session is cleared afterwards: the room was the live thing, and what it
 * produced is an editable record. Keeping both would mean two copies of the same
 * debate drifting apart.
 */
function produceRecord(session) {
  const record = sessionToDebate(session);
  const result = saveDebate(record);
  state.debates = loadDebates();
  if (!result.ok) {
    toast(result.error, { sticky: true, tone: 'error' });
    return;
  }
  state.session = blankSession();
  clearSession();
  toast('The room is now a debate record. Nothing was uploaded.');
  go(`/debate/${encodeURIComponent(record.id)}`);
}

function saveDebateDraft(debate) {
  if (!debate.motion) {
    toast('A debate needs a motion: one sentence that could be affirmed or denied.', { tone: 'warn' });
    return;
  }
  if (!debate.id) debate.id = debateSlug(debate);
  debate.format = 'witness/debate';

  // Stamp before saving. Only appends: a move that already carries a digest is
  // verified rather than recomputed, so this cannot launder an edit.
  const stamp = stampChain(debate);
  const result = saveDebate(debate);
  state.debates = loadDebates();
  if (!result.ok) {
    toast(result.error, { sticky: true, tone: 'error' });
    return;
  }
  if (!stamp.ok) {
    toast(
      `Saved, but the record no longer verifies: move ${stamp.index + 1} was changed after it was stamped. Exporting a contribution will refuse until you re-stamp it, which is only legitimate if you have not sent it yet.`,
      { sticky: true, tone: 'error' }
    );
    return;
  }

  // Errors are about the record's shape; warnings are about argument hygiene.
  // They are reported differently because one blocks a readable record and the
  // other is just worth knowing.
  const findings = lintDebate(debate);
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warn').length;
  if (errors) {
    toast(`Saved with ${errors} problem${errors === 1 ? '' : 's'} in the record still to fix.`, { tone: 'warn' });
  } else if (warnings) {
    toast(`Saved. ${warnings} thing${warnings === 1 ? '' : 's'} worth a look, listed under the form.`);
  } else {
    toast('Saved on this device. Nothing was uploaded.');
  }
}

/**
 * Send only your own moves.
 *
 * Refuses outright when the record does not verify: a contribution is a claim
 * about what you said, and sending one from a transcript you cannot verify would
 * be worse than sending nothing.
 */
function exportContribution(debate, sideId) {
  const stamp = stampChain(debate);
  if (!stamp.ok) {
    toast(`Not exported: move ${stamp.index + 1} no longer matches what it was stamped with.`, { sticky: true, tone: 'error' });
    return;
  }
  const contribution = contributionFor(debate, sideId);
  download(
    filename('contribution', `${debate.id || 'debate'}-${sideId}`, 'json'),
    `${JSON.stringify(contribution, null, 2)}\n`
  );
  toast('Contribution downloaded. It contains only your own moves, with the rest of your work left out.');
}

/** Merge what came back. Merging changes the record, so it is saved immediately. */
function importContribution(debate, text) {
  if (!text?.trim()) {
    return { ok: false, messages: ['Paste a contribution file first.'], conflicts: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, messages: [`That is not valid JSON — ${error.message}`], conflicts: [] };
  }

  const outcome = mergeContribution(debate, parsed);
  if (outcome.ok && outcome.added.length) {
    saveDebate(debate);
    state.debates = loadDebates();
  }
  return outcome;
}

/** Deliberate, destructive, and only legitimate before an exchange. */
function restampDebate(debate) {
  const confirmed = globalThis.confirm?.(
    'Re-stamp the whole transcript? This throws away every recorded digest and computes them again from the current text. It cannot tell a correction from a rewrite, so any copy the other side already holds will stop matching. Do this only if you have not sent this debate to anyone.'
  );
  if (!confirmed) return;
  const result = restampAll(debate);
  saveDebate(debate);
  state.debates = loadDebates();
  toast(result.ok ? 'Re-stamped from the current text.' : 'Re-stamping failed.', { tone: result.ok ? '' : 'error' });
  render();
}

function openDraft(draft) {
  if (draft.moves) {
    state.debates = loadDebates();
    go(`/debate/${encodeURIComponent(draft.id)}`);
  } else if (draft.versions) {
    state.statements = loadStatements();
    go(`/statement/${encodeURIComponent(draft.id)}`);
  } else {
    state.drafts = loadDraftCards();
    go(`/author/${encodeURIComponent(draft.id)}`);
  }
}

function removeDraft(id) {
  if (state.debates.some((d) => d.id === id)) deleteDebate(id);
  else if (state.statements.some((s) => s.id === id)) deleteStatement(id);
  else deleteDraftCard(id);
  state.drafts = loadDraftCards();
  state.statements = loadStatements();
  state.debates = loadDebates();
  toast('Deleted from this device.');
}

function clearAllData() {
  const confirmed = globalThis.confirm?.(
    'Delete every draft, statement, and debate stored in this browser? This cannot be undone. Export first if you are not sure.'
  );
  if (!confirmed) return;
  for (const draft of loadDraftCards()) deleteDraftCard(draft.id);
  for (const statement of loadStatements()) deleteStatement(statement.id);
  for (const debate of loadDebates()) deleteDebate(debate.id);
  state.drafts = [];
  state.statements = [];
  state.debates = [];
  toast('All local data deleted.');
  render();
}

// Archives exported before the rename carry the old identifier, and nothing
// about their contents changed with the name, so they still import.
const ARCHIVE_FORMATS = ['witness/local-archive', 'colophon/local-archive'];

function importText(text, kind) {
  if (!text.trim()) return { ok: false, message: 'Paste something first.' };
  try {
    const isArchive = ARCHIVE_FORMATS.some((format) => text.includes(`"format": "${format}"`));
    if (kind === 'archive' || (kind === 'auto' && isArchive)) {
      const summary = importEverything(JSON.parse(text));
      state.drafts = loadDraftCards();
      state.statements = loadStatements();
      state.debates = loadDebates();
      return {
        ok: true,
        message: `Imported ${summary.drafts} card(s), ${summary.statements} statement(s), ${summary.debates} debate(s).`,
      };
    }
    if (text.includes('witness/contribution') || kind === 'contribution') {
      return {
        ok: false,
        message: 'A contribution is merged into a debate rather than imported on its own: it belongs to a specific exchange. Open that debate, then use Correspondence → Merge it.',
      };
    }
    if (kind === 'debate' || (kind === 'auto' && text.includes('"motion"') && text.includes('"moves"'))) {
      const debate = JSON.parse(text);
      if (!Array.isArray(debate.moves)) throw new Error('expected a debate record with a "moves" array');
      if (!debate.id) debate.id = debateSlug(debate);
      debate.format = 'witness/debate';
      saveDebate(debate);
      state.debates = loadDebates();
      return { ok: true, message: `Imported the debate “${debate.motion || debate.id}”.` };
    }
    if (kind === 'statement' || (kind === 'auto' && text.includes('"versions"'))) {
      const statement = parseStatementInput(text);
      if (!statement.id) statement.id = statementId(statement);
      saveStatement(statement);
      state.statements = loadStatements();
      return { ok: true, message: `Imported the statement “${statement.title || statement.id}”.` };
    }
    const cards = parseCardsInput(text);
    const problems = [];
    for (const card of cards) {
      const findings = lintCard(card, `${card.id || 'card'}.json`);
      const errors = findings.filter((f) => f.level === 'error');
      if (!card.id) {
        problems.push('a card with no id');
        continue;
      }
      saveDraftCard(card);
      if (errors.length) problems.push(`${card.id}: ${errors.length} error(s)`);
    }
    state.drafts = loadDraftCards();
    return {
      ok: true,
      message: `Imported ${cards.length} card(s) into your drafts.${problems.length ? ` Needs attention: ${problems.join('; ')}` : ''}`,
    };
  } catch (error) {
    return { ok: false, message: `Could not import: ${error.message}` };
  }
}

// ------------------------------------------------------------------- exports

function exportEverythingFor(kind, payload) {
  switch (kind) {
    case 'card': {
      // Pruned, so empty optional fields do not ship as empty strings and make a
      // reviewer guess whether they were meant.
      download(filename('card', payload.id, 'json'), `${JSON.stringify(pruneEmpty(payload), null, 2)}\n`);
      toast('Card JSON downloaded. This is the file to contribute.');
      return;
    }
    case 'card-copy':
      return copyAndSay(
        JSON.stringify(pruneEmpty(payload), null, 2),
        'Card JSON copied. Paste it into an issue, or save it and open a pull request.'
      );
    case 'csv':
      download(filename('terms', 'base', 'csv'), toCsv(state.results.map((r) => r.entry.card)), 'text/csv');
      toast('CSV downloaded. One row per rendering, with the recorded losses.');
      return;
    case 'tbx':
      download(filename('terms', 'base', 'tbx'), toTbx(state.results.map((r) => r.entry.card)), 'application/xml');
      toast('TBX downloaded. Translators can open this in a CAT tool.');
      return;
    case 'markdown':
      download(filename('losses', 'report', 'md'), toLossReport(state.cards), 'text/markdown');
      toast('Loss report downloaded.');
      return;
    case 'statement':
      download(filename('statement', payload.id || payload.title, 'json'), `${JSON.stringify(payload, null, 2)}\n`);
      toast('Statement record downloaded. This is the file that travels with the approvals.');
      return;
    case 'statement-markdown':
      download(filename('statement', payload.id || payload.title, 'md'), statementToMarkdown(payload), 'text/markdown');
      toast('Markdown downloaded. This is the version to circulate.');
      return;
    case 'debate':
      download(filename('debate', payload.id || payload.motion, 'json'), `${JSON.stringify(payload, null, 2)}\n`);
      toast('Debate record downloaded. The JSON is the record of what each side actually said.');
      return;
    case 'debate-markdown':
      download(filename('debate', payload.id || payload.motion, 'md'), debateToMarkdown(payload), 'text/markdown');
      toast('Markdown downloaded. This is the version to circulate, including the objections nobody answered.');
      return;
    case 'statement-cite':
      return copyAndSay(citeStatement(payload, { url: permalink(`/statement/${payload.id}`) }), 'Statement citation copied.');
    case 'archive':
      download(filename('archive', 'local', 'json'), JSON.stringify(exportEverything(), null, 2));
      return;
    default:
      toast(`Unknown export “${kind}”.`, { tone: 'warn' });
  }
}

function exportResults(kind) {
  exportEverythingFor(kind);
}

const cardActions = {
  cite: (id) => {
    const card = state.cards.find((c) => c.id === id);
    return copyAndSay(
      citeCard(card, state.digests.get(id), {
        baseRevision: state.bundle.digest,
        url: permalink(`/term/${id}`),
      }),
      'Citation copied. It names the card revision, so the claim stays checkable.'
    );
  },
  copyMarkdown: (id) => {
    const card = state.cards.find((c) => c.id === id);
    return copyAndSay(cardToMarkdown(card, state.digests.get(id), { url: permalink(`/term/${id}`) }), 'Card copied as Markdown.');
  },
  copyBibtex: (id) => {
    const card = state.cards.find((c) => c.id === id);
    return copyAndSay(citeCardBibtex(card, state.digests.get(id), { url: permalink(`/term/${id}`) }), 'BibTeX copied.');
  },
  copyLink: (route) => copyAndSay(permalink(route), 'Link copied.'),
  downloadCard: (id) => {
    const card = state.cards.find((c) => c.id === id);
    // Exported exactly as published, unpruned, so the digest of the file a
    // reader downloads matches the digest on the card.
    download(filename('card', id, 'json'), `${JSON.stringify(card, null, 2)}\n`);
    toast('Card JSON downloaded. It is byte-for-byte the published card.');
  },
  compare: (id) => go(`/compare?a=${encodeURIComponent(id)}`),
  editDraft: (id) => {
    const card = state.cards.find((c) => c.id === id);
    saveDraftCard({ ...card, provenance_note: `Draft copied from the published card. ${card.provenance_note || ''}`.trim() });
    state.drafts = loadDraftCards();
    toast('Copied into your drafts. The published card is untouched.');
    go(`/author/${encodeURIComponent(id)}`);
  },
};

// -------------------------------------------------------------- command palette

function buildPalette() {
  const input = el('input', {
    id: 'palette-input',
    type: 'search',
    placeholder: 'Jump to a card, or a screen…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-controls': 'palette-list',
    'aria-expanded': 'true',
    role: 'combobox',
  });
  const list = el('ul', { id: 'palette-list', class: 'palette-list', role: 'listbox' });
  const overlay = el('div', { class: 'palette', hidden: true, role: 'dialog', 'aria-label': 'Command palette', 'aria-modal': 'true' },
    el('div', { class: 'palette-box' }, input, list)
  );

  const commands = [
    { label: 'Debate room', route: '/' },
    { label: 'Term base', route: '/terms' },
    { label: 'Loss ledger', route: '/losses' },
    { label: 'Concepts by language', route: '/matrix' },
    { label: 'Compare two concepts', route: '/compare' },
    { label: 'Your drafts', route: '/drafts' },
    { label: 'New term card', route: '/author' },
    { label: 'New statement', route: '/statement' },
    { label: 'New debate', route: '/debate' },
    { label: 'Import JSON', route: '/import' },
    { label: 'Settings', route: '/settings' },
    { label: 'About', route: '/about' },
  ];

  let items = [];
  let active = 0;

  const draw = () => {
    list.replaceChildren(...items.map((item, index) => el('li', {
      class: `palette-item ${index === active ? 'active' : ''}`,
      role: 'option',
      'aria-selected': index === active,
      on: { click: () => choose(item) },
    },
      el('span', { text: item.label }),
      item.hint ? el('span', { class: 'palette-hint', text: item.hint }) : null
    )));
    const activeNode = list.children[active];
    activeNode?.scrollIntoView({ block: 'nearest' });
  };

  const filter = () => {
    const query = input.value.trim().toLowerCase();
    const matchedCommands = commands
      .filter((command) => !query || command.label.toLowerCase().includes(query))
      .map((command) => ({ ...command, hint: 'screen' }));
    const matchedCards = state.index
      .filter((entry) => !query || entry.label.includes(query) || entry.id.includes(query))
      .slice(0, 12)
      .map((entry) => ({ label: entry.card.concept.label, hint: 'card', route: `/term/${entry.id}` }));

    items = query ? [...matchedCommands, ...matchedCards] : [...matchedCommands];
    active = 0;
    draw();
  };

  const choose = (item) => {
    if (!item) return;
    close();
    go(item.route);
  };

  let restoreFocusTo = null;

  const open = () => {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    document.body.classList.add('palette-open');
    input.value = '';
    filter();
    input.focus();
  };

  const close = () => {
    overlay.hidden = true;
    document.body.classList.remove('palette-open');
    // Keyboard users should end up where they were, not at the top of the page.
    if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
    restoreFocusTo = null;
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      draw();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      draw();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  // Populate before the first open, so the list is never empty even for a
  // moment. The overlay is hidden with the `hidden` attribute, and base.css
  // guarantees that attribute wins over any display rule.
  filter();

  return { node: overlay, open, close, isOpen: () => !overlay.hidden };
}

let palette = null;

// ----------------------------------------------------------------------- boot

async function boot() {
  state.route = parseRoute();
  applySettings();

  if (state.route.name === 'terms') {
    const decoded = decodeSearch(location.hash.split('?')[1] || '');
    state.query = decoded.query;
    state.filters = decoded.filters;
  }

  // Before anything is read: move any data stored under the project's old name
  // across, so a rename never costs somebody their drafts.
  const migration = migrateLegacyStorage();
  if (migration.moved) {
    toast(`Moved ${migration.moved} stored item${migration.moved === 1 ? '' : 's'} over after the rename. Your drafts are intact.`);
  }

  setView(messageView('Loading', 'Reading the published cards.'));

  try {
    state.bundle = await loadTermBase();
  } catch (error) {
    document.title = 'Witness — unavailable';
    setView(messageView('The term base could not be loaded', error.message, { tone: 'error' }));
    return;
  }

  state.cards = state.bundle.cards;
  state.index = buildIndex(state.cards);
  state.facetData = facets(state.index);
  for (const entry of state.index) state.digests.set(entry.id, cardDigest(entry.card));

  state.drafts = loadDraftCards();
  state.statements = loadStatements();
  state.debates = loadDebates();

  palette = buildPalette();
  document.body.append(palette.node);

  render({ replacePanel: true });
  document.body.classList.add('ready');
}

window.addEventListener('hashchange', () => {
  // Navigating away from an open palette should not leave a scrim behind.
  if (palette?.isOpen()) palette.close();
  state.route = parseRoute();
  if (state.route.name === 'terms') {
    const decoded = decodeSearch(location.hash.split('?')[1] || '');
    state.query = decoded.query;
    state.filters = decoded.filters;
    if (panel) {
      panel.setFacets(state.facetData, state.filters);
      panel.input.value = state.query;
    }
  }
  render({ moveFocus: true });
});

document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

// When the app is following the system and the system changes, follow it. The
// CSS no longer reacts to this on its own, because the palette is resolved here.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if ((state.settings.theme || 'system') === 'system') applySettings();
});

window.addEventListener('keydown', (event) => {
  const meta = event.metaKey || event.ctrlKey;

  if (meta && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!palette) return;
    if (palette.isOpen()) palette.close();
    else palette.open();
    return;
  }

  if (event.key === 'Escape' && palette?.isOpen()) {
    palette.close();
    return;
  }

  // "/" focuses search, the way every tool this audience already uses does.
  if (event.key === '/' && !meta && !event.altKey) {
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (typing) return;
    event.preventDefault();
    if (state.route.name !== 'terms') go('/terms');
    requestAnimationFrame(() => document.getElementById('q')?.focus());
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' }).catch(() => {
      // Offline support is a convenience; the app works without it.
    });
  });
}

boot();

export { state, render, toast };
