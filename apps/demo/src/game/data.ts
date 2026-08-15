import { IndexService } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import {
  parseFieldEntry,
  parseMaplist,
  resolveMaplistTarget,
  type FieldBundle,
  type FieldMaplist,
} from '@webmidgar/formats-field';
import {
  indexKernelSections,
  inventoryDescriptionLookup,
  inventoryNameLookup,
  listNameLookup,
  parseKernelContainer,
  readMateriaRecords,
  resolveKernelDataSections,
  resolveKernelNameLists,
  parseWindowBin,
  type InventoryNameLookup,
  type MateriaRecord,
  type WindowBin,
} from '@webmidgar/formats-kernel';
import { dialogMetrics, type DialogMetricsResult } from '@webmidgar/dialog';
import { parseSceneBin, type SceneContainer } from '@webmidgar/formats-battle';
import { parseTex, texToRgba } from '@webmidgar/formats-model';
import {
  parseFieldTbl,
  parseWorldAnimatedTextures,
  parseWorldMap,
  parseWorldEv,
  parseWorldTextureNames,
  type FieldTable,
  type WorldAnimatedTexture,
  type WorldTerrain,
  type WorldEv,
} from '@webmidgar/formats-world';
import {
  buildWorldTextureSet,
  type StaticTextureImage,
  type WorldTextureSet,
} from '@webmidgar/render-world';
import { parseOriginalSave, readSavemap, type Savemap } from '@webmidgar/formats-save';
import { openHttpSource, fetchRawFile } from './http-source';

/**
 * Datenlayer der integrierten Demo: bündelt alle Quellen (LGP-Archive über den
 * IndexService, Rohdateien über den Dev-HTTP-Endpunkt) hinter einer Fassade.
 * Der Boot lädt nur die kleinen Kataloge (maplist, kernel, scene.bin, WM0,
 * .ev, Spielstand); Fields und Modelle kommen lazy über die read*-Helfer.
 */

/**
 * Welche Weltkarte geladen ist — Terrain UND Script **gemeinsam gewählt** (W1).
 *
 * 🔵 Der frühere Griff `[...worldGm.keys()].find((n) => n.endsWith('.ev'))` nahm
 * den ERSTEN `.ev`-Eintrag in TOC-Reihenfolge. In `world_*.lgp` liegt `wm2.ev`
 * (Unterwasserkarte, 1 Mesh-Funktion) VOR `wm0.ev` (49 Mesh-Funktionen) — die
 * Demo fuhr also das Unterwasser-Script zum WM0-Terrain. Deshalb wird der
 * Eintrag jetzt exakt benannt und mit seiner Kartendatei zusammen geführt.
 */
export interface WorldMapChoice {
  id: 'wm0' | 'wm2' | 'wm3';
  /** Rohdateipfad der Karte, so wie `fetchRawFile` ihn erwartet. */
  mapFile: string;
  /** Eintragsname im LGP-Archiv — exakt, nicht gesucht. */
  evName: string;
  /** Archiv, aus dem das Script tatsächlich kam (`null` = keins gefunden). */
  evArchive: string | null;
  /** Zahl der Mesh-Funktionen des geladenen Scripts (wm0 erwartet: 49). */
  meshFunctions: number;
}

export interface GameData {
  index: IndexService;
  maplist: FieldMaplist | null;
  fieldNames: string[];
  scenes: SceneContainer | null;
  terrain: WorldTerrain | null;
  worldEv: WorldEv | null;
  /** Welche Karte/Script-Paarung geladen wurde (W1). */
  worldChoice: WorldMapChoice;
  /** `field.tbl` aus `world_us.lgp` — World↔Field-Einstiegspunkte (F06). */
  fieldTable: FieldTable | null;
  savemap: Savemap | null;
  /**
   * Rohbytes desselben Slots (4340 B) — **die Wahrheit**, aus der `savemap`
   * gelesen wurde.
   *
   * Sie werden seit Welle 4 mitgeführt, weil das Menü sie verändert (F07):
   * Ausrüsten schreibt in diese Bytes, und `readSavemap` deutet sie danach neu.
   * Ohne sie gäbe es nur die gedeutete Fassung, und ein Schreibweg über das
   * gedeutete Objekt hätte zwei Quellen erzeugt, die auseinanderlaufen können.
   */
  savemapRaw: Uint8Array | null;
  /**
   * Fingerprint der Quellinstallation. Ein Spielstand gehört zu seinen Daten;
   * beim Laden warnt `acceptSlot`, wenn er von woanders stammt.
   */
  sourceFingerprint: string;
  musicNames: string[];
  /**
   * Bereichskodierte Inventarnamen (F18): 0–127 Gegenstände · 128–255 Waffen ·
   * 256–287 Rüstungen · 288–319 Accessoires. MUSS aus `inventoryNameLookup`
   * stammen — eine einlistige Auswahl traf früher die Zauberliste.
   */
  itemName: InventoryNameLookup;
  /**
   * Beschreibungstext zu einer Inventarkennung (F24-B). Gleiche
   * Bereichskodierung wie `itemName` — beide kommen aus derselben Auflösung.
   */
  itemDescription: InventoryNameLookup;
  /** Materianamen (Kennung = Listenindex). */
  materiaName: InventoryNameLookup;
  /** Zaubernamen (Kennung = Listenindex). */
  magicName: InventoryNameLookup;
  /** Materia-Recordtabelle aus KERNEL.BIN — Stufe und (🔴) Zauberzuordnung. */
  materiaRecords: readonly MateriaRecord[];
  /** Warum die Namenszuordnung (nicht) ging — sonst verdeckt sie sich selbst. */
  kernelHinweis: string;
  kernelSections: Uint8Array[] | null;
  /**
   * Textmetrik aus `WINDOW.BIN` (Welle 2). `measured: false` heißt: die Datei
   * fehlte, es gilt die Ersatzmetrik — und `diagnostic` sagt warum. Ein
   * stiller Rückfall ist hier ausdrücklich nicht vorgesehen.
   */
  textMetrik: DialogMetricsResult;
  /** Rohbefund der `WINDOW.BIN` — null, wenn die Datei fehlt. */
  windowBin: WindowBin | null;
  windowHinweis: string;
  /**
   * F11b/F25: Texturtabelle **und** Atlas der Weltkarte in EINEM Objekt
   * (`buildWorldTextureSet`). `null` heißt: `ff7.exe` war nicht erreichbar oder
   * trug kein auffindbares Zeigerfeld — dann bleibt die Weltkarte bei der
   * Klassenfarben-Diagnose, statt eine Zuordnung zu erfinden.
   */
  worldTextures: WorldTextureSet | null;
  /** Warum die Welttexturen (nicht) verfügbar sind — gehört in den Bootlog. */
  worldTexturHinweis: string;
  readFieldEntry(name: string): Promise<Uint8Array | null>;
  readCharEntry(name: string): Promise<Uint8Array | null>;
  readBattleEntry(name: string): Promise<Uint8Array | null>;
  /** Alle Einträge eines battle.lgp-Präfixes (erfüllt `BattleEntrySource`). */
  listBattleEntries(prefix: string): string[];
  /**
   * Alle 2-Zeichen-Präfixe von battle.lgp, sortiert. K5 schneidet daraus über
   * den Namensbereich `og`…`rr` selbst das Bühnenband heraus — deshalb wird
   * hier NICHT vorgefiltert.
   */
  listBattlePrefixes(): string[];
  loadFieldBundle(name: string): Promise<{ bundle: FieldBundle | null; codes: string[] }>;
  fieldNameByMaplist(index: number): string | null;
}

function entryMap(index: IndexService, archive: string): Map<string, LgpEntry> {
  const map = new Map<string, LgpEntry>();
  for (const e of index.listEntries(archive)) map.set(e.name.toLowerCase(), e);
  return map;
}

async function readFrom(
  index: IndexService,
  map: Map<string, LgpEntry>,
  name: string,
): Promise<Uint8Array | null> {
  const entry = map.get(name.toLowerCase());
  if (!entry) return null;
  try {
    return await index.readEntry(entry.canonicalId);
  } catch {
    return null; // Quarantäne/Lesefehler ⇒ Aufrufer entscheidet über Ersatz
  }
}

export async function bootGameData(status: (msg: string) => void): Promise<GameData | null> {
  status('Öffne Dev-Datenquelle (/ff7data) …');
  const source = await openHttpSource();
  if (!source) {
    status('Dev-Datenquelle nicht verfügbar — FF7_DATA_DIR bzw. ff7data.local.json fehlt.');
    return null;
  }

  const index = new IndexService();
  status('Indexiere LGP-Archive (Fast Scan) …');
  const result = await index.openSource(source, { deep: false });
  const namen = result.archives.map((a) => `${a.archiveName}(${a.resolvable})`).join(', ');
  status(`Archive: ${namen}`);

  const flevel = entryMap(index, 'flevel');
  const char = entryMap(index, 'char');
  const battle = entryMap(index, 'battle');

  /**
   * Battle-Präfixindex (K1/K2): `loadBattleModel` klassifiziert die Einträge
   * eines Präfixes über ihre Inhaltssignatur — dafür braucht es den echten
   * Namensraum statt eines abgetasteten Suffixfensters. Einmal beim Boot
   * gebaut; die Map trägt bereits alle Namen kleingeschrieben.
   */
  const battlePraefixe = new Map<string, string[]>();
  for (const name of battle.keys()) {
    if (name.length !== 4) continue; // Modelldateien sind 2 B Präfix + 2 B Suffix
    const p = name.slice(0, 2);
    let liste = battlePraefixe.get(p);
    if (!liste) {
      liste = [];
      battlePraefixe.set(p, liste);
    }
    liste.push(name);
  }

  // maplist: der gemeinsame Namensraum aller Field-Wechsel (S11).
  let maplist: FieldMaplist | null = null;
  const maplistBytes = await readFrom(index, flevel, 'maplist');
  if (maplistBytes) maplist = parseMaplist(maplistBytes, 'flevel/maplist', []);

  const fieldNames = [...flevel.keys()].filter((n) => !n.includes('.')).sort((a, b) => a.localeCompare(b));

  // kernel: Inventarnamen (Menü) + Rohsektionen (Growth etc. für später).
  // F18: Die Rollenbestimmung löst alle vier Bereiche auf, nicht eine Liste.
  let itemName: InventoryNameLookup = () => null;
  let itemDescription: InventoryNameLookup = () => null;
  let materiaName: InventoryNameLookup = () => null;
  let magicName: InventoryNameLookup = () => null;
  let materiaRecords: readonly MateriaRecord[] = [];
  let kernelHinweis = 'ohne KERNEL.BIN — Inventarnamen bleiben leer';
  let kernelSections: Uint8Array[] | null = null;
  const kernelBytes = await fetchRawFile('data/kernel/KERNEL.BIN');
  if (kernelBytes) {
    const container = await parseKernelContainer(kernelBytes, 'kernel.bin');
    if (container) {
      kernelSections = container.sections.map((s: { data: Uint8Array }) => s.data);
      const listen = resolveKernelNameLists(indexKernelSections(container));
      itemName = inventoryNameLookup(listen);
      // F24-B: Beschreibungen und die beiden Zusatzlisten kommen aus DERSELBEN
      // Auflösung — eine zweite Zuordnungslogik wäre genau der Fehler von F18.
      itemDescription = inventoryDescriptionLookup(listen);
      materiaName = listNameLookup(listen.materia);
      magicName = listNameLookup(listen.magic);
      try {
        materiaRecords = readMateriaRecords(container, resolveKernelDataSections(container));
      } catch {
        materiaRecords = []; // Datensektionen nicht auflösbar ⇒ Materiaansicht sagt es selbst
      }
      // Der Grund MUSS sichtbar sein: eine stillschweigend leere Zuordnung hat
      // F18 so lange verdeckt (das Menü zeigte einfach Zaubernamen).
      kernelHinweis =
        listen.reason === null
          ? `Namen aus den Sektionen ${listen.items!.sectionIndex}/${listen.weapons!.sectionIndex}/${listen.armor!.sectionIndex}/${listen.accessories!.sectionIndex} (Gegenstände/Waffen/Rüstungen/Accessoires)`
          : `Namenslisten nicht zuordenbar: ${listen.reason}`;
    } else {
      kernelHinweis = 'KERNEL.BIN nicht lesbar';
    }
    status(kernelHinweis);
  }

  // WINDOW.BIN: Glyphenbreiten für die Fenstermetrik (Welle 2). Ohne sie
  // bemisst der Dialog seine Fenster mit einer erfundenen Breite — genau das
  // war bis Welle 1 der Zustand, und es fiel nicht auf, weil niemand es sagte.
  let windowBin: WindowBin | null = null;
  const windowBytes = await fetchRawFile('data/kernel/WINDOW.BIN');
  if (windowBytes) windowBin = await parseWindowBin(windowBytes, 'WINDOW.BIN');
  const textMetrik = dialogMetrics(windowBin);
  const windowHinweis = textMetrik.measured
    ? `Glyphenbreiten aus WINDOW.BIN (Polsterung ${textMetrik.spacing.padding} px, Namensplatzhalter ${textMetrik.spacing.widths[0xea]} px)`
    : (textMetrik.diagnostic ?? 'Textmetrik unbekannt');
  status(windowHinweis);

  // scene.bin: alle Kampfszenen (lazy wäre möglich, aber 256 Szenen sind klein).
  let scenes: SceneContainer | null = null;
  const sceneBytes = await fetchRawFile('data/battle/scene.bin');
  if (sceneBytes) scenes = await parseSceneBin(sceneBytes, 'scene.bin');

  // Weltkarte (W1): Terrain UND Script als EIN Paar. Der Eintrag wird exakt
  // benannt; ein „erster .ev-Eintrag" ist TOC-Reihenfolge und damit wm2.
  const worldChoice: WorldMapChoice = {
    id: 'wm0',
    mapFile: 'data/wm/WM0.MAP',
    evName: 'wm0.ev',
    evArchive: null,
    meshFunctions: 0,
  };
  let terrain: WorldTerrain | null = null;
  const mapBytes = await fetchRawFile(worldChoice.mapFile);
  if (mapBytes) terrain = parseWorldMap(mapBytes);

  // Die Sprachvariante des Archivs ist für das Script gleichgültig — genommen
  // wird die erste, die den EXAKT benannten Eintrag führt.
  const worldArchives = ['world_us', 'world_gm', 'world_fr', 'world_sp'] as const;
  let worldEv: WorldEv | null = null;
  let fieldTable: FieldTable | null = null;
  for (const archiv of worldArchives) {
    const eintraege = entryMap(index, archiv);
    if (eintraege.size === 0) continue;
    if (!worldEv && eintraege.has(worldChoice.evName)) {
      const evBytes = await readFrom(index, eintraege, worldChoice.evName);
      if (evBytes) {
        try {
          worldEv = parseWorldEv(evBytes);
          worldChoice.evArchive = archiv;
          worldChoice.meshFunctions = worldEv.functions.filter((f) => f.type === 'mesh').length;
        } catch {
          worldEv = null; // Script ist optional — die Weltkarte fährt auch ohne VM
        }
      }
    }
    // field.tbl (F06): World↔Field-Einstiegspunkte, Ziel des Opcodes 0x318.
    if (!fieldTable && eintraege.has('field.tbl')) {
      const tblBytes = await readFrom(index, eintraege, 'field.tbl');
      if (tblBytes) {
        const parsed = parseFieldTbl(tblBytes);
        for (const d of parsed.diagnostics) status(`${d.code}: ${d.message}`);
        fieldTable = parsed;
      }
    }
  }
  status(
    worldEv
      ? `Weltscript ${worldChoice.evName} aus ${worldChoice.evArchive} (${worldChoice.meshFunctions} Mesh-Funktionen)`
      : `Weltscript ${worldChoice.evName} nicht gefunden — Weltkarte fährt ohne VM`,
  );

  /**
   * F11b + F25 — Welttexturen.
   *
   * Vier Quellen, ein Aufruf: die Zeigertabelle aus der Spiel-EXE (die
   * Zuordnung `textureId` → Dateiname), die `.tex`-Bilder aus `world_us.lgp`,
   * die animierten Texturen aus `wm.ta` und die UV-Spannweiten des Terrains.
   * Fehlt EINE davon, wird nichts geraten — dann bleibt die Weltkarte bei der
   * Klassenfarben-Diagnose und sagt im Bootlog, warum.
   */
  let worldTextures: WorldTextureSet | null = null;
  let worldTexturHinweis = 'Weltkarten-Texturen nicht verfügbar — Klassenfarben-Diagnose';
  if (terrain) {
    const exeBytes = (await fetchRawFile('ff7.exe')) ?? (await fetchRawFile('ff7_en.exe'));
    const nameTable = exeBytes ? parseWorldTextureNames(exeBytes) : null;
    if (!exeBytes) {
      worldTexturHinweis =
        'ff7.exe nicht erreichbar (ff7data-Freigabe/Installation) — Weltkarte ohne Texturen';
    } else if (!nameTable) {
      worldTexturHinweis = 'ff7.exe gelesen, aber kein Texturzeigerfeld gefunden — Weltkarte ohne Texturen';
    } else {
      // Bilder und Animationstabelle liegen im selben Archiv wie das Terrain-
      // Zubehör; genommen wird das erste, das `wm.ta` führt.
      const staticImages = new Map<string, StaticTextureImage>();
      let animated: WorldAnimatedTexture[] = [];
      let texturArchiv: string | null = null;
      for (const archiv of worldArchives) {
        const eintraege = entryMap(index, archiv);
        if (!eintraege.has('wm.ta')) continue;
        texturArchiv = archiv;
        const taBytes = await readFrom(index, eintraege, 'wm.ta');
        if (taBytes) animated = parseWorldAnimatedTextures(taBytes).textures;
        for (const [name] of eintraege) {
          if (!name.endsWith('.tex')) continue;
          const bytes = await readFrom(index, eintraege, name);
          if (!bytes) continue;
          const tex = parseTex(bytes, `${archiv}/${name}`).value;
          if (!tex) continue;
          staticImages.set(name.slice(0, -4), {
            name: name.slice(0, -4),
            width: tex.width,
            height: tex.height,
            rgba: texToRgba(tex),
          });
        }
        break;
      }
      if (staticImages.size === 0) {
        worldTexturHinweis = 'keine .tex-Einträge in world_*.lgp gefunden — Weltkarte ohne Texturen';
      } else {
        worldTextures = buildWorldTextureSet({
          terrain,
          nameTable,
          base: nameTable.bases.wm0,
          staticImages,
          animated,
        });
        const r = worldTextures.report;
        worldTexturHinweis =
          `Welttexturen aus ${texturArchiv}: ${r.named}/${r.usedIds} IDs benannt, ` +
          `${r.animatedIds} animiert (🟡 Ersatzpalette, ${Math.round(r.substitutePaletteTriangleShare * 1000) / 10} % der Dreiecke), ` +
          `${r.atlasPages} Atlasseite(n), ${r.misfits.length} Fehlpassungen`;
      }
    }
  }
  status(worldTexturHinweis);

  // Musikindex (S37/O2): Zeilenindex 0-basiert, musicId der Scripts 1-basiert.
  let musicNames: string[] = [];
  const idxBytes = await fetchRawFile('data/music/music.idx');
  if (idxBytes) {
    musicNames = new TextDecoder('latin1')
      .decode(idxBytes)
      .split(/\r?\n/)
      .map((l) => l.trim());
  }

  // Spielstand: erster belegter Slot der ersten vorhandenen Save-Datei.
  let savemap: Savemap | null = null;
  let savemapRaw: Uint8Array | null = null;
  for (const file of ['save/save00.ff7', 'save/save01.ff7']) {
    const bytes = await fetchRawFile(file);
    if (!bytes) continue;
    const parsed = parseOriginalSave(bytes, file);
    const slot = parsed?.slots.find((s) => s.occupied);
    if (slot) {
      savemap = readSavemap(slot.raw);
      // Eigene Kopie: Der Wirt schreibt hinein, und die Bytes des geladenen
      // Dateipuffers gehören ihm nicht.
      if (savemap) {
        savemapRaw = slot.raw.slice();
        break;
      }
    }
  }

  const data: GameData = {
    index,
    maplist,
    fieldNames,
    scenes,
    terrain,
    worldEv,
    worldChoice,
    fieldTable,
    savemap,
    savemapRaw,
    sourceFingerprint: result.sourceFingerprint,
    musicNames,
    itemName,
    itemDescription,
    materiaName,
    magicName,
    materiaRecords,
    kernelHinweis,
    kernelSections,
    textMetrik,
    windowBin,
    windowHinweis,
    worldTextures,
    worldTexturHinweis,
    readFieldEntry: (name) => readFrom(index, flevel, name),
    readCharEntry: (name) => readFrom(index, char, name),
    readBattleEntry: (name) => readFrom(index, battle, name),
    listBattleEntries: (prefix) => battlePraefixe.get(prefix.toLowerCase()) ?? [],
    listBattlePrefixes: () => [...battlePraefixe.keys()].sort(),
    loadFieldBundle: async (name) => {
      const bytes = await readFrom(index, flevel, name);
      if (!bytes) return { bundle: null, codes: ['E-GAME-ENTRY-FEHLT'] };
      const parsed = parseFieldEntry(bytes, name);
      return {
        bundle: parsed.ok && parsed.bundle ? parsed.bundle : null,
        codes: parsed.diagnostics.map((d: { code: string }) => d.code),
      };
    },
    fieldNameByMaplist: (i) => (maplist ? resolveMaplistTarget(maplist, i) : null),
  };
  return data;
}
