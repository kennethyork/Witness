#!/usr/bin/env node
/**
 * Static checks for the parts that only exist in a browser.
 *
 * Node can import the DOM-free modules, so a bad import there fails loudly. But
 * app/ui.js, app/editor.js and app/main.js touch the DOM and therefore cannot be
 * imported here. That leaves a real gap: a typo in an import specifier or a name
 * that was renamed in one file and not the other would only show up when a
 * visitor opened the page.
 *
 * So this parses the module graph instead of executing it. It is the closest
 * thing to running the app that is available without a browser engine.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');

const problems = [];
const warnings = [];
const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

/** Names a module exports, via declarations and via export { … } lists. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const [original, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      if (!original) continue;
      names.add((alias || original).trim());
    }
  }
  return names;
}

/** Import statements, as { from, names, defaultName }. */
function importedNames(source) {
  const imports = [];
  for (const match of source.matchAll(/import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = match[1].trim();
    const from = match[2];
    const namedBlock = clause.match(/\{([^}]*)\}/);
    const names = namedBlock
      ? namedBlock[1]
          .split(',')
          .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
      : [];
    const defaultName = !clause.startsWith('{') && !clause.startsWith('*')
      ? clause.split(',')[0].trim()
      : null;
    imports.push({ from, names, defaultName, raw: match[0] });
  }
  return imports;
}

/** Does this identifier appear anywhere other than the import lines? */
function usedElsewhere(source, name) {
  const withoutImports = source.replace(/import\s+[^;]*?from\s+['"][^'"]+['"];?/g, '');
  return new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(withoutImports);
}

const files = (await readdir(appDir)).filter((name) => name.endsWith('.js')).sort();
const sources = new Map();
const exportsByFile = new Map();

for (const file of files) {
  const source = await readFile(path.join(appDir, file), 'utf8');
  sources.set(file, source);
  exportsByFile.set(file, exportedNames(source));
}

// 1. Every import resolves, and every imported name is actually exported.
for (const file of files) {
  const source = sources.get(file);
  const imports = importedNames(source);

  for (const entry of imports) {
    if (!entry.from.startsWith('.')) continue;

    const target = path.resolve(appDir, entry.from);
    const targetName = path.basename(target);
    if (!sources.has(targetName)) {
      fail(`${file}: imports "${entry.from}", which does not exist in app/`);
      continue;
    }

    const available = exportsByFile.get(targetName);
    for (const name of entry.names) {
      if (!available.has(name)) {
        fail(`${file}: imports { ${name} } from ${entry.from}, but ${targetName} does not export it`);
      }
    }
  }

  // 2. The same name imported twice from one module. This is a real mistake that
  //    Node tolerates in some forms and browsers reject in others.
  const seen = new Map();
  for (const entry of imports) {
    for (const name of entry.names) {
      const key = `${entry.from}:${name}`;
      if (seen.has(key)) fail(`${file}: imports "${name}" twice from ${entry.from}`);
      seen.set(key, true);
    }
  }

  // 3. Imports nothing uses. Warning, because it is untidy rather than broken.
  const counts = new Map();
  for (const entry of imports) {
    for (const name of entry.names) counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) continue;
    if (!usedElsewhere(source, name)) warn(`${file}: imports "${name}" but never uses it`);
  }
}

// 4. The service worker must list every module, or an offline visitor gets a
//    half-app and no explanation.
const serviceWorker = await readFile(path.join(root, 'sw.js'), 'utf8');
for (const file of files) {
  if (!serviceWorker.includes(`./app/${file}`)) {
    fail(`sw.js: app/${file} is not in the precache list, so offline visitors will not get it`);
  }
}
if (!serviceWorker.includes('./data/terms.json')) {
  fail('sw.js: data/terms.json is not in the precache list');
}
if (!/const VERSION = '/.test(serviceWorker)) {
  fail('sw.js: no VERSION constant, so cached clients can never be invalidated');
}

// The shell, read once and used by the checks below (inline script, asset paths).
const shell = await readFile(path.join(root, 'index.html'), 'utf8');

// 4b. Stylesheet hazards that only show up in a real browser.
const baseCss = await readFile(path.join(root, 'styles', 'base.css'), 'utf8');
const printCss = await readFile(path.join(root, 'styles', 'print.css'), 'utf8');

// Check declarations, not prose: comments here discuss the very hazards these
// checks look for, and stripping them first is the difference between a check
// that catches a bug and one that catches its own documentation.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const baseRules = stripComments(baseCss);
const allCss = `${baseRules}\n${stripComments(printCss)}`;

// The `hidden` attribute loses to any author rule that sets display, so an
// overlay styled `display: flex` stays on the page forever while element.hidden
// still reads true. This exact bug shipped once.
if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(baseRules)) {
  fail('base.css: no global [hidden] { display: none !important } rule, so any component that sets display will ignore the hidden attribute');
}

// An unsupported function drops the whole declaration with it, and a dropped
// scrim is an invisible overlay. Plain colours only.
if (/color-mix\(/.test(allCss)) {
  fail('a stylesheet uses color-mix(), which an unsupported browser drops silently');
}

// A selector that sets display on the same element type... nothing further to
// check statically, but flag the pattern that caused the bug above.
if (/\.palette\s*\{[^}]*display:\s*flex/.test(baseRules) && !/body\.palette-open/.test(baseRules)) {
  warn('base.css: .palette sets display: flex; make sure it can still be hidden');
}

// 4c. The theme is applied by an inline script before the first paint, which
//     means the storage key is written in two places. If they drift, dark mode
//     silently stops working and nobody notices until somebody complains about
//     a flash of white. So the drift is a build failure.
const storeSource = await readFile(path.join(appDir, 'store.js'), 'utf8');
const prefixMatch = storeSource.match(/const PREFIX = '([^']+)'/);
if (!prefixMatch) {
  fail('store.js: no PREFIX constant to check the inline theme script against');
} else {
  const inline = shell.match(/<script>([\s\S]*?)<\/script>/);
  if (!inline) {
    fail('index.html: no inline script, so the theme is applied only after first paint and dark mode flashes light');
  } else {
    if (!inline[1].includes(`${prefixMatch[1]}settings`)) {
      fail(`index.html: the inline theme script does not read ${prefixMatch[1]}settings, which is the key store.js writes`);
    }
    if (!/root\.dataset\.theme\s*=/.test(inline[1])) {
      fail('index.html: the inline script does not set data-theme');
    }
  }
}

// 4d. Both schemes must be declared, or native controls keep following the
//     system and disagree with the theme chosen in the app.
if (!/color-scheme:\s*light/.test(baseRules) || !/color-scheme:\s*dark/.test(baseRules)) {
  fail('base.css: color-scheme is not declared for both themes, so form controls and scrollbars will not follow the chosen theme');
}

// 5. Every local file the shell references must exist.
for (const match of shell.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) {
  const relative = match[1].replace(/^\.\//, '');
  try {
    await readFile(path.join(root, relative));
  } catch {
    fail(`index.html: references ${match[1]}, which does not exist`);
  }
}

// 5b. Every asset the service worker precaches must exist, or cache.addAll()
//     rejects and the visitor gets no offline support at all.
for (const match of serviceWorker.matchAll(/'(\.\/[^']+)'/g)) {
  const relative = match[1].replace(/^\.\//, '');
  if (relative === '') continue;
  if (relative === 'data/terms.json') continue; // generated by the build
  try {
    await readFile(path.join(root, relative));
  } catch {
    fail(`sw.js: precaches ${match[1]}, which does not exist, so cache.addAll() will reject and offline breaks entirely`);
  }
}

// 6. The manifest's icons must exist, or the install prompt silently fails.
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  const relative = String(icon.src).replace(/^\.\//, '');
  try {
    await readFile(path.join(root, relative));
  } catch {
    fail(`manifest.webmanifest: icon ${icon.src} does not exist`);
  }
}

// ------------------------------------------------------------------- report

for (const message of warnings) console.warn(`warning ${message}`);
for (const message of problems) console.error(`error   ${message}`);

const moduleCount = files.length;
console.log(`\nchecked ${moduleCount} modules and the service worker: ${problems.length} error(s), ${warnings.length} warning(s).`);
if (problems.length) process.exit(1);
