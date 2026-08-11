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
  inventoryNameLookup,
  parseKernelContainer,
  resolveKernelNameLists,
  type InventoryNameLookup,
} from '@webmidgar/formats-kernel';
import { parseSceneBin, type SceneContainer } from '@webmidgar/formats-battle';
import {
  parseFieldTbl,
  parseWorldMap,
  parseWorldEv,
  type FieldTable,
  type WorldTerrain,
  type WorldEv,
} from '@webmidgar/formats-world';
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
  musicNames: string[];
  /**
   * Bereichskodierte Inventarnamen (F18): 0–127 Gegenstände · 128–255 Waffen ·
   * 256–287 Rüstungen · 288–319 Accessoires. MUSS aus `inventoryNameLookup`
   * stammen — eine einlistige Auswahl traf früher die Zauberliste.
   */
  itemName: InventoryNameLookup;
  /** Warum die Namenszuordnung (nicht) ging — sonst verdeckt sie sich selbst. */
  kernelHinweis: string;
  kernelSections: Uint8Array[] | null;
  readFieldEntry(name: string): Promise<Uint8Array | null>;
  readCharEntry(name: string): Promise<Uint8Array | null>;
  readBattleEntry(name: string): Promise<Uint8Array | null>;
  /** Alle Einträge eines battle.lgp-Präfixes (erfüllt `BattleEntrySource`). */
  listBattleEntries(prefix: string): string[];
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
  let kernelHinweis = 'ohne KERNEL.BIN — Inventarnamen bleiben leer';
  let kernelSections: Uint8Array[] | null = null;
  const kernelBytes = await fetchRawFile('data/kernel/KERNEL.BIN');
  if (kernelBytes) {
    const container = await parseKernelContainer(kernelBytes, 'kernel.bin');
    if (container) {
      kernelSections = container.sections.map((s: { data: Uint8Array }) => s.data);
      const listen = resolveKernelNameLists(indexKernelSections(container));
      itemName = inventoryNameLookup(listen);
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
  for (const file of ['save/save00.ff7', 'save/save01.ff7']) {
    const bytes = await fetchRawFile(file);
    if (!bytes) continue;
    const parsed = parseOriginalSave(bytes, file);
    const slot = parsed?.slots.find((s) => s.occupied);
    if (slot) {
      savemap = readSavemap(slot.raw);
      if (savemap) break;
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
    musicNames,
    itemName,
    kernelHinweis,
    kernelSections,
    readFieldEntry: (name) => readFrom(index, flevel, name),
    readCharEntry: (name) => readFrom(index, char, name),
    readBattleEntry: (name) => readFrom(index, battle, name),
    listBattleEntries: (prefix) => battlePraefixe.get(prefix.toLowerCase()) ?? [],
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
