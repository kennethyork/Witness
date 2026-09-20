/**
 * Multi-language statements and translation parity.
 *
 * This is the V1 idea: a joint statement, an apology, a declaration, or a
 * restorative justice agreement exists in N languages, and every language
 * version has its own approval state per party. "Translated" is never a
 * boolean, and divergence between versions is a tracked field rather than a bug
 * report. The same discipline that makes UN and EU treaties "equally authentic"
 * in every language of record (VCLT Article 33).
 *
 * DOM-free and dependency-free so scripts/check.mjs can test the logic without
 * a browser.
 *
 * One rule shapes the whole design: this module does not decide whether two
 * language versions mean the same thing. It cannot, and a tool that pretends to
 * would be dangerous. It tracks what named humans declare, and it computes
 * things that are facts about the record — who has approved what, what is still
 * open, and how much shorter one version is than another. A wide length gap is
 * a *signal to look*, never a verdict.
 */

export const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'withheld'];

export const VERSION_STATES = ['draft', 'proposed', 'approved', 'rejected'];

export const DIVERGENCE_KINDS = [
  'omission',
  'addition',
  'softening',
  'strengthening',
  'ambiguity',
  'other',
];

export const STATEMENT_KINDS = ['declaration', 'apology', 'agreement', 'dialogue-record', 'other'];

export const PARTY_ROLES = ['party', 'facilitator', 'witness', 'interpreter'];

export const APPROVAL_LABELS = {
  pending: 'not yet answered',
  approved: 'approved',
  rejected: 'rejected',
  withheld: 'withheld — do not treat as approval',
};

export const DIVERGENCE_LABELS = {
  omission: 'says less',
  addition: 'says more',
  softening: 'weaker than the source',
  strengthening: 'stronger than the source',
  ambiguity: 'ambiguity introduced',
  other: 'other',
};

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

// ------------------------------------------------------------------ counting

const countWords = (text) =>
  isText(text) ? text.trim().split(/\s+/).length : 0;

/**
 * Per-language facts about the record. Deliberately descriptive: this reports
 * what has been declared, not what should be concluded.
 */
export function paritySummary(statement) {
  const parties = statement.parties || [];
  const versions = statement.versions || [];

  return versions.map((version) => {
    const approvals = version.approvals || [];
    const byParty = new Map(approvals.map((a) => [a.party, a.state]));
    const decisions = parties.map((party) => ({
      party,
      state: byParty.get(party.id) || 'pending',
    }));

    const approved = decisions.filter((d) => d.state === 'approved');
    const rejected = decisions.filter((d) => d.state === 'rejected');
    const withheld = decisions.filter((d) => d.state === 'withheld');
    const pending = decisions.filter((d) => d.state === 'pending');
    const openDivergences = (version.divergences || []).filter((d) => !d.resolved);

    let state = 'draft';
    if (version.status === 'rejected') state = 'rejected';
    else if (pending.length || approvals.length < parties.length) state = 'incomplete';
    else if (rejected.length) state = 'rejected';
    else if (withheld.length) state = 'withheld';
    else if (openDivergences.length) state = 'diverged';
    else if (version.status === 'approved' || approved.length === parties.length) state = 'ratified';

    return {
      language: version.language,
      state,
      words: countWords(version.body),
      approved: approved.map((d) => d.party),
      rejected: rejected.map((d) => d.party),
      withheld: withheld.map((d) => d.party),
      pending: pending.map((d) => d.party),
      openDivergences: openDivergences.length,
      resolvedDivergences: (version.divergences || []).length - openDivergences.length,
    };
  });
}

/**
 * Is the statement ratifiable as it stands? A single withheld approval blocks
 * it: "withheld" exists precisely so that silence is never counted as consent.
 */
export function statementState(statement) {
  const summary = paritySummary(statement);
  const openDivergences = summary.reduce((total, v) => total + v.openDivergences, 0);
  const needsAttention = summary.filter(
    (v) => v.state !== 'ratified' || v.openDivergences > 0
  ).length;
  const ratified = summary.length > 0 && summary.every((v) => v.state === 'ratified');

  return { summary, openDivergences, needsAttention, ratified, versions: summary.length };
}

/** Which parties to ask, and for which language. Drives the follow-up list. */
export function outstanding(statement) {
  const byParty = new Map();
  for (const party of statement.parties || []) {
    byParty.set(party.id, { party, languages: [] });
  }

  for (const version of statement.versions || []) {
    const approvals = new Map((version.approvals || []).map((a) => [a.party, a.state]));
    for (const party of statement.parties || []) {
      const state = approvals.get(party.id) || 'pending';
      if (state === 'pending' || state === 'withheld') {
        byParty.get(party.id)?.languages.push({ language: version.language, state });
      }
    }
  }

  return [...byParty.values()].filter((entry) => entry.languages.length);
}

/**
 * Length signals.
 *
 * A version materially shorter or longer than another is worth a human look.
 * This is the only automatic comparison this tool makes, it is arithmetic
 * rather than analysis, and the UI must present it as a question rather than a
 * finding. Nothing here knows what the words mean.
 */
export function lengthSignals(statement, { threshold = 0.25 } = {}) {
  const summary = paritySummary(statement).filter((v) => v.words > 0);
  if (summary.length < 2) return [];

  const longest = summary.reduce((a, b) => (b.words > a.words ? b : a));
  const signals = [];

  for (const version of summary) {
    if (version.language === longest.language) continue;
    const gap = (longest.words - version.words) / longest.words;
    if (gap >= threshold) {
      signals.push({
        language: version.language,
        against: longest.language,
        words: version.words,
        againstWords: longest.words,
        gap,
      });
    }
  }

  return signals.sort((a, b) => b.gap - a.gap);
}

/** Term cards cited as the basis for a translation choice, across the record. */
export function citedTerms(statement) {
  const counts = new Map();
  for (const version of statement.versions || []) {
    for (const basis of version.basis || []) {
      if (!basis?.termCard) continue;
      counts.set(basis.termCard, (counts.get(basis.termCard) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([termCard, count]) => ({ termCard, count }))
    .sort((a, b) => b.count - a.count || a.termCard.localeCompare(b.termCard));
}

/**
 * The record's own digest. A statement that changes after signatures have been
 * collected must be visibly a different statement, so every version carries a
 * digest of the body text and the record carries a digest of the whole.
 */
export function statementId(statement) {
  return (statement.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function blankStatement(kinds = STATEMENT_KINDS) {
  return {
    format: 'colophon/statement',
    version: 1,
    id: '',
    title: '',
    kind: kinds[0],
    created: new Date().toISOString().slice(0, 10),
    parties: [
      { id: 'party-a', name: '', role: 'party', languages: [] },
      { id: 'party-b', name: '', role: 'party', languages: [] },
    ],
    versions: [],
    retention: { policy: '', destroyBy: '' },
    note: '',
  };
}

/** Validate a statement record, using the same finding shape as card linting. */
export function lintStatement(statement) {
  const findings = [];
  const at = (path, message, level = 'error') => findings.push({ level, file: statement?.id || 'statement', path, message });

  if (!isText(statement?.title)) at('title', 'a statement needs a title');
  if (!(statement?.parties || []).length) at('parties', 'a statement needs at least one party');
  if (!(statement?.versions || []).length) at('versions', 'a statement needs at least one language version');

  const partyIds = new Set();
  for (const [index, party] of (statement?.parties || []).entries()) {
    if (!isText(party?.name)) at(`parties[${index}].name`, 'party name is required');
    if (!isText(party?.id)) at(`parties[${index}].id`, 'party id is required');
    else if (partyIds.has(party.id)) at(`parties[${index}].id`, `duplicate party id "${party.id}"`);
    else partyIds.add(party.id);
    if (!PARTY_ROLES.includes(party?.role)) at(`parties[${index}].role`, `role must be one of: ${PARTY_ROLES.join(', ')}`);
  }

  const languages = new Map();
  for (const [index, version] of (statement?.versions || []).entries()) {
    if (!isText(version?.language)) at(`versions[${index}].language`, 'language is required');
    else if (languages.has(version.language)) {
      at(`versions[${index}].language`, `two versions in "${version.language}". Drafts of the same language need separate records, or one of them is not what you think it is.`);
    } else languages.set(version.language, true);

    if (!isText(version?.body) && version?.status !== 'draft') {
      at(`versions[${index}].body`, 'a version that is not a draft needs text');
    }

    for (const [approvalIndex, approval] of (version?.approvals || []).entries()) {
      if (!partyIds.has(approval?.party)) {
        at(`versions[${index}].approvals[${approvalIndex}].party`, `unknown party "${approval?.party}"`);
      }
      if (!APPROVAL_STATES.includes(approval?.state)) {
        at(`versions[${index}].approvals[${approvalIndex}].state`, `state must be one of: ${APPROVAL_STATES.join(', ')}`);
      }
    }

    for (const [divergenceIndex, divergence] of (version?.divergences || []).entries()) {
      if (!isText(divergence?.summary)) at(`versions[${index}].divergences[${divergenceIndex}].summary`, 'say what the divergence is');
      if (!isText(divergence?.raisedBy)) {
        at(`versions[${index}].divergences[${divergenceIndex}].raisedBy`, 'a divergence needs a named person who raised it. A tool cannot notice this.');
      }
      if (!DIVERGENCE_KINDS.includes(divergence?.kind)) {
        at(`versions[${index}].divergences[${divergenceIndex}].kind`, `kind must be one of: ${DIVERGENCE_KINDS.join(', ')}`);
      }
    }

    for (const [basisIndex, basis] of (version?.basis || []).entries()) {
      if (!isText(basis?.termCard)) at(`versions[${index}].basis[${basisIndex}].termCard`, 'cite a term card id, or remove the entry');
    }

    if (version?.status === 'approved' && (version.approvals || []).some((a) => a.state !== 'approved')) {
      at(`versions[${index}].status`, 'marked approved while a party has not approved it', 'warn');
    }
  }

  if ((statement?.parties || []).filter((p) => p.role === 'party').length < 2) {
    at('parties', 'a statement with fewer than two parties is not a statement between anyone', 'warn');
  }

  return findings;
}
