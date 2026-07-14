import { Writable } from 'stream';

export interface TagDetail {
  name: string;
  line: number;
  col: number;
  index: number;
  openEnd: number;
}

export interface CloseMeta {
  name: string;
  line?: number;
  col?: number;
  index?: number;
  closeEnd?: number;
}

export interface AttrMeta {
  index: number;
}

export interface StopEnd {
  index: number;
  line: number;
  col: number;
}

export interface XmlDeclaration {
  version?: number;
  encoding?: string;
  standalone?: string;
}

export interface ExitInfo {
  tagDetail: { name: string; index: number };
  matcher: unknown;
  depth: number;
}

export interface ValueParser {
  parse(value: unknown, ctx?: unknown): unknown;
  reset(): void;
}

export interface SaxHandlers {
  onAttribute?(this: SaxBuilder, name: string, value: unknown, attrMeta: AttrMeta | undefined): void;
  onStartElement?(this: SaxBuilder, name: string, attributes: Record<string, unknown>, tagDetail: TagDetail): void;
  onEndElement?(this: SaxBuilder, name: string, closeMeta: CloseMeta): void;
  onText?(this: SaxBuilder, text: string): void;
  onCData?(this: SaxBuilder, text: string): void;
  onComment?(this: SaxBuilder, text: string): void;
  onProcessingInstruction?(this: SaxBuilder, name: string, attributes: Record<string, unknown>): void;
  onXmlDeclaration?(this: SaxBuilder, attrs: XmlDeclaration): void;
  onStopNode?(this: SaxBuilder, tagDetail: TagDetail, rawContent: string, stopEnd: StopEnd): void;
  onExit?(this: SaxBuilder, exitInfo: ExitInfo): void;
  onDocType?(this: SaxBuilder, entities: Record<string, string>): void;
  onError?(err: Error): void;
  onEnd?(this: SaxBuilder): void;
}

export interface SaxParserOptions extends SaxHandlers {
  // Forwarded verbatim as XMLParser's parser options — tags.stopNodes,
  // skip.*, limits.*, autoClose, doctypeOptions, feedable.*, etc.
  fxpOptions?: Record<string, unknown>;
  /**
   * Ordered value-parser chain run over tag text / attribute values before
   * they reach any handler. Backed by `@nodable/base-output-builder`'s
   * registry — built-in names: 'entity', 'ws', 'boolean', 'number', 'trim'.
   * Default: `{ tags: ['entity'], attributes: ['entity'] }` — decodes
   * `&lt;`/`&#60;`-style references only. Pass `[]` to disable entirely.
   * Register custom parsers via `SaxParser.registerValueParser()`.
   */
  valueParsers?: {
    tags?: Array<string | ValueParser>;
    attributes?: Array<string | ValueParser>;
  };
}

export class SaxParser {
  constructor(options?: SaxParserOptions);
  xmlDecl: XmlDeclaration;
  parse(xml: string | Buffer): void;
  parseBytesArr(xmlBytes: Uint8Array | ArrayBufferView): void;
  write(chunk: string | Buffer): this;
  end(): this;
  asWritable(streamOptions?: object): Writable;
  /** Passthrough to the internal SaxBuilderFactory — see SaxBuilderFactory.registerValueParser. */
  registerValueParser(name: string, parserInstance: ValueParser): void;
}

export interface SaxBuilderOptions {
  handlers?: SaxHandlers;
  valueParsers?: SaxParserOptions['valueParsers'];
}

export class SaxBuilder {
  constructor(parserOptions: object, builderOptions: SaxBuilderOptions, readonlyMatcher: unknown);
  matcher: unknown;
  attributes: Record<string, unknown>;
  addAttribute(name: string, value: unknown, matcher: unknown, attrMeta: AttrMeta | undefined): void;
  addElement(tag: TagDetail, matcher: unknown): void;
  closeElement(matcher: unknown, closeMeta: CloseMeta): void;
  addValue(text: string, matcher: unknown): void;
  addLiteral(text: string): void;
  addComment(text: string): void;
  addInstruction(name: string): void;
  addDeclaration(name: string, attr: XmlDeclaration): void;
  addInputEntities(entities: Record<string, string>): void;
  onStopNode(tagDetail: TagDetail, rawContent: string, matcher: unknown, stopEnd: StopEnd): void;
  onExit(exitInfo: ExitInfo): void;
  getOutput(): undefined;
}

export class SaxBuilderFactory {
  constructor(builderOptions?: SaxBuilderOptions);
  getInstance(parserOptions: object, readonlyMatcher: unknown): SaxBuilder;
  /**
   * Add or replace a named value parser in the shared registry (from
   * `@nodable/base-output-builder`). Takes effect for all builder instances
   * created after this call.
   */
  registerValueParser(name: string, parserInstance: ValueParser): void;
}

export default SaxParser;
