import { bdiag, type BattleDiagnostic } from './diagnostics.js';
import {
  ATTACK_RECORD_LEN,
  ATTACKS_PER_SCENE,
  CAMERA_RECORD_LEN,
  ENEMY_RECORD_LEN,
  ENEMY_SLOTS_PER_FORMATION,
  ENEMY_TYPES_PER_SCENE,
  FORMATION_SLOT_LEN,
  FORMATIONS_PER_SCENE,
  SCENE_BLOCK_BYTES,
  SCENE_DECOMPRESSED_LEN,
  SCENE_OFF,
  SCENE_PTRS_PER_BLOCK,
  SETUP_RECORD_LEN,
  type AttackRecord,
  type BattleFormation,
  type BattleScene,
  type EnemyRecord,
  type FormationSlot,
} from './types.js';

/**
 * scene.bin — Parser (S30).
 *
 * Containergrammatik (✅ 256/256 byteexakt, Kontrolle „Zeiger als
 * Byte-Offsets" 0/256): Blöcke à 0x2000, je Block 16 u32-Zeiger in
 * 4-Byte-Einheiten (0xFFFFFFFF = leer) auf gzip-Ströme, Füllung dahinter
 * ausnahmslos 0xFF (23.884 Füllbytes im Bestand, kein einziges anderes).
 *
 * **Dekodierstrategie (browsertauglich):** Die Ströme tragen Nachlauf-Füllung
 * bis zum nächsten Zeiger; ein strikter gzip-Dekoder lehnt das ab. Da die
 * Füllung ausnahmslos 0xFF ist und ein gzip-Strom mit ISIZE endet (dessen
 * höchstes Byte bei unseren Größen nie 0xFF ist), liefert das Abstreifen des
 * 0xFF-Laufs am Chunk-Ende EXAKT den Strom — der dann mit
 * `DecompressionStream('gzip')` inklusive CRC-Prüfung dekodiert (256/256).
 */

async function gunzipExact(chunk: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(chunk.length);
  owned.set(chunk);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value as Uint8Array;
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface SceneContainer {
  schemaVersion: 1;
  /** Index = Szenennummer (Kampf-ID >> 2). Quarantänisierte Szenen: null. */
  scenes: (BattleScene | null)[];
  diagnostics: BattleDiagnostic[];
}

export async function parseSceneBin(bytes: Uint8Array, asset: string): Promise<SceneContainer> {
  const diagnostics: BattleDiagnostic[] = [];
  const scenes: (BattleScene | null)[] = [];
  if (bytes.length === 0 || bytes.length % SCENE_BLOCK_BYTES !== 0) {
    diagnostics.push(bdiag('E-BTL-CONTAINER', asset, `Dateigröße ${bytes.length} ist kein Vielfaches von 0x2000`));
    return { schemaVersion: 1, scenes, diagnostics };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let b = 0; b < bytes.length / SCENE_BLOCK_BYTES; b++) {
    const base = b * SCENE_BLOCK_BYTES;
    const ptrs: number[] = [];
    let tableOk = true;
    for (let i = 0; i < SCENE_PTRS_PER_BLOCK; i++) {
      const v = view.getUint32(base + i * 4, true);
      if (v === 0xffffffff) continue;
      const off = v * 4;
      if (off < SCENE_PTRS_PER_BLOCK * 4 || off >= SCENE_BLOCK_BYTES) {
        diagnostics.push(bdiag('E-BTL-CONTAINER', asset, `Block ${b}: Zeiger ${i} außerhalb (${off})`, b));
        tableOk = false;
        break;
      }
      if (ptrs.length > 0 && off <= ptrs[ptrs.length - 1]!) {
        diagnostics.push(bdiag('E-BTL-CONTAINER', asset, `Block ${b}: Zeiger ${i} nicht monoton`, b));
        tableOk = false;
        break;
      }
      ptrs.push(off);
    }
    if (!tableOk) continue;
    for (let i = 0; i < ptrs.length; i++) {
      const start = base + ptrs[i]!;
      const end = i + 1 < ptrs.length ? base + ptrs[i + 1]! : base + SCENE_BLOCK_BYTES;
      let streamEnd = end;
      while (streamEnd > start && bytes[streamEnd - 1] === 0xff) streamEnd--;
      const sceneIndex = scenes.length;
      let decompressed: Uint8Array;
      try {
        decompressed = await gunzipExact(bytes.subarray(start, streamEnd));
      } catch (err) {
        diagnostics.push(bdiag('E-BTL-SCENE', asset, `Szene ${sceneIndex}: gzip defekt: ${(err as Error).message}`, sceneIndex));
        scenes.push(null);
        continue;
      }
      if (decompressed.length !== SCENE_DECOMPRESSED_LEN) {
        diagnostics.push(
          bdiag('E-BTL-SCENE', asset, `Szene ${sceneIndex}: ${decompressed.length} B statt ${SCENE_DECOMPRESSED_LEN}`, sceneIndex),
        );
        scenes.push(null);
        continue;
      }
      scenes.push(parseScene(decompressed, sceneIndex, asset, diagnostics));
    }
  }
  return { schemaVersion: 1, scenes, diagnostics };
}

/** Attack-Record (28 B) — geteilt zwischen Szene und kernel-Sektion 1. */
/**
 * Angriffsdatensatz, 28 Byte. 🟢 Feldlage aus der eigenen Codeanalyse
 * (ADR-028, `spec-battle-formulas.md` §2) — und an unseren Daten gegengezählt:
 * Das Histogramm der hohen Nibbles von `damageCalc` (`+0x0E`) trifft den
 * Zensus des Bestands über 8320 Datensätze auf den Datensatz genau
 * (`schadensbyte.rdtest.ts`). Das belegt zugleich das ganze Recordraster.
 *
 * `raw` bleibt maßgeblich und wird weiterhin mitgeführt: Die gedeuteten
 * Felder sind eine Bequemlichkeit, keine Ersetzung.
 */
export function parseAttackRecord(bytes: Uint8Array): AttackRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    accuracy: bytes[0]!,
    impactEffectId: bytes[1]!,
    targetPoseClass: bytes[2]!,
    mpCost: view.getUint16(4, true),
    soundOrPopupId: view.getInt16(6, true),
    cameraSingle: view.getUint16(8, true),
    cameraMulti: view.getUint16(10, true),
    targetFlags: bytes[0x0c]!,
    attackEffectId: bytes[0x0d]!,
    damageCalc: bytes[0x0e]!,
    power: bytes[0x0f]!,
    statusMode: bytes[0x11]!,
    addedEffectId: bytes[0x12]!,
    addedEffectArg: bytes[0x13]!,
    statusMask: view.getUint32(0x14, true),
    // 🟢 `0xFFFF` wird im Original auf 0 normiert — „kein Element", nicht
    // „alle Elemente". Wer das roh übernimmt, macht aus jedem elementlosen
    // Angriff einen mit sechzehn Elementen.
    elementMask: view.getInt16(0x18, true) === -1 ? 0 : view.getUint16(0x18, true),
    specialFlags: view.getUint16(0x1a, true),
    raw: bytes.slice(0),
  };
}

function parseEnemyRecord(bytes: Uint8Array): EnemyRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const attackIds = new Uint16Array(16);
  const attackCameraRaw = new Uint16Array(16);
  for (let i = 0; i < 16; i++) {
    attackIds[i] = view.getUint16(0x48 + i * 2, true);
    attackCameraRaw[i] = view.getUint16(0x68 + i * 2, true);
  }
  return {
    nameRaw: bytes.slice(0, 32),
    level: bytes[0x20]!,
    statsRaw: bytes.slice(0x20, 0x28),
    elementRaw: bytes.slice(0x28, 0x38),
    animationIds: bytes.slice(0x38, 0x48),
    attackIds,
    attackCameraRaw,
    itemRaw: bytes.slice(0x88, 0x94),
    mp: view.getUint16(0x9c, true),
    ap: view.getUint16(0x9e, true),
    backAttackScale: bytes[0xa2]!,
    hp: view.getUint32(0xa4, true),
    exp: view.getUint32(0xa8, true),
    gil: view.getUint32(0xac, true),
    statusesAllowed: view.getUint32(0xb0, true),
    raw: bytes.slice(0),
  };
}

/**
 * Liest eine KI-Offsettabelle (`count` u16, relativ zum Tabellenanfang) und
 * schneidet die Skripte als Spannen [off_i, nächster belegter Offset bzw.
 * Bereichsende). ✅ Tabellenlagen 0xC80/0xE80 realdaten-belegt (Sweep;
 * die Community-Angabe 0xF00 ist widerlegt).
 */
function sliceAiScripts(
  scene: Uint8Array,
  tableOff: number,
  count: number,
  regionEnd: number,
  asset: string,
  sceneIndex: number,
  diagnostics: BattleDiagnostic[],
): (Uint8Array | null)[] {
  const view = new DataView(scene.buffer, scene.byteOffset, scene.byteLength);
  const offsets: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const v = view.getUint16(tableOff + i * 2, true);
    if (v === 0xffff) {
      offsets.push(null);
      continue;
    }
    if (v < count * 2 || tableOff + v >= regionEnd) {
      diagnostics.push(bdiag('E-BTL-AI', asset, `Szene ${sceneIndex}: KI-Offset ${i} außerhalb (${v})`, sceneIndex));
      offsets.push(null);
      continue;
    }
    offsets.push(v);
  }
  return offsets.map((off, i) => {
    if (off === null) return null;
    let end = regionEnd - tableOff;
    for (let j = i + 1; j < count; j++) {
      const next = offsets[j];
      if (next !== null && next !== undefined && next > off) {
        end = next;
        break;
      }
    }
    return scene.slice(tableOff + off, tableOff + end);
  });
}

export function parseScene(
  bytes: Uint8Array,
  sceneIndex: number,
  asset = 'scene.bin',
  diagnostics: BattleDiagnostic[] = [],
): BattleScene {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const enemyTypeIds = [view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)];

  const formationAi = sliceAiScripts(
    bytes,
    SCENE_OFF.formationAi,
    FORMATIONS_PER_SCENE,
    SCENE_OFF.enemyAi,
    asset,
    sceneIndex,
    diagnostics,
  );
  const formations: BattleFormation[] = [];
  for (let f = 0; f < FORMATIONS_PER_SCENE; f++) {
    const slots: FormationSlot[] = [];
    for (let e = 0; e < ENEMY_SLOTS_PER_FORMATION; e++) {
      const off = SCENE_OFF.formation + f * ENEMY_SLOTS_PER_FORMATION * FORMATION_SLOT_LEN + e * FORMATION_SLOT_LEN;
      const slotBytes = bytes.slice(off, off + FORMATION_SLOT_LEN);
      const enemyTypeId = view.getUint16(off, true);
      if (enemyTypeId !== 0xffff && !enemyTypeIds.includes(enemyTypeId)) {
        // ✅ Referenzschluss 2414/2414 im Bestand — eine Verletzung ist ein
        // echter Datenfehler, der Slot wird quarantänisiert (leer).
        diagnostics.push(
          bdiag('E-BTL-RECORD', asset, `Szene ${sceneIndex}, Formation ${f}: Slot ${e} referenziert fremden Gegner ${enemyTypeId}`, sceneIndex),
        );
        slots.push({ enemyTypeId: 0xffff, x: 0, y: 0, z: 0, row: 0, coverFlags: 0, initialState: 0, raw: slotBytes });
        continue;
      }
      slots.push({
        enemyTypeId,
        x: view.getInt16(off + 2, true),
        y: view.getInt16(off + 4, true),
        z: view.getInt16(off + 6, true),
        row: view.getUint16(off + 8, true),
        coverFlags: view.getUint16(off + 10, true),
        initialState: view.getUint32(off + 12, true),
        raw: slotBytes,
      });
    }
    const setupOff = SCENE_OFF.setup + f * SETUP_RECORD_LEN;
    formations.push({
      slots,
      setupRaw: bytes.slice(setupOff, setupOff + SETUP_RECORD_LEN),
      location: view.getUint16(setupOff, true),
      cameraRaw: bytes.slice(SCENE_OFF.camera + f * CAMERA_RECORD_LEN, SCENE_OFF.camera + (f + 1) * CAMERA_RECORD_LEN),
      aiScript: formationAi[f] ?? new Uint8Array(0),
    });
  }

  const enemies: (EnemyRecord | null)[] = [];
  for (let e = 0; e < ENEMY_TYPES_PER_SCENE; e++) {
    if (enemyTypeIds[e] === 0xffff) {
      enemies.push(null);
      continue;
    }
    enemies.push(parseEnemyRecord(bytes.subarray(SCENE_OFF.enemy + e * ENEMY_RECORD_LEN, SCENE_OFF.enemy + (e + 1) * ENEMY_RECORD_LEN)));
  }

  const attacks: AttackRecord[] = [];
  const attackIds = new Uint16Array(ATTACKS_PER_SCENE);
  for (let a = 0; a < ATTACKS_PER_SCENE; a++) {
    attacks.push(parseAttackRecord(bytes.subarray(SCENE_OFF.attack + a * ATTACK_RECORD_LEN, SCENE_OFF.attack + (a + 1) * ATTACK_RECORD_LEN)));
    attackIds[a] = view.getUint16(SCENE_OFF.attackIds + a * 2, true);
  }

  const enemyAiScripts = sliceAiScripts(
    bytes,
    SCENE_OFF.enemyAi,
    ENEMY_TYPES_PER_SCENE,
    SCENE_DECOMPRESSED_LEN,
    asset,
    sceneIndex,
    diagnostics,
  );

  return {
    sceneIndex,
    enemyTypeIds,
    formations,
    enemies,
    attacks,
    attackIds,
    attackNamesRaw: bytes.slice(SCENE_OFF.attackNames, SCENE_OFF.formationAi),
    enemyAiScripts,
  };
}
