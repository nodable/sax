'use strict';

import { SaxParser } from '../src/index.js';

// Deliberately split mid-tag and mid-text to demonstrate FXP's chunk-boundary
// safety — FSP doesn't need any extra logic for this, it's inherited for free.
const chunks = [
  '<root><ite',
  'm id="1">hel',
  'lo wor',
  'ld</item><item id="2"',
  '>second</item></root>',
];

const parser = new SaxParser({
  fxpOptions: {
    skip: { attributes: false },
  },
  onStartElement(name, attrs) {
    console.log('start:', name, attrs);
  },
  onText(text) {
    if (text.trim()) console.log('text:', JSON.stringify(text));
  },
  onEndElement(name) {
    console.log('end:', name);
  },
  onEnd() {
    console.log('--- stream complete ---');
  },
});

for (const chunk of chunks) {
  parser.write(chunk);
}
parser.end();
