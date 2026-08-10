import { describe, expect, it } from 'vitest';
import { DEFAULT_HISTORY_BYTE_BUDGET, History, type HistoryStep } from './history.js';

function mkStep(log: string[], tag: string, bytes: number): HistoryStep {
  return {
    name: tag,
    bytes,
    undo: () => {
      log.push(`u:${tag}`);
    },
    redo: () => {
      log.push(`r:${tag}`);
    },
  };
}

describe('History: Byte-Budget', () => {
  it('hat ein Default-Budget von ~2 MB', () => {
    expect(DEFAULT_HISTORY_BYTE_BUDGET).toBe(2 * 1024 * 1024);
  });

  it('kürzt älteste Einträge komplett bei Budgetüberschreitung', () => {
    const log: string[] = [];
    const h = new History({ byteBudget: 100 });
    h.push(mkStep(log, 'a', 60));
    expect(h.length).toBe(1);
    expect(h.bytes).toBe(60);

    h.push(mkStep(log, 'b', 60)); // 120 > 100 → 'a' fällt komplett weg
    expect(h.length).toBe(1);
    expect(h.bytes).toBe(60);

    h.push(mkStep(log, 'c', 40)); // 60+40 = 100 → passt
    expect(h.length).toBe(2);
    expect(h.bytes).toBe(100);

    h.undo(); // c
    h.undo(); // b
    expect(h.undo()).toBeNull(); // 'a' ist längst gekürzt
    expect(log).toEqual(['u:c', 'u:b']);
  });

  it('eine Geste bleibt atomar — auch wenn sie allein das Budget reißt', () => {
    const log: string[] = [];
    const h = new History({ byteBudget: 100 });
    h.push(mkStep(log, 'alt', 90));
    h.beginGesture('drag');
    h.push(mkStep(log, 'g1', 40));
    h.push(mkStep(log, 'g2', 40));
    h.push(mkStep(log, 'g3', 40));
    expect(h.length).toBe(1); // offene Geste noch nicht committet
    h.endGesture(); // Geste = 120 Bytes, über Budget: 'alt' fällt weg, Geste bleibt ganz
    expect(h.length).toBe(1);
    expect(h.bytes).toBe(120);
    expect(h.logEntries[0]!.steps).toHaveLength(3);

    h.undo();
    expect(log).toEqual(['u:g3', 'u:g2', 'u:g1']); // strikt umgekehrte Reihenfolge
    h.redo();
    expect(log).toEqual(['u:g3', 'u:g2', 'u:g1', 'r:g1', 'r:g2', 'r:g3']);
  });
});

describe('History: Gesten-Disziplin', () => {
  it('verbietet verschachtelte Gesten und endGesture ohne begin', () => {
    const h = new History();
    expect(() => h.endGesture()).toThrow(/ohne offene Geste/);
    h.beginGesture('a');
    expect(() => h.beginGesture('b')).toThrow(/Verschachtelte/);
    h.endGesture();
    expect(h.length).toBe(0); // leere Geste erzeugt keinen Eintrag
  });

  it('verbietet undo/redo bei offener Geste', () => {
    const log: string[] = [];
    const h = new History();
    h.push(mkStep(log, 'x', 1));
    h.beginGesture();
    expect(() => h.undo()).toThrow(/Offene Geste/);
    expect(() => h.redo()).toThrow(/Offene Geste/);
    h.endGesture();
  });

  it('leert den Redo-Stack bei neuem Command', () => {
    const log: string[] = [];
    const h = new History();
    h.push(mkStep(log, 'a', 1));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(mkStep(log, 'b', 1));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
  });
});
