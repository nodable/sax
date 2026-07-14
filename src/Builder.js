'use strict';
import {
  BaseOutputBuilderFactory,
  ValueParserPipeline,
  SharedContext,
  Context,
} from '@nodable/base-output-builder';
import { buildOptions } from './OptionsBuilder.js';

/**
 * FXP `OutputBuilder` factory that emits SAX-style events instead of
 * building a tree.
 *
 * Value parsing (entity decoding, number/boolean coercion, whitespace
 * normalization) is delegated entirely to `@nodable/base-output-builder`'s
 * registry/pipeline machinery — extending `BaseOutputBuilderFactory` gets
 * the shared `ValueParserRegistry` and `registerValueParser()` for free.
 * `SaxBuilder` itself deliberately does NOT extend `BaseOutputBuilder`
 * (its lifecycle methods are tree-shaped — attribute prefixing, nameFor.*
 * grouping — none of which apply to sax's flat, raw-name event contract).
 */
export default class SaxBuilderFactory extends BaseOutputBuilderFactory {
  /**
   * @param {object} builderOptions
   * @param {import('./index.d.ts').SaxHandlers} [builderOptions.handlers]
   * @param {import('./index.d.ts').SaxParserOptions['valueParsers']} [builderOptions.valueParsers]
   */
  constructor(builderOptions = {}) {
    super();
    this.builderOptions = buildOptions(builderOptions);
  }

  /**
   * Called by XMLParser before each document parse to obtain a fresh builder.
   * @param {object} parserOptions
   * @param {import('path-expression-matcher').MatcherView} readonlyMatcher
   * @returns {SaxBuilder}
   */
  getInstance(parserOptions, readonlyMatcher) {
    return new SaxBuilder(parserOptions, this.builderOptions, readonlyMatcher, this.registry);
  }
}

export class SaxBuilder {
  constructor(parserOptions, builderOptions, readonlyMatcher, registry) {
    this.parserOptions = parserOptions;
    this.builderOptions = builderOptions;
    this.matcher = readonlyMatcher;
    this.handlers = builderOptions.handlers || {};

    // Per-tag attribute accumulator — flushed and zeroed on every
    // addElement/addInstruction/addDeclaration call. Never grows across
    // siblings or across documents.
    this.attributes = {};

    this._pendingStopNode = false;

    // --- value-parsing wiring (composition, not inheritance) ---
    // Fresh SharedContext + pipelines per document, same lifecycle
    // guarantee BOB gives its own tree builders: getInstance() is called
    // once per parse, so there is no risk of stale xmlVersion/inputEntities
    // leaking between documents.
    this.sharedContext = new SharedContext();
    this.tagsPipeline = new ValueParserPipeline(
      builderOptions.valueParsers.tags,
      registry,
      this.sharedContext,
    );
    this.attrsPipeline = new ValueParserPipeline(
      builderOptions.valueParsers.attributes,
      registry,
      this.sharedContext,
    );
    // Registry parsers are long-lived singletons owned by the factory
    // (e.g. EntityParser caches a decoder across parses) — reset their
    // per-document state now that fresh pipelines/context exist.
    this.tagsPipeline.resetAll();
    this.attrsPipeline.resetAll();
  }

  /**
   * Fired once per attribute, in document order, only when skip.attributes
   * is false. `value` is run through the attribute value-parser chain
   * before either the accumulator or the handler sees it.
   * @param {string} name
   * @param {*} value
   * @param {object} matcher read-only matcher from FXP
   * @param {{index: number}|undefined} attrMeta absolute document offset of the attribute name
   */
  addAttribute(name, value, matcher, attrMeta) {
    const context = new Context(name, matcher, true, true); // attributes are always leaf values
    const parsed = this.attrsPipeline.run(value, context);
    this.attributes[name] = parsed;
    this.handlers.onAttribute?.call(this, name, parsed, attrMeta);
  }

  /** @param {import('./index.d.ts').TagDetail} tag */
  addElement(tag, matcher) {
    this.handlers.onStartElement?.call(this, tag.name, this.attributes, tag);
    this.attributes = {};
  }

  /** @param {import('./index.d.ts').CloseMeta} closeMeta */
  closeElement(matcher, closeMeta) {
    this.handlers.onEndElement?.call(this, closeMeta.name, closeMeta);
    this._pendingStopNode = false;
  }

  /**
   * onText never fires for stop-node content — _pendingStopNode is set by
   * onStopNode() and cleared by closeElement(). Text is run through the tag
   * value-parser chain (entity decoding by default) before reaching the
   * handler.
   */
  addValue(text, matcher) {
    if (this._pendingStopNode) return;
    const context = new Context(matcher?.getCurrentTag?.(), matcher, null, false);
    const parsed = this.tagsPipeline.run(text, context);
    this.handlers.onText?.call(this, parsed);
  }

  /**
   * CDATA section — always its own event, never silently merged into
   * onText regardless of FXP's nameFor.cdata setting, and never run through
   * the value-parser chain: CDATA content is literal per the XML spec.
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
   * @param {string} name always "?xml"
   * @param {import('./index.d.ts').XmlDeclaration} attr FXP's parser.xmlDec scratch object
   */
  addDeclaration(name, attr) {
    // FXP delivers the declaration's own attrs directly here — no need for
    // BOB's addAttribute-then-addDeclaration(name) dance (that exists only
    // because tree builders don't get a second argument). Feed the version
    // straight into SharedContext so EntityParser can apply the right NCR
    // rules for the document's declared XML version.
    if (attr?.version) this.sharedContext.set('xmlVersion', +attr.version);

    const xmlDec = {
      version: attr.version,
      encoding: attr.encoding || undefined,
      standalone: attr.standalone || undefined,
    };
    this.handlers.onXmlDeclaration?.call(this, xmlDec);
    this.attributes = {};
  }

  /**
   * Called even when skip.declaration is true. Forwards to the user's
   * onDocType callback (unchanged) AND feeds SharedContext so the entity
   * parser can resolve DTD-declared entities on the next decode() call.
   */
  addInputEntities(entities) {
    this.sharedContext.set('inputEntities', entities);
    this.handlers.onDocType?.call(this, entities);
  }

  /**
   * Called when a stop node is fully collected, before addValue(). Sets
   * _pendingStopNode so the subsequent addValue() call skips onText.
   * rawContent is deliberately NOT run through the value-parser chain —
   * it's documented as unparsed raw XML.
   * @param {import('./index.d.ts').TagDetail} tagDetail
   * @param {string} rawContent
   * @param {object} matcher
   * @param {import('./index.d.ts').StopEnd} stopEnd
   */
  onStopNode(tagDetail, rawContent, matcher, stopEnd) {
    this._pendingStopNode = true;
    this.handlers.onStopNode?.call(this, tagDetail, rawContent, stopEnd);
  }

  /**
   * Called by the parser when exitIf returns true for the current tag.
   * @param {import('./index.d.ts').ExitInfo} exitInfo
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
