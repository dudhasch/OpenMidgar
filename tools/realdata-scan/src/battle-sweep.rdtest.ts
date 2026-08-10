import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  parseBattleSkeleton,
  parseKernelBattleData,
  parseSceneBin,
  enemyModelPrefix,
} from '@webmidgar/formats-battle';
import { parseKernelContainer } from '@webmidgar/formats-kernel';
import { NodeDirectorySource } from './node-source.js';

/**
 * S30 — Sweep mit den PRODUKTIONSPARSERN über den Realbestand (die Probe
 * `battle-probe.rdtest.ts` hat die Grammatik erschlossen; dieser Sweep belegt,
 * dass die Parser exakt diese Grammatik implementieren).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));

describe.skipIf(!available)('S30-Sweep: Produktionsparser gegen Realdaten', () => {
  it('parseSceneBin: 256/256 Szenen, 0 Diagnosen; Gegner- und KI-Bestand', async () => {
    const bytes = new Uint8Array(readFileSync(join(REAL_DIR, 'data', 'battle', 'scene.bin')));
    const container = await parseSceneBin(bytes, 'scene.bin');
    expect(container.diagnostics).toEqual([]);
    expect(container.scenes.length).toBe(256);
    expect(container.scenes.every((s) => s !== null)).toBe(true);

    let gegner = 0;
    let kiSkripte = 0;
    let formationenMitGegner = 0;
    for (const scene of container.scenes) {
      gegner += scene!.enemies.filter((e) => e !== null).length;
      kiSkripte += scene!.enemyAiScripts.filter((s) => s !== null).length;
      for (const f of scene!.formations) {
        if (f.slots.some((s) => s.enemyTypeId !== 0xffff)) formationenMitGegner++;
      }
    }
    console.log('Sweep scene.bin:', JSON.stringify({ gegner, kiSkripte, formationenMitGegner }));
    expect(gegner).toBe(627);
    expect(formationenMitGegner).toBe(1000);
  }, 120_000);

  it('parseBattleSkeleton: 481/481 Skelette; parseKernelBattleData trägt', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    let skelette = 0;
    let ok = 0;
    for (const entry of index.listEntries('battle')) {
      if (!/^[a-z]{2}aa$/.test(entry.name)) continue;
      skelette++;
      const { skeleton, diagnostics } = parseBattleSkeleton(await index.readEntry(entry.canonicalId), entry.name);
      if (skeleton && diagnostics.length === 0) ok++;
    }
    expect(ok).toBe(skelette);
    expect(skelette).toBe(481);

    // Modellpräfix-Helfer: konsistent zur Probe (354/354 aufgelöst).
    expect(enemyModelPrefix(0)).toBe('aa');
    expect(enemyModelPrefix(369)).toBe('of');

    const kernel = await parseKernelContainer(
      new Uint8Array(readFileSync(join(REAL_DIR, 'data', 'kernel', 'kernel.bin'))),
      'kernel.bin',
    );
    const battle = parseKernelBattleData(kernel!.sections);
    expect(battle.diagnostics).toEqual([]);
    expect(battle.data).not.toBeNull();
    expect(battle.data!.commands.length).toBe(32);
    expect(battle.data!.attacks.length).toBe(128);
    expect(battle.data!.growth.characters.length).toBe(9);
    // EXP-Kurven aller 9 Charaktere: Basis 0 in allen Paaren (Formatfakt).
    for (const ch of battle.data!.growth.characters) {
      const curve = battle.data!.growth.curves[ch.curveIndexes.exp]!;
      expect([...curve.bases]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
