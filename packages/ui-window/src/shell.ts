import { WindowDisplayMode } from './skin.js';

/**
 * Fensterverwaltung als **Zustandsmodell** — die Anschlussstelle für die
 * Opcodes `WINDOW` (0x50), `WMODE` (0x52) und `WCLSE` (0x54).
 *
 * 🔵 Absicht: Der Interpreter soll später nur noch *rufen*, nicht *entscheiden*.
 * Deshalb liegt hier alles, was ein Fenster ausmacht (Geometrie, Modus,
 * offen/geschlossen), und nichts, was mit Zeichnen zu tun hat. Kein DOM, keine
 * Zeitquelle — damit bleibt es replay-fähig und in Node testbar.
 *
 * ⛔ Die Opcodes selbst werden hier **nicht** implementiert; das gehört dem
 * Interpreter-Besitzer einer späteren Welle. Was er aufrufen soll, steht in
 * `publicApi` des zugehörigen Berichts und in den Methodennamen unten.
 */

export interface WindowSlotState {
  /** Fenster-Slot, wie ihn der WINDOW-Opcode adressiert (0…). */
  id: number;
  x: number;
  y: number;
  /** Außenmaß laut Skript; 0 heißt „an den Text anpassen". */
  width: number;
  height: number;
  mode: WindowDisplayMode;
  /**
   * 🟡 Bleibt der Modus über `WCLSE` hinaus stehen? Im Original ist `WMODE`
   * an den Slot gebunden, nicht an die Einblendung — deshalb wird er beim
   * Schließen **nicht** zurückgesetzt. Fällt beim Anschließen der Opcodes auf,
   * falls es anders ist.
   */
  open: boolean;
}

export const DEFAULT_WINDOW_SLOTS = 16;

export class WindowShell {
  readonly slots = new Map<number, WindowSlotState>();

  /** `WINDOW id x y w h` — Geometrie setzen; legt den Slot bei Bedarf an. */
  place(id: number, x: number, y: number, width: number, height: number): WindowSlotState {
    const slot = this.ensure(id);
    slot.x = x;
    slot.y = y;
    slot.width = width;
    slot.height = height;
    return slot;
  }

  /** `WMODE id modus permanent` — Darstellungsart des Slots. */
  setMode(id: number, mode: WindowDisplayMode): WindowSlotState {
    const slot = this.ensure(id);
    slot.mode = mode;
    return slot;
  }

  /** Fenster einblenden (implizit durch MESSAGE/ASK). */
  open(id: number): WindowSlotState {
    const slot = this.ensure(id);
    slot.open = true;
    return slot;
  }

  /** `WCLSE id` — Fenster schließen; der Modus bleibt am Slot stehen. */
  close(id: number): void {
    const slot = this.slots.get(id);
    if (slot) slot.open = false;
  }

  get(id: number): WindowSlotState | undefined {
    return this.slots.get(id);
  }

  /** Alle offenen Fenster, aufsteigend nach Slot — das ist die Zeichenliste. */
  visible(): WindowSlotState[] {
    return [...this.slots.values()].filter((s) => s.open).sort((a, b) => a.id - b.id);
  }

  reset(): void {
    this.slots.clear();
  }

  private ensure(id: number): WindowSlotState {
    let slot = this.slots.get(id);
    if (!slot) {
      slot = { id, x: 0, y: 0, width: 0, height: 0, mode: WindowDisplayMode.Normal, open: false };
      this.slots.set(id, slot);
    }
    return slot;
  }
}
