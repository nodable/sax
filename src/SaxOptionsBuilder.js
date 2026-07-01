'use strict';

/**
 * Builder-options shape for FastSaxBuilder.
 *
 * IMPORTANT: this only owns *builder*-level concerns — value parser chains
 * and the user's event-handler bag. It deliberately does NOT duplicate
 * `nameFor` / `skip` here even though the reference ParserOptionsBuilder.js
 * (from @nodable/compact-builder etc.) has those keys in its default shape.
 * In every example builder reviewed, `this.parserOptions.skip.comment`,
 * `this.parserOptions.nameFor.text`, etc. are read from PARSER options
 * (threaded through unchanged from `XMLParser` via `getInstance(parserOptions, ...)`),
 * never from builder options. Re-declaring them here would create two
 * differently-defaulted bags with the same key names — exactly the kind of
 * silent footgun worth avoiding.
 *
 * FSP's only genuinely builder-specific options are:
 *   - tags.valueParsers / attributes.valueParsers (value parser chains)
 *   - handlers (the SAX callback bag)
 */

const defaultOptions = {
  tags: {
    valueParsers: [],
  },
  attributes: {
    valueParsers: [],
  },
  handlers: {},
};

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

function copyProperties(target, source) {
  for (const key of Object.keys(source)) {
    // Guard against prototype pollution via option keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

    if (typeof source[key] === 'function') {
      target[key] = source[key];
    } else if (Array.isArray(source[key])) {
      target[key] = source[key];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      copyProperties(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

/**
 * Build the final builder-options object.
 *
 * Unlike CompactBuilder's buildOptions(), FSP's default value-parser chains
 * are EMPTY, not ['ws','entity','boolean','number']. This is a deliberate
 * performance choice: FSP is a low-level SAX parser, and most SAX consumers
 * want raw strings and do their own typing. Pass `valueParsers` explicitly
 * to opt back into FXP's entity/boolean/number coercion.
 *
 * @param {object} options - user-supplied builder options
 * @returns {object} final, deep-merged builder options
 */
export function buildOptions(options) {
  const finalOptions = deepClone(defaultOptions);

  if (options) {
    copyProperties(finalOptions, options);
  }

  return finalOptions;
}
