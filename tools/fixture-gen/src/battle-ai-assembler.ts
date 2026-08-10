/**
 * Assembler für Gegner-KI-Skripte (S31) — Zweitimplementierung, codegetrennt
 * von der VM in battle-runtime. Baut die realdaten-belegte Grammatik:
 * 16×u16-Handler-Tabelle (0xFFFF = leer), erster Handler bei Offset 32,
 * Sprünge HANDLER-relativ, Terminator 0x73, String-Op 0x93 endet mit 0xFF.
 */

type AiInstr = number[];

export class BattleAiAsm {
  private readonly instrs: AiInstr[] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: { instrIndex: number; byteOffset: number; label: string }[] = [];

  /** Push aus dem Battle-Speicher (Familie 0x00–0x03, 2-Byte-Adresse). */
  pushMem(size: 0 | 1 | 2 | 3, address: number): this {
    this.instrs.push([size, address & 0xff, (address >> 8) & 0xff]);
    return this;
  }

  pushConst(value: number): this {
    if (value <= 0xff) this.instrs.push([0x60, value]);
    else if (value <= 0xffff) this.instrs.push([0x61, value & 0xff, value >> 8]);
    else this.instrs.push([0x62, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
    return this;
  }

  /** Immediate-Treppe 0x10–0x13 (🟡 Zweitfamilie). */
  pushTyped(width: 1 | 2 | 3 | 4, value: number): this {
    const bytes = [0x10 + width - 1];
    for (let i = 0; i < width; i++) bytes.push((value >> (8 * i)) & 0xff);
    this.instrs.push(bytes);
    return this;
  }

  op(opcode: number): this {
    this.instrs.push([opcode]);
    return this;
  }

  add(): this {
    return this.op(0x30);
  }
  sub(): this {
    return this.op(0x31);
  }
  eq(): this {
    return this.op(0x40);
  }
  lt(): this {
    return this.op(0x45);
  }
  not(): this {
    return this.op(0x52);
  }
  store(): this {
    return this.op(0x90);
  }
  discard(): this {
    return this.op(0x91);
  }
  attack(): this {
    return this.op(0x92);
  }
  end(): this {
    return this.op(0x73);
  }

  debugString(text: string): this {
    const bytes = [0x93];
    for (const ch of text) bytes.push(ch.charCodeAt(0) & 0xff);
    bytes.push(0xff);
    this.instrs.push(bytes);
    return this;
  }

  label(name: string): this {
    this.labels.set(name, this.instrs.length);
    return this;
  }

  jz(label: string): this {
    this.fixups.push({ instrIndex: this.instrs.length, byteOffset: 1, label });
    this.instrs.push([0x70, 0, 0]);
    return this;
  }

  jmp(label: string): this {
    this.fixups.push({ instrIndex: this.instrs.length, byteOffset: 1, label });
    this.instrs.push([0x71, 0, 0]);
    return this;
  }

  /** Roh-Bytes (z. B. absichtlich unbekannte Opcodes für UNKNOWN-Tests). */
  raw(...bytes: number[]): this {
    this.instrs.push(bytes);
    return this;
  }

  /** Kodiert den Handler; Sprungziele werden HANDLER-relativ aufgelöst. */
  assemble(): Uint8Array {
    const offsets: number[] = [];
    let at = 0;
    for (const ins of this.instrs) {
      offsets.push(at);
      at += ins.length;
    }
    const bytes = new Uint8Array(at);
    let o = 0;
    for (const ins of this.instrs) {
      bytes.set(ins, o);
      o += ins.length;
    }
    for (const fix of this.fixups) {
      const target = this.labels.get(fix.label);
      if (target === undefined) throw new Error(`Label ${fix.label} nicht definiert`);
      const rel = offsets[target] ?? at;
      const pos = offsets[fix.instrIndex]! + fix.byteOffset;
      bytes[pos] = rel & 0xff;
      bytes[pos + 1] = (rel >> 8) & 0xff;
    }
    return bytes;
  }
}

/** Baut ein vollständiges KI-Skript: 16er-Tabelle + Handler in Indexordnung. */
export function composeAiScript(handlers: Partial<Record<number, Uint8Array>>): Uint8Array {
  const table = new Array<number | null>(16).fill(null);
  const parts: Uint8Array[] = [];
  let cursor = 32;
  for (let i = 0; i < 16; i++) {
    const h = handlers[i];
    if (!h) continue;
    table[i] = cursor;
    parts.push(h);
    cursor += h.length;
  }
  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 16; i++) view.setUint16(i * 2, table[i] ?? 0xffff, true);
  let o = 32;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return bytes;
}
