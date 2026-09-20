/**
 * The debating room.
 *
 * This is the part of Witness that is a debating app rather than a record of
 * one. Two sides on screen at once, a clock, a phase you are in, arguments
 * landing while people talk, points of information, and a ballot at the end.
 *
 * Two design commitments, both of which are reactions to how bad a form makes
 * arguing feel:
 *
 *  1. **Entering an argument takes two fields and one keystroke.** Claim and
 *     support, then Enter. Anything longer and people stop typing while they
 *     are speaking, which is when the app becomes useless.
 *
 *  2. **The rules do not gate the room.** Nothing here refuses a move because a
 *     burden is unstated or an objection lacks a restatement. The session
 *     converts to a debate record at the end, and *that* is where the rules
 *     apply — so a group argues freely and then reads an honest account of what
 *     they did, including that they cited nothing. Strict afterwards, easy
 *     during, which is the opposite of a compliance form.
 *
 * DOM-free and dependency-free, so scripts/check.mjs can test the clock, the
 * phase machine, the point-of-information rules, and the conversion.
 */

export const SIDE_KEYS = ['a', 'b'];

/** A point of information may not be raised in the first seconds of a speech. */
export const POI_GRACE_SECONDS = 20;

/**
 * Debate formats.
 *
 * `side` is 'a', 'b', or null for a phase that belongs to the room rather than
 * to a side. `pointsAllowed` is how many interruptions the opposition may make
 * during that speech, which is what makes parliamentary debate parliamentary.
 */
export const FORMATS = {
  freeform: {
    label: 'Freeform',
    description: 'No clock needed. Useful for a first pass, a study group, or when nobody is sure of the format.',
    phases: [
      { name: 'Opening — affirming', side: 'a', kind: 'speech', seconds: 300 },
      { name: 'Opening — denying', side: 'b', kind: 'speech', seconds: 300 },
      { name: 'Open discussion', side: null, kind: 'open', seconds: 900 },
      { name: 'Closing — denying', side: 'b', kind: 'speech', seconds: 180 },
      { name: 'Closing — affirming', side: 'a', kind: 'speech', seconds: 180 },
    ],
  },
  'one-on-one': {
    label: 'One on one',
    description: 'Two speakers alternating, one point of information allowed in each constructive speech.',
    phases: [
      { name: 'Prep — affirming', side: 'a', kind: 'prep', seconds: 120 },
      { name: 'Prep — denying', side: 'b', kind: 'prep', seconds: 120 },
      { name: 'Opening — affirming', side: 'a', kind: 'speech', seconds: 240, pointsAllowed: 1 },
      { name: 'Opening — denying', side: 'b', kind: 'speech', seconds: 240, pointsAllowed: 1 },
      { name: 'Reply — affirming', side: 'a', kind: 'speech', seconds: 180 },
      { name: 'Reply — denying', side: 'b', kind: 'speech', seconds: 180 },
    ],
  },
  parliamentary: {
    label: 'Parliamentary',
    description: 'Alternating constructive speeches with points of information, then a reply for each side.',
    phases: [
      { name: 'Prep', side: null, kind: 'prep', seconds: 900 },
      { name: 'Opening — affirming', side: 'a', kind: 'speech', seconds: 420, pointsAllowed: 2 },
      { name: 'Opening — denying', side: 'b', kind: 'speech', seconds: 420, pointsAllowed: 2 },
      { name: 'Reply — denying', side: 'b', kind: 'speech', seconds: 240 },
      { name: 'Reply — affirming', side: 'a', kind: 'speech', seconds: 240 },
    ],
  },
};

export const FORMAT_KEYS = Object.keys(FORMATS);

// ------------------------------------------------------------------- session

export function blankSession() {
  return {
    format: 'witness/session',
    version: 1,
    id: '',
    motion: '',
    formatKey: 'freeform',
    sides: {
      a: { name: 'Affirming', burden: '' },
      b: { name: 'Denying', burden: '' },
    },
    cards: [],
    points: [],
    phaseIndex: 0,
    elapsed: 0,
    running: false,
    ballot: { judge: '', decision: 'open', reasons: '' },
    createdAt: new Date().toISOString(),
  };
}

export function sessionId(session) {
  return (session?.motion || 'debate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'debate';
}

/**
 * A first draft of what each side has to establish, so nobody faces a blank box.
 * They are meant to be edited; a debate where both burdens are the motion read
 * back is not a debate.
 */
export function suggestBurden(motion, sideKey) {
  const text = (motion || '').trim().replace(/\.$/, '');
  if (!text) return '';
  return sideKey === 'a'
    ? `Establish that ${text.charAt(0).toLowerCase()}${text.slice(1)}.`
    : `Establish that it does not, or that the difference does not matter.`;
}

export function phasesFor(session) {
  return (FORMATS[session?.formatKey] || FORMATS.freeform).phases;
}

export function currentPhase(session) {
  const phases = phasesFor(session);
  const index = Math.min(Math.max(session?.phaseIndex ?? 0, 0), phases.length - 1);
  return phases[index];
}

export const formatClock = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

/** What the room should be showing: whose floor, how long left, whether time is up. */
export function roomClock(session) {
  const phases = phasesFor(session);
  const phase = currentPhase(session);
  const elapsed = Math.max(0, Math.floor(session?.elapsed || 0));
  const remaining = phase.seconds - elapsed;
  const over = remaining < 0;

  return {
    phase,
    phaseNumber: Math.min((session?.phaseIndex ?? 0) + 1, phases.length),
    phaseCount: phases.length,
    elapsed,
    remaining,
    /** Time elapsed past the limit, for the "over by" display. */
    overrun: over ? -remaining : 0,
    over,
    text: over ? `+${formatClock(-remaining)}` : formatClock(remaining),
    speaker: phase.side,
    /** Whose floor it is, or null when the room is in an open phase. */
    floor: phase.side,
    isOpen: phase.kind === 'open' || phase.side === null,
    last: (session?.phaseIndex ?? 0) >= phases.length - 1,
  };
}

export function advancePhase(session) {
  const phases = phasesFor(session);
  if (session.phaseIndex >= phases.length - 1) return false;
  session.phaseIndex += 1;
  session.elapsed = 0;
  return true;
}

export function lastPhase(session) {
  return (session?.phaseIndex ?? 0) >= phasesFor(session).length - 1;
}

// ------------------------------------------------------- points of information

/** How many points the named side may still raise in the current phase. */
export function pointsRemaining(session, sideKey) {
  const phase = currentPhase(session);
  if (phase.kind !== 'speech' || !phase.pointsAllowed) return 0;
  if (phase.side === sideKey) return 0;
  const raised = (session.points || []).filter(
    (point) => point.phaseIndex === session.phaseIndex && point.side === sideKey
  ).length;
  return Math.max(0, phase.pointsAllowed - raised);
}

/**
 * Whether a point may be raised right now, and why not if not.
 *
 * The grace period is not a technicality: interrupting in the first twenty
 * seconds of a speech is how a room stops listening to anyone.
 */
export function canRaisePoint(session, sideKey) {
  const phase = currentPhase(session);
  if (phase.kind !== 'speech') return { ok: false, reason: 'Points may only be raised during a speech.' };
  if (phase.side === sideKey) return { ok: false, reason: 'You have the floor. Make your point in the speech.' };
  if (!phase.pointsAllowed) return { ok: false, reason: 'This speech does not take points.' };
  if ((session.elapsed || 0) < POI_GRACE_SECONDS) {
    return { ok: false, reason: `Points open ${POI_GRACE_SECONDS} seconds in.` };
  }
  if (pointsRemaining(session, sideKey) <= 0) {
    return { ok: false, reason: 'This side has used its points in this speech.' };
  }
  return { ok: true, reason: '' };
}

export function raisePoint(session, sideKey, { text = '', at = new Date().toISOString() } = {}) {
  const allowed = canRaisePoint(session, sideKey);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  const point = {
    id: `poi${(session.points || []).length + 1}`,
    phaseIndex: session.phaseIndex,
    phase: currentPhase(session).name,
    side: sideKey,
    text,
    state: 'offered',
    at,
  };
  session.points = [...(session.points || []), point];
  return { ok: true, point };
}

export function settlePoint(session, id, state) {
  const point = (session.points || []).find((entry) => entry.id === id);
  if (!point) return { ok: false, reason: 'No such point.' };
  point.state = state;
  return { ok: true, point };
}

// ----------------------------------------------------------------- arguments

/**
 * The two fields. `claim` is what the side is asserting; `support` is the reason
 * they gave for it. Deliberately not labelled "evidence", because mid-speech
 * people offer reasons, and the record is where they find out whether any of
 * them was a citation.
 */
export function addCard(session, sideKey, { claim = '', support = '', at = new Date().toISOString() } = {}) {
  if (!claim.trim()) return { ok: false, reason: 'A card needs a claim.' };
  const card = {
    id: `c${(session.cards || []).length + 1}`,
    side: sideKey,
    claim: claim.trim(),
    support: support.trim(),
    phase: currentPhase(session)?.name || '',
    at,
  };
  session.cards = [...(session.cards || []), card];
  return { ok: true, card };
}

export function removeCard(session, id) {
  session.cards = (session.cards || []).filter((card) => card.id !== id);
  return session.cards.length;
}

/** Counts for the room header: who has said how much. */
export function roomTally(session) {
  const cards = session?.cards || [];
  return SIDE_KEYS.map((key) => ({
    key,
    name: session?.sides?.[key]?.name || key,
    cards: cards.filter((card) => card.side === key).length,
    withSupport: cards.filter((card) => card.side === key && card.support).length,
    points: (session?.points || []).filter((point) => point.side === key).length,
  }));
}

// ------------------------------------------------------- session -> record

/**
 * Turn what happened in the room into a debate record.
 *
 * This is where the rules finally apply. Nothing was refused during the room;
 * the record simply states what is missing, and the room's arguments become
 * moves that were made in the order they were made. Support text becomes the
 * warrant, so an argument given without a citation shows up as exactly that.
 */
export function sessionToDebate(session, { at = new Date().toISOString() } = {}) {
  const phaseOrder = phasesFor(session).map((phase) => phase.name);
  const sideFor = (key) => ({
    id: key,
    name: session?.sides?.[key]?.name || key,
    position: key === 'a' ? 'affirms' : 'denies',
    burden: session?.sides?.[key]?.burden || '',
  });

  // Order by phase, then by the order the cards were added. Card ids are handed
  // out in that order, and timestamps can tie when two people are typing at once.
  const cardNumber = (id) => Number(String(id).replace(/\D/g, '')) || 0;

  const moves = [...(session.cards || [])]
    .sort((left, right) => {
      const byPhase = phaseOrder.indexOf(left.phase) - phaseOrder.indexOf(right.phase);
      return byPhase !== 0 ? byPhase : cardNumber(left.id) - cardNumber(right.id);
    })
    .map((card, index) => ({
      id: `m${index + 1}`,
      side: card.side,
      // Every card is an argument, because that is what a claim and a reason
      // are. Opening and closing are phases of the room rather than kinds of
      // contribution, and calling a card an "opening" would quietly exempt it
      // from the check that matters: that the room cited nothing.
      kind: 'argument',
      language: '',
      claim: card.claim,
      warrant: card.support,
      steelman: '',
      impact: '',
      targets: [],
      evidence: [],
      at: card.at,
    }));

  return {
    format: 'witness/debate',
    version: 1,
    id: sessionId(session),
    motion: session?.motion || '',
    kind: 'disputation',
    created: at.slice(0, 10),
    terms: [],
    sides: SIDE_KEYS.map(sideFor),
    moves,
    concessions: [],
    adjudication: {
      state: session?.ballot?.decision === 'open' ? 'unresolved' : 'decided',
      adjudicator: session?.ballot?.judge || '',
      decision: session?.ballot?.decision === 'open' ? '' : session.ballot.decision,
      reasons: session?.ballot?.reasons || '',
    },
    /** Not arguments: what the room did procedurally. */
    procedural: (session?.points || []).map((point) => ({
      kind: 'point of information',
      phase: point.phase,
      side: point.side,
      state: point.state,
      text: point.text,
      at: point.at,
    })),
    note: '',
  };
}

/**
 * Motions to offer on the setup screen, drawn from the term base.
 *
 * A term base is a poor home page and an excellent source of things to argue
 * about, which is why the cards end up here: each recorded loss is a motion
 * waiting to be made.
 */
export function motionsFor(cards, { limit = 8 } = {}) {
  const motions = [];
  for (const card of cards || []) {
    const label = card?.concept?.label;
    if (!label) continue;
    for (const rendition of card.renditions || []) {
      if (!rendition?.loss || !rendition?.rendering) continue;
      // No language code in the prose: "into en" is a raw identifier leaking
      // into a sentence a person has to read aloud in a room.
      motions.push(`Rendering \u201c${label}\u201d as \u201c${rendition.rendering}\u201d misleads a reader.`);
      if (motions.length >= limit) return motions;
    }
    if (motions.length < limit) motions.push(`\u201c${label}\u201d is untranslatable.`);
    if (motions.length >= limit) return motions;
  }
  return motions;
}

/** The room's own transcript, for pasting into a chat or printing. */
export function sessionToMarkdown(session) {
  const clock = roomClock(session);
  const lines = [
    `# ${session.motion || 'Untitled motion'}`,
    '',
    `- Format: ${(FORMATS[session.formatKey] || FORMATS.freeform).label}`,
    `- Affirming: ${session.sides?.a?.name || 'a'}`,
    `- Denying: ${session.sides?.b?.name || 'b'}`,
    '',
  ];

  for (const key of SIDE_KEYS) {
    const sideName = session.sides?.[key]?.name || key;
    lines.push(`## ${sideName} — ${key === 'a' ? 'affirms' : 'denies'}`, '');
    if (session.sides?.[key]?.burden) lines.push(`*Must establish:* ${session.sides[key].burden}`, '');
    const cards = (session.cards || []).filter((card) => card.side === key);
    if (!cards.length) lines.push('_Nothing recorded._', '');
    for (const card of cards) {
      lines.push(`- **${card.claim}**`);
      if (card.support) lines.push(`  - ${card.support}`);
    }
    lines.push('');
  }

  if ((session.points || []).length) {
    lines.push('## Points of information', '');
    for (const point of session.points) {
      lines.push(`- ${point.phase} — raised by ${session.sides?.[point.side]?.name || point.side}: ${point.state}${point.text ? ` — ${point.text}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Ballot', '');
  if (session.ballot?.decision && session.ballot.decision !== 'open') {
    lines.push(`Decided by **${session.ballot.judge || 'an unnamed judge'}**: ${session.ballot.decision}`, '');
    if (session.ballot.reasons) lines.push(session.ballot.reasons, '');
  } else {
    lines.push('No decision recorded. That is a legitimate outcome, and often the honest one.', '');
  }

  lines.push(`_Session in the ${clock.phase.name} phase when exported._`);
  return lines.join('\n');
}
