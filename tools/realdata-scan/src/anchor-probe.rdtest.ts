import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S22-Vorprobe „Anker-Eindeutigkeit".
 *
 * Ein Script-Patch braucht eine Stelle, an der er greift. Der Entwurf aus
 * Phase 5.2 adressiert sie über `{entity, slot, ipOffset}` und sichert sie mit
 * einem `guardHash` ab. Bevor das gebaut wird, müssen drei Fragen an den Daten
 * beantwortet sein — jede davon kann den Entwurf kippen:
 *
 * **A1 — Sind Entitätsnamen innerhalb eines Fields eindeutig?** Wenn nicht,
 * ist ein namensbasierter Anker mehrdeutig, und der Patch müsste über den
 * Index adressieren. Das ist kein Detail: Ein Mod-Autor schreibt Namen, keine
 * Indizes.
 *
 * **A2 — Teilen sich Slots ihren Einsprungpunkt?** Der Leerspan-Sentinel aus
 * S6 (Entry == Stringtabellenanfang) sorgt schon konstruktionsbedingt dafür.
 * Wo zwei Slots auf denselben Offset zeigen, patcht man unvermeidlich beide —
 * das muss der Prüfer erkennen und melden, statt es geschehen zu lassen.
 *
 * **A3 — Wie breit muss das Guard-Fenster sein?** Der `guardHash` soll
 * feststellen, ob die Stelle noch die ist, für die der Patch geschrieben
 * wurde. Gemessen wird, wie oft ein Bytefenster fester Breite ab dem Anker im
 * Bytecode desselben Fields **mehrfach** vorkommt. Ein Fenster, das häufig
 * mehrdeutig ist, taugt nicht als Sicherung — dann bestätigt der Hash eine
 * beliebige gleich aussehende Stelle.
 *
 * Urheberrecht: ausschließlich Zähler, Quoten und Fenstergrößen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const GUARD_WINDOWS = [4, 8, 16, 32, 64] as const;

function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

describe.skipIf(!available)('Realdaten S22: Anker-Eindeutigkeit für Script-Patches', () => {
  it('misst Namensmehrdeutigkeit, geteilte Einsprungpunkte und die nötige Guard-Breite', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let felder = 0;
    let entitaeten = 0;
    let felderMitDoppeltemNamen = 0;
    let doppelteNamen = 0;
    let anker = 0;
    let echteAnker = 0;
    let ankerMitGeteiltemEinsprung = 0;
    let echteMitGeteiltemEinsprung = 0;

    /** Je Fensterbreite: wie viele Anker haben ein mehrdeutiges Guard-Fenster? */
    const mehrdeutig = new Map<number, number>(GUARD_WINDOWS.map((w) => [w, 0]));
    const echtMehrdeutig = new Map<number, number>(GUARD_WINDOWS.map((w) => [w, 0]));
    const zuKurz = new Map<number, number>(GUARD_WINDOWS.map((w) => [w, 0]));

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bundle = parsed.bundle;
      if (!parsed.ok || !bundle?.script) continue;
      const code = bundle.rawSections[1];
      if (!code) continue;
      felder++;

      // A1 — Namensmehrdeutigkeit.
      const namen = bundle.script.entities.map((e) => e.name);
      entitaeten += namen.length;
      const gesehen = new Set<string>();
      let feldHatDoppel = false;
      for (const n of namen) {
        if (gesehen.has(n)) {
          doppelteNamen++;
          feldHatDoppel = true;
        }
        gesehen.add(n);
      }
      if (feldHatDoppel) felderMitDoppeltemNamen++;

      // Häufigkeitstabelle je Fensterbreite: einmal über den Bytecode, danach
      // ist jede Anker-Abfrage ein Nachschlagen. Die naive Fassung verglich
      // jeden Anker gegen jede Byteposition und war damit quadratisch —
      // rechnerisch dieselbe Aussage, praktisch unbrauchbar.
      const haeufigkeit = new Map<number, Map<number, number>>();
      for (const w of GUARD_WINDOWS) {
        const tabelle = new Map<number, number>();
        for (let o = 0; o + w <= code.length; o++) {
          const h = fnv1a32(code.subarray(o, o + w));
          tabelle.set(h, (tabelle.get(h) ?? 0) + 1);
        }
        haeufigkeit.set(w, tabelle);
      }

      // A2/A3 — je Anker.
      for (const entity of bundle.script.entities) {
        const belegteOffsets = new Map<number, number>();
        for (const ep of entity.entryPoints) {
          if (ep === null || ep === undefined) continue;
          belegteOffsets.set(ep, (belegteOffsets.get(ep) ?? 0) + 1);
        }
        // Der häufigste Einsprungpunkt einer Entität ist der Leerspan-Sentinel
        // aus S6 (alle ungenutzten Slots zeigen dorthin). Ohne diese Trennung
        // wäre jede Quote unbrauchbar: Die ungenutzten Slots stellen die große
        // Mehrheit und schleppen jede Kennzahl mit sich.
        let sentinel = -1;
        let sentinelZahl = 1;
        for (const [off, n] of belegteOffsets) {
          if (n > sentinelZahl) {
            sentinel = off;
            sentinelZahl = n;
          }
        }

        for (const ep of entity.entryPoints) {
          if (ep === null || ep === undefined) continue;
          anker++;
          const echt = ep !== sentinel;
          if (echt) echteAnker++;
          if ((belegteOffsets.get(ep) ?? 0) > 1) {
            ankerMitGeteiltemEinsprung++;
            if (echt) echteMitGeteiltemEinsprung++;
          }

          for (const w of GUARD_WINDOWS) {
            if (ep + w > code.length) {
              zuKurz.set(w, zuKurz.get(w)! + 1);
              continue;
            }
            // Kommt dasselbe Fenster im Bytecode desselben Fields noch einmal
            // vor? Gezählt wird an JEDER Byteposition, nicht nur an
            // Instruktionsgrenzen — der Hash hält sich auch nicht daran.
            const treffer = haeufigkeit.get(w)!.get(fnv1a32(code.subarray(ep, ep + w))) ?? 0;
            if (treffer > 1) {
              mehrdeutig.set(w, mehrdeutig.get(w)! + 1);
              if (echt) echtMehrdeutig.set(w, echtMehrdeutig.get(w)! + 1);
            }
          }
        }
      }
    }

    const bericht = {
      felder,
      entitaeten,
      a1: {
        felderMitDoppeltemNamen,
        anteilFelder: Number((felderMitDoppeltemNamen / Math.max(1, felder)).toFixed(4)),
        doppelteNamen,
      },
      a2: {
        anker,
        echteAnker,
        ankerMitGeteiltemEinsprung,
        anteilAlle: Number((ankerMitGeteiltemEinsprung / Math.max(1, anker)).toFixed(4)),
        echteMitGeteiltemEinsprung,
        anteilEchte: Number((echteMitGeteiltemEinsprung / Math.max(1, echteAnker)).toFixed(4)),
      },
      a3: GUARD_WINDOWS.map((w) => ({
        fensterBytes: w,
        anteilMehrdeutigAlle: Number((mehrdeutig.get(w)! / Math.max(1, anker)).toFixed(4)),
        anteilMehrdeutigEchte: Number((echtMehrdeutig.get(w)! / Math.max(1, echteAnker)).toFixed(4)),
        fensterRagtUeberBytecodeHinaus: zuKurz.get(w)!,
      })),
    };
    console.log('S22 Anker-Eindeutigkeit:', JSON.stringify(bericht, null, 2));
    expect(felder).toBeGreaterThan(0);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
