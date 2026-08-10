/**
 * Mock-Projekt „Midgar-Nebenquest" — Demo-Daten, damit alle Seiten der
 * Modding-Suite sofort erlebbar sind (design.md Abschnitt 8, Demo-Daten).
 *
 * Die Dokumenttypen kommen direkt aus `@webmidgar/studio-core`
 * (nur Type-Imports — zur Laufzeit ist dieses Modul vollständig
 * eigenständig). Page-Agenten ersetzen die Daten später durch echten
 * studio-core-Zugriff (IndexedDB-Projektspeicher), ohne die Formen
 * ändern zu müssen.
 */
import type {
  Befund,
  CharacterDoc,
  DialogueDoc,
  FieldDeltaDoc,
  FieldDoc,
  ProjectDoc,
  ScriptGraphDoc,
  VariablesDoc,
} from '@webmidgar/studio-core';

/* ------------------------------------------------------------------ */
/* App-seitige Zusatztypen (UI-Zustand, kein studio-core-Vertrag)      */
/* ------------------------------------------------------------------ */

/** Befund mit Quellenangabe für das Befund-Dock (Validierung | Kompilierung). */
export interface StudioBefund extends Befund {
  quelle: 'validierung' | 'kompilierung';
  /** Editor-Route, zu der ein Zeilen-Klick springt (HashRouter-Pfad). */
  zielRoute: string;
}

export type SaveStatus = 'gespeichert' | 'speichert' | 'fehler';

/** Eintrag im Crash-Journal (ungespeicherter Stand nach Absturz). */
export interface CrashJournalStand {
  zeitpunkt: string;
  projektName: string;
  betroffeneDokumente: number;
}

/** Zuletzt geöffnetes Projekt auf der Startseite. */
export interface RecentProject {
  name: string;
  modId: string;
  thumbnail: string;
  zuletztGeoeffnet: string;
  dokumente: number;
  befundChips: { fehler: number; warnung: number; info: number };
  demo?: boolean;
}

/** Dokument-Zeile für gruppierte Listen (Home, Paletten). */
export interface DokumentEintrag {
  name: string;
  /** Projektpfad, Mono (z. B. `dialogues/md1_1.de.json`). */
  pfad: string;
  typ: 'dialogue' | 'scriptGraph' | 'character' | 'field' | 'fieldDelta' | 'asset';
  geaendert: string;
  /** Editor-Route für Zeilen-Klick. */
  route: string;
  /** Original-Referenz (Provenienz), falls Delta/Referenz. */
  originalRef?: string;
  guardHash?: string;
  hatBefund?: boolean;
}

export interface ProjektStatistik {
  label: string;
  wert: number;
  suffix?: string;
  icon: 'dialoge' | 'eintraege' | 'knoten' | 'charaktere' | 'felder' | 'variablen';
}

/* ------------------------------------------------------------------ */
/* project.json                                                        */
/* ------------------------------------------------------------------ */

export const demoProject: ProjectDoc = {
  schemaVersion: 1,
  modId: 'de.beispiel.nebenquest',
  name: 'Midgar-Nebenquest',
  version: '0.1.0',
  engineCompat: '^0.4.0',
  primaersprache: 'de',
  sprachen: ['de', 'en'],
  manifestZielversion: 2,
};

/* ------------------------------------------------------------------ */
/* dialogues/ — zwei Dialoge (md1_1 mit Original-Delta, Slumkirche neu) */
/* ------------------------------------------------------------------ */

export const demoDialoge: DialogueDoc[] = [
  {
    schemaVersion: 1,
    field: 'field:md1_1',
    locale: 'de',
    eintraege: [
      {
        id: 'dlg:md1_1/lina-gruss',
        sprecher: 'Lina',
        seiten: [
          {
            text: 'He! Du bist nicht von hier, oder?\nPass auf, wo du hintrittst — die Platte ist brüchig.',
            steuerelemente: [{ art: 'pause', wert: '30' }],
          },
          { text: 'Man nennt mich Lina. Ich halte die Kirche hier zusammen.' },
        ],
      },
      {
        id: 'dlg:md1_1/wache-original',
        sprecher: 'Wache',
        seiten: [{ text: 'Halt! Dieser Sektor ist für Unbefugte gesperrt.' }],
        delta: { guardHash: 'a3f9b2c1', ersetztOriginalIndex: 7 },
      },
      {
        id: 'dlg:md1_1/lina-hinweis',
        sprecher: 'Lina',
        seiten: [
          {
            text: 'Wenn du {story_fortschritt} weit bist, zeige ich dir den Hinterausgang.',
            steuerelemente: [
              { art: 'variable', wert: 'story_fortschritt' },
              { art: 'farbe', wert: 'cyan' },
            ],
          },
        ],
      },
    ],
  },
  {
    schemaVersion: 1,
    field: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen',
    locale: 'de',
    eintraege: [
      {
        id: 'dlg:slumkirche/tuer-schild',
        seiten: [{ text: '„Kapelle der letzten Laterne" — das Schild hängt schief.' }],
      },
      {
        id: 'dlg:slumkirche/lina-ankunft',
        sprecher: 'Lina',
        seiten: [
          { text: 'Gut, dass du gekommen bist. Drinnen ist es warm.' },
          {
            text: 'Kommst du mit?\n→ Ja, gehen wir.\n→ Ich schaue mich noch um.',
            steuerelemente: [{ art: 'auswahl', wert: '2' }],
          },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* scripts/ — Script-Graph „lina.interaktion" mit Verzweigung          */
/* ------------------------------------------------------------------ */

export const demoScriptGraph: ScriptGraphDoc = {
  schemaVersion: 1,
  entitaet: 'lina',
  slot: 'interaktion',
  knoten: [
    { id: 'n1', kategorie: 'kontrollfluss', op: 'ENTRY', blockierend: false, position: { x: 80, y: 60 } },
    { id: 'n2', kategorie: 'variablen', op: 'LDA', operanden: { variable: 'lina_vertrauen' }, blockierend: false, position: { x: 80, y: 140 } },
    { id: 'n3', kategorie: 'kontrollfluss', op: 'JMPF', operanden: { bedingung: 'lina_vertrauen < 3', ziel: 'n_kalt' }, blockierend: false, position: { x: 80, y: 220 } },
    { id: 'n4', kategorie: 'dialog', op: 'MESSAGE', operanden: { ref: 'dlg:md1_1/lina-gruss' }, blockierend: true, position: { x: 280, y: 180 } },
    { id: 'n5', kategorie: 'dialog', op: 'ASK', operanden: { ref: 'dlg:slumkirche/lina-ankunft', antworten: 2 }, blockierend: true, position: { x: 280, y: 280 } },
    { id: 'n6', kategorie: 'kontrollfluss', op: 'JMPF', operanden: { bedingung: 'antwort == 1', ziel: 'n_abbruch' }, blockierend: false, position: { x: 280, y: 380 } },
    { id: 'n7', kategorie: 'variablen', op: 'PLUS!', operanden: { variable: 'lina_vertrauen', wert: 1 }, blockierend: false, position: { x: 480, y: 320 } },
    { id: 'n8', kategorie: 'field-uebergang', op: 'MAPJUMP', operanden: { ziel: 'slumkirche_aussen', gateway: 0 }, blockierend: true, position: { x: 480, y: 420 } },
    { id: 'n_kalt', kategorie: 'dialog', op: 'MESSAGE', operanden: { ref: 'dlg:md1_1/lina-hinweis' }, blockierend: true, position: { x: 520, y: 100 } },
    { id: 'n_abbruch', kategorie: 'kontrollfluss', op: 'RET', blockierend: false, position: { x: 520, y: 520 } },
    { id: 'n_ende', kategorie: 'kontrollfluss', op: 'RET', blockierend: false, position: { x: 700, y: 420 } },
  ],
  kanten: [
    { von: 'n1', zu: 'n2' },
    { von: 'n2', zu: 'n3' },
    { von: 'n3', zu: 'n4', bedingung: 'vertrauen ≥ 3' },
    { von: 'n3', zu: 'n_kalt', bedingung: 'sonst' },
    { von: 'n4', zu: 'n5' },
    { von: 'n5', zu: 'n6' },
    { von: 'n6', zu: 'n7', bedingung: 'antwort 0' },
    { von: 'n6', zu: 'n_abbruch', bedingung: 'antwort 1' },
    { von: 'n7', zu: 'n8' },
    { von: 'n8', zu: 'n_ende' },
    { von: 'n_kalt', zu: 'n_ende' },
  ],
  variablenRefs: ['lina_vertrauen', 'story_fortschritt'],
};

/* ------------------------------------------------------------------ */
/* characters/ — NPC „Lina"                                            */
/* ------------------------------------------------------------------ */

export const demoCharakter: CharacterDoc = {
  schemaVersion: 1,
  id: 'mod:de.beispiel.nebenquest/char/lina',
  name: 'Lina',
  modell: { art: 'referenz', ref: 'lgp:char/ACGD' },
  kollision: { radius: 24, hoehe: 64 },
  auftritte: [
    {
      field: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen',
      dreieck: 2,
      position: { x: 412, y: 0, z: -318 },
      richtung: 192,
      scripts: { interaktion: 'scripts/lina.interaktion.json', main: 'scripts/lina.main.json' },
    },
  ],
};

/* ------------------------------------------------------------------ */
/* fields/ — neues Field + Original-Delta                              */
/* ------------------------------------------------------------------ */

export const demoField: FieldDoc = {
  schemaVersion: 1,
  id: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen',
  hintergrundAsset: 'field-bg-slumkirche.png',
  walkmesh: {
    dreiecke: [
      { a: [0, 0, 0], b: [220, 0, 40], c: [60, 0, 200], adjazent: [1, null, null] },
      { a: [220, 0, 40], b: [300, 0, 210], c: [60, 0, 200], adjazent: [2, null, 0] },
      { a: [300, 0, 210], b: [430, 0, -60], c: [220, 0, 40], adjazent: [3, null, 1] },
      { a: [430, 0, -60], b: [520, 0, 120], c: [300, 0, 210], adjazent: [null, null, 2] },
    ],
  },
  kameras: [
    {
      position: { x: 260, y: 480, z: 640 },
      ziel: { x: 280, y: 0, z: 120 },
      fovBasis: 1.6,
    },
  ],
  trigger: [
    {
      id: 'trg:kirchentuer',
      eckpunkte: [
        { x: 470, y: 0, z: 60 },
        { x: 520, y: 0, z: 120 },
        { x: 430, y: 0, z: -60 },
      ],
      scriptRef: 'scripts/lina.interaktion.json',
    },
  ],
  gateways: [
    {
      zielField: 'field:md1_1',
      zielDreieck: 12,
      zielPosition: { x: -812, y: 0, z: 1460 },
    },
  ],
};

export const demoFieldDelta: FieldDeltaDoc = {
  schemaVersion: 1,
  zielField: 'field:md1_1',
  operationen: [
    {
      op: 'insert-after',
      anker: { entity: 'wache', slot: 'interaktion', ipOffset: 0x1c },
      guardHash: 'a3f9b2c1',
      payload: 'MESSAGE dlg:md1_1/wache-original',
    },
    {
      op: 'disable-span',
      anker: { entity: 'tuer_sued', slot: 'beruehrung', ipOffset: 0x08 },
      guardHash: '77c0d2ef',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* variables.json — 3 benannte Variablen                               */
/* ------------------------------------------------------------------ */

export const demoVariablen: VariablesDoc = {
  schemaVersion: 1,
  benannt: [
    { name: 'story_fortschritt', bank: 1, adresse: 80, kommentar: '0–9, steuert Questphasen' },
    { name: 'lina_vertrauen', bank: 1, adresse: 81, kommentar: 'Schwelle 3 für Hinterausgang' },
    { name: 'slumkirche_betreten', bank: 2, adresse: 12, kommentar: 'Flag, einmalig gesetzt' },
  ],
};

/* ------------------------------------------------------------------ */
/* Befundliste (zentrales UX-Motiv): je Klasse Beispiele               */
/* ------------------------------------------------------------------ */

export const demoBefunde: StudioBefund[] = [
  {
    dokument: 'scripts/lina.interaktion.json',
    pfad: 'knoten[n8].operanden.ziel',
    klasse: 'fehler',
    quelle: 'validierung',
    meldung: 'MAPJUMP-Ziel „slumkirche_aussen" fehlt Namensraum-Präfix „mod:…/field/…".',
    fixHint: 'Kanonische Field-ID verwenden: mod:de.beispiel.nebenquest/field/slumkirche_aussen.',
    zielRoute: '/quests',
  },
  {
    dokument: 'variables.json',
    pfad: 'benannt[lina_vertrauen]',
    klasse: 'warnung',
    quelle: 'validierung',
    meldung: 'Variable „lina_vertrauen" wird geschrieben, aber nie im Dialog referenziert.',
    fixHint: 'Im Dialog {lina_vertrauen} einsetzen oder Variable entfernen.',
    zielRoute: '/quests',
  },
  {
    dokument: 'fields/md1_1.delta.json',
    pfad: 'operationen[1].guardHash',
    klasse: 'warnung',
    quelle: 'kompilierung',
    meldung: 'guardHash „77c0d2ef" weicht vom aktuellen Originalstand ab (Restore-Guard).',
    fixHint: 'Delta gegen Original neu verankern, sonst schlägt das Patchen fehl.',
    zielRoute: '/felder',
  },
  {
    dokument: 'dialogues/md1_1.de.json',
    pfad: 'eintraege[wache-original]',
    klasse: 'info',
    quelle: 'validierung',
    meldung: 'Eintrag ersetzt Originalindex 7 — Originaltext wird nur referenziert, nie kopiert.',
    fixHint: 'Provenienz ist korrekt verankert (guardHash a3f9…c1).',
    zielRoute: '/dialoge',
  },
  {
    dokument: 'characters/lina.json',
    pfad: 'modell.ref',
    klasse: 'info',
    quelle: 'kompilierung',
    meldung: 'Modellreferenz „lgp:char/ACGD" wird als externe Referenz ins Manifest übernommen.',
    fixHint: 'Kein Handlungsbedarf — Referenz bleibt im Paket extern.',
    zielRoute: '/charaktere',
  },
  {
    dokument: 'fields/slumkirche_aussen.json',
    pfad: 'walkmesh.dreiecke[3]',
    klasse: 'info',
    quelle: 'validierung',
    meldung: 'Dreieck 3 hat keine Adjazenz an Kante bc (Rand des begehbaren Bereichs).',
    fixHint: 'Randkanten sind zulässig; bei Gateway-Ausbau Nachbar anbinden.',
    zielRoute: '/felder',
  },
  {
    dokument: 'dialogues/slumkirche.de.json',
    pfad: 'eintraege[lina-ankunft].seiten[1]',
    klasse: 'info',
    quelle: 'validierung',
    meldung: 'Auswahl mit 2 Optionen — Übersetzung für Locale „en" fehlt noch.',
    fixHint: 'Lokalisierungsspalte „en" im Dialog-Editor ergänzen.',
    zielRoute: '/dialoge',
  },
  {
    dokument: 'project.json',
    pfad: 'engineCompat',
    klasse: 'info',
    quelle: 'kompilierung',
    meldung: 'engineCompat „^0.4.0" deckt Manifest v2 ab; Paket bleibt abwärtslesbar.',
    fixHint: 'Für ältere Engines Range „>=0.3.2 <0.5.0" erwägen.',
    zielRoute: '/paket',
  },
];

/* ------------------------------------------------------------------ */
/* Abgeleitete UI-Daten                                                */
/* ------------------------------------------------------------------ */

export function befundCounts(befunde: StudioBefund[] = demoBefunde) {
  return {
    fehler: befunde.filter((b) => b.klasse === 'fehler').length,
    warnung: befunde.filter((b) => b.klasse === 'warnung').length,
    info: befunde.filter((b) => b.klasse === 'info').length,
  };
}

/** Statistik-Kacheln der Projekt-Übersicht (Home 4.1). */
export const demoStatistiken: ProjektStatistik[] = [
  { label: 'Dialoge', wert: demoDialoge.length, icon: 'dialoge' },
  { label: 'Einträge gesamt', wert: 34, icon: 'eintraege' },
  { label: 'Script-Knoten', wert: demoScriptGraph.knoten.length, icon: 'knoten' },
  { label: 'Charaktere', wert: 1, icon: 'charaktere' },
  { label: 'Felder', wert: 1, suffix: '+ 1 Δ', icon: 'felder' },
  { label: 'Variablen', wert: demoVariablen.benannt.length, icon: 'variablen' },
];

/** Gruppierte Dokumentliste (Home 4.3). */
export const demoDokumente: { gruppe: string; eintraege: DokumentEintrag[] }[] = [
  {
    gruppe: 'dialogues/',
    eintraege: [
      { name: 'md1_1.de.json', pfad: 'dialogues/md1_1.de.json', typ: 'dialogue', geaendert: 'vor 3 h', route: '/dialoge', originalRef: 'field:md1_1', guardHash: 'a3f9…c1' },
      { name: 'slumkirche.de.json', pfad: 'dialogues/slumkirche.de.json', typ: 'dialogue', geaendert: 'gestern', route: '/dialoge', hatBefund: true },
    ],
  },
  {
    gruppe: 'scripts/',
    eintraege: [
      { name: 'lina.interaktion.json', pfad: 'scripts/lina.interaktion.json', typ: 'scriptGraph', geaendert: 'vor 26 min', route: '/quests', hatBefund: true },
    ],
  },
  {
    gruppe: 'characters/',
    eintraege: [
      { name: 'lina.json', pfad: 'characters/lina.json', typ: 'character', geaendert: 'vor 2 Tagen', route: '/charaktere', originalRef: 'lgp:char/ACGD' },
    ],
  },
  {
    gruppe: 'fields/',
    eintraege: [
      { name: 'slumkirche_aussen.json', pfad: 'fields/slumkirche_aussen.json', typ: 'field', geaendert: 'vor 5 h', route: '/felder' },
      { name: 'md1_1.delta.json', pfad: 'fields/md1_1.delta.json', typ: 'fieldDelta', geaendert: 'gestern', route: '/felder', originalRef: 'field:md1_1', guardHash: '77c0…ef', hatBefund: true },
    ],
  },
  {
    gruppe: 'assets/',
    eintraege: [
      { name: 'field-bg-slumkirche.png', pfad: 'assets/field-bg-slumkirche.png', typ: 'asset', geaendert: 'vor 5 h', route: '/felder' },
      { name: 'char-silhouette-lina.png', pfad: 'assets/char-silhouette-lina.png', typ: 'asset', geaendert: 'vor 2 Tagen', route: '/charaktere' },
      { name: 'texture-swatches.png', pfad: 'assets/texture-swatches.png', typ: 'asset', geaendert: 'vor 2 Tagen', route: '/charaktere' },
    ],
  },
];

/** Zuletzt geöffnete Projekte (Home Sektion 3). */
export const demoLetzteProjekte: RecentProject[] = [
  {
    name: 'Midgar-Nebenquest',
    modId: 'de.beispiel.nebenquest',
    thumbnail: './thumb-midgar-nebenquest.png',
    zuletztGeoeffnet: 'vor 2 Tagen',
    dokumente: 14,
    befundChips: { fehler: 1, warnung: 2, info: 5 },
    demo: true,
  },
  {
    name: 'Wallmarkt-Wache',
    modId: 'de.beispiel.wallmarkt',
    thumbnail: './thumb-leeres-projekt.png',
    zuletztGeoeffnet: 'vor 6 Tagen',
    dokumente: 5,
    befundChips: { fehler: 0, warnung: 1, info: 2 },
  },
  {
    name: 'Chocobo-Rennen-Plus',
    modId: 'de.beispiel.chocoborennen',
    thumbnail: './thumb-leeres-projekt.png',
    zuletztGeoeffnet: 'vor 3 Wochen',
    dokumente: 9,
    befundChips: { fehler: 0, warnung: 0, info: 4 },
  },
];

/** Crash-Journal: offener Wiederherstellungsstand (Home Sektion 0). */
export const demoCrashJournal: CrashJournalStand = {
  zeitpunkt: '12.03. · 21:47',
  projektName: 'Midgar-Nebenquest',
  betroffeneDokumente: 3,
};

/** Zuletzt bearbeitet (Home Schnellzugriff-Spalte). */
export const demoZuletztBearbeitet = [
  { dokument: 'scripts/lina.interaktion.json', zeit: 'vor 26 min', route: '/quests' },
  { dokument: 'dialogues/md1_1.de.json', zeit: 'vor 3 h', route: '/dialoge' },
  { dokument: 'fields/slumkirche_aussen.json', zeit: 'vor 5 h', route: '/felder' },
];

/** Meta-Zeile im Hero. */
export const studioVersionen = 'studio-core v0.4.0 · studio-compiler v0.4.0 · Manifest v2';
