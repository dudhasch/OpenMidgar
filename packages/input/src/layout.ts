/**
 * Touch-Layout als DATEN (S27): Das virtuelle Steuerkreuz und die
 * Aktionsknöpfe werden als deklarative Spezifikation geführt und je Viewport
 * (Größe, Orientierung, Safe-Area) zu absoluten Rechtecken aufgelöst. Der
 * Resolver ist DOM-frei und Node-testbar; die Overlay-Schale (App/Demo)
 * zeichnet nur noch, was hier herauskommt — keine CSS-Sonderfallsammlung.
 */

export type Anchor = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type SizeClass = 'compact' | 'medium' | 'expanded';
export type Orientation = 'portrait' | 'landscape';

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
  safeArea: SafeArea;
}

export interface TouchControlSpec {
  id: string;
  /** Ecke, an der das Element hängt. */
  anchor: Anchor;
  /** Versatz von der Ankerecke in Layout-Einheiten (s. `layoutUnit`). */
  offsetX: number;
  offsetY: number;
  /** Größe in Layout-Einheiten. */
  width: number;
  height: number;
  shape: 'rect' | 'circle';
  /** Fehlt die Angabe, erscheint das Element in allen Größenklassen. */
  sizeClasses?: SizeClass[];
}

export interface TouchLayoutSpec {
  controls: TouchControlSpec[];
}

export interface ResolvedControl {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'rect' | 'circle';
}

/**
 * Größenklassen nach kürzerer Viewport-Seite (🔵 Eigenentwurf, dokumentiert):
 * < 480 px compact (Telefon), < 900 px medium (Tablet), sonst expanded.
 */
export function sizeClassOf(viewport: Viewport): SizeClass {
  const minSide = Math.min(viewport.width, viewport.height);
  if (minSide < 480) return 'compact';
  if (minSide < 900) return 'medium';
  return 'expanded';
}

export function orientationOf(viewport: Viewport): Orientation {
  return viewport.width >= viewport.height ? 'landscape' : 'portrait';
}

/**
 * Layout-Einheit: 1/25 der kürzeren Seite, ganzzahlig gerundet und auf
 * mindestens 12 px begrenzt — dieselbe Spezifikation ergibt auf jedem Gerät
 * proportional gleiche, aber nie unbedienbar kleine Elemente.
 */
export function layoutUnit(viewport: Viewport): number {
  return Math.max(12, Math.round(Math.min(viewport.width, viewport.height) / 25));
}

/**
 * Löst die Spezifikation zu absoluten Rechtecken auf. Die Safe-Area wird als
 * harter Rand behandelt: Ankerecken liegen IMMER innerhalb der Safe-Area,
 * damit kein Steuerelement unter einer Gerätekerbe oder Systemgeste liegt.
 */
export function resolveTouchLayout(spec: TouchLayoutSpec, viewport: Viewport): ResolvedControl[] {
  const unit = layoutUnit(viewport);
  const cls = sizeClassOf(viewport);
  const sa = viewport.safeArea;
  const out: ResolvedControl[] = [];
  for (const c of spec.controls) {
    if (c.sizeClasses && !c.sizeClasses.includes(cls)) continue;
    const w = c.width * unit;
    const h = c.height * unit;
    const ox = c.offsetX * unit;
    const oy = c.offsetY * unit;
    let x: number;
    let y: number;
    switch (c.anchor) {
      case 'bottom-left':
        x = sa.left + ox;
        y = viewport.height - sa.bottom - oy - h;
        break;
      case 'bottom-right':
        x = viewport.width - sa.right - ox - w;
        y = viewport.height - sa.bottom - oy - h;
        break;
      case 'top-left':
        x = sa.left + ox;
        y = sa.top + oy;
        break;
      case 'top-right':
        x = viewport.width - sa.right - ox - w;
        y = sa.top + oy;
        break;
    }
    out.push({ id: c.id, x, y, width: w, height: h, shape: c.shape });
  }
  return out;
}

export function hitTest(controls: ResolvedControl[], px: number, py: number): string | null {
  // Rückwärts: später deklarierte Elemente liegen oben (wie beim Zeichnen).
  for (let i = controls.length - 1; i >= 0; i--) {
    const c = controls[i]!;
    if (c.shape === 'rect') {
      if (px >= c.x && px <= c.x + c.width && py >= c.y && py <= c.y + c.height) return c.id;
    } else {
      const rx = c.width / 2;
      const ry = c.height / 2;
      const dx = (px - (c.x + rx)) / rx;
      const dy = (py - (c.y + ry)) / ry;
      if (dx * dx + dy * dy <= 1) return c.id;
    }
  }
  return null;
}

/**
 * Standard-Layout: Steuerkreuz unten links (vier Rechteckzonen um eine freie
 * Mitte), OK/Abbrechen unten rechts, Laufen daneben, Menü oben rechts.
 * IDs entsprechen den Schlüsseln der `touch`-Belegungstabelle.
 */
export const DEFAULT_TOUCH_LAYOUT: TouchLayoutSpec = {
  controls: [
    { id: 'dpad-up', anchor: 'bottom-left', offsetX: 3.5, offsetY: 6.5, width: 3, height: 3, shape: 'rect' },
    { id: 'dpad-down', anchor: 'bottom-left', offsetX: 3.5, offsetY: 0.5, width: 3, height: 3, shape: 'rect' },
    { id: 'dpad-left', anchor: 'bottom-left', offsetX: 0.5, offsetY: 3.5, width: 3, height: 3, shape: 'rect' },
    { id: 'dpad-right', anchor: 'bottom-left', offsetX: 6.5, offsetY: 3.5, width: 3, height: 3, shape: 'rect' },
    { id: 'btn-ok', anchor: 'bottom-right', offsetX: 0.5, offsetY: 3.5, width: 3, height: 3, shape: 'circle' },
    { id: 'btn-cancel', anchor: 'bottom-right', offsetX: 4, offsetY: 0.5, width: 3, height: 3, shape: 'circle' },
    { id: 'btn-run', anchor: 'bottom-right', offsetX: 4, offsetY: 6.5, width: 3, height: 3, shape: 'circle' },
    { id: 'btn-menu', anchor: 'top-right', offsetX: 0.5, offsetY: 0.5, width: 2.5, height: 2.5, shape: 'circle', sizeClasses: ['compact', 'medium'] },
  ],
};
