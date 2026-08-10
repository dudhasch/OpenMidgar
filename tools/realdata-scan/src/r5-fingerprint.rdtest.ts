import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanLgp } from '@webmidgar/formats-lgp';
import {
  archivRolle,
  BEKANNTE_RELEASES,
  berichtIstAssetfrei,
  klassifiziere,
  kurz,
  profilMitFingerprint,
  type Klassifikation,
} from '@webmidgar/nfr-run';
import { NodeDirectorySource } from './node-source.js';

/**
 * S20 — R5-Fingerprint-Matrix über die lokal vorhandenen Archive.
 *
 * R5 lautet: „Release-Varianz (1998 vs. Steam) in Field-Containern und
 * Archiven — Parser bricht auf Nutzervarianten". Die Verifikationsmethode ist
 * die Fingerprint-Matrix plus der Nachweis, dass unbekannte Varianten in den
 * „best effort"-Pfad laufen statt in den Abbruch.
 *
 * Die Matrix wird hier aus **allen** LGP-Archiven der Installation gebildet —
 * einschließlich der Sicherungskopien eines Game-Converters. Damit hat die
 * Messung beide Richtungen, die eine Kennung braucht:
 *  - **Sensitivität**: verschiedene Fassungen derselben Archivrolle (Sprach-
 *    und Regionalvarianten) müssen verschiedene Fingerprints liefern.
 *  - **Stabilität**: dieselbe Datei an zwei Pfaden mit zwei mtimes muss
 *    denselben Fingerprint liefern.
 * Ohne die zweite Richtung wäre die erste wertlos: eine Kennung, die alles
 * trennt, trennt nichts.
 *
 * Assetfreiheit: Ausgabe sind Digests, Zähler und Endungshistogramme.
 * Dateipfade werden bewusst NICHT ausgegeben, nur ein Struktur-Tag
 * („haupt" / „sicherung"), das aus der Verzeichnistiefe abgeleitet ist.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Struktur-Tag statt Pfad: nur „liegt im Hauptbaum" oder „in einer Sicherung". */
function herkunftsTag(pfad: string): 'haupt' | 'sicherung' {
  return /backup|sicherung|7h\d/i.test(pfad) ? 'sicherung' : 'haupt';
}

interface MatrixZeile {
  archiv: string;
  herkunft: 'haupt' | 'sicherung';
  fingerprint: string;
  eintraege: number;
  konfliktEintraege: number;
  quarantaene: number;
  verschattet: number;
  terminatorOk: boolean;
  lookupReproduzierbar: boolean;
  endungen: Record<string, number>;
  urteil: Klassifikation['urteil'];
}

describe.skipIf(!available)('Realdaten: R5-Fingerprint-Matrix (S20)', () => {
  it('bildet die Matrix und weist den best-effort-Pfad nach', { timeout: 1_800_000 }, async () => {
    // Ganzer Installationsbaum: includePrefixes leer = alles aufzählen.
    const dir = new NodeDirectorySource(REAL_DIR, []);
    const zeilen: MatrixZeile[] = [];
    let fatale = 0;

    for await (const datei of dir.files()) {
      if (!datei.name.toLowerCase().endsWith('.lgp')) continue;
      const archivName = datei.name.toLowerCase().replace(/\.lgp$/, '');
      const scan = await scanLgp(datei, archivName, { mode: 'fast' });
      if (!scan.ok || !scan.archive) {
        fatale++;
        continue;
      }
      const profil = await profilMitFingerprint(scan.archive);
      const urteil = klassifiziere(profil);
      zeilen.push({
        archiv: profil.archiv,
        herkunft: herkunftsTag(datei.path),
        fingerprint: kurz(profil.releaseFingerprint),
        eintraege: profil.eintraege,
        konfliktEintraege: profil.konfliktEintraege,
        quarantaene: profil.quarantaene,
        verschattet: profil.verschattet,
        terminatorOk: profil.terminatorOk,
        lookupReproduzierbar: profil.lookupReproduzierbar,
        endungen: profil.endungen,
        urteil: urteil.urteil,
      });
    }

    zeilen.sort((a, b) => a.archiv.localeCompare(b.archiv) || a.herkunft.localeCompare(b.herkunft));

    // --- Trennschärfe, zwei Richtungen ---------------------------------------
    // (1) Sensitivität: verschiedene Fassungen DERSELBEN Rolle (Sprach-/
    //     Regionalvarianten desselben Archivs) müssen sich unterscheiden.
    const nachRolle = new Map<string, Set<string>>();
    for (const z of zeilen) {
      const rolle = archivRolle(z.archiv);
      const menge = nachRolle.get(rolle) ?? new Set<string>();
      menge.add(z.fingerprint);
      nachRolle.set(rolle, menge);
    }
    const rollenMitVarianten = [...nachRolle.entries()]
      .filter(([, fps]) => fps.size > 1)
      .map(([rolle, fps]) => ({ rolle, varianten: fps.size }))
      .sort((a, b) => b.varianten - a.varianten || a.rolle.localeCompare(b.rolle));

    // (2) Stabilität (Kontrollhypothese): identische Dateien — dieselbe Datei
    //     im Hauptbaum und in einer Sicherungskopie, mit anderem Pfad und
    //     anderer mtime — MÜSSEN denselben Fingerprint tragen. Ohne diese
    //     Gegenprobe könnte die Kennung schlicht zufällig sein und die
    //     Sensitivität oben wäre wertlos.
    const nachName = new Map<string, MatrixZeile[]>();
    for (const z of zeilen) nachName.set(z.archiv, [...(nachName.get(z.archiv) ?? []), z]);
    let kopienPaare = 0;
    let inkonsistent = 0;
    for (const gruppe of nachName.values()) {
      if (gruppe.length < 2) continue;
      kopienPaare += gruppe.length - 1;
      const erster = gruppe[0]!.fingerprint;
      for (const z of gruppe.slice(1)) if (z.fingerprint !== erster) inkonsistent++;
    }

    const bekannt = zeilen.filter((z) => z.urteil === 'bekannt').length;
    const unbekannt = zeilen.filter((z) => z.urteil === 'unbekannte-variante').length;

    console.log(
      'R5-Fingerprint-Matrix:',
      JSON.stringify(
        {
          archive: zeilen.length,
          fataleArchive: fatale,
          bekannteReleases: bekannt,
          unbekannteVarianten: unbekannt,
          registryGroesse: BEKANNTE_RELEASES.length,
          rollenMitMehrerenVarianten: rollenMitVarianten,
          identischeKopienPaare: kopienPaare,
          inkonsistenteFingerprints: inkonsistent,
          matrix: zeilen,
        },
        null,
        1,
      ),
    );

    // --- Zusicherungen --------------------------------------------------------
    expect(zeilen.length).toBeGreaterThanOrEqual(3);
    // Kein Archiv darf am Header scheitern — R5 wäre sonst akut.
    expect(fatale).toBe(0);
    // best-effort-Pfad: auch unbekannte Varianten liefern ein nutzbares
    // Verzeichnis (Einträge > 0, keine Quarantäneflut).
    for (const z of zeilen) {
      expect(z.eintraege).toBeGreaterThan(0);
      expect(z.quarantaene).toBeLessThanOrEqual(Math.ceil(z.eintraege * 0.01));
    }
    // Sensitivität: mindestens drei Archivrollen liegen in mehreren
    // unterscheidbaren Fassungen vor.
    expect(rollenMitVarianten.length).toBeGreaterThanOrEqual(3);
    // Stabilität: identische Dateien an verschiedenen Pfaden mit verschiedener
    // mtime tragen denselben Fingerprint.
    expect(kopienPaare).toBeGreaterThan(0);
    expect(inkonsistent).toBe(0);
    // Die drei registrierten Releases müssen in der Matrix wiedergefunden werden.
    expect(bekannt).toBeGreaterThanOrEqual(3);
    // Assetfreiheit des gesamten Berichts.
    const pruefung = berichtIstAssetfrei(zeilen);
    expect(pruefung.ok, pruefung.stelle).toBe(true);

    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
