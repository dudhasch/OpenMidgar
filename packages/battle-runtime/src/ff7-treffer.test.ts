import { describe, expect, it } from 'vitest';
import { leererKontext } from './ff7-schaden.js';
import { setzeZufall } from './ff7-zufall.js';
import {
  magischerTrefferwurf,
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

describe('Magischer Trefferwurf', () => {
  const MAG = (teil: Partial<Parameters<typeof magischerTrefferwurf>[1]> = {}) => ({
    hitRate: 100,
    attackerLevel: 30,
    targetLevel: 20,
    magicDefensePercent: 0,
    elemReaction: 0,
    statusInflict: 0,
    ...teil,
  });

  it('zieht BEIDE Größen vor jeder Abkürzung — die fragilste Reihenfolge', () => {
    const verbrauch = (hitRate: number): number => {
      const z = setzeZufall(identitaet(), 0);
      magischerTrefferwurf(leererKontext(), MAG({ hitRate }), z);
      return z.cursor[0]!;
    };
    // 0xFF heißt „kann nicht danebengehen" — kostet trotzdem beide Bytes.
    expect(verbrauch(0xff)).toBe(2);
    expect(verbrauch(100)).toBe(2);
  });

  it('kostet zwei zufallUnter — nicht einen plus wurf1bis100 wie physisch', () => {
    const zm = setzeZufall(identitaet(), 0);
    magischerTrefferwurf(leererKontext(), MAG(), zm);
    const zp = setzeZufall(identitaet(), 0);
    physischerTrefferwurf(leererKontext(), EIN(), zp);
    // Physisch: 1 + 2 = 3 Bytes. Magisch: 2. Die Wege sind verschieden teuer.
    expect(zm.cursor[0]).toBe(2);
    expect(zp.cursor[0]).toBe(3);
  });

  /**
   * ⚠️ Für einen Fehlschlag muss `r2 >= rate + lvlTerm` gelten. Bei einem
   * Angreifer weit ÜBER der Zielstufe ist `lvlTerm` so groß, dass selbst
   * Trefferquote 0 noch trifft — der erste Anlauf dieses Tests ist genau
   * daran gescheitert. Deshalb steht der Angreifer hier unter dem Ziel.
   */
  const SCHWACH = { hitRate: 0, attackerLevel: 1, targetLevel: 20 };

  it('lässt Reflect nur ohne Sonderflag 0x0200 durchgehen', () => {
    const mitReflect = leererKontext({ targetStatus: 1 << 18 });
    expect(magischerTrefferwurf(mitReflect, MAG(SCHWACH), setzeZufall(identitaet(), 0)).getroffen).toBe(true);
    const beachtet = leererKontext({ targetStatus: 1 << 18, specialFlags: 0x0200 });
    expect(magischerTrefferwurf(beachtet, MAG(SCHWACH), setzeZufall(identitaet(), 0)).getroffen).toBe(false);
  });

  it('kann bei gesetztem statusInflict doch danebengehen', () => {
    // Schlafendes Ziel: ohne Statuszufügung sicherer Treffer …
    const ohne = leererKontext({ targetStatus: 1 << 2 });
    expect(magischerTrefferwurf(ohne, MAG(SCHWACH), setzeZufall(identitaet(), 0)).getroffen).toBe(true);
    // … mit Statuszufügung greift die Ausnahme nicht mehr.
    const mit = leererKontext({ targetStatus: 1 << 2 });
    expect(
      magischerTrefferwurf(mit, MAG({ ...SCHWACH, statusInflict: 0x4 }), setzeZufall(identitaet(), 0)).getroffen,
    ).toBe(false);
  });

  it('lässt einen hochstufigen Angreifer auch mit Quote 0 treffen', () => {
    // Der Stufenterm allein trägt: 30 − trunc32(20,2) = 20, und r2 = 1 < 20.
    const ctx = leererKontext();
    expect(magischerTrefferwurf(ctx, MAG({ hitRate: 0 }), setzeZufall(identitaet(), 0)).getroffen).toBe(true);
  });

  it('rechnet den Stufenterm mit halber Zielstufe, zur Null hin gekürzt', () => {
    // lvlTerm = 30 − trunc32(21,2) = 30 − 10 = 20
    const z = setzeZufall(identitaet(), 0);
    // r1 = 0 (kein MDef%-Ausweichen), r2 = (1*100>>8)+1 = 1 → 1 >= rate+20?
    const ctx = leererKontext();
    const r = magischerTrefferwurf(ctx, MAG({ hitRate: 1, targetLevel: 21 }), z);
    expect(r.getroffen).toBe(true); // 1 >= 1+20 ist falsch
  });
});
