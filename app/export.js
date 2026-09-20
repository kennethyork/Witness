/**
 * Export and import.
 *
 * Formats here exist for specific people, not for completeness:
 *
 *  - TBX and CSV are for translators and terminologists, who already have CAT
 *    tools and spreadsheets and should not have to read this app's JSON.
 *  - Single-card JSON is for contributing to the repository without git.
 *  - Statement Markdown is for circulating a document to parties who will read
 *    it on paper or in an email client, not in a browser.
 *  - The bundle is what the app itself consumes.
 *
 * DOM-free, so scripts/check.mjs can verify round-trips and escaping.
 */

import { APPROVAL_LABELS, DIVERGENCE_LABELS, statementState } from './parity.js';

// ------------------------------------------------------------------- escaping

/** XML text escaping. Ampersand first, or we double-escape ourselves. */
export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 4180 quoting: wrap when needed, double any embedded quote. */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Markdown escaping, so a citation containing a pipe cannot break a table. */
function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

// ----------------------------------------------------------------- term cards

export function toTermBaseBundle(cards, digest) {
  return {
    format: 'colophon/term-base',
    version: 1,
    license: 'CC-BY-SA-4.0',
    digest: digest || null,
    count: cards.length,
    cards,
  };
}

/**
 * Terminology exchange for translators. A minimal TBX-Lite: termEntry per
 * concept, one langSet per language, with the recorded loss carried in a
 * descrip so it survives the trip into someone's CAT tool.
 */
export function toTbx(cards) {
  const entries = cards.map((card) => {
    const langSets = [];

    if (card.origin?.term) {
      langSets.push(
        [
          `      <langSet xml:lang="${xmlEscape(card.origin.language || 'und')}">`,
          '        <tig>',
          `          <term>${xmlEscape(card.origin.term)}</term>`,
          card.origin.transliteration
            ? `          <termNote type="transliteration">${xmlEscape(card.origin.transliteration)}</termNote>`
            : null,
          `          <descrip type="definition">${xmlEscape(card.concept.gloss)}</descrip>`,
          '        </tig>',
          '      </langSet>',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }

    for (const rendition of card.renditions) {
      langSets.push(
        [
          `      <langSet xml:lang="${xmlEscape(rendition.language || 'und')}">`,
          '        <tig>',
          `          <term>${xmlEscape(rendition.rendering)}</term>`,
          rendition.transliteration
            ? `          <termNote type="transliteration">${xmlEscape(rendition.transliteration)}</termNote>`
            : null,
          `          <descrip type="status">${xmlEscape(rendition.status)}</descrip>`,
          rendition.loss ? `          <descrip type="loss">${xmlEscape(rendition.loss)}</descrip>` : null,
          rendition.basis?.citation
            ? `          <descrip type="basis">${xmlEscape(rendition.basis.citation)}</descrip>`
            : null,
          '        </tig>',
          '      </langSet>',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }

    return [
      `    <termEntry id="${xmlEscape(card.id)}">`,
      `      <descrip type="subjectField">${xmlEscape((card.concept.domains || []).join(', '))}</descrip>`,
      ...langSets,
      '    </termEntry>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Minimal TBX-Lite profile. Losses are carried in descrip type="loss".',
    '     Colophon, data licence CC BY-SA 4.0. Concepts belong to the traditions',
    '     that hold them, not to this project. -->',
    '<tbx style="dca" type="TBX-Lite" xml:lang="en" xmlns="urn:iso:std:iso:30042:ed-2">',
    '  <header>',
    '    <fileDesc>',
    '      <titleStmt><title>Colophon term base</title></titleStmt>',
    `      <sourceDesc><p>${cards.length} concept(s).</p></sourceDesc>`,
    '    </fileDesc>',
    '  </header>',
    '  <body>',
    ...entries,
    '  </body>',
    '</tbx>',
    '',
  ].join('\n');
}

export const CSV_COLUMNS = [
  'card_id',
  'concept',
  'origin_language',
  'origin_term',
  'origin_transliteration',
  'language',
  'rendering',
  'transliteration',
  'tradition',
  'status',
  'loss',
  'basis_citation',
  'basis_locator',
  'basis_language',
  'reviewed',
];

export function toCsv(cards) {
  const rows = [CSV_COLUMNS];
  for (const card of cards) {
    const reviewed = (card.contributors || []).some((c) => c.role === 'reviewer') ? 'yes' : 'no';
    for (const rendition of card.renditions) {
      rows.push([
        card.id,
        card.concept.label,
        card.origin?.language || '',
        card.origin?.term || '',
        card.origin?.transliteration || '',
        rendition.language,
        rendition.rendering,
        rendition.transliteration || '',
        rendition.tradition || '',
        rendition.status,
        rendition.loss || '',
        rendition.basis?.citation || '',
        rendition.basis?.locator || '',
        rendition.basis?.language || '',
        reviewed,
      ]);
    }
  }
  return csvRows(rows);
}

/** Just the losses, grouped, as a sheet you could take into a room. */
export function toLossReport(cards) {
  const lines = [
    '# Recorded losses',
    '',
    'What each rendering drops, according to the cited source for each card.',
    'Generated from a Colophon term base (data licence CC BY-SA 4.0).',
    '',
  ];

  for (const card of cards) {
    const withLoss = card.renditions.filter((r) => r.loss);
    if (!withLoss.length) continue;
    lines.push(`## ${card.concept.label}`, '', card.concept.gloss, '');
    for (const rendition of withLoss) {
      lines.push(
        `### ${rendition.rendering} (${rendition.language}) — ${rendition.status}`,
        '',
        rendition.loss,
        '',
        `Basis: ${rendition.basis?.citation || 'none recorded'}`,
        ''
      );
    }
  }

  return lines.join('\n');
}

// ------------------------------------------------------------------- importing

/**
 * Accept a single card, an array of cards, or a built bundle. Used by the
 * import screen, so a contributor can paste what a reviewer sent back.
 */
export function parseCardsInput(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON — ${error.message}`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.cards)) return parsed.cards;
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new Error('expected a card, an array of cards, or a term base bundle');
}

// ------------------------------------------------------------------ statements

export function parseStatementInput(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON — ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.versions)) {
    throw new Error('expected a Colophon statement record with a "versions" array');
  }
  return parsed;
}

/**
 * A statement as a document to circulate. Every approval state is printed
 * explicitly, including the ones that are not approval, because the whole point
 * is that silence is not consent.
 */
export function statementToMarkdown(statement) {
  const { summary, openDivergences, ratified } = statementState(statement);
  const lines = [
    `# ${statement.title}`,
    '',
    `- Kind: ${statement.kind}`,
    `- Created: ${statement.created}`,
    `- Parties: ${(statement.parties || []).map((p) => `${p.name} (${p.role})`).join('; ')}`,
    `- Languages of record: ${summary.map((v) => v.language).join(', ') || 'none'}`,
    `- Fully ratified in every language: ${ratified ? 'yes' : 'no'}`,
    `- Open divergences: ${openDivergences}`,
    '',
    '> Every language version below is intended to be equally authentic. Where a',
    '> version is not approved by every party, that is stated rather than implied.',
    '',
  ];

  for (const version of statement.versions || []) {
    const facts = summary.find((v) => v.language === version.language);
    lines.push(
      `## ${version.language}`,
      '',
      `State: ${facts ? facts.state : 'unknown'}${version.status ? ` (recorded as ${version.status})` : ''}`,
      '',
      version.body || '_no text yet_',
      '',
      '### Approvals',
      '',
      '| Party | State |',
      '| --- | --- |'
    );

    for (const party of statement.parties || []) {
      const approval = (version.approvals || []).find((a) => a.party === party.id);
      const state = approval ? approval.state : 'pending';
      lines.push(`| ${mdCell(party.name)} | ${mdCell(APPROVAL_LABELS[state] || state)} |`);
    }

    lines.push('');
    if (approvalLines(version).length) {
      lines.push('### Approval notes', '');
      lines.push(...approvalLines(version), '');
    }

    if ((version.divergences || []).length) {
      lines.push('### Divergences', '');
      for (const divergence of version.divergences) {
        lines.push(
          `- **${DIVERGENCE_LABELS[divergence.kind] || divergence.kind}** — ${divergence.summary} (raised by ${divergence.raisedBy}; ${divergence.resolved ? 'resolved' : 'open'})`
        );
      }
      lines.push('');
    }

    if ((version.basis || []).length) {
      lines.push('### Terms relied on', '');
      for (const basis of version.basis) {
        lines.push(`- \`${basis.termCard}\`${basis.note ? ` — ${basis.note}` : ''}`);
      }
      lines.push('');
    }

    if (version.translator?.name || version.translator?.kind) {
      lines.push(
        `Translated by: ${version.translator?.name || 'unnamed'}${version.translator?.kind ? ` (${version.translator.kind})` : ''}`,
        ''
      );
    }
  }

  if (statement.retention?.policy || statement.retention?.destroyBy) {
    lines.push(
      '## Retention',
      '',
      `- Policy: ${statement.retention.policy || 'not stated'}`,
      `- Destroy by: ${statement.retention.destroyBy || 'not stated'}`,
      ''
    );
  }

  if (statement.note) lines.push('## Note', '', statement.note, '');

  return lines.join('\n');
}

function approvalLines(version) {
  return (version.approvals || [])
    .filter((a) => a.note)
    .map((a) => `- ${a.party}: ${a.note}`);
}

/** Filenames that sort usefully and say what they are. */
export function filename(prefix, id, extension) {
  const slug = (id || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `colophon-${prefix}-${slug}.${extension}`;
}
