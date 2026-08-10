/**
 * charfelder.ts — gemeinsame Demo-Konstanten und 2D-Geometrie-Helfer für
 * den Charakter-Editor (charaktere.md) und den Field-Editor (felder.md).
 *
 * Reine UI-/Demo-Ebene: Daten werden aus `mock-project.ts` geseedet,
 * der Zustand lebt lokal in den Seiten (useState). Kein studio-core-
 * Laufzeitzugriff — nur Type-Imports.
 */
import type { SlotArt } from '@webmidgar/studio-core';
import { demoField } from '@/lib/mock-project';

/* ------------------------------------------------------------------ */
/* 2D-Geometrie (Top-Down-Projektion: Welt x/z → Canvas x/y)           */
/* ------------------------------------------------------------------ */

export interface Pt {
  x: number;
  y: number;
}

export interface Dreieck2D {
  a: Pt;
  b: Pt;
  c: Pt;
  /** Kante (ab, bc, ca) → Index des Nachbardreiecks oder null. */
  adjazent: [number | null, number | null, number | null];
}

export function dreieckFlaeche(d: Dreieck2D): number {
  return Math.abs(
    (d.a.x * (d.b.y - d.c.y) + d.b.x * (d.c.y - d.a.y) + d.c.x * (d.a.y - d.b.y)) / 2,
  );
}

/** Schwelle für degenerierte Dreiecke (felder.md: „Fläche < 0.5"). */
export const DEGENERIERT_SCHWELLE = 0.5;

export function istDegeneriert(d: Dreieck2D): boolean {
  return dreieckFlaeche(d) < DEGENERIERT_SCHWELLE;
}

export function dreieckZentrum(d: Dreieck2D): Pt {
  return { x: (d.a.x + d.b.x + d.c.x) / 3, y: (d.a.y + d.b.y + d.c.y) / 3 };
}

export function punktImDreieck(p: Pt, d: Dreieck2D): boolean {
  const { a, b, c } = d;
  const s1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const s2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const s3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = s1 < 0 || s2 < 0 || s3 < 0;
  const pos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(neg && pos);
}

/** Index des ersten validen Dreiecks unter dem Punkt, sonst -1. */
export function dreieckBei(p: Pt, dreiecke: Dreieck2D[]): number {
  return dreiecke.findIndex((d) => !istDegeneriert(d) && punktImDreieck(p, d));
}

/** Kanten als Punktpaare in der Reihenfolge (ab, bc, ca). */
export function dreieckKanten(d: Dreieck2D): [Pt, Pt][] {
  return [
    [d.a, d.b],
    [d.b, d.c],
    [d.c, d.a],
  ];
}

/** Toleranz (Canvas-Einheiten) für geometrisch geteilte Kanten. */
const KANTEN_EPS = 6;

function gleicheKante(k1: [Pt, Pt], k2: [Pt, Pt]): boolean {
  const eq = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < KANTEN_EPS && Math.abs(p.y - q.y) < KANTEN_EPS;
  return (eq(k1[0], k2[0]) && eq(k1[1], k2[1])) || (eq(k1[0], k2[1]) && eq(k1[1], k2[0]));
}

export interface MeshBefund {
  dreieck: number;
  meldung: string;
}

/**
 * Live-Invarianten (felder.md 2.1): degenerierte Dreiecke (Fläche ≈ 0)
 * und Adjazenzfehler — gesetzte Adjazenz ohne Gegenbezug, oder zwei
 * begehbare Dreiecke teilen geometrisch eine Kante, ohne sie verknüpft
 * zu haben (offene Kante). Wird während Drags live re-evaluiert.
 */
export function pruefeWalkmesh(dreiecke: Dreieck2D[]): MeshBefund[] {
  const befunde: MeshBefund[] = [];
  dreiecke.forEach((d, i) => {
    if (istDegeneriert(d)) {
      befunde.push({ dreieck: i, meldung: `Dreieck #${i} degeneriert — Fläche < ${DEGENERIERT_SCHWELLE}` });
    }
    d.adjazent.forEach((nachbar, kante) => {
      if (nachbar === null) return;
      const ziel = dreiecke[nachbar];
      if (!ziel || !ziel.adjazent.includes(i)) {
        befunde.push({ dreieck: i, meldung: `Adjazenz: Kante (${i},${kante}) ohne Gegenbezug` });
      }
    });
  });
  for (let i = 0; i < dreiecke.length; i++) {
    if (istDegeneriert(dreiecke[i])) continue;
    for (let j = i + 1; j < dreiecke.length; j++) {
      if (istDegeneriert(dreiecke[j])) continue;
      dreieckKanten(dreiecke[i]).forEach((kante, ke) => {
        const geteilt = dreieckKanten(dreiecke[j]).some((andere) => gleicheKante(kante, andere));
        if (geteilt && dreiecke[i].adjazent[ke] !== j) {
          befunde.push({
            dreieck: i,
            meldung: `Adjazenz: Kante (${i},${j}) offen — Dreiecke teilen eine Kante ohne Verknüpfung`,
          });
        }
      });
    }
  }
  return befunde;
}

/** Pro Dreieck: welche der drei Kanten (ab, bc, ca) adjazenzfehlerhaft sind. */
export function adjazenzFehlerKanten(dreiecke: Dreieck2D[]): boolean[][] {
  const fehler = dreiecke.map(() => [false, false, false]);
  dreiecke.forEach((d, i) => {
    d.adjazent.forEach((n, k) => {
      if (n === null) return;
      const ziel = dreiecke[n];
      if (!ziel || !ziel.adjazent.includes(i)) fehler[i]![k] = true;
    });
  });
  for (let i = 0; i < dreiecke.length; i++) {
    if (istDegeneriert(dreiecke[i]!)) continue;
    for (let j = i + 1; j < dreiecke.length; j++) {
      if (istDegeneriert(dreiecke[j]!)) continue;
      dreieckKanten(dreiecke[i]!).forEach((kante, ke) => {
        dreieckKanten(dreiecke[j]!).forEach((andere, kf) => {
          if (gleicheKante(kante, andere) && dreiecke[i]!.adjazent[ke] !== j) {
            fehler[i]![ke] = true;
            fehler[j]![kf] = true;
          }
        });
      });
    }
  }
  return fehler;
}

/** Entfernt ein Dreieck und reindiziert alle Adjazenzen konsistent. */
export function entferneDreieck(dreiecke: Dreieck2D[], index: number): Dreieck2D[] {
  return dreiecke
    .filter((_, i) => i !== index)
    .map((d) => ({
      ...d,
      adjazent: d.adjazent.map((n) => {
        if (n === null || n === index) return null;
        return n > index ? n - 1 : n;
      }) as [number | null, number | null, number | null],
    }));
}

/* ------------------------------------------------------------------ */
/* Autocomplete-Quellen / Demo-Listen                                  */
/* ------------------------------------------------------------------ */

export const LGP_CHAR_IDS = [
  'lgp:char/ACGD',
  'lgp:char/cloud',
  'lgp:char/tifa',
  'lgp:char/barret',
  'lgp:char/aerith',
  'lgp:char/redxiii',
  'lgp:char/cait',
  'lgp:char/vincent',
  'lgp:char/yuffie',
];

export const ORIGINAL_FIELDS = ['field:md1_1', 'field:md1_2', 'field:mds5_1', 'field:nrthmk', 'field:mrkt2'];

export const SCRIPT_GRAPHEN = [
  { ref: 'scripts/lina.interaktion.json', label: 'Lina — Begegnung' },
  { ref: 'scripts/lina.main.json', label: 'Lina — Hauptloop' },
  { ref: 'scripts/kirche.init.json', label: 'Slumkirche — Init' },
];

/** Script-Slot-Matrix des Charakter-Editors (charaktere.md Block „Script-Slots"). */
export const CHAR_SLOTS: SlotArt[] = ['init', 'interaktion', 'beruehrung'];

/** Textur-Swatches: 4 Kacheln à 128px aus `texture-swatches.png` (512×128). */
export const TEXTUR_VARIANTEN = [
  { name: 'Grün', offset: 0 },
  { name: 'Rostrot', offset: 1 },
  { name: 'Nachtblau', offset: 2 },
  { name: 'Aschgrau', offset: 3 },
];

/** Demo-Animationsliste mit topologyHash-Badges (Actor-Viewer-Platzhalter). */
export const DEMO_ANIMATIONEN = [
  { name: 'idle', hash: 'topo:8f2c…a1' },
  { name: 'gehen', hash: 'topo:8f2c…a1' },
  { name: 'laufen', hash: 'topo:3be9…d0' },
  { name: 'hinweisen', hash: 'topo:77aa…12' },
];

export const SLUMKIRCHE_FIELD_ID = 'mod:de.beispiel.nebenquest/field/slumkirche_aussen';

/* ------------------------------------------------------------------ */
/* Demo-Walkmeshes                                                     */
/* ------------------------------------------------------------------ */

/** Platzierungs-Canvas des Charakter-Editors — aus demoField geseedet. */
export function demoCharMesh(): Dreieck2D[] {
  const basis: Dreieck2D[] = demoField.walkmesh.dreiecke.map((t) => ({
    a: { x: t.a[0], y: t.a[2] },
    b: { x: t.b[0], y: t.b[2] },
    c: { x: t.c[0], y: t.c[2] },
    adjazent: [...t.adjazent],
  }));
  // zwei lokale Erweiterungs-Dreiecke für ein sichtbareres Netz
  basis.push(
    { a: { x: -160, y: -60 }, b: { x: 0, y: 0 }, c: { x: -80, y: -220 }, adjazent: [null, 5, null] },
    { a: { x: 0, y: 0 }, b: { x: -80, y: -220 }, c: { x: 60, y: -240 }, adjazent: [4, null, null] },
  );
  return basis;
}

/**
 * Field-Editor-Demo-Mesh: 12 Dreiecke vor der Slumkirche.
 * Bewusst mit zwei Invarianten-Verstößen geseedet (felder.md 2.1/Statistik):
 * Dreieck #10 ist degeneriert (kollinear), zwischen #5 und #11 fehlt die
 * Adjazenz-Verknüpfung (offene Kante) → Live-Befunde ab dem ersten Render.
 */
export function demoFeldMesh(): Dreieck2D[] {
  const v: Pt[] = [
    { x: 60, y: 120 }, { x: 220, y: 100 }, { x: 380, y: 130 }, { x: 540, y: 110 },
    { x: 40, y: 260 }, { x: 210, y: 250 }, { x: 400, y: 260 }, { x: 560, y: 240 },
    { x: 70, y: 400 }, { x: 240, y: 410 }, { x: 430, y: 400 }, { x: 580, y: 380 },
  ];
  const t = (a: Pt, b: Pt, c: Pt, adjazent: Dreieck2D['adjazent']): Dreieck2D => ({ a, b, c, adjazent });
  return [
    t(v[0], v[1], v[5], [null, null, 1]),   // 0
    t(v[0], v[5], v[4], [0, 6, null]),      // 1
    t(v[1], v[2], v[6], [null, null, 3]),   // 2
    t(v[1], v[6], v[5], [2, 8, null]),      // 3
    t(v[2], v[3], v[7], [null, null, 5]),   // 4
    t(v[2], v[7], v[6], [4, null, null]),   // 5 — Kante v7–v6 geteilt mit #11, nicht verknüpft
    t(v[4], v[5], v[9], [1, null, 7]),      // 6
    t(v[4], v[9], v[8], [6, null, null]),   // 7
    t(v[5], v[6], v[10], [3, null, 9]),     // 8
    t(v[5], v[10], v[9], [8, null, null]),  // 9
    t({ x: 470, y: 330 }, { x: 476, y: 336 }, { x: 473, y: 333 }, [null, null, null]), // 10 degeneriert
    t(v[6], v[7], { x: 620, y: 300 }, [null, null, null]), // 11 offene Kante zu #5
  ];
}

/* ------------------------------------------------------------------ */
/* Canvas-UI-Typen des Field-Editors                                   */
/* ------------------------------------------------------------------ */

export interface TriggerZone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ausloeser: 'beruehrung' | 'interaktion';
  scriptRef: string;
  einmalig: boolean;
}

export interface GatewayMark {
  id: string;
  x: number;
  y: number;
  zielField: string;
  spawnX: number;
  spawnY: number;
  /** 8-Wege-Richtung in Grad (0 = N). */
  richtung: number;
}

export interface KameraPose {
  posX: number;
  posY: number;
  zielX: number;
  zielY: number;
  zoom: number;
  rotation: number;
  fovBasis: number;
}

export type CanvasSelektion =
  | { art: 'dreieck'; index: number }
  | { art: 'trigger'; id: string }
  | { art: 'gateway'; id: string }
  | { art: 'kamera' }
  | null;

export type Werkzeug = 'auswaehlen' | 'dreieck' | 'trigger' | 'gateway' | 'kamera' | 'loeschen';

/** Tiefenmasken-Polygon des Demo-Fields (Layer-Visualisierung, felder.md 2.1). */
export const DEMO_TIEFENMASKE: Pt[] = [
  { x: 270, y: 40 },
  { x: 530, y: 30 },
  { x: 570, y: 150 },
  { x: 250, y: 170 },
];

export function demoTrigger(): TriggerZone[] {
  return [
    {
      id: 'trg:kirchentuer',
      name: 'Kirchentür',
      x: 296,
      y: 148,
      w: 76,
      h: 52,
      ausloeser: 'beruehrung',
      scriptRef: 'scripts/lina.interaktion.json',
      einmalig: false,
    },
  ];
}

export function demoGateways(): GatewayMark[] {
  return [
    { id: 'gw:sektor8', x: 46, y: 336, zielField: 'field:md1_1', spawnX: -812, spawnY: 1460, richtung: 180 },
    { id: 'gw:innen', x: 614, y: 196, zielField: 'mod:de.beispiel.nebenquest/field/slumkirche_innen', spawnX: 0, spawnY: -40, richtung: 0 },
  ];
}

export function demoKamera(): KameraPose {
  return { posX: 320, posY: 470, zielX: 300, zielY: 180, zoom: 1.6, rotation: 0, fovBasis: 240 };
}
