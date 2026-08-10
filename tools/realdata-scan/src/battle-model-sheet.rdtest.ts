import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import { assignPartsToBones, battleSkeletonToSkeleton } from '@webmidgar/render-battle';
import { parseP, parseTex, type TextureSource } from '@webmidgar/formats-model';
import { bindPoseFrame } from '@webmidgar/render-actor';
import { NodeDirectorySource } from './node-source.js';
import { dreiecke, html, rasterize, type Fall, type Modell } from './sheet.js';

/**
 * S32 — Standbild-Sichtnachweis der Battle-Modellklassen (S30-Abnahme
 * „Gegner steht, Textur sitzt" + S32-Kompositionsregel).
 *
 * Aufbau je Modell: Skelett `<präfix>aa` (belegte 52+12n-Grammatik) →
 * Geometrie-/Texturdateien des Präfixes nach Suffixordnung klassifiziert
 * ÜBER INHALTS-SIGNATUR (nicht über den Namen) → 🟡-Kompositionsregel
 * „k-ter Flag-Bone ← k-tes Teil" → Bindpose → Frontansicht durch DENSELBEN
 * Rasterizer wie die R4-Tafeln.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));

const OUT =
  process.env['WEBMIDGAR_BATTLE_SHEET_OUT'] ??
  join(REAL_DIR, '..', '..', '..', '..', 'webmidgar-sheets', 'battle-modelle.html');

/** Präfixe quer über die Klassen: frühe Gegner, späte Gegner, Spielermodelle. */
const PROBEN = ['aa', 'ab', 'ac', 'ba', 'cn', 'dz', 'gm', 'iz', 'of', 'rt', 'ru', 'rv', 'sb', 'si'];

describe.skipIf(!available)('S32-Tafel: Battle-Modelle im Standbild', () => {
  it('rendert je Modellklasse ein Standbild (Bindpose, Frontansicht)', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('battle')];
    const byName = new Map(entries.map((e) => [e.name, e]));

    const faelle: Fall[] = [];
    let mitTextur = 0;
    for (const prefix of PROBEN) {
      const skelEntry = byName.get(prefix + 'aa');
      if (!skelEntry) continue;
      const { skeleton: bs } = parseBattleSkeleton(await index.readEntry(skelEntry.canonicalId), prefix + 'aa');
      if (!bs) continue;

      // Alle Dateien des Präfixes in Suffixordnung, per Inhalt klassifiziert.
      const own = entries.filter((e) => e.name.startsWith(prefix) && e.name.length === 4).sort((a, b) => (a.name < b.name ? -1 : 1));
      const parts = [];
      const texturen: (TextureSource | null)[] = [];
      for (const e of own) {
        if (e.name === prefix + 'aa') continue;
        const data = await index.readEntry(e.canonicalId);
        const p = parseP(data, e.name).value;
        if (p) {
          parts.push(p);
          continue;
        }
        const t = parseTex(data, e.name).value;
        if (t) texturen.push(t);
      }
      const { boneToPart, unassignedParts } = assignPartsToBones(bs, parts.length);

      // Varianten: Kindversatz-Vorzeichen × Wurzelwinkel. Anlass: KimeraCS
      // versetzt Battle-Bones mit +len (Field: −len, R4-B1) — die Tafel hat
      // entschieden, welche Kombination die Figur aufrecht stellt.
      //
      // **Ergebnis (Sichtprüfung 2026-08-10, dokumentiert in FINDINGS S32):**
      // Sieger ist (+len, Frame-X 270° ⇒ netto Rx(180°) im Modellraum) —
      // Cloud mit Frisur/Gesicht/Schwert, Barret, Laternenträger u. a.
      // aufrecht und zusammenhängend. Diese Kombination ist seither die
      // PRODUKTIONSREGEL (`battleSkeletonToSkeleton` negiert die Längen,
      // `BATTLE_ROOT_EXTRA_X_DEG = 270`); `negate: true` stellt hier die alte
      // Field-Konvention als Kontrolle wieder her.
      const varianten: { name: string; negate: boolean; rootXDeg: number }[] = [
        { name: 'PRODUKTION: +len, Frame-X 270°', negate: false, rootXDeg: 270 },
        { name: 'Kontrolle: −len, Frame-X 270°', negate: true, rootXDeg: 270 },
        { name: 'Kontrolle: +len, Frame-X 0°', negate: false, rootXDeg: 0 },
        { name: 'Kontrolle: +len, Frame-X 90°', negate: false, rootXDeg: 90 },
      ];
      for (const variante of varianten) {
        const bsVar = variante.negate
          ? { ...bs, bones: bs.bones.map((b) => ({ ...b, length: -b.length })) }
          : bs;
        const skeleton = battleSkeletonToSkeleton(bsVar, prefix);
        const res = new Map<number, { mesh: (typeof parts)[number]; texturen: (TextureSource | null)[] }[]>();
        for (const [bone, part] of boneToPart) res.set(bone, [{ mesh: parts[part]!, texturen }]);
        const frame = bindPoseFrame(skeleton);
        const modell: Modell = {
          skeleton,
          res,
          clip: { schemaVersion: 1, frames: [frame], boneCount: bs.boneCount, rotationOrder: [1, 0, 2], diagnostics: [] },
          texAnzahl: texturen.length,
          texDreiecke: 0,
        };
        const tris = dreiecke(modell, {
          palette: 'BGRA (heute)',
          flipU: false,
          flipV: false,
          vertexPerm: null,
          frame: { ...frame, rootRotation: [variante.rootXDeg, 0, 0] },
        });
        if (tris.some((t) => t.tex)) mitTextur++;
        faelle.push({
          id: `battle-${prefix}-${varianten.indexOf(variante)}`,
          gruppe: prefix < 'oh' ? `Gegner ${prefix}` : `Spieler/Sonder ${prefix}`,
          frage: 'Steht die Figur aufrecht und zusammenhängend, sitzt die Textur?',
          variante: variante.name,
          detail: `bones=${bs.boneCount} teile=${parts.length} tex=${texturen.length} unzugeordnet=${unassignedParts.length}`,
          png: rasterize(tris, { transparenz: true, aufkleberVersatz: true }),
        });
      }
    }

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      html(faelle, {
        titel: 'S32 — Battle-Modelle: Standbild-Sichtnachweis',
        speicher: 'webmidgar-battle-modelle',
        kennung: 'battle-modelle-v1',
        einleitung:
          '<p>Bindpose, Frontansicht, 🟡-Kompositionsregel „k-ter Flag-Bone ← k-tes Teil in Suffixordnung". Urteil pro Zelle.</p>',
        wahl: [
          ['richtig', 'aufrecht + zusammenhängend'],
          ['gedreht', 'erkennbar, aber gedreht/gekippt'],
          ['zerlegt', 'Teile verstreut (Regel falsch)'],
          ['unbrauchbar', 'nicht erkennbar'],
        ],
      }),
      'utf8',
    );
    // Einzelbilder zusätzlich als PNG (für die dokumentierte Sichtprüfung).
    const pngDir = join(dirname(OUT), 'battle-png');
    mkdirSync(pngDir, { recursive: true });
    for (const f of faelle) writeFileSync(join(pngDir, `${f.id}.png`), f.png);
    console.log(`Battle-Tafel: ${faelle.length} Modelle → ${OUT} (PNGs: ${pngDir}); mitTextur=${mitTextur}`);
    expect(faelle.length).toBeGreaterThanOrEqual(10);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
