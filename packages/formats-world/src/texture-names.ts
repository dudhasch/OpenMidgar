/**
 * F11b — **Die Zuordnung `textureId` → Texturdatei, gemessen statt geraten.**
 *
 * ═══ Fundstelle ═══
 * Die Weltkarten-Texturtabelle steht nicht in den Datendateien, sondern als
 * **Zeigerfeld in der Spiel-EXE** (`ff7.exe` / `ff7_en.exe`). Jeder Eintrag
 * zeigt auf einen NUL-terminierten Namen `<name>.tim` in einem 4-Byte-
 * ausgerichteten Zeichenkettenvorrat derselben Sektion. Die PC-Fassung lädt
 * daraus `<name>.tex` aus `world_us.lgp` — die Endung `.tim` ist ein
 * PSX-Überbleibsel.
 *
 * 🟢 GEMESSEN (`world-texmap-probe`, 2026-08-11, `ff7.exe` 5.882.880 B,
 * SHA-256 c1437392…4b6f; identisch in `ff7_en.exe`):
 *   - Zeigerfeld bei Dateiversatz 0x5686E8 (VA 0x969CE8), **402 Einträge**.
 *   - 380 Einträge zeigen auf `*.tim`-Namen, zu denen `world_us.lgp` genau
 *     eine `.tex`-Datei führt (380/380 auflösbar, 0 Fehlverweise).
 *   - 22 Einträge zeigen NICHT in den Namensvorrat, sondern auf eine
 *     lückenlose 4-Byte-Rampe (0x00E2D16C … 0x00E2D1C0). Genau **22** ist
 *     auch die Eintragszahl von `wm.ta` im selben Archiv — das sind die
 *     ANIMIERTEN Texturen, deren Pixel in `wm.ta` liegen statt in einer
 *     `.tex`. Zwei unabhängige Zählungen, dieselbe Zahl.
 *
 * ═══ Aufteilung auf die drei Karten ═══
 * Die 402 Einträge sind DREI hintereinandergelegte Tabellen. Belegt durch
 * zwei Messungen, die sich gegenseitig kontrollieren:
 *   (a) Belegte `textureId`-Werte je Karte (world-fieldtbl-probe): WM0 = 0…281
 *       lückenlos, WM2 = 0…7, WM3 = 0…3.
 *   (b) Die letzten zwölf Namen der Tabelle sind
 *       `cltr, lake_a, rock, scave, ssand, swall02, sng01, sng02` gefolgt von
 *       `hokola01, hokola02, snwfldl, snwfld2` — genau die acht Unterwasser-
 *       und vier Gletschernamen, die auch die Fremdbeschreibung nennt, und
 *       zwar in genau dieser Reihenfolge. Damit liegt Unterwasser bei
 *       `len − 12`, Gletscher bei `len − 4` und die Overworld bei 0.
 * WM0 nutzt also nur 282 der 390 Overworld-Plätze; 108 bleiben unbenutzt.
 * Dass die Basis 0 stimmt, ist ebenfalls gemessen und nicht gesetzt: mit
 * Basis 0 passen auf WM0 282/282 UV-Fenster (Verwürfelungskontrolle 0,6028),
 * s. `render-world/texture-table.ts`.
 * (Die Fremdbeschreibung nennt „282 Texturen" — das ist die Zahl der
 * BENUTZTEN IDs, nicht die Tabellenlänge. Unsere Messung sagt 390.)
 *
 * ═══ Urheberrecht ═══
 * Diese Datei enthält **keine** Namenstabelle. Sie enthält das Verfahren, die
 * Tabelle aus der EXE DES NUTZERS zu lesen — dieselbe Haltung wie bei jedem
 * anderen Originaldatum im Projekt (Regel 2: nie Originaldaten ins Repo).
 */

export interface WorldTextureNameTable {
  /**
   * Tabelleneinträge in Originalreihenfolge. `null` = animierte Textur, deren
   * Pixel in `wm.ta` liegen (kein `.tex`-Name vorhanden).
   */
  names: Array<string | null>;
  /** Dateiversatz des Zeigerfeldes (Diagnose/Reproduzierbarkeit). */
  tableOffset: number;
  /** Startindex je Kartendatei in `names`. */
  bases: { wm0: number; wm2: number; wm3: number };
  /** Anzahl `null`-Einträge (erwartet: 22). */
  animatedCount: number;
  diagnostics: string[];
}

/** Länge der beiden Kleinkarten-Teiltabellen am Tabellenende (🟢 gemessen). */
export const WORLD_UNDERWATER_TEXTURES = 8;
export const WORLD_GLACIER_TEXTURES = 4;

interface Section {
  va: number;
  vsize: number;
  raw: number;
  rsize: number;
}

/** PE-Sektionen lesen. `null`, wenn die Datei kein PE32-Abbild ist. */
function readPe(bytes: Uint8Array): { imageBase: number; sections: Section[] } | null {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null; // 'MZ'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true);
  if (pe + 24 > bytes.length) return null;
  if (view.getUint32(pe, true) !== 0x00004550) return null; // 'PE\0\0'
  const numSec = view.getUint16(pe + 6, true);
  const optSize = view.getUint16(pe + 20, true);
  if (optSize < 32) return null;
  const imageBase = view.getUint32(pe + 24 + 28, true);
  const secStart = pe + 24 + optSize;
  const sections: Section[] = [];
  for (let i = 0; i < numSec; i++) {
    const o = secStart + i * 40;
    if (o + 40 > bytes.length) return null;
    sections.push({
      vsize: view.getUint32(o + 8, true),
      va: view.getUint32(o + 12, true),
      rsize: view.getUint32(o + 16, true),
      raw: view.getUint32(o + 20, true),
    });
  }
  return { imageBase, sections };
}

const TIM = /^[a-z0-9_.\-]{1,24}\.tim$/;

/**
 * Zeichenkettenvorrat einsammeln: jeder `*.tim`-Name, der auf ein NUL folgt
 * (bzw. am Sektionsanfang steht). Rückgabe: virtuelle Adresse → Basisname
 * ohne Endung.
 */
function collectTimStrings(
  bytes: Uint8Array,
  imageBase: number,
  sections: Section[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const s of sections) {
    const ende = Math.min(s.raw + s.rsize, bytes.length);
    let start = s.raw;
    for (let i = s.raw; i < ende; i++) {
      if (bytes[i] !== 0) continue;
      const len = i - start;
      if (len > 0 && len <= 28) {
        let text = '';
        for (let k = start; k < i; k++) text += String.fromCharCode(bytes[k]!);
        if (TIM.test(text)) map.set(imageBase + s.va + (start - s.raw), text.slice(0, -4));
      }
      start = i + 1;
    }
  }
  return map;
}

/** Mindestlänge eines glaubwürdigen Laufes — die echte Tabelle hat 402. */
const MIN_RUN = 64;
/** Höchstzahl aufeinanderfolgender namenloser Einträge innerhalb des Laufes. */
const MAX_LUECKE = 6;

/**
 * Die Texturtabelle aus einem PE-Abbild lesen.
 *
 * Die Fundstelle wird **gesucht, nicht fest verdrahtet**: gesucht wird der
 * längste Lauf aufeinanderfolgender u32, die auf `*.tim`-Namen zeigen, wobei
 * kurze Lücken (die animierten Einträge) überbrückt werden. Ein Lauf muss mit
 * einem Namen beginnen und enden — sonst würden angrenzende Nullen den Lauf
 * beliebig verlängern.
 */
export function parseWorldTextureNames(bytes: Uint8Array): WorldTextureNameTable | null {
  const pe = readPe(bytes);
  if (!pe) return null;
  const strings = collectTimStrings(bytes, pe.imageBase, pe.sections);
  if (strings.size < MIN_RUN) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let bestStart = -1;
  let bestLen = 0;
  let bestNamed = 0;
  const limit = bytes.length - 4;
  let i = 0;
  while (i * 4 <= limit) {
    const off = i * 4;
    if (!strings.has(view.getUint32(off, true))) {
      i++;
      continue;
    }
    // Lauf ab hier verfolgen.
    let j = i;
    let letzterName = i;
    let namen = 0;
    let luecke = 0;
    while (j * 4 <= limit) {
      const wert = view.getUint32(j * 4, true);
      if (strings.has(wert)) {
        namen++;
        luecke = 0;
        letzterName = j;
      } else if (++luecke > MAX_LUECKE) break;
      j++;
    }
    const len = letzterName - i + 1;
    if (len > bestLen) {
      bestLen = len;
      bestStart = i;
      bestNamed = namen;
    }
    i = letzterName + 1;
  }
  if (bestStart < 0 || bestLen < MIN_RUN) return null;

  const diagnostics: string[] = [];
  const names: Array<string | null> = [];
  for (let k = 0; k < bestLen; k++) {
    const wert = view.getUint32((bestStart + k) * 4, true);
    names.push(strings.get(wert) ?? null);
  }
  const animatedCount = bestLen - bestNamed;
  const wm2 = names.length - (WORLD_UNDERWATER_TEXTURES + WORLD_GLACIER_TEXTURES);
  const wm3 = names.length - WORLD_GLACIER_TEXTURES;
  if (wm2 <= 0) {
    diagnostics.push(`Tabelle zu kurz für die Kartenaufteilung (${names.length} Einträge)`);
    return null;
  }
  // Selbstkontrolle: die Fundstelle ist nur dann die Texturtabelle, wenn die
  // zwölf Schlussnamen alle belegt sind (die Kleinkarten haben KEINE
  // animierten Texturen — WM2/WM3 zeigen 8 bzw. 4 benannte IDs).
  const schluss = names.slice(wm2);
  if (schluss.some((n) => n === null)) {
    diagnostics.push('Schlussblock enthält animierte Einträge — Kartenaufteilung fraglich');
  }
  return {
    names,
    tableOffset: bestStart * 4,
    bases: { wm0: 0, wm2, wm3 },
    animatedCount,
    diagnostics,
  };
}
