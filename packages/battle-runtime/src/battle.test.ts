import { describe, expect, it } from 'vitest';
import { BattleAiAsm, composeAiScript, composeScene } from '@webmidgar/fixture-gen';
import { parseScene } from '@webmidgar/formats-battle';
import { parseAiScript, runAiHandler, type AiMemory } from './ai-vm.js';
import { defaultFormulas } from './formulas.js';
import {
  BattleSession,
  battleConfigFromScene,
  NEUTRAL_BATTLE_INPUT,
  type BattleConfig,
  type BattleTickInput,
} from './session.js';

/**
 * Fixture-Tests battle-runtime (S31). Die KI-Fixtures kommen aus dem
 * codegetrennten Assembler (fixture-gen); jede scharfgeschaltete
 * Opcode-Kategorie hat hier ihren Sollverlauf — der Spannen-Abschluss der
 * Probe belegt ausdrücklich KEINE Semantik (blinde Gütefunktion).
 */

class MapMemory implements AiMemory {
  cells = new Map<number, number>();
  read(address: number): number {
    return this.cells.get(address) ?? 0;
  }
  write(address: number, value: number): void {
    this.cells.set(address, value);
  }
}

describe('KI-VM: Sollverläufe je Kategorie', () => {
  it('Push/Vergleich/Sprung: wählt die Attacke des genommenen Zweigs', () => {
    // if (mem[0x40] < 100) attack(7) else attack(9)
    const handler = new BattleAiAsm()
      .pushMem(1, 0x40)
      .pushConst(100)
      .lt()
      .jz('else')
      .pushConst(7)
      .attack()
      .end()
      .label('else')
      .pushConst(9)
      .attack()
      .end()
      .assemble();
    const script = parseAiScript(composeAiScript({ 0: handler }))!;

    const memLow = new MapMemory();
    memLow.cells.set(0x40, 50);
    const r1 = runAiHandler(script, 0, memLow);
    expect(r1.finished).toBe(true);
    expect(r1.faults).toEqual([]);
    expect(r1.actions.map((a) => a.attackId)).toEqual([7]);

    const memHigh = new MapMemory();
    memHigh.cells.set(0x40, 200);
    const r2 = runAiHandler(script, 0, memHigh);
    expect(r2.actions.map((a) => a.attackId)).toEqual([9]);
  });

  it('Arithmetik mit u32-Wrap und Store', () => {
    // mem[0x10] = (10 - 12) + 5  → u32-Wrap: (0xFFFFFFFE + 5) = 3
    const handler = new BattleAiAsm()
      .pushTyped(2, 0x10) // Zieladresse
      .pushConst(10)
      .pushConst(12)
      .sub()
      .pushConst(5)
      .add()
      .store()
      .end()
      .assemble();
    const script = parseAiScript(composeAiScript({ 0: handler }))!;
    const mem = new MapMemory();
    const r = runAiHandler(script, 0, mem);
    expect(r.faults).toEqual([]);
    expect(mem.cells.get(0x10)).toBe(3);
  });

  it('String-Op 0x93: 0x00 im Text beendet NICHT (Formatfakt: Ende = 0xFF)', () => {
    const handler = new BattleAiAsm()
      .debugString('AB\0CD')
      .pushConst(3)
      .attack()
      .end()
      .assemble();
    const script = parseAiScript(composeAiScript({ 0: handler }))!;
    const r = runAiHandler(script, 0, new MapMemory());
    expect(r.faults).toEqual([]);
    expect(r.actions.map((a) => a.attackId)).toEqual([3]);
  });

  it('UNKNOWN-Politik: unbekannter Opcode faultet und wird übersprungen', () => {
    const handler = new BattleAiAsm().raw(0xc0).pushConst(5).attack().end().assemble();
    const script = parseAiScript(composeAiScript({ 0: handler }))!;
    const r = runAiHandler(script, 0, new MapMemory());
    expect(r.finished).toBe(true);
    expect(r.unknownCount).toBe(1);
    expect(r.faults.some((f) => f.kind === 'unknown-op' && f.opcode === 0xc0)).toBe(true);
    expect(r.actions.map((a) => a.attackId)).toEqual([5]);
  });

  it('Budget bricht Endlosschleifen ab', () => {
    const handler = new BattleAiAsm().label('loop').pushConst(1).discard().jmp('loop').assemble();
    const script = parseAiScript(composeAiScript({ 0: handler }))!;
    const r = runAiHandler(script, 0, new MapMemory(), { budget: 64 });
    expect(r.finished).toBe(false);
    expect(r.faults.some((f) => f.kind === 'budget')).toBe(true);
  });
});

function fixtureConfig(seed = 7): BattleConfig {
  const aiScript = composeAiScript({
    0: new BattleAiAsm().pushConst(260).attack().end().assemble(),
  });
  return {
    seed,
    party: [
      { id: 'held', level: 10, maxHp: 300, maxMp: 40, strength: 20, defense: 12, magic: 14, mdefense: 10, dexterity: 24, luck: 8 },
      { id: 'stuetze', level: 9, maxHp: 260, maxMp: 60, strength: 14, defense: 10, magic: 20, mdefense: 14, dexterity: 20, luck: 10 },
    ],
    enemies: [
      {
        enemyTypeId: 7,
        level: 5,
        maxHp: 120,
        mp: 0,
        stats: { level: 5, strength: 10, defense: 6, magic: 4, mdefense: 4, dexterity: 12, luck: 4 },
        attackIds: [260],
        aiScript,
        exp: 22,
        ap: 2,
        gil: 15,
      },
      {
        enemyTypeId: 7,
        level: 5,
        maxHp: 120,
        mp: 0,
        stats: { level: 5, strength: 10, defense: 6, magic: 4, mdefense: 4, dexterity: 12, luck: 4 },
        attackIds: [260],
        aiScript,
        exp: 22,
        ap: 2,
        gil: 15,
      },
    ],
    attackTable: new Map([[260, { mpCost: 0, accuracy: 255, power: 16 }]]),
  };
}

/** Spielt deterministisch: sobald ein Party-Akteur bereit ist, greift er an. */
function autoPlay(session: BattleSession, maxTicks: number): { digests: string[]; ticks: number } {
  const digests: string[] = [];
  let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
  for (let t = 0; t < maxTicks; t++) {
    const result = session.tick(pending);
    pending = NEUTRAL_BATTLE_INPUT;
    if (result.awaitingInput.length > 0) {
      pending = { command: { actorId: result.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
    }
    digests.push(session.digest());
    if (result.outcome) return { digests, ticks: t + 1 };
  }
  return { digests, ticks: maxTicks };
}

describe('BattleSession: Determinismus (die Abnahme zuerst, nicht zuletzt)', () => {
  it('gleicher Seed + gleiche Eingabefolge ⇒ bitidentische Digestfolge', () => {
    const a = autoPlay(new BattleSession(fixtureConfig()), 10_000);
    const b = autoPlay(new BattleSession(fixtureConfig()), 10_000);
    expect(a.digests).toEqual(b.digests);
    expect(a.ticks).toBeLessThan(10_000);
  });

  it('GEGENPROBE: ein um einen Takt verschobener Eingabestrom ändert den Digest', () => {
    // Ohne diese Probe wäre die Gleichheit oben wertlos (blinder Digest).
    const s1 = new BattleSession(fixtureConfig());
    const s2 = new BattleSession(fixtureConfig());
    const inputs1: BattleTickInput[] = [];
    // Lauf 1 aufzeichnen.
    let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 400; t++) {
      inputs1.push(pending);
      const r = s1.tick(pending);
      pending = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) {
        pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      }
    }
    // Lauf 2: dieselben Eingaben, um einen Takt verzögert.
    const shifted: BattleTickInput[] = [NEUTRAL_BATTLE_INPUT, ...inputs1.slice(0, -1)];
    for (const inp of shifted) s2.tick(inp);
    expect(s2.digest()).not.toBe(s1.digest());
  });

  it('anderer Seed ⇒ nachweisbar verschiedener Verlauf', () => {
    const a = autoPlay(new BattleSession(fixtureConfig(7)), 10_000);
    const b = autoPlay(new BattleSession(fixtureConfig(999)), 10_000);
    expect(a.digests).not.toEqual(b.digests);
  });

  it('Snapshot/Restore mitten im ATB-Fenster ist verlustfrei', () => {
    const cfg = fixtureConfig();
    const s1 = new BattleSession(cfg);
    // 37 Takte laufen — mitten im Füllfenster, mit teils gefüllter Queue.
    let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 37; t++) {
      const r = s1.tick(pending);
      pending = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) {
        pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      }
    }
    const snap = structuredClone(s1.snapshot());
    const s2 = new BattleSession(cfg);
    s2.restore(snap);
    expect(s2.digest()).toBe(s1.digest());
    // Beide Sitzungen laufen identisch weiter.
    for (let t = 0; t < 200; t++) {
      const r1 = s1.tick(NEUTRAL_BATTLE_INPUT);
      const r2 = s2.tick(NEUTRAL_BATTLE_INPUT);
      expect(s2.digest()).toBe(s1.digest());
      if (r1.outcome || r2.outcome) break;
    }
  });

  it('ein vollständiger Kampf läuft headless bis zum Sieg mit exakter Sollrechnung der Beute', () => {
    const session = new BattleSession(fixtureConfig());
    const { ticks } = autoPlay(session, 10_000);
    expect(session.finished).toBe(true);
    const snap = session.snapshot();
    expect(snap.outcome).toMatchObject({ kind: 'victory', exp: 44, ap: 4, gil: 30, defeatedEnemyTypeIds: [7, 7] });
    expect(ticks).toBeGreaterThan(10);
  });

  it('Niederlage und Flucht sind eigene Pfade', () => {
    // Übermächtiger Gegner, Party tut nichts ⇒ Niederlage.
    const cfg = fixtureConfig();
    cfg.enemies = [
      {
        enemyTypeId: 99,
        level: 90,
        maxHp: 100_000,
        mp: 0,
        stats: { level: 90, strength: 250, defense: 200, magic: 200, mdefense: 200, dexterity: 200, luck: 50 },
        attackIds: [260],
        exp: 0,
        ap: 0,
        gil: 0,
      },
    ];
    const s = new BattleSession(cfg);
    let outcome = null;
    for (let t = 0; t < 10_000 && !outcome; t++) outcome = s.tick(NEUTRAL_BATTLE_INPUT).outcome;
    expect(outcome).toEqual({ kind: 'defeat' });

    // Flucht: hohes Partylevel gegen Level-5-Gegner ⇒ Schwelle greift schnell.
    const s2 = new BattleSession(fixtureConfig());
    let escaped = null;
    for (let t = 0; t < 10_000 && !escaped; t++) {
      const r = s2.tick(
        r0(t) ? NEUTRAL_BATTLE_INPUT : NEUTRAL_BATTLE_INPUT,
      );
      if (r.awaitingInput.length > 0) {
        const rr = s2.tick({ command: { actorId: r.awaitingInput[0]!, command: { kind: 'escape' } } });
        if (rr.outcome) escaped = rr.outcome;
      }
      if (r.outcome) escaped = r.outcome;
    }
    expect(escaped).toEqual({ kind: 'escape' });

    function r0(_t: number): boolean {
      return false;
    }
  });
});

describe('battleConfigFromScene: Aufstellung aus den Szenendaten', () => {
  it('übernimmt Gegner, Attacken und KI aus einer komponierten Szene', () => {
    const sceneBytes = composeScene({
      enemies: [
        {
          id: 42,
          name: 'PROBE',
          level: 8,
          hp: 200,
          mp: 12,
          exp: 30,
          gil: 9,
          ap: 3,
          attackSlots: [0],
          aiScript: composeAiScript({ 0: new BattleAiAsm().pushConst(300).attack().end().assemble() }),
        },
      ],
      formations: [{ slots: [{ enemyIndex: 0, x: 10, z: -20 }, { enemyIndex: 0 }] }],
      attackIds: [300],
      attackMpCosts: [2],
    });
    const scene = parseScene(sceneBytes, 0);
    const cfg = battleConfigFromScene(scene, 0, [
      { id: 'held', level: 10, maxHp: 300, maxMp: 40, strength: 20, defense: 12, magic: 14, mdefense: 10, dexterity: 24, luck: 8 },
    ], { seed: 3 });
    expect(cfg.enemies.length).toBe(2);
    expect(cfg.enemies[0]!.maxHp).toBe(200);
    expect(cfg.enemies[0]!.exp).toBe(30);
    expect(cfg.attackTable!.get(300)).toMatchObject({ mpCost: 2 });

    const session = new BattleSession(cfg);
    const { ticks } = (function run() {
      let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
      for (let t = 0; t < 10_000; t++) {
        const r = session.tick(pending);
        pending = NEUTRAL_BATTLE_INPUT;
        if (r.awaitingInput.length > 0) {
          pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
        }
        if (r.outcome) return { ticks: t + 1 };
      }
      return { ticks: -1 };
    })();
    expect(session.finished).toBe(true);
    expect(ticks).toBeGreaterThan(0);
    const outcome = session.snapshot().outcome!;
    expect(outcome).toMatchObject({ kind: 'victory', exp: 60, ap: 6, gil: 18 });
  });
});

describe('Formelsatz: dokumentierte 🔵-Eigenschaften', () => {
  it('ist monoton in Stärke, antimonoton in Verteidigung, nie unter 1', () => {
    const f = defaultFormulas();
    const base = { level: 10, strength: 20, defense: 10, magic: 10, mdefense: 10, dexterity: 10, luck: 10 };
    const d1 = f.physicalDamage(base, base, 16);
    const d2 = f.physicalDamage({ ...base, strength: 40 }, base, 16);
    const d3 = f.physicalDamage(base, { ...base, defense: 100 }, 16);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeLessThan(d1);
    expect(f.physicalDamage({ ...base, strength: 0, level: 1 }, { ...base, defense: 255 }, 1)).toBeGreaterThanOrEqual(1);
  });
});
