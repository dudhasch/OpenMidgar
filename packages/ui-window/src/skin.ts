/**
 * Gemeinsame Fensterschale (Welle 2).
 *
 * 🔵 **Warum ein eigenes Paket.** Dialog, Menü und Kampf-HUD zeigen dasselbe
 * FF7-Fenster. Bis hierher lebte diese Optik als CSS im Dialogfenster der
 * Demo (`apps/demo/game.html`, Finding F40) und wäre in den beiden anderen
 * Bereichen ein zweites und drittes Mal nachgebaut worden — mit garantiert
 * abweichenden Werten. Hier liegt sie **einmal als Daten**; die UI ist eine
 * dünne Schale, die diese Daten anwendet.
 *
 * 🟢 **Herkunft der Zahlen:** am Original pixelvermessen (Steam-Durchlauf
 * 2026-08-10, Referenzbilder in `apps/demo/.shots/ref/`). Übernommen
 * unverändert aus dem CSS, das aus dieser Vermessung entstanden ist —
 * dieselben Farben, dieselben Stärken, dieselbe Zeilenhöhe.
 */

/**
 * Darstellungsart eines Fensters — die vier Modi des `WMODE`-Opcodes (0x52).
 *
 * 🟡 Die Reihenfolge ist die dokumentierte Lesart des Operanden; welcher
 * Zahlenwert welchen Modus meint, muss der Interpreter-Besitzer beim
 * Anschließen an echten Skripten prüfen. Definiert sind hier die
 * **Darstellungen**, nicht die Opcode-Semantik.
 */
export enum WindowDisplayMode {
  /** 0 — Rahmen und Hintergrund wie üblich. */
  Normal = 0,
  /** 1 — ohne Rahmen und ohne Hintergrund: nur Text. */
  NoFrameNoBackground = 1,
  /** 2 — durchsichtig: Rahmen bleibt, Füllung wird durchscheinend. */
  Transparent = 2,
  /** 3 — ohne Rahmen, Füllung bleibt. */
  NoFrame = 3,
}

export interface WindowBorderLayer {
  /** Stärke in Pixeln der 640×480-Renderfläche. */
  width: number;
  color: string;
}

export interface WindowSkin {
  /** Bordüre von außen nach innen. */
  border: readonly WindowBorderLayer[];
  cornerRadius: number;
  /** Diagonalverlauf der Füllung, oben links → unten rechts. */
  fill: { angleDeg: number; stops: readonly { color: string; at: number }[] };
  /** Deckkraft der Füllung im Modus `Transparent`. */
  transparentFillAlpha: number;
  textColor: string;
  textShadow: { dx: number; dy: number; color: string };
  /** Zeilenhöhe in Pixeln — dieselbe für Dialog, Menü und Kampf-HUD. */
  lineHeight: number;
  /** Schriftgröße in Pixeln der Renderfläche. */
  fontSize: number;
  /**
   * 🟡 Ersatzschrift. Das Original zeichnet aus dem Fontblatt in
   * `WINDOW.BIN` (Sektion 1, 12×12-Zellen); bis das als Textur gerendert
   * wird, steht hier die Systemschrift, mit der die Demo vermessen wurde.
   */
  fontFamily: string;
  /** Innenabstand [links, oben, rechts, unten]. */
  padding: readonly [number, number, number, number];
  /** Cursorzeichen der Auswahl. */
  cursor: string;
}

/**
 * 🟢 Die vermessene FF7-Fensterschale. Wer sie ändert, ändert Dialog, Menü
 * und Kampf-HUD gleichzeitig — das ist der Zweck.
 */
export const FF7_WINDOW_SKIN: WindowSkin = {
  border: [
    { width: 2, color: '#7a7c7d' },
    { width: 2, color: '#c6c4c5' },
    { width: 1, color: '#313035' },
  ],
  cornerRadius: 4,
  fill: {
    angleDeg: 135,
    stops: [
      { color: '#0001b7', at: 0 },
      { color: '#000188', at: 0.45 },
      { color: '#000022', at: 1 },
    ],
  },
  transparentFillAlpha: 0.5,
  textColor: '#ffffff',
  textShadow: { dx: 1, dy: 1, color: '#000000' },
  lineHeight: 32,
  fontSize: 21,
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  padding: [12, 6, 12, 6],
  cursor: '▶ ',
};

/**
 * 🟢 Renderflächen des Originals. Field und Kampf zeichnen auf 640×448 und
 * lassen unten einen 32-px-Balken; Menüs nutzen die vollen 640×480.
 */
export const RENDER_SURFACE = {
  width: 640,
  height: 480,
  /** Nutzhöhe für Field/Battle. */
  playHeight: 448,
  /** Balken unter der Spielfläche. */
  bottomBarHeight: 32,
} as const;

/** Summe aller Bordürenstärken — das Fenster ist außen so viel größer. */
export function borderThickness(skin: WindowSkin = FF7_WINDOW_SKIN): number {
  return skin.border.reduce((n, l) => n + l.width, 0);
}

/**
 * Außenmaße eines Fensters aus der reinen Textfläche. `contentWidth` kommt
 * aus `measureFfWindow` (`@webmidgar/formats-kernel`) — die Polsterung steckt
 * dort bereits drin, hier kommt nur noch die Bordüre dazu.
 */
export function windowOuterSize(
  contentWidth: number,
  lines: number,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): { width: number; height: number } {
  const b = borderThickness(skin) * 2;
  return {
    width: contentWidth + b,
    height: lines * skin.lineHeight + skin.padding[1] + skin.padding[3] + b,
  };
}

/**
 * Die Schale als CSS-Eigenschaften — **reine Daten**, kein DOM. Genau dieses
 * Objekt hat die Demo bisher als handgeschriebenes CSS im `<style>`-Block
 * stehen gehabt; der Vergleich beider ist die Regressionssicherung.
 *
 * Die dreilagige Bordüre wird wie im Original nachgebaut: die mittlere Lage
 * als `border`, die äußere als `outline` (die außen anliegt und das Layout
 * nicht verschiebt), die innere als `inset box-shadow`.
 */
export function windowSkinCss(
  mode: WindowDisplayMode = WindowDisplayMode.Normal,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): Record<string, string> {
  const [outer, middle, inner] = skin.border;
  const showFrame =
    mode === WindowDisplayMode.Normal || mode === WindowDisplayMode.Transparent;
  const showFill = mode !== WindowDisplayMode.NoFrameNoBackground;

  const gradient =
    `linear-gradient(${skin.fill.angleDeg}deg, ` +
    skin.fill.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ') +
    ')';

  const css: Record<string, string> = {
    color: skin.textColor,
    'font-family': skin.fontFamily,
    'font-size': `${skin.fontSize}px`,
    'line-height': `${skin.lineHeight}px`,
    'text-shadow': `${skin.textShadow.dx}px ${skin.textShadow.dy}px 0 ${skin.textShadow.color}`,
    padding: `${skin.padding[1]}px ${skin.padding[0]}px ${skin.padding[3]}px ${skin.padding[2]}px`,
    'border-radius': `${skin.cornerRadius}px`,
    background: showFill ? gradient : 'none',
    border: showFrame && middle ? `${middle.width}px solid ${middle.color}` : 'none',
    outline: showFrame && outer ? `${outer.width}px solid ${outer.color}` : 'none',
    'box-shadow': showFrame && inner ? `inset 0 0 0 ${inner.width}px ${inner.color}` : 'none',
    opacity: mode === WindowDisplayMode.Transparent ? String(skin.transparentFillAlpha) : '1',
  };
  return css;
}

/**
 * Dünne Zeichenfunktion: wendet die Schale auf ein Element an. Mehr tut die
 * UI-Seite nicht — alles Entscheidbare ist oben schon entschieden.
 *
 * Bewusst über `setProperty` und nicht über einen `cssText`-Block: so bleiben
 * Layouteigenschaften des Aufrufers (Position, Breite) unangetastet.
 */
export function applyWindowSkin(
  el: { style: { setProperty(name: string, value: string): void } },
  mode: WindowDisplayMode = WindowDisplayMode.Normal,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): void {
  for (const [key, value] of Object.entries(windowSkinCss(mode, skin))) {
    el.style.setProperty(key, value);
  }
}
