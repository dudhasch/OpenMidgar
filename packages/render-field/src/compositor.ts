import { LinearSRGBColorSpace, NoToneMapping, type Camera, type Scene, type WebGLRenderer } from 'three';
import { computeLetterbox, type LetterboxRect } from './letterbox.js';

/**
 * 4:3-Komposition mit Letterboxing (ADR-005): Der Kamera-Aspect bleibt fest;
 * der Kompositor rendert in das größte zentrierte 4:3-Rechteck des Canvas,
 * der Rest bleibt schwarz. Resize verändert ausschließlich die Balken.
 */

/**
 * Farbpfad auf „Byte rein, Byte raus" stellen.
 *
 * Das Original ist eine reine 8-Bit-Kette: Palettenbyte und Vertexfarbbyte
 * werden multipliziert und das Ergebnis landet unverändert im Bildspeicher. Es
 * gibt an keiner Stelle eine Gammastufe — weder beim Laden der Textur
 * (`Gl_ConvertTexturePixels`, `GfxCreateTextureSurfaces`) noch beim Ausgeben.
 *
 * three ab r152 rechnet standardmäßig anders herum: `outputColorSpace` steht
 * auf sRGB, der Renderer **kodiert** also beim Schreiben ins Bild. Ein
 * gespeichertes 128 verlässt die Kette dann als 187. Das betrifft jedes Pixel —
 * Modelle wie Hintergrund — und ist der größte Einzelbetrag, um den unsere
 * Farben bisher neben dem Original lagen.
 *
 * `LinearSRGBColorSpace` schaltet genau diese Kodierung ab; die Werte gehen
 * unverändert durch. Tonemapping wird aus demselben Grund abgeschaltet: das
 * Original hat keins.
 *
 * Die Funktion steht bewusst hier und wird vom Kompositor aufgerufen — er ist
 * nach ADR-005 die eine Stelle, durch die jede Feldausgabe läuft.
 */
export function configureOriginalColorPipeline(renderer: WebGLRenderer): void {
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
}

export class FieldCompositor {
  private lastRect: LetterboxRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly renderer: WebGLRenderer) {
    configureOriginalColorPipeline(renderer);
  }

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
