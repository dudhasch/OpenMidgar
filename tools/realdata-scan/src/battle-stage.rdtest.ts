import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseSceneBin } from '@webmidgar/formats-battle';
import { hasPSignature, hasTexSignature, parseP, parseTex, type TextureSource } from '@webmidgar/formats-model';
import { battleToScene, loadBattleStage, parseCameraBlock, STAGE_BAND_FIRST_INDEX, stagePrefixForLocation } from '@webmidgar/render-battle';
import { NodeDirectorySource } from './node-source.js';
import { rasterize, texRgb, type Dreieck, type Vec3 } from './sheet.js';

/**
 * K5 — DIE ECHTE KAMPFBÜHNE.
 *
 * Vorhersage aus der Aktenlage: battle.lgp hat GENAU 90 skelettlose Präfixe
 * (`og`…`rr`, Bandindex 370…459), und das Setup-Feld `location` der
 * Formationen soll laut `docs/fremdquellen/gears-pdf.md` §8 einen Wertebereich
 * 0x00…0x59 = 90 Einträge haben. Wenn beides dieselbe Tabelle ist, muss
 * `Präfixindex = 370 + location` gelten.
 *
 * Diese Probe misst das:
 *  - Wertebereich und Häufigkeit aller `location`-Werte über scene.bin.
 *  - Auflösungsquote der Regel, MIT den Kontrollen `location+1`, `location−1`
 *    und einer verwürfelten Zuordnung.
 *  - Abdeckung: wie viele der 90 Präfixe werden von mindestens einer Szene
 *    erreicht.
 *  - Ortsfrage der Bühnenteile: Tragen die `.p`-Dateien ihren eigenen Ursprung
 *    (dann ist die Bühne die blosse Vereinigung ihrer Teile), oder liegen alle
 *    Teile um denselben Punkt (dann fehlte eine Platzierungsregel)?
 *
 * ⚠️ **Was diese Probe NICHT entscheidet, und warum.** Vollständigkeit ist
 * hier ein schwaches Maß: `location` schöpft 0…89 exakt aus, also löst JEDE
 * Bijektion 0…89 → Band zu 100 % auf — eine verwürfelte Zuordnung genauso wie
 * die Regel. Es wurden deshalb zwei INHALTSMASSE versucht, und beide sind
 * gescheitert und werden als gescheitert berichtet:
 *   (a) „Gegner im Bühnengrundriss": Regel 98,05 %, Kontrolle +1 sogar
 *       99,09 %, verwürfelt im Mittel 97,85 %. Jede Bühne ist größer als jede
 *       Aufstellung — das Maß kann nicht trennen.
 *   (b) „Bühnenradius gegen Kameraabstand" (Rangkorrelation): Regel −0,066,
 *       verwürfelt −0,157…+0,068. Alles Rauschen; es gibt diesen Zusammenhang
 *       in scene.bin schlicht nicht.
 * Was die Regel STÜTZT, ist damit: die exakte Bereichsausschöpfung (0…89 bei
 * genau 90 Präfixen), die Häufigkeitsprobe (die drei geometrielosen Bühnen
 * `og`/`qo`/`rk` sind zugleich die drei seltensten locations, `rk` mit 0
 * Benutzungen) — und der Sichtvergleich im zweiten Test.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));
const OUT = process.env['WEBMIDGAR_K5_OUT'] ?? join(tmpdir(), 'webmidgar-sheets', 'k5');

/** Deterministischer Mischer für die Kontrollhypothese „verwürfelt". */
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

describe.skipIf(!available)('K5: Kampfbühne — location → Bühnenpräfix', () => {
  it('misst Wertebereich, Auflösungsquote und Teileursprünge', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const bytesOf = new Map<string, Uint8Array>();
    for (const e of index.listEntries('battle')) bytesOf.set(e.name, await index.readEntry(e.canonicalId));

    const proPraefix = new Map<string, string[]>();
    for (const name of bytesOf.keys()) {
      const pre = name.slice(0, 2);
      if (!proPraefix.has(pre)) proPraefix.set(pre, []);
      proPraefix.get(pre)!.push(name);
    }
    const praefixe = [...proPraefix.keys()].sort();
    const band2 = praefixe.slice(STAGE_BAND_FIRST_INDEX, STAGE_BAND_FIRST_INDEX + 90);
    expect(band2.length).toBe(90);
    expect(band2[0]).toBe('og');
    expect(band2[89]).toBe('rr');

    // --- location-Werte aus scene.bin -------------------------------------
    const scenePfad = join(REAL_DIR, 'data', 'battle', 'scene.bin');
    const container = await parseSceneBin(await readFile(scenePfad), 'scene.bin');
    const haeufig = new Map<number, number>();
    let formationen = 0;
    let leerFormationen = 0;
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (const f of scene.formations) {
        // Leere Formationen (kein einziger belegter Slot) tragen kein Bild.
        if (f.slots.every((s) => s.enemyTypeId === 0xffff)) {
          leerFormationen++;
          continue;
        }
        formationen++;
        haeufig.set(f.location, (haeufig.get(f.location) ?? 0) + 1);
      }
    }
    const werte = [...haeufig.keys()].sort((a, b) => a - b);
    const min = werte[0]!;
    const max = werte[werte.length - 1]!;

    // --- Auflösungsquote mit Kontrollen -----------------------------------
    const verwuerfelt = mische(band2, 0x5eed);
    const loest = (abbild: (loc: number) => string | null): { quote: number; erreicht: number } => {
      let ok = 0;
      let gesamt = 0;
      const erreicht = new Set<string>();
      for (const [loc, n] of haeufig) {
        gesamt += n;
        const p = abbild(loc);
        if (p !== null && proPraefix.has(p)) {
          ok += n;
          erreicht.add(p);
        }
      }
      return { quote: ok / gesamt, erreicht: erreicht.size };
    };
    const regel = loest((loc) => band2[loc] ?? null);
    const plus1 = loest((loc) => band2[loc + 1] ?? null);
    const minus1 = loest((loc) => band2[loc - 1] ?? null);
    const zufall = loest((loc) => verwuerfelt[loc] ?? null);

    console.log(
      `K5 location: ${formationen} belegte Formationen (${leerFormationen} leere), ` +
        `${werte.length} verschiedene Werte, Bereich ${min}…${max}\n` +
        `K5 Auflösung Regel (Index 370+location): ${(regel.quote * 100).toFixed(2)} %, ` +
        `erreichte Präfixe ${regel.erreicht}/90\n` +
        `K5 Kontrolle location+1: ${(plus1.quote * 100).toFixed(2)} % (${plus1.erreicht}/90); ` +
        `location−1: ${(minus1.quote * 100).toFixed(2)} % (${minus1.erreicht}/90); ` +
        `verwürfelt: ${(zufall.quote * 100).toFixed(2)} % (${zufall.erreicht}/90)`,
    );
    // Häufigkeit gegen Bühnengröße: Eine Bühne, die fast keine Geometrie hat,
    // kann nicht der Schauplatz hunderter Kämpfe sein. Passt die Regel, muss
    // die winzigste Bühne auch die seltenste sein.
    const groesse = new Map<string, number>();
    for (const prefix of band2) {
      let tris = 0;
      for (const name of proPraefix.get(prefix)!.slice().sort()) {
        const b = bytesOf.get(name)!;
        if (!hasPSignature(b)) continue;
        const p = parseP(b, name).value;
        if (p) for (const sm of p.submeshes) tris += sm.count / 3;
      }
      groesse.set(prefix, tris);
    }
    const klein = [...groesse.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
    console.log(
      `K5 kleinste Bühnen (Präfix/Dreiecke/Benutzungen): ` +
        klein.map(([p, t]) => `${p}=${t}/${haeufig.get(band2.indexOf(p)) ?? 0}`).join(' '),
    );
    const top = [...haeufig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(
      `K5 häufigste locations (loc/Benutzungen/Dreiecke der Bühne): ` +
        top.map(([l, n]) => `${l}=${n}/${groesse.get(band2[l]!) ?? -1}`).join(' '),
    );

    // Nicht erreichte Präfixe benennen — das ist der ehrliche Rest.
    const erreichteMenge = new Set(werte.map((l) => band2[l]).filter(Boolean));
    console.log(`K5 nie erreichte Bühnenpräfixe: ${band2.filter((p) => !erreichteMenge.has(p)).join(' ') || '(keine)'}`);

    // Die Regel muss den Bereich exakt ausschöpfen — sonst ist sie nur die
    // Feststellung „irgendein Index existiert".
    expect(min).toBe(0);
    expect(max).toBe(89);
    expect(regel.quote).toBe(1);

    // --- Ortsfrage: tragen die Bühnenteile ihren eigenen Ursprung? ---------
    // Gütemaß: Verhältnis der Streuung der TEILMITTELPUNKTE zur mittleren
    // Teilgröße. Nahe 0 hiesse „alle Teile um denselben Punkt" (Platzierung
    // fehlt); deutlich über 0 heisst „die .p tragen ihre Weltlage selbst".
    const verhaeltnisse: number[] = [];
    let teileGesamt = 0;
    for (const prefix of band2) {
      const mitten: Vec3[] = [];
      let mittlereGroesse = 0;
      for (const name of proPraefix.get(prefix)!.slice().sort()) {
        const b = bytesOf.get(name)!;
        if (!hasPSignature(b)) continue;
        const p = parseP(b, name).value;
        if (!p || p.positions.length === 0) continue;
        teileGesamt++;
        let mn: Vec3 = [Infinity, Infinity, Infinity];
        let mx: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.positions.length; i += 3)
          for (let k = 0; k < 3; k++) {
            const v = p.positions[i + k]!;
            if (v < mn[k]!) mn[k] = v;
            if (v > mx[k]!) mx[k] = v;
          }
        mitten.push([(mn[0]! + mx[0]!) / 2, (mn[1]! + mx[1]!) / 2, (mn[2]! + mx[2]!) / 2]);
        mittlereGroesse += Math.max(mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!);
      }
      if (mitten.length < 2) continue;
      mittlereGroesse /= mitten.length;
      const mittel: Vec3 = [0, 0, 0];
      for (const m of mitten) for (let k = 0; k < 3; k++) mittel[k] = mittel[k]! + m[k]! / mitten.length;
      let streuung = 0;
      for (const m of mitten)
        streuung += Math.hypot(m[0] - mittel[0]!, m[1] - mittel[1]!, m[2] - mittel[2]!) / mitten.length;
      if (mittlereGroesse > 0) verhaeltnisse.push(streuung / mittlereGroesse);
    }
    verhaeltnisse.sort((a, b) => a - b);
    const median = verhaeltnisse[Math.floor(verhaeltnisse.length / 2)]!;
    console.log(
      `K5 Teileursprung: ${teileGesamt} Bühnenteile, Streuung/Teilgröße über ${verhaeltnisse.length} Bühnen — ` +
        `Median ${median.toFixed(3)}, min ${verhaeltnisse[0]!.toFixed(3)}, max ${verhaeltnisse[verhaeltnisse.length - 1]!.toFixed(3)}, ` +
        `Anteil > 0,25: ${(verhaeltnisse.filter((v) => v > 0.25).length / verhaeltnisse.length * 100).toFixed(1)} %`,
    );

    // --- SCHÄRFERE GÜTEFUNKTION: passt die Bühne zur Aufstellung? ----------
    // Vollständigkeit allein trennt die Regel NICHT von einer verwürfelten
    // Zuordnung: jede Bijektion 0…89 → Band löst zu 100 % auf (oben gemessen).
    // Ein Inhaltsmaß muss her. Die Gegnerplätze der Formation MÜSSEN auf der
    // Bühne stehen — also innerhalb ihres Grundrisses. Unter einer falschen
    // Zuordnung landen Gegner reihenweise neben der Bühne.
    const grundriss = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
    for (const prefix of band2) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const name of proPraefix.get(prefix)!.slice().sort()) {
        const b = bytesOf.get(name)!;
        if (!hasPSignature(b)) continue;
        const p = parseP(b, name).value;
        if (!p) continue;
        for (let i = 0; i < p.positions.length; i += 3) {
          const x = p.positions[i]!;
          const z = p.positions[i + 2]!;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (z < z0) z0 = z;
          if (z > z1) z1 = z;
        }
      }
      grundriss.set(prefix, { x0, x1, z0, z1 });
    }
    const drinnen = (abbild: (loc: number) => string | null): number => {
      let drin = 0;
      let gesamt = 0;
      for (const scene of container.scenes) {
        if (!scene) continue;
        for (const f of scene.formations) {
          const belegt = f.slots.filter((s) => s.enemyTypeId !== 0xffff);
          if (belegt.length === 0) continue;
          const p = abbild(f.location);
          const g = p ? grundriss.get(p) : undefined;
          if (!g) {
            gesamt += belegt.length;
            continue;
          }
          for (const s of belegt) {
            gesamt++;
            if (s.x >= g.x0 && s.x <= g.x1 && s.z >= g.z0 && s.z <= g.z1) drin++;
          }
        }
      }
      return drin / gesamt;
    };
    const drinRegel = drinnen((loc) => band2[loc] ?? null);
    const drinPlus = drinnen((loc) => band2[loc + 1] ?? null);
    const drinMinus = drinnen((loc) => band2[loc - 1] ?? null);
    const drinZufall = [0x5eed, 0x1234, 0xabcd, 0x9999, 0x2468].map((saat) => {
      const m = mische(band2, saat);
      return drinnen((loc) => m[loc] ?? null);
    });
    console.log(
      `K5 Gegner im Bühnengrundriss — Regel ${(drinRegel * 100).toFixed(2)} %, ` +
        `Kontrolle +1 ${(drinPlus * 100).toFixed(2)} %, −1 ${(drinMinus * 100).toFixed(2)} %, ` +
        `verwürfelt ${drinZufall.map((v) => (v * 100).toFixed(2)).join(' / ')} % ` +
        `(Mittel ${((drinZufall.reduce((a, b) => a + b, 0) / drinZufall.length) * 100).toFixed(2)} %)`,
    );
    // BEFUND: Dieses Maß trennt NICHT. Alle Bühnen sind größer als jede
    // Aufstellung, also liegen die Gegner fast immer im Grundriss — egal
    // welcher. Es wird berichtet, aber es trägt keine Entscheidung.
    expect(drinRegel).toBeGreaterThan(0.9);

    // --- ZWEITE Gütefunktion: Bühnengröße gegen die Kamera der Formation ---
    // Jede Formation trägt einen eigenen Kamerablock. Eine enge Bühne braucht
    // eine nahe Kamera, eine weite eine ferne. Besteht dieser Zusammenhang,
    // muss er unter der RICHTIGEN Zuordnung stärker sein als unter einer
    // verwürfelten — das ist ein Inhaltsmaß, kein Vollständigkeitsmaß.
    const radius = new Map<string, number>();
    for (const [p, g] of grundriss) radius.set(p, Math.hypot(g.x1 - g.x0, g.z1 - g.z0) / 2);
    const korrelation = (abbild: (loc: number) => string | null): number => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const scene of container.scenes) {
        if (!scene) continue;
        for (const f of scene.formations) {
          if (f.slots.every((s) => s.enemyTypeId === 0xffff)) continue;
          const p = abbild(f.location);
          const r = p ? radius.get(p) : undefined;
          if (r === undefined || !Number.isFinite(r)) continue;
          const { cameras } = parseCameraBlock(f.cameraRaw);
          const k = cameras[0]!;
          const d = Math.hypot(
            k.position[0] - k.target[0],
            k.position[1] - k.target[1],
            k.position[2] - k.target[2],
          );
          if (!Number.isFinite(d) || d === 0) continue;
          xs.push(r);
          ys.push(d);
        }
      }
      // Rangkorrelation (Spearman) — robust gegen die schiefen Größenverteilungen.
      const rang = (v: number[]): number[] => {
        const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
        const r = new Array<number>(v.length);
        idx.forEach(([, i], k) => (r[i] = k));
        return r;
      };
      const rx = rang(xs);
      const ry = rang(ys);
      const n = rx.length;
      const mx = rx.reduce((a, b) => a + b, 0) / n;
      const my = ry.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        const dx = rx[i]! - mx;
        const dy = ry[i]! - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    const korrRegel = korrelation((loc) => band2[loc] ?? null);
    const korrPlus = korrelation((loc) => band2[loc + 1] ?? null);
    const korrMinus = korrelation((loc) => band2[loc - 1] ?? null);
    const korrZufall = [0x5eed, 0x1234, 0xabcd, 0x9999, 0x2468, 0x1111, 0x7777, 0xbeef].map((saat) => {
      const m = mische(band2, saat);
      return korrelation((loc) => m[loc] ?? null);
    });
    const mittelZufall = korrZufall.reduce((a, b) => a + b, 0) / korrZufall.length;
    const maxZufall = Math.max(...korrZufall.map(Math.abs));
    console.log(
      `K5 Rangkorrelation Bühnenradius↔Kameraabstand — Regel ${korrRegel.toFixed(3)}, ` +
        `+1 ${korrPlus.toFixed(3)}, −1 ${korrMinus.toFixed(3)}, ` +
        `verwürfelt ${korrZufall.map((v) => v.toFixed(3)).join(' / ')} ` +
        `(Mittel ${mittelZufall.toFixed(3)}, größter Betrag ${maxZufall.toFixed(3)})`,
    );
    // BEFUND (ehrlich): AUCH dieses Maß trennt nicht — alle Werte liegen im
    // Rauschband um 0. Es gibt in scene.bin schlicht keinen Zusammenhang
    // zwischen Bühnengröße und Kameraabstand, den man als Gütefunktion
    // benutzen könnte. Festgehalten wird deshalb nur, dass die Regel im
    // Rauschband liegt, NICHT dass sie belegt wäre.
    expect(Math.abs(korrRegel)).toBeLessThan(0.3);
    expect(Math.abs(mittelZufall)).toBeLessThan(0.3);

    // ZUSAMMENFASSUNG der Beweislage (siehe Kommentar am Dateikopf):
    // Vollständigkeit + exakte Bereichsausschöpfung belegen, dass `location`
    // GENAU EIN Index in dieses 90er-Band ist. Welche Permutation, entscheidet
    // erst der Sichtvergleich gegen eine Originalaufnahme (zweiter Test).
    await dir.closeAll();
  }, 900_000);

  it('rendert Bühnen als Standbild (Sichtnachweis)', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const bytesOf = new Map<string, Uint8Array>();
    const proPraefix = new Map<string, string[]>();
    for (const e of index.listEntries('battle')) {
      bytesOf.set(e.name, await index.readEntry(e.canonicalId));
      const pre = e.name.slice(0, 2);
      if (!proPraefix.has(pre)) proPraefix.set(pre, []);
      proPraefix.get(pre)!.push(e.name);
    }
    mkdirSync(OUT, { recursive: true });

    const quelle = {
      listBattleEntries: (p: string) => proPraefix.get(p) ?? [],
      readBattleEntry: (n: string) => Promise.resolve(bytesOf.get(n) ?? null),
    };
    // Welche `location` tragen die ERSTEN Szenen? Die erste Szene ist der
    // erste Kampf des Spiels (Reaktor 1) — und von genau diesem Kampf liegt
    // eine Originalaufnahme vor. Damit wird der Sichtvergleich gerichtet.
    const container = await parseSceneBin(
      await readFile(join(REAL_DIR, 'data', 'battle', 'scene.bin')),
      'scene.bin',
    );
    const ersteLocations: number[] = [];
    for (let s = 0; s < 6; s++) {
      const scene = container.scenes[s];
      if (!scene) continue;
      const locs = scene.formations
        .filter((f) => f.slots.some((x) => x.enemyTypeId !== 0xffff))
        .map((f) => f.location);
      console.log(`K5 Szene ${s}: locations ${JSON.stringify(locs)}`);
      for (const l of locs) if (!ersteLocations.includes(l)) ersteLocations.push(l);
    }

    for (const location of [...new Set([...ersteLocations, 0, 15, 30, 45, 58, 75, 89])]) {
      const prefix = stagePrefixForLocation(location, [...proPraefix.keys()].sort());
      expect(prefix).toBeTruthy();
      const stage = await loadBattleStage(prefix!, quelle);
      expect(stage).toBeTruthy();
      const cache = new Map<TextureSource, ReturnType<typeof texRgb>>();
      const tris: Dreieck[] = [];
      for (const mesh of stage!.parts) {
        for (const sub of mesh.submeshes) {
          const tex = sub.textured ? (stage!.textures[sub.textureIndex] ?? null) : null;
          let bild = null;
          if (tex) {
            let b = cache.get(tex);
            if (!b) {
              b = texRgb(tex, (r, g, bl) => [r, g, bl]);
              cache.set(tex, b);
            }
            bild = b;
          }
          for (let i = sub.start; i + 3 <= sub.start + sub.count; i += 3) {
            const p: Vec3[] = [];
            const uv: [number, number][] = [];
            const col: Vec3[] = [];
            for (let e = 0; e < 3; e++) {
              const vi = mesh.indices[i + e]!;
              p.push(
                battleToScene([mesh.positions[vi * 3]!, mesh.positions[vi * 3 + 1]!, mesh.positions[vi * 3 + 2]!]),
              );
              uv.push([mesh.uvs[vi * 2] ?? 0, mesh.uvs[vi * 2 + 1] ?? 0]);
              col.push([mesh.colors[vi * 4] ?? 255, mesh.colors[vi * 4 + 1] ?? 255, mesh.colors[vi * 4 + 2] ?? 255]);
            }
            tris.push({
              p: [p[0]!, p[1]!, p[2]!],
              uv: [uv[0]!, uv[1]!, uv[2]!],
              col: [col[0]!, col[1]!, col[2]!],
              tex: bild,
            });
          }
        }
      }
      writeFileSync(
        join(OUT, `stage-loc${String(location).padStart(2, '0')}-${prefix}.png`),
        rasterize(tris, { transparenz: true, aufkleberVersatz: true, groesse: { w: 560, h: 420 } }),
      );
      console.log(`K5 Bühne location=${location} → ${prefix}: ${stage!.parts.length} Teile, ${stage!.textures.length} Texturen, ${tris.length} Dreiecke`);
    }
    console.log(`K5-Bilder: ${OUT}`);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
