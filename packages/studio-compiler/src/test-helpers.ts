/**
 * Test-Fixtures: Mini-Quest-Projekt (1 Charakter mit Textur-Override,
 * 1 Script-Graph mit Verzweigung, 1 Dialog replace+add, 1 neues Field
 * mit Walkmesh, 1 Field-Delta, benannte Variablen, 1 EnemyDoc + 1
 * BattleDoc MS15/MS16) über dem MemoryProjectStore aus studio-core.
 */

import {
  canonicalJson,
  MemoryProjectStore,
  StudioProject,
  utf8Bytes,
  type BattleDoc,
  type CharacterDoc,
  type DialogueDoc,
  type EnemyDoc,
  type FieldDeltaDoc,
  type FieldDoc,
  type ProjectDoc,
  type ScriptGraphDoc,
  type VariablesDoc,
} from '@webmidgar/studio-core';

export const MOD_ID = 'de.example.midgarquest';

export function projectDoc(): ProjectDoc {
  return {
    schemaVersion: 1,
    modId: MOD_ID,
    name: 'Midgar Quest',
    version: '0.1.0',
    engineCompat: '^0.11.0',
    primaersprache: 'de',
    sprachen: ['de'],
    manifestZielversion: 2,
  };
}

export function scriptGraphDoc(): ScriptGraphDoc {
  return {
    schemaVersion: 1,
    entitaet: 'lina',
    slot: 'interaktion',
    knoten: [
      { id: 'n_start', kategorie: 'variablen', op: 'SET_VAR', operanden: { name: 'quest_started', wert: 1 }, blockierend: false, position: { x: 0, y: 0 } },
      { id: 'n_frage', kategorie: 'dialog', op: 'ASK', operanden: { dialog: 'lina_frage' }, blockierend: true, position: { x: 0, y: 100 } },
      { id: 'n_ja', kategorie: 'dialog', op: 'MESSAGE', operanden: { dialog: 'lina_ja' }, blockierend: true, position: { x: -100, y: 200 } },
      { id: 'n_nein', kategorie: 'dialog', op: 'MESSAGE', operanden: { dialog: 'lina_nein' }, blockierend: true, position: { x: 100, y: 200 } },
      { id: 'n_ende', kategorie: 'kontrollfluss', op: 'RET', blockierend: false, position: { x: 0, y: 300 } },
    ],
    kanten: [
      { von: 'n_start', zu: 'n_frage' },
      { von: 'n_frage', zu: 'n_ja', bedingung: 'antwort==1' },
      { von: 'n_frage', zu: 'n_nein', bedingung: 'antwort==2' },
      { von: 'n_ja', zu: 'n_ende' },
      { von: 'n_nein', zu: 'n_ende' },
    ],
    variablenRefs: ['quest_started', 'lina_antwort'],
  };
}

export function characterDoc(): CharacterDoc {
  return {
    schemaVersion: 1,
    id: 'lina',
    name: 'Lina',
    modell: { art: 'textur-override', ref: 'lgp:char/test_npc', texturAsset: 'assets/lina_tex.png' },
    kollision: { radius: 16, hoehe: 32 },
    auftritte: [
      {
        field: 'slumchurch_ext',
        dreieck: 0,
        position: { x: 0, y: 0, z: 0 },
        richtung: 90,
        scripts: { interaktion: 'lina.interaktion' },
      },
    ],
  };
}

export function dialogueDoc(): DialogueDoc {
  return {
    schemaVersion: 1,
    field: 'field:md8_1',
    locale: 'de',
    eintraege: [
      {
        id: 'lina_intro_ersetzt',
        sprecher: 'Lina',
        seiten: [{ text: 'Willkommen in der Slumkirche.' }],
        delta: { guardHash: '0123abcd', ersetztOriginalIndex: 12 },
      },
      {
        id: 'lina_neu',
        sprecher: 'Lina',
        seiten: [{ text: 'Neuer Dialog der Mod.' }],
      },
    ],
  };
}

export function fieldDoc(): FieldDoc {
  return {
    schemaVersion: 1,
    id: 'slumchurch_ext',
    walkmesh: {
      dreiecke: [
        { a: [0, 0, 0], b: [100, 0, 0], c: [0, 0, 100], adjazent: [1, null, null] },
        { a: [100, 0, 0], b: [100, 0, 100], c: [0, 0, 100], adjazent: [null, null, 0] },
      ],
    },
    kameras: [{ position: { x: 0, y: 50, z: 200 }, ziel: { x: 0, y: 0, z: 0 }, fovBasis: 1.5 }],
    trigger: [
      {
        id: 't_intro',
        eckpunkte: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
          { x: 0, y: 0, z: 10 },
        ],
        scriptRef: 'lina.interaktion',
      },
    ],
    gateways: [{ zielField: 'field:md8_1', zielDreieck: 3, zielPosition: { x: 1, y: 0, z: 2 } }],
  };
}

export function fieldDeltaDoc(): FieldDeltaDoc {
  return {
    schemaVersion: 1,
    zielField: 'field:md8_1',
    operationen: [
      {
        op: 'insert-after',
        anker: { entity: 'cloud', slot: 'main', ipOffset: 4 },
        guardHash: 'ff00ee11',
        payload: 'SET_VAR name=quest_started wert=1',
      },
    ],
  };
}

export function variablesDoc(): VariablesDoc {
  return {
    schemaVersion: 1,
    benannt: [
      { name: 'lina_antwort', bank: 15, adresse: 1, kommentar: 'Antwort der Auswahl' },
      { name: 'quest_started', bank: 15, adresse: 0 },
    ],
  };
}

/** MS15-Fixture: Demo-Gegner „Rostwolf" (befundfrei: Stats im Band, kernel:-Items extern). */
export function enemyDoc(): EnemyDoc {
  return {
    schemaVersion: 1,
    id: 'rostwolf',
    name: 'Rostwolf',
    modell: { art: 'referenz', ref: 'lgp:enemy/aaaa' },
    stats: {
      hp: 120,
      mp: 10,
      staerke: 20,
      abwehr: 10,
      magie: 5,
      magAbwehr: 8,
      geschick: 12,
      glueck: 7,
      level: 5,
      exp: 60,
      ap: 4,
      gil: 80,
    },
    affinitaeten: { elemente: { feuer: 'schwach' }, statusImmunitaeten: ['gift'] },
    angriffe: [
      { id: 'biss', name: 'Biss', effekt: { art: 'schaden', ziel: 'gegner_einzeln', staerke: { fest: 30 } } },
      { id: 'heulen', name: 'Heulen', effekt: { art: 'buff', ziel: 'selbst', staerke: { prozent: 20 } } },
    ],
    verhalten: {
      art: 'prioritaeten',
      regeln: [
        { wenn: { art: 'hp_unter', prozent: 25 }, dann: 'heulen', gewicht: 1 },
        { wenn: { art: 'immer' }, dann: 'biss', gewicht: 1 },
      ],
    },
    beute: { drops: [{ itemRef: 'kernel:item/potion', rate: 0.5 }], stehlen: [], morph: 'kernel:item/ether' },
    formationTags: ['wildnis'],
  };
}

/** MS16-Fixture: Demo-Szene „Slum-Hinterhof ×3" (befundfrei: verknüpft, music:-Präfix, Flucht erlaubt). */
export function battleDoc(): BattleDoc {
  return {
    schemaVersion: 1,
    id: 'slum_hinterhof',
    name: 'Slum-Hinterhof ×3',
    arena: { art: 'referenz', ref: 'field:md8_1/battle-arena' },
    formation: {
      reihen: [{ enemyRef: 'rostwolf', anzahl: 3, position: { x: 1, z: 2 } }],
      maxGleichzeitig: 4,
    },
    regeln: { flucht: 'erlaubt', hinterhalt: 'moeglich', siegbedingung: 'alle-besiegt' },
    musikRef: 'music:fight',
    belohnung: { expMod: 1.2, garantierteDrops: [{ itemRef: 'kernel:item/potion' }] },
    verknuepfung: { feldRef: 'field:md8_1', encounterZone: 'zone_sued' },
  };
}

export const LINA_TEX_BYTES = utf8Bytes('FAKE-PNG lina textur variant');

export function fixtureAssets(): Map<string, Uint8Array> {
  return new Map([['assets/lina_tex.png', LINA_TEX_BYTES]]);
}

export async function fixtureStore(
  overrides?: (docs: Map<string, unknown>) => void,
): Promise<MemoryProjectStore> {
  const docs = new Map<string, unknown>([
    ['project.json', projectDoc()],
    ['scripts/lina.interaktion.json', scriptGraphDoc()],
    ['characters/lina.json', characterDoc()],
    ['dialogues/md8_1.de.json', dialogueDoc()],
    ['fields/slumchurch_ext.json', fieldDoc()],
    ['fields/md8_1.delta.json', fieldDeltaDoc()],
    ['variables.json', variablesDoc()],
    ['enemies/rostwolf.json', enemyDoc()],
    ['battles/slum_hinterhof.json', battleDoc()],
  ]);
  overrides?.(docs);
  const store = new MemoryProjectStore();
  for (const [pfad, doc] of docs) {
    await store.save(pfad, utf8Bytes(canonicalJson(doc)));
  }
  return store;
}

export async function fixtureProject(
  overrides?: (docs: Map<string, unknown>) => void,
): Promise<StudioProject> {
  return StudioProject.open(await fixtureStore(overrides));
}
