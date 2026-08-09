import type { Walkmesh } from '@webmidgar/formats-field';

/**
 * Walkmesh-Bewegungs-Solver (Masterplan Phase 3.3).
 * Arbeitet im FF7-Field-Raum (Grundriss x/y, Höhe z) — die Konvertierung in
 * den Scene-Raum passiert ausschließlich beim Rendering (ADR-009).
 *
 * Entscheidungslogik laut Plan: baryzentrische Punktprüfung, exakte
 * Höheninterpolation über die Ebenengleichung, iterativer Kantenübertritt mit
 * harter Obergrenze, 2-Pass-Sliding an gesperrten Kanten, Clamp-Notanker als
 * Invariantenschutz („immer im Mesh").
 */

export interface SolverOptions {
  /** Toleranz als Abstand zur Kante in Field-Einheiten. */
  epsDist?: number;
  /** Obergrenze Kantenübertritte pro move() — Schutz vor degenerierten Fächern. */
  maxCrossings?: number;
  /** Obergrenze Slide-Iterationen pro move() (Original: „an Wand entlangrutschen"). */
  maxSlides?: number;
}

export interface WalkState {
  tri: number;
  x: number;
  y: number;
  height: number;
}

export type MoveEventType = 'crossed' | 'slid' | 'blocked' | 'clamped';

export interface MoveEvent {
  type: MoveEventType;
  tri: number;
  edge?: number;
}

export interface MoveResult {
  state: WalkState;
  events: MoveEvent[];
}

interface DerivedTri {
  // Grundriss-Ecken
  xs: [number, number, number];
  ys: [number, number, number];
  // Ebenengleichung z = pA·x + pB·y + pC
  pA: number;
  pB: number;
  pC: number;
  /** Doppelte vorzeichenbehaftete Grundrissfläche (Winding-Indikator). */
  det: number;
  /** false: im Grundriss degeneriert (senkrecht/kollabiert) → unbegehbar. */
  walkable: boolean;
  adj: [number | null, number | null, number | null];
  /** Kantenlängen im Grundriss (für Abstandsnormierung). */
  edgeLen: [number, number, number];
}

const AREA_EPS = 1e-6;
const TINY = 1e-9;

export class WalkmeshSolver {
  readonly tris: DerivedTri[];
  private readonly grid = new Map<string, number[]>();
  private readonly cell: number;
  private readonly opts: Required<SolverOptions>;

  constructor(mesh: Walkmesh, opts: SolverOptions = {}) {
    this.opts = {
      epsDist: opts.epsDist ?? 1e-3,
      maxCrossings: opts.maxCrossings ?? 16,
      maxSlides: opts.maxSlides ?? 2,
    };
    this.tris = mesh.triangles.map((t) => {
      const [a, b, c] = t.vertices;
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      const walkable = Math.abs(det) > AREA_EPS && !t.degenerate;
      let pA = 0, pB = 0, pC = 0;
      if (walkable) {
        pA = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / det;
        pB = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / det;
        pC = a[2] - pA * a[0] - pB * a[1];
      }
      const xs: [number, number, number] = [a[0], b[0], c[0]];
      const ys: [number, number, number] = [a[1], b[1], c[1]];
      const edgeLen = [0, 1, 2].map((e) => {
        const f = (e + 1) % 3;
        return Math.hypot(xs[f]! - xs[e]!, ys[f]! - ys[e]!) || TINY;
      }) as [number, number, number];
      return { xs, ys, pA, pB, pC, det, walkable, adj: [...t.adjacency], edgeLen };
    });

    // Uniform Grid über den Grundriss für O(1)-Startdreieck-Suche.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, edgeSum = 0, edgeCount = 0;
    for (const t of this.tris) {
      if (!t.walkable) continue;
      minX = Math.min(minX, ...t.xs);
      maxX = Math.max(maxX, ...t.xs);
      minY = Math.min(minY, ...t.ys);
      maxY = Math.max(maxY, ...t.ys);
      edgeSum += t.edgeLen[0] + t.edgeLen[1] + t.edgeLen[2];
      edgeCount += 3;
    }
    this.cell = Math.max(1, edgeCount ? edgeSum / edgeCount : 1);
    this.tris.forEach((t, i) => {
      if (!t.walkable) return;
      const cx0 = Math.floor(Math.min(...t.xs) / this.cell);
      const cx1 = Math.floor(Math.max(...t.xs) / this.cell);
      const cy0 = Math.floor(Math.min(...t.ys) / this.cell);
      const cy1 = Math.floor(Math.max(...t.ys) / this.cell);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${cx},${cy}`;
          const list = this.grid.get(key) ?? [];
          list.push(i);
          this.grid.set(key, list);
        }
      }
    });
  }

  /** Vorzeichenbehafteter Abstand des Punkts zur Kante e (innen positiv). */
  private edgeDistance(tri: DerivedTri, e: number, x: number, y: number): number {
    const f = (e + 1) % 3;
    const cross =
      (tri.xs[f]! - tri.xs[e]!) * (y - tri.ys[e]!) - (tri.ys[f]! - tri.ys[e]!) * (x - tri.xs[e]!);
    return (Math.sign(tri.det) * cross) / tri.edgeLen[e]!;
  }

  containsPoint(triId: number, x: number, y: number, eps = this.opts.epsDist): boolean {
    const tri = this.tris[triId];
    if (!tri || !tri.walkable) return false;
    for (let e = 0; e < 3; e++) if (this.edgeDistance(tri, e, x, y) < -eps) return false;
    return true;
  }

  heightAt(triId: number, x: number, y: number): number {
    const tri = this.tris[triId]!;
    return tri.pA * x + tri.pB * y + tri.pC;
  }

  /**
   * Startdreieck-Suche über das Grid; bei überlappenden Ebenen (Brücken)
   * entscheidet die Höhennähe zu zHint.
   */
  locate(x: number, y: number, zHint?: number): WalkState | null {
    const key = `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
    const candidates = this.grid.get(key) ?? [];
    let best: WalkState | null = null;
    for (const id of candidates) {
      if (!this.containsPoint(id, x, y)) continue;
      const height = this.heightAt(id, x, y);
      if (
        best === null ||
        (zHint !== undefined && Math.abs(height - zHint) < Math.abs(best.height - zHint))
      ) {
        best = { tri: id, x, y, height };
      }
    }
    return best;
  }

  /** Kooperative Schrittintegration im Grundriss (Masterplan 3.3, Schritt 3). */
  move(state: WalkState, dx: number, dy: number): MoveResult {
    const events: MoveEvent[] = [];
    let tri = state.tri;
    let x = state.x;
    let y = state.y;
    let rx = dx;
    let ry = dy;
    let slides = 0;

    for (let iter = 0; iter < this.opts.maxCrossings; iter++) {
      if (Math.hypot(rx, ry) < TINY) break;
      const tx = x + rx;
      const ty = y + ry;
      if (this.containsPoint(tri, tx, ty, this.opts.epsDist)) {
        x = tx;
        y = ty;
        rx = 0;
        ry = 0;
        break;
      }

      // Austrittskante: kleinster Parameter t entlang der Bewegung.
      const exit = this.findExitEdge(tri, x, y, rx, ry);
      if (!exit) {
        // Numerischer Notanker: Ziel in das Dreieck clampen.
        const clamped = this.clampToTriangle(tri, tx, ty);
        x = clamped.x;
        y = clamped.y;
        events.push({ type: 'clamped', tri });
        rx = 0;
        ry = 0;
        break;
      }

      // Bis zur Kante vorrücken, Rest verkürzen.
      x = x + rx * exit.t;
      y = y + ry * exit.t;
      rx *= 1 - exit.t;
      ry *= 1 - exit.t;

      const neighbor = this.tris[tri]!.adj[exit.edge] ?? null;
      if (neighbor !== null && this.tris[neighbor]!.walkable) {
        tri = neighbor;
        events.push({ type: 'crossed', tri, edge: exit.edge });
        continue;
      }

      // Gesperrte Kante → Sliding (Projektion auf die Kantenrichtung).
      slides++;
      if (slides > this.opts.maxSlides) {
        events.push({ type: 'blocked', tri, edge: exit.edge });
        rx = 0;
        ry = 0;
        break;
      }
      const t = this.tris[tri]!;
      const f = (exit.edge + 1) % 3;
      const ex = (t.xs[f]! - t.xs[exit.edge]!) / t.edgeLen[exit.edge]!;
      const ey = (t.ys[f]! - t.ys[exit.edge]!) / t.edgeLen[exit.edge]!;
      const along = rx * ex + ry * ey;
      rx = ex * along;
      ry = ey * along;
      events.push({ type: 'slid', tri, edge: exit.edge });
    }

    // Invariante „immer im Mesh": notfalls hart clampen.
    if (!this.containsPoint(tri, x, y, this.opts.epsDist * 10)) {
      const clamped = this.clampToTriangle(tri, x, y);
      x = clamped.x;
      y = clamped.y;
      events.push({ type: 'clamped', tri });
    }
    return { state: { tri, x, y, height: this.heightAt(tri, x, y) }, events };
  }

  private findExitEdge(
    triId: number,
    x: number,
    y: number,
    rx: number,
    ry: number,
  ): { edge: number; t: number } | null {
    const tri = this.tris[triId]!;
    let best: { edge: number; t: number } | null = null;
    for (let e = 0; e < 3; e++) {
      const f = (e + 1) % 3;
      const ex = tri.xs[f]! - tri.xs[e]!;
      const ey = tri.ys[f]! - tri.ys[e]!;
      const denom = rx * ey - ry * ex;
      if (Math.abs(denom) < TINY) continue; // parallel zur Kante
      // Nur Kanten, durch die die Bewegung das Dreieck VERLÄSST:
      // CCW (det>0): Austritt gdw. cross(e,r) < 0 ⇔ sign(det)·denom > 0.
      const outward = Math.sign(tri.det) * denom;
      if (outward <= 0) continue;
      const wx = tri.xs[e]! - x;
      const wy = tri.ys[e]! - y;
      const t = (wx * ey - wy * ex) / denom;
      const s = (wx * ry - wy * rx) / denom;
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      if (s < -1e-6 || s > 1 + 1e-6) continue;
      if (best === null || t < best.t) best = { edge: e, t: Math.max(0, Math.min(1, t)) };
    }
    return best;
  }

  private clampToTriangle(triId: number, x: number, y: number): { x: number; y: number } {
    const tri = this.tris[triId]!;
    let bx = x;
    let by = y;
    // Iterativ hinter verletzte Kanten zurückprojizieren (max 3 Kanten).
    for (let pass = 0; pass < 3; pass++) {
      let worst = -1;
      let worstDist = -this.opts.epsDist;
      for (let e = 0; e < 3; e++) {
        const d = this.edgeDistance(tri, e, bx, by);
        if (d < worstDist) {
          worst = e;
          worstDist = d;
        }
      }
      if (worst < 0) return { x: bx, y: by };
      const f = (worst + 1) % 3;
      const ex = (tri.xs[f]! - tri.xs[worst]!) / tri.edgeLen[worst]!;
      const ey = (tri.ys[f]! - tri.ys[worst]!) / tri.edgeLen[worst]!;
      // Auf die Kantengerade projizieren, dann in Kantengrenzen clampen.
      const px = bx - tri.xs[worst]!;
      const py = by - tri.ys[worst]!;
      const along = Math.max(0, Math.min(tri.edgeLen[worst]!, px * ex + py * ey));
      bx = tri.xs[worst]! + ex * along;
      by = tri.ys[worst]! + ey * along;
    }
    // Letzter Ausweg: Schwerpunkt (garantiert im Dreieck).
    return {
      x: (tri.xs[0]! + tri.xs[1]! + tri.xs[2]!) / 3,
      y: (tri.ys[0]! + tri.ys[1]! + tri.ys[2]!) / 3,
    };
  }

  /** Debug-Overlay-Daten: alle Kanten mit Blocked-Markierung (Masterplan 3.3.8). */
  debugEdges(): { a: [number, number, number]; b: [number, number, number]; blocked: boolean }[] {
    const out: { a: [number, number, number]; b: [number, number, number]; blocked: boolean }[] = [];
    this.tris.forEach((t) => {
      if (!t.walkable) return;
      for (let e = 0; e < 3; e++) {
        const f = (e + 1) % 3;
        const za = t.pA * t.xs[e]! + t.pB * t.ys[e]! + t.pC;
        const zb = t.pA * t.xs[f]! + t.pB * t.ys[f]! + t.pC;
        out.push({
          a: [t.xs[e]!, t.ys[e]!, za],
          b: [t.xs[f]!, t.ys[f]!, zb],
          blocked: t.adj[e] === null,
        });
      }
    });
    return out;
  }
}
