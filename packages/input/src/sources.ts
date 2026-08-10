import { sortActions, type InputSourceKind, type SemanticAction } from './actions.js';
import type { BindingSet } from './bindings.js';
import { hitTest, type ResolvedControl } from './layout.js';
import { quantizeAxis } from './quantize.js';

/**
 * Quellen-Adapter (S27). Jede Quelle sammelt zwischen den Ticks Rohzustand
 * (Events oder Polling-Ergebnis) und wird vom Sampler GENAU EINMAL pro Tick
 * abgetastet. Die Adapter sind DOM-frei: Die App-Schale reicht Ereignisse
 * bzw. Gamepad-Zustände herein; hier gibt es keine `addEventListener`.
 */

export interface SourceSample {
  held: SemanticAction[];
  /** Analogbeitrag in ganzzahligen Stufen; null = diese Quelle hat keine Achse. */
  axisX: number | null;
  axisY: number | null;
}

export interface InputSource {
  readonly kind: InputSourceKind;
  sample(binding: BindingSet): SourceSample;
}

const NO_AXIS = { axisX: null, axisY: null } as const;

/** Tastatur: hält die Menge gedrückter `KeyboardEvent.code`. */
export class KeyboardFeed implements InputSource {
  readonly kind = 'keyboard' as const;
  private readonly down = new Set<string>();

  handleKey(code: string, isDown: boolean): void {
    if (isDown) this.down.add(code);
    else this.down.delete(code);
  }

  /** Fokusverlust o. Ä. — alles loslassen, sonst klemmen Tasten für immer. */
  clear(): void {
    this.down.clear();
  }

  sample(binding: BindingSet): SourceSample {
    const held: SemanticAction[] = [];
    for (const code of this.down) {
      const action = binding.keyboard[code];
      if (action) held.push(action);
    }
    return { held: sortActions(held), ...NO_AXIS };
  }
}

export interface GamepadState {
  buttons: boolean[];
  axes: number[];
}

/**
 * Gamepad: Die App-Schale pollt `navigator.getGamepads()` (im rAF) und reicht
 * den Zustand herein; abgetastet wird trotzdem nur am Tick. Verbindung und
 * Trennung sind Teil des Vertrags — ein getrenntes Pad liefert die leere
 * Abtastung, KEINEN eingefrorenen Letztzustand (Abnahmetest S27: Trennung
 * mitten im Lauf erzeugt `released`-Flanken am nächsten Tick).
 */
export class GamepadFeed implements InputSource {
  readonly kind = 'gamepad' as const;
  private connected = false;
  private state: GamepadState = { buttons: [], axes: [] };

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.state = { buttons: [], axes: [] };
  }

  setState(state: GamepadState): void {
    if (!this.connected) return;
    this.state = { buttons: [...state.buttons], axes: [...state.axes] };
  }

  sample(binding: BindingSet): SourceSample {
    if (!this.connected) return { held: [], ...NO_AXIS };
    const held: SemanticAction[] = [];
    for (const [idxStr, action] of Object.entries(binding.gamepadButtons)) {
      if (this.state.buttons[Number(idxStr)]) held.push(action);
    }
    const ax = this.state.axes[binding.gamepadAxes.moveX];
    const ay = this.state.axes[binding.gamepadAxes.moveY];
    const sign = binding.gamepadAxes.invertY ? -1 : 1;
    return {
      held: sortActions(held),
      axisX: ax === undefined ? null : quantizeAxis(ax),
      axisY: ay === undefined ? null : quantizeAxis(sign * ay),
    };
  }
}

interface ActivePointer {
  x: number;
  y: number;
}

/**
 * Touch: aktive Zeiger werden gegen das aufgelöste Layout getestet; jedes
 * getroffene Steuerelement trägt seine Aktion bei. Das Layout kommt von
 * außen (resolveTouchLayout) — die Quelle kennt weder Viewport noch DOM.
 */
export class TouchFeed implements InputSource {
  readonly kind = 'touch' as const;
  private readonly pointers = new Map<number, ActivePointer>();

  constructor(private controls: ResolvedControl[]) {}

  updateLayout(controls: ResolvedControl[]): void {
    this.controls = controls;
  }

  pointerDown(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y });
  }

  pointerMove(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (p) {
      p.x = x;
      p.y = y;
    }
  }

  pointerUp(id: number): void {
    this.pointers.delete(id);
  }

  clear(): void {
    this.pointers.clear();
  }

  sample(binding: BindingSet): SourceSample {
    const held: SemanticAction[] = [];
    for (const p of this.pointers.values()) {
      const controlId = hitTest(this.controls, p.x, p.y);
      if (!controlId) continue;
      const action = binding.touch[controlId];
      if (action) held.push(action);
    }
    return { held: sortActions(held), ...NO_AXIS };
  }
}
