/**
 * Demo-Daten und Logik des Battle-Editors (schlacht.md, MS16).
 *
 * Enthält:
 * - minimale Gegner-Demo-Daten (eigene Kopie — bewusst NICHT aus
 *   lib/gegner.ts importiert, um Merge-Konflikte zu vermeiden),
 * - die Demo-Szene „Slum-Hinterhof ×3" als BattleDoc (studio-core),
 * - Encounter-Zonen-Karte (Mod- + Original-Fields),
 * - Live-Belohnungs-Summen (Σ Gegner-Stats × Modifikatoren),
 * - die deterministische Probekampf-Heuristik (A-ST-17),
 * - Befund-Ableitung (Formation leer, Arena ungültig, tote Refs …).
 *
 * Dokumenttypen per `import type` aus `@webmidgar/studio-core`.
 */
import type {
  BattleDoc,
  EnemyDoc,
  EnemyAngriff,
  FluchtRegel,
  HinterhaltArt,
  VerhaltensRegel,
} from '@webmidgar/studio-core';

/* ------------------------------------------------------------------ */
/* Gegner-Palette (minimale Demo-Kopien, EnemyDoc-Form)                */
/* ------------------------------------------------------------------ */

export const ROSTWOLF_ID = 'mod:de.beispiel.nebenquest/enemy/rostwolf';
export const MAKO_SCHWARM_ID = 'mod:de.beispiel.nebenquest/enemy/mako-schwarm';

export const demoGegner: EnemyDoc[] = [
  {
    schemaVersion: 1,
    id: ROSTWOLF_ID,
    name: 'Rostwolf',
    beschreibung: 'Schrottplatz-Rudeltier der Slums — greift im Rudel an, heult bei kritischen HP.',
    modell: { art: 'referenz', ref: 'lgp:battle/ROSTWLF' },
    stats: {
      hp: 220,
      mp: 0,
      staerke: 16,
      abwehr: 8,
      magie: 0,
      magAbwehr: 4,
      geschick: 14,
      glueck: 6,
      level: 9,
      exp: 140,
      ap: 12,
      gil: 120,
    },
    affinitaeten: { elemente: { feuer: 'schwach' }, statusImmunitaeten: [] },
    angriffe: [
      {
        id: 'ang:biss',
        name: 'Biss',
        effekt: { art: 'schaden', ziel: 'gegner_einzeln', staerke: { fest: 48 } },
      },
      {
        id: 'ang:heulen',
        name: 'Heulen',
        effekt: { art: 'buff', ziel: 'selbst', staerke: { prozent: 20 } },
        zielregel: 'staerke',
      },
    ],
    verhalten: {
      art: 'prioritaeten',
      regeln: [
        { wenn: { art: 'hp_unter', prozent: 25 }, dann: 'ang:heulen', gewicht: 100 },
        { wenn: { art: 'immer' }, dann: 'ang:biss', gewicht: 10 },
      ],
    },
    beute: { drops: [{ itemRef: 'kernel:item/potion', rate: 0.32 }], stehlen: [] },
    formationTags: ['rudel', 'nahkampf'],
  },
  {
    schemaVersion: 1,
    id: MAKO_SCHWARM_ID,
    name: 'Mako-Schwarm',
    beschreibung: 'Irrlichter aus undichter Mako-Leitung — schnell, aber fragil.',
    modell: { art: 'referenz', ref: 'lgp:battle/MAKOSWM' },
    stats: {
      hp: 90,
      mp: 30,
      staerke: 9,
      abwehr: 3,
      magie: 12,
      magAbwehr: 10,
      geschick: 22,
      glueck: 10,
      level: 7,
      exp: 60,
      ap: 6,
      gil: 45,
    },
    affinitaeten: { elemente: { blitz: 'absorbiert', erde: 'immun' }, statusImmunitaeten: ['gift'] },
    angriffe: [
      {
        id: 'ang:stich',
        name: 'Stich',
        effekt: { art: 'schaden', ziel: 'gegner_einzeln', staerke: { fest: 22 } },
      },
    ],
    verhalten: {
      art: 'prioritaeten',
      regeln: [{ wenn: { art: 'immer' }, dann: 'ang:stich', gewicht: 10 }],
    },
    beute: { drops: [], stehlen: [] },
    formationTags: ['flug', 'schwarm'],
  },
];

export function gegnerNachId(ref: string): EnemyDoc | undefined {
  return demoGegner.find((g) => g.id === ref);
}

/* ------------------------------------------------------------------ */
/* Formation-Marker (UI-Zustand — `anzahl` wird aus Markern abgeleitet) */
/* ------------------------------------------------------------------ */

export interface FormationMarker {
  id: string;
  enemyRef: string;
  /** Index-Suffix innerhalb derselben Gegnerart (A/B/C …). */
  suffix: string;
  /** Normalisierte Position 0..1 auf der Arena-Grundfläche. */
  x: number;
  z: number;
}

export const SUFFIXE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function markerLabel(m: FormationMarker): string {
  const g = gegnerNachId(m.enemyRef);
  return `${g?.name ?? m.enemyRef} ${m.suffix}`;
}

/** Nächster freier Suffix je Gegnerart. */
export function naechsterSuffix(enemyRef: string, marker: FormationMarker[]): string {
  const belegt = new Set(marker.filter((m) => m.enemyRef === enemyRef).map((m) => m.suffix));
  for (const s of SUFFIXE) if (!belegt.has(s)) return s;
  return 'Z';
}

/** Nächster freier Slot (Palette-Plus): Raster auf der Gegnerseite. */
export function naechsterFreierSlot(marker: FormationMarker[]): { x: number; z: number } {
  const spalten = 6;
  const i = marker.length;
  return {
    x: 0.14 + (i % spalten) * 0.14,
    z: 0.14 + Math.floor(i / spalten) * 0.12,
  };
}

/** Reihen-Gruppierung: gleiche Höhenlinie innerhalb der Snap-Toleranz. */
export interface Reihe {
  nr: number;
  z: number;
  marker: FormationMarker[];
}

export const REIHEN_SNAP = 0.055; // ≈ 24px bei 440px Canvas-Höhe

export function reihenGruppieren(marker: FormationMarker[]): Reihe[] {
  const sortiert = [...marker].sort((a, b) => a.z - b.z);
  const reihen: Reihe[] = [];
  for (const m of sortiert) {
    const offen = reihen.find((r) => Math.abs(r.z - m.z) <= REIHEN_SNAP);
    if (offen) {
      offen.marker.push(m);
      offen.z = offen.marker.reduce((s, mm) => s + mm.z, 0) / offen.marker.length;
    } else {
      reihen.push({ nr: reihen.length + 1, z: m.z, marker: [m] });
    }
  }
  reihen.forEach((r, i) => (r.nr = i + 1));
  return reihen;
}

/* ------------------------------------------------------------------ */
/* Demo-Szene „Slum-Hinterhof ×3" (BattleDoc, A-ST-16/ADR-025)          */
/* ------------------------------------------------------------------ */

export const ARENA_ASSET = 'arena-slum-hinterhof.png';

export const demoSchlacht: BattleDoc = {
  schemaVersion: 1,
  id: 'mod:de.beispiel.nebenquest/battles/slum-hinterhof-x3',
  name: 'Slum-Hinterhof ×3',
  arena: { art: 'nutzerbild', asset: ARENA_ASSET },
  formation: {
    reihen: [
      { enemyRef: ROSTWOLF_ID, anzahl: 1, position: { x: 0.3, z: 0.18 } },
      { enemyRef: ROSTWOLF_ID, anzahl: 1, position: { x: 0.52, z: 0.16 } },
      { enemyRef: ROSTWOLF_ID, anzahl: 1, position: { x: 0.72, z: 0.18 } },
    ],
    maxGleichzeitig: 6,
  },
  regeln: { flucht: 'erlaubt', hinterhalt: 'moeglich', siegbedingung: 'alle-besiegt' },
  belohnung: {
    expMod: 1.2,
    apMod: 1.0,
    gilMod: 1.5,
    garantierteDrops: [{ itemRef: 'kernel:item/potion' }],
  },
  verknuepfung: {
    feldRef: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen',
    encounterZone: 'hinterhof',
  },
};

export const demoMarker: FormationMarker[] = [
  { id: 'm:a', enemyRef: ROSTWOLF_ID, suffix: 'A', x: 0.3, z: 0.18 },
  { id: 'm:b', enemyRef: ROSTWOLF_ID, suffix: 'B', x: 0.52, z: 0.16 },
  { id: 'm:c', enemyRef: ROSTWOLF_ID, suffix: 'C', x: 0.72, z: 0.18 },
];

/** Neue leere Szene (Wizard-Ergebnis, MS17). */
export function neueSchlacht(n: number): { doc: BattleDoc; marker: FormationMarker[] } {
  const doc: BattleDoc = {
    schemaVersion: 1,
    id: `mod:de.beispiel.nebenquest/battles/neue-schlacht-${n}`,
    name: `Neue Schlacht ${n}`,
    arena: { art: 'nutzerbild', asset: ARENA_ASSET },
    formation: { reihen: [], maxGleichzeitig: 6 },
    regeln: { flucht: 'erlaubt', hinterhalt: 'keiner', siegbedingung: 'alle-besiegt' },
    belohnung: { expMod: 1, apMod: 1, gilMod: 1, garantierteDrops: [] },
  };
  return { doc, marker: [] };
}

/* ------------------------------------------------------------------ */
/* Items (Autocomplete garantierte Drops — minimale Demo-Menge)        */
/* ------------------------------------------------------------------ */

export const DEMO_ITEMS = [
  { ref: 'kernel:item/potion', name: 'Potion' },
  { ref: 'kernel:item/ether', name: 'Äther' },
  { ref: 'kernel:item/phoenix-down', name: 'Phönixfeder' },
  { ref: 'mod:de.beispiel.nebenquest/item/laternensplitter', name: 'Laternensplitter' },
];

export function itemName(ref: string): string {
  return DEMO_ITEMS.find((i) => i.ref === ref)?.name ?? ref;
}

/* ------------------------------------------------------------------ */
/* Encounter-Zonen-Karte (Mod-Fields + Original-Fields)                */
/* ------------------------------------------------------------------ */

export interface EncounterZone {
  id: string;
  name: string;
  /** Rechteck auf der Mini-Karte (0..1). */
  rect: { x: number; y: number; w: number; h: number };
}

export interface EncounterFeld {
  feldRef: string;
  name: string;
  original: boolean;
  zonen: EncounterZone[];
}

export const ENCOUNTER_FELDER: EncounterFeld[] = [
  {
    feldRef: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen',
    name: 'Slumkirche außen',
    original: false,
    zonen: [
      { id: 'eingang', name: 'Eingang', rect: { x: 0.58, y: 0.62, w: 0.3, h: 0.26 } },
      { id: 'hinterhof', name: 'Hinterhof', rect: { x: 0.12, y: 0.12, w: 0.36, h: 0.34 } },
    ],
  },
  {
    feldRef: 'field:md1_1',
    name: 'Sektor-1-Bahnhof',
    original: true,
    zonen: [{ id: 'bahnsteig', name: 'Bahnsteig', rect: { x: 0.2, y: 0.3, w: 0.5, h: 0.3 } }],
  },
];

/** Demo-Script-Verweis: Battle-Knoten „Kampf starten" im Quest-Editor. */
export const DEMO_SCRIPT_VERWEIS = {
  scriptRef: 'mod:de.beispiel.nebenquest/scripts/lina-begegnung',
  knotenName: 'Kampf: Slum-Hinterhof',
};

/* ------------------------------------------------------------------ */
/* Belohnung — Live-Summen aus Σ Gegner-Stats × Modifikatoren          */
/* ------------------------------------------------------------------ */

export interface BelohnungsSummen {
  exp: number;
  ap: number;
  gil: number;
  aufschluesselung: string;
}

export function belohnungsSummen(doc: BattleDoc, marker: FormationMarker[]): BelohnungsSummen {
  let exp = 0;
  let ap = 0;
  let gil = 0;
  const jeArt = new Map<string, { name: string; n: number; exp: number; ap: number; gil: number }>();
  for (const m of marker) {
    const g = gegnerNachId(m.enemyRef);
    if (!g) continue;
    exp += g.stats.exp;
    ap += g.stats.ap;
    gil += g.stats.gil;
    const e = jeArt.get(g.id) ?? { name: g.name, n: 0, exp: g.stats.exp, ap: g.stats.ap, gil: g.stats.gil };
    e.n += 1;
    jeArt.set(g.id, e);
  }
  const teile = [...jeArt.values()].map((e) => `${e.n}× ${e.name} (je ${e.exp} EXP / ${e.ap} AP / ${e.gil} Gil)`);
  return {
    exp: Math.round(exp * (doc.belohnung.expMod ?? 1)),
    ap: Math.round(ap * (doc.belohnung.apMod ?? 1)),
    gil: Math.round(gil * (doc.belohnung.gilMod ?? 1)),
    aufschluesselung: teile.length > 0 ? `${teile.join(' + ')} × Mod` : 'Keine Gegner platziert.',
  };
}

/* ------------------------------------------------------------------ */
/* Probekampf-Heuristik (A-ST-17)                                      */
/*                                                                     */
/* DETERMINISTISCH — kein Zufall:                                      */
/*  - feste Seed (es existiert keine Entropie-Quelle),                 */
/*  - Zielwahl: Round-Robin über lebende Ziele in Formationsreihenfolge*/
/*  - Regelwahl: Gewichts-Max-Regel — unter den erfüllten Bedingungen  */
/*    gewinnt die Regel mit dem höchsten `gewicht`, bei Gleichstand    */
/*    die zuerst gelistete.                                            */
/* Gleiche Eingaben erzeugen daher immer denselben Ablauf.             */
/* ------------------------------------------------------------------ */

export interface KampfEreignis {
  akteur: string;
  aktion: string;
  ziel?: string;
  schaden?: number;
  hinweis?: string;
}

export interface HpStand {
  /** Name → HP-Anteil 0..1 nach dieser Runde. */
  [teilnehmer: string]: number;
}

export interface KampfRunde {
  nr: number;
  ereignisse: KampfEreignis[];
  hp: HpStand;
}

export interface KampfTeilnehmer {
  name: string;
  seite: 'party' | 'gegner';
  maxHp: number;
}

export interface ProbekampfErgebnis {
  teilnehmer: KampfTeilnehmer[];
  runden: KampfRunde[];
  ausgang: 'sieg' | 'niederlage' | 'abbruch';
  ausgangText: string;
  hpRestProzent: number;
  haertesteRunde: number;
  regelAusloesungen: { name: string; anzahl: number }[];
}

/** Angenommene Party (Referenz-Profil, im Profi-Modus anpassbar). */
export interface PartyAnnahme {
  level: number;
  staerke: number;
  abwehr: number;
}

export const PARTY_REFERENZ: PartyAnnahme = { level: 10, staerke: 32, abwehr: 12 };

const MAX_RUNDEN = 8;
const PARTY_HP = 340;

interface KampfGegner {
  name: string;
  doc: EnemyDoc;
  hp: number;
  gebufft: boolean;
}

function bedingungErfuellt(regel: VerhaltensRegel, g: KampfGegner): boolean {
  const w = regel.wenn;
  switch (w.art) {
    case 'hp_unter':
      return g.hp <= (g.doc.stats.hp * w.prozent) / 100;
    case 'immer':
      return true;
    case 'runde_jede':
    case 'ziel_hat_status':
    case 'gruppenmitglieder_unter':
    case 'mp_unter':
      return false; // Heuristik wertet nur hp_unter/immer aus (dokumentierte Grenze)
  }
}

/** Gewichts-Max-Regel: höchstes Gewicht unter erfüllten Regeln, Tie-Break = Listenreihenfolge. */
function waehleRegel(g: KampfGegner): VerhaltensRegel | undefined {
  const erfuellt = g.doc.verhalten.regeln.filter((r) => bedingungErfuellt(r, g));
  let beste: VerhaltensRegel | undefined;
  for (const r of erfuellt) {
    if (!beste || r.gewicht > beste.gewicht) beste = r;
  }
  return beste;
}

export function simuliereProbekampf(marker: FormationMarker[], annahme: PartyAnnahme = PARTY_REFERENZ): ProbekampfErgebnis {
  const gegner: KampfGegner[] = marker
    .map((m) => ({ m, doc: gegnerNachId(m.enemyRef) }))
    .filter((e): e is { m: FormationMarker; doc: EnemyDoc } => !!e.doc)
    .map(({ m, doc }) => ({ name: markerLabel(m), doc, hp: doc.stats.hp, gebufft: false }));

  const partyNamen = ['Party-1', 'Party-2', 'Party-3'];
  const partyHp = [PARTY_HP, PARTY_HP, PARTY_HP];
  const teilnehmer: KampfTeilnehmer[] = [
    ...partyNamen.map((name) => ({ name, seite: 'party' as const, maxHp: PARTY_HP })),
    ...gegner.map((g) => ({ name: g.name, seite: 'gegner' as const, maxHp: g.doc.stats.hp })),
  ];

  const runden: KampfRunde[] = [];
  const ausloesungen = new Map<string, number>();
  let haertesteRunde = 1;
  let maxPartySchaden = -1;
  let ausgang: ProbekampfErgebnis['ausgang'] = 'abbruch';
  let endRunde = 0;

  const snapshot = (): HpStand => {
    const s: HpStand = {};
    partyNamen.forEach((n, i) => (s[n] = Math.max(0, partyHp[i]!) / PARTY_HP));
    gegner.forEach((g) => (s[g.name] = Math.max(0, g.hp) / g.doc.stats.hp));
    return s;
  };

  const partySchaden = Math.max(1, annahme.staerke * 2 - 8); // pro Mitglied, gegen Rostwolf-Bandbreite kalibriert
  let zielZeiger = 0;

  for (let runde = 1; runde <= MAX_RUNDEN; runde++) {
    const ereignisse: KampfEreignis[] = [];
    let partySchadenRunde = 0;

    // 1) Gegner agieren (Formationsreihenfolge)
    for (const g of gegner) {
      if (g.hp <= 0) continue;
      const regel = waehleRegel(g);
      if (!regel) continue;
      const angriff: EnemyAngriff | undefined = g.doc.angriffe.find((a) => a.id === regel.dann);
      if (!angriff) continue;
      if (angriff.effekt.art === 'buff') {
        if (!g.gebufft) {
          g.gebufft = true;
          const prozent = 'prozent' in angriff.effekt.staerke ? angriff.effekt.staerke.prozent : 0;
          ausloesungen.set(angriff.name, (ausloesungen.get(angriff.name) ?? 0) + 1);
          ereignisse.push({
            akteur: g.name,
            aktion: angriff.name,
            hinweis: `HP < ${regel.wenn.art === 'hp_unter' ? regel.wenn.prozent : '?'} % → ${angriff.name} (Stärke +${prozent} %)`,
          });
        }
        continue;
      }
      // Schaden: feste Stärke − Party-Abwehr, Buff-Faktor 1,2 nach Heulen
      const basis = 'fest' in angriff.effekt.staerke ? angriff.effekt.staerke.fest : 20;
      const schaden = Math.max(1, Math.round(basis * (g.gebufft ? 1.2 : 1) - Math.floor(annahme.abwehr / 4)));
      // Zielwahl: Round-Robin über lebende Party-Mitglieder (deterministisch)
      let ziel = -1;
      for (let k = 0; k < partyNamen.length; k++) {
        const idx = (zielZeiger + k) % partyNamen.length;
        if (partyHp[idx]! > 0) {
          ziel = idx;
          break;
        }
      }
      if (ziel === -1) break;
      zielZeiger = (ziel + 1) % partyNamen.length;
      partyHp[ziel] = Math.max(0, partyHp[ziel]! - schaden);
      partySchadenRunde += schaden;
      ereignisse.push({ akteur: g.name, aktion: angriff.name, ziel: partyNamen[ziel], schaden });
    }

    // 2) Party kontert (jedes lebende Mitglied, Fokus = erster lebender Gegner)
    for (let i = 0; i < partyNamen.length; i++) {
      if (partyHp[i]! <= 0) continue;
      const ziel = gegner.find((g) => g.hp > 0);
      if (!ziel) break;
      const schaden = Math.min(ziel.hp, partySchaden);
      ziel.hp -= schaden;
      ereignisse.push({
        akteur: `Party`,
        aktion: i === 0 ? 'Gegenschlag' : 'Angriff',
        ziel: ziel.name,
        schaden,
        hinweis: ziel.hp <= 0 ? 'besiegt' : undefined,
      });
    }

    if (partySchadenRunde > maxPartySchaden) {
      maxPartySchaden = partySchadenRunde;
      haertesteRunde = runde;
    }

    runden.push({ nr: runde, ereignisse, hp: snapshot() });

    if (gegner.every((g) => g.hp <= 0)) {
      ausgang = 'sieg';
      endRunde = runde;
      break;
    }
    if (partyHp.every((h) => h <= 0)) {
      ausgang = 'niederlage';
      endRunde = runde;
      break;
    }
  }

  if (ausgang === 'abbruch') endRunde = MAX_RUNDEN;

  const hpRest = partyHp.reduce((s, h) => s + Math.max(0, h), 0) / (PARTY_HP * partyNamen.length);
  const ausgangText =
    marker.length === 0
      ? 'Keine Formation — nichts zu simulieren'
      : ausgang === 'sieg'
        ? `Sieg in ~${endRunde} Runden`
        : ausgang === 'niederlage'
          ? `Niederlage in Runde ${endRunde}`
          : `Offen nach ${MAX_RUNDEN} Runden (Heuristik-Kappe)`;

  return {
    teilnehmer,
    runden,
    ausgang,
    ausgangText,
    hpRestProzent: Math.round(hpRest * 100),
    haertesteRunde,
    regelAusloesungen: [...ausloesungen.entries()].map(([name, anzahl]) => ({ name, anzahl })),
  };
}

/* ------------------------------------------------------------------ */
/* Befunde (Befundzeile der Seite + Spiegel zum Befund-Dock)           */
/* ------------------------------------------------------------------ */

export interface SchlachtBefund {
  klasse: 'fehler' | 'warnung' | 'info';
  meldung: string;
  pfad: string;
}

export const MUSIK_IM_PROJEKT: string[] = []; // MS12-Importer liefert noch keine Dokumente

export function pruefeSchlacht(doc: BattleDoc, marker: FormationMarker[]): SchlachtBefund[] {
  const befunde: SchlachtBefund[] = [];
  if (marker.length === 0) {
    befunde.push({
      klasse: 'fehler',
      pfad: 'formation.reihen',
      meldung: 'Formation leer — keine Gegner platziert',
    });
  }
  if (doc.arena.art === 'referenz' && !doc.arena.ref.trim()) {
    befunde.push({
      klasse: 'fehler',
      pfad: 'arena.ref',
      meldung: 'Arena ungültig — Referenz ohne Ziel',
    });
  }
  const drops = doc.belohnung.garantierteDrops ?? [];
  for (const d of drops) {
    if (!DEMO_ITEMS.some((i) => i.ref === d.itemRef)) {
      befunde.push({
        klasse: 'fehler',
        pfad: 'belohnung.garantierteDrops',
        meldung: `Toter Item-Verweis in garantierten Drops: ${d.itemRef}`,
      });
    }
  }
  if (doc.musikRef && !MUSIK_IM_PROJEKT.includes(doc.musikRef)) {
    befunde.push({
      klasse: 'fehler',
      pfad: 'musikRef',
      meldung: `Toter musicRef — Musik-Dokument „${doc.musikRef}" existiert nicht`,
    });
  }
  if (doc.regeln.flucht === 'verboten' && drops.length === 0) {
    befunde.push({
      klasse: 'warnung',
      pfad: 'regeln.flucht',
      meldung: 'Flucht verboten ohne garantierte Drops — Spieler können festhängen (Balancing-Risiko)',
    });
  }
  if (!doc.verknuepfung) {
    befunde.push({
      klasse: 'warnung',
      pfad: 'verknuepfung',
      meldung: 'Szene ist mit keiner Encounter-Zone und keinem Script verknüpft',
    });
  }
  if (doc.regeln.hinterhalt === 'garantiert') {
    befunde.push({
      klasse: 'info',
      pfad: 'regeln.hinterhalt',
      meldung: 'Hinterhalt „garantiert" macht Flucht-Erwartung unüblich',
    });
  }
  return befunde;
}

/* ------------------------------------------------------------------ */
/* Labels für Selects                                                  */
/* ------------------------------------------------------------------ */

export const FLUCHT_LABELS: Record<FluchtRegel, string> = {
  erlaubt: 'erlaubt',
  verboten: 'verboten',
  bedingt: 'bedingt',
};

export const HINTERHALT_LABELS: Record<HinterhaltArt, string> = {
  keiner: 'keiner',
  moeglich: 'möglich',
  garantiert: 'garantiert',
};
