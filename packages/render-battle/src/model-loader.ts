import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import {
  hasPSignature,
  hasTexSignature,
  parseP,
  parseTex,
  type MeshSource,
  type TextureSource,
} from '@webmidgar/formats-model';
import type { BattleModelFiles } from './battle-actor.js';

/**
 * Battle-Modell-Lader: löst ein 2-Zeichen-Präfix (aus `enemyModelPrefix`
 * bzw. dem Party-Präfix) gegen die Einträge von battle.lgp auf.
 *
 * 🔵 GRUNDENTSCHEIDUNG (K1/K2, 2026-08-11): Es wird **kein Dateiname mehr
 * geraten**. Der Lader listet den Namensraum des Präfixes auf und
 * klassifiziert jeden Eintrag über seine INHALTS-SIGNATUR
 * (`hasPSignature` / `hasTexSignature` aus `formats-model`) — dieselbe
 * Methode, mit der die Realdaten-Tafel `battle-model-sheet.rdtest.ts`
 * arbeitet. Die Suffixordnung bleibt die Teileordnung der
 * 🟡-Kompositionsregel („k-ter Flag-Bone ← k-tes Teil").
 *
 * ANLASS — der alte, namensratende Lader verlor gemessen 74 % der Geometrie
 * und 83 % der Modelltexturen (Ursache von F26/F33):
 *  - Er zählte Suffixe ab `am` linear hoch und brach beim ERSTEN fehlenden
 *    Namen ab. Die Annahme „Geometriesuffixe je Präfix zusammenhängend" ist
 *    am Bestand FALSCH: von 8979 `.p`-Dateien erreichte er 2321 (25,8 %),
 *    358 von 481 Präfixen verloren Teile, 36 Präfixe ergaben 0 Teile obwohl
 *    `.p` vorhanden war (deren Geometrie beginnt bei `an`, nicht `am`).
 *    Sein Fenster `am`+63 endete zudem bei `cx`, während Spielermodelle bis
 *    `cz` laufen.
 *  - Die feste Texturliste `ae…ai` war eine Namensannahme: Modelltexturen
 *    liegen gemessen bei `ac…af` (108 × `ac`, 58 × `ad`, 33 × `ae`, 2 × `af`),
 *    Bühnentexturen bei `ac…aj`. Cloud (`rt`) hat seine beiden Texturen bei
 *    `ac`/`ad` und bekam damit NULL Texturen.
 *
 * BELEGE (battle.lgp, alle 11.119 Einträge, Messung 2026-08-11; Kontrollen
 * in `battle-model-loader.rdtest.ts` und an den Signaturfunktionen):
 *  - Namensraum: ausnahmslos 4 Kleinbuchstaben `<präfix:2><suffix:2>`,
 *    481 Präfixe. 🟢 Klassifikation nach Inhalt: 8979 `.p`, 787 TEX,
 *    481 Skelette (je Präfix genau eines, Suffix `aa`, Grammatik 52+12·n),
 *    872 Rest — und dieser Rest ist ZU 100 % die `ab`/`da`-Familie
 *    (Animationsformate, Grammatik 🔴). Die drei Signaturen sind am
 *    Gesamtbestand paarweise disjunkt (0 Mehrfachtreffer).
 *  - 🟢 Der Namensraum aus `docs/fremdquellen/gears-pdf.md` §9 ist damit an
 *    den Daten bestätigt UND präzisiert: `am`…`cj` Körperteile, `ck`…`cz`
 *    Waffen. Für **391/391 Modellpräfixe** gilt exakt
 *    `Flag-Bones == Anzahl .p im Band am…cj` (Cloud `rt`: 17 = 17, dazu
 *    16 Waffenteile `ck`…`cz`). Bühnenpräfixe (`og`…`rr`) folgen dieser
 *    Regel NICHT (0/90) — sie sind keine Skelettmodelle.
 *  - 🟢 Texturordnung: für alle 198 Präfixe mit texturierten Submeshes gilt
 *    `max(textureIndex) == Anzahl TEX − 1`, ausnahmslos. Kontrollhypothese
 *    „die erste TEX-Datei ist NICHT Index 0" (Liste um eins verkürzt)
 *    scheitert in 198/198. Index 0 ist also die erste TEX-Datei in
 *    Suffixordnung.
 *
 * Fehlerpolitik: fehlende oder unparsebare Teile werden toleriert (der Lauf
 * geht weiter), `null` NUR wenn das Skelett fehlt oder defekt ist. Eine
 * unparsebare TEX-Datei behält als `null` ihren Listenplatz — ein
 * Überspringen würde alle folgenden `textureIndex`-Verweise verschieben.
 */

const SKELETON_SUFFIX = 'aa';

/**
 * 🔵 Quelle der battle.lgp-Einträge. `listBattleEntries` liefert die Namen
 * ALLER Einträge eines Präfixes (Reihenfolge egal — der Lader sortiert
 * selbst nach Suffix); `readBattleEntry` liest einen davon.
 * `GameData` der Demo erfüllt diese Schnittstelle strukturell.
 */
export interface BattleEntrySource {
  listBattleEntries(prefix: string): Promise<readonly string[]> | readonly string[];
  readBattleEntry(name: string): Promise<Uint8Array | null>;
}

/** Reine Lesefunktion (Altaufrufer ohne Auflistung) — siehe `resolveNames`. */
export type ReadBattleEntry = (name: string) => Promise<Uint8Array | null>;

/**
 * Suffixfenster des Rückfallpfads: `aa`…`dz`. 🟢 Am Bestand liegt das größte
 * vorkommende Suffix bei `da`; das Fenster deckt es mit Rand ab. Es wird NUR
 * benutzt, wenn der Aufrufer keine Auflistung anbietet — dann ersetzt das
 * vollständige Abtasten des Suffixraums die Auflistung. Geraten wird auch
 * dabei nichts: klassifiziert wird ausschließlich nach Inhalt.
 */
const PROBE_ROWS = 4; // 'a'..'d'

function probeSuffixes(): string[] {
  const out: string[] = [];
  for (let r = 0; r < PROBE_ROWS; r++)
    for (let c = 0; c < 26; c++) out.push(String.fromCharCode(97 + r) + String.fromCharCode(97 + c));
  return out;
}

function isSource(x: BattleEntrySource | ReadBattleEntry): x is BattleEntrySource {
  return typeof x === 'object' && x !== null && typeof x.listBattleEntries === 'function';
}

/**
 * Einträge des Präfixes in SUFFIXORDNUNG. Mit Auflistung: der echte
 * Namensraum. Ohne: das abgetastete Suffixfenster (Treffer entscheidet der
 * Lesevorgang, nicht der Name).
 */
async function resolveNames(prefix: string, src: BattleEntrySource | ReadBattleEntry): Promise<string[]> {
  if (!isSource(src)) return probeSuffixes().map((s) => prefix + s);
  const listed = await src.listBattleEntries(prefix);
  const namen = listed
    .map((n) => n.toLowerCase())
    .filter((n) => n.length === prefix.length + 2 && n.startsWith(prefix.toLowerCase()));
  return [...new Set(namen)].sort();
}

export async function loadBattleModel(
  prefix: string,
  source: BattleEntrySource | ReadBattleEntry,
): Promise<BattleModelFiles | null> {
  const read: ReadBattleEntry = isSource(source) ? (n) => source.readBattleEntry(n) : source;

  const skeletonName = prefix + SKELETON_SUFFIX;
  const skeletonBytes = await read(skeletonName);
  if (!skeletonBytes) return null;
  const { skeleton } = parseBattleSkeleton(skeletonBytes, skeletonName);
  if (!skeleton) return null;

  const parts: MeshSource[] = [];
  const textures: (TextureSource | null)[] = [];

  for (const name of await resolveNames(prefix, source)) {
    if (name === skeletonName) continue; // Skelettplatz ist namensfest belegt.
    const bytes = await read(name);
    if (!bytes) continue;
    if (hasPSignature(bytes)) {
      const mesh = parseP(bytes, name).value;
      if (mesh) parts.push(mesh); // Defektes Teil: übersprungen, nicht fatal.
      continue;
    }
    if (hasTexSignature(bytes)) {
      // Platzhalter bei Parse-Fehler: die Indexposition MUSS erhalten bleiben.
      textures.push(parseTex(bytes, name).value);
    }
    // Alles Übrige (gemessen: ausschließlich die `ab`/`da`-Animationsfamilie)
    // wird nicht angefasst.
  }

  return { skeleton, parts, textures };
}
