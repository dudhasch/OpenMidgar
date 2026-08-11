import { describe, expect, it } from 'vitest';
import {
  applyWindowSkin,
  borderThickness,
  FF7_WINDOW_SKIN,
  RENDER_SURFACE,
  WindowDisplayMode,
  WindowShell,
  windowOuterSize,
  windowSkinCss,
} from './index.js';

/**
 * Die Fensterschale ist die gemeinsame Grundlage von Dialog, Menü und
 * Kampf-HUD. Getestet wird deshalb nicht „sieht gut aus", sondern:
 * (a) die Zahlen sind exakt die am Original vermessenen,
 * (b) die vier WMODE-Darstellungen unterscheiden sich genau in dem, was sie
 *     laut Definition unterscheiden soll,
 * (c) die Fensterverwaltung ist ein sauberer Zustandsautomat.
 */

/**
 * Der **Regressionsanker**: exakt das CSS, das vor der Umstellung im
 * <style>-Block von apps/demo/game.html stand (Finding F40, am Original
 * vermessen). Ändert sich `windowSkinCss` unbeabsichtigt, fällt es hier auf
 * und nicht erst im Screenshot.
 */
const CSS_VOR_DER_UMSTELLUNG: Record<string, string> = {
  background: 'linear-gradient(135deg, #0001b7 0%, #000188 45%, #000022 100%)',
  color: '#ffffff',
  border: '2px solid #c6c4c5',
  outline: '2px solid #7a7c7d',
  'box-shadow': 'inset 0 0 0 1px #313035',
  'border-radius': '4px',
  padding: '6px 12px 6px 12px',
  'font-family': "'Segoe UI', system-ui, sans-serif",
  'font-size': '21px',
  'line-height': '32px',
  'text-shadow': '1px 1px 0 #000000',
};

describe('Fensterschale — pixelgleich zum handgeschriebenen CSS', () => {
  it('erzeugt für den Normalmodus genau die vermessenen Werte', () => {
    const css = windowSkinCss(WindowDisplayMode.Normal);
    for (const [prop, expected] of Object.entries(CSS_VOR_DER_UMSTELLUNG)) {
      expect(`${prop}: ${css[prop]}`).toBe(`${prop}: ${expected}`);
    }
  });

  it('hält die vermessenen Einzelwerte fest', () => {
    expect(FF7_WINDOW_SKIN.border.map((b) => `${b.width}px ${b.color}`)).toEqual([
      '2px #7a7c7d',
      '2px #c6c4c5',
      '1px #313035',
    ]);
    expect(borderThickness()).toBe(5);
    expect(FF7_WINDOW_SKIN.lineHeight).toBe(32);
    expect(FF7_WINDOW_SKIN.cornerRadius).toBe(4);
    expect(RENDER_SURFACE.playHeight + RENDER_SURFACE.bottomBarHeight).toBe(RENDER_SURFACE.height);
  });
});

describe('Fensterschale — die vier WMODE-Darstellungsarten', () => {
  it('Normal zeigt Rahmen und Füllung', () => {
    const css = windowSkinCss(WindowDisplayMode.Normal);
    expect(css['background']).toContain('linear-gradient');
    expect(css['border']).not.toBe('none');
    expect(css['opacity']).toBe('1');
  });

  it('NoFrameNoBackground zeigt weder Rahmen noch Füllung — aber Text', () => {
    const css = windowSkinCss(WindowDisplayMode.NoFrameNoBackground);
    expect(css['background']).toBe('none');
    expect(css['border']).toBe('none');
    expect(css['outline']).toBe('none');
    expect(css['box-shadow']).toBe('none');
    expect(css['color']).toBe('#ffffff');
  });

  it('Transparent behält den Rahmen und macht die Füllung durchscheinend', () => {
    const css = windowSkinCss(WindowDisplayMode.Transparent);
    expect(css['border']).not.toBe('none');
    expect(css['background']).toContain('linear-gradient');
    expect(Number(css['opacity'])).toBeLessThan(1);
  });

  it('NoFrame behält die Füllung und lässt den Rahmen weg', () => {
    const css = windowSkinCss(WindowDisplayMode.NoFrame);
    expect(css['background']).toContain('linear-gradient');
    expect(css['border']).toBe('none');
    expect(css['outline']).toBe('none');
  });

  it('alle vier Modi liefern paarweise verschiedene Darstellungen', () => {
    const seen = new Set(
      [
        WindowDisplayMode.Normal,
        WindowDisplayMode.NoFrameNoBackground,
        WindowDisplayMode.Transparent,
        WindowDisplayMode.NoFrame,
      ].map((m) => JSON.stringify(windowSkinCss(m))),
    );
    expect(seen.size).toBe(4);
  });
});

describe('applyWindowSkin — dünne Zeichenfunktion', () => {
  it('setzt jede Eigenschaft einzeln und rührt nichts anderes an', () => {
    const gesetzt: Record<string, string> = {};
    const el = { style: { setProperty: (n: string, v: string) => void (gesetzt[n] = v) } };
    applyWindowSkin(el, WindowDisplayMode.Normal);
    expect(gesetzt).toEqual(windowSkinCss(WindowDisplayMode.Normal));
  });
});

describe('windowOuterSize', () => {
  it('legt die dreilagige Bordüre auf beiden Seiten auf die Textbreite', () => {
    // 5 px Bordüre je Seite ⇒ 10 px mehr als der gemessene Inhalt.
    expect(windowOuterSize(200, 3).width).toBe(210);
    // 3 Zeilen à 32 px + 6 px oben + 6 px unten + 10 px Bordüre.
    expect(windowOuterSize(200, 3).height).toBe(3 * 32 + 6 + 6 + 10);
  });
});

describe('WindowShell — Anschlussstelle für WINDOW/WMODE/WCLSE', () => {
  it('legt Slots bei Bedarf an und hält Geometrie fest', () => {
    const shell = new WindowShell();
    const slot = shell.place(2, 10, 20, 300, 73);
    expect(slot).toMatchObject({ id: 2, x: 10, y: 20, width: 300, height: 73, open: false });
    expect(shell.get(2)).toBe(slot);
  });

  it('behält den WMODE über das Schließen hinaus — der Modus hängt am Slot', () => {
    const shell = new WindowShell();
    shell.setMode(1, WindowDisplayMode.Transparent);
    shell.open(1);
    expect(shell.visible().map((s) => s.id)).toEqual([1]);
    shell.close(1);
    expect(shell.visible()).toEqual([]);
    expect(shell.get(1)!.mode).toBe(WindowDisplayMode.Transparent);
  });

  it('liefert die Zeichenliste aufsteigend nach Slot', () => {
    const shell = new WindowShell();
    for (const id of [5, 1, 3]) shell.open(id);
    shell.open(2);
    shell.close(3);
    expect(shell.visible().map((s) => s.id)).toEqual([1, 2, 5]);
  });

  it('close auf einem unbekannten Slot ist wirkungslos, nicht fatal', () => {
    const shell = new WindowShell();
    expect(() => shell.close(9)).not.toThrow();
    expect(shell.slots.size).toBe(0);
  });
});
