/**
 * The debating room, on screen.
 *
 * What this view is for: two sides arguing while somebody watches the clock.
 * Everything about it is arranged around that. The clock is the largest thing on
 * the page, the two sides sit side by side so each can see what the other has
 * said, and adding an argument is two short inputs and Enter.
 *
 * It owns a timer, so it returns a `dispose` and main.js calls it before
 * replacing the view. A leaked interval running against a detached DOM is the
 * kind of bug that only shows up as a fan spinning up.
 */

import { el, block, clear } from './dom.js';
import { field, textInput, textArea, select } from './forms.js';
import { button } from './ui.js';
import {
  FORMATS, FORMAT_KEYS, TERM_STATE_LABELS, SIDE_KEYS, suggestBurden,
  roomClock, advancePhase, lastPhase,
  canRaisePoint, raisePoint, settlePoint, addCard, removeCard, roomTally,
  pinTerm, pinFromMotion, removeTerm, pinnedTermsState,
  sessionToMarkdown,
} from './room.js';

const TERM_STATES = ['settled', 'contested', 'undefined'];

export function debateRoomView({
  session, motions = [], cards = [], onPersist, onProduce, onReset,
}) {
  const node = el('div', { class: 'room' });
  let interval = null;
  let lastPersist = 0;

  const stop = () => {
    if (interval) clearInterval(interval);
    interval = null;
    session.running = false;
  };

  const persist = (message) => onPersist(session, message);

  const clockNode = el('div', { class: 'room-clock' });
  const phaseNode = el('div', { class: 'room-phase' });
  const termsStrip = el('div', { class: 'room-terms' });
  const columnsNode = el('div', { class: 'room-columns' });

  /**
   * The pinned terms, kept in view while people argue.
   *
   * This is the format's signature rule, and a constraint nobody can see is not
   * a constraint. A contested term shows how each side reads it, so a speaker
   * can be reminded mid-argument that the disagreement may be about the word.
   */
  function drawTermsStrip() {
    const state = pinnedTermsState(session);
    clear(termsStrip);

    if (!state.count) {
      termsStrip.append(el('p', {
        class: 'room-terms-empty',
        text: 'No terms pinned. The record will say so, and some of this may be a disagreement about a word.',
      }));
      return;
    }

    termsStrip.append(
      el('p', { class: 'room-terms-head' },
        el('span', { class: 'lang', text: `${state.count} term(s) pinned` }),
        state.allSettled
          ? el('span', { class: 'status status-ok', text: 'both sides agree on the words' })
          : el('span', { class: 'status status-warn', text: `${state.unpinned.length} read differently` }),
        state.incomplete.length
          ? el('span', { class: 'status status-alert', text: `${state.incomplete.length} still to describe` })
          : null
      ),
      el('ul', { class: 'room-term-list' }, (session.terms || []).map((term) =>
        el('li', { class: `room-term room-term-${term.status}` },
          el('span', { class: 'room-term-word', auto: term.term }),
          term.card
            ? el('a', { class: 'lang', href: `#/term/${encodeURIComponent(term.card)}`, text: term.card })
            : null,
          el('span', { class: 'lang', text: TERM_STATE_LABELS[term.status] || term.status }),
          (term.status === 'settled' ? term.agreed : term.note)
            ? block('p', term.status === 'settled' ? term.agreed : term.note, { class: 'room-term-note' })
            : el('p', { class: 'room-term-note empty', text: 'nothing recorded yet' })
        )
      ))
    );
  }

  // ------------------------------------------------------------- the clock

  const startClock = () => {
    if (interval) return;
    interval = setInterval(() => {
      if (!session.running) return;
      session.elapsed = (session.elapsed || 0) + 1;
      drawClock();
      // Persist occasionally rather than every second: losing the clock to a
      // reload is annoying, and writing sixty times a minute is worse.
      if (Date.now() - lastPersist > 15000) {
        lastPersist = Date.now();
        persist();
      }
    }, 1000);
  };

  function drawClock() {
    const clock = roomClock(session);
    const floorName = clock.isOpen
      ? 'the room'
      : session.sides?.[clock.floor]?.name || clock.floor;

    clockNode.className = `room-clock ${clock.over ? 'over' : ''}`;
    clear(clockNode).append(
      el('p', { class: 'room-whose', text: clock.isOpen ? 'Open floor' : `${floorName} has the floor` }),
      el('p', { class: 'room-time', text: clock.text }),
      el('p', { class: 'room-left', text: clock.over ? 'time is up' : 'remaining' })
    );

    clear(phaseNode).append(
      el('span', { class: 'lang', text: `Phase ${clock.phaseNumber} of ${clock.phaseCount}` }),
      block('span', clock.phase.name, { class: 'room-phase-name' }),
      el('span', { class: 'lang', text: FORMATS[session.formatKey]?.label || session.formatKey }),
      clock.phase.pointsAllowed && !clock.isOpen
        ? el('span', { class: 'lang', text: `takes ${clock.phase.pointsAllowed} point(s) of information` })
        : null
    );

    // A glance should tell you whose floor it is.
    for (const column of columnsNode.querySelectorAll('.room-column')) {
      column.classList.toggle('has-floor', !clock.isOpen && column.dataset.side === clock.floor);
    }
  }

  // -------------------------------------------------------- the two columns

  function drawColumns() {
    clear(columnsNode).append(...SIDE_KEYS.map(drawColumn));
    drawClock();
    for (const column of columnsNode.querySelectorAll('.room-column')) {
      column.classList.toggle('has-floor', column.dataset.side === roomClock(session).floor);
    }
  }

  function drawColumn(key) {
    const tally = roomTally(session).find((entry) => entry.key === key);
    const cards = (session.cards || []).filter((card) => card.side === key);
    const toDecide = (session.points || []).filter(
      (point) => point.state === 'offered' && point.side !== key
    );

    const claim = el('input', {
      type: 'text', dir: 'auto', placeholder: 'What they are claiming…', autocomplete: 'off',
    });
    const support = el('input', {
      type: 'text', dir: 'auto', placeholder: 'the reason given (optional)', autocomplete: 'off',
    });

    const submit = () => {
      const result = addCard(session, key, { claim: claim.value, support: support.value });
      if (!result.ok) {
        claim.focus();
        return;
      }
      persist();
      drawColumns();
      // Focus the next claim, so the next argument is one keystroke away.
      node.querySelector(`.room-column[data-side="${key}"] input[placeholder^="What"]`)?.focus();
    };

    for (const input of [claim, support]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
    }

    const point = canRaisePoint(session, key);
    const pointText = el('input', {
      type: 'text', dir: 'auto', placeholder: 'the point, in one line', autocomplete: 'off',
    });
    const pointForm = el('div', { class: 'room-poi-form', hidden: true },
      pointText,
      button('Offer it', () => {
        const raised = raisePoint(session, key, { text: pointText.value });
        if (!raised.ok) return;
        persist();
        drawColumns();
      }, { class: 'ghost tiny' })
    );

    return el('section', { class: 'room-column', dataset: { side: key } },
      el('header', { class: 'room-column-head' },
        block('h3', session.sides?.[key]?.name || key, { tabindex: '-1' }),
        el('p', { class: 'room-position', text: key === 'a' ? 'affirms the motion' : 'denies the motion' }),
        session.sides?.[key]?.burden
          ? block('p', `Must establish: ${session.sides[key].burden}`, { class: 'room-burden' })
          : el('p', { class: 'room-burden empty', text: 'No burden stated. The record will say so.' }),
        el('p', { class: 'room-tally' },
          el('span', { class: 'lang', text: `${tally.cards} argument${tally.cards === 1 ? '' : 's'}` }),
          el('span', { class: 'lang', text: `${tally.withSupport} with a reason` }),
          tally.points ? el('span', { class: 'lang', text: `${tally.points} point(s) raised` }) : null
        )
      ),

      toDecide.length
        ? el('div', { class: 'room-points' }, toDecide.map((entry) =>
            el('div', { class: 'room-point' },
              el('div', {},
                el('strong', { text: 'Point of information' }),
                block('span', entry.text || '(offered without text)', {})
              ),
              el('div', { class: 'actions' },
                button('Accept', () => { settlePoint(session, entry.id, 'accepted'); persist(); drawColumns(); }, { class: 'ghost tiny' }),
                button('Decline', () => { settlePoint(session, entry.id, 'declined'); persist(); drawColumns(); }, { class: 'ghost tiny' })
              )
            )
          ))
        : null,

      el('ol', { class: 'room-cards' }, cards.length
        ? cards.map((card) => el('li', { class: 'room-card' },
            el('div', { class: 'room-card-body' },
              block('p', card.claim, { class: 'room-card-claim' }),
              card.support
                ? block('p', card.support, { class: 'room-card-support' })
                : el('p', { class: 'room-card-support empty', text: 'no reason given' })
            ),
            el('div', { class: 'room-card-tools' },
              el('span', { class: 'lang', text: card.phase || '' }),
              button('Remove', () => { removeCard(session, card.id); persist(); drawColumns(); }, { class: 'ghost tiny' })
            )
          ))
        : el('p', { class: 'empty', text: 'Nothing from this side yet.' })),

      el('div', { class: 'room-add' }, claim, support, button('Add', submit, { class: 'tiny' })),

      el('div', { class: 'room-point-actions' },
        el('button', {
          type: 'button',
          class: 'ghost tiny',
          text: 'Offer a point of information',
          disabled: !point.ok,
          title: point.ok ? 'Offer a point during the other side\u2019s speech' : point.reason,
          on: {
            click: () => {
              pointForm.hidden = !pointForm.hidden;
              if (!pointForm.hidden) pointText.focus();
            },
          },
        }),
        point.ok ? null : el('span', { class: 'room-poi-why', text: point.reason })
      ),
      pointForm
    );
  }

  // -------------------------------------------------------------- the setup

  function setupScreen() {
    const motion = el('input', {
      type: 'text', dir: 'auto', class: 'room-motion-input', autocomplete: 'off',
      placeholder: 'One sentence that could be affirmed or denied…',
      value: session.motion || '',
    });

    const names = {
      a: el('input', { type: 'text', value: session.sides?.a?.name || '', autocomplete: 'off' }),
      b: el('input', { type: 'text', value: session.sides?.b?.name || '', autocomplete: 'off' }),
    };
    const burdens = {
      a: el('input', { type: 'text', dir: 'auto', value: session.sides?.a?.burden || '', autocomplete: 'off' }),
      b: el('input', { type: 'text', dir: 'auto', value: session.sides?.b?.burden || '', autocomplete: 'off' }),
    };

    const fillBurdens = () => {
      for (const key of SIDE_KEYS) {
        if (!burdens[key].value.trim()) burdens[key].value = suggestBurden(motion.value, key);
      }
    };
    // Keep the typed motion in the session without redrawing, so choosing a
    // suggestion afterwards does not lose what somebody already wrote.
    motion.addEventListener('blur', () => {
      session.motion = motion.value;
      fillBurdens();
      persist();
    });

    // ---------------------------------------------------------- the terms

    const termsNode = el('div', { class: 'room-term-editor' });

    const drawTerms = () => {
      const state = pinnedTermsState(session);
      const newTerm = el('input', {
        type: 'text', dir: 'auto', placeholder: 'a word the two sides may mean differently…',
        autocomplete: 'off',
      });

      clear(termsNode).append(
        (session.terms || []).map((term, index) => el('div', { class: 'room-term-row' },
          el('div', { class: 'repeatable-head' },
            el('span', { class: 'repeatable-title', text: `Term ${index + 1}` }),
            button('Remove', () => { removeTerm(session, term.id); persist(); drawTerms(); }, { class: 'ghost tiny' })
          ),
          el('div', { class: 'form-row' },
            field('Word', el('input', {
              type: 'text', dir: 'auto', value: term.term, autocomplete: 'off',
              on: { input: (event) => { term.term = event.target.value; persist(); } },
            }), { hint: 'In the language it is disputed in.' }),
            field('Term card', el('input', {
              type: 'text', list: 'room-term-cards', value: term.card || '', autocomplete: 'off',
              on: { input: (event) => { term.card = event.target.value.trim(); persist(); } },
            }), { hint: 'Optional. Bind it and the card\u2019s recorded losses come with it.' })
          ),
          field('Status', select({
            value: term.status,
            options: TERM_STATES.map((value) => [value, TERM_STATE_LABELS[value]]),
            onChange: (value) => { term.status = value; persist(); drawTerms(); },
          }), {}),
          field(term.status === 'settled'
            ? 'What both sides accept it to mean here'
            : 'How the sides read it differently', textArea({
              value: term.status === 'settled' ? term.agreed : term.note,
              rows: 2, dir: 'auto',
              onChange: (value) => {
                if (term.status === 'settled') term.agreed = value;
                else term.note = value;
                persist();
              },
            }), {
            hint: term.status === 'settled'
              ? 'Required. The wording both sides will accept for this debate.'
              : 'Required, and usually the most useful sentence the room produces. If the sides cannot write it, that is worth knowing before anyone argues.',
          })
        )),

        el('div', { class: 'room-term-add' },
          newTerm,
          button('Pin it', () => {
            const result = pinTerm(session, { term: newTerm.value, status: 'contested' });
            if (!result.ok) { newTerm.focus(); return; }
            newTerm.value = '';
            persist();
            drawTerms();
          }, { class: 'tiny' })
        ),

        state.incomplete.length
          ? el('p', { class: 'field-error', text: `${state.incomplete.length} term(s) still need the sentence the record requires.` })
          : null
      );
    };
    drawTerms();

    const open = () => {
      if (!motion.value.trim()) {
        motion.focus();
        return;
      }
      fillBurdens();
      session.motion = motion.value.trim();
      for (const key of SIDE_KEYS) {
        session.sides[key].name = names[key].value.trim() || session.sides[key].name;
        session.sides[key].burden = burdens[key].value.trim();
      }
      session.phaseIndex = 0;
      session.elapsed = 0;
      session.ballot = { judge: '', decision: 'open', reasons: '' };
      persist();
      draw();
    };

    return el('div', { class: 'room-setup' },
      el('h2', { text: 'Open a debate', tabindex: '-1' }),
      el('p', { class: 'lede', text: 'Two sides, a motion, a clock. Nothing is demanded of you while you argue: the record takes care of itself afterwards, and it will tell you honestly what was missing.' }),

      field('The motion', motion, {
        id: 'room-motion',
        hint: 'A proposition a side can affirm or deny. “Hesed is untranslatable” is a motion; “translation” is a topic.',
      }),

      motions.length
        ? el('div', { class: 'room-suggestions' },
            el('p', { class: 'field-hint', text: 'Or take one from the term base:' }),
            el('ul', {}, motions.map((suggestion) =>
              el('li', {},
                el('button', {
                  type: 'button', class: 'ghost tiny', text: suggestion.text,
                  on: {
                    click: () => {
                      // Taking a motion from the base also pins its term, seeded
                      // from that card's recorded loss: the loss is the dispute.
                      session.motion = suggestion.text;
                      for (const key of SIDE_KEYS) {
                        session.sides[key].burden = suggestBurden(suggestion.text, key);
                      }
                      pinFromMotion(session, suggestion);
                      persist();
                      draw();
                    },
                  },
                })
              )
            ))
          )
        : null,

      el('datalist', { id: 'room-term-cards' }, cards.map((card) => el('option', { value: card.id, text: card.concept.label }))),

      el('fieldset', { class: 'group' },
        el('legend', { text: 'Terms, pinned before argument' }),
        el('p', { class: 'hint', text: 'Most disagreement about a word is disagreement about the word. Pin it now, or find out here that you cannot \u2014 either is better than discovering it an hour in.' }),
        termsNode
      ),

      el('fieldset', { class: 'group' },
        el('legend', { text: 'Format' }),
        el('div', { class: 'room-formats' }, FORMAT_KEYS.map((key) => {
          const format = FORMATS[key];
          return el('label', { class: `room-format ${session.formatKey === key ? 'chosen' : ''}` },
            el('input', {
              type: 'radio', name: 'room-format', checked: session.formatKey === key,
              on: {
                change: () => {
                  session.formatKey = key;
                  session.phaseIndex = 0;
                  session.elapsed = 0;
                  persist();
                  draw();
                },
              },
            }),
            el('span', { class: 'room-format-name', text: format.label }),
            el('span', { class: 'room-format-desc', text: format.description }),
            el('span', { class: 'room-format-phases', text: format.phases.map((phase) => phase.name).join(' → ') })
          );
        }))
      ),

      el('fieldset', { class: 'group' },
        el('legend', { text: 'The two sides' }),
        el('div', { class: 'room-sides' }, SIDE_KEYS.map((key) =>
          el('div', { class: 'room-side-setup' },
            field(key === 'a' ? 'Affirming' : 'Denying', names[key], { id: `room-name-${key}` }),
            field('Must establish', burdens[key], { id: `room-burden-${key}`, hint: 'Filled in from the motion, and meant to be edited.' })
          )
        ))
      ),

      el('div', { class: 'actions' },
        button('Open the room', open),
        session.motion ? button('Start over', onReset, { class: 'ghost' }) : null
      )
    );
  }

  // ---------------------------------------------------------- the judgement

  function judgementPanel() {
    const ballot = (session.ballot = session.ballot || { judge: '', decision: 'open', reasons: '' });

    return el('fieldset', { class: 'group room-judgement' },
      el('legend', { text: 'Judgement' }),
      el('p', { class: 'hint', text: 'The app has no opinion and there is nowhere here to give it one. If nobody moved, record that: in a dispute about words it is often the honest answer.' }),
      field('Judge', textInput({
        id: 'room-judge',
        value: ballot.judge,
        onChange: (value) => { ballot.judge = value; persist(); },
      }), { id: 'room-judge' }),
      el('div', { class: 'room-decisions' }, [
        ['open', 'No decision'],
        ['a', `For ${session.sides?.a?.name || 'the affirming side'}`],
        ['b', `For ${session.sides?.b?.name || 'the denying side'}`],
        ['unresolved', 'Nobody moved'],
      ].map(([value, label]) =>
        el('label', { class: 'room-decision' },
          el('input', {
            type: 'radio', name: 'room-decision', checked: ballot.decision === value,
            on: { change: () => { ballot.decision = value; persist(); draw(); } },
          }),
          el('span', { text: label })
        )
      )),
      ballot.decision !== 'open'
        ? field(ballot.decision === 'unresolved' ? 'Why nobody moved' : 'Reasons', textInput({
            id: 'room-reasons',
            value: ballot.reasons,
            onChange: (value) => { ballot.reasons = value; persist(); },
          }), { id: 'room-reasons' })
        : null,
      el('div', { class: 'actions' },
        button('Turn this into the record', () => onProduce(session)),
        button('Copy the transcript', async () => {
          try {
            await navigator.clipboard.writeText(sessionToMarkdown(session));
            onPersist(session, 'Transcript copied.');
          } catch {
            onPersist(session, 'The clipboard is unavailable here.');
          }
        }, { class: 'ghost' }),
        button('Print', () => window.print(), { class: 'ghost' })
      )
    );
  }

  // ------------------------------------------------------------- the whole

  function draw() {
    clear(node);
    if (!session.motion) {
      stop();
      node.append(setupScreen());
      return;
    }
    drawTermsStrip();
    node.append(
      el('div', { class: 'room-head' },
        block('p', session.motion, { class: 'room-motion', tabindex: '-1' }),
        el('div', { class: 'actions' },
          button(session.running ? 'Pause the clock' : 'Start the clock', () => {
            session.running = !session.running;
            if (session.running) startClock();
            persist();
            draw();
          }),
          button('Next phase', () => {
            if (!advancePhase(session)) return;
            persist();
            draw();
          }, { class: 'ghost', disabled: lastPhase(session) }),
          button('Back a phase', () => {
            if (session.phaseIndex === 0) return;
            session.phaseIndex -= 1;
            session.elapsed = 0;
            persist();
            draw();
          }, { class: 'ghost', disabled: session.phaseIndex === 0 }),
          button('New debate', onReset, { class: 'ghost' })
        )
      ),
      phaseNode,
      clockNode,
      termsStrip,
      columnsNode,
      judgementPanel()
    );
    drawColumns();
  }

  draw();
  if (session.running) startClock();

  return {
    node,
    dispose() {
      stop();
    },
  };
}
