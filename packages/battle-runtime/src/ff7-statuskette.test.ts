import { describe, expect, it } from 'vitest';
import {
  abgeleiteteWerte,
  addiereAusruestungsBonus,
  addiereStatProzent,
  alsI8,
  ausweichProzent,
  FLUCHRING_ID,
  grundwerte,
  inKaempfer,
  wendeStatProzentAn,
} from './ff7-statuskette.js';
import { leererKontext, trunc32 } from './ff7-schaden.js';
import { setzeZufall } from './ff7-zufall.js';
import { physischerTrefferwurf } from './ff7-treffer.js';

/**
 * Testvektoren 11.8 (Statuskette) und 11.9 (Trefferwurf), Schritt für
 * Schritt. Die Eingaben stehen im Klartext — es sind Zahlen aus der
 * Spezifikation, keine Originaldaten.
 */

/** Waffe 0, Buster Sword — nur die Felder, die die Kette liest. */
const BUSTER = {
  attackPower: 18, // +0x04
  accuracy: 96, // +0x08
  criticalBonus: 0, // +0x07
  statBoostIndex: [0x02, 0xff, 0xff, 0xff],
  statBoostAmount: [0x02, 0xff, 0xff, 0xff].map(alsI8),
};

/** Rüstung 2, Titan Bangle. */
const TITAN = {
  defense: 14, // +0x02
  magicDefense: 4, // +0x03 — wird NICHT gebraucht
  defensePercent: 2, // +0x04
  magicDefensePercent: 0, // +0x05
  statBoostIndex: [0x00, 0xff, 0xff, 0xff],
  statBoostAmount: [0x00, 0xff, 0xff, 0xff].map(alsI8),
};

describe('Testvektor 11.8 — die Statuskette von Ende zu Ende', () => {
  const BASIS = [40, 30, 22, 25, 21, 18];
  const QUELLEN = [5, 0, 0, 0, 0, 0];

  const kette = () => {
    const stat = grundwerte({
      base: BASIS,
      sourceBonus: QUELLEN,
      ausruestung: [
        { index: BUSTER.statBoostIndex, amount: BUSTER.statBoostAmount },
        { index: TITAN.statBoostIndex, amount: TITAN.statBoostAmount },
      ],
    });
    return { stat, w: abgeleiteteWerte({ stat, weaponAttackPower: BUSTER.attackPower, armorDefense: TITAN.defense }) };
  };

  it('trifft die vier Grundwerte, Waffenbonus eingerechnet', () => {
    const { stat } = kette();
    expect(stat[0]).toBe(45); // 40 + 5 + 0
    expect(stat[1]).toBe(30); // 30 + 0 + 0
    /**
     * ⚠️ **Die Stelle, an der ein Entwurf des Bestands selbst danebenlag.**
     * Der Buster Sword trägt `statBoostIndex = 02` mit `amount = +2`, also
     * Magie +2. Wer den Waffenbonus überspringt, bekommt hier 22 statt 24 —
     * und damit auch Magieangriff 22 statt 24.
     */
    expect(stat[2]).toBe(24);
    expect(stat[3]).toBe(25);
  });

  it('trifft die vier abgeleiteten Werte — ohne die Magieabwehr der Rüstung', () => {
    const { w } = kette();
    expect(w.attack).toBe(63); // 18 + 45
    expect(w.defense).toBe(44); // 14 + 30
    expect(w.magicAttack).toBe(24); // 0 + 24
    /**
     * 🟢 **Die Rüstung trägt `magicDefense = 4` — und sie wird nicht
     * addiert.** Wer sie mitrechnet, bekommt 29 und liegt bei jedem
     * magischen Treffer rund 2 % daneben.
     */
    expect(w.magicDefense).toBe(25);
    expect(TITAN.magicDefense).toBe(4);
    expect(w.magicDefense).not.toBe(25 + TITAN.magicDefense);
  });

  it('hebt nur den Angriff auf mindestens 1', () => {
    const leer = inKaempfer({ attack: 0, defense: 0, magicAttack: 0, magicDefense: 0 });
    expect(leer.attack).toBe(1);
    expect(leer.defense).toBe(0);
    expect(leer.magicAttack).toBe(0);
    expect(leer.magicDefense).toBe(0);
  });

  it('rechnet Dragon Force durch, wie der Vektor es vorführt', () => {
    // statPct[2] = +50 auf die Abwehr des Ziels: 30 → 45.
    expect(wendeStatProzentAn(30, 50)).toBe(45);
    // Damit wird aus dem Verteidigungsterm 512−30=482 ein 512−45=467 …
    expect(512 - 45).toBe(467);
    // … und aus dem Vorstreuungsschaden 122 ein 118.
    expect(trunc32(130 * 467 * 16, 8192)).toBe(118);
  });

  it('ignoriert Bonusindizes über 5 statt sie zu klemmen', () => {
    const bonus = [0, 0, 0, 0, 0, 0];
    addiereAusruestungsBonus(bonus, { index: [0xff, 6, 254, 5], amount: [99, 99, 99, 3] });
    expect(bonus).toEqual([0, 0, 0, 0, 0, 3]);
  });

  it('lässt den Bonus-Akkumulator als u8 überlaufen', () => {
    const bonus = [200, 0, 0, 0, 0, 0];
    addiereAusruestungsBonus(bonus, { index: [0, 0], amount: [100, 0] });
    expect(bonus[0]).toBe(44); // 300 & 0xFF
  });

  it('addiert den Fluchring pauschal', () => {
    const ohne = grundwerte({ base: BASIS, sourceBonus: QUELLEN, ausruestung: [] });
    const mit = grundwerte({ base: BASIS, sourceBonus: QUELLEN, ausruestung: [], accessoryId: FLUCHRING_ID });
    expect(mit[0]! - ohne[0]!).toBe(15);
    expect(mit[5]! - ohne[5]!).toBe(10);
  });

  it('kürzt Prozentsätze zur Null hin, auch negativ', () => {
    expect(wendeStatProzentAn(63, 0)).toBe(63);
    expect(wendeStatProzentAn(7, 50)).toBe(10); // 7 + trunc(3,5) = 10
    expect(wendeStatProzentAn(7, -50)).toBe(4); // 7 + trunc(-3,5) = 7 − 3
    expect(Math.floor((7 * -50) / 100)).toBe(-4); // abrundend wäre 3 — falsch
  });

  it('klemmt Prozentsätze auf ±100 und nur in der gewählten Maske', () => {
    const pct = [0, 0, 0, 0, 0, 0, 0, 0];
    addiereStatProzent(pct, 50, 0x0c); // Abwehr + Magabwehr
    expect(pct).toEqual([0, 0, 50, 50, 0, 0, 0, 0]);
    addiereStatProzent(pct, 200, 0x0c);
    expect(pct[2]).toBe(100);
    addiereStatProzent(pct, -500, 0xff);
    expect(pct.every((v) => v === -100)).toBe(true);
  });
});

describe('Testvektor 11.9 — der physische Trefferwurf von Ende zu Ende', () => {
  it('rechnet die Rate auf 103 und trifft', () => {
    // dexTerm = trunc32(21, 4) = 5
    expect(trunc32(21, 4)).toBe(5);
    // Ausweichen Angreifer (Platz 0 < 4): (21>>2) + 2 = 7
    expect(ausweichProzent(0, 21, 2)).toBe(7);
    // Ausweichen Ziel (Platz 4): nur defensePercent = 5
    expect(ausweichProzent(4, 21, 5)).toBe(5);
    // rate = (96 + 5 + 7) − 5 = 103
    expect(96 + 5 + 7 - 5).toBe(103);

    // Tabelle so gebaut, dass zufallUnter(100) = 40 und wurf1bis100 = 37 fällt.
    const tabelle = new Uint8Array(256);
    for (let i = 0; i < 256; i++) tabelle[i] = i;
    // zufallUnter(100) = (t*100)>>8 = 40  →  t = 103 (103*100>>8 = 40)
    expect((103 * 100) >> 8).toBe(40);
    tabelle[0] = 103;
    // wurf1bis100 = trunc(r16*99/65535)+1 = 37  →  r16 ≈ 23831
    const r16 = 23831;
    expect((((r16 * 0x63) | 0) / 0xffff) | 0).toBe(36);
    tabelle[1] = r16 & 0xff;
    tabelle[2] = (r16 >> 8) & 0xff;

    const z = setzeZufall(tabelle, 0);
    const ctx = leererKontext();
    const r = physischerTrefferwurf(
      ctx,
      {
        hitRate: 96,
        dexterity: 21,
        evadeAttacker: 7,
        evadeTarget: 5,
        luckAttacker: 18,
        luckTarget: 10,
        attackerSlot: 0,
        targetSlot: 4,
        elemReaction: 0,
      },
      z,
    );
    expect(r.rate).toBe(103);
    expect(r.getroffen).toBe(true);
  });

  it('bestätigt: Trefferquote 1 geht IMMER daneben', () => {
    /**
     * Der Vektor führt diesen Randfall eigens vor: Bei `rate = 1` liefert
     * `wurf1bis100` mindestens 1, und `1 < 1` ist falsch. Genau deshalb ist
     * die Untergrenze 1 und der Vergleich streng.
     */
    const tabelle = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let seed = 0; seed < 32; seed++) {
      const z = setzeZufall(tabelle, seed);
      const ctx = leererKontext();
      const r = physischerTrefferwurf(
        ctx,
        {
          hitRate: 1,
          dexterity: 0,
          evadeAttacker: 0,
          evadeTarget: 0,
          luckAttacker: 0,
          luckTarget: 0,
          attackerSlot: 0,
          targetSlot: 4,
          elemReaction: 0,
        },
        z,
      );
      expect(r.rate).toBe(1);
      expect(r.getroffen).toBe(false);
    }
  });

  it('nimmt für Platz 3 den Party-Zweig des Ausweichens', () => {
    // `< 4`, nicht `< 3`: Platz 3 rechnet dexterity mit.
    expect(ausweichProzent(3, 40, 0)).toBe(10);
    expect(ausweichProzent(4, 40, 0)).toBe(0);
  });
});
