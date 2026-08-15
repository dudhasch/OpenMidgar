import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { formationAddress, parseSceneBin, type BattleScene } from '@webmidgar/formats-battle';
import { NodeDirectorySource } from './node-source.js';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * K8, Schritt 1 — WELCHE FORMATION zeigt die Referenzaufnahme?
 *
 * Die drei Kampfaufnahmen in `apps/demo/.shots/ref/` (nur im
 * Screenshot-Worktree) zeigen denselben Kampf: zwei gleich aussehende Wachen
 * auf einer Bahnhofs-/Reaktorbühne, Abschlussbildschirm **EXP 32p / AP 4p**,
 * Cloud auf Level 6 mit 302 HP.
 *
 * ⚠️ **Ein erster Anlauf hat hier die Suchmenge falsch gewählt** und ist
 * daran gescheitert: Er verlangte „genau zwei belegte Slots, gleicher Typ,
 * EXP-Summe 32" und fand **0 von 1000** Formationen — obwohl 207 die ersten
 * beiden Bedingungen erfüllen. Die Bedingung „beide Gegner leben noch" ist
 * eine Annahme über die AUFNAHME, kein Merkmal der Daten. Die Suchmenge kommt
 * deshalb jetzt aus den Daten selbst: aus den Encounter-Tabellen der Fields
 * des Bahnhofsbereichs (Field-Sektion 7, 702/702 byteexakt belegt). Damit ist
 * gefragt, was man dort ÜBERHAUPT treffen kann, statt was ich vermute.
 *
 * Berichtet werden drei Trichter nebeneinander, damit sichtbar bleibt, welche
 * Bedingung die Menge zusammenzieht und welche nur mitläuft.
 */

const available = existsSync(realPfad('battle/scene.bin'));

/** Abgelesen aus dem Abschlussbildschirm `20260810223347_1.jpg`. */
const REF_EXP = 32;
const REF_AP = 4;

/** Der Bahnhofs-/Reaktorbogen der Demo — dieselbe Kette wie die Wellenabnahme. */
const FIELDS = ['md1stin', 'md1_1', 'md1_2', 'nrthmk', 'md8_4', 'nmkin_1'];

function ffText(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    if (b === 0xff) break;
    s += b >= 0x20 && b < 0x80 ? String.fromCharCode(b + 0x20) : '·';
  }
  return s;
}

interface FormationInfo {
  battleId: number;
  location: number;
  belegt: number;
  typen: number[];
  namen: string[];
  expSumme: number;
  apSumme: number;
  gilSumme: number;
  slots: string[];
}

function infoZu(szenen: (BattleScene | null)[], battleId: number): FormationInfo | null {
  const { sceneIndex, formationIndex } = formationAddress(battleId);
  const scene = szenen[sceneIndex];
  const f = scene?.formations[formationIndex];
  if (!scene || !f) return null;
  const belegt = f.slots.filter((s) => s.enemyTypeId !== 0xffff);
  if (belegt.length === 0) return null;
  let exp = 0;
  let ap = 0;
  let gil = 0;
  const namen: string[] = [];
  for (const s of belegt) {
    // `enemyTypeId` ist die GLOBALE Gegner-ID; `scene.enemies` ist über die
    // Position in `scene.enemyTypeIds` indiziert (3 Typen je Szene).
    const rec = scene.enemies[scene.enemyTypeIds.indexOf(s.enemyTypeId)];
    if (!rec) continue;
    exp += rec.exp;
    ap += rec.ap;
    gil += rec.gil;
    namen.push(ffText(rec.nameRaw));
  }
  return {
    battleId,
    location: f.location,
    belegt: belegt.length,
    typen: belegt.map((s) => s.enemyTypeId),
    namen,
    expSumme: exp,
    apSumme: ap,
    gilSumme: gil,
    slots: belegt.map((s) => `${s.x}/${s.y}/${s.z}`),
  };
}

describe.skipIf(!available)('K8/1: Referenzaufnahme → Formation', () => {
  it('sucht die Formation in den Encounter-Tabellen des Bahnhofsbogens', async () => {
    const container = await parseSceneBin(
      await readFile(realPfad('battle/scene.bin')),
      'scene.bin',
    );
    const szenen = container.scenes;

    const dir = new NodeDirectorySource(REAL_DIR, ['data/field', 'data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const eintraege = new Map<string, string>();
    for (const e of index.listEntries('flevel')) eintraege.set(e.name.toLowerCase(), e.canonicalId);

    const ausField = new Map<number, string[]>();
    for (const name of FIELDS) {
      const id = eintraege.get(name);
      if (!id) continue;
      let bundle: FieldBundle | null = null;
      try {
        const parsed = parseFieldEntry(await index.readEntry(id), name);
        bundle = parsed.ok ? (parsed.bundle ?? null) : null;
      } catch {
        bundle = null;
      }
      for (const t of bundle?.encounters?.tables ?? []) {
        for (const s of [...t.standard, ...t.special]) {
          if (s.formationId === 0) continue;
          const liste = ausField.get(s.formationId) ?? [];
          if (!liste.includes(name)) liste.push(name);
          ausField.set(s.formationId, liste);
        }
      }
    }

    const ausBogen = [...ausField.keys()]
      .map((id) => ({ info: infoZu(szenen, id), fields: ausField.get(id)! }))
      .filter((x): x is { info: FormationInfo; fields: string[] } => x.info !== null);

    // --- Trichter A: aus dem Bogen, EXP-Summe passend -----------------------
    const trefferBogen = ausBogen.filter((x) => x.info.expSumme === REF_EXP);
    // --- Trichter B: ganzer Bestand, EXP-Summe passend ---------------------
    const alle: FormationInfo[] = [];
    for (let id = 0; id < 1024; id++) {
      const i = infoZu(szenen, id);
      if (i) alle.push(i);
    }
    const trefferAlle = alle.filter((i) => i.expSumme === REF_EXP);
    const trefferAlleMitAp = trefferAlle.filter((i) => i.apSumme === REF_AP);

    // eslint-disable-next-line no-console
    console.log('K8/1 Trichter:', {
      formationenImBogen: ausBogen.length,
      davonExpSumme32: trefferBogen.length,
      formationenGesamt: alle.length,
      gesamtExpSumme32: trefferAlle.length,
      'gesamt + AP-Summe 4': trefferAlleMitAp.length,
    });
    // eslint-disable-next-line no-console
    console.log(
      'K8/1 Bogenformationen:',
      ausBogen
        .sort((a, b) => a.info.battleId - b.info.battleId)
        .map((x) => ({
          id: x.info.battleId,
          fields: x.fields.join(','),
          n: x.info.belegt,
          namen: x.info.namen.join('+'),
          exp: x.info.expSumme,
          ap: x.info.apSumme,
          gil: x.info.gilSumme,
          loc: x.info.location,
          slots: x.info.slots.join(' '),
        })),
    );

    expect(ausBogen.length).toBeGreaterThan(0);
  });
});
