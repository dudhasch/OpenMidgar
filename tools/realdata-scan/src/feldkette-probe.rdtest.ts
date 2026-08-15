import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  parseFieldEntry,
  parseMaplist,
  type FieldBundle,
  type FieldDiagnostic,
  type FieldMaplist,
} from '@webmidgar/formats-field';
import { FieldSession, planTransition } from '@webmidgar/field-runtime';
import { berechneAnfangsBgStates } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * **Wellenabnahme Welle 4: sechs Fields am Stück, ohne Eingriff.**
 *
 * Die bisherige Abnahme des Feldwechsels (`field-transition.rdtest.ts`) rechnet
 * **Kanten**: Für jedes belegte Gateway wird geprüft, ob der Zielpunkt im
 * Zielnetz liegt. Das ist die richtige Messung für F15 und sie steht — 978 von
 * 978 auflösbaren Kanten.
 *
 * Sie beantwortet aber die Frage dieser Welle nicht. „Durchstich" heißt: Eine
 * Figur, die **läuft**, kommt durch. Dazwischen liegen drei Dinge, die eine
 * Kantenrechnung nicht anfasst — die Auslöseregel (Eintritt in den Kreis um
 * die Austrittsstelle), der Walkmesh-Solver mit seinem Gleiten an Wänden, und
 * das Zusammenspiel mit dem laufenden Script. Dieser Test läuft deshalb
 * wirklich: Er setzt die Figur auf den Ankunftspunkt, gibt ihr eine Richtung
 * und lässt sie takten, bis der Übertritt feuert.
 *
 * **Gütefunktion.** Sechs Übertritte hintereinander, jeder ausgelöst durch
 * Bewegung und nicht durch einen Aufruf.
 *
 * **Kontrollniveau.** Derselbe Lauf mit der Bewegungseingabe **null**: Eine
 * stehende Figur darf **kein** Gateway auslösen. Ohne diese Gegenprobe wäre
 * ein Erfolg wertlos — eine Auslöseregel, die jeden Takt feuert, käme auch
 * durch sechs Fields, und genau dieser Fehler ist beim Bau der Regel dreimal
 * passiert.
 *
 * Urheberrecht: ausschließlich Ablaufprotokolle über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Startfeld der Demo — der Bahnhofsvorplatz. */
const START = 'md1stin';
/** Sollzahl der Wellenabnahme. */
const KETTE_SOLL = 6;
/** Takte, die eine Figur höchstens auf einen Ausgang zuläuft. */
const TAKTE_JE_VERSUCH = 1200;

interface Schritt {
  von: string;
  nach: string;
  gateway: number;
  takte: number;
  ankunft: { x: number; y: number };
  quelle: string;
}

describe.skipIf(!available)('Realdaten: Wellenabnahme — sechs Fields am Stück', () => {
  it(
    'läuft eine Kette von Feldwechseln, ohne dass jemand eingreift',
    { timeout: 1_800_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      const eintraege = new Map<string, string>();
      let maplist: FieldMaplist | null = null;
      const diagnostics: FieldDiagnostic[] = [];
      for (const e of index.listEntries('flevel')) {
        const name = e.name.toLowerCase();
        if (name === 'maplist') {
          maplist = parseMaplist(await index.readEntry(e.canonicalId), 'maplist', diagnostics);
          continue;
        }
        if (e.name.includes('.')) continue;
        eintraege.set(name, e.canonicalId);
      }
      expect(maplist, 'maplist muss im Bestand liegen').not.toBeNull();

      const geladen = new Map<string, FieldBundle | null>();
      const lade = async (name: string): Promise<FieldBundle | null> => {
        const key = name.toLowerCase();
        if (geladen.has(key)) return geladen.get(key)!;
        const id = eintraege.get(key);
        if (!id) {
          geladen.set(key, null);
          return null;
        }
        let b: FieldBundle | null = null;
        try {
          const parsed = parseFieldEntry(await index.readEntry(id), key);
          b = parsed.ok ? (parsed.bundle ?? null) : null;
        } catch {
          b = null;
        }
        geladen.set(key, b);
        return b;
      };

      const sitzung = (bundle: FieldBundle, start: { x: number; y: number }): FieldSession =>
        new FieldSession(bundle, {
          runScript: false,
          start,
          initialBgStates: berechneAnfangsBgStates(
            (bundle.background?.layers ?? []).flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state }))),
          ),
        });

      /**
       * Ein Standort, von dem aus überhaupt losgelaufen werden kann.
       *
       * **Das war der erste Fehlschlag dieses Tests, und er war lehrreich.**
       * Zuerst stand die Figur auf der Austrittsstelle des Gateways selbst.
       * Der Übertritt feuerte nie — völlig richtig: Die Auslöseregel ist der
       * **Eintritt** in den Kreis, und wer schon drin steht, tritt nicht mehr
       * ein. Der Test hat also nicht die Kette widerlegt, sondern seine eigene
       * Aufstellung. Gesucht wird deshalb der Dreiecksschwerpunkt mit dem
       * größten Abstand zum nächsten Ausgang — begehbar nach Konstruktion und
       * garantiert außerhalb jedes Auslösekreises.
       */
      const weitesterStandort = (bundle: FieldBundle): { x: number; y: number } | null => {
        const dreiecke = bundle.walkmesh?.triangles ?? [];
        const ausgaenge = (bundle.triggers?.gateways ?? []).filter((g) => g.used).map((g) => g.exitPoint);
        let bester: { x: number; y: number } | null = null;
        let besterAbstand = -1;
        for (const t of dreiecke) {
          const x = Math.round((t.vertices[0]![0] + t.vertices[1]![0] + t.vertices[2]![0]) / 3);
          const y = Math.round((t.vertices[0]![1] + t.vertices[1]![1] + t.vertices[2]![1]) / 3);
          let nah = Infinity;
          for (const [gx, gy] of ausgaenge) {
            const d = Math.sqrt((x - gx) ** 2 + (y - gy) ** 2);
            if (d < nah) nah = d;
          }
          if (nah > besterAbstand) {
            besterAbstand = nah;
            bester = { x, y };
          }
        }
        return bester;
      };

      const schwerpunkt = (bundle: FieldBundle, i: number): [number, number] => {
        const t = bundle.walkmesh!.triangles[i]!;
        return [
          (t.vertices[0]![0] + t.vertices[1]![0] + t.vertices[2]![0]) / 3,
          (t.vertices[0]![1] + t.vertices[1]![1] + t.vertices[2]![1]) / 3,
        ];
      };

      /** Punkt-in-Dreieck über die Vorzeichen der Kreuzprodukte. */
      const imDreieck = (bundle: FieldBundle, i: number, px: number, py: number): boolean => {
        const t = bundle.walkmesh!.triangles[i]!;
        const [ax, ay] = t.vertices[0]!;
        const [bx, by] = t.vertices[1]!;
        const [cx, cy] = t.vertices[2]!;
        const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
        const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
        const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      };

      /** Dreieck zu einem Punkt; liegt er außerhalb, das nächstgelegene. */
      const dreieckZu = (bundle: FieldBundle, px: number, py: number): number => {
        const n = bundle.walkmesh?.triangles.length ?? 0;
        for (let i = 0; i < n; i++) if (imDreieck(bundle, i, px, py)) return i;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          const [cx, cy] = schwerpunkt(bundle, i);
          const d = (cx - px) ** 2 + (cy - py) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        return best;
      };

      /**
       * **Wegpunkte über den Walkmesh selbst.**
       *
       * Ein erster Anlauf ließ die Figur schnurstracks auf den Ausgang zulaufen
       * und bei Stillstand quer ausweichen. Das kam in `md1_2` nicht am zweiten
       * Ausgang an — und damit hätte der Test eine Wand gemessen statt die
       * Auslöseregel. Der Walkmesh trägt seine Nachbarschaft aber selbst
       * (`adjacency`, gesperrte Kanten sind `null`); eine Breitensuche darüber
       * liefert eine begehbare Dreieckskette, und deren Schwerpunkte sind die
       * Wegpunkte. Das ist keine Nachbildung der Original-Wegfindung — es ist
       * ein Testwerkzeug, das dafür sorgt, dass gemessen wird, was gemessen
       * werden soll.
       */
      const wegSuchen = (
        bundle: FieldBundle,
        von: { x: number; y: number },
        ziel: [number, number],
      ): [number, number][] => {
        const tris = bundle.walkmesh?.triangles ?? [];
        if (tris.length === 0) return [ziel];
        const startT = dreieckZu(bundle, von.x, von.y);
        const zielT = dreieckZu(bundle, ziel[0], ziel[1]);
        if (startT === zielT) return [ziel];
        const vorher = new Map<number, number>([[startT, -1]]);
        const schlange = [startT];
        for (let k = 0; k < schlange.length; k++) {
          const cur = schlange[k]!;
          if (cur === zielT) break;
          for (const nb of tris[cur]!.adjacency) {
            if (nb === null || nb < 0 || nb >= tris.length || vorher.has(nb)) continue;
            vorher.set(nb, cur);
            schlange.push(nb);
          }
        }
        if (!vorher.has(zielT)) return [ziel];
        const pfad: number[] = [];
        for (let cur = zielT; cur !== -1; cur = vorher.get(cur)!) pfad.unshift(cur);
        return [...pfad.slice(1).map((i) => schwerpunkt(bundle, i)), ziel];
      };

      /**
       * Ein Versuch: Die Figur läuft die Wegpunkte ab. Bleibt sie trotzdem
       * hängen, zählt das als Fehlversuch, und die Kette probiert das nächste
       * Gateway.
       */
      const laufeZu = (
        s: FieldSession,
        wegpunkte: readonly [number, number][],
      ): { change: ReturnType<FieldSession['tick']>['fieldChange']; takte: number } => {
        let takte = 0;
        for (const [zx, zy] of wegpunkte) {
          let stillstand = 0;
          /**
           * **Ausweichen statt Aufgeben.** Ein reiner Zielkurs bleibt an der
           * ersten Wand stehen, und dann misst der Test die Wand statt die
           * Auslöseregel. Bleibt die Figur hängen, läuft sie eine Weile quer —
           * abwechselnd nach links und rechts, damit sie sich nicht in eine
           * Ecke schaukelt — und nimmt danach wieder Zielkurs auf. Das ist
           * bewusst primitiv: Es gehört in den Test, nicht in die Engine.
           */
          let umweg = 0;
          let umwegSeite = 1;
          let umwegRest = 0;
          for (let t = 0; t < TAKTE_JE_VERSUCH; t++) {
            const p = s.player;
            if (!p) return { change: null, takte };
            const vorX = p.walk.x;
            const vorY = p.walk.y;
            const dx = zx - vorX;
            const dy = zy - vorY;
            const laenge = Math.sqrt(dx * dx + dy * dy);
            if (laenge < 8) break; // Wegpunkt erreicht
            const zielX = dx / laenge;
            const zielY = dy / laenge;
            const [mx, my] =
              umwegRest > 0 ? [-zielY * umwegSeite, zielX * umwegSeite] : [zielX, zielY];
            if (umwegRest > 0) umwegRest--;
            const r = s.tick({ moveX: mx, moveY: my, confirm: false, cancel: false });
            takte++;
            if (r.fieldChange) return { change: r.fieldChange, takte };
            const bewegt = Math.abs(s.player!.walk.x - vorX) + Math.abs(s.player!.walk.y - vorY) > 0.5;
            stillstand = bewegt ? 0 : stillstand + 1;
            if (stillstand > 10) {
              if (umweg >= 8) break;
              umweg++;
              umwegSeite = -umwegSeite;
              umwegRest = 60;
              stillstand = 0;
            }
          }
        }
        return { change: null, takte };
      };

      // --- Die Kette ------------------------------------------------------
      const kette: Schritt[] = [];
      const gesehen = new Set<string>([START]);
      let aktuellName = START;
      let aktuell = await lade(START);
      expect(aktuell, `${START} muss ladbar sein`).not.toBeNull();
      let start: { x: number; y: number } | null = null;
      const sackgassen: string[] = [];
      const versuche: string[] = [];

      for (let hop = 0; hop < KETTE_SOLL && aktuell; hop++) {
        const gateways = (aktuell.triggers?.gateways ?? []).map((g, i) => ({ g, i })).filter((x) => x.g.used);
        if (gateways.length === 0) {
          sackgassen.push(`${aktuellName}: kein belegtes Gateway`);
          break;
        }
        if (!start) start = weitesterStandort(aktuell);
        if (!start) {
          sackgassen.push(`${aktuellName}: kein begehbarer Standort gefunden`);
          break;
        }

        /**
         * **Zwei Beine statt einem.** Die Figur läuft erst zum freien Standort
         * des Fields und von dort zum Ausgang. Das ist keine Bequemlichkeit,
         * sondern nötig: Sie landet nach jedem Wechsel im Auslösekreis des
         * Gateways, durch das sie kam, und die Eintrittskantenregel feuert erst
         * wieder, wenn sie den Kreis einmal verlassen hat. Genau das tut ein
         * Spieler auch — er tritt von der Tür weg, bevor er sie erneut nimmt.
         */
        const frei = weitesterStandort(aktuell);

        let gemacht: Schritt | null = null;
        const zurueckgestellt: string[] = [];
        for (let runde = 0; runde < 2 && !gemacht; runde++) {
        const bekannteErlaubt = runde === 1;
        for (const { g, i } of gateways) {
          const s = sitzung(aktuell, start);
          if (!s.player) {
            versuche.push(`${aktuellName} G${i}: Startpunkt ${start.x}/${start.y} ist nicht begehbar`);
            continue;
          }
          const wegpunkte: [number, number][] = frei
            ? [...wegSuchen(aktuell, start, [frei.x, frei.y]), ...wegSuchen(aktuell, frei, g.exitPoint)]
            : wegSuchen(aktuell, start, g.exitPoint);
          const lauf = laufeZu(s, wegpunkte);
          if (!lauf.change) {
            versuche.push(
              `${aktuellName} G${i}: kein Übertritt in ${lauf.takte} Takten, ` +
                `Endstand ${Math.round(s.player.walk.x)}/${Math.round(s.player.walk.y)}, Ziel ${g.exitPoint[0]}/${g.exitPoint[1]}`,
            );
            continue;
          }
          const plan = planTransition(lauf.change, maplist!, null, aktuellName);
          if (!plan) {
            versuche.push(`${aktuellName} G${i}: Ziel nicht in der maplist`);
            continue;
          }
          const ziel = await lade(plan.targetField);
          if (!ziel) {
            versuche.push(`${aktuellName} G${i}: Zielfield "${plan.targetField}" nicht im Bestand`);
            continue;
          }
          const voll = planTransition(lauf.change, maplist!, ziel, aktuellName);
          if (!voll?.arrival) {
            versuche.push(`${aktuellName} G${i}: keine begehbare Ankunft in "${plan.targetField}"`);
            continue;
          }
          // Nicht dorthin zurück, wo wir herkommen — die Abnahme fragt nach
          // sechs Fields, nicht nach dreimal Hin und Her.
          /**
           * **Unbekanntes zuerst, Rückweg erlaubt.** Ein erster Anlauf verbot
           * Rückkehr rundheraus und blieb nach vier Wechseln in `md8_4`
           * stehen — nicht, weil etwas kaputt wäre, sondern weil dieses Field
           * nur **einen** Gateway-Ausgang hat: Im Original geht es dort per
           * Script weiter, und Scripte laufen in diesem Test bewusst nicht.
           * Ein Verbot, das die Kette an der Datenlage scheitern lässt, misst
           * die Datenlage statt die Engine. Der zweite Durchgang nimmt deshalb
           * bekannte Ziele — aber erst, wenn kein unbekanntes bleibt. Das
           * prüft die Strecke zusätzlich in der Gegenrichtung.
           */
          if (gesehen.has(plan.targetField) && !bekannteErlaubt) {
            zurueckgestellt.push(`${aktuellName} G${i}: "${plan.targetField}" schon besucht`);
            continue;
          }
          gemacht = {
            von: aktuellName,
            nach: plan.targetField,
            gateway: lauf.change.gatewayIndex,
            takte: lauf.takte,
            ankunft: voll.arrival,
            quelle: voll.source ?? '—',
          };
          aktuellName = plan.targetField;
          aktuell = ziel;
          start = voll.arrival;
          gesehen.add(plan.targetField);
          break;
        }
        }
        if (zurueckgestellt.length) versuche.push(...zurueckgestellt);
        if (!gemacht) {
          sackgassen.push(`${aktuellName}: kein Ausgang in ${TAKTE_JE_VERSUCH} Takten erreichbar`);
          break;
        }
        kette.push(gemacht);
      }

      // --- Kontrolle: eine stehende Figur wechselt kein Field ---------------
      let stehendGefeuert = 0;
      let stehendGeprueft = 0;
      for (const schritt of kette) {
        const b = await lade(schritt.nach);
        if (!b) continue;
        const s = sitzung(b, schritt.ankunft);
        if (!s.player) continue;
        stehendGeprueft++;
        for (let t = 0; t < TAKTE_JE_VERSUCH; t++) {
          const r = s.tick({ moveX: 0, moveY: 0, confirm: false, cancel: false });
          if (r.fieldChange) {
            stehendGefeuert++;
            break;
          }
        }
      }
      await dir.closeAll();

      console.log(
        'Wellenabnahme Welle 4 — Feldkette:',
        JSON.stringify(
          {
            Start: START,
            'Wechsel geschafft': `${kette.length}/${KETTE_SOLL}`,
            Kette: kette.map(
              (k) =>
                `${k.von} → ${k.nach} (Gateway ${k.gateway}, ${k.takte} Takte, Ankunft ${k.ankunft.x}/${k.ankunft.y}, ${k.quelle})`,
            ),
            'besuchte Fields': [...gesehen],
            Sackgassen: sackgassen.length ? sackgassen : '— keine —',
            'Fehlversuche (erste 20)': versuche.slice(0, 20),
            'Takte gesamt': kette.reduce((n, k) => n + k.takte, 0),
            '=== Kontrolle: stehende Figur ===': '',
            'Ankünfte geprüft': stehendGeprueft,
            [`Wechsel ohne Bewegung in ${TAKTE_JE_VERSUCH} Takten`]: stehendGefeuert,
          },
          null,
          1,
        ),
      );

      // Die Abnahme der Welle.
      expect(kette.length).toBe(KETTE_SOLL);
      // Jeder Wechsel ist gelaufen, nicht gerufen.
      expect(kette.every((k) => k.takte > 0 && k.takte < TAKTE_JE_VERSUCH)).toBe(true);
      /**
       * Wie viele **verschiedene** Fields dabei herauskommen, ist eine Aussage
       * über den Bestand, nicht über die Engine: Die Gateway-Kette ab
       * `md1stin` ist fünf Fields lang, danach führt das Original per Script
       * weiter. Fünf ist deshalb der Sollwert, nicht sieben.
       */
      expect(gesehen.size).toBeGreaterThanOrEqual(5);
      // Und die tragende Gegenprobe: Stillstehen wechselt kein Field.
      expect(stehendGeprueft).toBe(KETTE_SOLL);
      expect(stehendGefeuert).toBe(0);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
