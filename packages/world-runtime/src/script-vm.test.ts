import { describe, expect, it } from 'vitest';
import {
  assembleWorldEv,
  meshFunctionId,
  modelFunctionId,
  systemFunctionId,
  type WorldMnemonic,
} from '@webmidgar/fixture-gen';
import { parseWorldEv } from '@webmidgar/formats-world';
import { WorldScriptVM } from './script-vm.js';

/**
 * Sollverlauf-Suite der World-Script-VM (S29). Der Spannen-/Funktions-
 * Abschluss der Probe belegt KEINE Semantik (blinde Gütefunktion) — deshalb
 * bekommt jede scharfgeschaltete Kategorie hier ihren Fixture-Sollverlauf
 * über die volle Kette Assembler (Zweitimplementierung) → Parser → VM.
 */

function vmMit(...functions: Array<{ id: number; code: WorldMnemonic[] }>): WorldScriptVM {
  const ev = parseWorldEv(assembleWorldEv(functions));
  expect(ev.diagnostics).toEqual([]);
  return new WorldScriptVM(ev);
}

describe('Roundtrip Assembler ↔ Parser', () => {
  it('erhält Kennungen, Typen und Codegrenzen; Kennungskodierung ist umkehrbar', () => {
    const ev = parseWorldEv(
      assembleWorldEv([
        { id: systemFunctionId(2), code: [{ op: 'Return' }] },
        { id: modelFunctionId(5, 1), code: [{ op: 'Nop' }, { op: 'Return' }] },
        { id: meshFunctionId(12, 7, 3), code: [{ op: 'Return' }] },
      ]),
    );
    expect(ev.functions).toHaveLength(3);
    expect(ev.functions[0]).toMatchObject({ type: 'system', functionId: 2 });
    expect(ev.functions[1]).toMatchObject({ type: 'model', modelId: 5, functionId: 1 });
    expect(ev.functions[2]).toMatchObject({ type: 'mesh', meshX: 12, meshY: 7, functionId: 3 });
    // Codegrenzen: Funktionen sind disjunkt und beginnen hinter der Leerfunktion.
    expect(ev.functions[0]!.offset).toBe(1);
    expect(ev.functions[1]!.offset).toBe(ev.functions[0]!.end);
  });
});

describe('Sollverläufe je Kategorie', () => {
  it('Arithmetik und Write: (5 + 3) · 2 → Adresse 100', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 100 }, // Adresse zuerst (🟡 dokumentierte Reihenfolge)
        { op: 'PushConst', value: 5 },
        { op: 'PushConst', value: 3 },
        { op: 'Add' },
        { op: 'PushConst', value: 2 },
        { op: 'Mul' },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    expect(r.faults).toEqual([]);
    expect(r.writes).toEqual([{ addr: 100, value: 16 }]);
    expect(vm.savemap.get(100)).toBe(16);
  });

  it('u16-Wrap: 0 − 1 → 0xFFFF (dokumentierte 🟡-Festlegung)', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 7 },
        { op: 'PushConst', value: 0 },
        { op: 'PushConst', value: 1 },
        { op: 'Sub' },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    vm.runFunction(vm.findSystemFunction(1)!);
    expect(vm.savemap.get(7)).toBe(0xffff);
  });

  it('Vergleich + GotoIfFalse: der falsche Zweig wird übersprungen', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 1 },
        { op: 'PushConst', value: 2 },
        { op: 'Gt' }, // 1 > 2 = 0
        { op: 'GotoIfFalse', label: 'sonst' },
        { op: 'PushConst', value: 50 },
        { op: 'PushConst', value: 1 },
        { op: 'Write' },
        { op: 'Return' },
        { op: 'Label', name: 'sonst' },
        { op: 'PushConst', value: 50 },
        { op: 'PushConst', value: 2 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    vm.runFunction(vm.findSystemFunction(1)!);
    expect(vm.savemap.get(50)).toBe(2);
  });

  it('Schleife (Rückwärtssprung) + Temp-Lesen: 4 Runden zählen', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Label', name: 'kopf' },
        { op: 'PushConst', value: 9 },
        { op: 'PushTempByte', addr: 9 },
        { op: 'PushConst', value: 1 },
        { op: 'Add' },
        { op: 'Write' },
        { op: 'PushTempByte', addr: 9 },
        { op: 'PushConst', value: 4 },
        { op: 'Lt' },
        { op: 'GotoIfFalse', label: 'ende' },
        { op: 'Goto', label: 'kopf' },
        { op: 'Label', name: 'ende' },
        { op: 'Return' },
      ],
    });
    // Der Rückwärtssprung selbst ist der Prüfgegenstand: solange temp[9] < 4
    // ist, dreht die Funktion Runden (und läuft ins Budget, weil Write nach
    // savemap schreibt, nicht nach temp — temp erhöht der Test von außen).
    for (let i = 0; i < 4; i++) {
      vm.temp.set(9, i);
      const r = vm.runFunction(vm.findSystemFunction(1)!, 1000);
      expect(r.finished).toBe(false); // Schleife endet erst am Budget
      expect(vm.savemap.get(9)).toBe(i + 1); // aber der Rumpf lief mit temp=i
    }
  });

  it('Reset leert den Stack — ein Write danach meldet stack-underflow statt zu raten', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 1 },
        { op: 'PushConst', value: 2 },
        { op: 'Reset' },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    expect(r.faults.filter((f) => f.kind === 'stack-underflow')).toHaveLength(2);
    expect(r.writes).toEqual([{ addr: 0, value: 0 }]);
  });

  it('UNKNOWN-Politik: ein Kommando-Opcode (0x305) faultet und wird übersprungen, der Lauf endet regulär', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Raw', word: 0x305 },
        { op: 'PushConst', value: 11 },
        { op: 'PushConst', value: 1 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    expect(r.faults).toEqual([expect.objectContaining({ kind: 'unknown-op', opcode: 0x305 })]);
    expect(vm.savemap.get(11)).toBe(1);
  });

  it('Budget: eine Endlosschleife endet mit budget-Fault, nie mit Hänger', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [{ op: 'Label', name: 'l' }, { op: 'Goto', label: 'l' }, { op: 'Return' }],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!, 500);
    expect(r.finished).toBe(false);
    expect(r.faults.some((f) => f.kind === 'budget')).toBe(true);
  });

  it('Bit- und Word-Pushes lesen die dokumentierte Zerlegung (addr>>3, addr&7)', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 60 },
        { op: 'PushSavemapBit', addr: 8 * 5 + 3 }, // Byte 5, Bit 3
        { op: 'Write' },
        { op: 'PushConst', value: 61 },
        { op: 'PushSavemapWord', addr: 12 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    vm.savemap.set(5, 0b0000_1000);
    vm.savemap.set(12, 0x1234);
    vm.runFunction(vm.findSystemFunction(1)!);
    expect(vm.savemap.get(60)).toBe(1);
    expect(vm.savemap.get(61)).toBe(0x1234);
  });
});
