import {
  sortActions,
  type ActionFrame,
  type InputContextId,
  type SemanticAction,
} from './actions.js';
import type { BindingTable } from './bindings.js';
import { axisFromDigital } from './quantize.js';
import type { InputSource } from './sources.js';

/**
 * Der Sampler (S27-Kern): tastet alle Quellen GENAU EINMAL pro Tick ab,
 * verschmilzt die Ergebnisse zu einem Aktionsrahmen und bildet die Flanken
 * (`pressed`/`released`) aus dem Vergleich mit der Abtastung des Vor-Ticks.
 *
 * Verschmelzungsregeln (deterministisch, quellordnungsstabil):
 *  - Achsen: digitale Richtungsaktionen der Quellen (Tasten, D-Pad, Touch-
 *    Kreuz) ergeben Vollausschlag; der betragsgrößte Analogbeitrag gewinnt
 *    gegen digital, bei Gleichstand die frühere Quelle.
 *  - `held` enthält die Nicht-Richtungsaktionen aller Quellen PLUS die aus
 *    der FINALEN Achse abgeleiteten Richtungsaktionen. Das ist die
 *    Normalisierung, die Quellgleichheit erst möglich macht: Ein Stick nach
 *    rechts und eine gedrückte Pfeiltaste erzeugen denselben Rahmen — die
 *    Quellaktion selbst erreicht den Strom nie, nur ihre Wirkung.
 *
 * Kontexte: Ein Kontext ohne Belegung (reservierter Platz) liefert die leere
 * Abtastung — KEIN Durchgriff auf eine „ähnliche" Tabelle. Damit kann kein
 * späterer Bogen versehentlich mit Field-Belegung laufen.
 */
const DIRECTION_ACTIONS: ReadonlySet<SemanticAction> = new Set(['up', 'down', 'left', 'right']);
export class InputSampler {
  private context: InputContextId;
  private prevHeld: SemanticAction[] = [];
  private tick = 0;

  constructor(
    private readonly bindings: BindingTable,
    private readonly sources: InputSource[],
    initialContext: InputContextId = 'field',
  ) {
    this.context = initialContext;
  }

  get activeContext(): InputContextId {
    return this.context;
  }

  /** Kontextwechsel wirkt ab der NÄCHSTEN Abtastung (Tick-Grenze, ADR-006). */
  setContext(context: InputContextId): void {
    this.context = context;
  }

  sampleTick(): ActionFrame {
    this.tick++;
    const binding = this.bindings[this.context];
    if (!binding) {
      const released = this.prevHeld;
      this.prevHeld = [];
      return { tick: this.tick, held: [], pressed: [], released, axisX: 0, axisY: 0 };
    }

    const raw: SemanticAction[] = [];
    let bestX: number | null = null;
    let bestY: number | null = null;
    for (const source of this.sources) {
      const s = source.sample(binding);
      raw.push(...s.held);
      if (s.axisX !== null && (bestX === null || Math.abs(s.axisX) > Math.abs(bestX))) bestX = s.axisX;
      if (s.axisY !== null && (bestY === null || Math.abs(s.axisY) > Math.abs(bestY))) bestY = s.axisY;
    }
    const has = (a: SemanticAction): boolean => raw.includes(a);
    const digitalX = axisFromDigital(has('left'), has('right'));
    const digitalY = axisFromDigital(has('down'), has('up'));
    const axisX = bestX !== null && bestX !== 0 ? bestX : digitalX;
    const axisY = bestY !== null && bestY !== 0 ? bestY : digitalY;
    const held: SemanticAction[] = raw.filter((a) => !DIRECTION_ACTIONS.has(a));
    if (axisX < 0) held.push('left');
    else if (axisX > 0) held.push('right');
    if (axisY > 0) held.push('up');
    else if (axisY < 0) held.push('down');
    const heldSorted = sortActions(held);

    const prev = new Set(this.prevHeld);
    const now = new Set(heldSorted);
    const pressed = heldSorted.filter((a) => !prev.has(a));
    const released = this.prevHeld.filter((a) => !now.has(a));
    this.prevHeld = heldSorted;

    return { tick: this.tick, held: heldSorted, pressed, released, axisX, axisY };
  }
}
