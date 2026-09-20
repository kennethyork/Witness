# Witness

**No claim without a witness.**

A cited term base for interfaith translation, plus a parity tracker for multi-language statements. Every card records how each tradition renders a concept and, more importantly, **what each rendering loses**. "No equivalent" is a citable claim here, not a failure state.

Live site: <https://witness.studytools.cc/> — static, no server, no accounts, no dependencies.

Repository: <https://github.com/kennethyork/Witness>, which also serves the site at <https://kennethyork.github.io/Witness/> (that URL redirects to the domain above).

---

## The idea

Machine translation fails at exactly the moments that matter in interfaith work. *hesed* becomes "loving-kindness" and the covenant obligation disappears. *dharma* becomes "religion" and a colonial classification looks native. *shalom* becomes "peace" and a material promise of wholeness becomes the absence of noise. A translator will pick a word and hide the loss; in dialogue, the loss **is** the content.

So this tool stores the loss as data, next to the citation that establishes it, and refuses to publish a card that claims one without stating it.

Three primitives, in [`FORMAT.md`](FORMAT.md):

1. **Provenance** — no claim without a source. Enforced by the schema, not by convention.
2. **Parity** — every language version of a text has its own approval state per party. "Translated" is never a boolean.
3. **Additivity** — text is never silently overwritten. Corrections are annotations; redaction is attributed and visible.

The domain has a mature precedent for primitives 2 and 3: multilingual legal drafting. UN, EU, and Canadian treaty practice treats every language version as **equally authentic** and tracks divergence explicitly (VCLT Article 33). The scholarship even names the failure mode this project exists to resist — courts drifting into "de facto bilingualism" that favors English and French "at the expense of other equally authentic language versions." Restorative justice agreements have the identical property and no affordable tooling at all.

## What it does

**Debate** — the front door is a room, not a reference book:

- **A motion, two sides, a clock.** Pick or write a proposition, pick a format (freeform, one on one, parliamentary), name the sides. Motions can be drawn from the term base: every recorded loss is an argument waiting to be had.
- **The clock is the largest thing on the page**, because in a room the clock is what everyone is looking at. Prep, speaking time, time-up shown honestly as an overrun rather than silently wrapped.
- **Phases with a floor.** Whose turn it is, highlighted at a glance, with next/back so the chair can correct a mistake.
- **Adding an argument takes two fields and Enter.** Claim and the reason given. Anything slower and people stop typing while they are speaking, which is when an app stops being useful.
- **Points of information**, with the rules that make them work: only during the other side's speech, not in the first twenty seconds, no more than the phase allows. The speaker accepts or declines.
- **A ballot at the end** from a named judge, or "nobody moved".
- **The rules do not gate the room.** Nothing is refused mid-argument. The room converts to a debate record afterwards, and *that* is where the rules apply — so a group argues freely and then reads an honest account of what they did, including that they cited nothing. Strict afterwards, easy during.

This is the opposite of the rest of the app, deliberately. The term base, the statement tracker, and the debate *record* are all for recording what happened. The room is for happening.

## What it records

**Read** — a term base you can actually interrogate:

- **Search** across terms, glosses, sources, and the recorded losses, not just the words. Quoted phrases kept whole, every token must match.
- **Filters** by language of rendering, language the concept came from, status, and tradition — combined as AND. "Every rendering anyone has disputed" and "everything whose origin is Hebrew" are first-class queries, not power-user tricks.
- **Loss ledger** — every recorded loss in one place, grouped by status, with the statistics. Read together, the losses are the interesting part: the same borrowed word shows up again and again, doing work it cannot do.
- **Concepts by language** — a coverage matrix.
- **Compare** two concepts side by side, with the languages aligned, so you can see where two traditions reached for the same word. That is usually where the misunderstanding lives, and it is better to find it before you are in a room arguing about it.
- **RTL, bidi, and scripts** handled by construction: every string carries `dir="auto"` and a `lang` attribute, so Arabic and Hebrew lay out correctly and a screen reader pronounces them from the right language.
- **Print** as a first-class output. Cards, results, the ledger, and statement records all survive the printer with the digest attached.
- **Offline**, installable, and keyboard-driven. `⌘K` / `Ctrl-K` for the command palette, `/` to search.
- **Citations** that name the card's *revision*, not just its id: plain text, BibTeX, Markdown, or a permalink. Search state lives in the URL, so a search is a link.

**Write** — without git, without an account, without uploading anything:

- **Card editor** with live validation using the same rules CI enforces. Progress indicator, error list with paths, and a suggestions list that never nags you into inventing an optional field.
- **Statement editor (the parity tracker)** — parties, language versions, per-party approvals, declared divergences, terms relied on, retention policy. It computes what the record says: which versions are ratified, who is outstanding, which divergences are open.
- **Drafts** in your browser, exportable as single files, and a full local archive you can move between devices.
- **Import** a card, several cards, a statement, or an archive — by paste or file.
- **Export for other people's tools**: CSV and TBX-Lite for translators and terminologists, Markdown for circulating a statement, JSON for the repository.

**Argue** — structured disputation, which is a different thing from dialogue:

- **Debate records** with a motion, terms pinned *before* argument, sides with stated burdens, and moves that carry evidence and a warrant.
- **An objection must restate what it attacks, in its strongest form** — enforced by validation, not requested. None of the platforms I looked at requires this, which is not the same as claiming none of them solves the problem another way.
- **The tool never adjudicates.** A decision requires a named person and their reasons; the record computes which objections went unanswered and what was conceded, and it has no score. There is a test that fails if anyone ever adds one.
- **`unresolved` is a legitimate outcome**, and often the honest one.
- **Two people can conduct a debate with no server.** Each side writes only its own moves and exports a contribution file; the other side merges it. Editing a move, reordering them, or contradicting a copy someone already holds is *detected and refused* at merge time, and if your two sets of pinned terms differ, the record tells you that you may be arguing about different words. The limits of that guarantee — it is tamper-*evident*, not tamper-proof — are written down in [`FORMAT.md`](FORMAT.md) rather than left implied by the word "signed".

**Deliberately absent**, and not by omission:

- No translator. It never renders your sentence into another language and never claims a loss it cannot name.
- No authority. Cards state who said what and on what basis, and unreviewed ones say so loudly.
- No machine reader. It cannot tell whether two texts mean the same thing, so it never tries: divergences are declared by named people, and the only automatic comparison is counting words — reported as *a question to ask a human*, never as a finding.
- No upload path. See below.
- No verdict. It will not tell you who won a debate, and it is built so that it cannot: a tool that scored religious argument would be the worst possible version of this.

## Where this sits

Naming your neighbours is the same rule this project applies to everything else, so: most of
what is here is not new, and implying otherwise would be the exact failure this project was built
to catch.

**Not new.** Structured argument tooling has a fifty-five-year lineage — IBIS (Kunz and Rittel,
1970), Toulmin's argument model, Araucaria, MIT's Deliberatorium. [Kialo](https://www.kialo.com) is
the category leader in text debate and is **already** "no winner by design", so declining to
adjudicate is not a differentiator. [Wikidebates](https://www.wikidebates.org/) is a nonprofit
encyclopedia of pro and con arguments under CC BY-SA. Cassin's *Dictionary of Untranslatables* is
the term-base idea done superbly across a dozen languages, in print, in 1,344 pages. IATE, UNTERM
and TERMIUM Plus are the institutional multilingual terminology databases the parity primitive
imitates — and they standardise translations rather than recording what each one loses. Sefaria,
SuttaCentral, 84000 and STEPBible already publish parallel translations, each within one tradition.
The [Database of Religious History](https://religiondatabase.org) already gathers
expert-contributed, cited, structured claims about religion.

**What I could not find anyone doing:**

- Recording the *loss* as first-class, cited data **across** traditions. Institutions standardise
the loss away; single-tradition platforms do not attempt it; the dictionary is not a tool.
- Pinning terms across languages before an argument starts.
- Requiring an objection to restate what it attacks, enforced by validation.
- No accounts, no server, nothing uploaded. Every platform above is hosted.
- A portable record that two parties can verify against each other's copy.

**One warning from the field, which matters more than any competitor.** Wikidebate, the Wikimedia
structured-debate project, was [discontinued in August 2026](https://en.wikiversity.org/wiki/Wikidebate)
"due to a lack of moderation and policy implementation". A structurally sound, well-intentioned,
funded debate platform died of **governance**, not of technology. That is the risk worth guarding
against, and it is why the review path matters more than the feature list.

**Adopt rather than invent.** The structure of an argument is thoroughly worked ground. The
[Argument Interchange Format](https://en.wikipedia.org/wiki/Argument_Interchange_Format) is the
interoperability target worth meeting so a debate recorded here can move into academic
argumentation tooling instead of competing with it.

## The line that cannot be crossed

**This repository and this site are public and have no server. Case data is not here.**

| | Where it lives | Public |
|---|---|---|
| App and tooling | GitHub Pages, a folder of static files | yes, by design |
| Term cards | repo, JSON, versioned | yes, by design — it is a commons |
| Draft cards | your browser's local storage; you export a file | no |
| Statements, approvals, divergences | your browser; you export a file when ready to circulate | no |
| RJ case files | never the repo, never any server. Device-local, exported as files. | no |

If a future feature would require uploading a harmed person's statement to a server, that feature does not get built. This is not a nicety: it is the constraint that makes the project trustworthy, and it is stated on the About page of the deployed site.

Clearing browser data deletes local drafts. That is the point — and it is why **export is the backup**, and why the interface says so rather than pretending drafts are safe.

## Run it

```bash
node scripts/check.mjs          # hashing, determinism, search, lint, parity, exports
node scripts/check-modules.mjs  # module graph, service worker, nav links, stylesheet hazards
node scripts/build.mjs          # lint + build into _site/
node scripts/smoke.mjs          # boot the app in a fake DOM and walk every route
node scripts/serve.mjs          # http://localhost:8080, serving _site/
```

Or `npm test`, which runs all three. No `npm install`: there are no dependencies, and that is deliberate. A project meant to be readable and rebuildable in ten years should not rot with a lockfile.

Browsers refuse to load ES modules over `file://`, so opening `index.html` from disk will not work. Use `scripts/serve.mjs` or any static server.

## Deploy to GitHub Pages

1. Create a public repository (Pages on a private repo needs a paid plan, and the site is public either way).
2. Push this to `main`.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) validates the cards against the schema, runs both test suites, builds `_site/`, and deploys it.

No base-path configuration is needed. Every asset is referenced relatively and the app fetches its data relative to its own module URL, so it runs at `/`, at `/Witness/`, on a user page, or on a custom domain — where it is served from the domain root — without changes.

To serve it on a subdomain, claim the domain in the repository settings **before** pointing DNS at it (GitHub's own warning: a domain configured in DNS but unclaimed can be taken over by another repository). Then add one record:

| type | name | value |
|---|---|---|
| `CNAME` | your subdomain label | `kennethyork.github.io` |

No `CNAME` file is needed: with a GitHub Actions deployment it is ignored and not required, which is the opposite of what most guides say (they assume a branch deployment). The certificate is provisioned by Let's Encrypt automatically, up to an hour after DNS resolves; **Enforce HTTPS** becomes available once it lands. Check for `CAA` records on the domain, which can silently block issuance.

Notes for whoever maintains this next:

- **Service worker:** `sw.js` has an explicit asset list and a `VERSION` constant. `scripts/check-modules.mjs` fails the build if a module is missing from the list, so this cannot rot silently. Bump `VERSION` on release, or clients keep the old copy.
- **`.nojekyll`:** shipped, though `upload-pages-artifact` bypasses Jekyll anyway.
- **Deep links:** routing is hash-based, so there are no 404s to rewrite. `404.html` exists as belt and braces.
- **Three places share the rules:** `app/lint.js` and `app/parity.js` are used by the browser editor, by `scripts/build.mjs`, and by the tests. A rule that disagrees with itself is the worst kind of bug in a tool like this, so the rules live in one place by design.

## Layout

```
index.html                  app shell
app/
  main.js                   routing, state, handlers, command palette
  dom.js                    el(), bidi helpers; the only place text is inserted
  forms.js                  form controls, repeatable blocks, path accessors
  ui.js                     read views: term base, card, ledger, matrix, compare
  editor.js                 authoring views: card editor, statement editor, drafts
  search.js                 search, facets, permalinks (DOM-free, tested)
  lint.js                   the rules of a card (shared by editor, build, tests)
  parity.js                 statement model, approvals, divergences (DOM-free)
  export.js                 CSV, TBX, Markdown, JSON, and the import parsers
  store.js                  local storage; no upload path exists in this file
  hash.js                   SHA-256 and canonical JSON, pure JS so file:// works
  cite.js                   citations that name a revision
  terms.js                  loads the built bundle
styles/base.css             printer's ink and rubric red; system fonts only
styles/print.css            a first-class output, not an afterthought
data/terms/*.json           the source of truth, one file per card
data/terms.json             generated; do not edit
schema/term-card.schema.json   the contract
scripts/validate_cards.py   real JSON Schema validation, used in CI
scripts/build.mjs           deterministic build
scripts/check.mjs           136 logic checks, no framework
scripts/check-modules.mjs   static module-graph checks for the browser-only code
scripts/smoke.mjs           boots the app against a fake DOM and walks every route
scripts/serve.mjs           a dev server that survives malformed requests
```

## Why the digest exists

A card id is stable; a card's contents are not. So every card has a **digest** — SHA-256 over its canonical JSON — and citations name the digest, not just the id. An argument made in year one stays checkable in year ten, and you can tell whether the card changed underneath it. The whole term base has a digest too, so a revision of the commons is a thing you can name.

Consequences that are enforced rather than hoped for:

- The build is **deterministic**: same cards, byte-identical output. No timestamps, sorted cards, fixed key order.
- The browser and the build share [`app/hash.js`](app/hash.js), so a digest shown on the page cannot drift from the digest the build published.
- Hashing does not depend on `crypto.subtle`, which is missing on insecure origins, so it also works from a removable disk on a machine with no network.

## One thing to be careful about

A recorded *loss* is a fact about **translation**, not a fault in a tradition.
That distinction survives careful reading and does not survive quotation. In an
adversarial setting, *"the Latin pax imports imperial imposition"* quotes fine as
an attack on Christianity, and *"dharma rendered as religion"* quotes fine as an
accusation of colonialism.

Someone will do this. It is worth saying plainly, in the tool and in the record,
so that nobody can claim they were not warned: the losses here are what
languages do to each other, and every tradition in this base has lost something
in translation. That is the argument for recording them, not against any of them.

## Contributing a card

The editor at `#/author` writes cards without git: fill it in, watch it validate, export the JSON, and either open a pull request or paste it into an issue. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the rule everything else follows from, and how to write a *loss* that is worth reading.

The three seed cards are **unreviewed by design** — they say so on the page. That is the honest state of a base no community has yet corrected.

## Roadmap

- **V0:** read-only term base. Search, facets, RTL, print, offline. *Done.*
- **V1:** card editor and parity tracker for multi-language statements. *Done.*
- **V2:** restorative justice case records. Append-only statements, attributed redactions, hash-chained bodies, per-party visibility, printed artifacts for the room. **Do not build this without a practitioner.** Software that mediates restorative justice encodes the facilitator's power into its defaults, and the tool should produce artifacts humans use in a room, not a process humans perform inside the tool.
- **Small and useful next:** a single-file offline archive build for distribution on removable media; PDF export that embeds the digest; a translation-memory import so an existing TMX corpus can be checked against these cards.

## Licence

- Code: **AGPL-3.0** — a closed hosted fork of this is the failure worth preventing.
- Data: **CC BY-SA 4.0** — the commons should be forkable and must stay a commons.

Concepts are attributed to traditions and sources, not to this project.
