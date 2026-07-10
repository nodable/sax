'use strict';

const defaultOptions = {
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
