import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import type { AnimationFrame } from '@webmidgar/formats-model';
import { ff7ToScene } from '@webmidgar/convert';
import { computePose } from '@webmidgar/render-actor';
import { NodeDirectorySource } from './node-source.js';
import {
  H, W, dreiecke, html, ladeModelle, rasterize, texturierteDreiecke,
  type Dreieck, type Fall, type Modell, type Vec3,
} from './sheet.js';

/**
 * O4-Resttafel — die vier Posten, die die B1..B8-Runde NICHT geschlossen hat.
 *
 * Nach der O4-Bilanz (2026-08-10) sind sechs Annahmen entschieden. Übrig
 * bleiben vier, und sie zerfallen in zwei sehr verschiedene Sorten:
 *
 *  - **B7 ist widerlegt, ohne Ersatz.** Der Wurzelpivot liegt in der Hüfte,
 *    nicht am Bodenkontaktpunkt. Damit ist offen, welcher Punkt des Modells
 *    auf dem Walkmesh aufsetzt.
 *  - **B3, B4, B10 sind unbelegt.** Sie stehen im Code als Auslegung, ohne
 *    dass je gemessen wurde, ob die Gegenauslegung schlechter aussieht.
 *
 * **Warum eine Tafel und keine Kennzahl.** Die Bilanz der fünf Messanläufe bei
 * B1 steht in R4-MODELL-KONVENTIONEN.md: Vier Aggregatmaße haben dieselbe
 * Frage viermal nicht beantwortet und dabei jedes Mal überzeugend ausgesehen.
 * Entschieden hat die fünfte Runde mit 50 Bildern in Minuten.
 *
 * **Warum diese Tafel trotzdem anders gebaut ist als die B1-Tafel.** Die
 * O4-Bilanz hält fest, dass B7 per Auge *grundsätzlich* nicht zu schließen
 * ist: Die Wurzeltranslation verschiebt Figur und Pivot gemeinsam, das Bild
 * sieht bei jedem Versatz gleich aus. Der Ausweg ist eine **externe Referenz**
 * — hier eine eingezeichnete Bodenlinie und, entscheidend, ein **festes
 * Sichtfenster** über alle Varianten eines Modells. Ohne das feste Fenster
 * würde die Einpassung jede Höhenverschiebung sofort wieder wegzentrieren und
 * die Tafel zeigte in jeder Zelle dasselbe Bild — genau die blinde
 * Gütefunktion, nur mit dem Auge als Messgerät.
 *
 * **Die drei Fallen, gegen die hier gebaut wird** (alle im Projekt bezahlt):
 *
 *  1. *Blinde Gütefunktion.* Jede Gruppe hat eine Antwortmöglichkeit „kaum
 *     Unterschied zu den Nachbarzellen". Wird sie gewählt, ist das ein
 *     Ergebnis über die Tafel, nicht über FF7 — die Auslegung ist dann
 *     folgenlos und darf so dokumentiert werden.
 *  2. *Der Prüfgegenstand trägt die Frage nicht.* Bei B5/B6 ging das zweimal
 *     schief (Effektsprite für eine Farbfrage, rotierendes Objekt für eine
 *     Ausrichtungsfrage). Deshalb wird hier **vor** dem Erzeugen jeder Zelle
 *     geprüft, dass die Varianten sich im Bild überhaupt unterscheiden, und
 *     bei B4 zusätzlich, dass die Gegenreihenfolge von der Dateireihenfolge
 *     abweicht.
 *  3. *Trivial richtige Zelle.* Bei B7 setzt die Variante „tiefster Mesh-Punkt
 *     auf den Boden" **per Konstruktion** auf. Sie kann gar nicht schweben.
 *     Ihr „sieht richtig aus" ist wertlos; aussagekräftig ist allein, ob die
 *     heutige Auslegung daneben liegt und um wie viel. Das steht auch im
 *     Formular, damit das Urteil nicht daran hängen bleibt.
 *
 * **Was B4 angeht, wurde die naive Gegenhypothese verworfen, bevor sie Bilder
 * erzeugt hat.** `hrc.ts` legt Bones in Dateireihenfolge an (`fileOrder: i`),
 * es gibt keine Umsortierung — „Array- statt Dateireihenfolge" wäre also per
 * Konstruktion dieselbe Zuordnung und hätte eine vollständig aussehende, aber
 * leere Tafel ergeben. Echte Alternativen sind Tiefen- und Breitensuche über
 * die Hierarchie; beide werden nur dort gezeigt, wo sie von der
 * Dateireihenfolge tatsächlich abweichen.
 *
 * **Datenschutz/Urheberrecht:** läuft ausschließlich lokal, kein Upload. Die
 * erzeugte HTML-Datei enthält gerenderte Bilder aus der Installation des
 * Nutzers und gehört deshalb NICHT ins Repo.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

/**
 * 🔵 Ausgabeort der Tafel: Temp-Verzeichnis des Systems, überschreibbar per
 * Umgebungsvariable. Hier stand vorher der Scratchpad-Pfad EINER längst
 * beendeten Sitzung — er existiert auf keinem anderen Rechner und in keiner
 * späteren Sitzung. Ein Diagnosewerkzeug darf nicht davon abhängen, wo es
 * zufällig zuerst gelaufen ist.
 */
const OUT = process.env['WEBMIDGAR_O4_OUT'] ?? join(tmpdir(), 'webmidgar-sheets', 'o4-formular.html');

const available = existsSync(REAL_DIR);

/**
 * Boden bei Szenenhöhe 0, hinter der Figur: **Fläche statt Linie**.
 *
 * Eine bloße Linie hat sich als zu schwach erwiesen — ein Versatz von 16 % der
 * Figurhöhe war im Bild kaum zu erkennen, und eine Tafel, deren Unterschiede
 * man suchen muss, lädt zu Zufallsurteilen ein. Der gesamte Bereich unter dem
 * Boden bekommt deshalb eine andere Farbe: Eine Figur, die einsinkt, steht
 * dann sichtbar VOR der dunklen Fläche statt vor dem Hintergrund, und
 * „schwebt" gegen „steckt drin" ist auf einen Blick entscheidbar.
 */
function boden(halbBreite: number, dicke: number, tiefe: number, z: number, linie: Vec3, erde: Vec3): Dreieck[] {
  const leer: [[number, number], [number, number], [number, number]] = [[0, 0], [0, 0], [0, 0]];
  const quad = (x0: number, y0: number, x1: number, y1: number, farbe: Vec3): Dreieck[] => {
    const c: [Vec3, Vec3, Vec3] = [farbe, farbe, farbe];
    const e = (x: number, y: number): Vec3 => [x, y, z];
    return [
      { p: [e(x0, y0), e(x1, y0), e(x1, y1)], uv: leer, col: c, tex: null },
      { p: [e(x0, y0), e(x1, y1), e(x0, y1)], uv: leer, col: c, tex: null },
    ];
  };
  return [
    ...quad(-halbBreite, -tiefe, halbBreite, -dicke, erde),
    ...quad(-halbBreite, -dicke, halbBreite, 0, linie),
  ];
}

/** Höhenbereich und Tiefenbereich einer Dreiecksliste in Szenenkoordinaten. */
function spanne(tris: Dreieck[]): { minY: number; maxY: number; minZ: number; minX: number; maxX: number } {
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, minX = Infinity, maxX = -Infinity;
  for (const t of tris) for (const p of t.p) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
  }
  return { minY, maxY, minZ, minX, maxX };
}

/** Tiefensuche über die Bone-Hierarchie, Kinder in Dateireihenfolge. */
function tiefensuche(parents: number[]): number[] {
  const kinder = parents.map(() => [] as number[]);
  const wurzeln: number[] = [];
  for (let i = 0; i < parents.length; i++) {
    if (parents[i]! < 0) wurzeln.push(i);
    else kinder[parents[i]!]!.push(i);
  }
  const out: number[] = [];
  const ab = (i: number): void => {
    out.push(i);
    for (const k of kinder[i]!) ab(k);
  };
  for (const w of wurzeln) ab(w);
  return out;
}

/** Breitensuche über die Bone-Hierarchie. */
function breitensuche(parents: number[]): number[] {
  const kinder = parents.map(() => [] as number[]);
  const schlange: number[] = [];
  for (let i = 0; i < parents.length; i++) {
    if (parents[i]! < 0) schlange.push(i);
    else kinder[parents[i]!]!.push(i);
  }
  const out: number[] = [];
  for (let k = 0; k < schlange.length; k++) {
    const i = schlange[k]!;
    out.push(i);
    for (const c of kinder[i]!) schlange.push(c);
  }
  return out;
}

/**
 * Frame so umschreiben, dass `computePose` die Gegenauslegung liefert.
 *
 * `computePose` liest den Rotationsblock über `bone.fileOrder`. Soll Slot `j`
 * stattdessen dem Bone gehören, der in `ordnung` an Stelle `j` steht, genügt
 * es, die Blöcke zu permutieren — die Posenmathematik bleibt unangetastet.
 */
function umsortiert(frame: AnimationFrame, ordnung: number[]): AnimationFrame {
  const r = new Float32Array(frame.rotations.length);
  for (let platz = 0; platz < ordnung.length; platz++) {
    const bone = ordnung[platz]!;
    for (let k = 0; k < 3; k++) r[bone * 3 + k] = frame.rotations[platz * 3 + k] ?? 0;
  }
  return { rootRotation: frame.rootRotation, rootTranslation: frame.rootTranslation, rotations: r };
}

const BASIS = { palette: 'BGRA (heute)', flipV: false, flipU: false, vertexPerm: null } as const;

describe.skipIf(!available)('Realdaten: O4-Resttafel (B3, B4, B7, B10)', () => {
  it('erzeugt ein Testformular für die vier offenen R4-Posten', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const modelle = await ladeModelle(dir, index, 60);
    await dir.closeAll();

    for (const m of modelle) m.texDreiecke = texturierteDreiecke(m);
    // Figürliche Modelle mit vielen Bones: Ein Objekt mit drei Bones kann weder
    // die Bodenfrage noch die Reihenfolgefrage tragen.
    const figuren: Modell[] = [...modelle]
      .filter((m) => m.skeleton.bones.length >= 8 && m.res.size > 0)
      .sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length);
    expect(figuren.length).toBeGreaterThan(2);

    const faelle: Fall[] = [];
    const notizen: string[] = [];

    // ================================================================
    // B7 — welcher Punkt des Modells setzt auf dem Walkmesh auf?
    // ================================================================
    const B7_FRAGE =
      'Die waagerechte helle Linie ist der Boden (Walkmesh-Ebene). Frage: Steht die Figur darauf? ' +
      'ACHTUNG — die Variante „tiefster Mesh-Punkt" setzt PER KONSTRUKTION auf und kann gar nicht schweben; ' +
      'ihr „richtig" beweist nichts. Aussagekräftig ist allein, ob die heutigen Varianten (Modellursprung, ' +
      'Wurzelbone) daneben liegen und wie weit.';

    let b7 = 1;
    for (const [n, m] of figuren.slice(0, 3).entries()) {
      const roh = dreiecke(m, BASIS);
      if (roh.length === 0) continue;
      const s = spanne(roh);

      const poses = computePose(m.skeleton, m.clip.frames[0]!, true);
      const wurzelIdx = m.skeleton.bones.findIndex((b) => b.parentIndex < 0);
      const wurzelY = wurzelIdx >= 0 ? (ff7ToScene(poses[wurzelIdx]!.origin) as Vec3)[1] : 0;
      let tiefsterBoneY = Infinity;
      for (const p of poses) {
        const y = (ff7ToScene(p.origin) as Vec3)[1];
        if (y < tiefsterBoneY) tiefsterBoneY = y;
      }

      const hoehe = Math.max(1e-6, s.maxY - s.minY);
      // Festes Fenster für ALLE Varianten dieses Modells: etwas mehr als die
      // Figurhöhe, Boden bei 0 in der unteren Hälfte. Ohne das ist die Tafel
      // gegen genau die Größe blind, die sie messen soll.
      const halbHoehe = hoehe * 0.72;
      const fenster = { cx: (s.minX + s.maxX) / 2, cy: halbHoehe * 0.42, halbHoehe };
      const bodenTris = boden(hoehe * 1.4, hoehe * 0.014, hoehe * 3, s.minZ - hoehe * 0.5, [130, 180, 240], [46, 52, 64]);

      const KANDIDATEN: Array<[string, number, string]> = [
        ['K1 Modellursprung auf dem Boden — DAS IST DIE HEUTIGE REGEL', 0,
          'dy = 0 — der Modellraum-Nullpunkt sitzt auf der Walkmesh-Höhe'],
        ['K2 Wurzelbone (Hüfte) auf dem Boden', -wurzelY,
          `dy = ${(-wurzelY).toFixed(1)} — das ist die durch B7 widerlegte Annahme`],
        ['K3 tiefster Mesh-Punkt auf dem Boden', -s.minY,
          `dy = ${(-s.minY).toFixed(1)} — setzt PER KONSTRUKTION auf, beweist für sich nichts`],
        ['K4 tiefstes Gelenk auf dem Boden', -tiefsterBoneY,
          `dy = ${(-tiefsterBoneY).toFixed(1)} — Fußgelenk statt Fußsohle`],
      ];

      const bilder: string[] = [];
      for (const [name, dy, detail] of KANDIDATEN) {
        const tris = [...bodenTris, ...dreiecke(m, { ...BASIS, versatzY: dy })];
        const png = rasterize(tris, { transparenz: true, aufkleberVersatz: true, fenster });
        bilder.push(png.toString('base64'));
        faelle.push({
          id: `B7-${b7++}`,
          gruppe: 'B7 — WIDERLEGT: welcher Punkt des Modells setzt auf dem Boden auf?',
          frage: B7_FRAGE,
          variante: name,
          detail: `Modell ${n + 1} · ${m.skeleton.bones.length} Bones · ${detail}`,
          png,
        });
      }
      // Kontrolle: Die vier Kandidaten MÜSSEN verschiedene Bilder liefern.
      // Wären sie gleich, hätte das feste Fenster nicht gegriffen und die
      // Gruppe wäre wertlos — dann lieber gar keine Tafel als eine leere.
      expect(new Set(bilder).size).toBe(4);
      notizen.push(
        `B7 Modell ${n + 1}: Figurhöhe ${hoehe.toFixed(1)}, Wurzelbone bei ${wurzelY.toFixed(1)}, ` +
        `Unterkante bei ${s.minY.toFixed(1)}, tiefstes Gelenk bei ${tiefsterBoneY.toFixed(1)} ` +
        `⇒ Abstand Wurzelbone↔Unterkante ${(wurzelY - s.minY).toFixed(1)} (${(((wurzelY - s.minY) / hoehe) * 100).toFixed(0)} % der Figurhöhe)`,
      );
    }

    // ================================================================
    // B3 — 24 Wurzel-Bytes: Rotation vor Translation, oder umgekehrt?
    // ================================================================
    let b3 = 1;
    for (const [n, m] of figuren.slice(0, 3).entries()) {
      // Den Frame mit dem STÄRKSTEN Signal wählen. Die zweite Hälfte trägt
      // laut Messung Werte bis 16,45, die erste ist zu 98,7 % genau 0 — ein
      // beliebiger Frame zeigte daher mit hoher Wahrscheinlichkeit gar nichts.
      let besterIdx = 0;
      let bestes = -1;
      for (const [i, f] of m.clip.frames.entries()) {
        const stark = Math.max(...f.rootTranslation.map(Math.abs), ...f.rootRotation.map(Math.abs));
        if (stark > bestes) { bestes = stark; besterIdx = i; }
      }
      const f = m.clip.frames[besterIdx]!;
      if (bestes < 1e-3) continue;

      const vertauscht: AnimationFrame = {
        rootRotation: [...f.rootTranslation] as [number, number, number],
        rootTranslation: [...f.rootRotation] as [number, number, number],
        rotations: f.rotations,
      };

      const VAR: Array<[string, AnimationFrame, string]> = [
        ['heute: Bytes 0–11 = Rotation, 12–23 = Translation', f,
          `Rot ${f.rootRotation.map((v) => v.toFixed(1)).join('/')} · Trans ${f.rootTranslation.map((v) => v.toFixed(1)).join('/')}`],
        ['vertauscht: Bytes 0–11 = Translation, 12–23 = Rotation', vertauscht,
          `Rot ${vertauscht.rootRotation.map((v) => v.toFixed(1)).join('/')} · Trans ${vertauscht.rootTranslation.map((v) => v.toFixed(1)).join('/')}`],
      ];

      const bilder: string[] = [];
      for (const [name, frame, detail] of VAR) {
        const png = rasterize(dreiecke(m, { ...BASIS, frame }), { transparenz: true, aufkleberVersatz: true });
        bilder.push(png.toString('base64'));
        faelle.push({
          id: `B3-${b3++}`,
          gruppe: 'B3 — UNBELEGT: welche Hälfte des 24-Byte-Wurzelblocks ist die Rotation?',
          frage:
            'Beide Zellen zeigen denselben Frame, einmal wie heute gelesen und einmal mit vertauschten Hälften. ' +
            'Frage: Steht die Figur in der einen Zelle gerade und in der anderen verkantet? Wenn beide gleich ' +
            'aussehen, ist die Auslegung folgenlos — bitte „kaum Unterschied" wählen, das ist ein gültiges Ergebnis.',
          variante: name,
          detail: `Modell ${n + 1} · Frame ${besterIdx}/${m.clip.frames.length} · ${detail}`,
          png,
        });
      }
      if (new Set(bilder).size === 1) {
        // Ehrlicher als eine Zelle, die Unterschied vortäuscht: Wenn die
        // Vertauschung nichts ändert, steht das im Bericht.
        notizen.push(`B3 Modell ${n + 1}: Vertauschung ändert das Bild NICHT (Signal ${bestes.toFixed(2)}).`);
      } else {
        notizen.push(`B3 Modell ${n + 1}: Vertauschung ändert das Bild, stärkster Frame ${besterIdx} (Signal ${bestes.toFixed(2)}).`);
      }
    }

    // ================================================================
    // B4 — adressieren Frames die Bones in Dateireihenfolge?
    // ================================================================
    let b4 = 1;
    let b4Modelle = 0;
    for (const m of figuren) {
      if (b4Modelle >= 3) break;
      const parents = m.skeleton.bones.map((b) => b.parentIndex);
      const dfs = tiefensuche(parents);
      const bfs = breitensuche(parents);
      const identisch = (o: number[]): boolean => o.every((v, i) => v === i);
      // Der entscheidende Filter: Wo die Gegenreihenfolge mit der
      // Dateireihenfolge zusammenfällt, kann die Zelle die Frage nicht tragen.
      if (identisch(dfs) && identisch(bfs)) continue;

      const f = m.clip.frames[0]!;
      const VAR: Array<[string, AnimationFrame, string]> = [
        ['Dateireihenfolge (heute)', f, 'Slot i gehört dem i-ten Bone der Datei'],
      ];
      if (!identisch(dfs)) VAR.push(['Tiefensuche über die Hierarchie', umsortiert(f, dfs), 'Slot i gehört dem i-ten Bone einer Tiefensuche']);
      if (!identisch(bfs)) VAR.push(['Breitensuche über die Hierarchie', umsortiert(f, bfs), 'Slot i gehört dem i-ten Bone einer Breitensuche']);

      const bilder: string[] = [];
      const gebaut: Fall[] = [];
      for (const [name, frame, detail] of VAR) {
        const png = rasterize(dreiecke(m, { ...BASIS, frame }), { transparenz: true, aufkleberVersatz: true });
        bilder.push(png.toString('base64'));
        gebaut.push({
          id: `B4-${b4++}`,
          gruppe: 'B4 — UNBELEGT: in welcher Reihenfolge adressieren die Frames die Bones?',
          frage:
            'Nur eine dieser Zuordnungen kann richtig sein — eine falsche verdreht einzelne Gliedmaßen, ' +
            'ohne die Figur als Ganzes zu kippen. Bitte auf Arme, Beine und Kopf achten, nicht auf die Gesamtlage.',
          variante: name,
          detail: `${m.skeleton.bones.length} Bones · ${detail}`,
          png,
        });
      }
      // Nur aufnehmen, wenn die Varianten sich auch im BILD unterscheiden.
      // Eine abweichende Permutation, die dasselbe Bild liefert (etwa weil die
      // betroffenen Bones Rotation 0 tragen), täuscht eine Prüfung vor.
      if (new Set(bilder).size < 2) {
        notizen.push(`B4: Modell mit ${m.skeleton.bones.length} Bones verworfen — Gegenreihenfolge ändert das Bild nicht.`);
        b4 -= VAR.length;
        continue;
      }
      faelle.push(...gebaut);
      b4Modelle++;
    }
    notizen.push(`B4: ${b4Modelle} Modelle mit wirksam abweichender Gegenreihenfolge gefunden.`);

    // ================================================================
    // B10 — bekommen texturierte Teilnetze zu Recht den Tiefenvorzug?
    // ================================================================
    let b10 = 1;
    for (const [n, m] of figuren.filter((x) => x.texDreiecke > 0).slice(0, 2).entries()) {
      const tris = dreiecke(m, BASIS);
      const aufkleber = tris.filter((t) => t.tex !== null);
      const rest = tris.filter((t) => t.tex === null);
      if (aufkleber.length === 0 || rest.length === 0) continue;

      // Der Versatz wächst mit dem Listenindex — die Zeichenreihenfolge IST
      // also die Vorzugsregel. Damit lässt sich die Regel umkehren, ohne den
      // Rasterizer anzufassen.
      const VAR: Array<[string, Dreieck[], boolean, string]> = [
        ['heute: texturierte Teilnetze bekommen den Vorzug', [...rest, ...aufkleber], true, 'Aufkleber zuletzt gezeichnet'],
        ['umgekehrt: die UNtexturierten bekommen den Vorzug', [...aufkleber, ...rest], true, 'Kontrollregel — muss schlechter aussehen'],
        ['gar kein Vorzug: der Rundungsfehler entscheidet', tris, false, 'koplanare Flächen streiten frei'],
      ];

      const bilder: string[] = [];
      for (const [name, liste, versatz, detail] of VAR) {
        const png = rasterize(liste, { transparenz: true, aufkleberVersatz: versatz });
        bilder.push(png.toString('base64'));
        faelle.push({
          id: `B10-${b10++}`,
          gruppe: 'B10 — UNBELEGT: ist „texturiert = Aufkleber" die richtige Vorzugsregel?',
          frage:
            'Die Regel ist eine Bauformregel, kein Datum der Datei. Die mittlere Zelle kehrt sie um und MUSS ' +
            'schlechter aussehen — tut sie das nicht, ist die Regel folgenlos und darf so dokumentiert werden. ' +
            'Bitte auf Augen und Mund achten.',
          variante: name,
          detail: `Modell ${n + 1} · ${m.texDreiecke} texturierte Dreiecke von ${tris.length} · ${detail}`,
          png,
        });
      }
      expect(new Set(bilder).size).toBeGreaterThan(1);
    }

    // ---------------------------------------------------------------
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      html(faelle, {
        titel: 'O4-Resttafel — B7 (widerlegt) und B3/B4/B10 (unbelegt)',
        speicher: 'o4-urteile',
        kennung: 'o4-rest',
        einleitung:
          '<p>Die B1..B8-Runde hat sechs Annahmen entschieden. Diese Tafel nimmt sich die vier vor, die übrig ' +
          'geblieben sind: <b>B7</b> ist <i>widerlegt ohne Ersatz</i> (der Wurzelpivot liegt in der Hüfte, nicht am ' +
          'Bodenkontaktpunkt), <b>B3</b>, <b>B4</b> und <b>B10</b> stehen unbelegt im Code.</p>' +
          '<p><b>Wichtig für B7:</b> Die Variante „tiefster Mesh-Punkt auf dem Boden" setzt <i>per Konstruktion</i> ' +
          'auf — sie kann gar nicht schweben, und ihr „sieht richtig aus" beweist nichts. Interessant ist, ob die ' +
          'heute verwendeten Varianten daneben liegen und wie weit.</p>' +
          '<p><b>„Kaum Unterschied" ist eine richtige Antwort</b>, kein Ausweichen. Wenn zwei Auslegungen dasselbe ' +
          'Bild liefern, ist die Auslegung folgenlos — das wird als solches dokumentiert, statt eine Semantik zu ' +
          'erfinden. Bei B10 ist die mittlere Zelle sogar absichtlich die <i>falsche</i> Regel: Sieht sie nicht ' +
          'schlechter aus, ist die Regel wirkungslos.</p>' +
          '<p>Unbeantwortete Fälle sind erlaubt und erscheinen im JSON als <code>offen</code>. Der Fortschritt ' +
          'bleibt beim Neuladen erhalten. Unten links steht das JSON — kopieren und zurückgeben.</p>',
        wahl: [
          ['richtig', 'sieht richtig aus'],
          ['schwebt', 'schwebt über dem Boden (B7)'],
          ['versinkt', 'steckt im Boden (B7)'],
          ['falsch', 'anders falsch — bitte Notiz'],
          ['kaum', 'kaum Unterschied zu den Nachbarzellen'],
          ['unklar', 'nicht beurteilbar'],
        ],
      }),
      'utf8',
    );

    console.log(`O4-Testformular geschrieben: ${OUT}`);
    console.log(`Testfälle: ${faelle.length} (B7 ${b7 - 1}, B3 ${b3 - 1}, B4 ${b4 - 1}, B10 ${b10 - 1})`);
    for (const z of notizen) console.log('  ' + z);

    // Die Tafel muss alle vier Posten tragen — eine Gruppe, die leer bleibt,
    // wäre stillschweigend weggefallen und niemand hätte es gemerkt.
    for (const posten of ['B7-', 'B3-', 'B4-', 'B10-']) {
      expect(faelle.some((f) => f.id.startsWith(posten))).toBe(true);
    }
    expect(faelle.length).toBeGreaterThanOrEqual(20);
    expect(W).toBe(210);
    expect(H).toBe(270);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
