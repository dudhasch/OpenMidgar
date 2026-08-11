import type { BattleFormation, BattleSkeleton } from '@webmidgar/formats-battle';
import { fnv1a32Numbers, type Skeleton } from '@webmidgar/formats-model';

/**
 * Battle-Modellkomposition (S32) — bewusst Three-frei (Dualitätsprinzip wie
 * pose.ts): Diese Datei trägt die Regeln, der Three-Pfad reproduziert sie.
 *
 * Belegte Fakten (S30-Probe): Battle-Skelett = 52+12·n (481/481), Bone =
 * parent/length/Geometrieflag; Geometrie = `.p`-Dateien (Suffixe ab `am`),
 * Texturen = TEX (`ae`–`ai`); Namensraster `<präfix:2><teil:2>`.
 *
 * 🟡 Kompositionsregel: „Der k-te Bone mit Geometrieflag erhält die k-te
 * Geometriedatei in Suffixordnung." Exakt in 356/481 Präfixen; 125 Präfixe
 * haben genau eine Datei mehr (Waffen-Kandidat) — sie bleibt unzugeordnet
 * und wird gemeldet. Der Sichtnachweis (Standbild) entscheidet die Regel.
 */

/**
 * 🟢 **Sichtgeprüft (S32-Tafel, 2026-08-10):** Battle-Modelle brauchen
 * gegenüber der Field-Kette ZWEI Abweichungen, beide über eine
 * 6-Varianten-Tafel (14 Modelle × Kindversatz-Vorzeichen × Wurzelwinkel)
 * entschieden: (1) Kindversatz **+len** statt −len — ausgedrückt als
 * Längen-Negation, damit `computePose`/`buildActor` unverändert bleiben;
 * (2) Wurzel-Zusatzdrehung um X: Frame-Wert **+270°**, was mit dem
 * Field-Wurzelfix −90° netto Rx(180°) im Modellraum ergibt (Gesamtlage nach
 * ADR-009-Basis: Rx(+90°)). In der Siegervariante sind Cloud (Frisur,
 * Gesicht, Schwert über der Schulter), Barret und der Laternenträger klar
 * erkennbar und aufrecht; alle anderen Varianten liegen oder stehen kopfüber.
 * Unabhängige Stütze: KimeraCS versetzt Battle-Bones mit +len (FINDINGS,
 * `.a`-Rotationsreihenfolge-Abschnitt).
 */
export const BATTLE_ROOT_EXTRA_X_DEG = 270;

/**
 * 🟢 **Battle-Basis (S33/F13, aus 2414 belegten Slots aller 1000 nicht-leeren
 * Formationen in scene.bin gemessen, 2026-08-10):** Der Battle-Raum ist
 * x-rechts / **y-ab** / z-Tiefe — NICHT die Field-Konvention (z-oben) von
 * ADR-009/`ff7ToScene`. Belege:
 *
 *  - Höhe = Slot-y: 2217/2414 (91,8 %) exakt 0 (Bodenhöhe), die 197
 *    Nicht-Null-Werte sind 196/197 negativ (Flieger ÜBER dem Boden ⇒ y-ab;
 *    max +1). Kontrollen: x = 0 nur 39,7 %, z = 0 nur 0,6 % — die aktuelle
 *    ff7ToScene-Deutung (Höhe = Slot-z) legte 99,4 % der Gegner in die Luft
 *    bzw. unter den Boden (F13-Sichtbefund: −1700/−2000).
 *  - Tiefe = Slot-z: row-monoton (Mittel row 1→−1400, 2→−2450, 3→−3330) und
 *    2047/2400 auf EINER Seite (−z; Rest = Zangenangriffe, 910/1000
 *    Formationen komplett einseitig). Kontrollen x/y: row-Schritte < 300.
 *  - Unabhängige Referenz Kamerablock: Die Kamera-POSITION ist auf genau
 *    einer Achse streng einseitig — y, 1000/1000 negativ (über dem Boden,
 *    y-ab), x 959/1000, z 713/1000; die Blickrichtung verfehlt den
 *    Formationsschwerpunkt unter Achs-Identität in 996/1000 Fällen um < 20°.
 *
 * Abbildung B: (x,y,z)_battle → (x,−y,−z)_scene = Rx(180°), det +1 (kein
 * Spiegel). Konsistenzstütze: Rx(180°) − Field-Basis Rx(−90°) = Rx(270°) —
 * exakt der sichtgeprüfte Wurzelfix `BATTLE_ROOT_EXTRA_X_DEG` (S32): Modelle
 * und Aufstellung folgen DERSELBEN y-ab-Konvention. Dies ist die EINZIGE
 * Battle-Flip-Stelle (Pendant zu `ff7ToScene`, ADR-009).
 * 🟡 Rest: Das globale Vorzeichen von z (Spiegelfrage „Gegner links oder
 * rechts im Bild") ist aus den Daten allein nicht entscheidbar; gewählt ist
 * die händigkeitserhaltende Variante, Sichtnachweis gegen das Original steht aus.
 */
export function battleToScene(v: [number, number, number]): [number, number, number] {
  return [v[0], -v[1], -v[2]];
}

/** Bildet das Battle-Skelett auf den NAM-Skeleton der Modellkette ab. */
export function battleSkeletonToSkeleton(bs: BattleSkeleton, name: string): Skeleton {
  return {
    schemaVersion: 1,
    name,
    bones: bs.bones.map((b, i) => ({
      name: `bone${i}`,
      parentIndex: b.parent,
      // Vorzeichen gedreht: Battle-Kindversatz ist +len (Sichtnachweis oben).
      length: -b.length,
      resourceRefs: [],
      fileOrder: i,
    })),
    topologyHash: fnv1a32Numbers([bs.bones.length, ...bs.bones.map((b) => b.parent + 1)]),
    diagnostics: [],
  };
}

export interface PartAssignment {
  /** boneIndex → Index in der übergebenen (suffix-sortierten) Teileliste. */
  boneToPart: Map<number, number>;
  /** Teile ohne Bone (🟡 Waffen-Kandidaten) — gemeldet, nicht geraten. */
  unassignedParts: number[];
}

export function assignPartsToBones(bs: BattleSkeleton, partCount: number): PartAssignment {
  const boneToPart = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < bs.bones.length; i++) {
    if (!bs.bones[i]!.hasGeometry) continue;
    if (next < partCount) boneToPart.set(i, next++);
  }
  const unassignedParts: number[] = [];
  for (let p = next; p < partCount; p++) unassignedParts.push(p);
  return { boneToPart, unassignedParts };
}

/**
 * Szenen-Kamerablock (48 B je Formation) — Deutung aus der S32-Probe:
 * **3 Kameras à 12 B** (i16 Position x,y,z + i16 Ziel x,y,z) + 6×0xFFFF
 * Füllung. Gemessen: Füllwörter ausnahmslos −1, Kamera-y ausnahmslos negativ
 * (über dem Boden — FF7-y zeigt nach unten), Ziel-x überwiegend 0 (Bühnenmitte).
 */
export interface BattleCamera {
  position: [number, number, number];
  target: [number, number, number];
}

export function parseCameraBlock(cameraRaw: Uint8Array): { cameras: BattleCamera[]; padOk: boolean } {
  const view = new DataView(cameraRaw.buffer, cameraRaw.byteOffset, cameraRaw.byteLength);
  const cameras: BattleCamera[] = [];
  for (let c = 0; c < 3; c++) {
    const o = c * 12;
    cameras.push({
      position: [view.getInt16(o, true), view.getInt16(o + 2, true), view.getInt16(o + 4, true)],
      target: [view.getInt16(o + 6, true), view.getInt16(o + 8, true), view.getInt16(o + 10, true)],
    });
  }
  let padOk = true;
  for (let k = 18; k < 24; k++) if (view.getInt16(k * 2, true) !== -1) padOk = false;
  return { cameras, padOk };
}

export interface PlacedActor {
  slotIndex: number;
  enemyTypeId: number;
  /** Szene-Koordinaten über die zentrale Battle-Basis `battleToScene` — keine zweite Flip-Stelle. */
  scenePosition: [number, number, number];
  row: number;
}

/**
 * Aufstellung AUS DEN SZENENDATEN (keine handgesetzten Positionen): belegte
 * Formationsplätze, über die 🟢 Battle-Basis `battleToScene` (x-rechts, y-ab,
 * z-Tiefe; Messbelege dort) in den Szenenraum gebracht. Damit stehen 91,8 %
 * der Akteure exakt auf Bodenhöhe 0, Flieger darüber; Gegner überwiegend auf
 * der Szene-+z-Seite (Battle-z < 0 in 2047/2400 Slots).
 */
export function placeFormation(formation: BattleFormation): PlacedActor[] {
  const placed: PlacedActor[] = [];
  formation.slots.forEach((slot, i) => {
    if (slot.enemyTypeId === 0xffff) return;
    placed.push({
      slotIndex: i,
      enemyTypeId: slot.enemyTypeId,
      scenePosition: battleToScene([slot.x, slot.y, slot.z]),
      row: slot.row,
    });
  });
  return placed;
}

/**
 * 🔵 Party-Standardpositionen. In scene.bin steht KEINE Partyposition — die
 * Aufstellung der eigenen Reihe ist Sache der Engine. Statt eine Zahl zu
 * erfinden, wird die Gegnerseite gespiegelt; deren Lage ist gemessen
 * (2414 belegte Plätze, `battle-vollbild.rdtest.ts`, 2026-08-11):
 *
 *  - Tiefe z: Median **−1700** (10 %-Quantil −3500, 90 % +1700) — die Gegner
 *    stehen mehrheitlich auf der −z-Seite. Die Party bekommt daher +1700.
 *  - Seite x: Median **0**, 10 %/90 % bei **∓1200** — die Staffelung quer zur
 *    Blickachse beträgt im Bestand also rund 1200 Einheiten je Platz. Genau
 *    dieser Wert wird für den Abstand der Partyplätze übernommen.
 *  - Höhe y: 0 (Boden; 91,8 % aller Gegnerplätze liegen exakt dort).
 *
 * Damit ist die Regel zwar weiterhin eine Ersatzregel, aber ihre beiden
 * Zahlen sind aus den Daten abgeleitet und nicht geraten.
 */
export const PARTY_ROW_DEPTH = 1700;
export const PARTY_SLOT_SPACING = 1200;

export function placeParty(count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * PARTY_SLOT_SPACING;
    out.push(battleToScene([Math.round(x), 0, PARTY_ROW_DEPTH]));
  }
  return out;
}
