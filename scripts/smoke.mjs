#!/usr/bin/env node
/**
 * Boot the real app in a fake DOM.
 *
 * This exists because of a specific failure: a scripted edit turned
 * `setView` into a function that called itself, so every render blew the stack
 * and the entire app rendered nothing. The static checks passed. Node could not
 * import the module, because it touches `document`. So the whole app shipped
 * broken and nobody could have known without opening a browser.
 *
 * So this builds just enough DOM for main.js to run for real, then walks every
 * route and asserts that something with the right shape came out. It is not a
 * browser and it does not check layout. It checks that the thing boots, routes,
 * and renders, which is exactly the class of bug that got through.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDigest } from '../app/hash.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const fail = (message) => {
  problems.push(message);
  console.error(`error   ${message}`);
};

// ---------------------------------------------------------------- fake DOM

class FakeNode {
  constructor() {
    this.children = [];
    this.parentNode = null;
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

let focused = null;

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty: () => {} };
    this.listeners = new Map();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.title = '';
    this.scrollTop = 0;
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((name) => this.classList._set.add(name)),
      remove: (...names) => names.forEach((name) => this.classList._set.delete(name)),
      contains: (name) => this.classList._set.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classList._set.has(name) : force;
        if (on) this.classList._set.add(name);
        else this.classList._set.delete(name);
        return on;
      },
    };
  }

  get className() { return [...this.classList._set].join(' '); }
  set className(value) {
    this.classList._set = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent ?? '').join('');
    return this._text;
  }

  set textContent(value) {
    this.children = [];
    this._text = String(value ?? '');
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (node instanceof FakeFragment) {
        for (const child of node.children) this.append(child);
        node.children = [];
        continue;
      }
      const child = node instanceof FakeNode ? node : new FakeText(node);
      child.parentNode = this;
      this.children.push(child);
      this._text = '';
    }
  }

  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return this.dataset[key] === undefined ? null : String(this.dataset[key]);
    }
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ type, target: this, preventDefault() {}, stopPropagation() {}, ...event });
    }
  }
  focus() { focused = this; }
  blur() { if (focused === this) focused = null; }
  scrollIntoView() {}
  click() { this.dispatch('click'); }

  descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType === 1) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelectorAll(selector) {
    const compounds = selector.trim().split(/\s+/);
    const last = compounds[compounds.length - 1];
    return this.descendants().filter((el) => matches(el, last));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeFragment extends FakeNode {
  constructor() { super(); this.nodeType = 11; }
}

/** Enough of a selector engine for the compound selectors this app uses. */
function matches(el, selector) {
  const cleaned = selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
  const tag = cleaned.match(/^[a-zA-Z][\w-]*/);
  if (tag && el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;

  for (const cls of cleaned.match(/\.[A-Za-z0-9_-]+/g) || []) {
    if (!el.classList.contains(cls.slice(1))) return false;
  }
  const id = cleaned.match(/#([\w-]+)/);
  if (id && el.getAttribute('id') !== id[1]) return false;

  for (const attr of cleaned.match(/\[[^\]]+\]/g) || []) {
    const parsed = attr.slice(1, -1).match(/^([\w-]+)(?:([\^$*]?)=(?:"([^"]*)"|([^\]]*)))?$/);
    if (!parsed) continue;
    const [, name, operator, quoted, bare] = parsed;
    const value = quoted === undefined ? bare : quoted;
    const actual = el.getAttribute(name);
    if (value === undefined) {
      if (actual === null) return false;
      continue;
    }
    const text = String(actual ?? '');
    if (operator === '^' ? !text.startsWith(value)
      : operator === '$' ? !text.endsWith(value)
      : operator === '*' ? !text.includes(value)
      : text !== value) return false;
  }
  return true;
}

const documentElement = new FakeElement('html');
documentElement.lang = 'en';

const body = new FakeElement('body');

/** The elements index.html provides, which the app reaches for by id. */
const shellMain = new FakeElement('main');
shellMain.setAttribute('id', 'main');
const themeToggle = new FakeElement('button');
themeToggle.setAttribute('id', 'theme-toggle');
const themeIcon = new FakeElement('span');
themeIcon.className = 'theme-icon';
const themeLabel = new FakeElement('span');
themeLabel.className = 'theme-label';
themeToggle.append(themeIcon, themeLabel);
body.append(shellMain, themeToggle);

const byId = new Map([['main', shellMain], ['theme-toggle', themeToggle]]);

globalThis.document = {
  documentElement,
  body,
  title: '',
  activeElement: null,
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
  createDocumentFragment: () => new FakeFragment(),
  getElementById: (id) => byId.get(id) || documentElement.descendants().find((el) => el.getAttribute('id') === id) || null,
  querySelector: (selector) => documentElement.querySelector(selector),
  addEventListener: () => {},
};

globalThis.Node = FakeNode;
globalThis.HTMLElement = FakeElement;
globalThis.requestAnimationFrame = (fn) => fn();

// ------------------------------------------------------------------ globals

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};

globalThis.location = {
  hash: '',
  protocol: 'https:',
  origin: 'https://example.test',
  pathname: '/witness/',
};

globalThis.history = { replaceState: () => {} };
globalThis.navigator = { clipboard: { writeText: async () => {} } };
globalThis.confirm = () => false;
globalThis.print = () => {};
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};

// The term base is assembled here from the source cards rather than read from
// _site/. An earlier version read the built bundle, which meant this check only
// worked after a build had run -- it passed locally, where a _site was always
// lying around, and died in CI with ENOENT because it was wired in before the
// build step. A check that depends on another step having run first is a trap.
const cardsDir = path.join(root, 'data', 'terms');
const cardFiles = (await readdir(cardsDir)).filter((name) => name.endsWith('.json')).sort();
const cards = [];
for (const file of cardFiles) {
  cards.push(JSON.parse(await readFile(path.join(cardsDir, file), 'utf8')));
}
const termBase = {
  format: 'witness/term-base',
  version: 1,
  license: 'CC-BY-SA-4.0',
  digest: baseDigest(cards),
  count: cards.length,
  cards,
};
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => termBase,
});

const listeners = new Map();
globalThis.window = {
  addEventListener: (type, handler) => {
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  },
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  print: () => {},
};
const fireWindow = (type, event = {}) => {
  for (const handler of listeners.get(type) || []) handler({ type, preventDefault() {}, ...event });
};

// -------------------------------------------------------------------- run

const routes = [
  ['#/', 'Open a debate'],
  ['#/terms', 'Search the term base'],
  ['#/term/hesed', 'Provenance'],
  ['#/losses', 'Loss ledger'],
  ['#/matrix', 'Concepts by language'],
  ['#/compare', 'Compare two concepts'],
  ['#/drafts', 'Your drafts'],
  ['#/author', 'New card'],
  ['#/statement', 'New statement'],
  ['#/debate', 'New debate'],
  ['#/import', 'Import JSON'],
  ['#/settings', 'Settings'],
  ['#/about', 'About Witness'],
];

// A rejected promise inside boot() would otherwise abort with a raw stack trace
// instead of naming what broke.
process.on('unhandledRejection', (error) => {
  fail(`the app threw while booting or routing: ${error?.message || error}`);
});

try {
  await import('../app/main.js');
  // Let the boot promise resolve.
  await new Promise((resolve) => setTimeout(resolve, 200));
} catch (error) {
  fail(`importing and booting main.js threw: ${error.message}`);
}

const viewRoot = byId.get('main');
const renderedText = () => viewRoot.textContent;

if (!renderedText().includes('Open a debate')) {
  fail(`the front door did not render the room. Got: ${renderedText().slice(0, 200)}`);
}

for (const [hash, expected] of routes) {
  location.hash = hash;
  try {
    fireWindow('hashchange');
    await new Promise((resolve) => setTimeout(resolve, 20));
  } catch (error) {
    fail(`route ${hash} threw: ${error.message}`);
    continue;
  }
  const text = renderedText();
  if (!text.includes(expected)) {
    fail(`route ${hash} did not render "${expected}". Got: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

// The search panel and its results are built on the term base route.
location.hash = '#/terms';
try {
  fireWindow('hashchange');
  await new Promise((resolve) => setTimeout(resolve, 20));
} catch (error) {
  fail(`returning to the term base threw: ${error.message}`);
}
if (!renderedText().includes('hesed')) {
  fail('the term base route rendered no cards');
}

// Nothing should have been left ticking behind by the room.
location.hash = '#/';
fireWindow('hashchange');
await new Promise((resolve) => setTimeout(resolve, 20));

// ------------------------------------------------------------------ report

if (!problems.length) {
  console.log(`booted, and all ${routes.length + 2} route checks rendered something.`);
} else {
  console.error(`\n${problems.length} problem(s) found by booting the app.`);
  process.exit(1);
}

export { matches, FakeElement };
