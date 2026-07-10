'use strict';

/**
 * FXP `OutputBuilder` factory that emits SAX-style events instead of
 * building a tree.
 */
export default class SaxBuilderFactory {
  /**
   * @param {object} builderOptions
   * @param {import('./index.d.ts').SaxHandlers} [builderOptions.handlers]
   */
  constructor(builderOptions = {}) {
    // No defaults to merge — a builder only ever needs the caller's handler
    // bag, verbatim. The deep-clone/deep-merge machinery this used to go
    // through (copied from FXP's own OptionsBuilder, which does need it for
    // its much larger, nested options object) had nothing to actually merge
    // here, so it's gone: this is the whole "build" step now.
    this.builderOptions = { handlers: builderOptions.handlers || {} };
  }

  /**
   * Called by XMLParser before each document parse to obtain a fresh builder.
   * @param {object} parserOptions
   * @param {import('path-expression-matcher').MatcherView} readonlyMatcher
   * @returns {SaxBuilder}
   */
  getInstance(parserOptions, readonlyMatcher) {
    return new SaxBuilder(parserOptions, this.builderOptions, readonlyMatcher);
  }
}

export class SaxBuilder {
  constructor(parserOptions, builderOptions, readonlyMatcher) {
    this.parserOptions = parserOptions;
    this.builderOptions = builderOptions;
    this.matcher = readonlyMatcher;
    this.handlers = builderOptions.handlers || {};

    // Per-tag attribute accumulator — flushed and zeroed on every
    // addElement/addInstruction/addDeclaration call. Never grows across
    // siblings or across documents.
    this.attributes = {};

    this._pendingStopNode = false;
  }

  /**
   * Fired once per attribute, in document order, only when skip.attributes
   * is false.
   * @param {string} name
   * @param {*} value
   * @param {object} matcher read-only matcher from FXP
   * @param {{index: number}|undefined} attrMeta absolute document offset of the attribute name
   */
  addAttribute(name, value, matcher, attrMeta) {
    this.attributes[name] = value;
    this.handlers.onAttribute?.call(this, name, value, attrMeta);
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
   * onStopNode() and cleared by closeElement().
   */
  addValue(text, matcher) {
    if (this._pendingStopNode) return;
    this.handlers.onText?.call(this, text);
  }

  /**
   * CDATA section — always its own event, never silently merged into
   * onText regardless of FXP's nameFor.cdata setting.
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
    const xmlDec = {
      version: attr.version,
      encoding: attr.encoding || undefined,
      standalone: attr.standalone || undefined,
    };
    this.handlers.onXmlDeclaration?.call(this, xmlDec);
    this.attributes = {};
  }

  /** Called even when skip.declaration is true. */
  addInputEntities(entities) {
    this.handlers.onDocType?.call(this, entities);
  }

  /**
   * Called when a stop node is fully collected, before addValue(). Sets
   * _pendingStopNode so the subsequent addValue() call skips onText.
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
