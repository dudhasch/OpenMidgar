import { describe, expect, it } from 'vitest';
import { composeMaplist } from '@webmidgar/fixture-gen';
import { parseMaplist, resolveMaplistTarget } from './maplist.js';
import type { FieldDiagnostic } from './diagnostics.js';

/**
 * S11: `maplist` — Namenstabelle für die Auflösung von Gateway-Zielen.
 * Roundtrip über zwei unabhängige Implementierungen.
 */

const diag = (): FieldDiagnostic[] => [];

describe('maplist', () => {
  it('Roundtrip: Zähler, Namen, Auffüllung und Kleinschreibung', () => {
    const d = diag();
    const list = parseMaplist(composeMaplist(['MD1STIN', 'md1_1', '', 'nmkin_1']), 'maplist', d)!;
    expect(list).not.toBeNull();
    expect(d).toEqual([]);
    expect(list.names).toEqual(['md1stin', 'md1_1', '', 'nmkin_1']);
  });

  it('Auflösung liefert null für leere Slots und Indizes außerhalb', () => {
    const list = parseMaplist(composeMaplist(['erstes', '', 'drittes']), 'maplist', diag())!;
    expect(resolveMaplistTarget(list, 0)).toBe('erstes');
    // Leerer Slot ist kein Fehler, sondern eine Sackgasse.
    expect(resolveMaplistTarget(list, 1)).toBeNull();
    expect(resolveMaplistTarget(list, 2)).toBe('drittes');
    expect(resolveMaplistTarget(list, 3)).toBeNull();
    expect(resolveMaplistTarget(list, -1)).toBeNull();
  });

  it('E-MAPLIST-SIZE, wenn Zähler und Länge nicht zusammenpassen', () => {
    const bytes = composeMaplist(['a', 'b']);
    const d1 = diag();
    expect(parseMaplist(bytes.subarray(0, bytes.length - 4), 'maplist', d1)).toBeNull();
    expect(d1.map((x) => x.code)).toContain('E-MAPLIST-SIZE');

    const d2 = diag();
    expect(parseMaplist(new Uint8Array(1), 'maplist', d2)).toBeNull();
    expect(d2.map((x) => x.code)).toContain('E-MAPLIST-SIZE');
  });

  it('leere Liste ist gültig', () => {
    const d = diag();
    const list = parseMaplist(composeMaplist([]), 'maplist', d)!;
    expect(list.names).toEqual([]);
    expect(d).toEqual([]);
  });
});
