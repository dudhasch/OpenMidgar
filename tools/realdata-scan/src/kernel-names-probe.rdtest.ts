import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ITEM_LAST_OCCUPIED,
  indexKernelSections,
  inventoryCategory,
  inventoryNameLookup,
  itemNameLookup,
  parseKernelContainer,
  readArmorRecords,
  readItemRecords,
  readMateriaRecords,
  readWeaponRecords,
  resolveKernelDataSections,
  resolveKernelNameLists,
  type KernelTextList,
} from '@webmidgar/formats-kernel';
import { readInventory } from '@webmidgar/formats-save';

/**
 * F18/F24-A — Realdatenabnahme „Inventarnamen".
 *
 * **Was hier widerlegt wird.** Die S21-Messung (FINDINGS.md, M4) hielt
 * Textsektion 18 für die Gegenstandsnamen. Sie ist die *Zauberliste*. Der
 * damalige Zugewinn über die Basisrate (+0,256) sah gesund aus, weil die
 * Zauberliste zu 75 % belegt ist und die Inventarkennungen 0…104 dort fast
 * überall *irgendeinen* Namen finden — nur eben den falschen. Eine
 * Auflösungsquote kann Verwechslung nicht sehen; nur ein Vergleich mehrerer
 * Kandidatenlisten gegeneinander kann es.
 *
 * **Kontrollniveau dieser Probe** ist deshalb ausdrücklich die *alte* Lesung:
 * Beide Auflösungen laufen über dieselben Inventarzeilen, und der Bericht nennt
 * beide Zahlen nebeneinander.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Anteile und Sektionskennzahlen. Die
 * wenigen Namen im Bericht sind **Fixturenamen aus dem Test**, keine
 * Originaltexte; aus den Realdaten wird kein dekodierter Text protokolliert.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const SAVE_HEADER_LEN = 9;

async function ladeKernel(): Promise<NonNullable<Awaited<ReturnType<typeof parseKernelContainer>>> | null> {
  const pfad = join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN');
  if (!existsSync(pfad)) return null;
  return parseKernelContainer(await readFile(pfad), 'KERNEL.BIN');
}

/** Alle dicht beschriebenen Slots der `save*.ff7`-Dateien. */
async function ladeSlots(): Promise<Array<{ datei: string; slot: number; bytes: Uint8Array }>> {
  const saveDir = join(REAL_DIR, 'save');
  if (!existsSync(saveDir)) return [];
  const out: Array<{ datei: string; slot: number; bytes: Uint8Array }> = [];
  for (const d of (await readdir(saveDir)).filter((f) => /\.ff7$/i.test(f)).sort()) {
    const b = await readFile(join(saveDir, d));
    if (b.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const start = SAVE_HEADER_LEN + i * SLOT_LEN;
      const slot = new Uint8Array(b.subarray(start, start + SLOT_LEN));
      if (slot.filter((x) => x !== 0).length / SLOT_LEN >= 0.1) out.push({ datei: d, slot: i, bytes: slot });
    }
  }
  return out;
}

function kennzahlen(l: KernelTextList | null): unknown {
  return l === null
    ? null
    : {
        sektion: l.sectionIndex,
        strings: l.strings.length,
        fuellgrad: Number(l.fillRate.toFixed(3)),
        letzterBelegt: l.lastOccupied,
        mittlereLaenge: Number(l.meanLength.toFixed(1)),
      };
}

describe.skipIf(!available)('Realdaten F18/F24-A: Inventarnamen und Kernel-Recordtabellen', () => {
  it('N1 — Rollenbestimmung der Namenslisten gegen die echte KERNEL.BIN', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    if (!container) {
      console.log('N1: keine KERNEL.BIN — gültiger Negativbefund.');
      return;
    }
    const index = indexKernelSections(container);
    const listen = resolveKernelNameLists(index);

    // Warum die Länge allein nicht reicht: Wie viele Listen tragen dieselbe Anzahl?
    const nachAnzahl = new Map<number, number[]>();
    for (const l of index.lists) {
      const arr = nachAnzahl.get(l.strings.length) ?? [];
      arr.push(l.sectionIndex);
      nachAnzahl.set(l.strings.length, arr);
    }

    console.log(
      'N1 Rollenbestimmung:',
      JSON.stringify(
        {
          grund: listen.reason,
          ankerSektion: listen.weaponSection,
          mehrdeutigkeitNachStringanzahl: [...nachAnzahl.entries()]
            .map(([n, s]) => ({ stringAnzahl: n, sektionen: s }))
            .sort((a, b) => a.stringAnzahl - b.stringAnzahl),
          rollen: {
            commands: kennzahlen(listen.commands),
            magic: kennzahlen(listen.magic),
            items: kennzahlen(listen.items),
            weapons: kennzahlen(listen.weapons),
            armor: kennzahlen(listen.armor),
            accessories: kennzahlen(listen.accessories),
            materia: kennzahlen(listen.materia),
            keyItems: kennzahlen(listen.keyItems),
          },
        },
        null,
        2,
      ),
    );

    expect(listen.reason).toBeNull();
    // Die tragende Doppelbedingung: 128 Plätze UND Belegungsgrenze 104.
    expect(listen.items!.strings).toHaveLength(128);
    expect(listen.items!.lastOccupied).toBe(ITEM_LAST_OCCUPIED);
    expect(listen.weapons!.fillRate).toBe(1);
    expect(listen.armor!.strings).toHaveLength(32);
    expect(listen.accessories!.strings).toHaveLength(32);
    // Und der Nachweis, dass die Länge allein NICHT reicht: fünf 128er-Listen.
    expect(nachAnzahl.get(128)).toHaveLength(5);
    expect(nachAnzahl.get(256)).toHaveLength(2);
  });

  it('N2 — alle Inventarzeilen der Spielstände lösen auf; Kontrolle ist die alte Lesung', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    const slots = await ladeSlots();
    if (!container || slots.length === 0) {
      console.log('N2: KERNEL.BIN oder Spielstände fehlen — gültiger Negativbefund.');
      return;
    }
    const index = indexKernelSections(container);
    const listen = resolveKernelNameLists(index);
    const neu = inventoryNameLookup(listen);

    // **Kontrollniveau**: die widerlegte Lesung. Sie wählte die einzige
    // Textliste mit 256 Einträgen und der kürzeren mittleren Länge — das ist
    // die Zauberliste.
    const alteListe = index.lists
      .filter((l) => l.strings.length === 256)
      .sort((a, b) => a.meanLength - b.meanLength)[0]!;
    const alt = itemNameLookup(alteListe);

    let zeilen = 0;
    let neuOffen = 0;
    let altOffen = 0;
    let altAbweichend = 0;
    let altGleich = 0;
    const bereiche = new Map<string, { zeilen: number; offen: number }>();
    for (const s of slots) {
      for (const e of readInventory(s.bytes)) {
        zeilen++;
        const n = neu(e.itemId);
        const a = alt(e.itemId);
        const kat = inventoryCategory(e.itemId)?.category ?? 'ausserhalb';
        const b = bereiche.get(kat) ?? { zeilen: 0, offen: 0 };
        b.zeilen++;
        if (n === null) {
          neuOffen++;
          b.offen++;
        }
        bereiche.set(kat, b);
        if (a === null) altOffen++;
        else if (a === n) altGleich++;
        else altAbweichend++;
      }
    }

    console.log(
      'N2 Inventarauflösung:',
      JSON.stringify(
        {
          spielstaende: [...new Set(slots.map((s) => s.datei))].length,
          slots: slots.length,
          inventarzeilen: zeilen,
          bereichskodiert: { ungeloest: neuOffen, jeBereich: [...bereiche.entries()].map(([k, v]) => ({ bereich: k, ...v })) },
          kontrolleAlteLesung: {
            sektion: alteListe.sectionIndex,
            fuellgrad: Number(alteListe.fillRate.toFixed(3)),
            ungeloest: altOffen,
            abweichenderName: altAbweichend,
            gleicherName: altGleich,
          },
        },
        null,
        2,
      ),
    );

    // Abnahme: keine einzige Zeile bleibt offen.
    expect(zeilen).toBeGreaterThanOrEqual(79);
    expect(neuOffen).toBe(0);
    // Kontrolle: unter der alten Lesung blieben 14 Zeilen offen, und keine
    // einzige der aufgelösten trug denselben Namen wie jetzt — der alte Zustand
    // war nicht „ungenau", er war durchgehend falsch.
    expect(altOffen).toBeGreaterThan(0);
    expect(altGleich).toBe(0);
  });

  it('N3 — Accounting der Recordtabellen (Kernel-Sektionen 5…9, 1-basiert)', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    if (!container) {
      console.log('N3: keine KERNEL.BIN — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const zeilen = (['item', 'weapon', 'armor', 'accessory', 'materia'] as const).map((rolle) => {
      const s = sections[rolle];
      const ist = s === null ? null : container.sections[s.sectionIndex]!.data.length;
      return {
        rolle,
        sektion0Basiert: s?.sectionIndex ?? null,
        recordZahl: s?.recordCount ?? null,
        recordGroesse: s?.recordSize ?? null,
        erwarteteLaenge: s === null ? null : s.recordCount * s.recordSize,
        istLaenge: ist,
        gehtAuf: s !== null && s.recordCount * s.recordSize === ist,
      };
    });
    console.log('N3 Accounting:', JSON.stringify({ grund: sections.reason, zeilen }, null, 2));

    expect(sections.reason).toBeNull();
    for (const z of zeilen) expect(z).toMatchObject({ gehtAuf: true });
    // Je Sektion einzeln, damit ein Fehlschlag die Rolle benennt.
    expect(zeilen.map((z) => [z.rolle, z.recordZahl, z.recordGroesse, z.istLaenge])).toEqual([
      ['item', 128, 28, 3584],
      ['weapon', 128, 44, 5632],
      ['armor', 32, 36, 1152],
      ['accessory', 32, 16, 512],
      ['materia', 96, 20, 1920],
    ]);
  });

  it('N4 — Feldbelegung der Recordtabellen, jede Behauptung gegen ein Kontrollniveau', { timeout: 600_000 }, async () => {
    const container = await ladeKernel();
    if (!container) {
      console.log('N4: keine KERNEL.BIN — gültiger Negativbefund.');
      return;
    }
    const sections = resolveKernelDataSections(container);
    const weapons = readWeaponRecords(container, sections);
    const items = readItemRecords(container, sections);
    const armor = readArmorRecords(container, sections);
    const materia = readMateriaRecords(container, sections);

    // (a) Wachstumsrate: Werte 0…3. Kontrollniveau sind die Nachbarspalten
    //     desselben Records — läge das Feld anderswo, wäre der Wertebereich
    //     dort genauso eng.
    const wachstum = new Map<number, number>();
    for (const w of weapons) wachstum.set(w.growthRate, (wachstum.get(w.growthRate) ?? 0) + 1);
    const wsec = container.sections[sections.weapon!.sectionIndex]!.data;
    const nachbarSpalten = [0x04, 0x05, 0x07, 0x08, 0x09].map((off) => {
      const werte = new Set<number>();
      for (let r = 0; r < 128; r++) werte.add(wsec[r * 44 + off]!);
      return { offset: off, verschiedene: werte.size, max: Math.max(...werte) };
    });

    // (b) AP-Schwellen: Monotonie über die vier u16 ab 0x00. Kontrollniveau
    //     sind dieselben Monotonieproben auf u16-Quadrupeln an anderer Stelle
    //     desselben Records.
    const belegt = materia.filter((m) => m.apLevelsRaw.some((x) => x !== 0 && x !== 0xffff));
    const monoton = belegt.filter((m) => m.apLevelsRaw.every((ap, k, all) => k === 0 || all[k - 1]! <= ap)).length;
    const gegen = belegt.filter((m) => m.apLevelsRaw.every((ap, k, all) => k === 0 || all[k - 1]! >= ap)).length;
    const msec = container.sections[sections.materia!.sectionIndex]!.data;
    const mview = new DataView(msec.buffer, msec.byteOffset, msec.byteLength);
    const kontrolleMonoton = [8, 10, 12].map((start) => {
      let mono = 0;
      let n = 0;
      for (let r = 0; r < 96; r++) {
        const q = [0, 2, 4, 6].map((o) => mview.getUint16(r * 20 + start + o, true));
        if (q.every((x) => x === 0)) continue;
        n++;
        if (q.every((x, k) => k === 0 || q[k - 1]! <= x)) mono++;
      }
      return { abOffset: start, monoton: mono, belegt: n };
    });

    // (c) Restriktionen bitinvertiert: Ein Verbotsfeld hat oben durchgehend 1
    //     und variiert unten. Kontrollniveau sind alle u16-Spalten des
    //     Gegenstandsrecords — nur wenige erfüllen beides zugleich.
    const isec = container.sections[sections.item!.sectionIndex]!.data;
    const iview = new DataView(isec.buffer, isec.byteOffset, isec.byteLength);
    const restriktionsKandidaten: Array<{ offset: number; obenGesetzt: number; untenVerschieden: number }> = [];
    for (let off = 0; off + 2 <= 28; off += 2) {
      let obenGesetzt = 0;
      const unten = new Set<number>();
      for (let r = 0; r < 128; r++) {
        const v = iview.getUint16(r * 28 + off, true);
        if ((v & 0xfff8) === 0xfff8) obenGesetzt++;
        unten.add(v & 0x07);
      }
      if (obenGesetzt === 128) restriktionsKandidaten.push({ offset: off, obenGesetzt, untenVerschieden: unten.size });
    }

    console.log(
      'N4 Feldbelegung:',
      JSON.stringify(
        {
          wachstumsrateVerteilung: [...wachstum.entries()].map(([wert, n]) => ({ wert, n })).sort((a, b) => a.wert - b.wert),
          kontrolleNachbarspalten: nachbarSpalten,
          apMonotonie: { belegt: belegt.length, monoton, gegenrichtung: gegen },
          kontrolleApMonotonie: kontrolleMonoton,
          restriktionsKandidatenItem: restriktionsKandidaten,
          ruestungAbwehrBereich: { min: Math.min(...armor.map((a) => a.defense)), max: Math.max(...armor.map((a) => a.defense)) },
          angriffskraftBereich: { min: Math.min(...items.map((i) => i.attackPower)), max: Math.max(...items.map((i) => i.attackPower)) },
        },
        null,
        2,
      ),
    );

    // 🟢 Wachstumsrate: eng, Nachbarn nicht.
    expect(weapons.every((w) => w.growthRate <= 3)).toBe(true);
    expect(nachbarSpalten.filter((s) => s.max <= 3)).toHaveLength(0);
    // 🟢 AP-Schwellen: vollständig monoton, Gegenrichtung nie; Kontrolle deutlich darunter.
    expect(monoton).toBe(belegt.length);
    expect(gegen).toBe(0);
    for (const k of kontrolleMonoton) expect(k.monoton / k.belegt).toBeLessThan(0.6);
    // 🟢 Restriktionsfeld: genau ein u16 hat oben durchgehend 1 UND unten mehrere Belegungen.
    const echt = restriktionsKandidaten.filter((k) => k.untenVerschieden >= 3);
    expect(echt.map((k) => k.offset)).toEqual([0x0a]);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
