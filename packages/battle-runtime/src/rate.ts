/**
 * Taktrate des Kampfmodus.
 *
 * 🟢 **Formatfakt** (`docs/fremdquellen/ffnx.md`, Abschnitt „Zielraten pro
 * Modus", rekonstruiert aus `ff7_limit_fps`): Das Original begrenzt jeden
 * Modus auf eine EIGENE Bildrate — FIELD 30, WORLDMAP 30, **BATTLE 15**,
 * SWIRL 30, MENU 60, CREDITS 39, SUBMARINE 30. Und weiter: „Alle Zeitangaben
 * in Skripten/Daten sind Ticks der modusspezifischen Rate, nicht Sekunden.
 * Ein Feld-`WAIT n` = n/30 s, ein Kampf-Wartewert = n/15 s."
 *
 * 🔵 **Was das für uns heißt — und was nicht.** Die `BattleSession` hat
 * keinerlei Wanduhr: Sie zählt Takte, sonst nichts. Die Rate ist damit
 * **keine Eigenschaft der Sitzung**, sondern eine des Wirts, der sie taktet.
 * Deshalb steht hier eine Konstante und keine Verhaltensänderung: Der Digest
 * nach N Takten ist von dieser Zahl unberührt (belegt in `rate.test.ts`).
 *
 * **Gemessener Ist-Stand vor dieser Runde** (2026-08-11): `packages/
 * battle-runtime` kannte überhaupt keine Rate; die 1.0-Demo tickte den Kampf
 * in derselben Schleife wie das Field, also mit `TICK_HZ = 30`
 * (`apps/demo/src/game-demo.ts`: `tick()` ruft `battleTick(frame)`, die
 * Schleife läuft über `TICK_DT_MS = 1000/30`). Der Kampf lief damit
 * **doppelt so schnell wie im Original**.
 *
 * Wichtig für die Einordnung: Die in der Aufgabe befürchtete Folge „alle
 * Wartewerte um Faktor 2 falsch" trifft hier NICHT zu, weil es in der
 * Kampflaufzeit bislang gar keine aus Originaldaten stammenden Wartewerte
 * gibt — die ATB-Füllrate (`atbGainPerTick`) ist 🔵 Eigenentwurf. Falsch war
 * allein die **Wanduhrgeschwindigkeit**. Sobald echte Kampfskript-Wartewerte
 * dazukommen (Kamera-, Animations- und AKAO-Wartezeiten), ist diese Konstante
 * der Bezugspunkt, gegen den sie zu rechnen sind.
 */

/** 🟢 Zielrate des Kampfmodus im Original. */
export const BATTLE_TICK_HZ = 15;

/** 🟢 Zielrate von Field und Weltkarte — hier nur zum Vergleich. */
export const FIELD_TICK_HZ = 30;

/**
 * Verhältnis Field-Takt zu Kampf-Takt. Ein Wirt, der eine gemeinsame
 * 30-Hz-Schleife fährt, tickt den Kampf jeden `FIELD_TO_BATTLE_DIVIDER`-ten
 * Durchlauf.
 */
export const FIELD_TO_BATTLE_DIVIDER = FIELD_TICK_HZ / BATTLE_TICK_HZ;

/** Dauer eines Kampftakts in Millisekunden (66,66…). */
export const BATTLE_TICK_MS = 1000 / BATTLE_TICK_HZ;

/** Wartewert eines Kampfskripts in Millisekunden. */
export function battleTicksToMs(ticks: number): number {
  return (ticks * 1000) / BATTLE_TICK_HZ;
}

/**
 * Taktteiler für Wirte mit gemeinsamer Schleife: liefert `true`, wenn im
 * Schleifendurchlauf `hostTick` (0-basiert, 30 Hz) ein Kampftakt fällig ist.
 * Ganzzahlig und ohne Zustand — damit bleibt die Kopplung nachrechenbar.
 */
export function isBattleTickDue(hostTick: number, hostHz = FIELD_TICK_HZ): boolean {
  const divider = Math.max(1, Math.round(hostHz / BATTLE_TICK_HZ));
  return hostTick % divider === 0;
}
