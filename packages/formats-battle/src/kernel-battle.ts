import { bdiag, type BattleDiagnostic } from './diagnostics.js';
import { parseAttackRecord } from './scene.js';
import {
  ATTACK_RECORD_LEN,
  KERNEL_ATTACK_COUNT,
  KERNEL_COMMAND_COUNT,
  KERNEL_COMMAND_LEN,
  type AttackRecord,
  type CommandRecord,
  type GrowthCharacter,
  type GrowthCurve,
  type GrowthSection,
  type KernelBattleData,
} from './types.js';

/**
 * kernel.bin Sektionen 0–2 — von „roh konserviert" (S13) auf typisiert (S30).
 *
 * Belegte Fakten (Probe): Sektion 0 = exakt 32×8 B, Sektion 1 = exakt
 * 128×28 B (Record-Layout identisch zur Szenen-Attacktabelle), Sektion 2 =
 * 9×56 B Charakter-Records (81/81 Kurvenindizes < 64, HP/MP/EXP-Bänder
 * 37–45/46–54/55–63 exakt getrennt) + 3×12 B Gewinn-Tabellen (monoton) +
 * 64×16 B Kurven ab 0x21C (Basis aus den Daten abgeleitet: der EXP-Block
 * ist der längste (grad,0)-Paarlauf der Sektion) + 2424 B Rest (🟡, roh).
 */

export const GROWTH_CHARACTER_COUNT = 9;
export const GROWTH_CHARACTER_LEN = 56;
export const GROWTH_CURVE_BASE = 0x21c;
export const GROWTH_CURVE_COUNT = 64;
export const GROWTH_CURVE_LEN = 16;
export const GROWTH_SECTION_LEN = 3988;

export function parseGrowthSection(bytes: Uint8Array, asset: string, diagnostics: BattleDiagnostic[]): GrowthSection | null {
  if (bytes.length !== GROWTH_SECTION_LEN) {
    diagnostics.push(bdiag('E-BTL-KERNEL', asset, `Growth-Sektion ${bytes.length} B statt ${GROWTH_SECTION_LEN}`));
    return null;
  }
  const characters: GrowthCharacter[] = [];
  for (let c = 0; c < GROWTH_CHARACTER_COUNT; c++) {
    const raw = bytes.slice(c * GROWTH_CHARACTER_LEN, (c + 1) * GROWTH_CHARACTER_LEN);
    const idx = [...raw.subarray(0, 9)];
    if (idx.some((v) => v >= GROWTH_CURVE_COUNT)) {
      diagnostics.push(bdiag('E-BTL-KERNEL', asset, `Charakter ${c}: Kurvenindex außerhalb`, c));
    }
    characters.push({
      curveIndexes: { primary: idx.slice(0, 6), hp: idx[6]!, mp: idx[7]!, exp: idx[8]! },
      startLevelRaw: raw[10]!,
      raw,
    });
  }
  const curves: GrowthCurve[] = [];
  for (let k = 0; k < GROWTH_CURVE_COUNT; k++) {
    const off = GROWTH_CURVE_BASE + k * GROWTH_CURVE_LEN;
    const gradients = new Uint8Array(8);
    const bases = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      gradients[i] = bytes[off + i * 2]!;
      bases[i] = bytes[off + i * 2 + 1]!;
    }
    curves.push({ gradients, bases });
  }
  return {
    characters,
    statGain: bytes.slice(0x1f8, 0x204),
    hpGain: bytes.slice(0x204, 0x210),
    mpGain: bytes.slice(0x210, 0x21c),
    curves,
    tailRaw: bytes.slice(GROWTH_CURVE_BASE + GROWTH_CURVE_COUNT * GROWTH_CURVE_LEN),
  };
}

export interface ParseKernelBattleResult {
  data: KernelBattleData | null;
  diagnostics: BattleDiagnostic[];
}

/** Nimmt die ENTPACKTEN Sektionen 0–2 (aus `parseKernelContainer`). */
export function parseKernelBattleData(
  sections: { data: Uint8Array }[],
  asset = 'kernel.bin',
): ParseKernelBattleResult {
  const diagnostics: BattleDiagnostic[] = [];
  const s0 = sections[0]?.data;
  const s1 = sections[1]?.data;
  const s2 = sections[2]?.data;
  if (!s0 || !s1 || !s2) {
    diagnostics.push(bdiag('E-BTL-KERNEL', asset, 'Sektionen 0–2 unvollständig'));
    return { data: null, diagnostics };
  }
  if (s0.length !== KERNEL_COMMAND_COUNT * KERNEL_COMMAND_LEN) {
    diagnostics.push(bdiag('E-BTL-KERNEL', asset, `Sektion 0: ${s0.length} B statt ${KERNEL_COMMAND_COUNT * KERNEL_COMMAND_LEN}`));
    return { data: null, diagnostics };
  }
  if (s1.length !== KERNEL_ATTACK_COUNT * ATTACK_RECORD_LEN) {
    diagnostics.push(bdiag('E-BTL-KERNEL', asset, `Sektion 1: ${s1.length} B statt ${KERNEL_ATTACK_COUNT * ATTACK_RECORD_LEN}`));
    return { data: null, diagnostics };
  }
  const commands: CommandRecord[] = [];
  for (let i = 0; i < KERNEL_COMMAND_COUNT; i++) {
    commands.push({ raw: s0.slice(i * KERNEL_COMMAND_LEN, (i + 1) * KERNEL_COMMAND_LEN) });
  }
  const attacks: AttackRecord[] = [];
  for (let i = 0; i < KERNEL_ATTACK_COUNT; i++) {
    attacks.push(parseAttackRecord(s1.subarray(i * ATTACK_RECORD_LEN, (i + 1) * ATTACK_RECORD_LEN)));
  }
  const growth = parseGrowthSection(s2, asset, diagnostics);
  if (!growth) return { data: null, diagnostics };
  return { data: { commands, attacks, growth }, diagnostics };
}
