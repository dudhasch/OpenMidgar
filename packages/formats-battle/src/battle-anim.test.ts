import { describe, expect, it } from 'vitest';
import { parseBattleAnimBank, winkelZuGrad, ANIM_MAX_JOINTS } from './battle-anim.js';

/**
 * Fixtures für die Animationsbank (K9).
 *
 * Der Erzeuger unten ist **absichtlich eine zweite Umsetzung derselben
 * Grammatik**, nicht der umgedrehte Parser: Er wählt die Deltacodes selbst,
 * schreibt die Bits selbst und rechnet die Blocklänge selbst aus. Nur so
 * prüft der Test die Grammatik und nicht die eigene Hilfsfunktion.
 *
 * Keine Originaldaten — alle Bytes hier sind erzeugt.
 */

/** Bitschreiber, MSB zuerst. Spiegelbild von `Bitstrom`, unabhängig gebaut. */
class Schreiber {
  private readonly bits: number[] = [];

  bitzahl(): number {
    return this.bits.length;
  }

  schreibe(wert: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits.push((wert >> i) & 1);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3]! |= 1 << (7 - (i & 7));
    });
    return out;
  }
}

/** Verschiebungsdelta kodieren: 7 Bit, wenn es passt, sonst 16. */
function schreibeVerschiebung(s: Schreiber, delta: number): void {
  if (delta >= -64 && delta <= 63) {
    s.schreibe(0, 1);
    s.schreibe(delta & 0x7f, 7);
  } else {
    s.schreibe(1, 1);
    s.schreibe(delta & 0xffff, 16);
  }
}

/**
 * Drehdelta kodieren. `q` ist der Wert **vor** der Verschiebung um `shift`.
 * Die Zweigwahl ist hier von Hand hergeleitet, nicht aus dem Parser kopiert.
 */
function schreibeDrehung(s: Schreiber, q: number, shift: number): void {
  if (q === 0) {
    s.schreibe(0, 1);
    return;
  }
  s.schreibe(1, 1);
  if (q === -1) {
    s.schreibe(0, 3);
    return;
  }
  for (let k = 1; k <= 6; k++) {
    const halb = 1 << (k - 1);
    // Zweig k deckt +[2^(k−1) … 2^k−1] und −[2^(k−1)+1 … 2^k] ab.
    if (q >= halb && q <= 2 * halb - 1) {
      s.schreibe(k, 3);
      s.schreibe((q - halb) & ((1 << k) - 1), k);
      return;
    }
    if (q <= -halb - 1 && q >= -2 * halb) {
      s.schreibe(k, 3);
      s.schreibe((q + halb) & ((1 << k) - 1), k);
      return;
    }
  }
  s.schreibe(7, 3);
  s.schreibe(q & ((1 << (12 - shift)) - 1), 12 - shift);
}

interface Rahmenwunsch {
  /** Verschiebung: beim Schlüsselrahmen absolut, sonst als Delta. */
  t: [number, number, number];
  /** Je Gelenk drei Werte vor der Verschiebung um `shift`. */
  q: number[];
}

interface Satzwunsch {
  jointCount: number;
  shift: number;
  kopfWort?: number;
  rahmen: Rahmenwunsch[];
  /** Absichtlicher Defekt: `frameCount` im Satzkopf verfälschen. */
  frameCountLuege?: number;
  /** Absichtlicher Defekt: `packedSize` im Satzkopf verfälschen. */
  packedSizeAufschlag?: number;
}

/**
 * Platzhaltersatz, wie er 707-mal im Bestand steht: vier Byte Nutzlast,
 * `stromBytes == 0`, **kein `shift`-Byte**.
 */
function baueLeerenSatz(jointCount: number, frameCount: number, kopfWort: number): Uint8Array {
  const satz = new Uint8Array(16);
  const v = new DataView(satz.buffer);
  v.setUint32(0, jointCount, true);
  v.setUint32(4, frameCount, true);
  v.setUint32(8, 4, true);
  v.setUint16(12, kopfWort, true);
  v.setUint16(14, 0, true);
  return satz;
}

function baueSatz(w: Satzwunsch): Uint8Array {
  const s = new Schreiber();
  w.rahmen.forEach((r, idx) => {
    if (idx === 0) {
      for (const v of r.t) s.schreibe(v & 0xffff, 16);
      for (const q of r.q) s.schreibe(q & ((1 << (12 - w.shift)) - 1), 12 - w.shift);
    } else {
      for (const v of r.t) schreibeVerschiebung(s, v);
      for (const q of r.q) schreibeDrehung(s, q, w.shift);
    }
  });
  const strom = s.bytes();
  const block = new Uint8Array(5 + strom.length);
  const bv = new DataView(block.buffer);
  bv.setUint16(0, w.kopfWort ?? 0, true);
  bv.setUint16(2, strom.length, true);
  block[4] = w.shift;
  block.set(strom, 5);

  const packedSize = block.length + (w.packedSizeAufschlag ?? 0);
  const satz = new Uint8Array(12 + block.length);
  const sv = new DataView(satz.buffer);
  sv.setUint32(0, w.jointCount, true);
  sv.setUint32(4, w.frameCountLuege ?? w.rahmen.length, true);
  sv.setUint32(8, packedSize, true);
  satz.set(block, 12);
  return satz;
}

function baueBank(saetze: Satzwunsch[]): Uint8Array {
  const teile = saetze.map(baueSatz);
  const gesamt = new Uint8Array(4 + teile.reduce((a, t) => a + t.length, 0));
  new DataView(gesamt.buffer).setUint32(0, saetze.length, true);
  let at = 4;
  for (const t of teile) {
    gesamt.set(t, at);
    at += t.length;
  }
  return gesamt;
}

/** Erwartungswert der Winkelnormierung — ebenfalls von Hand, nicht aus dem Parser. */
function erwarteterWinkel(q: number, shift: number): number {
  const roh = ((q << shift) << 16) >> 16;
  return roh < 0 ? roh + 0x1000 : roh;
}

describe('Animationsbank <präfix>da', () => {
  it('liest einen reinen Schlüsselrahmen wertgetreu', () => {
    const q = [0, 1, 2047, -2048, 100, -100];
    const bank = baueBank([{ jointCount: 2, shift: 0, rahmen: [{ t: [10, -20, 30], q }] }]);
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(diagnostics).toEqual([]);
    expect(b!.animations).toHaveLength(1);
    const a = b!.animations[0]!;
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0]!.rootTranslation).toEqual([10, -20, 30]);
    expect([...a.frames[0]!.rotations]).toEqual(q.map((v) => erwarteterWinkel(v, 0)));
  });

  it('trifft alle sieben Zweige des Drehdeltas', () => {
    // je Zweig ein Vertreter: unverändert, k=0, k=1…6 positiv und negativ, k=7.
    const deltas = [0, -1, 1, -2, 2, -4, 5, -8, 20, -20, 40, -60, 700];
    const jointCount = Math.ceil(deltas.length / 3);
    const start = new Array(jointCount * 3).fill(0);
    const dq = [...deltas, ...new Array(jointCount * 3 - deltas.length).fill(0)];
    const bank = baueBank([
      { jointCount, shift: 0, rahmen: [{ t: [0, 0, 0], q: start }, { t: [0, 0, 0], q: dq }] },
    ]);
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(diagnostics).toEqual([]);
    const a = b!.animations[0]!;
    expect(a.frames).toHaveLength(2);
    expect([...a.frames[1]!.rotations]).toEqual(dq.map((v) => erwarteterWinkel(v, 0)));
  });

  it('quantisiert Winkel über shift und behält die 12-Bit-Breite', () => {
    for (const shift of [0, 1, 3, 7, 11]) {
      const grenze = 1 << (11 - shift);
      const q = [0, grenze - 1, -grenze];
      const bank = baueBank([{ jointCount: 1, shift, rahmen: [{ t: [0, 0, 0], q }] }]);
      const { bank: b, diagnostics } = parseBattleAnimBank(bank, `shift${shift}`);
      expect(diagnostics).toEqual([]);
      expect([...b!.animations[0]!.frames[0]!.rotations]).toEqual(q.map((v) => erwarteterWinkel(v, shift)));
    }
  });

  it('nimmt beide Zweige des Verschiebungsdeltas, mit s16-Überlauf', () => {
    const bank = baueBank([
      {
        jointCount: 1,
        shift: 0,
        rahmen: [
          { t: [32000, 0, 0], q: [0, 0, 0] },
          { t: [63, -64, 0], q: [0, 0, 0] }, // 7-Bit-Zweig, beide Ränder
          { t: [1000, -1000, 300], q: [0, 0, 0] }, // 16-Bit-Zweig
        ],
      },
    ]);
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(diagnostics).toEqual([]);
    const f = b!.animations[0]!.frames;
    expect(f[1]!.rootTranslation).toEqual([32063, -64, 0]);
    // 32063 + 1000 = 33063 läuft als short über — genau wie im Original.
    expect(f[2]!.rootTranslation).toEqual([-32473, -1064, 300]);
  });

  it('führt mehrere Animationen durch die Satzkette', () => {
    const bank = baueBank([
      { jointCount: 3, shift: 0, rahmen: [{ t: [1, 2, 3], q: new Array(9).fill(5) }] },
      {
        jointCount: 2,
        shift: 2,
        kopfWort: 0x1234,
        rahmen: [
          { t: [0, 0, 0], q: new Array(6).fill(1) },
          { t: [1, 1, 1], q: new Array(6).fill(-1) },
        ],
      },
    ]);
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(diagnostics).toEqual([]);
    expect(b!.animations).toHaveLength(2);
    expect(b!.animations[0]!.jointCount).toBe(3);
    expect(b!.animations[1]!.kopfWort).toBe(0x1234);
    expect(b!.animations[1]!.frames).toHaveLength(2);
  });

  it('fällt, wenn die Satzkette das Dateiende verfehlt', () => {
    const gut = baueBank([{ jointCount: 1, shift: 0, rahmen: [{ t: [0, 0, 0], q: [0, 0, 0] }] }]);
    const zuLang = new Uint8Array(gut.length + 1);
    zuLang.set(gut);
    const { bank, diagnostics } = parseBattleAnimBank(zuLang, 'fix');
    expect(bank).toBeNull();
    expect(diagnostics[0]!.message).toMatch(/Satzkette endet/);
  });

  it('fällt, wenn die Rahmenabrechnung nicht aufgeht', () => {
    for (const luege of [1, 3]) {
      const bank = baueBank([
        {
          jointCount: 2,
          shift: 0,
          rahmen: [
            { t: [0, 0, 0], q: new Array(6).fill(0) },
            { t: [1, 1, 1], q: new Array(6).fill(2) },
          ],
          frameCountLuege: luege,
        },
      ]);
      const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
      expect(b).toBeNull();
      expect(diagnostics.some((d) => /Rahmen/.test(d.message))).toBe(true);
    }
  });

  it('weist Blockköpfe zurück, die keine Winkelbits übrig lassen', () => {
    const bank = baueBank([{ jointCount: 1, shift: 0, rahmen: [{ t: [0, 0, 0], q: [0, 0, 0] }] }]);
    bank[4 + 12 + 4] = 12; // shift auf 12 setzen
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(b).toBeNull();
    expect(diagnostics[0]!.message).toMatch(/shift 12/);
  });

  it('weist Gelenkzahlen jenseits des Kratzpuffers zurück', () => {
    const bank = baueBank([{ jointCount: 1, shift: 0, rahmen: [{ t: [0, 0, 0], q: [0, 0, 0] }] }]);
    new DataView(bank.buffer).setUint32(4, ANIM_MAX_JOINTS + 1, true);
    const { bank: b, diagnostics } = parseBattleAnimBank(bank, 'fix');
    expect(b).toBeNull();
    expect(diagnostics[0]!.message).toMatch(/jointCount/);
  });

  it('erkennt Platzhaltersätze ohne Bitstrom und erfindet keine Rahmen', () => {
    // Eine Bank aus einem echten Satz und zwei Platzhaltern, wie im Bestand
    // gemischt. Der Platzhalter darf die Kette nicht stören.
    const echt = baueSatz({ jointCount: 4, shift: 4, rahmen: [{ t: [1, 2, 3], q: new Array(12).fill(3) }] });
    const leer1 = baueLeerenSatz(1, 1, 2573);
    const leer2 = baueLeerenSatz(36, 1, 6704);
    const gesamt = new Uint8Array(4 + echt.length + leer1.length + leer2.length);
    new DataView(gesamt.buffer).setUint32(0, 3, true);
    gesamt.set(echt, 4);
    gesamt.set(leer1, 4 + echt.length);
    gesamt.set(leer2, 4 + echt.length + leer1.length);

    const { bank, diagnostics } = parseBattleAnimBank(gesamt, 'fix');
    expect(diagnostics).toEqual([]);
    expect(bank!.animations.map((a) => a.leer)).toEqual([false, true, true]);
    expect(bank!.animations[1]!.frames).toEqual([]);
    expect(bank!.animations[2]!.kopfWort).toBe(6704);
    // Der echte Satz bleibt unberührt — die Platzhalter verschieben nichts.
    expect(bank!.animations[0]!.frames).toHaveLength(1);
    expect(bank!.animations[0]!.frames[0]!.rootTranslation).toEqual([1, 2, 3]);
  });

  it('rechnet PSX-Einheiten in Grad um', () => {
    expect(winkelZuGrad(0)).toBe(0);
    expect(winkelZuGrad(1024)).toBe(90);
    expect(winkelZuGrad(4095)).toBeCloseTo(359.912, 3);
  });
});
