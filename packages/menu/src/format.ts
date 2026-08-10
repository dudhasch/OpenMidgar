/**
 * Darstellungsregeln des Menüs (S21).
 *
 * Bewusst ein eigenes Modul und bewusst ohne `Intl`: Die Ausgabe muss über
 * Browser und Node hinweg **zeichengleich** sein, sonst unterscheiden sich
 * Golden-Vergleiche je nach Umgebung. `Intl.NumberFormat` liefert je nach
 * ICU-Stand verschiedene Trennzeichen (schmales Leerzeichen statt Punkt) —
 * genau die Sorte Abweichung, die R9 in S20 schon einmal gekostet hat.
 */

/** Tausenderpunkte, deutsche Schreibweise. */
export function formatNumber(value: number): string {
  const n = Math.trunc(Math.abs(value));
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return (value < 0 ? '-' : '') + out;
}

/** Spielzeit als `h:mm:ss`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `aktuell/maximum`, wie das Original es zeigt. */
export function formatRatio(current: number, max: number): string {
  return `${formatNumber(current)}/${formatNumber(max)}`;
}

/**
 * Balkenfüllung als Anteil 0…1.
 *
 * Ein Maximum von 0 ergibt 0 und nicht NaN: Ein leerer Charakterplatz hat kein
 * HP-Maximum, und ein NaN im View-Model würde sich bis in die Darstellung
 * durchfressen, wo es niemand mehr zuordnen kann.
 */
export function barFill(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, current / max));
}
