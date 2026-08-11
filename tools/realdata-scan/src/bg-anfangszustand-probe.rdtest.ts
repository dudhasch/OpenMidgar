import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { berechneAnfangsBgStates, FieldRuntime, prepareScript } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * **F35-1 — Wirkt die Vorbelegung der Hintergrundmasken?**
 *
 * Die Vorbelegung (`berechneAnfangsBgStates`) ist eine 🔵-Entscheidung. Ob sie
 * den beobachteten Sichtdefekt behebt, ist dagegen eine **Messfrage** — und
 * die muss beantwortet werden, bevor irgendwer sie als Fix verbucht.
 *
 * Gemessen wird über alle Fields mit animierten Hintergrundgruppen:
 *  1. wie viele Gruppen beim Field-START ohne Vorbelegung leer wären
 *     (= alle ihre Kacheln unsichtbar),
 *  2. wie viele davon die Vorbelegung rettet,
 *  3. wie viele **nach 300 Ticks Skriptlauf** immer noch leer sind — denn eine
 *     Vorbelegung, die das Skript sofort wieder abräumt, behebt nichts.
 *
 * Punkt 3 ist die eigentliche Kontrolle. Ohne ihn hieße „die Karte ist beim
 * Start nicht mehr leer" nur, dass die Zahl an einer Stelle steht, an der
 * niemand hinschaut.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const TICKS = 300;

describe.skipIf(!available)('Realdaten: F35-1 Anfangszustand der Hintergrundmasken', () => {
  it('misst, wie viele Kachelgruppen ohne und mit Vorbelegung unsichtbar bleiben', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let fields = 0;
    let fieldsMitGruppen = 0;
    let gruppenGesamt = 0;
    let leerBeimStartOhne = 0;
    let leerBeimStartMit = 0;
    let leerNachLaufOhne = 0;
    let leerNachLaufMit = 0;
    let kachelnGerettet = 0;
    const beispiele: string[] = [];
    // F35-1 ist an `junonr2` aufgefallen (verschwundene Gondel) — dieses Field
    // wird deshalb namentlich berichtet, nicht nur im Aggregat.
    let junonr2 = 'nicht erreicht';

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const b = parsed.bundle;
      if (!parsed.ok || !b?.script || !b.rawSections[1] || !b.background) continue;
      fields++;
      const kacheln = b.background.layers.flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state })));
      const anfang = berechneAnfangsBgStates(kacheln);
      const params = Object.keys(anfang).map(Number);
      if (params.length === 0) continue;
      fieldsMitGruppen++;
      gruppenGesamt += params.length;

      const prepared = prepareScript(b.script, b.rawSections[1]!);
      const lauf = (vor: Record<number, number> | undefined): Record<number, number> => {
        const rt = new FieldRuntime(prepared, { seed: 0x5117, budget: 200, mainLoop: true, initialBgStates: vor });
        rt.start();
        for (let t = 0; t < TICKS; t++) rt.tick();
        return rt.state.bgStates;
      };

      for (const p of params) {
        leerBeimStartOhne++; // ohne Vorbelegung ist beim Start JEDE Gruppe leer
        if ((anfang[p] ?? 0) === 0) leerBeimStartMit++;
      }
      const ohne = lauf(undefined);
      const mit = lauf(anfang);
      if (entry.name === 'junonr2') {
        junonr2 = `Vorbelegung ${JSON.stringify(anfang)} · nach ${TICKS} Ticks ohne ${JSON.stringify(ohne)} · mit ${JSON.stringify(mit)}`;
      }
      for (const p of params) {
        const o = ohne[p] ?? 0;
        const m = mit[p] ?? 0;
        if (o === 0) leerNachLaufOhne++;
        if (m === 0) leerNachLaufMit++;
        if (o === 0 && m !== 0) {
          kachelnGerettet += kacheln.filter((k) => k.param === p).length;
          if (beispiele.length < 12) beispiele.push(`${entry.name} param ${p}: 0 → ${m}`);
        }
      }
    }
    await dir.closeAll();

    console.log(
      'F35-1 Anfangszustand:',
      JSON.stringify(
        {
          'Fields mit Hintergrund': fields,
          'Fields mit animierten Gruppen': fieldsMitGruppen,
          Kachelgruppen: gruppenGesamt,
          'beim Start leer OHNE Vorbelegung': leerBeimStartOhne,
          'beim Start leer MIT Vorbelegung': leerBeimStartMit,
          [`nach ${TICKS} Ticks leer OHNE Vorbelegung`]: leerNachLaufOhne,
          [`nach ${TICKS} Ticks leer MIT Vorbelegung`]: leerNachLaufMit,
          'dadurch wieder sichtbare Kacheln': kachelnGerettet,
          'junonr2 (F35-1)': junonr2,
          Beispiele: beispiele,
        },
        null,
        1,
      ),
    );

    expect(fieldsMitGruppen).toBeGreaterThan(50);
    // Die Vorbelegung darf nie eine Gruppe leeren, die vorher gefüllt war.
    expect(leerNachLaufMit).toBeLessThanOrEqual(leerNachLaufOhne);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
