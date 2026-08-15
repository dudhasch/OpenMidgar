import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scanLgp, resolvableEntries } from '@webmidgar/formats-lgp';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource, NodeSourceFile } from './node-source.js';
import { buildAsciiTable, decodeFfText, germanLikeness, DEFAULT_ASCII_OFFSET } from '@webmidgar/formats-kernel';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * S21-Vorprobe „Menü-Grundlagen": drei Messungen, die VOR dem Bau von
 * `packages/menu` beantwortet sein müssen (Methodikstandard seit S7).
 *
 * **M1 — Menü-Assetbestand.** Was liegt in `menu_gm.lgp` (deutsche Fassung)?
 * Anzahl, Namensraum, Dateitypen. Zusätzlich der Vergleich gegen `menu_us.lgp`:
 * Beide Archive sind byte­gleich groß, was zwei völlig verschiedene Ursachen
 * haben kann (identischer Inhalt oder gleich langes, aber anderes Textmaterial)
 * — das ist über den SHA-256 in einem Schritt entscheidbar und bestimmt, ob der
 * Menüpfad überhaupt sprachabhängig laden muss.
 *
 * **M2 — Savemap-Feldlage.** Der S14-Parser liefert den 4340-B-Slot bislang nur
 * als Rohbytes. Für die Menüansichten werden Gil, Spielzeit, Ort, Party und die
 * Charakterrecords gebraucht. Gemessen wird mit vier voneinander unabhängigen
 * Verfahren, jedes mit eigenem Kontrollniveau:
 *
 *  - **M2a Duplikatgruppen.** Das Originalformat führt einen Vorschaublock am
 *    Slotanfang, der Werte aus der eigentlichen Savemap **wiederholt**. Sucht
 *    man Offsetpaare, deren Wert über ALLE belegten Slots übereinstimmt und
 *    dabei zwischen den Slots variiert, fallen genau diese Wiederholungen auf.
 *    Das Verfahren braucht keine Annahme darüber, WAS dort steht — es findet
 *    die Paare aus der Struktur selbst. Kontrolle ist eingebaut: Ein Paar aus
 *    konstanten Feldern (etwa zwei Nullbereiche) wird durch die
 *    Varianzforderung ausgeschlossen.
 *  - **M2b Namensraster.** Charakternamen sind FF-Text mit Terminator 0xFF. Die
 *    Zeichentabelle ist aus S13 belegt, also ist „hier steht ein Name" messbar.
 *    Die Abstände zwischen den Fundstellen ergeben die Recordlänge. Kontrolle:
 *    dieselbe Suche auf byteweise verwürfelten Slots.
 *  - **M2c Ortsindex.** Ein u16 mit Werten < 788 (maplist-Umfang) in allen
 *    belegten Slots, mindestens drei verschiedene Werte, mindestens einer
 *    ≥ 100 — die letzten beiden Forderungen schließen kleine Zähler aus, die
 *    zufällig im Wertebereich liegen.
 *  - **M2d Ordnungspaare.** HP/MP-Paare erfüllen „aktuell ≤ Maximum". Geprüft
 *    wird jedes u16-Offsetpaar innerhalb eines Recordrasters über alle
 *    Charaktere aller Slots; Kontrolle ist die umgekehrte Ungleichung, die bei
 *    einem echten Paar deutlich seltener gilt.
 *
 * **M3 — Kernel-Sektionsrollen.** `kernel.bin` hat 27 Sektionen (S13). Welche
 * sind Recordtabellen, welche Textlisten? Für Recordtabellen wird die Schrittweite
 * über den Spalten-Konstanz-Anteil bestimmt (echte Recordarrays haben Spalten,
 * die über alle Records gleich sind — Polster und ungenutzte Felder). Kontrolle:
 * dieselbe Messung auf verwürfelten Daten. Textlisten erkennt man an der
 * Zeigertabelle am Sektionsanfang; ihre **Stringanzahl** ordnet sie dann einer
 * Recordtabelle zu (gleiche Anzahl ⇒ gehört zusammen).
 *
 * Urheberrecht: Ausgabe ausschließlich Längen, Zähler, Anteile, Digests und
 * abgeleitete Kennzahlen — nie dekodierter Text, nie zusammenhängende Rohbytes
 * aus Datensektionen.
 */


const available = existsSync(REAL_DIR);

const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const SAVE_HEADER_LEN = 9;
/** Umfang der `maplist` laut S11 — Obergrenze für einen gültigen Ortsindex. */
const MAPLIST_COUNT = 788;

const TEXT_TABLE = buildAsciiTable(DEFAULT_ASCII_OFFSET);

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Deterministischer PRNG (mulberry32) — Kontrollhypothesen müssen reproduzierbar sein. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(bytes: Uint8Array, seed: number): Uint8Array {
  const out = bytes.slice();
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// --- M1: Menü-Archive --------------------------------------------------------

interface ArchiveReport {
  datei: string;
  groesse: number;
  sha256: string;
  eintraege: number;
  endungen: Array<{ endung: string; anzahl: number }>;
  groesstenNamenlos: number;
}

async function inventarisiereArchiv(absPath: string, relName: string): Promise<ArchiveReport | null> {
  const s = await stat(absPath);
  const source = new NodeSourceFile(absPath, relName, s.size, s.mtimeMs);
  const bytes = await readFile(absPath);
  // `finally`, weil `scanLgp` bei einem kaputten Archiv wirft — das Handle
  // muss auch dann zu, sonst meldet es die Speicherbereinigung später als
  // unbehandelten Fehler in irgendeiner anderen Probe.
  let result;
  try {
    result = await scanLgp(source, relName, { mode: 'fast' });
  } finally {
    await source.close();
  }
  if (!result.ok || !result.archive) return null;
  const entries = resolvableEntries(result.archive);
  const hist = new Map<string, number>();
  for (const e of entries) {
    const dot = e.name.lastIndexOf('.');
    const ext = dot > 0 ? e.name.slice(dot + 1) : '<ohne>';
    hist.set(ext, (hist.get(ext) ?? 0) + 1);
  }
  return {
    datei: relName,
    groesse: s.size,
    sha256: sha256Hex(bytes),
    eintraege: entries.length,
    endungen: [...hist.entries()]
      .map(([endung, anzahl]) => ({ endung, anzahl }))
      .sort((a, b) => b.anzahl - a.anzahl),
    groesstenNamenlos: entries.filter((e) => e.name.trim() === '').length,
  };
}

// --- M2: Savemap-Messungen ---------------------------------------------------

/**
 * M2a. Offsets, deren Wertfolge über alle Slots identisch ist, in Gruppen
 * zusammenfassen. Eine Gruppe mit ≥2 Offsets und ≥3 verschiedenen Werten ist
 * eine echte Wiederholung derselben Größe an zwei Stellen des Slots.
 */
function duplikatGruppen(slots: Uint8Array[], width: 1 | 2 | 4): Array<{ offsets: number[]; verschiedeneWerte: number }> {
  const views = slots.map((s) => new DataView(s.buffer, s.byteOffset, s.byteLength));
  const readAt = (v: DataView, o: number): number =>
    width === 1 ? v.getUint8(o) : width === 2 ? v.getUint16(o, true) : v.getUint32(o, true);
  const buckets = new Map<string, number[]>();
  const distinct = new Map<string, number>();
  for (let o = 0; o + width <= SLOT_LEN; o++) {
    const values: number[] = [];
    for (const v of views) values.push(readAt(v, o));
    const sig = values.join(',');
    const list = buckets.get(sig);
    if (list) list.push(o);
    else {
      buckets.set(sig, [o]);
      distinct.set(sig, new Set(values).size);
    }
  }
  return [...buckets.entries()]
    .filter(([sig, offsets]) => offsets.length >= 2 && (distinct.get(sig) ?? 0) >= 3)
    .map(([sig, offsets]) => ({ offsets, verschiedeneWerte: distinct.get(sig) ?? 0 }))
    .sort((a, b) => a.offsets[0]! - b.offsets[0]!);
}

/**
 * M2b. Ist an `offset` ein FF-Text-Name der Maximallänge `maxLen`? Gefordert:
 * Terminator innerhalb des Feldes, mindestens zwei Zeichen, ausschließlich
 * namenstaugliche Zeichen und ein Großbuchstabe am Anfang.
 */
function istName(slot: Uint8Array, offset: number, maxLen: number): boolean {
  if (offset + maxLen > slot.length) return false;
  const feld = slot.subarray(offset, offset + maxLen);
  const d = decodeFfText(feld, TEXT_TABLE, 0, maxLen);
  if (!d.terminated) return false;
  if (d.unknownBytes > 0) return false;
  if (d.text.length < 2) return false;
  if (!/^[A-ZÄÖÜ]/.test(d.text)) return false;
  return /^[A-Za-zÄÖÜäöüß0-9 .'-]+$/.test(d.text);
}

/**
 * Trefferquote je Offset statt Alles-oder-nichts. Der Bestand enthält einen
 * sehr dünn beschriebenen Slot (S14-Befund: über 95 % genullt, aber gültige
 * Prüfsumme); eine „in allen Slots"-Forderung würde an ihm jede Fundstelle
 * verwerfen. Gefordert wird deshalb eine hohe Quote, und das Kontrollniveau
 * wird mit derselben Quote gemessen.
 */
function namensFundstellen(slots: Uint8Array[], maxLen: number, mindestQuote: number): number[] {
  const treffer: number[] = [];
  for (let o = 0; o + maxLen <= SLOT_LEN; o++) {
    let hits = 0;
    for (const s of slots) if (istName(s, o, maxLen)) hits++;
    if (hits / slots.length >= mindestQuote) treffer.push(o);
  }
  return treffer;
}

/** Aufeinanderfolgende Offsets zu Blöcken zusammenfassen (Duplikat-Läufe). */
function zuBloecken(gruppen: Array<{ offsets: number[]; verschiedeneWerte: number }>): Array<{
  a: number;
  b: number;
  laenge: number;
  verschiedeneWerte: number;
}> {
  const paare = gruppen
    .filter((g) => g.offsets.length === 2)
    .map((g) => ({ a: g.offsets[0]!, b: g.offsets[1]!, verschiedeneWerte: g.verschiedeneWerte }))
    .sort((x, y) => x.a - y.a);
  const out: Array<{ a: number; b: number; laenge: number; verschiedeneWerte: number }> = [];
  for (const p of paare) {
    const last = out[out.length - 1];
    if (last && p.a === last.a + last.laenge && p.b === last.b + last.laenge) {
      last.laenge++;
      last.verschiedeneWerte = Math.max(last.verschiedeneWerte, p.verschiedeneWerte);
    } else {
      out.push({ a: p.a, b: p.b, laenge: 1, verschiedeneWerte: p.verschiedeneWerte });
    }
  }
  return out;
}

/** M2c. u16-Offsets, die in allen Slots einen gültigen maplist-Index tragen. */
function ortsIndexKandidaten(slots: Uint8Array[]): Array<{ offset: number; verschiedene: number; max: number }> {
  const views = slots.map((s) => new DataView(s.buffer, s.byteOffset, s.byteLength));
  const out: Array<{ offset: number; verschiedene: number; max: number }> = [];
  for (let o = 0; o + 2 <= SLOT_LEN; o++) {
    const values = views.map((v) => v.getUint16(o, true));
    if (!values.every((x) => x < MAPLIST_COUNT)) continue;
    const verschiedene = new Set(values).size;
    const max = Math.max(...values);
    if (verschiedene >= 3 && max >= 100) out.push({ offset: o, verschiedene, max });
  }
  return out;
}

/**
 * M2d. u16-Paare (a,b) mit a ≤ b in allen Stichproben — Kandidaten für
 * „aktuell/Maximum". Kontrollniveau ist die Gegenrichtung: Bei einem echten
 * Paar gilt sie deutlich seltener, bei zwei beliebigen Feldern etwa gleich oft.
 */
function ordnungsPaare(
  records: Uint8Array[],
  recordLen: number,
  maxWert: number,
): Array<{ aktuell: number; maximum: number; gegenrichtung: number }> {
  const views = records.map((r) => new DataView(r.buffer, r.byteOffset, r.byteLength));
  const out: Array<{ aktuell: number; maximum: number; gegenrichtung: number }> = [];
  for (let a = 0; a + 2 <= recordLen; a++) {
    for (let b = 0; b + 2 <= recordLen; b++) {
      // Nur gleiche Ausrichtung: Ein u16-Paar desselben Records liegt auf
      // demselben Raster. Ohne diese Forderung dominieren zufällig passende
      // Überlappungen benachbarter Felder die Trefferliste.
      if (a === b || (a - b) % 2 !== 0) continue;
      let vorwaerts = 0;
      let rueckwaerts = 0;
      let gueltig = 0;
      let echtKleiner = 0;
      for (const v of views) {
        const x = v.getUint16(a, true);
        const y = v.getUint16(b, true);
        if (x === 0 && y === 0) continue;
        if (y === 0 || y > maxWert || x === 0) {
          gueltig = -1;
          break;
        }
        gueltig++;
        if (x <= y) vorwaerts++;
        if (y <= x) rueckwaerts++;
        if (x < y) echtKleiner++;
      }
      // Gefordert: Ungleichung gilt immer, ist aber nicht trivial (mindestens
      // einmal echt kleiner) — sonst wären zwei identische Felder ein "Treffer".
      // Die Gegenrichtung ist das eingebaute Kontrollniveau: Bei einem echten
      // Aktuell/Maximum-Paar liegt sie deutlich unter 1.
      if (gueltig >= 8 && vorwaerts === gueltig && echtKleiner > 0 && rueckwaerts / gueltig < 0.75) {
        out.push({ aktuell: a, maximum: b, gegenrichtung: Number((rueckwaerts / gueltig).toFixed(2)) });
      }
    }
  }
  return out;
}

// --- M3: Kernel-Sektionsrollen ----------------------------------------------

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Anteil der Spalten, die über alle Records konstant sind. Für die echte
 * Schrittweite eines Recordarrays ist der Wert deutlich höher als für jede
 * andere — dieselbe Idee wie der Spannen-Abschluss aus S12, nur für Tabellen.
 */
function spaltenKonstanz(data: Uint8Array, stride: number): number {
  const n = Math.floor(data.length / stride);
  if (n < 4) return 0;
  let konstant = 0;
  for (let c = 0; c < stride; c++) {
    const first = data[c]!;
    let same = true;
    for (let r = 1; r < n; r++) {
      if (data[r * stride + c] !== first) {
        same = false;
        break;
      }
    }
    if (same) konstant++;
  }
  return konstant / stride;
}

/**
 * Schrittweite eines Recordarrays.
 *
 * **Messfallstrick, der hier ausdrücklich abgefangen wird:** Die
 * Spalten-Konstanz eines echten Recordarrays ist bei jedem VIELFACHEN der
 * wahren Schrittweite mindestens so hoch wie bei ihr selbst — ein Vielfaches
 * fasst mehrere Records zu einem zusammen und erbt alle konstanten Spalten.
 * Das reine Maximum wählt deshalb systematisch zu grob (gemessen: 3584 B
 * wurden als 16×224 statt als 128×28 gelesen). Genommen wird darum die
 * **kleinste** Schrittweite, die den Bestwert nahezu erreicht — dieselbe Sorte
 * Schatten wie der Groß-/Kleinschreibungsschatten der Zeichentabelle aus S13.
 */
function besteSchrittweite(
  data: Uint8Array,
): { stride: number; konstanz: number; kontrolle: number; groebsteStride: number } | null {
  const verwuerfelt = shuffled(data, 0x5eed);
  const bewertet: Array<{ stride: number; konstanz: number; kontrolle: number }> = [];
  for (let stride = 4; stride <= 256; stride++) {
    if (data.length % stride !== 0) continue;
    if (data.length / stride < 4) continue;
    bewertet.push({
      stride,
      konstanz: spaltenKonstanz(data, stride),
      kontrolle: spaltenKonstanz(verwuerfelt, stride),
    });
  }
  if (bewertet.length === 0) return null;
  const bestAbstand = Math.max(...bewertet.map((b) => b.konstanz - b.kontrolle));
  if (bestAbstand <= 0) return null;
  const groebste = bewertet.find((b) => b.konstanz - b.kontrolle === bestAbstand)!;
  const feinste = bewertet.find((b) => b.konstanz - b.kontrolle >= bestAbstand * 0.9)!;
  return { ...feinste, groebsteStride: groebste.stride };
}

/** Zeigertabellen-Länge am Sektionsanfang (aufsteigende u16 < Sektionslänge). */
function zeigerTabellePrefix(data: Uint8Array): number {
  if (data.length < 2) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let n = 0;
  let prev = -1;
  while ((n + 1) * 2 <= data.length) {
    const v = view.getUint16(n * 2, true);
    if (v < data.length && v >= prev) {
      prev = v;
      n++;
    } else break;
  }
  return n;
}

/**
 * Textsektion auswerten: Anzahl vollständig dekodierbarer Strings über die
 * Zeigertabelle, mittlere Länge, mittlere Deutsch-Ähnlichkeit. Der Umfang der
 * Zeigertabelle ist selbst ein Messergebnis — die plausibelste Anzahl ist die,
 * bei der der erste Zeiger genau hinter der Tabelle liegt.
 */
function textSektion(data: Uint8Array): {
  stringAnzahl: number;
  vollstaendig: number;
  mittlereLaenge: number;
  deutschGuete: number;
} | null {
  if (data.length < 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const erster = view.getUint16(0, true);
  if (erster % 2 !== 0 || erster < 2 || erster > data.length) return null;
  const anzahl = erster / 2;
  let vollstaendig = 0;
  let laengeSumme = 0;
  let gueteSumme = 0;
  for (let i = 0; i < anzahl; i++) {
    const off = view.getUint16(i * 2, true);
    if (off >= data.length) continue;
    const d = decodeFfText(data, TEXT_TABLE, off);
    if (d.terminated && d.unknownBytes === 0) vollstaendig++;
    laengeSumme += d.text.length;
    gueteSumme += germanLikeness(d.text);
  }
  return {
    stringAnzahl: anzahl,
    vollstaendig,
    mittlereLaenge: laengeSumme / Math.max(1, anzahl),
    deutschGuete: gueteSumme / Math.max(1, anzahl),
  };
}

// --- Test --------------------------------------------------------------------

describe.skipIf(!available)('Realdaten S21: Menü-Grundlagen (Assets, Savemap, Kernel-Records)', () => {
  it('M1 — Menü-Archive inventarisieren', { timeout: 600_000 }, async () => {
    const menuDir = join(REAL_DIR, 'data', 'menu');
    if (!existsSync(menuDir)) {
      console.log('M1: kein data/menu-Verzeichnis — gültiger Negativbefund.');
      return;
    }
    const dateien = (await readdir(menuDir)).filter((f) => /\.lgp$/i.test(f)).sort();
    const berichte: ArchiveReport[] = [];
    for (const d of dateien) {
      const r = await inventarisiereArchiv(join(menuDir, d), d);
      if (r) berichte.push(r);
    }
    const deutsch = berichte.find((b) => /_gm\./i.test(b.datei));
    const englisch = berichte.find((b) => /_us\./i.test(b.datei));
    console.log(
      'M1 Menü-Archive:',
      JSON.stringify(
        {
          archive: berichte,
          spracharchiveInhaltsgleich:
            deutsch && englisch ? deutsch.sha256 === englisch.sha256 : null,
        },
        null,
        2,
      ),
    );
    expect(berichte.length).toBeGreaterThan(0);
  });

  it('M2 — Savemap-Feldlage aus belegten Slots ableiten', { timeout: 900_000 }, async () => {
    const saveDir = join(REAL_DIR, 'save');
    if (!existsSync(saveDir)) {
      console.log('M2: kein save-Verzeichnis — gültiger Negativbefund.');
      return;
    }
    const dateien = (await readdir(saveDir)).filter((f) => /\.ff7$/i.test(f)).sort();
    const slots: Uint8Array[] = [];
    for (const d of dateien) {
      const bytes = await readFile(join(saveDir, d));
      if (bytes.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
      for (let i = 0; i < SLOT_COUNT; i++) {
        const start = SAVE_HEADER_LEN + i * SLOT_LEN;
        const slot = new Uint8Array(bytes.subarray(start, start + SLOT_LEN));
        if (slot.some((b) => b !== 0)) slots.push(slot);
      }
    }
    if (slots.length < 3) {
      console.log(`M2: nur ${slots.length} belegte Slots — für die Messung zu wenig (Negativbefund).`);
      return;
    }

    // M2a — Duplikatgruppen je Breite, zu Blöcken zusammengefasst.
    const bloecke = zuBloecken(duplikatGruppen(slots, 1)).filter((b) => b.laenge >= 2);

    // M2b — Namensraster, mehrere Feldlängen probieren.
    const MINDEST_QUOTE = 0.7;
    const namensRaster = [8, 10, 12, 16].map((maxLen) => {
      const echt = namensFundstellen(slots, maxLen, MINDEST_QUOTE);
      const kontrolle = namensFundstellen(
        slots.map((s, i) => shuffled(s, 0x1234 + i)),
        maxLen,
        MINDEST_QUOTE,
      );
      const abstaende = new Map<number, number>();
      for (let i = 1; i < echt.length; i++) {
        const d = echt[i]! - echt[i - 1]!;
        abstaende.set(d, (abstaende.get(d) ?? 0) + 1);
      }
      return {
        feldLaenge: maxLen,
        treffer: echt.length,
        kontrollTreffer: kontrolle.length,
        ersteTreffer: echt.slice(0, 16),
        haeufigsteAbstaende: [...abstaende.entries()]
          .map(([abstand, anzahl]) => ({ abstand, anzahl }))
          .sort((a, b) => b.anzahl - a.anzahl)
          .slice(0, 8),
      };
    });

    // M2c — Ortsindex.
    const orte = ortsIndexKandidaten(slots);

    // M2d — Ordnungspaare innerhalb des über M2b gefundenen Rasters. Der
    // Rasteranfang ist der Beginn des LÄNGSTEN Laufs mit konstanter
    // Schrittweite, nicht die erste Fundstelle überhaupt: Einzeltreffer außerhalb
    // des Rasters (Vorschaublock, Zufallsfunde) würden ihn sonst verschieben.
    const bestesRaster = namensRaster
      .filter((r) => r.treffer >= 3 && r.kontrollTreffer === 0)
      .sort((a, b) => b.treffer - a.treffer)[0];
    let ordnung: Array<{ aktuell: number; maximum: number; gegenrichtung: number }> = [];
    let rasterInfo: { start: number; stride: number; records: number; anzahl: number } | null = null;
    const spalten: Array<{
      offset: number;
      min: number;
      max: number;
      verschiedene: number;
      gleichRecordindex: number;
    }> = [];
    if (bestesRaster) {
      const abstand = bestesRaster.haeufigsteAbstaende[0]?.abstand ?? 0;
      const treffer = bestesRaster.ersteTreffer;
      let bestStart = treffer[0] ?? 0;
      let bestLaenge = 1;
      for (let i = 0; i < treffer.length; i++) {
        let laenge = 1;
        while (treffer.includes(treffer[i]! + laenge * abstand)) laenge++;
        if (laenge > bestLaenge) {
          bestLaenge = laenge;
          bestStart = treffer[i]!;
        }
      }
      if (abstand >= 32 && abstand <= 256 && bestLaenge >= 3) {
        const records: Uint8Array[] = [];
        for (const slot of slots) {
          for (let i = 0; i < bestLaenge; i++) {
            const o = bestStart + i * abstand;
            if (o + abstand <= SLOT_LEN) records.push(slot.subarray(o, o + abstand));
          }
        }
        rasterInfo = { start: bestStart, stride: abstand, records: bestLaenge, anzahl: records.length };
        ordnung = ordnungsPaare(records, abstand, 9999).slice(0, 32);
        // Spaltenstatistik: Wertebereich je Recordoffset über alle Records.
        // Aus ihr lassen sich Feldarten ablesen, ohne eine Belegung anzunehmen
        // (Stufe 1..99 = Level, 0..8 mit Gleichlauf zum Recordindex = Kennung).
        //
        // Das Fenster reicht bewusst VOR das Namensfeld: Die Messung liefert die
        // Lage des Namens, nicht die des Recordanfangs. Liegt der Name nicht am
        // Recordanfang, muss die Kennungsspalte links davon auftauchen.
        for (let c = -32; c < abstand; c++) {
          let min = 255;
          let max = 0;
          const werte = new Set<number>();
          let gleichIndex = 0;
          records.forEach((r, i) => {
            const v = r[c] ?? slots[Math.floor(i / bestLaenge)]![bestStart + (i % bestLaenge) * abstand + c]!;
            min = Math.min(min, v);
            max = Math.max(max, v);
            werte.add(v);
            if (v === i % bestLaenge) gleichIndex++;
          });
          spalten.push({
            offset: c,
            min,
            max,
            verschiedene: werte.size,
            gleichRecordindex: Number((gleichIndex / records.length).toFixed(2)),
          });
        }
      }
    }

    // M2e — u32-Kandidaten für Gil und Spielzeit. Beide sind im Original
    // **doppelt** vorhanden (Vorschaublock und Savemap); die Duplikatgruppen
    // sind deshalb der Filter, die Plausibilitätsbereiche nur die Zuordnung.
    const u32Gruppen = duplikatGruppen(slots, 4);
    const u32Views = slots.map((s) => new DataView(s.buffer, s.byteOffset, s.byteLength));
    const u32Werte = (o: number): number[] => u32Views.map((v) => v.getUint32(o, true));
    const u32Kandidaten = u32Gruppen.map((g) => {
      const werte = u32Werte(g.offsets[0]!);
      const belegt = werte.filter((w) => w > 0);
      const max = Math.max(...werte);
      return {
        offsets: g.offsets,
        verschiedeneWerte: g.verschiedeneWerte,
        max,
        // 100 h Spielzeit in Sekunden = 360.000; Gil geht bis 99.999.999.
        passtZuSpielzeitSekunden: belegt.length > 0 && max < 360_000 && Math.min(...belegt) > 60,
        passtZuGil: max < 99_999_999 && max > 1000,
      };
    });

    // M2f — Inventar. Eine Gegenstandsliste endet auf einem langen Lauf des
    // Leer-Sentinels. Gesucht wird deshalb der längste Lauf gleicher,
    // ausgerichteter u16-Werte, der in ALLEN Slots an derselben Stelle endet —
    // der Listenanfang ergibt sich dann aus der Länge der Liste davor.
    const sentinelLaeufe = (() => {
      const kandidaten = new Map<string, number>();
      for (const slot of slots) {
        if (slot.filter((b) => b !== 0).length / SLOT_LEN < 0.1) continue; // dünner Slot
        const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
        let runStart = 0;
        let runValue = -1;
        for (let o = 0; o + 2 <= SLOT_LEN; o += 2) {
          const val = v.getUint16(o, true);
          if (val !== runValue) {
            const laenge = (o - runStart) / 2;
            if (laenge >= 16 && runValue >= 0) {
              kandidaten.set(`${runValue}@${runStart}..${o}`, (kandidaten.get(`${runValue}@${runStart}..${o}`) ?? 0) + 1);
            }
            runStart = o;
            runValue = val;
          }
        }
      }
      return [...kandidaten.entries()]
        .filter(([, n]) => n >= 2)
        .map(([lauf, n]) => ({ lauf, inSlots: n }))
        .sort((a, b) => b.inSlots - a.inSlots)
        .slice(0, 12);
    })();

    // M2g — Levelspalte verifizieren. Ein Level muss mit dem HP-Maximum
    // gleichlaufen: Von zwei Charakteren hat der höherstufige (fast) immer die
    // höhere HP-Obergrenze. Gemessen wird die Konkordanz über alle Recordpaare,
    // Kontrolle ist dieselbe Messung gegen verwürfelte Zuordnung.
    const levelKandidaten: Array<{ offset: number; konkordanz: number; kontrolle: number }> = [];
    /**
     * Recordanfang. Gemessen wird er über die **Kennungsspalte**: Genau eine
     * Spalte des Rasters trägt in jedem Record einen Wert ≤ 10 (die Zahl der
     * Figuren) und nimmt über den Bestand fast alle davon an. Sie muss am
     * Recordanfang stehen; jede andere Basis verschiebt sie.
     */
    let recordBasis: number | null = null;
    if (rasterInfo) {
      const { start, stride, records: n } = rasterInfo;
      for (let basis = start - stride + 1; basis <= start; basis++) {
        if (basis < 0) continue;
        const werte = new Set<number>();
        let ok = true;
        for (const slot of slots) {
          if (slot.filter((b) => b !== 0).length / SLOT_LEN < 0.1) continue;
          for (let i = 0; i < n; i++) {
            const v = slot[basis + i * stride]!;
            if (v > 10) {
              ok = false;
              break;
            }
            werte.add(v);
          }
          if (!ok) break;
        }
        if (ok && werte.size >= 8) {
          recordBasis = basis;
          break;
        }
      }
    }
    if (rasterInfo && recordBasis !== null) {
      const { stride, records: n } = rasterInfo;
      const start = recordBasis;
      const hpOffset = 100 + 30 - start; // gemessene maxHP-Lage, jetzt recordrelativ
      const paare: Array<{ hp: number; bytes: Uint8Array }> = [];
      for (const slot of slots) {
        const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
        for (let i = 0; i < n; i++) {
          const base = start + i * stride;
          const hp = v.getUint16(base + hpOffset, true);
          if (hp > 0) paare.push({ hp, bytes: slot.subarray(base, base + stride) });
        }
      }
      const rnd = mulberry32(0xa11ce);
      const verwuerfelt = paare.map((p) => p.hp).sort(() => rnd() - 0.5);
      for (let c = 0; c < stride; c++) {
        let konk = 0;
        let konkKontrolle = 0;
        let gesamt = 0;
        for (let i = 0; i < paare.length; i++) {
          for (let j = i + 1; j < paare.length; j++) {
            const a = paare[i]!;
            const b = paare[j]!;
            if (a.bytes[c] === b.bytes[c] || a.hp === b.hp) continue;
            gesamt++;
            if (a.bytes[c]! < b.bytes[c]! === a.hp < b.hp) konk++;
            if (a.bytes[c]! < b.bytes[c]! === verwuerfelt[i]! < verwuerfelt[j]!) konkKontrolle++;
          }
        }
        // Eine Spalte mit nur zwei verschiedenen Werten erreicht mühelos eine
        // hohe Konkordanz — sie wird deshalb ausgeschlossen, nicht bewertet.
        const spaltenWerte = new Set(paare.map((p) => p.bytes[c]!)).size;
        if (gesamt > 20 && spaltenWerte >= 5) {
          levelKandidaten.push({
            offset: c,
            konkordanz: Number((konk / gesamt).toFixed(3)),
            kontrolle: Number((konkKontrolle / gesamt).toFixed(3)),
          });
        }
      }
      levelKandidaten.sort((a, b) => b.konkordanz - a.konkordanz);
    }

    // M2h — Partyaufstellung. Drei Bytes, jedes entweder eine Charakterkennung
    // (< 9) oder der Leer-Sentinel 0xFF, und die belegten paarweise verschieden
    // — dieselbe Figur kann nicht zweimal in der Gruppe stehen. Genau diese
    // Verschiedenheit ist das Kontrollniveau: Zufällige Bytetripel im gültigen
    // Wertebereich verletzen sie regelmäßig.
    const dickeSlots = slots.filter((s) => s.filter((b) => b !== 0).length / SLOT_LEN >= 0.1);
    const partyKandidaten: number[] = [];
    for (let o = 0; o + 3 <= SLOT_LEN; o++) {
      let ok = true;
      let variiert = new Set<string>();
      for (const s of dickeSlots) {
        const t = [s[o]!, s[o + 1]!, s[o + 2]!];
        if (!t.every((v) => v < 9 || v === 0xff)) {
          ok = false;
          break;
        }
        const belegt = t.filter((v) => v !== 0xff);
        if (new Set(belegt).size !== belegt.length || belegt.length === 0) {
          ok = false;
          break;
        }
        variiert.add(t.join(','));
      }
      if (ok && variiert.size >= 3) partyKandidaten.push(o);
    }

    // M2i — Gil und Spielzeit auseinanderhalten. Beide sind u32 und beide sind
    // doppelt abgelegt; unterscheiden lassen sie sich nur über ihr Verhalten.
    // Zwei unabhängige Kriterien: (1) Ein Spielstand mit mehr Gil hat in aller
    // Regel auch mehr Spielzeit — die Konkordanz beider Reihen misst das;
    // (2) der Wertebereich schließt die Vertauschung aus (50 Mio. Sekunden
    // wären 578 Tage). Ausreißer (Spielstände mit erspieltem Maximalgil) werden
    // NICHT entfernt, sondern gehen in die Quote ein.
    const gilZeit = (() => {
      const a = u32Werte(32);
      const b = u32Werte(36);
      let konkordant = 0;
      let gesamt = 0;
      for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
          if (a[i] === a[j] || b[i] === b[j]) continue;
          gesamt++;
          if (a[i]! < a[j]! === b[i]! < b[j]!) konkordant++;
        }
      }
      return { konkordanz: gesamt > 0 ? Number((konkordant / gesamt).toFixed(3)) : null, paare: gesamt };
    })();

    console.log(
      'M2 Savemap-Feldlage:',
      JSON.stringify(
        {
          belegteSlots: slots.length,
          slotFuellgrad: slots.map((s) => Number((s.filter((b) => b !== 0).length / SLOT_LEN).toFixed(3))),
          m2aDuplikatBloecke: bloecke,
          m2bNamensraster: namensRaster,
          m2cOrtsindexKandidaten: orte.slice(0, 24),
          m2cAnzahl: orte.length,
          m2dRaster: rasterInfo,
          m2dOrdnungspaare: ordnung,
          m2dSpalten: spalten.map((s) => `${s.offset}:${s.min}-${s.max}/${s.verschiedene}${s.gleichRecordindex > 0.8 ? ' =idx' : ''}`),
          m2eU32Kandidaten: u32Kandidaten,
          // Wertedumps der beiden Vorschau-Duplikate: Nur mit den konkreten
          // Werten ist entscheidbar, welches Feld Gil und welches Spielzeit ist.
          m2eWerteAt32: u32Werte(32),
          m2eWerteAt36: u32Werte(36),
          m2fSentinelLaeufe: sentinelLaeufe,
          m2gRecordBasis: recordBasis,
          m2gLevelKandidaten: levelKandidaten.slice(0, 6),
          m2hPartyKandidaten: partyKandidaten.slice(0, 20),
          m2hAnzahl: partyKandidaten.length,
          m2iGilZeitKonkordanz: gilZeit,
        },
        null,
        2,
      ),
    );
    // Die drei tragenden Strukturbefunde werden zugesichert, damit die Probe
    // zum Regressionstest wird: Ändert sich die Installation oder der Parser,
    // fällt es hier auf und nicht erst im Menü.
    expect(rasterInfo?.stride).toBe(132);
    expect(recordBasis).toBe(84);
    expect(partyKandidaten).toContain(84 + 9 * 132);
  });

  it('M3 — Kernel-Sektionsrollen bestimmen', { timeout: 900_000 }, async () => {
    const kernelPfad = realPfad('kernel/KERNEL.BIN');
    if (!existsSync(kernelPfad)) {
      console.log('M3: keine KERNEL.BIN — gültiger Negativbefund.');
      return;
    }
    const bytes = await readFile(kernelPfad);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sektionen: Array<{
      index: number;
      laenge: number;
      zeigerPrefix: number;
      text: ReturnType<typeof textSektion>;
      record: ReturnType<typeof besteSchrittweite>;
    }> = [];
    let offset = 0;
    let index = 0;
    while (bytes.length - offset > 2) {
      const komp = view.getUint16(offset, true);
      const start = offset + 6;
      if (komp <= 0 || start + komp > bytes.length) break;
      let data: Uint8Array;
      try {
        data = await gunzip(bytes.subarray(start, start + komp));
      } catch {
        offset = start + komp;
        index++;
        continue;
      }
      sektionen.push({
        index,
        laenge: data.length,
        zeigerPrefix: zeigerTabellePrefix(data),
        text: textSektion(data),
        record: besteSchrittweite(data),
      });
      offset = start + komp;
      index++;
    }

    // Zuordnung Text↔Record über gleiche Anzahl: eine Textliste mit n Strings
    // gehört zu der Recordtabelle mit n Records.
    const zuordnung: Array<{ textSektion: number; recordSektion: number; anzahl: number }> = [];
    for (const t of sektionen) {
      const n = t.text?.stringAnzahl ?? 0;
      if (n < 8 || (t.text?.deutschGuete ?? 0) < 0.2) continue;
      for (const r of sektionen) {
        if (r.index === t.index || !r.record) continue;
        if (Math.floor(r.laenge / r.record.stride) === n && r.record.konstanz - r.record.kontrolle > 0.05) {
          zuordnung.push({ textSektion: t.index, recordSektion: r.index, anzahl: n });
        }
      }
    }

    console.log('M3 Kernel-Sektionsrollen:', JSON.stringify({ sektionen, zuordnung }, null, 2));
    expect(sektionen.length).toBeGreaterThan(0);
  });

  it('M4 — Inventarlage und Item-Namensliste aneinander binden', { timeout: 900_000 }, async () => {
    const saveDir = join(REAL_DIR, 'save');
    const kernelPfad = realPfad('kernel/KERNEL.BIN');
    if (!existsSync(saveDir) || !existsSync(kernelPfad)) {
      console.log('M4: Spielstände oder KERNEL.BIN fehlen — gültiger Negativbefund.');
      return;
    }

    // Slots einlesen (nur dicht beschriebene — dünne tragen kein Inventar).
    const slots: Uint8Array[] = [];
    for (const d of (await readdir(saveDir)).filter((f) => /\.ff7$/i.test(f)).sort()) {
      const bytes = await readFile(join(saveDir, d));
      if (bytes.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
      for (let i = 0; i < SLOT_COUNT; i++) {
        const start = SAVE_HEADER_LEN + i * SLOT_LEN;
        const slot = new Uint8Array(bytes.subarray(start, start + SLOT_LEN));
        if (slot.filter((b) => b !== 0).length / SLOT_LEN >= 0.1) slots.push(slot);
      }
    }
    if (slots.length < 3) {
      console.log('M4: zu wenige dicht beschriebene Slots — Negativbefund.');
      return;
    }

    // Textsektionen des Kernels einlesen.
    const kbytes = await readFile(kernelPfad);
    const kview = new DataView(kbytes.buffer, kbytes.byteOffset, kbytes.byteLength);
    const textSektionen: Array<{ index: number; strings: string[] }> = [];
    let off = 0;
    let idx = 0;
    while (kbytes.length - off > 2) {
      const komp = kview.getUint16(off, true);
      const start = off + 6;
      if (komp <= 0 || start + komp > kbytes.length) break;
      try {
        const data = await gunzip(kbytes.subarray(start, start + komp));
        const t = textSektion(data);
        if (t && t.vollstaendig === t.stringAnzahl && t.stringAnzahl >= 16) {
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const strings: string[] = [];
          for (let i = 0; i < t.stringAnzahl; i++) {
            strings.push(decodeFfText(data, TEXT_TABLE, dv.getUint16(i * 2, true)).text);
          }
          textSektionen.push({ index: idx, strings });
        }
      } catch {
        /* defekte Sektion überspringen */
      }
      off = start + komp;
      idx++;
    }

    /**
     * Ein Inventareintrag ist ein u16. Die Aufteilung in Kennung und Anzahl ist
     * eine **parametrierte Hypothese** (Bitbreite k der Kennung), keine
     * Annahme — gemessen wird, welches k über welchem Bereich aufgeht.
     * Gütefunktion: Anteil der Einträge, die entweder der Leer-Sentinel sind
     * oder eine plausible Kennung UND eine Anzahl von 1…99 tragen.
     */
    const EINTRAEGE = 320;
    const laenge = EINTRAEGE * 2;
    const bewertung = (start: number, k: number): number => {
      const maske = (1 << k) - 1;
      let gut = 0;
      let gesamt = 0;
      for (const slot of slots) {
        const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
        for (let i = 0; i < EINTRAEGE; i++) {
          const o = start + i * 2;
          if (o + 2 > SLOT_LEN) return 0;
          const val = v.getUint16(o, true);
          gesamt++;
          if (val === 0xffff) {
            gut++;
            continue;
          }
          const anzahl = val >> k;
          const id = val & maske;
          if (anzahl >= 1 && anzahl <= 99 && id < 512) gut++;
        }
      }
      return gesamt > 0 ? gut / gesamt : 0;
    };

    const inventarKandidaten: Array<{ start: number; k: number; guete: number }> = [];
    for (let k = 8; k <= 10; k++) {
      let best = { start: -1, k, guete: 0 };
      for (let start = 0; start + laenge <= SLOT_LEN; start += 2) {
        const g = bewertung(start, k);
        if (g > best.guete) best = { start, k, guete: g };
      }
      inventarKandidaten.push(best);
    }
    inventarKandidaten.sort((a, b) => b.guete - a.guete);
    const gewinner = inventarKandidaten[0]!;
    // Kontrollniveau: derselbe Bereich um ein Byte verschoben. Eine echte
    // u16-Tabelle bricht dabei ein, ein zufällig „passender" Bereich nicht.
    const kontrolleVersetzt = gewinner.start > 0 ? bewertung(gewinner.start + 1, gewinner.k) : 0;

    /**
     * Bindung an die Namensliste: Jede im Inventar vorkommende Kennung muss in
     * der richtigen Textsektion einen nicht leeren Namen haben.
     *
     * **Das richtige Kontrollniveau ist der Füllgrad der Sektion, nicht eine
     * verschobene Kennung.** Der erste Anlauf verglich mit „Kennung + 1" und
     * erzeugte damit einen Scheinbefund: In einer zu 92 % belegten Liste löst
     * auch die falsche Kennung fast immer auf, die Trefferquote von 94,6 % war
     * gegenüber diesem Vergleich also praktisch bedeutungslos. Entscheidend ist
     * der **Zugewinn über die Basisrate** — eine echte Namensliste löst alle
     * vorkommenden Kennungen auf, obwohl sie insgesamt Lücken hat.
     */
    const maske = (1 << gewinner.k) - 1;
    const kennungen = new Set<number>();
    for (const slot of slots) {
      const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
      for (let i = 0; i < EINTRAEGE; i++) {
        const val = v.getUint16(gewinner.start + i * 2, true);
        if (val !== 0xffff) kennungen.add(val & maske);
      }
    }
    const bindung = textSektionen
      .map((s) => {
        const treffer = [...kennungen].filter((id) => (s.strings[id] ?? '').trim().length > 0).length;
        const belegt = s.strings.filter((t) => t.trim().length > 0).length;
        const aufloesung = treffer / Math.max(1, kennungen.size);
        const fuellgrad = belegt / Math.max(1, s.strings.length);
        return {
          sektion: s.index,
          strings: s.strings.length,
          aufloesung: Number(aufloesung.toFixed(3)),
          fuellgrad: Number(fuellgrad.toFixed(3)),
          zugewinn: Number((aufloesung - fuellgrad).toFixed(3)),
          mittlereNamenslaenge: Number(
            (s.strings.reduce((n, t) => n + t.length, 0) / Math.max(1, s.strings.length)).toFixed(1),
          ),
        };
      })
      .filter((b) => b.aufloesung > 0.5)
      .sort((a, b) => b.zugewinn - a.zugewinn || b.aufloesung - a.aufloesung);

    // Bitaufteilung entscheiden. Die Gütefunktion oben ist gegenüber k
    // indifferent (beide erreichen 1,0) — sie prüft nur Wertebereiche. Was die
    // beiden Auslegungen wirklich trennt, ist die **Verteilung der Anzahl**:
    // Ein Inventar besteht überwiegend aus Einzelstücken und kleinen Stapeln,
    // die richtige Aufteilung erzeugt deshalb eine stark auf kleine Zahlen
    // konzentrierte Verteilung, die falsche streut sie.
    const anzahlVerteilung = (k: number): Array<{ anzahl: number; n: number }> => {
      const hist = new Map<number, number>();
      for (const slot of slots) {
        const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
        for (let i = 0; i < EINTRAEGE; i++) {
          const val = v.getUint16(gewinner.start + i * 2, true);
          if (val === 0xffff) continue;
          const a = val >> k;
          hist.set(a, (hist.get(a) ?? 0) + 1);
        }
      }
      return [...hist.entries()]
        .map(([anzahl, n]) => ({ anzahl, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 6);
    };

    console.log(
      'M4 Inventar und Item-Namen:',
      JSON.stringify(
        {
          slots: slots.length,
          inventarKandidaten,
          kontrolleUmEinByteVersetzt: Number(kontrolleVersetzt.toFixed(3)),
          verschiedeneKennungen: kennungen.size,
          anzahlVerteilungK8: anzahlVerteilung(8),
          anzahlVerteilungK9: anzahlVerteilung(9),
          namensSektionen: bindung,
        },
        null,
        2,
      ),
    );
    expect(gewinner.guete).toBeGreaterThan(0.9);
    // Regressionsanker: Inventarbeginn direkt hinter der Partyaufstellung.
    expect(gewinner.start).toBe(1276);
    // Die Aufteilung 9/7 muss „Anzahl 1" als häufigsten Wert liefern; die
    // Aufteilung 8/8 kennt die 1 überhaupt nicht und ist damit widerlegt.
    expect(anzahlVerteilung(9)[0]?.anzahl).toBe(1);
    expect(anzahlVerteilung(8).some((e) => e.anzahl === 1)).toBe(false);
  });

  it('M5 — Menü-Opcodes 0x49/0x4A in den Field-Skripten vermessen', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const len = new Array<number>(256).fill(-1);
    for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) len[Number(op)] = l;
    for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) len[Number(op)] = l;

    /** Operandenbytes je Opcode, spaltenweise gesammelt. */
    const spalten = new Map<number, number[][]>();
    let felder = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bundle = parsed.bundle;
      if (!parsed.ok || !bundle?.script) continue;
      const code = bundle.rawSections[1];
      if (!code) continue;
      felder++;
      for (const s of bundle.script.spans) {
        if (s.end <= s.start) continue;
        let pc = s.start;
        let guard = 0;
        while (pc < s.end && ++guard < 100_000) {
          const op = code[pc]!;
          if (op === OP_KAWAI) {
            const total = code[pc + 1];
            if (total === undefined || total < 2) break;
            pc += total;
            continue;
          }
          const l = len[op] ?? -1;
          if (l < 0) break;
          if (pc + 1 + l > code.length) break;
          let sp = spalten.get(op);
          if (!sp) {
            sp = Array.from({ length: l }, () => [] as number[]);
            spalten.set(op, sp);
          }
          for (let i = 0; i < l; i++) sp[i]!.push(code[pc + 1 + i]!);
          pc += 1 + l;
        }
      }
    }
    await dir.closeAll();

    /**
     * Kennzahl je Operandenspalte: Anzahl verschiedener Werte und der Anteil
     * des häufigsten. Ein **Ansichtswähler** hat wenige, stark konzentrierte
     * Werte; ein freier Parameter streut. Das Kontrollniveau liefern die
     * übrigen Opcodes gleicher Operandenlänge — ohne sie wäre „wenige Werte"
     * keine Aussage, weil viele Operanden im Bestand selten belegt sind.
     */
    const profil = (op: number): Array<{ n: number; verschiedene: number; haeufigsterAnteil: number }> =>
      (spalten.get(op) ?? []).map((werte) => {
        const hist = new Map<number, number>();
        for (const w of werte) hist.set(w, (hist.get(w) ?? 0) + 1);
        const top = Math.max(0, ...hist.values());
        return {
          n: werte.length,
          verschiedene: hist.size,
          haeufigsterAnteil: Number((top / Math.max(1, werte.length)).toFixed(3)),
        };
      });

    const dreiByteOps = [...spalten.entries()]
      .filter(([op, sp]) => sp.length === 3 && sp[0]!.length >= 50 && op !== 0x49)
      .map(([op]) => op);
    const kontrolle = dreiByteOps.map((op) => {
      const p = profil(op);
      return { op: `0x${op.toString(16)}`, verschiedene: p.map((c) => c.verschiedene) };
    });

    console.log(
      'M5 Menü-Opcodes:',
      JSON.stringify(
        {
          felder,
          op0x49: profil(0x49),
          op0x4a: profil(0x4a),
          kontrolleAndereDreiByteOps: kontrolle,
        },
        null,
        2,
      ),
    );
    expect(felder).toBeGreaterThan(0);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
