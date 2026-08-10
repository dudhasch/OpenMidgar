/**
 * Compiler-Pipeline (B.3): Compile des Fixture-Projekts, Manifest-v2-
 * Vollständigkeit mit abgeleiteten Capabilities, sowie totale
 * Befundliste bei Defekt-Fixtures (alle Fehler gleichzeitig).
 */

import { describe, expect, it } from 'vitest';
import type { BattleDoc, CharacterDoc, DialogueDoc, EnemyDoc, FieldDoc, ScriptGraphDoc } from '@webmidgar/studio-core';
import { compileProject, MOD_VARIABLEN_BANK } from './index.js';
import { fixtureAssets, fixtureProject, MOD_ID } from './test-helpers.js';

describe('compileProject — Fixture (Mini-Quest)', () => {
  it('kompiliert fehlerfrei zu Manifest v2 + Paket', async () => {
    const project = await fixtureProject();
    const result = await compileProject(project, { assets: fixtureAssets() });
    expect(result.ok).toBe(true);
    expect(result.befunde).toEqual([]);
    expect(result.manifest).toBeDefined();
    expect(result.paket).toBeDefined();
    expect(result.audit.length).toBeGreaterThan(0);
  });

  it('erzeugt die vollständige Manifest-Wurzel (Masterplan 5.2 + Teil D)', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    const m = result.manifest!;
    expect(m.manifestVersion).toBe('2.0.0');
    expect(m.id).toBe(MOD_ID);
    expect(m.version).toBe('0.1.0');
    expect(m.name).toBe('Midgar Quest');
    expect(m.engineCompat).toBe('^0.11.0');
    expect(m.dependencies).toEqual([]);
    expect(m.conflicts).toEqual([]);
    expect(m.integrity.algo).toBe('sha256');
    expect(Object.keys(m.integrity.hashes).length).toBeGreaterThan(0);
  });

  it('leitet Capabilities deterministisch aus dem Inhalt ab (A-ST-2)', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    expect(result.manifest!.capabilities).toEqual([
      'texture-override',
      'script-patch',
      'dialogue-replace',
      'field-add',
      'entity-add',
      'script-add',
      'dialogue-add',
      'variable-claim',
    ]);
  });

  it('setzt reservierte Capabilities (model/background) nicht ohne Inhalte', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    const caps = result.manifest!.capabilities;
    expect(caps).not.toContain('model-add');
    expect(caps).not.toContain('model-override');
    expect(caps).not.toContain('background-override');
  });

  it('entities[]: entity-add aus CharacterDoc mit auftritte', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.entities).toHaveLength(1);
    const e = m.entities![0]!;
    expect(e.id).toBe(`mod:${MOD_ID}/char/lina`);
    expect(e.field).toBe(`mod:${MOD_ID}/field/slumchurch_ext`);
    expect(e.modellRef).toBe('lgp:char/test_npc');
    expect(e.platzierung).toEqual({ dreieck: 0, position: { x: 0, y: 0, z: 0 }, richtung: 90 });
    expect(e.kollision).toEqual({ radius: 16, hoehe: 32 });
    expect(e.scripts).toEqual({ interaktion: `mod:${MOD_ID}/script/lina.interaktion` });
  });

  it('scripts[]: Mnemonics topologisch sortiert, Sprünge auf Knoten-IDs, quelle = Graph-Digest', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.scripts).toHaveLength(1);
    const s = m.scripts![0]!;
    expect(s.id).toBe(`mod:${MOD_ID}/script/lina.interaktion`);
    expect(s.quelle).toMatch(/^[0-9a-f]{64}$/);
    expect(s.payload).toEqual([
      'n_start: SET_VAR name=quest_started wert=1',
      'n_frage: ASK dialog=lina_frage',
      'n_frage -> n_ja wenn antwort==1',
      'n_frage -> n_nein wenn antwort==2',
      'n_ja: MESSAGE dialog=lina_ja',
      'n_ja -> n_ende',
      'n_nein: MESSAGE dialog=lina_nein',
      'n_ende: RET',
    ]);
  });

  it('dialogues[]: replace (delta) und add (ohne delta) als getrennte Records', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.dialogues).toHaveLength(2);
    const replace = m.dialogues!.find((d) => d.mode === 'replace')!;
    const add = m.dialogues!.find((d) => d.mode === 'add')!;
    expect(replace.field).toBe('field:md8_1');
    expect(replace.locale).toBe('de');
    expect(replace.eintraege.map((e) => e.id)).toEqual(['lina_intro_ersetzt']);
    expect(replace.eintraege[0]!.delta!.guardHash).toBe('0123abcd');
    expect(add.eintraege.map((e) => e.id)).toEqual(['lina_neu']);
  });

  it('fields[]: NAM-naher Record für das neue Field', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.fields).toHaveLength(1);
    const f = m.fields![0]!;
    expect(f.id).toBe(`mod:${MOD_ID}/field/slumchurch_ext`);
    expect(f.walkmesh.dreiecke).toHaveLength(2);
    expect(f.kameras).toHaveLength(1);
    expect(f.trigger[0]!.scriptRef).toBe('lina.interaktion');
    expect(f.gateways[0]!.zielField).toBe('field:md8_1');
  });

  it('patches[]: aus FieldDeltaDocs, mit Payload → script-patch', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.patches).toHaveLength(1);
    expect(m.patches![0]).toEqual({
      field: 'field:md8_1',
      anchor: { entity: 'cloud', slot: 'main', ipOffset: 4 },
      operation: 'insert-after',
      payload: 'SET_VAR name=quest_started wert=1',
      guardHash: 'ff00ee11',
    });
  });

  it('assets[]: texture-override mit Paketquelle aus assets/', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.assets).toEqual([
      { target: 'lgp:char/test_npc', source: 'content/assets/lina_tex.png', format: 'png' },
    ]);
  });

  it('variables: variable-claim mit bereich + benannteSlots', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.variables!.bereich).toEqual({ bank: MOD_VARIABLEN_BANK, von: 0, bis: 1 });
    expect(m.variables!.benannteSlots.map((v) => v.name)).toEqual(['lina_antwort', 'quest_started']);
  });
});

describe('compileProject — v3-Kandidaten enemy-add/battle-add (MS15/MS16)', () => {
  it('leitet enemy-add/battle-add ins markierte Erweiterungsfeld ab — v2-Schema unberührt', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    expect(result.ok).toBe(true);
    const m = result.manifest!;
    // v2-Capability-Liste bleibt frei von v3-Kandidaten.
    expect(m.capabilities).not.toContain('enemy-add');
    expect(m.capabilities).not.toContain('battle-add');
    expect(m.manifestVersion).toBe('2.0.0');
    const v3 = m.v3Kandidaten!;
    expect(v3.capabilities).toEqual(['enemy-add', 'battle-add']);
  });

  it('enemies[]: vollständiges Datenbündel mit id im Mod-Namensraum', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.v3Kandidaten!.enemies).toHaveLength(1);
    const e = m.v3Kandidaten!.enemies![0]!;
    expect(e.id).toBe(`mod:${MOD_ID}/enemy/rostwolf`);
    expect(e.name).toBe('Rostwolf');
    expect(e.stats.hp).toBe(120);
    expect(e.affinitaeten.elemente).toEqual({ feuer: 'schwach' });
    expect(e.angriffe.map((a) => a.id)).toEqual(['biss', 'heulen']);
    expect(e.verhalten.art).toBe('prioritaeten');
    expect(e.beute.drops[0]).toEqual({ itemRef: 'kernel:item/potion', rate: 0.5 });
    expect(e.formationTags).toEqual(['wildnis']);
    // schemaVersion wird nicht in den Record transportiert (Dokument-Metadatum).
    expect('schemaVersion' in e).toBe(false);
  });

  it('battles[]: Formation/Regeln/Belohnung mit normalisierten Referenzen', async () => {
    const m = (await compileProject(await fixtureProject(), { assets: fixtureAssets() })).manifest!;
    expect(m.v3Kandidaten!.battles).toHaveLength(1);
    const b = m.v3Kandidaten!.battles![0]!;
    expect(b.id).toBe(`mod:${MOD_ID}/battle/slum_hinterhof`);
    expect(b.formation.reihen[0]!.enemyRef).toBe(`mod:${MOD_ID}/enemy/rostwolf`);
    expect(b.formation.maxGleichzeitig).toBe(4);
    expect(b.regeln).toEqual({ flucht: 'erlaubt', hinterhalt: 'moeglich', siegbedingung: 'alle-besiegt' });
    expect(b.musikRef).toBe('music:fight');
    expect(b.belohnung.garantierteDrops).toEqual([{ itemRef: 'kernel:item/potion' }]);
    expect(b.verknuepfung).toEqual({ feldRef: 'field:md8_1', encounterZone: 'zone_sued' });
  });

  it('ohne Enemy-/Battle-Dokumente bleibt das Erweiterungsfeld weg', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        docs.delete('enemies/rostwolf.json');
        docs.delete('battles/slum_hinterhof.json');
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(true);
    expect(result.manifest!.v3Kandidaten).toBeUndefined();
  });

  it('Defekte erscheinen alle in der totalen Befundliste: toter enemyRef, unbekannte Effekt-Art, leere Formation', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        // 1. Toter enemyRef (Referenzgraph).
        const battle = docs.get('battles/slum_hinterhof.json') as BattleDoc;
        battle.formation.reihen[0]!.enemyRef = 'geist';
        // 2. Unbekannte Effekt-Art (Taxonomie-Abweisung, ADR-020).
        const enemy = docs.get('enemies/rostwolf.json') as EnemyDoc;
        enemy.angriffe[0]!.effekt = { art: 'wunder' as never, ziel: 'selbst', staerke: { fest: 1 } };
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeUndefined();
    const fehler = result.befunde.filter((b) => b.klasse === 'fehler');
    expect(
      fehler.some((b) => b.dokument === 'battles/slum_hinterhof.json' && b.meldung.includes('Tote Referenz') && b.meldung.includes('/enemy/geist')),
    ).toBe(true);
    expect(fehler.some((b) => b.dokument === 'enemies/rostwolf.json' && b.pfad === 'angriffe[0].effekt.art')).toBe(true);

    // 3. Leere Formation (fachlicher Fehler aus studio-core).
    const leer = await compileProject(
      await fixtureProject((docs) => {
        (docs.get('battles/slum_hinterhof.json') as BattleDoc).formation.reihen = [];
      }),
      { assets: fixtureAssets() },
    );
    expect(leer.ok).toBe(false);
    expect(
      leer.befunde.some((b) => b.klasse === 'fehler' && b.dokument === 'battles/slum_hinterhof.json' && b.meldung.includes('leere Formation')),
    ).toBe(true);
  });

  it('Battle ohne verknuepfung = Warnung „Szene ist nirgends erreichbar" (paketiert trotzdem)', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        delete (docs.get('battles/slum_hinterhof.json') as BattleDoc).verknuepfung;
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(true);
    expect(result.paket).toBeDefined();
    expect(
      result.befunde.some(
        (b) => b.klasse === 'warnung' && b.dokument === 'battles/slum_hinterhof.json' && b.meldung.includes('nirgends erreichbar'),
      ),
    ).toBe(true);
    expect(result.manifest!.v3Kandidaten!.battles![0]!.verknuepfung).toBeUndefined();
  });

  it('alle enemyRefs mit gesperrten Modellarten = Info; gemischte Formation ohne Info', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        (docs.get('enemies/rostwolf.json') as EnemyDoc).modell = { art: 'baukasten' };
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(true);
    const infos = result.befunde.filter((b) => b.klasse === 'info');
    // studio-core meldet die Sperre am Gegner, der Compiler an der Szene.
    expect(infos.some((b) => b.dokument === 'enemies/rostwolf.json' && b.meldung.includes("Modellart 'baukasten'"))).toBe(true);
    expect(
      infos.some(
        (b) => b.dokument === 'battles/slum_hinterhof.json' && b.meldung.includes('gesperrte Modellarten') && b.meldung.includes('MS9'),
      ),
    ).toBe(true);
  });
});

describe('compileProject — totale Befundliste bei Defekten', () => {
  /** Präpariert ein Projekt mit fünf unabhängigen Defekten gleichzeitig. */
  function defekte(docs: Map<string, unknown>): void {
    // 1. Tote Referenz: Character verweist auf fehlendes Script.
    const char = docs.get('characters/lina.json') as CharacterDoc;
    char.auftritte[0]!.scripts = { interaktion: 'geist.interaktion' };
    // 2. Kaputtes Walkmesh: Adjazenz asymmetrisch.
    const field = docs.get('fields/slumchurch_ext.json') as FieldDoc;
    field.walkmesh.dreiecke[1]!.adjazent = [null, null, null];
    // 3. Unerreichbarer Knoten + 4. Wartezyklus im Script-Graphen.
    const graph = docs.get('scripts/lina.interaktion.json') as ScriptGraphDoc;
    graph.knoten.push(
      { id: 'n_tot', kategorie: 'kontrollfluss', op: 'RET', blockierend: false, position: { x: 300, y: 0 } },
      { id: 'n_w1', kategorie: 'kontrollfluss', op: 'WAIT', blockierend: true, position: { x: 300, y: 100 } },
      { id: 'n_w2', kategorie: 'kontrollfluss', op: 'WAIT', blockierend: true, position: { x: 300, y: 200 } },
    );
    graph.kanten.push({ von: 'n_w1', zu: 'n_w2' }, { von: 'n_w2', zu: 'n_w1' });
    // 5. Dialogmetrik-Überlauf (> 3 Zeilen à ~48 Zeichen).
    const dlg = docs.get('dialogues/md8_1.de.json') as DialogueDoc;
    dlg.eintraege[1]!.seiten = [{ text: 'x'.repeat(49 * 3) }];
  }

  it('liefert alle Fehler und Warnungen gleichzeitig (nie First-Error-Abbruch)', async () => {
    const result = await compileProject(await fixtureProject(defekte), { assets: fixtureAssets() });
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeUndefined();
    expect(result.paket).toBeUndefined();

    const fehler = result.befunde.filter((b) => b.klasse === 'fehler');
    const warnungen = result.befunde.filter((b) => b.klasse === 'warnung');

    // Tote Referenz + kaputtes Walkmesh: zwei Fehler gleichzeitig.
    expect(fehler.length).toBeGreaterThanOrEqual(2);
    expect(fehler.some((b) => b.dokument === 'characters/lina.json' && b.meldung.includes('Tote Referenz'))).toBe(true);
    expect(
      fehler.some((b) => b.dokument === 'fields/slumchurch_ext.json' && b.meldung.includes('Adjazenz nicht symmetrisch')),
    ).toBe(true);

    // Unerreichbarkeit, toter Einstieg, Wartezyklus, Dialogmetrik.
    expect(warnungen.some((b) => b.meldung.includes("Knoten 'n_tot'") && b.meldung.includes('unerreichbar'))).toBe(true);
    expect(warnungen.some((b) => b.meldung.includes("Knoten 'n_tot'") && b.meldung.includes('keine eingehende Kante'))).toBe(
      true,
    );
    expect(warnungen.some((b) => b.meldung.includes('Wartezyklus') && b.meldung.includes("'n_w1'"))).toBe(true);
    expect(warnungen.some((b) => b.dokument === 'dialogues/md8_1.de.json' && b.meldung.includes('Fenstermetrik'))).toBe(true);
  });

  it('meldet fehlende Assets als Fehler (Provenienz: nur user-asset)', async () => {
    const result = await compileProject(await fixtureProject(), { assets: new Map() });
    expect(result.ok).toBe(false);
    expect(
      result.befunde.some(
        (b) => b.klasse === 'fehler' && b.meldung.includes("Referenziertes Asset 'assets/lina_tex.png' fehlt"),
      ),
    ).toBe(true);
  });

  it('meldet Asset-Referenzen außerhalb von assets/ als Fehler', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        (docs.get('characters/lina.json') as CharacterDoc).modell = {
          art: 'textur-override',
          ref: 'lgp:char/test_npc',
          texturAsset: 'woanders/tex.png',
        };
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(false);
    expect(result.befunde.some((b) => b.klasse === 'fehler' && b.meldung.includes('user-asset'))).toBe(true);
  });

  it('warnt bei Wartezyklus, paketiert aber trotzdem (Warnung ≠ Fehler)', async () => {
    const result = await compileProject(
      await fixtureProject((docs) => {
        const graph = docs.get('scripts/lina.interaktion.json') as ScriptGraphDoc;
        graph.knoten.push(
          { id: 'n_w1', kategorie: 'kontrollfluss', op: 'WAIT', blockierend: true, position: { x: 0, y: 400 } },
          { id: 'n_w2', kategorie: 'kontrollfluss', op: 'WAIT', blockierend: true, position: { x: 0, y: 500 } },
        );
        graph.kanten.push({ von: 'n_ende', zu: 'n_w1' }, { von: 'n_w1', zu: 'n_w2' }, { von: 'n_w2', zu: 'n_w1' });
      }),
      { assets: fixtureAssets() },
    );
    expect(result.ok).toBe(true);
    expect(result.paket).toBeDefined();
    expect(result.befunde.some((b) => b.klasse === 'warnung' && b.meldung.includes('Wartezyklus'))).toBe(true);
    expect(result.befunde.every((b) => b.klasse !== 'fehler')).toBe(true);
  });
});
