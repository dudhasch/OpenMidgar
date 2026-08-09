import { FIELD_ASPECT } from '@webmidgar/convert';

/**
 * Letterbox-/Pillarbox-Einpassung (ADR-005): Der 4:3-Bildkreis der
 * Originalkamera wird NIE gestreckt — nur skaliert und zentriert; der Rest
 * des Canvas bleibt schwarz.
 */

export interface LetterboxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeLetterbox(
  canvasWidth: number,
  canvasHeight: number,
  aspect: number = FIELD_ASPECT,
): LetterboxRect {
  if (canvasWidth <= 0 || canvasHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const canvasAspect = canvasWidth / canvasHeight;
  if (canvasAspect > aspect) {
    // Pillarbox: volle Höhe, seitliche Balken.
    const width = Math.round(canvasHeight * aspect);
    return { x: Math.floor((canvasWidth - width) / 2), y: 0, width, height: canvasHeight };
  }
  // Letterbox: volle Breite, Balken oben/unten.
  const height = Math.round(canvasWidth / aspect);
  return { x: 0, y: Math.floor((canvasHeight - height) / 2), width: canvasWidth, height };
}
