'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { FastSaxParser } from '../index.js';

test('emits start/text/end in document order, no tree retained', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (text) => { if (text.trim()) events.push(['text', text]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  fsp.parse('<root><a>hi</a><b>bye</b></root>');
  assert.deepEqual(events, [
    ['start', 'root'],
    ['start', 'a'],
    ['text', 'hi'],
    ['end', 'a'],
    ['start', 'b'],
    ['text', 'bye'],
    ['end', 'b'],
    ['end', 'root'],
  ]);
});

test('attributes are skipped by default (FXP default), enabled via fxpOptions.skip.attributes', () => {
  let captured = null;
  const fsp = new FastSaxParser({
    fxpOptions: { skip: { attributes: false } },
    onStartElement: (name, attrs) => { if (name === 'item') captured = attrs; },
  });
  fsp.parse('<root><item id="5" label="x"/></root>');
  assert.deepEqual(captured, { id: '5', label: 'x' });
});

test('attribute names are bare — no prefix/suffix mangling', () => {
  let captured = null;
  const fsp = new FastSaxParser({
    fxpOptions: { skip: { attributes: false } },
    onStartElement: (name, attrs) => { if (name === 'item') captured = attrs; },
  });
  fsp.parse('<root><item id="5"/></root>');
  assert.ok('id' in captured, 'expected bare key "id", got: ' + Object.keys(captured));
});

test('value parsers are empty by default — values stay raw strings', () => {
  let text = null;
  const fsp = new FastSaxParser({
    onText: (t) => { if (t.trim()) text = t; },
  });
  fsp.parse('<root><n>007</n></root>');
  assert.equal(text, '007');
  assert.equal(typeof text, 'string');
});

test('value parsers apply when explicitly requested', () => {
  let text = null;
  const fsp = new FastSaxParser({
    valueParsers: { tags: ['number'] },
    onText: (t) => { if (typeof t !== 'string' || t.trim()) text = t; },
  });
  fsp.parse('<root><n>42</n></root>');
  assert.equal(text, 42);
  assert.equal(typeof text, 'number');
});

test('CDATA fires onCData, never silently merged into onText', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onCData: (t) => events.push(['cdata', t]),
  });
  fsp.parse('<root><![CDATA[raw <stuff> here]]></root>');
  assert.deepEqual(events, [['cdata', 'raw <stuff> here']]);
});

test('XML declaration fires onXmlDeclaration, distinct from onProcessingInstruction', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onXmlDeclaration: (attrs) => events.push(['decl', attrs]),
    onProcessingInstruction: (name) => events.push(['pi', name]),
  });
  fsp.parse('<?xml version="1.0"?><?some-pi data?><root/>');
  assert.deepEqual(events, [
    ['decl', { version: 1, encoding: undefined, standalone: undefined }],
    ['pi', '?some-pi'],
  ]);
});

test('comments fire onComment and respect skip.comment', () => {
  const seen = [];
  const fsp = new FastSaxParser({
    onComment: (t) => seen.push(t),
  });
  fsp.parse('<root><!-- hello --></root>');
  assert.deepEqual(seen, [' hello ']);

  const seenSkipped = [];
  const fsp2 = new FastSaxParser({
    fxpOptions: { skip: { comment: true } },
    onComment: (t) => seenSkipped.push(t),
  });
  fsp2.parse('<root><!-- hello --></root>');
  assert.deepEqual(seenSkipped, []);
});

test('stop nodes deliver raw unparsed content and suppress nested events', () => {
  const events = [];
  const fsp = new FastSaxParser({
    fxpOptions: { tags: { stopNodes: ['root.blob'] } },
    onStartElement: (name) => events.push(['start', name]),
    onStopNode: (tagDetail, raw) => events.push(['stop', tagDetail.name, raw]),
    onEndElement: (name) => events.push(['end', name]),
  });
  fsp.parse('<root><blob><nested>x</nested></blob></root>');
  assert.deepEqual(events, [
    ['start', 'root'],
    ['start', 'blob'],
    ['stop', 'blob', '<nested>x</nested>'],
    ['end', 'blob'],
    ['end', 'root'],
  ]);
});

test('streaming write() handles chunks split mid-tag and mid-text', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  const chunks = ['<ro', 'ot><ite', 'm>hel', 'lo</item', '></root>'];
  for (const c of chunks) fsp.write(c);
  fsp.end();
  assert.deepEqual(events, [
    ['start', 'root'],
    ['start', 'item'],
    ['text', 'hello'],
    ['end', 'item'],
    ['end', 'root'],
  ]);
});

test('onEnd fires exactly once after parse completes', () => {
  let count = 0;
  const fsp = new FastSaxParser({ onEnd: () => count++ });
  fsp.parse('<root/>');
  assert.equal(count, 1);
});

test('onError receives ParseError instead of throwing when handler is supplied', () => {
  let captured = null;
  const fsp = new FastSaxParser({
    onError: (err) => { captured = err; },
  });
  fsp.parse('<root><unclosed></root>');
  assert.ok(captured, 'expected onError to be called');
});

test('parse() throws when no onError handler is supplied', () => {
  const fsp = new FastSaxParser({});
  assert.throws(() => fsp.parse('<root><unclosed></root>'));
});

test('nested elements report correct names at close, not the last-opened child name', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onEndElement: (name) => events.push(['end', name]),
  });
  fsp.parse('<a><b><c/></b></a>');
  assert.deepEqual(events, [
    ['start', 'a'], ['start', 'b'], ['start', 'c'], ['end', 'c'], ['end', 'b'], ['end', 'a'],
  ]);
});

// ─── New tests for v1.5.0 changes ────────────────────────────────────────────

test('onText does NOT fire for stop-node raw content (bug fix)', () => {
  const textEvents = [];
  const stopEvents = [];
  const fsp = new FastSaxParser({
    fxpOptions: { tags: { stopNodes: ['root.blob'] } },
    onText: (t) => textEvents.push(t),
    onStopNode: (tagDetail, raw) => stopEvents.push(raw),
  });
  fsp.parse('<root><blob><nested>x</nested></blob></root>');
  assert.deepEqual(stopEvents, ['<nested>x</nested>']);
  assert.deepEqual(textEvents, [], 'onText must not fire for stop-node content');
});

test('onAttribute fires once per attribute in document order, before onStartElement', () => {
  const attrEvents = [];
  let startFired = false;
  const fsp = new FastSaxParser({
    fxpOptions: { skip: { attributes: false } },
    onAttribute: (name, value) => {
      assert.ok(!startFired, 'onAttribute must fire before onStartElement');
      attrEvents.push([name, value]);
    },
    onStartElement: () => { startFired = true; },
  });
  fsp.parse('<root id="1" class="main"/>');
  assert.deepEqual(attrEvents, [['id', '1'], ['class', 'main']]);
});

test('onAttribute receives attrMeta as 3rd arg with absolute document index', () => {
  // <root id="1" name="x"/>
  //       ^ id at 6     ^ name at 13
  const metas = {};
  const fsp = new FastSaxParser({
    fxpOptions: { skip: { attributes: false } },
    onAttribute: (name, value, meta) => { metas[name] = meta; },
  });
  fsp.parse('<root id="1" name="x"/>');
  assert.equal(metas.id?.index, 6);
  assert.equal(metas.name?.index, 13);
});

test('onStartElement receives tagDetail as 3rd arg with index pointing at <', () => {
  // <root><child>x</child></root>
  //  ^0    ^6
  const tags = {};
  const fsp = new FastSaxParser({
    onStartElement: (name, attrs, tag) => { tags[name] = tag; },
  });
  fsp.parse('<root><child>x</child></root>');
  assert.equal(tags.root.index, 0);
  assert.equal(tags.root.line, 1);
  assert.equal(tags.root.col, 0);
  assert.equal(tags.child.index, 6);
});

test('tagDetail.openEnd points right after the opening tag >', () => {
  // <root> = 6 chars, so openEnd = 6
  // <child> = 7 chars, starts at 6, so openEnd = 13
  const tags = {};
  const fsp = new FastSaxParser({
    onStartElement: (name, attrs, tag) => { tags[name] = tag; },
  });
  fsp.parse('<root><child>x</child></root>');
  assert.equal(tags.root.openEnd, 6);
  assert.equal(tags.child.openEnd, 13);
});

test('onEndElement receives closeMeta as 2nd arg with name always present', () => {
  const closes = [];
  const fsp = new FastSaxParser({
    onEndElement: (name, closeMeta) => closes.push({ name, metaName: closeMeta?.name }),
  });
  fsp.parse('<root><a>1</a><b>2</b></root>');
  // name arg and closeMeta.name must always agree
  for (const c of closes) {
    assert.equal(c.name, c.metaName);
  }
  assert.deepEqual(closes.map(c => c.name), ['a', 'b', 'root']);
});

test('closeMeta carries index and closeEnd for a real closing tag', () => {
  // <root><tag>v</tag></root>
  //             ^ </tag> starts at 12, ends at 18
  const closes = {};
  const fsp = new FastSaxParser({
    onEndElement: (name, closeMeta) => { closes[name] = closeMeta; },
  });
  fsp.parse('<root><tag>v</tag></root>');
  assert.equal(closes.tag.index, 12);
  assert.equal(closes.tag.closeEnd, 18);
});

test('closeMeta for a self-closing tag reuses the opening tag position, no separate close', () => {
  // <root><item/></root> — <item/> at index 6, length 7, so closeEnd = 13
  const closes = {};
  const fsp = new FastSaxParser({
    onEndElement: (name, closeMeta) => { closes[name] = closeMeta; },
  });
  fsp.parse('<root><item/></root>');
  assert.equal(closes.item.index, 6);
  assert.equal(closes.item.closeEnd, 13);
});

test('onStopNode receives stopEnd as 3rd arg pointing right after the closing tag', () => {
  // <root><script>x</script></root>
  //                         ^ stopEnd.index = len('<root><script>x</script>') = 24
  let stopEnd = null;
  const fsp = new FastSaxParser({
    fxpOptions: { tags: { stopNodes: ['root.script'] } },
    onStopNode: (tagDetail, raw, end) => { stopEnd = end; },
  });
  fsp.parse('<root><script>x</script></root>');
  const expected = '<root><script>x</script>'.length;
  assert.equal(stopEnd?.index, expected);
});

test('handlers can read this.matcher (builder-bound, not passed positionally)', () => {
  const matchers = [];
  const fsp = new FastSaxParser({
    onStartElement(name) { matchers.push([name, this.matcher]); },
  });
  fsp.parse('<root><child/></root>');
  assert.equal(matchers.length, 2);
  for (const [, m] of matchers) {
    assert.ok(m, 'this.matcher should be defined inside a non-arrow handler');
  }
});

test('write() becomes a no-op after a parse error, end() surfaces the dead session clearly', () => {
  const errors = [];
  const fsp = new FastSaxParser({
    fxpOptions: { feedable: { bufferSize: 1 } }, // force write() to parse immediately
    onError: (err) => errors.push(err.message),
  });
  fsp.write('<root><a></b>'); // mismatched closing tag — throws synchronously
  // session is now errored — further write() is silently dropped
  fsp.write('<more/>');
  fsp.end(); // must call onError, not throw
  assert.equal(errors.length, 2); // parse error + dead-session error from end()
});

test('a new FastSaxParser instance works normally after a previous one errored', () => {
  const fsp1 = new FastSaxParser({
    fxpOptions: { feedable: { bufferSize: 1 } },
    onError: () => { },
  });
  fsp1.write('<root><a></b>');
  fsp1.end();

  // fresh instance — completely independent
  const events = [];
  const fsp2 = new FastSaxParser({
    onStartElement: (name) => events.push(name),
  });
  fsp2.parse('<root/>');
  assert.deepEqual(events, ['root']);
});

// ─── parseBytesArr() ──────────────────────────────────────────────────────

test('parseBytesArr() parses a Uint8Array the same as parse() parses its string source', () => {
  const events = [];
  const fsp = new FastSaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  const bytes = new Uint8Array(Buffer.from('<root><tag>hello 世界</tag></root>'));
  fsp.parseBytesArr(bytes);
  assert.deepEqual(events, [
    ['start', 'root'],
    ['start', 'tag'],
    ['text', 'hello 世界'],
    ['end', 'tag'],
    ['end', 'root'],
  ]);
});

test('parseBytesArr() routes errors through onError like parse() does', () => {
  let captured = null;
  const fsp = new FastSaxParser({
    onError: (err) => { captured = err; },
  });
  const bytes = new Uint8Array(Buffer.from('<root><unclosed></root>'));
  fsp.parseBytesArr(bytes);
  assert.ok(captured, 'expected onError to be called');
});

// ─── xmlDecl (saxes-style parity property) ───────────────────────────────

test('xmlDecl stays empty until the XML declaration is seen', () => {
  const fsp = new FastSaxParser();
  assert.deepEqual(fsp.xmlDecl, {});
  fsp.parse('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>');
  assert.deepEqual(fsp.xmlDecl, { version: 1, encoding: 'UTF-8', standalone: 'yes' });
});

test('xmlDecl fields stay undefined for fields absent from the declaration', () => {
  const fsp = new FastSaxParser();
  fsp.parse('<?xml version="1.0"?><root/>');
  assert.equal(fsp.xmlDecl.version, 1);
  assert.equal(fsp.xmlDecl.encoding, undefined);
  assert.equal(fsp.xmlDecl.standalone, undefined);
});

test('xmlDecl is populated regardless of skip.attributes (declaration bypasses the attribute pipeline)', () => {
  const withSkip = new FastSaxParser({ fxpOptions: { skip: { attributes: true } } });
  withSkip.parse('<?xml version="1.0" encoding="UTF-8"?><root/>');
  assert.equal(withSkip.xmlDecl.version, 1);
  assert.equal(withSkip.xmlDecl.encoding, 'UTF-8');

  const withoutSkip = new FastSaxParser({ fxpOptions: { skip: { attributes: false } } });
  withoutSkip.parse('<?xml version="1.0" encoding="UTF-8"?><root/>');
  assert.deepEqual(withoutSkip.xmlDecl, withSkip.xmlDecl);
});

test('user-supplied onXmlDeclaration still fires alongside xmlDecl population', () => {
  let calledWith = null;
  const fsp = new FastSaxParser({
    onXmlDeclaration: (attrs) => { calledWith = attrs; },
  });
  fsp.parse('<?xml version="1.0"?><root/>');
  assert.deepEqual(calledWith, { version: 1, encoding: undefined, standalone: undefined });
  assert.equal(fsp.xmlDecl.version, 1);
});