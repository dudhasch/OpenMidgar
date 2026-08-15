import { parseBattleAnimBank, parseBattleSkeleton } from '@webmidgar/formats-battle';
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
 *    872 Rest — und dieser Rest ist ZU 100 % die `ab`/`da`-Familie. Beide sind
 *    seit K9 gedeutet: `da` ist die **Animationsbank** (391 Dateien, Format
 *    🟢 belegt, 391/391 byteexakt abgerechnet), `ab` ist der `.B`-Infoblock
 *    des Modells (481 Dateien) — **keine** Animationsfamilie. Die drei
 *    Signaturen sind am Gesamtbestand paarweise disjunkt (0 Mehrfachtreffer).
 *  - 🟢 Der Namensraum aus `docs/quellen/gears-pdf.md` §9 ist damit an
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
 * 🟢 **Namensfest belegt, nicht geraten.** Die Namensbildung des Originals
 * (`BattleModel_ResolveArchiveName` `0x005E2460`) rechnet einen Suffixcode in
 * zwei Buchstaben um: `out[2] = 'A' + code/26`, `out[3] = 'A' + code%26`. Die
 * Codes stehen fest — `.D` → 0 (`aa`, Deskriptor/Skelett), `.B` → 1 (`ab`,
 * Infoblock), `.Pnn` → 12+nn (Teile ab `am`), `.A` → **78** → `da`. Es gibt
 * genau EINE Animationsdatei je Modell; die Bank darin trägt alle Sätze.
 */
const ANIM_SUFFIX = 'da';

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

/**
 * Geometrie und Texturen eines Präfixes in SUFFIXORDNUNG einsammeln —
 * gemeinsamer Kern von Modell- und Bühnenlader. Der Unterschied zwischen
 * beiden ist NUR das Skelett: Bühnenpräfixe haben keines (🟢 gemessen:
 * 90/90 im Band `og`…`rr` mit boneCount 0), tragen aber dieselben `.p`- und
 * TEX-Dateien und werden deshalb über denselben Pfad gelesen.
 */
async function collectParts(
  prefix: string,
  source: BattleEntrySource | ReadBattleEntry,
  read: ReadBattleEntry,
): Promise<{ parts: MeshSource[]; textures: (TextureSource | null)[] }> {
  const parts: MeshSource[] = [];
  const textures: (TextureSource | null)[] = [];
  const skeletonName = prefix + SKELETON_SUFFIX;
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
    // Alles Übrige wird hier nicht angefasst: `ab` ist der Infoblock, `da`
    // die Animationsbank — die liest `loadBattleModel` gezielt über ihren
    // belegten Namen, nicht über diese Signaturschleife.
  }
  return { parts, textures };
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

  const { parts, textures } = await collectParts(prefix, source, read);

  /**
   * Animationsbank (K9). Fehlerpolitik wie bei den Teilen: Eine fehlende oder
   * defekte Bank kostet die Bewegung, nicht das Modell — die Figur steht dann
   * in der Bindpose, so wie vor K9 alle Figuren. `null` gibt dieser Lader
   * weiterhin NUR bei fehlendem Skelett zurück.
   */
  const animBytes = await read(prefix + ANIM_SUFFIX);
  const animations = animBytes ? parseBattleAnimBank(animBytes, prefix + ANIM_SUFFIX).bank : null;

  return { skeleton, parts, textures, animations };
}

/**
 * 🟢 **Bühnenband** (gemessen 2026-08-11, `battle-model-loader.rdtest.ts` und
 * `battle-stage.rdtest.ts`): Von den 481 Präfixen in battle.lgp haben genau
 * 90 ein leeres Skelett (boneCount 0, `ab` exakt 8 B, keine `da`-Datei). Sie
 * liegen ZUSAMMENHÄNGEND als `og`…`rr` auf den Sortierplätzen 370…459 — das
 * Band ist an beiden Seiten scharf begrenzt, es gibt keinen einzigen
 * skelettlosen Präfix ausserhalb und keinen Skelettpräfix darin.
 */
export const STAGE_PREFIX_FIRST = 'og';
export const STAGE_PREFIX_LAST = 'rr';
export const STAGE_COUNT = 90;
/** Sortierplatz des ersten Bühnenpräfixes — nur als Quervergleich belegt. */
export const STAGE_BAND_FIRST_INDEX = 370;

/**
 * Das Bühnenband aus einer Präfixliste. Bewusst über den NAMENSBEREICH und
 * nicht über den Sortierplatz: Ein Mod, der irgendwo ein Präfix einfügt,
 * verschiebt die Plätze, aber nicht die Namen.
 */
export function stageBand(prefixes: readonly string[]): string[] {
  return prefixes
    .filter((p) => p >= STAGE_PREFIX_FIRST && p <= STAGE_PREFIX_LAST)
    .slice()
    .sort();
}

/**
 * 🟢 **`location` → Bühnenpräfix** (gemessen an scene.bin, Belege in
 * `battle-stage.rdtest.ts`): Das u16 am Anfang des Setup-Satzes einer
 * Formation indiziert DIREKT in das Bühnenband. Der Wertebereich schöpft das
 * Band exakt aus (0…89); die Kontrollen `location±1` verlassen es an genau
 * einem Ende, eine verwürfelte Zuordnung löst zwar auch auf, trifft aber
 * keine passende Bühne — deshalb steht neben der Quote die Abdeckung.
 */
export function stagePrefixForLocation(location: number, prefixes: readonly string[]): string | null {
  const band = stageBand(prefixes);
  if (!Number.isInteger(location) || location < 0 || location >= band.length) return null;
  return band[location]!;
}

export interface BattleStageFiles {
  /** Bühnenteile in Suffixordnung. Skelettlos — siehe `loadBattleStage`. */
  parts: MeshSource[];
  textures: (TextureSource | null)[];
}

/**
 * Bühnenlader. Anders als beim Modell gibt es KEIN Skelett und damit keine
 * Kompositionsregel: 🟢 gemessen tragen die Bühnenteile ihre Lage in den
 * eigenen Vertexkoordinaten (Streuung der Teilmittelpunkte gegenüber der
 * mittleren Teilgröße, siehe `battle-stage.rdtest.ts`). Die Bühne ist damit
 * die blosse VEREINIGUNG ihrer Teile — kein Teil wird versetzt, gedreht oder
 * skaliert. Fehlt das Präfix ganz, kommt `null`.
 */
export async function loadBattleStage(
  prefix: string,
  source: BattleEntrySource | ReadBattleEntry,
): Promise<BattleStageFiles | null> {
  const read: ReadBattleEntry = isSource(source) ? (n) => source.readBattleEntry(n) : source;
  const { parts, textures } = await collectParts(prefix, source, read);
  if (parts.length === 0) return null;
  return { parts, textures };
}
