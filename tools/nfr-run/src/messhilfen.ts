/**
 * Messhilfen für die NFR-Kampagne: Perzentile, Heap-Abtastung, Zeitmessung.
 *
 * Zwei bewusste Entscheidungen:
 *  1. Berichtet wird p50 **und** p95 **und** max. Ein Median allein versteckt
 *     genau die Ausreißer, für die ein Latenzbudget existiert.
 *  2. Die Heap-Abtastung sagt offen, ob ein echter GC erzwungen werden konnte
 *     (`--expose-gc`). Ohne GC ist ein Heap-Vergleich gegen eine Baseline
 *     nicht belastbar — dann steht das im Ergebnis statt einer schönen Zahl.
 */

export interface Perzentile {
  n: number;
  p50: number;
  p95: number;
  max: number;
  summeMs: number;
}

export function perzentile(werte: readonly number[]): Perzentile {
  if (werte.length === 0) return { n: 0, p50: NaN, p95: NaN, max: NaN, summeMs: 0 };
  const sortiert = [...werte].sort((a, b) => a - b);
  const bei = (p: number): number =>
    sortiert[Math.min(sortiert.length - 1, Math.floor((sortiert.length - 1) * p))]!;
  return {
    n: sortiert.length,
    p50: bei(0.5),
    p95: bei(0.95),
    max: sortiert[sortiert.length - 1]!,
    summeMs: sortiert.reduce((a, b) => a + b, 0),
  };
}

export const jetzt = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export const MB = 1024 * 1024;

export interface HeapProbe {
  bytes: number;
  /** 'node' = process.memoryUsage, 'browser' = performance.memory, 'keine' = nicht verfügbar. */
  quelle: 'node' | 'browser' | 'keine';
  /** true, wenn vor der Messung ein echter GC lief. */
  gcErzwungen: boolean;
}

interface NodeProcessLike {
  memoryUsage?: () => { heapUsed: number };
}

interface PerformanceMemoryLike {
  memory?: { usedJSHeapSize: number };
}

/**
 * Erzwingt — falls möglich — eine Speicherbereinigung. Ohne `--expose-gc`
 * bleibt nur, dem Mikrotask-/Makrotask-Wechsel Gelegenheit zu geben; das ist
 * kein GC und wird im Ergebnis auch nicht so genannt.
 */
export async function versucheGc(): Promise<boolean> {
  const g = globalThis as unknown as { gc?: () => void };
  if (typeof g.gc === 'function') {
    g.gc();
    await new Promise((r) => setTimeout(r, 0));
    g.gc();
    return true;
  }
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  return false;
}

export async function heapProbe(): Promise<HeapProbe> {
  const gcErzwungen = await versucheGc();
  const proc = (globalThis as unknown as { process?: NodeProcessLike }).process;
  if (proc && typeof proc.memoryUsage === 'function') {
    return { bytes: proc.memoryUsage().heapUsed, quelle: 'node', gcErzwungen };
  }
  const perf = (globalThis as unknown as { performance?: PerformanceMemoryLike }).performance;
  if (perf?.memory) return { bytes: perf.memory.usedJSHeapSize, quelle: 'browser', gcErzwungen };
  return { bytes: NaN, quelle: 'keine', gcErzwungen };
}

/** Abweichung eines Messwerts von einer Baseline in Prozent. */
export function abweichungProzent(baseline: number, jetztWert: number): number {
  if (!Number.isFinite(baseline) || baseline === 0) return NaN;
  return ((jetztWert - baseline) / baseline) * 100;
}
