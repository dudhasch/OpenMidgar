import { describe, expect, it } from 'vitest';
import {
  baueImmunitaetsmaske,
  EIMER_HEILEN,
  EIMER_UMSCHALTEN,
  EIMER_ZUFUEGEN,
  ladeStatusaenderung,
  RATE_SICHER,
  ST_DEATH_FORCE,
  ST_PEERLESS,
  ST_RESIST,
  wuerfleStatuserfolg,
  type ErfolgsEingabe,
} from './ff7-status.js';
import { setzeZufall } from './ff7-zufall.js';

const identitaet = (): Uint8Array => Uint8Array.from({ length: 256 }, (_, i) => i);

const IMM = (teil: Partial<Parameters<typeof baueImmunitaetsmaske>[0]> = {}) => ({
  statusLock: 0,
  status: 0,
  slot: 0,
  specialFlags: 0x0080,
  ...teil,
});

const ERF = (teil: Partial<ErfolgsEingabe> = {}): ErfolgsEingabe => ({
  rate: 100,
  inflict: 0x4,
  cure: 0,
  toggle: 0,
  targetStatus: 0,
  targetSlot: 4,
  targetFlags: 0,
  targetCount: 1,
  repeatCasts: 0,
  bonusPercent: 0,
  ...teil,
});

describe('Statusänderung laden', () => {
  it('teilt Modus und Rate im selben Byte auf', () => {
    // Eimer 0 (zufügen), Rate 0x20 << 2 = 128.
    const a = ladeStatusaenderung(0x20, 0x0004);
    expect(a.inflict).toBe(0x0004);
    expect(a.rate).toBe(128);
    expect(a.cure).toBe(0);

    const b = ladeStatusaenderung((EIMER_HEILEN << 6) | 0x10, 0x0008);
    expect(b.cure).toBe(0x0008);
    expect(b.rate).toBe(64);

    const c = ladeStatusaenderung((EIMER_UMSCHALTEN << 6) | 0x3f, 0x0010);
    expect(c.toggle).toBe(0x0010);
    expect(c.rate).toBe(252);
  });

  it('liest 0xFF als „keine Änderung" — weil 0xFF >>> 6 === 3 ist', () => {
    const a = ladeStatusaenderung(0xff, 0xffffffff);
    expect(a.inflict).toBe(0);
    expect(a.cure).toBe(0);
    expect(a.toggle).toBe(0);
    expect(0xff >>> 6).toBe(3);
  });

  it('lässt der Fangen-Sonderfall die Rate unangetastet — und damit sicher gelingen', () => {
    /**
     * Der Zweig schreibt `rate` nicht. Da sie einmal je Aktion auf `0xFF`
     * vorbelegt wird, gelingt so ein Datensatz automatisch. Das ist kein
     * Versehen der Nachbildung, sondern das Verhalten des Originals.
     */
    const a = ladeStatusaenderung(EIMER_ZUFUEGEN << 6, 0x80000002, 0xff);
    expect(a.inflict).toBe(0x80000000);
    expect(a.battleTypeSel).toBe(2);
    expect(a.rate).toBe(0xff);
    expect(a.rate).toBeGreaterThanOrEqual(RATE_SICHER);
  });
});

describe('Immunitätsmaske', () => {
  it('lässt Widerstand und Todeskraft nur mit honourResistBits gelten', () => {
    expect(baueImmunitaetsmaske(IMM({ status: 1 << ST_RESIST }))).toBe(0x5fffffff >>> 0);
    expect(baueImmunitaetsmaske(IMM({ status: 1 << ST_RESIST, honourResistBits: false }))).toBe(0);
    // Todeskraft zieht die Todesurteilsimmunität nach sich.
    const tk = baueImmunitaetsmaske(IMM({ status: 1 << ST_DEATH_FORCE }));
    expect(tk & 1).toBe(1);
    expect(tk & 0x00200000).toBe(0x00200000);
  });

  it('macht Peerless gegen alles außer Bit 31 immun — auch ohne honourResistBits', () => {
    const m = baueImmunitaetsmaske(IMM({ status: 1 << ST_PEERLESS, honourResistBits: false }));
    expect(m).toBe(0x7fffffff);
  });

  it('koppelt Hast und Verlangsamung', () => {
    expect(baueImmunitaetsmaske(IMM({ statusLock: 0x100 })) & 0x300).toBe(0x300);
    expect(baueImmunitaetsmaske(IMM({ statusLock: 0x200 })) & 0x300).toBe(0x300);
    expect(baueImmunitaetsmaske(IMM({ statusLock: 0x400 })) & 0x300).toBe(0);
  });

  it('lässt eine Wiederbelebung die Todesimmunität nur in der Party schlagen', () => {
    expect(baueImmunitaetsmaske(IMM({ statusLock: 1, allowRevive: true, slot: 0 })) & 1).toBe(0);
    // Platz 4 ist ein Gegner — dort greift die Ausnahme nicht.
    expect(baueImmunitaetsmaske(IMM({ statusLock: 1, allowRevive: true, slot: 4 })) & 1).toBe(1);
    // Und „kann nicht sterben" setzt sie danach wieder.
    expect(
      baueImmunitaetsmaske(IMM({ statusLock: 1, allowRevive: true, slot: 0, kannNichtSterben: true })) & 1,
    ).toBe(1);
  });

  it('löscht ALLES ohne Sonderflag 0x0080 — der letzte Schritt gewinnt', () => {
    const voll = IMM({ statusLock: 0xffffffff, status: 1 << ST_PEERLESS, specialFlags: 0 });
    expect(baueImmunitaetsmaske(voll)).toBe(0);
  });

  it('setzt verwandelt genau die drei Bits', () => {
    expect(baueImmunitaetsmaske(IMM({ verwandelt: true }))).toBe(0x00800840);
  });
});

describe('Erfolgswurf', () => {
  it('zieht NICHT, wenn die Rate 252 erreicht', () => {
    const z = setzeZufall(identitaet(), 0);
    expect(wuerfleStatuserfolg(ERF({ rate: RATE_SICHER }), z)).toBe(true);
    expect(z.cursor[0]).toBe(0); // kein Byte verbraucht
  });

  it('zieht genau ein Byte, wenn die Rate darunter liegt', () => {
    const z = setzeZufall(identitaet(), 0);
    wuerfleStatuserfolg(ERF({ rate: 100 }), z);
    expect(z.cursor[0]).toBe(1);
  });

  it('vergleicht mit r+1 — eine Rate von 1 scheitert immer', () => {
    for (let seed = 0; seed < 32; seed++) {
      const z = setzeZufall(identitaet(), seed);
      expect(wuerfleStatuserfolg(ERF({ rate: 1 }), z)).toBe(false);
    }
  });

  it('lässt Hast, Schild und Berserk auf einem Partymitglied immer landen', () => {
    for (const bit of [0x00000100, 0x00100000, 0x00800000]) {
      const z = setzeZufall(identitaet(), 0);
      expect(wuerfleStatuserfolg(ERF({ rate: 1, inflict: bit, targetSlot: 0 }), z)).toBe(true);
      // Auf einem Gegner nicht.
      const z2 = setzeZufall(identitaet(), 0);
      expect(wuerfleStatuserfolg(ERF({ rate: 1, inflict: bit, targetSlot: 4 }), z2)).toBe(false);
    }
  });

  it('gelingt sicher, wenn die Änderung genau Frosch oder Mini betrifft', () => {
    const z = setzeZufall(identitaet(), 0);
    // Ziel hat Frosch, und die Änderung ist genau das Froschbit.
    expect(wuerfleStatuserfolg(ERF({ rate: 1, inflict: 0x0800, targetStatus: 0x0800 }), z)).toBe(true);
    const z2 = setzeZufall(identitaet(), 0);
    expect(wuerfleStatuserfolg(ERF({ rate: 1, inflict: 0x1000, targetStatus: 0x1000 }), z2)).toBe(true);
  });

  it('drittelt bei mehreren Zielen und halbiert bei Mehrfachzauber', () => {
    // rate 100, drei Ziele, targetFlags ohne 0x04-Muster → (100*2)/3 = 66
    const z = setzeZufall(identitaet(), 0);
    z.cursor[0] = 168; // zufallUnter(100) = (168*100)>>8 = 65
    expect((168 * 100) >> 8).toBe(65);
    // 66 <= 65+1 = 66 → scheitert knapp.
    expect(wuerfleStatuserfolg(ERF({ rate: 100, targetCount: 3 }), z)).toBe(false);

    const z2 = setzeZufall(identitaet(), 0);
    z2.cursor[0] = 168;
    // Ohne Mehrfachziel: 100 > 66 → gelingt.
    expect(wuerfleStatuserfolg(ERF({ rate: 100, targetCount: 1 }), z2)).toBe(true);
  });

  it('scheitert an einem entfernten Ziel, wenn die Änderung den Tod betrifft', () => {
    const z = setzeZufall(identitaet(), 0);
    expect(
      wuerfleStatuserfolg(
        ERF({ rate: RATE_SICHER, inflict: 1, targetSlot: 4, removedActorMask: 1 << 4 }),
        z,
      ),
    ).toBe(false);
    // Ohne Todesbit stört die Entfernung nicht.
    const z2 = setzeZufall(identitaet(), 0);
    expect(
      wuerfleStatuserfolg(
        ERF({ rate: RATE_SICHER, inflict: 0x4, targetSlot: 4, removedActorMask: 1 << 4 }),
        z2,
      ),
    ).toBe(true);
  });
});
