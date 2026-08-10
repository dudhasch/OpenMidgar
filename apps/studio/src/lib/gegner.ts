/**
 * Demo-Daten und UI-Hilfsfunktionen des Gegner-Editors (MS15, gegner.md).
 * Fachlich verbindlich: `EnemyDoc` und die geschlossene Effekt-Taxonomie
 * aus `@webmidgar/studio-core` (EFFECT_ARTEN, EFFECT_ZIELE, ELEMENTE,
 * STATUSWERTE, ENEMY_STAT_BAND, VERHALTENS_BEDINGUNGEN). Kein Freitext.
 *
 * Die UI führt Angriffe als `AngriffUi` (mit Stärke-Modus fest|prozent|faktor);
 * `alsEnemyDoc` bildet sie auf das verbindliche `EnemyAngriff` ab
 * (EffektStaerke kennt nur fest|prozent — faktor wird als prozent der
 * Basisstärke serialisiert, gekappt auf 100).
 */
import { ELEMENTE, ENEMY_STAT_BAND, STATUSWERTE } from '@webmidgar/studio-core';
import type {
  EffectArt,
  EffectZiel,
  Element,
  ElementAffinitaet,
  EnemyDoc,
  EnemyStats,
  StatusWert,
  VerhaltensBedingung,
  VerhaltensBedingungArt,
} from '@webmidgar/studio-core';

/* ------------------------------------------------------------------ */
/* UI-Typen                                                            */
/* ------------------------------------------------------------------ */

export type StaerkeModus = 'fest' | 'prozent' | 'faktor';

export interface StaerkeUi {
  modus: StaerkeModus;
  wert: number;
}

/** Angriff im UI-Zustand (wird via `alsEnemyDoc` auf EnemyAngriff abgebildet). */
export interface AngriffUi {
  id: string;
  name: string;
  art: EffectArt;
  ziel: EffectZiel;
  staerke: StaerkeUi;
  element?: Element | undefined;
  status?: StatusWert | undefined;
  /** 0..1, nur bei status_setzen. */
  trefferquote?: number | undefined;
  /** MP-Kosten. */
  kosten: number;
}

/** Gegner im UI-Zustand: EnemyDoc-Form, aber Angriffe als AngriffUi + Avatar-Asset. */
export interface GegnerUi extends Omit<EnemyDoc, 'angriffe'> {
  angriffe: AngriffUi[];
  /** Silhouetten-Asset (Sidebar-Avatar, Modell-Vorschau). */
  avatar: string;
}

/** Bildet den UI-Zustand verlustarm auf das verbindliche Dokument ab. */
export function alsEnemyDoc(g: GegnerUi): EnemyDoc {
  return {
    ...g,
    angriffe: g.angriffe.map((a) => ({
      id: a.id,
      name: a.name,
      effekt: {
        art: a.art,
        ziel: a.ziel,
        staerke:
          a.staerke.modus === 'fest'
            ? { fest: a.staerke.wert }
            : { prozent: Math.min(100, Math.round(a.staerke.modus === 'faktor' ? a.staerke.wert * 100 : a.staerke.wert)) },
        element: a.element,
        status: a.status,
        trefferquote: a.trefferquote,
      },
      kosten: a.kosten,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Taxonomie-Labels (geschlossene Mengen aus studio-core, Deutsch)     */
/* ------------------------------------------------------------------ */

export const EFFECT_ART_LABELS: Record<EffectArt, string> = {
  schaden: 'Schaden',
  heil_hp: 'HP heilen',
  heil_mp: 'MP heilen',
  buff: 'Stärkung',
  debuff: 'Schwächung',
  status_setzen: 'Status setzen',
  status_heilen: 'Status heilen',
};

/** Ein-Zeilen-Erklärungen für die Taxonomie-Hilfe (Inspektor, Tab Angriffe). */
export const EFFECT_ART_HILFE: Record<EffectArt, string> = {
  schaden: 'Reduziert HP des Ziels — optional mit Element.',
  heil_hp: 'Stellt HP wieder her — fest oder prozentual.',
  heil_mp: 'Stellt MP wieder her — fest oder prozentual.',
  buff: 'Verstärkt einen Wert des Ziels für einige Runden.',
  debuff: 'Schwächt einen Wert des Ziels für einige Runden.',
  status_setzen: 'Belegt das Ziel mit einem Status — mit Trefferquote.',
  status_heilen: 'Entfernt einen Status vom Ziel.',
};

export const EFFECT_ZIEL_LABELS: Record<EffectZiel, string> = {
  wahl_einzeln: 'Ein Ziel (Wahl)',
  wahl_gruppe: 'Gruppe (Wahl)',
  party: 'Party',
  selbst: 'Selbst',
  gegner_einzeln: 'Gegner einzeln',
  gegner_gruppe: 'Gegnergruppe',
};

/** Ziel-Auswahl im Gegner-Editor (gegner.md Sektion 4 — Teilmenge von EFFECT_ZIELE). */
export const GEGNER_ZIELE: readonly EffectZiel[] = ['wahl_einzeln', 'wahl_gruppe', 'party', 'selbst'];

export const ELEMENT_LABELS: Record<Element, string> = {
  feuer: 'Feuer',
  eis: 'Eis',
  blitz: 'Blitz',
  erde: 'Erde',
  wind: 'Wind',
  wasser: 'Wasser',
  heilig: 'Heilig',
  schatten: 'Schatten',
  gift: 'Gift',
  schwerkraft: 'Schwerkraft',
};

/** Elemente-Matrix-Zeilen (gegner.md Sektion 3 — 8 Zeilen, Teilmenge von ELEMENTE). */
export const MATRIX_ELEMENTE: readonly Element[] = [
  'feuer',
  'eis',
  'blitz',
  'erde',
  'wasser',
  'wind',
  'heilig',
  'schatten',
];

export const STATUS_LABELS: Record<StatusWert, string> = {
  gift: 'Gift',
  schlaf: 'Schlaf',
  blind: 'Blind',
  stumm: 'Stumm',
  frosch: 'Frosch',
  mini: 'Mini',
  langsam: 'Langsam',
  hast: 'Hast',
  stop: 'Stop',
  regen: 'Regen',
  reflekt: 'Reflekt',
  barriere: 'Barriere',
  todesurteil: 'Todesurteil',
  berserk: 'Wut',
  paralyse: 'Paralyse',
  stein: 'Stein',
  verwirrung: 'Verwirrung',
  tod: 'Todesstoß',
};

/** Status-Chip-Reihenfolge im UI (gegner.md-Liste zuerst, Rest der Taxonomie danach). */
export const STATUS_UI_REIHENFOLGE: readonly StatusWert[] = [
  'gift',
  'blind',
  'schlaf',
  'stumm',
  'berserk',
  'verwirrung',
  'stop',
  'langsam',
  'tod',
  ...STATUSWERTE.filter(
    (s) => !['gift', 'blind', 'schlaf', 'stumm', 'berserk', 'verwirrung', 'stop', 'langsam', 'tod'].includes(s),
  ),
];

/* ------------------------------------------------------------------ */
/* Affinitäten (5-Zustände-Cycler)                                     */
/* ------------------------------------------------------------------ */

export const AFFINITAET_REIHENFOLGE: readonly ElementAffinitaet[] = [
  'schwach',
  'normal',
  'resistent',
  'immun',
  'absorbiert',
];

export const AFFINITAET_LABELS: Record<ElementAffinitaet, string> = {
  schwach: 'Schwach',
  normal: 'Normal',
  resistent: 'Resistent',
  immun: 'Immun',
  absorbiert: 'Absorbiert',
};

/** Farbklassen (Tailwind, explizit enumeriert) je Zustand. */
export const AFFINITAET_STILE: Record<ElementAffinitaet, string> = {
  schwach: 'border-error/60 bg-error/15 text-error',
  normal: 'border-subtle bg-inset text-muted',
  resistent: 'border-info/60 bg-info/15 text-info',
  immun: 'border-engine/60 bg-engine/15 text-engine',
  absorbiert: 'border-mako/60 bg-mako-dim text-mako',
};

export function naechsteAffinitaet(aktuell: ElementAffinitaet, richtung: 1 | -1 = 1): ElementAffinitaet {
  const i = AFFINITAET_REIHENFOLGE.indexOf(aktuell);
  const n = AFFINITAET_REIHENFOLGE.length;
  return AFFINITAET_REIHENFOLGE[(i + richtung + n) % n] as ElementAffinitaet;
}

/* ------------------------------------------------------------------ */
/* Verhalten (geschlossene Bedingungs-Menge, ADR-024)                  */
/* ------------------------------------------------------------------ */

export const BEDINGUNG_LABELS: Record<VerhaltensBedingungArt, string> = {
  hp_unter: 'HP unter … %',
  mp_unter: 'MP unter … %',
  runde_jede: 'Jede n-te Runde',
  ziel_hat_status: 'Ziel hat Status',
  gruppenmitglieder_unter: 'Gruppenmitglieder unter n',
  immer: 'Immer',
};

/** Parameter-Art je Bedingung (für den morphenden Parameter-Input). */
export const BEDINGUNG_PARAMETER: Record<VerhaltensBedingungArt, 'prozent' | 'n' | 'status' | 'keiner'> = {
  hp_unter: 'prozent',
  mp_unter: 'prozent',
  runde_jede: 'n',
  ziel_hat_status: 'status',
  gruppenmitglieder_unter: 'n',
  immer: 'keiner',
};

/** Bedingungs-Referenz (Inspektor, Tab Verhalten): Name · Parameter · Beispiel. */
export const BEDINGUNG_REFERENZ: { art: VerhaltensBedingungArt; parameter: string; beispiel: string }[] = [
  { art: 'hp_unter', parameter: 'prozent: 0–100', beispiel: 'hp_unter 25 %' },
  { art: 'mp_unter', parameter: 'prozent: 0–100', beispiel: 'mp_unter 30 %' },
  { art: 'runde_jede', parameter: 'n: ≥ 1', beispiel: 'runde_jede 3' },
  { art: 'ziel_hat_status', parameter: 'status: Taxonomie', beispiel: 'ziel_hat_status blind' },
  { art: 'gruppenmitglieder_unter', parameter: 'n: ≥ 1', beispiel: 'gruppenmitglieder_unter 2' },
  { art: 'immer', parameter: '—', beispiel: 'immer' },
];

export function bedingungStandard(art: VerhaltensBedingungArt): VerhaltensBedingung {
  switch (art) {
    case 'hp_unter':
      return { art, prozent: 50 };
    case 'mp_unter':
      return { art, prozent: 50 };
    case 'runde_jede':
      return { art, n: 2 };
    case 'ziel_hat_status':
      return { art, status: 'blind' };
    case 'gruppenmitglieder_unter':
      return { art, n: 2 };
    case 'immer':
      return { art };
  }
}

export function bedingungText(b: VerhaltensBedingung): string {
  switch (b.art) {
    case 'hp_unter':
      return `HP unter ${b.prozent} %`;
    case 'mp_unter':
      return `MP unter ${b.prozent} %`;
    case 'runde_jede':
      return `Jede ${b.n}. Runde`;
    case 'ziel_hat_status':
      return `Ziel hat Status „${STATUS_LABELS[b.status]}"`;
    case 'gruppenmitglieder_unter':
      return `Gruppenmitglieder unter ${b.n}`;
    case 'immer':
      return 'Immer';
  }
}

/** Index der ersten `immer`-Regel — alle Regeln dahinter sind unerreichbar. */
export function immerIndex(regeln: { wenn: VerhaltensBedingung }[]): number {
  return regeln.findIndex((r) => r.wenn.art === 'immer');
}

/* ------------------------------------------------------------------ */
/* Stats: Budget-Band (Orientierung Original-Level-Band)               */
/* ------------------------------------------------------------------ */

export { ENEMY_STAT_BAND, ELEMENTE, STATUSWERTE };

/** Zielband der Demo-Formation „Slums" — Zeiger außerhalb = Warnung. */
export const ORIENTIERUNGS_BAND = { label: 'Lvl 8–12', min: 260, max: 470, skalaMax: 700 };

/** Heuristische Gesamtstärke aus den Stats (kein Engine-Versprechen). */
export function staerkeHeuristik(s: EnemyStats): number {
  return Math.round(
    s.hp / 2 + s.mp + s.staerke + s.abwehr + s.magie + s.magAbwehr + s.geschick * 0.5 + s.glueck * 0.5 + s.level * 10,
  );
}

export function bandStatus(s: EnemyStats): 'darunter' | 'im-band' | 'darueber' {
  const wert = staerkeHeuristik(s);
  if (wert < ORIENTIERUNGS_BAND.min) return 'darunter';
  if (wert > ORIENTIERUNGS_BAND.max) return 'darueber';
  return 'im-band';
}

/** Stat-Felder des Werte-Grids: Label + Slider-Grenzen aus ENEMY_STAT_BAND (UI-gekappt). */
export const STAT_FELDER: { key: keyof EnemyStats; label: string; max: number }[] = [
  { key: 'hp', label: 'HP', max: 9999 },
  { key: 'mp', label: 'MP', max: 999 },
  { key: 'staerke', label: 'Stärke', max: 255 },
  { key: 'abwehr', label: 'Abwehr', max: 255 },
  { key: 'magie', label: 'Magie', max: 255 },
  { key: 'magAbwehr', label: 'Magie-Abwehr', max: 255 },
  { key: 'geschick', label: 'Geschick', max: 255 },
  { key: 'glueck', label: 'Glück', max: 255 },
  { key: 'level', label: 'Level', max: 99 },
];

export const BELOHNUNG_FELDER: { key: keyof EnemyStats; label: string; max: number }[] = [
  { key: 'exp', label: 'EXP', max: 9999 },
  { key: 'ap', label: 'AP', max: 255 },
  { key: 'gil', label: 'Gil', max: 9999 },
];

/* ------------------------------------------------------------------ */
/* FF-Zeichensatz (Namen/Beschreibung — Live-Validierung)              */
/* ------------------------------------------------------------------ */

const FF_ZEICHEN = /^[A-Za-zÄÖÜäöüß0-9 .,!?"'()\-:;+&…\n]*$/;

export function ffZeichensatzOk(text: string): boolean {
  return FF_ZEICHEN.test(text);
}

/* ------------------------------------------------------------------ */
/* Angriffs-Vorschauzeile (live generierter deutscher Satz)            */
/* ------------------------------------------------------------------ */

function zahlDE(wert: number): string {
  return String(Math.round(wert * 100) / 100).replace('.', ',');
}

function zielPhrase(ziel: EffectZiel): string {
  switch (ziel) {
    case 'wahl_einzeln':
      return 'einem Ziel';
    case 'wahl_gruppe':
      return 'einer Gruppe';
    case 'party':
      return 'der Party';
    case 'selbst':
      return 'sich selbst';
    case 'gegner_einzeln':
      return 'einem Gegner';
    case 'gegner_gruppe':
      return 'der Gegnergruppe';
  }
}

function staerkeText(s: StaerkeUi): string {
  if (s.modus === 'fest') return `${zahlDE(s.wert)}`;
  if (s.modus === 'prozent') return `${zahlDE(s.wert)} %`;
  return `${zahlDE(s.wert)}× Stärke-`;
}

export function angriffsVorschau(a: AngriffUi): string {
  const teile: string[] = [];
  switch (a.art) {
    case 'schaden': {
      const elem = a.element ? `${ELEMENT_LABELS[a.element]}schaden` : 'Schaden';
      const betrag =
        a.staerke.modus === 'faktor'
          ? `${zahlDE(a.staerke.wert)}× Stärke-${elem}`
          : `${staerkeText(a.staerke)} ${elem}`;
      teile.push(`Fügt ${zielPhrase(a.ziel)} ${betrag} zu`);
      break;
    }
    case 'heil_hp':
      teile.push(`Heilt ${zielPhrase(a.ziel)} um ${staerkeText(a.staerke)} HP`);
      break;
    case 'heil_mp':
      teile.push(`Stellt ${zielPhrase(a.ziel)} ${staerkeText(a.staerke)} MP wieder her`);
      break;
    case 'buff':
      teile.push(`Verstärkt ${zielPhrase(a.ziel)} um ${staerkeText(a.staerke)}`);
      break;
    case 'debuff':
      teile.push(`Schwächt ${zielPhrase(a.ziel)} um ${staerkeText(a.staerke)}`);
      break;
    case 'status_setzen':
      teile.push(
        `${Math.round((a.trefferquote ?? 0.3) * 100)} % Chance auf „${a.status ? STATUS_LABELS[a.status] : '—'}" für ${zielPhrase(a.ziel)}`,
      );
      break;
    case 'status_heilen':
      teile.push(`Heilt „${a.status ? STATUS_LABELS[a.status] : '—'}" bei ${zielPhrase(a.ziel)}`);
      break;
  }
  // Bei schaden + status_setzen-Kombi (sekundärer Status) anhängen:
  if (a.art === 'schaden' && a.status && a.trefferquote !== undefined) {
    teile.push(`${Math.round(a.trefferquote * 100)} % Chance auf „${STATUS_LABELS[a.status]}"`);
  }
  let satz = teile.join(', ') + '.';
  if (a.kosten > 0) satz += ` Kosten: ${a.kosten} MP.`;
  return satz;
}

/* ------------------------------------------------------------------ */
/* Referenzen: bekannte lgp-IDs, Formation-Tags, Mock-Items            */
/* ------------------------------------------------------------------ */

export const LGP_BATTLE_IDS: readonly string[] = [
  'lgp:battle/rostwolf',
  'lgp:battle/wachroboter',
  'lgp:battle/mako-schwarm',
  'lgp:battle/schrottgolem',
  'lgp:battle/sektorratte',
];

export const FORMATION_TAGS: readonly string[] = ['slums', 'schwarm', 'boss'];

export const TEXTUR_ASSETS: readonly string[] = [
  'assets/textur-schwarm-nacht.png',
  'assets/textur-schwarm-gruen.png',
  'assets/textur-rostwolf-asch.png',
  'assets/textur-rostwolf-rost.png',
];

export interface MockItem {
  ref: string;
  name: string;
  /** true = eigenes MS11-Item (Mako-Chip), false = Original-Referenz (RefBadge). */
  eigen: boolean;
}

export const MOCK_ITEMS: readonly MockItem[] = [
  { ref: 'mod:de.beispiel.nebenquest/item/mako-tropfen', name: 'Mako-Tropfen', eigen: true },
  { ref: 'mod:de.beispiel.nebenquest/item/heilkraut', name: 'Heilkraut', eigen: true },
  { ref: 'kernel:item/potion', name: 'Potion', eigen: false },
  { ref: 'kernel:item/antidote', name: 'Antidote', eigen: false },
  { ref: 'kernel:item/ether', name: 'Ether', eigen: false },
  { ref: 'kernel:item/phoenix-down', name: 'Phönixfeder', eigen: false },
];

export function itemName(ref: string): string {
  return MOCK_ITEMS.find((i) => i.ref === ref)?.name ?? ref;
}

/** Tote Item-Verweise: nicht in MOCK_ITEMS und keine kernel:/mod:-Form. */
export function itemRefTot(ref: string): boolean {
  if (MOCK_ITEMS.some((i) => i.ref === ref)) return false;
  return !/^(kernel:item\/[a-z0-9-]+|mod:[a-z0-9.-]+\/item\/[a-z0-9-]+)$/.test(ref);
}

/* ------------------------------------------------------------------ */
/* Demo-Gegner (gegner.md: Rostwolf ausgewählt, Mako-Schwarm Textur)   */
/* ------------------------------------------------------------------ */

export const demoGegner: GegnerUi[] = [
  {
    schemaVersion: 1,
    id: 'mod:de.beispiel.nebenquest/enemy/rostwolf',
    name: 'Rostwolf',
    beschreibung:
      'Streift in Rudeln durch die Sektorslums. Rostiges Fell, scharfe Zähne — greift zuerst die Schwächsten an.',
    avatar: './enemy-silhouette-rostwolf.png',
    modell: { art: 'referenz', ref: 'lgp:battle/rostwolf' },
    stats: {
      hp: 280,
      mp: 24,
      staerke: 42,
      abwehr: 28,
      magie: 12,
      magAbwehr: 20,
      geschick: 35,
      glueck: 10,
      level: 9,
      exp: 64,
      ap: 4,
      gil: 120,
    },
    affinitaeten: {
      elemente: { feuer: 'schwach', eis: 'resistent' },
      statusImmunitaeten: ['schlaf'],
    },
    angriffe: [
      {
        id: 'angriff:rostwolf/biss',
        name: 'Biss',
        art: 'schaden',
        ziel: 'wahl_einzeln',
        staerke: { modus: 'faktor', wert: 1.0 },
        kosten: 0,
      },
      {
        id: 'angriff:rostwolf/heulen',
        name: 'Heulen',
        art: 'buff',
        ziel: 'selbst',
        staerke: { modus: 'prozent', wert: 20 },
        kosten: 6,
      },
    ],
    verhalten: {
      art: 'prioritaeten',
      regeln: [
        { wenn: { art: 'hp_unter', prozent: 25 }, dann: 'angriff:rostwolf/heulen', gewicht: 8 },
        { wenn: { art: 'runde_jede', n: 3 }, dann: 'angriff:rostwolf/biss', gewicht: 5 },
        { wenn: { art: 'immer' }, dann: 'angriff:rostwolf/biss', gewicht: 5 },
      ],
    },
    beute: {
      drops: [{ itemRef: 'kernel:item/potion', rate: 0.4 }],
      stehlen: [{ itemRef: 'kernel:item/antidote', rate: 0.25 }],
      morph: undefined,
    },
    formationTags: ['slums'],
  },
  {
    schemaVersion: 1,
    id: 'mod:de.beispiel.nebenquest/enemy/mako-schwarm',
    name: 'Mako-Schwarm',
    beschreibung:
      'Glühende Motten aus verdichtetem Mako. Einzeln harmlos — als Schwarm lähmend. Halte dich von den Rohren fern.',
    avatar: './enemy-silhouette-schwarm.png',
    modell: { art: 'textur-override', ref: 'lgp:battle/mako-schwarm', texturAsset: 'assets/textur-schwarm-nacht.png' },
    stats: {
      hp: 160,
      mp: 40,
      staerke: 18,
      abwehr: 14,
      magie: 32,
      magAbwehr: 36,
      geschick: 48,
      glueck: 14,
      level: 6,
      exp: 40,
      ap: 3,
      gil: 80,
    },
    affinitaeten: {
      elemente: { blitz: 'schwach', wind: 'resistent', heilig: 'absorbiert' },
      statusImmunitaeten: ['blind', 'stumm'],
    },
    angriffe: [
      {
        id: 'angriff:schwarm/stich',
        name: 'Stich',
        art: 'schaden',
        ziel: 'wahl_einzeln',
        staerke: { modus: 'faktor', wert: 0.8 },
        kosten: 0,
      },
      {
        id: 'angriff:schwarm/surren',
        name: 'Surren',
        art: 'status_setzen',
        ziel: 'wahl_einzeln',
        staerke: { modus: 'fest', wert: 1 },
        status: 'blind',
        trefferquote: 0.3,
        kosten: 5,
      },
    ],
    verhalten: {
      art: 'prioritaeten',
      regeln: [
        { wenn: { art: 'runde_jede', n: 2 }, dann: 'angriff:schwarm/surren', gewicht: 6 },
        { wenn: { art: 'gruppenmitglieder_unter', n: 2 }, dann: 'angriff:schwarm/stich', gewicht: 7 },
        { wenn: { art: 'immer' }, dann: 'angriff:schwarm/stich', gewicht: 5 },
      ],
    },
    beute: {
      drops: [
        { itemRef: 'mod:de.beispiel.nebenquest/item/mako-tropfen', rate: 0.6 },
        { itemRef: 'kernel:item/ether', rate: 0.15 },
      ],
      stehlen: [{ itemRef: 'kernel:item/potion', rate: 0.1 }],
      morph: 'kernel:item/potion',
    },
    formationTags: ['schwarm', 'slums'],
  },
];

/** Leerer Gegner für „Neuer Gegner" (Profi: direkte Leer-Anlage). */
export function leererGegner(nummer: number): GegnerUi {
  const id = `mod:de.beispiel.nebenquest/enemy/gegner_${nummer}`;
  return {
    schemaVersion: 1,
    id,
    name: `Gegner ${nummer}`,
    beschreibung: '',
    avatar: './enemy-silhouette-rostwolf.png',
    modell: { art: 'referenz', ref: 'lgp:battle/wachroboter' },
    stats: { hp: 200, mp: 20, staerke: 30, abwehr: 20, magie: 10, magAbwehr: 15, geschick: 25, glueck: 10, level: 8, exp: 50, ap: 3, gil: 100 },
    affinitaeten: { elemente: {}, statusImmunitaeten: [] },
    angriffe: [
      {
        id: `angriff:gegner_${nummer}/schlag`,
        name: 'Schlag',
        art: 'schaden',
        ziel: 'wahl_einzeln',
        staerke: { modus: 'faktor', wert: 1.0 },
        kosten: 0,
      },
    ],
    verhalten: { art: 'prioritaeten', regeln: [{ wenn: { art: 'immer' }, dann: `angriff:gegner_${nummer}/schlag`, gewicht: 5 }] },
    beute: { drops: [], stehlen: [], morph: undefined },
    formationTags: [],
  };
}
