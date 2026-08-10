/**
 * `scene.bin`-Composer für Golden Fixtures (S30) — codegetrennt vom Parser in
 * formats-battle (Dualitätsprinzip). Baut die realdaten-belegte Grammatik
 * nach: Blöcke à 0x2000, 16 u32-Zeiger in 4-Byte-Einheiten (0xFFFFFFFF =
 * leer), gzip-Ströme, Füllung 0xFF bis zum nächsten Zeiger bzw. Blockende.
 */

export interface SceneEnemySpec {
  id: number;
  name?: string;
  level?: number;
  hp?: number;
  mp?: number;
  ap?: number;
  exp?: number;
  gil?: number;
  /** Indizes in die Szenen-Attacktabelle (werden als Attack-IDs übersetzt). */
  attackSlots?: number[];
  /** KI-Skript (roh); undefined = kein Skript (0xFFFF-Offset). */
  aiScript?: Uint8Array;
}

export interface SceneFormationSlotSpec {
  /** Index 0..2 in die Gegnerliste der Szene. */
  enemyIndex: number;
  x?: number;
  y?: number;
  z?: number;
  row?: number;
}

export interface SceneFormationSpec {
  slots: SceneFormationSlotSpec[];
  location?: number;
  aiScript?: Uint8Array;
}

export interface SceneSpec {
  enemies: SceneEnemySpec[];
  formations: SceneFormationSpec[];
  /** Attack-IDs der Szenentabelle (bis 32). */
  attackIds?: number[];
  /** MP-Kosten je Attacke (parallel zu attackIds). */
  attackMpCosts?: number[];
}

const SCENE_LEN = 0x1e80;
const BLOCK = 0x2000;
const OFF = {
  setup: 0x8,
  camera: 0x58,
  formation: 0x118,
  enemy: 0x298,
  attack: 0x4c0,
  attackIds: 0x840,
  attackNames: 0x880,
  formationAi: 0xc80,
  enemyAi: 0xe80,
} as const;

/** Kodiert einen Namen im linearen ASCII-Fenster (Versatz 0x20) + 0xFF-Ende. */
function encodeName(target: Uint8Array, name: string): void {
  const n = Math.min(name.length, target.length - 1);
  for (let i = 0; i < n; i++) target[i] = (name.charCodeAt(i) - 0x20) & 0xff;
  target.fill(0xff, n);
}

/** Baut die entpackten 7808 B einer Szene aus der Spezifikation. */
export function composeScene(spec: SceneSpec): Uint8Array {
  if (spec.enemies.length > 3) throw new Error('höchstens 3 Gegnertypen je Szene');
  if (spec.formations.length > 4) throw new Error('höchstens 4 Formationen je Szene');
  const bytes = new Uint8Array(SCENE_LEN);
  bytes.fill(0xff);
  const view = new DataView(bytes.buffer);

  // Gegner-IDs (0xFFFF für unbenutzte Slots bleibt durch das Vorfüllen).
  for (let e = 0; e < 3; e++) {
    view.setUint16(e * 2, e < spec.enemies.length ? spec.enemies[e]!.id : 0xffff, true);
  }
  view.setUint16(6, 0xffff, true);

  // Setup + Kamera: genullt (roh konserviert im Parser).
  bytes.fill(0, OFF.setup, OFF.formation);
  spec.formations.forEach((f, fi) => {
    view.setUint16(OFF.setup + fi * 20, f.location ?? 0, true);
  });

  // Formationen: leere Plätze tragen 0xFFFF.
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 6; s++) {
      const off = OFF.formation + f * 96 + s * 16;
      const slot = spec.formations[f]?.slots[s];
      if (!slot) {
        view.setUint16(off, 0xffff, true);
        bytes.fill(0, off + 2, off + 16);
        continue;
      }
      const enemy = spec.enemies[slot.enemyIndex];
      if (!enemy) throw new Error(`Formation ${f}: enemyIndex ${slot.enemyIndex} unbelegt`);
      view.setUint16(off, enemy.id, true);
      view.setInt16(off + 2, slot.x ?? 0, true);
      view.setInt16(off + 4, slot.y ?? 0, true);
      view.setInt16(off + 6, slot.z ?? 0, true);
      view.setUint16(off + 8, slot.row ?? 0, true);
      view.setUint16(off + 10, 0, true);
      view.setUint32(off + 12, 0, true);
    }
  }

  // Gegner-Records.
  for (let e = 0; e < 3; e++) {
    const off = OFF.enemy + e * 184;
    const enemy = spec.enemies[e];
    if (!enemy) {
      bytes.fill(0xff, off, off + 184);
      continue;
    }
    bytes.fill(0, off, off + 184);
    encodeName(bytes.subarray(off, off + 32), enemy.name ?? `GEGNER${e}`);
    bytes[off + 0x20] = enemy.level ?? 1;
    for (let a = 0; a < 16; a++) {
      const slotIdx = enemy.attackSlots?.[a];
      const id = slotIdx !== undefined ? (spec.attackIds?.[slotIdx] ?? 0xffff) : 0xffff;
      view.setUint16(off + 0x48 + a * 2, id, true);
      view.setUint16(off + 0x68 + a * 2, 0xffff, true);
    }
    bytes.fill(0xff, off + 0x88, off + 0x94); // Drop-Slots leer
    view.setUint16(off + 0x9c, enemy.mp ?? 0, true);
    view.setUint16(off + 0x9e, enemy.ap ?? 0, true);
    view.setUint16(off + 0xa0, 0xffff, true); // Morph leer
    view.setUint32(off + 0xa4, enemy.hp ?? 1, true);
    view.setUint32(off + 0xa8, enemy.exp ?? 0, true);
    view.setUint32(off + 0xac, enemy.gil ?? 0, true);
    view.setUint32(off + 0xb0, 0, true);
  }

  // Attacktabelle + IDs + Namen.
  bytes.fill(0, OFF.attack, OFF.attackIds);
  const ids = spec.attackIds ?? [];
  for (let a = 0; a < 32; a++) {
    view.setUint16(OFF.attackIds + a * 2, a < ids.length ? ids[a]! : 0xffff, true);
    const nameOff = OFF.attackNames + a * 32;
    if (a < ids.length) {
      bytes.fill(0, nameOff, nameOff + 32);
      encodeName(bytes.subarray(nameOff, nameOff + 32), `ATTACKE${a}`);
      view.setUint16(OFF.attack + a * 28 + 4, spec.attackMpCosts?.[a] ?? 0, true);
    } else {
      bytes.fill(0xff, nameOff, nameOff + 32);
    }
  }

  // KI-Bereiche: Offsettabelle (relativ zum Tabellenanfang) + Skripte.
  const writeAi = (tableOff: number, count: number, regionEnd: number, scripts: (Uint8Array | undefined)[]) => {
    bytes.fill(0xff, tableOff, regionEnd);
    let cursor = count * 2;
    for (let i = 0; i < count; i++) {
      const script = scripts[i];
      if (!script) {
        view.setUint16(tableOff + i * 2, 0xffff, true);
        continue;
      }
      if (tableOff + cursor + script.length > regionEnd) throw new Error('KI-Skripte passen nicht in den Bereich');
      view.setUint16(tableOff + i * 2, cursor, true);
      bytes.set(script, tableOff + cursor);
      cursor += script.length;
    }
  };
  writeAi(OFF.formationAi, 4, OFF.enemyAi, spec.formations.map((f) => f.aiScript));
  writeAi(OFF.enemyAi, 3, SCENE_LEN, spec.enemies.map((e) => e.aiScript));

  return bytes;
}

async function gzip(chunk: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(chunk.length);
  owned.set(chunk);
  const stream = new Blob([owned]).stream().pipeThrough(new CompressionStream('gzip'));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = new Uint8Array(value as ArrayBufferView as Uint8Array);
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

/**
 * Baut eine vollständige `scene.bin` aus Szenen-Spezifikationen. Szenen werden
 * in Blockreihenfolge gepackt; passt der nächste gzip-Strom nicht mehr in den
 * Block, beginnt ein neuer (wie im Original: variable Szenenzahl je Block).
 */
export async function composeSceneBin(scenes: readonly SceneSpec[], opts: { corruptSceneIndex?: number } = {}): Promise<Uint8Array> {
  const streams: Uint8Array[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const gz = await gzip(composeScene(scenes[i]!));
    if (opts.corruptSceneIndex === i) {
      // Defektfixture: Strom in der Mitte zerstören (E-BTL-SCENE-Quarantäne).
      const mid = Math.floor(gz.length / 2);
      gz[mid] = gz[mid]! ^ 0xa5;
    }
    streams.push(gz);
  }
  interface Block {
    ptrs: number[];
    chunks: Uint8Array[];
  }
  const blocks: Block[] = [];
  let current: Block | null = null;
  let cursor = 0;
  for (const gz of streams) {
    // 4-Byte-Ausrichtung des nächsten Zeigers erzwingen.
    const aligned = (n: number) => (n + 3) & ~3;
    const need = aligned(gz.length);
    if (!current || current.ptrs.length >= 16 || cursor + need > BLOCK) {
      current = { ptrs: [], chunks: [] };
      blocks.push(current);
      cursor = 64;
    }
    current.ptrs.push(cursor);
    current.chunks.push(gz);
    cursor += need;
  }
  const bytes = new Uint8Array(blocks.length * BLOCK);
  bytes.fill(0xff);
  const view = new DataView(bytes.buffer);
  blocks.forEach((block, b) => {
    const base = b * BLOCK;
    for (let i = 0; i < 16; i++) {
      view.setUint32(base + i * 4, i < block.ptrs.length ? block.ptrs[i]! / 4 : 0xffffffff, true);
    }
    block.chunks.forEach((gz, i) => {
      bytes.set(gz, base + block.ptrs[i]!);
    });
  });
  return bytes;
}

/** Battle-Skelett (52-B-Kopf + 12 B je Bone) für Fixture-Tests. */
export function composeBattleSkeleton(bones: { parent: number; length: number; hasGeometry: boolean }[]): Uint8Array {
  const bytes = new Uint8Array(52 + bones.length * 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(12, bones.length, true);
  bones.forEach((bone, k) => {
    view.setInt32(52 + k * 12, bone.parent, true);
    view.setFloat32(52 + k * 12 + 4, bone.length, true);
    view.setUint32(52 + k * 12 + 8, bone.hasGeometry ? 1 : 0, true);
  });
  return bytes;
}

/** Growth-Sektion (3988 B) mit setzbaren Kurven für Level-Up-Tests. */
export function composeGrowthSection(opts: {
  expCurves?: { charIndex: number; gradients: number[] }[];
} = {}): Uint8Array {
  const bytes = new Uint8Array(3988);
  // 9 Charakter-Records: Kurvenindizes wie im Bestand gebändert.
  for (let c = 0; c < 9; c++) {
    const off = c * 56;
    for (let i = 0; i < 6; i++) bytes[off + i] = (c + i) % 37;
    bytes[off + 6] = 37 + c;
    bytes[off + 7] = 46 + c;
    bytes[off + 8] = 55 + c;
    bytes[off + 9] = 0xff;
    bytes[off + 10] = 1;
    bytes[off + 11] = 0xff;
  }
  // Gewinn-Tabellen monoton.
  for (let i = 0; i < 12; i++) {
    bytes[0x1f8 + i] = i;
    bytes[0x204 + i] = 10 + i * 10;
    bytes[0x210 + i] = 5 + i * 5;
  }
  // Kurven: Vorgabe flach; EXP-Kurven (55..63) mit Basis 0.
  for (let k = 0; k < 64; k++) {
    for (let i = 0; i < 8; i++) {
      bytes[0x21c + k * 16 + i * 2] = 50;
      bytes[0x21c + k * 16 + i * 2 + 1] = k >= 55 ? 0 : 10;
    }
  }
  for (const c of opts.expCurves ?? []) {
    const k = 55 + c.charIndex;
    for (let i = 0; i < 8; i++) {
      bytes[0x21c + k * 16 + i * 2] = c.gradients[i] ?? 50;
      bytes[0x21c + k * 16 + i * 2 + 1] = 0;
    }
  }
  return bytes;
}
