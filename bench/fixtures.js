'use strict';

/**
 * Generate a flat XML document with `n` sibling elements.
 * Each element has `attrCount` attributes and a text body.
 * Shape: <catalog> <item id="1" lang="en" ... >text</item> ... </catalog>
 */
export function makeFlat(elementCount, attrCount = 2) {
  const attrs = Array.from({ length: attrCount }, (_, i) => `a${i}="v${i}"`).join(' ');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<catalog>\n';
  for (let i = 0; i < elementCount; i++) {
    xml += `  <item ${attrs}>text content ${i}</item>\n`;
  }
  xml += '</catalog>';
  return xml;
}

/**
 * Generate a deeply nested XML document with `depth` levels and `breadth`
 * children per level.
 * Shape: <l0><l1><l2>…<leaf>text</leaf>…</l2></l1></l0>
 */
export function makeDeep(depth, breadth = 2) {
  function nest(d) {
    if (d === 0) return `<leaf>text at depth ${depth}</leaf>`;
    const tag = `l${depth - d}`;
    const children = Array.from({ length: breadth }, () => nest(d - 1)).join('');
    return `<${tag}>${children}</${tag}>`;
  }
  return `<?xml version="1.0"?><root>${nest(depth)}</root>`;
}

/**
 * Generate XML with embedded comments and CDATA, plus processing instructions.
 * Includes a run of unpaired tags (<br/> style handled as unpaired, not
 * self-closing) interleaved so the `isUnpaired` branch in readOpeningTag is
 * exercised too — pass `tags.unpaired: ['br']` in fxpOptions when using this
 * fixture, or the <br> tags will just parse as ordinary empty elements.
 */
export function makeMixed(elementCount) {
  let xml = '<?xml version="1.0"?>\n<!DOCTYPE root SYSTEM "foo.dtd"><?app-pi data="x"?>\n<root>\n';
  for (let i = 0; i < elementCount; i++) {
    xml += `  <!-- comment ${i} -->\n`;
    xml += `  <item id="${i}"><![CDATA[raw <content> ${i}]]></item>\n`;
    // xml += `  <br>\n`; //SAX and SAXES doesn't support unpaired tags
  }
  xml += '</root>';
  return xml;
}

/**
 * Generate an SVG-shaped document: xmlns-prefixed root, deep <g> nesting,
 * and many <path> elements with long `d` attribute values — stresses
 * AttributeProcessor's per-char scan on long attribute strings and
 * readOpeningTag's namespace extraction (colonIdx split on every tag).
 *
 * Shape: <svg xmlns="..." xmlns:xlink="..."><g><g>...<path d="M0 0 L…"/>...</g></g></svg>
 *
 * @param {number} pathCount   number of <path> leaves
 * @param {number} groupDepth  levels of nested <g> wrapping the paths
 * @param {number} pathLength  number of "L x y" segments per path's `d` attr
 */
export function makeSvg(pathCount, groupDepth = 4, pathLength = 40) {
  const d = 'M0 0 ' + Array.from({ length: pathLength }, (_, i) => `L${i} ${i * 2}`).join(' ');
  let inner = '';
  for (let i = 0; i < pathCount; i++) {
    inner += `<path d="${d}" fill="none" stroke="#${(i % 999).toString(16).padStart(3, '0')}" stroke-width="1.5" xlink:href="#ref${i}"/>`;
  }
  for (let i = 0; i < groupDepth; i++) inner = `<g transform="translate(${i},${i})">${inner}</g>`;
  return `<?xml version="1.0"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">` +
    inner +
    `</svg>`;
}

/**
 * Generate an HTML-shaped document with <script> bodies containing string
 * literals with embedded '<'/'>' characters — the case skipEnclosures exists
 * for. Use with fxpOptions like:
 *   tags: { stopNodes: [{ expression: 'html.body.script', skipEnclosures: quoteEnclosures }] }
 * to actually exercise StopNodeProcessor._collectEnclosureOnly instead of
 * _collectPlain (plain stop nodes never hit the enclosure-skip code path).
 *
 * @param {number} scriptCount
 */
export function makeHtmlWithScripts(scriptCount) {
  const body = `
    if (a < b && c > d) {
      var s = "value < 10 && value > 0";
      var t = 'another < weird > string';
    }
  `;
  let xml = '<html><body>\n';
  for (let i = 0; i < scriptCount; i++) {
    xml += `<script id="s${i}">${body}</script>\n`;
    xml += `<div>content ${i}</div>\n`;
  }
  xml += '</body></html>';
  return xml;
}
