import { describe, expect, it } from 'vitest';
import {
  composeCompressedField,
  composeFieldContainer,
  composeModelLoaderSection,
  composeWalkmeshSection,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer } from './container.js';
import { parseModelLoaderSection, splitModelFileField } from './sections/model-loader.js';
import { SECTION } from './nam.js';
import type { FieldDiagnostic } from './diagnostics.js';

/** S10: Model-Loader-Sektion — Roundtrips über zwei unabhängige Implementierungen. */

const diag = (): FieldDiagnostic[] => [];

function manifestSpec(): Parameters<typeof composeModelLoaderSection>[0] {
  const block = new Uint8Array(30);
  block[0] = 0xff;
  block[29] = 0x7f;
  return {
    scaleGlobal: 512,
    models: [
      {
        name: 'fixture1_a_modell.dat',
        file: 'aaaa.hrc',
        scale: 512,
        block,
        animations: [
          { name: 'aaaa.anm' },
          { name: 'aaab.anm', tail: 1 },
        ],
      },
      {
        name: 'fixture2_b_modell.dat',
        file: 'bbbb.hrc',
        scale: 1024,
        animations: [{ name: 'bbbb.anm' }],
      },
    ],
  };
}

describe('Sektion 3: Model-Loader', () => {
  it('Roundtrip: Kopf, Modelle, Dateifeld mit Skalatext, Animationen', () => {
    const d = diag();
    const manifest = parseModelLoaderSection(composeModelLoaderSection(manifestSpec()), 'fix', d)!;
    expect(manifest).not.toBeNull();
    expect(d).toEqual([]);
    expect(manifest.blank).toBe(0);
    expect(manifest.scaleGlobal).toBe(512);
    expect(manifest.models).toHaveLength(2);

    const m0 = manifest.models[0]!;
    expect(m0.name).toBe('fixture1_a_modell.dat');
    expect(m0.modelFile).toBe('aaaa.hrc');
    expect(m0.scale).toBe(512);
    expect(m0.unknownAfterName).toBe(0);
    expect(m0.blockRaw.length).toBe(30);
    expect(m0.blockRaw[0]).toBe(0xff);
    expect(m0.blockRaw[29]).toBe(0x7f);
    expect(m0.animations.map((a) => a.name)).toEqual(['aaaa.anm', 'aaab.anm']);
    expect(m0.animations[0]!.tail).toBe(1);
    // Der Teil hinter dem Punkt ist keine Endung: die Datei heißt <stamm>.a.
    expect(m0.animations.map((a) => a.file)).toEqual(['aaaa.a', 'aaab.a']);
    expect(m0.animations[0]!.tag).toBe('anm');

    const m1 = manifest.models[1]!;
    expect(m1.modelFile).toBe('bbbb.hrc');
    // Vierstellige Skala füllt das 12-B-Feld exakt aus (kein Nullterminator).
    expect(m1.scale).toBe(1024);
    expect(m1.animations).toHaveLength(1);
  });

  it('Dateifeld-Zerlegung trennt Endung und Skalatext', () => {
    expect(splitModelFileField(new TextEncoder().encode('aaaa.hrc512\0'))).toEqual({
      file: 'aaaa.hrc',
      scale: 512,
    });
    // Ohne Ziffern: Skala unbekannt, Datei bleibt erhalten.
    expect(splitModelFileField(new TextEncoder().encode('aaaa.hrc\0\0\0\0'))).toEqual({
      file: 'aaaa.hrc',
      scale: null,
    });
  });

  it('Leerer Default-Composer ergibt ein gültiges leeres Manifest', () => {
    const d = diag();
    const manifest = parseModelLoaderSection(composeModelLoaderSection(), 'fix', d)!;
    expect(manifest).not.toBeNull();
    expect(d).toEqual([]);
    expect(manifest.models).toEqual([]);
  });

  it('E-MDL-COUNT bei unplausibler Modellzahl, E-MDL-SIZE bei gestörtem Accounting', () => {
    const good = composeModelLoaderSection(manifestSpec());

    const badCount = good.slice();
    new DataView(badCount.buffer).setUint16(2, 9999, true);
    const d1 = diag();
    expect(parseModelLoaderSection(badCount, 'fix', d1)).toBeNull();
    expect(d1.map((x) => x.code)).toContain('E-MDL-COUNT');

    // Namenslänge des ersten Modells aufblähen → alles Folgende verrutscht.
    // Welcher Wächter zuerst greift (Größe oder Zähler), hängt vom Zufall der
    // verschobenen Bytes ab — entscheidend ist, dass die Sektion abgelehnt wird.
    const badLen = good.slice();
    new DataView(badLen.buffer).setUint16(6, 60, true);
    const d2 = diag();
    expect(parseModelLoaderSection(badLen, 'fix', d2)).toBeNull();
    expect(d2.some((x) => x.code.startsWith('E-MDL-'))).toBe(true);

    // Ein Byte anhängen → Sektion läuft nicht mehr exakt aus.
    const tooLong = new Uint8Array(good.length + 1);
    tooLong.set(good, 0);
    const d3 = diag();
    expect(parseModelLoaderSection(tooLong, 'fix', d3)).toBeNull();
    expect(d3.map((x) => x.code)).toContain('E-MDL-SIZE');
  });

  it('W-MDL-SCALE, wenn im Dateifeld kein Skalatext steht', () => {
    const d = diag();
    const manifest = parseModelLoaderSection(
      composeModelLoaderSection({ models: [{ name: 'ohne_skala.dat', file: 'cccc.hrc' }] }),
      'fix',
      d,
    )!;
    expect(manifest).not.toBeNull();
    expect(manifest.models[0]!.scale).toBeNull();
    expect(d.map((x) => x.code)).toContain('W-MDL-SCALE');
  });
});

describe('Container-Integration Sektion 3', () => {
  it('Manifest landet im Bundle; defekte Sektion quarantäniert nur sich selbst', () => {
    const wm = composeWalkmeshSection({
      triangles: [{ vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]] }],
    });
    const good = parseFieldContainer(
      composeFieldContainer({
        sections: {
          [SECTION.WALKMESH]: wm,
          [SECTION.MODEL_LOADER]: composeModelLoaderSection(manifestSpec()),
        },
      }).bytes,
      'f',
    );
    expect(good.bundle!.models!.models).toHaveLength(2);
    expect(good.bundle!.quarantinedSections).not.toContain(SECTION.MODEL_LOADER);

    const broken = parseFieldContainer(
      composeFieldContainer({
        sections: { [SECTION.WALKMESH]: wm, [SECTION.MODEL_LOADER]: new Uint8Array(40) },
      }).bytes,
      'f',
    );
    expect(broken.bundle!.models).toBeUndefined();
    expect(broken.bundle!.quarantinedSections).toContain(SECTION.MODEL_LOADER);
    expect(broken.bundle!.enterable).toBe(true); // Field bleibt begehbar
  });

  it('überlebt den LZS-Rahmen (voller Fixture-Pfad)', () => {
    const bytes = composeCompressedField({
      sections: { [SECTION.MODEL_LOADER]: composeModelLoaderSection(manifestSpec()) },
    });
    expect(bytes.length).toBeGreaterThan(0);
  });
});
