import type { ArchiveIndexData } from '@webmidgar/formats-lgp';
import { idbDelete, idbGet, idbPut, openDb } from './idb.js';

/**
 * Cache-Stufe S0 (Masterplan Phase 2.2): Archiv-Indizes + Quellmetadaten.
 * Key-Schema: Archiv-Index unter seinem Quell-Fingerprint; die Quelle
 * (Verzeichnis) referenziert ihre Archive über deren Fingerprints.
 * Migration = Reparse statt In-place (ADR-008): unbekannte schemaVersion → Miss.
 */

const DB_NAME = 'webmidgar-s0';
const DB_VERSION = 1;
const ARCHIVES = 'archive-index';
const SOURCES = 'source-meta';

export interface SourceMeta {
  schemaVersion: 1;
  sourceFingerprint: string;
  archiveFingerprints: string[];
  savedAt: number;
}

export class S0Store {
  private db: IDBDatabase | null = null;

  private async open(): Promise<IDBDatabase> {
    this.db ??= await openDb(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(ARCHIVES)) db.createObjectStore(ARCHIVES);
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES);
    });
    return this.db;
  }

  async putArchiveIndex(index: ArchiveIndexData): Promise<void> {
    if (!index.fingerprint) throw new Error('ArchiveIndexData ohne Fingerprint nicht persistierbar');
    await idbPut(await this.open(), ARCHIVES, index, index.fingerprint);
  }

  async getArchiveIndex(fingerprint: string): Promise<ArchiveIndexData | undefined> {
    const hit = await idbGet<ArchiveIndexData>(await this.open(), ARCHIVES, fingerprint);
    if (hit && hit.schemaVersion !== 1) return undefined; // ADR-008: Miss statt Migration
    return hit;
  }

  async deleteArchiveIndex(fingerprint: string): Promise<void> {
    await idbDelete(await this.open(), ARCHIVES, fingerprint);
  }

  async putSourceMeta(meta: SourceMeta): Promise<void> {
    await idbPut(await this.open(), SOURCES, meta, meta.sourceFingerprint);
  }

  async getSourceMeta(sourceFingerprint: string): Promise<SourceMeta | undefined> {
    return idbGet<SourceMeta>(await this.open(), SOURCES, sourceFingerprint);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
