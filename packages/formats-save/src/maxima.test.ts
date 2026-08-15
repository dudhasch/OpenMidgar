import { describe, expect, it } from 'vitest';
import {
  CHAR,
  CHARACTER_RECORD_BASE,
  CHARACTER_RECORD_LEN,
  MAXIMUM_UNBERECHNET,
  SAVEMAP_SLOT_LEN,
  readSavemap,
  wirksamesMaximum,
} from './savemap.js';
import { setCharacterPoints } from './write.js';

/**
 * F12-Nachtrag — der Sentinel `0xFFFF` bei @56/@58.
 *
 * **Der Befund, der diese Datei nötig gemacht hat** (2026-08-15, gemessen an
 * den echten Spielständen der Installation): **24 von 63** benannten
 * Charakterrecords tragen bei @56 **und** @58 den Wert `0xFFFF`. Das ist kein
 * Maximum von 65535, sondern „noch nicht berechnet" — das Original füllt die
 * Felder erst bei Kampfeintritt, in den meisten Menübildern und bei jeder
 * Gruppenänderung. Wer nie in der Gruppe war, behält den Sentinel.
 *
 * Ohne Auflösung ginge eine solche Figur mit `maxHp = 65535` in den Kampf, und
 * — schlimmer, weil unbemerkt — die Klemmung im **Schreibpfad** klemmte gegen
 * 65535, also gar nicht.
 */

/** Ein Slot mit zwei Figuren: eine mit berechneten Maxima, eine mit Sentinel. */
function slotMitSentinel(): Uint8Array {
  const slot = new Uint8Array(SAVEMAP_SLOT_LEN);
  const view = new DataView(slot.buffer);
  const figur = (
    index: number,
    id: number,
    werte: { hp: number; hpBasis: number; hpMax: number; mp: number; mpBasis: number; mpMax: number },
  ): void => {
    const at = CHARACTER_RECORD_BASE + index * CHARACTER_RECORD_LEN;
    slot[at + CHAR.id] = id;
    slot[at + CHAR.level] = 7;
    // Name: ein Zeichen, damit `used` greift (FF-Text, 0xFF terminiert).
    slot[at + CHAR.name] = 0x21;
    slot[at + CHAR.name + 1] = 0xff;
    view.setUint16(at + CHAR.hp, werte.hp, true);
    view.setUint16(at + CHAR.hpBasis, werte.hpBasis, true);
    view.setUint16(at + CHAR.hpMax, werte.hpMax, true);
    view.setUint16(at + CHAR.mp, werte.mp, true);
    view.setUint16(at + CHAR.mpBasis, werte.mpBasis, true);
    view.setUint16(at + CHAR.mpMax, werte.mpMax, true);
  };
  // 0: berechnet — Materia handelt HP nach unten und MP nach oben (der
  //    gemessene Normalfall: 18 von 63 Records haben Maximum < Basis).
  figur(0, 0, { hp: 250, hpBasis: 314, hpMax: 302, mp: 40, mpBasis: 54, mpMax: 56 });
  // 1: Sentinel an beiden Feldern — nie in der Gruppe gewesen.
  figur(1, 5, {
    hp: 90,
    hpBasis: 177,
    hpMax: MAXIMUM_UNBERECHNET,
    mp: 12,
    mpBasis: 23,
    mpMax: MAXIMUM_UNBERECHNET,
  });
  return slot;
}

describe('wirksamesMaximum', () => {
  it('nimmt den berechneten Wert, auch wenn er unter dem Basiswert liegt', () => {
    // Nach unten gehandelte Maxima sind KEIN Fehlerfall — Magie-Materia tut
    // genau das. Eine Wache „Maximum ≥ Basis" wäre also falsch.
    expect(wirksamesMaximum(302, 314)).toBe(302);
    expect(wirksamesMaximum(56, 54)).toBe(56);
  });

  it('fällt nur beim Sentinel auf den Basiswert zurück', () => {
    expect(wirksamesMaximum(MAXIMUM_UNBERECHNET, 177)).toBe(177);
    // Kontrolle: 0xFFFE ist ein gewöhnlicher Wert, kein Sentinel.
    expect(wirksamesMaximum(0xfffe, 177)).toBe(0xfffe);
    expect(wirksamesMaximum(0, 177)).toBe(0);
  });
});

describe('readSavemap mit Sentinel', () => {
  it('liefert die berechneten Maxima unverändert', () => {
    const c = readSavemap(slotMitSentinel())!.characters[0]!;
    expect(c.hpMax).toBe(302);
    expect(c.mpMax).toBe(56);
    expect(c.hpBasis).toBe(314);
    expect(c.mpBasis).toBe(54);
    expect(c.maximaBerechnet).toBe(true);
  });

  it('setzt beim Sentinel den Basiswert und meldet es', () => {
    const c = readSavemap(slotMitSentinel())!.characters[1]!;
    expect(c.hpMax).toBe(177);
    expect(c.mpMax).toBe(23);
    expect(c.maximaBerechnet).toBe(false);
    // Der Rohwert bleibt über den Basiswert nachvollziehbar — die Auflösung
    // verschluckt keine Information.
    expect(c.hpBasis).toBe(177);
    expect(c.mpBasis).toBe(23);
  });

  it('lässt die Figur belegt sein — sie existiert, ihr fehlt nur die Rechnung', () => {
    const c = readSavemap(slotMitSentinel())!.characters[1]!;
    expect(c.used).toBe(true);
  });
});

describe('setCharacterPoints klemmt gegen das wirksame Maximum', () => {
  it('klemmt bei berechneten Maxima wie bisher', () => {
    const r = setCharacterPoints(slotMitSentinel(), 0, 'hp', 9999);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readSavemap(r.slot)!.characters[0]!.hp).toBe(302);
  });

  it('klemmt beim Sentinel gegen den Basiswert statt gegen 65535', () => {
    // Das ist der eigentliche Fehler, den die Wache verhindert: vorher wurde
    // hier 9999 geschrieben, weil 9999 < 65535 gilt.
    const r = setCharacterPoints(slotMitSentinel(), 1, 'hp', 9999);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = readSavemap(r.slot)!.characters[1]!;
    expect(c.hp).toBe(177);
    expect(c.hp).toBeLessThanOrEqual(c.hpMax);
  });

  it('klemmt MP beim Sentinel ebenso', () => {
    const r = setCharacterPoints(slotMitSentinel(), 1, 'mp', 500);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readSavemap(r.slot)!.characters[1]!.mp).toBe(23);
  });
});
