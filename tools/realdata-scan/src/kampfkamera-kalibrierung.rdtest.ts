import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formationAddress, parseSceneBin, type BattleFormation } from '@webmidgar/formats-battle';
import { parseCameraBlock, type BattleCamera } from '@webmidgar/render-battle';

/**
 * K8, Schritt 2 — DER ÖFFNUNGSWINKEL, GEGEN EINE ORIGINALAUFNAHME GERECHNET.
 *
 * Ausgangslage nach Schritt 1: Die Referenzaufnahme `20260810223321_1.jpg`
 * zeigt **Formation 301** (zwei MP-Wachen, EXP 32 / AP 4 / Gil 20, aus den
 * Encounter-Tabellen von `md1stin`/`md1_1`/`md1_2`, Slots −500/0/−1500 und
 * +500/0/−1700).
 *
 * Vermessen wurden im Original die Mittelpunkte der drei Schattenellipsen.
 * Das ging ohne Augenmaß: Bei einer Ellipse liegt die BREITESTE Zeile genau
 * auf dem Mittelpunkt, und sie ist gegen die dunklen Stiefel robust, weil die
 * innerhalb der Ellipse liegen. Schwelle je Region 78 % des Regionsmedians.
 *
 * **Die Rechnung ist überbestimmt, und darin liegt ihr Wert.** Zwei
 * Bodenpunkte liefern VIER Bildkoordinaten; frei ist genau EINE Zahl (der
 * Öffnungswinkel). Passt die Kameradeutung nicht, gibt es keinen Winkel, der
 * alle vier gleichzeitig trifft — dann scheitert die Messung sichtbar, statt
 * einen Wert zu liefern.
 *
 * Mitentschieden wird dabei die seit S33 offene 🟡 **z-Spiegelfrage**
 * („Gegner links oder rechts im Bild"): Beide Vorzeichen werden durchgerechnet,
 * die Aufnahme entscheidet.
 *
 * **Kontrollniveau:** dieselbe Rechnung mit (a) den Kameras aller anderen
 * Formationen, (b) der Konkurrenzformation 307 (ebenfalls 2×MP, EXP 32, aber
 * aus `nrthmk`). Liegt der Fehler der echten Kombination nicht deutlich unter
 * dem der Kontrollen, ist nichts belegt.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle', 'scene.bin'));

/** 🟢 F40: vermessene Renderfläche des Originals (32-px-Balken unten). */
const BREITE = 640;
const HOEHE = 448;
const ASPEKT = BREITE / HOEHE;

/**
 * Vermessen in `20260810223321_1.jpg` (Schattenellipsen, breiteste Zeile).
 * Die beiden Wachen tragen dieselbe Figur, ihre Schatten also dieselbe
 * Weltgröße — das Verhältnis der Bildbreiten ist damit ein Tiefenverhältnis
 * und prüft die Kamera OHNE den Öffnungswinkel zu kennen.
 */
const REF = {
  gegnerLinks: { x: 65.5, y: 260, breite: 83 },
  gegnerRechts: { x: 177.5, y: 241, breite: 77 },
  cloud: { x: 481.5, y: 298, breite: 109 },
};

const REF_BATTLE_ID = 301;
const KONKURRENT_ID = 307;

type Vec3 = [number, number, number];

/** Battle→Szene mit wählbarem z-Vorzeichen (S33 ließ es 🟡 offen). */
function zuSzene(v: Vec3, zMinus: boolean): Vec3 {
  return [v[0], -v[1], zMinus ? -v[2] : v[2]];
}

interface Kamerabasis {
  p: Vec3;
  fw: Vec3;
  rw: Vec3;
  uw: Vec3;
}

function basis(cam: BattleCamera, zMinus: boolean): Kamerabasis | null {
  const p = zuSzene(cam.position as Vec3, zMinus);
  const t = zuSzene(cam.target as Vec3, zMinus);
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

/** Kameraraum-Koordinaten (xc rechts, yc oben, zc Tiefe) eines Weltpunkts. */
function imKameraraum(b: Kamerabasis, q: Vec3): { xc: number; yc: number; zc: number } {
  const d: Vec3 = [q[0] - b.p[0], q[1] - b.p[1], q[2] - b.p[2]];
  return {
    xc: d[0] * b.rw[0] + d[1] * b.rw[1] + d[2] * b.rw[2],
    yc: d[0] * b.uw[0] + d[1] * b.uw[1] + d[2] * b.uw[2],
    zc: d[0] * b.fw[0] + d[1] * b.fw[1] + d[2] * b.fw[2],
  };
}

function aufBild(k: { xc: number; yc: number; zc: number }, fovGrad: number): { x: number; y: number } {
  const tanH = Math.tan((fovGrad * Math.PI) / 360);
  const ndcX = k.xc / (k.zc * tanH * ASPEKT);
  const ndcY = k.yc / (k.zc * tanH);
  return { x: ((ndcX + 1) / 2) * BREITE, y: ((1 - ndcY) / 2) * HOEHE };
}

/**
 * Kleinster Wurzel-mittlerer-Quadrat-Pixelfehler über alle Öffnungswinkel,
 * plus der Winkel, der ihn erreicht. Grobsuche 4…140°, dann zwei
 * Verfeinerungsrunden — das genügt, weil der Fehler in fov unimodal ist.
 */
function bestFov(
  b: Kamerabasis,
  punkte: { welt: Vec3; bild: { x: number; y: number } }[],
): { fov: number; rms: number } {
  const kr = punkte.map((p) => ({ k: imKameraraum(b, p.welt), bild: p.bild }));
  if (kr.some((p) => p.k.zc <= 1)) return { fov: NaN, rms: Infinity };
  const fehler = (fov: number): number => {
    let s = 0;
    for (const p of kr) {
      const b2 = aufBild(p.k, fov);
      s += (b2.x - p.bild.x) ** 2 + (b2.y - p.bild.y) ** 2;
    }
    return Math.sqrt(s / (kr.length * 2));
  };
  let lo = 4;
  let hi = 140;
  let best = { fov: NaN, rms: Infinity };
  for (let runde = 0; runde < 3; runde++) {
    const schritt = (hi - lo) / 200;
    best = { fov: NaN, rms: Infinity };
    for (let f = lo; f <= hi; f += schritt) {
      const e = fehler(f);
      if (e < best.rms) best = { fov: f, rms: e };
    }
    if (!Number.isFinite(best.fov)) return best;
    lo = Math.max(1, best.fov - schritt * 2);
    hi = best.fov + schritt * 2;
  }
  return best;
}

interface Fall {
  name: string;
  fov: number;
  rms: number;
  zMinus: boolean;
  kamera: number;
  tausch: boolean;
}

/** Alle Deutungsvarianten für eine Formation + Kamerablock durchrechnen. */
function varianten(f: BattleFormation, kameras: BattleCamera[], etikett: string): Fall[] {
  const belegt = f.slots.filter((s) => s.enemyTypeId !== 0xffff);
  if (belegt.length !== 2) return [];
  const out: Fall[] = [];
  for (const zMinus of [true, false]) {
    for (let k = 0; k < kameras.length; k++) {
      const b = basis(kameras[k]!, zMinus);
      if (!b) continue;
      for (const tausch of [false, true]) {
        const a = tausch ? belegt[1]! : belegt[0]!;
        const c = tausch ? belegt[0]! : belegt[1]!;
        const r = bestFov(b, [
          { welt: zuSzene([a.x, a.y, a.z], zMinus), bild: REF.gegnerLinks },
          { welt: zuSzene([c.x, c.y, c.z], zMinus), bild: REF.gegnerRechts },
        ]);
        out.push({ name: etikett, fov: r.fov, rms: r.rms, zMinus, kamera: k, tausch });
      }
    }
  }
  return out;
}

async function szenen(): Promise<ReturnType<typeof parseSceneBin> extends Promise<infer T> ? T : never> {
  return parseSceneBin(await readFile(join(REAL_DIR, 'data', 'battle', 'scene.bin')), 'scene.bin');
}

function formationVon(
  container: Awaited<ReturnType<typeof parseSceneBin>>,
  battleId: number,
): BattleFormation | null {
  const { sceneIndex, formationIndex } = formationAddress(battleId);
  return container.scenes[sceneIndex]?.formations[formationIndex] ?? null;
}

describe.skipIf(!available)('K8/2: Öffnungswinkel gegen die Originalaufnahme', () => {
  it('prüft FOV-FREI, ob das Tiefenverhältnis der Schatten zur Kamera passt', async () => {
    const container = await szenen();
    const f = formationVon(container, REF_BATTLE_ID);
    expect(f, 'Formation 301 muss im Bestand liegen').not.toBeNull();
    const belegt = f!.slots.filter((s) => s.enemyTypeId !== 0xffff);
    expect(belegt.length).toBe(2);
    const kameras = parseCameraBlock(f!.cameraRaw).cameras;

    /**
     * Beide Wachen sind dieselbe Figur, ihre Schattenellipsen also gleich
     * groß in der Welt. Bildbreite ∝ 1/Tiefe ⇒ Tiefenverhältnis =
     * Breitenverhältnis, ganz ohne Öffnungswinkel.
     */
    const sollVerhaeltnis = REF.gegnerLinks.breite / REF.gegnerRechts.breite;

    const zeilen: object[] = [];
    for (const zMinus of [true, false]) {
      for (let k = 0; k < kameras.length; k++) {
        const b = basis(kameras[k]!, zMinus);
        if (!b) continue;
        const tiefen = belegt.map((s) => imKameraraum(b, zuSzene([s.x, s.y, s.z], zMinus)).zc);
        // Der im Bild breitere Schatten ist der nähere ⇒ kleinere Tiefe.
        const nah = Math.min(...tiefen);
        const fern = Math.max(...tiefen);
        zeilen.push({
          zMinus,
          kamera: k,
          tiefen: tiefen.map((t) => Math.round(t)),
          istVerhaeltnis: +(fern / nah).toFixed(4),
          abweichung: +(fern / nah - sollVerhaeltnis).toFixed(4),
        });
      }
    }
    // eslint-disable-next-line no-console
    console.log('K8/2 FOV-freier Tiefentest:', {
      sollVerhaeltnis: +sollVerhaeltnis.toFixed(4),
      varianten: zeilen,
    });
    expect(zeilen.length).toBeGreaterThan(0);
  });

  it('bestimmt den Öffnungswinkel und misst ihn gegen zwei Kontrollen', async () => {
    const container = await szenen();
    const f301 = formationVon(container, REF_BATTLE_ID)!;
    const f307 = formationVon(container, KONKURRENT_ID)!;

    const echte = varianten(f301, parseCameraBlock(f301.cameraRaw).cameras, 'F301 eigene Kamera');
    echte.sort((a, b) => a.rms - b.rms);

    // --- Kontrolle A: Konkurrenzformation 307 mit ihrer eigenen Kamera ----
    const konkurrent = varianten(f307, parseCameraBlock(f307.cameraRaw).cameras, 'F307 eigene Kamera');
    konkurrent.sort((a, b) => a.rms - b.rms);

    // --- Kontrolle B: F301-Plätze durch FREMDE Kameras -------------------
    const fremd: Fall[] = [];
    for (let id = 0; id < 1024; id++) {
      if (id === REF_BATTLE_ID) continue;
      const g = formationVon(container, id);
      if (!g) continue;
      const blk = parseCameraBlock(g.cameraRaw);
      const v = varianten(f301, blk.cameras, `fremd ${id}`);
      for (const x of v) fremd.push(x);
    }
    fremd.sort((a, b) => a.rms - b.rms);

    const kurz = (x: Fall): object => ({
      fall: x.name,
      kam: x.kamera,
      zMinus: x.zMinus,
      tausch: x.tausch,
      fov: +x.fov.toFixed(2),
      rmsPixel: +x.rms.toFixed(2),
    });

    // eslint-disable-next-line no-console
    console.log('K8/2 Passung:', {
      echteBesteDrei: echte.slice(0, 3).map(kurz),
      konkurrent307Beste: konkurrent.slice(0, 2).map(kurz),
      fremdkamerasBesteDrei: fremd.slice(0, 3).map(kurz),
      fremdAnzahl: fremd.length,
      fremdBesserAlsEcht: fremd.filter((x) => x.rms < (echte[0]?.rms ?? Infinity)).length,
    });

    expect(echte.length).toBeGreaterThan(0);

    /**
     * DAUERBEFUND, absichtlich als Erwartung formuliert: Diese Methode trägt
     * NICHT. Gemessen (2026-08-15): beste echte Passung 17,51 px (Kamera 0,
     * z−, getauschte Slotzuordnung, 25,8°) — beste FREMDE Passung **3,50 px**
     * (Formation 731, 11,4°). Unter rund 12 000 Kontrollvarianten findet sich
     * immer eine bessere; vier Messzahlen gegen einen freien Parameter sind zu
     * wenig Überbestimmung. Dazu kommt, dass die Figuren im Kampf gar nicht
     * exakt auf ihren Aufstellungsplätzen stehen.
     *
     * Schlägt diese Erwartung eines Tages fehl, ist das die gute Nachricht:
     * Dann trennt die Gütefunktion, und der Punkt-Fit ist brauchbar geworden
     * — etwa nach einer besseren Kameradeutung.
     */
    expect(fremd.filter((x) => x.rms < echte[0]!.rms).length).toBeGreaterThan(0);
  });
});
