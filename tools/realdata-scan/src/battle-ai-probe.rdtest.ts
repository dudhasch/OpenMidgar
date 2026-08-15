import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSceneBin } from '@webmidgar/formats-battle';
import { aiOperandLengths, AI_STRING_OP, AI_TERMINATOR, parseAiScript, runAiHandler, type AiMemory } from '@webmidgar/battle-runtime';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * S31 — Gegner-KI-Grammatik (Verfahren S12 mit den dort gelernten Grenzen).
 *
 * Ableitungsgeschichte (2026-08-10), damit sie nicht verloren geht:
 *
 * 1. **Handler-Tabelle:** Jedes Skript beginnt mit 16×u16-Offsets; belegte
 *    monoton, erster IMMER 32. → hier als Gate gemessen.
 * 2. **Zwei blinde Gütefunktionen nacheinander:** (a) „Durchlauf landet auf
 *    dem Spannenende" ist unter der NULLTABELLE trivial 100 % (bytewese
 *    Vorrücken landet immer exakt); (b) „…und die letzte Instruktion ist ein
 *    Terminator" ebenso (das letzte Byte IST der Terminator). Erst die
 *    Kombination aus linearem Abschluss + CFG-Verfolgung + Terminator-Pflicht
 *    trennt — und selbst dann ÜBERFITTET der freie Abstieg (er verbog die
 *    Push-Familie 0x00→0, exakt die S12-Lehre).
 * 3. **Unabhängige Stützen statt Abstieg:** Push-Adressoperanden clustern in
 *    8 Bänken (95 %); String-Op 0x93 endet mit 0xFF (0x00 ist TRENNZEICHEN —
 *    sichtbar an ASCII-Debugtexten im Bytecode); 0x72 trägt einen
 *    u16-Operanden (wiederkehrende `72 XX 00`-Tripel), Terminator ist allein
 *    0x73; Sprungziele sind HANDLER-relativ; 0x70 ist bedingt (Nachfolger nie
 *    Sprungziel), 0x71/0x72 unbedingt (Nachfolger nur als Ziel erreichbar).
 *
 * Dieses File misst die EINGEFRORENE Ergebnistabelle (`aiOperandLengths` aus
 * battle-runtime) gegen den Bestand — inklusive der Kontrollen.
 */

const available = existsSync(join(REAL_DIR, 'data', 'battle'));

interface Span {
  bytes: Uint8Array;
  off: number;
}

async function loadAiScripts(): Promise<{ scripts: Uint8Array[]; spans: Span[] }> {
  const bytes = new Uint8Array(readFileSync(realPfad('battle/scene.bin')));
  const container = await parseSceneBin(bytes, 'scene.bin');
  const scripts: Uint8Array[] = [];
  const spans: Span[] = [];
  for (const scene of container.scenes) {
    if (!scene) continue;
    for (const script of scene.enemyAiScripts) {
      if (!script || script.length < 32) continue;
      scripts.push(script);
      const view = new DataView(script.buffer, script.byteOffset, script.byteLength);
      const offs: number[] = [];
      for (let i = 0; i < 16; i++) {
        const v = view.getUint16(i * 2, true);
        if (v !== 0xffff) offs.push(v);
      }
      for (let i = 0; i + 1 < offs.length; i++) {
        if (offs[i + 1]! <= script.length) spans.push({ bytes: script.subarray(offs[i]!, offs[i + 1]!), off: offs[i]! });
      }
    }
  }
  return { scripts, spans };
}

function strEnd(b: Uint8Array, i: number): number {
  let j = i + 1;
  while (j < b.length && b[j] !== 0xff) j++;
  return j + 1;
}

describe.skipIf(!available)('S31-Probe: Gegner-KI-Grammatik', () => {
  it('Handler-Tabelle: 16×u16, monoton, erster Offset ausnahmslos 32', async () => {
    const { scripts } = await loadAiScripts();
    let mono = 0;
    let first32 = 0;
    for (const s of scripts) {
      const view = new DataView(s.buffer, s.byteOffset, s.byteLength);
      const offs: number[] = [];
      for (let i = 0; i < 16; i++) {
        const v = view.getUint16(i * 2, true);
        if (v !== 0xffff) offs.push(v);
      }
      let ok = offs.length > 0;
      for (let i = 1; i < offs.length; i++) if (offs[i]! <= offs[i - 1]!) ok = false;
      if (ok) mono++;
      if (offs[0] === 32) first32++;
    }
    console.log('KI-Skripte:', JSON.stringify({ scripts: scripts.length, monoton: mono, ersterOffset32: first32 }));
    expect(mono).toBe(scripts.length);
    expect(first32).toBe(scripts.length);
    /**
     * 612 statt 614: Seit der Locale-Umstellung (2026-08-15) liest die Probe
     * `data/lang-en/battle/scene.bin` — den Zweig, den das Original lädt. Dort
     * ist Szene 4 leergeräumt, im deutschen Zweig trug sie zwei Gegnertypen
     * mit KI-Skript. Genau −2, keine andere Szene betroffen (F-LOC).
     *
     * Wichtig für die beiden Zusicherungen darüber: `mono` und `first32`
     * werden gegen `scripts.length` geprüft, nicht gegen eine feste Zahl —
     * die Invariante „alle Skripte, ausnahmslos" bleibt damit unberührt.
     */
    expect(scripts.length).toBe(612);
  }, 120_000);

  it('Spannen-Abschluss ≥ 99 % mit der eingefrorenen Tabelle; Nulltabellen-Blindheit dokumentiert', async () => {
    const { spans } = await loadAiScripts();
    const table = aiOperandLengths();

    const walk = (sp: Span, t: Int8Array): { exact: boolean; lastTerm: boolean } => {
      const b = sp.bytes;
      let i = 0;
      let last = -1;
      while (i < b.length) {
        last = b[i]!;
        if (last === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        i += 1 + t[last]!;
      }
      return { exact: i === b.length, lastTerm: last === AI_TERMINATOR };
    };

    let closed = 0;
    for (const sp of spans) {
      const r = walk(sp, table);
      if (r.exact && r.lastTerm) closed++;
    }
    const quote = closed / spans.length;

    // ⚠️ Die Nulltabelle „besteht" den nackten Abschluss trivial — diese Zeile
    // steht hier als Beleg der Blindheit, nicht als Kontrolle. Die tragenden
    // Kontrollen sind die unabhängigen Messungen unten.
    const zero = new Int8Array(256);
    let zeroClosed = 0;
    for (const sp of spans) {
      const r = walk(sp, zero);
      if (r.exact && r.lastTerm) zeroClosed++;
    }

    console.log(
      'Spannen-Abschluss:',
      JSON.stringify({ spans: spans.length, closed, quote: (quote * 100).toFixed(2) + '%', nulltabelleTrivial: zeroClosed }),
    );
    expect(quote).toBeGreaterThanOrEqual(0.99);
    // Die 3 bekannten Restspannen (0,32 %) bleiben 🟡 dokumentiert.
    expect(spans.length - closed).toBeLessThanOrEqual(5);
  }, 120_000);

  it('Sprungziele: handler-relativ auf Instruktionsgrenzen (Kontrollen: +1 und skript-relativ)', async () => {
    const { spans } = await loadAiScripts();
    const table = aiOperandLengths();
    let total = 0;
    let onBoundary = 0;
    let plusOne = 0;
    let scriptRelative = 0;
    for (const sp of spans) {
      const b = sp.bytes;
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const bounds = new Set<number>();
      let i = 0;
      while (i < b.length) {
        bounds.add(i);
        const op = b[i]!;
        if (op === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        i += 1 + table[op]!;
      }
      i = 0;
      while (i < b.length) {
        const op = b[i]!;
        if (op === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        if ((op === 0x70 || op === 0x71 || op === 0x72) && i + 3 <= b.length) {
          const raw = view.getUint16(i + 1, true);
          total++;
          if (bounds.has(raw)) onBoundary++;
          if (bounds.has(raw + 1)) plusOne++;
          if (bounds.has(raw - sp.off)) scriptRelative++;
        }
        i += 1 + table[op]!;
      }
    }
    console.log(
      'Sprungziele:',
      JSON.stringify({ total, onBoundary, plusOne, scriptRelative, quote: ((100 * onBoundary) / total).toFixed(2) + '%' }),
    );
    // 97,5 % über ALLE drei Sprungopcodes (0x70/0x71 allein: 99,5 %) — die
    // +1-Kontrolle liegt höher als bei flevel, weil 1-Byte-Instruktionen fast
    // jede Position zur Grenze machen; entscheidend ist der Abstand.
    expect(onBoundary / total).toBeGreaterThan(0.97);
    expect(plusOne).toBeLessThan(onBoundary * 0.5);
    expect(scriptRelative).toBeLessThan(onBoundary * 0.5);
  }, 120_000);

  it('0x70 ist bedingt, 0x71/0x72 unbedingt (Nachfolger-ist-Ziel-Statistik)', async () => {
    const { spans } = await loadAiScripts();
    const table = aiOperandLengths();
    const stats: Record<number, { n: number; succTarget: number }> = {
      0x70: { n: 0, succTarget: 0 },
      0x71: { n: 0, succTarget: 0 },
      0x72: { n: 0, succTarget: 0 },
    };
    for (const sp of spans) {
      const b = sp.bytes;
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const targets = new Set<number>();
      let i = 0;
      while (i < b.length) {
        const op = b[i]!;
        if (op === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        if ((op === 0x70 || op === 0x71 || op === 0x72) && i + 3 <= b.length) targets.add(view.getUint16(i + 1, true));
        i += 1 + table[op]!;
      }
      i = 0;
      while (i < b.length) {
        const op = b[i]!;
        if (op === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        const next = i + 1 + table[op]!;
        if (op === 0x70 || op === 0x71 || op === 0x72) {
          const s = stats[op]!;
          s.n++;
          if (targets.has(next) || next >= b.length) s.succTarget++;
        }
        i = next;
      }
    }
    const q = (op: number) => stats[op]!.succTarget / stats[op]!.n;
    console.log(
      'Sprungart:',
      JSON.stringify({
        cond0x70: (q(0x70) * 100).toFixed(1) + '%',
        uncond0x71: (q(0x71) * 100).toFixed(1) + '%',
        uncond0x72: (q(0x72) * 100).toFixed(1) + '%',
      }),
    );
    expect(q(0x70)).toBeLessThan(0.05);
    expect(q(0x71)).toBeGreaterThan(0.5);
    expect(q(0x72)).toBeGreaterThan(0.5);
  }, 120_000);

  it('Push-Adressoperanden clustern in wenigen Bänken (95 % in 8)', async () => {
    const { spans } = await loadAiScripts();
    const table = aiOperandLengths();
    const hiH = new Map<number, number>();
    let n = 0;
    for (const sp of spans) {
      const b = sp.bytes;
      let i = 0;
      while (i < b.length) {
        const op = b[i]!;
        if (op === AI_STRING_OP) {
          i = strEnd(b, i);
          continue;
        }
        if (op <= 0x03 && i + 3 <= b.length) {
          hiH.set(b[i + 2]!, (hiH.get(b[i + 2]!) ?? 0) + 1);
          n++;
        }
        i += 1 + table[op]!;
      }
    }
    const top8 = [...hiH.values()].sort((a, b) => b - a).slice(0, 8).reduce((s, v) => s + v, 0);
    console.log('Push-Bänke:', JSON.stringify({ pushes: n, verschiedeneHiBytes: hiH.size, top8Anteil: ((100 * top8) / n).toFixed(1) + '%' }));
    expect(top8 / n).toBeGreaterThan(0.9);
  }, 120_000);

  it('VM-Abdeckungslauf: Haupthandler aller 614 Skripte enden regulär; Quoten berichtet', async () => {
    const { scripts } = await loadAiScripts();
    class NullMemory implements AiMemory {
      cells = new Map<number, number>();
      read(address: number): number {
        return this.cells.get(address) ?? 0;
      }
      write(address: number, value: number): void {
        this.cells.set(address, value);
      }
    }
    let finished = 0;
    let withActions = 0;
    let totalSteps = 0;
    let unknown = 0;
    const faultKinds = new Map<string, number>();
    for (const bytes of scripts) {
      const script = parseAiScript(bytes)!;
      const main = script.handlerOffsets.findIndex((o) => o !== null);
      const result = runAiHandler(script, main, new NullMemory(), { budget: 4096, rng: () => 0x1234 });
      if (result.finished) finished++;
      if (result.actions.length > 0) withActions++;
      totalSteps += result.steps;
      unknown += result.unknownCount;
      for (const f of result.faults) faultKinds.set(f.kind, (faultKinds.get(f.kind) ?? 0) + 1);
    }
    console.log(
      'VM-Abdeckung:',
      JSON.stringify({
        scripts: scripts.length,
        finished,
        mitAktionen: withActions,
        schritte: totalSteps,
        unknownQuote: ((100 * unknown) / Math.max(1, totalSteps)).toFixed(1) + '%',
        faults: [...faultKinds.entries()],
      }),
    );
    // Kernzusicherung: kein Skript hängt. 613/614 enden regulär; das eine
    // Nicht-Ende ist ein bad-jump-ABBRUCH (kein Hänger) in einem der 3
    // bekannten Restspannen-Skripte (🟡 dokumentiert).
    expect(finished).toBeGreaterThanOrEqual(scripts.length - 1);
    expect(faultKinds.get('budget') ?? 0).toBe(0);
    // Mit Null-Speicher wählt knapp ein Drittel der Haupthandler eine Attacke
    // (194/614) — der Rest verzweigt speicherabhängig; ehrliche Quote, die
    // Runtime deckt das mit dem dokumentierten 🔵-Rückfallpfad ab.
    expect(withActions / scripts.length).toBeGreaterThan(0.25);
  }, 120_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
