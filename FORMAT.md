# Witness — format notes

**No claim without a witness.** Three primitives. Everything else is interface.

## 1. Provenance

No claim exists without a citation. A term card without `sources` is invalid by
schema, not by convention. When a contributor asserts "this rendering loses the
covenantal sense," the card records *who* asserts it and *on what basis*.

## 2. Parity

In any multi-language statement, each language version has its own approval
state per party. "Translated" is never a boolean and never a single person's
decision to declare. Divergence between versions is a tracked field, not a bug
report — the same discipline that makes UN and EU treaties "equally authentic"
in every language of record.

## 3. Additivity

Bodies of text are never edited in place. Corrections are annotations. Redaction
is an attributed, visible act with an author and a reason. Nothing is
silently overwritten, because in this domain the history of the document *is*
the document.

---

## The statement record

A statement (`witness/statement`) is the parity primitive applied to a text that
exists in several languages at once: a joint declaration, an apology, an
agreement, a dialogue record.

```
statement
  parties[]    { id, name, role: party|facilitator|witness|interpreter, languages[] }
  versions[]   { language, status, body, translator: { name, kind },
                 approvals[]:  { party, state, note, at }
                 divergences[]: { kind, summary, raisedBy, resolved }
                 basis[]:      { termCard, note } }
  retention    { policy, destroyBy }
```

Four rules shape it, and each exists because of a specific failure:

1. **Four approval states, not two.** `pending`, `approved`, `rejected`, and
   `withheld`. Withheld exists so that silence is never counted as consent. A
   statement with a withheld approval is not ratified, and the UI says so.
2. **A divergence needs a named person.** `raisedBy` is required. No tool can
   notice that a translation says less than its source; a human has to declare
   it, and their name goes on the declaration.
3. **The tool never compares meanings.** The only automatic comparison is
   counting words, reported as a question to ask a human, never as a finding.
4. **One version per language.** Two drafts in the same language is an error,
   because it is almost always a mistake rather than an intention, and it hides
   which text is actually of record.

Retention is a field rather than an afterthought: a record about people should
say when it is destroyed, and by whom. If the parties have not agreed, it is
blank, and the record says that too.

---

## The debate record

A statement is for a text the parties agree on. A **debate** (`witness/debate`)
is the opposite situation: sides, a question in dispute, and an outcome that may
be a decision or may honestly be that nobody moved. That cannot be squeezed into
a statement, so it is its own record.

```
debate
  motion        one sentence that could be affirmed or denied
  terms[]       { term, card, status: settled|contested|undefined, agreed, note }
  sides[]       { id, name, position, burden, languages[] }
  moves[]       { id, side, kind: opening|argument|objection|response|closing,
                  claim, evidence[]: { source, locator, card },
                  warrant, impact, steelman, targets[], language }
  concessions[] { move, side, state: conceded|contested|unaddressed, note }
  adjudication  { state: open|decided|unresolved, adjudicator, decision, reasons }
```

Four rules, each answering a specific way that religious argument goes wrong.

1. **Terms are pinned before argument.** Most interfaith disagreement about a
   word is disagreement about the word, and the cheapest move in the genre is
   *"that is not what hesed means"*. Each contested term records what both sides
   accept it means **for this debate**, and which card each side relies on. If the
   terms cannot be pinned, `status` says so and the record says so loudly —
   because then the debate is about terminology, and the participants should know
   that before spending an hour on doctrine. A settled term needs the actual
   wording; an unsettled one needs a note on how the readings differ.
2. **An objection must restate what it attacks, in its strongest form.**
   `steelman` is required, and lint **rejects** an objection without it. This is
   the only structural defence against strawmanning, which is the most common way
   a debate produces heat without progress. A restatement too short to be fair is
   flagged.
3. **Every argument carries evidence and a warrant.** Evidence is a citation,
   ideally a term card; the warrant is why that evidence supports the claim.
   Missing either is *flagged, not blocked* — sometimes you are reasoning from a
   text you have not quoted yet, and a format that refuses to record that is a
   format people work around.
4. **The tool never adjudicates.** `decided` requires a named person and their
   reasons, and lint rejects a decision without either. What the tool computes is
   facts about the record: which objections went unanswered, which arguments cite
   nothing, which terms were left unpinned, what each side conceded. It has no
   score, no ranking, and no notion of who is winning — and there is a test that
   fails if anyone ever adds one.

`unresolved` is a first-class outcome, not a failure. In a dispute about
terminology it is often the more honest answer than a decision.

---

## The correspondence protocol

Two people can conduct a debate without any server, the way a disputation by
post always worked. Each side writes only its own moves, exports a
**contribution** file, and sends it. Importing merges the correspondent's moves
and verifies that nothing already held has been altered.

```
contribution
  debate      { id, motion }
  side        which side sent it
  basedOn     transcript digest this was written against
  terms       the pinned terms, as this side holds them
  termsDigest sha256 of those terms
  moves[]     only this side's moves
```

Each move carries `at` (when it was made), `prev` (the transcript digest it was
appended to) and `digest` (sha256 of its own contents, including `prev`).
`stampChain` assigns these and only ever **appends**: an already-stamped move is
verified rather than recomputed, so it cannot be used to launder an edit.

**A merge refuses rather than guesses.** It will not accept a move that
contradicts one you already hold, a move whose digest does not match its own
contents, or a move written against a transcript version you do not have — and in
each case it names the move and the reason. A merge that silently reorganises
somebody's argument is worse than a merge that fails.

**Terms divergence is reported.** If the correspondent's `termsDigest` differs
from yours, the moves still merge and the record says so loudly, because the two
of you may be arguing about different words. Reading the two digests aloud to
each other is the point of having them.

### What this proves, and what it does not

Stated plainly rather than implied by the word "signed":

| holds | does not hold |
|---|---|
| Editing any move is detected, at the earliest edited move | Someone holding a copy can edit a move and recompute every digest after it; nothing here would notice |
| Reordering moves is detected | Dropping **trailing** moves is not: a shorter chain still verifies |
| An incoming contribution contradicting your copy is refused | Nothing prevents a side from writing an entirely fabricated transcript |

The practical guarantee is structural and social rather than cryptographic: each
side holds its own copy, your own record of what you said lives in your file, and
a contradiction surfaces at merge time rather than never. Real asymmetric
signatures would close the fabrication gap, and they are the upgrade path — they
need a secure context and a key-management story that a static folder does not
have.

`Re-stamp everything` exists for one case: you wrote a move, saved it, spotted a
typo, and have not sent it. It recomputes the whole chain and therefore cannot
tell a correction from a rewrite, so it is never automatic, it says so in the
confirmation, and it moves the transcript revision so that any copy the other
side already holds stops matching.

---

## The line that cannot be crossed

**The repository is public. Case data is not.**

| | Where it lives | Public? |
|---|---|---|
| The app / tooling | GitHub Pages | yes, by design |
| The term base (V0) | repo, JSON, version-controlled | yes, by design |
| Joint statements (V1) | repo **only if** every party consents, and drafts never | case by case |
| RJ case files (V2) | **never** the repo. Device-local only, exported as files. | no |

If a feature requires uploading a harmed person's statement to a server, that
feature does not get built. This is the constraint that makes the project
trustworthy, and it is not negotiable for convenience.

## Licensing

- **Code**: AGPL-3.0. A hosted closed fork of a tool like this is the failure
  mode worth preventing.
- **Data (term cards)**: CC BY-SA 4.0. The commons should be forkable and
  must stay a commons.

## Contribution flow for term cards

Git history is the audit trail. Contributors add or amend JSON under
`data/terms/`, CI validates against `schema/term-card.schema.json`, reviewers
review. An amended card keeps its `id` forever, so a citation made in year one
still resolves in year ten.

Machine translation may *suggest* a rendition. It may never be an `author`.
Every `basis` is a human, a text, or both.

## Rendering requirements (not polish)

- Every user-supplied string renders with `dir="auto"` and correct script
  fonts. Bidirectional text is the product, not a feature of it.
- Print stylesheet is a first-class output. These documents get signed on paper.
- Full keyboard navigation and screen-reader labelling. A tool about who gets
  heard cannot be a tool that excludes people from reading it.
