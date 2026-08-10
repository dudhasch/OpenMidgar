import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { composeA, composeHrc, composeP, composeRsd, composeTex } from '@webmidgar/fixture-gen';
import type { FieldModelEntry } from '@webmidgar/formats-field';
import { createActorLibrary, type ActorLibraryOptions } from './field-actor.js';

/**
 * Field-Actor-Library: In-Memory-`readEntry` mit selbstgebauten Fixture-Bytes
 * (Writer aus fixture-gen, codegetrennt von den Parsern — Dualitätsprinzip).
 * Geprüft werden Auflösekette, Skalierungshypothese, deterministische
 * Animationsschaltung und die Cache-Teilung der Quellobjekte.
 */

const DEG = Math.PI / 180;

/** Fixture-Bestand wie in char.lgp: hrc → rsd → p/tex, dazu zwei .a-Clips. */
function fixtureFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set(
    'test.hrc',
    composeHrc({
      skeletonName: 'kette',
      bones: [
        { name: 'hip', parent: 'root', length: 2 },
        { name: 'chest', parent: 'hip', length: 3, resources: ['segm'] },
        { name: 'arm', parent: 'chest', length: 1 },
      ],
    }),
  );
  files.set('segm.rsd', composeRsd({ ply: 'segm', textures: ['glow'] }));
  files.set(
    'segm.p',
    composeP({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      normals: [[0, 0, 1]],
      texCoords: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      groups: [
        {
          vertexStart: 0,
          vertexCount: 3,
          polys: [{ v: [0, 1, 2], n: [0, 0, 0] }],
          textured: true,
          textureIndex: 0,
          texCoordStart: 0,
        },
      ],
    }),
  );
  files.set(
    'glow.tex',
    composeTex({
      width: 2,
      height: 2,
      palettes: [[[0, 0, 0, 0], [200, 40, 40, 255]]],
      pixels: [0, 1, 0, 0],
    }),
  );
  // Drei Frames mit je eindeutiger hip-Rotation: 10° → 20° → 30°.
  files.set(
    'walk.a',
    composeA({
      frames: [10, 20, 30].map((x) => ({
        rootRotation: [0, 0, 0] as [number, number, number],
        rootTranslation: [0, 0, 0] as [number, number, number],
        boneRotations: [
          [x, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ] as [number, number, number][],
      })),
    }),
  );
  return files;
}

function modelEntry(scale: number | null, animations: { name: string; file: string }[] = [
  { name: 'walk.abc', file: 'walk.a' },
]): FieldModelEntry {
  return {
    name: 'fixture model entry',
    modelFile: 'test.hrc',
    scale,
    fileFieldRaw: new Uint8Array(12),
    unknownAfterName: 0,
    blockRaw: new Uint8Array(30),
    animations: animations.map((a) => ({ ...a, tag: 'abc', tail: 1 })),
  };
}

function makeLibrary(options?: ActorLibraryOptions): {
  library: ReturnType<typeof createActorLibrary>;
  reads: string[];
} {
  const files = fixtureFiles();
  const reads: string[] = [];
  const library = createActorLibrary(async (name) => {
    reads.push(name);
    return files.get(name) ?? null;
  }, options);
  return { library, reads };
}

function firstMesh(root: THREE.Group): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  if (!found) throw new Error('Handle trägt kein Mesh');
  return found;
}

describe('createActorLibrary — Auflösekette', () => {
  it('load liefert Handle mit korrekter Bone-Zahl, Mesh und Animationszähler', async () => {
    const { library } = makeLibrary();
    const handle = await library.load(modelEntry(512), 512);
    expect(handle).not.toBeNull();
    expect(handle!.skeleton.bones.length).toBe(3);
    expect(handle!.actor.boneGroups).toHaveLength(3);
    expect(handle!.animationCount).toBe(1);
    // Das Segment hängt am chest-Bone (Index 1) — Auflösekette hrc→rsd→p/tex.
    const meshes = handle!.actor.boneGroups[1]!.children.filter((c) => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1);
    const materials = (meshes[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[];
    expect(materials[0]!.map).not.toBeNull(); // Textur aufgelöst, kein Platzhalter
    library.dispose();
  });

  it('fehlendes .hrc → null (kein Wurf)', async () => {
    const { library } = makeLibrary();
    const entry = { ...modelEntry(512), modelFile: 'fehlt.hrc' };
    await expect(library.load(entry, 512)).resolves.toBeNull();
    library.dispose();
  });
});

describe('createActorLibrary — Skalierung (🟡 Hypothese model-over-512)', () => {
  it('512 → 1.0 und 1024 → 2.0 auf root.scale', async () => {
    const { library } = makeLibrary();
    const normal = await library.load(modelEntry(512), 512);
    const gross = await library.load(modelEntry(1024), 512);
    expect(normal!.actor.root.scale.x).toBeCloseTo(1, 6);
    expect(gross!.actor.root.scale.x).toBeCloseTo(2, 6);
    expect(gross!.actor.root.scale.y).toBeCloseTo(2, 6);
    library.dispose();
  });

  it('scale null → neutrale 1.0; scaleMode none/model-over-global übersteuern', async () => {
    const { library } = makeLibrary();
    const ohne = await library.load(modelEntry(null), 512);
    expect(ohne!.actor.root.scale.x).toBeCloseTo(1, 6);
    library.dispose();

    const { library: keine } = makeLibrary({ scaleMode: 'none' });
    const roh = await keine.load(modelEntry(1024), 512);
    expect(roh!.actor.root.scale.x).toBeCloseTo(1, 6);
    keine.dispose();

    const { library: global } = makeLibrary({ scaleMode: 'model-over-global' });
    const halb = await global.load(modelEntry(512), 1024);
    expect(halb!.actor.root.scale.x).toBeCloseTo(0.5, 6);
    global.dispose();
  });
});

describe('createActorLibrary — Animationsschaltung', () => {
  it('setAnimation + advanceTick schaltet deterministisch (speed 1, Loop)', async () => {
    const { library } = makeLibrary();
    const handle = (await library.load(modelEntry(512), 512))!;

    // Vor setAnimation: Bindpose (alle Bone-Rotationen 0).
    handle.advanceTick();
    expect(handle.actor.boneGroups[0]!.rotation.x).toBeCloseTo(0, 6);

    handle.setAnimation(0, 1, true);
    await handle.whenAnimationSettled();
    const hipX = (): number => handle.actor.boneGroups[0]!.rotation.x;
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(10 * DEG, 6); // Frame 0
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(20 * DEG, 6); // Frame 1
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(30 * DEG, 6); // Frame 2
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(10 * DEG, 6); // Loop → Frame 0
    library.dispose();
  });

  it('speed 2 hält jeden Frame zwei Takte; loop=false bleibt am Ende stehen', async () => {
    const { library } = makeLibrary();
    const handle = (await library.load(modelEntry(512), 512))!;
    const hipX = (): number => handle.actor.boneGroups[0]!.rotation.x;

    handle.setAnimation(0, 2, true);
    await handle.whenAnimationSettled();
    handle.advanceTick();
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(10 * DEG, 6); // Frame 0, zweiter Takt
    handle.advanceTick();
    expect(hipX()).toBeCloseTo(20 * DEG, 6); // Frame 1

    handle.setAnimation(0, 1, false);
    await handle.whenAnimationSettled();
    for (let i = 0; i < 5; i++) handle.advanceTick();
    expect(hipX()).toBeCloseTo(30 * DEG, 6); // klemmt am letzten Frame
    library.dispose();
  });

  it('fehlende oder unbekannte Animation → Bindpose, keine Exception', async () => {
    const { library } = makeLibrary();
    const entry = modelEntry(512, [{ name: 'fehlt.abc', file: 'fehlt.a' }]);
    const handle = (await library.load(entry, 512))!;

    handle.setAnimation(0, 1, true); // Datei fehlt im Bestand
    await handle.whenAnimationSettled();
    handle.advanceTick();
    expect(handle.actor.boneGroups[0]!.rotation.x).toBeCloseTo(0, 6);

    handle.setAnimation(7, 1, true); // Index außerhalb der Manifest-Liste
    await handle.whenAnimationSettled();
    handle.advanceTick();
    expect(handle.actor.boneGroups[0]!.rotation.x).toBeCloseTo(0, 6);
    library.dispose();
  });
});

describe('createActorLibrary — Cache & Freigabe', () => {
  it('zweites load liest nichts nach und teilt die Quellobjekte', async () => {
    const { library, reads } = makeLibrary();
    const erst = (await library.load(modelEntry(512), 512))!;
    const readsAfterFirst = reads.length;
    expect(readsAfterFirst).toBeGreaterThan(0);

    const zweit = (await library.load(modelEntry(1024), 512))!;
    expect(reads.length).toBe(readsAfterFirst); // alles aus dem Cache

    // Geteilte Quellen: beide Geometrien wickeln DENSELBEN Positions-Array
    // der gecachten MeshSource — eigene Three-Instanzen, gemeinsame Daten.
    const posErst = firstMesh(erst.actor.root).geometry.getAttribute('position') as THREE.BufferAttribute;
    const posZweit = firstMesh(zweit.actor.root).geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(posErst.array).toBe(posZweit.array);
    expect(firstMesh(erst.actor.root)).not.toBe(firstMesh(zweit.actor.root));

    // Auch die Animationsbindung wird geteilt: einmal geladen, kein Re-Read.
    erst.setAnimation(0, 1, true);
    await erst.whenAnimationSettled();
    const readsAfterAnim = reads.length;
    zweit.setAnimation(0, 1, true);
    await zweit.whenAnimationSettled();
    expect(reads.length).toBe(readsAfterAnim);
    library.dispose();
  });

  it('release gibt die Three-Ressourcen des Handles frei; dispose räumt alles', async () => {
    const { library } = makeLibrary();
    const handle = (await library.load(modelEntry(512), 512))!;
    const geometry = firstMesh(handle.actor.root).geometry;
    const disposeSpy = vi.spyOn(geometry, 'dispose');
    handle.release();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    handle.release(); // idempotent
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    const rest = (await library.load(modelEntry(512), 512))!;
    const restSpy = vi.spyOn(firstMesh(rest.actor.root).geometry, 'dispose');
    library.dispose();
    expect(restSpy).toHaveBeenCalledTimes(1);
    await expect(library.load(modelEntry(512), 512)).resolves.toBeNull(); // nach dispose gesperrt
  });
});
