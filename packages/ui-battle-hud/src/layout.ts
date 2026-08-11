/**
 * Kampf-HUD und Ergebnisbildschirm — **die vermessene Geometrie als Daten**
 * (K6/N7).
 *
 * 🔵 **Warum ein eigenes Paket.** `@webmidgar/ui-window` trägt die
 * Fensterschale (Bordüre, Verlauf, Textfarbe) — die ist bei Dialog, Menü und
 * Kampf dieselbe. Was hier dazukommt, ist ausschließlich die **Anordnung**
 * des Kampf-HUD: welche Fenster wo liegen, wo Balken und Spalten sitzen.
 * Diese Zahlen gehören nicht in die Schale (sonst kennt der Dialog plötzlich
 * ATB-Balken) und nicht in `render-battle` (das gehört einem anderen
 * Bereich). Die Schale wird benutzt, NICHT nachgebaut: dieses Paket schreibt
 * keine einzige Fensterfarbe selbst hin.
 *
 * 🟢 **Herkunft der Zahlen.** Alles unten ist an Originalaufnahmen eines
 * echten Steam-Durchlaufs pixelvermessen. Referenzbilder (640×480, unskaliert):
 *
 *   `apps/demo/.shots/ref/20260810223335_1.jpg` — Kampf, ATB teilgefüllt
 *   `apps/demo/.shots/ref/20260810223327_1.jpg` — Kampf, ATB voll + Kommandofenster
 *   `apps/demo/.shots/ref/20260810223321_1.jpg` — Kampf, Gegenprobe
 *   `apps/demo/.shots/ref/20260810223347_1.jpg` — Ergebnisbildschirm (EXP/AP)
 *   `apps/demo/.shots/ref/20260810223349_1.jpg` — Ergebnisbildschirm mit LEVEL UP
 *
 * Die Fensterkanten aus Finding **F40** (`docs/DEMO-FINDINGS-1.0.md`) sind in
 * dieser Runde **unabhängig nachgemessen** worden (Kantensuche über die
 * Bordürenfarben, Skript in der Sitzung). Ergebnis: Übereinstimmung innerhalb
 * von 1–3 px; die Abweichung ist genau die Frage, ob die äußerste, vom
 * JPEG weichgezeichnete Bordürenzeile mitgezählt wird. Übernommen sind die
 * F40-Werte (sie sind der veröffentlichte Katalog), die Nachmessung steht als
 * Kommentar an jeder Konstante.
 *
 * Was NICHT gemessen werden konnte, ist als 🟡 markiert und trägt die
 * Herleitung im Kommentar — vor allem der **Zeilenabstand**: in allen
 * Referenzaufnahmen steht Cloud allein in der Gruppe, es gibt also keine
 * zweite Zeile zum Nachmessen.
 */

import { RENDER_SURFACE } from '@webmidgar/ui-window';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rechteck aus zwei Eckpunkten (beide **einschließlich**, so wie F40 notiert). */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 🟢 Zeichenfläche des Kampfes. Identisch mit Field: 640×448 Spielfläche,
 * darunter ein 32-px-Balken (`RENDER_SURFACE` aus der Fensterschale). Die
 * HUD-Fenster liegen im UNTEREN Teil der Spielfläche; das Kommandofenster
 * ragt bewusst in den Balken hinein (gemessen: Unterkante y=450).
 */
export const BATTLE_SURFACE = RENDER_SURFACE;

/**
 * 🟢 **Das linke HUD-Fenster** („NAME / BARRIER"): F40 `(1,333)–(270,442)`.
 * Nachgemessen 2026-08-11: äußere Bordürenkante bei x=0…273, y=332…443 —
 * also dieselbe Kante ±1 px je Seite.
 */
export const HUD_STATUS_WINDOW: Rect = rectFromCorners(1, 333, 270, 442);

/**
 * 🟢 **Das rechte HUD-Fenster** („HP / MP / LIMIT / TIME"): F40
 * `(275,333)–(637,442)`. Nachgemessen: x=274…639, y=332…443.
 * Die beiden Fenster stoßen fast aneinander — der sichtbare Spalt ist die
 * Bordüre selbst, keine Lücke.
 */
export const HUD_GAUGE_WINDOW: Rect = rectFromCorners(275, 333, 637, 442);

/**
 * 🟢 **Kommandofenster** (Attack/Magic/Item …): F40 `(145,341)–(261,450)`.
 * Nachgemessen: x=144…263, y=340…451.
 *
 * Bemerkenswert: Die Breite 117 px ist exakt die Breite, die die
 * Glyphenmetrik als Namensplatzhalter liefert (9 × 13 px, größte Zeichen-
 * breite der Tabelle). Das ist ein Hinweis, aber kein Beleg — deshalb steht
 * die Zahl hier gemessen und nicht gerechnet.
 */
export const HUD_COMMAND_WINDOW: Rect = rectFromCorners(145, 341, 261, 450);

/**
 * 🟢 **Meldungsfenster** über der Bühne (zeigt den Namen der ausgeführten
 * Aktion, z. B. „Machine Gun"). Nachgemessen an `20260810223335_1.jpg`:
 * Bordürenkanten x=32…607, y=16…63 → 576 × 48, also 32 px Rand links und
 * rechts. In F40 nicht katalogisiert.
 */
export const HUD_MESSAGE_WINDOW: Rect = { x: 32, y: 16, w: 576, h: 48 };

/**
 * 🟢 Bordürenstärke der Fensterschale in dieser Größe: 2 px grau + 2 px hell
 * + 1 px dunkel = 5 px je Seite. (Gemessen an der linken Kante des linken
 * HUD-Fensters: x=0…1 grau, 2…3 hell, 4 dunkel.)
 */
export const HUD_FRAME = 5;

/**
 * 🟢 **Höhe der Beschriftungszeile** („NAME"/„BARRIER" bzw.
 * „HP"/„MP"/„LIMIT"/„TIME"). Die Beschriftungen füllen y=338…345, also 8 px
 * Tinte ab der Innenkante (333+5=338). Der reservierte Streifen ist 13 px
 * hoch — das folgt aus der Zeilenrechnung unten und trifft die gemessene
 * Oberkante des ersten Balkens auf den Pixel.
 */
export const HUD_HEADER_HEIGHT = 13;

/**
 * 🟡 **Zeilenabstand einer Gruppenzeile.** NICHT direkt messbar: in jeder
 * Referenzaufnahme steht Cloud allein in der Gruppe, es gibt also keine
 * zweite Zeile zum Abgreifen. Hergeleitet aus der Aufteilung des Innenraums:
 *
 *   Innenhöhe   = 110 − 2·5      = 100 px
 *   Zeilenraum  = 100 − 13       =  87 px
 *   Zeilenhöhe  = 87 / 3         =  29 px   (FF7 zeigt genau 3 Gruppenplätze)
 *
 * **Wie belastbar das ist — genau, und nicht mehr:**
 *
 * - Belegt ist `HUD_HEADER_HEIGHT = 13`, nicht die Zeilenhöhe. Die Oberkante
 *   des ersten Balkens ergibt sich zu 333+5+13 = 351 und trifft die
 *   unabhängig abgelesene Kante y=351 exakt. **Kontrollniveau:** Kopfhöhe 12
 *   ergäbe 350, Kopfhöhe 14 ergäbe 352 — beide daneben. Der Treffer ist also
 *   ein echter, kein zufälliger.
 * - Über die **Zeilenhöhe** sagt dieser Treffer NICHTS: Zeile 0 liegt vor
 *   der ersten Vervielfachung. Für 29 spricht allein, dass 87 / 3 ohne Rest
 *   aufgeht — 28 ließe 3 px übrig, 30 überliefe den Innenraum um 3 px. Das
 *   ist ein Argument, aber es steht und fällt mit der Annahme, dass die drei
 *   Zeilen den Innenraum restlos füllen. Wer eine Aufnahme mit voller Gruppe
 *   hat, misst hier nach.
 */
export const HUD_ROW_HEIGHT = 29;

/** 🟢 FF7 zeigt drei Gruppenplätze im Kampf-HUD. */
export const HUD_ROW_COUNT = 3;

/**
 * 🟢 **Balkenmaße** (BARRIER, LIMIT, TIME — alle drei identisch).
 * Gemessen an `20260810223335_1.jpg`:
 *   BARRIER x=190…263, LIMIT x=476…549, TIME x=554…627 → je 74 px außen
 *   Innenfläche 560…623 (TIME) → **64 px**, in beiden Aufnahmen gleich
 *   senkrecht: Rahmen y=351…353, Füllung y=354…363, Rahmen y=364…366
 * ⇒ außen 74 × 16, Rahmen 5 px waagerecht / 3 px senkrecht, innen 64 × 10.
 *
 * 🟡 **Bekannte Abweichung von 1 px.** Der linke Balkenrahmen liest sich in
 * beiden Aufnahmen als 6 px (554…559 vor der Füllung ab 560), der rechte als
 * 5 px — in Summe 75 statt 74. Eindeutig ist nur die **Innenfläche 64 px**;
 * die äußerste Spalte ist vom JPEG weichgezeichnet. Gewählt ist deshalb der
 * symmetrische Schnitt 5/64/5. Folge, im Browser nachgemessen: Die Füllung
 * beginnt bei x=559 statt 560. Die Rahmenkanten selbst (190/476/554, y=351)
 * treffen auf den Pixel.
 */
export const HUD_BAR = {
  width: 74,
  height: 16,
  frameX: 5,
  frameY: 3,
  get innerWidth(): number {
    return this.width - this.frameX * 2;
  },
  get innerHeight(): number {
    return this.height - this.frameY * 2;
  },
} as const;

/**
 * 🟢 Spaltenversätze im **linken** Fenster, relativ zu `HUD_STATUS_WINDOW.x`.
 * Gemessen: Beschriftung „NAME" und der Name selbst beginnen bei x=28;
 * der BARRIER-Balken beginnt bei x=190.
 */
export const HUD_STATUS_COLUMNS = {
  nameLabel: 27,
  name: 27,
  barrierBar: 189,
} as const;

/**
 * 🟢 Spaltenversätze im **rechten** Fenster, relativ zu `HUD_GAUGE_WINDOW.x`.
 * Gemessen an `20260810223335_1.jpg` (HP „287/ 302", MP „54"):
 *   „HP" x=288 · Ist-HP endet x=341 · Max-HP endet x=405
 *   „MP" x=420 · MP-Wert endet x=470
 *   „LIMIT" x=476 (= Balkenkante) · „TIME" x=554 (= Balkenkante)
 * Werte sind **rechtsbündig** — deshalb stehen hier die rechten Kanten.
 *
 * 🟡 Der Trennstrich „/" zwischen Ist- und Max-HP ließ sich nicht sauber
 * abgreifen: er liegt zwischen x=342 und x=379 in einem Bereich, in dem die
 * Helligkeitsschwelle des Messskripts (>170 je Kanal) nichts findet — die
 * Glyphe ist dort dunkler gezeichnet als die Ziffern. Gesetzt ist deshalb
 * „direkt hinter dem Ist-Wert".
 */
export const HUD_GAUGE_COLUMNS = {
  hpLabel: 13,
  hpValueRight: 67,
  hpSlash: 69,
  hpMaxRight: 131,
  mpLabel: 145,
  mpValueRight: 196,
  limitBar: 201,
  timeBar: 279,
} as const;

/**
 * 🟢 **Balkenfarben.** Der Balken ist kein Flächenton, sondern ein
 * senkrechtes Profil über 10 Zeilen. Gemessen (TIME, grün, x=570):
 *
 *   y354 (97,141,116) · y355 (103,165,128) · y356 (121,200,152)
 *   y357 (140,213,170) ← Kennfarbe · y358 (221,255,241) ← Glanzlinie
 *   y359 (220,253,236) · y360 (203,252,223) · y361 (186,250,213)
 *   y362 (150,234,184) · y363 (151,222,182)
 *
 * Dieselbe Messung mit vollem Balken (`20260810223327_1.jpg`, x=590) liefert
 * die Kennfarbe (228,181,129) und die Glanzlinie (255,245,215).
 *
 * Die **Kennfarben** (Zeile y357) sind damit unabhängig bestätigt und decken
 * sich mit F40: ATB füllend `rgb(145,210,170)`, voll `rgb(227,181,129)`.
 * Der Farbumschlag bei „voll" ist gemessen und keine Erfindung: in
 * `…223327` (Kommandofenster offen, Cloud am Zug) ist der TIME-Balken
 * vollständig sandgelb, in `…223335` (ATB läuft) grün.
 */
export const HUD_BAR_COLORS = {
  /** F40; nachgemessen (140,213,170). */
  atbFilling: [145, 210, 170] as const,
  /** F40; nachgemessen (228,181,129). */
  atbFull: [227, 181, 129] as const,
  /** Neu gemessen (Kennzeile y357 des LIMIT-Balkens): (204,143,176). */
  limit: [204, 143, 176] as const,
  /** Ungefüllter Teil und leerer BARRIER-Balken: (89,89,89). */
  empty: [89, 89, 89] as const,
} as const;

export type Rgb = readonly [number, number, number];

function mix(c: Rgb, target: Rgb, t: number): string {
  const v = (i: 0 | 1 | 2) => Math.round(c[i] + (target[i] - c[i]) * t);
  return `rgb(${v(0)},${v(1)},${v(2)})`;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * 🟡 Das gemessene 10-Zeilen-Profil als CSS-Verlauf. Die Stützstellen sind
 * eine **Näherung** des Profils oben (die Originalzeilen sind nicht durch
 * eine einzige Mischformel darstellbar — Glanzlinie und Kennfarbe mischen mit
 * unterschiedlichen Anteilen je Kanal). Was stimmt: Kennfarbe in der Mitte,
 * abgedunkelte Oberkante, helle Glanzlinie knapp unter der Mitte.
 */
export function gaugeGradient(base: Rgb): string {
  return (
    'linear-gradient(180deg,' +
    `${mix(base, BLACK, 0.32)} 0%,` +
    `${mix(base, BLACK, 0.0)} 35%,` +
    `${mix(base, WHITE, 0.8)} 45%,` +
    `${mix(base, WHITE, 0.72)} 62%,` +
    `${mix(base, BLACK, 0.0)} 78%,` +
    `${mix(base, WHITE, 0.1)} 100%)`
  );
}

export function rgbCss(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * 🟢/🟡 **Schriftmaße des HUD.** Gemessen an `20260810223335_1.jpg`:
 *   Name „Ex-SOLDIER"   Tinte y=350…365 → 16 px hoch, Vorschub 12…16 px
 *   Zahlen „287/ 302"   Tinte y=348…361 → 14 px hoch, Vorschub 14 px
 *   Beschriftung „NAME" Tinte y=338…345 →  8 px hoch
 *
 * 🟡 Daraus abgeleitete CSS-Größen: Das HUD zeichnet weiterhin mit einer
 * Systemschrift, nicht aus dem Fontblatt in WINDOW.BIN (offener Punkt 4 der
 * Glyphen-Grundlage). Die Kästchen stimmen damit, die Strichbreiten nicht.
 */
export const HUD_TYPE = {
  /** Gruppenname und Zahlenwerte. */
  valueSize: 17,
  /** Spaltenüberschriften („NAME", „HP", „LIMIT" …). */
  labelSize: 11,
  /** Kommandoeinträge im Kommandofenster. */
  commandSize: 17,
  /** Zeilenhöhe im Kommandofenster (4 Einträge in 110 px − 2·5 Rahmen). */
  commandLineHeight: 25,
} as const;

/** Absolute Lage der Balkenkästen einer Gruppenzeile (0-basiert). */
export function hudRowTop(row: number): number {
  return HUD_STATUS_WINDOW.y + HUD_FRAME + HUD_HEADER_HEIGHT + row * HUD_ROW_HEIGHT;
}

export function hudBarRect(row: number, columnOffset: number, windowX: number): Rect {
  return {
    x: windowX + columnOffset,
    y: hudRowTop(row),
    w: HUD_BAR.width,
    h: HUD_BAR.height,
  };
}

// --- Ergebnisbildschirm (N7) -------------------------------------------------------

/**
 * 🟢 **Ergebnisbildschirm.** Der Sieg-Bildschirm nutzt die **volle**
 * Menüfläche 640×480 (nicht 640×448) und teilt sie lückenlos in fünf
 * Fensterbänder. Nachgemessen an `20260810223347_1.jpg` (Kantensuche über die
 * Bordürenfarben, waagerechte Läufe > 300 px):
 *
 *   Meldung     Oberkante y=0    Unterkante y=67    → Höhe 68
 *   EXP / AP    Oberkante y=68   Unterkante y=119   → Höhe 52
 *   Figur 1     Oberkante y=120  Unterkante y=239   → Höhe 120
 *   Figur 2     Oberkante y=240  Unterkante y=359   → Höhe 120
 *   Figur 3     Oberkante y=360  Unterkante y=479   → Höhe 120
 *
 * Summe 68+52+3·120 = 480 — das Band füllt den Schirm restlos, was die
 * Ablesung gegenprüft. Die Trennung EXP|AP liegt bei x=346 (dort beginnt die
 * linke Bordüre des AP-Fensters; das EXP-Fenster läuft dahinter aus).
 */
export const RESULT_LAYOUT = {
  surface: { width: 640, height: 480 },
  message: { x: 0, y: 0, w: 640, h: 68 } as Rect,
  exp: { x: 0, y: 68, w: 351, h: 52 } as Rect,
  ap: { x: 346, y: 68, w: 294, h: 52 } as Rect,
  memberHeight: 120,
  memberTop: 120,
  memberCount: 3,
  /**
   * 🟢 Textspalten der oberen drei Fenster, gemessen an `…223347_1.jpg`:
   * Meldungstext beginnt x=27 (Tinte y=28…43); „EXP" x=57 und sein Wert
   * „32p" endet x=291; „AP" x=402 und sein Wert „4p" endet x=573.
   */
  messageText: { x: 27, dy: 28 } as const,
  expLabel: 57,
  expValueRight: 293,
  apLabel: 56,
  apValueRight: 229,
} as const;

export function resultMemberRect(index: number): Rect {
  return {
    x: 0,
    y: RESULT_LAYOUT.memberTop + index * RESULT_LAYOUT.memberHeight,
    w: RESULT_LAYOUT.surface.width,
    h: RESULT_LAYOUT.memberHeight,
  };
}

/**
 * 🟢 Spaltenversätze im Figurenfenster, gemessen an `…223347_1.jpg`
 * (Figurenfenster 1 liegt bei y=120; `dy` ist der Versatz zu dessen
 * Oberkante). Ermittelt über die Zeilen-/Spalten-Histogramme heller Pixel:
 *
 *   Porträtkachel  x=35…118, y=129…224          → 84 × 96, dy=9
 *   Name           Tinte x=141…261, y=141…161   → dy=21
 *   „EXP:"         Tinte x=355…416, gleiche Zeile
 *   EXP-Wert       „610p" endet x=580           → rechtsbündig 582
 *   EXP-Balken     x=448…572, y=171…185         → 125 × 15, dy=51
 *   „Level:"       Tinte x=178…231, y=195…212   → dy=75
 *   Levelwert      „6" endet x=261              → rechtsbündig 263
 *   „next level:"  Tinte x=307…402
 *   Restwert       „6p" endet x=580             → rechtsbündig 582
 */
export const RESULT_MEMBER_COLUMNS = {
  portrait: { x: 35, dy: 9, w: 84, h: 96 } as const,
  name: 141,
  nameDy: 21,
  expLabel: 355,
  expValueRight: 582,
  expBar: { x: 448, dy: 51, w: 125, h: 15 } as const,
  levelLabel: 178,
  levelDy: 75,
  levelValueRight: 263,
  nextLabel: 307,
  nextValueRight: 582,
  /**
   * 🟢 Das „LEVEL UP"-Schild aus `20260810223349_1.jpg`: Bordürenkanten
   * x=58…184 (links grau 58/59, hell 60/61, dunkel 62 — dieselbe 5-px-
   * Rezeptur wie jedes andere Fenster) und y=184…225. Es liegt ÜBER der
   * Levelzeile und verdeckt dort das „L" von „Level:".
   */
  levelUpBadge: { x: 58, dy: 64, w: 127, h: 42 } as const,
} as const;

/**
 * 🟢 Der „LEVEL UP"-Schriftzug ist gelb: gemessen im Schriftzug bei y=205
 * Spitzenwert (235,232,31), typische Glyphenmitte (224,224,75) — also ein
 * gesättigtes Grüngelb, nicht Weiß.
 *
 * 🟢 Der EXP-Fortschrittsbalken ist rosa: bei y=177 flächig (243,197,199),
 * derselbe Farbton wie der LIMIT-Balken im Kampf (dort heller, weil dieser
 * Balken fast voll ist).
 */
export const RESULT_COLORS = {
  levelUpText: [228, 226, 60] as const,
  expBar: HUD_BAR_COLORS.limit,
} as const;
