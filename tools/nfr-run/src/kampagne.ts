/**
 * Die NFR-Messkampagne (S20). Ein Lauf, drei Umgebungen: Node gegen die
 * synthetische Fake-Installation, Node gegen die echte lokale Installation,
 * Browser gegen die Fake-Installation. Weil alle drei denselben Code
 * ausführen, sind die Zahlen untereinander vergleichbar.
 *
 * Etappen werden **einzeln** gemessen (IO, LZS, Container-Parse, Sitzung,
 * Ticks, Atlas), nicht nur als Summe. Das ist die Voraussetzung für die
 * ADR-010-Entscheidung: ohne Aufteilung ließe sich nicht sagen, ob eine
 * WASM-Beschleunigung von LZS und Texturkonvertierung überhaupt etwas
 * bewirken könnte.
 *
 * Zuordnung zur Architektur (ADR-002: alle Parser laufen in Workern):
 *  - Worker-Etappen: LZS, Container-Parse, Atlasaufbau
 *  - Hauptthread-Etappen: Sitzungsaufbau und Ticks (Zustand + Rendering)
 * Der Node-Lauf führt beides im selben Thread aus; die Trennung erfolgt über
 * die Buchführung, nicht über echte Threads. Deshalb ist der
 * Hauptthread-Wert aus Node eine **untere** Schranke und der Browserlauf mit
 * echtem Worker die belastbare Quelle für die Long-Task-Aussage.
 */

import { S0Store } from '@webmidgar/cache';
import { FieldSession, NEUTRAL_INPUT } from '@webmidgar/field-runtime';
import {
  decompressLzsEntry,
  parseFieldContainer,
  type FieldBundle,
} from '@webmidgar/formats-field';
import { IndexService, type DirectorySource } from '@webmidgar/io';
import { buildTileAtlas } from '@webmidgar/render-field';
import { Telemetry, startLagProbe } from '@webmidgar/telemetry';
import { abweichungProzent, heapProbe, jetzt, perzentile, type Perzentile } from './messhilfen.js';
import { VramBuchfuehrung, atlasBytes, type VramStand } from './vram-buchfuehrung.js';

export interface KampagneOptionen {
  quelle: DirectorySource;
  /** Archivname ohne Endung, z. B. 'flevel'. */
  archiv?: string;
  /** Kantenlänge der Atlanten; kleiner = schnellere Messung, gleiche Struktur. */
  atlasGroesse?: number;
  /** Höchstzahl der besuchten Fields (Standard: alle). */
  maxFields?: number;
  /** Takte je Sitzung für die Hauptthread-Messung. */
  ticksJeSitzung?: number;
  /** S0-Store; ein frischer Store erzwingt den kalten Pfad. */
  store?: S0Store;
  /** Zweiter Store für den Warmlauf (Standard: derselbe Store). */
  warmStore?: S0Store;
}

export interface EtappenPerzentile {
  io: Perzentile;
  lzs: Perzentile;
  parse: Perzentile;
  sitzung: Perzentile;
  ticks: Perzentile;
  atlas: Perzentile;
  wechselGesamt: Perzentile;
}

export interface KampagneErgebnis {
  fields: number;
  archive: number;
  eintraege: number;
  /** Erstimport inkl. Scan bis zum ersten fertigen Field. */
  ttffKaltMs: number;
  /** Zweitimport aus S0 + Cache bis zum ersten fertigen Field. */
  ttffWarmMs: number;
  scanKaltMs: number;
  scanWarmMs: number;
  etappen: EtappenPerzentile;
  /** Größte einzelne Etappe, die laut ADR-002 im Hauptthread bleibt. */
  hauptthreadEtappeMaxMs: number;
  /** Größte einzelne Etappe, die laut ADR-002 in einen Worker gehört. */
  workerEtappeMaxMs: number;
  /** Anteil LZS + Atlas an der gesamten Wechselarbeit (ADR-010-Lastprofil). */
  wasmKandidatAnteilProzent: number;
  longTasks: number;
  longTaskMaxMs: number;
  vram: VramStand;
  vramHoechststandMB: number;
  heapBaselineMB: number;
  heapEndeMB: number;
  heapAbweichungProzent: number;
  gcErzwungen: boolean;
  atlasSeiten: Perzentile;
  bundleFehler: number;
}

/**
 * Field-Einträge eines `flevel`-Archivs: kein Punkt im Namen (Fields tragen
 * keine Endung) und nicht die Verzeichnisdatei `maplist`. Ohne die zweite
 * Bedingung landete die maplist im Wechselpfad und erzeugte einen
 * E-LZS-STREAM-Fehler je Runde — eine Fehlerquote, die wie ein Parserproblem
 * aussieht und keines ist.
 */
export function istFieldEintrag(name: string): boolean {
  return !name.includes('.') && name.toLowerCase() !== 'maplist';
}

/**
 * Baut aus einem geparsten Bundle die Renderdaten auf und bucht sie in der
 * VRAM-Buchführung — genau die Arbeit, die ein Field-Wechsel leisten muss.
 */
function baueAtlas(
  bundle: FieldBundle,
  atlasGroesse: number,
  vram: VramBuchfuehrung,
  generation: number,
): { ms: number; seiten: number } {
  if (!bundle.background) return { ms: 0, seiten: 0 };
  const t0 = jetzt();
  const atlas = buildTileAtlas(bundle.background, bundle.palette, { atlasSize: atlasGroesse });
  const ms = jetzt() - t0;
  atlas.atlases.forEach((_, i) => {
    vram.erwirb(`${bundle.fieldId}#atlas${i}`, atlasBytes(1, atlasGroesse), generation);
  });
  return { ms, seiten: atlas.atlases.length };
}

export async function fuehreKampagneAus(o: KampagneOptionen): Promise<KampagneErgebnis> {
  const archivName = o.archiv ?? 'flevel';
  const atlasGroesse = o.atlasGroesse ?? 512;
  const ticks = o.ticksJeSitzung ?? 60;

  const telemetrie = new Telemetry();
  const stopLag = startLagProbe(telemetrie, { intervalMs: 20, thresholdMs: 50 });
  const vram = new VramBuchfuehrung();

  const basis = await heapProbe();

  // --- Kaltlauf: frischer Index, frischer Store -----------------------------
  const kaltStore = o.store ?? new S0Store();
  const kaltIndex = new IndexService(kaltStore);
  const tKalt = jetzt();
  const kaltErgebnis = await kaltIndex.openSource(o.quelle, { deep: false });
  const scanKaltMs = jetzt() - tKalt;

  const alleEintraege = kaltIndex.listEntries(archivName).filter((e) => istFieldEintrag(e.name));
  const fieldNamen = o.maxFields ? alleEintraege.slice(0, o.maxFields) : alleEintraege;
  const erstes = fieldNamen[0];
  if (!erstes) throw new Error(`Archiv "${archivName}" enthält keine Field-Einträge`);

  // Time-to-First-Field kalt = Scan + erstes Field vollständig aufgebaut.
  const rohErstes = await kaltIndex.readEntry(erstes.canonicalId);
  const entpacktErstes = decompressLzsEntry(rohErstes);
  const geparstErstes = parseFieldContainer(entpacktErstes, erstes.name);
  if (geparstErstes.bundle) {
    new FieldSession(geparstErstes.bundle, { seed: 1 });
    baueAtlas(geparstErstes.bundle, atlasGroesse, vram, 0);
  }
  const ttffKaltMs = jetzt() - tKalt;
  vram.gibFremdeGenerationenFrei(-1); // Generation 0 abräumen, sauberer Start

  // --- Warmlauf: S0-Treffer + gecachtes Bundle ------------------------------
  const warmIndex = new IndexService(o.warmStore ?? kaltStore);
  const tWarm = jetzt();
  await warmIndex.openSource(o.quelle, { deep: false });
  const scanWarmMs = jetzt() - tWarm;
  const warmEintrag = warmIndex.listEntries(archivName).find((e) => e.name === erstes.name)!;
  const rohWarm = await warmIndex.readEntry(warmEintrag.canonicalId);
  const warmBundle = parseFieldContainer(decompressLzsEntry(rohWarm), warmEintrag.name);
  if (warmBundle.bundle) {
    new FieldSession(warmBundle.bundle, { seed: 1 });
    baueAtlas(warmBundle.bundle, atlasGroesse, vram, 1);
  }
  const ttffWarmMs = jetzt() - tWarm;
  vram.gibFremdeGenerationenFrei(-1);

  // --- Warme Field-Wechsel --------------------------------------------------
  const ioMs: number[] = [];
  const lzsMs: number[] = [];
  const parseMs: number[] = [];
  const sitzungMs: number[] = [];
  const tickMs: number[] = [];
  const atlasMsWerte: number[] = [];
  const wechselMs: number[] = [];
  const seitenWerte: number[] = [];
  let bundleFehler = 0;
  let generation = 10;

  for (const eintrag of fieldNamen) {
    generation++;
    const tWechsel = jetzt();

    const t1 = jetzt();
    const roh = await warmIndex.readEntry(eintrag.canonicalId);
    ioMs.push(jetzt() - t1);

    const t2 = jetzt();
    let entpackt: Uint8Array;
    try {
      entpackt = decompressLzsEntry(roh);
    } catch {
      bundleFehler++;
      continue;
    }
    lzsMs.push(jetzt() - t2);

    const t3 = jetzt();
    const geparst = parseFieldContainer(entpackt, eintrag.name);
    parseMs.push(jetzt() - t3);
    if (!geparst.ok || !geparst.bundle) {
      bundleFehler++;
      continue;
    }

    const t4 = jetzt();
    const sitzung = new FieldSession(geparst.bundle, { seed: 3, dialogMode: 'auto' });
    sitzungMs.push(jetzt() - t4);

    const t5 = jetzt();
    for (let t = 0; t < ticks; t++) sitzung.tick(NEUTRAL_INPUT);
    tickMs.push(jetzt() - t5);

    const atlas = baueAtlas(geparst.bundle, atlasGroesse, vram, generation);
    if (atlas.seiten > 0) {
      atlasMsWerte.push(atlas.ms);
      seitenWerte.push(atlas.seiten);
    }

    wechselMs.push(jetzt() - tWechsel);
    // Wie beim echten Wechsel: die Vorgängergeneration wird freigegeben.
    vram.gibFremdeGenerationenFrei(generation);
  }

  // Nach dem letzten Wechsel gibt die Runtime auch die aktuelle Generation frei.
  vram.gibGenerationFrei(generation);

  stopLag();
  const ende = await heapProbe();

  const etappen: EtappenPerzentile = {
    io: perzentile(ioMs),
    lzs: perzentile(lzsMs),
    parse: perzentile(parseMs),
    sitzung: perzentile(sitzungMs),
    ticks: perzentile(tickMs),
    atlas: perzentile(atlasMsWerte),
    wechselGesamt: perzentile(wechselMs),
  };

  const arbeitGesamt =
    etappen.lzs.summeMs + etappen.parse.summeMs + etappen.sitzung.summeMs + etappen.ticks.summeMs + etappen.atlas.summeMs;
  const wasmKandidat = etappen.lzs.summeMs + etappen.atlas.summeMs;

  const telemetrieStand = telemetrie.snapshot();
  const vramStand = vram.stand();

  return {
    fields: fieldNamen.length,
    archive: kaltErgebnis.archives.length,
    eintraege: alleEintraege.length,
    ttffKaltMs,
    ttffWarmMs,
    scanKaltMs,
    scanWarmMs,
    etappen,
    hauptthreadEtappeMaxMs: Math.max(etappen.sitzung.max, etappen.ticks.max),
    workerEtappeMaxMs: Math.max(etappen.lzs.max, etappen.parse.max, etappen.atlas.max),
    wasmKandidatAnteilProzent: arbeitGesamt > 0 ? (wasmKandidat / arbeitGesamt) * 100 : 0,
    longTasks: telemetrieStand.longTasks.count,
    longTaskMaxMs: telemetrieStand.longTasks.maxMs,
    vram: vramStand,
    vramHoechststandMB: vramStand.hoechststandBytes / (1024 * 1024),
    heapBaselineMB: basis.bytes / (1024 * 1024),
    heapEndeMB: ende.bytes / (1024 * 1024),
    heapAbweichungProzent: abweichungProzent(basis.bytes, ende.bytes),
    gcErzwungen: basis.gcErzwungen && ende.gcErzwungen,
    atlasSeiten: perzentile(seitenWerte),
    bundleFehler,
  };
}
