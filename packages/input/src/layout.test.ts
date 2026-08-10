import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOUCH_LAYOUT,
  hitTest,
  layoutUnit,
  orientationOf,
  resolveTouchLayout,
  sizeClassOf,
  type ResolvedControl,
  type Viewport,
} from './layout.js';

/**
 * S27-Abnahme „Touch-Layout in vier Größen-/Orientierungsklassen inklusive
 * Safe-Area" — als Golden-Werte des DOM-freien Resolvers. (Die Roadmap nennt
 * Golden-Screenshots; da der Resolver die einzige Layoutquelle ist und die
 * Overlay-Schale nur zeichnet, was er liefert, prüfen die Goldens hier den
 * gesamten Layoutinhalt. Der Bildschirm-Nachweis auf einem realen Gerät
 * bleibt als dokumentierte Sichtprüfung offen — ADR-019: es gibt derzeit
 * kein Mobile-Referenzgerät.)
 */

const KLASSEN: Array<{ name: string; viewport: Viewport; erwartet: { klasse: string; orientierung: string } }> = [
  {
    name: 'Telefon hochkant mit Kerbe',
    viewport: { width: 390, height: 844, safeArea: { top: 47, right: 0, bottom: 34, left: 0 } },
    erwartet: { klasse: 'compact', orientierung: 'portrait' },
  },
  {
    name: 'Telefon quer mit seitlicher Safe-Area',
    viewport: { width: 844, height: 390, safeArea: { top: 0, right: 47, bottom: 21, left: 47 } },
    erwartet: { klasse: 'compact', orientierung: 'landscape' },
  },
  {
    name: 'Tablet',
    viewport: { width: 1024, height: 768, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
    erwartet: { klasse: 'medium', orientierung: 'landscape' },
  },
  {
    name: 'Desktop',
    viewport: { width: 1920, height: 1080, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
    erwartet: { klasse: 'expanded', orientierung: 'landscape' },
  },
];

function rechteckeUeberlappen(a: ResolvedControl, b: ResolvedControl): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('Touch-Layout-Resolver', () => {
  for (const { name, viewport, erwartet } of KLASSEN) {
    it(`${name}: Klasse ${erwartet.klasse}, alle Elemente in der Safe-Area, überlappungsfrei`, () => {
      expect(sizeClassOf(viewport)).toBe(erwartet.klasse);
      expect(orientationOf(viewport)).toBe(erwartet.orientierung);
      const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, viewport);
      expect(controls.length).toBeGreaterThan(0);
      const sa = viewport.safeArea;
      for (const c of controls) {
        expect(c.x).toBeGreaterThanOrEqual(sa.left);
        expect(c.y).toBeGreaterThanOrEqual(sa.top);
        expect(c.x + c.width).toBeLessThanOrEqual(viewport.width - sa.right);
        expect(c.y + c.height).toBeLessThanOrEqual(viewport.height - sa.bottom);
      }
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          expect(rechteckeUeberlappen(controls[i]!, controls[j]!)).toBe(false);
        }
      }
    });
  }

  it('Golden: Telefon hochkant — exakte Rechtecke der tragenden Elemente', () => {
    const viewport = KLASSEN[0]!.viewport;
    expect(layoutUnit(viewport)).toBe(16);
    const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, viewport);
    const byId = new Map(controls.map((c) => [c.id, c]));
    expect(byId.get('dpad-left')).toEqual({ id: 'dpad-left', x: 8, y: 706, width: 48, height: 48, shape: 'rect' });
    expect(byId.get('dpad-right')).toEqual({ id: 'dpad-right', x: 104, y: 706, width: 48, height: 48, shape: 'rect' });
    expect(byId.get('btn-ok')).toEqual({ id: 'btn-ok', x: 334, y: 706, width: 48, height: 48, shape: 'circle' });
    expect(byId.get('btn-menu')).toEqual({ id: 'btn-menu', x: 342, y: 55, width: 40, height: 40, shape: 'circle' });
  });

  it('Desktop (expanded): das Menü-Element entfällt laut Größenklassen-Datum', () => {
    const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, KLASSEN[3]!.viewport);
    expect(controls.some((c) => c.id === 'btn-menu')).toBe(false);
  });

  it('hitTest: trifft Kreise nur innerhalb der Ellipse, obere Elemente gewinnen', () => {
    const viewport = KLASSEN[2]!.viewport;
    const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, viewport);
    const ok = controls.find((c) => c.id === 'btn-ok')!;
    expect(hitTest(controls, ok.x + ok.width / 2, ok.y + ok.height / 2)).toBe('btn-ok');
    // Rechteck-Ecke des umschriebenen Kastens liegt AUSSERHALB des Kreises.
    expect(hitTest(controls, ok.x + 1, ok.y + 1)).toBeNull();
    expect(hitTest(controls, 5, 5)).toBeNull();
  });
});
