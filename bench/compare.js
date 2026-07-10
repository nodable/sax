/**
 * Benchmark: @nodable/sax vs sax vs saxes
 *
 * Measures wall-clock time for N iterations of a full parse, across varied
 * document shapes (flat/attribute-heavy/deep/mixed).
 *
 * NOTE on text event counts: FSP skips whitespace-only text runs by default
 * (FXP's `skip.whitespaceText: true`), so its `texts` count will be lower
 * than sax/saxes which fire for every whitespace run between tags. This is
 * expected and correct — time measurements are the comparable metric.
 *
 * Run:  node bench/compare.js
 */

import { performance } from 'perf_hooks';
import sax from 'sax';
import { SaxesParser } from 'saxes';
import { SaxParser } from '../src/index.js';
import { makeFlat, makeDeep, makeMixed, makeSvg, loadXml } from './fixtures.js';

global.attempts = 0;
// ─── Config ──────────────────────────────────────────────────────────────────

const WARMUP = 50;   // iterations to discard
const ITERS = 500;  // measured iterations

// ─── Parser factories ─────────────────────────────────────────────────────────

function makeNodableSax() {
  // Mirrors realistic usage: start/text/end handlers only, no valueParsers
  // (empty chains = fast path). skip.attributes: false to parse element attrs.
  let starts = 0, texts = 0, ends = 0;
  const p = new SaxParser({
    fxpOptions: {
      onDangerousProperty: false,
      sanitizeNames: false,
      skip: {
        attributes: false,
        nsPrefix: false,
        whitespaceText: false
      },
      attributes: {
        booleanType: false,
      }
      // tags: { unpaired: ['br'] } 
    },
    onStartElement() { starts++; },
    onText() { texts++; },
    onEndElement() { ends++; },
  });
  return { name: '@nodable/sax', parse: (xml) => p.parse(xml), counts: () => ({ starts, texts, ends }) };
}

function makeSax() {
  // sax is stateful — a parser instance accumulates across write() calls.
  // For fair comparison (each iteration parses a complete fresh document)
  // we create a new instance per iteration, matching how FSP and saxes work.
  let starts = 0, texts = 0, ends = 0;
  function parse(xml) {
    const p = sax.parser(true /* strict */);
    p.onopentag = () => starts++;
    p.ontext = () => texts++;
    p.onclosetag = () => ends++;
    p.write(xml).close();
  }
  return { name: 'sax', parse, counts: () => ({ starts, texts, ends }) };
}

function makeSaxes() {
  // saxes strict-XML mode (default — no fragment, no xmlns)
  let starts = 0, texts = 0, ends = 0;
  const p = new SaxesParser();
  p.on('opentag', () => starts++);
  p.on('text', () => texts++);
  p.on('closetag', () => ends++);
  p.on('error', () => { });
  p.on('cdata', () => { });
  p.on('comment', () => { });
  return {
    name: 'saxes',
    parse: (xml) => { p.write(xml); p.close(); },
    counts: () => ({ starts, texts, ends }),
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────


function bench(label, xml, parsers) {
  const kbSize = (Buffer.byteLength(xml, 'utf8') / 1024).toFixed(1);
  console.log(`\n── ${label}  (${kbSize} KB, ${ITERS} iters) ──`);

  for (const { name, parse, counts } of parsers) {
    // Warmup
    for (let i = 0; i < WARMUP; i++) parse(xml);

    const t0 = performance.now();
    for (let i = 0; i < ITERS; i++) parse(xml);
    const elapsed = performance.now() - t0;

    const perIter = (elapsed / ITERS).toFixed(3);
    const throughput = ((Buffer.byteLength(xml, 'utf8') * ITERS) / (elapsed / 1000) / 1e6).toFixed(1);
    console.log(`  ${name.padEnd(20)} ${String(elapsed.toFixed(1)).padStart(7)} ms total  ${perIter.padStart(7)} ms/iter  ${throughput.padStart(6)} MB/s   counts:`, counts());
  }
}

// ─── Suites ───────────────────────────────────────────────────────────────────

console.log(`Node ${process.version}   warmup=${WARMUP}   measured=${ITERS}`);


bench(
  'mini-sample.xml',
  loadXml(),
  [makeSaxes(), makeNodableSax(), makeSax()],
);

// Flat: many siblings, each with 2 attrs and text — bread-and-butter feed
bench(
  'Flat 500 elements (2 attrs + text each)',
  makeFlat(500, 2),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// Flat large: stress higher element counts
bench(
  'Flat 2000 elements (2 attrs + text each)',
  makeFlat(2000, 2),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// Flat attribute-heavy: more attribute work per element
bench(
  'Flat 500 elements (8 attrs + text each)',
  makeFlat(500, 8),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// Deep: stresses push/pop state, not element count
bench(
  'Deep nesting depth=10 breadth=2',
  makeDeep(10, 2),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// Mixed: comments, CDATA, PIs alongside elements, plus unpaired <br> tags

console.log("SAX and SAXES doesn't support unpaired tags")
bench(
  'Mixed 300 elements (comments + CDATA)',
  makeMixed(300),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// SVG-shaped: xmlns, deep <g> nesting, long `d` attribute values
bench(
  'SVG 300 paths (depth=4, pathLength=40)',
  makeSvg(300, 4, 40),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

// SVG stress: fewer paths but much longer `d` values — isolates
// AttributeProcessor's per-char scan cost from element/tag dispatch cost
bench(
  'SVG 50 paths, very long d attrs (pathLength=500)',
  makeSvg(50, 4, 500),
  [makeNodableSax(), makeSaxes(), makeSax()],
);

bench(
  'SVG 50 paths, very long d attrs (pathLength=500)',
  makeSvg(50, 4, 500),
  [makeSaxes(), makeNodableSax(), makeSax()],
);


