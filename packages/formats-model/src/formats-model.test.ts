import { describe, expect, it } from 'vitest';
import {
  composeA,
  composeHrc,
  composeP,
  composeRsd,
  composeTex,
  type PSpec,
} from '@webmidgar/fixture-gen';
import { parseA } from './anim.js';
import { parseHrc } from './hrc.js';
import { parseP } from './p.js';
import { parseRsd } from './rsd.js';
import { parseTex, texToRgba } from './tex.js';

/** Roundtrips laufen über zwei unabhängige Implementierungen (Writer↔Parser). */

describe('.hrc', () => {
  const spec = {
    skeletonName: 'figur',
    bones: [
      { name: 'hip', parent: 'root', length: -2.5, resources: ['hipmesh'] },
      { name: 'chest', parent: 'hip', length: -3.25, resources: [] },
      { name: 'arm_l', parent: 'chest', length: -1.5, resources: ['armmesh', 'armextra'] },
    ],
  };

  it('Roundtrip: Namen, Parents, Längen, Ressourcen, Dateireihenfolge', () => {
    const { value } = parseHrc(composeHrc(spec), 'fix.hrc');
    expect(value).not.toBeNull();
    expect(value!.name).toBe('figur');
    expect(value!.bones.map((b) => b.name)).toEqual(['hip', 'chest', 'arm_l']);
    expect(value!.bones.map((b) => b.parentIndex)).toEqual([-1, 0, 1]);
    expect(value!.bones[0]!.length).toBeCloseTo(-2.5);
    expect(value!.bones[2]!.resourceRefs).toEqual(['armmesh', 'armextra']);
    expect(value!.bones.map((b) => b.fileOrder)).toEqual([0, 1, 2]);
  });

  it('topologyHash: gleiche Topologie gleich, andere Topologie verschieden', () => {
    const a = parseHrc(composeHrc(spec), 'a').value!;
    const b = parseHrc(composeHrc({ ...spec, skeletonName: 'anders' }), 'b').value!;
    const c = parseHrc(
      composeHrc({
        skeletonName: 'flach',
        bones: spec.bones.map((bone) => ({ ...bone, parent: 'root' })),
      }),
      'c',
    ).value!;
    expect(a.topologyHash).toBe(b.topologyHash);
    expect(a.topologyHash).not.toBe(c.topologyHash);
  });

  it('E-HRC-GRAMMAR bei Müll, E-HRC-CYCLE bei Vorwärts-Parent', () => {
    const garbage = parseHrc(new TextEncoder().encode('kein hrc'), 'g');
    expect(garbage.value).toBeNull();
    expect(garbage.diagnostics.map((d) => d.code)).toContain('E-HRC-GRAMMAR');

    const cyclic = parseHrc(
      composeHrc({
        skeletonName: 'zyklus',
        bones: [
          { name: 'a', parent: 'b', length: 1 },
          { name: 'b', parent: 'root', length: 1 },
        ],
      }),
      'c',
    );
    expect(cyclic.value).toBeNull();
    expect(cyclic.diagnostics.map((d) => d.code)).toContain('E-HRC-CYCLE');
  });
});

describe('.rsd', () => {
  it('Roundtrip inkl. Alt-Endungs-Mapping (PLY/TIM → Basisnamen)', () => {
    const { value } = parseRsd(composeRsd({ ply: 'aaba', textures: ['aabb', 'aabc'] }), 'fix.rsd');
    expect(value).not.toBeNull();
    expect(value!.meshRef).toBe('aaba');
    expect(value!.textureRefs).toEqual(['aabb', 'aabc']);
  });

  it('E-RSD-KEY bei fehlendem PLY oder lückenhafter Texturliste', () => {
    const noPly = parseRsd(new TextEncoder().encode('@RSD940102\r\nNTEX=0\r\n'), 'r');
    expect(noPly.value).toBeNull();
    expect(noPly.diagnostics.map((d) => d.code)).toContain('E-RSD-KEY');

    const gap = parseRsd(new TextEncoder().encode('@RSD940102\r\nPLY=X.PLY\r\nNTEX=2\r\nTEX[0]=A.TIM\r\n'), 'r');
    expect(gap.value).toBeNull();
    expect(gap.diagnostics.map((d) => d.code)).toContain('E-RSD-KEY');
  });
});

function meshSpec(): PSpec {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [5, 0, 0],
      [6, 0, 0],
      [5, 1, 0],
    ],
    normals: [
      [0, 0, 1],
      [1, 0, 0],
    ],
    texCoords: [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ],
    vertexColors: [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
    ],
    groups: [
      // Untexturierte Gruppe über Vertices 0–2 (relative Indizes).
      { vertexStart: 0, vertexCount: 3, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] },
      // Texturierte Gruppe über Vertices 3–5, TexCoords 0–2.
      {
        vertexStart: 3,
        vertexCount: 3,
        texCoordStart: 0,
        textured: true,
        textureIndex: 1,
        polys: [{ v: [0, 1, 2], n: [1, 1, 1] }],
      },
    ],
  };
}

describe('.p', () => {
  it('Roundtrip + Index-Flattening verlustfrei (jede Ecke trägt exakt ihr Quelltupel)', () => {
    const spec = meshSpec();
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value).not.toBeNull();
    const mesh = value!;
    expect(mesh.submeshes).toHaveLength(2);
    expect(mesh.indices.length).toBe(6);
    expect(mesh.droppedGroups).toBe(0);

    // Verlustfreiheit: Ecke für Ecke gegen die Spezifikation prüfen.
    let corner = 0;
    for (const g of spec.groups) {
      for (const poly of g.polys) {
        for (let k = 0; k < 3; k++) {
          const unified = mesh.indices[corner]!;
          const absV = g.vertexStart + poly.v[k]!;
          expect([
            mesh.positions[unified * 3],
            mesh.positions[unified * 3 + 1],
            mesh.positions[unified * 3 + 2],
          ]).toEqual(spec.vertices[absV]);
          const n = spec.normals[poly.n[k]!]!;
          expect(mesh.normals[unified * 3]).toBeCloseTo(n[0]);
          const c = spec.vertexColors![absV]!;
          expect([
            mesh.colors[unified * 4],
            mesh.colors[unified * 4 + 1],
            mesh.colors[unified * 4 + 2],
            mesh.colors[unified * 4 + 3],
          ]).toEqual([...c]);
          if (g.textured) {
            const uv = spec.texCoords![(g.texCoordStart ?? 0) + poly.v[k]!]!;
            expect(mesh.uvs[unified * 2]).toBeCloseTo(uv[0]);
            expect(mesh.uvs[unified * 2 + 1]).toBeCloseTo(uv[1]);
          }
          corner++;
        }
      }
    }
    // Dedup: gemeinsam genutzte (v,n,uv)-Tupel erzeugen keine Duplikate.
    expect(mesh.positions.length / 3).toBe(6);
  });

  it('Defekte Gruppe degradiert (W-P-GROUP), intakte Gruppe überlebt', () => {
    const spec = meshSpec();
    spec.groups[1]!.vertexStart = 99; // Vertexbereich außerhalb
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value).not.toBeNull();
    expect(value!.droppedGroups).toBe(1);
    expect(value!.submeshes).toHaveLength(1);
    expect(value!.diagnostics.map((d) => d.code)).toContain('W-P-GROUP');
  });

  it('E-P-SIZE bei abgeschnittener Datei', () => {
    const bytes = composeP(meshSpec()).subarray(0, 200);
    const result = parseP(new Uint8Array(bytes), 'fix.p');
    expect(result.value).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('E-P-SIZE');
  });

  it('Renderstate-Block schlägt die Materialklasse — er ist, was die Engine liest', () => {
    // Widersprüchliche Datei: Klasse sagt GOURAUD, der Block sagt FLAT.
    // Im Bestand kommt das nicht vor (der Konverter erzeugt beide aus
    // demselben Materialsatz), aber es trennt die beiden Quellen sauber.
    const spec = meshSpec();
    spec.groups[0]!.materialClass = 1; // G → Klasse sagt Gouraud
    spec.groups[0]!.shadeMode = 1; // Block sagt D3DSHADE_FLAT
    spec.groups[1]!.materialClass = 0; // C → Klasse sagt flach
    spec.groups[1]!.shadeMode = 2; // Block sagt D3DSHADE_GOURAUD
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value!.submeshes.map((s) => s.flatShaded)).toEqual([true, false]);
  });

  it('ohne Renderstate-Block fällt die Schattierung auf die Materialklasse zurück', () => {
    const spec = meshSpec();
    spec.groups[0]!.materialClass = 0; // C
    spec.groups[0]!.shadeMode = 0; // Block bleibt leer
    spec.groups[1]!.materialClass = 4; // H
    spec.groups[1]!.shadeMode = 0;
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value!.submeshes.map((s) => s.flatShaded)).toEqual([true, false]);
  });

  it('Blendmodus des Blocks wird mitgeführt', () => {
    const spec = meshSpec();
    spec.groups[0]!.blendMode = 1;
    spec.groups[1]!.blendMode = 4;
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value!.submeshes.map((s) => s.blendMode)).toEqual([1, 4]);
  });

  it('Materialklasse wird gelesen und trennt FLAT von GOURAUD', () => {
    const spec = meshSpec();
    spec.groups[0]!.materialClass = 1; // G
    spec.groups[1]!.materialClass = 2; // T — im Original D3DSHADE_FLAT
    const { value } = parseP(composeP(spec), 'fix.p');
    expect(value!.submeshes.map((s) => s.materialClass)).toEqual([1, 2]);
    expect(value!.submeshes.map((s) => s.flatShaded)).toEqual([false, true]);
  });

  it('FLAT-Gruppe: Farbe UND Normale aller drei Ecken stammen von Ecke 0', () => {
    const spec = meshSpec();
    // Beide Gruppen flach; jede Ecke hat im Fixture eine andere Farbe, und
    // Gruppe 1 nutzt unterschiedliche Normalenindizes je Ecke.
    spec.groups[0]!.materialClass = 0; // C
    spec.groups[0]!.polys[0]!.n = [0, 1, 0];
    spec.groups[1]!.materialClass = 2; // T
    spec.groups[1]!.polys[0]!.n = [1, 0, 1];

    const { value } = parseP(composeP(spec), 'fix.p');
    const mesh = value!;

    for (const [g, gruppe] of spec.groups.entries()) {
      const sub = mesh.submeshes[g]!;
      const ecke0 = mesh.indices[sub.start]!;
      const erwarteteFarbe = spec.vertexColors![gruppe.vertexStart + gruppe.polys[0]!.v[0]!]!;
      const erwarteteNormale = spec.normals[gruppe.polys[0]!.n[0]!]!;

      for (let k = 0; k < 3; k++) {
        const u = mesh.indices[sub.start + k]!;
        expect([mesh.colors[u * 4], mesh.colors[u * 4 + 1], mesh.colors[u * 4 + 2]]).toEqual([
          erwarteteFarbe[0],
          erwarteteFarbe[1],
          erwarteteFarbe[2],
        ]);
        expect(mesh.normals[u * 3]).toBeCloseTo(erwarteteNormale[0]);
        expect(mesh.normals[u * 3 + 1]).toBeCloseTo(erwarteteNormale[1]);
        expect(mesh.normals[u * 3 + 2]).toBeCloseTo(erwarteteNormale[2]);
      }
      // Die Position bleibt je Ecke echt — nur Schattierungsquelle wird geteilt.
      expect(ecke0).toBe(mesh.indices[sub.start]!);
      const positionen = [0, 1, 2].map((k) => {
        const u = mesh.indices[sub.start + k]!;
        return [mesh.positions[u * 3], mesh.positions[u * 3 + 1], mesh.positions[u * 3 + 2]];
      });
      expect(positionen).toEqual(
        gruppe.polys[0]!.v.map((rel) => spec.vertices[gruppe.vertexStart + rel]!.map((c) => c)),
      );
    }
  });

  it('GOURAUD-Gruppe behält die Ecknormale — Gegenprobe zur FLAT-Einbackung', () => {
    const spec = meshSpec();
    spec.groups[0]!.materialClass = 1;
    spec.groups[0]!.polys[0]!.n = [0, 1, 0];
    const { value } = parseP(composeP(spec), 'fix.p');
    const mesh = value!;
    const sub = mesh.submeshes[0]!;
    const normaleVon = (k: number): number => {
      const u = mesh.indices[sub.start + k]!;
      return mesh.normals[u * 3]!;
    };
    // Normalenindex 1 = (1,0,0), Index 0 = (0,0,1) → x-Komponente trennt sie.
    expect(normaleVon(0)).toBeCloseTo(0);
    expect(normaleVon(1)).toBeCloseTo(1);
    expect(normaleVon(2)).toBeCloseTo(0);
  });
});

describe('.tex', () => {
  it('Roundtrip: Maße, Mehrfachpaletten (BGRA→RGBA), Pixel, Dekodierung', () => {
    const bytes = composeTex({
      width: 4,
      height: 2,
      palettes: [
        [
          [255, 0, 0, 255],
          [0, 255, 0, 255],
        ],
        [
          [0, 0, 255, 255],
          [255, 255, 0, 128],
        ],
      ],
      pixels: [0, 1, 0, 1, 1, 0, 1, 0],
    });
    const { value } = parseTex(bytes, 'fix.tex');
    expect(value).not.toBeNull();
    expect(value!.width).toBe(4);
    expect(value!.height).toBe(2);
    expect(value!.palettes).toHaveLength(2);
    expect([...value!.palettes[0]!.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...value!.palettes[1]!.subarray(4, 8)]).toEqual([255, 255, 0, 128]);
    const rgba0 = texToRgba(value!, 0);
    expect([...rgba0.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    const rgba1 = texToRgba(value!, 1);
    expect([...rgba1.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('E-TEX-SIZE bei inkonsistentem Header', () => {
    const bytes = composeTex({ width: 2, height: 2, palettes: [[[0, 0, 0, 255]]], pixels: [0, 0, 0, 0] });
    const result = parseTex(new Uint8Array(bytes.subarray(0, bytes.length - 2)), 'fix.tex');
    expect(result.value).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('E-TEX-SIZE');
  });
});

describe('.a', () => {
  it('Roundtrip: Wurzelvektoren + Bone-Rotationen je Frame', () => {
    const bytes = composeA({
      frames: [
        { rootRotation: [0, 90, 0], rootTranslation: [1, 2, 3], boneRotations: [[10, 20, 30], [0, -45, 0]] },
        { rootRotation: [0, 0, 0], rootTranslation: [4, 5, 6], boneRotations: [[0, 0, 0], [90, 0, 0]] },
      ],
    });
    const { value } = parseA(bytes, 'fix.a');
    expect(value).not.toBeNull();
    expect(value!.boneCount).toBe(2);
    expect(value!.frames).toHaveLength(2);
    expect(value!.frames[0]!.rootRotation[1]).toBeCloseTo(90);
    expect(value!.frames[0]!.rootTranslation).toEqual([1, 2, 3]);
    expect(value!.frames[0]!.rotations[4]).toBeCloseTo(-45);
    expect(value!.frames[1]!.rotations[3]).toBeCloseTo(90);
  });

  it('E-ANIM-SIZE bei Header/Längen-Mismatch', () => {
    const bytes = composeA({ frames: [{ rootRotation: [0, 0, 0], rootTranslation: [0, 0, 0], boneRotations: [[0, 0, 0]] }] });
    const result = parseA(new Uint8Array(bytes.subarray(0, bytes.length - 4)), 'fix.a');
    expect(result.value).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('E-ANIM-SIZE');
  });

  describe('Rotationsreihenfolge steht im Dateikopf, nicht im Code', () => {
    const frames = [{ rootRotation: [0, 0, 0] as const, rootTranslation: [0, 0, 0] as const, boneRotations: [[0, 0, 0] as const] }];
    const spec = (rotationOrder?: [number, number, number]) =>
      composeA({
        frames: frames.map((f) => ({
          rootRotation: [...f.rootRotation] as [number, number, number],
          rootTranslation: [...f.rootTranslation] as [number, number, number],
          boneRotations: f.boneRotations.map((b) => [...b] as [number, number, number]),
        })),
        ...(rotationOrder ? { rotationOrder } : {}),
      });

    it('liest die Vorgabe YXZ zurück — der real belegte Wert', () => {
      const result = parseA(spec(), 'fix.a');
      expect(result.value!.rotationOrder).toEqual([1, 0, 2]);
      expect(result.diagnostics.map((d) => d.code)).not.toContain('W-ANIM-ROTORDER');
    });

    it('liest eine ABWEICHENDE Reihenfolge zurück, statt sie zu überschreiben', () => {
      // Gegenprobe zur Vorgabe: Läse der Parser die Bytes nicht wirklich,
      // käme hier trotzdem YXZ heraus und der Test bliebe unbemerkt grün.
      const result = parseA(spec([2, 1, 0]), 'fix.a');
      expect(result.value!.rotationOrder).toEqual([2, 1, 0]);
      expect(result.diagnostics.map((d) => d.code)).not.toContain('W-ANIM-ROTORDER');
    });

    it('W-ANIM-ROTORDER, wenn das Tripel keine Permutation ist', () => {
      const result = parseA(spec([1, 1, 2]), 'fix.a');
      expect(result.diagnostics.map((d) => d.code)).toContain('W-ANIM-ROTORDER');
      // Kein Raten: Rückfall auf die einzige real belegte Reihenfolge.
      expect(result.value!.rotationOrder).toEqual([1, 0, 2]);
    });
  });
});
