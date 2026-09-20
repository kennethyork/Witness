/**
 * Debate records: structured adversarial disputation, and the correspondence
 * protocol that lets two people conduct one without a server.
 *
 * The exchange works the way a disputation by post always worked: each side
 * writes only its own moves, exports them as a contribution file, and sends it.
 * Importing merges the other side's moves and verifies that nothing already in
 * your copy has been altered. That last part is the whole point: the record of
 * what you said lives in your copy of the file, so nobody can edit your words
 * and have it hold.
 *
 * On what this does and does not prove, stated plainly rather than implied by
 * the word "signed":
 *
 *  - Each move carries a digest, and each move's digest is chained to the digest
 *    of every move before it. Editing any move breaks every link after it, and
 *    the break is reported at the earliest edited move.
 *  - That makes tampering *evident*. It does not make it *impossible*: someone
 *    holding a record can edit a move and recompute the whole chain, and this
 *    code cannot tell the difference. Real asymmetric signatures would close
 *    that, and they are the documented upgrade path, but they need a secure
 *    context and a key management story that a static folder does not have.
 *  - So the practical guarantee is social and structural rather than
 *    cryptographic: both sides hold their own copy, an incoming contribution
 *    that contradicts what you already hold is *rejected* with the conflicting
 *    moves named, and you can always compare digests out loud.
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

import { sha256Hex, canonical } from './hash.js';

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

  // You cannot answer yourself, and a debate where one side speaks twice in a row
  // is two speeches rather than an exchange. Flagged rather than blocked: a
  // closing statement legitimately follows your own previous move.
  const order = debate?.moves || [];
  order.forEach((move, index) => {
    for (const target of move?.targets || []) {
      const targetMove = order.find((other) => other.id === target);
      if (targetMove && targetMove.side === move.side) {
        at(`moves[${index}].targets`, 'a side cannot answer its own move. If this develops your own argument, make it an argument rather than an objection.');
      }
    }
    if (index > 0 && order[index - 1].side === move.side) {
      at(`moves[${index}].side`, 'the same side had the previous move. Check the order, unless this is a deliberate continuation.', 'warn');
    }
  });

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

// ------------------------------------------------- the correspondence protocol

/**
 * The digest of an empty transcript. Everything chains from here.
 *
 * A hash chain makes tampering evident, not impossible. Anyone holding a copy
 * can edit a move and recompute every digest after it, and nothing here would
 * notice. What it catches is the ordinary case: one side quietly altering what
 * the other side said, or what they themselves said earlier, in a copy they
 * then send on. See the note at the top of this file for the honest limits.
 */
const GENESIS = sha256Hex('witness/debate/genesis');

/**
 * The fields a move is judged on. Everything a person could have written, plus
 * the link backwards. Deliberately excludes `digest`, which is derived from this.
 */
const MOVE_DIGEST_FIELDS = [
  'id', 'side', 'kind', 'language', 'claim', 'warrant', 'steelman',
  'impact', 'targets', 'evidence', 'at', 'prev',
];

function movePayload(move) {
  const payload = {};
  for (const key of MOVE_DIGEST_FIELDS) {
    if (move?.[key] !== undefined) payload[key] = move[key];
  }
  return payload;
}

/** The digest of one move's contents, including the link to what came before. */
export function moveDigest(move) {
  return sha256Hex(canonical(movePayload(move)));
}

/**
 * The digest of the pinned terms.
 *
 * Two people can compare this by reading it aloud, and the comparison is worth
 * making: if it differs, the sides are not arguing from the same pinned words,
 * whatever else they agree about.
 */
export function termsDigest(terms) {
  return sha256Hex(
    canonical(
      (terms || []).map((term) => ({
        term: term?.term || '',
        card: term?.card || '',
        status: term?.status || '',
        agreed: term?.agreed || '',
        note: term?.note || '',
      }))
    )
  );
}

/** The digest of a whole transcript: the fold of every move's digest. */
export function transcriptDigest(moves) {
  let accumulator = GENESIS;
  for (const move of moves || []) {
    accumulator = sha256Hex(`${accumulator}:${moveDigest(move)}`);
  }
  return accumulator;
}

/**
 * Check a transcript without changing it.
 *
 * Reports where it first breaks rather than only that it broke, because "one of
 * the moves has been edited" is not actionable and "move 3 does not match what
 * it was stamped with" is.
 */
export function verifyChain(debate) {
  const moves = debate?.moves || [];
  if (!moves.length) return { state: 'empty', count: 0 };

  const stamped = moves.filter((move) => move?.digest).length;
  if (!stamped) return { state: 'unsigned', count: moves.length };
  if (stamped !== moves.length) {
    const index = moves.findIndex((move) => !move?.digest);
    return { state: 'partial', count: moves.length, index };
  }

  let accumulator = GENESIS;
  for (const [index, move] of moves.entries()) {
    if (move.prev !== accumulator) {
      return { state: 'broken', reason: 'link', index, expected: accumulator, found: move.prev };
    }
    const digest = moveDigest(move);
    if (digest !== move.digest) {
      return { state: 'broken', reason: 'content', index, expected: digest, found: move.digest };
    }
    accumulator = sha256Hex(`${accumulator}:${digest}`);
  }

  return { state: 'intact', count: moves.length, digest: accumulator };
}

/**
 * Give every unstamped move a link and a digest.
 *
 * Only appends. A move that is already stamped is verified rather than
 * recomputed, so this can never be used to launder an edit: if the history does
 * not check out, it refuses and says where.
 */
export function stampChain(debate, { at = new Date().toISOString() } = {}) {
  const moves = (debate.moves = debate.moves || []);
  let accumulator = GENESIS;
  let stamped = 0;

  for (const [index, move] of moves.entries()) {
    if (move.digest) {
      if (move.prev !== accumulator) return { ok: false, reason: 'link', index };
      const digest = moveDigest(move);
      if (digest !== move.digest) return { ok: false, reason: 'content', index };
      accumulator = sha256Hex(`${accumulator}:${digest}`);
      continue;
    }
    move.prev = accumulator;
    if (!move.at) move.at = at;
    move.digest = moveDigest(move);
    accumulator = sha256Hex(`${accumulator}:${move.digest}`);
    stamped += 1;
  }

  return { ok: true, stamped, digest: accumulator };
}

/**
 * Throw away every stamp and chain the transcript again.
 *
 * Deliberately not called automatically, and deliberately named for what it is.
 * There is a legitimate use: you wrote a move, saved it, spotted a typo, and
 * have not sent it to anyone. Restamping recomputes the whole history from
 * scratch, so it cannot tell an honest correction from a rewritten record. Any
 * copy your correspondent already holds will stop matching, which is the
 * signal you were supposed to get.
 */
export function restampAll(debate, { at } = {}) {
  for (const move of debate.moves || []) {
    delete move.digest;
    delete move.prev;
  }
  return stampChain(debate, at ? { at } : {});
}

/**
 * One side's contribution, ready to send.
 *
 * Contains only that side's moves. Your correspondent cannot see your drafting
 * notes or your other debates, and cannot alter these words without their
 * digests failing when you compare against your own copy.
 */
export function contributionFor(debate, sideId, { author = '', at = new Date().toISOString() } = {}) {
  const side = (debate.sides || []).find((entry) => entry.id === sideId);
  return {
    format: 'witness/contribution',
    version: 1,
    debate: { id: debate.id || '', motion: debate.motion || '' },
    side: sideId,
    author: author || side?.name || sideId,
    at,
    basedOn: transcriptDigest(debate.moves),
    terms: debate.terms || [],
    termsDigest: termsDigest(debate.terms),
    moves: (debate.moves || []).filter((move) => move.side === sideId),
  };
}

/**
 * Merge a correspondent's contribution.
 *
 * Refuses rather than guesses. Three things it will not do: accept a move that
 * contradicts one you already hold, accept a move whose digest does not match
 * its contents, or stitch on a move that was written against a version of the
 * transcript you do not have. In each case it says which move and why, because
 * a merge that silently reorganises somebody's argument is worse than a merge
 * that fails.
 */
export function mergeContribution(debate, contribution) {
  const result = {
    ok: false,
    added: [],
    conflicts: [],
    termsDiverged: false,
    incomingTerms: [],
    chain: null,
    messages: [],
  };

  if (!contribution || typeof contribution !== 'object' || contribution.format !== 'witness/contribution') {
    result.messages.push('That is not a Witness contribution file.');
    return result;
  }
  if (!Array.isArray(contribution.moves)) {
    result.messages.push('The contribution has no moves in it.');
    return result;
  }
  if (contribution.debate?.id && debate.id && contribution.debate.id !== debate.id) {
    result.messages.push(
      `That contribution belongs to a different debate (“${contribution.debate.motion || contribution.debate.id}”).`
    );
    return result;
  }

  const mine = new Map((debate.moves || []).map((move) => [move.id, move]));

  // Every incoming move must be internally consistent, and must not contradict
  // anything already held. This is the check that makes the exchange worth
  // doing at all.
  for (const move of contribution.moves) {
    if (!move?.id) {
      result.conflicts.push({ id: '(no id)', reason: 'a move with no id cannot be merged' });
      continue;
    }
    if (mine.has(move.id)) {
      if (moveDigest(mine.get(move.id)) !== moveDigest(move)) {
        result.conflicts.push({
          id: move.id,
          reason: 'you already hold this move with different contents. One of the two has been edited.',
        });
      }
      continue;
    }
    if (move.digest && moveDigest(move) !== move.digest) {
      result.conflicts.push({
        id: move.id,
        reason: 'its digest does not match its contents, so it was altered after it was stamped',
      });
    }
  }

  if (result.conflicts.length) {
    result.messages.push('Nothing was merged.');
    return result;
  }

  const incoming = contribution.moves.filter((move) => !mine.has(move.id));
  if (!incoming.length) {
    result.ok = true;
    result.messages.push('Nothing new: you already hold every move in this contribution.');
    return result;
  }

  result.termsDiverged = contribution.termsDigest !== termsDigest(debate.terms);
  result.incomingTerms = contribution.terms || [];

  const combined = [...(debate.moves || []), ...incoming];
  const verification = verifyChain({ moves: combined });
  result.chain = verification;

  if (verification.state === 'broken') {
    const where = incoming.findIndex((move) => move.id === combined[verification.index]?.id);
    result.messages.push(
      where === -1
        ? 'The merged transcript would not verify, so nothing was merged.'
        : `The chain does not join at “${combined[verification.index].id}”. It was written against a transcript ending ${String(verification.found).slice(0, 12)}, but the transcript you hold ends ${String(verification.expected).slice(0, 12)}. One of you has moves the other has not seen.`
    );
    return result;
  }

  debate.moves = combined;
  result.ok = true;
  result.added = incoming.map((move) => move.id);
  result.messages.push(`Merged ${incoming.length} move(s) from ${contribution.author || contribution.side}.`);
  if (result.termsDiverged) {
    result.messages.push(
      'Their pinned terms differ from yours. The terms were not merged: before arguing further, check that you are both arguing about the same words.'
    );
  }
  return result;
}
