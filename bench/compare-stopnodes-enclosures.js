/**
 * Benchmark: StopNodeProcessor's enclosure-skip strategies specifically.
 *
 * compare-stopnodes.js only exercises _collectDepthOnly (nested same-name
 * tags, no skipEnclosures) — that fixture's <payload> blobs never contain a
 * skipEnclosures marker, so _collectEnclosureOnly / _collectFull never run.
 * This file targets those two directly using script-shaped content that
 * contains '<'/'>' inside string literals — the actual scenario
 * skipEnclosures exists for (per StopNodeProcessor.js's own docs/quoteEnclosures).
 *
 * Run: node bench/compare-stopnodes-enclosures.js
 */

import sax from 'sax';
import { FastSaxParser } from '../index.js';
import { quoteEnclosures } from '@nodable/flexible-xml-parser';
import { makeHtmlWithScripts } from './fixtures.js';

function runFspPlainStopNode(xml) {
  // nested:false, no skipEnclosures — _collectPlain. First </script> wins,
  // even one embedded inside a string literal in the script body (which
  // this fixture's body doesn't contain, so it's still "correct" here —
  // included only as the baseline to compare enclosure-skip cost against).
  let scriptCount = 0;
  const fsp = new FastSaxParser({
    fxpOptions: { tags: { stopNodes: ['html.body.script'] } },
    onStopNode: () => scriptCount++,
  });
  fsp.parse(xml);
  return { scriptCount };
}

function runFspEnclosureStopNode(xml) {
  // nested:false, skipEnclosures: quoteEnclosures — _collectEnclosureOnly.
  // Correctly skips over the '<'/'>' inside quoted string literals in the
  // script body rather than treating them as tag-like content.
  let scriptCount = 0;
  const fsp = new FastSaxParser({
    fxpOptions: {
      tags: {
        stopNodes: [{ expression: 'html.body.script', skipEnclosures: quoteEnclosures }],
      },
    },
    onStopNode: () => scriptCount++,
  });
  fsp.parse(xml);
  return { scriptCount };
}

function runSaxManual(xml) {
  // sax has no stop-node concept — best a consumer can do is track depth
  // and ignore text inside <script>.
  let scriptCount = 0;
  let inScript = false;
  const parser = sax.parser(true);
  parser.onopentag = (node) => { if (node.name === 'script') { inScript = true; scriptCount++; } };
  parser.onclosetag = (name) => { if (name === 'script') inScript = false; };
  parser.write(xml).close();
  return { scriptCount };
}

function bench(label, fn, iterations) {
  for (let i = 0; i < Math.min(5, iterations); i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)}ms total, ${(ms / iterations).toFixed(3)}ms/iter`);
  return ms;
}

const scriptCount = 400;
const xml = makeHtmlWithScripts(scriptCount);
const iterations = 100;

console.log(`${scriptCount} <script> tags with quoted '<'/'>' in string literals (${(xml.length / 1024).toFixed(0)} KB)\n`);

console.log('plain (_collectPlain, no skipEnclosures):', runFspPlainStopNode(xml));
console.log('enclosure-aware (_collectEnclosureOnly): ', runFspEnclosureStopNode(xml));
console.log('sax (manual depth tracking):             ', runSaxManual(xml));
console.log();

bench('FSP stopNode plain            ', () => runFspPlainStopNode(xml), iterations);
bench('FSP stopNode + skipEnclosures ', () => runFspEnclosureStopNode(xml), iterations);
bench('sax manual                    ', () => runSaxManual(xml), iterations);
