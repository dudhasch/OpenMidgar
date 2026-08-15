import { byteAngleToDegrees } from './angles.js';
import { CMP, evalComparison, IMPL_OPERAND_LEN, OP, OP_KAWAI, SKIP_OPERAND_LEN, type OpCategory } from './opcodes.js';
import type { PreparedScript } from './prepared.js';
import {
  createActor,
  nextRandom,
  readBank,
  writeBank,
  type ActorRuntime,
  type FieldRuntimeState,
  type ScriptContext,
} from './state.js';
import { fnv1a32 } from './digest.js';
import type { TraceSink } from './trace.js';

/**
 * VM-Kern: führt genau EINE Instruktion eines Kontexts aus. Scheduling,
 * Budget und Event-Zustellung liegen im Runtime-Modul — die VM mutiert nur
 * Kontext- und Bankzustand und meldet das Ergebnis als Daten.
 *
 * 🟡 Sprungbasis-Konvention (`Zu validieren`, R1-Notiz): Sprungziel =
 * Adresse des Offset-Operanden ± Offset. Der Fixture-Assembler spiegelt
 * exakt diese Konvention; Realverhalten wird später differenziell geprüft.
 */

export type StepOutcome =
  | { kind: 'continue' }
  | { kind: 'yield' }
  | { kind: 'completed' }
  | { kind: 'faulted' }
  | { kind: 'request'; target: number; slot: number; priority: number; mode: 'async' | 'async-guaranteed' | 'sync' }
  | { kind: 'retto'; slot: number; priority: number };

function fault(
  rt: FieldRuntimeState,
  ctx: ScriptContext,
  reason: 'unknown-op' | 'budget' | 'data' | 'unknown-comparison',
  op: number,
  detail: string,
): StepOutcome {
  ctx.status = 'faulted';
  ctx.faultInfo = { reason, op, ip: ctx.ip, tick: rt.tickCounter, detail };
  return { kind: 'faulted' };
}

/** 🟡 Prioritäts-/Slot-Packung des REQ-Operanden: hohe 3 Bits Priorität. */
export function unpackRequestOperand(byte: number): { priority: number; slot: number } {
  return { priority: (byte >> 5) & 0x07, slot: byte & 0x1f };
}

const asSigned16 = (v: number): number => (v << 16) >> 16;
const signed16 = asSigned16;

/**
 * Actor-Zustand der ausfuehrenden Entitaet; wird bei Bedarf angelegt, damit
 * aeltere Snapshots ohne `actors`-Feld weiterhin restaurierbar bleiben.
 */
function actor(rt: FieldRuntimeState, ctx: ScriptContext): ActorRuntime {
  rt.actors ??= [];
  const existing = rt.actors[ctx.entityIndex];
  if (existing) return existing;
  const fresh = createActor();
  rt.actors[ctx.entityIndex] = fresh;
  return fresh;
}

export function stepInstruction(
  rt: FieldRuntimeState,
  ctx: ScriptContext,
  script: PreparedScript,
  trace: TraceSink,
): StepOutcome {
  const { code, codeEnd } = script;
  if (ctx.ip === codeEnd) {
    // Leerer Span (Entry == codeEnd, realdaten-validierter Sentinel).
    ctx.status = 'completed';
    return { kind: 'completed' };
  }
  if (ctx.ip < script.dataStart || ctx.ip > codeEnd) {
    return fault(rt, ctx, 'data', -1, `ip ${ctx.ip} außerhalb [${script.dataStart}, ${codeEnd}]`);
  }
  const op = code[ctx.ip]!;

  // Operandenlänge bestimmen (implementiert → Tabelle; sonst UNKNOWN-Politik).
  let operandLen = IMPL_OPERAND_LEN[op];
  let category: OpCategory;
  if (operandLen !== undefined) {
    category =
      op === OP.MENU || op === OP.MENU2
        ? 'menu'
        : op >= 0x76
          ? 'variable'
          : op >= 0x40
            ? 'dialog'
            : 'control';
  } else if (op === OP_KAWAI) {
    const total = ctx.ip + 1 < codeEnd ? code[ctx.ip + 1]! : 0;
    if (total < 2 || ctx.ip + total > codeEnd) {
      return fault(rt, ctx, 'data', op, `KAWAI-Länge ${total} unplausibel`);
    }
    operandLen = total - 1;
    category = 'unknown-skipped';
  } else if (SKIP_OPERAND_LEN[op] !== undefined) {
    operandLen = SKIP_OPERAND_LEN[op]!;
    category = 'unknown-skipped';
  } else {
    trace.record({ tick: rt.tickCounter, entityIndex: ctx.entityIndex, slot: ctx.slot, ip: ctx.ip, op, category: 'unknown-fault', operandsDigest: 0 });
    return fault(rt, ctx, 'unknown-op', op, `Opcode 0x${op.toString(16)} ohne bekannte Länge`);
  }

  if (ctx.ip + 1 + operandLen > codeEnd) {
    return fault(rt, ctx, 'data', op, `Operanden überschreiten Bytecode-Ende`);
  }
  const args = code.subarray(ctx.ip + 1, ctx.ip + 1 + operandLen);
  trace.record({
    tick: rt.tickCounter,
    entityIndex: ctx.entityIndex,
    slot: ctx.slot,
    ip: ctx.ip,
    op,
    category,
    operandsDigest: fnv1a32(args),
  });
  const next = ctx.ip + 1 + operandLen;

  // UNKNOWN-Politik Stufe „Länge bekannt": überspringen + zählen.
  if (category === 'unknown-skipped') {
    rt.unknownSkips[op] = (rt.unknownSkips[op] ?? 0) + 1;
    ctx.ip = next;
    return { kind: 'continue' };
  }

  const u8 = (i: number): number => args[i]!;
  const u16 = (i: number): number => args[i]! | (args[i + 1]! << 8);
  /** Operandenwert: Bank 0 ⇒ Literal, sonst Bankzugriff (Adresse = raw & 0xff). */
  const srcValue = (bank: number, raw: number, word: boolean): number =>
    bank === 0 ? raw : readBank(rt, bank, raw & 0xff, word);
  const jumpForward = (argOffset: number, offset: number): number => ctx.ip + 1 + argOffset + offset;
  /**
   * ✅ **O11 behoben (2026-08-15, Welle 4).** Rückwärtssprünge zählen vom
   * **Opcode-Byte**, nicht vom Operandenbyte: `ip − offset`.
   *
   * Der Beleg ist eine Trefferquote auf echten Daten mit geeichter Messanlage:
   * Über alle 5286 im Instruktionsstrom erreichten `JMPB` des Bestands landet
   * `ip − offset` in **5266 Fällen (99,6 %)** auf einer Instruktionsgrenze,
   * die frühere Rechnung `ip + 1 − offset` in **39 (0,7 %)**; bei `JMPBL`
   * 97/97 gegen 0/97. Geeicht ist die Anlage an den Vorwärtssprüngen, wo die
   * unveränderte Rechnung `ip + 1 + offset` 7809/7876 (99,1 %) trifft und die
   * um eins verschobene nur 974/7876. Vorwärts war richtig, rückwärts um genau
   * ein Byte daneben.
   *
   * **In einem Zug mit `tools/fixture-gen/src/script-assembler.ts` korrigiert.**
   * Der Assembler kodierte Rücksprünge mit derselben falschen Konvention; beide
   * Seiten waren konsistent falsch, weshalb keine Fixture-Schleife aufgefallen
   * war. Eine einseitige Korrektur hätte jede Fixture-Schleife zerrissen.
   */
  const jumpBackward = (argOffset: number, offset: number): number => ctx.ip + argOffset - offset;

  switch (op) {
    case OP.RET: {
      const back = ctx.callStack.pop();
      if (back !== undefined) {
        ctx.ip = back;
        return { kind: 'continue' };
      }
      ctx.status = 'completed';
      return { kind: 'completed' };
    }
    case OP.REQ:
    case OP.REQSW:
    case OP.REQEW: {
      const target = u8(0);
      const { priority, slot } = unpackRequestOperand(u8(1));
      ctx.ip = next;
      const mode = op === OP.REQ ? 'async' : op === OP.REQSW ? 'async-guaranteed' : 'sync';
      return { kind: 'request', target, slot, priority, mode };
    }
    case OP.RETTO: {
      const { priority, slot } = unpackRequestOperand(u8(0));
      ctx.ip = next;
      return { kind: 'retto', slot, priority };
    }
    case OP.JMPF:
      ctx.ip = jumpForward(0, u8(0));
      return { kind: 'continue' };
    case OP.JMPFL:
      ctx.ip = jumpForward(0, u16(0));
      return { kind: 'continue' };
    case OP.JMPB:
      ctx.ip = jumpBackward(0, u8(0));
      return { kind: 'continue' };
    case OP.JMPBL:
      ctx.ip = jumpBackward(0, u16(0));
      return { kind: 'continue' };
    case OP.IFUB:
    case OP.IFUBL:
    case OP.IFSW:
    case OP.IFSWL:
    case OP.IFUW:
    case OP.IFUWL: {
      const word = op >= OP.IFSW;
      const longJump = op === OP.IFUBL || op === OP.IFSWL || op === OP.IFUWL;
      const bankPair = u8(0);
      // O9: Bei den Wort-Varianten ist die LINKE Seite ebenfalls zwei Byte
      // breit — beide Seiten haben dieselbe Form. Vorher wurde links ein Byte
      // gelesen, wodurch alles danach um eine Stelle verrutschte.
      const rawLeft = word ? u16(1) : u8(1);
      const valueAt = word ? 3 : 2;
      const rawValue = word ? u16(valueAt) : u8(valueAt);
      const cmpAt = word ? 5 : 3;
      const cmpOp = u8(cmpAt);
      const jumpArgAt = cmpAt + 1;
      const jump = longJump ? u16(jumpArgAt) : u8(jumpArgAt);
      // Beide Seiten laufen jetzt über dieselbe Quellenregel (Bank 0 ⇒ Literal).
      let a = srcValue((bankPair >> 4) & 0xf, rawLeft, word);
      let b = srcValue(bankPair & 0xf, rawValue, word);
      if (op === OP.IFSW || op === OP.IFSWL) {
        a = asSigned16(a);
        b = asSigned16(b);
      }
      const result = evalComparison(a, b, cmpOp);
      if (result === null) {
        return fault(rt, ctx, 'unknown-comparison', op, `Vergleichsoperator ${cmpOp}`);
      }
      ctx.ip = result ? next : jumpForward(jumpArgAt, jump);
      return { kind: 'continue' };
    }
    case OP.WAIT: {
      // 🟡 WAIT 0: als „bis zum nächsten Tick" interpretiert (`Zu validieren`).
      const ticks = Math.max(1, u16(0));
      ctx.ip = next;
      ctx.waitState = { kind: 'ticks', untilTick: rt.tickCounter + ticks };
      return { kind: 'yield' };
    }
    case OP.MESSAGE: {
      // Operanden: Fenster-ID, String-Index — dieselbe Belegung, die der
      // Fixture-Assembler unabhängig spiegelt (`message(windowId, dialogId)`).
      const requestId = rt.nextRequestId++;
      ctx.ip = next;
      ctx.waitState = { kind: 'dialogue', requestId, dialogId: u8(1), choice: undefined };
      return { kind: 'yield' };
    }
    case OP.ASK: {
      // 🟡 Operandenbelegung (B, Fenster, Dialog, erste/letzte Zeile, Adresse).
      const bankPair = u8(0);
      const dialogId = u8(2);
      const firstChoice = u8(3);
      const lastChoice = u8(4);
      const addr = u8(5);
      const requestId = rt.nextRequestId++;
      ctx.ip = next;
      ctx.waitState = {
        kind: 'dialogue',
        requestId,
        dialogId,
        firstChoice,
        lastChoice,
        choice: { bank: (bankPair >> 4) & 0xf || 1, addr },
      };
      return { kind: 'yield' };
    }
    case OP.MENU: {
      // Das Menü ist eine Wirkung nach außen — wie Musik und Kampf wird es
      // eingereiht, nicht ausgeführt (ADR-006). Der Kontext wartet, weil das
      // Original das Skript anhält, solange das Menü offen ist.
      const bankPair = u8(0);
      const requestId = rt.nextRequestId++;
      rt.hostRequests.push({
        kind: 'menu',
        selector: srcValue((bankPair >> 4) & 0xf, u8(1), false),
        param: srcValue(bankPair & 0xf, u8(2), false),
        requestId,
      });
      ctx.ip = next;
      ctx.waitState = { kind: 'menu', requestId };
      return { kind: 'yield' };
    }
    case OP.MENU2: {
      // 🟡 Rohwert, keine Deutung: Der Operand nimmt sechs verschiedene Werte
      // an und ist damit nachweislich keine Ja/Nein-Angabe.
      rt.menuAccessRaw = u8(0);
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.WINDOW:
    case OP.WMODE:
      // Dialog-Stub: Fensterverwaltung ist UI-Sache — hier nur Trace, kein Yield.
      ctx.ip = next;
      return { kind: 'continue' };

    // --- Entität & Bewegung (S12) --------------------------------------------
    // Alle diese Ops schreiben ausschließlich in den Actor-Zustand. Wo eine
    // Bewegung ausgeführt werden muss, setzt der Interpreter nur den Auftrag
    // und wartet; ausgeführt wird sie vom Host mit dem Walkmesh-Solver. So
    // bleibt der Solver die einzige Instanz, die über Begehbarkeit urteilt.
    case OP.PC: {
      actor(rt, ctx).partyMember = u8(0);
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.CHAR: {
      actor(rt, ctx).modelIndex = u8(0);
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.VISI: {
      actor(rt, ctx).visible = u8(0) !== 0;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.DFANM:
    case OP.ANIME1: {
      // 🟡 Operanden: Animations-ID, Geschwindigkeit (`Zu validieren`).
      actor(rt, ctx).animation = { id: u8(0), speed: u8(1), loop: op === OP.DFANM };
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.DIR: {
      // Operanden: Bank-Byte + u8 Richtung (Referenzstruktur { banks,
      // direction }; Länge 2 auch aus den Realdaten abgeleitet).
      //
      // Der Operand ist ein **Byte-Winkel**, kein Gradwert:
      // `Script_OpSetDirection` (0x00618062) liest ihn mit
      // `Script_ReadOperand8` und legt ihn als `char` in `model+0x38`
      // (`displayHeading`) ab — ohne jede Umrechnung. Dasselbe Feld speist die
      // Modelldrehung, und seine Null zeigt nach −Y (s. `angles.ts`).
      //
      // Bis hierher haben wir den Rohwert als Grad übernommen. Das verdrehte
      // jede vom Skript gesetzte Figur um 90° und stauchte den Kreis auf
      // 256/360 — sichtbar an NPCs, die im Dialog in die falsche Richtung
      // schauen.
      const bankPair = u8(0);
      const value = srcValue(bankPair & 0xf, u8(1), false);
      actor(rt, ctx).direction = byteAngleToDegrees(value);
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.XYZI: {
      // 🟡 Feldaufteilung: 2 Bankpaarbytes, i16 x/y/z, u16 Dreiecksindex.
      // Realdaten-geprüft über „Dreiecksindex muss im Walkmesh existieren".
      const bp1 = u8(0);
      const bp2 = u8(1);
      const a = actor(rt, ctx);
      a.position = [
        signed16(srcValue((bp1 >> 4) & 0xf, u16(2), true)),
        signed16(srcValue(bp1 & 0xf, u16(4), true)),
        signed16(srcValue((bp2 >> 4) & 0xf, u16(6), true)),
      ];
      a.triangle = srcValue(bp2 & 0xf, u16(8), true);
      // Ein Sprung an eine feste Position beendet einen laufenden Auftrag.
      a.moveTarget = null;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.XYI: {
      // Aufteilung wie XYZI, nur ohne Höhe: 2 Bankpaarbytes, i16 x/y,
      // u16 Dreiecksindex (realdaten-belegt, Nachweis in `opcodes.ts`).
      //
      // 🟡 **Die Höhe bleibt unverändert.** Das ist die einzige Auslegung, die
      // ohne Zusatzannahme auskommt: Der Opcode nennt kein z, also darf er
      // keines setzen. War die Entität noch nie platziert, gibt es auch kein
      // vorheriges z — dann steht dort 0, und der Walkmesh-Solver des Wirts
      // korrigiert die Höhe über den Dreiecksindex, der hier mitgeliefert wird.
      const bp1 = u8(0);
      const bp2 = u8(1);
      const a = actor(rt, ctx);
      a.position = [
        signed16(srcValue((bp1 >> 4) & 0xf, u16(2), true)),
        signed16(srcValue(bp1 & 0xf, u16(4), true)),
        a.position?.[2] ?? 0,
      ];
      a.triangle = srcValue((bp2 >> 4) & 0xf, u16(6), true);
      a.moveTarget = null;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.XYZ: {
      // 2 Bankpaarbytes, i16 x/y/z — kein Dreiecksindex.
      //
      // 🟡 **Das Dreieck bleibt unverändert.** Dieselbe Begründung wie bei XYI:
      // Der Opcode nennt keines. Ein Rücksetzen auf null würde dem Wirt die
      // einzige Information nehmen, aus der er die Bodenhöhe bestimmt — und
      // hier ist die Höhe ja explizit angegeben, also ist die Position auch
      // ohne Dreiecksangabe vollständig.
      const bp1 = u8(0);
      const bp2 = u8(1);
      const a = actor(rt, ctx);
      a.position = [
        signed16(srcValue((bp1 >> 4) & 0xf, u16(2), true)),
        signed16(srcValue(bp1 & 0xf, u16(4), true)),
        signed16(srcValue((bp2 >> 4) & 0xf, u16(6), true)),
      ];
      a.moveTarget = null;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.MOVE: {
      // 🟡 Feldaufteilung: Bankpaar + i16 x + i16 y.
      const bankPair = u8(0);
      const a = actor(rt, ctx);
      const requestId = rt.nextRequestId++;
      a.moveTarget = {
        x: signed16(srcValue((bankPair >> 4) & 0xf, u16(1), true)),
        y: signed16(srcValue(bankPair & 0xf, u16(3), true)),
        requestId,
      };
      ctx.ip = next;
      ctx.waitState = { kind: 'movement', requestId };
      return { kind: 'yield' };
    }
    // --- Audio (S17) ----------------------------------------------------------
    // Beide Ops wirken NICHT direkt: sie reihen eine Wirkung ein, die der Host
    // abholt. Audio darf den Tick weder verzögern noch beeinflussen, sonst wäre
    // der Replay nicht mehr bitgenau.
    case OP.MUSIC: {
      rt.hostRequests.push({ kind: 'music', trackId: u8(0) });
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.SOUND: {
      // 🟡 Operanden: Bankpaar, u16 Klang-ID, u8 Panorama (0x00…0x7F, Mitte 0x40).
      const bankPair = u8(0);
      rt.hostRequests.push({
        kind: 'sound',
        soundId: srcValue((bankPair >> 4) & 0xf, u16(1), true),
        pan: srcValue(bankPair & 0xf, u8(3), false),
      });
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.MAPJUMP: {
      // 🟡 Nur der Zielfield-Index (u16@0) ist belegt; die restlichen 7 Bytes
      // tragen vermutlich Zielposition und Blickrichtung und bleiben roh.
      const requestId = rt.nextRequestId++;
      rt.hostRequests.push({ kind: 'field-change', maplistIndex: u16(0), requestId });
      ctx.ip = next;
      // Der Kontext wartet: Ein Field-Wechsel beendet die Welt, in der er läuft.
      ctx.waitState = { kind: 'transition' };
      return { kind: 'yield' };
    }
    case OP.BATTLE: {
      // Bank-Byte in der unteren Hälfte adressiert die Formationsnummer;
      // 0 bedeutet Literal (im Bestand 173 von 184 Vorkommen).
      const encounterId = srcValue(u8(0) & 0xf, u16(1), true);
      const requestId = rt.nextRequestId++;
      rt.hostRequests.push({ kind: 'battle', encounterId, requestId });
      ctx.ip = next;
      // Der Kontext wartet auf das Kampfergebnis; der Wirt meldet es über
      // `battle-finished` zurück (Vertrag aus ADR-011, jetzt erstmals genutzt).
      ctx.waitState = { kind: 'battle', requestId };
      return { kind: 'yield' };
    }
    case OP.BTLON: {
      // Zufallskämpfe an/aus. 🟡 Die Polarität ist nicht belegt; der Wert wird
      // roh mitgeführt, damit der Wirt entscheidet, statt hier zu raten.
      rt.randomEncountersDisabled = u8(0) !== 0;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.BGON:
    case OP.BGOFF: {
      // 🟢 Makou (Script::backgroundParams): Operanden = Bankpaar, param,
      // state; BGON setzt Bit `1 << state`, BGOFF löscht es. Der Host liest
      // `bgStates` je Takt und schaltet die Tile-Zustände (F22).
      const banks = u8(0);
      const param = srcValue(banks >> 4, u8(1), false);
      const state = srcValue(banks & 0xf, u8(2), false);
      const bit = 1 << (state & 31);
      const alt = rt.bgStates[param] ?? 0;
      rt.bgStates[param] = op === OP.BGON ? alt | bit : alt & ~bit;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.BGCLR: {
      const banks = u8(0);
      const param = srcValue(banks >> 4, u8(1), false);
      rt.bgStates[param] = 0;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    case OP.BGROL:
    case OP.BGROL2: {
      // Operanden: Bankpaar, param — dieselbe Form wie BGCLR (Länge 2 belegt,
      // s. `opcodes.ts`). BGROL schaltet die Zustandsmaske der Gruppe einen
      // Schritt weiter, BGROL2 einen zurück.
      //
      // 🟡 **Entscheidung, die die Daten nicht hergeben.** „Weiterschalten"
      // kann zweierlei heißen:
      //   (a) die Maske um ein Bit **rotieren**, oder
      //   (b) auf den nächsten Zustand springen, der im Hintergrund dieses
      //       Fields **tatsächlich vorkommt** (Lücken überspringen).
      // In `hyou4` — dem einzigen Field, das nach den Längenkorrekturen BGROL
      // belegt benutzt — fallen beide zusammen, weil dort die Bits 0…5
      // lückenlos belegt sind. Korpusweit gibt es zwar 195 Kachelgruppen in
      // 109 Fields mit Lücke oder ohne Bit 0, aber **keine davon liegt in
      // einem Field, das BGROL benutzt**. Die Frage ist an diesem Bestand
      // also nicht entscheidbar; gewählt ist (a) als die einfachere Regel.
      // Für (b) läge der Weg bereit: `berechneAnfangsBgStates` in `state.ts`
      // liest die vorkommenden Zustände je Parameter bereits aus dem Bundle,
      // und die Sitzungsoption `initialBgStates` reicht sie herein.
      //
      // 🟢 **Die Rotationsbreite ist gemessen, nicht geraten: 8 Bit.** Der
      // Zustandsoperand von BGON/BGOFF nimmt über 9684 Literalvorkommen genau
      // die Werte 0…7 an und nie mehr; die Kachelzustände sind die acht
      // Zweierpotenzen 1…128. Der Zustandsraum einer Gruppe ist damit exakt
      // ein Byte breit.
      //
      // Eine leere Maske bleibt leer: Ohne gesetzten Zustand gibt es nichts
      // weiterzuschalten, und ein Zustand aus dem Nichts wäre geraten.
      const banks = u8(0);
      const param = srcValue(banks >> 4, u8(1), false);
      const alt = (rt.bgStates[param] ?? 0) & 0xff;
      rt.bgStates[param] =
        op === OP.BGROL ? ((alt << 1) | (alt >>> 7)) & 0xff : ((alt >>> 1) | (alt << 7)) & 0xff;
      ctx.ip = next;
      return { kind: 'continue' };
    }
    default:
      break;
  }

  // --- Variablenkategorie ---------------------------------------------------
  const word = [OP.PLUS2_S, OP.MINUS2_S, OP.INC2_S, OP.DEC2_S, OP.SETWORD, OP.PLUS2, OP.MINUS2, OP.MUL2, OP.DIV2, OP.MOD2, OP.AND2, OP.OR2, OP.XOR2, OP.INC2, OP.DEC2].includes(
    op as never,
  );
  const mask = word ? 0xffff : 0xff;
  const bankPair = u8(0);
  const dstBank = ((bankPair >> 4) & 0xf) || 1; // 🟡 Bank 0 als Ziel: auf Bank 1 normiert
  const dstAddr = u8(1);
  const rhs = (): number => srcValue(bankPair & 0xf, word ? u16(2) : u8(2), word);
  const current = (): number => readBank(rt, dstBank, dstAddr, word);
  const store = (v: number): void => writeBank(rt, dstBank, dstAddr, v & mask, word);
  const storeClamped = (v: number): void => store(Math.min(mask, Math.max(0, v)));

  switch (op) {
    case OP.SETBYTE:
    case OP.SETWORD:
      store(rhs());
      break;
    case OP.BITON:
      store(current() | (1 << (rhs() & 0x1f)));
      break;
    case OP.BITOFF:
      store(current() & ~(1 << (rhs() & 0x1f)));
      break;
    case OP.BITXOR:
      store(current() ^ (1 << (rhs() & 0x1f)));
      break;
    // 🟡 Plain-Arithmetik wickelt (Maske), "!"-Varianten saturieren.
    case OP.PLUS:
    case OP.PLUS2:
      store(current() + rhs());
      break;
    case OP.PLUS_S:
    case OP.PLUS2_S:
      storeClamped(current() + rhs());
      break;
    case OP.MINUS:
    case OP.MINUS2:
      store(current() - rhs() + mask + 1);
      break;
    case OP.MINUS_S:
    case OP.MINUS2_S:
      storeClamped(current() - rhs());
      break;
    case OP.MUL:
    case OP.MUL2:
      store(Math.imul(current(), rhs()));
      break;
    case OP.DIV:
    case OP.DIV2: {
      const d = rhs();
      // 🟡 Division durch 0: Ergebnis 0 statt Fault (`Zu validieren`).
      store(d === 0 ? 0 : Math.floor(current() / d));
      break;
    }
    case OP.MOD:
    case OP.MOD2: {
      const d = rhs();
      store(d === 0 ? 0 : current() % d);
      break;
    }
    case OP.AND:
    case OP.AND2:
      store(current() & rhs());
      break;
    case OP.OR:
    case OP.OR2:
      store(current() | rhs());
      break;
    case OP.XOR:
    case OP.XOR2:
      store(current() ^ rhs());
      break;
    case OP.INC:
    case OP.INC2:
      store(current() + 1);
      break;
    case OP.INC_S:
    case OP.INC2_S:
      storeClamped(current() + 1);
      break;
    case OP.DEC:
    case OP.DEC2:
      store(current() - 1 + mask + 1);
      break;
    case OP.DEC_S:
    case OP.DEC2_S:
      storeClamped(current() - 1);
      break;
    case OP.RANDOM:
      store(Math.floor(nextRandom(rt) * 256) & 0xff);
      break;
    default:
      return fault(rt, ctx, 'unknown-op', op, `implementierte Länge, aber kein Handler`);
  }
  ctx.ip = next;
  return { kind: 'continue' };
}
