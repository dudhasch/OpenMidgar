/**
 * Script-Bytecode-Assembler für Golden Fixtures — bewusst codegetrennt vom
 * Interpreter (Dualitätsprinzip wie LGP-Writer↔Scanner): Encoding-Wissen ist
 * hier unabhängig aus derselben öffentlichen Dokumentation implementiert.
 * Roundtrips Assembler→Interpreter beweisen zwei unabhängige Umsetzungen.
 *
 * Sprungkonvention (muss der Interpreter-Annahme entsprechen, beide 🟡):
 * Ziel = Adresse des Offset-Operanden ± Offset.
 */

export type SrcOperand = number | { bank: number; addr: number };

interface Fragment {
  size: number;
  encode(bytes: Uint8Array, pos: number, labels: Map<string, number>): void;
}

const bankPairOf = (dstBank: number, src: SrcOperand): number =>
  ((dstBank & 0xf) << 4) | (typeof src === 'number' ? 0 : src.bank & 0xf);
const rawOf = (src: SrcOperand): number => (typeof src === 'number' ? src : src.addr);

export class ScriptAssembler {
  private fragments: Fragment[] = [];
  private labels = new Map<string, number>();
  private cursor = 0;

  /** Aktuelle Position als benanntes Sprung-/Entry-Ziel registrieren. */
  label(name: string): this {
    if (this.labels.has(name)) throw new Error(`Label doppelt: ${name}`);
    this.labels.set(name, this.cursor);
    return this;
  }

  private emit(size: number, encode: Fragment['encode']): this {
    this.fragments.push({ size, encode });
    this.cursor += size;
    return this;
  }

  raw(...bytes: number[]): this {
    return this.emit(bytes.length, (out, pos) => out.set(bytes, pos));
  }

  // --- Kontrollfluss ---------------------------------------------------------

  ret(): this {
    return this.raw(0x00);
  }

  private request(op: number, entity: number, slot: number, priority: number): this {
    return this.raw(op, entity, ((priority & 0x07) << 5) | (slot & 0x1f));
  }

  req(entity: number, slot: number, priority: number): this {
    return this.request(0x01, entity, slot, priority);
  }

  reqsw(entity: number, slot: number, priority: number): this {
    return this.request(0x02, entity, slot, priority);
  }

  reqew(entity: number, slot: number, priority: number): this {
    return this.request(0x03, entity, slot, priority);
  }

  retto(slot: number, priority: number): this {
    return this.raw(0x07, ((priority & 0x07) << 5) | (slot & 0x1f));
  }

  private jump(op: number, target: string, wide: boolean, backward: boolean): this {
    const size = wide ? 3 : 2;
    return this.emit(size, (out, pos, labels) => {
      const dest = labels.get(target);
      if (dest === undefined) throw new Error(`Unbekanntes Label: ${target}`);
      const argPos = pos + 1;
      const offset = backward ? argPos - dest : dest - argPos;
      if (offset < 0 || offset > (wide ? 0xffff : 0xff)) {
        throw new Error(`Sprungweite ${offset} außerhalb (${target})`);
      }
      out[pos] = op;
      out[argPos] = offset & 0xff;
      if (wide) out[argPos + 1] = (offset >> 8) & 0xff;
    });
  }

  jmpf(target: string): this {
    return this.jump(0x10, target, false, false);
  }

  jmpfl(target: string): this {
    return this.jump(0x11, target, true, false);
  }

  jmpb(target: string): this {
    return this.jump(0x12, target, false, true);
  }

  jmpbl(target: string): this {
    return this.jump(0x13, target, true, true);
  }

  private ifOp(
    op: number,
    word: boolean,
    wide: boolean,
    bank: number,
    addr: number,
    value: SrcOperand,
    cmp: number,
    elseTarget: string,
  ): this {
    const size = 1 + (word ? 4 : 3) + 1 + (wide ? 2 : 1);
    return this.emit(size, (out, pos, labels) => {
      const dest = labels.get(elseTarget);
      if (dest === undefined) throw new Error(`Unbekanntes Label: ${elseTarget}`);
      out[pos] = op;
      out[pos + 1] = bankPairOf(bank, value);
      out[pos + 2] = addr & 0xff;
      const raw = rawOf(value);
      out[pos + 3] = raw & 0xff;
      let cmpAt = pos + 4;
      if (word) {
        out[pos + 4] = (raw >> 8) & 0xff;
        cmpAt = pos + 5;
      }
      out[cmpAt] = cmp;
      const argPos = cmpAt + 1;
      const offset = dest - argPos;
      if (offset < 0 || offset > (wide ? 0xffff : 0xff)) {
        throw new Error(`Sprungweite ${offset} außerhalb (${elseTarget})`);
      }
      out[argPos] = offset & 0xff;
      if (wide) out[argPos + 1] = (offset >> 8) & 0xff;
    });
  }

  ifub(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x14, false, false, bank, addr, value, cmp, elseTarget);
  }

  ifubl(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x15, false, true, bank, addr, value, cmp, elseTarget);
  }

  ifsw(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x16, true, false, bank, addr, value, cmp, elseTarget);
  }

  ifswl(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x17, true, true, bank, addr, value, cmp, elseTarget);
  }

  ifuw(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x18, true, false, bank, addr, value, cmp, elseTarget);
  }

  ifuwl(bank: number, addr: number, value: SrcOperand, cmp: number, elseTarget: string): this {
    return this.ifOp(0x19, true, true, bank, addr, value, cmp, elseTarget);
  }

  // --- Entität & Bewegung (S12) ---------------------------------------------
  // Operandenlängen sind realdaten-abgeleitet (Spannen-Abschluss); die
  // Feldaufteilung spiegelt die Auslegung des Interpreters — bewusst hier
  // dupliziert, damit Fixtures die Auslegung unabhängig gegenprüfen.

  /** CHAR: bindet die Entität an einen Modellindex des Field-Manifests. */
  char(modelIndex: number): this {
    return this.raw(0xa1, modelIndex & 0xff);
  }

  /** PC: ordnet die Entität einem Partymitglied zu. */
  pc(member: number): this {
    return this.raw(0xa0, member & 0xff);
  }

  /** VISI: Sichtbarkeit. */
  visi(visible: boolean): this {
    return this.raw(0xa4, visible ? 1 : 0);
  }

  /** DFANM (Dauerschleife) bzw. ANIME1 (einmalig). */
  dfanm(animId: number, speed: number, loop = true): this {
    return this.raw(loop ? 0xa2 : 0xa3, animId & 0xff, speed & 0xff);
  }

  /** DIR: Blickrichtung in Grad (Literal). */
  dir(degrees: number): this {
    return this.raw(0xab, 0x00, degrees & 0xff, (degrees >> 8) & 0xff);
  }

  /** XYZI: setzt Position und Walkmesh-Dreieck hart (Literale). */
  xyzi(x: number, y: number, z: number, triangle: number): this {
    return this.raw(
      0xa5,
      0x00,
      0x00,
      x & 0xff,
      (x >> 8) & 0xff,
      y & 0xff,
      (y >> 8) & 0xff,
      z & 0xff,
      (z >> 8) & 0xff,
      triangle & 0xff,
      (triangle >> 8) & 0xff,
    );
  }

  /** MOVE: Bewegungsauftrag an den Solver (Literale); blockiert bis zur Ankunft. */
  move(x: number, y: number): this {
    return this.raw(0xa8, 0x00, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff);
  }

  wait(ticks: number): this {
    return this.raw(0x24, ticks & 0xff, (ticks >> 8) & 0xff);
  }

  // --- Kampf (S17) -----------------------------------------------------------

  /** BATTLE: skriptierter Kampf mit globaler Formationsnummer (Literal). */
  battle(encounterId: number): this {
    return this.raw(0x70, 0x00, encounterId & 0xff, (encounterId >> 8) & 0xff);
  }

  /** BTLON: Zufallskämpfe an/aus (Rohwert, Polarität 🟡). */
  btlon(value: number): this {
    return this.raw(0x71, value & 0xff);
  }

  // --- Dialog-Stub -----------------------------------------------------------

  message(windowId: number, dialogId: number): this {
    return this.raw(0x40, windowId, dialogId);
  }

  ask(bank: number, addr: number, windowId: number, dialogId: number, first: number, last: number): this {
    return this.raw(0x48, (bank & 0xf) << 4, windowId, dialogId, first, last, addr & 0xff);
  }

  window(id: number, x: number, y: number, w: number, h: number): this {
    return this.raw(0x50, id, x & 0xff, x >> 8, y & 0xff, y >> 8, w & 0xff, w >> 8, h & 0xff, h >> 8);
  }

  wclse(id: number): this {
    return this.raw(0x52, id);
  }

  // --- Variablen -------------------------------------------------------------

  private byteOp(op: number, bank: number, addr: number, src: SrcOperand): this {
    return this.raw(op, bankPairOf(bank, src), addr & 0xff, rawOf(src) & 0xff);
  }

  private wordOp(op: number, bank: number, addr: number, src: SrcOperand): this {
    const raw = rawOf(src);
    return this.raw(op, bankPairOf(bank, src), addr & 0xff, raw & 0xff, (raw >> 8) & 0xff);
  }

  private unaryOp(op: number, bank: number, addr: number): this {
    return this.raw(op, (bank & 0xf) << 4, addr & 0xff);
  }

  setByte(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x80, bank, addr, src);
  }

  setWord(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x81, bank, addr, src);
  }

  biton(bank: number, addr: number, bit: SrcOperand): this {
    return this.byteOp(0x82, bank, addr, bit);
  }

  bitoff(bank: number, addr: number, bit: SrcOperand): this {
    return this.byteOp(0x83, bank, addr, bit);
  }

  bitxor(bank: number, addr: number, bit: SrcOperand): this {
    return this.byteOp(0x84, bank, addr, bit);
  }

  plus(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x85, bank, addr, src);
  }

  plus2(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x86, bank, addr, src);
  }

  plusSat(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x76, bank, addr, src);
  }

  plus2Sat(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x77, bank, addr, src);
  }

  minus(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x87, bank, addr, src);
  }

  minus2(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x88, bank, addr, src);
  }

  minusSat(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x78, bank, addr, src);
  }

  minus2Sat(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x79, bank, addr, src);
  }

  mul(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x89, bank, addr, src);
  }

  mul2(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x8a, bank, addr, src);
  }

  div(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x8b, bank, addr, src);
  }

  div2(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x8c, bank, addr, src);
  }

  mod(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x8d, bank, addr, src);
  }

  mod2(bank: number, addr: number, src: SrcOperand): this {
    return this.wordOp(0x8e, bank, addr, src);
  }

  and(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x8f, bank, addr, src);
  }

  or(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x91, bank, addr, src);
  }

  xor(bank: number, addr: number, src: SrcOperand): this {
    return this.byteOp(0x93, bank, addr, src);
  }

  inc(bank: number, addr: number): this {
    return this.unaryOp(0x95, bank, addr);
  }

  inc2(bank: number, addr: number): this {
    return this.unaryOp(0x96, bank, addr);
  }

  incSat(bank: number, addr: number): this {
    return this.unaryOp(0x7a, bank, addr);
  }

  dec(bank: number, addr: number): this {
    return this.unaryOp(0x97, bank, addr);
  }

  dec2(bank: number, addr: number): this {
    return this.unaryOp(0x98, bank, addr);
  }

  decSat(bank: number, addr: number): this {
    return this.unaryOp(0x7c, bank, addr);
  }

  random(bank: number, addr: number): this {
    return this.unaryOp(0x99, bank, addr);
  }

  // --- Assemblierung ---------------------------------------------------------

  assemble(): { bytes: Uint8Array; offsets: Record<string, number> } {
    const bytes = new Uint8Array(this.cursor);
    let pos = 0;
    for (const f of this.fragments) {
      f.encode(bytes, pos, this.labels);
      pos += f.size;
    }
    return { bytes, offsets: Object.fromEntries(this.labels) };
  }
}
