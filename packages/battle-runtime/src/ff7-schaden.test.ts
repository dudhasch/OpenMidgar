import { describe, expect, it } from 'vitest';
import {
  dekodiereSchadensbyte,
  klemmeSchaden,
  leererKontext,
  nimmtKeinenSchaden,
  sar,
  schadenMagisch,
  schadenPhysisch,
  SCHADENSKLASSEN_FLAGS,
  SONDEREFFEKT_AUS_LO,
  STATUS_BERSERK,
  STATUS_FROG,
  STATUS_SADNESS,
  STATUS_SMALL,
  trunc32,
  wuerfleKritisch,
  type KampfteilnehmerLage,
} from './ff7-schaden.js';

/**
 * Die Abrechnung für die zahlengleiche Schadensrechnung.
 *
 * **Die Testvektoren sind die Gütefunktion.** Der Bestand gibt sie
 * schrittweise mit Zwischenwerten an — jeder Zwischenwert ist eine eigene
 * scharfe Vorhersage, und eine falsch gesetzte Rundung verfehlt sie sofort.
 * Deshalb wird hier nicht nur das Ergebnis geprüft, sondern die Kette.
 *
 * Keine Originaldaten: Alle Eingaben stehen im Klartext im Test.
 */

const PARTY: KampfteilnehmerLage = { flags2: 0, backAttackMul8: 0x10, level: 20, luck: 20 };
const GEGNER: KampfteilnehmerLage = { flags2: 0, backAttackMul8: 16, level: 12, luck: 10 };

describe('Ganzzahl-Verhalten', () => {
  it('kürzt zur Null hin, nicht ab — der Unterschied zeigt sich nur negativ', () => {
    expect(trunc32(1160, 32)).toBe(36);
    expect(trunc32(78, 32)).toBe(2);
    expect(trunc32(1002560, 8192)).toBe(122);
    expect(trunc32(28, 4)).toBe(7);
    // Genau hier laufen Portierungen auseinander:
    expect(trunc32(-7, 2)).toBe(-3);
    expect(sar(-7, 1)).toBe(-4);
    expect(trunc32(-1, 8192)).toBe(0);
    expect(sar(-1, 13)).toBe(-1);
  });
});

describe('Schadensbyte (Tabellen am Abbild geprüft)', () => {
  it('trägt die 16 Klassenflags des Abbilds', () => {
    expect([...SCHADENSKLASSEN_FLAGS]).toEqual([
      0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x03, 0x02, 0x00, 0x00, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00,
    ]);
  });

  it('bildet die Sondereffekt-IDs ab, samt der Abweichung zur Vorlage', () => {
    expect([...SONDEREFFEKT_AUS_LO].slice(0, 9)).toEqual([0x0a, 0x0b, 0x0c, 0x0d, 0x1e, 0x1f, 0x20, 0x21, 0x22]);
    // Ab Versatz 12 liegt im Abbild die Konstante 1/256 — die Vorlage schreibt
    // dort Nullen. Nachgebildet ist das Abbild.
    expect([...SONDEREFFEKT_AUS_LO].slice(12)).toEqual([0x00, 0x00, 0x80, 0x3b]);
  });

  it('erzwingt physisch über Klassenflag 1 — und zwar VOR der Wahl des Angriffswerts', () => {
    // Gruppe 1 hat Flag 0x01: Bit 2 der Sonderflags wird gelöscht.
    const ctx = leererKontext({ damageCalc: 0x11, specialFlags: 0xffff });
    const { magisch } = dekodiereSchadensbyte(ctx);
    expect(ctx.formulaGroup).toBe(1);
    expect(ctx.formulaIndex).toBe(1);
    expect(magisch).toBe(false);
    expect(ctx.specialFlags & 0x0004).toBe(0);
  });

  it('lässt magisch stehen, wo kein Flag es löscht', () => {
    // Gruppe 2 hat Flag 0x00 — Bit 2 von 0xFDFD bleibt gesetzt.
    const ctx = leererKontext({ damageCalc: 0x22, specialFlags: 0xfdfd });
    expect(dekodiereSchadensbyte(ctx).magisch).toBe(true);
    expect(ctx.formulaIndex).toBe(2);
  });

  it('springt über Flag 2 in die zweite Formelhälfte', () => {
    const ctx = leererKontext({ damageCalc: 0x73, specialFlags: 0xffff }); // Gruppe 7 → Flag 0x02
    dekodiereSchadensbyte(ctx);
    expect(ctx.formulaIndex).toBe(0x13);
    expect(ctx.specialFlags & 0x0004).toBe(4); // NICHT physisch erzwungen
  });

  it('macht über Flag 4 aus dem niederen Nibble eine Effekt-ID', () => {
    const ctx = leererKontext({ damageCalc: 0xa4, specialFlags: 0xffff }); // Gruppe 10 → Flag 0x05
    dekodiereSchadensbyte(ctx);
    expect(ctx.specialEffectId).toBe(0x1e);
    expect(ctx.formulaIndex).toBe(1);
    expect(ctx.specialFlags & 0x0004).toBe(0); // Flag 0x05 enthält auch Bit 0
  });
});

describe('Testvektor 11.1 — normaler physischer Angriff, kein Kritischer', () => {
  const bau = () =>
    leererKontext({
      damageCalc: 0x11,
      specialFlags: 0xffff,
      targetFlags: 0x23,
      attackerLevel: 20,
      attackStat: 58,
      defence: 30,
      power: 16,
      targetCount: 1,
      repeatCasts: 0,
      bonusPercent: 0,
    });

  it('trifft jeden Zwischenwert der Kette', () => {
    const ctx = bau();
    dekodiereSchadensbyte(ctx);
    expect(ctx.formulaIndex).toBe(1);

    // Grundschaden, Schritt für Schritt wie im Vektor.
    const base = trunc32(20 * 58, 32) * trunc32(20 + 58, 32) + 58;
    expect(trunc32(20 * 58, 32)).toBe(36);
    expect(trunc32(20 + 58, 32)).toBe(2);
    expect(base).toBe(130);
    expect(512 - 30).toBe(482);
    expect(130 * 482 * 16).toBe(1002560);
    expect(trunc32(1002560, 8192)).toBe(122);

    // Und die ganze Kette: 122 vor der Streuung, 118 danach.
    const d = schadenPhysisch(ctx, PARTY, GEGNER, 0x80);
    expect(d).toBe(118);
    // Der erzwungene Kritische feuert NICHT: Bit 13 ist gesetzt.
    expect(ctx.damageKind & 0x2).toBe(0);
  });

  it('rechnet die Streuung nachvollziehbar: f = 3969, 122·3969 >> 12', () => {
    expect(0x80 + 0x0f01).toBe(3969);
    expect((122 * 3969) >> 12).toBe(118);
    expect(122 * 3969).toBe(484218);
  });
});

describe('Testvektor 11.2 — derselbe Angriff, kritisch', () => {
  it('verdoppelt vor den Nachbearbeitern und ergibt 236', () => {
    const ctx = leererKontext({
      damageCalc: 0x11,
      specialFlags: 0xffff,
      targetFlags: 0x23,
      attackerLevel: 20,
      attackStat: 58,
      defence: 30,
      power: 16,
      damageKind: 0x2, // der Wurf war erfolgreich
    });
    dekodiereSchadensbyte(ctx);
    expect(schadenPhysisch(ctx, PARTY, GEGNER, 0x80)).toBe(236);
    expect((244 * 3969) >> 12).toBe(236);
  });

  it('reproduziert den Wurf, der ihn ausgelöst hat: rate 7, Wurf 5', () => {
    const ctx = leererKontext({ attackerLevel: 20 });
    // trunc32(20 + 20 − 12, 4) = trunc32(28, 4) = 7, criticalBonus 0.
    expect(wuerfleKritisch(ctx, PARTY, GEGNER, 0, true, 5)).toBe(true);
    expect(ctx.damageKind & 0x2).toBe(0x2);
    // 8 > 7 — knapp daneben.
    const ctx2 = leererKontext({ attackerLevel: 20 });
    expect(wuerfleKritisch(ctx2, PARTY, GEGNER, 0, true, 8)).toBe(false);
  });

  it('garantiert den Kritischen beim Masamune-Bonus 0xFF', () => {
    const ctx = leererKontext({ attackerLevel: 1 });
    const schwach: KampfteilnehmerLage = { flags2: 0, backAttackMul8: 16, level: 99, luck: 0 };
    expect(wuerfleKritisch(ctx, schwach, schwach, 0xff, true, 100)).toBe(true);
  });

  it('würfelt gar nicht, wenn der Angriff schon danebenging', () => {
    const ctx = leererKontext({ attackerLevel: 99, resultFlags: 1 });
    expect(wuerfleKritisch(ctx, PARTY, GEGNER, 0xff, true, 1)).toBe(false);
  });
});

describe('Testvektor 11.3 — Feuer 3, magischer Zweig vor dem Elementarschritt', () => {
  it('trifft Grundschaden und Produkt', () => {
    const ctx = leererKontext({
      damageCalc: 0x22,
      specialFlags: 0xfdfd,
      targetFlags: 0x0f,
      attackerLevel: 30,
      attackStat: 60,
      defence: 40,
      power: 64,
      targetCount: 3,
    });
    expect(dekodiereSchadensbyte(ctx).magisch).toBe(true);
    // Vektor: base 540, Verteidigungsterm 472, Produkt 16312320.
    expect((60 + 30) * 6).toBe(540);
    expect(512 - 40).toBe(472);
    expect(540 * 472 * 64).toBe(16312320);
    // (targetFlags 0x0F & 0x0C) === 0x0C, nicht 0x04 → keine Unterdrückung,
    // die Aufteilung auf drei Ziele greift also.
    expect((0x0f & 0x0c) === 0x04).toBe(false);
    const d = schadenMagisch(ctx, 0x00);
    // 16312320/8192 = 1991; ×2/3 = 1327; Streuung r=0 → ×3841 >> 12.
    expect(trunc32(16312320, 8192)).toBe(1991);
    expect(((1991 << 1) / 3) | 0).toBe(1327);
    expect(d).toBe((1327 * 3841) >> 12);
  });
});

describe('Die Nachbearbeiter einzeln', () => {
  const grund = () =>
    leererKontext({
      damageCalc: 0x11,
      specialFlags: 0xffff,
      targetFlags: 0x23,
      attackerLevel: 20,
      attackStat: 58,
      defence: 30,
      power: 16,
    });

  it('Trauer nimmt dem Ziel 30 %', () => {
    const ctx = grund();
    ctx.targetStatus = 1 << STATUS_SADNESS;
    dekodiereSchadensbyte(ctx);
    // 122 − trunc(122·3/10) = 122 − 36 = 86; dann Streuung.
    expect(schadenPhysisch(ctx, PARTY, GEGNER, 0xff)).toBe((86 * 4096) >> 12);
  });

  it('Berserk rundet ab statt zu kürzen', () => {
    const ctx = grund();
    ctx.attackerStatus = 1 << STATUS_BERSERK;
    dekodiereSchadensbyte(ctx);
    expect(schadenPhysisch(ctx, PARTY, GEGNER, 0xff)).toBe((sar(122 * 3, 1) * 4096) >> 12);
  });

  it('Frosch viertelt, Mini nullt — und die Streuung hebt Mini auf 1', () => {
    const frosch = grund();
    frosch.attackerStatus = 1 << STATUS_FROG;
    dekodiereSchadensbyte(frosch);
    expect(schadenPhysisch(frosch, PARTY, GEGNER, 0xff)).toBe(30); // 122>>2

    const mini = grund();
    mini.attackerStatus = 1 << STATUS_SMALL;
    dekodiereSchadensbyte(mini);
    expect(schadenPhysisch(mini, PARTY, GEGNER, 0xff)).toBe(1);
  });

  it('halbiert für die hintere Reihe — aber nur bei Nahkampf', () => {
    const nah = grund();
    dekodiereSchadensbyte(nah);
    const hinten: KampfteilnehmerLage = { ...GEGNER, flags2: 0x40 };
    expect(schadenPhysisch(nah, PARTY, hinten, 0xff)).toBe(61); // trunc32(122,2)

    // targetFlags ohne 0x20 und kein Nahkampfkommando: Reihen zählen nicht.
    const fern = grund();
    fern.targetFlags = 0x03;
    dekodiereSchadensbyte(fern);
    expect(schadenPhysisch(fern, PARTY, hinten, 0xff)).toBe(122);
  });

  it('nimmt beim Rückenangriff den Faktor des ZIELS, in Achteln', () => {
    const ctx = grund();
    ctx.modifierFlags = 1;
    dekodiereSchadensbyte(ctx);
    // backAttackMul8 = 16 → ×2.
    expect(schadenPhysisch(ctx, PARTY, GEGNER, 0xff)).toBe(244);
  });

  it('Streuung kann nur mindern, nie mehren', () => {
    for (const r of [0, 1, 0x40, 0x80, 0xfe, 0xff]) {
      const ctx = grund();
      dekodiereSchadensbyte(ctx);
      const d = schadenPhysisch(ctx, PARTY, GEGNER, r);
      expect(d).toBeLessThanOrEqual(122);
      expect(d).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Nachklemmung', () => {
  it('klemmt auf 9999 HP bzw. 999 MP, in dieser Reihenfolge', () => {
    const ctx = leererKontext({ damage: 50000 });
    expect(klemmeSchaden(ctx, { hpCap: 9999, mpCap: 999, nimmtKeinenSchaden: false, luckySevens: false })).toBe(9999);
    const mp = leererKontext({ damage: 50000, damageKind: 0x4 });
    expect(klemmeSchaden(mp, { hpCap: 9999, mpCap: 999, nimmtKeinenSchaden: false, luckySevens: false })).toBe(999);
  });

  it('setzt Lucky 7s NACH der Immunität — ein immunes Ziel bleibt bei 0', () => {
    const immun = leererKontext({ damage: 500 });
    expect(klemmeSchaden(immun, { hpCap: 9999, mpCap: 999, nimmtKeinenSchaden: true, luckySevens: true })).toBe(0);
    const sieben = leererKontext({ damage: 500 });
    expect(klemmeSchaden(sieben, { hpCap: 9999, mpCap: 999, nimmtKeinenSchaden: false, luckySevens: true })).toBe(0x1e61);
  });

  it('erkennt Petrify und Peerless als schadensfrei', () => {
    expect(nimmtKeinenSchaden(1 << 14, false)).toBe(true);
    expect(nimmtKeinenSchaden(1 << 24, false)).toBe(true);
    expect(nimmtKeinenSchaden(0, true)).toBe(true);
    expect(nimmtKeinenSchaden(1 << 23, false)).toBe(false);
  });
});
