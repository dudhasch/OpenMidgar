import { describe, expect, it } from 'vitest';
import { composeScriptSection, type AkaoBlockSpec } from '@webmidgar/fixture-gen';
import { parseScriptSection } from './script.js';
import { parseAkaoBlock, resolveFieldMusic } from './akao.js';
import type { FieldDiagnostic } from '../diagnostics.js';

/**
 * F09-B — die MUSIC-Kette am ersten Glied.
 *
 * Geprüft wird nicht „der Parser läuft durch", sondern jede der drei belegten
 * Blocksorten einzeln: gültiges Magic, abgeschnittenes Magic (Originaldefekt,
 * Makou §4.2) und ein Tutorial-Block am Ziel eines MUSIC-Operanden. Jede
 * Abweichung muss eine BENANNTE Diagnose erzeugen — geraten wird nichts.
 */

const script = (akao: AkaoBlockSpec[]): Uint8Array =>
  composeScriptSection({
    entities: [{ name: 'hero', entryPoints: [0] }],
    scriptBytes: new Uint8Array(16).fill(0x90),
    strings: [new TextEncoder().encode('hi')],
    akao,
  });

function parse(akao: AkaoBlockSpec[]): {
  set: NonNullable<ReturnType<typeof parseScriptSection>>;
  bytes: Uint8Array;
  diagnostics: FieldDiagnostic[];
} {
  const bytes = script(akao);
  const diagnostics: FieldDiagnostic[] = [];
  const set = parseScriptSection(bytes, 'fix1', diagnostics);
  expect(set).not.toBeNull();
  return { set: set!, bytes, diagnostics };
}

const codes = (d: FieldDiagnostic[]): string[] => d.map((x) => x.code);

describe('AKAO-Offsettabelle in Sektion 1', () => {
  it('liest nAkao u32-Offsets und hebt sie in FieldScriptSet — Schemaversion 2', () => {
    const { set } = parse([
      { kind: 'akao', musicId: 42 },
      { kind: 'akao', musicId: 7 },
      { kind: 'tutorial' },
    ]);
    expect(set.schemaVersion).toBe(2);
    expect(set.akaoOffsets).toHaveLength(3);
    // Streng monoton: die Blöcke liegen hintereinander hinter der Stringtabelle.
    expect(set.akaoOffsets[0]).toBeLessThan(set.akaoOffsets[1]!);
    expect(set.akaoOffsets[1]).toBeLessThan(set.akaoOffsets[2]!);
    // Die Tabelle darf die Entry-Tabelle nicht überlappen: alle Offsets liegen
    // hinter dem Bytecodebeginn.
    for (const off of set.akaoOffsets) expect(off).toBeGreaterThan(set.stringTableOffset);
  });

  it('gültiger AKAO-Block: Magic erkannt, musicId aus u16 bei +4, keine Diagnose', () => {
    const { set, bytes, diagnostics } = parse([{ kind: 'akao', musicId: 84 }]);
    expect(diagnostics).toHaveLength(0);
    const block = parseAkaoBlock(bytes, set.akaoOffsets[0]!);
    expect(block.kind).toBe('akao');
    expect(block.missingMagicBytes).toBe(0);
    expect(block.musicId).toBe(84);
    expect(set.akaoBlocks[0]).toEqual(block);
  });

  it.each([1, 2] as const)(
    'abgeschnittenes Magic (%i fehlende Byte) ⇒ W-FLD-AKAOMAG, ID um denselben Betrag verschoben gelesen',
    (missing) => {
      const { set, bytes, diagnostics } = parse([{ kind: 'akao-truncated', missing, musicId: 33 }]);
      expect(codes(diagnostics)).toEqual(['W-FLD-AKAOMAG']);
      expect(diagnostics[0]!.severity).toBe('warning');
      expect(diagnostics[0]!.section).toBe(1);
      expect(diagnostics[0]!.detail).toContain(missing === 1 ? 'KAO' : 'AO');

      const block = parseAkaoBlock(bytes, set.akaoOffsets[0]!);
      expect(block.kind).toBe('akao-truncated');
      expect(block.missingMagicBytes).toBe(missing);
      expect(block.musicId).toBe(33);

      // Kontrolle: würde man stur bei +4 lesen (also den Defekt ignorieren),
      // käme etwas anderes heraus — der Versatz ist also wirksam und nicht
      // zufällig richtig.
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint16(set.akaoOffsets[0]! + 4, true)).not.toBe(33);
    },
  );

  it('Tutorial-Block ist normaler Inhalt und erzeugt beim Parsen KEINE Diagnose', () => {
    const { set, bytes, diagnostics } = parse([{ kind: 'tutorial' }]);
    expect(diagnostics).toHaveLength(0);
    const block = parseAkaoBlock(bytes, set.akaoOffsets[0]!);
    expect(block.kind).toBe('tutorial');
    expect(block.musicId).toBeNull();
  });

  it('Block ohne Magic und mit ungültigem Tutorial-Opcode ⇒ W-FLD-AKAOUNK', () => {
    const { diagnostics } = parse([{ kind: 'unknown', firstByte: 0x7b }]);
    expect(codes(diagnostics)).toEqual(['W-FLD-AKAOUNK']);
    expect(diagnostics[0]!.detail).toContain('0x7b');
  });

  it('Offset außerhalb der Sektion ⇒ E-FLD-AKAOOFF (Fehler, nicht Warnung)', () => {
    const { diagnostics } = parse([{ kind: 'dangling-offset' }]);
    expect(codes(diagnostics)).toEqual(['E-FLD-AKAOOFF']);
    expect(diagnostics[0]!.severity).toBe('error');
  });
});

describe('MUSIC-Kette: Operand → akaoOffsets[v] → AKAO-Kopf → musicId', () => {
  it('löst den field-lokalen Operanden auf und liefert den 0-basierten music.idx-Index', () => {
    const { set, bytes } = parse([
      { kind: 'akao', musicId: 5 },
      { kind: 'akao', musicId: 91 },
    ]);
    const d: FieldDiagnostic[] = [];
    expect(resolveFieldMusic(set.akaoOffsets, bytes, 1, 'fix1', d)).toMatchObject({
      musicId: 91,
      musicIndex: 90,
      reason: 'ok',
    });
    expect(d).toHaveLength(0);
  });

  it('Operand ≥ nAkao ⇒ E-FLD-AKAOOFF, kein geratener Titel', () => {
    const { set, bytes } = parse([{ kind: 'akao', musicId: 5 }]);
    const d: FieldDiagnostic[] = [];
    const res = resolveFieldMusic(set.akaoOffsets, bytes, 3, 'fix1', d);
    expect(res.musicId).toBeNull();
    expect(res.reason).toBe('operand-out-of-range');
    expect(codes(d)).toEqual(['E-FLD-AKAOOFF']);
  });

  it('Operand zeigt auf einen Tutorial-Block ⇒ W-FLD-AKAOTUT statt Fehlklang', () => {
    const { set, bytes } = parse([{ kind: 'tutorial' }]);
    const d: FieldDiagnostic[] = [];
    const res = resolveFieldMusic(set.akaoOffsets, bytes, 0, 'fix1', d);
    expect(res.musicId).toBeNull();
    expect(res.reason).toBe('tutorial-block');
    expect(codes(d)).toEqual(['W-FLD-AKAOTUT']);
  });

  it('abgeschnittenes Magic bleibt auflösbar und meldet es trotzdem', () => {
    const { set, bytes } = parse([{ kind: 'akao-truncated', missing: 2, musicId: 12 }]);
    const d: FieldDiagnostic[] = [];
    const res = resolveFieldMusic(set.akaoOffsets, bytes, 0, 'fix1', d);
    expect(res).toMatchObject({ musicId: 12, musicIndex: 11, reason: 'ok-truncated-magic' });
    expect(codes(d)).toEqual(['W-FLD-AKAOMAG']);
  });
});
