# @nodable/sax

> From the creator of [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)

A SAX-style streaming XML parser built on [`@nodable/flexible-xml-parser`](https://github.com/nodable/flexible-xml-parser) (FXP).

No tree. No DOM. No retained document state beyond the names of currently-open tags. Just events, fired the instant FXP's tokeniser produces them.

Install
```bash
npm install @nodable/sax
```

Use
```js
import { SaxParser } from '@nodable/sax';

const parser = new SaxParser({
  onStartElement(name, attrs) { console.log('open', name, attrs); },
  onText(text)                { console.log('text', text); },
  onEndElement(name)          { console.log('close', name); },
});

parser.parse('<root><item id="1">hello</item></root>');
```

## Why this exists

[`sax`](https://www.npmjs.com/package/sax) is the standard low-level SAX parser for Node, but it implements its own hand-rolled tokeniser. SaxParser instead sits on top of FXP — a maintained, security-hardened tokeniser that already solves the hard parts (chunk-boundary-safe streaming, entity-bomb defenses, prototype-pollution guards, lenient-HTML auto-close recovery) — and adds **only** the one thing FXP doesn't ship: an output builder that emits events instead of building a tree.

That's the whole implementation. @nodable/sax is a few lines output builder, not a parser.

`@nodable/sax` is roughly 3-4x faster than `sax`, but slower than `saxes`, for the following major reasons:
- It has provision to handle streams
- It has provision to handle incomplete document
- It has provision for skipping a tag, to exit on certain condition, and to stop parsing for particular depth.
- It maintains a path expression matcher which is very useful to build real life project.

In short, it handles all (or most) cross cutting concerns that any project may need instead of providing bare SAX parser.

### What you get for free from FXP

- **Stop nodes** — skip tokenising a subtree entirely and get its raw XML as a single string.
- **Skip Tags** — skip defined tags from the output completely.
- **Early Exit**: Skip tokenizing the rest document on certain condition.
- **Lenient auto-close recovery** — Multiple strategies to handle malformed / incomplete document.
- **Encoding**: Supports `'utf8'`, `'ascii'`, `'latin1'` (also `'iso‑8859‑1'`), `'utf16le'`, `'utf16be'` by default. And you can configure it to support more.
- **Security defenses already built in** — Billion Laughs (entity-bomb) defense at both read-time and expansion-time, prototype-pollution guards on tag/attribute names, attribute-count limits, and nesting-depth limits. 
- DOCTYPE handling, namespace extraction, and self-closing/unpaired tag handling (`<br>`, `<img>`, etc.) — all FXP's job, not SaxParser's.

## Comparison & migration


| **Feature / Capability**                                        | **FSP (FastSaxParser)**                                                                                   | **SAX (`node-sax`)**                            | **SAXES (`saxes`)**                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| **--- Input Sources ---**                                       |                                                                                                           |                                                 |                                                |
| Input: `String`                                                 | ✅                                                                                                         | ✅                                               | ✅                                              |
| Input: `Buffer` (Node.js)                                       | ✅                                                                                                         | ✅                                               | ✅                                              |
| Input: `Uint8Array` / `ArrayBufferView`                         | ✅                                                                                                         | ❌                                               | ❌                                              |
| Input: Chunks (incremental `.write(chunk)`)                     | ✅                                                                                                         | ❌                                               | ❌                                              |
| Input: Node.js `Readable` → `Writable` (`pipe`)                 | ✅                                                                                                         | ❌                                               | ❌                                              |
| Multiple Encodings                                              | ✅ `'utf8'`, `'ascii'`, `'latin1'` (also `'iso‑8859‑1'`), `'utf16le'`, `'utf16be'` by default. And Custom. |                                                 |                                                |
| **--- Parsing Features ---**                                    |                                                                                                           |                                                 |                                                |
| **Path‑based stop‑nodes** (skip `<script>` bodies)              | ✅                                                                                                         | ❌                                               | ❌                                              |
| **Path‑based skip‑tags** (skip `<script>` from output)          | ✅                                                                                                         | ❌                                               | ❌                                              |
| **Auto‑close missing tags** (`<root><a></root>` → `<a>` closed) | ✅                                                                                                         | ✅ (`strict: false`)                             | ❌ (strict XML only)                            |
| **Unpaired (void) tags** (`<br>` treated as self‑closing)       | ✅ (`tags.unpaired: ['br']`)                                                                               | ❌ (must be `<br/>`)                             | ❌ (must be `<br/>`)                            |
| **Namespace prefix stripping**                                  | ✅ (`skip.nsPrefix: true` )                                                                                | ❌                                               | ❌                                              |
| **Exit in between**                                             | ✅                                                                                                         | ❌                                               | ❌                                              |
| **--- Security ---**                                            |                                                                                                           |                                                 |                                                |
| **Prototype pollution prevention** (`__proto__` keys)           | ✅ (sanitises tags/attributes in `buildOptions`)                                                           | ❌ (vulnerable – allows `__proto__` attributes)  | ❌ (vulnerable – allows `__proto__` attributes) |
| **Unsafe tag name detection**                                   | ✅ (throws on `constructor`/`prototype` in builder opts)                                                   | ❌                                               | ❌                                              |

## API

### `new SaxParser(options)`

Every handler below is invoked with `this` bound to the internal builder instance — use a regular function (not an arrow function) if you want `this.matcher`, a read-only `path-expression-matcher` view of the current position in the document (current tag name, attribute values, ancestor path, sibling index, etc. — see [path-expression-matcher](https://www.npmjs.com/package/path-expression-matcher) for its full API). `matcher` is **not** passed as a handler argument.

| Option                    | Type                                       | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fxpOptions`              | `object`                                   | `{}`    | Forwarded verbatim as `XMLParser`'s parser options — `tags.stopNodes`, `skip.*`, `limits.*`, `autoClose`, `doctypeOptions`, `feedable.*`, etc. check [FXP Options](https://github.com/nodable/flexible-xml-parser/blob/main/docs/02-options.md                                                                                                                                                                                                                     |
| `onAttribute`             | `(name, value, attrMeta) => void`          | —       | Fires once per attribute, in document order, **before** `onStartElement`. `value` is already run through the attribute value-parser chain. `attrMeta` is `{ index }` — the absolute document offset of the attribute name's first character. Does not fire at all when `fxpOptions.skip.attributes` is `true` (the default).                                                                                                                                       |
| `onStartElement`          | `(name, attributes, tagDetail) => void`    | —       | Opening tag. `attributes` is a plain object — empty unless `fxpOptions.skip.attributes: false` — already run through the attribute value-parser chain (raw strings if you left the chain empty). `tagDetail` is `{ name, line, col, index, openEnd }` — `index` is the offset of the opening tag's `<`, `openEnd` is the offset right after its `>`.                                                                                                               |
| `onEndElement`            | `(name, closeMeta) => void`                | —       | Closing tag. `closeMeta` is `{ name, line?, col?, index?, closeEnd? }` — `name` is always present and always agrees with the `name` argument; the position fields (`line`, `col`, `index`, `closeEnd`) are present only for a real closing tag and omitted for self-closing tags, autoClose-synthesized closes, unpaired tags, and stop-node-triggered closes.                                                                                                     |
| `onText`                  | `(text) => void`                           | —       | A run of text content. Called once per FXP `addValue` — SaxParser does not pre-join text across multiple calls for the same element. Never fires for text inside a stop node's raw content — use `onStopNode` for that. Skipped entirely for whitespace-only runs when `fxpOptions.skip.whitespaceText` is `true` (the default).                                                                                                                                   |
| `onCData`                 | `(text) => void`                           | —       | A `<![CDATA[...]]>` section. Always fires as its own event — never silently merged into `onText`, regardless of FXP's `nameFor.cdata` setting. Does not fire when `fxpOptions.skip.cdata` is `true`.                                                                                                                                                                                                                                                               |
| `onDocType`               | `entities => void`                         |         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `onComment`               | `(text) => void`                           | —       | A `<!-- ... -->` comment. Does not fire when `fxpOptions.skip.comment` is `true`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `onProcessingInstruction` | `(name, attributes) => void`               | —       | A `<?name ...?>` PI, excluding the XML declaration. Does not fire when `fxpOptions.skip.pi` is `true`.                                                                                                                                                                                                                                                                                                                                                             |
| `onXmlDeclaration`        | `(attributes) => void`                     | —       | The `<?xml version="1.0" ...?>` declaration specifically — FXP dispatches this separately from ordinary PIs, so SaxParser exposes it separately too. `attributes` is `{ version, encoding?, standalone? }`, populated unconditionally (not gated by `fxpOptions.skip.attributes` — unlike ordinary element/PI attributes, the declaration's own fields come from FXP's dedicated declaration parsing). Does not fire when `fxpOptions.skip.declaration` is `true`. |
| `onStopNode`              | `(tagDetail, rawContent, stopEnd) => void` | —       | Fires when a tag matching `fxpOptions.tags.stopNodes` is fully collected. `rawContent` is the **unparsed** inner XML string — none of `onStartElement`/`onText`/`onEndElement` fire for anything inside it. `stopEnd` is `{ index, line, col }` — the offset right after the matched closing tag's `>`.                                                                                                                                                            |
| `onExit`                  | `(exitInfo) => void`                       | —       | Fires when `fxpOptions.tags.exitIf` triggers early termination. `exitInfo` is `{ tagDetail, matcher, depth }` — `matcher` here is a normal argument, not `this.matcher`, since `onExit` is forwarded as-is from FXP's own `exitInfo` shape.                                                                                                                                                                                                                        |
| `onError`                 | `(err) => void`                            | throws  | Called instead of throwing when `parse()`/`parseBytesArr()`/`write()`/`end()` encounter a `ParseError`. Not builder-bound — fired directly from `SaxParser`, outside any active matcher state. Omit to let errors throw normally.                                                                                                                                                                                                                                  |
| `onEnd`                   | `() => void`                               | —       | Fires once parsing completes successfully.                                                                                                                                                                                                                                                                                                                                                                                                                         |

### `xmlDecl` (read after parsing)

```js
const parser = new SaxParser();
parser.parse(xmlString);
console.log(parser.xmlDecl); // { version: 1, encoding: 'UTF-8', standalone: undefined }
```

Populated unconditionally as soon as the document's `<?xml ...?>` declaration is seen (stays `{}` if there's no declaration at all). `encoding`/`standalone` are `undefined` if not present in the declaration; `version` defaults to `1` per the XML spec when the declaration omits it. Populated from the same data delivered to `onXmlDeclaration`, so it's redundant if you're already using that callback.

### Methods

```js
parser.parse(xmlString)        // one-shot parse of a complete document (string or Buffer)
parser.parseBytesArr(bytes)    // one-shot parse of a Uint8Array/ArrayBufferView —
                             // use this instead of parse() for raw byte input
                             // that isn't a Node Buffer (fetch().arrayBuffer(),
                             // WebSocket binary frames, browser code with no
                             // Buffer global)
parser.write(chunk)            // feed one chunk; safe to call repeatedly, any boundary
parser.end()                   // signal end of input after write() calls
parser.asWritable(streamOpts)  // get a Node Writable: readStream.pipe(parser.asWritable())
```

## Examples

See `examples/`:

- `basic.js` — one-shot parse covering start/end/text/comment/declaration events, including the `tagDetail`/`closeMeta` position metadata passed to `onStartElement`/`onEndElement`, and reading `this.matcher` for the current path.
- `streaming.js` — `write()`/`end()` with chunks deliberately split mid-tag and mid-text, to show FXP's chunk-boundary handling working transparently.
- `stop-nodes.js` — using `tags.stopNodes` to pull a subtree's raw XML as a single string without tokenising its contents.

## Implementation notes

- **Attribute names are not prefixed/suffixed.** FXP's default `addAttribute`   bakes `attributes.prefix`/`attributes.suffix` into the object *key* (useful
  for tree builders disambiguating attributes from child elements — e.g.   `@_id` vs `id`). SaxParser overrides `addAttribute` and skips this, since SAX
  consumers expect bare attribute names.
- **`onText` is not pre-concatenated.** Some SAX implementations buffer and  join adjacent text runs before firing a callback. SaxParser fires once per
  underlying FXP `addValue` call, matching the tokeniser's actual granularity — concatenate yourself if you need a single string per element.
- **`skip.attributes` defaults to `true` in FXP itself**, not SaxParser. If your `onStartElement`/`onAttribute` callbacks are receiving empty attribute
  objects, this is almost certainly why — pass `fxpOptions: { skip: { attributes: false } }`. Note this does **not** affect `onXmlDeclaration`/`xmlDecl` — the XML declaration's own  `version`/`encoding`/`standalone` come from FXP's dedicated declaration parsing path and are always delivered.


## License

MIT