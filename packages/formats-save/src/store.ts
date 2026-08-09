import { idbDelete, idbGet, idbPut, openDb } from '@webmidgar/cache';
import { acceptSlot, slotMeta, type SaveLoadOutcome, type SaveSlot, type SaveSlotMeta } from './slot.js';

/**
 * Spielstandspeicher in IndexedDB (S14). Bewusst getrennt von den
 * Asset-Caches: Ein Cache darf jederzeit verworfen werden, ein Spielstand
 * niemals. Deshalb eine eigene Datenbank statt eines weiteren Objektspeichers
 * neben den Assets — sonst würde eine Cache-Bereinigung Spielstände mitnehmen.
 */

export const SAVE_DB_NAME = 'webmidgar-saves';
export const SAVE_DB_VERSION = 1;
const STORE = 'slots';

export class SaveSlotStore {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await openDb(SAVE_DB_NAME, SAVE_DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    });
  }

  private require(): IDBDatabase {
    if (!this.db) throw new Error('SaveSlotStore.open() wurde nicht aufgerufen');
    return this.db;
  }

  async write(index: number, slot: SaveSlot): Promise<void> {
    await idbPut(this.require(), STORE, slot, index);
  }

  /**
   * Liest einen Slot und prüft ihn. Ein unlesbarer oder zu neuer Stand wird
   * abgelehnt statt halb geladen — ein falsch interpretierter Spielstand wäre
   * schlimmer als ein fehlender.
   */
  async read(index: number, expectedFingerprint?: string): Promise<SaveLoadOutcome | null> {
    const raw = await idbGet<unknown>(this.require(), STORE, index);
    if (raw === undefined) return null;
    return acceptSlot(raw, expectedFingerprint);
  }

  async remove(index: number): Promise<void> {
    await idbDelete(this.require(), STORE, index);
  }

  /** Übersicht aller belegten Slots — ohne die Nutzdaten zu laden. */
  async list(count: number): Promise<SaveSlotMeta[]> {
    const out: SaveSlotMeta[] = [];
    for (let i = 0; i < count; i++) {
      const raw = await idbGet<unknown>(this.require(), STORE, i);
      if (raw === undefined) continue;
      const outcome = acceptSlot(raw);
      if (outcome.ok) out.push(slotMeta(i, outcome.slot));
    }
    return out;
  }
}
