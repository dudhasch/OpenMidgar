/**
 * Command-Bus (Masterplan B.5): einziger Mutationsweg — auch Werkzeuge
 * und Viewports mutieren Dokumente ausschließlich über benannte Commands
 * mit `apply`/`invert`. Dokumente sind immutable Snapshots; der Bus
 * misst das Byte-Budget der History aus kanonischen JSON-Snapshots.
 */

import { History } from './history.js';
import { canonicalJson, utf8Length } from './json.js';

export interface Command<T = unknown> {
  /** Anzeigename (Problemliste, Undo-Menü, Makros). */
  name: string;
  /** Liefert den neuen Snapshot; das Eingangsdokument wird nicht verändert. */
  apply(doc: T): T;
  /** Strikt invers zu `apply`: invert(apply(x)) ≡ x (bitverlustfrei). */
  invert(doc: T): T;
}

/** Dokumentzugriff, über den der Bus Snapshots bezieht und ersetzt. */
export interface DocumentHost {
  get(pfad: string): unknown;
  set(pfad: string, doc: unknown): void;
}

export interface CommandBusOptions {
  history?: History | undefined;
  byteBudget?: number | undefined;
}

export class CommandBus {
  readonly history: History;
  private readonly host: DocumentHost;
  private readonly listeners = new Set<(pfad: string) => void>();

  constructor(host: DocumentHost, options?: CommandBusOptions) {
    this.host = host;
    this.history =
      options?.history ??
      new History(options?.byteBudget !== undefined ? { byteBudget: options.byteBudget } : {});
  }

  /** Listener werden nach jeder Mutation (dispatch/undo/redo) benachrichtigt. */
  subscribe(listener: (pfad: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch<T>(pfad: string, command: Command<T>): void {
    const before = this.host.get(pfad) as T;
    const after = command.apply(before);
    this.host.set(pfad, after);
    const bytes = utf8Length(canonicalJson(before)) + utf8Length(canonicalJson(after));
    this.history.push({
      name: command.name,
      bytes,
      undo: () => {
        this.host.set(pfad, command.invert(this.host.get(pfad) as T));
        this.notify(pfad);
      },
      redo: () => {
        this.host.set(pfad, command.apply(this.host.get(pfad) as T));
        this.notify(pfad);
      },
    });
    this.notify(pfad);
  }

  /** Gesten-Gruppierung: alle dispatches bis endGesture() → 1 History-Eintrag. */
  beginGesture(name?: string): void {
    this.history.beginGesture(name);
  }

  endGesture(): void {
    this.history.endGesture();
  }

  undo(): boolean {
    return this.history.undo() !== null;
  }

  redo(): boolean {
    return this.history.redo() !== null;
  }

  private notify(pfad: string): void {
    for (const listener of this.listeners) listener(pfad);
  }
}
