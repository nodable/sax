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
 */
export function makeMixed(elementCount) {
  let xml = '<?xml version="1.0"?>\n<?app-pi data="x"?>\n<root>\n';
  for (let i = 0; i < elementCount; i++) {
    xml += `  <!-- comment ${i} -->\n`;
    xml += `  <item id="${i}"><![CDATA[raw <content> ${i}]]></item>\n`;
  }
  xml += '</root>';
  return xml;
}
