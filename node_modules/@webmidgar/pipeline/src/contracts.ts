import type { FieldParseResult } from '@webmidgar/formats-field';

/**
 * Versionierter Nachrichtenvertrag der Worker-Pipeline (Masterplan Phase 2.1).
 * Alle Nachrichten sind diskriminierte Records mit requestId-Korrelation;
 * jede Anfrage trägt die Field-Generation für die Abbruchsemantik.
 */

export const PIPELINE_PROTOCOL_VERSION = 1;

export interface ParseFieldPayload {
  fieldId: string;
  /** Komprimierter Eintrag (LZS-Rahmen) — als Transferable vorgesehen. */
  bytes: ArrayBuffer;
  /** Nur für Abbruch-Injektionstests: künstliche Verzögerung vor dem Parse. */
  delayMs?: number;
}

/** Textur-Stub (S3-Nicht-Ziel: echte Dekoder) — mehrstufig für Abbruchtests. */
export interface DecodeTexturePayload {
  width: number;
  height: number;
  stages?: number;
}

export interface DecodedTextureStub {
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export type PipelineRequest =
  | {
      v: 1;
      kind: 'parse-field';
      requestId: number;
      generation: number;
      payload: ParseFieldPayload;
      /** SAB-optionaler Abbruchkanal (ADR-003): Int32 an Index 0, 1 = abgebrochen. */
      abortFlag?: SharedArrayBuffer;
    }
  | {
      v: 1;
      kind: 'decode-texture';
      requestId: number;
      generation: number;
      payload: DecodeTexturePayload;
      abortFlag?: SharedArrayBuffer;
    }
  | { v: 1; kind: 'abort'; requestId: number };

export type PipelineResponse =
  | { v: 1; kind: 'result'; requestId: number; payload: FieldParseResult | DecodedTextureStub }
  | { v: 1; kind: 'aborted'; requestId: number }
  | { v: 1; kind: 'fault'; requestId: number; code: string; message: string };

export class PipelineFault extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
