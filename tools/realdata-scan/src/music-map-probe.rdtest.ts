import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { NodeDirectorySource } from './node-source.js';

/**
 * S16-Nachprobe „Musikindex → Dateiname", zweiter Anlauf.
 *
 * Der erste Anlauf suchte eine **Indexdatei** in den Audioverzeichnissen und
 * fand keine; zusätzlich folgt kein einziger OGG-Dateiname einem
 * Nummernschema (0 von 188). Beides stimmt — der Schluss „Zuordnung nicht
 * auffindbar" war trotzdem voreilig, weil er am falschen Ort gesucht hat.
 *
 * Neue Spur: FFNx löst den Musiknamen über eine Funktion **in der Spiel-EXE**
 * auf (`get_midi_name(musicId)`). Eine Datentabelle gibt es also gar nicht —
 * wohl aber ein Archiv, dessen Inhaltsverzeichnis dieselbe Reihenfolge tragen
 * könnte: `data/midi/midi.lgp`. Die Kette wäre
 * `musicId → TOC-Rang in midi.lgp → Name → <name>.ogg`.
 *
 * Diese Probe prüft das **Namensglied** dieser Kette und nur dieses: Decken
 * sich die Einträge von `midi.lgp` mit den Dateien in `music_ogg`? Der
 * **Reihenfolgeteil** (TOC-Rang == musicId) ist damit ausdrücklich NICHT
 * belegt — dafür bräuchte es einen zweiten, unabhängigen Beleg.
 *
 * Gegenhypothese: Die drei Schwesterarchive (`awe.lgp`, `xg.lgp`, `ygm.lgp`)
 * sind andere Klangsätze derselben Stücke. Tragen sie dieselben Namen in
 * derselben Reihenfolge, stützt das die Annahme einer stabilen, kanonischen
 * Ordnung; weichen sie ab, ist die Ordnung kein Formatfakt.
 *
 * Urheberrecht/Datenschutz: Ausgabe ausschließlich Zähler, Quoten und
 * Positionsvergleiche — keine Titelnamen (Werkinhalt).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(join(REAL_DIR, 'data', 'midi'));

/** Dateiname ohne Endung, kleingeschrieben. */
function stem(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

describe.skipIf(!available)('Realdaten: Musikindex-Zuordnung (S16, zweiter Anlauf)', () => {
  it('midi.lgp-Inhaltsverzeichnis gegen music_ogg', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/midi']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const archive: Record<string, string[]> = {};
    for (const name of ['midi', 'awe', 'xg', 'ygm']) {
      try {
        archive[name] = [...index.listEntries(name)].map((e) => stem(e.name));
      } catch {
        // Archiv nicht vorhanden — kein Fehler, nur weniger Vergleichsmaterial.
      }
    }

    const oggs = (await readdir(join(REAL_DIR, 'data', 'music_ogg')))
      .filter((f) => /\.ogg$/i.test(f))
      .map(stem);
    const oggSet = new Set(oggs);

    const midi = archive['midi'] ?? [];
    const midiSet = new Set(midi);
    const treffer = midi.filter((s) => oggSet.has(s)).length;
    const oggOhneMidi = oggs.filter((s) => !midiSet.has(s)).length;

    // Gegenhypothese: Tragen die Schwesterarchive dieselbe Ordnung?
    const ordnung: Record<string, string> = {};
    for (const [name, list] of Object.entries(archive)) {
      if (name === 'midi') continue;
      const gleich = list.filter((s, i) => midi[i] === s).length;
      ordnung[name] = `${gleich}/${Math.min(list.length, midi.length)} positionsgleich`;
    }

    console.log(
      'Musikzuordnung:',
      JSON.stringify(
        {
          midiEintraege: midi.length,
          oggDateien: oggs.length,
          midiMitPassenderOgg: `${treffer}/${midi.length}`,
          oggOhneMidiEintrag: oggOhneMidi,
          schwesterarchive: ordnung,
        },
        null,
        1,
      ),
    );

    // Das Namensglied muss tragen: Praktisch jede OGG-Datei braucht einen
    // Eintrag im Archiv, sonst ist die Kette an dieser Stelle schon falsch.
    expect(midi.length).toBeGreaterThan(0);
    expect(oggOhneMidi / oggs.length).toBeLessThan(0.05);
    await dir.closeAll();
  }, 300_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
