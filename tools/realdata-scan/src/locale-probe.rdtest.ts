import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKernelContainer } from '@webmidgar/formats-kernel';
import { parseSceneBin } from '@webmidgar/formats-battle';
import {
  LOCALE_VERBUND,
  loeseLocale,
  normalisierePfad,
  pruefeVerbund,
  verfuegbareLocales,
  waehleLocale,
  type LocaleAuswahl,
} from '@webmidgar/io';

/**
 * F-LOC — Realdatenabnahme „Sprachzweig".
 *
 * **Der Anlass.** Die Installation legt einen Teil ihrer Daten doppelt ab:
 * `data/<rel>` und `data/lang-<code>/<rel>`. Bis 2026-08-15 las das Projekt
 * ausnahmslos den Wurzelzweig — auf dieser Installation ist das der
 * **deutsche**, während das Original nachweislich `data/lang-en/` lädt.
 *
 * **Der Wahrheitstest ist kein Größenvergleich, sondern eine Kreuzprobe.**
 * `kernel.bin` trägt in Sektion 2 bei `+0x0F1C` eine `0xFF`-terminierte
 * Bytetabelle „Block → erste Szene" für `scene.bin`. Ihre Eintragszahl mal
 * `0x2000` muss die Dateigröße der `scene.bin` **desselben Zweigs** byteexakt
 * treffen. Das ist ein **externer** Test: Die Prüfmenge steht in einer anderen
 * Datei, und ein falsch gepaarter Zweig kann sie nicht zufällig treffen.
 *
 * **Die Kontrolle ist die Kreuzpaarung.** Deutsche `kernel.bin` gegen
 * englische `scene.bin` und umgekehrt müssen **fehlschlagen** — sonst misst
 * die Gütefunktion nichts. Genau diese Kontrolle fehlte den früheren
 * Größenargumenten.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Größen und Sektionskennzahlen.
 * Dekodierter Originaltext wird nicht protokolliert.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN'));

const BLOCK = 0x2000;
/** Blockindex „Block → erste Szene" in kernel.bin-Sektion 2. */
const BLOCKINDEX_OFF = 0x0f1c;
const BLOCKINDEX_LEN = 64;

/** Alle Dateien der Installation unterhalb von `data/`, '/'-normalisiert. */
async function dateibaum(): Promise<Set<string>> {
  const { readdir } = await import('node:fs/promises');
  const out = new Set<string>();
  const lauf = async (abs: string, rel: string): Promise<void> => {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      const a = join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await lauf(a, r);
      else out.add(normalisierePfad(r));
    }
  };
  await lauf(join(REAL_DIR, 'data'), 'data');
  return out;
}

async function sektion2(pfad: string): Promise<Uint8Array> {
  const container = await parseKernelContainer(await readFile(pfad), 'KERNEL.BIN');
  expect(container, `kernel.bin nicht lesbar: ${pfad}`).not.toBeNull();
  const s = container!.sections[2];
  expect(s, 'Sektion 2 fehlt').toBeDefined();
  return s!.data;
}

/**
 * Entpackte Szenen als Rohbytes — **absichtlich eine zweite, unabhängige
 * Implementierung** (`node:zlib` statt `DecompressionStream`). Der Vergleich
 * unten soll nicht von der Deutung des Projektparsers abhängen; dass beide
 * Wege auf dieselben 256 Szenen kommen, ist zugleich dessen Gegenprobe.
 */
async function rohSzenen(pfad: string): Promise<Uint8Array[]> {
  const { inflateRawSync } = await import('node:zlib');
  const b = await readFile(pfad);
  const out: Uint8Array[] = [];
  for (let bo = 0; bo < b.length; bo += BLOCK) {
    const zeiger: number[] = [];
    for (let i = 0; i < 16; i++) zeiger.push(b.readUInt32LE(bo + i * 4) * 4);
    for (let i = 0; i < 16; i++) {
      if (zeiger[i]! >= BLOCK) continue;
      const start = bo + zeiger[i]!;
      const ende = i + 1 < 16 && zeiger[i + 1]! < BLOCK ? bo + zeiger[i + 1]! : bo + BLOCK;
      const chunk = b.subarray(start, ende);
      if (chunk[0] !== 0x1f || chunk[1] !== 0x8b) continue;
      out.push(new Uint8Array(inflateRawSync(chunk.subarray(10))));
    }
  }
  return out;
}

/** Einträge des Blockindex bis zum `0xFF`-Abschluss. */
function blockindex(sektion: Uint8Array): number[] {
  const w: number[] = [];
  for (let i = BLOCKINDEX_OFF; i < BLOCKINDEX_OFF + BLOCKINDEX_LEN; i++) {
    if (sektion[i] === 0xff) break;
    w.push(sektion[i]!);
  }
  return w;
}

describe.skipIf(!available)('F-LOC — Sprachzweig der Installation', () => {
  it('findet den Sprachzweig und löst die Verbunddateien einheitlich auf', async () => {
    const baum = await dateibaum();
    const zweige = verfuegbareLocales(baum);
    const locale = waehleLocale(zweige);

    const auswahlen: LocaleAuswahl[] = [];
    const fehlend: string[] = [];
    for (const rel of LOCALE_VERBUND) {
      const a = loeseLocale(rel, locale, (p) => baum.has(p));
      if (a) auswahlen.push(a);
      else fehlend.push(rel);
    }

    console.log('\n[F-LOC] Sprachzweige:', zweige.length ? zweige.join(', ') : '(keine)');
    console.log('[F-LOC] gewählt:', locale ?? '(Wurzel)');
    for (const a of auswahlen) console.log(`[F-LOC]   ${a.rel} → ${a.pfad}`);
    if (fehlend.length) console.log('[F-LOC] nicht vorhanden:', fehlend.join(', '));

    // Die Installation, gegen die kalibriert wird, führt genau einen Zweig.
    expect(zweige.length).toBeGreaterThan(0);
    expect(auswahlen.length).toBeGreaterThanOrEqual(4);
    expect(pruefeVerbund(auswahlen)).toBeNull();
  });

  it('kreuzvalidiert den Blockindex gegen die Größe der scene.bin — mit Gegenpaarung', async () => {
    const paare = [
      {
        name: 'Wurzel',
        kernel: join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN'),
        scene: join(REAL_DIR, 'data', 'battle', 'scene.bin'),
      },
      {
        name: 'lang-en',
        kernel: join(REAL_DIR, 'data', 'lang-en', 'kernel', 'KERNEL.BIN'),
        scene: join(REAL_DIR, 'data', 'lang-en', 'battle', 'scene.bin'),
      },
    ].filter((p) => existsSync(p.kernel) && existsSync(p.scene));
    expect(paare.length, 'beide Zweige nötig, sonst misst die Gegenprobe nichts').toBe(2);

    const gemessen = [] as { name: string; eintraege: number; bloecke: number }[];
    for (const p of paare) {
      const idx = blockindex(await sektion2(p.kernel));
      const bloecke = statSync(p.scene).size / BLOCK;
      gemessen.push({ name: p.name, eintraege: idx.length, bloecke });
      console.log(
        `[F-LOC] ${p.name}: Blockindex ${idx.length} Einträge, scene.bin ${statSync(p.scene).size} B = ${bloecke} Blöcke`,
      );
      // Der eigentliche Befund: eigene Paarung trifft byteexakt.
      expect(bloecke, `${p.name}: Blockindex trifft die eigene scene.bin nicht`).toBe(idx.length);
      // Monotonie — ein Index, der nicht steigt, wäre falsch ausgerichtet.
      for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
      expect(idx[0]).toBe(0);
    }

    // KONTROLLE: Die Kreuzpaarung muss scheitern. Täte sie es nicht, wäre die
    // Kreuzvalidierung blind und der Befund oben wertlos.
    const [wurzel, en] = gemessen as [(typeof gemessen)[0], (typeof gemessen)[0]];
    expect(wurzel.eintraege).not.toBe(en.bloecke);
    expect(en.eintraege).not.toBe(wurzel.bloecke);
    console.log(
      `[F-LOC] Kontrolle: Kreuzpaarung scheitert (${wurzel.eintraege}≠${en.bloecke}, ${en.eintraege}≠${wurzel.bloecke}) — die Probe trennt.`,
    );
  });

  it('belegt, worin sich die beiden scene.bin unterscheiden — und worin nicht', async () => {
    // Beide Zweige einmal durch den Projektparser, damit die Szenenzahl aus
    // der Produktionskette stammt und nicht aus dem Rohleser unten.
    const geparst = await parseSceneBin(
      await readFile(join(REAL_DIR, 'data', 'lang-en', 'battle', 'scene.bin')),
      'lang-en/scene.bin',
    );
    expect(geparst.scenes.filter((s) => s !== null).length).toBe(256);

    const de = await rohSzenen(join(REAL_DIR, 'data', 'battle', 'scene.bin'));
    const en = await rohSzenen(join(REAL_DIR, 'data', 'lang-en', 'battle', 'scene.bin'));
    expect(de.length).toBe(256);
    expect(en.length).toBe(256);

    /**
     * Partitionen der entpackten Szene. Verglichen wird auf den Rohbytes, weil
     * eine gedeutete Gegenüberstellung die Frage beantworten würde, die der
     * Parser schon entschieden hat.
     */
    const BEREICHE: [string, number, number][] = [
      ['enemyIds', 0x000, 0x008],
      ['setup', 0x008, 0x058],
      ['camera', 0x058, 0x118],
      ['formation', 0x118, 0x298],
      ['attack', 0x4c0, 0x840],
      ['formationAi', 0xc80, 0xe80],
    ];

    const zaehler = new Map<string, number>();
    for (const [name] of BEREICHE) zaehler.set(name, 0);
    for (let i = 0; i < 256; i++) {
      const a = de[i]!;
      const b = en[i]!;
      for (const [name, von, bis] of BEREICHE) {
        for (let o = von; o < bis; o++) {
          if (a[o] !== b[o]) {
            zaehler.set(name, zaehler.get(name)! + 1);
            break;
          }
        }
      }
    }
    for (const [name] of BEREICHE) {
      console.log(`[F-LOC] ${name.padEnd(12)} unterschiedlich in ${zaehler.get(name)}/256 Szenen`);
    }

    /**
     * DAUERBEFUND. Die mechanischen Partitionen sind zwischen den Zweigen
     * gleich — bis auf **genau eine** Szene, die im englischen Zweig
     * vollständig leergeräumt ist. Deshalb steht hier `1` und nicht `0`:
     * Eine Null zu erwarten wäre falsch, und eine Obergrenze „klein" wäre
     * keine Vorhersage.
     *
     * Praktische Folge, die K8 betrifft: Die Kameras der Formation 301
     * (Szene 75) sind in beiden Zweigen byteidentisch — der 🟢-Befund aus K8
     * hängt nicht am Sprachzweig.
     */
    for (const [name] of BEREICHE) {
      expect(zaehler.get(name), `${name} weicht in mehr als der einen Szene ab`).toBe(1);
    }

    // Szene 75 (Formation 301) namentlich, weil daran ein Befund hängt.
    const a75 = de[75]!;
    const b75 = en[75]!;
    let gleich = true;
    for (let o = 0x058; o < 0x298; o++) if (a75[o] !== b75[o]) gleich = false;
    expect(gleich, 'Kamera/Formation der Szene 75 hängen doch am Sprachzweig').toBe(true);
  });
});
