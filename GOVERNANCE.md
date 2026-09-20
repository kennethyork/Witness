# Governance

*written 2026-09-20. This is a first draft by the person who wrote the code, and the open questions at the end are real ones. Sections marked **open** are not settled.*

## Why this file exists

Wikidebate, the Wikimedia structured-debate project, was [discontinued in August 2026](https://en.wikiversity.org/wiki/Wikidebate) *"due to a lack of moderation and policy implementation."* It was funded, well-intentioned and structurally sound. It died of governance.

This project has the same shape and the same exposure. A cited commons with no rule about who may assert what, and no rule about who may remove it, does not fail loudly: it fills up with unreviewed claims that nobody stands behind, and readers stop trusting all of it.

So there are three questions this file has to answer. Everything else is detail.

1. **Who may assert something?** Anyone, as long as it is labelled as unreviewed.
2. **Who may mark it reviewed?** A named person with standing, whose name stays attached.
3. **Who may remove it?** Almost nobody, never silently, and never because they disagree with it.

## Cards

**Contributing.** Anyone. A card states who said what and on what basis; the build rejects a card that claims a loss without stating it, and a card with no source. Contributions arrive by pull request, or as a file pasted into an issue from the app, in which case somebody with a GitHub account opens the pull request and credits the author.

**Review.** A card stops displaying as *unreviewed* only when a contributor entry names a **reviewer** with standing in the relevant tradition or language. "Standing" is self-declared and public: a name that can be attached to the claim, and enough familiarity with the language or tradition to have a view. Nothing here verifies credentials, and the record does not pretend to.

**What a reviewer is signing.** The card, at a revision visible on the page, or — once the schema supports it — the specific renditions they have standing on. A Hebrew scholar is not signing the Pali.

**Conflicts of interest** (**open**: whether to require disclosure, or merely to record it):

- a reviewer may not review a card they authored;
- a translator may not review their own rendering;
- a reviewer with a doctrinal stake records it in their contributor entry rather than declining.

**When reviewers disagree.** This is not a tie for a maintainer to break. Disagreement is recorded, in the card's `disputes`, with each position named and sourced. A card carrying an unresolved dispute displays it. Maintainers adjudicate **process**, never substance: whether a citation exists, whether a reviewer has standing to sign the part they signed, whether the schema is satisfied.

**The honest failure mode.** If no reviewer with standing exists for a tradition, the card stays *unreviewed* and says so on the page, forever if necessary. That is a visible gap rather than a hidden one, and it is the correct behaviour. A base that pretends to authority it has not earned is worse than one that admits it is unfinished.

## Debates

A debate is a record of an exchange. Moderation of a debate is **not** deletion, and the four rules the build enforces are not negotiable:

- every argument states its claim;
- every objection restates what it attacks, in its strongest form;
- no decision exists without a named person and their reasons;
- the tool never adjudicates.

**What a maintainer may do.** Refuse to merge a debate that fails validation. Ask for a change before merging. Mark a debate as withdrawn at its author's request.

**What a maintainer may not do.** Edit anyone's move, including their own past moves: the chain makes edits detectable, and that mechanism exists precisely so this rule can be enforced rather than trusted. Remove a published debate because they think the argument is wrong. Add a verdict.

**Removal.** If a published debate must come out of the repository — a legal problem, a person's safety — it is removed by a commit that says why, in public, with a link to the issue. Git history keeps the fact that it happened. Nothing is silently deleted, because a commons that deletes quietly has no history worth citing.

**Objecting to a debate.** Take a side in the app and send a contribution, which is the point of the thing. If the objection is procedural, open an issue.

## The line that cannot be crossed

The repository and the site are public. **Restorative justice case data, or any statement made by a harmed person, is never hosted here, never uploaded, and never opened in a pull request, an issue, or a screenshot of one.** Where that material is concerned the tool produces files that the people involved hold. This rule is not subject to a vote, a majority, or a maintainer's judgement.

## Conduct

See [CODE-OF-CONDUCT.md](CODE-OF-CONDUCT.md). In short: argue about claims, not about people's standing; name your sources; do not use a recorded loss as a weapon against the tradition it belongs to.

## Appeals

Anyone affected by a maintainer action may say so in an issue. The maintainer who acted recuses themselves from the decision about it. **Open**: how appeals are decided while there is effectively one maintainer, which is the situation today.

## Open questions

Recorded rather than quietly decided:

- **Standing.** Self-declared, as now? Or attested by one existing reviewer? The first is open and gameable; the second is closed and slow.
- **Weight.** Does one reviewer close a card, or does a contested card need two? Today: one, recorded by name.
- **Maintainers.** Appointed, or whoever shows up? Today: whoever shows up.
- **Removal without a public reason.** Is there a case where a reason cannot be public? If yes, who decides that it is one?
- **A minimum of two maintainers**, so that appeals are possible at all. Today there is one, which is the weakest part of this document.

These are not rhetorical. Each one has a failure mode attached, and the failure modes are worse the longer they stay unwritten.
