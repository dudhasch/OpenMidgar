import { now, type Telemetry } from './telemetry.js';

/**
 * Event-Loop-Lag-Probe: misst, wie stark Timer-Ticks hinter ihrem Soll
 * herlaufen. Drift über der Schwelle == der Thread war blockiert == Long Task.
 * Läuft identisch in Browser und Node (im Browser ergänzt observeLongTasks
 * die präzisere PerformanceObserver-Quelle).
 */

export interface LagProbeOptions {
  intervalMs?: number;
  thresholdMs?: number;
}

export function startLagProbe(telemetry: Telemetry, opts: LagProbeOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 25;
  const thresholdMs = opts.thresholdMs ?? 50;
  let stopped = false;
  let expected = now() + intervalMs;

  const tick = (): void => {
    if (stopped) return;
    const drift = now() - expected;
    if (drift > thresholdMs) telemetry.recordLongTask(drift);
    expected = now() + intervalMs;
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
  };
}

/** Browser-Pfad: echte Long-Task-Einträge des PerformanceObserver. */
export function observeLongTasks(telemetry: Telemetry): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) telemetry.recordLongTask(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    return () => observer.disconnect();
  } catch {
    return () => {}; // 'longtask' nicht unterstützt — Lag-Probe bleibt die Quelle
  }
}
