#!/usr/bin/env node
/**
 * Build the deployable site into _site/.
 *
 * Deliberately deterministic: two runs over the same cards produce byte-identical
 * output, so the published digest is a fact about the cards rather than about
 * the machine that built them. No timestamps, sorted cards, fixed key order.
 * scripts/check.mjs asserts it.
 *
 * The digest is computed with app/hash.js and the rules come from app/lint.js,
 * the same modules the browser runs, so a published digest cannot drift from the
 * one a reader sees on the page and the rules cannot drift from the ones the
 * editor applies.
 *
 * This lint is fast and dependency-free. Real JSON Schema validation runs in CI
 * via scripts/validate_cards.py.
 */

import { readFile, readdir, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDigest } from '../app/hash.js';
import { lintAll } from '../app/lint.js';
import { lintDebate, stampChain, verifyChain, debateBaseDigest } from '../app/debate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '_site');
const termsDir = path.join(root, 'data', 'terms');
const debatesDir = path.join(root, 'debates');

const STATIC_FILES = [
  'index.html',
  '404.html',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  '.nojekyll',
  'app',
  'styles',
  'LICENSE',
  'DATA-LICENSE',
];

async function readCards() {
  const files = (await readdir(termsDir)).filter((name) => name.endsWith('.json')).sort();
  const entries = [];
  for (const file of files) {
    const raw = await readFile(path.join(termsDir, file), 'utf8');
    try {
      entries.push({ file, card: JSON.parse(raw) });
    } catch (error) {
      console.error(`error ${file}: invalid JSON — ${error.message}`);
      process.exit(1);
    }
  }
  return entries;
}

/**
 * Published debates, read the way cards are: files in the repository.
 *
 * Git is the platform here. The repository already provides accounts, identity,
 * publishing, attribution, history and moderation-by-merge, so this project does
 * not have to build any of that -- it has to produce records worth merging.
 */
async function readDebates() {
  let files = [];
  try {
    files = (await readdir(debatesDir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }

  const published = [];
  for (const file of files) {
    const raw = await readFile(path.join(debatesDir, file), 'utf8');
    try {
      published.push({ file, debate: JSON.parse(raw) });
    } catch (error) {
      console.error(`error  debates/${file}: invalid JSON — ${error.message}`);
      process.exit(1);
    }
  }
  return published;
}

async function main() {
  const entries = await readCards();
  const findings = lintAll(entries);

  // Published debates carry the same contract as cards: every argument states
  // its claim, every objection restates what it attacks, and no decision exists
  // without a named person. Errors stop the build; warnings are published.
  const published = await readDebates();
  for (const { file, debate } of published) {
    for (const finding of lintDebate(debate)) {
      findings.push({ ...finding, file: `debates/${file}` });
    }
  }

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warn');

  for (const finding of findings) {
    const stream = finding.level === 'error' ? console.error : console.warn;
    stream(`${finding.level === 'error' ? 'error  ' : 'warning'} ${finding.file} ${finding.path}: ${finding.message}`);
  }

  // Refuse rather than publish a half-truth. Note that nothing is deleted on
  // failure: the previously built site stays intact.
  if (errors.length) {
    console.error(`\n${errors.length} error(s). Nothing written.`);
    process.exit(1);
  }

  const cards = entries.map(({ card }) => card).sort((a, b) => a.id.localeCompare(b.id));
  const digest = baseDigest(cards);

  const bundle = {
    format: 'witness/term-base',
    version: 1,
    license: 'CC-BY-SA-4.0',
    digest,
    count: cards.length,
    cards,
  };

  await rm(outDir, { recursive: true, force: true });
  for (const relative of STATIC_FILES) {
    const from = path.join(root, relative);
    const to = path.join(outDir, relative);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });
  }

  // The schema ships with the site: the contract should be visible at a URL,
  // not just in the repository.
  await mkdir(path.join(outDir, 'schema'), { recursive: true });
  await cp(
    path.join(root, 'schema', 'term-card.schema.json'),
    path.join(outDir, 'schema', 'term-card.schema.json')
  );

  // The static-file loop creates the directories it needs; this one is
  // generated rather than copied, so it needs its own.
  await mkdir(path.join(outDir, 'data'), { recursive: true });
  await writeFile(path.join(outDir, 'data', 'terms.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  // Published debates are stamped as they are bundled. The sources carry `at`
  // and no digests, so a digest is determined by the content rather than by the
  // machine, and the build fails rather than publishing a broken chain.
  const debates = [];
  for (const { file, debate } of published) {
    const stamp = stampChain(debate);
    if (!stamp.ok) {
      console.error(`error  debates/${file}: the transcript does not verify (move ${stamp.index + 1}, ${stamp.reason})`);
      process.exit(1);
    }
    const check = verifyChain(debate);
    if (check.state !== 'intact') {
      console.error(`error  debates/${file}: the chain is ${check.state} after stamping`);
      process.exit(1);
    }
    debates.push(debate);
  }

  await writeFile(
    path.join(outDir, 'data', 'debates.json'),
    `${JSON.stringify({ format: 'witness/debate-base', version: 1, license: 'CC-BY-SA-4.0', digest: debateBaseDigest(debates), count: debates.length, debates }, null, 2)}\n`,
    'utf8'
  );

  // A build that silently produces nothing is worse than one that fails, so the
  // output is checked before this reports success.
  const problems = await verifyOutput({ cards: cards.length, digest });
  if (problems.length) {
    for (const problem of problems) console.error(`error   output: ${problem}`);
    console.error(`\n${problems.length} problem(s) with the built site.`);
    process.exit(1);
  }

  console.log(`\ncards: ${cards.length}`);
  console.log(`debates: ${debates.length}`);
  console.log(`base digest: ${digest}`);
  console.log(`output: ${path.relative(root, outDir)}/`);
  if (warnings.length) {
    console.log(`warnings: ${warnings.length} (published, and shown as unreviewed in the UI)`);
  }
}

async function verifyOutput({ cards, digest }) {
  const problems = [];

  for (const relative of [...STATIC_FILES, 'schema/term-card.schema.json', 'data/terms.json', 'data/debates.json']) {
    try {
      await stat(path.join(outDir, relative));
    } catch {
      problems.push(`${relative} is missing from the built site`);
    }
  }

  try {
    const bundle = JSON.parse(await readFile(path.join(outDir, 'data', 'terms.json'), 'utf8'));
    if (bundle.cards.length !== cards) {
      problems.push(`the published bundle has ${bundle.cards.length} cards, expected ${cards}`);
    }
    if (bundle.digest !== digest) {
      problems.push('the published digest does not match the digest of the cards that were read');
    }
  } catch (error) {
    problems.push(`the published bundle is unreadable: ${error.message}`);
  }

  return problems;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
