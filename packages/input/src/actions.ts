/**
 * S27 — Eingabe-Abstraktion: semantischer Aktionsraum.
 *
 * Alle Quellen (Tastatur, Gamepad, Touch) werden auf DIESEN Aktionsraum
 * abgebildet; alles hinter der Abbildung (Aufzeichnung, Replay, Digest) kennt
 * nur noch Aktionen. Das ist die tragende Entwurfsentscheidung: Die Quelle
 * ist ein Metadatum, nie Zustand — sonst wäre kein Replay quer über
 * Eingabegeräte möglich (R9-Erweiterung, s. ROADMAP-S27-S36).
 */

export const SEMANTIC_ACTIONS = [
  'ok',
  'cancel',
  'menu',
  'up',
  'down',
  'left',
  'right',
  'run',
  'pageUp',
  'pageDown',
  'switch',
] as const;

export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];

const ACTION_ORDER = new Map<SemanticAction, number>(SEMANTIC_ACTIONS.map((a, i) => [a, i]));

export function isSemanticAction(value: string): value is SemanticAction {
  return ACTION_ORDER.has(value as SemanticAction);
}

/** Sortiert Aktionen in die kanonische Reihenfolge — Determinismus der Digests. */
export function sortActions(actions: Iterable<SemanticAction>): SemanticAction[] {
  return [...new Set(actions)].sort((a, b) => ACTION_ORDER.get(a)! - ACTION_ORDER.get(b)!);
}

/**
 * Eingabekontexte. `field`, `dialog` und `menu` sind belegt; `battle`,
 * `world` und `minigame` sind **reservierte Tabellenplätze** (S27-Vorgabe:
 * Plätze ja, Belegungen nein — die füllt der jeweilige Bogen selbst).
 */
export const INPUT_CONTEXTS = ['field', 'dialog', 'menu', 'battle', 'world', 'minigame'] as const;
export type InputContextId = (typeof INPUT_CONTEXTS)[number];

export function isInputContext(value: string): value is InputContextId {
  return (INPUT_CONTEXTS as readonly string[]).includes(value);
}

/** Herkunft einer Eingabe — ausdrücklich METADATUM, fließt nie in einen Digest. */
export type InputSourceKind = 'keyboard' | 'gamepad' | 'touch';

/**
 * Eine Tick-Abtastung: gehaltene Aktionen + quantisierte Achsen.
 * `axisX`/`axisY` sind ganzzahlige Stufen (s. quantize.ts) in der
 * Field-Grundriss-Konvention: +x = rechts, +y = oben (`up`) — dieselbe
 * Richtung, in der die Demo `moveY:+1` für „hoch" schickt. Gamepad-Sticks
 * liefern oben als negativen Rohwert; die Umkehr ist ein Belegungsdatum
 * (`gamepadAxes.invertY`), keine Sonderlogik.
 */
export interface ActionSample {
  held: SemanticAction[];
  axisX: number;
  axisY: number;
}

/**
 * Ergebnis eines Abtast-Ticks. `pressed`/`released` entstehen AUSSCHLIESSLICH
 * aus dem Vergleich zweier Tick-Abtastungen im Sampler — nie aus
 * Event-Handlern. Ein Event zwischen zwei Ticks (Taste kurz gedrückt und
 * wieder losgelassen) ist damit bewusst unsichtbar: Was der Takt nicht sieht,
 * existiert für die Spiellogik nicht. Das ist die Voraussetzung für
 * quellunabhängige Replays.
 */
export interface ActionFrame extends ActionSample {
  tick: number;
  pressed: SemanticAction[];
  released: SemanticAction[];
}

export function isNeutralSample(s: ActionSample): boolean {
  return s.held.length === 0 && s.axisX === 0 && s.axisY === 0;
}
