/**
 * Studio-Projektmodell (A-ST-4): verwaltet die Menge der Dokumente
 * (Pfad → Dokument), den Referenzgraphen (welche Dokumente referenzieren
 * welche IDs) sowie Autosave mit Crash-Journal. Alle Inhalts-Mutationen
 * laufen über den Command-Bus.
 */

import { CommandBus, type Command, type CommandBusOptions, type DocumentHost } from './commands.js';
import {
  documentKindForPath,
  migrateDocument,
  type BattleDoc,
  type CharacterDoc,
  type DialogueDoc,
  type DocumentKind,
  type EnemyDoc,
  type FieldDoc,
  type ProjectDoc,
  type ScriptGraphDoc,
  type VariablesDoc,
} from './documents.js';
import { canonicalJson, utf8Bytes, utf8Decode } from './json.js';
import type { ProjectStore } from './store.js';

export const JOURNAL_PREFIX = '.journal/';
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 1500;

export interface MigrationBerichtEintrag {
  pfad: string;
  von: number;
  nach: number;
  ok: boolean;
  meldung?: string | undefined;
}

/** Referenzgraph: IDs → lieferndes Dokument; Dokument → referenzierte IDs. */
export interface ReferenceGraph {
  provides: Map<string, string>;
  references: Map<string, string[]>;
  /** Provides-Liste eines Dokuments (sortiert) — Basis des Inkremental-Diffs. */
  providesOf(pfad: string): string[];
}

export class StudioProject implements DocumentHost {
  readonly bus: CommandBus;
  /** Bericht der beim Öffnen gelaufenen Migrationen (B.1: explizit, nie still). */
  readonly migrationsBericht: MigrationBerichtEintrag[] = [];
  private readonly docs = new Map<string, unknown>();
  private readonly dirty = new Set<string>();
  private readonly listeners = new Set<(pfad: string) => void>();

  constructor(options?: CommandBusOptions) {
    this.bus = new CommandBus(this, options);
    this.bus.subscribe((pfad) => {
      this.dirty.add(pfad);
      this.emit(pfad);
    });
  }

  /** Lädt alle Projektdokumente aus einem Store und migriert sie einmalig. */
  static async open(store: ProjectStore): Promise<StudioProject> {
    const project = new StudioProject();
    const paths = (await store.list()).filter(
      (p) => p.endsWith('.json') && !p.startsWith(JOURNAL_PREFIX) && !p.startsWith('build/'),
    );
    for (const pfad of paths.sort()) {
      const kind = documentKindForPath(pfad);
      if (!kind) continue;
      const bytes = await store.load(pfad);
      if (!bytes) continue;
      const parsed: unknown = JSON.parse(utf8Decode(bytes));
      try {
        const res = migrateDocument(kind, parsed);
        project.docs.set(pfad, res.doc);
        if (res.migriert) {
          project.migrationsBericht.push({ pfad, von: res.von, nach: res.nach, ok: true });
        }
      } catch (err) {
        project.migrationsBericht.push({
          pfad,
          von: -1,
          nach: -1,
          ok: false,
          meldung: err instanceof Error ? err.message : String(err),
        });
        project.docs.set(pfad, parsed);
      }
    }
    return project;
  }

  /* --- DocumentHost (Command-Bus) --- */

  get(pfad: string): unknown {
    return this.docs.get(pfad);
  }

  set(pfad: string, doc: unknown): void {
    this.docs.set(pfad, doc);
  }

  /* --- Dokumentbestand --- */

  documents(): string[] {
    return [...this.docs.keys()].sort();
  }

  getDocument<T = unknown>(pfad: string): T | undefined {
    return this.docs.get(pfad) as T | undefined;
  }

  documentKind(pfad: string): DocumentKind | null {
    return documentKindForPath(pfad);
  }

  /** Strukturelle Operation (kein Undo) — Dokument neu anlegen. */
  addDocument(pfad: string, doc: unknown): void {
    if (this.docs.has(pfad)) throw new Error(`Dokument existiert bereits: ${pfad}`);
    this.docs.set(pfad, doc);
    this.dirty.add(pfad);
    this.emit(pfad);
  }

  /** Strukturelle Operation (kein Undo) — Dokument entfernen. */
  removeDocument(pfad: string): void {
    if (!this.docs.delete(pfad)) return;
    this.dirty.delete(pfad);
    this.emit(pfad);
  }

  /** Einziger Inhalt-Mutationsweg: benanntes Command über den Bus. */
  mutate<T>(pfad: string, command: Command<T>): void {
    this.bus.dispatch(pfad, command);
  }

  /** Wiederhergestellten Stand einsetzen (Crash-Journal), als dirty markiert. */
  applyRecovered(pfad: string, doc: unknown): void {
    this.docs.set(pfad, doc);
    this.dirty.add(pfad);
    this.emit(pfad);
  }

  /** Änderungsbenachrichtigung (Autosave, UI-Invalidierung). */
  subscribe(listener: (pfad: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(pfad: string): void {
    for (const listener of this.listeners) listener(pfad);
  }

  dirtyPaths(): string[] {
    return [...this.dirty].sort();
  }

  markClean(pfade?: Iterable<string>): void {
    if (pfade === undefined) {
      this.dirty.clear();
      return;
    }
    for (const p of pfade) this.dirty.delete(p);
  }

  /* --- Referenzgraph (B.2: Referenzen als IDs) --- */

  referenceGraph(): ReferenceGraph {
    const modId = this.modId();
    const provides = new Map<string, string>();
    const perDocProvides = new Map<string, string[]>();
    const references = new Map<string, string[]>();
    for (const pfad of this.documents()) {
      const kind = documentKindForPath(pfad);
      if (!kind) continue;
      const { provides: prov, references: refs } = extractReferences(kind, this.docs.get(pfad), modId);
      const sorted = [...new Set(prov)].sort();
      perDocProvides.set(pfad, sorted);
      for (const id of sorted) if (!provides.has(id)) provides.set(id, pfad);
      references.set(pfad, [...new Set(refs)].sort());
    }
    return {
      provides,
      references,
      providesOf: (pfad) => perDocProvides.get(pfad) ?? [],
    };
  }

  /** modId des Projekts oder null (ohne gültiges project.json). */
  modId(): string | null {
    const doc = this.docs.get('project.json') as ProjectDoc | undefined;
    return doc && typeof doc.modId === 'string' ? doc.modId : null;
  }
}

/**
 * Normalisiert eine Referenz in den Mod-Namensraum. Kanonische/externe
 * Präfixe (`field:`, `lgp:`, `kernel:`, `music:`) sind nicht projektintern
 * und werden nie als tote Referenzen geprüft (z. B. `kernel:item/<id>`
 * referenzierte Original-Items, MS15).
 */
function normalizeRef(value: string, modId: string | null, typ: 'field' | 'script' | 'enemy' | 'item'): string | null {
  if (value.startsWith('mod:')) return value;
  if (value.startsWith('field:') || value.startsWith('lgp:') || value.startsWith('kernel:') || value.startsWith('music:')) {
    return null; // kanonisch, extern
  }
  if (modId === null) return null;
  return `mod:${modId}/${typ}/${value}`;
}

function extractReferences(
  kind: DocumentKind,
  doc: unknown,
  modId: string | null,
): { provides: string[]; references: string[] } {
  const provides: string[] = [];
  const references: string[] = [];
  const ns = (typ: string, name: string) => (modId === null ? null : `mod:${modId}/${typ}/${name}`);
  const push = (list: string[], id: string | null) => {
    if (id !== null) list.push(id);
  };

  switch (kind) {
    case 'dialogue': {
      const d = doc as DialogueDoc;
      if (Array.isArray(d.eintraege)) {
        for (const e of d.eintraege) if (typeof e?.id === 'string') push(provides, ns('dlg', e.id));
      }
      break;
    }
    case 'scriptGraph': {
      const d = doc as ScriptGraphDoc;
      if (typeof d.entitaet === 'string' && typeof d.slot === 'string') {
        push(provides, ns('script', `${d.entitaet}.${d.slot}`));
      }
      if (Array.isArray(d.variablenRefs)) {
        for (const v of d.variablenRefs) if (typeof v === 'string') push(references, ns('var', v));
      }
      break;
    }
    case 'character': {
      const d = doc as CharacterDoc;
      if (typeof d.id === 'string') push(provides, ns('char', d.id));
      if (Array.isArray(d.auftritte)) {
        for (const a of d.auftritte) {
          if (typeof a?.field === 'string') push(references, normalizeRef(a.field, modId, 'field'));
          if (a?.scripts && typeof a.scripts === 'object') {
            for (const ref of Object.values(a.scripts)) {
              if (typeof ref === 'string') push(references, normalizeRef(ref, modId, 'script'));
            }
          }
        }
      }
      break;
    }
    case 'field': {
      const d = doc as FieldDoc;
      if (typeof d.id === 'string') push(provides, ns('field', d.id));
      if (Array.isArray(d.trigger)) {
        for (const t of d.trigger) {
          if (typeof t?.scriptRef === 'string') push(references, normalizeRef(t.scriptRef, modId, 'script'));
        }
      }
      if (Array.isArray(d.gateways)) {
        for (const g of d.gateways) {
          if (typeof g?.zielField === 'string') push(references, normalizeRef(g.zielField, modId, 'field'));
        }
      }
      break;
    }
    case 'variables': {
      const d = doc as VariablesDoc;
      if (Array.isArray(d.benannt)) {
        for (const b of d.benannt) if (typeof b?.name === 'string') push(provides, ns('var', b.name));
      }
      break;
    }
    case 'enemy': {
      const d = doc as EnemyDoc;
      if (typeof d.id === 'string') push(provides, ns('enemy', d.id));
      // Modell-Referenz: nur mod:-Referenzen sind projektintern prüfbar;
      // lgp:/kernel:-Ziele sind kanonisch extern (wie beim CharacterDoc).
      if ((d.modell?.art === 'referenz' || d.modell?.art === 'textur-override') && typeof d.modell.ref === 'string') {
        if (d.modell.ref.startsWith('mod:')) push(references, d.modell.ref);
      }
      const beuteRefs = [
        ...(Array.isArray(d.beute?.drops) ? d.beute.drops : []),
        ...(Array.isArray(d.beute?.stehlen) ? d.beute.stehlen : []),
      ];
      for (const b of beuteRefs) {
        if (typeof b?.itemRef === 'string') push(references, normalizeRef(b.itemRef, modId, 'item'));
      }
      if (typeof d.beute?.morph === 'string') push(references, normalizeRef(d.beute.morph, modId, 'item'));
      break;
    }
    case 'battle': {
      const d = doc as BattleDoc;
      if (typeof d.id === 'string') push(provides, ns('battle', d.id));
      if (Array.isArray(d.formation?.reihen)) {
        for (const r of d.formation.reihen) {
          if (typeof r?.enemyRef === 'string') push(references, normalizeRef(r.enemyRef, modId, 'enemy'));
        }
      }
      const drops = d.belohnung?.garantierteDrops;
      if (Array.isArray(drops)) {
        for (const g of drops) {
          if (typeof g?.itemRef === 'string') push(references, normalizeRef(g.itemRef, modId, 'item'));
        }
      }
      break;
    }
    default:
      break; // project, fieldDelta: keine projekt-internen IDs
  }
  return { provides, references };
}

/* ------------------------------------------------------------------ */
/* Autosave + Crash-Journal (A-ST-8, MS1-Akzeptanz)                    */
/* ------------------------------------------------------------------ */

function journalPath(pfad: string): string {
  return `${JOURNAL_PREFIX}${encodeURIComponent(pfad)}.json`;
}

function journalPathToPfad(name: string): string {
  return decodeURIComponent(name.slice(JOURNAL_PREFIX.length, -'.json'.length));
}

/**
 * Debounced Autosave: jede Änderung wird sofort ins Crash-Journal
 * geschrieben (`.journal/`), die eigentlichen Dokumente erst nach dem
 * Debounce-Intervall; danach werden die Journal-Einträge abgeräumt.
 */
export class AutoSaver {
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private journalWrites: Promise<unknown>[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly project: StudioProject,
    private readonly store: ProjectStore,
    options?: { debounceMs?: number | undefined },
  ) {
    this.debounceMs = options?.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
    this.unsubscribe = project.subscribe((pfad) => this.onChange(pfad));
  }

  private onChange(pfad: string): void {
    const doc = this.project.getDocument(pfad);
    if (doc === undefined) {
      // Dokument entfernt → Store und Journal aufräumen.
      this.journalWrites.push(this.store.delete(pfad), this.store.delete(journalPath(pfad)));
    } else {
      this.journalWrites.push(this.store.save(journalPath(pfad), utf8Bytes(canonicalJson(doc))));
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /** Wartet ausstehende Journal-Schreibzugriffe ab (nicht den Debounce-Timer). */
  async flushPending(): Promise<void> {
    await Promise.all(this.journalWrites.splice(0));
  }

  /** Persistiert alle dirty Dokumente sofort und räumt das Journal ab. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flushPending();
    const dirty = this.project.dirtyPaths();
    for (const pfad of dirty) {
      const doc = this.project.getDocument(pfad);
      if (doc !== undefined) await this.store.save(pfad, utf8Bytes(canonicalJson(doc)));
      await this.store.delete(journalPath(pfad));
    }
    this.project.markClean(dirty);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
  }
}

/** Erkanntes, ungespeichertes Arbeitsstands-Rest (Wiederherstellungsdialog). */
export interface CrashRecovery {
  pfade: string[];
  restore(project: StudioProject): Promise<void>;
}

/**
 * Prüft beim Öffnen, ob Journal-Einträge eines abgestürzten Laufs
 * vorliegen, und bietet deren Wiederherstellung an.
 */
export async function detectCrashRecovery(store: ProjectStore): Promise<CrashRecovery | null> {
  const pfade = (await store.list())
    .filter((p) => p.startsWith(JOURNAL_PREFIX) && p.endsWith('.json'))
    .map(journalPathToPfad)
    .sort();
  if (pfade.length === 0) return null;
  return {
    pfade,
    async restore(project: StudioProject): Promise<void> {
      for (const pfad of pfade) {
        const bytes = await store.load(journalPath(pfad));
        if (!bytes) continue;
        project.applyRecovered(pfad, JSON.parse(utf8Decode(bytes)));
      }
    },
  };
}
