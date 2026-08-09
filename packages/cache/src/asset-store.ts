import type { CacheStage } from './keys.js';
import { openDb } from './idb.js';

/**
 * Persistenter Asset-Cache (Stufen S1 Rohbytes / S2 dekodierte NAMs) in
 * IndexedDB mit Byte-Budget und LRU-Sweep über einen lastAccess-Index
 * (Masterplan Phase 2.2). Payloads müssen structured-clonebar sein.
 */

const DB_NAME = 'webmidgar-assets';
const DB_VERSION = 1;
const STORE = 'assets';

interface AssetRecord {
  key: string;
  stage: CacheStage;
  byteLength: number;
  lastAccess: number;
  payload: unknown;
}

export class AssetStore {
  private db: IDBDatabase | null = null;
  /** Monotone Sequenz bricht lastAccess-Gleichstände innerhalb einer Session. */
  private seq = 0;

  constructor(private readonly budgetBytes: number = Number.POSITIVE_INFINITY) {}

  private async open(): Promise<IDBDatabase> {
    this.db ??= await openDb(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastAccess', 'lastAccess');
      }
    });
    return this.db;
  }

  private touchStamp(): number {
    // Millisekunden × 4096 + Sequenz: sessionübergreifend zeitlich geordnet,
    // innerhalb einer Session strikt monoton.
    return Date.now() * 4096 + (this.seq++ & 0xfff);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const record = req.result as AssetRecord | undefined;
        if (record) {
          record.lastAccess = this.touchStamp();
          store.put(record); // Recency-Touch in derselben Transaktion
        }
        resolve(record?.payload as T | undefined);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async put(key: string, stage: CacheStage, payload: unknown, byteLength: number): Promise<void> {
    const db = await this.open();
    const record: AssetRecord = { key, stage, byteLength, lastAccess: this.touchStamp(), payload };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (Number.isFinite(this.budgetBytes)) await this.sweep(this.budgetBytes);
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async totalBytes(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let total = 0;
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(total);
        total += (cursor.value as AssetRecord).byteLength;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Entfernt die am längsten unbenutzten Einträge, bis das Budget hält. */
  async sweep(budgetBytes: number): Promise<string[]> {
    const total = await this.totalBytes();
    if (total <= budgetBytes) return [];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const evicted: string[] = [];
      let remaining = total;
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).index('lastAccess').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || remaining <= budgetBytes) return; // tx.oncomplete löst auf
        const record = cursor.value as AssetRecord;
        remaining -= record.byteLength;
        evicted.push(record.key);
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(evicted);
      tx.onerror = () => reject(tx.error);
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
