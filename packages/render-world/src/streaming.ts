import type { WorldGrid } from '@webmidgar/formats-world';
import { cellAt, cellToBlockIndex, wrapCell, type BlockCell } from './layout.js';

/**
 * Blockweises Streaming (S28): resident ist ausschließlich die Nachbarschaft
 * der Kamerazelle (Chebyshev-Radius). Eigene GENERATIONSACHSE wie bei der
 * Pipeline: Jede Lade-Anweisung trägt die Generation, unter der sie gültig
 * ist — eine später eintreffende Ladung einer alten Generation wird von der
 * Schale verworfen (dasselbe Muster, mit dem S3 die Field-Wechsel härtet).
 *
 * Der Streamer ist reine Logik ohne IO und ohne Three — die Schale
 * (Demo/App) lädt und entlädt, was `update` ihr aufträgt, und meldet die
 * Buchführung an die GPU-Registry.
 */

export interface StreamSlot {
  /** Ungewickelte Zelle (Platzierung in der Szene — die Karte wiederholt sich). */
  cell: BlockCell;
  /** Blockindex im Primärraster (Datenquelle, gewickelt). */
  blockIndex: number;
  /** Schlüssel der Szene-Instanz. */
  key: string;
}

export interface StreamUpdate {
  load: StreamSlot[];
  release: StreamSlot[];
  generation: number;
  residentCount: number;
}

export class WorldStreamer {
  private resident = new Map<string, StreamSlot>();
  private generation = 0;

  constructor(
    private readonly grid: WorldGrid,
    /** Chebyshev-Radius in Blöcken; 1 ⇒ 3×3 resident. */
    private readonly radius = 1,
  ) {}

  get residentSlots(): StreamSlot[] {
    return [...this.resident.values()];
  }

  /** Neuberechnung der Residenz für eine Weltposition. */
  update(x: number, z: number): StreamUpdate {
    this.generation++;
    const center = cellAt(x, z);
    const wanted = new Map<string, StreamSlot>();
    for (let dr = -this.radius; dr <= this.radius; dr++) {
      for (let dc = -this.radius; dc <= this.radius; dc++) {
        const cell = { col: center.col + dc, row: center.row + dr };
        const wrapped = wrapCell(cell, this.grid);
        const blockIndex = cellToBlockIndex(wrapped, this.grid);
        const key = `${cell.col}:${cell.row}`;
        wanted.set(key, { cell, blockIndex, key });
      }
    }
    const load: StreamSlot[] = [];
    const release: StreamSlot[] = [];
    for (const [key, slot] of wanted) if (!this.resident.has(key)) load.push(slot);
    for (const [key, slot] of this.resident) if (!wanted.has(key)) release.push(slot);
    for (const slot of release) this.resident.delete(slot.key);
    for (const slot of load) this.resident.set(slot.key, slot);
    return { load, release, generation: this.generation, residentCount: this.resident.size };
  }

  /** Vollständige Räumung (Kartenwechsel, Sitzungsende). */
  clear(): StreamUpdate {
    this.generation++;
    const release = [...this.resident.values()];
    this.resident.clear();
    return { load: [], release, generation: this.generation, residentCount: 0 };
  }
}
