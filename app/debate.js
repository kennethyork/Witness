/**
 * Debate records: structured adversarial disputation.
 *
 * The statement record is for a text that parties agree on. A debate is the
 * opposite situation: two or more sides, a question in dispute, and an outcome
 * that may be a decision or may honestly be "nobody moved". That cannot be
 * squeezed into a statement, so it gets its own record type.
 *
 * Four rules shape it, and each exists because of a specific failure mode of
 * religious argument:
 *
 *  1. Terms are pinned before argument. Most interfaith disagreement about a
 *     word is disagreement about the word, and the cheapest move in the genre is
 *     "that is not what hesed means". So a debate opens by recording, for each
 *     contested term, what both sides will accept it means *for this debate*,
 *     and which card each side is relying on. If the terms cannot be pinned, the
 *     record says so, loudly, because then the debate is about terminology and
 *     the participants should know that before spending an hour on doctrine.
 *
 *  2. An objection must restate what it attacks, in its strongest form. This is
 *     structural rather than advisory: `steelman` is required, and lint rejects
 *     an objection without one. Strawmanning is the most common way a debate
 *     produces heat without progress.
 *
 *  3. Every argument carries its evidence and its warrant. Evidence is a
 *     citation, ideally a term card; the warrant is why that evidence supports
 *     the claim. An argument missing either is flagged, not blocked: sometimes
 *     you are reasoning from a text you have not quoted yet.
 *
 *  4. The tool never adjudicates. `adjudication.decided` requires a named human
 *     and their reasons, and the tool computes only facts about the record --
 *     which objections went unanswered, which claims cite nothing, what was
 *     conceded. It never scores, ranks, or decides. An argument checker that
 *     picks a winner would be the worst possible version of this.
 *
 * DOM-free and dependency-free, so scripts/check.mjs can test all of it.
 */

export const MOVE_KINDS = ['opening', 'argument', 'objection', 'response', 'closing'];

export const MOVE_KIND_LABELS = {
  opening: 'opening',
  argument: 'argument',
  objection: 'objection',
  response: 'response',
  closing: 'closing',
};

export const SIDE_POSITIONS = ['affirms', 'denies', 'undecided'];

export const TERM_STATES = ['settled', 'contested', 'undefined'];

export const TERM_STATE_LABELS = {
  settled: 'agreed for this debate',
  contested: 'both sides read it differently',
  undefined: 'nobody has pinned it down',
};

export const CONCESSION_STATES = ['conceded', 'contested', 'unaddressed'];

export const CONCESSION_LABELS = {
  conceded: 'conceded',
  contested: 'still contested',
  unaddressed: 'not addressed',
};

export const ADJUDICATION_STATES = ['open', 'decided', 'unresolved'];

export const DEBATE_KINDS = ['disputation', 'study', 'consultation', 'other'];

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/** A steelman shorter than this is almost certainly a restatement of the words. */
const STEELMAN_MINIMUM = 40;

// --------------------------------------------------------------------- model

export function blankDebate() {
  return {
    format: 'witness/debate',
    version: 1,
    id: '',
    motion: '',
    kind: 'disputation',
    created: new Date().toISOString().slice(0, 10),
    terms: [],
    sides: [
      { id: 'pro', name: '', position: 'affirms', burden: '', languages: [] },
      { id: 'con', name: '', position: 'denies', burden: '', languages: [] },
    ],
    moves: [],
    concessions: [],
    adjudication: { state: 'open', adjudicator: '', decision: '', reasons: '' },
    note: '',
  };
}

export function debateSlug(debate) {
  return (debate?.motion || debate?.title || 'debate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'debate';
}

/** Move ids are short and stable, because other moves refer to them by id. */
export function nextMoveId(debate) {
  let highest = 0;
  for (const move of debate?.moves || []) {
    const match = /^m(\d+)$/.exec(move?.id || '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `m${highest + 1}`;
}

export function moveLabel(debate, id) {
  const index = (debate?.moves || []).findIndex((move) => move.id === id);
  if (index === -1) return id || 'unknown';
  const move = debate.moves[index];
  return `${index + 1}. ${MOVE_KIND_LABELS[move.kind] || move.kind}${move.claim ? ` — ${move.claim.slice(0, 60)}` : ''}`;
}

// ---------------------------------------------------------------------- state

/**
 * Facts about the record. Deliberately not a score.
 *
 * There is no "who is winning" here, and there must never be one. What this
 * computes is the state of the exchange: what was left unanswered, what was
 * asserted without a citation, what either side conceded, and whether the terms
 * were pinned before anyone argued about them.
 */
export function debateState(debate) {
  const sides = debate?.sides || [];
  const moves = debate?.moves || [];
  const terms = debate?.terms || [];

  const answeredBy = new Map();
  for (const move of moves) {
    for (const target of move.targets || []) {
      const list = answeredBy.get(target) || [];
      list.push(move);
      answeredBy.set(target, list);
    }
  }

  const unanswered = [];
  for (const move of moves) {
    if (move.kind !== 'objection') continue;
    const answers = (answeredBy.get(move.id) || []).filter((answer) => answer.kind === 'response');
    if (!answers.length) unanswered.push(move);
  }

  const unsupported = moves.filter((move) => move.kind === 'argument' && !(move.evidence || []).length);
  const unwarranted = moves.filter((move) => move.kind === 'argument' && !isText(move.warrant));
  const vagueSteelman = moves.filter(
    (move) => move.kind === 'objection' && (move.steelman || '').trim().length < STEELMAN_MINIMUM
  );

  const concededBy = new Map();
  for (const concession of debate?.concessions || []) {
    const bucket = concededBy.get(concession.side) || { conceded: 0, contested: 0, unaddressed: 0 };
    bucket[concession.state] = (bucket[concession.state] || 0) + 1;
    concededBy.set(concession.side, bucket);
  }

  // One way to cite a card: evidence[].card. An older draft of this had a
  // separate `cites` list as well, which is two mechanisms for one fact.
  const reliedOn = new Map();
  for (const move of moves) {
    for (const item of move.evidence || []) {
      if (item?.card) reliedOn.set(item.card, (reliedOn.get(item.card) || 0) + 1);
    }
  }

  const languages = [
    ...new Set(moves.map((move) => move.language).filter(Boolean)),
  ].sort();

  return {
    moves: moves.length,
    bySide: sides.map((side) => ({
      side,
      moves: moves.filter((move) => move.side === side.id).length,
      objections: moves.filter((move) => move.side === side.id && move.kind === 'objection').length,
      burdensStated: isText(side.burden),
    })),
    unanswered,
    answered: moves.filter((move) => move.kind === 'objection' && !unanswered.includes(move)),
    unsupported,
    unwarranted,
    vagueSteelman,
    unpinnedTerms: terms.filter((term) => term.status !== 'settled'),
    concessions: concededBy,
    reliedOn: [...reliedOn.entries()]
      .map(([card, count]) => ({ card, count }))
      .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card)),
    adjudication: debate?.adjudication || { state: 'open' },
    decided: debate?.adjudication?.state === 'decided',
    languages,
    /** The tool's one editorial opinion, and it is about method, not substance. */
    terminologyFirst: terms.length > 0 && terms.every((term) => term.status === 'settled'),
  };
}

// ---------------------------------------------------------------------- lint

export function lintDebate(debate) {
  const findings = [];
  const at = (path, message, level = 'error') =>
    findings.push({ level, file: debate?.id || 'debate', path, message });

  if (!isText(debate?.motion)) {
    at('motion', 'a debate needs a motion: a single sentence that could be affirmed or denied');
  } else if (debate.motion.trim().length < 20) {
    at('motion', 'the motion looks like a topic rather than a proposition. A debate needs something a side can affirm or deny.', 'warn');
  }

  if (!(debate?.terms || []).length) {
    at(
      'terms',
      'no terms pinned. Before arguing about words, record what each side will accept them to mean, or say plainly that neither side would settle them.',
      'warn'
    );
  }

  for (const [index, term] of (debate?.terms || []).entries()) {
    const where = `terms[${index}]`;
    if (!isText(term?.term)) at(`${where}.term`, 'say which word this is');
    if (!TERM_STATES.includes(term?.status)) {
      at(`${where}.status`, `status must be one of: ${TERM_STATES.join(', ')}`);
    }
    if (term?.status === 'settled' && !isText(term?.agreed)) {
      at(`${where}.agreed`, 'a settled term needs the wording both sides accept');
    }
    if (term?.status !== 'settled' && !isText(term?.note)) {
      at(`${where}.note`, 'an unsettled term needs a note saying how the sides read it differently. That note is usually the most useful line in the debate.');
    }
  }

  const sides = debate?.sides || [];
  const sideIds = new Set();
  if (sides.length < 2) {
    at('sides', 'a debate needs at least two sides', 'warn');
  }
  for (const [index, side] of sides.entries()) {
    const where = `sides[${index}]`;
    if (!isText(side?.id)) at(`${where}.id`, 'a side needs an id, which moves refer to');
    else if (sideIds.has(side.id)) at(`${where}.id`, `duplicate side id "${side.id}"`);
    else sideIds.add(side.id);
    if (!isText(side?.name)) at(`${where}.name`, 'name the side, or say who is speaking for it');
    if (!SIDE_POSITIONS.includes(side?.position)) {
      at(`${where}.position`, `position must be one of: ${SIDE_POSITIONS.join(', ')}`);
    }
    // A debate without a stated burden is an argument. This is the rule that
    // separates the two, so it is an error rather than a suggestion.
    if (!isText(side?.burden)) {
      at(`${where}.burden`, 'state what this side has to establish. Without a burden, nobody can tell whether they met it.');
    }
  }

  const moveIds = new Set();
  for (const [index, move] of (debate?.moves || []).entries()) {
    const where = `moves[${index}]`;
    if (!isText(move?.id)) at(`${where}.id`, 'a move needs an id');
    else if (moveIds.has(move.id)) at(`${where}.id`, `duplicate move id "${move.id}"`);
    else moveIds.add(move.id);

    if (!sideIds.has(move?.side)) at(`${where}.side`, `unknown side "${move?.side}"`);
    if (!MOVE_KINDS.includes(move?.kind)) {
      at(`${where}.kind`, `kind must be one of: ${MOVE_KINDS.join(', ')}`);
    }
    if (!isText(move?.claim)) at(`${where}.claim`, 'say what this move is claiming');

    for (const target of move?.targets || []) {
      if (!(debate?.moves || []).some((other) => other.id === target)) {
        at(`${where}.targets`, `this move answers "${target}", which is not a move in this debate`);
      }
      if (target === move.id) at(`${where}.targets`, 'a move cannot answer itself');
    }

    if (move?.kind === 'objection') {
      if (!(move.targets || []).length) {
        at(`${where}.targets`, 'an objection must answer a specific move. An objection to the general shape of the other side is a speech, not an objection.');
      }
      if (!isText(move.steelman)) {
        at(`${where}.steelman`, 'an objection must restate the move it attacks in its strongest form before answering it. This is the rule that stops the debate from becoming two speeches.');
      } else if (move.steelman.trim().length < STEELMAN_MINIMUM) {
        at(`${where}.steelman`, 'that restatement is too short to be a fair version of the other side. Put the argument at its strongest, then answer it.', 'warn');
      }
    }

    if (move?.kind === 'response') {
      if (!(move.targets || []).length) {
        at(`${where}.targets`, 'a response must say which move it answers');
      }
    }

    if (move?.kind === 'argument') {
      if (!(move.evidence || []).length) {
        at(`${where}.evidence`, 'this argument cites nothing. If it rests on a text, name the text; if it rests on reasoning, say so in the warrant.', 'warn');
      }
      if (!isText(move.warrant)) {
        at(`${where}.warrant`, 'state why the evidence supports the claim. Without a warrant, the citation is decoration.', 'warn');
      }
    }

    for (const [eIndex, item] of (move?.evidence || []).entries()) {
      if (!isText(item?.source)) at(`${where}.evidence[${eIndex}].source`, 'name the source, or remove the entry');
    }
  }

  for (const [index, concession] of (debate?.concessions || []).entries()) {
    const where = `concessions[${index}]`;
    if (!sideIds.has(concession?.side)) at(`${where}.side`, `unknown side "${concession?.side}"`);
    if (!moveIds.has(concession?.move)) at(`${where}.move`, `unknown move "${concession?.move}"`);
    if (!CONCESSION_STATES.includes(concession?.state)) {
      at(`${where}.state`, `state must be one of: ${CONCESSION_STATES.join(', ')}`);
    }
  }

  const adjudication = debate?.adjudication || {};
  if (!ADJUDICATION_STATES.includes(adjudication.state)) {
    at('adjudication.state', `state must be one of: ${ADJUDICATION_STATES.join(', ')}`);
  }
  if (adjudication.state === 'decided') {
    if (!isText(adjudication.adjudicator)) {
      at('adjudication.adjudicator', 'a decision needs a named person who made it. The tool does not decide debates.');
    }
    if (!isText(adjudication.reasons)) {
      at('adjudication.reasons', 'a decision needs reasons, or it is an announcement rather than a judgement');
    }
  }
  if (adjudication.state === 'decided') {
    const unpinned = (debate?.terms || []).filter((term) => term.status !== 'settled');
    if (unpinned.length) {
      at(
        'adjudication.state',
        `decided while ${unpinned.length} term(s) were still unpinned. A decision about a word neither side settled is worth revisiting.`,
        'warn'
      );
    }
    const unanswered = debateState(debate).unanswered;
    if (unanswered.length) {
      at(
        'adjudication.state',
        `decided with ${unanswered.length} objection(s) left unanswered. Say in the reasons whether that mattered.`,
        'warn'
      );
    }
  }

  return findings;
}

// ------------------------------------------------------------------ markdown

export function debateToMarkdown(debate) {
  const state = debateState(debate);
  const lines = [
    `# ${debate.motion || 'Untitled debate'}`,
    '',
    `- Kind: ${debate.kind || 'disputation'}`,
    `- Opened: ${debate.created || 'unknown'}`,
    `- Sides: ${(debate.sides || []).map((side) => `${side.name || side.id} (${side.position})`).join('; ')}`,
    `- Moves: ${state.moves}${state.languages.length ? ` in ${state.languages.join(', ')}` : ''}`,
    '',
  ];

  if ((debate.terms || []).length) {
    lines.push(
      '## Terms, pinned before argument',
      '',
      '| Term | Status | What the sides accept | Card |',
      '| --- | --- | --- | --- |'
    );
    for (const term of debate.terms) {
      const what = term.status === 'settled' ? term.agreed : term.note;
      lines.push(
        `| ${cell(term.term)} | ${cell(TERM_STATE_LABELS[term.status] || term.status)} | ${cell(what || '')} | ${term.card ? `\`${cell(term.card)}\`` : ''} |`
      );
    }
    lines.push('');
    if (!state.terminologyFirst) {
      lines.push(
        '> Not every term was settled before the argument began. Where that is true, some of',
        '> what follows may be a disagreement about a word rather than about doctrine.',
        ''
      );
    }
  }

  lines.push('## Burdens', '');
  for (const side of debate.sides || []) {
    lines.push(`- **${side.name || side.id}** (${side.position}) must establish: ${side.burden || '_not stated_'}`);
  }
  lines.push('');

  lines.push('## The exchange', '');
  (debate.moves || []).forEach((move, index) => {
    const side = (debate.sides || []).find((entry) => entry.id === move.side);
    lines.push(
      `### ${index + 1}. ${MOVE_KIND_LABELS[move.kind] || move.kind} — ${side?.name || move.side}${move.language ? ` (${move.language})` : ''}`,
      ''
    );
    if ((move.targets || []).length) {
      lines.push(`*Answers:* ${move.targets.map((target) => moveLabel(debate, target)).join('; ')}`, '');
    }
    if (move.kind === 'objection') {
      lines.push(`**Restated at its strongest:** ${move.steelman || '_missing_'}`, '');
    }
    lines.push(`**Claim.** ${move.claim || '_none stated_'}`, '');
    if (isText(move.warrant)) lines.push(`**Warrant.** ${move.warrant}`, '');
    if ((move.evidence || []).length) {
      lines.push('**Evidence.**', '');
      for (const item of move.evidence) {
        const parts = [item.source];
        if (item.locator) parts.push(item.locator);
        if (item.card) parts.push(`card \`${item.card}\``);
        lines.push(`- ${parts.join(' · ')}`);
      }
      lines.push('');
    }
    if (isText(move.impact)) lines.push(`**Why it matters.** ${move.impact}`, '');
    const answers = (debate.moves || []).filter((other) => (other.targets || []).includes(move.id));
    if (move.kind === 'objection') {
      lines.push(
        answers.some((answer) => answer.kind === 'response')
          ? `*Answered.*`
          : `*Left unanswered.*`,
        ''
      );
    } else if (answers.length) {
      lines.push(`*Answered by ${answers.map((answer) => moveLabel(debate, answer.id)).join('; ')}*`, '');
    }
  });

  lines.push('## Where it stands', '');
  lines.push(
    `- Objections left unanswered: ${state.unanswered.length}`,
    `- Arguments citing nothing: ${state.unsupported.length}`,
    `- Arguments with no stated warrant: ${state.unwarranted.length}`,
    `- Objections whose restatement was too thin to be fair: ${state.vagueSteelman.length}`
  );
  for (const [sideId, counts] of state.concessions) {
    const side = (debate.sides || []).find((entry) => entry.id === sideId);
    lines.push(
      `- ${side?.name || sideId} recorded: ${counts.conceded || 0} conceded, ${counts.contested || 0} still contested, ${counts.unaddressed || 0} not addressed`
    );
  }
  lines.push('');
  if (state.unanswered.length) {
    lines.push('Unanswered objections:', '');
    for (const move of state.unanswered) {
      lines.push(`- ${moveLabel(debate, move.id)}`);
    }
    lines.push('');
  }

  lines.push('## Adjudication', '');
  if (debate.adjudication?.state === 'decided') {
    lines.push(
      `Decided by **${debate.adjudication.adjudicator}**: ${debate.adjudication.decision || ''}`,
      '',
      debate.adjudication.reasons || '_no reasons recorded_',
      ''
    );
  } else if (debate.adjudication?.state === 'unresolved') {
    lines.push(
      'Recorded as unresolved. Nobody moved. In a dispute about terminology that is a legitimate',
      'outcome, and often a more honest one than a decision.',
      ''
    );
    if (isText(debate.adjudication?.reasons)) lines.push(debate.adjudication.reasons, '');
  } else {
    lines.push(
      'Still open. No adjudicator has recorded a decision, and the record does not imply one.',
      ''
    );
  }

  if ((debate.note || '').trim()) lines.push('## Note', '', debate.note, '');

  lines.push(
    '---',
    '',
    'The counts above are facts about the record, not a verdict. This record does not',
    'score the debate, rank the sides, or decide anything: that is a named person\'s job.',
    'Generated from a Witness debate record.'
  );

  return lines.join('\n');
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}
