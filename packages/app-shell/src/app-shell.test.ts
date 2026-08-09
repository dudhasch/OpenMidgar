import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsExport,
  checkCapabilities,
  importHint,
  importTransition,
  isAssetFree,
  missingCapabilities,
  type CapabilityId,
  type CapabilityProbe,
  type CapabilityResult,
  type DiagnosticEntry,
  type ImportEvent,
  type ImportState,
  INITIAL_IMPORT_STATE,
} from './index.js';

/** Attrappe: standardmäßig sind alle Fähigkeiten vorhanden. */
function allOkProbe(): CapabilityProbe {
  return {
    webgl2: () => true,
    fileAccess: () => true,
    indexedDb: () => true,
    moduleWorker: () => true,
    compression: () => true,
  };
}

const CAPABILITY_IDS: CapabilityId[] = ['webgl2', 'fileAccess', 'indexedDb', 'moduleWorker', 'compression'];

function okResults(): CapabilityResult[] {
  return checkCapabilities(allOkProbe());
}

describe('checkCapabilities / missingCapabilities', () => {
  it('meldet bei jedem Durchlauf genau die eine fehlende Fähigkeit mit spezifischer Meldung', () => {
    const messages = new Set<string>();
    for (const missingId of CAPABILITY_IDS) {
      const probe = allOkProbe();
      probe[missingId] = () => false;
      const results = checkCapabilities(probe);
      const missing = missingCapabilities(results);
      expect(missing).toHaveLength(1);
      expect(missing[0]!.id).toBe(missingId);
      expect(missing[0]!.message.length).toBeGreaterThan(0);
      messages.add(missing[0]!.message);
    }
    // Jede Fähigkeit hat eine eigene, unterscheidbare Meldung.
    expect(messages.size).toBe(CAPABILITY_IDS.length);
  });

  it('behandelt eine werfende Prüfung als fehlende Fähigkeit, ohne selbst zu werfen', () => {
    const probe = allOkProbe();
    probe.moduleWorker = () => {
      throw new Error('Worker-Konstruktor nicht verfügbar');
    };
    let results: CapabilityResult[] = [];
    expect(() => {
      results = checkCapabilities(probe);
    }).not.toThrow();
    const entry = results.find((r) => r.id === 'moduleWorker');
    expect(entry?.available).toBe(false);
  });
});

describe('importTransition — glücklicher Pfad', () => {
  it('durchläuft start → awaiting-directory → scanning → ready', () => {
    let state: ImportState = INITIAL_IMPORT_STATE;
    expect(state).toEqual({ kind: 'start' });

    state = importTransition(state, { kind: 'capabilities', results: okResults() });
    expect(state).toEqual({ kind: 'awaiting-directory' });

    state = importTransition(state, { kind: 'directory-chosen', handleId: 'handle-1' });
    expect(state).toEqual({ kind: 'scanning', handleId: 'handle-1', fromCache: false });

    state = importTransition(state, { kind: 'scan-done', sourceFingerprint: 'fp-xyz', archives: 12 });
    expect(state).toEqual({
      kind: 'ready',
      handleId: 'handle-1',
      sourceFingerprint: 'fp-xyz',
      archives: 12,
    });
  });
});

describe('importTransition — unsupported ist eine Sackgasse', () => {
  it('landet bei fehlender Fähigkeit in unsupported und bleibt dort außer bei reset', () => {
    const results = okResults();
    const idx = results.findIndex((r) => r.id === 'webgl2');
    results[idx] = { ...results[idx]!, available: false };

    const state = importTransition({ kind: 'start' }, { kind: 'capabilities', results });
    expect(state.kind).toBe('unsupported');

    const events: ImportEvent[] = [
      { kind: 'directory-chosen', handleId: 'h' },
      { kind: 'permission', granted: true },
      { kind: 'scan-done', sourceFingerprint: 'f', archives: 1 },
      { kind: 'stored-handle', handleId: 'h' },
    ];
    for (const event of events) {
      expect(importTransition(state, event)).toEqual(state);
    }
  });
});

describe('importTransition — Re-Grant-Pfad', () => {
  it('fragt bei gespeichertem Handle die Berechtigung erneut ab', () => {
    const awaitingDirectory: ImportState = { kind: 'awaiting-directory' };
    const awaitingRegrant = importTransition(awaitingDirectory, {
      kind: 'stored-handle',
      handleId: 'handle-42',
    });
    expect(awaitingRegrant).toEqual({ kind: 'awaiting-regrant', handleId: 'handle-42' });

    const granted = importTransition(awaitingRegrant, { kind: 'permission', granted: true });
    expect(granted).toEqual({ kind: 'scanning', handleId: 'handle-42', fromCache: true });
  });

  it('führt bei verweigerter Berechtigung zurück zur Verzeichniswahl, der Handle bleibt aber erhalten', () => {
    const awaitingRegrant: ImportState = { kind: 'awaiting-regrant', handleId: 'handle-42' };
    const denied = importTransition(awaitingRegrant, { kind: 'permission', granted: false });
    expect(denied).toEqual({ kind: 'awaiting-directory' });

    // Der Handle selbst lebt außerhalb der Maschine (Persistenzschicht) weiter:
    // ein erneutes stored-handle-Ereignis mit derselben ID führt wieder zu
    // awaiting-regrant, statt dass die ID verlorenginge.
    const again = importTransition(denied, { kind: 'stored-handle', handleId: 'handle-42' });
    expect(again).toEqual({ kind: 'awaiting-regrant', handleId: 'handle-42' });
  });
});

describe('importTransition — stored-handle mit null', () => {
  it('lässt awaiting-directory unverändert', () => {
    const state: ImportState = { kind: 'awaiting-directory' };
    const next = importTransition(state, { kind: 'stored-handle', handleId: null });
    expect(next).toEqual(state);
  });
});

describe('importTransition — Fehler und Neustart', () => {
  const sampleStates: ImportState[] = [
    { kind: 'start' },
    { kind: 'awaiting-directory' },
    { kind: 'awaiting-regrant', handleId: 'h' },
    { kind: 'scanning', handleId: 'h', fromCache: false },
    { kind: 'ready', handleId: 'h', sourceFingerprint: 'f', archives: 3 },
    { kind: 'unsupported', missing: [{ id: 'webgl2', available: false, message: 'fehlt' }] },
    { kind: 'failed', reason: 'vorher', retryable: false },
  ];

  it('führt aus jedem Zustand über error nach failed mit retryable', () => {
    for (const state of sampleStates) {
      const failed = importTransition(state, { kind: 'error', reason: 'kaputt', retryable: false });
      expect(failed).toEqual({ kind: 'failed', reason: 'kaputt', retryable: false });
    }
  });

  it('setzt retryable standardmäßig auf true, wenn es im Ereignis fehlt', () => {
    const failed = importTransition({ kind: 'start' }, { kind: 'error', reason: 'kaputt' });
    expect(failed).toEqual({ kind: 'failed', reason: 'kaputt', retryable: true });
  });

  it('führt reset aus jedem Zustand immer zurück nach start', () => {
    for (const state of sampleStates) {
      expect(importTransition(state, { kind: 'reset' })).toEqual({ kind: 'start' });
    }
  });
});

describe('importTransition — unbekannte Kombinationen ändern nichts', () => {
  it('verschluckt sinnlose Zustand/Ereignis-Paare', () => {
    const cases: Array<[ImportState, ImportEvent]> = [
      [{ kind: 'scanning', handleId: 'h', fromCache: false }, { kind: 'stored-handle', handleId: 'h' }],
      [{ kind: 'ready', handleId: 'h', sourceFingerprint: 'f', archives: 1 }, { kind: 'permission', granted: true }],
      [{ kind: 'awaiting-directory' }, { kind: 'scan-done', sourceFingerprint: 'f', archives: 1 }],
      [{ kind: 'awaiting-regrant', handleId: 'h' }, { kind: 'scan-started', fromCache: true }],
    ];
    for (const [state, event] of cases) {
      expect(importTransition(state, event)).toEqual(state);
    }
  });
});

describe('importHint', () => {
  it('liefert für jeden Zustandstyp eine nichtleere Zeichenkette', () => {
    const missing: CapabilityResult[] = [
      { id: 'webgl2', available: false, message: 'WebGL2 fehlt komplett.' },
      { id: 'compression', available: false, message: 'DecompressionStream fehlt komplett.' },
    ];
    const states: ImportState[] = [
      { kind: 'start' },
      { kind: 'unsupported', missing },
      { kind: 'awaiting-directory' },
      { kind: 'awaiting-regrant', handleId: 'h' },
      { kind: 'scanning', handleId: 'h', fromCache: false },
      { kind: 'scanning', handleId: 'h', fromCache: true },
      { kind: 'ready', handleId: 'h', sourceFingerprint: 'f', archives: 3 },
      { kind: 'failed', reason: 'r', retryable: true },
      { kind: 'failed', reason: 'r', retryable: false },
    ];
    for (const state of states) {
      expect(importHint(state).length).toBeGreaterThan(0);
    }
  });

  it('nennt in unsupported die Meldung jeder fehlenden Fähigkeit', () => {
    const missing: CapabilityResult[] = [
      { id: 'webgl2', available: false, message: 'WebGL2 fehlt komplett.' },
      { id: 'compression', available: false, message: 'DecompressionStream fehlt komplett.' },
    ];
    const hint = importHint({ kind: 'unsupported', missing });
    for (const m of missing) {
      expect(hint).toContain(m.message);
    }
  });
});

describe('buildDiagnosticsExport / isAssetFree', () => {
  const entries: DiagnosticEntry[] = [
    {
      code: 'E-ASSET-MISSING',
      severity: 'error',
      asset: 'md1stin',
      detail: 'Datei md1stin fehlt im Archiv flevel.lgp',
    },
    {
      code: 'E-ASSET-MISSING',
      severity: 'error',
      asset: 'char/aaaa.hrc',
      detail: 'Cloud-Modell char/aaaa.hrc ist beschädigt',
    },
    {
      code: 'W-ASSET-CRC',
      severity: 'warn',
      asset: 'md1stin',
      section: 2,
      detail: 'CRC von md1stin weicht ab',
    },
  ];

  it('ist assetfrei — keine Assetnamen oder Freitexte im serialisierten Export', () => {
    const exportResult = buildDiagnosticsExport(entries, 'deadbeefcafe1234');
    expect(isAssetFree(exportResult)).toEqual({ ok: true });

    const json = JSON.stringify(exportResult);
    expect(json).not.toContain('md1stin');
    expect(json).not.toContain('char/aaaa.hrc');
    expect(json).not.toContain('aaaa.hrc');
    expect(json).not.toContain('flevel');
    expect(json).not.toContain('Cloud-Modell');
    expect(json).not.toContain('beschädigt');
  });

  it('isAssetFree erkennt absichtlich eingeschmuggelten Freitext mit Pfadangabe', () => {
    const smuggled = {
      schemaVersion: 1,
      sourceFingerprint: 'deadbeefcafe1234',
      counts: { 'E-ASSET-MISSING': 1 },
      samples: { 'E-ASSET-MISSING': ['md1stin'] },
      totals: { entries: 1, assets: 1 },
    };
    const result = isAssetFree(smuggled);
    expect(result.ok).toBe(false);
    expect(result.offender).toContain('$.samples.E-ASSET-MISSING[0]');
    expect(result.offender).toContain('md1stin');
  });

  it('begrenzt samples je Klasse auf sampleLimit, zählt totals.assets aber vollständig', () => {
    const manyEntries: DiagnosticEntry[] = Array.from({ length: 8 }, (_, i) => ({
      code: 'E-BULK',
      severity: 'error',
      asset: `bulk-asset-${i}`,
    }));
    const exportResult = buildDiagnosticsExport(manyEntries, 'abcdef1234567890', 3);
    expect(exportResult.samples['E-BULK']).toHaveLength(3);
    expect(exportResult.totals.assets).toBe(8);
    expect(exportResult.totals.entries).toBe(8);
    expect(isAssetFree(exportResult)).toEqual({ ok: true });
  });
});
