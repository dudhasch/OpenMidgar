import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import { hasPSignature, hasTexSignature } from '@webmidgar/formats-model';
import { loadBattleModel, type BattleEntrySource } from '@webmidgar/render-battle';
import { NodeDirectorySource } from './node-source.js';

/**
 * K1/K2-Abnahme — der Battle-Modell-Lader gegen den GESAMTBESTAND von
 * battle.lgp (11.119 Einträge, 481 Präfixe).
 *
 * Prüffrage: Erreicht die Klassifikation nach INHALTS-SIGNATUR jede
 * Geometrie- und Texturdatei, die im Archiv liegt? Die Kontrollhypothese ist
 * der alte, namensratende Lader (Suffixe ab `am` linear, Abbruch an der
 * ersten Lücke, Texturen fest bei `ae`…`ai`) — er wird hier mitgerechnet,
 * damit die Trefferquote ein Kontrollniveau hat.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));

/** Bühnenband `og`…`rr` (gears-pdf §9) — keine Skelettmodelle. */
const istBuehne = (prefix: string): boolean => prefix >= 'og' && prefix <= 'rr';
/** Körperteilband `am`…`cj`; ab `ck` liegen die Waffenteile. */
const istKoerperSuffix = (suffix: string): boolean => suffix >= 'am' && suffix <= 'cj';

/** Der Lader VOR K1/K2 — reine Namensarithmetik, als Kontrollniveau. */
const TEXTURE_SUFFIXES_ALT = ['ae', 'af', 'ag', 'ah', 'ai'];
function altLader(
  vorhanden: Map<string, { p: boolean; tex: boolean }>,
  prefix: string,
): { parts: number; tex: number } {
  const suffixOf = (i: number): string =>
    String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
  const first = ('a'.charCodeAt(0) - 97) * 26 + ('m'.charCodeAt(0) - 97);
  let parts = 0;
  for (let i = 0; i < 64; i++) {
    const eintrag = vorhanden.get(prefix + suffixOf(first + i));
    if (!eintrag) break; // „erste Lücke beendet den Teilelauf"
    if (eintrag.p) parts++;
  }
  let tex = 0;
  for (const s of TEXTURE_SUFFIXES_ALT) if (vorhanden.get(prefix + s)?.tex) tex++;
  return { parts, tex };
}

describe.skipIf(!available)('K1/K2: Battle-Modell-Lader über den Gesamtbestand', () => {
  it('lädt jede .p- und TEX-Datei, die im Archiv liegt', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('battle')];

    // --- Unabhängige Sollrechnung: Klassifikation über alle Einträge --------
    const byName = new Map(entries.map((e) => [e.name, e]));
    const bytesOf = new Map<string, Uint8Array>();
    for (const e of entries) bytesOf.set(e.name, await index.readEntry(e.canonicalId));

    const klasse = new Map<string, { p: boolean; tex: boolean }>();
    const proPraefix = new Map<string, string[]>();
    let sollP = 0;
    let sollTex = 0;
    let sonstige = 0;
    let sonstigeAbDa = 0;
    let mehrdeutig = 0;
    for (const [name, bytes] of bytesOf) {
      expect(name).toMatch(/^[a-z]{4}$/); // Namensraum: 4 Kleinbuchstaben
      const p = hasPSignature(bytes);
      const tex = hasTexSignature(bytes);
      if (p && tex) mehrdeutig++;
      klasse.set(name, { p, tex });
      if (p) sollP++;
      if (tex) sollTex++;
      if (!p && !tex && name.slice(2) !== 'aa') {
        sonstige++;
        if (name.slice(2) === 'ab' || name.slice(2) === 'da') sonstigeAbDa++;
      }
      const pre = name.slice(0, 2);
      if (!proPraefix.has(pre)) proPraefix.set(pre, []);
      proPraefix.get(pre)!.push(name);
    }
    const praefixe = [...proPraefix.keys()].sort();

    // 🟢 Bestandszahlen (2026-08-11). Ändern sie sich, ist die Datenbasis
    // eine andere — dann gehört dieser Test angepasst, nicht der Lader.
    expect(entries.length).toBe(11_119);
    expect(praefixe.length).toBe(481);
    expect(sollP).toBe(8979);
    expect(sollTex).toBe(787);
    // KONTROLLE 1: die Signaturen sind disjunkt und der Rest ist restlos die
    // `ab`/`da`-Animationsfamilie — die Klassifikation greift nicht zufällig.
    expect(mehrdeutig).toBe(0);
    expect(sonstige).toBe(872);
    expect(sonstigeAbDa).toBe(872);

    // --- Lader über alle Präfixe -------------------------------------------
    const source: BattleEntrySource = {
      listBattleEntries: (prefix) => proPraefix.get(prefix) ?? [],
      readBattleEntry: (name) => Promise.resolve(bytesOf.get(name) ?? null),
    };

    let istP = 0;
    let istTex = 0;
    let istTexNichtNull = 0;
    let altP = 0;
    let altTex = 0;
    let ohneSkelett = 0;
    let nullTrotzGeometrie = 0;
    const abweichung: string[] = [];
    let flagGleich = 0;
    let flagModelle = 0;
    let flagBuehnen = 0;
    let texIndexPasst = 0;
    let texIndexKontrolle = 0;
    let texIndexPraefixe = 0;

    for (const prefix of praefixe) {
      const namen = proPraefix.get(prefix)!;
      const eigeneP = namen.filter((n) => klasse.get(n)!.p);
      const eigeneTex = namen.filter((n) => klasse.get(n)!.tex).length;

      const model = await loadBattleModel(prefix, source);
      if (!model) {
        ohneSkelett++;
        continue;
      }
      istP += model.parts.length;
      istTex += model.textures.length;
      istTexNichtNull += model.textures.filter((t) => t !== null).length;
      if (model.parts.length === 0 && eigeneP.length > 0) nullTrotzGeometrie++;
      if (model.parts.length !== eigeneP.length || model.textures.length !== eigeneTex) {
        abweichung.push(`${prefix}: teile ${model.parts.length}/${eigeneP.length}, tex ${model.textures.length}/${eigeneTex}`);
      }

      const alt = altLader(klasse, prefix);
      altP += alt.parts;
      altTex += alt.tex;

      // Kompositionsregel: Flag-Bones gegen das Körperteilband.
      const { skeleton } = parseBattleSkeleton(bytesOf.get(prefix + 'aa')!, prefix + 'aa');
      const flagged = skeleton!.bones.filter((b) => b.hasGeometry).length;
      const koerper = eigeneP.filter((n) => istKoerperSuffix(n.slice(2))).length;
      if (istBuehne(prefix)) {
        if (flagged === koerper) flagBuehnen++;
      } else {
        flagModelle++;
        if (flagged === koerper) flagGleich++;
      }

      // Texturordnung: der größte textureIndex muss der letzten TEX-Datei
      // entsprechen — sonst zeigt die Liste am Bestand vorbei.
      let maxIdx = -1;
      for (const mesh of model.parts)
        for (const sm of mesh.submeshes) if (sm.textured && sm.textureIndex > maxIdx) maxIdx = sm.textureIndex;
      if (maxIdx >= 0 && model.textures.length > 0) {
        texIndexPraefixe++;
        if (maxIdx === model.textures.length - 1) texIndexPasst++;
        // KONTROLLE 2: „die erste TEX-Datei ist nicht Index 0" ⇒ Liste um
        // eins kürzer. Passt das auch, sagt der Test nichts aus.
        if (maxIdx < model.textures.length - 1) texIndexKontrolle++;
      }
    }

    console.log(
      `K1/K2: Teile ${istP}/${sollP} (Kontrolle alter Lader: ${altP}), ` +
        `TEX ${istTex}/${sollTex} (Kontrolle: ${altTex}), ` +
        `Präfixe ohne Skelett ${ohneSkelett}, 0-Teile-trotz-Geometrie ${nullTrotzGeometrie}, ` +
        `Flag-Bones==Körperteile ${flagGleich}/${flagModelle} Modelle, ${flagBuehnen} Bühnen; ` +
        `texIndex passt ${texIndexPasst}/${texIndexPraefixe}, Kontrolle ${texIndexKontrolle}`,
    );

    // --- Abnahme ------------------------------------------------------------
    expect(abweichung).toEqual([]);
    expect(istP).toBe(sollP); // 8979 statt 2321
    expect(istTex).toBe(sollTex); // 787 statt 411
    expect(istTexNichtNull).toBe(sollTex); // alle parsebar (bpp=1 im Bestand)
    expect(ohneSkelett).toBe(0);
    expect(nullTrotzGeometrie).toBe(0);
    // Kontrollniveau: der alte Lader bleibt weit darunter.
    expect(altP).toBe(2321);
    expect(altTex).toBe(411);

    // 🟢 Kompositionsregel am Bestand: 391/391 Modellpräfixe, 0/90 Bühnen.
    expect(flagGleich).toBe(flagModelle);
    expect(flagModelle).toBe(391);
    expect(flagBuehnen).toBe(0);

    // 🟢 Texturordnung: ausnahmslos passend, Kontrolle ausnahmslos nicht.
    expect(texIndexPraefixe).toBe(198);
    expect(texIndexPasst).toBe(198);
    expect(texIndexKontrolle).toBe(0);

    // Der Rückfallpfad ohne Auflistung muss dasselbe liefern (Stichprobe).
    for (const prefix of ['aa', 'ak', 'ao', 'ar', 'ba', 'ef', 'rt', 'sm']) {
      const mitListe = await loadBattleModel(prefix, source);
      const ohneListe = await loadBattleModel(prefix, (n) => Promise.resolve(bytesOf.get(n) ?? null));
      expect(ohneListe!.parts.length).toBe(mitListe!.parts.length);
      expect(ohneListe!.textures.length).toBe(mitListe!.textures.length);
    }

    // Cloud (`rt`) namentlich: 33 Teile (17 Körper + 16 Waffen), 2 Texturen.
    const cloud = await loadBattleModel('rt', source);
    expect(cloud!.parts.length).toBe(33);
    expect(cloud!.textures.length).toBe(2);

    expect(byName.size).toBe(entries.length);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
