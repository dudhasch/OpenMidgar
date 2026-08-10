import { canonicalJson, fnv1a64HexOfString } from '@webmidgar/interpreter';
import type { BattleScene } from '@webmidgar/formats-battle';
import { parseAiScript, runAiHandler, type AiFault, type AiMemory, type AiScript } from './ai-vm.js';
import { ATB_MAX, applyVariance, defaultFormulas, type CombatantStats, type FormulaSet } from './formulas.js';

/**
 * BattleSession (S31) — Fixed-Tick-Kampfsitzung im ADR-006-Vertrag.
 *
 * Zeitmodell: **ATB als ganzzahlige Akkumulatoren** (0..65536) im Fixed-Tick —
 * keine Fließkommazeit, keine Wanduhr, keine rAF-Kopplung. Die Füllrate ist
 * Teil des austauschbaren 🔵-Formelsatzes (`formulas.ts`). Eingaben werden am
 * Takt verarbeitet (eine Kommando-Eingabe je Takt), die Aktionswarteschlange
 * ist strikt FIFO — dieselbe stabile Ordnung wie beim Field-Scheduler.
 *
 * Der PRNG (LCG wie in der WorldSession) ist Teil des Snapshots: gleicher
 * Seed + gleiche Eingabefolge ⇒ bitidentischer Verlauf.
 *
 * Gegner entscheiden über die KI-VM (`ai-vm.ts`): Beim Bereitwerden läuft der
 * Haupthandler (niedrigster belegter Tabellenplatz, 🟡); wählt er per 0x92
 * keine Attacke (UNKNOWN-Lücken), fällt der Gegner auf seine erste belegte
 * Attack-ID zurück — dokumentierter 🔵-Rückfallpfad, damit ein Kampf nie an
 * einer Semantiklücke hängen bleibt.
 */

export interface PartyMemberSpec {
  id: string;
  level: number;
  maxHp: number;
  hp?: number;
  maxMp: number;
  mp?: number;
  strength: number;
  defense: number;
  magic: number;
  mdefense: number;
  dexterity: number;
  luck: number;
}

export interface EnemyInstanceSpec {
  /** Gegnertyp (Szenen-ID) — für Modell-/Berichtszwecke. */
  enemyTypeId: number;
  level: number;
  maxHp: number;
  mp: number;
  /**
   * 🟡 Die Reihenfolge der u8-Statistiken im Gegner-Record ist nicht
   * realdaten-belegt (nur Level ist gemessen). Die Abbildung hier folgt der
   * Community-Deutung [speed@0x21, luck@0x22, evade@0x23, str@0x24, def@0x25,
   * mag@0x26, mdef@0x27] — über `fromEnemyRecordStats` gekapselt.
   */
  stats: CombatantStats;
  attackIds: number[];
  aiScript?: Uint8Array | null;
  exp: number;
  ap: number;
  gil: number;
  /** 🟡 Drop-Kandidaten aus dem itemRaw-Block (4 Paare Rate/Item-ID). */
  drops?: { rate: number; itemId: number }[];
}

/** Kapselt die 🟡-Felddeutung des statsRaw-Blocks an genau EINER Stelle. */
export function fromEnemyRecordStats(statsRaw: Uint8Array): CombatantStats {
  return {
    level: statsRaw[0]!,
    dexterity: statsRaw[1]!,
    luck: statsRaw[2]!,
    strength: statsRaw[4]!,
    defense: statsRaw[5]!,
    magic: statsRaw[6]!,
    mdefense: statsRaw[7]!,
  };
}

export interface AttackSpec {
  mpCost: number;
  accuracy: number;
  /** Kraft in 1/16 (16 = Normalhieb) — 🔵 solange das Attack-Record-Feld unbelegt ist. */
  power: number;
  magical?: boolean;
}

export type PartyCommand =
  | { kind: 'attack'; targetId: string }
  | { kind: 'defend' }
  | { kind: 'item'; itemId: number; targetId: string }
  | { kind: 'escape' };

export interface BattleTickInput {
  /** Höchstens ein Kommando je Takt (Determinismus der Eingabeordnung). */
  command?: { actorId: string; command: PartyCommand };
}

export const NEUTRAL_BATTLE_INPUT: BattleTickInput = {};

export interface ItemSpec {
  /** 🔵 Minimal-Itemmodell für S31: positive Werte heilen HP. */
  healHp: number;
}

export interface BattleConfig {
  party: PartyMemberSpec[];
  enemies: EnemyInstanceSpec[];
  attackTable?: Map<number, AttackSpec>;
  items?: Map<number, ItemSpec>;
  formulas?: FormulaSet;
  seed?: number;
  escapable?: boolean;
  aiBudget?: number;
}

export type BattleOutcome =
  | {
      kind: 'victory';
      exp: number;
      ap: number;
      gil: number;
      defeatedEnemyTypeIds: number[];
      /** Item-IDs der gefallenen Beute (🔵 Wurf: roll256 < rate, am Siegzeitpunkt mit dem Sitzungs-PRNG). */
      drops: number[];
    }
  | { kind: 'defeat' }
  | { kind: 'escape' };

export type BattleEvent =
  | { kind: 'ready'; actorId: string }
  | { kind: 'action'; actorId: string; targetId: string; attackId: number | null; damage: number; hit: boolean }
  | { kind: 'heal'; actorId: string; targetId: string; amount: number }
  | { kind: 'defend'; actorId: string }
  | { kind: 'escape-attempt'; actorId: string; success: boolean }
  | { kind: 'death'; actorId: string }
  | { kind: 'outcome'; outcome: BattleOutcome };

export interface BattleTickResult {
  tick: number;
  events: BattleEvent[];
  /** Party-Akteure, die auf ein Kommando warten. */
  awaitingInput: string[];
  aiFaults: AiFault[];
  outcome: BattleOutcome | null;
}

interface QueuedAction {
  actorId: string;
  command: PartyCommand | { kind: 'enemy-attack'; attackId: number; targetId: string };
}

interface ActorState {
  id: string;
  side: 'party' | 'enemy';
  enemyTypeId: number | null;
  stats: CombatantStats;
  maxHp: number;
  hp: number;
  maxMp: number;
  mp: number;
  atb: number;
  defending: boolean;
  /** Party: wartet auf Eingabe; Gegner: KI schon gelaufen. */
  ready: boolean;
  exp: number;
  ap: number;
  gil: number;
  attackIds: number[];
  aiScript: AiScript | null;
  drops: { rate: number; itemId: number }[];
}

export interface BattleSnapshot {
  schemaVersion: 1;
  tick: number;
  rngState: number;
  actors: {
    id: string;
    hp: number;
    mp: number;
    atb: number;
    defending: boolean;
    ready: boolean;
  }[];
  queue: QueuedAction[];
  aiMemory: [number, number][];
  outcome: BattleOutcome | null;
}

/** 🔵 Scratch-Speicher der KI: Stores landen hier und sind rücklesbar. Die
 * Belegung des Original-Adressraums ist unbelegt; nicht beschriebene Adressen
 * lesen 0 (still — die Quote unbekannter Adressen meldet die Statistik). */
class ScratchAiMemory implements AiMemory {
  readonly cells = new Map<number, number>();
  unknownReads = 0;
  read(address: number, _size: number): number {
    const v = this.cells.get(address);
    if (v === undefined) {
      this.unknownReads++;
      return 0;
    }
    return v;
  }
  write(address: number, value: number): void {
    this.cells.set(address, value >>> 0);
  }
}

export class BattleSession {
  private readonly formulas: FormulaSet;
  private readonly attackTable: Map<number, AttackSpec>;
  private readonly items: Map<number, ItemSpec>;
  private readonly escapable: boolean;
  private readonly aiBudget: number;
  private actors: ActorState[] = [];
  private queue: QueuedAction[] = [];
  private rngState: number;
  private tickCount = 0;
  private outcome: BattleOutcome | null = null;
  private readonly aiMemory = new ScratchAiMemory();

  constructor(config: BattleConfig) {
    this.formulas = config.formulas ?? defaultFormulas();
    this.attackTable = config.attackTable ?? new Map();
    this.items = config.items ?? new Map([[0, { healHp: 100 }]]);
    this.escapable = config.escapable ?? true;
    this.aiBudget = config.aiBudget ?? 2048;
    this.rngState = (config.seed ?? 0x51ed) >>> 0;
    for (const p of config.party) {
      this.actors.push({
        id: p.id,
        side: 'party',
        enemyTypeId: null,
        stats: {
          level: p.level,
          strength: p.strength,
          defense: p.defense,
          magic: p.magic,
          mdefense: p.mdefense,
          dexterity: p.dexterity,
          luck: p.luck,
        },
        maxHp: p.maxHp,
        hp: p.hp ?? p.maxHp,
        maxMp: p.maxMp,
        mp: p.mp ?? p.maxMp,
        atb: 0,
        defending: false,
        ready: false,
        exp: 0,
        ap: 0,
        gil: 0,
        attackIds: [],
        aiScript: null,
        drops: [],
      });
    }
    config.enemies.forEach((e, i) => {
      this.actors.push({
        id: `enemy-${i}`,
        side: 'enemy',
        enemyTypeId: e.enemyTypeId,
        stats: e.stats,
        maxHp: e.maxHp,
        hp: e.maxHp,
        maxMp: e.mp,
        mp: e.mp,
        atb: 0,
        defending: false,
        ready: false,
        exp: e.exp,
        ap: e.ap,
        gil: e.gil,
        attackIds: e.attackIds.filter((id) => id !== 0xffff),
        aiScript: e.aiScript ? parseAiScript(e.aiScript) : null,
        drops: e.drops ?? [],
      });
    });
  }

  /** LCG wie WorldSession — bitgenau, Teil des Snapshots. */
  private roll256(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState >>> 24;
  }

  get currentTick(): number {
    return this.tickCount;
  }

  actor(id: string): { id: string; side: 'party' | 'enemy'; hp: number; mp: number; atb: number } | null {
    const a = this.actors.find((x) => x.id === id);
    return a ? { id: a.id, side: a.side, hp: a.hp, mp: a.mp, atb: a.atb } : null;
  }

  get finished(): boolean {
    return this.outcome !== null;
  }

  tick(input: BattleTickInput = NEUTRAL_BATTLE_INPUT): BattleTickResult {
    const events: BattleEvent[] = [];
    const aiFaults: AiFault[] = [];
    this.tickCount++;
    if (this.outcome) {
      return { tick: this.tickCount, events, awaitingInput: [], aiFaults, outcome: this.outcome };
    }

    // 1. Eingabe des Takts (höchstens ein Kommando).
    if (input.command) {
      const actor = this.actors.find((a) => a.id === input.command!.actorId);
      if (actor && actor.side === 'party' && actor.ready && actor.hp > 0) {
        actor.ready = false;
        actor.atb = 0;
        actor.defending = false;
        this.queue.push({ actorId: actor.id, command: input.command.command });
      }
    }

    // 2. ATB-Füllung (deterministische Reihenfolge = Aufstellungsreihenfolge).
    for (const a of this.actors) {
      if (a.hp <= 0 || a.ready || this.hasQueued(a.id)) continue;
      a.atb = Math.min(ATB_MAX, a.atb + this.formulas.atbGainPerTick(a.stats));
      if (a.atb >= ATB_MAX) {
        if (a.side === 'party') {
          a.ready = true;
          events.push({ kind: 'ready', actorId: a.id });
        } else {
          this.enemyDecide(a, aiFaults);
        }
      }
    }

    // 3. Genau eine Aktion je Takt ausführen (stabile FIFO-Ordnung).
    const action = this.queue.shift();
    if (action) this.execute(action, events);

    // 4. Ausgang prüfen.
    this.checkOutcome(events);

    return {
      tick: this.tickCount,
      events,
      awaitingInput: this.actors.filter((a) => a.side === 'party' && a.ready && a.hp > 0).map((a) => a.id),
      aiFaults,
      outcome: this.outcome,
    };
  }

  private hasQueued(actorId: string): boolean {
    return this.queue.some((q) => q.actorId === actorId);
  }

  private enemyDecide(actor: ActorState, aiFaults: AiFault[]): void {
    actor.atb = 0;
    let attackId: number | null = null;
    if (actor.aiScript) {
      const mainIndex = actor.aiScript.handlerOffsets.findIndex((o) => o !== null);
      if (mainIndex >= 0) {
        const result = runAiHandler(actor.aiScript, mainIndex, this.aiMemory, {
          budget: this.aiBudget,
          rng: () => {
            this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
            return this.rngState >>> 16;
          },
        });
        aiFaults.push(...result.faults);
        const withKnownAttack = result.actions.find((a) => this.attackTable.has(a.attackId) || actor.attackIds.includes(a.attackId));
        if (withKnownAttack) attackId = withKnownAttack.attackId;
        else if (result.actions.length > 0) attackId = result.actions[0]!.attackId;
      }
    }
    // 🔵 Rückfallpfad: ohne (verwertbare) KI-Wahl die erste belegte Attacke.
    if (attackId === null) attackId = actor.attackIds[0] ?? -1;
    const target = this.pickTarget('party');
    if (target === null) return;
    this.queue.push({ actorId: actor.id, command: { kind: 'enemy-attack', attackId, targetId: target } });
  }

  /** Zielwahl 🔵: gleichverteilt über lebende Ziele (PRNG-Wurf, im Snapshot). */
  private pickTarget(side: 'party' | 'enemy'): string | null {
    const alive = this.actors.filter((a) => a.side === side && a.hp > 0);
    if (alive.length === 0) return null;
    return alive[this.roll256() % alive.length]!.id;
  }

  private execute(action: QueuedAction, events: BattleEvent[]): void {
    const actor = this.actors.find((a) => a.id === action.actorId);
    if (!actor || actor.hp <= 0) return;
    const cmd = action.command;
    switch (cmd.kind) {
      case 'defend':
        actor.defending = true;
        events.push({ kind: 'defend', actorId: actor.id });
        break;
      case 'escape': {
        if (!this.escapable) {
          events.push({ kind: 'escape-attempt', actorId: actor.id, success: false });
          break;
        }
        const threshold = this.formulas.escapeThreshold(
          actor.stats,
          this.actors.filter((a) => a.side === 'enemy' && a.hp > 0).map((a) => a.stats),
        );
        const success = this.roll256() < threshold;
        events.push({ kind: 'escape-attempt', actorId: actor.id, success });
        if (success) {
          this.outcome = { kind: 'escape' };
          events.push({ kind: 'outcome', outcome: this.outcome });
        }
        break;
      }
      case 'item': {
        const item = this.items.get(cmd.itemId);
        const target = this.actors.find((a) => a.id === cmd.targetId);
        if (item && target && target.hp > 0) {
          const amount = Math.min(item.healHp, target.maxHp - target.hp);
          target.hp += amount;
          events.push({ kind: 'heal', actorId: actor.id, targetId: target.id, amount });
        }
        break;
      }
      case 'attack':
      case 'enemy-attack': {
        let targetId = cmd.kind === 'attack' ? cmd.targetId : cmd.targetId;
        let target = this.actors.find((a) => a.id === targetId);
        if (!target || target.hp <= 0) {
          // Ziel bereits gefallen: deterministisch umlenken.
          const fallback = this.pickTarget(actor.side === 'party' ? 'enemy' : 'party');
          if (fallback === null) return;
          target = this.actors.find((a) => a.id === fallback)!;
          targetId = fallback;
        }
        const attackId = cmd.kind === 'enemy-attack' && cmd.attackId >= 0 ? cmd.attackId : null;
        const spec: AttackSpec = (attackId !== null ? this.attackTable.get(attackId) : undefined) ?? {
          mpCost: 0,
          accuracy: 224,
          power: 16,
        };
        if (spec.mpCost > 0 && actor.mp >= spec.mpCost) actor.mp -= spec.mpCost;
        const hit = this.formulas.hits(spec.accuracy, actor.stats, target.stats, this.roll256());
        let damage = 0;
        if (hit) {
          const base = spec.magical
            ? this.formulas.magicalDamage(actor.stats, target.stats, spec.power)
            : this.formulas.physicalDamage(actor.stats, target.stats, spec.power);
          damage = applyVariance(base, this.formulas.varianceNumerator(this.roll256()));
          if (target.defending) damage = Math.max(1, damage >> 1);
          target.hp = Math.max(0, target.hp - damage);
        }
        events.push({ kind: 'action', actorId: actor.id, targetId, attackId, damage, hit });
        if (target.hp === 0) events.push({ kind: 'death', actorId: target.id });
        break;
      }
    }
  }

  private checkOutcome(events: BattleEvent[]): void {
    if (this.outcome) return;
    const enemiesAlive = this.actors.some((a) => a.side === 'enemy' && a.hp > 0);
    const partyAlive = this.actors.some((a) => a.side === 'party' && a.hp > 0);
    if (!enemiesAlive) {
      const dead = this.actors.filter((a) => a.side === 'enemy');
      // 🔵 Beutewurf am Siegzeitpunkt, mit dem Sitzungs-PRNG (im Snapshot —
      // Replay-identisch). Ratensemantik des Originals unbelegt; Regel:
      // roll256 < rate, in Aufstellungs- und Slot-Reihenfolge.
      const drops: number[] = [];
      for (const a of dead) {
        for (const d of a.drops) {
          if (d.itemId === 0xffff) continue;
          if (this.roll256() < d.rate) drops.push(d.itemId);
        }
      }
      this.outcome = {
        kind: 'victory',
        exp: dead.reduce((s, a) => s + a.exp, 0),
        ap: dead.reduce((s, a) => s + a.ap, 0),
        gil: dead.reduce((s, a) => s + a.gil, 0),
        defeatedEnemyTypeIds: dead.map((a) => a.enemyTypeId ?? -1),
        drops,
      };
      events.push({ kind: 'outcome', outcome: this.outcome });
    } else if (!partyAlive) {
      this.outcome = { kind: 'defeat' };
      events.push({ kind: 'outcome', outcome: this.outcome });
    }
  }

  snapshot(): BattleSnapshot {
    return {
      schemaVersion: 1,
      tick: this.tickCount,
      rngState: this.rngState,
      actors: this.actors.map((a) => ({
        id: a.id,
        hp: a.hp,
        mp: a.mp,
        atb: a.atb,
        defending: a.defending,
        ready: a.ready,
      })),
      queue: structuredClone(this.queue),
      aiMemory: [...this.aiMemory.cells.entries()],
      outcome: this.outcome ? structuredClone(this.outcome) : null,
    };
  }

  restore(snapshot: BattleSnapshot): void {
    if (snapshot.schemaVersion !== 1) throw new Error(`BattleSnapshot schemaVersion ${snapshot.schemaVersion} unbekannt`);
    this.tickCount = snapshot.tick;
    this.rngState = snapshot.rngState >>> 0;
    for (const s of snapshot.actors) {
      const a = this.actors.find((x) => x.id === s.id);
      if (!a) throw new Error(`Snapshot nennt unbekannten Akteur ${s.id}`);
      a.hp = s.hp;
      a.mp = s.mp;
      a.atb = s.atb;
      a.defending = s.defending;
      a.ready = s.ready;
    }
    this.queue = structuredClone(snapshot.queue);
    this.aiMemory.cells.clear();
    for (const [k, v] of snapshot.aiMemory) this.aiMemory.cells.set(k, v);
    this.outcome = snapshot.outcome ? structuredClone(snapshot.outcome) : null;
  }

  digest(): string {
    return fnv1a64HexOfString(canonicalJson(this.snapshot()));
  }
}

/**
 * Baut die Kampfkonfiguration aus einer geparsten Szene + Formationsindex —
 * die Aufstellung kommt AUS DEN DATEN (Roadmap-S32-Grundsatz), hier bereits
 * für die headless Runtime: Gegnerinstanzen in Slot-Reihenfolge.
 */
export function battleConfigFromScene(
  scene: BattleScene,
  formationIndex: number,
  party: PartyMemberSpec[],
  options: { seed?: number; formulas?: FormulaSet } = {},
): BattleConfig {
  const formation = scene.formations[formationIndex];
  if (!formation) throw new Error(`Formation ${formationIndex} existiert nicht`);
  const enemies: EnemyInstanceSpec[] = [];
  for (const slot of formation.slots) {
    if (slot.enemyTypeId === 0xffff) continue;
    const typeIndex = scene.enemyTypeIds.indexOf(slot.enemyTypeId);
    const record = typeIndex >= 0 ? scene.enemies[typeIndex] : null;
    if (!record) continue;
    // 🟡 itemRaw-Deutung (Community): 4×u8 Raten + 4×u16 Item-IDs; 0xFFFF = leer.
    const itemView = new DataView(record.itemRaw.buffer, record.itemRaw.byteOffset, record.itemRaw.byteLength);
    const drops: { rate: number; itemId: number }[] = [];
    for (let d = 0; d < 4; d++) {
      const itemId = itemView.getUint16(4 + d * 2, true);
      if (itemId !== 0xffff) drops.push({ rate: record.itemRaw[d]!, itemId });
    }
    enemies.push({
      enemyTypeId: slot.enemyTypeId,
      level: record.level,
      maxHp: record.hp,
      mp: record.mp,
      stats: fromEnemyRecordStats(record.statsRaw),
      attackIds: [...record.attackIds],
      aiScript: (typeIndex >= 0 ? scene.enemyAiScripts[typeIndex] : null) ?? null,
      exp: record.exp,
      ap: record.ap,
      gil: record.gil,
      drops,
    });
  }
  const attackTable = new Map<number, AttackSpec>();
  for (let i = 0; i < scene.attackIds.length; i++) {
    const id = scene.attackIds[i]!;
    if (id === 0xffff) continue;
    const rec = scene.attacks[i]!;
    attackTable.set(id, {
      mpCost: rec.mpCost,
      // 🟡 accuracy aus dem Record; 0 gilt als „nicht gepflegt" → sicherer Treffer.
      accuracy: rec.accuracy === 0 ? 255 : rec.accuracy,
      power: 16,
    });
  }
  const cfg: BattleConfig = { party, enemies, attackTable };
  if (options.seed !== undefined) cfg.seed = options.seed;
  if (options.formulas !== undefined) cfg.formulas = options.formulas;
  return cfg;
}
