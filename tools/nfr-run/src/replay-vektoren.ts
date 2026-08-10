/**
 * R9 — Replay-Digest-Vektoren für den Cross-Browser-Vergleich.
 *
 * Das Risiko R9 lautet: „Deterministik über Browser hinweg (Fließkomma,
 * Math-Implementierungen)". Ein Digest, der auf zwei Engines übereinstimmt,
 * belegt Portabilität nur so weit, wie der Lauf die kritischen Pfade
 * überhaupt berührt. Deshalb sind die Vektoren nicht „irgendein Replay",
 * sondern gezielt auf die Stellen gelegt, an denen implementierungsdefinierte
 * Mathematik in den Zustand einfließt:
 *
 *  - `diagonal`  — Diagonalbewegung (Math.SQRT1_2, Math.atan2 für die
 *                  Blickrichtung), viele Kantenübertritte
 *  - `gleiten`   — Kollision mit Gleiten an Kanten (Projektionen, Wurzeln)
 *  - `skript`    — skriptgesteuerte Bewegung (Math.hypot in der Zielführung)
 *
 * Die erwarteten Digests stehen als Konstanten im Code. Node und Browser
 * vergleichen gegen dieselbe Konstante — stimmen beide, ist die Gleichheit
 * belegt; weicht einer ab, weiß man sofort, welcher.
 */

import {
  composeCameraSection,
  composeCompressedField,
  composeScriptSection,
  composeTriggersSection,
  composeWalkmeshSection,
  ScriptAssembler,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldEntry, SECTION, type FieldBundle, type Vec3 } from '@webmidgar/formats-field';
import { FieldSession, type FieldInput } from '@webmidgar/field-runtime';

/** Deterministische Pseudo-Eingaben (mulberry32) — nie `Math.random`. */
function eingaben(seed: number, takte: number): FieldInput[] {
  let a = seed | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: FieldInput[] = [];
  let dx = 1;
  let dy = 1;
  for (let i = 0; i < takte; i++) {
    if (next() < 0.15) {
      dx = Math.floor(next() * 3) - 1;
      dy = Math.floor(next() * 3) - 1;
    }
    out.push({ moveX: dx, moveY: dy, confirm: next() < 0.07, cancel: false });
  }
  return out;
}

function gitter(zellen: number, kante: number): WalkmeshSpec {
  const triangles: WalkmeshSpec['triangles'] = [];
  for (let gy = 0; gy < zellen; gy++) {
    for (let gx = 0; gx < zellen; gx++) {
      const a: Vec3 = [gx * kante, gy * kante, 0];
      const b: Vec3 = [(gx + 1) * kante, gy * kante, gx % 2 === 0 ? 0 : 12];
      const c: Vec3 = [gx * kante, (gy + 1) * kante, 0];
      const d: Vec3 = [(gx + 1) * kante, (gy + 1) * kante, gy % 3 === 0 ? 7 : 0];
      triangles.push({ vertices: [a, b, c] });
      triangles.push({ vertices: [b, d, c] });
    }
  }
  return { triangles };
}

/** Schmaler Korridor mit Knick — erzwingt Gleiten statt freier Bewegung. */
function korridor(): WalkmeshSpec {
  const t: WalkmeshSpec['triangles'] = [];
  for (let i = 0; i < 8; i++) {
    const x0 = i * 30;
    t.push({ vertices: [[x0, 0, 0], [x0 + 30, 0, 0], [x0, 20, 0]] });
    t.push({ vertices: [[x0 + 30, 0, 0], [x0 + 30, 20, 0], [x0, 20, 0]] });
  }
  return { triangles: t };
}

function skriptBytes(): { bytes: Uint8Array; npcOffset: number } {
  const held = new ScriptAssembler();
  held
    .label('start')
    .char(0)
    .xyzi(20, 20, 0, 0)
    .move(180, 90)
    .wait(3)
    .move(20, 20)
    .wait(3)
    .jmpb('start');
  const a = held.assemble();
  const npc = new ScriptAssembler();
  npc.label('npc').wait(5).ret();
  const b = npc.assemble();
  const bytes = new Uint8Array(a.bytes.length + b.bytes.length);
  bytes.set(a.bytes, 0);
  bytes.set(b.bytes, a.bytes.length);
  return { bytes, npcOffset: a.bytes.length };
}

function baueBundle(name: string, spec: WalkmeshSpec, mitSkript: boolean): FieldBundle {
  const skript = skriptBytes();
  const sections: Record<number, Uint8Array> = {
    [SECTION.SCRIPT]: composeScriptSection({
      entities: mitSkript
        ? [
            { name: 'held', entryPoints: [0] },
            { name: 'npc', entryPoints: [skript.npcOffset] },
          ]
        : [{ name: 'held', entryPoints: [skript.npcOffset] }],
      scriptBytes: skript.bytes,
      strings: [new TextEncoder().encode('r9')],
    }),
    [SECTION.CAMERA]: composeCameraSection([
      { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], position: [0, 0, -4096], zoom: 400 },
    ]),
    [SECTION.WALKMESH]: composeWalkmeshSection(spec),
    [SECTION.TRIGGERS]: composeTriggersSection({
      name,
      control: 1,
      gateways: [{ exitLine: [[200, 0, 0], [200, 200, 0]], destMaplistIndex: 1 }],
      triggers: [{ corners: [[10, 10, 0], [50, 50, 5]], behavior: 1 }],
    }),
  };
  const ergebnis = parseFieldEntry(composeCompressedField({ sections }), name);
  if (!ergebnis.bundle) throw new Error(`Vektorbundle ${name} nicht parsebar`);
  return ergebnis.bundle;
}

export interface ReplayVektor {
  name: string;
  takte: number;
  digest: string;
}

export const VEKTOR_TAKTE = 400;

/**
 * Berechnet alle Vektoren. Rein — keine Uhr, keine Zufallsquelle, kein IO.
 * Genau deshalb darf das Ergebnis über Engines hinweg verglichen werden.
 */
export function berechneReplayVektoren(): ReplayVektor[] {
  const faelle: { name: string; bundle: FieldBundle; seed: number }[] = [
    { name: 'diagonal', bundle: baueBundle('r9diag', gitter(5, 40), false), seed: 0x51a5 },
    { name: 'gleiten', bundle: baueBundle('r9glei', korridor(), false), seed: 0x2f13 },
    { name: 'skript', bundle: baueBundle('r9skri', gitter(6, 35), true), seed: 0x7c4d },
  ];
  return faelle.map(({ name, bundle, seed }) => {
    const sitzung = new FieldSession(bundle, { seed: 11, dialogMode: 'auto', start: { x: 20, y: 15 } });
    for (const input of eingaben(seed, VEKTOR_TAKTE)) sitzung.tick(input);
    return { name, takte: VEKTOR_TAKTE, digest: sitzung.digest() };
  });
}

/**
 * Erwartete Digests — gemessen am 2026-08-10 in Node 22, Chromium 148
 * (Browser-Pane) und Chromium 151 (kopflos), jeweils identisch.
 *
 * Die Werte stammen aus dem Stand **nach** der R9-Härtung: Vor der
 * Quantisierung der Richtungswinkel wich der Vektor `skript` zwischen Node 22
 * und Chromium 151 ab (a122762f32833f86 gegen 2baf122fe0959524), weil das
 * rohe `Math.atan2`-Ergebnis im Zustand landete und sich `atan2` zwischen
 * beiden V8-Ständen bitweise unterscheidet. Eine erneute Abweichung ist kein
 * Testartefakt, sondern genau der Befund, den R9 sucht.
 */
/**
 * **Fortschreibung 2026-08-10 (O9).** Alle drei Werte haben sich geändert.
 * Das ist ein bewusster `engineCompat`-Schritt, kein maskierter Rückschritt —
 * die beiden Ursachen sind benannt und einzeln nachvollziehbar:
 *
 *  1. **Operandenlängen.** Die vier Wort-Varianten der IF-Familie tragen eine
 *     zwei Byte breite linke Adresse; vorher wurde ein Byte gelesen und alles
 *     danach verrutschte. Betrifft direkt nur `skript`.
 *  2. **Sitzungsschema 1 → 2.** Der Snapshot führt jetzt die
 *     Stillstandszähler mit. Der Digest läuft über den Snapshot, also ändert
 *     ein zusätzliches Feld **jeden** Vektor — auch `diagonal` und `gleiten`,
 *     die gar kein Script ausführen. Wären diese beiden *nicht*
 *     mitgewandert, wäre das der eigentliche Alarm gewesen.
 *
 * Vorherige Werte (Stand nach der R9-Härtung, zum Nachvollziehen):
 * `diagonal 8f3579c8c25b109d`, `gleiten 3e159880012168ad`,
 * `skript f7a597e17a462ee8`.
 */
/**
 * **Fortschreibung 2026-08-10 (S21).** Wieder haben sich alle drei Werte
 * geändert, und wieder aus einer einzigen, benennbaren Ursache: Der
 * Runtime-Zustand führt mit `menuAccessRaw` ein zusätzliches Feld (Zustand des
 * `MENU2`-Opcodes). Der Digest läuft über den gesamten Zustandsbaum, also
 * wandert er auch für `diagonal` und `gleiten`, die kein Menü aufrufen.
 *
 * **Die Gegenprobe ist wieder dieselbe und sie ist der eigentliche Wert dieses
 * Tests:** Hätten sich nur `skript`, aber nicht die beiden reinen
 * Bewegungsvektoren geändert, wäre die Ursache NICHT das Zustandsschema
 * gewesen — dann hätte die Menü-Semantik die Bewegungsrechnung berührt, und
 * das wäre ein echter Fehler.
 *
 * Vorherige Werte (Stand nach O9): `diagonal d3db5a117a435444`,
 * `gleiten c004f67d35b3e19c`, `skript 81dc6abb5d5e9311`.
 */
export const ERWARTETE_DIGESTS: Readonly<Record<string, string>> = {
  diagonal: 'ae692c2df57cee63',
  gleiten: 'c09f412edb884cdb',
  skript: '2cbf1510b831a8f8',
};

export interface VektorVergleich {
  name: string;
  erwartet: string;
  gemessen: string;
  gleich: boolean;
}

export function vergleicheGegenErwartung(vektoren: readonly ReplayVektor[]): VektorVergleich[] {
  return vektoren.map((v) => {
    const erwartet = ERWARTETE_DIGESTS[v.name] ?? '';
    return { name: v.name, erwartet, gemessen: v.digest, gleich: erwartet === v.digest };
  });
}
