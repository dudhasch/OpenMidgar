import { RENDER_SURFACE } from '@webmidgar/ui-window';

/**
 * Bildschirmaufteilung des Hauptmenüs (F24-B, Teil 5) — **als Daten**.
 *
 * 🔵 **Warum als Daten und nicht als Code.** Die Anordnung ist der einzige
 * Teil dieses Menüs, für den es keinen Beleg gibt (siehe unten). Alles, was
 * unbelegt ist, gehört an **eine** Stelle, an der es sich austauschen lässt,
 * sobald ein Beleg auftaucht — nicht verteilt über eine Zeichenfunktion.
 * `buildMainScreen` nimmt dieses Objekt als Parameter; wer eine Menüaufnahme
 * hat, ändert nur die Zahlen hier.
 *
 * 🔴 **Der Beleg fehlt, und das ist eine Aussage, keine Auslassung.** Der
 * Auftrag verlangt, die Anordnung an den Original-Screenshots in
 * `apps/demo/.shots/ref/` zu messen. Die 18 Aufnahmen des Steam-Durchlaufs
 * zeigen: Weltkarte/Sternenhimmel, sechs Field-Szenen, drei Kampfszenen, ein
 * Dialogfenster und drei Kampfabschluss-Bildschirme. **Eine Aufnahme des
 * Hauptmenüs ist nicht dabei.** Die Anordnung unten ist deshalb durchgehend
 * 🟡; belegt ist an ihr nur das, was ausdrücklich mit 🟢 markiert ist.
 *
 * 🟢 **Was sich trotzdem messen ließ.** Die drei Kampfabschluss-Bildschirme
 * (`20260810223347_1.jpg`, `…349`, `…351`) sind Vollbild-Fensterstapel in
 * derselben Optik wie das Menü und liegen in 640×480 vor. An ihnen gemessen
 * (Pixelabtastung der Rahmenkanten):
 *
 *  - Die Fenster sitzen **bündig am Bildrand**: linke Rahmenkante bei x = 0,
 *    obere bei y = 0, rechte endet bei x = 637, untere bei y = 479. Ein
 *    Außenrand von 8 px, wie ihn die Field-Fenstergeometrie kennt, existiert
 *    hier nicht.
 *  - Zwischen zwei gestapelten Fenstern liegen **2 px** Zwischenraum.
 *  - Die Bordüre ist 5–6 px stark und dreilagig — gemessen 2 px mittelgrau,
 *    2 px hellgrau, 1–2 px dunkel. Das deckt sich mit `FF7_WINDOW_SKIN`
 *    (2/2/1) und ist der Grund, warum diese Datei die Schale **nicht**
 *    nachbaut, sondern benutzt.
 *
 * ⚠️ **Nebenbefund für den Besitzer von `@webmidgar/ui-window`:** An der
 * Oberkante liegen die Lagen von außen nach innen mittelgrau → hellgrau →
 * dunkel, an der **Unterkante in derselben Reihenfolge von oben nach unten**,
 * also innen mittelgrau und außen dunkel. Die Schale zeichnet beide Kanten
 * gespiegelt. Das ist ein 2-px-Unterschied an der Unterkante; hier wird nichts
 * geändert, weil die Schale einem anderen Auftrag gehört.
 */

/** 🟢 Menüs zeichnen auf die volle Fläche, nicht auf die 640×448 von Field/Kampf (F40). */
export const MENU_SURFACE = { width: RENDER_SURFACE.width, height: RENDER_SURFACE.height } as const;

/** 🟢 Zwischenraum zwischen gestapelten Fenstern, an den Referenzbildern gemessen. */
export const PANEL_GAP = 2;

/** 🟢 Außenrand: keiner — die Fenster sitzen bündig am Bildrand. */
export const SCREEN_MARGIN = 0;

export interface MenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Die Aufteilung des Hauptmenüs. Sämtliche Werte 🟡.
 *
 * ⚠️ **Bekannter Widerspruch, offen.** Die Auftragsbeschreibung nennt
 * „Kommandospalte links, Gruppenfenster rechts, Zeit/Gil/Ort unten links" —
 * so ist es hier umgesetzt. Es gibt aber weder eine Aufnahme noch eine
 * Fremdbeschreibung, die das bestätigt, und die Seitenwahl ist genau die
 * Sorte Detail, bei der eine Erinnerung trügt. Wer eine Menüaufnahme hat,
 * entscheidet es hier in einem Objekt.
 */
export interface MainMenuLayout {
  /** Fenster der Kommandoliste. */
  commands: MenuRect;
  /** Fenster der Gruppenübersicht. */
  party: MenuRect;
  /** Ortsanzeige. */
  location: MenuRect;
  /** Spielzeit und Gil. */
  timeGil: MenuRect;
  /** Höhe eines Gruppeneintrags innerhalb des Gruppenfensters. */
  partyEntryHeight: number;
  /** Spaltenanker innerhalb der Textfläche eines Fensters, in Pixeln. */
  columns: {
    /** Wertespalte rechtsbündig — Abstand vom rechten Textflächenrand. */
    valueRight: number;
    /** Zweite Spalte (z. B. „HP") linksbündig. */
    second: number;
    /** Dritte Spalte (z. B. „MP"). */
    third: number;
    /** Balkenbreite in Pixeln. */
    barWidth: number;
  };
}

/**
 * 🟡 Die Vorgabeaufteilung. Die Zahlen ergeben sich aus dem Raster: 640 px
 * Breite, links eine Kommandospalte (Breite seit Welle 3 aus der gemessenen
 * Spielschrift abgeleitet, s. `LINKE_SPALTE`), rechts der Rest.
 *
 * 🟢 **Was an ihnen KEINE Wahl mehr ist — das Höhenbudget** (gemessen beim
 * Verdrahten der Demo, weil die erste Fassung die Gil-Zeile verschluckte):
 * Ein Fenster trägt `n` Zeilen genau dann, wenn seine Höhe mindestens
 * `n · lineHeight + 2 · borderThickness + padding[1] + padding[3]` ist — mit
 * `FF7_WINDOW_SKIN` also `n · 32 + 22`. Daraus folgt:
 *
 *  - Kommandospalte, 10 Einträge: **342 px** (10 · 32 + 22).
 *  - Zeit/Gil, 2 Zeilen: **86 px**. Ort, 1 Zeile: **54 px**.
 *  - Gruppenfenster, 3 × 4 Zeilen: der letzte Eintrag endet bei
 *    `2 · partyEntryHeight + 4 · 32`; mit `partyEntryHeight = 132` sind das
 *    392 px Textfläche, also 414 px Außenmaß.
 *
 * Drei Fenster ÜBEREINANDER in der linken Spalte gehen damit nicht auf:
 * 342 + 54 + 86 + 2 Zwischenräume = **486 px** bei 480 px Fläche. Deshalb
 * steht der Ort jetzt als breites Fenster unter der Gruppe statt unter der
 * Zeit — eine erzwungene Entscheidung, keine gemessene. Sobald eine
 * Menüaufnahme auftaucht, wird sie hier korrigiert.
 */
/**
 * Spalte für den Auswahlzeiger. Er ist **kein Blattzeichen** (er sitzt in der
 * Fenstergrafik, `WINDOW.BIN` Sektion 0) und wird als eigener Kasten links vor
 * die Zeile gesetzt; der Text rückt um diesen Betrag ein, damit er nicht
 * darunter liegt.
 */
export const CURSOR_SPALTE = 20;

/**
 * Breite der linken Spalte — seit Welle 3 **aus der gemessenen Spielschrift
 * abgeleitet**, nicht mehr geraten.
 *
 * Sobald der Text aus dem Fontblatt kommt, ist die Spaltenbreite keine freie
 * Zahl mehr: Sie muss den längsten Kommandonamen plus Zeigerspalte tragen, und
 * in derselben Spalte steht darunter „Zeit" mit rechtsbündigem Wert. Gemessen
 * an der deutschen Fassung (640×480-Fläche, Vorschübe aus `WINDOW.BIN`):
 *
 * | Inhalt | gemessen |
 * |---|---|
 * | längstes Kommando („Gegenstand") | 138 px |
 * | Zeigerspalte | 20 px |
 * | „Zeit" + „8:39:36" | 46 + 108 = 154 px |
 * | „Gil" + „15.473" | 28 + 96 = 124 px |
 *
 * Die Textfläche eines Fensters ist `Breite − 34` (Bordüre 2 × 5 px,
 * Polsterung 2 × 12 px). Verlangt werden davon 158 px (Kommando + Zeiger) und
 * 154 px (Zeit + Wert), Letzteres mit sichtbarem Abstand dazwischen. Gesetzt
 * sind **204 px** ⇒ 170 px Textfläche: 12 px Reserve für die Kommandospalte,
 * 16 px Abstand in der Zeitzeile. Die alten 168 px stammten aus der
 * Systemschrift und waren für „Gegenstand" **zu schmal** — der Zeiger lag auf
 * dem G, und Zeit und Wert überschrieben sich.
 *
 * 🔴 Unverändert offen bleibt die *Anordnung* (welches Fenster wo steht, ob die
 * Kommandospalte links oder rechts sitzt): dafür fehlt weiterhin eine
 * Menüaufnahme. Gemessen ist die Untergrenze, nicht die Aufteilung.
 */
const LINKE_SPALTE = 204;

export const FF7_MAIN_MENU_LAYOUT: MainMenuLayout = {
  commands: { x: 0, y: 0, width: LINKE_SPALTE, height: 342 },
  timeGil: { x: 0, y: 342 + PANEL_GAP, width: LINKE_SPALTE, height: 86 },
  party: {
    x: LINKE_SPALTE + PANEL_GAP,
    y: 0,
    width: MENU_SURFACE.width - LINKE_SPALTE - PANEL_GAP,
    height: 424,
  },
  location: {
    x: LINKE_SPALTE + PANEL_GAP,
    y: 426,
    width: MENU_SURFACE.width - LINKE_SPALTE - PANEL_GAP,
    height: 54,
  },
  partyEntryHeight: 132,
  // Balken 20 px schmaler als vorher: Die Gruppenfläche verliert durch die
  // breitere linke Spalte 36 px; `third + barWidth` muss in ihre Textfläche
  // (434 − 34 = 400 px) passen und tut das jetzt exakt.
  columns: { valueRight: 0, second: 150, third: 300, barWidth: 100 },
};

/** Zwei Rechtecke überlappen? Wird im Test gegen die Aufteilung geprüft. */
export function rectsOverlap(a: MenuRect, b: MenuRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Liegt das Rechteck vollständig auf der Menüfläche? */
export function rectInSurface(r: MenuRect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.width <= MENU_SURFACE.width && r.y + r.height <= MENU_SURFACE.height;
}
