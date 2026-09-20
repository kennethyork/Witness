# Colophon — format notes

**No claim without a colophon.** Three primitives. Everything else is interface.

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

A statement (`colophon/statement`) is the parity primitive applied to a text that
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
