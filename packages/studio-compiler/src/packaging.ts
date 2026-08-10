/**
 * Deterministische `.wmmod`-Paketierung (A-ST-3, B.3): ZIP-Container
 * via fflate mit sortierten Einträgen, festen DOS-Epoch-Zeitstempeln
 * und fester Kompressionsstufe — gleicher Projektstand erzeugt ein
 * byteidentisches Paket (Doppellauf-Digest). Jede Paketdatei trägt eine
 * Provenienz (`user-asset` aus `assets/` oder `generated` vom Compiler);
 * das Paket-Audit listet sie vollständig mit Bytezahl und SHA-256.
 */

import { zipSync, type Zippable } from 'fflate';
import { sha256Hex } from './hash.js';

export type PaketHerkunft = 'user-asset' | 'generated';

export interface PaketDatei {
  /** Pfad im Paket (`manifest.json`, `content/…`). */
  pfad: string;
  herkunft: PaketHerkunft;
  bytes: Uint8Array;
}

export interface PaketAudit {
  pfad: string;
  herkunft: PaketHerkunft;
  bytes: number;
  sha256: string;
}

/**
 * Fester ZIP-Zeitstempel: DOS-Epoch 1980-01-01 00:00:00. fflate wertet
 * `mtime` über lokale Date-Komponenten aus — die lokale Konstruktion
 * macht den DOS-Zeitstempel zeitzonenunabhängig konstant.
 */
export const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);

/** Feste Deflate-Stufe für reproduzierbare Kompression. */
export const ZIP_LEVEL = 6;

/**
 * Paketiert die Dateien deterministisch zu einem `.wmmod`-ZIP und
 * liefert das vollständige Paket-Audit (B.7: Schlussphase listet jede
 * Paketdatei mit Herkunft).
 */
export async function paketiere(dateien: PaketDatei[]): Promise<{ paket: Uint8Array; audit: PaketAudit[] }> {
  const sortiert = [...dateien].sort((a, b) => a.pfad.localeCompare(b.pfad));
  const zippable: Zippable = {};
  for (const datei of sortiert) {
    zippable[datei.pfad] = [datei.bytes, { mtime: ZIP_MTIME, level: ZIP_LEVEL }];
  }
  const paket = zipSync(zippable);
  const audit: PaketAudit[] = [];
  for (const datei of sortiert) {
    audit.push({
      pfad: datei.pfad,
      herkunft: datei.herkunft,
      bytes: datei.bytes.byteLength,
      sha256: await sha256Hex(datei.bytes),
    });
  }
  return { paket, audit };
}
