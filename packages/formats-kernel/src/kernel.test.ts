import { describe, expect, it } from 'vitest';
import { composeKernelContainer, composeTextSection } from '@webmidgar/fixture-gen';
import { parseKernelContainer } from './container.js';
import {
  DEFAULT_ASCII_OFFSET,
  buildAsciiTable,
  decodeFfText,
  decodeStringTable,
  germanLikeness,
} from './text.js';

/** S13: Kernel-Container und Textdekoder — Roundtrips über zwei Implementierungen. */

describe('Kernel-Container: Kopfauslegung u16-triple', () => {
  it('Roundtrip: drei Sektionen, Layout erkannt, Daten byteidentisch, keine Diagnosen', async () => {
    const sec0 = new Uint8Array([1, 2, 3, 4, 5]);
    const sec1 = new Uint8Array([9, 8, 7]);
    const sec2 = Uint8Array.from({ length: 64 }, (_, i) => (i * 3 + 1) & 0xff);

    const bytes = await composeKernelContainer(
      [{ data: sec0 }, { data: sec1 }, { data: sec2 }],
      'u16-triple',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container).not.toBeNull();
    expect(container.layout).toBe('u16-triple');
    expect(container.sections).toHaveLength(3);
    expect(container.diagnostics).toEqual([]);
    expect(container.sections.every((s) => s.ok)).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect([...container.sections[1]!.data]).toEqual([...sec1]);
    expect([...container.sections[2]!.data]).toEqual([...sec2]);
  });
});

describe('Kernel-Container: Kopfauslegung u32-len', () => {
  it('Roundtrip: drei Sektionen, Layout selbst erkannt, Daten byteidentisch, keine Diagnosen', async () => {
    // sec1 muss inkompressibel und > 64 KiB entpackt sein: erst dann trägt der
    // gzip-Strom mehr als 0xFFFF komprimierte Bytes, und die u16-triple-Lesart
    // (die nur die unteren 16 Bit des u32-Feldes sähe) läuft nicht mehr
    // byteexakt aus. Bei kleineren Sektionen sind beide Kopfauslegungen
    // bitidentisch interpretierbar — echte Mehrdeutigkeit, kein Kopf-Bug.
    let seed = 0x9e3779b9;
    const prng = () => {
      seed = (seed ^ (seed << 13)) >>> 0;
      seed = (seed ^ (seed >>> 17)) >>> 0;
      seed = (seed ^ (seed << 5)) >>> 0;
      return seed;
    };
    const sec0 = new Uint8Array([11, 22, 33]);
    const sec1 = Uint8Array.from({ length: 80_000 }, () => prng() & 0xff);
    const sec2 = new Uint8Array([255, 0, 128, 64]);

    const bytes = await composeKernelContainer(
      [{ data: sec0 }, { data: sec1 }, { data: sec2 }],
      'u32-len',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container).not.toBeNull();
    expect(container.layout).toBe('u32-len');
    expect(container.sections).toHaveLength(3);
    expect(container.diagnostics).toEqual([]);
    expect(container.sections.every((s) => s.ok)).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect([...container.sections[1]!.data]).toEqual([...sec1]);
    expect([...container.sections[2]!.data]).toEqual([...sec2]);
  });
});

describe('Kernel-Container: Kopf-/Strom-Defekte', () => {
  it('E-KRN-GZIP bei falscher entpackter Länge im Kopf — Nutzdaten kommen trotzdem korrekt an', async () => {
    const sec0 = new Uint8Array([4, 5, 6, 7]);
    const bytes = await composeKernelContainer(
      [{ data: sec0, declaredLengthOverride: 999 }],
      'u16-triple',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toHaveLength(1);
    expect(container.sections[0]!.ok).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-GZIP');
  });

  it('defekter gzip-Strom quarantänisiert nur die betroffene Sektion, die übrigen bleiben nutzbar', async () => {
    const secA = new Uint8Array([1, 2, 3]);
    const secB = Uint8Array.from({ length: 80 }, (_, i) => (i * 7 + 1) & 0xff);
    const secC = new Uint8Array([9, 8, 7]);

    const bytes = await composeKernelContainer(
      [{ data: secA }, { data: secB }, { data: secC }],
      'u16-triple',
    );

    // Sektion 1 (secB) mitten im gzip-Strom verfälschen — nicht die ersten
    // beiden Bytes (gzip-Magic), sonst würde schon das Accounting scheitern.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const comp0 = view.getUint16(0, true);
    const sec1HeaderOffset = 6 + comp0;
    const comp1 = view.getUint16(sec1HeaderOffset, true);
    const sec1DataOffset = sec1HeaderOffset + 6;
    const corruptAt = sec1DataOffset + Math.floor(comp1 * 0.6);
    bytes[corruptAt] = bytes[corruptAt]! ^ 0xff;

    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toHaveLength(3);
    expect(container.sections[0]!.ok).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...secA]);
    expect(container.sections[1]!.ok).toBe(false);
    expect(container.sections[1]!.data).toHaveLength(0);
    expect(container.sections[2]!.ok).toBe(true);
    expect([...container.sections[2]!.data]).toEqual([...secC]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-SEC1');
  });

  it('kein gültiges Layout → leere Sektionsliste mit E-KRN-ACCOUNT, kein Wurf', async () => {
    const bytes = new Uint8Array(32).fill(0xaa);
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toEqual([]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-ACCOUNT');
  });
});

describe('Textdekoder', () => {
  it('Roundtrip: mehrere Zeichenketten kommen exakt zurück, keine unbekannten Bytes', () => {
    const strings = ['hallo welt', 'system test', 'dritte zeile'];
    const bytes = composeTextSection(strings, DEFAULT_ASCII_OFFSET);
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET);

    const decoded = decodeStringTable(bytes, table, 0, strings.length);

    expect(decoded).toHaveLength(3);
    decoded.forEach((d, i) => {
      expect(d.text).toBe(strings[i]);
      expect(d.unknownBytes).toBe(0);
      expect(d.terminated).toBe(true);
    });
  });

  it('falscher Versatz erzeugt Unsinn — germanLikeness des richtigen Textes ist deutlich höher', () => {
    // Selbst erfundener Beispielsatz, kein Originaltext aus dem Spiel.
    const satz = 'der kleine drache fliegt schnell ueber den fluss';
    const bytes = composeTextSection([satz], DEFAULT_ASCII_OFFSET);

    const correctTable = buildAsciiTable(DEFAULT_ASCII_OFFSET);
    const wrongTable = buildAsciiTable(DEFAULT_ASCII_OFFSET + 1);

    const correct = decodeStringTable(bytes, correctTable, 0, 1)[0]!;
    const wrong = decodeStringTable(bytes, wrongTable, 0, 1)[0]!;

    expect(correct.text).toBe(satz);
    expect(wrong.text).not.toBe(satz);
    expect(germanLikeness(correct.text)).toBeGreaterThan(0.3);
    expect(germanLikeness(correct.text)).toBeGreaterThan(germanLikeness(wrong.text) + 0.15);
  });

  it('Steuercodes und unbekannte Bytes werden gezählt, das Ersatzzeichen steht im Text', () => {
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET);
    const bytes = new Uint8Array([
      'A'.charCodeAt(0) - DEFAULT_ASCII_OFFSET, // 'A' im linearen ASCII-Fenster
      0xfe,
      0x00, // Steuercode (0xFE) mit einem Folgebyte
      0xc5, // Byte außerhalb aller Fenster — unbekannt
      0xff, // Terminator
    ]);

    const decoded = decodeFfText(bytes, table);

    expect(decoded.controlCount).toBe(1);
    expect(decoded.unknownBytes).toBe(1);
    expect(decoded.terminated).toBe(true);
    expect(decoded.text).toBe('A�');
  });
});
