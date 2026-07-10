# @nodable/sax

> From the creator of [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)

A SAX-style streaming XML parser built on [`@nodable/flexible-xml-parser`](https://github.com/nodable/flexible-xml-parser) (FXP).

No tree. No DOM. No retained document state beyond the names of currently-open
tags. Just events, fired the instant FXP's tokeniser produces them.

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

That's the whole implementation. @nodable/sax is a ~150-line output builder, not a parser.

`@nodable/sax` is roughly 3-4x faster than `sax`, but slower than `saxes`, for the following major reasons:
- It has provision to handle streams
- It has provision to handle incomplete document
- It has provision for skipping a tag, to exit on certain condition, and to stop parsing for particular depth.

### What you get for free from FXP

- **Stop nodes** — skip tokenising a subtree entirely and get its raw XML as a single string.
- **Skip Tags** — skip defined tags from the output completely.
- **Early Exit**: Skip tokenizing the rest document on certain condition.
- **Lenient auto-close recovery** — Multiple strategies to handle malformed / incomplete document.
- **Encoding**: Supports `'utf8'`, `'ascii'`, `'latin1'` (also `'iso‑8859‑1'`), `'utf16le'`, `'utf16be'` by default. And you can configure it to support more.
- **Security defenses already built in** — Billion Laughs (entity-bomb) defense at both read-time and expansion-time, prototype-pollution guards on tag/attribute names, attribute-count limits, and nesting-depth limits. 
- **DOCTYPE handling**, namespace extraction, and self-closing/unpaired tag handling (`<br>`, `<img>`, etc.) — all FXP's job, not SaxParser's.

### What SaxParser adds

- A genuinely tree-free output builder (`SaxBuilder`) — `O(depth)` memory,
  not `O(document)`.
- **Value parsing is opt-in, not default.** FXP's default builders run `ws → entity → boolean → number` on every tag value. SaxParser defaults both chains to `[]` — you get raw strings unless you explicitly ask for coercion. This is the main reason SaxParser can be faster than parsers that always coerce types you don't need.
- A small, explicit event surface, documented below, with one callback per FXP builder-contract method.

## Comparison & migration

| | `sax` | `saxes` | `@nodable/sax` |
|---|---|---|---|
| Tokeniser | hand-rolled | hand-rolled (sax fork, rewritten) | FXP (`@nodable/flexible-xml-parser`) |
| Malformed/lenient input | recovers silently | throws by default | configurable — `autoClose` recovers leniently, or `autoClose: { onMismatch: 'throw' }`/strict defaults reject it, same as `saxes` |
| Streaming chunk boundaries | yes (own implementation) | yes (own implementation) | yes, via FXP's mark/rewind |
| Skip-subtree / stop nodes | no — manual depth tracking in your handlers | no | yes (`tags.stopNodes`) — SaxParser's main differentiator |
| Position info (line/col/index) | yes (`parser.line/column/position`, parser-global, mutates as you read it) | yes (similar, parser-global) | yes, per-event (`tagDetail`/`closeMeta`/`attrMeta`/`stopEnd`), not a mutable parser-global |
| Value coercion | none (always strings) | none (always strings) | opt-in chains (`valueParsers.tags`/`.attributes`), empty by default |
| DoS/security hardening | minimal | minimal | entity-bomb defenses, prototype-pollution guards, nesting/attribute-count limits, ReDoS-safe attribute scanning — all FXP-provided; tune via `fxpOptions.limits.*` and `fxpOptions.doctypeOptions.*` |

`saxes` is not a strict superset of `sax` — it deliberately rejects malformed XML rather than recovering from it, which SaxParser can match via `fxpOptions.autoClose` (leave at FXP's default-strict behavior, or explicitly configure recovery). The migration notes below assume you're moving *to* SaxParser and want to keep behavior equivalent.

### Migrating from `sax`

| `sax` | `@nodable/sax` | Notes |
|---|---|---|
| `parser.onopentag = (node) => ...` where `node` is `{ name, attributes }` | `onStartElement: (name, attributes, tagDetail) => ...` | `sax` bundles name+attributes into one object; SaxParser passes them as separate positional args. Position info moves from the mutable `parser.line`/`parser.column` to the per-call `tagDetail`, or read `this.matcher` for live path info. |
| `parser.onattribute = ({ name, value }) => ...` | `onAttribute: (name, value, attrMeta) => ...` | Same per-attribute granularity; `sax` only enables this with `opentagstart` workflows, SaxParser fires it by default whenever `skip.attributes: false`. |
| `parser.ontext = (text) => ...` | `onText: (text) => ...` | Both fire per text run, not pre-joined. `sax` can be configured with `MAX_BUFFER_LENGTH` to force splitting; SaxParser has no equivalent knob — it always matches FXP's tokeniser granularity. |
| `parser.onclosetag = (name) => ...` | `onEndElement: (name, closeMeta) => ...` | `sax`'s `name` is the only info given; SaxParser additionally hands back `closeMeta` with position data when available. |
| `parser.oncdata = (text) => ...` | `onCData: (text) => ...` | Direct equivalent. |
| `parser.oncomment = (text) => ...` | `onComment: (text) => ...` | Direct equivalent. |
| `parser.onprocessinginstruction = ({ name, body }) => ...` | `onProcessingInstruction: (name, attributes) => ...` | `sax` gives raw unparsed `body`; SaxParser parses PI attributes for you (and splits out the XML declaration into `onXmlDeclaration`). |
| (no equivalent) | `onStopNode: (tagDetail, rawContent, stopEnd) => ...` | The feature `sax` cannot do — declare `fxpOptions.tags.stopNodes` and skip tokenising a subtree entirely instead of manually tracking depth in your handlers to ignore it. |
| `parser.write(chunk).close()` | `parser.write(chunk); parser.end();` or `parser.parse(xml)` for one-shot | Same chunked-write model; SaxParser separates the one-shot (`parse`) and streaming (`write`/`end`) entry points instead of overloading one method. |
| (no direct equivalent — `sax` takes strings/Buffers only) | `parser.parseBytesArr(uint8Array)` | For raw `Uint8Array`/`ArrayBufferView` input (`fetch().arrayBuffer()`, WebSocket frames) that isn't a Node `Buffer`. Use `parse()` for `Buffer`, same as `sax`. |

### Migrating from `saxes`

`saxes`'s event names already closely mirror DOM-ish SAX conventions
(`onopentag`, `onclosetag`, `ontext`, `oncdata`, `oncomment`,
`onprocessinginstruction`) and its `tag` object on open/close carries
`name`, `attributes`, and `isSelfClosing` — broadly the same shape as
`sax`'s, so the migration table above applies with the same field mapping.
The main behavioral difference to account for: `saxes` throws by default on
malformed XML with no auto-recovery (set `onerror` to override). FXP matches
this out of the box — `fxpOptions.autoClose` defaults to disabled, which
means SaxParser also throws on malformed input by default, same as `saxes`. Opt
into leniency explicitly with `autoClose: 'html'` (or fine-grained
`{ onEof, onMismatch, collectErrors }`) only if you actually want recovery.
exposes `xmlDecl` as a property read once the declaration is seen — SaxParser
supports the exact same `parser.xmlDecl` property *and* fires it as an event
(`onXmlDeclaration`), so existing `saxes` code reading `parser.xmlDecl`
should work with only the constructor swapped — see
[`xmlDecl`](#xmldecl-read-after-parsing) above.


## Install

```bash
npm install @nodable/sax
```

## API

### `new SaxParser(options)`

Every handler below is invoked with `this` bound to the internal builder instance — use a regular function (not an arrow function) if you want `this.matcher`, a read-only `path-expression-matcher` view of the current position in the document (current tag name, attribute values, ancestor path, sibling index, etc. — see [path-expression-matcher](https://www.npmjs.com/package/path-expression-matcher) for its full API). `matcher` is **not** passed as a handler argument.

| Option | Type | Default | Description |
|---|---|---|---|
| `fxpOptions` | `object` | `{}` | Forwarded verbatim as `XMLParser`'s parser options — `tags.stopNodes`, `skip.*`, `limits.*`, `autoClose`, `doctypeOptions`, `feedable.*`, etc. See [`skip`](#skip--exclude-node-types-from-SaxParser-events) below and FXP's own docs for the rest. |
| `valueParsers.tags` | `Array<string\|ValueParser>` | `[]` | Value-parser chain for tag text. Pass `['ws', 'entity', 'boolean', 'number']` to restore FXP's tree-builder defaults. |
| `valueParsers.attributes` | `Array<string\|ValueParser>` | `[]` | Value-parser chain for attribute values. |
| `onAttribute` | `(name, value, attrMeta) => void` | — | Fires once per attribute, in document order, **before** `onStartElement`. `value` is already run through the attribute value-parser chain. `attrMeta` is `{ index }` — the absolute document offset of the attribute name's first character. Does not fire at all when `fxpOptions.skip.attributes` is `true` (the default). |
| `onStartElement` | `(name, attributes, tagDetail) => void` | — | Opening tag. `attributes` is a plain object — empty unless `fxpOptions.skip.attributes: false` — already run through the attribute value-parser chain (raw strings if you left the chain empty). `tagDetail` is `{ name, line, col, index, openEnd }` — `index` is the offset of the opening tag's `<`, `openEnd` is the offset right after its `>`. |
| `onEndElement` | `(name, closeMeta) => void` | — | Closing tag. `closeMeta` is `{ name, line?, col?, index?, closeEnd? }` — `name` is always present and always agrees with the `name` argument; the position fields (`line`, `col`, `index`, `closeEnd`) are present only for a real closing tag and omitted for self-closing tags, autoClose-synthesized closes, unpaired tags, and stop-node-triggered closes. |
| `onText` | `(text) => void` | — | A run of text content. Called once per FXP `addValue` — SaxParser does not pre-join text across multiple calls for the same element. Never fires for text inside a stop node's raw content — use `onStopNode` for that. Skipped entirely for whitespace-only runs when `fxpOptions.skip.whitespaceText` is `true` (the default). |
| `onCData` | `(text) => void` | — | A `<![CDATA[...]]>` section. Always fires as its own event — never silently merged into `onText`, regardless of FXP's `nameFor.cdata` setting. Does not fire when `fxpOptions.skip.cdata` is `true`. |
| `onComment` | `(text) => void` | — | A `<!-- ... -->` comment. Does not fire when `fxpOptions.skip.comment` is `true`. |
| `onProcessingInstruction` | `(name, attributes) => void` | — | A `<?name ...?>` PI, excluding the XML declaration. Does not fire when `fxpOptions.skip.pi` is `true`. |
| `onXmlDeclaration` | `(attributes) => void` | — | The `<?xml version="1.0" ...?>` declaration specifically — FXP dispatches this separately from ordinary PIs, so SaxParser exposes it separately too. `attributes` is `{ version, encoding?, standalone? }`, populated unconditionally (not gated by `fxpOptions.skip.attributes` — unlike ordinary element/PI attributes, the declaration's own fields come from FXP's dedicated declaration parsing). Does not fire when `fxpOptions.skip.declaration` is `true`. |
| `onStopNode` | `(tagDetail, rawContent, stopEnd) => void` | — | Fires when a tag matching `fxpOptions.tags.stopNodes` is fully collected. `rawContent` is the **unparsed** inner XML string — none of `onStartElement`/`onText`/`onEndElement` fire for anything inside it. `stopEnd` is `{ index, line, col }` — the offset right after the matched closing tag's `>`. |
| `onExit` | `(exitInfo) => void` | — | Fires when `fxpOptions.tags.exitIf` triggers early termination. `exitInfo` is `{ tagDetail, matcher, depth }` — `matcher` here is a normal argument, not `this.matcher`, since `onExit` is forwarded as-is from FXP's own `exitInfo` shape. |
| `onError` | `(err) => void` | throws | Called instead of throwing when `parse()`/`parseBytesArr()`/`write()`/`end()` encounter a `ParseError`. Not builder-bound — fired directly from `SaxParser`, outside any active matcher state. Omit to let errors throw normally. |
| `onEnd` | `() => void` | — | Fires once parsing completes successfully. |

### `skip` — exclude node types from SaxParser events

`fxpOptions.skip` controls which FXP token types reach SaxParser's handlers at all — this is the most commonly reached-for option, since several defaults are opt-out for SAX use (FXP's own defaults assume a tree builder, where omitting attributes/whitespace text keeps the tree small):

```js
new SaxParser({
  fxpOptions: {
    skip: {
      attributes:     true,  // default — onAttribute/onStartElement's attrs
                              // object stay empty/unfired; set false to get them
      whitespaceText: true,  // default — onText doesn't fire for whitespace-only runs
      declaration:    false, // default — onXmlDeclaration fires
      pi:             false, // default — onProcessingInstruction fires
      cdata:          false, // default — onCData fires
      comment:        false, // default — onComment fires
      nsPrefix:       false, // default — ns:tag stays ns:tag; true strips to tag
                              // and drops xmlns:* attributes
      tags:           [],    // tag paths to drop silently — the tag and its
                              // entire subtree are consumed but never forwarded
                              // to any handler; use stopNodes instead if you
                              // need the raw inner text
    },
  },
});
```

`skip.attributes: false` is the one you'll reach for most often — without it, `onAttribute` never fires and `onStartElement`'s `attributes` argument is always `{}`. The other flags default to "deliver the event" already and are there to opt back *out* if you don't need a given event type (e.g. `skip.comment: true` if you don't care about comments and want to skip the `onComment` call overhead entirely on a hot path).

#### `skip.tags` — silently discard subtrees

`skip.tags` accepts the same path expression syntax as `stopNodes` (see FXP docs for the full grammar), but instead of capturing the inner content as a raw string, it **silently discards** the tag and its entire subtree — no handler fires, no raw content is collected:

```js
new SaxParser({
  fxpOptions: {
    skip: {
      tags: [
        '..script',    // drop all <script> tags at any depth
        'root.debug',  // drop <debug> only when directly inside <root>
      ],
    },
  },
});
```

Compare with `fxpOptions.tags.stopNodes`: both match on path expressions, but `stopNodes` gives you the raw inner text (and fires `onStopNode`), while `skip.tags` is a silent black-hole. Prefer `skip.tags` when you want to strip instrumentation/debug subtrees from the event stream without writing handler logic; prefer `stopNodes` when the raw text matters (e.g. `<script>` content you need to forward elsewhere).

### `xmlDecl` (read after parsing)

```js
const parser = new SaxParser();
parser.parse(xmlString);
console.log(parser.xmlDecl); // { version: 1, encoding: 'UTF-8', standalone: undefined }
```

A `saxes`-style parity property — `{ version, encoding, standalone }`, populated unconditionally as soon as the document's `<?xml ...?>` declaration is seen (stays `{}` if there's no declaration at all). `encoding`/`standalone` are `undefined` if not present in the declaration; `version` defaults to `1` per the XML spec when the declaration omits it. Populated from the same data delivered to `onXmlDeclaration`, so it's redundant if you're already using that callback; provided so code migrated from `sax`/`saxes` that reads `parser.xmlDecl` off the parser instance doesn't need to switch to a callback. Unlike ordinary element/PI attributes, this is **not** gated by `fxpOptions.skip.attributes` — only `fxpOptions.skip.declaration: true` suppresses it.

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


## Benchmarks

`@nodable/sax` is roughly 3-4x faster than `sax`, but slower than `saxes`, for
the reasons already noted under [Why this exists](#why-this-exists):

- it has provision to handle streams
- it has provision to handle incomplete documents
- it has provision for skipping a tag, exiting early on a condition, and
  stopping parsing at a given depth

`saxes` doesn't carry any of that machinery, which is what lets it stay
faster. Run `npm run bench` on your own machine/documents to reproduce —
numbers vary by document shape (flat vs. deeply nested, attribute-heavy vs.
text-heavy) and Node version, so a fixed table here would go stale.

## Implementation notes

- **Attribute names are not prefixed/suffixed.** FXP's default `addAttribute`
  bakes `attributes.prefix`/`attributes.suffix` into the object *key* (useful
  for tree builders disambiguating attributes from child elements — e.g.
  `@_id` vs `id`). SaxParser overrides `addAttribute` and skips this, since SAX
  consumers expect bare attribute names.
- **`onText` is not pre-concatenated.** Some SAX implementations buffer and
  join adjacent text runs before firing a callback. SaxParser fires once per
  underlying FXP `addValue` call, matching the tokeniser's actual granularity
  — concatenate yourself if you need a single string per element.
- **`skip.attributes` defaults to `true` in FXP itself**, not SaxParser. If your
  `onStartElement`/`onAttribute` callbacks are receiving empty attribute
  objects, this is almost certainly why — pass
  `fxpOptions: { skip: { attributes: false } }`. Note this does **not** affect
  `onXmlDeclaration`/`xmlDecl` — the XML declaration's own
  `version`/`encoding`/`standalone` come from FXP's dedicated declaration
  parsing path and are always delivered.

## A note on custom value parsers

If you pass custom parser instances in `valueParsers.tags`/`valueParsers.attributes`,
each one **must implement `reset()`** — even as a no-op — or FXP's
`ValueParserRegistry.register()` throws `Error('parser must implement reset()')`
at registration time, before any parsing happens:

```js
import { BaseValueParser } from '@nodable/base-output-builder';

class MyParser extends BaseValueParser {
  constructor(opts, isFinal = false) { super(isFinal); this.opts = opts; }
  parse(val, ctx) { return val.toUpperCase(); }
  reset() { /* no-op is fine if you have no internal state to clear */ }
}
```

## License

MIT