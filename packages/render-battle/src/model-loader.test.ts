import { describe, expect, it } from 'vitest';
import { composeBattleSkeleton, composeP, composeTex } from '@webmidgar/fixture-gen';
import { loadBattleModel, type BattleEntrySource } from './model-loader.js';

/**
 * Modell-Lader gegen In-Memory-Einträge. Sollverlauf ist die
 * INHALTS-Klassifikation (K1/K2): der Namensraum des Präfixes wird
 * aufgelistet, jeder Eintrag über seine Signatur eingeordnet, die
 * Suffixordnung bleibt die Teileordnung. Die alten Namensannahmen
 * (`am` fortlaufend bis zur ersten Lücke, Texturen fest bei `ae`…`ai`)
 * stehen hier als Regressionsfälle.
 */

function fixtureSkeleton(): Uint8Array {
  return composeBattleSkeleton([
    { parent: -1, length: 0, hasGeometry: false },
    { parent: 0, length: -10, hasGeometry: true },
    { parent: 1, length: -8, hasGeometry: true },
    { parent: 2, length: -6, hasGeometry: true },
  ]);
}

/** `n` Dreiecke — die Vertexzahl macht die Teile in der Reihenfolge unterscheidbar. */
function fixtureMesh(dreiecke = 1): Uint8Array {
  const vertices: [number, number, number][] = [];
  const groups = [];
  for (let i = 0; i < dreiecke; i++) {
    vertices.push([i, 0, 0], [i + 1, 0, 0], [i, 1, 0]);
    groups.push({
      vertexStart: i * 3,
      vertexCount: 3,
      polys: [{ v: [0, 1, 2] as [number, number, number], n: [0, 0, 0] as [number, number, number] }],
    });
  }
  return composeP({ vertices, normals: [[0, 0, 1]], groups });
}

function fixtureTex(): Uint8Array {
  return composeTex({
    width: 2,
    height: 2,
    palettes: [
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ],
    ],
    pixels: [0, 1, 1, 0],
  });
}

/** TEX-Signatur intakt (Size-Accounting), aber außerhalb des S7-Scopes. */
function fixtureTexUnparsebar(): Uint8Array {
  const bytes = fixtureTex();
  new DataView(bytes.buffer).setUint32(0x4c, 0, true); // hasPalette = 0 ⇒ E-TEX-FORMAT
  return bytes;
}

/** Fremdformat (`ab`/`da`-Familie): trägt keine der beiden Signaturen. */
function fixtureFremd(len = 64): Uint8Array {
  return new Uint8Array(len).fill(0x7f);
}

function makeSource(entries: Record<string, Uint8Array>): BattleEntrySource & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    listBattleEntries: (prefix) => Object.keys(entries).filter((n) => n.startsWith(prefix)),
    readBattleEntry: (name) => {
      requested.push(name);
      return Promise.resolve(entries[name] ?? null);
    },
  };
}

function makeReadEntry(entries: Record<string, Uint8Array>): (name: string) => Promise<Uint8Array | null> {
  return (name) => Promise.resolve(entries[name] ?? null);
}

describe('loadBattleModel: Klassifikation nach Inhalt', () => {
  it('ordnet Skelett, Teile und Texturen nach Signatur, in Suffixordnung', async () => {
    const src = makeSource({
      xyaa: fixtureSkeleton(),
      xyab: fixtureFremd(), // Animationsformat — weder Teil noch Textur
      xyac: fixtureTex(),
      xyad: fixtureTex(),
      xyam: fixtureMesh(1),
      xyan: fixtureMesh(2),
      xyao: fixtureMesh(3),
      xyda: fixtureFremd(128),
    });
    const model = await loadBattleModel('xy', src);
    expect(model).not.toBeNull();
    expect(model!.skeleton.boneCount).toBe(4);
    // Suffixordnung = Teileordnung: 1, 2, 3 Dreiecke ⇒ 3, 6, 9 Indizes.
    expect(model!.parts.map((p) => p.indices.length)).toEqual([3, 6, 9]);
    expect(model!.textures.length).toBe(2);
    expect(model!.textures.every((t) => t !== null)).toBe(true);
  });

  it('K1-Regression: Teilesuffixe mit Lücken und ohne `am` werden vollständig geladen', async () => {
    // Der alte Lader hätte hier 0 Teile geliefert (kein `am`, Abbruch an der
    // ersten Lücke) — am Bestand betraf genau das 36 Präfixe.
    const src = makeSource({
      xyaa: fixtureSkeleton(),
      xyan: fixtureMesh(1),
      xyap: fixtureMesh(2),
      xybz: fixtureMesh(3),
      xycz: fixtureMesh(4), // jenseits des alten Fensters (`am`+63 = `cx`)
    });
    const model = await loadBattleModel('xy', src);
    expect(model!.parts.map((p) => p.indices.length)).toEqual([3, 6, 9, 12]);
  });

  it('K2-Regression: Texturen außerhalb von `ae`…`ai` (Cloud-Fall `ac`/`ad`)', async () => {
    const src = makeSource({
      rtaa: fixtureSkeleton(),
      rtac: fixtureTex(),
      rtad: fixtureTex(),
      rtam: fixtureMesh(),
    });
    const model = await loadBattleModel('rt', src);
    expect(model!.textures.length).toBe(2); // alter Lader: 0
  });

  it('unparsebare Textur behält ihre Indexposition (null statt Überspringen)', async () => {
    const src = makeSource({
      xyaa: fixtureSkeleton(),
      xyac: fixtureTexUnparsebar(),
      xyad: fixtureTex(),
      xyae: fixtureTex(),
    });
    const model = await loadBattleModel('xy', src);
    expect(model!.textures.length).toBe(3);
    expect(model!.textures[0]).toBeNull();
    expect(model!.textures[1]).not.toBeNull();
    expect(model!.textures[2]).not.toBeNull();
    // Kontrolle gegen das alte Verhalten: dort wäre `ad` auf Index 0
    // gerutscht und jeder `textureIndex` der Submeshes um eins verschoben.
  });

  it('fehlendes Skelett ⇒ null; defektes Skelett ⇒ null', async () => {
    expect(await loadBattleModel('xy', makeSource({}))).toBeNull();
    const defekt = fixtureSkeleton();
    defekt[12] = 99; // Bone-Anzahl passt nicht mehr zum Accounting
    expect(await loadBattleModel('xy', makeSource({ xyaa: defekt }))).toBeNull();
  });

  it('Einträge ohne Signatur (Animationsfamilie) werden weder Teil noch Textur', async () => {
    const src = makeSource({
      xyaa: fixtureSkeleton(),
      xyam: fixtureMesh(1),
      xyan: fixtureFremd(512), // weder .p noch TEX ⇒ ignoriert
      xyao: fixtureMesh(2),
    });
    const model = await loadBattleModel('xy', src);
    expect(model!.parts.length).toBe(2);
    expect(model!.textures).toEqual([]);
  });

  it('Altaufruf ohne Auflistung: Suffixfenster wird abgetastet, Ergebnis identisch', async () => {
    const entries = {
      xyaa: fixtureSkeleton(),
      xyab: fixtureFremd(),
      xyac: fixtureTex(),
      xyan: fixtureMesh(1),
      xycz: fixtureMesh(2),
    };
    const mitListe = await loadBattleModel('xy', makeSource(entries));
    const ohneListe = await loadBattleModel('xy', makeReadEntry(entries));
    expect(ohneListe!.parts.map((p) => p.indices.length)).toEqual(mitListe!.parts.map((p) => p.indices.length));
    expect(ohneListe!.textures.length).toBe(mitListe!.textures.length);
    expect(ohneListe!.parts.length).toBe(2);
  });

  it('Einträge fremder Präfixe aus der Auflistung werden ignoriert', async () => {
    const src = makeSource({ xyaa: fixtureSkeleton(), xyam: fixtureMesh() });
    // Auflistung liefert absichtlich zu viel (falsche Länge, fremdes Präfix).
    const laut: BattleEntrySource = {
      listBattleEntries: () => ['xyaa', 'xyam', 'zzam', 'xyamx', 'XYAM'],
      readBattleEntry: src.readBattleEntry,
    };
    const model = await loadBattleModel('xy', laut);
    expect(model!.parts.length).toBe(1); // `XYAM` ist derselbe Eintrag, nicht ein zweiter
  });
});
