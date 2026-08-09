/**
 * NFR-Instrumentierung (Masterplan Phase 2.4): Zähler, Latenzen, Long Tasks.
 * Bewusst abhängigkeitsfrei und allokationsarm — Telemetrie darf selbst nie
 * zur Last werden.
 */

export interface LatencyStat {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface TelemetrySnapshot {
  counters: Record<string, number>;
  latencies: Record<string, LatencyStat & { avgMs: number }>;
  longTasks: LatencyStat;
}

export class Telemetry {
  private counters = new Map<string, number>();
  private latencies = new Map<string, LatencyStat>();
  private longTasks: LatencyStat = { count: 0, totalMs: 0, maxMs: 0 };

  count(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  counterOf(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  recordLatency(name: string, ms: number): void {
    const stat = this.latencies.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    this.latencies.set(name, stat);
  }

  /** Startet eine Messung; die zurückgegebene Funktion beendet sie. */
  time(name: string): () => number {
    const t0 = now();
    return () => {
      const ms = now() - t0;
      this.recordLatency(name, ms);
      return ms;
    };
  }

  recordLongTask(ms: number): void {
    this.longTasks.count++;
    this.longTasks.totalMs += ms;
    this.longTasks.maxMs = Math.max(this.longTasks.maxMs, ms);
  }

  get longTaskCount(): number {
    return this.longTasks.count;
  }

  snapshot(): TelemetrySnapshot {
    const latencies: TelemetrySnapshot['latencies'] = {};
    for (const [name, stat] of this.latencies) {
      latencies[name] = { ...stat, avgMs: stat.count ? stat.totalMs / stat.count : 0 };
    }
    return {
      counters: Object.fromEntries(this.counters),
      latencies,
      longTasks: { ...this.longTasks },
    };
  }
}

export const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();
