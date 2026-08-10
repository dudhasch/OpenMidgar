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
  itemNameLookup,
  parseKernelContainer,
  pickItemTextLists,
} from '@webmidgar/formats-kernel';
import { parseSceneBin, type SceneContainer } from '@webmidgar/formats-battle';
import { parseWorldMap, parseWorldEv, type WorldTerrain, type WorldEv } from '@webmidgar/formats-world';
import { parseOriginalSave, readSavemap, type Savemap } from '@webmidgar/formats-save';
import { openHttpSource, fetchRawFile } from './http-source';

/**
 * Datenlayer der integrierten Demo: bündelt alle Quellen (LGP-Archive über den
 * IndexService, Rohdateien über den Dev-HTTP-Endpunkt) hinter einer Fassade.
 * Der Boot lädt nur die kleinen Kataloge (maplist, kernel, scene.bin, WM0,
 * .ev, Spielstand); Fields und Modelle kommen lazy über die read*-Helfer.
 */

export interface GameData {
  index: IndexService;
  maplist: FieldMaplist | null;
  fieldNames: string[];
  scenes: SceneContainer | null;
  terrain: WorldTerrain | null;
  worldEv: WorldEv | null;
  savemap: Savemap | null;
  musicNames: string[];
  itemName: (id: number) => string | null;
  kernelSections: Uint8Array[] | null;
  readFieldEntry(name: string): Promise<Uint8Array | null>;
  readCharEntry(name: string): Promise<Uint8Array | null>;
  readBattleEntry(name: string): Promise<Uint8Array | null>;
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
  const worldGm = entryMap(index, 'world_gm');

  // maplist: der gemeinsame Namensraum aller Field-Wechsel (S11).
  let maplist: FieldMaplist | null = null;
  const maplistBytes = await readFrom(index, flevel, 'maplist');
  if (maplistBytes) maplist = parseMaplist(maplistBytes, 'flevel/maplist', []);

  const fieldNames = [...flevel.keys()].filter((n) => !n.includes('.')).sort((a, b) => a.localeCompare(b));

  // kernel: Gegenstandsnamen (Menü) + Rohsektionen (Growth etc. für später).
  let itemName: (id: number) => string | null = () => null;
  let kernelSections: Uint8Array[] | null = null;
  const kernelBytes = await fetchRawFile('data/kernel/KERNEL.BIN');
  if (kernelBytes) {
    const container = await parseKernelContainer(kernelBytes, 'kernel.bin');
    if (container) {
      kernelSections = container.sections.map((s: { data: Uint8Array }) => s.data);
      const listen = pickItemTextLists(indexKernelSections(container));
      itemName = itemNameLookup(listen.names);
    }
  }

  // scene.bin: alle Kampfszenen (lazy wäre möglich, aber 256 Szenen sind klein).
  let scenes: SceneContainer | null = null;
  const sceneBytes = await fetchRawFile('data/battle/scene.bin');
  if (sceneBytes) scenes = await parseSceneBin(sceneBytes, 'scene.bin');

  // Weltkarte: WM0-Terrain + Weltscript.
  let terrain: WorldTerrain | null = null;
  const wm0 = await fetchRawFile('data/wm/WM0.MAP');
  if (wm0) terrain = parseWorldMap(wm0);
  let worldEv: WorldEv | null = null;
  const evEntry = [...worldGm.keys()].find((n) => n.endsWith('.ev'));
  if (evEntry) {
    const evBytes = await readFrom(index, worldGm, evEntry);
    if (evBytes) {
      try {
        worldEv = parseWorldEv(evBytes);
      } catch {
        worldEv = null; // Script ist optional — die Weltkarte fährt auch ohne VM
      }
    }
  }

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
    savemap,
    musicNames,
    itemName,
    kernelSections,
    readFieldEntry: (name) => readFrom(index, flevel, name),
    readCharEntry: (name) => readFrom(index, char, name),
    readBattleEntry: (name) => readFrom(index, battle, name),
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
