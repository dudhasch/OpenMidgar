/**
 * Soak-Test: 500 Field-Wechsel (Masterplan-Teststrategie, Zeile „Speicher").
 *
 * Abnahme ist nicht „läuft durch", sondern **Rückkehr auf die Baseline**:
 * Heap und GPU-/VRAM-Buchführung müssen nach dem letzten Wechsel wieder dort
 * stehen, wo sie vor dem ersten standen (± 5 %). Ein Leck zeigt sich als
 * monotoner Anstieg, nicht als Absturz — deshalb wird der Verlauf abgetastet
 * und nicht nur der Endwert verglichen.
 *
 * Zusätzlich läuft eine Determinismusprobe mit: dasselbe Field muss im
 * 500. Zyklus denselben Sitzungsdigest liefern wie im ersten. Damit ist
 * ausgeschlossen, dass sich Zustand über Wechsel hinweg einschleicht — der
 * unauffälligste Fehler dieser Klasse.
 */

import { FieldSession, NEUTRAL_INPUT } from '@webmidgar/field-runtime';
import { decompressLzsEntry, parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { IndexService, type DirectorySource } from '@webmidgar/io';
import { buildTileAtlas } from '@webmidgar/render-field';
import { istFieldEintrag } from './kampagne.js';
import { abweichungProzent, heapProbe, jetzt, perzentile, type Perzentile } from './messhilfen.js';
import { VramBuchfuehrung, atlasBytes, type VramStand } from './vram-buchfuehrung.js';

export interface SoakOptionen {
  quelle: DirectorySource;
  archiv?: string;
  /** Anzahl der Wechsel (Sollwert der Teststrategie: 500). */
  wechsel?: number;
  atlasGroesse?: number;
  ticksJeWechsel?: number;
  /** Wie viele verschiedene Fields die Rotation nutzt. */
  fieldsInRotation?: number;
  /** Heap-Abtastung alle n Wechsel. */
  abtastungAlle?: number;
  /**
   * Wechsel, nach denen die **Steady-State-Baseline** genommen wird
   * (Standard: eine volle Rotation). Vorher ist der Heap noch von einmaligen
   * Effekten geprägt — JIT-Code, interne Caches, erstmalig angelegte
   * Strukturen. Wer die Baseline davor nimmt, misst diese Einmalkosten als
   * „Leck" mit; wer sie ganz weglässt, misst gar nichts.
   */
  aufwaermWechsel?: number;
}

export interface SoakStichprobe {
  wechsel: number;
  heapMB: number;
  vramBytes: number;
  vramEintraege: number;
}

export interface SoakErgebnis {
  wechsel: number;
  fieldsInRotation: number;
  aufwaermWechsel: number;
  /** Heap vor dem ersten Wechsel (kalt, inkl. Einmalkosten). */
  heapKaltBaselineMB: number;
  /** Heap nach der Aufwärmphase — die Baseline des Steady State. */
  heapBaselineMB: number;
  heapEndeMB: number;
  /** Abweichung gegen die Steady-State-Baseline — die Leck-Aussage. */
  heapAbweichungProzent: number;
  /** Abweichung gegen die kalte Baseline — enthält die Einmalkosten. */
  heapAbweichungKaltProzent: number;
  gcErzwungen: boolean;
  vramBaselineBytes: number;
  vramEndeBytes: number;
  vram: VramStand;
  verlauf: SoakStichprobe[];
  wechselMs: Perzentile;
  /** Digest des ersten Fields im ersten Zyklus. */
  digestErsterZyklus: string;
  /** Derselbe Digest im letzten Zyklus — muss identisch sein. */
  digestLetzterZyklus: string;
  digestStabil: boolean;
  fehler: number;
}

export async function fuehreSoakAus(o: SoakOptionen): Promise<SoakErgebnis> {
  const archivName = o.archiv ?? 'flevel';
  const wechselZiel = o.wechsel ?? 500;
  const atlasGroesse = o.atlasGroesse ?? 512;
  const ticks = o.ticksJeWechsel ?? 30;
  const abtastungAlle = o.abtastungAlle ?? 50;

  const index = new IndexService();
  await index.openSource(o.quelle, { deep: false });
  const alle = index.listEntries(archivName).filter((e) => istFieldEintrag(e.name));
  const rotation = alle.slice(0, o.fieldsInRotation ?? Math.min(24, alle.length));
  if (rotation.length === 0) throw new Error(`Archiv "${archivName}" hat keine Field-Einträge`);

  // Rohbytes einmal vorladen: der Soak misst den Speicherlebenszyklus der
  // Parse-/Render-Kette, nicht die Dateisystemlatenz.
  const rohdaten = new Map<string, Uint8Array>();
  for (const e of rotation) rohdaten.set(e.canonicalId, await index.readEntry(e.canonicalId));

  const aufwaermWechsel = o.aufwaermWechsel ?? rotation.length;
  const vram = new VramBuchfuehrung();
  const kaltBasis = await heapProbe();
  let basis = kaltBasis;
  const vramBaseline = vram.bytes;

  const verlauf: SoakStichprobe[] = [];
  const dauern: number[] = [];
  let fehler = 0;
  let digestErster = '';
  let digestLetzter = '';
  let generation = 0;

  const zyklus = (index_: number): { id: string; name: string } => {
    const e = rotation[index_ % rotation.length]!;
    return { id: e.canonicalId, name: e.name };
  };

  // Letzter Durchlauf, der wieder auf dem ERSTEN Field der Rotation landet —
  // nur dort ist der Digestvergleich gegen den ersten Zyklus zulässig.
  const letzterErstdurchlauf = Math.floor((wechselZiel - 1) / rotation.length) * rotation.length;

  for (let i = 0; i < wechselZiel; i++) {
    generation++;
    const { id, name } = zyklus(i);
    const t0 = jetzt();
    const roh = rohdaten.get(id)!;
    let bundle: FieldBundle | undefined;
    try {
      const geparst = parseFieldContainer(decompressLzsEntry(roh), name);
      bundle = geparst.bundle;
    } catch {
      fehler++;
      continue;
    }
    if (!bundle) {
      fehler++;
      continue;
    }

    const sitzung = new FieldSession(bundle, { seed: 5, dialogMode: 'auto' });
    for (let t = 0; t < ticks; t++) sitzung.tick(NEUTRAL_INPUT);

    if (bundle.background) {
      const atlas = buildTileAtlas(bundle.background, bundle.palette, { atlasSize: atlasGroesse });
      atlas.atlases.forEach((_, k) =>
        vram.erwirb(`${name}#atlas${k}`, atlasBytes(1, atlasGroesse), generation),
      );
    }

    // Determinismusprobe auf dem ersten Field der Rotation.
    if (i === 0) digestErster = sitzung.digest();
    if (i === letzterErstdurchlauf) digestLetzter = sitzung.digest();

    // Generationswechsel: alles Fremde fällt weg (Registry-Vertrag 2.2).
    vram.gibFremdeGenerationenFrei(generation);
    dauern.push(jetzt() - t0);

    // Steady-State-Baseline nach der Aufwärmphase.
    if (i + 1 === aufwaermWechsel) basis = await heapProbe();

    if ((i + 1) % abtastungAlle === 0) {
      const probe = await heapProbe();
      verlauf.push({
        wechsel: i + 1,
        heapMB: probe.bytes / (1024 * 1024),
        vramBytes: vram.bytes,
        vramEintraege: vram.eintraege,
      });
    }
  }

  // Sitzungsende: auch die letzte Generation wird freigegeben.
  vram.gibGenerationFrei(generation);
  const ende = await heapProbe();

  return {
    wechsel: wechselZiel,
    fieldsInRotation: rotation.length,
    aufwaermWechsel,
    heapKaltBaselineMB: kaltBasis.bytes / (1024 * 1024),
    heapBaselineMB: basis.bytes / (1024 * 1024),
    heapEndeMB: ende.bytes / (1024 * 1024),
    heapAbweichungProzent: abweichungProzent(basis.bytes, ende.bytes),
    heapAbweichungKaltProzent: abweichungProzent(kaltBasis.bytes, ende.bytes),
    gcErzwungen: kaltBasis.gcErzwungen && ende.gcErzwungen,
    vramBaselineBytes: vramBaseline,
    vramEndeBytes: vram.bytes,
    vram: vram.stand(),
    verlauf,
    wechselMs: perzentile(dauern),
    digestErsterZyklus: digestErster,
    digestLetzterZyklus: digestLetzter,
    digestStabil: digestErster !== '' && digestErster === digestLetzter,
    fehler,
  };
}
