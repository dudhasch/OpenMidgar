import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAsciiTable,
  decodeFfText,
  DEFAULT_ASCII_OFFSET,
  indexKernelSections,
  parseKernelContainer,
  readArmorRecords,
  readMateriaRecords,
  readWeaponRecords,
  resolveKernelDataSections,
  resolveKernelNameLists,
} from '@webmidgar/formats-kernel';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * Vorprobe zu den **neuen Menüansichten** (Welle 2, F24-B): Ausrüstung,
 * Materia, Zauber, Limit, PHS, Konfiguration — und die **Ortsanzeige**, die
 * bis hierher geraten wurde.
 *
 * Jede Messung trägt ihr eigenes Kontrollniveau. Ohne Kontrolle ist eine
 * Trefferquote hier grundsätzlich wertlos: Fast jede Bytespalte eines
 * Spielstands erfüllt irgendeine schwache Bereichsforderung, weil die meisten
 * Werte klein sind.
 *
 * Urheberrecht: ausgegeben werden Zähler, Anteile und Bereichsangaben. Aus den
 * Namenslisten wird **kein** Text ausgegeben — die Zugehörigkeit zu einer Liste
 * wird über Indexbereiche gemessen, nicht über Wortlaute.
 */


const available = existsSync(REAL_DIR);

const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const SAVE_HEADER_LEN = 9;
const CHAR_BASE = 84;
const CHAR_LEN = 132;
const CHAR_COUNT = 9;

const TABLE = buildAsciiTable(DEFAULT_ASCII_OFFSET);

interface Slot {
  datei: string;
  slot: number;
  bytes: Uint8Array;
  view: DataView;
}

async function ladeSlots(dicht: boolean): Promise<Slot[]> {
  const saveDir = join(REAL_DIR, 'save');
  if (!existsSync(saveDir)) return [];
  const out: Slot[] = [];
  for (const d of (await readdir(saveDir)).filter((f) => /\.ff7$/i.test(f)).sort()) {
    const b = await readFile(join(saveDir, d));
    if (b.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const start = SAVE_HEADER_LEN + i * SLOT_LEN;
      const bytes = new Uint8Array(b.subarray(start, start + SLOT_LEN));
      const belegt = dicht
        ? bytes.filter((x) => x !== 0).length / SLOT_LEN >= 0.1
        : bytes.some((x) => x !== 0);
      if (belegt) {
        out.push({ datei: d, slot: i, bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
      }
    }
  }
  return out;
}

async function ladeKernel(): Promise<Awaited<ReturnType<typeof parseKernelContainer>> | null> {
  const pfad = realPfad('kernel/KERNEL.BIN');
  if (!existsSync(pfad)) return null;
  return parseKernelContainer(await readFile(pfad), 'KERNEL.BIN');
}

/** Deterministische Byteverwürfelung — das Kontrollniveau für Lagemessungen. */
function verwuerfeln(u8: Uint8Array, seed: number): Uint8Array {
  const a = Uint8Array.from(u8);
  let x = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const j = x % (i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * Namensfeld-Kandidat an `at`: dekodiert, terminiert, druckbar. `''` steht für
 * ein leeres (nur Füllzeichen) Feld — das ist kein Fehlschlag, sondern „kein
 * Ort eingetragen"; `null` heißt „hier steht kein Namensfeld".
 */
function namensfeld(bytes: Uint8Array, at: number, feld: number, minLen: number): string | null {
  if (at + feld > bytes.length) return null;
  const d = decodeFfText(bytes, TABLE, at, feld);
  if (d.unknownBytes > 0) return null;
  const t = d.text.trimEnd();
  if (!d.terminated && t.length > 0) return null;
  if (t.length === 0) return '';
  if (t.length < minLen) return null;
  return /^[A-Za-z0-9][\u0020-\u007e]*$/.test(t) ? t : null;
}

interface CharRec {
  slot: Slot;
  base: number;
  id: number;
  u8: (o: number) => number;
  u16: (o: number) => number;
  u32: (o: number) => number;
}

function benutzteCharaktere(slots: Slot[]): CharRec[] {
  const out: CharRec[] = [];
  for (const s of slots) {
    for (let k = 0; k < CHAR_COUNT; k++) {
      const base = CHAR_BASE + k * CHAR_LEN;
      const u8 = (o: number): number => s.bytes[base + o]!;
      const u16 = (o: number): number => s.view.getUint16(base + o, true);
      const u32 = (o: number): number => s.view.getUint32(base + o, true);
      const name = decodeFfText(s.bytes, TABLE, base + 0x10, 12).text.trim();
      if (name.length > 0 && u16(0x38) > 0) out.push({ slot: s, base, id: u8(0x00), u8, u16, u32 });
    }
  }
  return out;
}

describe.skipIf(!available)('Realdaten F24-B: Menüansichten und Ortsanzeige', () => {
  it('V1 — Ortsname: Feldlage über einen vollständigen Sweep, Kontrolle verwürfelt', { timeout: 600_000 }, async () => {
    const slots = await ladeSlots(false);
    if (slots.length === 0) {
      console.log('V1: keine Spielstände — gültiger Negativbefund.');
      return;
    }

    /**
     * Sweep über **jeden** Offset des Slots. Gefordert: an dieser Stelle steht
     * in ALLEN belegten Slots ein dekodierbares, terminiertes Namensfeld von
     * mindestens vier Zeichen (oder ein leeres Feld), und über die Slots hinweg
     * nimmt es mindestens drei verschiedene Werte an. Die Varianzforderung
     * schließt konstante Textkonserven aus.
     */
    const sweep = (hole: (s: Slot) => Uint8Array, feld: number): Array<{ at: number; verschieden: number }> => {
      const treffer: Array<{ at: number; verschieden: number }> = [];
      for (let at = 0; at + feld <= SLOT_LEN; at++) {
        const werte: string[] = [];
        let ok = true;
        for (const s of slots) {
          const k = namensfeld(hole(s), at, feld, 4);
          if (k === null) {
            ok = false;
            break;
          }
          werte.push(k);
        }
        if (!ok) continue;
        const gefuellt = werte.filter((w) => w.length > 0);
        const verschieden = new Set(gefuellt).size;
        if (verschieden < 3) continue;
        treffer.push({ at, verschieden });
      }
      return treffer;
    };

    const echt = sweep((s) => s.bytes, 24);
    const kontrolle = sweep((s) => verwuerfeln(s.bytes, 4711 + s.slot), 24);

    /**
     * Schattenfilter: Ein Treffer bei `at+1` ist kein zweiter Fund, sondern
     * dieselbe Zeichenkette ohne ihr erstes Zeichen. Als eigenständig zählt nur
     * ein Offset, dessen Vorgänger kein Treffer ist.
     */
    const eigenstaendig = echt.filter((t) => !echt.some((v) => v.at === t.at - 1));

    // Übereinstimmung der beiden Ablagen, wo beide gefüllt sind.
    let beideGefuellt = 0;
    let gleich = 0;
    for (const s of slots) {
      const preview = namensfeld(s.bytes, 0x28, 32, 0);
      const savemap = namensfeld(s.bytes, 0x0f0c, 24, 0);
      if (preview && savemap) {
        beideGefuellt++;
        if (preview === savemap) gleich++;
      }
    }

    console.log(
      'V1 Ortsname:',
      JSON.stringify(
        {
          belegteSlots: slots.length,
          trefferEcht: echt.map((t) => `0x${t.at.toString(16).toUpperCase().padStart(4, '0')}`),
          eigenstaendigeOffsets: eigenstaendig.map((t) => `0x${t.at.toString(16).toUpperCase().padStart(4, '0')}`),
          kontrolleVerwuerfelt: kontrolle.length,
          uebereinstimmungPreviewSavemap: `${gleich}/${beideGefuellt}`,
        },
        null,
        2,
      ),
    );

    // Genau zwei eigenständige Fundstellen: Vorschaublock und Savemap.
    expect(eigenstaendig.map((t) => t.at)).toEqual([0x28, 0x0f0c]);
    expect(kontrolle).toHaveLength(0);
    expect(gleich).toBe(beideGefuellt);
    expect(beideGefuellt).toBeGreaterThan(0);
  });

  it('V2 — Ausrüstung: Kreuzprobe Savemap × KERNEL.BIN über `equipableBy`', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    const slots = await ladeSlots(true);
    if (!container || slots.length === 0) {
      console.log('V2: KERNEL.BIN oder Spielstände fehlen — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const weapons = readWeaponRecords(container, sections);
    const armor = readArmorRecords(container, sections);
    const chars = benutzteCharaktere(slots);

    /**
     * Der eigentliche Beweis. `equipableBy` ist eine Bitmaske über die neun
     * Figuren; die Figurenkennung steht im Charakterrecord. Wenn 0x1C wirklich
     * die Waffe ist, dann muss für **jede** Figur das Bit ihrer eigenen
     * Kennung gesetzt sein. Kontrolle ist dieselbe Prüfung mit der Kennung der
     * jeweils nächsten Figur (`(id+1) mod 9`) — dieselben Daten, nur die
     * Zuordnung verschoben.
     *
     * Ausgewertet werden nur Records mit `id ≤ 8`. Die Slots enthalten auch
     * Sonderfassungen (Kennungen 9 und 10, im Bestand Sephiroth und ein
     * zweiter Roter XIII); für die gibt es in `equipableBy` gar kein Bit, ein
     * Treffer wäre dort also nur ein Überlauf der Modulorechnung.
     */
    const spielbar = chars.filter((c) => c.id < CHAR_COUNT);
    const pruefe = (
      hole: (c: CharRec) => number,
      maske: (index: number) => number | null,
      versatz: number,
    ): { ok: number; gesamt: number } => {
      let ok = 0;
      let gesamt = 0;
      for (const c of spielbar) {
        const idx = hole(c);
        if (idx === 0xff) continue;
        const m = maske(idx);
        if (m === null) continue;
        gesamt++;
        const bit = (c.id + versatz) % CHAR_COUNT;
        if ((m >> bit) & 1) ok++;
      }
      return { ok, gesamt };
    };

    const wMaske = (i: number): number | null => weapons[i]?.equipableBy ?? null;
    const aMaske = (i: number): number | null => armor[i]?.equipableBy ?? null;

    const waffeEcht = pruefe((c) => c.u8(0x1c), wMaske, 0);
    const waffeKontrolle = pruefe((c) => c.u8(0x1c), wMaske, 1);
    const ruestungEcht = pruefe((c) => c.u8(0x1d), aMaske, 0);
    const ruestungKontrolle = pruefe((c) => c.u8(0x1d), aMaske, 1);
    // Zweite Kontrolle: die Accessoirespalte als vermeintliche Waffe gelesen.
    const nachbarEcht = pruefe((c) => c.u8(0x1e), wMaske, 0);
    // Wie trennscharf ist `equipableBy` überhaupt? Eine Maske, die alle neun
    // Bits trägt, kann nichts widerlegen — deshalb wird sie mitgezählt.
    const waffenVollmasken = weapons.filter((w) => (w.equipableBy & 0x1ff) === 0x1ff).length;
    const ruestungVollmasken = armor.filter((a) => (a.equipableBy & 0x1ff) === 0x1ff).length;

    const quote = (r: { ok: number; gesamt: number }): string =>
      r.gesamt === 0 ? 'n/a' : `${r.ok}/${r.gesamt} = ${((100 * r.ok) / r.gesamt).toFixed(1)} %`;

    console.log(
      'V2 Ausrüstung:',
      JSON.stringify(
        {
          charaktere: chars.length,
          davonSpielbar: spielbar.length,
          waffe_0x1C: quote(waffeEcht),
          waffe_0x1C_kontrolle_idPlus1: quote(waffeKontrolle),
          ruestung_0x1D: quote(ruestungEcht),
          ruestung_0x1D_kontrolle_idPlus1: quote(ruestungKontrolle),
          accessoirespalte_0x1E_alsWaffe: quote(nachbarEcht),
          waffenMitVollmaske: `${waffenVollmasken}/${weapons.length}`,
          ruestungenMitVollmaske: `${ruestungVollmasken}/${armor.length}`,
          verschiedeneWerte: {
            '0x1C': new Set(chars.map((c) => c.u8(0x1c))).size,
            '0x1D': new Set(chars.map((c) => c.u8(0x1d))).size,
            '0x1E': new Set(chars.map((c) => c.u8(0x1e))).size,
          },
        },
        null,
        2,
      ),
    );

    expect(waffeEcht.ok).toBe(waffeEcht.gesamt);
    expect(waffeKontrolle.ok).toBeLessThan(waffeEcht.ok);
    // Die Rüstungsprobe trennt nicht — fast jede Rüstung trägt die Vollmaske.
    // Das ist ein Befund über die Daten, kein Fehlschlag der Messung, und es
    // heißt: 0x1D bleibt 🟡 (nur über den Wertebereich gestützt).
    expect(ruestungEcht.ok).toBe(ruestungKontrolle.ok);
  });

  it('V3 — Materiaplätze: belegte Plätze passen zur Platzzahl der Ausrüstung', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    const slots = await ladeSlots(true);
    if (!container || slots.length === 0) {
      console.log('V3: KERNEL.BIN oder Spielstände fehlen — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const weapons = readWeaponRecords(container, sections);
    const armor = readArmorRecords(container, sections);
    const chars = benutzteCharaktere(slots);

    /** Platzzahl eines Ausrüstungsstücks: Rohbytes ≠ 0 in der 8er-Platzliste. */
    const platzzahl = (raw: number[] | undefined): number => (raw ?? []).filter((b) => b !== 0).length;

    /**
     * Wenn die Materiaplätze 0…7 zur **Waffe** und 8…15 zur **Rüstung**
     * gehören, darf kein belegter Platz jenseits der Platzzahl des jeweiligen
     * Stücks liegen. Kontrolle ist die vertauschte Zuordnung — dieselben Daten,
     * Waffe und Rüstung getauscht.
     */
    const pruefe = (tausch: boolean): { ok: number; gesamt: number } => {
      let ok = 0;
      let gesamt = 0;
      for (const c of chars) {
        const w = weapons[c.u8(0x1c)];
        const a = armor[c.u8(0x1d)];
        if (!w || !a) continue;
        const nW = platzzahl(tausch ? a.materiaSlots : w.materiaSlots);
        const nA = platzzahl(tausch ? w.materiaSlots : a.materiaSlots);
        for (let i = 0; i < 16; i++) {
          const id = c.u8(0x40 + i * 4);
          if (id === 0xff) continue;
          gesamt++;
          const grenze = i < 8 ? nW : nA;
          if (i % 8 < grenze) ok++;
        }
      }
      return { ok, gesamt };
    };

    const echt = pruefe(false);
    const kontrolle = pruefe(true);
    const quote = (r: { ok: number; gesamt: number }): string =>
      r.gesamt === 0 ? 'n/a' : `${r.ok}/${r.gesamt} = ${((100 * r.ok) / r.gesamt).toFixed(1)} %`;

    console.log(
      'V3 Materiaplätze:',
      JSON.stringify({ belegtePlaetze: echt.gesamt, zuordnung: quote(echt), kontrolle_vertauscht: quote(kontrolle) }, null, 2),
    );

    expect(echt.gesamt).toBeGreaterThan(0);
    expect(echt.ok).toBe(echt.gesamt);
  });

  it('V4 — Materia-Attributbytes 0x0E…0x13 zeigen in die Zauberliste', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    if (!container) {
      console.log('V4: keine KERNEL.BIN — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const listen = resolveKernelNameLists(indexKernelSections(container));
    const materiaSektion = sections.materia;
    if (!materiaSektion || !listen.magic) {
      console.log('V4: Materiasektion oder Zauberliste nicht auflösbar — gültiger Negativbefund.');
      return;
    }
    const daten = container.sections[materiaSektion.sectionIndex]!.data;
    const records = readMateriaRecords(container, sections);
    // Belegungsgrenze der Zauberliste: der letzte Index mit nichtleerem Namen.
    const zauberGrenze = listen.magic.lastOccupied;

    /**
     * Hypothese: In den sechs Bytes 0x0E…0x13 stehen die von der Materia
     * gewährten **Zauberindizes**, aufsteigend, mit 0xFF aufgefüllt.
     * Gemessen wird über alle Records, wie oft der belegte Vorlauf streng
     * steigt und dabei komplett in der belegten Zauberliste liegt.
     * Kontrolle: dieselbe Prüfung auf zwei anderen 6-Byte-Fenstern desselben
     * Records (0x08…0x0D und 0x02…0x07).
     */
    const fenster = (
      von: number,
      auswahl: (i: number) => boolean,
    ): { steigend: number; imBereich: number; mitInhalt: number } => {
      let steigend = 0;
      let imBereich = 0;
      let mitInhalt = 0;
      for (let i = 0; i < materiaSektion.recordCount; i++) {
        if (!auswahl(i)) continue;
        const b = i * materiaSektion.recordSize;
        const werte: number[] = [];
        for (let k = 0; k < 6; k++) werte.push(daten[b + von + k]!);
        const vorlauf: number[] = [];
        for (const v of werte) {
          if (v === 0xff) break;
          vorlauf.push(v);
        }
        // 0xFF darf nur hinten stehen — sonst ist es keine gefüllte Liste.
        const nurHintenGefuellt = werte.slice(vorlauf.length).every((v) => v === 0xff);
        if (vorlauf.length === 0 || !nurHintenGefuellt) continue;
        mitInhalt++;
        let steigt = true;
        for (let k = 1; k < vorlauf.length; k++) if (vorlauf[k]! <= vorlauf[k - 1]!) steigt = false;
        if (steigt) steigend++;
        if (vorlauf.every((v) => v <= zauberGrenze)) imBereich++;
      }
      return { steigend, imBereich, mitInhalt };
    };

    const alle = (): boolean => true;
    const typVerteilung = [
      ...records.reduce((m, r) => m.set(r.typeNibble, (m.get(r.typeNibble) ?? 0) + 1), new Map<number, number>()),
    ].sort((a, b) => a[0] - b[0]);

    /**
     * Aufgeschlüsselt nach Typnibble. Erwartet wird, dass sich **eine** Gruppe
     * herausschält, in der die sechs Bytes ausnahmslos aufsteigen — das wäre
     * die Zaubermateria. Über alle Records zusammen ist die Quote gedämpft,
     * weil die anderen Materiaarten dort etwas anderes ablegen.
     */
    const jeTyp = typVerteilung.map(([typ, anzahl]) => ({
      typ,
      anzahl,
      ...fenster(0x0e, (i) => records[i]!.typeNibble === typ),
    }));

    const echt = fenster(0x0e, alle);
    const k1 = fenster(0x08, alle);
    const k2 = fenster(0x02, alle);

    console.log(
      'V4 Materia-Attributbytes:',
      JSON.stringify(
        {
          records: materiaSektion.recordCount,
          zauberlisteBelegtBis: zauberGrenze,
          fenster_0x0E_alle: echt,
          kontrolle_0x08_alle: k1,
          kontrolle_0x02_alle: k2,
          jeTypNibble: jeTyp,
        },
        null,
        2,
      ),
    );

    expect(echt.mitInhalt).toBeGreaterThan(0);
    // Kein Record des Kontrollfensters steigt — das ist der eigentliche Beleg.
    expect(k1.steigend).toBe(0);
    expect(k2.steigend).toBe(0);
  });

  it('V6 — Materiastufe: welcher Faktor verbindet gespeicherte AP mit den Schwellen?', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    const slots = await ladeSlots(true);
    if (!container || slots.length === 0) {
      console.log('V6: KERNEL.BIN oder Spielstände fehlen — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const materia = readMateriaRecords(container, sections);
    const chars = benutzteCharaktere(slots);

    // Alle ausgerüsteten Materia der echten Stände: Kennung und gespeicherte AP.
    const getragen: Array<{ id: number; ap: number }> = [];
    for (const c of chars) {
      for (let i = 0; i < 16; i++) {
        const at = 0x40 + i * 4;
        const id = c.u8(at);
        if (id === 0xff) continue;
        getragen.push({ id, ap: c.u8(at + 1) | (c.u8(at + 2) << 8) | (c.u8(at + 3) << 16) });
      }
    }

    /**
     * Die Fremdbeschreibung sagt „Schwellenwert × 100 = echte AP", misst das
     * aber nicht. Hier entscheidet der Bestand: Ein Faktor ist brauchbar, wenn
     * **keine** getragene Materia mehr AP hat, als ihre höchste Schwelle
     * zulässt (Stufe 5 ist das Maximum, darüber gibt es nichts mehr). Faktoren,
     * die zu klein sind, erzeugen Überläufe; ein zu großer Faktor erzeugt keine
     * Überläufe, dafür bleibt jede Materia auf Stufe 1 stecken — deshalb wird
     * **beides** gemessen.
     */
    const pruefeFaktor = (faktor: number): { ueberlauf: number; stufeUeber1: number; gesamt: number } => {
      let ueberlauf = 0;
      let stufeUeber1 = 0;
      let gesamt = 0;
      for (const g of getragen) {
        const rec = materia[g.id];
        if (!rec) continue;
        // 0xFFFFFF ist ein Sättigungswert („gemeistert"), keine AP-Zahl —
        // gemessen: er kommt 63-mal vor, und exakt so viele Überläufe zeigt
        // die Rechnung vor dieser Ausnahme. Er wird deshalb nicht bewertet.
        if (g.ap === 0xffffff) continue;
        gesamt++;
        const schwellen = rec.apLevelsRaw.map((s) => s * faktor);
        const hoechste = Math.max(...schwellen);
        if (hoechste > 0 && g.ap > hoechste) ueberlauf++;
        const stufe = 1 + schwellen.filter((s) => s > 0 && g.ap >= s).length;
        if (stufe > 1) stufeUeber1++;
      }
      return { ueberlauf, stufeUeber1, gesamt };
    };

    const ergebnis = Object.fromEntries([1, 10, 100, 1000].map((f) => [`faktor_${f}`, pruefeFaktor(f)]));

    /**
     * Der Überlauf verschwindet mit keinem Faktor. Also stimmt die Annahme
     * nicht, dass die gespeicherten AP immer unter der höchsten Schwelle
     * liegen — der naheliegende Verdacht ist ein Sättigungswert für
     * „gemeistert". Deshalb wird die Verteilung mitgemessen statt geraten.
     */
    const apWerte = getragen.map((g) => g.ap).sort((a, b) => a - b);
    const haeufig = [...getragen.reduce((m, g) => m.set(g.ap, (m.get(g.ap) ?? 0) + 1), new Map<number, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([wert, anzahl]) => ({ wert, hex: `0x${wert.toString(16).toUpperCase()}`, anzahl }));

    console.log(
      'V6 Materiastufe:',
      JSON.stringify(
        {
          getrageneMateria: getragen.length,
          ...ergebnis,
          apVerteilung: {
            min: apWerte[0],
            median: apWerte[Math.floor(apWerte.length / 2)],
            max: apWerte[apWerte.length - 1],
            haeufigsteWerte: haeufig,
            gleich0xFFFFFF: getragen.filter((g) => g.ap === 0xffffff).length,
          },
        },
        null,
        2,
      ),
    );

    expect(getragen.length).toBeGreaterThan(0);
    /**
     * **Ehrliches Teilergebnis.** Faktor 1 ist widerlegt (13 Überläufe).
     * Faktor 10 und 100 sind beide überlaufsfrei — der Bestand kann sie
     * **nicht** unterscheiden, weil die Stände zu früh im Spiel liegen: Ohne
     * den Sättigungswert erreicht keine getragene Materia auch nur die
     * Stufe-2-Schwelle des größeren Faktors. Wer die Materiastufe belastbar
     * anzeigen will, braucht Spielstände mit weit gelevelter Materia.
     * `@webmidgar/menu` rechnet deshalb mit 100 und markiert die Stufe 🟡.
     */
    expect(pruefeFaktor(1).ueberlauf).toBeGreaterThan(0);
    expect(pruefeFaktor(10).ueberlauf).toBe(0);
    expect(pruefeFaktor(100).ueberlauf).toBe(0);
    // Der Sättigungswert ist dagegen eindeutig: exakt so viele Einträge, wie
    // die Rechnung ohne die Ausnahme an Überläufen erzeugt hat.
    expect(getragen.filter((g) => g.ap === 0xffffff).length).toBe(63);
  });

  it('V5 — Limit, Reihe und Erfahrung im Charakterrecord, je mit Nachbarkontrolle', { timeout: 600_000 }, async () => {
    const slots = await ladeSlots(true);
    if (slots.length === 0) {
      console.log('V5: keine Spielstände — gültiger Negativbefund.');
      return;
    }
    const chars = benutzteCharaktere(slots);

    // Limitstufe: 1…4. Kontrolle sind die vier Nachbarspalten.
    const stufe = (o: number): number => chars.filter((c) => c.u8(o) >= 1 && c.u8(o) <= 4).length;

    /**
     * Gelernte Limits: eine u16-Maske, in der laut Fremdquelle nur die Bits
     * {0,1,3,4,6,7,9} vorkommen dürfen — sieben Limitzeilen in einem 16-Bit-
     * Feld mit Lücken. Diese *Lücken* sind das Beweismittel: Eine beliebige
     * Zahlenspalte trifft ein derart löchriges Muster nicht.
     */
    const LIMITBITS = new Set([0, 1, 3, 4, 6, 7, 9]);
    const maske = (o: number): number => {
      let ok = 0;
      for (const c of chars) {
        const v = c.u16(o);
        let gut = true;
        for (let b = 0; b < 16; b++) if ((v >> b) & 1 && !LIMITBITS.has(b)) gut = false;
        if (gut) ok++;
      }
      return ok;
    };

    // Reihe: laut Fremdquelle widersprüchlich dokumentiert (0/1 gegen 0xFE/0xFF).
    const reihenWerte = [...new Set(chars.map((c) => c.u8(0x20)))].sort((a, b) => a - b);

    /**
     * Erfahrung: Rangkonkordanz zwischen Stufe und Erfahrungspunkten über alle
     * Charakterpaare. Kontrollniveau ist dieselbe Rechnung mit einer um eine
     * Position rotierten Erfahrungsreihe.
     */
    const konkordanz = (werte: number[]): number => {
      const stufen = chars.map((c) => c.u8(0x01));
      let gleich = 0;
      let paare = 0;
      for (let i = 0; i < chars.length; i++) {
        for (let j = i + 1; j < chars.length; j++) {
          if (stufen[i] === stufen[j] || werte[i] === werte[j]) continue;
          paare++;
          if (stufen[i]! < stufen[j]! === werte[i]! < werte[j]!) gleich++;
        }
      }
      return paare === 0 ? 0 : gleich / paare;
    };
    const exp = chars.map((c) => c.u32(0x3c));
    const expRotiert = exp.map((_, i) => exp[(i + 1) % exp.length]!);

    console.log(
      'V5 Limit/Reihe/Erfahrung:',
      JSON.stringify(
        {
          charaktere: chars.length,
          limitstufe_0x0E: `${stufe(0x0e)}/${chars.length}`,
          kontrolle_stufe: { '0x0C': stufe(0x0c), '0x0D': stufe(0x0d), '0x0F': stufe(0x0f), '0x10': stufe(0x10) },
          limitmaske_0x22: `${maske(0x22)}/${chars.length}`,
          kontrolle_maske: { '0x20': maske(0x20), '0x21': maske(0x21), '0x23': maske(0x23), '0x24': maske(0x24) },
          reihe_0x20_werte: reihenWerte,
          konkordanz_stufe_erfahrung: Number(konkordanz(exp).toFixed(3)),
          kontrolle_konkordanz_rotiert: Number(konkordanz(expRotiert).toFixed(3)),
        },
        null,
        2,
      ),
    );

    expect(stufe(0x0e)).toBe(chars.length);
    expect(maske(0x22)).toBe(chars.length);
    // Die Fremdquelle nennt zwei widersprüchliche Lesarten der Reihe; hier
    // entscheidet die Messung: es sind 0xFE/0xFF, nicht 0/1.
    expect(reihenWerte.every((v) => v === 0xfe || v === 0xff)).toBe(true);
    expect(konkordanz(exp)).toBeGreaterThan(konkordanz(expRotiert));
  });
});
