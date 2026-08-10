import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { buildAsciiTable, decodeFfText, germanLikeness, DEFAULT_ASCII_OFFSET } from '@webmidgar/formats-kernel';
import { parseP, parseTex } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * S30 — Kampfdaten-Probe (VOR jeder Parserzeile, Methodik-Standard seit S7).
 *
 * Gegenstände: `data/battle/scene.bin` (Gegner + Formationen), `battle.lgp`
 * (Modelle), `kernel.bin` Sektionen 0–2 (Command/Attack/Growth), Inventar
 * `magic.lgp`/`camdat*`.
 *
 * Hypothesen (Qhimm/Community als HYPOTHESENGEBER — jede Zeile wird gegen die
 * eigenen Daten gemessen; zwei Community-Angaben wurden dabei bereits von den
 * Daten KORRIGIERT, s. u.):
 *
 *  - H-BLK: scene.bin = Blöcke à 0x2000; je Block 16 u32-Zeiger in
 *    4-Byte-Einheiten (0xFFFFFFFF = leer) auf gzip-Ströme; Füllung 0xFF.
 *  - H-SIZE: Jede Szene entpackt exakt 7808 B (0x1E80).
 *  - H-PART: Partition der Szene:
 *      [0x000,0x008) 3×u16 Gegner-IDs + Pad · [0x008,0x058) 4×20 B Setup ·
 *      [0x058,0x118) 4×48 B Kamera · [0x118,0x298) 4×6×16 B Formationsplätze ·
 *      [0x298,0x4C0) 3×184 B Gegner · [0x4C0,0x840) 32×28 B Attacken ·
 *      [0x840,0x880) 32×u16 Attack-IDs · [0x880,0xC80) 32×32 B Attack-Namen ·
 *      [0xC80,0xE80) Formation-KI (4×u16 Offsets + Daten) ·
 *      [0xE80,0x1E80) Gegner-KI (3×u16 Offsets + Daten).
 *    **Korrektur 1:** Die verbreitete Angabe „Gegner-KI-Offsets bei 0xF00"
 *    ist falsch — dort steht Text (Attack-Namen-Reste). Der Sweep unten
 *    findet 0xE80 mit Korrelation 241/256 gegen 73 beim Zweitplatzierten.
 *  - H-PRED: **Strukturvorhersage aus der 10-Bit-Kampf-ID** (Formatfakt
 *    2026-08-10): Der Bestand muss ≈1024 adressierbare Formationen halten.
 *    Diese Vorhersage fällt VOR jeder Record-Deutung.
 *  - H-ENEMY: Gegner-Record 184 B: Name[32] · Level u8@0x20 · … ·
 *    AttackIDs 16×u16@0x48 · MP u16@0x9C · AP u16@0x9E · HP u32@0xA4 ·
 *    EXP u32@0xA8 · Gil u32@0xAC. (Feinsemantik der übrigen Bytes 🟡.)
 *  - H-MODEL: Gegner-ID → Modellpräfix als Basis-26 (`id/26`,`id%26` je
 *    +'a'), Skelett = `<präfix>aa`.
 *  - H-SKEL: Battle-Skelett = 52-B-Kopf (u32[3] = Bone-Anzahl) + 12 B je Bone.
 *  - H-KRN: kernel.bin Sektion 0 = 32×8 B (Commands), Sektion 1 = 128×28 B
 *    (Attacken), Sektion 2 = 9×56 B Charakter-Records + 12 B Statgewinn +
 *    12 B HP-Gewinn + 12 B MP-Gewinn + 64×16 B Kurven @0x21C + Rest (🟡).
 *
 * Kontrollen: Nachbarszene (Referenzfelder), um 1 Byte verschobene Positionen
 * (Wertebereiche), Zeiger als Byte-Offsets statt 4-Byte-Einheiten (Container),
 * verschobene Kurvenbasis (Growth), id+1-Modellzuordnung (mit dokumentierter
 * Blindheit im dichten Namensraum).
 *
 * Nullwert-Zweitrechnung: leere Formationsplätze (0xFFFF), unbenutzte
 * Gegner-Slots, EXP-0-Gegner (Story-Bosse) werden getrennt gezählt.
 *
 * Urheberrecht: ausschließlich Zähler, Quoten, Wertebereiche, Digests —
 * keine Rohbytes über 16 B, keine Namen im Klartext.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const BATTLE_DIR = join(REAL_DIR, 'data', 'battle');
const available = existsSync(BATTLE_DIR);

const BLOCK = 0x2000;
const SCENE_LEN = 0x1e80;

interface RawScene {
  bytes: Uint8Array;
  view: DataView;
}

/** Entpackt alle Szenen (Exploration bestätigt: Zeiger in 4-Byte-Einheiten). */
function loadScenes(sceneBin: Uint8Array): { scenes: RawScene[]; streamLens: number[]; padBytes: number; padNonFF: number } {
  const dv = new DataView(sceneBin.buffer, sceneBin.byteOffset, sceneBin.byteLength);
  const scenes: RawScene[] = [];
  const streamLens: number[] = [];
  let padBytes = 0;
  let padNonFF = 0;
  for (let b = 0; b < sceneBin.length / BLOCK; b++) {
    const base = b * BLOCK;
    const ptrs: number[] = [];
    for (let i = 0; i < 16; i++) {
      const v = dv.getUint32(base + i * 4, true);
      if (v !== 0xffffffff) ptrs.push(v * 4);
    }
    for (let i = 0; i < ptrs.length; i++) {
      const start = base + ptrs[i]!;
      const end = i + 1 < ptrs.length ? base + ptrs[i + 1]! : base + BLOCK;
      // Stromlänge = Chunk ohne die 0xFF-Füllung am Ende. Das ist sicher,
      // weil der gzip-Strom mit ISIZE (hier 0x1E80 → MSB 0x00) endet und
      // deshalb nie auf 0xFF endet.
      let se = end;
      while (se > start && sceneBin[se - 1] === 0xff) se--;
      for (let p = se; p < end; p++) {
        padBytes++;
        if (sceneBin[p] !== 0xff) padNonFF++;
      }
      streamLens.push(se - start);
      const out = inflateRawSync(sceneBin.subarray(start + 10, se));
      const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      scenes.push({ bytes, view: new DataView(out.buffer, out.byteOffset, out.byteLength) });
    }
  }
  return { scenes, streamLens, padBytes, padNonFF };
}

const OFF = {
  setup: 0x8,
  camera: 0x58,
  formation: 0x118,
  enemy: 0x298,
  attack: 0x4c0,
  attackIds: 0x840,
  attackNames: 0x880,
  formationAi: 0xc80,
  enemyAi: 0xe80,
} as const;

describe.skipIf(!available)('S30-Probe: scene.bin — Container und Accounting', () => {
  const sceneBin = available ? readFileSync(join(BATTLE_DIR, 'scene.bin')) : new Uint8Array(0);

  it('H-BLK/H-SIZE/H-PRED: Blockzerlegung, 7808-B-Szenen, ≈1024 Formationen', async () => {
    expect(sceneBin.length % BLOCK).toBe(0);
    const { scenes, streamLens, padBytes, padNonFF } = loadScenes(new Uint8Array(sceneBin));

    // Accounting: Zeigertabellen + Ströme + Füllung == Dateigröße byteexakt.
    const tableBytes = (sceneBin.length / BLOCK) * 64;
    const streamTotal = streamLens.reduce((a, b) => a + b, 0);
    expect(tableBytes + streamTotal + padBytes).toBe(sceneBin.length);
    // Füllung ist AUSSCHLIESSLICH 0xFF (Grundlage der Browser-Dekodierstrategie:
    // 0xFF-Lauf abstreifen → exakter gzip-Strom).
    expect(padNonFF).toBe(0);

    // Jede Szene exakt 7808 B.
    expect(scenes.length).toBe(256);
    expect(scenes.every((s) => s.bytes.length === SCENE_LEN)).toBe(true);

    // Strukturvorhersage: 256 Szenen × 4 Formationen = 1024 — exakt die
    // Adressbreite der 10-Bit-Kampf-ID. Diese Zahl war VOR der Zerlegung
    // vorhergesagt.
    expect(scenes.length * 4).toBe(1024);

    // Browsertaugliche strikte Dekodierung: 0xFF-Lauf abstreifen, dann
    // DecompressionStream('gzip') — validiert CRC32+ISIZE des Originals.
    let strictOk = 0;
    const dv = new DataView(sceneBin.buffer, sceneBin.byteOffset, sceneBin.byteLength);
    for (let b = 0; b < sceneBin.length / BLOCK; b++) {
      const base = b * BLOCK;
      const ptrs: number[] = [];
      for (let i = 0; i < 16; i++) {
        const v = dv.getUint32(base + i * 4, true);
        if (v !== 0xffffffff) ptrs.push(v * 4);
      }
      for (let i = 0; i < ptrs.length; i++) {
        const start = base + ptrs[i]!;
        const end = i + 1 < ptrs.length ? base + ptrs[i + 1]! : base + BLOCK;
        let se = end;
        while (se > start && sceneBin[se - 1] === 0xff) se--;
        const owned = new Uint8Array(se - start);
        owned.set(sceneBin.subarray(start, se));
        const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
        let total = 0;
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += (value as Uint8Array).length;
          }
          if (total === SCENE_LEN) strictOk++;
        } catch {
          /* zählt nicht */
        }
      }
    }
    expect(strictOk).toBe(256);

    // Kontrolle: Zeiger als BYTE-Offsets gedeutet — dann läge bei ptr statt
    // ptr*4 ein gzip-Magic. Zählung über alle Blöcke:
    let magicAtByteOffset = 0;
    let magicAtWordOffset = 0;
    let checked = 0;
    for (let b = 0; b < sceneBin.length / BLOCK; b++) {
      const base = b * BLOCK;
      for (let i = 0; i < 16; i++) {
        const v = dv.getUint32(base + i * 4, true);
        if (v === 0xffffffff) continue;
        checked++;
        if (sceneBin[base + v] === 0x1f && sceneBin[base + v + 1] === 0x8b) magicAtByteOffset++;
        if (sceneBin[base + v * 4] === 0x1f && sceneBin[base + v * 4 + 1] === 0x8b) magicAtWordOffset++;
      }
    }
    console.log('Container:', JSON.stringify({ scenes: scenes.length, streamTotal, padBytes, magicAtWordOffset: `${magicAtWordOffset}/${checked}`, magicAtByteOffset: `${magicAtByteOffset}/${checked}` }));
    expect(magicAtWordOffset).toBe(checked);
    expect(magicAtByteOffset).toBeLessThan(checked / 10);
  }, 120_000);
});

describe.skipIf(!available)('S30-Probe: Szenen-Partition und Referenzschluss', () => {
  const sceneBin = available ? readFileSync(join(BATTLE_DIR, 'scene.bin')) : new Uint8Array(0);
  const { scenes } = available ? loadScenes(new Uint8Array(sceneBin)) : { scenes: [] as RawScene[] };

  function enemyIds(s: RawScene): number[] {
    return [s.view.getUint16(0, true), s.view.getUint16(2, true), s.view.getUint16(4, true)];
  }

  it('Formationsplätze referenzieren ausschließlich die 3 Szenen-Gegner (Kontrolle: Nachbarszene)', () => {
    let slots = 0;
    let leer = 0;
    let treffer = 0;
    let kontrolle = 0;
    for (let si = 0; si < scenes.length; si++) {
      const ids = enemyIds(scenes[si]!);
      const nachbar = enemyIds(scenes[(si + 1) % scenes.length]!);
      for (let f = 0; f < 4; f++) {
        for (let e = 0; e < 6; e++) {
          const id = scenes[si]!.view.getUint16(OFF.formation + f * 96 + e * 16, true);
          slots++;
          if (id === 0xffff) {
            leer++;
            continue;
          }
          if (ids.includes(id)) treffer++;
          if (nachbar.includes(id)) kontrolle++;
        }
      }
    }
    const belegt = slots - leer;
    console.log('Formation→Gegner:', JSON.stringify({ slots, leer, belegt, treffer, kontrolle }));
    // Nullwert-Zweitrechnung: Quote NUR über belegte Plätze.
    expect(treffer).toBe(belegt);
    expect(kontrolle / belegt).toBeLessThan(0.5);
  });

  it('Gegner-AttackIDs @0x48 referenzieren die Szenen-Attacktabelle @0x840 (Kontrolle: Nachbarszene)', () => {
    let refs = 0;
    let treffer = 0;
    let kontrolle = 0;
    let leer = 0;
    for (let si = 0; si < scenes.length; si++) {
      const s = scenes[si]!;
      const table = new Set<number>();
      const ntable = new Set<number>();
      for (let i = 0; i < 32; i++) {
        table.add(s.view.getUint16(OFF.attackIds + i * 2, true));
        ntable.add(scenes[(si + 1) % scenes.length]!.view.getUint16(OFF.attackIds + i * 2, true));
      }
      for (let e = 0; e < 3; e++) {
        const eoff = OFF.enemy + e * 184;
        for (let a = 0; a < 16; a++) {
          const id = s.view.getUint16(eoff + 0x48 + a * 2, true);
          if (id === 0xffff) {
            leer++;
            continue;
          }
          refs++;
          if (table.has(id)) treffer++;
          if (ntable.has(id)) kontrolle++;
        }
      }
    }
    console.log('Gegner→Attacken:', JSON.stringify({ refs, treffer, kontrolle, leer }));
    expect(treffer).toBe(refs);
    expect(kontrolle / refs).toBeLessThan(0.5);
  });

  it('HP u32@0xA4 und Level u8@0x20 (Kontrolle: um 1 Byte verschoben); EXP↔Level-Konkordanz', () => {
    let belegt = 0;
    let unbenutzt = 0;
    let hpOk = 0;
    let hpShifted = 0;
    let lvOk = 0;
    const used: { level: number; exp: number; expShifted: number }[] = [];
    for (const s of scenes) {
      const ids = enemyIds(s);
      for (let e = 0; e < 3; e++) {
        if (ids[e] === 0xffff) {
          unbenutzt++;
          continue;
        }
        belegt++;
        const eoff = OFF.enemy + e * 184;
        const hp = s.view.getUint32(eoff + 0xa4, true);
        if (hp >= 1 && hp <= 1_000_000) hpOk++;
        const hpS = s.view.getUint32(eoff + 0xa3, true);
        if (hpS >= 1 && hpS <= 1_000_000) hpShifted++;
        const lv = s.bytes[eoff + 0x20]!;
        if (lv >= 1 && lv <= 99) lvOk++;
        used.push({
          level: lv,
          exp: s.view.getUint32(eoff + 0xa8, true),
          expShifted: s.view.getUint32(eoff + 0xa9, true),
        });
      }
    }
    // Konkordanz: höheres Level ⇒ tendenziell mehr EXP. Nullwert-Zweitrechnung:
    // EXP-0-Gegner (Story-Bosse) fliegen raus, sonst misst man deren Sonderfall.
    const nonzero = used.filter((u) => u.exp > 0);
    const concord = (key: 'exp' | 'expShifted') => {
      let con = 0;
      let tot = 0;
      for (let i = 0; i < nonzero.length; i++) {
        for (let j = i + 1; j < nonzero.length; j++) {
          const a = nonzero[i]!;
          const b = nonzero[j]!;
          if (a.level === b.level) continue;
          tot++;
          const expOrder = a[key] <= b[key];
          if (a.level < b.level === expOrder) con++;
        }
      }
      return con / tot;
    };
    const kExp = concord('exp');
    const kShift = concord('expShifted');
    console.log(
      'Gegner-Record:',
      JSON.stringify({
        belegt,
        unbenutzt,
        hpOk: `${hpOk}/${belegt}`,
        hpShifted: `${hpShifted}/${belegt}`,
        lvOk: `${lvOk}/${belegt}`,
        expNonzero: nonzero.length,
        konkordanzExpLevel: kExp.toFixed(3),
        konkordanzShifted: kShift.toFixed(3),
      }),
    );
    expect(hpOk).toBe(belegt);
    expect(hpShifted).toBeLessThan(belegt * 0.9);
    expect(lvOk).toBe(belegt);
    expect(kExp).toBeGreaterThan(0.75);
    expect(kExp).toBeGreaterThan(kShift + 0.1);
  }, 60_000);

  it('KI-Offsettabellen: Sweep bestätigt 0xE80 (Gegner) und 0xC80 (Formation) — Community-Angabe 0xF00 widerlegt', () => {
    // Kriterium je Kandidatenposition P: 3 u16, jedes 0xFFFF oder monotoner
    // Offset in [6, 0x1E80-P); Korrelation „Slot belegt ⇔ Gegner existiert".
    const scored: { P: number; corr: number }[] = [];
    for (let P = 0xc00; P <= 0x1400; P += 2) {
      let corrOk = 0;
      for (const s of scenes) {
        const vals = [s.view.getUint16(P, true), s.view.getUint16(P + 2, true), s.view.getUint16(P + 4, true)];
        const ids = enemyIds(s);
        let ok = true;
        let prev = -1;
        let any = false;
        for (const v of vals) {
          if (v === 0xffff) continue;
          any = true;
          if (v < 6 || P + v >= SCENE_LEN || v <= prev) {
            ok = false;
            break;
          }
          prev = v;
        }
        if (!ok || !any) continue;
        let corr = true;
        for (let e = 0; e < 3; e++) {
          if (vals[e] !== 0xffff !== (ids[e] !== 0xffff)) corr = false;
        }
        if (corr) corrOk++;
      }
      scored.push({ P, corr: corrOk });
    }
    scored.sort((a, b) => b.corr - a.corr);
    const winner = scored[0]!;
    const zweiter = scored.find((s) => Math.abs(s.P - winner.P) > 8)!;
    const bei0xf00 = scored.find((s) => s.P === 0xf00)!;
    console.log(
      'KI-Offset-Sweep:',
      JSON.stringify({
        sieger: `0x${winner.P.toString(16)} (${winner.corr}/256)`,
        zweiterAbseits: `0x${zweiter.P.toString(16)} (${zweiter.corr}/256)`,
        community0xF00: `${bei0xf00.corr}/256`,
      }),
    );
    expect(winner.P).toBe(OFF.enemyAi);
    expect(winner.corr).toBeGreaterThan(zweiter.corr * 2);

    // Formation-KI @0xC80: Offsets zeigen in [0xC88, 0xE80).
    let fBelegt = 0;
    let fOk = 0;
    let fLeer = 0;
    for (const s of scenes) {
      for (let f = 0; f < 4; f++) {
        const v = s.view.getUint16(OFF.formationAi + f * 2, true);
        if (v === 0xffff) {
          fLeer++;
          continue;
        }
        fBelegt++;
        if (v >= 8 && OFF.formationAi + v < OFF.enemyAi) fOk++;
      }
    }
    console.log('Formation-KI:', JSON.stringify({ fBelegt, fOk, fLeer }));
    expect(fOk).toBe(fBelegt);
  });

  it('Gegnernamen dekodieren mit der S13-Zeichentabelle zu deutschem Text (Kontrolle: falscher Versatz)', () => {
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET);
    const falsch = buildAsciiTable(0x10);
    let namen = 0;
    let likeSum = 0;
    let likeFalschSum = 0;
    let vollstaendig = 0;
    for (const s of scenes) {
      const ids = enemyIds(s);
      for (let e = 0; e < 3; e++) {
        if (ids[e] === 0xffff) continue;
        const raw = s.bytes.subarray(OFF.enemy + e * 184, OFF.enemy + e * 184 + 32);
        const dec = decodeFfText(raw, table);
        const decF = decodeFfText(raw, falsch);
        if (dec.text.length === 0) continue;
        namen++;
        likeSum += germanLikeness(dec.text);
        likeFalschSum += germanLikeness(decF.text);
        if (dec.unknownBytes === 0) vollstaendig++;
      }
    }
    const like = likeSum / namen;
    const likeFalsch = likeFalschSum / namen;
    console.log(
      'Gegnernamen:',
      JSON.stringify({ namen, vollstaendig, likeness: like.toFixed(3), likenessFalscherVersatz: likeFalsch.toFixed(3) }),
    );
    // Namen sind kurz (keine Bigramm-Dichte wie Fließtext) — entscheidend ist
    // der Abstand zur Kontrolle, nicht der Absolutwert.
    expect(like).toBeGreaterThan(likeFalsch * 1.3);
    // 🟡 Umlaute liegen außerhalb des linearen Fensters (S13: Extended-Bytes) —
    // „vollständig" bleibt deshalb eine berichtete Zahl, kein Gate.
    expect(vollstaendig / namen).toBeGreaterThan(0.5);
  });

  it('Referenzschluss: alle Kampf-IDs der Encounter-Tabellen lösen auf nicht-leere Formationen auf', async () => {
    // Formationen mit ≥1 Gegner:
    const nonEmpty = new Set<number>();
    for (let si = 0; si < scenes.length; si++) {
      for (let f = 0; f < 4; f++) {
        for (let e = 0; e < 6; e++) {
          if (scenes[si]!.view.getUint16(OFF.formation + f * 96 + e * 16, true) !== 0xffff) {
            nonEmpty.add(si * 4 + f);
            break;
          }
        }
      }
    }

    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const encounterIds = new Set<number>();
    let battleOpIds = 0;
    let battleOpResolved = 0;
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const sec = parsed.bundle?.rawSections[7];
      if (!sec || sec.length !== 48) continue;
      const view = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      for (const t of [0, 1]) {
        for (let i = 0; i < 10; i++) {
          const raw = view.getUint16(t * 24 + 2 + i * 2, true);
          if (raw === 0) continue;
          encounterIds.add(raw & 0x03ff);
        }
      }
    }
    await dir.closeAll();

    let resolved = 0;
    const misses: number[] = [];
    for (const id of encounterIds) {
      if (nonEmpty.has(id)) resolved++;
      else misses.push(id);
    }
    // Kontrolle: um 1 verschobene IDs müssen messbar schlechter auflösen —
    // ABER: bei 940/1024 nicht-leeren Formationen ist auch diese Kontrolle
    // teilblind; der eigentliche Test ist resolved == alle.
    let shifted = 0;
    for (const id of encounterIds) {
      if (nonEmpty.has((id + 1) & 0x3ff)) shifted++;
    }
    console.log(
      'Encounter-Schluss:',
      JSON.stringify({
        formationenNichtLeer: nonEmpty.size,
        encounterIds: encounterIds.size,
        aufgeloest: resolved,
        misses: misses.slice(0, 8),
        kontrolleVerschoben: shifted,
        battleOpIds,
        battleOpResolved,
      }),
    );
    expect(resolved).toBe(encounterIds.size);
  }, 900_000);
});

describe.skipIf(!available)('S30-Probe: battle.lgp — Namenskonvention und Modellkette', () => {
  it('Namensraster, Skelett-Grammatik, Modell-Referenzschluss, Suffix-Klassifikation', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const entries = [...index.listEntries('battle')];
    const names = entries.map((e) => e.name);
    const nameSet = new Set(names);

    // Namensraster: ausnahmslos 4 Kleinbuchstaben, keine Endungen.
    const vierBuchstaben = names.filter((n) => /^[a-z]{4}$/.test(n)).length;
    const prefixes = new Set(names.filter((n) => /^[a-z]{4}$/.test(n)).map((n) => n.slice(0, 2)));
    // Jedes Präfix trägt genau ein 'aa' (Skelett) — Kern der Konvention.
    let prefixMitAa = 0;
    for (const p of prefixes) if (nameSet.has(p + 'aa')) prefixMitAa++;

    // Skelett-Grammatik: len == 52 + 12·bones mit bones == u32@12, über ALLE '..aa'.
    let skel = 0;
    let skelOk = 0;
    let boneMax = 0;
    for (const e of entries) {
      if (!e.name.endsWith('aa') || e.name.length !== 4) continue;
      skel++;
      const data = await index.readEntry(e.canonicalId);
      if (data.length >= 52) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const bones = view.getUint32(12, true);
        if (52 + bones * 12 === data.length) {
          skelOk++;
          boneMax = Math.max(boneMax, bones);
        }
      }
    }

    // Gegner-ID → Präfix (Basis 26): Schluss gegen den Szenenbestand.
    const sceneBin = readFileSync(join(BATTLE_DIR, 'scene.bin'));
    const { scenes } = loadScenes(new Uint8Array(sceneBin));
    const allIds = new Set<number>();
    for (const s of scenes) {
      for (let e = 0; e < 3; e++) {
        const id = s.view.getUint16(e * 2, true);
        if (id !== 0xffff) allIds.add(id);
      }
    }
    let modellOk = 0;
    for (const id of allIds) {
      const code = String.fromCharCode(97 + Math.floor(id / 26)) + String.fromCharCode(97 + (id % 26));
      if (nameSet.has(code + 'aa')) modellOk++;
    }
    // ⚠️ Grenze — blinde Kontrolle: Der ID-Raum ist dicht (0..369, nur 16
    // Lücken), fast jeder Nachbarcode existiert ebenfalls. id+1 löst deshalb
    // genauso auf und trennt NICHT. Die Zuordnung stützt sich auf die exakte
    // Basis-26-Arithmetik + den Sichtnachweis (S32); hier wird nur die
    // Vollständigkeit geschlossen.
    const idsSorted = [...allIds].sort((a, b) => a - b);

    // Suffix-Klassifikation über Inhalts-Signaturen (Stichprobe je Suffix):
    // .p-Parser und .tex-Parser aus S7 — Accounting entscheidet.
    const bySuffix = new Map<string, string[]>();
    for (const n of names) {
      if (!/^[a-z]{4}$/.test(n)) continue;
      const suf = n.slice(2);
      if (!bySuffix.has(suf)) bySuffix.set(suf, []);
      bySuffix.get(suf)!.push(n);
    }
    const klassen: Record<string, { p: number; tex: number; skel: number; sonst: number }> = {};
    for (const [suf, list] of bySuffix) {
      if (list.length < 50) continue; // nur die tragenden Klassen
      const sample = list.filter((_, i) => i % Math.ceil(list.length / 24) === 0).slice(0, 24);
      const k = { p: 0, tex: 0, skel: 0, sonst: 0 };
      for (const n of sample) {
        const entry = entries.find((e) => e.name === n)!;
        const data = await index.readEntry(entry.canonicalId);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (data.length >= 52 && 52 + view.getUint32(12, true) * 12 === data.length) k.skel++;
        else if (parseP(data, n).value) k.p++;
        else if (parseTex(data, n).value) k.tex++;
        else k.sonst++;
      }
      klassen[suf] = k;
    }

    console.log(
      'battle.lgp:',
      JSON.stringify(
        {
          eintraege: entries.length,
          vierBuchstaben,
          praefixe: prefixes.size,
          praefixMitAa: prefixMitAa,
          skelette: `${skelOk}/${skel}`,
          boneMax,
          gegnerIds: { anzahl: allIds.size, min: idsSorted[0], max: idsSorted.at(-1) },
          modellSchluss: `${modellOk}/${allIds.size}`,
          suffixKlassen: klassen,
        },
        null,
        1,
      ),
    );

    expect(vierBuchstaben).toBe(entries.length);
    expect(prefixMitAa).toBe(prefixes.size);
    expect(skelOk).toBe(skel);
    expect(modellOk).toBe(allIds.size);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(!available)('S30-Probe: kernel.bin Sektionen 0–2 (Command/Attack/Growth)', () => {
  it('Record-Accounting und Growth-Struktur mit Kurvenbasis-Ableitung', async () => {
    const kernelBytes = readFileSync(join(REAL_DIR, 'data', 'kernel', 'kernel.bin'));
    const { parseKernelContainer } = await import('@webmidgar/formats-kernel');
    const container = await parseKernelContainer(new Uint8Array(kernelBytes), 'kernel.bin');
    expect(container).not.toBeNull();
    const secs = container!.sections;

    // Sektion 0: Commands 32×8; Sektion 1: Attacken 128×28.
    expect(secs[0]!.data.length).toBe(32 * 8);
    expect(secs[1]!.data.length).toBe(128 * 28);

    const g = secs[2]!.data;
    const gv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    expect(g.length).toBe(3988);

    // 9 Charakter-Records à 56 B: alle 81 Kurvenindizes < 64; HP/MP/EXP-Indizes
    // liegen in getrennten Neuner-Bändern (37..45 / 46..54 / 55..63) — eine
    // Struktur, die eine falsche Recordgröße sofort zerstört.
    let idxOk = 0;
    const hpBand = new Set<number>();
    const mpBand = new Set<number>();
    const expBand = new Set<number>();
    for (let c = 0; c < 9; c++) {
      for (let i = 0; i < 9; i++) {
        const v = g[c * 56 + i]!;
        if (v < 64) idxOk++;
      }
      hpBand.add(g[c * 56 + 6]!);
      mpBand.add(g[c * 56 + 7]!);
      expBand.add(g[c * 56 + 8]!);
    }
    expect(idxOk).toBe(81);
    expect([...hpBand].every((v) => v >= 37 && v <= 45)).toBe(true);
    expect([...mpBand].every((v) => v >= 46 && v <= 54)).toBe(true);
    expect([...expBand].every((v) => v >= 55 && v <= 63)).toBe(true);
    expect(hpBand.size).toBe(9);
    expect(mpBand.size).toBe(9);
    expect(expBand.size).toBe(9);

    // Kurvenbasis AUS DEN DATEN: Der EXP-Block (Kurven 55..63, 144 B) besteht
    // aus (grad,0)-Paaren. Der längste solche Lauf im Sektionsbereich
    // liefert seinen Anfang; Basis = Laufanfang − 55·16.
    let best = { start: -1, len: 0 };
    for (let start = 0x200; start < 0x800; start += 2) {
      let len = 0;
      while (start + len * 2 + 1 < g.length && g[start + len * 2 + 1] === 0 && g[start + len * 2] !== 0) len++;
      if (len > best.len) best = { start, len };
    }
    const curveBase = best.start - 55 * 16;
    console.log(
      'Growth:',
      JSON.stringify({ expLauf: `@0x${best.start.toString(16)} (${best.len} Paare)`, kurvenBasis: `0x${curveBase.toString(16)}` }),
    );
    expect(curveBase).toBe(0x21c);

    // Alle 9 EXP-Kurven: Basisbyte 0 in allen 8 Paaren; Kontrolle: um 4 B
    // verschobene Basis verletzt das.
    const expBaseOk = (base: number) => {
      let ok = 0;
      for (let k = 55; k < 64; k++) {
        let allZero = true;
        for (let i = 0; i < 8; i++) if (g[base + k * 16 + i * 2 + 1] !== 0) allZero = false;
        if (allZero) ok++;
      }
      return ok;
    };
    expect(expBaseOk(0x21c)).toBe(9);
    expect(expBaseOk(0x21c + 4)).toBeLessThan(9);

    // Gewinn-Tabellen vor dem Kurvenblock: 0x1F8 12 B Statgewinn (klein,
    // monoton), 0x204 12 B HP-Gewinn, 0x210 12 B MP-Gewinn (beide monoton).
    const monotone = (off: number, n: number) => {
      for (let i = 1; i < n; i++) if (g[off + i]! < g[off + i - 1]!) return false;
      return true;
    };
    expect(monotone(0x1f8, 12)).toBe(true);
    expect(monotone(0x204, 12)).toBe(true);
    expect(monotone(0x210, 12)).toBe(true);

    // Accounting der gedeuteten Bereiche; Rest [0x61C, 0xF94) bleibt roh (🟡).
    expect(9 * 56).toBe(0x1f8);
    expect(0x1f8 + 12 + 12 + 12).toBe(0x21c);
    expect(0x21c + 64 * 16).toBe(0x61c);
    expect(g.length - 0x61c).toBe(2424);
  }, 120_000);
});

describe.skipIf(!available)('S30-Probe: Inventar magic.lgp, camdat, Stages', () => {
  it('inventarisiert die übrigen Kampf-Assets (nur Zähler)', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const magic = [...index.listEntries('magic')];
    const extH = new Map<string, number>();
    for (const e of magic) {
      const dot = e.name.lastIndexOf('.');
      const ext = dot >= 0 ? e.name.slice(dot) : '(ohne)';
      extH.set(ext, (extH.get(ext) ?? 0) + 1);
    }
    const camdat = [0, 1, 2].map((i) => {
      const p = join(BATTLE_DIR, `camdat${i}.bin`);
      return existsSync(p) ? readFileSync(p).length : -1;
    });
    console.log(
      'Inventar:',
      JSON.stringify({
        magicEintraege: magic.length,
        magicEndungen: [...extH.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        camdatBytes: camdat,
      }),
    );
    expect(magic.length).toBeGreaterThan(0);
    await dir.closeAll();
  }, 300_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
