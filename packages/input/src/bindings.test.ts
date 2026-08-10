import { describe, expect, it } from 'vitest';
import { defaultBindings, parseBindings, serializeBindings } from './bindings.js';
import { KeyboardFeed } from './sources.js';
import { InputSampler } from './sampler.js';

describe('Belegungstabellen als Daten', () => {
  it('Roundtrip: serialisieren und zurücklesen ist verlustfrei', () => {
    const table = defaultBindings();
    table.field!.keyboard['KeyQ'] = 'pageUp';
    const parsed = parseBindings(serializeBindings(table));
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.table).toEqual(table);
  });

  it('reservierte Plätze existieren nach dem Zurücklesen und bleiben null; world ist seit S29 belegt', () => {
    const parsed = parseBindings(serializeBindings(defaultBindings()));
    expect(parsed.table!.battle).toBeNull();
    expect(parsed.table!.minigame).toBeNull();
    expect(parsed.table!.world).not.toBeNull();
  });

  it('verwirft defekte Einträge mit benannter Diagnose statt abzustürzen', () => {
    const raw = JSON.parse(serializeBindings(defaultBindings())) as {
      contexts: Record<string, { keyboard: Record<string, string> }>;
    };
    raw.contexts['field']!.keyboard['KeyX'] = 'explode'; // keine Aktion
    (raw.contexts as Record<string, unknown>)['racing'] = raw.contexts['field']; // kein Kontext
    const parsed = parseBindings(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    expect(parsed.table!.field!.keyboard['KeyX']).toBeUndefined();
    expect(parsed.diagnostics.some((d) => d.includes('W-INP-ACTION'))).toBe(true);
    expect(parsed.diagnostics.some((d) => d.includes('W-INP-CONTEXT'))).toBe(true);
  });

  it('lehnt kaputtes JSON und fremde Schemaversionen als Fehler ab', () => {
    expect(parseBindings('{no').ok).toBe(false);
    expect(parseBindings(JSON.stringify({ schemaVersion: 99, contexts: {} })).ok).toBe(false);
  });

  it('Belegungsänderung wirkt sofort auf die nächste Abtastung', () => {
    const table = defaultBindings();
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(table, [kb]);
    kb.handleKey('KeyL', true);
    expect(sampler.sampleTick().held).toEqual([]); // KeyL ist unbelegt
    table.field!.keyboard['KeyL'] = 'right';
    expect(sampler.sampleTick().held).toEqual(['right']); // ab dem nächsten Tick belegt
  });
});
