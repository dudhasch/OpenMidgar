import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import {
  berechneAnfangsBgStates,
  FieldRuntime,
  IMPL_OPERAND_LEN,
  OP_KAWAI,
  prepareScript,
  SKIP_OPERAND_LEN,
  type ScriptContext,
} from '@webmidgar/interpreter';
import { Timeline } from '@webmidgar/interpreter-debug';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Posten 4 der Nachlese — über welchen Weg wird der Hintergrund-Bereich von
 * `junonr2` betreten?**
 *
 * Das ist eine **Ermittlung, keine Korrektur.** Bekannt ist bereits: Die
 * Entitäten `door` (Index 0) und `lift` (Index 3) tragen kein Modell — es sind
 * Hintergrundgruppen; nach 300 Ticks steht `bgStates` auf `{16:0, 17:0, 18:1}`,
 * und mit Maske 0 verschwindet die Gondel. Offen ist, **über welchen Slot bzw.
 * welchen REQ** der Bereich 1688…2293 überhaupt betreten wird, in welcher
 * Tickfolge dort BGON/BGOFF feuern, und ob unsere Verdrängungsregel dazu passt.
 *
 * Gemessen wird mit den Debug-Schnittstellen des Interpreters:
 *  - `Timeline` (`@webmidgar/interpreter-debug`) für Kontextstarts/-enden,
 *    Requests (samt `accepted`), Yields und Zwangs-Yields,
 *  - `stepGate` als Beobachter **vor** jeder Instruktion — anders als der
 *    `TraceSink` (der nur einen Operanden-Digest führt) sieht er die
 *    Operandenbytes und kann `param`/`state` von BGON/BGOFF mitschreiben.
 *
 * **Kontrolle.** Ein einzelnes Field ist eine Fallstudie, keine Statistik.
 * Deshalb läuft dieselbe Auswertung zusätzlich über **alle** Fields, deren
 * Hintergrundgruppen nach 300 Ticks leer bleiben: Ist `junonr2` ein Sonderfall
 * oder das Muster? Und es läuft ein **Erreichbarkeitstest** — welche Spannen
 * des Fields werden in 300 Ticks überhaupt je betreten? Ohne ihn hieße „der
 * Bereich feuert nicht" nur, dass niemand nachgesehen hat, ob er läuft.
 *
 * Urheberrecht: ausschließlich Zähler und Ablaufprotokolle über die Daten des
 * Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const TICKS = 300;
const BG_BEREICH = { start: 1688, end: 2293 };

const BGON = 0xe0;
const BGOFF = 0xe1;
const BGCLR = 0xe4;
const REQ_OPS = new Set([0x01, 0x02, 0x03]);

/** Operandenlängen wie in der VM: implementiert schlägt Skip-Tabelle. */
const laengen = ((): number[] => {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
})();

interface BgSchaltung {
  tick: number;
  entity: number;
  slot: number;
  ip: number;
  op: string;
  banks: number;
  param: number;
  state: number;
  imBereich: boolean;
}

describe.skipIf(!available)('Realdaten: junonr2 — Kontrollfluss in den Hintergrund-Bereich', () => {
  it('verfolgt Slots, Requests und die Tickfolge der BGON/BGOFF-Schaltungen', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // ---------------------------------------------------------------------
    // Teil 1 — die Fallstudie junonr2
    // ---------------------------------------------------------------------
    const eintrag = index.listEntries('flevel').find((e) => e.name === 'junonr2');
    expect(eintrag, 'junonr2 muss im Bestand liegen').toBeDefined();
    const parsed = parseFieldEntry(await index.readEntry(eintrag!.canonicalId), 'junonr2');
    const b = parsed.bundle!;
    const code = b.rawSections[1]!;
    const prepared = prepareScript(b.script!, code);

    const kacheln = b.background!.layers.flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state })));
    const anfang = berechneAnfangsBgStates(kacheln);

    // Modelle: welche Entität trägt eines? Die Modellliste ist die unabhängige
    // Quelle — sie sagt, was eine Figur ist und was eine Hintergrundgruppe.
    const modellNamen = (b.models?.models ?? []).map((m, i) => `#${i} ${m.name ?? '?'}`);

    // Welche Spanne gehört zu welcher Entität/Slot?
    interface SpanInfo {
      start: number;
      end: number;
      besitzer: string[];
      imBereich: boolean;
    }
    const spanInfos: SpanInfo[] = prepared.spans.map((s) => ({
      start: s.start,
      end: s.end,
      besitzer: [],
      imBereich: s.start < BG_BEREICH.end && s.end > BG_BEREICH.start,
    }));
    prepared.entities.forEach((e, ei) => {
      e.entryPoints.forEach((ep, slot) => {
        if (ep === null) return;
        // Ein Slot, der den Wert eines kleineren Slots wiederholt, ist ungenutzt.
        if (e.entryPoints.slice(0, slot).includes(ep)) return;
        const si = spanInfos.find((s) => ep >= s.start && ep < s.end);
        si?.besitzer.push(`${ei}:${e.name}/slot${slot}@${ep}`);
      });
    });

    // Alle Entry-Points, die IM Bereich liegen — der gesuchte Einstieg.
    const einstiege: string[] = [];
    prepared.entities.forEach((e, ei) => {
      e.entryPoints.forEach((ep, slot) => {
        if (ep === null) return;
        if (e.entryPoints.slice(0, slot).includes(ep)) return;
        if (ep >= BG_BEREICH.start && ep < BG_BEREICH.end) {
          einstiege.push(`Entity ${ei} "${e.name}" Slot ${slot} → ip ${ep}`);
        }
      });
    });

    // --- Lauf mit voller Beobachtung ---------------------------------------
    const timeline = new Timeline();
    const schaltungen: BgSchaltung[] = [];
    const besuchteIps = new Set<number>();
    const bereichBesuche: Array<{ tick: number; entity: number; slot: number; ip: number }> = [];
    let rt!: FieldRuntime;
    const gate = (ctx: ScriptContext): boolean => {
      const ip = ctx.ip;
      besuchteIps.add(ip);
      if (ip >= BG_BEREICH.start && ip < BG_BEREICH.end && bereichBesuche.length < 60) {
        bereichBesuche.push({ tick: rt.state.tickCounter, entity: ctx.entityIndex, slot: ctx.slot, ip });
      }
      const op = code[ip]!;
      if (op === BGON || op === BGOFF || op === BGCLR) {
        schaltungen.push({
          tick: rt.state.tickCounter,
          entity: ctx.entityIndex,
          slot: ctx.slot,
          ip,
          op: op === BGON ? 'BGON' : op === BGOFF ? 'BGOFF' : 'BGCLR',
          banks: code[ip + 1]!,
          param: code[ip + 2]!,
          state: op === BGCLR ? -1 : code[ip + 3]!,
          imBereich: ip >= BG_BEREICH.start && ip < BG_BEREICH.end,
        });
      }
      return true;
    };
    rt = new FieldRuntime(prepared, {
      seed: 0x5117,
      budget: 200,
      mainLoop: true,
      initialBgStates: anfang,
      observer: timeline,
      stepGate: gate,
    });
    rt.start();
    const maskenVerlauf: string[] = [];
    let letzte = JSON.stringify(rt.state.bgStates);
    maskenVerlauf.push(`Tick 0 (Vorbelegung): ${letzte}`);
    for (let t = 0; t < TICKS; t++) {
      rt.tick();
      const jetzt = JSON.stringify(rt.state.bgStates);
      if (jetzt !== letzte) {
        maskenVerlauf.push(`Tick ${rt.state.tickCounter}: ${jetzt}`);
        letzte = jetzt;
      }
    }

    // Erreichbarkeit je Spanne: wurde sie in 300 Ticks je betreten?
    const spanErreicht = spanInfos.map((s) => {
      let getroffen = 0;
      for (const ip of besuchteIps) if (ip >= s.start && ip < s.end) getroffen++;
      return { ...s, getroffen };
    });

    const requests = timeline.events.filter((e) => e.kind === 'request');
    const kontextStarts = timeline.events.filter((e) => e.kind === 'context-start');
    const kontextEnden = timeline.events.filter((e) => e.kind === 'context-end');
    const abgewiesen = requests.filter((e) => e.kind === 'request' && !e.accepted);
    const zwangsYields = timeline.events.filter((e) => e.kind === 'budget-forced-yield');

    // Welche Requests zielen auf eine Entität, deren Slot im BG-Bereich liegt?
    const bereichEntities = new Set(
      prepared.entities.flatMap((e, ei) =>
        e.entryPoints.some((ep, slot) =>
          ep !== null && !e.entryPoints.slice(0, slot).includes(ep) && ep >= BG_BEREICH.start && ep < BG_BEREICH.end,
        )
          ? [ei]
          : [],
      ),
    );

    // Welche REQ-Instruktionen im Bytecode zielen auf diese Entitäten?
    //
    // **Am Instruktionsstrom entlang, nicht byteweise.** Eine byteweise Suche
    // findet in den Operanden anderer Befehle Phantom-REQs; bei junonr2 waren
    // das über 30 Treffer mit erfundenen Slot- und Prioritätswerten. Der
    // Durchlauf mit der Längentabelle liefert nur echte Instruktionsanfänge —
    // und meldet zugleich, ob die Spanne dabei sauber schließt (tut sie es
    // nicht, ist die Liste dieser Spanne mit Vorsicht zu lesen).
    const reqQuellen: string[] = [];
    let spannenNichtGeschlossen = 0;
    for (const s of prepared.spans) {
      if (s.end <= s.start) continue;
      let pc = s.start;
      let guard = 0;
      while (pc < s.end && ++guard < 100_000) {
        const op = code[pc]!;
        if (REQ_OPS.has(op)) {
          const ziel = code[pc + 1]!;
          const packed = code[pc + 2]!;
          if (bereichEntities.has(ziel)) {
            const besitzer = spanInfos.find((x) => pc >= x.start && pc < x.end)?.besitzer.join(',') ?? '?';
            reqQuellen.push(
              `ip ${pc} (in Spanne von ${besitzer}) → ${op === 0x01 ? 'REQ' : op === 0x02 ? 'REQSW' : 'REQEW'} ` +
                `Entity ${ziel} Slot ${packed & 0x1f} Priorität ${(packed >> 5) & 0x07}`,
            );
          }
        }
        const l = op === OP_KAWAI ? (code[pc + 1] ?? 2) - 1 : (laengen[op] ?? -1);
        if (l < 0) break;
        pc += 1 + l;
      }
      if (pc !== s.end) spannenNichtGeschlossen++;
    }

    // ---------------------------------------------------------------------
    // Teil 2 — Kontrolle: ist junonr2 Sonderfall oder Muster?
    // ---------------------------------------------------------------------
    let fieldsMitGruppen = 0;
    let fieldsMitLeerNachLauf = 0;
    let gruppenLeerNachLauf = 0;
    let gruppenGesamt = 0;
    let gruppenNieGeschaltet = 0;
    let gruppenGeschaltetUndLeer = 0;
    const musterBeispiele: string[] = [];

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let p;
      try {
        p = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bb = p.bundle;
      if (!p.ok || !bb?.script || !bb.rawSections[1] || !bb.background) continue;
      const k = bb.background.layers.flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state })));
      const vor = berechneAnfangsBgStates(k);
      const params = Object.keys(vor).map(Number);
      if (params.length === 0) continue;
      fieldsMitGruppen++;
      gruppenGesamt += params.length;

      const pr = prepareScript(bb.script, bb.rawSections[1]!);
      const cc = bb.rawSections[1]!;
      const angefasst = new Set<number>();
      let r2!: FieldRuntime;
      r2 = new FieldRuntime(pr, {
        seed: 0x5117,
        budget: 200,
        mainLoop: true,
        initialBgStates: vor,
        stepGate: (ctx) => {
          const op = cc[ctx.ip]!;
          if (op === BGON || op === BGOFF || op === BGCLR) angefasst.add(cc[ctx.ip + 2]!);
          return true;
        },
      });
      r2.start();
      for (let t = 0; t < TICKS; t++) r2.tick();
      let leerHier = 0;
      for (const par of params) {
        if ((r2.state.bgStates[par] ?? 0) === 0) {
          leerHier++;
          gruppenLeerNachLauf++;
          if (angefasst.has(par)) gruppenGeschaltetUndLeer++;
          else gruppenNieGeschaltet++;
        }
      }
      if (leerHier > 0) {
        fieldsMitLeerNachLauf++;
        if (musterBeispiele.length < 10) {
          musterBeispiele.push(`${entry.name}: ${leerHier}/${params.length} Gruppen leer, geschaltete Parameter [${[...angefasst].sort((x, y) => x - y).join(',')}]`);
        }
      }
    }
    await dir.closeAll();

    console.log(
      'junonr2 — Kontrollfluss in den Hintergrund-Bereich:',
      JSON.stringify(
        {
          '=== Fallstudie junonr2 ===': '',
          Bytecode: `[${prepared.dataStart}, ${prepared.codeEnd}), untersuchter BG-Bereich [${BG_BEREICH.start}, ${BG_BEREICH.end})`,
          Entitäten: prepared.entities.map((e, i) => `#${i} ${e.name}`),
          'Modelle (unabhängige Quelle)': modellNamen.length ? modellNamen : '— keine Modellliste —',
          Vorbelegung: JSON.stringify(anfang),
          'Entry-Points IM BG-Bereich': einstiege.length ? einstiege : '— KEINER —',
          'Spannen, die den BG-Bereich schneiden': spanErreicht
            .filter((s) => s.imBereich)
            .map((s) => `[${s.start}, ${s.end}) Besitzer ${s.besitzer.join(' | ') || '— kein Entry-Point —'}, in ${TICKS} Ticks besuchte IPs: ${s.getroffen}`),
          'REQ-Instruktionen auf Entitäten mit BG-Bereichs-Slot (am Instruktionsstrom, keine Phantome)': reqQuellen.length
            ? reqQuellen
            : '— KEINE —',
          'Spannen, die beim Durchlauf nicht exakt schließen': spannenNichtGeschlossen,
          'Kontextstarts (erste 25)': kontextStarts
            .slice(0, 25)
            .map((e) => (e.kind === 'context-start' ? `Tick ${e.tick}: Entity ${e.entity} Slot ${e.slot} Priorität ${e.priority} ip ${e.ip}` : '')),
          Kontextstarts: kontextStarts.length,
          Kontextenden: kontextEnden.length,
          'Kontextenden mit Fault': kontextEnden
            .filter((e) => e.kind === 'context-end' && e.status === 'faulted')
            .map((e) => (e.kind === 'context-end' ? `Tick ${e.tick}: Entity ${e.entity} Slot ${e.slot} — ${e.faultReason}` : '')),
          Requests: requests.length,
          'abgewiesene Requests': abgewiesen.length
            ? abgewiesen.slice(0, 15).map((e) => (e.kind === 'request' ? `Tick ${e.tick}: ${e.source} → Entity ${e.target} Slot ${e.slot} (${e.mode})` : ''))
            : '— keine —',
          'Zwangs-Yields (Budget)': zwangsYields.length,
          'Besuche IM BG-Bereich (erste 60 Instruktionen)': bereichBesuche.length
            ? bereichBesuche.map((v) => `Tick ${v.tick}: Entity ${v.entity} Slot ${v.slot} ip ${v.ip}`)
            : '— der Bereich wird NIE betreten —',
          'BGON/BGOFF/BGCLR-Schaltungen in Tickfolge': schaltungen.map(
            (s) =>
              `Tick ${s.tick}: Entity ${s.entity} Slot ${s.slot} ip ${s.ip} ${s.op} banks=0x${s.banks.toString(16)} param=${s.param} state=${s.state}${s.imBereich ? ' [IM BG-BEREICH]' : ''}`,
          ),
          'Maskenverlauf (nur Änderungen)': maskenVerlauf,
          'Endzustand bgStates': JSON.stringify(rt.state.bgStates),
          'unbesuchte Spannen (nie betreten)': spanErreicht.filter((s) => s.getroffen === 0).length,
          Spannen: spanErreicht.length,

          '=== Kontrolle: Sonderfall oder Muster? ===': '',
          'Fields mit animierten Gruppen': fieldsMitGruppen,
          'Fields mit mindestens einer nach 300 Ticks leeren Gruppe': fieldsMitLeerNachLauf,
          Kachelgruppen: gruppenGesamt,
          'davon nach 300 Ticks leer': gruppenLeerNachLauf,
          'leer UND vom Skript nie angefasst': gruppenNieGeschaltet,
          'leer, OBWOHL das Skript den Parameter geschaltet hat': gruppenGeschaltetUndLeer,
          Musterbeispiele: musterBeispiele,
        },
        null,
        1,
      ),
    );

    expect(prepared.entities.length).toBeGreaterThan(0);
    expect(fieldsMitGruppen).toBeGreaterThan(50);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
