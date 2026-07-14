'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { SaxParser } from '../src/index.js';
import { EntitiesValueParser } from '@nodable/base-output-builder';

test('onText decodes named entities by default', () => {
  let text;
  const parser = new SaxParser({ onText: (t) => { text = t; } });
  parser.parse('<msg>Tom &amp; Jerry</msg>');
  assert.equal(text, 'Tom & Jerry');
});

test('onText decodes numeric decimal and hex entities by default', () => {
  let text;
  const parser = new SaxParser({ onText: (t) => { text = t; } });
  parser.parse('<msg>&#60;tag&#x3E;</msg>');
  assert.equal(text, '<tag>');
});

test('onAttribute decodes entities by default', () => {
  const attrs = {};
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onAttribute: (name, value) => { attrs[name] = value; },
  });
  parser.parse('<root a="Tom &amp; Jerry" b="&#60;x&#62;"/>');
  assert.deepEqual(attrs, { a: 'Tom & Jerry', b: '<x>' });
});

test('attributes object passed to onStartElement is also decoded', () => {
  let attrs;
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onStartElement: (name, a) => { attrs = a; },
  });
  parser.parse('<root a="1 &amp; 2"/>');
  assert.deepEqual(attrs, { a: '1 & 2' });
});

test('onCData is never entity-decoded — CDATA is literal per spec', () => {
  let cdata;
  const parser = new SaxParser({ onCData: (t) => { cdata = t; } });
  parser.parse('<root><![CDATA[Tom &amp; Jerry &#60;raw&#62;]]></root>');
  assert.equal(cdata, 'Tom &amp; Jerry &#60;raw&#62;');
});

test('onStopNode raw content is never entity-decoded', () => {
  let raw;
  const parser = new SaxParser({
    fxpOptions: { tags: { stopNodes: ['..script'] } },
    onStopNode: (tagDetail, rawContent) => { raw = rawContent; },
  });
  parser.parse('<root><script>if (a &amp;&amp; b) {}</script></root>');
  assert.equal(raw, 'if (a &amp;&amp; b) {}');
});

test('onText does not fire for stop-node content, so no decoding happens there either', () => {
  const textEvents = [];
  const parser = new SaxParser({
    fxpOptions: { tags: { stopNodes: ['..script'] } },
    onText: (t) => textEvents.push(t),
  });
  parser.parse('<root><script>a &amp; b</script></root>');
  assert.deepEqual(textEvents, []);
});

test('DOCTYPE-declared entities resolve in onText', () => {
  let text;
  const parser = new SaxParser({
    fxpOptions: { doctypeOptions: { enabled: true } },
    onText: (t) => { text = t; },
  });
  parser.parse('<!DOCTYPE root [<!ENTITY foo "bar">]><root>&foo; &amp;</root>');
  assert.equal(text, 'bar &');
});

test('onDocType still fires with the raw entity map, independent of decoding', () => {
  let entities;
  const parser = new SaxParser({
    fxpOptions: { doctypeOptions: { enabled: true } },
    onDocType: (e) => { entities = e; },
  });
  parser.parse('<!DOCTYPE root [<!ENTITY foo "bar">]><root>x</root>');
  assert.ok('foo' in entities);
});

test('xml declaration version feeds the entity parser (does not throw, decodes normally)', () => {
  let text;
  const parser = new SaxParser({ onText: (t) => { text = t; } });
  parser.parse('<?xml version="1.1"?><root>a &amp; b</root>');
  assert.equal(text, 'a & b');
});

test('valueParsers: [] disables decoding entirely — raw entities pass through', () => {
  let text, attrValue;
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    valueParsers: { tags: [], attributes: [] },
    onText: (t) => { text = t; },
    onAttribute: (n, v) => { attrValue = v; },
  });
  parser.parse('<root a="&amp;">&amp;</root>');
  assert.equal(text, '&amp;');
  assert.equal(attrValue, '&amp;');
});

test('registerValueParser overrides the default entity parser for subsequent parses', () => {
  let text;
  const parser = new SaxParser({ onText: (t) => { text = t; } });
  // Swap in a parser that uppercases instead of decoding entities.
  parser.registerValueParser('entity', {
    parse: (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    reset: () => { },
  });
  parser.parse('<msg>tom</msg>');
  assert.equal(text, 'TOM');
});

test('registered custom EntitiesValueParser (e.g. with COMMON_HTML) is honored', () => {
  let text;
  const parser = new SaxParser({ onText: (t) => { text = t; } });
  parser.registerValueParser('entity', new EntitiesValueParser({
    namedEntities: { copy: '\u00A9' },
  }));
  parser.parse('<msg>&copy; 2026</msg>');
  assert.equal(text, '\u00A9 2026');
});

test('multiple documents through one SaxParser instance do not leak entity/version state', () => {
  const results = [];
  const parser = new SaxParser({
    fxpOptions: { doctypeOptions: { enabled: true } },
    onText: (t) => results.push(t),
  });
  parser.parse('<!DOCTYPE root [<!ENTITY foo "first">]><root>&foo;</root>');
  parser.parse('<root>&foo;</root>'); // no DOCTYPE this time — foo must not resolve
  assert.equal(results[0], 'first');
  assert.equal(results[1], '&foo;');
});