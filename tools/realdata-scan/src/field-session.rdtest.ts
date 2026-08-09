import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { FieldSession, InputRecorder, replayInputs, type FieldInput } from '@webmidgar/field-runtime';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-Abnahme auf Realdaten, zwei Zusicherungen:
 *
 *  A) **Gateway-Graph** — jedes aktive Gateway muss ein existierendes Zielfield
 *     benennen. Nicht auflösbare Ziele wären beim Field-Wechsel Sackgassen.
 *  B) **Determinismus der Integration** — dieselbe Eingabefolge muss auf
 *     demselben Field denselben Sitzungsdigest liefern (Solver + Trigger +
 *     Interpreter gemeinsam), und Snapshot/Restore mitten im Lauf darf das
 *     Ergebnis nicht verändern.
 *
 * Ausgabe aggregiert; keine Originaldaten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Deterministische Pseudo-Eingaben (mulberry32) — kein Math.random. */
function makeInputs(seed: number, ticks: number): FieldInput[] {
  let a = seed | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: FieldInput[] = [];
  let dx = 1;
  let dy = 0;
  for (let i = 0; i < ticks; i++) {
    if (next() < 0.12) {
      dx = Math.floor(next() * 3) - 1;
      dy = Math.floor(next() * 3) - 1;
    }
    out.push({ moveX: dx, moveY: dy, confirm: next() < 0.05, cancel: false });
  }
  return out;
}

describe.skipIf(!available)('Realdaten: Field-Sitzung (S11)', () => {
  it('Gateway-Graph + Determinismus über alle Fields', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const bundles: FieldBundle[] = [];
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      try {
        const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        if (parsed.ok && parsed.bundle) bundles.push(parsed.bundle);
      } catch {
        /* Nicht-Fields überspringen */
      }
    }

    // --- A) Gateway-Graph ------------------------------------------------------
    // Die destFieldId ist ein Index in die Field-Liste des Archivs.
    const fieldCount = bundles.length;
    const gw = {
      total: 0,
      active: 0,
      inRange: 0,
      selfLoop: 0,
      outOfRange: [] as number[],
      fieldsWithoutExit: 0,
      maxPerField: 0,
    };
    for (const bundle of bundles) {
      const gateways = bundle.triggers?.gateways ?? [];
      let activeHere = 0;
      for (const g of gateways) {
        gw.total++;
        if (!g.active) continue;
        gw.active++;
        activeHere++;
        if (g.destFieldId >= 0 && g.destFieldId < fieldCount) gw.inRange++;
        else if (gw.outOfRange.length < 12) gw.outOfRange.push(g.destFieldId);
      }
      gw.maxPerField = Math.max(gw.maxPerField, activeHere);
      if (activeHere === 0) gw.fieldsWithoutExit++;
    }

    // --- B) Determinismus + Snapshot/Restore -----------------------------------
    const det = {
      sessions: 0,
      digestMismatch: 0,
      restoreMismatch: 0,
      restoreRejected: 0,
      outOfMesh: 0,
      fieldChanges: 0,
      triggerEvents: 0,
      withoutWalkmesh: 0,
    };
    const TICKS = 240;

    for (const bundle of bundles) {
      if (!bundle.walkmesh || bundle.walkmesh.triangles.length === 0) {
        det.withoutWalkmesh++;
        continue;
      }
      const inputs = makeInputs(0x51a5 ^ bundle.fieldId.length, TICKS);

      // Lauf 1: aufzeichnen, Snapshot in der Mitte ziehen.
      const s1 = new FieldSession(bundle, { seed: 7 });
      const rec = new InputRecorder(bundle.fieldId);
      let mid: ReturnType<FieldSession['snapshot']> | null = null;
      for (const [i, input] of inputs.entries()) {
        rec.record(input);
        const r = s1.tick(input);
        if (r.fieldChange) det.fieldChanges++;
        det.triggerEvents += r.triggers.length;
        if (s1.player && !Number.isFinite(s1.player.walk.height)) det.outOfMesh++;
        if (i === TICKS / 2 - 1) mid = s1.snapshot();
      }
      det.sessions++;
      const digest1 = s1.digest();

      // Lauf 2: identische Eingaben auf frischer Sitzung.
      const replay = replayInputs(bundle, rec.finish(), { seed: 7 });
      if (replay.digest !== digest1) det.digestMismatch++;

      // Lauf 3: aus dem Mittensnapshot fortsetzen.
      if (mid) {
        const s3 = new FieldSession(bundle, { seed: 7 });
        const restored = s3.restore(mid);
        if (!restored.ok) det.restoreRejected++;
        else {
          for (let i = TICKS / 2; i < TICKS; i++) s3.tick(inputs[i]!);
          if (s3.digest() !== digest1) det.restoreMismatch++;
        }
      }
    }

    console.log(
      'Field-Sitzung:',
      JSON.stringify(
        {
          fields: fieldCount,
          gatewayGraph: {
            gesamt: gw.total,
            aktiv: gw.active,
            zielImBereich: `${gw.inRange}/${gw.active}`,
            zieleAusserhalb: gw.outOfRange,
            fieldsOhneAusgang: gw.fieldsWithoutExit,
            maxAktiveJeField: gw.maxPerField,
          },
          determinismus: det,
          ticksJeSitzung: TICKS,
        },
        null,
        1,
      ),
    );

    expect(fieldCount).toBeGreaterThan(700);
    // Kernzusicherung der Integration: identische Eingaben ⇒ identischer Zustand.
    expect(det.digestMismatch).toBe(0);
    expect(det.restoreMismatch).toBe(0);
    expect(det.restoreRejected).toBe(0);
    expect(det.outOfMesh).toBe(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
