/**
 * Form controls and a tiny path accessor.
 *
 * The authoring screens mutate one plain object and re-render only the part that
 * structurally changed. Text inputs never trigger a re-render, because
 * re-rendering a form while somebody is typing in it is how you lose a
 * contributor's work and their goodwill at the same time.
 */

import { el, block, langName } from './dom.js';

// ------------------------------------------------------------ path accessors

export function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);
}

export function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((node, key) => {
    if (node[key] === undefined || node[key] === null) node[key] = {};
    return node[key];
  }, object);
  target[last] = value;
  return object;
}

/** Trim empty strings and empty arrays out of a record before export. */
export function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const pruned = pruneEmpty(item);
      if (pruned !== undefined && pruned !== '') result[key] = pruned;
    }
    return Object.keys(result).length ? result : undefined;
  }
  if (value === '' || value === null) return undefined;
  return value;
}

// -------------------------------------------------------------------- fields

export function field(label, control, { hint, id, error, className = '' } = {}) {
  return el('div', { class: `field ${className}`.trim() },
    el('label', { for: id, text: label }),
    control,
    hint ? el('p', { class: 'field-hint', text: hint }) : null,
    error ? el('p', { class: 'field-error', text: error, role: 'alert' }) : null
  );
}

export function textInput({ id, value = '', onChange, placeholder, type = 'text', dir, lang, maxlength }) {
  const input = el('input', {
    id,
    type,
    value: value ?? '',
    placeholder,
    dir,
    lang,
    maxlength,
    autocomplete: 'off',
    spellcheck: type === 'text' ? 'true' : 'false',
    on: { input: (event) => onChange(event.target.value) },
  });
  return input;
}

export function textArea({ id, value = '', onChange, rows = 4, dir, lang, placeholder }) {
  return el('textarea', {
    id,
    rows,
    dir,
    lang,
    placeholder,
    on: { input: (event) => onChange(event.target.value) },
    text: value ?? '',
  });
}

export function select({ id, value, options, onChange }) {
  const node = el('select', { id, on: { change: (event) => onChange(event.target.value) } });
  for (const option of options) {
    const [optionValue, label] = Array.isArray(option) ? option : [option, option];
    node.append(el('option', { value: optionValue, selected: optionValue === value, text: label }));
  }
  return node;
}

export function checkbox({ id, checked, label, onChange, hint }) {
  return el('label', { class: 'checkbox', for: id },
    el('input', {
      id,
      type: 'checkbox',
      checked,
      on: { change: (event) => onChange(event.target.checked) },
    }),
    el('span', { text: label }),
    hint ? el('span', { class: 'field-hint', text: hint }) : null
  );
}

/**
 * A repeatable block of fields.
 *
 * `renderItem(item, index, onRemove)` builds one row. Adding or removing
 * rebuilds the whole list — a structural change the user just asked for — and
 * focuses the first field of the new row so keyboard users keep their place.
 */
export function repeatable({ items, renderItem, onAdd, onRemove, addLabel = 'Add', emptyLabel = 'Nothing yet.', minimum = 0 }) {
  const list = el('div', { class: 'repeatable-list' });
  const container = el('div', { class: 'repeatable' });

  const renderList = () => {
    list.replaceChildren();
    if (!items.length) {
      list.append(el('p', { class: 'empty', text: emptyLabel }));
    } else {
      items.forEach((item, index) => {
        list.append(renderItem(item, index, () => {
          items.splice(index, 1);
          onRemove?.(index);
          renderList();
        }));
      });
    }
  };

  const addButton = el('button', {
    type: 'button',
    class: 'ghost add',
    text: typeof addLabel === 'function' ? addLabel(items.length) : addLabel,
    disabled: false,
    on: {
      click: () => {
        onAdd();
        renderList();
        const last = list.querySelector('.repeatable-item:last-child input, .repeatable-item:last-child textarea');
        last?.focus();
      },
    },
  });

  container.append(list, addButton);
  renderList();

  return { node: container, render: renderList };
}

// ------------------------------------------------------------------- display

export function findingsPanel(findings, { title = 'Problems to fix' } = {}) {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warn');

  if (!findings.length) {
    return el('div', { class: 'findings findings-clean' },
      el('p', { text: 'Nothing to fix. This validates against the same rules the build enforces.' })
    );
  }

  const list = (items) => el('ul', { class: 'finding-list' },
    items.map((finding) => el('li', {},
      el('span', { class: 'finding-path', text: finding.path || '(card)' }),
      el('span', { text: finding.message })
    ))
  );

  return el('div', { class: 'findings' },
    el('h4', { text: title }),
    errors.length ? el('div', { class: 'finding-group' },
      el('p', { class: 'finding-count finding-error', text: `${errors.length} error${errors.length === 1 ? '' : 's'} — this cannot be published` }),
      list(errors)
    ) : null,
    warnings.length ? el('div', { class: 'finding-group' },
      el('p', { class: 'finding-count finding-warn', text: `${warnings.length} warning${warnings.length === 1 ? '' : 's'} — publishable, but not finished` }),
      list(warnings)
    ) : null
  );
}

export function progressBar({ complete, missing, suggested }) {
  return el('div', { class: 'progress' },
    el('div', { class: 'progress-track' },
      el('div', { class: 'progress-fill', style: `width: ${complete}%` })
    ),
    el('p', { class: 'progress-label', text: complete >= 100 ? 'Complete, and ready for a reviewer.' : `${complete}% ready` }),
    missing.length ? el('ul', { class: 'progress-missing' }, missing.slice(0, 6).map((m) => el('li', { text: m }))) : null,
    suggested.length
      ? el('details', { class: 'progress-suggested' },
          el('summary', { text: `${suggested.length} suggestion${suggested.length === 1 ? '' : 's'} for a better card` }),
          el('ul', {}, suggested.slice(0, 8).map((s) => el('li', { text: s })))
        )
      : null
  );
}

/** A language select populated from the languages actually in use. */
export function languageSelect({ id, value, onChange, languages }) {
  const codes = [...new Set(languages)].sort();
  return el('select', { id, on: { change: (event) => onChange(event.target.value) } },
    el('option', { value: '', selected: !value, text: 'choose a language…' }),
    codes.map((code) => el('option', {
      value: code,
      selected: code === value,
      text: `${langName(code)} (${code})`,
    }))
  );
}

export function row(...children) {
  return el('div', { class: 'form-row' }, ...children);
}

export function hint(text) {
  return block('p', text, { class: 'field-hint' });
}
