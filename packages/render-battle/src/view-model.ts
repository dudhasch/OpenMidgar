import type { BattleEvent, BattleSession, BattleTickResult } from '@webmidgar/battle-runtime';

/**
 * BattleViewModel (S32) — die WIRKUNGSFREIE Projektionsschicht.
 *
 * Erste Abnahme des Bogens (Roadmap): „Die Präsentation ist wirkungsfrei —
 * der Digest des Kampfverlaufs ist mit und ohne Renderer identisch." Diese
 * Klasse erzwingt das strukturell: Sie hält KEINE Referenz auf die Session,
 * sondern konsumiert ausschließlich die Tick-ERGEBNISSE (Daten) und einen
 * einmaligen Anfangszustand. Es existiert kein Rückkanal.
 *
 * Effekt-Politik (Roadmap S32): Für KEINEN Zauber ist eine Darstellung aus
 * `magic.lgp` belegt (Formatlage 🔴) — die Abdeckungsquote ist damit ehrlich
 * 0 %, JEDE Aktion bekommt die dokumentierte Ersatzdarstellung (Blitzrahmen
 * + Trefferzahl). Das ist ein berichtetes Ergebnis, kein Makel.
 */

export interface ViewActor {
  id: string;
  side: 'party' | 'enemy';
  hp: number;
  maxHp: number;
  mp: number;
  alive: boolean;
}

export interface FloatingNumber {
  actorId: string;
  amount: number;
  kind: 'damage' | 'heal' | 'miss';
  /** Verbleibende Anzeige-Takte (reine Daten — der Renderer zählt nicht selbst). */
  ticksLeft: number;
}

export interface EffectFlash {
  actorId: string;
  /** 🔵 Ersatzdarstellung: Aufhellen des Ziels für n Takte. */
  ticksLeft: number;
}

export interface BattleViewState {
  tick: number;
  actors: ViewActor[];
  floating: FloatingNumber[];
  flashes: EffectFlash[];
  awaitingInput: string[];
  outcomeKind: string | null;
  /** Effektabdeckung als berichtete Quote (belegt/gesamt). */
  effectCoverage: { covered: number; substituted: number };
}

const FLOAT_TICKS = 45;
const FLASH_TICKS = 12;

export class BattleViewModel {
  private state: BattleViewState;

  constructor(initialActors: { id: string; side: 'party' | 'enemy'; hp: number; maxHp: number; mp: number }[]) {
    this.state = {
      tick: 0,
      actors: initialActors.map((a) => ({ ...a, alive: a.hp > 0 })),
      floating: [],
      flashes: [],
      awaitingInput: [],
      outcomeKind: null,
      effectCoverage: { covered: 0, substituted: 0 },
    };
  }

  /** Bequemer Anfangszustand direkt aus der Session (nur Lesezugriff). */
  static fromSession(session: BattleSession, actorIds: { id: string; maxHp: number; maxMp: number }[]): BattleViewModel {
    return new BattleViewModel(
      actorIds.map((spec) => {
        const a = session.actor(spec.id)!;
        return { id: a.id, side: a.side, hp: a.hp, maxHp: spec.maxHp, mp: a.mp };
      }),
    );
  }

  applyTick(result: BattleTickResult): void {
    const s = this.state;
    s.tick = result.tick;
    s.awaitingInput = [...result.awaitingInput];
    for (const f of s.floating) f.ticksLeft--;
    for (const f of s.flashes) f.ticksLeft--;
    s.floating = s.floating.filter((f) => f.ticksLeft > 0);
    s.flashes = s.flashes.filter((f) => f.ticksLeft > 0);
    for (const ev of result.events) this.applyEvent(ev);
    if (result.outcome) s.outcomeKind = result.outcome.kind;
  }

  private applyEvent(ev: BattleEvent): void {
    const s = this.state;
    switch (ev.kind) {
      case 'action': {
        const target = s.actors.find((a) => a.id === ev.targetId);
        if (target && ev.hit) {
          target.hp = Math.max(0, target.hp - ev.damage);
          s.floating.push({ actorId: ev.targetId, amount: ev.damage, kind: 'damage', ticksLeft: FLOAT_TICKS });
        } else {
          s.floating.push({ actorId: ev.targetId, amount: 0, kind: 'miss', ticksLeft: FLOAT_TICKS });
        }
        // Ersatzdarstellung für JEDE Aktion (Effektabdeckung 0 % belegt).
        s.flashes.push({ actorId: ev.targetId, ticksLeft: FLASH_TICKS });
        s.effectCoverage.substituted++;
        break;
      }
      case 'heal': {
        const target = s.actors.find((a) => a.id === ev.targetId);
        if (target) target.hp = Math.min(target.maxHp, target.hp + ev.amount);
        s.floating.push({ actorId: ev.targetId, amount: ev.amount, kind: 'heal', ticksLeft: FLOAT_TICKS });
        break;
      }
      case 'death': {
        const target = s.actors.find((a) => a.id === ev.actorId);
        if (target) {
          target.alive = false;
          target.hp = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  get view(): Readonly<BattleViewState> {
    return this.state;
  }
}
