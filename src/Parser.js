'use strict';

import { Writable } from 'stream';
import XMLParser from '@nodable/flexible-xml-parser';
import SaxBuilderFactory from './Builder.js';

/**
 * SAX-style streaming XML parser built on `@nodable/flexible-xml-parser`.
 * No DOM/tree is ever built — every callback fires the instant FXP's
 * tokeniser produces the relevant token, and only O(depth) state (open tag
 * names) is retained between calls.
 */
export class SaxParser {
  /** @param {import('./index.d.ts').SaxParserOptions} [options] */
  constructor(options = {}) {
    const { fxpOptions = {}, valueParsers, ...handlers } = options;

    this._handlers = handlers;
    this._feeding = false;
    this._feedErrored = false;

    /**
     * saxes-style parity property, populated once the XML declaration (if
     * any) is seen. Redundant with onXmlDeclaration if you're already using
     * that callback — provided so code ported from sax/saxes that reads
     * parser.xmlDecl off the instance doesn't need to switch to a callback.
     * @type {import('./index.d.ts').XmlDeclaration}
     */
    this.xmlDecl = {};

    const userOnXmlDeclaration = handlers.onXmlDeclaration;
    const self = this;
    handlers.onXmlDeclaration = function (attrs) {
      self.xmlDecl = {
        version: attrs.version,
        encoding: attrs.encoding,
        standalone: attrs.standalone,
      };
      if (userOnXmlDeclaration) userOnXmlDeclaration.call(this, attrs);
    };

    const factory = new SaxBuilderFactory({ handlers, valueParsers });
    this._builderFactory = factory;

    this._parser = new XMLParser({
      ...fxpOptions,
      OutputBuilder: factory,
    });
  }

  /**
   * Add or replace a named value parser (e.g. swap the default 'entity'
   * parser for one with custom `namedEntities`/`onInputEntity`, or register
   * a new name entirely). Takes effect for all documents parsed after this
   * call. See `@nodable/base-output-builder`'s `BaseValueParser` to write a
   * custom one.
   * @param {string} name
   * @param {import('./index.d.ts').ValueParser} parserInstance
   */
  registerValueParser(name, parserInstance) {
    this._builderFactory.registerValueParser(name, parserInstance);
  }

  /**
   * One-shot parse of a complete document.
   * @param {string|Buffer} xml
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
   * One-shot parse of a Uint8Array/ArrayBufferView that isn't a Node Buffer
   * (fetch().arrayBuffer(), WebSocket binary frames, browser code with no
   * Buffer global). Use parse() directly for a Node Buffer.
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
   * Feed one chunk for incremental/streaming parsing. Safe to call
   * repeatedly at any chunk boundary — FXP's mark/rewind protocol handles
   * tokens split across calls. Call end() when done.
   *
   * On a parse error: if onError is provided, it's called and the session is
   * marked errored (further write() calls become no-ops, end() throws/calls
   * onError too). If onError is not provided, the error is re-thrown and the
   * session is likewise closed.
   * @param {string|Buffer} chunk
   * @returns {this}
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
   * Signal end of input for a write()-based streaming session. No-op if
   * write() was never called. Throws (or calls onError) if the session
   * already ended in error.
   * @returns {this}
   */
  end() {
    if (!this._feeding) return this;
    if (this._feedErrored) {
      this._feeding = false;
      this._feedErrored = false;
      const err = new Error('Cannot end a feed session that ended in error. Start a new SaxParser instance.');
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
   * A Node.js Writable stream wired to this parser: readStream.pipe(p.asWritable())
   * @param {object} [streamOptions] forwarded to the Writable constructor
   * @returns {Writable}
   */
  asWritable(streamOptions = {}) {
    const self = this;
    return new Writable({
      ...streamOptions,
      write(chunk, encoding, callback) {
        try {
          // Pass the chunk through untouched (Buffer or string). feed()
          // already decodes Buffers via a persistent StringDecoder, so a
          // multi-byte character split across two chunks decodes correctly.
          // Converting with chunk.toString() here first would decode each
          // chunk in isolation instead (silent corruption on a split
          // character) and is also a redundant encode/decode round-trip.
          self.write(chunk);
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

export default SaxParser;
