/**
 * Der Maler — die einzige Stelle mit DOM-Berührung.
 *
 * 🔵 Er entscheidet nichts: Er bekommt fertige `HudBox`-Listen und setzt sie
 * absolut. Die Fensteroptik holt er ausschließlich aus
 * `@webmidgar/ui-window` (`applyWindowSkin`) — dieses Paket schreibt keine
 * Bordüre und keinen Verlauf selbst hin. Das war die ausdrückliche Auflage
 * der Fensterschalen-Grundlage, und sie hält: unten steht keine einzige
 * Farbe der Schale.
 */

import { FF7_WINDOW_SKIN, WindowDisplayMode, applyWindowSkin } from '@webmidgar/ui-window';
import type { HudBox } from './model.js';

/** Minimalsicht auf ein Element — hält den Maler ohne `lib.dom` testbar. */
export interface PaintElement {
  style: { setProperty(name: string, value: string): void };
  textContent: string | null;
  remove(): void;
}

export interface PaintHost {
  create(id: string): PaintElement;
  /** Bereits gezeichnete Kästen der letzten Runde, nach `id`. */
  existing: Map<string, PaintElement>;
}

const px = (n: number): string => `${n}px`;

/**
 * Zeichnet eine Kastenliste. Elemente, die diesmal fehlen, werden entfernt —
 * so bleibt der Baum genau so groß wie das Modell.
 */
export function paintBoxes(host: PaintHost, boxes: readonly HudBox[]): void {
  const seen = new Set<string>();
  for (const box of boxes) {
    seen.add(box.id);
    let el = host.existing.get(box.id);
    if (!el) {
      el = host.create(box.id);
      host.existing.set(box.id, el);
    }
    const s = el.style;
    s.setProperty('position', 'absolute');
    s.setProperty('left', px(box.rect.x));
    s.setProperty('top', px(box.rect.y));
    s.setProperty('width', px(box.rect.w));
    s.setProperty('height', px(box.rect.h));
    s.setProperty('box-sizing', 'border-box');
    s.setProperty('margin', '0');
    s.setProperty('pointer-events', 'none');
    s.setProperty('opacity', String(box.opacity ?? 1));

    switch (box.kind) {
      case 'window':
      case 'badge':
        applyWindowSkin(el, WindowDisplayMode.Normal);
        // Die Schale bringt ihre eigene Polsterung und Zeilenhöhe mit; im HUD
        // sind die Kästen bereits auf den Pixel gesetzt, deshalb neutralisiert.
        s.setProperty('padding', '0');
        s.setProperty('line-height', px(box.rect.h - 10));
        if (box.kind === 'badge') {
          s.setProperty('text-align', 'center');
          s.setProperty('font-size', px(box.fontSize ?? 17));
          s.setProperty('color', box.color ?? FF7_WINDOW_SKIN.textColor);
        }
        break;
      case 'barFrame':
        s.setProperty('background', box.background ?? 'rgb(89,89,89)');
        s.setProperty('border', '2px solid #c6c4c5');
        s.setProperty('outline', '2px solid #7a7c7d');
        s.setProperty('box-shadow', 'inset 0 0 0 1px #313035');
        break;
      case 'barFill':
        s.setProperty('background', box.background ?? '#fff');
        break;
      case 'portrait':
        s.setProperty('background', box.background ?? 'rgba(0,0,0,0.35)');
        s.setProperty('border', '1px solid rgba(255,255,255,0.25)');
        break;
      default: {
        s.setProperty('font-family', FF7_WINDOW_SKIN.fontFamily);
        s.setProperty('font-size', px(box.fontSize ?? 17));
        s.setProperty('line-height', px(box.rect.h));
        s.setProperty('color', box.color ?? FF7_WINDOW_SKIN.textColor);
        s.setProperty(
          'text-shadow',
          `${FF7_WINDOW_SKIN.textShadow.dx}px ${FF7_WINDOW_SKIN.textShadow.dy}px 0 ${FF7_WINDOW_SKIN.textShadow.color}`,
        );
        s.setProperty('text-align', box.align ?? 'left');
        s.setProperty('white-space', 'pre');
        s.setProperty('overflow', 'hidden');
        break;
      }
    }
    if (box.text !== undefined) el.textContent = box.text;
  }
  for (const [id, el] of host.existing) {
    if (seen.has(id)) continue;
    el.remove();
    host.existing.delete(id);
  }
}

/**
 * Bequemer Wirt für echtes DOM. Der Aufrufer gibt einen Container; darin
 * liegen die Kästen absolut. Der Container selbst muss `position: relative`
 * und die Maße der Renderfläche haben.
 */
export function domPaintHost(container: {
  appendChild(child: unknown): unknown;
  ownerDocument: { createElement(tag: string): unknown } | null;
}): PaintHost {
  const existing = new Map<string, PaintElement>();
  return {
    existing,
    create(id: string): PaintElement {
      const doc = container.ownerDocument;
      if (!doc) throw new Error('Container ohne ownerDocument');
      const el = doc.createElement('div') as unknown as PaintElement & { dataset: Record<string, string> };
      el.dataset.hudId = id;
      container.appendChild(el);
      return el;
    },
  };
}
