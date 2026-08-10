/**
 * Metadaten und Demo-Inhalte für den Quest-/Script-Editor (quests.md).
 * Reine UI-Ebene: Kategorie-Farben, Opcode-Vorlagen für die Palette,
 * Meilenstein-Projektion und Beispiel-Logikbefunde (Erreichbarkeit,
 * Wartezyklen). Keine Änderungen an mock-project.ts nötig.
 */
import type { ScriptKategorie, SlotArt } from '@webmidgar/studio-core';
import { GESPERRTE_SCRIPT_KATEGORIEN } from '@webmidgar/studio-core';
import { demoVariablen } from '@/lib/mock-project';

/* ------------------------------------------------------------------ */
/* Opcode-Kategorien (9)                                               */
/* ------------------------------------------------------------------ */

export interface OpcodeVorlage {
  op: string;
  blockierend: boolean;
  beschreibung: string;
}

export interface KategorieMeta {
  id: ScriptKategorie;
  name: string;
  farbe: string;
  gesperrt: boolean;
  vorlagen: OpcodeVorlage[];
}

export const KATEGORIEN: KategorieMeta[] = [
  {
    id: 'kontrollfluss',
    name: 'Kontrollfluss',
    farbe: '#3DDC97',
    gesperrt: false,
    vorlagen: [
      { op: 'ENTRY', blockierend: false, beschreibung: 'Einstiegspunkt des Scripts' },
      { op: 'JMPF', blockierend: false, beschreibung: 'Sprung, wenn Bedingung falsch' },
      { op: 'JMP', blockierend: false, beschreibung: 'Unbedingter Sprung' },
      { op: 'RET', blockierend: false, beschreibung: 'Rückkehr / Ende' },
      { op: 'WARTE', blockierend: true, beschreibung: 'Wartepunkt (Frames)' },
    ],
  },
  {
    id: 'variablen',
    name: 'Variablen & Flags',
    farbe: '#56B6F7',
    gesperrt: false,
    vorlagen: [
      { op: 'LDA', blockierend: false, beschreibung: 'Variable laden' },
      { op: 'SETZE', blockierend: false, beschreibung: 'Variable setzen' },
      { op: 'PLUS!', blockierend: false, beschreibung: 'Variable erhöhen' },
      { op: 'MINUS!', blockierend: false, beschreibung: 'Variable verringern' },
    ],
  },
  {
    id: 'dialog',
    name: 'Dialog',
    farbe: '#B48CF2',
    gesperrt: false,
    vorlagen: [
      { op: 'MESSAGE', blockierend: true, beschreibung: 'Dialogbox anzeigen' },
      { op: 'ASK', blockierend: true, beschreibung: 'Auswahlfrage stellen' },
      { op: 'WINDOW', blockierend: false, beschreibung: 'Fenster öffnen' },
      { op: 'CLOSE', blockierend: false, beschreibung: 'Fenster schließen' },
    ],
  },
  {
    id: 'entity-bewegung',
    name: 'Entity-Bewegung',
    farbe: '#4C8DFF',
    gesperrt: true,
    vorlagen: [
      { op: 'MOVE', blockierend: true, beschreibung: 'Entity zu Position bewegen' },
      { op: 'TURN', blockierend: false, beschreibung: 'Blickrichtung setzen' },
      { op: 'ANIM', blockierend: true, beschreibung: 'Animation abspielen' },
    ],
  },
  {
    id: 'kamera',
    name: 'Kamera',
    farbe: '#8FA3B8',
    gesperrt: true,
    vorlagen: [
      { op: 'CAMSET', blockierend: false, beschreibung: 'Kamerapose wählen' },
      { op: 'CAMFADE', blockierend: true, beschreibung: 'Kamera-Überblendung' },
    ],
  },
  {
    id: 'field-uebergang',
    name: 'Field-Übergang',
    farbe: '#F2A65A',
    gesperrt: false,
    vorlagen: [
      { op: 'MAPJUMP', blockierend: true, beschreibung: 'Zu anderem Field springen' },
      { op: 'GATEWAY', blockierend: false, beschreibung: 'Gateway-Kante aktivieren' },
    ],
  },
  {
    id: 'audio',
    name: 'Audio',
    farbe: '#5B6B7B',
    gesperrt: true,
    vorlagen: [
      { op: 'MUSIC', blockierend: false, beschreibung: 'Musikstück starten' },
      { op: 'SOUND', blockierend: false, beschreibung: 'Soundeffekt abspielen' },
    ],
  },
  {
    id: 'battle',
    name: 'Battle',
    farbe: '#F472B6',
    gesperrt: false,
    vorlagen: [
      { op: 'BATTLE', blockierend: true, beschreibung: 'Kampfbegegnung starten' },
      { op: 'BSETUP', blockierend: false, beschreibung: 'Kampf-Formation setzen' },
    ],
  },
  {
    id: 'spezial',
    name: 'Spezial',
    farbe: '#5B6B7B',
    gesperrt: true,
    vorlagen: [
      { op: 'SHOP', blockierend: true, beschreibung: 'Ladenmenü öffnen' },
      { op: 'PARTY', blockierend: false, beschreibung: 'Gruppierung ändern' },
    ],
  },
];

/** Konsistenz mit studio-core (A-ST-5) sicherstellen. */
export const GESPERRTE_KATEGORIEN: readonly ScriptKategorie[] = GESPERRTE_SCRIPT_KATEGORIEN;

export function kategorieMeta(id: ScriptKategorie): KategorieMeta {
  return KATEGORIEN.find((k) => k.id === id) ?? KATEGORIEN[0]!;
}

export function kategorieFarbe(id: ScriptKategorie): string {
  return kategorieMeta(id).farbe;
}

/** Blockierend-Flag einer Opcode-Vorlage (formatgegeben, read-only). */
export function vorlageBlockierend(kategorie: ScriptKategorie, op: string): boolean {
  const kat = KATEGORIEN.find((k) => k.id === kategorie);
  return kat?.vorlagen.find((v) => v.op === op)?.blockierend ?? false;
}

/** Standard-Operanden für neu aus der Palette gezogene Knoten. */
export function standardOperanden(kategorie: ScriptKategorie, op: string): Record<string, string | number> {
  switch (op) {
    case 'JMPF':
      return { bedingung: 'wert == 0', ziel: '' };
    case 'WARTE':
      return { frames: 30 };
    case 'LDA':
    case 'SETZE':
      return { variable: '', wert: 0 };
    case 'PLUS!':
    case 'MINUS!':
      return { variable: '', wert: 1 };
    case 'MESSAGE':
      return { ref: '' };
    case 'ASK':
      return { ref: '', antworten: 2 };
    case 'MAPJUMP':
      return { ziel: '', gateway: 0 };
    case 'BATTLE':
      return { formation: 0 };
    default:
      return kategorie === 'kontrollfluss' ? {} : { wert: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Trigger/Slot-Matrix                                                 */
/* ------------------------------------------------------------------ */

export const SLOT_MATRIX: { id: SlotArt; beschreibung: string }[] = [
  { id: 'init', beschreibung: 'beim Field-Load' },
  { id: 'main', beschreibung: 'dauerhaft aktiv' },
  { id: 'interaktion', beschreibung: 'Aktionstaste am Entity' },
  { id: 'beruehrung', beschreibung: 'Kontakt mit dem Entity' },
  { id: 'timer', beschreibung: 'Intervall (ms)' },
];

/* ------------------------------------------------------------------ */
/* Projektvariablen (UI-Sicht auf variables.json)                      */
/* ------------------------------------------------------------------ */

export interface ProjektVariable {
  name: string;
  typ: 'Zahl' | 'Flag' | 'Text';
  wert: string;
  bank: number;
  adresse: number;
  kommentar?: string;
}

export function initialeVariablen(): ProjektVariable[] {
  return demoVariablen.benannt.map((v) => ({
    name: v.name,
    typ: v.name.includes('betreten') ? 'Flag' : 'Zahl',
    wert: v.name.includes('betreten') ? 'false' : '0',
    bank: v.bank ?? 0,
    adresse: v.adresse ?? 0,
    kommentar: v.kommentar,
  }));
}

/* ------------------------------------------------------------------ */
/* Meilenstein-Projektion (Quest-Sicht)                                */
/* ------------------------------------------------------------------ */

export interface Meilenstein {
  id: string;
  titel: string;
  knotenIds: string[];
}

export const demoMeilensteine: Meilenstein[] = [
  { id: 'ms1', titel: 'Lina ansprechen', knotenIds: ['n1', 'n2', 'n3', 'n4', 'n5', 'n_kalt'] },
  { id: 'ms2', titel: 'Vertrauen ≥ 1', knotenIds: ['n6', 'n7', 'n_abbruch'] },
  { id: 'ms3', titel: 'Kirche freischalten', knotenIds: ['n8', 'n_ende'] },
];

/* ------------------------------------------------------------------ */
/* Beispiel-Logikbefunde (Erreichbarkeit / Wartezyklen)                */
/* ------------------------------------------------------------------ */

export interface LogikBefund {
  id: string;
  klasse: 'fehler' | 'warnung' | 'info';
  analyse: 'Erreichbarkeit' | 'Wartezyklus' | 'Trigger';
  meldung: string;
  /** Knoten, der beim Klick markiert + angezoomt wird. */
  knotenId?: string;
  /** Kante (ReactFlow-ID), die amber blinkt. */
  kantenId?: string;
}

export const demoLogikBefunde: LogikBefund[] = [
  {
    id: 'lb-erreichbarkeit',
    klasse: 'warnung',
    analyse: 'Erreichbarkeit',
    meldung: 'Knoten „n_abbruch" (RET) ist vom Einstieg aus nicht erreichbar.',
    knotenId: 'n_abbruch',
  },
  {
    id: 'lb-wartezyklus',
    klasse: 'warnung',
    analyse: 'Wartezyklus',
    meldung: 'Möglicher Wartezyklus: MESSAGE → ASK ohne Zeitfortschritt.',
    knotenId: 'n5',
    kantenId: 'e-n4-n5',
  },
  {
    id: 'lb-trigger',
    klasse: 'info',
    analyse: 'Trigger',
    meldung: 'Trigger „beruehrung" verdrahtet, aber kein Entity zugewiesen.',
    knotenId: 'n1',
  },
];

/** Achteck-Clip für blockierende Wartepunkt-Knoten. */
export const OKTAGON_CLIP =
  'polygon(26% 0%, 74% 0%, 100% 26%, 100% 74%, 74% 100%, 26% 100%, 0% 74%, 0% 26%)';
