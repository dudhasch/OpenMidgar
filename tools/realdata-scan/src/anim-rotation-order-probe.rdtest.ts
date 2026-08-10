import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4-B2 — Steht die Rotationsreihenfolge IN der Animationsdatei?
 *
 * Bisherige Annahme des Projekts: Die Reihenfolge der drei Winkel je Bone ist
 * eine **Konstante** der Engine. Wir haben YXZ fest verdrahtet, gestützt auf
 * zwei unabhängige Fremdimplementierungen (Kujata `rotationOrder = "YXZ"`,
 * KimeraCS `q = qY · qX · qZ`). Trotzdem stehen animierte Frames nur in
 * 10 von 76 Fällen aufrecht — die Konstante erklärt die Daten nicht.
 *
 * KimeraCS liest im `.a`-Header jedoch **drei Bytes `rotationOrder`** (Versatz
 * 12..14), dokumentiert als „0 = alpha, 1 = beta, 2 = gamma". Wäre das wahr,
 * dann ist die Reihenfolge **Datum, nicht Konstante** — und eine fest
 * verdrahtete Reihenfolge müsste überall dort scheitern, wo die Datei etwas
 * anderes sagt. Das wäre eine vollständige Erklärung für den Befund 10/76.
 *
 * Diese Probe entscheidet das, ohne die Behauptung zu übernehmen.
 *
 * **Vorhersage.** Sind die drei Bytes wirklich eine Reihenfolge, dann bilden
 * sie zwingend eine **Permutation von {0,1,2}** — jeder Winkel kommt genau
 * einmal vor. Das ist ein harter Struktur-Test: Von den 2^24 möglichen
 * Bytetripeln sind nur 6 eine Permutation. Ein zufälliges Tripel besteht ihn
 * mit einer Wahrscheinlichkeit von 6 / 16.777.216.
 *
 * **Kontrolle.** Dieselbe Prüfung an zwei bewusst falschen Versätzen (13 und
 * 16). Läge die Reihenfolge nicht bei 12, müsste die Trefferquote dort
 * vergleichbar sein. Diese Kontrolle kann durchfallen — und genau darum ist
 * sie eine.
 *
 * **Der eigentliche Befund** ist aber nicht die Quote, sondern die
 * **Verteilung**: Ist über alle Dateien nur EIN Tripel belegt, dann ist die
 * Reihenfolge faktisch doch konstant und B2 hat eine andere Ursache. Kommen
 * mehrere vor, ist die feste Verdrahtung widerlegt.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler und Quoten. Keine
 * Dateinamen im Ergebnis, keine Rohbytes, keine Geometrie.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Ist das Bytetripel ab `at` eine Permutation von {0,1,2}? */
function istPermutation(bytes: Uint8Array, at: number): boolean {
  if (at + 2 >= bytes.length) return false;
  const a = bytes[at]!;
  const b = bytes[at + 1]!;
  const c = bytes[at + 2]!;
  if (a > 2 || b > 2 || c > 2) return false;
  return a !== b && b !== c && a !== c;
}

/** Achsenkürzel für die Ausgabe — 0 = alpha (X), 1 = beta (Y), 2 = gamma (Z). */
const ACHSE = ['X', 'Y', 'Z'] as const;

function tripelName(bytes: Uint8Array, at: number): string {
  return [0, 1, 2].map((i) => ACHSE[bytes[at + i]!] ?? '?').join('');
}

describe.skipIf(!available)('Realdaten: Rotationsreihenfolge im .a-Header (R4-B2)', () => {
  it('prüft, ob Versatz 12..14 eine Reihenfolge trägt — mit zwei Kontrollversätzen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let dateien = 0;
    let versionEins = 0;
    let permKandidat = 0;
    let permKontrolle13 = 0;
    let permKontrolle16 = 0;
    const tripel = new Map<string, number>();
    const unusedWerte = new Map<number, number>();

    for (const entry of index.listEntries('char')) {
      if (!entry.name.toLowerCase().endsWith('.a')) continue;
      let bytes: Uint8Array;
      try {
        bytes = await index.readEntry(entry.canonicalId);
      } catch {
        continue;
      }
      if (bytes.length < 36) continue;
      dateien++;

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getInt32(0, true) === 1) versionEins++;

      if (istPermutation(bytes, 12)) {
        permKandidat++;
        const name = tripelName(bytes, 12);
        tripel.set(name, (tripel.get(name) ?? 0) + 1);
      }
      if (istPermutation(bytes, 13)) permKontrolle13++;
      if (istPermutation(bytes, 16)) permKontrolle16++;

      const unused = bytes[15]!;
      unusedWerte.set(unused, (unusedWerte.get(unused) ?? 0) + 1);
    }

    const quote = (n: number): string => `${((n / Math.max(1, dateien)) * 100).toFixed(1)}%`;

    console.log(
      'Rotationsreihenfolge im .a-Header:',
      JSON.stringify(
        {
          dateien,
          'version == 1': `${versionEins}/${dateien}`,
          'Versatz 12 ist Permutation': `${permKandidat}/${dateien} (${quote(permKandidat)})`,
          'Kontrolle Versatz 13': `${permKontrolle13}/${dateien} (${quote(permKontrolle13)})`,
          'Kontrolle Versatz 16': `${permKontrolle16}/${dateien} (${quote(permKontrolle16)})`,
          'belegte Reihenfolgen': [...tripel.entries()].sort((a, b) => b[1] - a[1]),
          'Byte 15 (laut Referenz ungenutzt)': [...unusedWerte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
        },
        null,
        1,
      ),
    );

    expect(dateien).toBeGreaterThan(1000);

    // Der Kandidat muss praktisch immer eine Permutation sein …
    expect(permKandidat / dateien).toBeGreaterThan(0.99);
    // … und die Kontrollen müssen deutlich abfallen. Täten sie das nicht,
    // wäre die Permutations-Eigenschaft kein Merkmal dieser Position.
    expect(permKandidat).toBeGreaterThan(permKontrolle13 * 4);
    expect(permKandidat).toBeGreaterThan(permKontrolle16 * 4);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
