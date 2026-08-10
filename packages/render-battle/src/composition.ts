import type { BattleFormation, BattleSkeleton } from '@webmidgar/formats-battle';
import { fnv1a32Numbers, type Skeleton } from '@webmidgar/formats-model';
import { ff7ToScene } from '@webmidgar/convert';

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
  /** Szene-Koordinaten (ADR-009 über die ZENTRALE Konvertierung — keine zweite Flip-Stelle). */
  scenePosition: [number, number, number];
  row: number;
}

/**
 * Aufstellung AUS DEN SZENENDATEN (keine handgesetzten Positionen): belegte
 * Formationsplätze, über `ff7ToScene` in den Szenenraum gebracht.
 * 🟡 Die Slot-Felder x,y,z sind als FF7-Raumkoordinaten gedeutet (Sichtnachweis
 * ausstehend); die Party steht dem Original nach gegenüber (+z-Seite) — hier
 * 🔵 als Spiegelposition der Gegnerseite gesetzt, bis Partypositionen belegt sind.
 */
export function placeFormation(formation: BattleFormation): PlacedActor[] {
  const placed: PlacedActor[] = [];
  formation.slots.forEach((slot, i) => {
    if (slot.enemyTypeId === 0xffff) return;
    placed.push({
      slotIndex: i,
      enemyTypeId: slot.enemyTypeId,
      scenePosition: ff7ToScene([slot.x, slot.y, slot.z]),
      row: slot.row,
    });
  });
  return placed;
}

/** 🔵 Party-Standardpositionen: Spiegelseite der Gegner, gestaffelt in x. */
export function placeParty(count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 1200;
    out.push(ff7ToScene([Math.round(x), 0, 3200]));
  }
  return out;
}
