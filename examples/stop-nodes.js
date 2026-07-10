'use strict';

import { SaxParser } from '../src/index.js';

// Use stopNodes to grab a subtree's raw, unparsed XML in one shot instead of
// walking every nested tag through onStartElement/onText/onEndElement.
// Useful for huge embedded blobs (base64 payloads, SOAP envelopes, etc.)
// where you only need the raw string, not a parsed structure.

const xml = `<feed>
  <entry id="1">
    <payload><nested><deep>binary-ish-blob-content-here</deep></nested></payload>
  </entry>
</feed>`;

const parser = new SaxParser({
  fxpOptions: {
    skip: { attributes: false },
    tags: { stopNodes: ['feed.entry.payload'] },
  },
  onStartElement(name, attrs) {
    console.log('start:', name, attrs);
  },
  onStopNode(tagDetail, rawContent) {
    // rawContent is the UNPARSED inner XML — <nested><deep>...</deep></nested> —
    // FXP never tokenised it tag-by-tag, so none of the nested
    // onStartElement/onText/onEndElement events fire for it.
    console.log('stop node:', tagDetail.name, '->', rawContent);
  },
  onEndElement(name) {
    console.log('end:', name);
  },
});

parser.parse(xml);
