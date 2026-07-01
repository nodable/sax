```
fast-sax-parser/
├── README.md
├── package.json
├── index.js                          # public entry — re-exports FastSaxParser, FastSaxBuilderFactory, FastSaxBuilder
├── src/
│   ├── FastSaxParser.js              # public class: parse()/parseBytesArr()/write()/end()/asWritable() — wraps XMLParser + the factory
│   ├── FastSaxBuilder.js             # FastSaxBuilder + FastSaxBuilderFactory — the actual SAX-emitting output builder
│   └── SaxOptionsBuilder.js          # builder-options defaults/merge (valueParsers chains + handlers bag only)
├── examples/
│   ├── basic.js                      # one-shot parse() — start/end/text/comment/declaration events, this.matcher, xmlDecl
│   ├── streaming.js                  # write()/end() with chunks split mid-tag and mid-text
│   ├── stop-nodes.js                 # tags.stopNodes — raw subtree content via onStopNode
│   └── feedable-stream.js            # asWritable() + Readable.pipe(), tuning fxpOptions.feedable
├── bench/
│   ├── compare.js                    # general start/end/text throughput vs sax, several document sizes
│   └── compare-stopnodes.js          # the stopNodes scenario specifically — where FSP's real edge shows up
└── test/
    └── fast-sax-parser.test.js       # 32 automated tests, run via `node --test`
```