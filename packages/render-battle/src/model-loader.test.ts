import { describe, expect, it } from 'vitest';
import { composeBattleSkeleton, composeP, composeTex } from '@webmidgar/fixture-gen';
import { loadBattleModel } from './model-loader.js';

/**
 * Modell-Lader gegen In-Memory-Einträge (readEntry als Map-Zugriff) — die
 * belegte battle.lgp-Namenskonvention als Sollverlauf: `aa` Skelett,
 * `ae`–`ai` TEX, `am`+ `.p` in Suffixordnung; `ab` (Animationsformat 🔴)
 * wird nicht angefasst.
 */

function fixtureSkeleton(): Uint8Array {
  return composeBattleSkeleton([
    { parent: -1, length: 0, hasGeometry: false },
    { parent: 0, length: -10, hasGeometry: true },
    { parent: 1, length: -8, hasGeometry: true },
    { parent: 2, length: -6, hasGeometry: true },
  ]);
}

function fixtureMesh(): Uint8Array {
  return composeP({
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    normals: [[0, 0, 1]],
    groups: [{ vertexStart: 0, vertexCount: 3, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] }],
  });
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

function makeReadEntry(entries: Record<string, Uint8Array>): {
  readEntry: (name: string) => Promise<Uint8Array | null>;
  requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    readEntry: (name) => {
      requested.push(name);
      return Promise.resolve(entries[name] ?? null);
    },
  };
}

describe('loadBattleModel: Namenskonvention und Toleranzregeln', () => {
  it('lädt Skelett (aa), Texturen (ae–ai) und Teile (am+) in Suffixordnung', async () => {
    const { readEntry, requested } = makeReadEntry({
      xyaa: fixtureSkeleton(),
      xyab: new Uint8Array([1, 2, 3]), // Animationsformat — darf nie angefragt werden
      xyae: fixtureTex(),
      xyaf: fixtureTex(),
      xyam: fixtureMesh(),
      xyan: fixtureMesh(),
      xyao: fixtureMesh(),
    });
    const model = await loadBattleModel('xy', readEntry);
    expect(model).not.toBeNull();
    expect(model!.skeleton.boneCount).toBe(4);
    expect(model!.parts.length).toBe(3);
    expect(model!.textures.length).toBe(2);
    expect(requested).not.toContain('xyab');
    // Teilelauf endet an der ersten Lücke: nach xyao wird xyap angefragt, dann Schluss.
    expect(requested.filter((n) => n >= 'xyam' && n <= 'xyap')).toEqual(['xyam', 'xyan', 'xyao', 'xyap']);
  });

  it('fehlendes Skelett ⇒ null; defektes Skelett ⇒ null', async () => {
    expect(await loadBattleModel('xy', makeReadEntry({}).readEntry)).toBeNull();
    const defekt = fixtureSkeleton();
    defekt[12] = 99; // Bone-Anzahl passt nicht mehr zum Accounting
    expect(await loadBattleModel('xy', makeReadEntry({ xyaa: defekt }).readEntry)).toBeNull();
  });

  it('fehlende Texturen und Teile werden toleriert (so viele Parts wie auflösbar)', async () => {
    // Keine Texturen, Lücke nach dem ersten Teil: xyao bleibt unerreichbar.
    const { readEntry } = makeReadEntry({
      xyaa: fixtureSkeleton(),
      xyam: fixtureMesh(),
      xyao: fixtureMesh(),
    });
    const model = await loadBattleModel('xy', readEntry);
    expect(model).not.toBeNull();
    expect(model!.textures).toEqual([]);
    expect(model!.parts.length).toBe(1);
  });

  it('ein vorhandener, aber unparsebarer Teil wird übersprungen, der Lauf geht weiter', async () => {
    const { readEntry } = makeReadEntry({
      xyaa: fixtureSkeleton(),
      xyam: fixtureMesh(),
      xyan: new Uint8Array([0xde, 0xad]), // kein .p
      xyao: fixtureMesh(),
    });
    const model = await loadBattleModel('xy', readEntry);
    expect(model!.parts.length).toBe(2);
  });

  it('unparsebare Textur wird übersprungen, spätere Suffixe zählen weiter', async () => {
    const { readEntry } = makeReadEntry({
      xyaa: fixtureSkeleton(),
      xyae: new Uint8Array([1]), // kein TEX
      xyag: fixtureTex(),
    });
    const model = await loadBattleModel('xy', readEntry);
    expect(model!.textures.length).toBe(1);
  });
});
