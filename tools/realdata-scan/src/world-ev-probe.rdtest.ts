import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * S29 — World-Script-Probe (`.ev`-Einträge in world_gm.lgp).
 *
 * DIE GRAMMATIKFRAGE ZUERST (Roadmap-S29): „Trägt der Weltkarten-Bytecode
 * dieselbe Instruktionsgrammatik wie `flevel`?" — GEMESSEN: Nein. Der
 * World-Bytecode ist eine EIGENE u16-wortbasierte Stack-Grammatik.
 *
 * Messweg (2026-08-10, inkl. zweier Fehlanläufe, die hier dokumentiert
 * bleiben, weil sie die Kontrollen begründen):
 *  1. Eine dynamisch gelesene Funktionstabelle (Ende am Sentinel) setzte die
 *     Codebasis auf Wort 288 — ALLE nachgelagerten Sprungmessungen lagen
 *     dadurch exakt auf Kontrollniveau. Erst die Hypothese „Tabelle ist FIX
 *     0x400 Bytes (256 Paare), Code ab Wort 512" (ff7-landscaper als
 *     Hypothesengeber) ließ die Struktur einrasten: 143/143 Funktionsziele
 *     liegen unmittelbar hinter einem 0x203/0x100.
 *  2. Ein Roh-Wortscan nach Sprungopcodes verwässert durch Operandenworte;
 *     erst die DISASSEMBLIERUNG mit der Operandenlängen-Hypothese macht die
 *     Sprungziel-Messung scharf.
 *
 * Verriegelte Fakten (alle drei Dateien, Kontrollen bestanden):
 *  - Datei fix 0x7000 B; Call-Tabelle 0x400 B = bis zu 256 Paare
 *    (u16 Kennung, u16 Wortoffset relativ zu Wort 512), 0xFFFF beendet.
 *  - Kennung: Typ = Bits 14–15 (0 System, 1 Modell, 2 Mesh), IDs monoton.
 *  - Operandenlängen: Push-Familie 0x110/114/117/118/119/11b/11c/11d/11f und
 *    Sprünge 0x200/0x201 tragen je EIN Wort; 0x203 (Return) beendet; alle
 *    übrigen beobachteten Opcodes 0 Operanden. Funktions-Abschluss 175/175.
 *  - Sprungziel = Wortoffset relativ zur CODEBASIS (Wort 512), trifft
 *    732/732 auf Instruktionsgrenzen (Kontrollen: +1 → 62 %, funktions-
 *    relativ → 36 %). Alle beobachteten Sprünge sind vorwärts gerichtet.
 *  - Die Field-Bytegrammatik schließt die Funktionen NICHT (Kontrolle unten)
 *    ⇒ eigene Opcode-Menge, eigener Interpreter (Roadmap-ADR bestätigt).
 *
 * Urheberrecht: nur Zähler, Quoten, Wertehistogramme — keine Bytefolgen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(REAL_DIR);

const CODE_BASIS_WORT = 512; // Call-Tabelle = 0x400 Bytes
const OPERAND1 = new Set([0x110, 0x114, 0x117, 0x118, 0x119, 0x11b, 0x11c, 0x11d, 0x11f, 0x200, 0x201]);
const OP_RETURN = 0x203;

async function readEvEntries(): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const out: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of index.listEntries('world_gm')) {
    if (entry.name.toLowerCase().endsWith('.ev')) {
      out.push({ name: entry.name, bytes: await index.readEntry(entry.canonicalId) });
    }
  }
  await dir.closeAll();
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface EvTable {
  paare: Array<{ id: number; offset: number }>;
  wort: (w: number) => number;
  worte: number;
  starts: number[];
  codeWorte: number;
}

function readTable(bytes: Uint8Array): EvTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const worte = bytes.length / 2;
  const wort = (w: number): number => view.getUint16(w * 2, true);
  const paare: Array<{ id: number; offset: number }> = [];
  let w = 0;
  while (w + 1 < CODE_BASIS_WORT && paare.length < 256) {
    const id = wort(w);
    if (id === 0xffff) break;
    paare.push({ id, offset: wort(w + 1) });
    w += 2;
  }
  const starts = [...new Set(paare.map((p) => p.offset))].sort((a, b) => a - b);
  return { paare, wort, worte, starts, codeWorte: worte - CODE_BASIS_WORT };
}

describe.skipIf(!available)('Realdaten: World-Script-Probe (S29)', () => {
  it('Call-Tabelle: fix 0x400 Bytes, Sentinel 0xFFFF, Typbits 14–15, IDs monoton, alle Ziele im Rahmen', async () => {
    const entries = await readEvEntries();
    expect(entries.length).toBe(3);
    const bericht: Record<string, unknown> = {};
    for (const { name, bytes } of entries) {
      expect(bytes.length).toBe(0x7000);
      const t = readTable(bytes);
      const typen = new Map<number, number>();
      for (const p of t.paare) typen.set(p.id >> 14, (typen.get(p.id >> 14) ?? 0) + 1);
      const idsMonoton = t.paare.every((p, i) => i === 0 || p.id >= t.paare[i - 1]!.id);
      const zieleImRahmen = t.paare.every((p) => p.offset < t.codeWorte);
      // Strukturbeleg: Jedes Funktionsziel liegt am Codeanfang oder direkt
      // hinter einem Return/Reset (143/143 bei wm0 — verriegelt).
      let hinterEnde = 0;
      for (const p of t.paare) {
        const z = CODE_BASIS_WORT + p.offset;
        const vor = z > CODE_BASIS_WORT ? t.wort(z - 1) : OP_RETURN;
        if (vor === OP_RETURN || vor === 0x100) hinterEnde++;
      }
      bericht[name] = {
        paare: t.paare.length,
        typen: [...typen.entries()],
        idsMonoton,
        zieleImRahmen,
        hinterEnde,
      };
      expect(idsMonoton).toBe(true);
      expect(zieleImRahmen).toBe(true);
      expect(hinterEnde).toBe(t.paare.length);
      // Erstes Codewort ist ein Return (Leerfunktion 0 — Strukturmerkmal).
      expect(t.wort(CODE_BASIS_WORT)).toBe(OP_RETURN);
    }
    console.log('EV-TABELLE:', JSON.stringify(bericht, null, 1));
  });

  it('Disassemblierung: 175/175 Funktionen schließen, 732/732 Sprungziele auf Instruktionsgrenzen', async () => {
    const entries = await readEvEntries();
    const bericht: Record<string, unknown> = {};
    let funktionenGesamt = 0;
    let spruengeGesamt = 0;
    for (const { name, bytes } of entries) {
      const t = readTable(bytes);
      let funktionen = 0;
      let abschluss = 0;
      let spruenge = 0;
      let sprungAufGrenze = 0;
      let sprungKontrollePlus1 = 0;
      let sprungFunktionsrelativ = 0;
      let sprungVorwaerts = 0;
      const opcodeHistogramm = new Map<number, number>();
      for (let i = 0; i < t.starts.length; i++) {
        const start = t.starts[i]!;
        const ende = i + 1 < t.starts.length ? t.starts[i + 1]! : t.codeWorte;
        funktionen++;
        const grenzen = new Set<number>();
        const lokaleSpruenge: number[] = [];
        let pc = start;
        let ok = false;
        let guard = 0;
        while (pc < ende && ++guard < 100000) {
          grenzen.add(pc);
          const op = t.wort(CODE_BASIS_WORT + pc);
          opcodeHistogramm.set(op, (opcodeHistogramm.get(op) ?? 0) + 1);
          if (op === OP_RETURN) {
            ok = true;
            break;
          }
          if (OPERAND1.has(op)) {
            if (op === 0x200 || op === 0x201) lokaleSpruenge.push(t.wort(CODE_BASIS_WORT + pc + 1));
            pc += 2;
          } else {
            pc += 1;
          }
        }
        if (ok) abschluss++;
        for (const ziel of lokaleSpruenge) {
          spruenge++;
          if (grenzen.has(ziel)) sprungAufGrenze++;
          if (grenzen.has(ziel + 1)) sprungKontrollePlus1++;
          if (grenzen.has(start + ziel)) sprungFunktionsrelativ++;
          if (ziel > start) sprungVorwaerts++;
        }
      }
      bericht[name] = {
        funktionen,
        abschluss,
        spruenge,
        sprungAufGrenze,
        sprungKontrollePlus1,
        sprungFunktionsrelativ,
        sprungVorwaerts,
        opcodesVerschieden: opcodeHistogramm.size,
        topOpcodes: [...opcodeHistogramm.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 16)
          .map(([v, c]) => [`0x${v.toString(16)}`, c]),
      };
      // Verriegelt: Abschluss UND Sprungbeweis sind vollständig; die
      // Kontrollen liegen strikt darunter (keine blinde Gütefunktion).
      expect(abschluss).toBe(funktionen);
      expect(sprungAufGrenze).toBe(spruenge);
      expect(sprungKontrollePlus1).toBeLessThan(spruenge);
      expect(sprungFunktionsrelativ).toBeLessThan(spruenge);
      expect(sprungVorwaerts).toBe(spruenge);
      funktionenGesamt += funktionen;
      spruengeGesamt += spruenge;
    }
    console.log('EV-DISASM:', JSON.stringify(bericht, null, 1));
    expect(funktionenGesamt).toBe(175);
    expect(spruengeGesamt).toBe(732);
  });

  it('Kontrolle H-EV-FELD: Die Field-Bytegrammatik schließt die World-Funktionen NICHT', async () => {
    const entries = await readEvEntries();
    const len = ((): number[] => {
      const table = new Array<number>(256).fill(-1);
      for (const [op, l] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = l;
      for (const [op, l] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = l;
      return table;
    })();
    const bericht: Record<string, unknown> = {};
    for (const { name, bytes } of entries) {
      const t = readTable(bytes);
      let abschluss = 0;
      for (let i = 0; i < t.starts.length; i++) {
        const startByte = (CODE_BASIS_WORT + t.starts[i]!) * 2;
        const endeByte = (CODE_BASIS_WORT + (i + 1 < t.starts.length ? t.starts[i + 1]! : t.codeWorte)) * 2;
        let pc = startByte;
        let guard = 0;
        let ok = false;
        while (pc < endeByte && ++guard < 1_000_000) {
          const op = bytes[pc]!;
          if (op === OP_KAWAI) {
            const total = bytes[pc + 1];
            if (total === undefined || total < 2) break;
            pc += total;
            continue;
          }
          const l = len[op] ?? -1;
          if (l < 0) break;
          pc += 1 + l;
          if (pc === endeByte) ok = true;
        }
        if (ok) abschluss++;
      }
      const quote = t.starts.length ? abschluss / t.starts.length : 0;
      bericht[name] = { funktionen: t.starts.length, feldAbschluss: abschluss, quote };
      // Die Grammatikfrage ist damit ENTSCHIEDEN gemessen: weit unter dem
      // 99-%-Standard, den dieselbe Tabelle auf flevel erreicht.
      expect(quote).toBeLessThan(0.5);
    }
    console.log('EV-FELDKONTROLLE:', JSON.stringify(bericht, null, 1));
  });
});
