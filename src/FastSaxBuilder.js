'use strict';

import { buildOptions } from './SaxOptionsBuilder.js';
import {
  SharedContext,
  ValueParserPipeline,
  ValueParserRegistry,
  Context,
} from '@nodable/base-output-builder';

/**
 * FastSaxBuilderFactory
 *
 * A `XMLParser.OutputBuilder` for `@nodable/flexible-xml-parser` that emits
 * classic SAX-style events instead of building a tree. No tree is ever
 * retained — every callback fires the instant FXP's tokeniser produces the
 * relevant piece, and per-tag state (`attributes`) is discarded the moment
 * it's been handed off.
 *
 * Does NOT extend BaseOutputBuilderFactory — inheriting from it added
 * `registerValueParser` and the shared `registry` field but required pulling
 * in a larger base-class module. Both are inlined here directly.
 *
 * `parserOptions` (skip.*, nameFor.*, attributes.prefix/suffix, etc.) are
 * supplied separately to `XMLParser` and forwarded here automatically by
 * FXP via `getInstance(parserOptions, matcher)` — see SaxOptionsBuilder.js
 * for why they are NOT duplicated in builder options.
 */
export default class FastSaxBuilderFactory {
  /**
   * @param {object} builderOptions
   * @param {object} [builderOptions.tags]       - { valueParsers: [] }
   * @param {object} [builderOptions.attributes] - { valueParsers: [] }
   * @param {object} builderOptions.handlers     - SAX event callback bag
   */
  constructor(builderOptions = {}) {
    this.builderOptions = buildOptions(builderOptions);
    /** @type {ValueParserRegistry} */
    this.registry = new ValueParserRegistry();
  }

  /**
   * Add or replace a named value parser in the shared registry.
   * Takes effect for all builder instances created after this call.
   *
   * @param {string} name
   * @param {object} parserInstance  Must implement `parse(val, context?)`
   */
  registerValueParser(name, parserInstance) {
    this.registry.register(name, parserInstance);
  }

  /**
   * Called by XMLParser before each document parse to obtain a fresh builder.
   *
   * @param {object} parserOptions
   * @param {import('path-expression-matcher').MatcherView} readonlyMatcher
   * @returns {FastSaxBuilder}
   */
  getInstance(parserOptions, readonlyMatcher) {
    return new FastSaxBuilder(
      parserOptions,
      this.builderOptions,
      readonlyMatcher,
      this.registry,
    );
  }
}

export class FastSaxBuilder {
  /**
   * Does NOT extend BaseOutputBuilder. All state that was inherited is either
   * inlined below (sharedContext, pipelines, _pendingStopNode) or eliminated:
   *
   * - `_rootName` / xmlVersion capture inside addAttribute: dead code since
   *   addDeclaration now receives the xmlDec object directly from FXP and sets
   *   sharedContext.xmlVersion itself. Removed.
   * - `addRawValue` / `_addChild`: only called from BaseOutputBuilder's own
   *   addComment/addLiteral, both of which FastSaxBuilder overrides fully.
   *   Never called in FSP's path. Removed.
   * - `tagNameStack` push/pop: only feeds `this.tagName`, which only feeds the
   *   `Context` object passed to `attrsPipeline.run()` / `tagsPipeline.run()`.
   *   When both chains are empty the pipelines are bypassed entirely and
   *   Context is never constructed, so tagName tracking is skipped too.
   *
   * Hot-path optimizations vs the inherited version:
   * 1. `addAttribute` with empty chain: raw assignment, no Context alloc, no
   *    pipeline call.
   * 2. `addValue` with empty chain: direct onText call, no Context alloc, no
   *    pipeline call.
   * 3. Constructor: skips pipeline.resetAll() (no-op on empty chains) and the
   *    base-class super() call overhead.
   *
   * @param {object}        parserOptions
   * @param {object}        builderOptions
   * @param {import('path-expression-matcher').MatcherView} readonlyMatcher
   * @param {ValueParserRegistry} registry
   */
  constructor(parserOptions, builderOptions, readonlyMatcher, registry) {
    this.parserOptions = parserOptions;
    this.builderOptions = builderOptions;
    this.matcher = readonlyMatcher;
    this.handlers = builderOptions.handlers || {};

    const tagChain = builderOptions?.tags?.valueParsers ?? [];
    const attrChain = builderOptions?.attributes?.valueParsers ?? [];

    /**
     * True when the tag value-parser chain is empty — addValue takes a
     * branch that skips pipeline invocation and Context allocation entirely.
     * @type {boolean}
     */
    this._emptyTagsPipeline = tagChain.length === 0;

    /**
     * True when the attribute value-parser chain is empty — addAttribute
     * takes a branch that skips pipeline invocation and Context allocation.
     * @type {boolean}
     */
    this._emptyAttrsPipeline = attrChain.length === 0;

    /**
     * Shared mutable context distributed to all value parsers.
     * Only allocated when at least one pipeline is non-empty; otherwise kept
     * null and the addDeclaration xmlVersion write is simply skipped (no
     * EntityParser registered, so no consumer of that value).
     * @type {SharedContext|null}
     */
    this.sharedContext = (!this._emptyTagsPipeline || !this._emptyAttrsPipeline)
      ? new SharedContext()
      : null;

    /**
     * Pipeline for tag text values. null when chain is empty.
     * @type {ValueParserPipeline|null}
     */
    this.tagsPipeline = this._emptyTagsPipeline
      ? null
      : new ValueParserPipeline(tagChain, registry, this.sharedContext);

    /**
     * Pipeline for attribute values. null when chain is empty.
     * @type {ValueParserPipeline|null}
     */
    this.attrsPipeline = this._emptyAttrsPipeline
      ? null
      : new ValueParserPipeline(attrChain, registry, this.sharedContext);

    // Reset all stateful parsers in the chains (e.g. EntityParser caches
    // doc-level entities and must be reset between documents).
    this.tagsPipeline?.resetAll();
    this.attrsPipeline?.resetAll();

    // Per-tag attribute accumulator — flushed and zeroed on every
    // addElement/addInstruction/addDeclaration call. Never grows across
    // siblings or across documents.
    this.attributes = {};

    // Open ancestor tag names — only kept when at least one pipeline is
    // non-empty, since tagName is only used to construct the Context object
    // passed to pipeline.run(). When both pipelines are empty, tagName is
    // never read, so we skip the stack entirely.
    if (!this._emptyTagsPipeline || !this._emptyAttrsPipeline) {
      /** @type {string[]} */
      this.tagNameStack = [];
      /** @type {string} */
      this.tagName = null;
    }

    this._pendingStopNode = false;
  }

  /**
   * Called by FXP for each attribute on an opening tag (only when
   * `skip.attributes` is false).
   *
   * Fast path (empty attrChain): raw value assignment + onAttribute — no
   * Context allocation, no pipeline invocation.
   *
   * Full path (non-empty attrChain): runs the attribute value through the
   * pipeline, then accumulates it and fires onAttribute — same semantics as
   * before, just without the base-class prefix/suffix key transformation
   * (SAX consumers expect bare attribute names).
   *
   * @param {string}                    name
   * @param {*}                         value
   * @param {object}                    matcher   Read-only matcher from FXP
   * @param {{index: number}|undefined} attrMeta  Absolute document offset of
   *   the attribute name's first character (FXP v1.5.0+).
   */
  addAttribute(name, value, matcher, attrMeta) {
    if (this._emptyAttrsPipeline) {
      this.attributes[name] = value;
    } else {
      const context = new Context(name, matcher, true, true);
      value = this.attrsPipeline.run(value, context);
      this.attributes[name] = value;
    }
    this.handlers.onAttribute?.call(this, name, value, attrMeta);
  }

  /**
   * @param {import('../..').TagDetail} tag - name, line, col, index, openEnd
   * @param {object} matcher
   */
  addElement(tag, matcher) {
    if (this.tagNameStack) {
      this.tagNameStack.push(this.tagName);
      this.tagName = tag.name;
    }
    this.handlers.onStartElement?.call(this, tag.name, this.attributes, tag);
    this.attributes = {};
  }

  /**
   * @param {object}                                         matcher
   * @param {{name, line?, col?, index?, closeEnd?}|undefined} closeMeta
   *   Position info for the closing tag (FXP v1.5.0+). Always carries `name`;
   *   carries position fields only when a real closing tag was read.
   */
  closeElement(matcher, closeMeta) {
    const name = closeMeta?.name ?? (this.tagNameStack ? this.tagName : undefined);
    this.handlers.onEndElement?.call(this, name, closeMeta);
    if (this.tagNameStack) this.tagName = this.tagNameStack.pop();
    this._pendingStopNode = false;
  }

  /**
   * Fast path (empty tagsChain): fire onText directly — no Context alloc,
   * no pipeline call.
   *
   * Full path (non-empty tagsChain): run text through pipeline then fire.
   *
   * NOTE: none of onStartElement/onText/onEndElement fire for stop-node
   * content — _pendingStopNode is set by onStopNode() and cleared by
   * closeElement().
   */
  addValue(text, matcher) {
    if (this._pendingStopNode) return;
    if (this._emptyTagsPipeline) {
      this.handlers.onText?.call(this, text);
    } else {
      const context = new Context(this.tagName, matcher, null, false);
      const parsed = this.tagsPipeline.run(text, context);
      this.handlers.onText?.call(this, parsed);
    }
  }

  /**
   * CDATA section. Overrides BaseOutputBuilder's fallback-to-addRawValue
   * path — SAX consumers want to know a CDATA section is a CDATA section,
   * not have it silently merged into onText.
   */
  addLiteral(text) {
    if (this.parserOptions.skip?.cdata) return;
    this.handlers.onCData?.call(this, text);
  }

  addComment(text) {
    if (this.parserOptions.skip?.comment) return;
    this.handlers.onComment?.call(this, text);
  }

  addInstruction(name) {
    this.handlers.onProcessingInstruction?.call(this, name, this.attributes);
    this.attributes = {};
  }

  /**
   * FXP (>=1.6.0) always passes the declaration's own data via `attr` here,
   * regardless of `skip.attributes` — `attr` is FXP's internal `parser.xmlDec`
   * scratch object, not run through the `flushAttributes()`/`addAttribute()`
   * path that `skip.attributes` gates. So `onXmlDeclaration`/`xmlDecl` are
   * populated unconditionally; `skip.attributes` only affects ordinary
   * element/PI attributes.
   *
   * `parser.xmlDec` carries init scaffolding (`lang: null`, never set from
   * the document) and defaults `version`/`standalone` even when the declaration
   * omits them. FSP normalizes to its documented `{version, encoding, standalone}`
   * contract here rather than leaking FXP's internal defaults.
   *
   * @param {string} name - always "?xml"
   * @param {{version?: number, lang?: null, encoding?: string|null, standalone?: string}} attr
   *   FXP's `parser.xmlDec` scratch object.
   */
  addDeclaration(name, attr) {
    const xmlDecl = {
      version: attr.version === 1.1 ? 1.1 : 1,
      encoding: attr.encoding ?? undefined,
      standalone: attr.standalone ?? undefined,
    };
    this.sharedContext?.set('xmlVersion', xmlDecl.version);
    this.handlers.onXmlDeclaration?.call(this, xmlDecl);
    this.attributes = {};
  }

  /**
   * Receive DOCTYPE entities from FXP and store them in SharedContext so
   * that value parsers (e.g. EntityParser) can access them on their first
   * `parse()` call. Called even when skip.declaration is true.
   *
   * @param {object} entities — raw entity map from DocTypeReader
   */
  addInputEntities(entities) {
    this.sharedContext?.set('inputEntities', entities);
  }

  /**
   * Called when a stop node is fully collected, before `addValue`. Sets
   * `_pendingStopNode` so the subsequent addValue() call skips the pipeline
   * and onText entirely.
   *
   * @param {import('../..').TagDetail}   tagDetail
   * @param {string}                      rawContent
   * @param {object}                      matcher
   * @param {{index, line, col}|undefined} stopEnd  Offset right after the
   *   matched closing tag's '>' (FXP v1.5.0+).
   */
  onStopNode(tagDetail, rawContent, matcher, stopEnd) {
    this._pendingStopNode = true;
    this.handlers.onStopNode?.call(this, tagDetail, rawContent, stopEnd);
  }

  /**
   * Called by the parser when `exitIf` returns true for the current tag.
   *
   * @param {object} exitInfo
   * @param {object} exitInfo.tagDetail  `{ name, line, col, index }` of the tag that triggered the exit
   * @param {object} exitInfo.matcher    Read-only matcher at the moment exitIf fired
   * @param {number} exitInfo.depth      Nesting depth at exit
   */
  onExit(exitInfo) {
    this.handlers.onExit?.call(this, exitInfo);
  }

  getOutput() {
    this.handlers.onEnd?.call(this);
    // SAX has no return value — all output happens via callback side effects.
    return undefined;
  }
}
