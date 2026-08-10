import { formationAddress, type SceneContainer } from '@webmidgar/formats-battle';
import type { FormulaSet } from './formulas.js';
import type { BattleStarter } from './mode.js';
import { BattleSession, battleConfigFromScene, type PartyMemberSpec } from './session.js';

/**
 * BattleStarter aus dem Szenencontainer — der produktive Weg vom Field-Opcode
 * zum laufenden Kampf.
 *
 * Die Encounter-ID ist die globale 10-Bit-Kampf-ID (✅ S30: 256 Szenen × 4
 * Formationen = exakt 1024 adressierbare IDs; Referenzschluss der Probe:
 * 434/434 Encounter-IDs der Field-Sektion 7 lösen auf nicht-leere Formationen
 * auf). Adressierung wie überall: `formationAddress` — Szene `id >> 2`,
 * Formation `id & 3`. Höhere Bits werden maskiert (dieselbe 0x03FF-Maske wie
 * der Sektion-7-Leser; die Oberbits der Tabellenwörter tragen keine Formations-
 * adresse).
 *
 * Fehlerpolitik (dieselbe Quarantäne-Haltung wie die Parser): eine fehlende
 * oder quarantänisierte Szene, eine leere Formation, eine ID außerhalb des
 * Containers ⇒ `null` statt Wurf. Der `BattleModeCoordinator` nimmt `null`
 * als definierten Ersatzausgang (kein Hänger im Field-Script).
 */
export function createEncounterBattleStarter(opts: {
  scenes: SceneContainer;
  party: PartyMemberSpec[];
  seed?: number;
  formulas?: FormulaSet;
}): BattleStarter {
  const configOptions: { seed?: number; formulas?: FormulaSet } = {};
  if (opts.seed !== undefined) configOptions.seed = opts.seed;
  if (opts.formulas !== undefined) configOptions.formulas = opts.formulas;

  return (encounterId: number) => {
    const { sceneIndex, formationIndex } = formationAddress(encounterId & 0x03ff);
    const scene = opts.scenes.scenes[sceneIndex] ?? null;
    if (!scene) return null;
    const config = battleConfigFromScene(scene, formationIndex, opts.party, configOptions);
    // Leere Formation: kein startbarer Kampf (der Bestand kennt den Fall nur
    // außerhalb der Encounter-Tabellen — dort löst jede ID auf ≥1 Gegner auf).
    if (config.enemies.length === 0) return null;
    return new BattleSession(config);
  };
}
