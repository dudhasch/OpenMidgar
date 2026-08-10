/**
 * Projekt-Store-Abstraktion (A-ST-8, B.1): der Speicherpfad ist
 * austauschbar — `MemoryProjectStore` für Tests/Node,
 * `IndexedDbProjectStore` als Browser-Primärpfad (eigener minimaler
 * IndexedDB-Wrapper, keine externen Dependencies; nur in Kontexten mit
 * `indexedDB` instanziierbar).
 */

export interface ProjectStore {
  load(pfad: string): Promise<Uint8Array | undefined>;
  save(pfad: string, bytes: Uint8Array): Promise<void>;
  list(): Promise<string[]>;
  delete(pfad: string): Promise<void>;
}

export class MemoryProjectStore implements ProjectStore {
  private readonly files = new Map<string, Uint8Array>();

  load(pfad: string): Promise<Uint8Array | undefined> {
    const hit = this.files.get(pfad);
    return Promise.resolve(hit ? hit.slice() : undefined);
  }

  save(pfad: string, bytes: Uint8Array): Promise<void> {
    this.files.set(pfad, bytes.slice());
    return Promise.resolve();
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].sort());
  }

  delete(pfad: string): Promise<void> {
    this.files.delete(pfad);
    return Promise.resolve();
  }

  /** Test-/Diagnosezugang. */
  get size(): number {
    return this.files.size;
  }
}

const IDB_STORE = 'files';

function idbOpen(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as DOMException);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as DOMException);
  });
}

/**
 * Browser-Primärpfad. Der Konstruktor ist bewusst lazy — die Datenbank
 * wird erst beim ersten Zugriff geöffnet; in Node (ohne `indexedDB`)
 * schlägt jeder Zugriff mit einer klaren Fehlermeldung fehl.
 */
export class IndexedDbProjectStore implements ProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = 'webmidgar-studio') {}

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new Error('IndexedDbProjectStore benötigt einen Browser-Kontext (indexedDB fehlt) — in Node MemoryProjectStore nutzen.'),
      );
    }
    this.dbPromise ??= idbOpen(this.dbName);
    return this.dbPromise;
  }

  async load(pfad: string): Promise<Uint8Array | undefined> {
    const db = await this.db();
    const hit = await idbRequest<Uint8Array | undefined>(
      db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(pfad),
    );
    return hit ? new Uint8Array(hit) : undefined;
  }

  async save(pfad: string, bytes: Uint8Array): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, pfad);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as DOMException);
    });
  }

  async list(): Promise<string[]> {
    const db = await this.db();
    const keys = await idbRequest<IDBValidKey[]>(
      db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys(),
    );
    return keys.map(String).sort();
  }

  async delete(pfad: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(pfad);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as DOMException);
    });
  }
}
