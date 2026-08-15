import { describe, expect, it } from 'vitest';
import { leererKontext } from './ff7-schaden.js';
import { setzeZufall } from './ff7-zufall.js';
import {
  physischerTrefferwurf,
  STATUS_FURY,
  TREFFER_ERZWINGENDE_STATUS,
  wendeWutabzugAn,
  type TrefferEingabe,
} from './ff7-treffer.js';

/** `t[i] = i` — der Wert verrät den Lesekopfstand. Selbst erzeugt. */
const identitaet = (): Uint8Array => Uint8Array.from({ length: 256 }, (_, i) => i);

const EIN = (teil: Partial<TrefferEingabe> = {}): TrefferEingabe => ({
  hitRate: 100,
  dexterity: 40,
  evadeAttacker: 0,
  evadeTarget: 0,
  luckAttacker: 0,
  luckTarget: 0,
  attackerSlot: 0,
  targetSlot: 4,
  elemReaction: 0,
  ...teil,
});

describe('Physischer Trefferwurf', () => {
  it('zieht IMMER genau zwei Größen — auch bei erzwungenem Treffer', () => {
    const messeVerbrauch = (modifierFlags: number): number => {
      const z = setzeZufall(identitaet(), 0);
      const ctx = leererKontext({ modifierFlags });
      physischerTrefferwurf(ctx, EIN(), z);
      // zufallUnter = 1 Byte, wurf1bis100 = 2 Bytes; erster Aufruf ohne Bankwechsel.
      return z.cursor[0]!;
    };
    // Rückenangriff erzwingt den Treffer — und kostet trotzdem dieselben 3 Bytes.
    expect(messeVerbrauch(0)).toBe(3);
    expect(messeVerbrauch(1)).toBe(3);
  });

  it('vergleicht streng: eine Rate von 1 trifft nie', () => {
    const z = setzeZufall(identitaet(), 0);
    const ctx = leererKontext();
    // hitRate so tief, dass die Untergrenze 1 greift.
    const r = physischerTrefferwurf(ctx, EIN({ hitRate: -500, dexterity: 0 }), z);
    expect(r.rate).toBe(1);
    expect(r.getroffen).toBe(false);
    expect(ctx.resultFlags & 1).toBe(1);
  });

  it('klemmt die Rate nicht nach oben — 0xFF trifft immer', () => {
    for (let seed = 0; seed < 40; seed++) {
      const z = setzeZufall(identitaet(), seed);
      const ctx = leererKontext({ modifierFlags: 1 });
      const r = physischerTrefferwurf(ctx, EIN(), z);
      expect(r.rate).toBe(0xff);
      expect(r.getroffen).toBe(true);
    }
  });

  it('erzwingt Treffer und Heilung bei Schlaf, Verwirrung und Manipulation', () => {
    for (const [bit, name] of [
      [2, 'Schlaf'],
      [6, 'Verwirrung'],
      [22, 'Manipulation'],
    ] as const) {
      const z = setzeZufall(identitaet(), 0);
      const ctx = leererKontext({ targetStatus: 1 << bit });
      const r = physischerTrefferwurf(ctx, EIN({ hitRate: 0, dexterity: 0 }), z);
      expect(r.rate, name).toBe(0xff);
      expect(r.workCure, name).toBe(1 << bit);
    }
    // Versteinerung erzwingt den Treffer, wird davon aber NICHT geheilt.
    const z = setzeZufall(identitaet(), 0);
    const ctx = leererKontext({ targetStatus: 1 << 14 });
    const r = physischerTrefferwurf(ctx, EIN({ hitRate: 0 }), z);
    expect(r.rate).toBe(0xff);
    expect(r.workCure).toBe(0);
    expect(TREFFER_ERZWINGENDE_STATUS & (1 << 14)).toBeTruthy();
  });

  it('nimmt für beide Glückstests denselben Zug', () => {
    // Lesekopf so gesetzt, dass zufallUnter(100) = 0 liefert.
    const z = setzeZufall(identitaet(), 0);
    const ctx = leererKontext();
    // Angreiferglück 4 → 4>>2 = 1 > 0 → garantierter Treffer.
    const r = physischerTrefferwurf(ctx, EIN({ hitRate: 0, dexterity: 0, luckAttacker: 4 }), z);
    expect(r.rate).toBe(0xff);
    expect(r.getroffen).toBe(true);
  });

  it('lässt nur Gegner gegen Party per Zielglück danebenschlagen', () => {
    const bau = (attackerSlot: number, targetSlot: number) => {
      const z = setzeZufall(identitaet(), 0);
      const ctx = leererKontext();
      return physischerTrefferwurf(ctx, EIN({ attackerSlot, targetSlot, luckTarget: 4 }), z);
    };
    // Gegner (Platz 4) gegen Party (Platz 0): Zielglück greift.
    expect(bau(4, 0).rate).toBe(0);
    // Party gegen Gegner: greift nicht.
    expect(bau(0, 4).rate).not.toBe(0);
    // Platz 3 zählt noch zur Party — `> 3`, nicht `>= 3`.
    expect(bau(3, 0).rate).not.toBe(0);
  });

  it('zieht Wut ab, aber nicht von einer erzwungenen Rate', () => {
    expect(wendeWutabzugAn(1 << STATUS_FURY, 100)).toBe(70);
    expect(wendeWutabzugAn(1 << STATUS_FURY, 0xff)).toBe(0xff);
    expect(wendeWutabzugAn(0, 100)).toBe(100);
    // Kürzen, nicht runden: 7·3/10 = 2,1 → 2, also 7−2 = 5.
    expect(wendeWutabzugAn(1 << STATUS_FURY, 7)).toBe(5);
  });

  it('rechnet die Rate aus Quote, Geschick und beiden Ausweichwerten', () => {
    const z = setzeZufall(identitaet(), 0);
    const ctx = leererKontext();
    // 100 + trunc32(40,4)=10 + 5 − 20 = 95
    const r = physischerTrefferwurf(
      ctx,
      EIN({ hitRate: 100, dexterity: 40, evadeAttacker: 5, evadeTarget: 20 }),
      z,
    );
    expect(r.rate).toBe(95);
  });

  it('erzwingt den Treffer bei Elementarreaktion und bei Deckung', () => {
    for (const elem of [0x01, 0x02, 0x20, 0x40]) {
      const z = setzeZufall(identitaet(), 0);
      const ctx = leererKontext();
      expect(physischerTrefferwurf(ctx, EIN({ hitRate: 0, dexterity: 0, elemReaction: elem }), z).rate).toBe(0xff);
    }
    // Bit 0x04 gehört NICHT zur Maske 0x63.
    const z = setzeZufall(identitaet(), 0);
    const ctx = leererKontext();
    expect(physischerTrefferwurf(ctx, EIN({ hitRate: 0, dexterity: 0, elemReaction: 0x04 }), z).rate).not.toBe(0xff);

    const zc = setzeZufall(identitaet(), 0);
    const ctxc = leererKontext({ resultFlags: 0x20 });
    expect(physischerTrefferwurf(ctxc, EIN({ hitRate: 0, dexterity: 0 }), zc).rate).toBe(0xff);
  });
});
