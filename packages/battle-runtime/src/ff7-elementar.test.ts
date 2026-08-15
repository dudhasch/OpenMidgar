import { describe, expect, it } from 'vitest';
import {
  AFF_ABSORB,
  AFF_HALB,
  AFF_NICHTIG,
  AFF_SCHWACH,
  AFF_SOFORTTOD,
  AFF_TRIFFT_SICHER,
  AFF_VOLLHEILUNG,
  baueAffinitaetstabelle,
  elementarNachSchaden,
  elementarVorSchaden,
  falteAffinitaet,
  leererKratz,
  loescheTrefferKratz,
} from './ff7-elementar.js';
import { leererKontext } from './ff7-schaden.js';
import { setzeZufall } from './ff7-zufall.js';

const identitaet = (): Uint8Array => Uint8Array.from({ length: 256 }, (_, i) => i);
const ziel = () => ({ curHp: 100, maxHp: 500, curMp: 5, maxMp: 50 });

describe('Affinitätstabelle', () => {
  it('teilt das Gegnerbyte in Hälfte und Bit auf', () => {
    // id 0 → Elementhälfte, Bit 0. id 0x23 = 35 → Statushälfte (35>>5 = 1), Bit 3.
    const t = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0xffff,
      gegner: [
        { id: 0x00, code: 2 }, // schwach gegen Element 0
        { id: 0x23, code: 6 }, // absorbiert Statusbit 3
      ],
    });
    expect(t[2]).toBe(0x0001);
    expect(t[6 + 8]).toBe(0x0008);
    // Und NICHT in der Elementhälfte gelandet:
    expect(t[6]).toBe(0);
  });

  it('überspringt 0xFF und nimmt die Party-Masken, wenn keine Paare da sind', () => {
    const t = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0,
      gegner: [{ id: 0xff, code: 2 }],
    });
    expect(t.every((v) => v === 0)).toBe(true);

    const p = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0,
      partyHalve: 0x0003,
      partyInvalid: 0x0004,
      partyAbsorb: 0x0008,
    });
    expect(p[4]).toBe(0x0003);
    expect(p[5]).toBe(0x0004);
    expect(p[6]).toBe(0x0008);
  });

  it('setzt Schild als Absorption 0…8 und Nichtigkeit 9…14', () => {
    const t = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0,
      gegner: [],
      hatSchild: true,
    });
    expect(t[6]).toBe(0x01ff);
    expect(t[5]).toBe(0x7e00);
    // Mit honourResistBits === false bleibt der Schild wirkungslos.
    const ohne = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0,
      hatSchild: true,
      honourResistBits: false,
    });
    expect(ohne[6]).toBe(0);
  });

  it('lässt Giftnichtigkeit und Giftimmunität einander nachziehen', () => {
    /**
     * ⚠️ Die Statusänderung muss hier **genau** das Giftbit sein. Bei einer
     * breiteren Maske greift die Regel aus dem nächsten Testfall — die
     * Immunität deckt sie dann nicht ganz ab und fällt ersatzlos weg. Der
     * erste Anlauf dieses Tests ist genau daran gescheitert.
     */
    const ausElement = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0x08,
      nullifyElementMask: 0x10,
    });
    expect(ausElement[5]! & 0x10).toBe(0x10);
    expect(ausElement[13]! & 0x08).toBe(0x08);

    const ausStatus = baueAffinitaetstabelle({
      attackElementMask: 0xffff,
      statusChangeMask: 0x08,
      statusImmunity: 0x08,
    });
    expect(ausStatus[5]! & 0x10).toBe(0x10);
    expect(ausStatus[13]! & 0x08).toBe(0x08);
  });

  it('verwirft Statusimmunität, die die Änderung nicht ganz abdeckt', () => {
    const teilweise = baueAffinitaetstabelle({
      attackElementMask: 0,
      statusChangeMask: 0x0003,
      statusImmunity: 0x0001, // deckt nur die Hälfte ab
    });
    expect(teilweise[13]).toBe(0);

    const ganz = baueAffinitaetstabelle({
      attackElementMask: 0,
      statusChangeMask: 0x0001,
      statusImmunity: 0x0001,
    });
    expect(ganz[13]).toBe(0x0001);
  });
});

describe('Falten zu elemReaction', () => {
  it('setzt Bit i&7 je belegtem Platz', () => {
    const t = new Array<number>(16).fill(0);
    t[2] = 1; // Schwäche
    t[10] = 1; // Statushälfte desselben Codes → dasselbe Bit
    expect(falteAffinitaet(t, 0, 0x0080)).toBe(AFF_SCHWACH);
  });

  it('leert die Statusimmunität, sobald der Angriff Stärke hat', () => {
    const t = new Array<number>(16).fill(0);
    t[13] = 0xff;
    expect(falteAffinitaet(t, 0, 0x0080)).toBe(AFF_NICHTIG); // 13 & 7 = 5
    expect(falteAffinitaet(t, 16, 0x0080)).toBe(0);
  });

  it('verwirft alles ohne Sonderflag 0x0080', () => {
    const t = new Array<number>(16).fill(0);
    t[2] = 1;
    expect(falteAffinitaet(t, 0, 0x0000)).toBe(0);
  });
});

describe('Vor dem Schaden', () => {
  it('tauscht bei Absorption Zufügen und Heilen', () => {
    const ctx = { ...leererKontext({ power: 16 }), hitRate: 100 };
    const k = { ...leererKratz(), elemReaction: AFF_ABSORB, workInflict: 0x10, workCure: 0x20 };
    elementarVorSchaden(ctx, k, setzeZufall(identitaet(), 0));
    expect(k.workInflict).toBe(0x20);
    expect(k.workCure).toBe(0x10);
  });

  it('macht aus getauschtem Todesbit die passende Sonderreaktion', () => {
    const ctx = { ...leererKontext({ power: 16 }), hitRate: 100 };
    // Heilung trug das Todesbit → nach dem Tausch steckt es in workInflict.
    const k = { ...leererKratz(), elemReaction: AFF_ABSORB, workInflict: 0, workCure: 1 };
    elementarVorSchaden(ctx, k, setzeZufall(identitaet(), 0));
    expect(k.elemReaction).toBe(AFF_SOFORTTOD);
    expect(k.workInflict & 1).toBe(0);
  });

  it('lässt Soforttod auf einer Prozentformel gegen einen d32-Wurf antreten', () => {
    const bau = (power: number, seed: number) => {
      const ctx = { ...leererKontext({ power }), hitRate: 100, formulaIndex: 3 };
      const k = { ...leererKratz(), elemReaction: AFF_SOFORTTOD };
      elementarVorSchaden(ctx, k, setzeZufall(identitaet(), seed));
      return k.elemReaction;
    };
    // Lesekopf 0 → Tabellenwert 0 → zufallUnter(32) = 0. power 0 <= 0 → herabgestuft.
    expect(bau(0, 0)).toBe(AFF_NICHTIG);
    // power 1 > 0 → bleibt Soforttod.
    expect(bau(1, 0)).toBe(AFF_SOFORTTOD);
  });

  it('würfelt NICHT, wenn die Formel keine Prozentformel ist', () => {
    const z = setzeZufall(identitaet(), 0);
    const ctx = { ...leererKontext({ power: 0 }), hitRate: 100, formulaIndex: 1 };
    elementarVorSchaden(ctx, { ...leererKratz(), elemReaction: AFF_SOFORTTOD }, z);
    expect(z.cursor[0]).toBe(0); // kein Byte verbraucht
  });

  it('skaliert bei Stärke 0 die Trefferquote statt des Schadens', () => {
    const schwach = { ...leererKontext({ power: 0 }), hitRate: 50 };
    elementarVorSchaden(schwach, { ...leererKratz(), elemReaction: AFF_SCHWACH }, setzeZufall(identitaet(), 0));
    expect(schwach.hitRate).toBe(100);

    const halb = { ...leererKontext({ power: 0 }), hitRate: 50 };
    elementarVorSchaden(halb, { ...leererKratz(), elemReaction: AFF_HALB }, setzeZufall(identitaet(), 0));
    expect(halb.hitRate).toBe(25);

    // Mit Stärke bleibt die Quote unberührt.
    const mit = { ...leererKontext({ power: 16 }), hitRate: 50 };
    elementarVorSchaden(mit, { ...leererKratz(), elemReaction: AFF_SCHWACH }, setzeZufall(identitaet(), 0));
    expect(mit.hitRate).toBe(50);
  });
});

describe('Nach dem Schaden', () => {
  it('verdoppelt glatt, halbiert aber AUFRUNDEND', () => {
    const schwach = { ...leererKontext(), displayedDamage: 0 };
    const k1 = { ...leererKratz(), elemReaction: AFF_SCHWACH, damage: 5 };
    elementarNachSchaden(schwach, k1, ziel());
    expect(k1.damage).toBe(10);

    const halb = { ...leererKontext(), displayedDamage: 0 };
    const k2 = { ...leererKratz(), elemReaction: AFF_HALB, damage: 5 };
    elementarNachSchaden(halb, k2, ziel());
    /**
     * ⚠️ **3, nicht 2.** Jede andere Halbierung im System kürzt zur Null hin;
     * diese eine rundet auf. Genau darauf weist der Bestand eigens hin.
     */
    expect(k2.damage).toBe(3);
  });

  it('dreht bei Absorption Schaden in Heilung, ohne zu skalieren', () => {
    const ctx = { ...leererKontext({ damageKind: 0 }), displayedDamage: 0 };
    const k = { ...leererKratz(), elemReaction: AFF_ABSORB | AFF_SCHWACH, damage: 5 };
    elementarNachSchaden(ctx, k, ziel());
    expect(ctx.damageKind & 0x1).toBe(0x1);
    expect(k.damage).toBe(5); // Schwäche greift bei Absorption NICHT
  });

  it('setzt bei Soforttod das Todesbit — oder meldet Fehlschlag bei bereits totem Ziel', () => {
    const lebend = { ...leererKontext({ targetStatus: 0, resultFlags: 0x2 }), displayedDamage: 0 };
    const k1 = { ...leererKratz(), elemReaction: AFF_SOFORTTOD, damage: 7 };
    elementarNachSchaden(lebend, k1, ziel());
    expect(k1.workInflict & 1).toBe(1);
    expect(lebend.displayedDamage).toBe(-2);
    expect(lebend.resultFlags & 0x2).toBe(0);

    const tot = { ...leererKontext({ targetStatus: 1 }), displayedDamage: 0 };
    const k2 = { ...leererKratz(), elemReaction: AFF_SOFORTTOD, damage: 7 };
    elementarNachSchaden(tot, k2, ziel());
    expect(tot.resultFlags & 0x3).toBe(0x3);
    expect(k2.damage).toBe(0);
    expect(k2.elemReaction).toBe(0);
  });

  it('füllt bei voller Wiederherstellung beide Leisten', () => {
    const ctx = { ...leererKontext(), displayedDamage: 0 };
    const z = ziel();
    const k = { ...leererKratz(), elemReaction: AFF_VOLLHEILUNG, workInflict: 1 };
    elementarNachSchaden(ctx, k, z);
    expect(z.curHp).toBe(z.maxHp);
    expect(z.curMp).toBe(z.maxMp);
    expect(ctx.damageKind).toBe(0x1);
    expect(ctx.displayedDamage).toBe(-3);
    expect(k.workInflict & 1).toBe(0);
  });

  it('meldet Nichtigkeit nur als Fehlschlag, wenn Status oder Element 3 im Spiel sind', () => {
    const ohne = { ...leererKontext(), displayedDamage: 0, elementMask: 0 };
    elementarNachSchaden(ohne, { ...leererKratz(), elemReaction: AFF_NICHTIG, damage: 9 }, ziel());
    expect(ohne.resultFlags & 1).toBe(0);

    const mitStatus = { ...leererKontext(), displayedDamage: 0, elementMask: 0 };
    const k = { ...leererKratz(), elemReaction: AFF_NICHTIG, workStatusUnion: 0x4, damage: 9 };
    elementarNachSchaden(mitStatus, k, ziel());
    expect(mitStatus.resultFlags & 1).toBe(1);
    expect(k.damage).toBe(0);
  });
});

describe('Kratzfelder', () => {
  it('löscht genau sechs Felder und lässt die übrigen stehen', () => {
    const k = {
      workInflict: 1,
      workCure: 2,
      workToggle: 3,
      workStatusUnion: 4,
      elemReaction: 5,
      damage: 6,
    };
    loescheTrefferKratz(k);
    expect(Object.values(k).every((v) => v === 0)).toBe(true);
  });

  it('führt die Treffermaske als 0x63 — Codes 0, 1, 5 und 6', () => {
    expect(AFF_TRIFFT_SICHER).toBe(AFF_SOFORTTOD | 0x02 | AFF_NICHTIG | AFF_ABSORB);
  });
});
