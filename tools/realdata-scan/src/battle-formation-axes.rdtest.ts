import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSceneBin, type BattleFormation } from '@webmidgar/formats-battle';
import { battleToScene, parseCameraBlock, placeFormation } from '@webmidgar/render-battle';

/**
 * S33/F13 — Abnahme der Battle-Basis (Slot-Achsen-Deutung) gegen ALLE 1024
 * Formationen in scene.bin (Gütefunktion + Kontrollhypothesen, Methodik-
 * Standard seit S7).
 *
 * Entschiedene Deutung: Slot (x, y, z) = (seitlich, HÖHE y-ab, Tiefe);
 * `battleToScene` = (x, −y, −z) = Rx(180°). Kontrollhypothesen: die beiden
 * anderen Achsrollen für die Höhe (x bzw. z) — Höhe = z IST die vorherige
 * ff7ToScene-Deutung (F13-Sichtbefund: Gegner bei Szene-y −1700/−2000 unter
 * dem Boden, Party bei +3200 schwebend).
 *
 * Messbild (2026-08-10, 2414 belegte Slots / 1000 nicht-leere Formationen):
 *  - Boden: y exakt 0 in 2217/2414 (91,8 %); Kontrollen x 39,7 %, z 0,6 %.
 *  - Einseitigkeit der Höhenausschläge: y ≠ 0 → 196/197 negativ (y-ab).
 *  - Tiefe: row-Monotonie nur auf z (−1400 → −2450 → −3330); 910/1000
 *    Formationen komplett auf einer z-Seite (Rest: Zangenangriffe).
 *  - Kamera (unabhängige Referenz): Position streng einseitig NUR auf y
 *    (1000/1000 negativ = über dem Boden); Blick verfehlt den
 *    Formationsschwerpunkt in 996/1000 um < 20°.
 *  - ⚠️ Grenze — teilblinde Kontrolle: Der 3D-Abstand Kameraziel↔Schwerpunkt
 *    trennt die Permutationen NICHT (Median ≈ 1900–2100 für alle; die
 *    Intro-Kameras zielen auf die Bühnenmitte, Median-Ziel ≈ (0, −224, 108),
 *    nicht auf den Gegner-Schwerpunkt). Er wird berichtet, nicht gegatet.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle', 'scene.bin'));

interface SlotV {
  x: number;
  y: number;
  z: number;
  row: number;
}

async function loadFormations(): Promise<{ formations: { formation: BattleFormation; slots: SlotV[] }[]; slots: SlotV[] }> {
  const bytes = new Uint8Array(readFileSync(join(REAL_DIR, 'data', 'battle', 'scene.bin')));
  const container = await parseSceneBin(bytes, 'scene.bin');
  expect(container.scenes.length).toBe(256);
  const formations: { formation: BattleFormation; slots: SlotV[] }[] = [];
  const slots: SlotV[] = [];
  for (const scene of container.scenes) {
    for (const formation of scene!.formations) {
      const fs = formation.slots
        .filter((s) => s.enemyTypeId !== 0xffff)
        .map((s) => ({ x: s.x, y: s.y, z: s.z, row: s.row }));
      if (fs.length === 0) continue;
      formations.push({ formation, slots: fs });
      slots.push(...fs);
    }
  }
  return { formations, slots };
}

describe.skipIf(!available)('S33/F13: Battle-Basis — Slot-Achsen aus scene.bin', () => {
  it('Höhenachse = y (y-ab): Bodenanteil > 90 %, Ausschläge einseitig; Kontrollen x/z deutlich schlechter', async () => {
    const { slots } = await loadFormations();
    const n = slots.length;
    const zeroShare = (k: keyof SlotV) => slots.filter((s) => s[k] === 0).length / n;
    const bodenY = zeroShare('y');
    const bodenX = zeroShare('x');
    const bodenZ = zeroShare('z');

    const yNonzero = slots.filter((s) => s.y !== 0);
    const yNeg = yNonzero.filter((s) => s.y < 0).length;

    console.log(
      'Bodenanteil:',
      JSON.stringify({
        slots: n,
        y: bodenY.toFixed(3),
        kontrolleX: bodenX.toFixed(3),
        kontrolleZ_ff7ToSceneDeutung: bodenZ.toFixed(3),
        yAusschlaege: `${yNeg}/${yNonzero.length} negativ (über dem Boden, y-ab)`,
      }),
    );
    // Gewählte Deutung: > 90 % exakt Boden (gemessen 0,918).
    expect(bodenY).toBeGreaterThan(0.9);
    // Kontrollen: Höhe = x (0,397) und Höhe = z / alte Deutung (0,006).
    expect(bodenX).toBeLessThan(0.5);
    expect(bodenZ).toBeLessThan(0.05);
    // y-ab: Nicht-Null-Höhen liegen praktisch ausnahmslos über dem Boden.
    expect(yNeg / yNonzero.length).toBeGreaterThan(0.99);
  }, 120_000);

  it('Tiefenachse = z: row-Monotonie (Schritte > 500), Kontrollen < 300; Formationen einseitig', async () => {
    const { formations, slots } = await loadFormations();
    const rowMeans = (k: keyof SlotV) => {
      const byRow = new Map<number, number[]>();
      for (const s of slots) {
        if (!byRow.has(s.row)) byRow.set(s.row, []);
        byRow.get(s.row)!.push(s[k]);
      }
      return [...byRow.entries()]
        .filter(([, a]) => a.length >= 30) // rows 1–3 tragen 2401/2414 Slots
        .sort((a, b) => a[0] - b[0])
        .map(([row, a]) => ({ row, mean: a.reduce((p, c) => p + c, 0) / a.length, n: a.length }));
    };
    const mz = rowMeans('z');
    const mx = rowMeans('x');
    const my = rowMeans('y');
    console.log('row-Mittel:', JSON.stringify({ z: mz, x: mx, y: my }, (_, v) => (typeof v === 'number' ? Math.round(v) : v)));

    // z: streng monoton nach hinten (row 1 → −1400, 2 → −2450, 3 → −3330).
    expect(mz.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < mz.length; i++) {
      expect(mz[i]!.mean).toBeLessThan(mz[i - 1]!.mean - 500);
    }
    // Kontrollen: x und y bewegen sich je row-Schritt um < 300.
    for (const m of [mx, my]) {
      for (let i = 1; i < m.length; i++) {
        expect(Math.abs(m[i]!.mean - m[i - 1]!.mean)).toBeLessThan(300);
      }
    }

    // Einseitigkeit: > 90 % der Formationen liegen komplett auf EINER z-Seite
    // (gemessen 910/1000; Gegenprobe x: 422/1000).
    const oneSide = (k: 'x' | 'z') =>
      formations.filter(({ slots: fs }) => fs.every((s) => s[k] <= 0) || fs.every((s) => s[k] >= 0)).length;
    const oneZ = oneSide('z');
    const oneX = oneSide('x');
    console.log('Einseitigkeit:', JSON.stringify({ formationen: formations.length, z: oneZ, kontrolleX: oneX }));
    expect(oneZ / formations.length).toBeGreaterThan(0.9);
    expect(oneX / formations.length).toBeLessThan(0.6);
  }, 120_000);

  it('Kamerablock als unabhängige Referenz: Höhe einseitig nur auf y; Blick trifft den Schwerpunkt', async () => {
    const { formations } = await loadFormations();
    let posNeg = [0, 0, 0];
    let posPos = [0, 0, 0];
    const winkel: number[] = [];
    const distanzen: Record<string, number[]> = { identitaet: [], hoeheX: [], hoeheZ_ff7ToSceneDeutung: [] };
    const perms: Record<string, (c: number[]) => number[]> = {
      identitaet: (c) => c,
      hoeheX: (c) => [c[1]!, c[0]!, c[2]!],
      hoeheZ_ff7ToSceneDeutung: (c) => [c[0]!, c[2]!, c[1]!],
    };
    for (const { formation, slots: fs } of formations) {
      const { cameras } = parseCameraBlock(formation.cameraRaw);
      const cam = cameras[0]!;
      for (let k = 0; k < 3; k++) {
        if (cam.position[k]! < 0) posNeg[k]!++;
        if (cam.position[k]! > 0) posPos[k]!++;
      }
      const c = [0, 0, 0];
      for (const s of fs) {
        c[0]! += s.x / fs.length;
        c[1]! += s.y / fs.length;
        c[2]! += s.z / fs.length;
      }
      // Blickwinkel (Achs-Identität Slot ↔ Kamera): Winkel zwischen (tgt−pos)
      // und (Schwerpunkt−pos).
      const view = [0, 1, 2].map((i) => cam.target[i]! - cam.position[i]!);
      const dir = [0, 1, 2].map((i) => c[i]! - cam.position[i]!);
      const dot = view[0]! * dir[0]! + view[1]! * dir[1]! + view[2]! * dir[2]!;
      const cos = dot / (Math.hypot(...view) * Math.hypot(...dir));
      winkel.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
      for (const [name, p] of Object.entries(perms)) {
        const pc = p(c);
        distanzen[name]!.push(Math.hypot(cam.target[0]! - pc[0]!, cam.target[1]! - pc[1]!, cam.target[2]! - pc[2]!));
      }
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
    const unter20 = winkel.filter((w) => w <= 20).length;
    console.log(
      'Kamera:',
      JSON.stringify({
        posEinseitig: posNeg.map((neg, k) => `${'xyz'[k]}: ${neg}−/${posPos[k]}+`),
        blickUnter20Grad: `${unter20}/${winkel.length}`,
        zielSchwerpunktMedian: Object.fromEntries(Object.entries(distanzen).map(([k, v]) => [k, Math.round(med(v))])),
      }),
    );
    // Streng einseitig ist GENAU die Höhenachse y (1000/1000 negativ = über
    // dem Boden, y-ab) — x und z sind es nicht.
    expect(posNeg[1]).toBe(formations.length);
    expect(Math.min(posNeg[0]!, posPos[0]!)).toBeGreaterThan(0);
    expect(Math.min(posNeg[2]!, posPos[2]!)).toBeGreaterThan(0);
    // Die Kamera schaut auf die Formation: ≥ 95 % binnen 20° am Schwerpunkt.
    expect(unter20 / winkel.length).toBeGreaterThan(0.95);
    // ⚠️ Die Ziel-Schwerpunkt-Distanz wird nur BERICHTET (teilblind, s. Kopf).
  }, 120_000);

  it('Abnahme F13: placeFormation stellt > 90 % der Akteure exakt auf Bodenhöhe 0, Flieger darüber', async () => {
    const bytes = new Uint8Array(readFileSync(join(REAL_DIR, 'data', 'battle', 'scene.bin')));
    const container = await parseSceneBin(bytes, 'scene.bin');
    let akteure = 0;
    let boden = 0;
    let ueber = 0;
    let unter = 0;
    for (const scene of container.scenes) {
      for (const formation of scene!.formations) {
        for (const a of placeFormation(formation)) {
          akteure++;
          if (a.scenePosition[1] === 0) boden++;
          else if (a.scenePosition[1] > 0) ueber++;
          else unter++;
        }
      }
    }
    // Encounter 303 (Szene 75, Formation 3) — der F13-Sichtbefund: beide
    // Gegner standen bei Szene-y −1700/−2000; jetzt Boden 0, Tiefe +1700/+2000.
    const f303 = placeFormation(container.scenes[75]!.formations[3]!);
    console.log(
      'Abnahme:',
      JSON.stringify({ akteure, boden, ueber, unter, encounter303: f303.map((a) => a.scenePosition) }),
    );
    expect(akteure).toBe(2414);
    expect(boden / akteure).toBeGreaterThan(0.9);
    // Nicht-Boden-Akteure sind (bis auf den einen +1-Slot im Bestand) Flieger ÜBER dem Boden.
    expect(unter).toBeLessThanOrEqual(1);
    expect(f303.map((a) => a.scenePosition)).toEqual([
      [-500, -0, 1700],
      [500, -0, 2000],
    ]);
    // Party-Ersatzseite (−z) liegt der Gegner-Mehrheitsseite (+z) gegenüber:
    expect(battleToScene([0, 0, 3200])[2]).toBe(-3200);
  }, 120_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
