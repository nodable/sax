# fast-sax-parser (FSP)

> From the creator of [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)

A SAX-style streaming XML parser built on [`@nodable/flexible-xml-parser`](https://github.com/nodable/flexible-xml-parser) (FXP).

No tree. No DOM. No retained document state beyond the names of currently-open
tags. Just events, fired the instant FXP's tokeniser produces them.

```js
import { FastSaxParser } from 'fast-sax-parser';

const fsp = new FastSaxParser({
  onStartElement(name, attrs) { console.log('open', name, attrs); },
  onText(text)                { console.log('text', text); },
  onEndElement(name)          { console.log('close', name); },
});

fsp.parse('<root><item id="1">hello</item></root>');
```

## Why this exists

[`sax`](https://www.npmjs.com/package/sax) is the standard low-level SAX parser
for Node, but it implements its own hand-rolled tokeniser. FSP instead sits on
top of FXP — a maintained, security-hardened tokeniser that already solves the
hard parts (chunk-boundary-safe streaming, entity-bomb defenses, prototype-pollution
guards, lenient-HTML auto-close recovery) — and adds **only** the one thing FXP
doesn't ship: an output builder that emits events instead of building a tree.

That's the whole implementation. FSP is a ~150-line output builder, not a parser.

It is not a strictly faster drop-in replacement for `sax` in every case — see
[Benchmarks](#benchmarks) below for honest numbers. Its real advantage is
`stopNodes`: the ability to skip tokenising entire subtrees you don't need
parsed, which `sax` has no equivalent for.

### What you get for free from FXP

- **Chunk-boundary safety** — `write()` can be called with arbitrarily-split
  chunks (mid-tag, mid-attribute, mid-CDATA); FXP's mark/rewind protocol
  replays partial tokens correctly across calls.
- **Stop nodes** — skip tokenising a subtree entirely and get its raw XML as
  a single string (`onStopNode`). This is the main performance lever for
  large documents with embedded blobs you don't need parsed.
- **Lenient auto-close recovery** — `autoClose: 'html'` for HTML-like void
  elements and mismatched-tag recovery, with optional error collection
  instead of throwing.
- **Security defenses already built in** — Billion Laughs (entity-bomb)
  defense at both read-time and expansion-time, prototype-pollution guards on
  tag/attribute names, attribute-count limits, nesting-depth limits, and a
  hand-written O(n) attribute scanner immune to catastrophic regex
  backtracking. All limits are configurable via `fxpOptions`:
  - `limits.maxNestedTags` — reject documents exceeding a tag nesting depth
  - `limits.maxAttributesPerTag` — reject tags with too many attributes
  - `doctypeOptions.maxEntityCount` / `doctypeOptions.maxEntitySize` — bound
    DOCTYPE entity declarations (entity-bomb read-time defense)
  - `doctypeOptions.enabled: true` with `valueParsers` `entity` stage — opt
    into entity replacement with expansion-time bomb defense
  All default to `null`/unlimited; set explicit values for untrusted input.
- **DOCTYPE handling**, namespace extraction, and self-closing/unpaired tag
  handling (`<br>`, `<img>`, etc.) — all FXP's job, not FSP's.

### What FSP adds

- A genuinely tree-free output builder (`FastSaxBuilder`) — `O(depth)` memory,
  not `O(document)`.
- **Value parsing is opt-in, not default.** FXP's default builders run
  `ws → entity → boolean → number` on every tag value. FSP defaults both
  chains to `[]` — you get raw strings unless you explicitly ask for
  coercion. This is the main reason FSP can be faster than parsers that
  always coerce types you don't need.
- A small, explicit event surface, documented below, with one callback per
  FXP builder-contract method.

## Comparison & migration

| | `sax` | `saxes` | `fast-sax-parser` |
|---|---|---|---|
| Tokeniser | hand-rolled | hand-rolled (sax fork, rewritten) | FXP (`@nodable/flexible-xml-parser`) |
| Malformed/lenient input | recovers silently | throws by default | configurable — `autoClose` recovers leniently, or `autoClose: { onMismatch: 'throw' }`/strict defaults reject it, same as `saxes` |
| Streaming chunk boundaries | yes (own implementation) | yes (own implementation) | yes, via FXP's mark/rewind |
| Skip-subtree / stop nodes | no — manual depth tracking in your handlers | no | yes (`tags.stopNodes`) — FSP's main differentiator |
| Position info (line/col/index) | yes (`parser.line/column/position`, parser-global, mutates as you read it) | yes (similar, parser-global) | yes, per-event (`tagDetail`/`closeMeta`/`attrMeta`/`stopEnd`), not a mutable parser-global |
| Value coercion | none (always strings) | none (always strings) | opt-in chains (`valueParsers.tags`/`.attributes`), empty by default |
| DoS/security hardening | minimal | minimal | entity-bomb defenses, prototype-pollution guards, nesting/attribute-count limits, ReDoS-safe attribute scanning — all FXP-provided; tune via `fxpOptions.limits.*` and `fxpOptions.doctypeOptions.*` |

`saxes` is not a strict superset of `sax` — it deliberately rejects
malformed XML rather than recovering from it, which FSP can match via
`fxpOptions.autoClose` (leave at FXP's default-strict behavior, or
explicitly configure recovery). The migration notes below assume you're
moving *to* FSP and want to keep behavior equivalent.

### Migrating from `sax`

| `sax` | `fast-sax-parser` | Notes |
|---|---|---|
| `parser.onopentag = (node) => ...` where `node` is `{ name, attributes }` | `onStartElement: (name, attributes, tagDetail) => ...` | `sax` bundles name+attributes into one object; FSP passes them as separate positional args. Position info moves from the mutable `parser.line`/`parser.column` to the per-call `tagDetail`, or read `this.matcher` for live path info. |
| `parser.onattribute = ({ name, value }) => ...` | `onAttribute: (name, value, attrMeta) => ...` | Same per-attribute granularity; `sax` only enables this with `opentagstart` workflows, FSP fires it by default whenever `skip.attributes: false`. |
| `parser.ontext = (text) => ...` | `onText: (text) => ...` | Both fire per text run, not pre-joined. `sax` can be configured with `MAX_BUFFER_LENGTH` to force splitting; FSP has no equivalent knob — it always matches FXP's tokeniser granularity. |
| `parser.onclosetag = (name) => ...` | `onEndElement: (name, closeMeta) => ...` | `sax`'s `name` is the only info given; FSP additionally hands back `closeMeta` with position data when available. |
| `parser.oncdata = (text) => ...` | `onCData: (text) => ...` | Direct equivalent. |
| `parser.oncomment = (text) => ...` | `onComment: (text) => ...` | Direct equivalent. |
| `parser.onprocessinginstruction = ({ name, body }) => ...` | `onProcessingInstruction: (name, attributes) => ...` | `sax` gives raw unparsed `body`; FSP parses PI attributes for you (and splits out the XML declaration into `onXmlDeclaration`). |
| (no equivalent) | `onStopNode: (tagDetail, rawContent, stopEnd) => ...` | The feature `sax` cannot do — declare `fxpOptions.tags.stopNodes` and skip tokenising a subtree entirely instead of manually tracking depth in your handlers to ignore it. |
| `parser.write(chunk).close()` | `fsp.write(chunk); fsp.end();` or `fsp.parse(xml)` for one-shot | Same chunked-write model; FSP separates the one-shot (`parse`) and streaming (`write`/`end`) entry points instead of overloading one method. |
| (no direct equivalent — `sax` takes strings/Buffers only) | `fsp.parseBytesArr(uint8Array)` | For raw `Uint8Array`/`ArrayBufferView` input (`fetch().arrayBuffer()`, WebSocket frames) that isn't a Node `Buffer`. Use `parse()` for `Buffer`, same as `sax`. |

### Migrating from `saxes`

`saxes`'s event names already closely mirror DOM-ish SAX conventions
(`onopentag`, `onclosetag`, `ontext`, `oncdata`, `oncomment`,
`onprocessinginstruction`) and its `tag` object on open/close carries
`name`, `attributes`, and `isSelfClosing` — broadly the same shape as
`sax`'s, so the migration table above applies with the same field mapping.
The main behavioral difference to account for: `saxes` throws by default on
malformed XML with no auto-recovery (set `onerror` to override). FXP matches
this out of the box — `fxpOptions.autoClose` defaults to disabled, which
means FSP also throws on malformed input by default, same as `saxes`. Opt
into leniency explicitly with `autoClose: 'html'` (or fine-grained
`{ onEof, onMismatch, collectErrors }`) only if you actually want recovery.
exposes `xmlDecl` as a property read once the declaration is seen — FSP
supports the exact same `parser.xmlDecl` property *and* fires it as an event
(`onXmlDeclaration`), so existing `saxes` code reading `parser.xmlDecl`
should work with only the constructor swapped — see
[`xmlDecl`](#xmldecl-read-after-parsing) above.


## Install

```bash
npm install fast-sax-parser
```

## API

### `new FastSaxParser(options)`

Every handler below is invoked with `this` bound to the internal builder
instance — use a regular function (not an arrow function) if you want
`this.matcher`, a read-only `path-expression-matcher` view of the current
position in the document (current tag name, attribute values, ancestor path,
sibling index, etc. — see [path-expression-matcher](https://www.npmjs.com/package/path-expression-matcher)
for its full API). `matcher` is **not** passed as a handler argument.

| Option | Type | Default | Description |
|---|---|---|---|
| `fxpOptions` | `object` | `{}` | Forwarded verbatim as `XMLParser`'s parser options — `tags.stopNodes`, `skip.*`, `limits.*`, `autoClose`, `doctypeOptions`, `feedable.*`, etc. See [`skip`](#skip--exclude-node-types-from-fsp-events) below and FXP's own docs for the rest. |
| `valueParsers.tags` | `Array<string\|ValueParser>` | `[]` | Value-parser chain for tag text. Pass `['ws', 'entity', 'boolean', 'number']` to restore FXP's tree-builder defaults. |
| `valueParsers.attributes` | `Array<string\|ValueParser>` | `[]` | Value-parser chain for attribute values. |
| `onAttribute` | `(name, value, attrMeta) => void` | — | Fires once per attribute, in document order, **before** `onStartElement`. `value` is already run through the attribute value-parser chain. `attrMeta` is `{ index }` — the absolute document offset of the attribute name's first character. Does not fire at all when `fxpOptions.skip.attributes` is `true` (the default). |
| `onStartElement` | `(name, attributes, tagDetail) => void` | — | Opening tag. `attributes` is a plain object — empty unless `fxpOptions.skip.attributes: false` — already run through the attribute value-parser chain (raw strings if you left the chain empty). `tagDetail` is `{ name, line, col, index, openEnd }` — `index` is the offset of the opening tag's `<`, `openEnd` is the offset right after its `>`. |
| `onEndElement` | `(name, closeMeta) => void` | — | Closing tag. `closeMeta` is `{ name, line?, col?, index?, closeEnd? }` — `name` is always present and always agrees with the `name` argument; the position fields (`line`, `col`, `index`, `closeEnd`) are present only for a real closing tag and omitted for self-closing tags, autoClose-synthesized closes, unpaired tags, and stop-node-triggered closes. |
| `onText` | `(text) => void` | — | A run of text content. Called once per FXP `addValue` — FSP does not pre-join text across multiple calls for the same element. Never fires for text inside a stop node's raw content — use `onStopNode` for that. Skipped entirely for whitespace-only runs when `fxpOptions.skip.whitespaceText` is `true` (the default). |
| `onCData` | `(text) => void` | — | A `<![CDATA[...]]>` section. Always fires as its own event — never silently merged into `onText`, regardless of FXP's `nameFor.cdata` setting. Does not fire when `fxpOptions.skip.cdata` is `true`. |
| `onComment` | `(text) => void` | — | A `<!-- ... -->` comment. Does not fire when `fxpOptions.skip.comment` is `true`. |
| `onProcessingInstruction` | `(name, attributes) => void` | — | A `<?name ...?>` PI, excluding the XML declaration. Does not fire when `fxpOptions.skip.pi` is `true`. |
| `onXmlDeclaration` | `(attributes) => void` | — | The `<?xml version="1.0" ...?>` declaration specifically — FXP dispatches this separately from ordinary PIs, so FSP exposes it separately too. `attributes` is `{ version, encoding?, standalone? }`, populated unconditionally (not gated by `fxpOptions.skip.attributes` — unlike ordinary element/PI attributes, the declaration's own fields come from FXP's dedicated declaration parsing). Does not fire when `fxpOptions.skip.declaration` is `true`. |
| `onStopNode` | `(tagDetail, rawContent, stopEnd) => void` | — | Fires when a tag matching `fxpOptions.tags.stopNodes` is fully collected. `rawContent` is the **unparsed** inner XML string — none of `onStartElement`/`onText`/`onEndElement` fire for anything inside it. `stopEnd` is `{ index, line, col }` — the offset right after the matched closing tag's `>`. |
| `onExit` | `(exitInfo) => void` | — | Fires when `fxpOptions.tags.exitIf` triggers early termination. `exitInfo` is `{ tagDetail, matcher, depth }` — `matcher` here is a normal argument, not `this.matcher`, since `onExit` is forwarded as-is from FXP's own `exitInfo` shape. |
| `onError` | `(err) => void` | throws | Called instead of throwing when `parse()`/`parseBytesArr()`/`write()`/`end()` encounter a `ParseError`. Not builder-bound — fired directly from `FastSaxParser`, outside any active matcher state. Omit to let errors throw normally. |
| `onEnd` | `() => void` | — | Fires once parsing completes successfully. |

### `skip` — exclude node types from FSP events

`fxpOptions.skip` controls which FXP token types reach FSP's handlers at all
— this is the most commonly reached-for option, since several defaults are
opt-out for SAX use (FXP's own defaults assume a tree builder, where omitting
attributes/whitespace text keeps the tree small):

```js
new FastSaxParser({
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

`skip.attributes: false` is the one you'll reach for most often — without
it, `onAttribute` never fires and `onStartElement`'s `attributes` argument is
always `{}`. The other flags default to "deliver the event" already and are
there to opt back *out* if you don't need a given event type (e.g.
`skip.comment: true` if you don't care about comments and want to skip the
`onComment` call overhead entirely on a hot path).

#### `skip.tags` — silently discard subtrees

`skip.tags` accepts the same path expression syntax as `stopNodes` (see FXP
docs for the full grammar), but instead of capturing the inner content as a
raw string, it **silently discards** the tag and its entire subtree — no
handler fires, no raw content is collected:

```js
new FastSaxParser({
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

Compare with `fxpOptions.tags.stopNodes`: both match on path expressions, but
`stopNodes` gives you the raw inner text (and fires `onStopNode`), while
`skip.tags` is a silent black-hole. Prefer `skip.tags` when you want to strip
instrumentation/debug subtrees from the event stream without writing handler
logic; prefer `stopNodes` when the raw text matters (e.g. `<script>` content
you need to forward elsewhere).

### `xmlDecl` (read after parsing)

```js
const fsp = new FastSaxParser();
fsp.parse(xmlString);
console.log(fsp.xmlDecl); // { version: 1, encoding: 'UTF-8', standalone: undefined }
```

A `saxes`-style parity property — `{ version, encoding, standalone }`,
populated unconditionally as soon as the document's `<?xml ...?>`
declaration is seen (stays `{}` if there's no declaration at all).
`encoding`/`standalone` are `undefined` if not present in the declaration;
`version` defaults to `1` per the XML spec when the declaration omits it.
Populated from the same data delivered to `onXmlDeclaration`, so it's
redundant if you're already using that callback; provided so code migrated
from `sax`/`saxes` that reads `parser.xmlDecl` off the parser instance
doesn't need to switch to a callback. Unlike ordinary element/PI attributes,
this is **not** gated by `fxpOptions.skip.attributes` — only
`fxpOptions.skip.declaration: true` suppresses it.

### Methods

```js
fsp.parse(xmlString)        // one-shot parse of a complete document (string or Buffer)
fsp.parseBytesArr(bytes)    // one-shot parse of a Uint8Array/ArrayBufferView —
                             // use this instead of parse() for raw byte input
                             // that isn't a Node Buffer (fetch().arrayBuffer(),
                             // WebSocket binary frames, browser code with no
                             // Buffer global)
fsp.write(chunk)            // feed one chunk; safe to call repeatedly, any boundary
fsp.end()                   // signal end of input after write() calls
fsp.asWritable(streamOpts)  // get a Node Writable: readStream.pipe(fsp.asWritable())
```

## Examples

See `examples/`:

- `basic.js` — one-shot parse covering start/end/text/comment/declaration
  events, including the `tagDetail`/`closeMeta` position metadata passed to
  `onStartElement`/`onEndElement`, and reading `this.matcher` for the current
  path.
- `streaming.js` — `write()`/`end()` with chunks deliberately split mid-tag and
  mid-text, to show FXP's chunk-boundary handling working transparently.
- `stop-nodes.js` — using `tags.stopNodes` to pull a subtree's raw XML as a
  single string without tokenising its contents.
- `feedable-stream.js` — piping a Node `Readable` into `asWritable()`, and
  tuning `fxpOptions.feedable` (`maxBufferSize`/`flushThreshold`) for
  long-running streaming sessions.


## Benchmarks

`npm run bench`

```
$ npm run bench

> fast-sax-parser@1.0.0 bench
> node bench/compare.js && node bench/compare-stopnodes.js

Node v22.14.0   warmup=50   measured=500

── Flat 500 elements (2 attrs + text each)  (23.4 KB, 500 iters) ──
  fast-sax-parser        977.8 ms total    1.956 ms/iter    12.2 MB/s   counts: { starts: 275550, texts: 275000, ends: 275550 }
  sax                    703.6 ms total    1.407 ms/iter    17.0 MB/s   counts: { starts: 275550, texts: 551100, ends: 275550 }
  saxes                  311.3 ms total    0.623 ms/iter    38.5 MB/s   counts: { starts: 275550, texts: 551100, ends: 275550 }

── Flat 2000 elements (2 attrs + text each)  (94.7 KB, 500 iters) ──
  fast-sax-parser       3698.0 ms total    7.396 ms/iter    13.1 MB/s   counts: { starts: 1100550, texts: 1100000, ends: 1100550 }
  sax                   2784.7 ms total    5.569 ms/iter    17.4 MB/s   counts: { starts: 1100550, texts: 2201100, ends: 1100550 }
  saxes                 1194.9 ms total    2.390 ms/iter    40.6 MB/s   counts: { starts: 1100550, texts: 2201100, ends: 1100550 }

── Flat 500 elements (8 attrs + text each)  (46.8 KB, 500 iters) ──
  fast-sax-parser       2576.6 ms total    5.153 ms/iter     9.3 MB/s   counts: { starts: 275550, texts: 275000, ends: 275550 }
  sax                   1466.3 ms total    2.933 ms/iter    16.4 MB/s   counts: { starts: 275550, texts: 551100, ends: 275550 }
  saxes                  846.4 ms total    1.693 ms/iter    28.3 MB/s   counts: { starts: 275550, texts: 551100, ends: 275550 }

── Deep nesting depth=10 breadth=2  (38.0 KB, 500 iters) ──
  fast-sax-parser       1060.3 ms total    2.121 ms/iter    18.4 MB/s   counts: { starts: 1126400, texts: 563200, ends: 1126400 }
  sax                   1308.6 ms total    2.617 ms/iter    14.9 MB/s   counts: { starts: 1126400, texts: 563200, ends: 1126400 }
  saxes                  482.7 ms total    0.965 ms/iter    40.3 MB/s   counts: { starts: 1126400, texts: 563200, ends: 1126400 }

── Mixed 300 elements (comments + CDATA)  (22.3 KB, 500 iters) ──
  fast-sax-parser        458.5 ms total    0.917 ms/iter    24.9 MB/s   counts: { starts: 165550, texts: 0, ends: 165550 }
  sax                    589.3 ms total    1.179 ms/iter    19.4 MB/s   counts: { starts: 165550, texts: 331650, ends: 165550 }
  saxes                  263.7 ms total    0.527 ms/iter    43.3 MB/s   counts: { starts: 165550, texts: 331650, ends: 165550 }
500 records, 40 levels of nesting per payload (394 KB)

FSP: { metaCount: 500, stopNodeCount: 500 }
sax: { metaCount: 500 }
fast-sax-parser (stopNodes): 252.3ms total, 12.616ms/iter
sax (manual skip)         : 749.7ms total, 37.486ms/iter

FSP is 2.97x faster than sax when skipping deep subtrees via stopNodes

```

**Bottom line:** if your documents are flat-ish and you need every tag, FSP
and `sax` are in the same ballpark — pick based on API preference and FXP's
other features (security hardening, lenient auto-close) rather than raw
speed. If your documents have large subtrees you want to skip entirely
(blobs, opaque payloads, vendor extensions you don't read), FSP's `stopNodes`
support is a genuine, measurable win that `sax` structurally cannot match.

## Implementation notes

- **Attribute names are not prefixed/suffixed.** FXP's default `addAttribute`
  bakes `attributes.prefix`/`attributes.suffix` into the object *key* (useful
  for tree builders disambiguating attributes from child elements — e.g.
  `@_id` vs `id`). FSP overrides `addAttribute` and skips this, since SAX
  consumers expect bare attribute names.
- **`onText` is not pre-concatenated.** Some SAX implementations buffer and
  join adjacent text runs before firing a callback. FSP fires once per
  underlying FXP `addValue` call, matching the tokeniser's actual granularity
  — concatenate yourself if you need a single string per element.
- **`skip.attributes` defaults to `true` in FXP itself**, not FSP. If your
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