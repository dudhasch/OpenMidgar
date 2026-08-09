/**
 * R9-Expositionsanalyse: **wie stark** hängt ein Replay-Digest überhaupt von
 * implementierungsdefinierter Mathematik ab?
 *
 * Der reine Digestvergleich über Browser beantwortet nur „gleich oder nicht"
 * — und er beantwortet das für die Engines, die gerade zur Hand sind. Fehlt
 * eine Engine (hier: SpiderMonkey und JavaScriptCore), bleibt ohne
 * Zusatzmessung nur Schweigen. Diese Analyse liefert stattdessen eine Zahl:
 * wie viele Aufrufe pro Lauf durch Funktionen laufen, die ECMA-262 **nicht**
 * bitgenau festlegt.
 *
 * ECMA-262 schreibt für `sqrt`, die Grundrechenarten und Rundungsfunktionen
 * exakte IEEE-754-Ergebnisse vor. Für `sin`, `cos`, `tan`, `atan`, `atan2`,
 * `pow`, `exp`, `log`, `hypot` und `cbrt` ist die Genauigkeit ausdrücklich
 * implementierungsabhängig — dort und nur dort kann ein Digest zwischen
 * Engines auseinanderlaufen.
 */

/** Nicht bitgenau spezifiziert (ECMA-262: „implementation-approximated"). */
export const IMPLEMENTIERUNGSDEFINIERT = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'pow',
  'exp',
  'log',
  'log2',
  'log10',
  'hypot',
  'cbrt',
  'sinh',
  'cosh',
  'tanh',
] as const;

/** Bitgenau festgelegt — hier ist Portabilität garantiert. */
export const IEEE_EXAKT = ['sqrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'trunc', 'min', 'max'] as const;

export interface MathExposition {
  /** Aufrufe je implementierungsdefinierter Funktion. */
  unsicher: Record<string, number>;
  /** Aufrufe je bitgenau festgelegter Funktion. */
  sicher: Record<string, number>;
  summeUnsicher: number;
  summeSicher: number;
  /** Anteil der unsicheren Aufrufe an allen erfassten Math-Aufrufen. */
  anteilUnsicherProzent: number;
}

type MathFn = (...args: number[]) => number;

/**
 * Führt `fn` mit instrumentiertem `Math` aus und zählt die Aufrufe. Der
 * Originalzustand wird in jedem Fall wiederhergestellt — auch wenn `fn`
 * wirft; ein dauerhaft gepatchtes `Math` wäre ein hübsch getarnter
 * Folgefehler.
 */
export function messeMathExposition<T>(fn: () => T): { ergebnis: T; exposition: MathExposition } {
  const original = new Map<string, MathFn>();
  const unsicher: Record<string, number> = {};
  const sicher: Record<string, number> = {};
  const mathAlsRecord = Math as unknown as Record<string, MathFn>;

  const instrumentiere = (name: string, ziel: Record<string, number>): void => {
    const echt = mathAlsRecord[name];
    if (typeof echt !== 'function') return;
    original.set(name, echt);
    ziel[name] = 0;
    mathAlsRecord[name] = (...args: number[]): number => {
      ziel[name] = (ziel[name] ?? 0) + 1;
      return echt.apply(Math, args);
    };
  };

  for (const name of IMPLEMENTIERUNGSDEFINIERT) instrumentiere(name, unsicher);
  for (const name of IEEE_EXAKT) instrumentiere(name, sicher);

  try {
    const ergebnis = fn();
    const summeUnsicher = Object.values(unsicher).reduce((a, b) => a + b, 0);
    const summeSicher = Object.values(sicher).reduce((a, b) => a + b, 0);
    const gesamt = summeUnsicher + summeSicher;
    return {
      ergebnis,
      exposition: {
        unsicher: nurBelegte(unsicher),
        sicher: nurBelegte(sicher),
        summeUnsicher,
        summeSicher,
        anteilUnsicherProzent: gesamt > 0 ? (summeUnsicher / gesamt) * 100 : 0,
      },
    };
  } finally {
    for (const [name, echt] of original) mathAlsRecord[name] = echt;
  }
}

function nurBelegte(werte: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(werte)) if (v > 0) out[k] = v;
  return out;
}

/**
 * Kontrollhypothese für die Expositionsanalyse: Ein Lauf, der garantiert
 * **keine** implementierungsdefinierte Mathematik berührt, muss 0 melden.
 * Ohne diese Gegenprobe wäre eine Null nicht von einer kaputten
 * Instrumentierung zu unterscheiden.
 */
export function kontrollLauf(): number {
  let summe = 0;
  for (let i = 1; i < 1000; i++) summe += Math.sqrt(i) + Math.abs(-i) + Math.floor(i / 3);
  return summe;
}

// --- Math-Fingerprint: welche Funktion weicht ab? ---------------------------

/**
 * FNV-1a-64 über Rohbytes (BigInt-frei ist hier nicht möglich, weil 64 Bit
 * gebraucht werden — die Digests sollen mit denen der Sitzung vergleichbar
 * breit sein).
 */
function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const maske = 0xffffffffffffffffn;
  for (const b of bytes) {
    hash = ((hash ^ BigInt(b)) * prime) & maske;
  }
  return hash.toString(16).padStart(16, '0');
}

export interface MathProbe {
  funktion: string;
  digest: string;
  proben: number;
  /** Erster Funktionswert der Reihe — als menschenlesbarer Anker. */
  ersterWert: number;
}

/**
 * Bildet je Funktion einen Digest über ein festes Argumentgitter.
 *
 * Zweck: Wenn zwei Engines verschiedene Replay-Digests liefern, sagt der
 * Sitzungsdigest allein nur „irgendwo anders". Diese Probe zeigt **welche**
 * Funktion abweicht — und ob überhaupt eine abweicht oder der Unterschied
 * woanders herkommt. Ohne sie bliebe ein R9-Befund unbehebbar.
 *
 * Das Gitter ist bewusst breit (negative und positive Argumente, kleine und
 * große Beträge), weil Genauigkeitsunterschiede oft nur in Randbereichen
 * auftreten.
 */
export function mathProbe(schritte = 2000): MathProbe[] {
  const funktionen: [string, (i: number) => number][] = [
    ['hypot', (i) => Math.hypot(i * 0.37 - 370, i * 0.11 + 0.5)],
    ['atan2', (i) => Math.atan2(i * 0.11 - 110, i * 0.37 - 370)],
    ['sqrt', (i) => Math.sqrt(i * 1.7 + 0.25)],
    ['sin', (i) => Math.sin(i * 0.013)],
    ['cos', (i) => Math.cos(i * 0.013)],
    ['pow', (i) => Math.pow(1 + i * 0.001, 1.5)],
    ['log', (i) => Math.log(i * 0.7 + 1)],
    ['exp', (i) => Math.exp(i * 0.003 - 3)],
  ];
  return funktionen.map(([name, fn]) => {
    const werte = new Float64Array(schritte);
    for (let i = 0; i < schritte; i++) werte[i] = fn(i);
    const bytes = new Uint8Array(werte.buffer);
    return { funktion: name, digest: fnv1a64(bytes), proben: schritte, ersterWert: werte[0]! };
  });
}
