/**
 * Der Zufallsgenerator des Kampfs — zahlengleich (ADR-028).
 *
 * ## Warum das ein eigenes Modul ist
 *
 * Ohne diesen Generator nützt die zahlengleiche Schadensrechnung wenig: Zwei
 * der drei Würfe eines Treffers kosten **je zwei** Tabellenbytes und
 * verschieben siebenmal von acht zusätzlich die Bank. Wer `roll1To100` als
 * einen Zug modelliert, bekommt beim ersten Treffer noch dieselbe Zahl und
 * ab dem zweiten nie wieder. Die Reihenfolge der Ziehungen ist Teil der
 * Formel, nicht Beiwerk.
 *
 * ## Die Tabelle steht NICHT in diesem Repository
 *
 * Die 256 Bytes sind Originaldaten: Sie liegen in `KERNEL.BIN`, in der
 * Sektion mit **Typfeld 2**, bei Versatz `0xE1C`. Dieses Modul trägt die
 * **Fundstelle und die Invarianten**, nicht das Fundstück —
 * {@link ladeZufallstabelle} liest sie zur Laufzeit aus den Daten des
 * Anwenders und prüft sie dabei.
 *
 * 🟢 Belegt: Die Tabelle ist eine **Permutation von `0x00`…`0xFF`** (jeder
 * Wert genau einmal, Bytesumme 32640) und in `data/kernel/KERNEL.BIN` und
 * `data/lang-en/kernel/KERNEL.BIN` **byteidentisch**, obwohl der Rest der
 * Sektion 2 sich unterscheidet.
 *
 * ## Was das für Wiederholbarkeit heißt
 *
 * Der Startwert ist ein C-`rand()`-Wert, also `0…0x7FFF`: Es gibt **nur
 * 32768 verschiedene Kampf-Zufallszustände**. Bei einem Arenakampf wird
 * **nicht** neu gesetzt — der Strom läuft weiter.
 */

/** Fundstelle der Tabelle: Sektion mit Typfeld 2, Versatz 0xE1C, 256 Byte. */
export const ZUFALLSTABELLE_SEKTIONSTYP = 2;
export const ZUFALLSTABELLE_VERSATZ = 0xe1c;
export const ZUFALLSTABELLE_LEN = 256;
/** Summe aller Bytes einer Permutation von 0…255 — die billigste Wache. */
export const ZUFALLSTABELLE_SUMME = 32640;

export interface Zufallszustand {
  /** Acht Leseköpfe teilen sich eine Tabelle. Je ein `u8`. */
  cursor: Uint8Array;
  /** Welcher Lesekopf gilt (0…7). */
  bank: number;
  /** Zähler NUR für {@link naechste16}; wird beim Setzen **nicht** zurückgesetzt. */
  rand16Counter: number;
  tabelle: Uint8Array;
}

/**
 * Prüft und übernimmt die Tabelle aus einer entpackten `KERNEL.BIN`-Sektion.
 * Gibt `null` zurück, wenn eine Invariante fällt — nie eine halbe Tabelle.
 */
export function ladeZufallstabelle(sektion2: Uint8Array): Uint8Array | null {
  if (sektion2.length < ZUFALLSTABELLE_VERSATZ + ZUFALLSTABELLE_LEN) return null;
  const t = sektion2.slice(ZUFALLSTABELLE_VERSATZ, ZUFALLSTABELLE_VERSATZ + ZUFALLSTABELLE_LEN);
  return istPermutation(t) ? t : null;
}

/** Ist `t` eine Permutation von 0…255? Das ist die scharfe Prüfung, nicht die Summe. */
export function istPermutation(t: Uint8Array): boolean {
  if (t.length !== ZUFALLSTABELLE_LEN) return false;
  const gesehen = new Uint8Array(256);
  let summe = 0;
  for (const b of t) {
    if (gesehen[b]) return false;
    gesehen[b] = 1;
    summe += b;
  }
  return summe === ZUFALLSTABELLE_SUMME;
}

/**
 * Zustand für einen Kampf. `seed` ist ein C-`rand()`-Wert (0…0x7FFF).
 *
 * ⚠️ Lesekopf `i` bekommt `(seed >> i) & 0xFF` — ein **gleitendes
 * Bytefenster**, keine Bitauslese. Die acht Köpfe starten also auf stark
 * überlappenden Werten, nicht auf 0/1. Wer das als Bit liest, bekommt einen
 * ganz anderen Strom.
 */
export function setzeZufall(tabelle: Uint8Array, seed: number): Zufallszustand {
  const cursor = new Uint8Array(8);
  for (let i = 0; i < 8; i++) cursor[i] = (seed >> i) & 0xff;
  return { cursor, bank: 0, rand16Counter: 0, tabelle };
}

/** Die Grundziehung: ein Tabellenbyte, Lesekopf der aktuellen Bank weiter. */
export function naechstesByte(z: Zufallszustand): number {
  const c = z.cursor[z.bank]!;
  const v = z.tabelle[c]!;
  z.cursor[z.bank] = (c + 1) & 0xff;
  return v;
}

/** Bankwechsel — einmal je Aktionsfolge, und innerhalb von {@link naechste16}. */
export function wechsleBank(z: Zufallszustand): void {
  z.bank = (z.bank + 1) & 7;
}

/** Gleichverteilt 0…`schranke`−1. Kostet **ein** Tabellenbyte. */
export function zufallUnter(z: Zufallszustand, schranke: number): number {
  return ((naechstesByte(z) & 0xff) * schranke) >> 8;
}

/**
 * 16-Bit-Ziehung. Kostet **zwei** Tabellenbytes und wechselt **sieben von
 * acht Malen** zusätzlich die Bank — sie stört damit jeden anderen
 * Verbraucher. Genau hier laufen Portierungen auseinander.
 */
export function naechste16(z: Zufallszustand): number {
  const lo = naechstesByte(z) & 0xff;
  const n = z.rand16Counter & 7;
  z.rand16Counter = (z.rand16Counter + 1) | 0;
  if (n !== 0) wechsleBank(z);
  const hi = naechstesByte(z) & 0xff;
  return ((hi << 8) | lo) & 0xffff;
}

/**
 * Gleichverteilt 1…100 — mit dem leichten Schiefstand des Originals: Der
 * Faktor ist `0x63` (=99) und der Teiler `0xFFFF`, das Maximum also
 * `99·65535/65535 + 1 = 100`.
 */
export function wurf1bis100(z: Zufallszustand): number {
  const r16 = naechste16(z) & 0xffff;
  return (((Math.imul(r16, 0x63) | 0) / 0xffff) | 0) + 1;
}
