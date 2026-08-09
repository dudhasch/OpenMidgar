import { describe, expect, it } from 'vitest';
import { Telemetry } from './telemetry.js';
import { startLagProbe } from './lag-probe.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Telemetry', () => {
  it('aggregiert Zähler und Latenzen', () => {
    const t = new Telemetry();
    t.count('x');
    t.count('x', 2);
    const stop = t.time('op');
    stop();
    t.recordLatency('op', 10);
    const snap = t.snapshot();
    expect(snap.counters['x']).toBe(3);
    expect(snap.latencies['op']!.count).toBe(2);
    expect(snap.latencies['op']!.maxMs).toBeGreaterThanOrEqual(10);
  });
});

describe('Lag-Probe (Long-Task-Messung)', () => {
  it('Steady State mit asynchroner Last: 0 Long Tasks; Blockade wird erkannt', async () => {
    const t = new Telemetry();
    const stop = startLagProbe(t, { intervalMs: 10, thresholdMs: 50 });

    // Steady State: 30 asynchrone Operationen, keine davon blockiert.
    for (let i = 0; i < 30; i++) await sleep(1);
    expect(t.longTaskCount).toBe(0); // NFR-Akzeptanzkriterium S3

    // Positivkontrolle: bewusste 120-ms-Blockade muss die Probe auslösen —
    // sonst wäre die 0 oben nicht aussagekräftig.
    const until = Date.now() + 120;
    while (Date.now() < until) {
      /* Event-Loop blockieren */
    }
    await sleep(30); // Probe-Tick nachlaufen lassen
    stop();
    expect(t.longTaskCount).toBeGreaterThanOrEqual(1);
    expect(t.snapshot().longTasks.maxMs).toBeGreaterThanOrEqual(50);
  });
});
