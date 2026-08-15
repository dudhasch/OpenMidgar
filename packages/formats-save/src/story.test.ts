import { describe, expect, it } from 'vitest';
import {
  GAME_MOMENT_OFFSET,
  leseGameMoment,
  leseSkriptregionen,
  MENU_BIT_BEENDEN,
  PHS_LOCK_OFFSET,
  readStoryZustand,
  schreibeGameMoment,
  schreibeSkriptregionen,
  SCRIPT_BANK_BASE,
  SCRIPT_BANK_REGION_COUNT,
  SCRIPT_BANK_REGION_LEN,
  SCRIPT_BANK_REGION_STORY,
  skriptregionVersatz,
  wirksameMenuemasken,
  type StoryZustand,
} from './story.js';
import { DISC_OFFSET, SAVEMAP_SLOT_LEN } from './savemap.js';

/** Selbst erzeugter Slot — keine Originaldaten. */
const slot = (): Uint8Array => new Uint8Array(SAVEMAP_SLOT_LEN);

const zustand = (teil: Partial<StoryZustand> = {}): StoryZustand => ({
  gameMoment: 0,
  menuVisibleRaw: 0,
  menuLockedRaw: 0,
  loadoutLocked: false,
  phsLocked: 0,
  phsAvailable: 0,
  ...teil,
});

describe('Das Raster der Skriptbänke', () => {
  it('lässt drei unabhängig hergeleitete Versätze zusammenfallen', () => {
    /**
     * 🟢 Das ist der eigentliche Beleg für das Raster: Der Fortschrittswert
     * (aus dem EXE-Bestand), die PHS-Maske (ebenfalls von dort) und unsere
     * **eigene**, längst gemessene Disc-Nummer liegen auf demselben
     * 256-Byte-Gitter — und die Regionszahl 5 stammt aus der
     * Bank-Aliasing-Tabelle des Interpreters, die von keinem dieser Versätze
     * weiß.
     */
    expect(PHS_LOCK_OFFSET - SCRIPT_BANK_BASE).toBe(SCRIPT_BANK_REGION_COUNT * SCRIPT_BANK_REGION_LEN);
    expect(PHS_LOCK_OFFSET).toBe(skriptregionVersatz(SCRIPT_BANK_REGION_COUNT));
    expect((DISC_OFFSET - SCRIPT_BANK_BASE) % SCRIPT_BANK_REGION_LEN).toBe(0);
    expect(DISC_OFFSET).toBe(skriptregionVersatz(3));
    expect(GAME_MOMENT_OFFSET).toBe(skriptregionVersatz(SCRIPT_BANK_REGION_STORY));
  });

  it('liest und schreibt die fünf Regionen verlustfrei', () => {
    const s = slot();
    for (let i = 0; i < SCRIPT_BANK_REGION_COUNT * SCRIPT_BANK_REGION_LEN; i++) {
      s[SCRIPT_BANK_BASE + i] = (i * 7 + 3) & 0xff;
    }
    const r = leseSkriptregionen(s);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(SCRIPT_BANK_REGION_COUNT);

    const leer = slot();
    expect(schreibeSkriptregionen(leer, r!)).toBe(true);
    expect([...leer.subarray(SCRIPT_BANK_BASE, PHS_LOCK_OFFSET)]).toEqual([
      ...s.subarray(SCRIPT_BANK_BASE, PHS_LOCK_OFFSET),
    ]);
    // Nichts außerhalb der Regionen wurde angefasst.
    expect(leer.subarray(0, SCRIPT_BANK_BASE).every((b) => b === 0)).toBe(true);
    expect(leer.subarray(PHS_LOCK_OFFSET).every((b) => b === 0)).toBe(true);
  });

  it('weist falsch bemessene Regionen ab, statt sie zurechtzuschneiden', () => {
    const s = slot();
    expect(schreibeSkriptregionen(s, [new Uint8Array(SCRIPT_BANK_REGION_LEN)])).toBe(false);
    expect(schreibeSkriptregionen(s, Array.from({ length: 5 }, () => new Uint8Array(255)))).toBe(false);
  });
});

describe('Der Fortschrittswert als Sicht', () => {
  it('trifft dieselben Bytes wie der direkte Slotzugriff', () => {
    const s = slot();
    new DataView(s.buffer).setUint16(GAME_MOMENT_OFFSET, 583, true);
    const r = leseSkriptregionen(s)!;
    expect(leseGameMoment(r[SCRIPT_BANK_REGION_STORY]!)).toBe(583);
    expect(readStoryZustand(s)!.gameMoment).toBe(583);
  });

  it('verträgt den Schreibzugriff auf das hohe Byte allein', () => {
    /**
     * ⚠️ Der Fall, an dem jede synchronisierte Kopie auseinanderliefe:
     * Feldskripte schreiben den Fortschritt **als hohes Byte allein**. Über
     * die Sicht ist das eine Änderung um 256 — über ein Zweitfeld wäre es gar
     * keine, bis jemand nachzieht.
     */
    const s = slot();
    const region = leseSkriptregionen(s)![SCRIPT_BANK_REGION_STORY]!;
    schreibeGameMoment(region, 300);
    expect(leseGameMoment(region)).toBe(300);
    region[1] = region[1]! + 1;
    expect(leseGameMoment(region)).toBe(300 + 256);
    region[0] = 5;
    expect(leseGameMoment(region)).toBe(256 + 256 + 5);
  });

  it('bleibt beim Hin- und Rückweg über den Slot erhalten', () => {
    const s = slot();
    const r = leseSkriptregionen(s)!;
    schreibeGameMoment(r[SCRIPT_BANK_REGION_STORY]!, 1620);
    expect(schreibeSkriptregionen(s, r)).toBe(true);
    expect(readStoryZustand(s)!.gameMoment).toBe(1620);
  });
});

describe('Menümasken', () => {
  it('erzwingt Beenden sichtbar und entsperrt, ohne die übrigen Bits zu rühren', () => {
    const { visible, locked } = wirksameMenuemasken(
      zustand({ menuVisibleRaw: 0x02fb, menuLockedRaw: 0x0500 }),
    );
    expect(visible & (1 << MENU_BIT_BEENDEN)).toBeTruthy();
    expect(locked & (1 << MENU_BIT_BEENDEN)).toBe(0);
    // Die übrigen Bits bleiben, wie sie waren.
    expect(visible & 0x02fb).toBe(0x02fb);
    expect(locked & 0x0100).toBe(0x0100);
  });

  it('lässt die Ausrüstungssperre auf Item und Limit durchschlagen', () => {
    const { locked } = wirksameMenuemasken(zustand({ menuVisibleRaw: 0xffff, loadoutLocked: true }));
    expect(locked & 1).toBe(1);
    expect(locked & (1 << 6)).toBe(1 << 6);
    expect(locked & (1 << 3)).toBe(0);
  });
});
