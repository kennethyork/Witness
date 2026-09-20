/**
 * Citations.
 *
 * A term card is only useful if a reader can name the exact revision they relied
 * on. So citing always carries the card digest, not just the id: an id is stable
 * while the card's contents are not, and an argument made in year one should
 * still be checkable in year ten.
 */

import { APPROVAL_LABELS, statementState } from './parity.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Braces, backslashes, and percent signs are BibTeX's problem characters. */
function bibtexEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}%&$#_])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** The canonical URL of a route, for pasting into a message or a footnote. */
export function permalink(route) {
  const origin = globalThis.location?.origin || '';
  const path = globalThis.location?.pathname || '/';
  return `${origin}${path}#${route}`;
}

export function citeCard(card, digest, { date = today(), baseRevision = null, url = null } = {}) {
  const lines = [
    `"${card.concept.label}" (${card.id}). Colophon term base.`,
    `Card revision ${digest.slice(0, 16)}.`,
  ];
  if (baseRevision) lines.push(`Base revision ${baseRevision.slice(0, 16)}.`);
  if (url) lines.push(url);
  lines.push(
    `Retrieved ${date}. Data licence CC BY-SA 4.0.`,
    `Concepts are attributed to traditions and sources, not to Colophon.`
  );
  return lines.join('\n');
}

export function citeRendition(card, rendition, digest, { url = null } = {}) {
  const status = rendition.status === 'equivalent'
    ? 'recorded as equivalent'
    : `recorded as ${rendition.status.replace(/-/g, ' ')}`;
  return [
    `"${rendition.rendering}" (${rendition.language}) for "${card.concept.label}" (${card.id}), ${status}.`,
    `Colophon term base, card revision ${digest.slice(0, 16)}.`,
    rendition.loss ? `Loss recorded: ${rendition.loss}` : null,
    url,
  ]
    .filter(Boolean)
    .join('\n');
}

/** For people writing papers, which is most of the people who want this. */
export function citeCardBibtex(card, digest, { url = null, year = null } = {}) {
  const key = `colophon:${card.id}:${digest.slice(0, 8)}`;
  const fields = [
    `  title = {${bibtexEscape(card.concept.label)}}`,
    `  note = {Colophon term base, card revision ${digest.slice(0, 16)}}`,
    `  year = {${year || new Date().getFullYear()}}`,
    url ? `  howpublished = {\\url{${url}}}` : null,
    '  organization = {Colophon}',
  ].filter(Boolean);

  return [`@misc{${key},`, fields.join(',\n'), '}'].join('\n');
}

/** A card as a passage somebody could paste into an email or a bulletin. */
export function cardToMarkdown(card, digest, { url = null } = {}) {
  const lines = [
    `## ${card.concept.label}`,
    '',
    card.concept.gloss,
    '',
  ];

  if (card.origin?.term) {
    lines.push(
      `Origin: ${card.origin.term}${card.origin.transliteration ? ` (${card.origin.transliteration})` : ''} — ${card.origin.language}`,
      ''
    );
  }

  for (const rendition of card.renditions) {
    lines.push(
      `**${rendition.rendering}** (${rendition.language}) — ${rendition.status.replace(/-/g, ' ')}`,
      ''
    );
    if (rendition.loss) lines.push(rendition.loss, '');
    if (rendition.basis?.citation) lines.push(`*Basis:* ${rendition.basis.citation}`, '');
  }

  if ((card.disputes || []).length) {
    lines.push('### Recorded disagreement', '');
    for (const dispute of card.disputes) {
      lines.push(`- ${dispute.position} — *held by ${dispute.held_by}*`);
    }
    lines.push('');
  }

  lines.push('### Sources', '');
  for (const source of card.sources) {
    lines.push(`- ${source.citation}${source.locator ? ` (${source.locator})` : ''}`);
  }

  const reviewed = (card.contributors || []).some((c) => c.role === 'reviewer');
  lines.push(
    '',
    reviewed
      ? `Reviewed by ${(card.contributors || []).filter((c) => c.role === 'reviewer').map((r) => r.name).join(', ')}.`
      : '**Unreviewed.** No named reviewer has signed this card.',
    '',
    `Colophon, card revision ${digest.slice(0, 16)}. Data licence CC BY-SA 4.0.${url ? ` ${url}` : ''}`
  );

  return lines.join('\n');
}

/**
 * A statement citation must say whether every party approved every version,
 * because that is usually the only thing the reader actually needs to know.
 */
export function citeStatement(statement, { url = null } = {}) {
  const { summary, ratified, openDivergences } = statementState(statement);
  const lines = [
    `"${statement.title}" — ${statement.kind}.`,
    `Parties: ${(statement.parties || []).map((p) => p.name).join('; ')}.`,
    `Languages of record: ${summary.map((v) => `${v.language} (${v.state})`).join('; ') || 'none'}.`,
    ratified
      ? 'Every version approved by every party.'
      : `Not fully ratified: ${summary.filter((v) => v.state !== 'ratified').map((v) => v.language).join(', ') || 'none'}.`,
    `Open divergences: ${openDivergences}.`,
    `Created ${statement.created}.`,
  ];
  if (url) lines.push(url);
  return lines.join('\n');
}

export { APPROVAL_LABELS };
