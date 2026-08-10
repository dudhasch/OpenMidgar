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

  it('UNKNOWN-Politik gilt weiter: 0x301 ist in keiner Messung belegt, faultet und wird übersprungen', () => {
    // 0x301 kommt im GESAMTEN Bestand (wm0/wm2/wm3) nicht vor — es gibt also
    // weder eine gemessene Stelligkeit noch eine Referenzangabe. Genau dafür
    // bleibt die Fault-Politik: melden, überspringen, nie raten.
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Raw', word: 0x301 },
        { op: 'PushConst', value: 11 },
        { op: 'PushConst', value: 1 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    expect(r.faults).toEqual([expect.objectContaining({ kind: 'unknown-op', opcode: 0x301 })]);
    expect(vm.savemap.get(11)).toBe(1);
  });

  it('Kommando mit gemessener Stelligkeit: 0x308 nimmt 2 Operanden in Push-Reihenfolge, wirkt aber NICHT', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Reset' },
        { op: 'PushConst', value: 22 },
        { op: 'PushConst', value: 15 },
        { op: 'Raw', word: 0x308 },
        { op: 'Reset' },
        { op: 'PushConst', value: 7 },
        { op: 'Raw', word: 0x304 },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    // Kein Fault mehr, kein Stack-Rest — die Anweisungsbilanz geht auf.
    expect(r.faults).toEqual([]);
    expect(r.commands).toEqual([
      { opcode: 0x308, args: [22, 15] },
      { opcode: 0x304, args: [7] },
    ]);
    // Die BEDEUTUNG bleibt außerhalb der VM: kein Speicher wurde berührt.
    expect(r.writes).toEqual([]);
    expect(vm.snapshotMemory()).toEqual({ savemap: [], temp: [], special: [] });
  });

  it('Anweisungsbilanz: eine Anweisung mit falscher Operandenzahl meldet stack-underflow', () => {
    // Gegenprobe zur Stelligkeitsmessung: 0x324 ist mit 4 Pops gemessen —
    // werden nur 3 Werte gepusht, MUSS die VM das melden statt zu raten.
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Reset' },
        { op: 'PushConst', value: 60 },
        { op: 'PushConst', value: 140 },
        { op: 'PushConst', value: 200 },
        { op: 'Raw', word: 0x324 },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.faults).toEqual([expect.objectContaining({ kind: 'stack-underflow', opcode: 0x324 })]);
  });

  it('Wartepunkt: 0x305/0x306 hält an und wird verlustfrei fortgesetzt', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Reset' },
        { op: 'PushConst', value: 3 },
        { op: 'Raw', word: 0x305 },
        { op: 'Raw', word: 0x306 },
        { op: 'Reset' },
        { op: 'PushConst', value: 77 },
        { op: 'PushConst', value: 5 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    const state = vm.startFunction(vm.findSystemFunction(1)!);
    const erst = vm.run(state);
    expect(erst.suspended).toBe(true);
    expect(erst.finished).toBe(false);
    expect(state.waitFrames).toBe(3);
    expect(vm.savemap.has(77)).toBe(false); // nach dem Wartepunkt noch nichts
    // Der Wirt zählt die Takte herunter — die VM hat keine Wanduhr.
    state.waitFrames = 0;
    const zweit = vm.run(state);
    expect(zweit.finished).toBe(true);
    expect(vm.savemap.get(77)).toBe(5);
  });

  it('Aufruf-Familie: 0x204+k ruft Funktion k des Modells vom Stack und kehrt zurück', () => {
    const vm = vmMit(
      {
        id: systemFunctionId(1),
        code: [
          { op: 'Reset' },
          { op: 'PushConst', value: 5 }, // Modellnummer
          { op: 'Raw', word: 0x204 + 2 }, // Funktion 2 dieses Modells
          { op: 'Reset' },
          { op: 'PushConst', value: 90 },
          { op: 'PushConst', value: 1 },
          { op: 'Write' },
          { op: 'Return' },
        ],
      },
      {
        id: modelFunctionId(5, 2),
        code: [
          { op: 'Reset' },
          { op: 'PushConst', value: 91 },
          { op: 'PushConst', value: 2 },
          { op: 'Write' },
          { op: 'Return' },
        ],
      },
    );
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    // Reihenfolge belegt den Rücksprung: erst der Rumpf des Modells, dann der Rest.
    expect(r.writes).toEqual([
      { addr: 91, value: 2 },
      { addr: 90, value: 1 },
    ]);
  });

  it('Aufruf ins Leere faultet als bad-call, ohne den Lauf zu zerstören', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'Reset' },
        { op: 'PushConst', value: 63 },
        { op: 'Raw', word: 0x204 + 7 },
        { op: 'Return' },
      ],
    });
    const r = vm.runFunction(vm.findSystemFunction(1)!);
    expect(r.finished).toBe(true);
    expect(r.faults).toEqual([expect.objectContaining({ kind: 'bad-call' })]);
  });

  it('Sonderregister: 0x117/0x11b/0x11f teilen EINEN Indexraum (gemessen)', () => {
    const vm = vmMit({
      id: systemFunctionId(1),
      code: [
        { op: 'PushConst', value: 70 },
        { op: 'PushSpecialByte', addr: 2 },
        { op: 'Write' },
        { op: 'PushConst', value: 71 },
        { op: 'PushSpecialWord', addr: 2 },
        { op: 'Write' },
        { op: 'PushConst', value: 72 },
        { op: 'PushSpecialBit', addr: 2 },
        { op: 'Write' },
        { op: 'Return' },
      ],
    });
    vm.special.set(2, 5412);
    vm.runFunction(vm.findSystemFunction(1)!);
    expect(vm.savemap.get(70)).toBe(5412);
    expect(vm.savemap.get(71)).toBe(5412);
    expect(vm.savemap.get(72)).toBe(5412);
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
