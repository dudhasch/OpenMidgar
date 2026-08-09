import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * S14-Vorprobe „Spielstand-Struktur": originale FF7-PC-Spielstände
 * (`save*.ff7`) suchen und gegen drei Formathypothesen prüfen, bevor
 * `packages/formats-save` entsteht (siehe docs/ROADMAP-S13-S19.md).
 *
 * Fundorte: Installationsverzeichnis (rekursiv, typischerweise ein
 * `save/`-Unterordner) UND das Dokumente-Verzeichnis der Steam-Fassung
 * (`~/Documents/Square Enix/FINAL FANTASY VII Steam/user_<id>/`). „Keine
 * Spielstände gefunden" ist ein vollständig gültiges Ergebnis — dann
 * entfällt die Strukturmessung und der Test bleibt grün.
 *
 * S1 (Kopf/Slot-Accounting): Kopf (Signatur, vermutlich 9 B) + 15 gleich
 * lange Slots. Reines Byte-Accounting `kopfLaenge + 15*slotLaenge ==
 * dateigroesse` über plausible Kopflängen 0…64 — alle exakt aufgehenden
 * Kombinationen werden berichtet (kann mehrere geben, da 15 mehrere
 * Kopflängen im Bereich mit derselben Kongruenz erlaubt).
 *
 * S2 (Slot-Prüfsumme): erste 2 Byte jedes Slots als u16-Prüfsumme über den
 * Rest des Slots. Eigene CRC-16-Implementierung (bitweise, Rocksoft-Modell)
 * probiert CCITT (poly 0x1021) mit Startwert 0xFFFF/0x0000 je normal und
 * reflektiert sowie CRC-16/ARC (poly 0x8005, reflektiert) — LE- und
 * BE-Interpretation des gespeicherten Feldes werden beide geprüft. Trifft
 * keine Variante, wird das als klarer Negativbefund gemeldet und stattdessen
 * die Verteilung der ersten beiden Bytes je Slot (als Zahl, nicht als
 * Rohbytes) ausgegeben.
 *
 * S3 (Belegung): ein Slot gilt als „belegt", wenn er nicht vollständig
 * genullt ist. Zusätzlich wird pro Byte-Offset im Slotanfang geprüft, ob
 * „Byte an Offset o != 0" exakt mit der Belegung korreliert (Kandidat für
 * ein dediziertes Zähler-/Flag-Feld).
 *
 * Zusatzstatistik (nur belegte Slots): Anteil Nullbytes, Anteil druckbares
 * ASCII, die 8 häufigsten Bytewerte sowie Position+Länge der längsten
 * Nullbyte-Folge — alles Zahlen, keine dekodierten Inhalte.
 *
 * Urheberrecht/Datenschutz: Ausgabe ausschließlich Längen, Zähler, Anteile,
 * Histogramme (Zahlen) und SHA-256-Digests. Pfade werden anonymisiert
 * (`<home>`/`<install>`, `user_<id>`) — nie der echte Benutzername, nie
 * roh dekodierter Text, nie Rohbytefolgen über 16 Byte.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const SLOT_COUNT = 15;
const MAX_HEADER_LEN = 64;
/** Kandidaten-Offsetbereich für die Zähler-/Flag-Feld-Suche am Slotanfang. */
const COUNTER_FIELD_SCAN_LEN = 64;

// --- Pfad-Anonymisierung -----------------------------------------------------

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function anonymizeSegment(seg: string): string {
  return /^user_\d+$/i.test(seg) ? 'user_<id>' : seg;
}

function anonymizePath(absPath: string): string {
  const norm = normalizeSlashes(absPath);
  const home = normalizeSlashes(homedir());
  const install = normalizeSlashes(REAL_DIR);
  let base: string;
  let rest: string;
  if (norm.toLowerCase().startsWith(home.toLowerCase())) {
    base = '<home>';
    rest = norm.slice(home.length);
  } else if (norm.toLowerCase().startsWith(install.toLowerCase())) {
    base = '<install>';
    rest = norm.slice(install.length);
  } else {
    base = '<root>';
    rest = `/${norm.split('/').pop() ?? ''}`;
  }
  const segs = rest.split('/').filter(Boolean).map(anonymizeSegment);
  return [base, ...segs].join('/');
}

// --- Dateisuche ---------------------------------------------------------------

/** Rekursive Suche nach `*.ff7` unterhalb `root`, tolerant gegen Zugriffsfehler. */
async function findFf7Files(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (/\.ff7$/i.test(entry.name)) {
        results.push(abs);
      }
    }
  }
  await walk(root);
  return results;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

// --- S1: Kopf/Slot-Accounting --------------------------------------------------

interface S1Kombo {
  kopfLaenge: number;
  slotLaenge: number;
}

function s1Accounting(fileSize: number): S1Kombo[] {
  const kombos: S1Kombo[] = [];
  for (let kopfLaenge = 0; kopfLaenge <= MAX_HEADER_LEN; kopfLaenge++) {
    const rest = fileSize - kopfLaenge;
    if (rest <= 0 || rest % SLOT_COUNT !== 0) continue;
    const slotLaenge = rest / SLOT_COUNT;
    if (slotLaenge <= 0) continue;
    kombos.push({ kopfLaenge, slotLaenge });
  }
  return kombos;
}

// --- S2: CRC-16-Zweitimplementierung (Rocksoft-Modell, bitweise) --------------

interface CrcVariante {
  name: string;
  poly: number;
  init: number;
  refin: boolean;
  refout: boolean;
  xorout: number;
}

const CRC_VARIANTEN: CrcVariante[] = [
  { name: 'CCITT-FALSE (poly=0x1021,init=0xFFFF,normal)', poly: 0x1021, init: 0xffff, refin: false, refout: false, xorout: 0x0000 },
  { name: 'XMODEM (poly=0x1021,init=0x0000,normal)', poly: 0x1021, init: 0x0000, refin: false, refout: false, xorout: 0x0000 },
  { name: 'CCITT reflektiert init=0xFFFF (X25-artig)', poly: 0x1021, init: 0xffff, refin: true, refout: true, xorout: 0x0000 },
  { name: 'KERMIT (poly=0x1021,init=0x0000,reflektiert)', poly: 0x1021, init: 0x0000, refin: true, refout: true, xorout: 0x0000 },
  { name: 'CRC-16/ARC (poly=0x8005,init=0x0000,reflektiert)', poly: 0x8005, init: 0x0000, refin: true, refout: true, xorout: 0x0000 },
];

function reflectBits(value: number, width: number): number {
  let result = 0;
  for (let i = 0; i < width; i++) {
    if (value & (1 << i)) result |= 1 << (width - 1 - i);
  }
  return result >>> 0;
}

function crc16(data: Uint8Array, v: CrcVariante): number {
  let crc = v.init;
  for (const byte of data) {
    const cur = v.refin ? reflectBits(byte, 8) : byte;
    crc = (crc ^ (cur << 8)) & 0xffff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ v.poly) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  if (v.refout) crc = reflectBits(crc, 16);
  return (crc ^ v.xorout) & 0xffff;
}

// --- Byte-Statistik (nur belegte Slots) ---------------------------------------

function byteHistogramStats(data: Uint8Array): {
  anteilNullBytes: number;
  anteilDruckbarAscii: number;
  top8Bytes: Array<{ byte: string; anzahl: number }>;
} {
  const hist = new Array<number>(256).fill(0);
  let zero = 0;
  let printable = 0;
  for (const b of data) {
    hist[b]!++;
    if (b === 0) zero++;
    if (b >= 0x20 && b <= 0x7e) printable++;
  }
  const len = data.length || 1;
  const top8Bytes = hist
    .map((anzahl, byte) => ({ byte: `0x${byte.toString(16).padStart(2, '0')}`, anzahl }))
    .filter((e) => e.anzahl > 0)
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 8);
  return { anteilNullBytes: zero / len, anteilDruckbarAscii: printable / len, top8Bytes };
}

function longestZeroRun(data: Uint8Array): { startImSlot: number; laenge: number } {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  return { startImSlot: bestStart, laenge: bestLen };
}

// --- Report-Typen ---------------------------------------------------------------

interface GefundeneDatei {
  pfad: string;
  groesse: number;
  sha256: string;
}

interface CrcVarianteErgebnis {
  variante: string;
  trefferLE: number;
  trefferBE: number;
}

interface BelegungProDatei {
  datei: string;
  belegteSlots: number;
  leereSlots: number;
}

interface ZusatzstatistikEintrag {
  datei: string;
  slotIndex: number;
  anteilNullBytes: number;
  anteilDruckbarAscii: number;
  top8Bytes: Array<{ byte: string; anzahl: number }>;
  laengsteNullSequenz: { startImSlot: number; laenge: number };
}

interface KomboAuswertung {
  kopfLaenge: number;
  slotLaenge: number;
  gesamtSlots: number;
  crcVarianten: CrcVarianteErgebnis[];
  besteCrcTrefferquote: number;
  crcNegativbefund: boolean;
  ersteZweiBytesBeiNegativbefund: Array<{ datei: string; slotIndex: number; wertLE: number }> | null;
  belegungProDatei: BelegungProDatei[];
  belegteSlotsGesamt: number;
  leereSlotsGesamt: number;
  counterFeldKandidaten: Array<{ offsetImSlot: number; korrelationMitBelegung: number }>;
  zusatzstatistikBelegteSlots: ZusatzstatistikEintrag[];
}

describe.skipIf(!available)('Realdaten: Spielstand-Struktur (save*.ff7)', () => {
  it(
    'Spielstand-Struktur: Kopf/Slot-Accounting, Prüfsummen, Belegung',
    { timeout: 900_000 },
    async () => {
      const documentsDir = join(homedir(), 'Documents');
      const searchRoots = [REAL_DIR, ...(existsSync(documentsDir) ? [documentsDir] : [])];

      const foundAbs = new Set<string>();
      for (const root of searchRoots) {
        for (const abs of await findFf7Files(root)) foundAbs.add(abs);
      }

      if (foundAbs.size === 0) {
        console.log(
          'Spielstand-Struktur: keine save*.ff7 gefunden — gültiger Negativbefund.',
          JSON.stringify({ durchsuchteOrte: searchRoots.map((r) => anonymizePath(r)) }),
        );
        expect(true).toBe(true);
        return;
      }

      const dateien: GefundeneDatei[] = [];
      const buffers = new Map<string, Uint8Array>();
      for (const abs of foundAbs) {
        const bytes = await readFile(abs);
        const sha256 = await sha256Hex(bytes);
        const pfad = anonymizePath(abs);
        dateien.push({ pfad, groesse: bytes.length, sha256 });
        buffers.set(pfad, bytes);
      }

      // --- S1: Kopf-/Slot-Accounting je Dateigröße --------------------------
      const groessenSet = new Set(dateien.map((d) => d.groesse));
      const s1ProGroesse = [...groessenSet].map((groesse) => ({
        groesse,
        kombinationen: s1Accounting(groesse),
      }));

      // Nur Dateien gleicher Größe lassen sich sinnvoll gemeinsam auswerten;
      // pro Größe wird jede aufgehende Kombination komplett durchgerechnet.
      const auswertungenProGroesse: Array<{ groesse: number; kombos: KomboAuswertung[] }> = [];

      for (const { groesse, kombinationen } of s1ProGroesse) {
        const dateienDieserGroesse = dateien.filter((d) => d.groesse === groesse);
        const kombos: KomboAuswertung[] = [];

        for (const { kopfLaenge, slotLaenge } of kombinationen) {
          const crcTreffer = new Map<string, { le: number; be: number }>();
          for (const v of CRC_VARIANTEN) crcTreffer.set(v.name, { le: 0, be: 0 });

          const belegungProDatei: BelegungProDatei[] = [];
          const zusatzstatistikBelegteSlots: ZusatzstatistikEintrag[] = [];
          const negativbefundWerte: Array<{ datei: string; slotIndex: number; wertLE: number }> = [];

          // Für die Zähler-/Flag-Feld-Korrelation über alle Slots aller
          // Dateien dieser Größe hinweg aggregiert.
          const scanLen = Math.min(COUNTER_FIELD_SCAN_LEN, slotLaenge);
          const nonZeroAtOffsetWhenOccupied = new Array<number>(scanLen).fill(0);
          const nonZeroAtOffsetWhenEmpty = new Array<number>(scanLen).fill(0);
          let gesamtSlots = 0;

          for (const datei of dateienDieserGroesse) {
            const bytes = buffers.get(datei.pfad)!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            let belegteSlots = 0;
            let leereSlots = 0;

            for (let i = 0; i < SLOT_COUNT; i++) {
              const slotStart = kopfLaenge + i * slotLaenge;
              const slotBytes = bytes.subarray(slotStart, slotStart + slotLaenge);
              gesamtSlots++;

              // S2: Prüfsumme = erste 2 Byte, Rest = slotBytes[2..]
              const rest = slotBytes.subarray(2);
              const storedLE = view.getUint16(slotStart, true);
              const storedBE = view.getUint16(slotStart, false);
              for (const v of CRC_VARIANTEN) {
                const berechnet = crc16(rest, v);
                const t = crcTreffer.get(v.name)!;
                if (berechnet === storedLE) t.le++;
                if (berechnet === storedBE) t.be++;
              }
              negativbefundWerte.push({ datei: datei.pfad, slotIndex: i, wertLE: storedLE });

              // S3: Belegung = nicht vollständig genullter Slot.
              let allZero = true;
              for (const b of slotBytes) {
                if (b !== 0) {
                  allZero = false;
                  break;
                }
              }
              if (allZero) leereSlots++;
              else belegteSlots++;

              for (let o = 0; o < scanLen; o++) {
                const nz = slotBytes[o] !== 0;
                if (!nz) continue;
                if (allZero) nonZeroAtOffsetWhenEmpty[o]!++;
                else nonZeroAtOffsetWhenOccupied[o]!++;
              }

              // Zusatzstatistik nur für belegte Slots.
              if (!allZero) {
                const stats = byteHistogramStats(slotBytes);
                const zeroRun = longestZeroRun(slotBytes);
                zusatzstatistikBelegteSlots.push({
                  datei: datei.pfad,
                  slotIndex: i,
                  ...stats,
                  laengsteNullSequenz: zeroRun,
                });
              }
            }

            belegungProDatei.push({ datei: datei.pfad, belegteSlots, leereSlots });
          }

          const crcVarianten: CrcVarianteErgebnis[] = CRC_VARIANTEN.map((v) => {
            const t = crcTreffer.get(v.name)!;
            return { variante: v.name, trefferLE: t.le, trefferBE: t.be };
          });
          const besteCrcTrefferquote =
            Math.max(0, ...crcVarianten.map((c) => Math.max(c.trefferLE, c.trefferBE))) / gesamtSlots;
          const crcNegativbefund = crcVarianten.every((c) => c.trefferLE === 0 && c.trefferBE === 0);

          const belegteGesamt = belegungProDatei.reduce((sum, b) => sum + b.belegteSlots, 0);
          const leereGesamt = belegungProDatei.reduce((sum, b) => sum + b.leereSlots, 0);
          const counterFeldKandidaten = Array.from({ length: scanLen }, (_, o) => {
            const treffer = nonZeroAtOffsetWhenOccupied[o]! + (leereGesamt - nonZeroAtOffsetWhenEmpty[o]!);
            return { offsetImSlot: o, korrelationMitBelegung: treffer / gesamtSlots };
          })
            .filter((c) => c.korrelationMitBelegung >= 0.95)
            .sort((a, b) => b.korrelationMitBelegung - a.korrelationMitBelegung);

          kombos.push({
            kopfLaenge,
            slotLaenge,
            gesamtSlots,
            crcVarianten,
            besteCrcTrefferquote,
            crcNegativbefund,
            ersteZweiBytesBeiNegativbefund: crcNegativbefund ? negativbefundWerte : null,
            belegungProDatei,
            belegteSlotsGesamt: belegteGesamt,
            leereSlotsGesamt: leereGesamt,
            counterFeldKandidaten,
            zusatzstatistikBelegteSlots,
          });
        }

        auswertungenProGroesse.push({ groesse, kombos });
      }

      const bestesLayoutProGroesse = auswertungenProGroesse.map(({ groesse, kombos }) => {
        const beste = kombos.reduce<KomboAuswertung | null>((best, k) => {
          if (!best || k.besteCrcTrefferquote > best.besteCrcTrefferquote) return k;
          return best;
        }, null);
        return {
          groesse,
          kopfLaenge: beste?.kopfLaenge ?? null,
          slotLaenge: beste?.slotLaenge ?? null,
          besteCrcTrefferquote: beste?.besteCrcTrefferquote ?? null,
        };
      });

      const output = {
        durchsuchteOrte: searchRoots.map((r) => anonymizePath(r)),
        gefundeneDateien: dateien.length,
        dateiInventar: dateien,
        s1KopfSlotAccounting: s1ProGroesse,
        auswertungenProGroesse,
        bestesLayoutProGroesse,
      };

      console.log('Spielstand-Struktur:', JSON.stringify(output, null, 2));

      expect(dateien.length).toBeGreaterThan(0);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
