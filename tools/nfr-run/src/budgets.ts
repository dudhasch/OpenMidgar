/**
 * NFR-Sollwerte aus Masterplan Phase 2.4 — als Daten, nicht als Prosa.
 *
 * Der Grund für diese Datei ist der Methodikstandard des Projekts: „Keine
 * Optimierung ohne vorherige Messung, jede Behauptung über Performance
 * braucht eine Zahl." Wenn die Sollwerte im Code stehen, kann ein Messlauf
 * sein eigenes Urteil fällen und ein verfehlter Zielwert lässt sich nicht
 * versehentlich wegformulieren.
 *
 * Die Bewertung kennt bewusst zwei Zustände jenseits von „erfüllt": eine
 * Überschreitung bis 20 % gilt laut S20-Akzeptanzkriterium als
 * begründungspflichtig, darüber als echter Verstoß. Und ein Sollwert ohne
 * Messwert ist **nicht** erfüllt, sondern `ungemessen` — das ist der Fall,
 * den man beim Abhaken am leichtesten unterschlägt.
 */

export type NfrProfil = 'desktop' | 'mobile';

export type NfrEinheit = 'ms' | 'MB' | 'Anzahl' | 'Verhältnis';

export interface NfrSollwert {
  id: string;
  bezeichnung: string;
  einheit: NfrEinheit;
  /** Obergrenze Desktop (Messwert muss ≤ sein). */
  desktop: number;
  /** Obergrenze Mobile. */
  mobile: number;
  /** Zeile der Masterplan-Tabelle 2.4, aus der der Wert stammt. */
  quelle: string;
}

export const NFR_SOLLWERTE: readonly NfrSollwert[] = [
  {
    id: 'main-thread-task',
    bezeichnung: 'Max. Main-Thread-Task durch Engine-Arbeit',
    einheit: 'ms',
    desktop: 8,
    mobile: 12,
    quelle: '2.4 Zeile 1',
  },
  {
    id: 'long-tasks',
    bezeichnung: 'Long Tasks (> 50 ms) im Steady State',
    einheit: 'Anzahl',
    desktop: 0,
    mobile: 0,
    quelle: '2.4 Zeile 1',
  },
  {
    id: 'gpu-upload-frame',
    bezeichnung: 'GPU-Upload je Frame',
    einheit: 'ms',
    desktop: 2,
    mobile: 4,
    quelle: '2.4 Zeile 2',
  },
  {
    id: 'ttff-cold',
    bezeichnung: 'Time-to-First-Field (kalt, inkl. Scan)',
    einheit: 'ms',
    desktop: 10_000,
    mobile: 25_000,
    quelle: '2.4 Zeile 3',
  },
  {
    id: 'ttff-warm',
    bezeichnung: 'Time-to-First-Field (warm, Index + S2-Cache)',
    einheit: 'ms',
    desktop: 2_000,
    mobile: 4_000,
    quelle: '2.4 Zeile 4',
  },
  {
    id: 'field-wechsel-warm',
    bezeichnung: 'Field-Wechsel (warm)',
    einheit: 'ms',
    desktop: 500,
    mobile: 1_200,
    quelle: '2.4 Zeile 5',
  },
  {
    id: 'asset-kalt',
    bezeichnung: 'Asset-Latenz Einzelmodell (kalt)',
    einheit: 'ms',
    desktop: 300,
    mobile: 800,
    quelle: '2.4 Zeile 6',
  },
  {
    id: 'asset-warm',
    bezeichnung: 'Asset-Latenz Einzelmodell (warm)',
    einheit: 'ms',
    desktop: 50,
    mobile: 120,
    quelle: '2.4 Zeile 6',
  },
  {
    id: 'heap-steady',
    bezeichnung: 'JS-Heap Steady State (ein Field + Party)',
    einheit: 'MB',
    desktop: 256,
    mobile: 128,
    quelle: '2.4 Zeile 7',
  },
  {
    id: 'vram-schaetzung',
    bezeichnung: 'VRAM-Schätzbudget (GPU-Registry-Buchführung)',
    einheit: 'MB',
    desktop: 512,
    mobile: 128,
    quelle: '2.4 Zeile 8',
  },
  {
    id: 'abbruchlatenz',
    bezeichnung: 'Abbruchlatenz ohne SAB, gemessen in Parse-Etappen',
    einheit: 'Verhältnis',
    desktop: 1,
    mobile: 1,
    quelle: '2.4 Zeile 9',
  },
];

export const SOLLWERT_NACH_ID: ReadonlyMap<string, NfrSollwert> = new Map(
  NFR_SOLLWERTE.map((s) => [s.id, s]),
);

export type NfrUrteil = 'erfüllt' | 'grenzwertig' | 'verfehlt' | 'ungemessen';

/** Überschreitung bis zu dieser Quote gilt als begründungspflichtig, nicht als Verstoß. */
export const TOLERANZ_PROZENT = 20;

export interface NfrBefund {
  id: string;
  bezeichnung: string;
  einheit: NfrEinheit;
  profil: NfrProfil;
  sollwert: number;
  messwert: number | null;
  /** (Messwert − Sollwert) / Sollwert in Prozent; negativ = unter dem Ziel. */
  abweichungProzent: number | null;
  urteil: NfrUrteil;
  /** Kurzer Beleg, wie gemessen wurde (Stichprobengröße, Perzentil, Umgebung). */
  beleg: string;
}

export function grenzwert(id: string, profil: NfrProfil): number {
  const soll = SOLLWERT_NACH_ID.get(id);
  if (!soll) throw new Error(`Unbekannter NFR-Sollwert: ${id}`);
  return profil === 'desktop' ? soll.desktop : soll.mobile;
}

/**
 * Bewertet einen Messwert. `null` bedeutet ausdrücklich „nicht gemessen" und
 * wird nie zu „erfüllt" — sonst könnte eine fehlende Messung wie ein Erfolg
 * aussehen.
 */
export function bewerte(
  id: string,
  messwert: number | null,
  profil: NfrProfil,
  beleg: string,
): NfrBefund {
  const soll = SOLLWERT_NACH_ID.get(id);
  if (!soll) throw new Error(`Unbekannter NFR-Sollwert: ${id}`);
  const grenze = profil === 'desktop' ? soll.desktop : soll.mobile;
  const basis = { id, bezeichnung: soll.bezeichnung, einheit: soll.einheit, profil, sollwert: grenze };

  if (messwert === null || !Number.isFinite(messwert)) {
    return { ...basis, messwert: null, abweichungProzent: null, urteil: 'ungemessen', beleg };
  }
  // Sollwert 0 (Long Tasks) kennt keine relative Abweichung — dort zählt nur
  // „genau 0 oder nicht".
  if (grenze === 0) {
    return {
      ...basis,
      messwert,
      abweichungProzent: null,
      urteil: messwert === 0 ? 'erfüllt' : 'verfehlt',
      beleg,
    };
  }
  const abweichung = ((messwert - grenze) / grenze) * 100;
  const urteil: NfrUrteil =
    messwert <= grenze ? 'erfüllt' : abweichung <= TOLERANZ_PROZENT ? 'grenzwertig' : 'verfehlt';
  return { ...basis, messwert, abweichungProzent: abweichung, urteil, beleg };
}

export interface NfrBilanz {
  befunde: NfrBefund[];
  erfuellt: number;
  grenzwertig: number;
  verfehlt: number;
  ungemessen: number;
  /** true, wenn kein Sollwert verfehlt ist und keiner ungemessen blieb. */
  vollstaendigErfuellt: boolean;
}

export function bilanziere(befunde: readonly NfrBefund[]): NfrBilanz {
  const zaehle = (u: NfrUrteil): number => befunde.filter((b) => b.urteil === u).length;
  const verfehlt = zaehle('verfehlt');
  const ungemessen = zaehle('ungemessen');
  return {
    befunde: [...befunde],
    erfuellt: zaehle('erfüllt'),
    grenzwertig: zaehle('grenzwertig'),
    verfehlt,
    ungemessen,
    vollstaendigErfuellt: verfehlt === 0 && ungemessen === 0,
  };
}

/** Markdown-Zeilen für den Bericht — Zahlen, keine Prosa. */
export function alsMarkdownTabelle(befunde: readonly NfrBefund[]): string {
  const kopf = '| Metrik | Profil | Soll | Ist | Abweichung | Urteil | Beleg |\n|---|---|---|---|---|---|---|';
  const zeilen = befunde.map((b) => {
    const ist = b.messwert === null ? '—' : formatZahl(b.messwert);
    const abw =
      b.abweichungProzent === null ? '—' : `${b.abweichungProzent >= 0 ? '+' : ''}${b.abweichungProzent.toFixed(1)} %`;
    return `| ${b.bezeichnung} | ${b.profil} | ${formatZahl(b.sollwert)} ${b.einheit} | ${ist} ${b.einheit} | ${abw} | ${b.urteil} | ${b.beleg} |`;
  });
  return [kopf, ...zeilen].join('\n');
}

function formatZahl(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(n < 10 ? 2 : 1);
}
