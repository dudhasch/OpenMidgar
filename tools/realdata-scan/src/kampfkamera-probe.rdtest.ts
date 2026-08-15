import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSceneBin, type BattleFormation } from '@webmidgar/formats-battle';
import { battleToScene, parseCameraBlock, type BattleCamera } from '@webmidgar/render-battle';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * K8 — DER ÖFFNUNGSWINKEL DER KAMPFKAMERA.
 *
 * Aktenlage: Der 48-B-Kamerablock einer Formation ist als 3 Kameras à 12 B
 * (i16 Position x,y,z + i16 Ziel x,y,z) plus 12 B Füllung gedeutet. Position
 * und Ziel legen die Kamera fest — den ZOOM legen sie nicht fest. Die Demo
 * rät seit S33 einen Öffnungswinkel von 50°; F26 nennt die Kampfkamera den
 * größten verbleibenden Sichtmangel (Ziegelwand füllt das Bild bei Encounter
 * 8, winzige Figuren bei Encounter 300).
 *
 * Diese Probe stellt drei Fragen, in dieser Reihenfolge, weil die billigen
 * die teure entbehrlich machen können:
 *
 *  **H-C — Steht der Zoom in den 12 B Füllung?** Wenn dort ausnahmslos 0xFFFF
 *  steht, trägt der Block keine weitere Zahl und H-C fällt sofort.
 *
 *  **H-B — Steht er im 20-B-Setup-Record?** 18 der 20 B sind ungedeutet.
 *  Eine Byteposition, die im ganzen Bestand nur EINEN Wert trägt, kann kein
 *  formationsabhängiger Zoom sein; eine mit Streuung ist Kandidat und wird
 *  gegen den gemessenen Winkelbedarf geprüft.
 *
 *  **H-A — Ist er fest?** Dann muss die Kameraposition zur Formation passen:
 *  Der Winkel, unter dem die belegten Gegnerplätze von der Kamera aus
 *  erscheinen, muss über den ganzen Bestand eine scharfe Obergrenze haben.
 *  Gütefunktion ist der BEDARFSWINKEL — der kleinste vertikale Öffnungswinkel,
 *  bei dem alle belegten Plätze im Bild liegen (Renderfläche 640×448, 🟢 F40).
 *
 * ⚠️ **Kontrollniveau ist hier Pflicht und nicht Zierde.** Ein enger
 * Bedarfswinkel allein belegt nichts: Wenn alle Formationen ähnlich groß sind
 * und alle Kameras ähnlich weit weg stehen, ist der Bedarf zwangsläufig
 * ähnlich, ganz ohne Abstimmung. Gemessen wird deshalb gegen ZWEI Kontrollen:
 * die um eins verschobene Zuordnung (Kamera der nächsten Formation) und eine
 * verwürfelte. Trennt die Gütefunktion diese nicht, ist sie blind und der
 * Befund entfällt — genau das ist in F35 passiert.
 *
 * ⚠️ **Was diese Probe NICHT kann:** Sie kennt nur Slot-MITTELPUNKTE, keine
 * Figurenausdehnung. Der gemessene Bedarf ist damit eine UNTERE Schranke für
 * den wahren Öffnungswinkel, keine Kalibrierung. Die Party bleibt außen vor,
 * weil ihre Plätze selbst eine 🔵-Ersatzregel sind — sie in die Gütefunktion
 * zu nehmen hieße, die eigene Annahme zu messen.
 */

const available = existsSync(realPfad('battle/scene.bin'));

/** 🟢 F40: vermessene Renderfläche des Originals. */
const BREITE = 640;
const HOEHE = 448;
const ASPEKT = BREITE / HOEHE;

type Vec3 = [number, number, number];

function mische<T>(xs: T[], saat: number): T[] {
  const out = xs.slice();
  let s = saat >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function quantil(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i]!;
}

const median = (xs: number[]): number => quantil(xs, 0.5);

/** Kamerabasis im Szenenraum — dieselbe Konstruktion wie in der Vollbildprobe. */
function basis(cam: BattleCamera): { p: Vec3; fw: Vec3; rw: Vec3; uw: Vec3 } | null {
  const p = battleToScene(cam.position);
  const t = battleToScene(cam.target);
  const f: Vec3 = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  if (fl < 1) return null;
  const fw: Vec3 = [f[0] / fl, f[1] / fl, f[2] / fl];
  const oben: Vec3 = Math.abs(fw[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const r: Vec3 = [
    fw[1] * oben[2] - fw[2] * oben[1],
    fw[2] * oben[0] - fw[0] * oben[2],
    fw[0] * oben[1] - fw[1] * oben[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]);
  if (rl < 1e-6) return null;
  const rw: Vec3 = [r[0] / rl, r[1] / rl, r[2] / rl];
  const uw: Vec3 = [
    rw[1] * fw[2] - rw[2] * fw[1],
    rw[2] * fw[0] - rw[0] * fw[2],
    rw[0] * fw[1] - rw[1] * fw[0],
  ];
  return { p, fw, rw, uw };
}

/**
 * Bedarfswinkel in Grad: der kleinste VERTIKALE Öffnungswinkel, bei dem alle
 * Punkte im Bild liegen. Die waagerechte Ausdehnung wird über das
 * Seitenverhältnis in dieselbe Größe umgerechnet. `null`, wenn ein Punkt
 * hinter der Kamera liegt — dann gibt es keinen solchen Winkel.
 */
function bedarfswinkel(cam: BattleCamera, punkte: Vec3[]): number | null {
  const b = basis(cam);
  if (!b || punkte.length === 0) return null;
  let tanMax = 0;
  for (const q of punkte) {
    const d: Vec3 = [q[0] - b.p[0], q[1] - b.p[1], q[2] - b.p[2]];
    const zc = d[0] * b.fw[0] + d[1] * b.fw[1] + d[2] * b.fw[2];
    if (zc <= 1) return null;
    const xc = d[0] * b.rw[0] + d[1] * b.rw[1] + d[2] * b.rw[2];
    const yc = d[0] * b.uw[0] + d[1] * b.uw[1] + d[2] * b.uw[2];
    tanMax = Math.max(tanMax, Math.abs(yc) / zc, Math.abs(xc) / zc / ASPEKT);
  }
  if (tanMax === 0) return 0;
  return (2 * Math.atan(tanMax) * 180) / Math.PI;
}

/** Belegte Gegnerplätze einer Formation in Szenenkoordinaten. */
function plaetze(f: BattleFormation): Vec3[] {
  return f.slots
    .filter((s) => s.enemyTypeId !== 0xffff)
    .map((s) => battleToScene([s.x, s.y, s.z]) as Vec3);
}

interface Eintrag {
  battleId: number;
  formation: BattleFormation;
  punkte: Vec3[];
  kameras: BattleCamera[];
  padOk: boolean;
}

async function bestand(): Promise<Eintrag[]> {
  const container = await parseSceneBin(
    await readFile(realPfad('battle/scene.bin')),
    'scene.bin',
  );
  const out: Eintrag[] = [];
  for (const scene of container.scenes) {
    if (!scene) continue;
    scene.formations.forEach((f, fi) => {
      const punkte = plaetze(f);
      if (punkte.length === 0) return;
      const blk = parseCameraBlock(f.cameraRaw);
      out.push({
        battleId: scene.sceneIndex * 4 + fi,
        formation: f,
        punkte,
        kameras: blk.cameras,
        padOk: blk.padOk,
      });
    });
  }
  return out;
}

describe.skipIf(!available)('K8: Öffnungswinkel der Kampfkamera', () => {
  it('H-C/H-B: sucht eine Zoomzahl in Füllung und Setup-Record', async () => {
    const eintraege = await bestand();
    expect(eintraege.length).toBeGreaterThan(500);

    // --- H-C: die 12 B Füllung -------------------------------------------
    const fuellungKonstant = eintraege.filter((e) => e.padOk).length;
    const fuellwerte = new Map<number, number>();
    for (const e of eintraege) {
      const v = new DataView(e.formation.cameraRaw.buffer, e.formation.cameraRaw.byteOffset, 48);
      for (let k = 18; k < 24; k++) {
        const w = v.getInt16(k * 2, true);
        fuellwerte.set(w, (fuellwerte.get(w) ?? 0) + 1);
      }
    }

    // --- H-B: die 18 ungedeuteten Setup-Bytes -----------------------------
    // Für jede Byteposition: wie viele verschiedene Werte kommen vor?
    const setupVielfalt: { pos: number; werte: number; haeufigster: number; anteil: number }[] = [];
    for (let pos = 2; pos < 20; pos++) {
      const zaehl = new Map<number, number>();
      for (const e of eintraege) {
        const b = e.formation.setupRaw[pos] ?? 0;
        zaehl.set(b, (zaehl.get(b) ?? 0) + 1);
      }
      let best = 0;
      let bestN = 0;
      for (const [w, n] of zaehl) if (n > bestN) [best, bestN] = [w, n];
      setupVielfalt.push({
        pos,
        werte: zaehl.size,
        haeufigster: best,
        anteil: bestN / eintraege.length,
      });
    }

    // eslint-disable-next-line no-console
    console.log('K8 H-C/H-B:', {
      formationen: eintraege.length,
      fuellungAlle0xFFFF: `${fuellungKonstant}/${eintraege.length}`,
      fuellwerte: [...fuellwerte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      setupVielfalt: setupVielfalt.map((s) => `@${s.pos}:${s.werte}w/${(s.anteil * 100).toFixed(0)}%`),
    });

    // Dauerbefund: Die Füllung IST konstant — falls sich das je ändert,
    // steckt dort Information und die Deutung des Blocks ist unvollständig.
    expect(fuellungKonstant).toBe(eintraege.length);
  });

  it('H-A: misst den Bedarfswinkel je Kamera gegen zwei Kontrollen', async () => {
    const eintraege = await bestand();

    // Für jede der drei Kameras getrennt: Bedarf, echt gegen Kontrollen.
    const proKamera: Record<
      number,
      { echt: number[]; verschoben: number[]; verwuerfelt: number[]; hinten: number }
    > = {};
    const verwuerfelt = mische(
      eintraege.map((_, i) => i),
      0x5eed,
    );

    for (let k = 0; k < 3; k++) {
      const echt: number[] = [];
      const verschobenL: number[] = [];
      const verwuerfeltL: number[] = [];
      let hinten = 0;
      eintraege.forEach((e, i) => {
        const cam = e.kameras[k];
        if (!cam) return;
        const w = bedarfswinkel(cam, e.punkte);
        if (w === null) {
          hinten++;
          return;
        }
        echt.push(w);
        const camV = eintraege[(i + 1) % eintraege.length]!.kameras[k];
        if (camV) {
          const wv = bedarfswinkel(camV, e.punkte);
          if (wv !== null) verschobenL.push(wv);
        }
        const camS = eintraege[verwuerfelt[i]!]!.kameras[k];
        if (camS) {
          const ws = bedarfswinkel(camS, e.punkte);
          if (ws !== null) verwuerfeltL.push(ws);
        }
      });
      proKamera[k] = { echt, verschoben: verschobenL, verwuerfelt: verwuerfeltL, hinten };
    }

    const bericht = (k: number): object => {
      const d = proKamera[k]!;
      return {
        kamera: k,
        n: d.echt.length,
        hinterDerKamera: d.hinten,
        echt: {
          median: +median(d.echt).toFixed(2),
          q90: +quantil(d.echt, 0.9).toFixed(2),
          q99: +quantil(d.echt, 0.99).toFixed(2),
          max: +Math.max(...d.echt).toFixed(2),
        },
        verschoben: { median: +median(d.verschoben).toFixed(2), q90: +quantil(d.verschoben, 0.9).toFixed(2) },
        verwuerfelt: { median: +median(d.verwuerfelt).toFixed(2), q90: +quantil(d.verwuerfelt, 0.9).toFixed(2) },
        anteilHinten: `${d.hinten}/${d.hinten + d.echt.length}`,
      };
    };

    // eslint-disable-next-line no-console
    console.log('K8 H-A Bedarfswinkel (Grad, vertikal):', [0, 1, 2].map(bericht));

    // Wie verschieden sind die drei Kameras überhaupt?
    let identisch01 = 0;
    let identisch02 = 0;
    for (const e of eintraege) {
      const [a, b, c] = e.kameras;
      const gl = (x?: BattleCamera, y?: BattleCamera): boolean =>
        !!x && !!y && x.position.every((v, i) => v === y.position[i]) && x.target.every((v, i) => v === y.target[i]);
      if (gl(a, b)) identisch01++;
      if (gl(a, c)) identisch02++;
    }
    // eslint-disable-next-line no-console
    console.log('K8 Kameravergleich:', {
      identisch_0_1: `${identisch01}/${eintraege.length}`,
      identisch_0_2: `${identisch02}/${eintraege.length}`,
    });

    // Grundabnahme: Kamera 0 sieht ihre eigene Formation überhaupt.
    expect(proKamera[0]!.echt.length).toBeGreaterThan(eintraege.length * 0.9);
  });
});
