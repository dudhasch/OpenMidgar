import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAR,
  hatTrauer,
  hatWut,
  istVordereReihe,
  readCharacterRecord,
  ROW_BACK,
  ROW_FRONT,
  type CharacterRecord,
} from '@webmidgar/formats-save';
import { REAL_DIR } from './real-pfade.js';

/**
 * Drei Savemap-Felder, die der eigene EXE-Bestand benannt hat — hier an den
 * echten Spielständen nachgerechnet.
 *
 * **Der Anlass.** Der Bestand führt für den Charakterrecord eine
 * Feldtabelle, die in einer eigenen Korrekturrunde um `0x0C` verschoben
 * werden musste („save-file parsers were reading 12 bytes past every
 * field"). Unser Parser hat die Recordbasis unabhängig hergeleitet — über
 * das Namensraster, Namen bei `100 + i·132` — und liegt auf **84 = 0x54**,
 * also auf dem korrigierten Wert. Jeder einzelne Feldversatz stimmt überein.
 *
 * Neu sind drei Deutungen. **Nur eine davon lässt sich an diesen
 * Spielständen prüfen** — die anderen beiden Felder sind durchgehend null,
 * und ein Nullfeld bestätigt keine Deutung. Das steht bei jeder Erwartung
 * einzeln, damit später niemand ein 🟢 liest, wo ein 🟡 gemeint ist:
 *
 * 1. `+0x08`…`+0x0D` sind **sechs Quellen-Boni**, index-für-index auf die
 *    Grundwerte zu addieren.
 * 2. `+0x1F` ist die **Kampfkondition**: Bit `0x10` Trauer, Bit `0x20` Wut —
 *    der einzige Status, der einen Kampf überdauert.
 * 3. `+0x20` ist ein **Flagfeld, in dem Bit 0 die Reihe trägt** — was die
 *    alte Zweideutigkeit „0/1 gegen 0xFE/0xFF" auflöst.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Wertebereiche, keine Namen und
 * keine Spielstandsinhalte.
 */

const SAVE_DIR = join(REAL_DIR, 'save');
const available = existsSync(SAVE_DIR);

const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const SAVE_HEADER_LEN = 9;

/** Alle dicht beschriebenen Slots aller `save*.ff7` — wie in den Nachbarproben. */
async function alleRecords(): Promise<{ records: CharacterRecord[]; dateien: number }> {
  const namen = (await readdir(SAVE_DIR)).filter((f) => /\.ff7$/i.test(f)).sort();
  const records: CharacterRecord[] = [];
  for (const d of namen) {
    const b = await readFile(join(SAVE_DIR, d));
    if (b.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const start = SAVE_HEADER_LEN + i * SLOT_LEN;
      const slot = new Uint8Array(b.subarray(start, start + SLOT_LEN));
      if (slot.filter((x) => x !== 0).length / SLOT_LEN < 0.1) continue;
      for (let k = 0; k < 9; k++) {
        const c = readCharacterRecord(slot, k);
        // Nur benannte Records: ein nie beschriebener traegt keine Deutung.
        if (c.name.length > 0 && c.level > 0) records.push(c);
      }
    }
  }
  return { records, dateien: namen.length };
}

describe.skipIf(!available)('Savemap-Felder aus dem EXE-Bestand', () => {
  it('liest die sechs Quellen-Boni und hält sie im Wertebereich', async () => {
    const { records, dateien } = await alleRecords();
    expect(records.length).toBeGreaterThan(20);

    let mitBonus = 0;
    let summeAllerBoni = 0;
    let maxBonus = 0;
    let ueberlauf = 0;
    for (const c of records) {
      expect(c.sourceBonus).toHaveLength(6);
      const s = c.sourceBonus.reduce((a, b) => a + b, 0);
      if (s > 0) mitBonus++;
      summeAllerBoni += s;
      for (let i = 0; i < 6; i++) {
        maxBonus = Math.max(maxBonus, c.sourceBonus[i]!);
        // Der wirksame Grundwert ist Basis + Bonus. Das Original klemmt ihn
        // erst später auf 255; hier zählen wir nur, wie oft es überhaupt
        // darüber ginge — ein Hinweis darauf, ob die Deutung plausibel ist.
        if ((c.stats[i] ?? 0) + c.sourceBonus[i]! > 255) ueberlauf++;
      }
    }
    console.log(
      `[SAVE] ${dateien} Dateien · ${records.length} benutzte Records · mit Quellen-Bonus ${mitBonus} · ` +
        `Bonussumme ${summeAllerBoni} · größter Einzelbonus ${maxBonus} · Basis+Bonus > 255 in ${ueberlauf} Fällen`,
    );

    /**
     * 🟡 **Diese Messung belegt die Deutung NICHT — und das ist der Befund.**
     *
     * Alle sechs Bytes sind in **63 von 63** Records **null**. Eine Prüfung
     * auf „Wertebereich plausibel" oder „kein Überlauf" ist damit leer: Nullen
     * bestehen jeden solchen Test, egal was das Feld bedeutet. Aus diesen
     * Spielständen lässt sich „sechs Quellen-Boni" nicht von „sechs ungenutzte
     * Bytes" unterscheiden.
     *
     * Die Deutung stützt sich deshalb auf zweierlei, beides außerhalb dieser
     * Messung: den eigenen EXE-Bestand (`total[i] = base[i] + sourceBonus[i]
     * + equipBonus[i]`) und das lückenlose Recordraster — zwischen den
     * Grundwerten (@2…@7) und der Limitstufe (@14) bleibt genau dieser Platz.
     *
     * **Was diese Erwartung leistet:** Sie schlägt an, sobald ein Spielstand
     * mit benutzten Quellen auftaucht. Dann wird die Messung zum ersten Mal
     * aussagekräftig — und genau dann soll jemand hinsehen.
     */
    expect(ueberlauf).toBe(0);
    expect(maxBonus).toBeLessThanOrEqual(255);
    // Eingefroren: Solange das gilt, ist die Deutung ungeprüft.
    expect(summeAllerBoni).toBe(0);
  }, 300_000);

  it('findet in +0x1F ausschließlich die beiden Konditionsbits', async () => {
    const { records } = await alleRecords();
    const werte = new Map<number, number>();
    let beide = 0;
    for (const c of records) {
      werte.set(c.condition, (werte.get(c.condition) ?? 0) + 1);
      if (hatTrauer(c.condition) && hatWut(c.condition)) beide++;
    }
    console.log(
      '[SAVE] Kondition (+0x1F):',
      [...werte.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `0x${v.toString(16)}×${n}`).join(', '),
    );

    /**
     * 🟡 **Auch hier trägt die Messung nicht.** Das Feld ist in **63 von 63**
     * Records `0x00`; keine Figur dieser Spielstände war traurig oder wütend.
     * „Kein unerwartetes Bit gesetzt" ist an einem Nullfeld keine Aussage.
     *
     * Die Deutung (Bit `0x10` Trauer, Bit `0x20` Wut) kommt aus dem
     * EXE-Bestand. Was hier steht, ist die **Wache**: Sobald ein Spielstand
     * ein Bit trägt, entscheidet sich, ob es eines der beiden ist — und ob
     * sie einander wirklich ausschließen.
     */
    const erlaubt = CHAR.CONDITION_SADNESS | CHAR.CONDITION_FURY;
    for (const v of werte.keys()) expect(v & ~erlaubt).toBe(0);
    expect(beide).toBe(0);
    // Eingefroren: Solange nur 0 vorkommt, ist die Deutung ungeprüft.
    expect([...werte.keys()]).toEqual([0]);
  }, 300_000);

  it('bestätigt: in +0x20 wechselt ausschließlich Bit 0', async () => {
    const { records } = await alleRecords();
    const werte = new Map<number, number>();
    let vorne = 0;
    for (const c of records) {
      werte.set(c.row, (werte.get(c.row) ?? 0) + 1);
      if (istVordereReihe(c.row)) vorne++;
    }
    console.log(
      `[SAVE] Reihe (+0x20): ${[...werte.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `0x${v.toString(16)}×${n}`).join(', ')} · vorne ${vorne}/${records.length}`,
    );

    /**
     * 🟢 **Die Auflösung der alten Zweideutigkeit.** Die Fremdquelle nannte
     * „0/1", unsere Messung fand „0xFE/0xFF" — beide beschrieben dasselbe
     * Feld, die eine das Bit, die andere das Byte. Hier wird geprüft, was
     * daraus folgt: Alle vorkommenden Werte unterscheiden sich **nur in
     * Bit 0**, ihr Rest ist konstant.
     *
     * Damit ist {@link istVordereReihe} als Bitprüfung gerechtfertigt und
     * nicht bloß eine Geschmacksfrage: Sie bliebe richtig, wenn ein weiteres
     * Bit dieses Bytes je belegt würde.
     */
    const oberteile = new Set([...werte.keys()].map((v) => v & ~CHAR.ROW_FRONT_BIT));
    expect(oberteile.size).toBe(1);
    for (const v of werte.keys()) expect(v === ROW_FRONT || v === ROW_BACK).toBe(true);
    // Beide Reihen kommen im Bestand vor — sonst wäre die Aussage leer.
    expect(vorne).toBeGreaterThan(0);
    expect(vorne).toBeLessThan(records.length);
  }, 300_000);
});
