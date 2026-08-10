/**
 * Undo/Redo-Log (Masterplan B.5): Einträge sind Nutzer-Gesten; jede
 * Geste fasst beliebig viele Command-Schritte zusammen und wird atomar
 * rückgängig gemacht. Das Log hat eine Byte-Obergrenze — bei
 * Überschreitung fallen die ältesten Einträge komplett weg, nie mitten
 * in einer Geste.
 */

export const DEFAULT_HISTORY_BYTE_BUDGET = 2 * 1024 * 1024; // ~2 MB

export interface HistoryStep {
  name: string;
  /** Gemessener Speicherbedarf des Schritts (vorher/nachher, Bytes). */
  bytes: number;
  undo(): void;
  redo(): void;
}

export interface HistoryEntry {
  name: string;
  steps: HistoryStep[];
  bytes: number;
}

export interface HistoryOptions {
  byteBudget?: number | undefined;
}

export class History {
  private entries: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private openGesture: HistoryEntry | null = null;
  private totalBytes = 0;
  private readonly budget: number;

  constructor(options?: HistoryOptions) {
    this.budget = options?.byteBudget ?? DEFAULT_HISTORY_BYTE_BUDGET;
  }

  /** Anzahl rückgängig machbarer Einträge (Gesten). */
  get length(): number {
    return this.entries.length;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get canUndo(): boolean {
    return this.entries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get gestureOpen(): boolean {
    return this.openGesture !== null;
  }

  /** Sichtbar für Tests/Diagnose. */
  get logEntries(): readonly HistoryEntry[] {
    return this.entries;
  }

  beginGesture(name = 'geste'): void {
    if (this.openGesture) throw new Error('Verschachtelte Gesten sind nicht erlaubt.');
    this.openGesture = { name, steps: [], bytes: 0 };
  }

  endGesture(): void {
    const gesture = this.openGesture;
    if (!gesture) throw new Error('endGesture() ohne offene Geste.');
    this.openGesture = null;
    if (gesture.steps.length > 0) this.commit(gesture);
  }

  /** Fügt einen Command-Schritt hinzu (bei offener Geste in diese, sonst eigener Eintrag). */
  push(step: HistoryStep): void {
    this.redoStack = [];
    if (this.openGesture) {
      this.openGesture.steps.push(step);
      this.openGesture.bytes += step.bytes;
    } else {
      this.commit({ name: step.name, steps: [step], bytes: step.bytes });
    }
  }

  /** Macht den jüngsten Eintrag atomar rückgängig (Schritte in umgekehrter Reihenfolge). */
  undo(): HistoryEntry | null {
    if (this.openGesture) throw new Error('Offene Geste — erst endGesture() aufrufen.');
    const entry = this.entries.pop();
    if (!entry) return null;
    this.totalBytes -= entry.bytes;
    for (let i = entry.steps.length - 1; i >= 0; i--) entry.steps[i]!.undo();
    this.redoStack.push(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    if (this.openGesture) throw new Error('Offene Geste — erst endGesture() aufrufen.');
    const entry = this.redoStack.pop();
    if (!entry) return null;
    for (const step of entry.steps) step.redo();
    this.entries.push(entry);
    this.totalBytes += entry.bytes;
    this.trim();
    return entry;
  }

  private commit(entry: HistoryEntry): void {
    this.entries.push(entry);
    this.totalBytes += entry.bytes;
    this.trim();
  }

  /** Kürzt älteste Einträge, bis das Budget passt; der jüngste Eintrag bleibt immer erhalten. */
  private trim(): void {
    while (this.entries.length > 1 && this.totalBytes > this.budget) {
      const dropped = this.entries.shift()!;
      this.totalBytes -= dropped.bytes;
    }
  }
}
