/**
 * DOM primitives.
 *
 * Two rules, enforced here rather than trusted to each view:
 *
 *  1. Untrusted text is inserted with textContent. Nothing in this app ever
 *     assigns innerHTML, because card data arrives from a public repository and
 *     a contributor's pull request should not be able to run script in a
 *     reader's browser.
 *  2. Text a human wrote gets dir="auto" and, where the language is known, a
 *     lang attribute. This is a tool about who gets heard; mangling someone's
 *     script or mispronouncing it to a screen reader would defeat the point.
 */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  setProps(node, props);
  append(node, children);
  return node;
}

function setProps(node, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'auto') {
      node.setAttribute('dir', 'auto');
      node.textContent = String(value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline text with automatic direction, for use inside a sentence. */
export function bdi(text, lang) {
  return el('bdi', { auto: text, lang });
}

/** A block of text with automatic direction. */
export function block(tag, text, props = {}) {
  return el(tag, { ...props, auto: text });
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export function langName(tag) {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }).of(tag) || tag;
  } catch {
    return tag;
  }
}

export function languageText(tag) {
  const name = langName(tag);
  return name === tag ? tag : `${name} (${tag})`;
}

export function langChip(tag) {
  return el('span', { class: 'lang', title: `${langName(tag)} (${tag})`, text: tag });
}

/** A definition list, skipping empty values. */
export function definitionList(pairs, className = 'defs') {
  const dl = el('dl', { class: className });
  for (const [term, value] of pairs) {
    if (value === null || value === undefined || value === '') continue;
    dl.append(el('dt', { text: term }), el('dd', { auto: String(value) }));
  }
  return dl;
}

/** Download a string as a file, entirely client-side. */
export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Clipboard with an honest failure path: no secure context, no clipboard. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, text };
  }
}
