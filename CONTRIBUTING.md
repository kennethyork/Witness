# Contributing a card

You do not need to write code, and you do not need to use git for this. Cards are data.

## The rule everything else follows from

**No claim without a source.** A card that asserts a rendering loses something must say who asserts it and cite the text that establishes it. A machine may suggest a rendition; a machine may never be the `basis`, and there is no field for one. The build fails otherwise, and that is intentional.

## What a card needs

One JSON file in `data/terms/`, named after the card's `id`. Start from an existing card — [`hesed.json`](../data/terms/hesed.json) is the fullest example. The contract is [`schema/term-card.schema.json`](../schema/term-card.schema.json).

The parts that carry the weight:

- **`gloss`** — one or two sentences in plain modern language, tradition-neutral where you can manage it. This is what a reader sees first.
- **`renditions[]`** — one entry per language the concept has been carried into. Each needs a `basis` (a citation) and a `status`.
- **`loss`** — required whenever `status` is not `equivalent`. Say what the rendering drops, adds, or distorts. This is the actual product. A card whose losses are vague is a bad card even if it validates.
- **`alternatives[]`** — renderings that were considered and rejected, with the reason. This is how the same argument stops being relitigated every five years.
- **`disputes[]`** — disagreement between traditions, or inside one, recorded rather than resolved. A term base that settles disputes in its own favour is not a commons.
- **`provenance_note`** — how the card came to exist, including who was not consulted.

## Status values

| status | use it when | `loss` required |
|---|---|---|
| `equivalent` | you are confident nothing load-bearing is lost. Rare, and worth being nervous about. | no |
| `nearest-no-equivalent` | the honest common case: this is the closest word, and here is how it fails. | yes |
| `transliterate-only` | the term should not be translated; it should be carried over and glossed. | no |
| `do-not-translate` | translating it is an error (liturgical formulas, names). | no |
| `contested` | people who know the languages disagree. Say who, in `disputes`. | yes |
| `undefined` | you know it matters and you cannot yet establish what it means. Recording ignorance honestly beats inventing a gloss. | yes |

## Writing a good loss

Bad: *"The English word is not exact."*

Good: *"English 'peace' is largely negative and private: the absence of war, noise, or disturbance. Shalom is positive and material — it includes health, sufficiency, safety, and right relation — so a community with no open conflict but no justice is not in shalom."*

The test: could a reader who knows neither language decide, from your sentence alone, whether the rendering is fit for their purpose? If not, keep writing.

## Review

Every card needs a **named reviewer** with standing in the relevant tradition or language before it stops displaying as **unreviewed**. Add them to `contributors` with `"role": "reviewer"`.

Unreviewed cards are published, and they say so, loudly, on the page. That is deliberate: a base that pretends to authority it has not earned is worse than one that admits it is unfinished.

Reviewers should assume their name will be attached to the card in citations for years.

## Writing a card without git

Open the site and go to **Drafts → New card** (`#/author`). It is a form. It validates as you type, using exactly the same rules CI enforces, and it tells you what is still missing and what would make the card better. When it is happy, press **Export card JSON** or **Copy card JSON**.

Then either open a pull request adding the file to `data/terms/`, or open an issue and paste it in. Somebody will do the git part and credit you as the author. Say if you would rather not use a terminal at all. The whole point of a commons is that the people whose knowledge it holds can add to it.

Your draft stays in your browser. It is not uploaded, because there is nowhere to upload it to: this project has no server.

## Writing a card with git

1. Copy `data/terms/hesed.json` to `data/terms/<your-id>.json`.
2. Edit it. Keep it valid JSON — no trailing commas, and no fields the schema does not define.
3. `node scripts/build.mjs` prints exactly what is wrong and where, and refuses to publish a card that fails.
4. Open a pull request. CI validates against the schema and runs the test suites.

## Statements, and the parity tracker

The **statement editor** (`Drafts → New statement`) is for a text that exists in several languages at once: a joint declaration, an apology, an agreement, a dialogue record. It records who approved which language version, and which divergences named people have reported, and it refuses to treat silence as consent. See [`FORMAT.md`](../FORMAT.md) for the four rules that shape the record.

This is the tool to use **before** you have a document to circulate, not instead of one. When you are ready, **Export for circulation (Markdown)** gives you something to send to the parties.

## What does not belong here

**Restorative justice case data, or any statement made by a harmed person.** Not in the repository, not in an issue, not in a pull request, not in a screenshot of one. See the boundary table in the [README](../README.md). If you are working on that material, it never touches this project's hosting.

## Licence

Cards are contributions under **CC BY-SA 4.0**. By contributing you confirm you have the right to, and that the commons stays a commons.
