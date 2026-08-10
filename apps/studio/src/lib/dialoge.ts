/**
 * Dialog-Editor — lokale Logik und Demo-Ableitungen (dialoge.md).
 *
 * Enthält:
 *  - Token-Modell + Parser ({FARBE:…}, {PAUSE:…}, {VAR:…}, Auswahl über „→"-Zeilen)
 *  - Wort-Umbruch wie die Engine (feste Zeilenbreite in Zeichen, 3 Zeilen/Seite)
 *  - Aufbau der Dokumentliste (Field × Sprache) aus den Mock-Dialogen plus
 *    lokal abgeleiteter EN-Lokalisierungsstände (Fallback-Befund)
 *  - Schreibgeschützte Original-Referenzzeilen für referenzierte Felder
 *
 * Reine UI-Ebene — der Mock-Store (mock-project.ts) bleibt unverändert.
 */
import type { DialogueControl, DialogueDoc, DialogueEntry } from '@webmidgar/studio-core';
import { demoDialoge, demoVariablen } from '@/lib/mock-project';

/* ------------------------------------------------------------------ */
/* Konstanten der FF7-Box                                              */
/* ------------------------------------------------------------------ */

/** Zeilenbreite der Dialogbox in Zeichen (Wort-Umbruch wie die Engine). */
export const ZEICHEN_PRO_ZEILE = 24;
/** Zeilen pro Seite, die die FF7-Box fasst. */
export const ZEILEN_PRO_SEITE = 3;
/** Tippgeschwindigkeit der Vorschau (ms pro Zeichen). */
export const TIPP_MS_PRO_ZEICHEN = 30;
/** Dauer eines Pause-Frames in ms (≈ 60 fps). */
export const MS_PRO_FRAME = 17;

/** Die 8 FF7-Textfarben (Toolbar-Palette). */
export const FF7_FARBEN = [
  { name: 'weiss', label: 'Weiß', hex: '#FFFFFF' },
  { name: 'grau', label: 'Grau', hex: '#9AA0A8' },
  { name: 'rot', label: 'Rot', hex: '#F25555' },
  { name: 'gelb', label: 'Gelb', hex: '#F2D84B' },
  { name: 'gruen', label: 'Grün', hex: '#59D959' },
  { name: 'cyan', label: 'Cyan', hex: '#55D9F2' },
  { name: 'lila', label: 'Lila', hex: '#B98CF2' },
  { name: 'mako', label: 'Mako-Grün', hex: '#3DDC97' },
] as const;

export type Ff7FarbName = (typeof FF7_FARBEN)[number]['name'];

export function farbHex(name: string): string {
  return FF7_FARBEN.find((f) => f.name === name)?.hex ?? '#FFFFFF';
}

/* ------------------------------------------------------------------ */
/* Token-Modell                                                        */
/* ------------------------------------------------------------------ */

export type TokenArt = 'farbe' | 'pause' | 'variable' | 'auswahl';

export interface DialogToken {
  art: TokenArt;
  wert: string;
  /** Rohtext inkl. Klammern (für Auswahl: „→ Option"). */
  roh: string;
  /** Startindex im Seiten-Text (für Token-Sprung/Puls). */
  position: number;
}

export interface TextSegment {
  typ: 'text' | TokenArt;
  wert: string;
  roh: string;
  position: number;
}

const TOKEN_RE = /\{(FARBE|PAUSE|VAR):([^}]+)\}|\{([a-z_][a-z0-9_]*)\}/gi;

/** Bekannte Variablen (variables.json + Engine-Standardwerte). */
export const VARIABLEN_WERTE: Record<string, string> = {
  gil: '42',
  quest_phase: '2',
  ...Object.fromEntries(demoVariablen.benannt.map((v) => [v.name, v.name === 'story_fortschritt' ? '3' : v.name === 'lina_vertrauen' ? '2' : '1'])),
};

/** Variablenliste für das Autocomplete im Toolbar-Popover. */
export const VARIABLEN_LISTE = [
  ...demoVariablen.benannt.map((v) => ({ name: v.name, kommentar: v.kommentar })),
  { name: 'gil', kommentar: 'Engine-Standard: Geld der Gruppe' },
  { name: 'quest_phase', kommentar: 'Engine-Standard: globale Questphase' },
];

/**
 * Zerlegt einen Seiten-Text in Segmente (Text + Token).
 * Erkennt {FARBE:…}, {PAUSE:…}, {VAR:…} sowie bare {name} für bekannte
 * Variablen (Demo-Daten nutzen diese Kurzform).
 */
export function parseSegmente(text: string): TextSegment[] {
  const segmente: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    const art = match[1]?.toLowerCase();
    const bare = match[3];
    // Bare {name} nur als Variable zählen, wenn der Name bekannt ist.
    const istToken = art === 'farbe' || art === 'pause' || art === 'variable' || (bare !== undefined && bare in VARIABLEN_WERTE);
    if (!istToken) continue;
    if (idx > cursor) segmente.push({ typ: 'text', wert: text.slice(cursor, idx), roh: text.slice(cursor, idx), position: cursor });
    const wert = art ? (match[2] ?? '') : (bare ?? '');
    const typ: TokenArt = art === 'farbe' ? 'farbe' : art === 'pause' ? 'pause' : 'variable';
    segmente.push({ typ, wert, roh: match[0], position: idx });
    cursor = idx + match[0].length;
  }
  if (cursor < text.length) segmente.push({ typ: 'text', wert: text.slice(cursor), roh: text.slice(cursor), position: cursor });
  return segmente;
}

/**
 * Alle Token eines Eintrags (über alle Seiten), inkl. Auswahlmenüs
 * („→"-Zeilen) und deklarierter Steuerelemente ohne Inline-Token.
 */
export function tokenDesEintrags(eintrag: DialogEintrag): DialogToken[] {
  const tokens: DialogToken[] = [];
  eintrag.seiten.forEach((seite) => {
    for (const seg of parseSegmente(seite.text)) {
      if (seg.typ !== 'text') tokens.push({ art: seg.typ, wert: seg.wert, roh: seg.roh, position: seg.position });
    }
    const auswahlZeilen = seite.text.split('\n').filter((z) => z.trimStart().startsWith('→'));
    if (auswahlZeilen.length >= 2) {
      tokens.push({
        art: 'auswahl',
        wert: String(auswahlZeilen.length),
        roh: `${auswahlZeilen.length} Optionen`,
        position: seite.text.indexOf('→'),
      });
    }
    // Deklarierte Steuerelemente ohne Inline-Token (Demo-Daten) ergänzen.
    for (const st of seite.steuerelemente ?? []) {
      const schonDa = tokens.some((t) => t.art === st.art && t.wert === st.wert);
      if (!schonDa && (st.art === 'farbe' || st.art === 'pause' || st.art === 'auswahl' || st.art === 'variable')) {
        tokens.push({ art: st.art, wert: st.wert, roh: st.art === 'auswahl' ? `${st.wert} Optionen` : st.wert, position: -1 });
      }
    }
  });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Wort-Umbruch + Vorschau-Auflösung                                   */
/* ------------------------------------------------------------------ */

/** Ein aufgelöstes Zeichen für die Tipp-Animation. */
export interface VorschauZeichen {
  char: string;
  farbe: string;
}

/** Aufgelöste Seite: gewrappte Zeilen + Auswahl-Metadaten. */
export interface VorschauSeite {
  /** Zeilen (jeweils aufgelöste Zeichen, Farben angewendet). */
  zeilen: VorschauZeichen[][];
  /** Indizes der Optionszeilen (für den ▶-Cursor), leer = kein Auswahlmenü. */
  optionen: number[];
  /** Positionen von Pause-Token: nach wie vielen getippten Zeichen wie lange warten. */
  pausen: { nachZeichen: number; frames: number }[];
  /** Gesamtzahl sichtbarer Zeichen (ohne Token). */
  zeichenGesamt: number;
}

function wrapWort(text: string, breite: number): string[] {
  const worte = text.split(' ');
  const zeilen: string[] = [];
  let aktuell = '';
  for (const wort of worte) {
    const kandidat = aktuell ? `${aktuell} ${wort}` : wort;
    if (kandidat.length <= breite) {
      aktuell = kandidat;
    } else {
      if (aktuell) zeilen.push(aktuell);
      // Sehr lange Wörter hart umbrechen.
      let rest = wort;
      while (rest.length > breite) {
        zeilen.push(rest.slice(0, breite));
        rest = rest.slice(breite);
      }
      aktuell = rest;
    }
  }
  zeilen.push(aktuell);
  return zeilen;
}

/**
 * Löst eine Dialogseite für die FF7-Vorschau auf:
 * Token → Werte/Farben/Pausen, Wort-Umbruch auf Engine-Zeilenbreite,
 * „→"-Zeilen werden Auswahloptionen (ohne Pfeil, mit Cursor).
 */
export function loeseSeiteAuf(seite: DialogSeite): VorschauSeite {
  const quellZeilen = seite.text.split('\n');
  const auswahlZeilen = quellZeilen.filter((z) => z.trimStart().startsWith('→'));

  // Seiten-Farbe aus deklariertem Steuerelement (Demo-Daten ohne Inline-Token).
  const seitenFarbe = (seite.steuerelemente ?? []).find((s) => s.art === 'farbe')?.wert;

  const zeilen: VorschauZeichen[][] = [];
  const optionen: number[] = [];
  const pausen: { nachZeichen: number; frames: number }[] = [];
  let farbe = seitenFarbe ? farbHex(seitenFarbe) : '#FFFFFF';
  let zeichenGesamt = 0;

  for (const quellZeile of quellZeilen) {
    const istOption = quellZeile.trimStart().startsWith('→');
    const zeilenText = istOption ? quellZeile.trimStart().slice(1).trimStart() : quellZeile;

    // Zeile in Zeichen auflösen (Token auswerten).
    const zeichen: VorschauZeichen[] = [];
    let textPuffer = '';
    const flush = () => {
      for (const c of textPuffer) zeichen.push({ char: c, farbe });
      textPuffer = '';
    };
    for (const seg of parseSegmente(zeilenText)) {
      if (seg.typ === 'text') {
        textPuffer += seg.wert;
      } else if (seg.typ === 'farbe') {
        flush();
        farbe = farbHex(seg.wert);
      } else if (seg.typ === 'variable') {
        flush();
        for (const c of VARIABLEN_WERTE[seg.wert] ?? `?${seg.wert}?`) zeichen.push({ char: c, farbe: '#F2D84B' });
      } else if (seg.typ === 'pause') {
        flush();
        pausen.push({ nachZeichen: zeichenGesamt + zeichen.length, frames: Number.parseInt(seg.wert, 10) || 15 });
      }
    }
    flush();

    // Wort-Umbruch der aufgelösten Zeichen (Farb-Runs bleiben erhalten).
    const alsText = zeichen.map((z) => z.char).join('');
    const gewrappt = wrapWort(alsText, ZEICHEN_PRO_ZEILE);
    let offset = 0;
    gewrappt.forEach((teil, ti) => {
      // wrapWort arbeitet auf Text-Ebene; Zeichen per Index zurückholen.
      // Leerzeichen am Zeilenanfang entfernen (kommt vom Umbruch).
      const start = offset;
      const laenge = teil.length;
      const run = zeichen.slice(start, start + laenge);
      // Offset für nächste Zeile: +1 für das verschluckte Leerzeichen.
      offset = start + laenge;
      while (offset < zeichen.length && zeichen[offset]!.char === ' ' && teil !== '') offset += 1;
      // Nur die erste gewrappte Zeile einer Option bekommt den Cursor.
      if (istOption && ti === 0) optionen.push(zeilen.length);
      zeilen.push(run);
    });
    zeichenGesamt += zeichen.length;
  }

  // Pause aus deklariertem Steuerelement am Seitenende (Demo-Daten).
  const seitenPause = (seite.steuerelemente ?? []).find((s) => s.art === 'pause');
  if (seitenPause && !pausen.some((p) => p.nachZeichen === zeichenGesamt)) {
    pausen.push({ nachZeichen: zeichenGesamt, frames: Number.parseInt(seitenPause.wert, 10) || 30 });
  }

  return { zeilen, optionen: auswahlZeilen.length >= 2 ? optionen : [], pausen, zeichenGesamt };
}

/* ------------------------------------------------------------------ */
/* Seiten-Datenmodell (lokale UI-Ebene)                                */
/* ------------------------------------------------------------------ */

export interface DialogSeite {
  text: string;
  steuerelemente?: DialogueControl[];
}

export interface DialogEintrag {
  id: string;
  sprecher?: string;
  seiten: DialogSeite[];
  delta?: { guardHash: string; ersetztOriginalIndex?: number };
  /** Schreibgeschützte Original-Referenzzeile (nie gespeicherter Originaltext). */
  referenz?: boolean;
  originalIndex?: number;
  /** Lokalisierung: EN-Stand älter als Primärtext → „veraltet". */
  veraltet?: boolean;
  /** Herkunfts-Referenzzeile (für „Delta entfernen → Original zurück"). */
  refId?: string;
}

export interface DialogDokument {
  id: string;
  /** Kanonische Field-ID (field:… oder mod:…). */
  field: string;
  fieldName: string;
  fieldSlug: string;
  locale: string;
  pfad: string;
  /** true = Delta auf Original (Referenz-Dokument). */
  istReferenz: boolean;
  guardHash?: string;
  eintraege: DialogEintrag[];
}

export const FELD_NAMEN: Record<string, string> = {
  md1_1: 'Sektor-8-Platz',
  slumkirche_aussen: 'Slumkirche außen',
};

function zuEintrag(e: DialogueEntry): DialogEintrag {
  return {
    id: e.id,
    sprecher: e.sprecher,
    seiten: e.seiten.map((s) => ({ text: s.text, steuerelemente: s.steuerelemente })),
    delta: e.delta ? { guardHash: e.delta.guardHash, ersetztOriginalIndex: e.delta.ersetztOriginalIndex } : undefined,
  };
}

/** EN-Übersetzungen der Demo-Einträge (lokaler Lokalisierungsstand). */
const EN_UEBERSETZUNGEN: Record<string, string[]> = {
  'dlg:md1_1/lina-gruss': [
    'Hey! You are not from around here, are you?\nWatch your step — the plate is brittle.',
    'They call me Lina. I keep this church together.',
  ],
  'dlg:md1_1/wache-original': ['Halt! This sector is off-limits to civilians.'],
  'dlg:md1_1/lina-hinweis': ['Once your {story_fortschritt} is far enough, I will show you the back exit.'],
  'dlg:slumkirche/tuer-schild': ['"Chapel of the Last Lantern" — the sign hangs crooked.'],
};

/** Einträge, deren Übersetzung veraltet ist (Primärtext später geändert). */
const VERALTETE_EN = new Set(['dlg:md1_1/lina-hinweis']);

function docPfad(doc: DialogueDoc): string {
  const slug = doc.field.startsWith('mod:') ? doc.field.split('/').pop()! : doc.field.replace('field:', '');
  return `dialogues/${slug}/${doc.locale}`;
}

/** Baut die lokale Dokumentliste (Field × Sprache) aus den Mock-Dialogen. */
export function baueDokumente(): DialogDokument[] {
  const docs: DialogDokument[] = [];
  for (const doc of demoDialoge) {
    const slug = doc.field.startsWith('mod:') ? doc.field.split('/').pop()! : doc.field.replace('field:', '');
    const istReferenz = doc.field.startsWith('field:');
    const basis: Omit<DialogDokument, 'locale' | 'id' | 'eintraege'> = {
      field: doc.field,
      fieldName: FELD_NAMEN[slug] ?? slug,
      fieldSlug: slug,
      pfad: docPfad(doc).replace(/\/[^/]+$/, ''),
      istReferenz,
      guardHash: istReferenz ? 'a3f9…c1' : undefined,
    };
    // Primärsprache DE
    docs.push({ ...basis, id: `${slug}/de`, locale: 'de', eintraege: doc.eintraege.map(zuEintrag) });
    // Fallback-Sprache EN: nur übersetzte Einträge, Rest fehlt.
    const enEintraege: DialogEintrag[] = doc.eintraege
      .filter((e) => EN_UEBERSETZUNGEN[e.id])
      .map((e) => ({
        id: e.id,
        sprecher: e.sprecher,
        seiten: (EN_UEBERSETZUNGEN[e.id] ?? []).map((text) => ({ text })),
        delta: e.delta ? { guardHash: e.delta.guardHash, ersetztOriginalIndex: e.delta.ersetztOriginalIndex } : undefined,
        veraltet: VERALTETE_EN.has(e.id),
      }));
    docs.push({ ...basis, id: `${slug}/en`, locale: 'en', eintraege: enEintraege });
  }
  return docs;
}

/* ------------------------------------------------------------------ */
/* Original-Referenzzeilen (schreibgeschützt, Originaltext nie lokal)  */
/* ------------------------------------------------------------------ */

export interface OriginalZeile {
  id: string;
  sprecher: string;
  originalIndex: number;
  guardHash: string;
}

/**
 * Original-Dialoge der referenzierten Felder. Es wird bewusst KEIN
 * Originaltext hinterlegt — nur Metadaten (Sprecher, Index, guardHash).
 */
export const ORIGINAL_ZEILEN: Record<string, OriginalZeile[]> = {
  md1_1: [
    { id: 'orig:md1_1/3', sprecher: 'Bürger', originalIndex: 3, guardHash: 'c41d…9a' },
    { id: 'orig:md1_1/5', sprecher: 'Soldat', originalIndex: 5, guardHash: '88be…10' },
  ],
};

/** Kürzt einen guardHash für die Chip-Darstellung (a3f9b2c1 → a3f9…c1). */
export function kurzHash(hash: string): string {
  if (hash.includes('…')) return hash;
  return hash.length > 6 ? `${hash.slice(0, 4)}…${hash.slice(-2)}` : hash;
}

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

/** Erste sichtbare Zeile eines Eintrags (Token-roh, für die Listen-Vorschau). */
export function ersteZeile(eintrag: DialogEintrag): string {
  return eintrag.seiten[0]?.text.split('\n')[0] ?? '';
}

/** Zeichenzähler eines Eintrags (alle Seiten, nur sichtbarer Text). */
export function zeichenZahl(eintrag: DialogEintrag): number {
  return eintrag.seiten.reduce((summe, s) => summe + s.text.replace(TOKEN_RE, '').length, 0);
}
