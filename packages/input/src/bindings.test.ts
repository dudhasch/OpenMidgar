import { describe, expect, it } from 'vitest';
import { defaultBindings, parseBindings, serializeBindings } from './bindings.js';
import { toMenuInput } from './menu-adapter.js';
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

  it('reservierte Plätze existieren nach dem Zurücklesen und bleiben null; world und battle sind belegt', () => {
    const parsed = parseBindings(serializeBindings(defaultBindings()));
    expect(parsed.table!.minigame).toBeNull();
    expect(parsed.table!.world).not.toBeNull();
    expect(parsed.table!.battle).not.toBeNull();
  });

  it('battle-Kontext ist analog zu field/menu belegt (Navigation, ok, cancel, menu)', () => {
    const battle = defaultBindings().battle!;
    expect(battle.keyboard['ArrowUp']).toBe('up');
    expect(battle.keyboard['ArrowDown']).toBe('down');
    expect(battle.keyboard['ArrowLeft']).toBe('left');
    expect(battle.keyboard['ArrowRight']).toBe('right');
    expect(battle.keyboard['Enter']).toBe('ok');
    expect(battle.keyboard['Escape']).toBe('cancel');
    expect(battle.keyboard['KeyM']).toBe('menu');
    expect(battle.gamepadButtons[0]).toBe('ok');
    expect(battle.gamepadButtons[1]).toBe('cancel');
    expect(battle.touch['btn-ok']).toBe('ok');
    // Eine persistierte Datei mit battle: null bleibt null — die Wahl des
    // Nutzers (bzw. der Altbestand) wird nicht still überschrieben.
    const table = defaultBindings();
    table.battle = null;
    const parsed = parseBindings(serializeBindings(table));
    expect(parsed.ok).toBe(true);
    expect(parsed.table!.battle).toBeNull();
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

describe('toMenuInput: Aktionsrahmen → menüartige Eingabeform (Battle-Kommandowahl)', () => {
  it('bildet den abgetasteten battle-Kontext auf die strukturelle Menüform ab', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb], 'battle');
    kb.handleKey('ArrowDown', true);
    kb.handleKey('Enter', true);
    const frame = sampler.sampleTick();
    expect(toMenuInput(frame)).toEqual({
      up: false,
      down: true,
      left: false,
      right: false,
      confirm: true,
      cancel: false,
      toggle: false,
    });
  });

  it('reicht Pegel durch (Flanken bildet die Sitzung selbst) und liest menu als toggle', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb], 'battle');
    kb.handleKey('KeyM', true);
    expect(toMenuInput(sampler.sampleTick()).toggle).toBe(true);
    // Taste bleibt gehalten: der Pegel bleibt an — KEINE Flankenlogik im Adapter.
    expect(toMenuInput(sampler.sampleTick()).toggle).toBe(true);
    kb.handleKey('KeyM', false);
    kb.handleKey('Escape', true);
    const frame = sampler.sampleTick();
    expect(toMenuInput(frame)).toMatchObject({ toggle: false, cancel: true });
  });
});
