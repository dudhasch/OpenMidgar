import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  resolveMaplistTarget,
  parseFieldEntry,
  parseMaplist,
  type FieldBundle,
  type FieldDiagnostic,
  type FieldMaplist,
} from '@webmidgar/formats-field';
import { FieldSession, planTransition, type FieldChange } from '@webmidgar/field-runtime';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-Abnahme des Field-Wechsels über den gesamten Bestand.
 *
 * Geprüft wird die vollständige Kette: belegtes Gateway → maplist-Index →
 * Zielfield → Gegen-Gateway → Ankunftspunkt im Ziel-Walkmesh. Entscheidend
 * ist die letzte Stufe: Der Ankunftspunkt muss BEGEHBAR sein, sonst stünde
 * die Figur nach dem Wechsel außerhalb des Meshs.
 *
 * Zusätzlich wird geprüft, dass die Ankunft nicht sofort wieder hinausführt —
 * ein Ankunftspunkt exakt auf der Austrittslinie würde beim ersten Schritt
 * erneut feuern (Endlosschleife zwischen zwei Fields).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Field-Wechsel (S11)', () => {
  it('Ankunftspunkt über das Gegen-Gateway ist begehbar', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const bundles = new Map<string, FieldBundle>();
    const diagnostics: FieldDiagnostic[] = [];
    let maplist: FieldMaplist | null = null;
    for (const entry of index.listEntries('flevel')) {
      const name = entry.name.toLowerCase();
      if (name === 'maplist') {
        maplist = parseMaplist(await index.readEntry(entry.canonicalId), 'maplist', diagnostics);
        continue;
      }
      if (entry.name.includes('.')) continue;
      try {
        const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        if (parsed.ok && parsed.bundle) bundles.set(name, parsed.bundle);
      } catch {
        /* Nicht-Fields überspringen */
      }
    }
    expect(maplist).not.toBeNull();

    const stats = {
      kanten: 0,
      zielUnbekannt: 0,
      ausRecord: 0,
      ausGegenGateway: 0,
      ohneAnkunft: 0,
      ankunftBegehbar: 0,
      ankunftFeuertSofort: 0,
      ankunftNahAnGateway: 0,
      gruende: {} as Record<string, number>,
    };

    for (const [fieldId, bundle] of bundles) {
      for (const [gatewayIndex, g] of (bundle.triggers?.gateways ?? []).entries()) {
        if (!g.used) continue;
        stats.kanten++;
        const change: FieldChange = {
          gatewayIndex,
          destMaplistIndex: g.destMaplistIndex,
          destPoint: g.destPoint,
        };
        const plan = planTransition(change, maplist!, null, fieldId);
        if (!plan) {
          stats.zielUnbekannt++;
          continue;
        }
        const target = bundles.get(plan.targetField);
        if (!target) {
          stats.zielUnbekannt++;
          continue;
        }
        const full = planTransition(change, maplist!, target, fieldId)!;
        if (full.source === 'record') stats.ausRecord++;
        else if (full.source === 'gegen-gateway') stats.ausGegenGateway++;
        if (!full.arrival) {
          stats.ohneAnkunft++;
          const reason = full.reason ?? 'unbekannt';
          stats.gruende[reason] = (stats.gruende[reason] ?? 0) + 1;
          continue;
        }
        // Ankunft muss begehbar sein …
        const session = new FieldSession(target, { runScript: false, start: full.arrival });
        if (!session.player) {
          stats.ohneAnkunft++;
          continue;
        }
        stats.ankunftBegehbar++;
        // … und darf nicht sofort wieder ein Gateway auslösen.
        let fired = false;
        for (const dir4 of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const probe = new FieldSession(target, { runScript: false, start: full.arrival });
          const r = probe.tick({ moveX: dir4[0], moveY: dir4[1], confirm: false, cancel: false });
          // Entscheidend ist das PENDELN: Ein Schritt, der sofort wieder ins
        // Herkunftsfield führt. Dass man neben der Ankunft ein anderes Gateway
        // betreten kann, ist dagegen normales Spielverhalten.
        if (r.fieldChange && resolveMaplistTarget(maplist!, r.fieldChange.destMaplistIndex) === fieldId) {
          fired = true;
        }
        if (r.fieldChange) stats.ankunftNahAnGateway++;
        }
        if (fired) stats.ankunftFeuertSofort++;
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
    console.log(
      'Field-Wechsel:',
      JSON.stringify(
        {
          fields: bundles.size,
          maplist: maplist?.names.length ?? 0,
          kanten: stats.kanten,
          zielUnbekannt: stats.zielUnbekannt,
          ausRecord: `${stats.ausRecord} (Normalweg: Zielpunkt @8/@10)`,
          ausGegenGateway: `${stats.ausGegenGateway} (Rückfall)`,
          ohneAnkunft: stats.ohneAnkunft,
          gruende: stats.gruende,
          ankunftBegehbar: `${stats.ankunftBegehbar} (${pct(stats.ankunftBegehbar, stats.kanten)} aller Kanten)`,
          ankunftFeuertSofort: `${stats.ankunftFeuertSofort} (${pct(stats.ankunftFeuertSofort, stats.ankunftBegehbar)}) — Pendeln ins Herkunftsfield`,
          ankunftNahAnGateway: `${stats.ankunftNahAnGateway} (${pct(stats.ankunftNahAnGateway, stats.ankunftBegehbar)}) — Schritt betritt IRGENDEIN Gateway`,
        },
        null,
        1,
      ),
    );

    expect(stats.kanten).toBeGreaterThan(1000);
    /**
     * **Gemessen nach F15 (2026-08-15): 978 von 1095 Kanten (89,3 %).** Die
     * übrigen 117 sind nicht etwa gescheitert, sondern zeigen auf Fields, die
     * die `maplist` nennt und das Archiv nicht führt (`zielUnbekannt`) —
     * bezogen auf die auflösbaren Kanten sind es **978 von 978**.
     *
     * Vorher waren es 510 (46,6 %), weil die Ankunft aus dem Gegen-Gateway
     * hergeleitet wurde. Der Sprung kommt allein daher, dass der Zielpunkt im
     * Record steht (@8/@10) und nicht mehr rekonstruiert werden muss.
     */
    expect(stats.ankunftBegehbar / stats.kanten).toBeGreaterThan(0.85);
    expect(stats.ausRecord).toBeGreaterThan(900);
    /**
     * **Pendeln: 3 von 978 (0,3 %).** Die alte Schranke war 0, und sie war
     * unter der alten Herleitung auch richtig: Die Ankunft wurde dort
     * ausdrücklich *neben* die Austrittsstelle gesetzt, konnte also gar nicht
     * zurückfeuern. Jetzt steht die Ankunft dort, wo das Spiel sie hinsetzt —
     * und in drei Fällen liegt sie so nah am Gegen-Gateway, dass ein Schritt
     * genau darauf zu wieder zurückführt.
     *
     * Das ist **kein Selbstlauf**: Die Probe drückt in alle vier Richtungen;
     * zurückzugehen, wo man hergekommen ist, ist erlaubtes Spielverhalten. Ein
     * Fehler wäre es erst, wenn es ohne Eingabe geschähe. Die Schranke steht
     * deshalb bei 5 und nicht bei 0 — sie soll ein Abrutschen melden, nicht
     * ein zulässiges Ergebnis verbieten.
     */
    expect(stats.ankunftFeuertSofort).toBeLessThanOrEqual(5);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
