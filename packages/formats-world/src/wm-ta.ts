/**
 * `wm.ta` — die **animierten Weltkarten-Texturen** (F11b, Teil 2).
 *
 * Warum das kein Randthema ist: die 22 animierten Texturen tragen auf WM0
 * **105.014 von 157.791 Dreiecken (66,6 %)** — das ist der Ozean. Ohne sie
 * gäbe es keine texturierte Weltkarte, sondern eine texturierte Küstenlinie.
 *
 * ═══ Aufbau (🟢 gemessen, 2026-08-11, `world_us.lgp`/`wm.ta`, 57.344 B) ═══
 *   u32 count                       (= 22)
 *   count × { u32 offset; u16 stride; u8 frames; u8 speed }
 *   … je Eintrag `frames` Halbbilder à `stride` Byte
 *
 * Belegt durch **Accounting statt Glauben**: `offset[i+1] − offset[i] ==
 * frames·stride` gilt für 21/21 Nachbarpaare, `stride == 528` für 22/22, und
 * 528 = 12 (Blockkopf) + 512 (Bildbytes) + 4 (Polsterung). Die Halbbildzahlen
 * sind 8 (5×) und 4 (17×) — zusammen 108 Halbbilder à 528 B = 57.024 B. Mit
 * 180 Tabellenbytes (4 + 22·8), 16 B Ausrichtungspolsterung bis zum ersten
 * Offset 196 und 124 B Restblock am Dateiende ergibt das exakt 57.344 —
 * die volle Dateigröße, ohne unerklärten Rest.
 * (Der 124-B-Restblock ist 🔴 ungedeutet; er wird nicht angefasst.)
 * `speed` nimmt genau vier Werte an: 10, 15, 20, 25.
 *
 * ═══ Halbbild ═══
 *   u32 bnum (= 524); u16 vramX; u16 vramY; u16 w16; u16 h  → dann w16·h·2 B
 * `w16` zählt VRAM-Halbworte, nicht Pixel. Gemessen ist `w16 = 8`, `h = 32`
 * und `12 + w16·h·2 == bnum` in **108/108** Halbbildern. Bei **4 bpp** trägt
 * ein Halbwort 4 Pixel ⇒ **32 × 32 Pixel**. Die VRAM-Positionen bilden ein
 * geschlossenes Raster: `vramX ∈ {384, 392, …, 440}` (Schrittweite 8 = w16),
 * `vramY ∈ {256, 288, 320}` (Schrittweite 32 = h) — 8 × 3 = 24 Plätze für 22
 * Texturen. Ein Raster, dessen Schrittweite genau die Textur­maße trifft, ist
 * die Gegenprobe zur Maßauslegung: bei 16 bpp (8 Pixel breit) klaffte
 * zwischen den Plätzen eine Lücke von 24 Pixeln.
 *
 * Dass 4 bpp die richtige Auslegung ist, ist nicht angenommen, sondern gegen
 * die Alternative ENTSCHIEDEN:
 *  (a) Die aus den Dreiecken gemessene UV-Fenstergröße dieser IDs ist in
 *      22/22 Fällen 32 × 32 — die 4-bpp-Auslegung trifft sie exakt, die
 *      16-bpp-Auslegung (8 × 32) verfehlt sie um Faktor 4 in der Breite.
 *  (b) Als 16-bpp-BGR555 gelesen sind die ersten Zeilen durchgehend
 *      (248,248,248) — praktisch Weiß; als 4-bpp-Indexbild ergibt sich ein
 *      zusammenhängender, zeilenweise gebänderter Verlauf. Nur eine der
 *      beiden Lesarten liefert ein Bild.
 *
 * ═══ 🔴 OFFEN: die Farbtabelle ═══
 * `wm.ta` enthält **keine** CLUT (Accounting oben ist ohne Rest aufgegangen),
 * und die 22 Tabelleneinträge der EXE zeigen in einen uninitialisierten
 * .data-Bereich (BSS) statt auf einen Namen. Woher die 16 Farben stammen, ist
 * NICHT gemessen. Dieses Modul liefert deshalb **Indexbilder**; wer sie
 * einfärbt, muss eine Palette beistellen und sie als solche kennzeichnen
 * (s. `substituteAnimatedPalette` in `render-world`).
 */

export interface WorldAnimatedFrame {
  /** VRAM-Position in Halbworten (roh konserviert, 🟡 Semantik). */
  vramX: number;
  vramY: number;
  /** Palettenindizes, ein Byte je Pixel, zeilenweise (width·height). */
  indices: Uint8Array;
}

export interface WorldAnimatedTexture {
  /** Position in der `wm.ta`-Tabelle (0-basiert). */
  slot: number;
  width: number;
  height: number;
  /** Bildwechselzahl aus dem Tabellenkopf (🟡 Einheit ungemessen). */
  speed: number;
  frames: WorldAnimatedFrame[];
}

export interface WorldAnimatedSet {
  textures: WorldAnimatedTexture[];
  diagnostics: string[];
}

const KOPF_BYTES = 12;
/** 🟢 gemessen: 4 bpp — Herleitung s. Dateikommentar. */
export const WORLD_ANIM_BITS_PER_PIXEL = 4;

export function parseWorldAnimatedTextures(bytes: Uint8Array): WorldAnimatedSet {
  const diagnostics: string[] = [];
  if (bytes.length < 4) return { textures: [], diagnostics: ['wm.ta kürzer als Kopf'] };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count === 0 || 4 + count * 8 > bytes.length) {
    return { textures: [], diagnostics: [`unplausible Eintragszahl ${count}`] };
  }
  const textures: WorldAnimatedTexture[] = [];
  for (let i = 0; i < count; i++) {
    const base = 4 + i * 8;
    const offset = view.getUint32(base, true);
    const stride = view.getUint16(base + 4, true);
    const frames = view.getUint8(base + 6);
    const speed = view.getUint8(base + 7);
    if (frames === 0 || stride < KOPF_BYTES || offset + frames * stride > bytes.length) {
      diagnostics.push(`Eintrag ${i}: Halbbildblock außerhalb (off=${offset}, ${frames}×${stride})`);
      continue;
    }
    const gelesen: WorldAnimatedFrame[] = [];
    let width = 0;
    let height = 0;
    for (let f = 0; f < frames; f++) {
      const o = offset + f * stride;
      const bnum = view.getUint32(o, true);
      const vramX = view.getUint16(o + 4, true);
      const vramY = view.getUint16(o + 6, true);
      const w16 = view.getUint16(o + 8, true);
      const h = view.getUint16(o + 10, true);
      const nutzBytes = w16 * h * 2;
      // Das Accounting IST der Wahrheitstest — jede Abweichung quarantäniert
      // das Halbbild statt es zu erfinden.
      if (bnum !== KOPF_BYTES + nutzBytes || o + KOPF_BYTES + nutzBytes > bytes.length) {
        diagnostics.push(`Eintrag ${i}, Halbbild ${f}: Accounting verletzt (bnum=${bnum}, ${w16}×${h})`);
        continue;
      }
      const px = (w16 * 16) / WORLD_ANIM_BITS_PER_PIXEL;
      const roh = bytes.subarray(o + KOPF_BYTES, o + KOPF_BYTES + nutzBytes);
      const indices = new Uint8Array(px * h);
      for (let k = 0; k < roh.length; k++) {
        indices[k * 2] = roh[k]! & 0x0f;
        indices[k * 2 + 1] = roh[k]! >> 4;
      }
      if (width === 0) {
        width = px;
        height = h;
      } else if (width !== px || height !== h) {
        diagnostics.push(`Eintrag ${i}: Halbbild ${f} weicht im Maß ab (${px}×${h} statt ${width}×${height})`);
        continue;
      }
      gelesen.push({ vramX, vramY, indices });
    }
    if (gelesen.length === 0) {
      diagnostics.push(`Eintrag ${i}: kein brauchbares Halbbild`);
      continue;
    }
    textures.push({ slot: i, width, height, speed, frames: gelesen });
  }
  return { textures, diagnostics };
}
