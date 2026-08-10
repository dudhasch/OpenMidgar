/**
 * Synthetische „Fake-Installation" für NFR-Messläufe ohne Originaldaten
 * (Masterplan-Teststrategie, Zeile E2E: „automatisierter Lauf gegen
 * synthetische Volldaten"). Alle Bytes stammen aus den eigenen Writern in
 * `tools/fixture-gen` — es liegt nichts Originales im Repository und der
 * Messlauf ist auf jeder Maschine reproduzierbar.
 *
 * Die Installation ist bewusst **strukturgleich**, nicht größengleich: ein
 * LGP-Archiv `data/field/flevel.lgp` mit N Field-Einträgen plus `maplist`,
 * jedes Field mit Script, Kamera, Palette, Walkmesh, Triggern/Gateways und
 * einem Hintergrund samt Texturseite. Damit läuft dieselbe Kette wie auf
 * echten Daten (Scan → Slice-Read → LZS → Container → Sitzung → Atlas), nur
 * schneller. Der Absolutwert einer Messung auf dieser Installation ist
 * deshalb **keine** Aussage über die Realdatenlast — dafür gibt es den
 * Realdatenlauf. Aussagekräftig ist hier die Leckfreiheit über viele Zyklen.
 */

import {
  composeBackgroundSection,
  composeCameraSection,
  composeCompressedField,
  composeMaplist,
  composePaletteSection,
  composeScriptSection,
  composeTriggersSection,
  composeWalkmeshSection,
  buildLgp,
  ScriptAssembler,
  type BgTileSpec,
  type Rgba8,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { SECTION, type Vec3 } from '@webmidgar/formats-field';
import { MemoryDirectorySource, MemorySourceFile } from '@webmidgar/io';

export interface FakeInstallationOptionen {
  /** Anzahl der Fields im Archiv (Standard 12). */
  fields?: number;
  /** Kacheln je Field (Standard 512) — bestimmt die Atlasarbeit. */
  kacheln?: number;
  /** Kantenlänge des Walkmesh-Gitters in Zellen (Standard 6 ⇒ 72 Dreiecke). */
  gitter?: number;
  /** Texturseiten je Field (Standard 1 ⇒ 64 KiB Rohdaten). */
  texturseiten?: number;
}

export interface FakeInstallation {
  quelle: MemoryDirectorySource;
  archivPfad: string;
  archivBytes: number;
  fieldNamen: string[];
  /** Unkomprimierte Gesamtgröße aller Field-Container. */
  rohBytes: number;
}

/** Deterministischer PRNG (mulberry32) — kein `Math.random` in Fixtures. */
function prng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gitterWalkmesh(zellen: number, kante: number): WalkmeshSpec {
  const triangles: WalkmeshSpec['triangles'] = [];
  for (let gy = 0; gy < zellen; gy++) {
    for (let gx = 0; gx < zellen; gx++) {
      const x0 = gx * kante;
      const y0 = gy * kante;
      const x1 = x0 + kante;
      const y1 = y0 + kante;
      const a: Vec3 = [x0, y0, 0];
      const b: Vec3 = [x1, y0, 0];
      const c: Vec3 = [x0, y1, 0];
      const d: Vec3 = [x1, y1, 0];
      triangles.push({ vertices: [a, b, c] });
      triangles.push({ vertices: [b, d, c] });
    }
  }
  return { triangles };
}

function paletteSeiten(anzahl: number): Rgba8[][] {
  const seiten: Rgba8[][] = [];
  for (let p = 0; p < anzahl; p++) {
    const farben: Rgba8[] = [];
    for (let i = 0; i < 256; i++) {
      // Index 0 bleibt transparent (Colorkey-Konvention der Kacheln).
      farben.push(i === 0 ? [0, 0, 0, 0] : [(i * 7) & 0xff, (i * 13 + p * 31) & 0xff, (i * 3) & 0xff, 255]);
    }
    seiten.push(farben);
  }
  return seiten;
}

/**
 * Texturseite mit **lokal kohärentem** Inhalt statt weißem Rauschen. Das ist
 * nicht Kosmetik: Rauschen ist inkompressibel und treibt die LZS-Kompression
 * des Fixture-Writers in den Literalpfad — der Aufbau der Fake-Installation
 * dauerte damit ein Vielfaches der eigentlichen Messung. Echte Texturseiten
 * sind palettenindiziert und flächig; die Blockstruktur hier bildet das ab.
 */
function texturseite(seed: number): Uint8Array {
  const daten = new Uint8Array(65536);
  const rnd = prng(seed);
  // Blockgröße 4096: Der Greedy-Kompressor der fixture-gen sucht Referenzen
  // linear über das 4-KiB-Fenster. Bei feinkörnigem Inhalt landet fast jedes
  // Byte im Literalpfad und der Aufbau kostete gemessen 1,8 s je Seite; mit
  // flächigen Blöcken sind es 31 ms — bei identischer Struktur.
  const blockGroesse = 4096;
  for (let block = 0; block * blockGroesse < daten.length; block++) {
    const wert = Math.floor(rnd() * 256);
    daten.fill(wert, block * blockGroesse, (block + 1) * blockGroesse);
  }
  return daten;
}

function kachelListe(anzahl: number, seed: number, texturseiten: number): BgTileSpec[] {
  const rnd = prng(seed);
  const tiles: BgTileSpec[] = [];
  for (let i = 0; i < anzahl; i++) {
    tiles.push({
      dstX: ((i * 16) % 320) - 160,
      dstY: (Math.floor(i / 20) * 16) % 224 - 112,
      srcX: (Math.floor(rnd() * 16) * 16) & 0xff,
      srcY: (Math.floor(rnd() * 16) * 16) & 0xff,
      paletteId: Math.floor(rnd() * 2),
      textureId: Math.floor(rnd() * texturseiten),
      z: 4095,
      bpp: 1,
    });
  }
  return tiles;
}

/**
 * Script mit Dauerlast: ein Kontext, der pro Takt rechnet und wartet. Ohne
 * `wait` liefe der Kontext bis zum Budget durch und die Messung würde die
 * Budgetgrenze statt der Sitzungsarbeit messen.
 */
function scriptBytes(): Uint8Array {
  const asm = new ScriptAssembler();
  asm
    .label('start')
    .setByte(1, 0, 1)
    .inc(1, 1)
    .plus(1, 2, { bank: 1, addr: 1 })
    .wait(2)
    .jmpb('start');
  const haupt = asm.assemble();

  const zweit = new ScriptAssembler();
  zweit.label('npc').wait(4).ret();
  const npc = zweit.assemble();

  const bytes = new Uint8Array(haupt.bytes.length + npc.bytes.length);
  bytes.set(haupt.bytes, 0);
  bytes.set(npc.bytes, haupt.bytes.length);
  return bytes;
}

const SCRIPT_BYTES = scriptBytes();
const NPC_EINSTIEG = SCRIPT_BYTES.length - 4;

export function fieldName(index: number): string {
  return `nfr${String(index).padStart(3, '0')}`;
}

export function baueFakeInstallation(opts: FakeInstallationOptionen = {}): FakeInstallation {
  const anzahlFields = opts.fields ?? 12;
  const kacheln = opts.kacheln ?? 512;
  const zellen = opts.gitter ?? 6;
  const seiten = opts.texturseiten ?? 1;

  const namen = Array.from({ length: anzahlFields }, (_, i) => fieldName(i));
  const eintraege: { name: string; data: Uint8Array }[] = [];
  let rohBytes = 0;

  namen.forEach((name, i) => {
    // Gateways verbinden die Fields zu einem Ring — der Wechselpfad ist damit
    // auch in der Fake-Installation ein echter Graph und kein Sonderfall.
    const naechstes = (i + 1) % anzahlFields;
    const vorheriges = (i - 1 + anzahlFields) % anzahlFields;
    const kante = 40;
    const spanne = zellen * kante;

    const sections: Record<number, Uint8Array> = {
      [SECTION.SCRIPT]: composeScriptSection({
        entities: [
          { name: 'held', entryPoints: [0] },
          { name: 'npc', entryPoints: [NPC_EINSTIEG] },
        ],
        scriptBytes: SCRIPT_BYTES,
        strings: [new TextEncoder().encode('nfr')],
      }),
      [SECTION.CAMERA]: composeCameraSection([
        { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], position: [0, 0, -4096], zoom: 400 },
      ]),
      [SECTION.PALETTE]: composePaletteSection({ pages: paletteSeiten(2) }),
      [SECTION.WALKMESH]: composeWalkmeshSection(gitterWalkmesh(zellen, kante)),
      [SECTION.TRIGGERS]: composeTriggersSection({
        name,
        control: 1,
        cameraRange: [-160, -120, 160, 120],
        gateways: [
          { exitLine: [[spanne - 1, 0, 0], [spanne - 1, spanne, 0]], destMaplistIndex: naechstes },
          { exitLine: [[1, 0, 0], [1, spanne, 0]], destMaplistIndex: vorheriges },
        ],
        triggers: [{ corners: [[10, 10, 0], [60, 60, 10]], behavior: 1, soundId: 2 }],
      }),
      [SECTION.BACKGROUND]: composeBackgroundSection({
        layers: { 0: { width: 320, height: 224, tiles: kachelListe(kacheln, 0x9e37 + i, seiten) } },
        texturePages: Array.from({ length: seiten }, (_, s) => ({
          slot: s,
          depth: 1 as const,
          data: texturseite(0x1234 + i * 16 + s),
        })),
      }),
    };
    const komprimiert = composeCompressedField({ sections });
    rohBytes += komprimiert.length;
    eintraege.push({ name, data: komprimiert });
  });

  eintraege.push({ name: 'maplist', data: composeMaplist(namen) });

  const archiv = buildLgp({ entries: eintraege });
  const pfad = 'data/field/flevel.lgp';
  const datei = new MemorySourceFile(pfad, archiv.bytes, 1_700_000_000_000);
  return {
    quelle: new MemoryDirectorySource([datei]),
    archivPfad: pfad,
    archivBytes: archiv.bytes.length,
    fieldNamen: namen,
    rohBytes,
  };
}
