import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';

/**
 * S14-Nachprobe „Slot-Prüfsumme, zweiter Anlauf".
 *
 * Der erste Anlauf ([save-probe.rdtest.ts]) hat fünf CRC-16-Varianten über
 * `slot[2..]` geprüft und **keinen** Treffer erzielt. Eine Community-Angabe
 * (Qhimm-Forum, dziugo; nachgenutzt u. a. in `niemasd/ff7-save-checksum`)
 * beschreibt das Verfahren anders — in ZWEI unabhängigen Punkten:
 *
 *  1. **Abgedeckter Bereich:** nicht `slot[2..4340]` (4338 B), sondern
 *     `slot[4..4340]` (**4336 B**). Das Prüfsummenfeld selbst ist demnach ein
 *     DWord, von dem nur das untere Word belegt wird — die Bytes 2 und 3
 *     gehören noch zum Feld und werden mit übersprungen.
 *  2. **Nachlauf-XOR:** `0xFFFF` statt `0x0000`. Damit ist es CRC-16/CCITT
 *     mit Polynom 0x1021, Startwert 0xFFFF, unreflektiert, XOR-out 0xFFFF
 *     (in der Katalogsprache: CRC-16/GENIBUS).
 *
 * Beide Abweichungen zusammen erklären den Fehlschlag vollständig — eine
 * allein hätte nicht gereicht. Genau das wird hier gemessen: Die Probe prüft
 * die Kombination UND die drei Teilabweichungen einzeln, damit belegt ist,
 * dass beide Korrekturen nötig sind und keine davon zufällig trägt.
 *
 * Die Angabe ist eine **Hypothese, keine Autorität** (Projektregel). Sie gilt
 * erst, wenn sie auf den belegten Slots der lokalen Installation trifft.
 *
 * Urheberrecht/Datenschutz: Ausgabe ausschließlich Zähler und Quoten. Kein
 * Spielstandsinhalt, keine Rohbytes, keine echten Pfade.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const HEADER_LEN = 9;
const SLOT_LEN = 0x10f4; // 4340
const SLOT_COUNT = 15;
const FILE_LEN = HEADER_LEN + SLOT_COUNT * SLOT_LEN; // 65109

/** Eigenimplementierung, bitweise — bewusst ohne Tabelle, damit sie lesbar bleibt. */
function crc16(
  data: Uint8Array,
  { poly, init, xorout }: { poly: number; init: number; xorout: number },
): number {
  let r = init;
  for (const byte of data) {
    r ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      r = r & 0x8000 ? ((r << 1) ^ poly) & 0xffff : (r << 1) & 0xffff;
    }
  }
  return (r ^ xorout) & 0xffff;
}

const CCITT = { poly: 0x1021, init: 0xffff };

/** Belegt = nennenswert von Null verschieden (Schwelle aus dem ersten Anlauf). */
function occupied(slot: Uint8Array): boolean {
  let zeros = 0;
  for (const b of slot) if (b === 0) zeros++;
  return zeros / slot.length < 0.95;
}

async function findSaves(): Promise<string[]> {
  const roots = [
    join(REAL_DIR, 'save'),
    join(homedir(), 'Documents', 'Square Enix', 'FINAL FANTASY VII Steam'),
  ];
  const out: string[] = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.ff7$/i.test(e.name)) out.push(p);
      }
    }
  }
  return out;
}

describe.skipIf(!available)('Realdaten: Slot-Prüfsumme (S14, zweiter Anlauf)', () => {
  it('Bereich ab +4 UND Nachlauf-XOR 0xFFFF — beide Korrekturen sind nötig', async () => {
    const files = await findSaves();
    // Vier Auslegungen: die beiden Abweichungen einzeln und gemeinsam.
    const varianten = {
      'ab+2, xorout 0x0000 (erster Anlauf)': { from: 2, xorout: 0x0000 },
      'ab+2, xorout 0xFFFF': { from: 2, xorout: 0xffff },
      'ab+4, xorout 0x0000': { from: 4, xorout: 0x0000 },
      'ab+4, xorout 0xFFFF (Hypothese)': { from: 4, xorout: 0xffff },
    };
    const treffer: Record<string, number> = {};
    for (const k of Object.keys(varianten)) treffer[k] = 0;

    let belegteSlots = 0;
    let leereSlots = 0;
    let dateien = 0;
    // Nebenbefund: Sind die Bytes 2..3 des Feldes bei belegten Slots wirklich 0?
    let hochwortNull = 0;
    // Zweite, großzügigere Belegtheitsfrage: Slots, die NICHT vollständig
    // genullt sind. Der erste Anlauf zählte danach 8 statt 7 — der Unterschied
    // muss aufgehen, sonst ist die Belegtheitsregel die eigentliche Unbekannte.
    let nichtGanzGenullt = 0;
    let trefferNichtGanzGenullt = 0;
    let vollGenullt = 0;
    let trefferVollGenullt = 0;

    for (const path of files) {
      const bytes = new Uint8Array(await readFile(path));
      if (bytes.length !== FILE_LEN) continue;
      dateien++;
      for (let i = 0; i < SLOT_COUNT; i++) {
        const start = HEADER_LEN + i * SLOT_LEN;
        const slot = bytes.subarray(start, start + SLOT_LEN);
        const gespeichert = slot[0]! | (slot[1]! << 8);
        const hypothese =
          crc16(slot.subarray(4), { ...CCITT, xorout: 0xffff }) === gespeichert;

        if (slot.some((b) => b !== 0)) {
          nichtGanzGenullt++;
          if (hypothese) trefferNichtGanzGenullt++;
        } else {
          vollGenullt++;
          if (hypothese) trefferVollGenullt++;
        }

        if (!occupied(slot)) {
          leereSlots++;
          continue;
        }
        belegteSlots++;
        if (slot[2] === 0 && slot[3] === 0) hochwortNull++;
        for (const [name, v] of Object.entries(varianten)) {
          const berechnet = crc16(slot.subarray(v.from), { ...CCITT, xorout: v.xorout });
          if (berechnet === gespeichert) treffer[name]!++;
        }
      }
    }

    console.log(
      'Slot-Prüfsumme:',
      JSON.stringify(
        {
          dateien,
          belegteSlots,
          leereSlots,
          hochwortNullBeiBelegten: `${hochwortNull}/${belegteSlots}`,
          treffer: Object.fromEntries(
            Object.entries(treffer).map(([k, v]) => [k, `${v}/${belegteSlots}`]),
          ),
          // Gegenprobe zur Belegtheitsregel: Die Hypothese über ALLE Slots.
          hypotheseNichtGanzGenullt: `${trefferNichtGanzGenullt}/${nichtGanzGenullt}`,
          hypotheseVollGenullt: `${trefferVollGenullt}/${vollGenullt}`,
        },
        null,
        1,
      ),
    );

    // Nebenertrag: Die Prüfsumme entscheidet die bislang mehrdeutige
    // Kopflänge. 9/4340, 24/4339, 39/4338 und 54/4337 gehen arithmetisch alle
    // auf; nur die richtige Aufteilung legt die Slotgrenzen so, dass die
    // Prüfsummen stimmen.
    const layouts = [
      { headerLength: 9, slotLength: 4340 },
      { headerLength: 24, slotLength: 4339 },
      { headerLength: 39, slotLength: 4338 },
      { headerLength: 54, slotLength: 4337 },
    ];
    const layoutTreffer: Record<string, string> = {};
    for (const l of layouts) {
      let ok = 0;
      let gepruef = 0;
      for (const path of files) {
        const bytes = new Uint8Array(await readFile(path));
        if (bytes.length !== FILE_LEN) continue;
        for (let i = 0; i < SLOT_COUNT; i++) {
          const start = l.headerLength + i * l.slotLength;
          const slot = bytes.subarray(start, start + l.slotLength);
          if (!slot.some((b) => b !== 0)) continue;
          gepruef++;
          const gespeichert = slot[0]! | (slot[1]! << 8);
          if (crc16(slot.subarray(4), { ...CCITT, xorout: 0xffff }) === gespeichert) ok++;
        }
      }
      layoutTreffer[`${l.headerLength}/${l.slotLength}`] = `${ok}/${gepruef}`;
    }
    console.log('Kopflänge über die Prüfsumme entschieden:', JSON.stringify(layoutTreffer));
    expect(layoutTreffer['9/4340']).toBe(`${nichtGanzGenullt}/${nichtGanzGenullt}`);

    if (belegteSlots === 0) return; // keine belegten Slots ist ein gültiges Ergebnis
    // Die Hypothese muss ALLE belegten Slots treffen — eine Prüfsumme, die
    // nur meistens stimmt, ist keine.
    expect(treffer['ab+4, xorout 0xFFFF (Hypothese)']).toBe(belegteSlots);
    // Und die Teilabweichungen dürfen NICHT tragen, sonst wäre die
    // Zuschreibung der Ursache falsch.
    expect(treffer['ab+2, xorout 0x0000 (erster Anlauf)']).toBe(0);
    expect(treffer['ab+2, xorout 0xFFFF']).toBe(0);
    expect(treffer['ab+4, xorout 0x0000']).toBe(0);
  }, 120_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
