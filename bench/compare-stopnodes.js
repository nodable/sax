'use strict';

import sax from 'sax';
import { FastSaxParser } from '../index.js';

// Scenario: a feed of records, each wrapping a large opaque blob (e.g. base64
// payload) the consumer does NOT need parsed — only the top-level metadata.
// This is the scenario FSP's stopNodes are actually for.

function buildXml(n, blobDepth) {
  let blob = 'x';
  for (let i = 0; i < blobDepth; i++) blob = `<level${i}>${blob}</level${i}>`;

  let s = '<root>';
  for (let i = 0; i < n; i++) {
    s += `<record id="${i}"><meta>info-${i}</meta><payload>${blob}</payload></record>`;
  }
  s += '</root>';
  return s;
}

function runFspWithStopNode(xml) {
  let metaCount = 0, stopNodeCount = 0;
  const fsp = new FastSaxParser({
    fxpOptions: {
      skip: { attributes: false },
      tags: { stopNodes: ['root.record.payload'] },
    },
    onStartElement: (name) => { if (name === 'meta') metaCount++; },
    onStopNode: () => stopNodeCount++,
  });
  fsp.parse(xml);
  return { metaCount, stopNodeCount };
}

function runSaxIgnoringPayload(xml) {
  // sax has no stop-node concept — the best a consumer can do is still walk
  // every token inside <payload> and discard it in the handler.
  let metaCount = 0, insidePayload = 0;
  const parser = sax.parser(true);
  parser.onopentag = (node) => {
    if (node.name === 'payload') insidePayload++;
    else if (node.name.startsWith('level')) insidePayload++;
    else if (node.name === 'meta' && insidePayload === 0) metaCount++;
  };
  parser.onclosetag = (name) => {
    if (name === 'payload' || name.startsWith('level')) insidePayload--;
  };
  parser.write(xml).close();
  return { metaCount };
}

function bench(label, fn, iterations) {
  for (let i = 0; i < Math.min(3, iterations); i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)}ms total, ${(ms / iterations).toFixed(3)}ms/iter`);
  return ms;
}

const n = 500;
const blobDepth = 40; // 40 nested levels per record's payload — deliberately deep
const xml = buildXml(n, blobDepth);
const iterations = 20;

console.log(`${n} records, ${blobDepth} levels of nesting per payload (${(xml.length / 1024).toFixed(0)} KB)\n`);

const fspResult = runFspWithStopNode(xml);
const saxResult = runSaxIgnoringPayload(xml);
console.log('FSP:', fspResult);
console.log('sax:', saxResult);

const fspMs = bench('fast-sax-parser (stopNodes)', () => runFspWithStopNode(xml), iterations);
const saxMs = bench('sax (manual skip)         ', () => runSaxIgnoringPayload(xml), iterations);

console.log(`\nFSP is ${(saxMs / fspMs).toFixed(2)}x faster than sax when skipping deep subtrees via stopNodes`);
