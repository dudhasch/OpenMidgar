import { describe, expect, it } from 'vitest';
import {
  composeCameraSection,
  composeCompressedField,
  composeFieldContainer,
  composeScriptSection,
  composeTriggersSection,
  composeWalkmeshSection,
  corruptSectionCount,
  corruptSectionLength,
  corruptSectionPointer,
  type FieldContainerSpec,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, parseFieldEntry } from './container.js';
import { SECTION, type Vec3 } from './nam.js';

const ascii = (s: string) => new TextEncoder().encode(s);

/** Quad (2 Dreiecke) + angesetzte Steigung — geteilte Kanten für Adjazenz. */
const walkmeshSpec = (): WalkmeshSpec => ({
  triangles: [
    { vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]] },
    { vertices: [[100, 0, 0], [100, 100, 0], [0, 100, 0]] },
    { vertices: [[100, 0, 0], [200, 0, 50], [100, 100, 0]] },
  ],
});

const cos30 = Math.cos(Math.PI / 6);
const sin30 = Math.sin(Math.PI / 6);

function fullFieldSpec(): FieldContainerSpec {
  return {
    sections: {
      [SECTION.SCRIPT]: composeScriptSection({
        entities: [
          { name: 'hero', entryPoints: [0, 8] },
          { name: 'door', entryPoints: [16] },
        ],
        scriptBytes: new Uint8Array(32).fill(0x90),
        strings: [ascii('hello'), ascii('world!')],
      }),
      [SECTION.CAMERA]: composeCameraSection([
        { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], position: [0, 0, -4096], zoom: 400 },
        {
          axes: [[cos30, 0, sin30], [0, 1, 0], [-sin30, 0, cos30]],
          position: [1000, -2000, 3000],
          zoom: 512,
        },
      ]),
      [SECTION.WALKMESH]: composeWalkmeshSection(walkmeshSpec()),
      [SECTION.TRIGGERS]: composeTriggersSection({
        name: 'fixture',
        control: 1,
        cameraFocusHeight: -50,
        cameraRange: [-160, -120, 160, 120],
        gateways: [
          { exit: [40, 60], dest: [10, 20], destMaplistIndex: 123 },
        ],
        triggers: [{ corners: [[10, 10, 0], [20, 20, 10]], bgGroup: 2, bgFrame: 1, behavior: 3, soundId: 4 }],
      }),
    },
  };
}

describe('Field-Container: Golden Roundtrip', () => {
  it('parst alle vier S2-Sektionen verlustfrei aus dem Fixture', () => {
    const result = parseFieldContainer(composeFieldContainer(fullFieldSpec()).bytes, 'fixture');
    expect(result.ok).toBe(true);
    const b = result.bundle!;
    expect(b.quarantinedSections).toEqual([]);
    expect(b.enterable).toBe(true);
    expect(result.diagnostics).toEqual([]);

    // Walkmesh: Vertices + automatisch berechnete, symmetrische Adjazenz.
    const wm = b.walkmesh!;
    expect(wm.triangleCount).toBe(3);
    expect(wm.triangles[0]!.vertices).toEqual(walkmeshSpec().triangles[0]!.vertices);
    expect(wm.triangles[0]!.adjacency).toContain(1);
    expect(wm.triangles[1]!.adjacency).toContain(0);
    expect(wm.triangles[1]!.adjacency).toContain(2);
    expect(wm.triangles[2]!.adjacency).toContain(1);

    // Kamera: Festkomma-Rohwerte exakt, Orthonormalität erkannt.
    const cams = b.cameras!.cameras;
    expect(cams).toHaveLength(2);
    expect(cams[0]!.axesRaw).toEqual([[4096, 0, 0], [0, 4096, 0], [0, 0, 4096]]);
    expect(cams[0]!.positionRaw).toEqual([0, 0, -4096]);
    expect(cams[0]!.zoom).toBe(400);
    expect(cams[0]!.orthonormal).toBe(true);
    expect(cams[1]!.zoom).toBe(512);
    expect(cams[1]!.orthonormal).toBe(true);
    expect(cams[1]!.axesRaw[0]![0]).toBe(Math.round(cos30 * 4096));

    // Trigger: belegter Gateway-Slot; ungenutzte sind genullt.
    const trg = b.triggers!;
    expect(trg.name).toBe('fixture');
    expect(trg.cameraRange).toEqual([-160, -120, 160, 120]);
    expect(trg.gateways[0]!.used).toBe(true);
    expect(trg.gateways[0]!.destMaplistIndex).toBe(123);
    expect(trg.gateways[0]!.exitPoint).toEqual([40, 60]);
    expect(trg.gateways[0]!.destPoint).toEqual([10, 20]);
    expect(trg.gateways.filter((g) => g.used)).toHaveLength(1);
    expect(trg.triggers[0]!.behavior).toBe(3);

    // Script: Spans aus Entry-Points, Stringindex vollständig.
    const scr = b.script!;
    expect(scr.entities.map((e) => e.name)).toEqual(['hero', 'door']);
    expect(scr.spans).toHaveLength(3);
    expect(scr.spans[0]).toEqual({ start: scr.dataStart, end: scr.dataStart + 8 });
    expect(scr.spans[2]).toEqual({ start: scr.dataStart + 16, end: scr.stringTableOffset });
    expect(scr.stringOffsets).toHaveLength(2);
    expect(scr.stringOffsets.every((o) => o !== null)).toBe(true);
  });

  it('kompletter Eintragspfad: LZS-Rahmen → Container → Bundle', () => {
    const result = parseFieldEntry(composeCompressedField(fullFieldSpec()), 'fixture');
    expect(result.ok).toBe(true);
    expect(result.bundle!.enterable).toBe(true);
    expect(result.bundle!.walkmesh!.triangleCount).toBe(3);
  });

  it('E-LZS-STREAM im Eintragspfad → ok:false mit typisierter Diagnose', () => {
    const entry = composeCompressedField(fullFieldSpec());
    new DataView(entry.buffer).setUint32(0, entry.length + 999, true);
    const result = parseFieldEntry(entry, 'fixture');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('E-LZS-STREAM');
  });
});

describe('Field-Container: sektionsweise Degradierung', () => {
  it('defekte Walkmesh-Sektion → E-FLD-SEC5, Bundle nutzbar, nicht betretbar', () => {
    const layout = composeFieldContainer(fullFieldSpec());
    const result = parseFieldContainer(corruptSectionLength(layout, SECTION.WALKMESH, 0xffffff), 'fixture');
    expect(result.ok).toBe(true);
    const b = result.bundle!;
    expect(b.quarantinedSections).toContain(SECTION.WALKMESH);
    expect(b.walkmesh).toBeUndefined();
    expect(b.enterable).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('E-FLD-SEC5');
    // Übrige Sektionen unbeeinträchtigt:
    expect(b.cameras!.cameras).toHaveLength(2);
    expect(b.script!.entities).toHaveLength(2);
    expect(b.triggers!.name).toBe('fixture');
  });

  it('Zeiger außerhalb → nur diese Sektion quarantänisiert', () => {
    const layout = composeFieldContainer(fullFieldSpec());
    const result = parseFieldContainer(corruptSectionPointer(layout, SECTION.CAMERA, 0xfffffff), 'fixture');
    const b = result.bundle!;
    expect(b.quarantinedSections).toEqual([SECTION.CAMERA]);
    expect(b.cameras).toBeUndefined();
    expect(b.walkmesh).toBeDefined();
    expect(result.diagnostics.map((d) => d.code)).toContain('E-FLD-SEC2');
  });

  it('E-FLD-HDR (fatal): Sektionsanzahl 0 bzw. absurd', async () => {
    const layout = composeFieldContainer(fullFieldSpec());
    for (const count of [0, 100000]) {
      const result = parseFieldContainer(corruptSectionCount(layout, count), 'fixture');
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]!.code).toBe('E-FLD-HDR');
    }
  });
});

describe('Walkmesh-Validierung', () => {
  const container = (wm: Uint8Array): Uint8Array =>
    composeFieldContainer({ sections: { [SECTION.WALKMESH]: wm } }).bytes;

  it('W-WM-ASYM: fehlender Rückverweis wird gemeldet, Daten bleiben nutzbar', () => {
    const spec = walkmeshSpec();
    spec.triangles[0]!.adjacencyOverride = [null, 1, null];
    spec.triangles[1]!.adjacencyOverride = [null, null, null]; // kein Rückverweis
    spec.triangles[2]!.adjacencyOverride = [null, null, null];
    const result = parseFieldContainer(container(composeWalkmeshSection(spec)), 'f');
    expect(result.diagnostics.map((d) => d.code)).toContain('W-WM-ASYM');
    expect(result.bundle!.walkmesh!.triangles[0]!.adjacency).toEqual([null, 1, null]);
  });

  it('E-WM-ADJ: Nachbarindex außerhalb → als gesperrt behandelt', () => {
    const spec = walkmeshSpec();
    spec.triangles[0]!.adjacencyOverride = [77, null, null];
    spec.triangles[1]!.adjacencyOverride = [null, null, null];
    spec.triangles[2]!.adjacencyOverride = [null, null, null];
    const result = parseFieldContainer(container(composeWalkmeshSection(spec)), 'f');
    expect(result.diagnostics.map((d) => d.code)).toContain('E-WM-ADJ');
    expect(result.bundle!.walkmesh!.triangles[0]!.adjacency).toEqual([null, null, null]);
  });

  it('W-WM-DEGEN: kollabiertes Dreieck wird markiert', () => {
    const spec: WalkmeshSpec = {
      triangles: [{ vertices: [[5, 5, 5], [5, 5, 5], [5, 5, 5]] as [Vec3, Vec3, Vec3] }],
    };
    const result = parseFieldContainer(container(composeWalkmeshSection(spec)), 'f');
    expect(result.diagnostics.map((d) => d.code)).toContain('W-WM-DEGEN');
    expect(result.bundle!.walkmesh!.triangles[0]!.degenerate).toBe(true);
  });

  it('E-WM-COUNT: Zähler passt nicht zur Länge → Sektion quarantänisiert', () => {
    const wm = composeWalkmeshSection(walkmeshSpec());
    new DataView(wm.buffer).setUint32(0, 999, true);
    const result = parseFieldContainer(container(wm), 'f');
    expect(result.diagnostics.map((d) => d.code)).toContain('E-WM-COUNT');
    expect(result.bundle!.walkmesh).toBeUndefined();
    expect(result.bundle!.enterable).toBe(false);
  });
});

describe('Kamera-/Script-Validierung', () => {
  it('W-CAM-ORTHO: schiefe Achsenmatrix wird erkannt', () => {
    const cam = composeCameraSection([
      { axes: [[1, 0, 0], [1, 0, 0], [0, 0, 1]], position: [0, 0, 0], zoom: 400 },
    ]);
    const result = parseFieldContainer(
      composeFieldContainer({ sections: { [SECTION.CAMERA]: cam } }).bytes,
      'f',
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('W-CAM-ORTHO');
    expect(result.bundle!.cameras!.cameras[0]!.orthonormal).toBe(false);
  });

  it('E-CAM-SIZE: krumme Sektionslänge → Sektion quarantänisiert', () => {
    const cam = composeCameraSection([
      { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], position: [0, 0, 0], zoom: 400 },
    ]).subarray(0, 37);
    const result = parseFieldContainer(
      composeFieldContainer({ sections: { [SECTION.CAMERA]: new Uint8Array(cam) } }).bytes,
      'f',
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('E-CAM-SIZE');
    expect(result.bundle!.cameras).toBeUndefined();
  });

  it('E-SCR-SPAN: Entry-Point außerhalb des Script-Bereichs → Slot null, Rest intakt', () => {
    const scr = composeScriptSection({
      entities: [{ name: 'hero', entryPoints: [0, 9999] }],
      scriptBytes: new Uint8Array(16),
    });
    const result = parseFieldContainer(
      composeFieldContainer({ sections: { [SECTION.SCRIPT]: scr } }).bytes,
      'f',
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('E-SCR-SPAN');
    const entity = result.bundle!.script!.entities[0]!;
    expect(entity.entryPoints[0]).not.toBeNull();
    expect(entity.entryPoints[1]).toBeNull();
  });
});

describe('Field-Container: Fuzzing', () => {
  it('300 mutierte Container werfen nie — nur Diagnosen', () => {
    let a = 0x51d2e;
    const rnd = (): number => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pristine = composeFieldContainer(fullFieldSpec()).bytes;
    for (let iter = 0; iter < 300; iter++) {
      const mutated = pristine.slice();
      const mutations = 1 + Math.floor(rnd() * 12);
      for (let m = 0; m < mutations; m++) {
        mutated[Math.floor(rnd() * mutated.length)] = Math.floor(rnd() * 256);
      }
      // Darf nie werfen — Rückgabewert (ok oder Diagnosen) ist immer definiert.
      const result = parseFieldContainer(mutated, `fuzz-${iter}`);
      expect(typeof result.ok).toBe('boolean');
    }
  });
});
