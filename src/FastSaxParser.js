'use strict';

import { Writable } from 'stream';
import XMLParser from '@nodable/flexible-xml-parser';
import FastSaxBuilderFactory from './FastSaxBuilder.js';

/**
 * FastSaxParser
 *
 * A SAX-style streaming XML parser built on top of `@nodable/flexible-xml-parser`.
 * No DOM/tree is ever built — every callback fires the instant FXP's tokeniser
 * produces the relevant token, and only O(depth) state (open tag names) is
 * retained between calls.
 *
 * @example
 * const fsp = new FastSaxParser({
 *   onStartElement(name, attrs, tag) { ... },
 *   onAttribute(name, value, attrMeta) { ... },
 *   onText(text) { ... },
 *   onEndElement(name, closeMeta) { ... },
 *   // every handler runs with `this` bound to the builder — read
 *   // `this.matcher` (a read-only path matcher) for the current position
 *   // instead of taking it as an argument.
 * });
 * fsp.write(xmlString);
 *
 * @example streaming
 * const fsp = new FastSaxParser({ onStartElement, onText, onEndElement });
 * for await (const chunk of readStream) fsp.write(chunk);
 * fsp.end();
 */
export class FastSaxParser {
  /**
   * @param {object} options
   * @param {object} [options.fxpOptions] - forwarded verbatim as XMLParser's
   *   parser options (tags.stopNodes, skip.*, limits.*, autoClose, etc.)
   * @param {object} [options.valueParsers] - { tags: [], attributes: [] }
   *   value-parser chains for the builder. Default: both empty — FSP hands
   *   you raw strings unless you opt back into FXP's entity/boolean/number
   *   coercion by naming parsers here.
   *
   * SAX event handlers (all optional). Every handler is invoked with `this`
   * bound to the FastSaxBuilder instance, so use a regular function (not an
   * arrow function) if you want `this.matcher` — a read-only
   * `path-expression-matcher` view reflecting the current position in the
   * document at the moment the handler fires.
   *
   * @param {function} [options.onStartElement]
   *   (name, attributes, tagDetail)
   *   `tagDetail` carries { name, line, col, index, openEnd } — the position
   *   of the opening tag's '<' and the offset right after its '>'.
   * @param {function} [options.onAttribute]
   *   (name, value, attrMeta)
   *   Fires once per attribute, in document order, before onStartElement.
   *   `attrMeta` is { index } — the attribute name's absolute document offset.
   * @param {function} [options.onEndElement]
   *   (name, closeMeta)
   *   `closeMeta` carries { name, line?, col?, index?, closeEnd? }. Position
   *   fields are present for real closing tags; omitted for self-closing,
   *   unpaired, stop-node, and autoClose-synthesized closes.
   * @param {function} [options.onText]         (text)
   *   NOT fired for stop-node raw content — use onStopNode for that.
   * @param {function} [options.onCData]        (text)
   * @param {function} [options.onComment]      (text)
   * @param {function} [options.onProcessingInstruction] (name, attributes)
   * @param {function} [options.onXmlDeclaration] (attributes)
   * @param {function} [options.onStopNode]
   *   (tagDetail, rawContent, stopEnd)
   *   `stopEnd` is { index, line, col } — offset right after the matched
   *   closing tag's '>'. None of onStartElement/onText/onEndElement fire
   *   for anything inside a stop node's raw content.
   * @param {function} [options.onExit]         (exitInfo)
   * @param {function} [options.onError]        (err)  not builder-bound —
   *   fired directly from the parser, outside any active matcher state.
   * @param {function} [options.onEnd]          ()
   */
  constructor(options = {}) {
    const {
      fxpOptions = {},
      valueParsers = {},
      ...handlers
    } = options;

    this._handlers = handlers;
    this._feeding = false;
    this._feedErrored = false;

    /**
     * `saxes`-style parity property: `{ version, encoding, standalone }`,
     * populated as soon as the XML declaration is encountered (stays `{}`
     * if the document has none). `encoding`/`standalone` are `undefined` if
     * not present in the declaration; `version` defaults to `1` per the XML
     * spec when the declaration omits it. Populated from the same data
     * delivered to `onXmlDeclaration`, so it's redundant with that callback
     * if you're already using it — provided mainly so code ported from
     * `sax`/`saxes` that reads `parser.xmlDecl` doesn't need to switch to a
     * callback.
     *
     * Populated regardless of `fxpOptions.skip.attributes` — the declaration's
     * own version/encoding/standalone come from FXP's dedicated declaration
     * parsing, not the ordinary attribute pipeline that `skip.attributes` gates.
     * @type {{version?: number, encoding?: string, standalone?: string}}
     */
    this.xmlDecl = {};

    const userOnXmlDeclaration = handlers.onXmlDeclaration;
    const self = this;
    handlers.onXmlDeclaration = function (attrs) {
      self.xmlDecl = {
        version: attrs?.version,
        encoding: attrs?.encoding,
        standalone: attrs?.standalone,
      };
      if (userOnXmlDeclaration) userOnXmlDeclaration.call(this, attrs);
    };

    const factory = new FastSaxBuilderFactory({
      tags: { valueParsers: valueParsers.tags ?? [] },
      attributes: { valueParsers: valueParsers.attributes ?? [] },
      handlers,
    });

    this._parser = new XMLParser({
      ...fxpOptions,
      OutputBuilder: factory,
    });
  }

  /**
   * Parse a complete XML string in one call. Convenience for non-streaming
   * use — equivalent to write() + implicit end-of-document, but uses FXP's
   * one-shot parse() path rather than feed()/end().
   *
   * @param {string} xml
   */
  parse(xml) {
    try {
      this._parser.parse(xml);
    } catch (err) {
      if (this._handlers.onError) this._handlers.onError(err);
      else throw err;
    }
  }

  /**
   * Parse a complete XML document already decoded into a byte array, in one
   * call — for inputs that are a `Uint8Array`/`ArrayBufferView` but not a
   * Node `Buffer` (e.g. `fetch().arrayBuffer()`, WebSocket binary frames,
   * browser-side code with no `Buffer` global). For a Node `Buffer`, use
   * `parse()` directly — `Buffer` already works there.
   *
   * @param {Uint8Array|ArrayBufferView} xmlBytes
   */
  parseBytesArr(xmlBytes) {
    try {
      this._parser.parseBytesArr(xmlBytes);
    } catch (err) {
      if (this._handlers.onError) this._handlers.onError(err);
      else throw err;
    }
  }

  /**
   * Feed a chunk of XML for incremental/streaming parsing. Safe to call
   * repeatedly with arbitrary chunk boundaries — FXP's mark/rewind protocol
   * handles tokens split across calls. Call end() when done.
   *
   * If a parse error occurs and onError is provided, it is called and the
   * session is marked errored — subsequent write() calls are no-ops, and
   * end() will throw. If onError is not provided, the error is re-thrown and
   * the session is likewise closed.
   *
   * @param {string} chunk
   */
  write(chunk) {
    if (this._feedErrored) return this;
    if (!this._feeding) this._feeding = true;
    try {
      this._parser.feed(chunk);
    } catch (err) {
      this._feedErrored = true;
      if (this._handlers.onError) this._handlers.onError(err);
      else throw err;
    }
    return this;
  }

  /**
   * Signal end of input for a write()-based streaming session.
   * No-op if write() was never called.
   * Throws (or calls onError) if the session ended in an error.
   */
  end() {
    if (!this._feeding) return this;
    if (this._feedErrored) {
      // Session is dead — reset state and surface the situation clearly.
      this._feeding = false;
      this._feedErrored = false;
      const err = new Error('Cannot end a feed session that ended in error. Start a new FastSaxParser instance.');
      if (this._handlers.onError) { this._handlers.onError(err); return this; }
      throw err;
    }
    try {
      this._parser.end();
    } catch (err) {
      if (this._handlers.onError) this._handlers.onError(err);
      else throw err;
    } finally {
      this._feeding = false;
      this._feedErrored = false;
    }
    return this;
  }

  /**
   * Return a Node.js Writable stream wired to this parser, so you can
   * `readStream.pipe(fsp.asWritable())`.
   *
   * @param {object} [streamOptions] - forwarded to the Writable constructor
   * @returns {Writable}
   */
  asWritable(streamOptions = {}) {
    const self = this;
    return new Writable({
      ...streamOptions,
      write(chunk, encoding, callback) {
        try {
          self.write(chunk.toString(streamOptions.defaultEncoding || 'utf8'));
          callback();
        } catch (err) {
          callback(err);
        }
      },
      final(callback) {
        try {
          self.end();
          callback();
        } catch (err) {
          callback(err);
        }
      },
    });
  }
}

export default FastSaxParser;
export { FastSaxBuilderFactory };
