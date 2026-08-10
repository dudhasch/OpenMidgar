import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import { parseP, parseTex, type MeshSource, type TextureSource } from '@webmidgar/formats-model';
import type { BattleModelFiles } from './battle-actor.js';

/**
 * Battle-Modell-Lader: löst ein 2-Zeichen-Präfix (aus `enemyModelPrefix`
 * bzw. dem Party-Präfix) gegen die Einträge von battle.lgp auf.
 *
 * Belegte Namenskonvention (✅ S30-Probe `battle-probe.rdtest.ts` über den
 * GESAMTBESTAND: 11.119 Einträge, ausnahmslos 4 Kleinbuchstaben
 * `<präfix:2><suffix:2>`, 481 Präfixe mit je genau einem `aa`; Suffix-
 * Klassifikation über INHALTS-Signaturen, FINDINGS S30):
 *
 *  - `<präfix>aa` — Skelett (52+12·n-Grammatik, 481/481 byteexakt).
 *  - `<präfix>ab` (und die `da`-Familie) — EIGENES Animationsformat
 *    (Grammatik 🔴). Die Vermutung „ab = Textur" ist damit WIDERLEGT —
 *    dieser Lader fasst `ab` nicht an.
 *  - `<präfix>ae`…`<präfix>ai` — Texturen (TEX).
 *  - `<präfix>am` und fortlaufend — `.p`-Geometrie in Suffixordnung
 *    (Basis-26-Zählung). Die Suffixordnung IST die Teileordnung der
 *    🟡-Kompositionsregel (S32-Sichtnachweis der Tafel).
 *
 * Fehlerpolitik gemäß Auftrag der Runtime: fehlende Teile werden toleriert
 * (so viele Parts wie auflösbar; ein vorhandener, aber unparsebarer Eintrag
 * wird übersprungen und der Lauf fortgesetzt), `null` NUR wenn das Skelett
 * fehlt oder defekt ist. Der Teilelauf endet an der ersten Namenslücke —
 * im Bestand sind die Geometriesuffixe je Präfix zusammenhängend; die
 * Obergrenze hält den Lauf zusätzlich sicher unterhalb der `da`-Familie.
 */

const SKELETON_SUFFIX = 'aa';
const TEXTURE_SUFFIXES = ['ae', 'af', 'ag', 'ah', 'ai'] as const;
const FIRST_PART_SUFFIX = 'am';
/** `am` + 64 Schritte endet bei `cx` — sicher vor der `da`-Familie (Animationsdaten). */
const MAX_PARTS = 64;

/** Basis-26-Suffix (`aa` = 0) — dieselbe Arithmetik wie `enemyModelPrefix`. */
function suffixOf(index: number): string {
  return String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26));
}

function suffixIndex(suffix: string): number {
  return (suffix.charCodeAt(0) - 97) * 26 + (suffix.charCodeAt(1) - 97);
}

export async function loadBattleModel(
  prefix: string,
  readEntry: (name: string) => Promise<Uint8Array | null>,
): Promise<BattleModelFiles | null> {
  const skeletonName = prefix + SKELETON_SUFFIX;
  const skeletonBytes = await readEntry(skeletonName);
  if (!skeletonBytes) return null;
  const { skeleton } = parseBattleSkeleton(skeletonBytes, skeletonName);
  if (!skeleton) return null;

  const textures: (TextureSource | null)[] = [];
  for (const suffix of TEXTURE_SUFFIXES) {
    const name = prefix + suffix;
    const bytes = await readEntry(name);
    if (!bytes) continue;
    const tex = parseTex(bytes, name).value;
    if (tex) textures.push(tex);
  }

  const parts: MeshSource[] = [];
  const first = suffixIndex(FIRST_PART_SUFFIX);
  for (let i = 0; i < MAX_PARTS; i++) {
    const name = prefix + suffixOf(first + i);
    const bytes = await readEntry(name);
    if (!bytes) break; // Erste Lücke beendet den zusammenhängenden Teilelauf.
    const mesh = parseP(bytes, name).value;
    if (mesh) parts.push(mesh); // Defekte Teile: übersprungen, nicht fatal.
  }

  return { skeleton, parts, textures };
}
