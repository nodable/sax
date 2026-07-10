'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { SaxParser } from '../src/index.js';

test('emits start/text/end in document order, no tree retained', () => {
  const events = [];
  const parser = new SaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (text) => { if (text.trim()) events.push(['text', text]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  parser.parse('<root><a>hi</a><b>bye</b></root>');
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
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onStartElement: (name, attrs) => { if (name === 'item') captured = attrs; },
  });
  parser.parse('<root><item id="5" label="x"/></root>');
  assert.deepEqual(captured, { id: '5', label: 'x' });
});

test('attribute names are bare — no prefix/suffix mangling', () => {
  let captured = null;
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onStartElement: (name, attrs) => { if (name === 'item') captured = attrs; },
  });
  parser.parse('<root><item id="5"/></root>');
  assert.ok('id' in captured, 'expected bare key "id", got: ' + Object.keys(captured));
});

test('CDATA fires onCData, never silently merged into onText', () => {
  const events = [];
  const parser = new SaxParser({
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onCData: (t) => events.push(['cdata', t]),
  });
  parser.parse('<root><![CDATA[raw <stuff> here]]></root>');
  assert.deepEqual(events, [['cdata', 'raw <stuff> here']]);
});

test('XML declaration fires onXmlDeclaration, distinct from onProcessingInstruction', () => {
  const events = [];
  const parser = new SaxParser({
    onXmlDeclaration: (attrs) => events.push(['decl', attrs]),
    onProcessingInstruction: (name) => events.push(['pi', name]),
  });
  parser.parse('<?xml version="1.0"?><?some-pi data?><root/>');
  assert.deepEqual(events, [
    ['decl', { version: 1, encoding: undefined, standalone: undefined }],
    ['pi', '?some-pi'],
  ]);
});

test('comments fire onComment and respect skip.comment', () => {
  const seen = [];
  const parser = new SaxParser({
    onComment: (t) => seen.push(t),
  });
  parser.parse('<root><!-- hello --></root>');
  assert.deepEqual(seen, [' hello ']);

  const seenSkipped = [];
  const parser2 = new SaxParser({
    fxpOptions: { skip: { comment: true } },
    onComment: (t) => seenSkipped.push(t),
  });
  parser2.parse('<root><!-- hello --></root>');
  assert.deepEqual(seenSkipped, []);
});

test('stop nodes deliver raw unparsed content and suppress nested events', () => {
  const events = [];
  const parser = new SaxParser({
    fxpOptions: { tags: { stopNodes: ['root.blob'] } },
    onStartElement: (name) => events.push(['start', name]),
    onStopNode: (tagDetail, raw) => events.push(['stop', tagDetail.name, raw]),
    onEndElement: (name) => events.push(['end', name]),
  });
  parser.parse('<root><blob><nested>x</nested></blob></root>');
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
  const parser = new SaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  const chunks = ['<ro', 'ot><ite', 'm>hel', 'lo</item', '></root>'];
  for (const c of chunks) parser.write(c);
  parser.end();
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
  const parser = new SaxParser({ onEnd: () => count++ });
  parser.parse('<root/>');
  assert.equal(count, 1);
});

test('onError receives ParseError instead of throwing when handler is supplied', () => {
  let captured = null;
  const parser = new SaxParser({
    onError: (err) => { captured = err; },
  });
  parser.parse('<root><unclosed></root>');
  assert.ok(captured, 'expected onError to be called');
});

test('parse() throws when no onError handler is supplied', () => {
  const parser = new SaxParser({});
  assert.throws(() => parser.parse('<root><unclosed></root>'));
});

test('nested elements report correct names at close, not the last-opened child name', () => {
  const events = [];
  const parser = new SaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onEndElement: (name) => events.push(['end', name]),
  });
  parser.parse('<a><b><c/></b></a>');
  assert.deepEqual(events, [
    ['start', 'a'], ['start', 'b'], ['start', 'c'], ['end', 'c'], ['end', 'b'], ['end', 'a'],
  ]);
});

// ─── New tests for v1.5.0 changes ────────────────────────────────────────────

test('onText does NOT fire for stop-node raw content (bug fix)', () => {
  const textEvents = [];
  const stopEvents = [];
  const parser = new SaxParser({
    fxpOptions: { tags: { stopNodes: ['root.blob'] } },
    onText: (t) => textEvents.push(t),
    onStopNode: (tagDetail, raw) => stopEvents.push(raw),
  });
  parser.parse('<root><blob><nested>x</nested></blob></root>');
  assert.deepEqual(stopEvents, ['<nested>x</nested>']);
  assert.deepEqual(textEvents, [], 'onText must not fire for stop-node content');
});

test('onAttribute fires once per attribute in document order, before onStartElement', () => {
  const attrEvents = [];
  let startFired = false;
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onAttribute: (name, value) => {
      assert.ok(!startFired, 'onAttribute must fire before onStartElement');
      attrEvents.push([name, value]);
    },
    onStartElement: () => { startFired = true; },
  });
  parser.parse('<root id="1" class="main"/>');
  assert.deepEqual(attrEvents, [['id', '1'], ['class', 'main']]);
});

test('onAttribute receives attrMeta as 3rd arg with absolute document index', () => {
  // <root id="1" name="x"/>
  //       ^ id at 6     ^ name at 13
  const metas = {};
  const parser = new SaxParser({
    fxpOptions: { skip: { attributes: false } },
    onAttribute: (name, value, meta) => { metas[name] = meta; },
  });
  parser.parse('<root id="1" name="x"/>');
  assert.equal(metas.id?.index, 6);
  assert.equal(metas.name?.index, 13);
});

test('onStartElement receives tagDetail as 3rd arg with index pointing at <', () => {
  // <root><child>x</child></root>
  //  ^0    ^6
  const tags = {};
  const parser = new SaxParser({
    onStartElement: (name, attrs, tag) => { tags[name] = tag; },
  });
  parser.parse('<root><child>x</child></root>');
  assert.equal(tags.root.index, 0);
  assert.equal(tags.child.index, 6);
});

test('tagDetail.openEnd points right after the opening tag >', () => {
  // <root> = 6 chars, so openEnd = 6
  // <child> = 7 chars, starts at 6, so openEnd = 13
  const tags = {};
  const parser = new SaxParser({
    onStartElement: (name, attrs, tag) => { tags[name] = tag; },
  });
  parser.parse('<root><child>x</child></root>');
  assert.equal(tags.root.openEnd, 6);
  assert.equal(tags.child.openEnd, 13);
});

test('onEndElement receives closeMeta as 2nd arg with name always present', () => {
  const closes = [];
  const parser = new SaxParser({
    onEndElement: (name, closeMeta) => closes.push({ name, metaName: closeMeta?.name }),
  });
  parser.parse('<root><a>1</a><b>2</b></root>');
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
  const parser = new SaxParser({
    onEndElement: (name, closeMeta) => { closes[name] = closeMeta; },
  });
  parser.parse('<root><tag>v</tag></root>');
  assert.equal(closes.tag.index, 12);
  assert.equal(closes.tag.closeEnd, 18);
});

test('closeMeta for a self-closing tag reuses the opening tag position, no separate close', () => {
  // <root><item/></root> — <item/> at index 6, length 7, so closeEnd = 13
  const closes = {};
  const parser = new SaxParser({
    onEndElement: (name, closeMeta) => { closes[name] = closeMeta; },
  });
  parser.parse('<root><item/></root>');
  assert.equal(closes.item.index, 6);
  assert.equal(closes.item.closeEnd, 13);
});

test('onStopNode receives stopEnd as 3rd arg pointing right after the closing tag', () => {
  // <root><script>x</script></root>
  //                         ^ stopEnd.index = len('<root><script>x</script>') = 24
  let stopEnd = null;
  const parser = new SaxParser({
    fxpOptions: { tags: { stopNodes: ['root.script'] } },
    onStopNode: (tagDetail, raw, end) => { stopEnd = end; },
  });
  parser.parse('<root><script>x</script></root>');
  const expected = '<root><script>x</script>'.length;
  assert.equal(stopEnd?.index, expected);
});

test('handlers can read this.matcher (builder-bound, not passed positionally)', () => {
  const matchers = [];
  const parser = new SaxParser({
    onStartElement(name) { matchers.push([name, this.matcher]); },
  });
  parser.parse('<root><child/></root>');
  assert.equal(matchers.length, 2);
  for (const [, m] of matchers) {
    assert.ok(m, 'this.matcher should be defined inside a non-arrow handler');
  }
});

test('write() becomes a no-op after a parse error, end() surfaces the dead session clearly', () => {
  const errors = [];
  const parser = new SaxParser({
    fxpOptions: { feedable: { bufferSize: 1 } }, // force write() to parse immediately
    onError: (err) => errors.push(err.message),
  });
  parser.write('<root><a></b>'); // mismatched closing tag — throws synchronously
  // session is now errored — further write() is silently dropped
  parser.write('<more/>');
  parser.end(); // must call onError, not throw
  assert.equal(errors.length, 2); // parse error + dead-session error from end()
});

test('a new SaxParser instance works normally after a previous one errored', () => {
  const parser1 = new SaxParser({
    fxpOptions: { feedable: { bufferSize: 1 } },
    onError: () => { },
  });
  parser1.write('<root><a></b>');
  parser1.end();

  // fresh instance — completely independent
  const events = [];
  const parser2 = new SaxParser({
    onStartElement: (name) => events.push(name),
  });
  parser2.parse('<root/>');
  assert.deepEqual(events, ['root']);
});

// ─── parseBytesArr() ──────────────────────────────────────────────────────

test('parseBytesArr() parses a Uint8Array the same as parse() parses its string source', () => {
  const events = [];
  const parser = new SaxParser({
    onStartElement: (name) => events.push(['start', name]),
    onText: (t) => { if (t.trim()) events.push(['text', t]); },
    onEndElement: (name) => events.push(['end', name]),
  });
  const bytes = new Uint8Array(Buffer.from('<root><tag>hello 世界</tag></root>'));
  parser.parseBytesArr(bytes);
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
  const parser = new SaxParser({
    onError: (err) => { captured = err; },
  });
  const bytes = new Uint8Array(Buffer.from('<root><unclosed></root>'));
  parser.parseBytesArr(bytes);
  assert.ok(captured, 'expected onError to be called');
});

// ─── xmlDecl (saxes-style parity property) ───────────────────────────────

test('xmlDecl stays empty until the XML declaration is seen', () => {
  const parser = new SaxParser();
  assert.deepEqual(parser.xmlDecl, {});
  parser.parse('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>');
  assert.deepEqual(parser.xmlDecl, { version: 1, encoding: 'UTF-8', standalone: 'yes' });
});

test('xmlDecl fields stay undefined for fields absent from the declaration', () => {
  const parser = new SaxParser();
  parser.parse('<?xml version="1.0"?><root/>');
  assert.equal(parser.xmlDecl.version, 1);
  assert.equal(parser.xmlDecl.encoding, undefined);
  assert.equal(parser.xmlDecl.standalone, undefined);
});

test('xmlDecl is populated regardless of skip.attributes (declaration bypasses the attribute pipeline)', () => {
  const withSkip = new SaxParser({ fxpOptions: { skip: { attributes: true } } });
  withSkip.parse('<?xml version="1.0" encoding="UTF-8"?><root/>');
  assert.equal(withSkip.xmlDecl.version, 1);
  assert.equal(withSkip.xmlDecl.encoding, 'UTF-8');

  const withoutSkip = new SaxParser({ fxpOptions: { skip: { attributes: false } } });
  withoutSkip.parse('<?xml version="1.0" encoding="UTF-8"?><root/>');
  assert.deepEqual(withoutSkip.xmlDecl, withSkip.xmlDecl);
});

test('user-supplied onXmlDeclaration still fires alongside xmlDecl population', () => {
  let calledWith = null;
  const parser = new SaxParser({
    onXmlDeclaration: (attrs) => { calledWith = attrs; },
  });
  parser.parse('<?xml version="1.0"?><root/>');
  assert.deepEqual(calledWith, { version: 1, encoding: undefined, standalone: undefined });
  assert.equal(parser.xmlDecl.version, 1);
});

// ─── asWritable() ────────────────────────────────────────────────────────

test('asWritable: piping a stream produces the same text as one-shot parse', async () => {
  const { Readable } = await import('node:stream');
  const { finished } = await import('node:stream/promises');

  let text = '';
  const parser = new SaxParser({ onText: (t) => { text += t; } });
  const xml = '<root>hello world</root>';

  const readable = Readable.from([xml], { objectMode: false });
  const writable = parser.asWritable();
  readable.pipe(writable);
  await finished(writable);

  assert.equal(text, 'hello world');
});

test('asWritable: a multi-byte character split across two stream chunks is not corrupted', async () => {
  const { Readable, Writable } = await import('node:stream');
  const { finished } = await import('node:stream/promises');

  // '日本語' is 9 bytes in UTF-8 (3 bytes per character). Splitting the raw
  // bytes at offset 4 cuts the second character in half. If asWritable()
  // ever re-introduces a per-chunk `chunk.toString('utf8')` before handing
  // data to the parser, this half-character gets replaced with U+FFFD
  // independently in each chunk and the text comes out corrupted.
  const xml = '<root>日本語</root>';
  const bytes = Buffer.from(xml, 'utf8');
  const splitAt = xml.indexOf('日本語');
  const byteOffset = Buffer.byteLength(xml.slice(0, splitAt), 'utf8') + 4; // mid-character

  const chunk1 = bytes.subarray(0, byteOffset);
  const chunk2 = bytes.subarray(byteOffset);

  let text = '';
  const parser = new SaxParser({ onText: (t) => { text += t; } });
  const writable = parser.asWritable();

  const source = Readable.from([chunk1, chunk2], { objectMode: true });
  source.pipe(writable);
  await finished(writable);

  assert.equal(text, '日本語');
});