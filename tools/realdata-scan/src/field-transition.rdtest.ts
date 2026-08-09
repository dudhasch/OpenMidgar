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
      ohneGegenGateway: 0,
      ohneAnkunft: 0,
      ankunftBegehbar: 0,
      ankunftFeuertSofort: 0,
      gruende: {} as Record<string, number>,
    };

    for (const [fieldId, bundle] of bundles) {
      for (const [gatewayIndex, g] of (bundle.triggers?.gateways ?? []).entries()) {
        if (!g.used) continue;
        stats.kanten++;
        const change: FieldChange = {
          gatewayIndex,
          destMaplistIndex: g.destMaplistIndex,
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
        if (full.returnGatewayIndex === null) stats.ohneGegenGateway++;
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
          if (r.fieldChange && r.fieldChange.gatewayIndex === full.returnGatewayIndex) fired = true;
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
          ohneGegenGateway: stats.ohneGegenGateway,
          ohneAnkunft: stats.ohneAnkunft,
          gruende: stats.gruende,
          ankunftBegehbar: `${stats.ankunftBegehbar} (${pct(stats.ankunftBegehbar, stats.kanten)} aller Kanten)`,
          ankunftFeuertSofort: `${stats.ankunftFeuertSofort} (${pct(stats.ankunftFeuertSofort, stats.ankunftBegehbar)})`,
        },
        null,
        1,
      ),
    );

    expect(stats.kanten).toBeGreaterThan(1000);
    // Gemessen: 510/1095 Kanten (46,6 %) bekommen eine exakte Ankunft über das
    // Gegen-Gateway. Der Rest fällt auf den Meshschwerpunkt zurück — das ist
    // brauchbar, aber der Wert soll nicht unbemerkt abrutschen.
    expect(stats.ankunftBegehbar / stats.kanten).toBeGreaterThan(0.4);
    // Entscheidend: keine Ankunft darf sofort wieder hinausführen, sonst
    // pendelt die Figur zwischen zwei Fields.
    expect(stats.ankunftFeuertSofort).toBe(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
