'use strict';

import { SaxParser } from '../src/index.js';

const xml = `<?xml version="1.0"?>
<catalog>
  <!-- inventory snapshot -->
  <book id="bk101" inStock="true">
    <title>XML Developer's Guide</title>
    <price>44.95</price>
  </book>
  <book id="bk102" inStock="false">
    <title>Midnight Rain</title>
    <price>5.95</price>
  </book>
</catalog>`;

let depth = 0;

const parser = new SaxParser({
  fxpOptions: {
    skip: { attributes: false },
  },
  onXmlDeclaration(attrs) {
    console.log('xml decl:', attrs);
  },
  onStartElement(name, attrs, tagDetail) {
    // `this.matcher` is the read-only path matcher for the current position —
    // handlers run with `this` bound to the builder, so use a regular
    // function (not an arrow function) if you need it.
    console.log('  '.repeat(depth) + `<${name}>`, attrs, `@${tagDetail.index} (L${tagDetail.line}:C${tagDetail.col}) path=${this.matcher?.toString()}`);
    depth++;
  },
  onText(text) {
    const trimmed = text.trim();
    if (trimmed) console.log('  '.repeat(depth) + `text: "${trimmed}"`);
  },
  onComment(text) {
    console.log('  '.repeat(depth) + `comment: "${text.trim()}"`);
  },
  onEndElement(name, closeMeta) {
    depth--;
    // closeMeta.index/closeEnd are only present for a real closing tag —
    // omitted for self-closing tags, autoClose-synthesized closes, etc.
    const pos = closeMeta?.index !== undefined ? ` @${closeMeta.index}-${closeMeta.closeEnd}` : '';
    console.log('  '.repeat(depth) + `</${name}>${pos}`);
  },
  onError(err) {
    console.error('parse error:', err.message, err.code);
  },
  onEnd() {
    console.log('--- document complete ---');
    // Also readable after the fact as a property (saxes-style parity) —
    // equivalent to what onXmlDeclaration already printed above.
    console.log('parser.xmlDecl:', parser.xmlDecl);
  },
});

parser.parse(xml);