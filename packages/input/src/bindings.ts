import {
  INPUT_CONTEXTS,
  isInputContext,
  isSemanticAction,
  type InputContextId,
  type SemanticAction,
} from './actions.js';

/**
 * Belegungen als DATEN (S27): Welche Taste/welcher Knopf/welches Touch-
 * Steuerelement welche Aktion auslöst, steht in einer serialisierbaren
 * Tabelle — keine Sonderlogik je Quelle. Die Tabelle ist je Eingabekontext
 * getrennt; `battle`, `world` und `minigame` sind reservierte Plätze und
 * bleiben in S27 bewusst `null` (die Bögen S29/S31/S34 füllen sie selbst).
 *
 * Wichtig für das Replay: Die Aufzeichnung enthält AKTIONEN, keine Tasten.
 * Eine Belegungsänderung wirkt deshalb sofort auf künftige Abtastungen, aber
 * nie auf eine bestehende Aufzeichnung (Abnahmetest in bindings.test.ts).
 */

export interface BindingSet {
  /** `KeyboardEvent.code` → Aktion (Layout-unabhängig, deshalb `code`, nicht `key`). */
  keyboard: Record<string, SemanticAction>;
  /** Knopfindex im Gamepad-Standard-Mapping → Aktion. */
  gamepadButtons: Record<number, SemanticAction>;
  /**
   * Achsindizes im Standard-Mapping. `invertY` gleicht die Stick-Konvention
   * (oben = negativ) an die Field-Konvention (+y = oben) an — als Datum.
   */
  gamepadAxes: { moveX: number; moveY: number; invertY: boolean };
  /** Touch-Steuerelement-ID (s. layout.ts) → Aktion. */
  touch: Record<string, SemanticAction>;
}

export type BindingTable = Record<InputContextId, BindingSet | null>;

function baseSet(): BindingSet {
  return {
    keyboard: {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right',
      Enter: 'ok',
      Space: 'ok',
      Escape: 'cancel',
      Backspace: 'cancel',
      KeyM: 'menu',
      ShiftLeft: 'run',
      ShiftRight: 'run',
      PageUp: 'pageUp',
      PageDown: 'pageDown',
      Tab: 'switch',
    },
    gamepadButtons: {
      0: 'ok',
      1: 'cancel',
      2: 'run',
      3: 'menu',
      4: 'pageUp',
      5: 'pageDown',
      8: 'switch',
      9: 'menu',
      12: 'up',
      13: 'down',
      14: 'left',
      15: 'right',
    },
    gamepadAxes: { moveX: 0, moveY: 1, invertY: true },
    touch: {
      'dpad-up': 'up',
      'dpad-down': 'down',
      'dpad-left': 'left',
      'dpad-right': 'right',
      'btn-ok': 'ok',
      'btn-cancel': 'cancel',
      'btn-menu': 'menu',
      'btn-run': 'run',
    },
  };
}

/**
 * Standardbelegung. `field`/`dialog`/`menu` seit S27 belegt, `world` seit S29
 * (der Bogen, der den Kontext nutzt, füllt seinen Platz — S27-Vorgabe);
 * `battle` und `minigame` bleiben reserviert (null).
 */
export function defaultBindings(): BindingTable {
  return {
    field: baseSet(),
    dialog: baseSet(),
    menu: baseSet(),
    battle: null,
    world: baseSet(),
    minigame: null,
  };
}

export const BINDINGS_SCHEMA_VERSION = 1;

export interface SerializedBindings {
  schemaVersion: typeof BINDINGS_SCHEMA_VERSION;
  contexts: BindingTable;
}

export function serializeBindings(table: BindingTable): string {
  const payload: SerializedBindings = { schemaVersion: BINDINGS_SCHEMA_VERSION, contexts: table };
  return JSON.stringify(payload);
}

export interface ParseBindingsResult {
  ok: boolean;
  table: BindingTable | null;
  diagnostics: string[];
}

/**
 * Liest eine persistierte Belegung zurück. Unbekannte Aktionen und Kontexte
 * sind DIAGNOSEN, keine Abstürze — der betroffene Eintrag wird verworfen und
 * benannt (dieselbe Quarantäne-Haltung wie beim LGP-Import).
 */
export function parseBindings(json: string): ParseBindingsResult {
  const diagnostics: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, table: null, diagnostics: [`E-INP-JSON: ${(e as Error).message}`] };
  }
  const obj = raw as Partial<SerializedBindings>;
  if (obj?.schemaVersion !== BINDINGS_SCHEMA_VERSION || typeof obj.contexts !== 'object' || obj.contexts === null) {
    return { ok: false, table: null, diagnostics: ['E-INP-SCHEMA: unbekannte Schemaversion oder fehlende Kontexte'] };
  }
  const table = defaultBindings();
  for (const ctx of Object.keys(obj.contexts)) {
    if (!isInputContext(ctx)) {
      diagnostics.push(`W-INP-CONTEXT: unbekannter Kontext "${ctx}" verworfen`);
      continue;
    }
    const set: unknown = (obj.contexts as Record<string, unknown>)[ctx];
    if (set === null) {
      table[ctx] = null;
      continue;
    }
    if (typeof set !== 'object') {
      diagnostics.push(`W-INP-SET: Kontext "${ctx}" ist kein Objekt — Standard bleibt`);
      continue;
    }
    const rawSet = set as Partial<BindingSet>;
    const parsed = baseSet();
    parsed.keyboard = sanitizeMap(rawSet.keyboard, `${ctx}.keyboard`, diagnostics);
    parsed.touch = sanitizeMap(rawSet.touch, `${ctx}.touch`, diagnostics);
    const buttons: Record<number, SemanticAction> = {};
    for (const [k, v] of Object.entries(rawSet.gamepadButtons ?? {})) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || !isSemanticAction(String(v))) {
        diagnostics.push(`W-INP-ACTION: ${ctx}.gamepadButtons[${k}]="${String(v)}" verworfen`);
        continue;
      }
      buttons[idx] = v;
    }
    parsed.gamepadButtons = buttons;
    const axes = rawSet.gamepadAxes;
    if (axes && Number.isInteger(axes.moveX) && Number.isInteger(axes.moveY)) {
      parsed.gamepadAxes = { moveX: axes.moveX, moveY: axes.moveY, invertY: axes.invertY === true };
    }
    table[ctx] = parsed;
  }
  // Reservierte Plätze müssen existieren, auch wenn die Datei sie nicht nennt.
  for (const ctx of INPUT_CONTEXTS) if (!(ctx in table)) table[ctx] = null;
  return { ok: true, table, diagnostics };
}

function sanitizeMap(
  map: Record<string, SemanticAction> | undefined,
  where: string,
  diagnostics: string[],
): Record<string, SemanticAction> {
  const out: Record<string, SemanticAction> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!isSemanticAction(String(v))) {
      diagnostics.push(`W-INP-ACTION: ${where}["${k}"]="${String(v)}" verworfen`);
      continue;
    }
    out[k] = v as SemanticAction;
  }
  return out;
}
