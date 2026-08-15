import { MENU_LOCKED_OFFSET, MENU_VISIBLE_OFFSET } from './savemap.js';

/**
 * Story-Fortschritt und die Masken, die er schaltet (F43).
 *
 * ## Warum der Fortschritt KEIN eigenes Feld ist
 *
 * 🔵 `gameMoment` liegt bei Slotversatz `0x0BA4` — und das ist zugleich das
 * **erste Wort der persistenten Skriptbank 1**. Feldskripte schreiben ihn
 * selbst; es gibt keine Engine-Funktion, die ihn setzt. Deshalb wird er hier
 * als **Sicht** auf die Bankregion geführt und nicht als kopiertes Feld:
 *
 * Die Skripte schreiben ihn als Wort, als Byte **und als hohes Byte allein**.
 * Jede synchronisierte Kopie liefe früher oder später auseinander — die
 * bytegenauen Schreibzugriffe sind nicht optional.
 *
 * ## Was er schaltet
 *
 * Drei Engine-Stellen lesen ihn (Weltkarten-Ressourcen, Musikschlitz der
 * Highwind, ein Chocobo-Rennfeld). Die Schwellen sind Erzählpunkte:
 * **1000** Junon-Hinrichtung · **1199** „Cloud kehrt zurück" · **1580**
 * Nordkrater-Barriere · **1620** Ende von Disc 2.
 *
 * 🟡 Die vier Schwellen sind an unseren Spielständen **nicht** prüfbar: Der
 * höchste dort vorkommende Wert ist 583. Sie stehen als Konstanten da, damit
 * sie an genau einer Stelle korrigierbar bleiben.
 */

/** Slotversatz des Fortschrittswerts = erstes Wort der persistenten Bank 1. */
export const GAME_MOMENT_OFFSET = 0x0ba4;

/** 🟡 Erzählschwellen aus der eigenen Codeanalyse (ADR-028), ungeprüft. */
export const MOMENT_JUNON_HINRICHTUNG = 1000;
export const MOMENT_CLOUD_KEHRT_ZURUECK = 1199;
export const MOMENT_NORDKRATER = 1580;
export const MOMENT_DISC2_ENDE = 1620;

export const MENU_BIT_PHS = 8;
export const MENU_BIT_SPEICHERN = 9;
/**
 * Beenden. Die Engine erzwingt diese Zeile — sichtbar UND entsperrt.
 *
 * ⚠️ **`MENU_ITEM_ORDER` in `savemap.ts` führt nur zehn Zeilen und endet bei
 * „save".** Der EXE-Bestand nennt eine elfte, `Beenden` auf Bit 10. Die Liste
 * wird hier **absichtlich nicht erweitert**: Welche Zeilen unser Hauptmenü
 * zeigt, ist ein eigener offener Posten ohne Referenzaufnahme, und eine Zeile
 * hinzuzufügen wäre eine Sichtänderung ohne Beleg. Festgehalten ist die
 * Abweichung, entschieden ist sie nicht.
 */
export const MENU_BIT_BEENDEN = 10;
export const MENU_MASKE_BEENDEN = 1 << MENU_BIT_BEENDEN;

/** Bit 0: Ausrüstungssperre. Sperrt zusätzlich die Zeilen 0 und 6. */
export const LOADOUT_LOCK_OFFSET = 0x0e13;
export const PHS_LOCK_OFFSET = 0x10a4;
export const PHS_AVAILABLE_OFFSET = 0x10a6;

export interface StoryZustand {
  /** `u16` bei `0x0BA4`. Bereich 0…~2000. */
  gameMoment: number;
  /** Rohe Sichtbarkeitsmaske aus dem Spielstand. */
  menuVisibleRaw: number;
  /** Rohe Sperrmaske aus dem Spielstand. */
  menuLockedRaw: number;
  /** `0x0E13` Bit 0 — Ausrüstung festgezurrt. */
  loadoutLocked: boolean;
  /** Bit je Figurenkennung: festgesetzt, kann nicht aus der Gruppe. */
  phsLocked: number;
  /** Bit je Figurenkennung: überhaupt im PHS-Raster vorhanden. */
  phsAvailable: number;
}

export function readStoryZustand(slot: Uint8Array): StoryZustand | null {
  if (slot.length < PHS_AVAILABLE_OFFSET + 2) return null;
  const v = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  return {
    gameMoment: v.getUint16(GAME_MOMENT_OFFSET, true),
    menuVisibleRaw: v.getUint16(MENU_VISIBLE_OFFSET, true),
    menuLockedRaw: v.getUint16(MENU_LOCKED_OFFSET, true),
    loadoutLocked: (slot[LOADOUT_LOCK_OFFSET]! & 1) !== 0,
    phsLocked: v.getUint16(PHS_LOCK_OFFSET, true),
    phsAvailable: v.getUint16(PHS_AVAILABLE_OFFSET, true),
  };
}

/**
 * Die wirksamen Menümasken.
 *
 * ⚠️ **Aus dem Spielstand JEDES BILD neu aufbauen, nicht fortschreiben.**
 * Die Engine legt zwei Zwänge darüber, und beide gehören zur Ableitung, nicht
 * in die gespeicherten Bytes: **Beenden ist immer sichtbar und nie gesperrt.**
 *
 * 🟢 **Und das ist keine Formalie.** Gemessen an sieben Spielständen ist Bit 10
 * in **drei** gesetzt und in **vier nicht** — die frühen Stände (Maske
 * `0x2FB`) tragen es nicht. Ohne das Erzwingen hätte das Menü dort **keinen
 * Ausgang**. Genau für diese Stände existiert der Zwang.
 *
 * ⚠️ **Die beiden Masken NICHT zusammenführen.** Eine gesperrte Zeile bleibt
 * sichtbar und brummt; verschmilzt man sie mit der Sichtbarkeit, verschwindet
 * sie stattdessen — ein anderer, falscher Eindruck.
 */
export function wirksameMenuemasken(z: StoryZustand): { visible: number; locked: number } {
  let visible = (z.menuVisibleRaw | MENU_MASKE_BEENDEN) & 0xffff;
  let locked = z.menuLockedRaw & ~MENU_MASKE_BEENDEN & 0xffff;
  if (z.loadoutLocked) {
    // Die Ausrüstungssperre schlägt auf zwei Zeilen durch: Item und Limit.
    locked |= (1 << 0) | (1 << 6);
  }
  visible >>>= 0;
  locked >>>= 0;
  return { visible, locked };
}

/** Ist die Menüzeile sichtbar? (Nach {@link wirksameMenuemasken}.) */
export function zeileSichtbar(visible: number, bit: number): boolean {
  return (visible & (1 << bit)) !== 0;
}

/** Ist die Menüzeile gesperrt — also sichtbar, aber nicht wählbar? */
export function zeileGesperrt(locked: number, bit: number): boolean {
  return (locked & (1 << bit)) !== 0;
}

/**
 * Kann die Figur aus der Gruppe genommen werden?
 *
 * ⚠️ Gesperrte Figuren **bleiben im Raster sichtbar** — sie lassen sich nur
 * nicht bewegen. Wer Sperre und Verfügbarkeit vermengt, blendet sie aus.
 */
export function phsBeweglich(z: StoryZustand, charId: number): boolean {
  const bit = 1 << charId;
  return (z.phsAvailable & bit) !== 0 && (z.phsLocked & bit) === 0;
}

/** Steht die Figur überhaupt im PHS-Raster? */
export function phsVorhanden(z: StoryZustand, charId: number): boolean {
  return (z.phsAvailable & (1 << charId)) !== 0;
}
