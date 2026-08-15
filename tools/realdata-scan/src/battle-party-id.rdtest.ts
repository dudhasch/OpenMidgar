import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import { buildAsciiTable, decodeFfText, DEFAULT_ASCII_OFFSET, parseKernelContainer } from '@webmidgar/formats-kernel';
import { assignPartsToBones, battleSkeletonToSkeleton, BATTLE_ROOT_EXTRA_X_DEG } from '@webmidgar/render-battle';
import { hasPSignature, hasTexSignature, parseP, parseTex, type TextureSource } from '@webmidgar/formats-model';
import { bindPoseFrame } from '@webmidgar/render-actor';
import { NodeDirectorySource } from './node-source.js';
import { dreiecke, rasterize, type Dreieck, type Modell, type Vec3 } from './sheet.js';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * K4 — WELCHE FIGUR TRÄGT WELCHES BATTLE-PRÄFIX?
 *
 * Ausgangslage (gemessen, `battle-model-loader.rdtest.ts`): battle.lgp hat 481
 * Präfixe in drei scharf getrennten Bändern. Das dritte Band (21 Präfixe,
 * Index 460…480) enthält die spielbaren Figuren. Bekannt war nur die
 * BEHAUPTUNG „rt = Cloud" aus `docs/quellen/gears-pdf.md` §9 — unbelegt.
 *
 * Drei unabhängige Achsen, damit keine Zeile auf einer einzigen Stütze steht:
 *  1. **Sichtbefund** — jedes Präfix wird in Bindpose gerendert
 *     (Produktionsregel: +len, Wurzel-Frame-X 270°), Front und Seite, groß
 *     genug zum Erkennen, und ANGESEHEN.
 *  2. **Kennzahlen und Byte-Identität** — Bones, Körper-/Waffenteile, Texturen,
 *     Dreiecke, `ab`/`da`-Längen; dazu ein byteweiser Vergleich der Körper-,
 *     Waffen- und Animationsdateien über alle 21 Präfixe.
 *  3. **Charakterreihenfolge aus kernel.bin** — ohne sie ist die
 *     Kontrollhypothese „Präfixindex = 460 + charakterId" gar nicht prüfbar.
 *
 * Urheberrecht: Aus den Realdaten wird KEIN dekodierter Text protokolliert.
 * Die Namen im Bericht stammen aus der Erwartungsliste dieses Tests; gemeldet
 * wird nur, an welcher Stelle ein Treffer lag.
 *
 * Ausgabe: PNGs unter `%TEMP%/webmidgar-sheets/k4/` plus Kennzahlen auf stdout.
 */

const available = existsSync(join(REAL_DIR, 'data', 'battle'));

const OUT = process.env['WEBMIDGAR_K4_OUT'] ?? join(tmpdir(), 'webmidgar-sheets', 'k4');

const ZELLE = { w: 380, h: 470 };

/** Erwartungsliste — Eingabe des Tests, NICHT aus den Realdaten gewonnen. */
const ERWARTETE_NAMEN = [
  'Cloud',
  'Barret',
  'Tifa',
  'Aerith',
  'Red XIII',
  'Yuffie',
  'Cait Sith',
  'Vincent',
  'Cid',
  'Sephiroth',
];

/** Drehung der fertigen Szene-Dreiecke um die Szenen-Hochachse Y. */
function dreheUmY(tris: Dreieck[], grad: number): Dreieck[] {
  const c = Math.cos((grad * Math.PI) / 180);
  const s = Math.sin((grad * Math.PI) / 180);
  const r = (p: Vec3): Vec3 => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  return tris.map((t) => ({ ...t, p: [r(t.p[0]), r(t.p[1]), r(t.p[2])] as [Vec3, Vec3, Vec3] }));
}

/** FNV-1a über den Dateiinhalt, mit Länge davor (Kollisionsschutz). */
function hash(b: Uint8Array | undefined): string {
  if (!b) return '-';
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${b.length}:${h.toString(16).padStart(8, '0')}`;
}

/** Suffixraster `aa`…`dz` (deckt das größte vorkommende Suffix `da` ab). */
function suffixe(): string[] {
  const out: string[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 26; c++) out.push(String.fromCharCode(97 + r) + String.fromCharCode(97 + c));
  return out;
}

/** 🟢 Bandgrenze aus `gears-pdf.md` §9, hier unabhängig nachgerechnet. */
const istKoerperSuffix = (s: string): boolean => s >= 'am' && s <= 'cj';
const istWaffenSuffix = (s: string): boolean => s >= 'ck' && s <= 'cz';

describe.skipIf(!available)('K4: Zuordnung Präfix → Spielfigur (Sichtbefund + Zweitbeleg)', () => {
  it('rendert das dritte Präfixband und misst seine Kennzahlen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('battle')];
    const bytesOf = new Map<string, Uint8Array>();
    for (const e of entries) bytesOf.set(e.name, await index.readEntry(e.canonicalId));

    const proPraefix = new Map<string, string[]>();
    for (const name of bytesOf.keys()) {
      const pre = name.slice(0, 2);
      if (!proPraefix.has(pre)) proPraefix.set(pre, []);
      proPraefix.get(pre)!.push(name);
    }
    const praefixe = [...proPraefix.keys()].sort();
    expect(praefixe.length).toBe(481);

    // --- Bandgrenzen unabhängig nachrechnen (nicht aus der Aufgabe glauben) --
    const skelettlos: string[] = [];
    for (const pre of praefixe) {
      const { skeleton } = parseBattleSkeleton(bytesOf.get(pre + 'aa')!, pre + 'aa');
      if ((skeleton?.boneCount ?? 0) === 0) skelettlos.push(pre);
    }
    const ersterOhne = praefixe.indexOf(skelettlos[0]!);
    const letzterOhne = praefixe.indexOf(skelettlos[skelettlos.length - 1]!);
    console.log(
      `K4-Bänder: skelettlos ${skelettlos.length} Präfixe, ${skelettlos[0]}…${skelettlos[skelettlos.length - 1]} ` +
        `(Index ${ersterOhne}…${letzterOhne}); drittes Band ab Index ${letzterOhne + 1} = ` +
        `${praefixe[letzterOhne + 1]}…${praefixe[praefixe.length - 1]}`,
    );
    // Das Band muss ZUSAMMENHÄNGEND sein, sonst ist die Bandrede falsch.
    expect(letzterOhne - ersterOhne + 1).toBe(skelettlos.length);

    const band3 = praefixe.slice(letzterOhne + 1);
    mkdirSync(OUT, { recursive: true });

    const zeilen: string[] = [];
    for (const [i, prefix] of band3.entries()) {
      const namen = proPraefix.get(prefix)!.slice().sort();
      const { skeleton: bs } = parseBattleSkeleton(bytesOf.get(prefix + 'aa')!, prefix + 'aa');
      if (!bs) continue;

      const parts = [];
      const texturen: (TextureSource | null)[] = [];
      let koerper = 0;
      let waffen = 0;
      for (const name of namen) {
        if (name === prefix + 'aa') continue;
        const bytes = bytesOf.get(name)!;
        const suffix = name.slice(2);
        if (hasPSignature(bytes)) {
          const p = parseP(bytes, name).value;
          if (p) parts.push(p);
          if (istKoerperSuffix(suffix)) koerper++;
          else waffen++;
          continue;
        }
        if (hasTexSignature(bytes)) texturen.push(parseTex(bytes, name).value);
      }
      const { boneToPart, unassignedParts } = assignPartsToBones(bs, parts.length);
      const skeleton = battleSkeletonToSkeleton(bs, prefix);
      const res = new Map<number, { mesh: (typeof parts)[number]; texturen: (TextureSource | null)[] }[]>();
      for (const [bone, part] of boneToPart) res.set(bone, [{ mesh: parts[part]!, texturen }]);
      const frame = bindPoseFrame(skeleton);
      const modell: Modell = {
        skeleton,
        res,
        clip: { schemaVersion: 1, frames: [frame], boneCount: bs.boneCount, rotationOrder: [1, 0, 2], diagnostics: [] },
        texAnzahl: texturen.length,
        texDreiecke: 0,
      };
      const tris = dreiecke(modell, {
        palette: 'BGRA (heute)',
        flipU: false,
        flipV: false,
        vertexPerm: null,
        frame: { ...frame, rootRotation: [BATTLE_ROOT_EXTRA_X_DEG, 0, 0] },
      });
      const ansichten: (readonly [string, number])[] = [
        ['front', 0],
        ['seite', 90],
      ];
      // Für die schwer erkennbaren Präfixe zusätzliche Winkel.
      if (['rs', 'sa', 'rw', 'sj'].includes(prefix))
        ansichten.push(['w045', 45], ['w135', 135], ['w180', 180], ['w225', 225], ['w270', 270], ['w315', 315]);
      for (const [ansicht, grad] of ansichten) {
        writeFileSync(
          join(OUT, `${String(i).padStart(2, '0')}-${prefix}-${ansicht}.png`),
          rasterize(dreheUmY(tris, grad), { transparenz: true, aufkleberVersatz: true, groesse: ZELLE }),
        );
      }

      const ab = bytesOf.get(prefix + 'ab');
      const da = bytesOf.get(prefix + 'da');
      let dreieckeGesamt = 0;
      for (const p of parts) for (const sm of p.submeshes) dreieckeGesamt += sm.count / 3;
      zeilen.push(
        `${String(i).padStart(2, '0')} ${prefix}  bones=${String(bs.boneCount).padStart(2)} ` +
          `teile=${String(parts.length).padStart(2)} (koerper=${String(koerper).padStart(2)} waffen=${String(waffen).padStart(2)}) ` +
          `flagBones=${String(bs.bones.filter((b) => b.hasGeometry).length).padStart(2)} ` +
          `unzug=${String(unassignedParts.length).padStart(2)} tex=${texturen.length} ` +
          `tris=${String(dreieckeGesamt).padStart(4)} ab=${ab ? ab.length : '-'} da=${da ? da.length : '-'} ` +
          `dateien=${namen.length}`,
      );
    }
    console.log(`K4-Kennzahlen (drittes Band, ${band3.length} Präfixe):\n${zeilen.join('\n')}`);
    console.log(`K4-Bilder: ${OUT}`);
    expect(band3.length).toBe(21);
    await dir.closeAll();
  }, 900_000);

  /**
   * ZWEITBELEG ohne Auge: Byte-Identität. Der Sichtbefund zeigt, dass
   * `sb`…`se` und `sf`…`sh` DASSELBE Bild liefern. Erst der Byte-Vergleich
   * trennt „ein Charakter, mehrere Waffensätze" von „mehrere Figuren, die
   * zufällig gleich aussehen". Ebenso für `si` gegen `rt`.
   */
  it('vergleicht Körper-, Waffen- und Animationsdateien byteweise', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const bytesOf = new Map<string, Uint8Array>();
    for (const e of index.listEntries('battle')) bytesOf.set(e.name, await index.readEntry(e.canonicalId));

    const band3 = ['rs', 'rt', 'ru', 'rv', 'rw', 'rx', 'ry', 'rz', 'sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm'];
    const koerperH = new Map<string, string>();
    const waffenH = new Map<string, string>();
    const daH = new Map<string, string>();
    const abH = new Map<string, string>();
    const waffenEinzeln = new Map<string, string[]>();
    for (const p of band3) {
      const koerper: string[] = [];
      const waffen: string[] = [];
      for (const s of suffixe()) {
        const b = bytesOf.get(p + s);
        if (!b || !hasPSignature(b)) continue;
        if (istKoerperSuffix(s)) koerper.push(hash(b));
        else if (istWaffenSuffix(s)) waffen.push(hash(b));
      }
      koerperH.set(p, koerper.join('|'));
      waffenH.set(p, waffen.join('|'));
      waffenEinzeln.set(p, waffen);
      daH.set(p, hash(bytesOf.get(p + 'da')));
      abH.set(p, hash(bytesOf.get(p + 'ab')));
    }

    const klassen = (m: Map<string, string>): string[] => {
      const inv = new Map<string, string[]>();
      for (const [p, h] of m) {
        if (!inv.has(h)) inv.set(h, []);
        inv.get(h)!.push(p);
      }
      return [...inv.values()].filter((g) => g.length > 1).map((g) => g.join('='));
    };

    console.log(`K4-Byteidentitaet Koerperteile, Klassen >1: ${JSON.stringify(klassen(koerperH))}`);
    console.log(`K4-Byteidentitaet Waffenteile, Klassen >1: ${JSON.stringify(klassen(waffenH))}`);
    console.log(`K4-Byteidentitaet 'da' (Anim), Klassen >1: ${JSON.stringify(klassen(daH))}`);
    console.log(`K4-Byteidentitaet 'ab', Klassen >1: ${JSON.stringify(klassen(abH))}`);
    for (const p of ['rt', 'sb', 'sc', 'sf', 'sg', 'si']) {
      const w = waffenEinzeln.get(p)!;
      console.log(`K4 Waffen ${p}: ${w.length} Dateien, ${new Set(w).size} verschieden`);
    }
    // KONTROLLE: Überschneiden sich die Waffensätze verschiedener Präfixe?
    for (const [a, b] of [
      ['sb', 'sc'],
      ['sb', 'sd'],
      ['sf', 'sg'],
      ['rt', 'si'],
      ['rt', 'sb'],
    ] as const) {
      const menge = new Set(waffenEinzeln.get(a)!);
      const gemeinsam = waffenEinzeln.get(b)!.filter((h) => menge.has(h)).length;
      console.log(`K4 Waffenueberschneidung ${a} und ${b}: ${gemeinsam}/16`);
    }
    expect(band3.length).toBe(21);
    await dir.closeAll();
  }, 900_000);

  /**
   * DRITTE Achse: die CHARAKTER-REIHENFOLGE aus kernel.bin. Die Sektion mit
   * den Anfangs-Charakterdaten trägt feste Sätze; aus dem Abstand der Treffer
   * fallen Satzlänge und Namensversatz ab, und damit die Reihenfolge, gegen
   * die die Kontrollhypothese „Präfixindex = 460 + charakterId" geprüft wird.
   */
  it('liest die Charakterreihenfolge aus kernel.bin', async () => {
    const pfad = realPfad('kernel/KERNEL.BIN');
    const container = await parseKernelContainer(await readFile(pfad), 'KERNEL.BIN');
    expect(container).toBeTruthy();
    const tabelle = buildAsciiTable(DEFAULT_ASCII_OFFSET);

    for (const [si, sec] of container!.sections.entries()) {
      const treffer: { name: string; off: number }[] = [];
      for (let off = 0; off + 12 <= sec.data.length; off++) {
        const txt = decodeFfText(sec.data.subarray(off, off + 12), tabelle).text;
        const name = ERWARTETE_NAMEN.find((n) => txt.startsWith(n));
        if (name && !treffer.some((t) => t.name === name)) treffer.push({ name, off });
      }
      if (treffer.length < 5) continue;
      const abstaende = treffer.slice(1).map((t, i) => t.off - treffer[i]!.off);
      console.log(
        `K4-Kernel Sektion ${si} (${sec.data.length} B): ` +
          treffer.map((t, i) => `${i}:${t.name}@0x${t.off.toString(16)}`).join(' ') +
          ` | Abstaende ${JSON.stringify(abstaende)}`,
      );
      // Satzraster: kleinster Abstand = Satzlänge. Damit jeden Satz ansprechen
      // und die Reihenfolge als Charakter-ID-Liste ausgeben.
      const stride = Math.min(...abstaende);
      const nameOff = treffer[0]!.off % stride;
      const folge: string[] = [];
      for (let r = 0; (r + 1) * stride <= sec.data.length; r++) {
        const off = r * stride + nameOff;
        if (off + 12 > sec.data.length) break;
        const roh = sec.data.subarray(off, off + 12);
        const txt = decodeFfText(roh, tabelle).text;
        const treff = ERWARTETE_NAMEN.find((n) => txt.startsWith(n));
        if (treff) {
          folge.push(treff);
          continue;
        }
        // Kein Treffer: NUR die Struktur melden, nie den Originaltext.
        let len = 0;
        while (len < roh.length && roh[len] !== 0xff) len++;
        folge.push(len === 0 ? 'leer' : `unbekannt(${len})`);
      }
      console.log(`K4-Kernel Satzraster ${stride} B, Namensversatz ${nameOff}: ${JSON.stringify(folge)}`);
    }
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
