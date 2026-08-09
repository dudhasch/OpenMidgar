import type { Camera, Scene, WebGLRenderer } from 'three';
import { computeLetterbox, type LetterboxRect } from './letterbox.js';

/**
 * 4:3-Komposition mit Letterboxing (ADR-005): Der Kamera-Aspect bleibt fest;
 * der Kompositor rendert in das größte zentrierte 4:3-Rechteck des Canvas,
 * der Rest bleibt schwarz. Resize verändert ausschließlich die Balken.
 */

export class FieldCompositor {
  private lastRect: LetterboxRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly renderer: WebGLRenderer) {}

  get viewportRect(): LetterboxRect {
    return this.lastRect;
  }

  render(scene: Scene, camera: Camera): LetterboxRect {
    const canvas = this.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;
    const rect = computeLetterbox(w, h);
    this.lastRect = rect;

    this.renderer.setScissorTest(true);
    // Vollflächig schwarz (Balken), dann nur ins 4:3-Fenster rendern.
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, false);
    this.renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
    this.renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
    this.renderer.render(scene, camera);
    this.renderer.setScissorTest(false);
    return rect;
  }
}
