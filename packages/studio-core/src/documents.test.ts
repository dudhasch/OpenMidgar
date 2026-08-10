import { describe, expect, it } from 'vitest';
import {
  documentKindForPath,
  FIELD_DELTA_OPS,
  migrateDocument,
  SCHEMA_VERSIONS,
  SCRIPT_KATEGORIEN,
  SLOT_ARTEN,
  STRUCTURAL_VALIDATORS,
  validateBattleDoc,
  validateCharacterDoc,
  validateDialogueDoc,
  validateEnemyDoc,
  validateFieldDeltaDoc,
  validateFieldDoc,
  validateProjectDoc,
  validateScriptGraphDoc,
  validateVariablesDoc,
  VERHALTENS_BEDINGUNGEN,
  type BattleDoc,
  type CharacterDoc,
  type DialogueDelta,
  type DialogueDoc,
  type EnemyDoc,
  type FieldDeltaDoc,
  type FieldDoc,
  type ProjectDoc,
  type ScriptGraphDoc,
  type VariablesDoc,
} from './documents.js';

/* --- Gültige Beispieldokumente --- */

export const projectDoc: ProjectDoc = {
  schemaVersion: 1,
  modId: 'de.example.midgarquest',
  name: 'Midgar Quest',
  version: '0.1.0',
  engineCompat: '^0.11.0',
  primaersprache: 'de',
  sprachen: ['de', 'en'],
  manifestZielversion: 2,
};

export const dialogueDoc: DialogueDoc = {
  schemaVersion: 1,
  field: 'field:md1stin',
  locale: 'de',
  eintraege: [
    {
      id: 'lina_intro',
      sprecher: 'Lina',
      seiten: [
        { text: 'Hallo!', steuerelemente: [{ art: 'farbe', wert: 'rot' }] },
        { text: 'Zweite Seite.' },
      ],
    },
    {
      id: 'orig_ersetzt',
      seiten: [{ text: 'Neuer Text des Mods.' }],
      delta: { guardHash: 'fnv1a64:abcd', ersetztOriginalIndex: 3 },
    },
  ],
};

export const scriptDoc: ScriptGraphDoc = {
  schemaVersion: 1,
  entitaet: 'lina',
  slot: 'init',
  knoten: [
    { id: 'n1', kategorie: 'kontrollfluss', op: 'JMPF', operanden: { ziel: 'n2' }, blockierend: false, position: { x: 0, y: 0 } },
    { id: 'n2', kategorie: 'dialog', op: 'MESSAGE', blockierend: true, position: { x: 10, y: 0 } },
  ],
  kanten: [{ von: 'n1', zu: 'n2' }],
  variablenRefs: ['fortschritt'],
};

export const characterDoc: CharacterDoc = {
  schemaVersion: 1,
  id: 'lina',
  name: 'Lina',
  modell: { art: 'referenz', ref: 'lgp:char/aaaa' },
  kollision: { radius: 24, hoehe: 60 },
  auftritte: [
    {
      field: 'slumchurch_ext',
      dreieck: 0,
      position: { x: 0, y: 0, z: 0 },
      richtung: 90,
      scripts: { init: 'lina.init', interaktion: 'lina.interaktion' },
    },
  ],
};

export const fieldDoc: FieldDoc = {
  schemaVersion: 1,
  id: 'slumchurch_ext',
  hintergrundAsset: 'assets/slumchurch.png',
  walkmesh: {
    dreiecke: [
      { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], adjazent: [1, null, null] },
      { a: [1, 0, 0], b: [1, 1, 0], c: [0, 1, 0], adjazent: [null, null, 0] },
    ],
  },
  kameras: [{ position: { x: 0, y: 0, z: 10 }, ziel: { x: 0, y: 0, z: 0 }, fovBasis: 1 }],
  trigger: [{ id: 't1', eckpunkte: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], scriptRef: 'lina.init' }],
  gateways: [{ zielField: 'field:md1stin', zielDreieck: 0, zielPosition: { x: 0, y: 0, z: 0 } }],
};

export const fieldDeltaDoc: FieldDeltaDoc = {
  schemaVersion: 1,
  zielField: 'field:md1stin',
  operationen: [
    {
      op: 'replace-span',
      anker: { entity: 'cloud', slot: 'init', ipOffset: 12 },
      guardHash: 'fnv1a64:1234',
      payload: 'MESSAGE 0x01',
    },
  ],
};

export const variablesDoc: VariablesDoc = {
  schemaVersion: 1,
  benannt: [{ name: 'fortschritt', bank: 1, adresse: 10, kommentar: 'Quest-Fortschritt' }],
};

/** MS15-Referenzdokument (Demo-Gegner „Rostwolf"). */
export const enemyDoc: EnemyDoc = {
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
  affinitaeten: { elemente: { feuer: 'schwach', eis: 'resistent' }, statusImmunitaeten: ['gift'] },
  angriffe: [
    { id: 'biss', name: 'Biss', effekt: { art: 'schaden', ziel: 'gegner_einzeln', staerke: { fest: 30 } } },
    {
      id: 'heulen',
      name: 'Heulen',
      effekt: { art: 'buff', ziel: 'selbst', staerke: { prozent: 20 } },
      kosten: 4,
      zielregel: 'immer-selbst',
    },
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

/** MS16-Referenzdokument (Demo-Szene „Slum-Hinterhof ×3"). */
export const battleDoc: BattleDoc = {
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

describe('documentKindForPath', () => {
  it('ordnet Projektpfade den Dokumenttypen zu', () => {
    expect(documentKindForPath('project.json')).toBe('project');
    expect(documentKindForPath('variables.json')).toBe('variables');
    expect(documentKindForPath('dialogues/md1stin.de.json')).toBe('dialogue');
    expect(documentKindForPath('scripts/lina.init.json')).toBe('scriptGraph');
    expect(documentKindForPath('characters/lina.json')).toBe('character');
    expect(documentKindForPath('enemies/rostwolf.json')).toBe('enemy');
    expect(documentKindForPath('battles/slum_hinterhof.json')).toBe('battle');
    expect(documentKindForPath('fields/slumchurch_ext.json')).toBe('field');
    expect(documentKindForPath('fields/md1stin.delta.json')).toBe('fieldDelta');
    expect(documentKindForPath('build/out.json')).toBeNull();
    expect(documentKindForPath('assets/bild.png')).toBeNull();
  });
});

describe('SCHEMA_VERSIONS + Migrationen', () => {
  it('kennt je Dokumenttyp eine Version; v1 ist überall aktuell (no-op)', () => {
    expect(Object.keys(SCHEMA_VERSIONS).sort()).toEqual(
      ['battle', 'character', 'dialogue', 'enemy', 'field', 'fieldDelta', 'project', 'scriptGraph', 'variables'].sort(),
    );
    for (const [kind, version] of Object.entries(SCHEMA_VERSIONS)) {
      expect(version).toBe(1);
      const res = migrateDocument(kind as keyof typeof SCHEMA_VERSIONS, { schemaVersion: 1 });
      expect(res.migriert).toBe(false);
      expect(res.von).toBe(1);
      expect(res.nach).toBe(1);
    }
  });

  it('wirft bei Dokumenten aus der Zukunft statt still zu raten', () => {
    expect(() => migrateDocument('project', { schemaVersion: 99 })).toThrow(/neuer als unterstützt/);
  });
});

describe('strukturelle Validierer — gültige Dokumente', () => {
  it('akzeptiert die Referenzdokumente aller Typen', () => {
    expect(validateProjectDoc(projectDoc)).toEqual([]);
    expect(validateDialogueDoc(dialogueDoc)).toEqual([]);
    expect(validateScriptGraphDoc(scriptDoc)).toEqual([]);
    expect(validateCharacterDoc(characterDoc)).toEqual([]);
    expect(validateFieldDoc(fieldDoc)).toEqual([]);
    expect(validateFieldDeltaDoc(fieldDeltaDoc)).toEqual([]);
    expect(validateVariablesDoc(variablesDoc)).toEqual([]);
    expect(validateEnemyDoc(enemyDoc)).toEqual([]);
    expect(validateBattleDoc(battleDoc)).toEqual([]);
  });

  it('akzeptiert reservierte Modellarten (baukasten/gltf) strukturell', () => {
    expect(validateEnemyDoc({ ...enemyDoc, modell: { art: 'baukasten' } })).toEqual([]);
    expect(validateEnemyDoc({ ...enemyDoc, modell: { art: 'gltf' } })).toEqual([]);
  });

  it('STRUCTURAL_VALIDATORS deckt alle Dokumenttypen ab', () => {
    expect(Object.keys(STRUCTURAL_VALIDATORS).sort()).toEqual(Object.keys(SCHEMA_VERSIONS).sort());
  });
});

describe('strukturelle Validierer — negative Fälle', () => {
  it('project: modId-Format, Semver, manifestZielversion', () => {
    const errors = validateProjectDoc({ ...projectDoc, modId: 'BAD ID!', version: '1.0', engineCompat: 'neu', manifestZielversion: 1 });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('modId');
    expect(pfade).toContain('version');
    expect(pfade).toContain('engineCompat');
    expect(pfade).toContain('manifestZielversion');
  });

  it('dialogue: Seiten ohne Text, unbekannte Steuerelement-Art, Delta ohne guardHash', () => {
    const errors = validateDialogueDoc({
      schemaVersion: 1,
      field: 'field:x',
      locale: 'de',
      eintraege: [
        { id: 'a', seiten: [{ steuerelemente: [{ art: 'blink', wert: 1 }] }] },
        { id: 'b', seiten: [], delta: { guardHash: '' } },
      ],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('eintraege[0].seiten[0].text');
    expect(pfade).toContain('eintraege[0].seiten[0].steuerelemente[0].art');
    expect(pfade).toContain('eintraege[0].seiten[0].steuerelemente[0].wert');
    expect(pfade).toContain('eintraege[1].delta.guardHash');
  });

  it('scriptGraph: ungültige Kategorie/Slot, blockierend, Position', () => {
    const errors = validateScriptGraphDoc({
      schemaVersion: 1,
      entitaet: 'x',
      slot: 'sonntag',
      knoten: [{ id: 'n', kategorie: 'magie', op: '', blockierend: 'ja', position: { x: 0 } }],
      kanten: [{ von: 'n' }],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('slot');
    expect(pfade).toContain('knoten[0].kategorie');
    expect(pfade).toContain('knoten[0].op');
    expect(pfade).toContain('knoten[0].blockierend');
    expect(pfade).toContain('knoten[0].position');
    expect(pfade).toContain('kanten[0].zu');
  });

  it('character: Modell-Art, Kollision, Auftritt-Scripts', () => {
    const errors = validateCharacterDoc({
      schemaVersion: 1,
      id: 'x',
      name: 'X',
      modell: { art: 'kopie', ref: 'lgp:char/a' },
      kollision: { radius: 'groß' },
      auftritte: [{ field: 'f', dreieck: -1, position: { x: 0, y: 0, z: 0 }, richtung: 0, scripts: { nacht: 'x.init' } }],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('modell.art');
    expect(pfade).toContain('kollision.radius');
    expect(pfade).toContain('kollision.hoehe');
    expect(pfade).toContain('auftritte[0].dreieck');
    expect(pfade).toContain('auftritte[0].scripts.nacht');
  });

  it('field: Walkmesh-Tripel, Trigger, Gateways', () => {
    const errors = validateFieldDoc({
      schemaVersion: 1,
      id: 'x',
      walkmesh: { dreiecke: [{ a: [0, 0], b: [1, 0, 0], c: [0, 1, 0], adjazent: [0, 0] }] },
      kameras: [{ position: { x: 0, y: 0, z: 0 }, ziel: { x: 0, y: 0, z: 0 }, fovBasis: 'weit' }],
      trigger: [{ id: 't', eckpunkte: 'viele', scriptRef: 1 }],
      gateways: [{ zielField: 'field:y', zielDreieck: -2, zielPosition: { x: 0, y: 0 } }],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('walkmesh.dreiecke[0].a');
    expect(pfade).toContain('walkmesh.dreiecke[0].adjazent');
    expect(pfade).toContain('kameras[0].fovBasis');
    expect(pfade).toContain('trigger[0].eckpunkte');
    expect(pfade).toContain('trigger[0].scriptRef');
    expect(pfade).toContain('gateways[0].zielDreieck');
    expect(pfade).toContain('gateways[0].zielPosition');
  });

  it('fieldDelta: op-Enumeration, Anker, payload', () => {
    expect(FIELD_DELTA_OPS).toEqual(['replace-span', 'insert-before', 'insert-after', 'disable-span']);
    const errors = validateFieldDeltaDoc({
      schemaVersion: 1,
      zielField: 7,
      operationen: [{ op: 'loeschen', anker: { entity: 'e', slot: 'falsch', ipOffset: -1 }, guardHash: '', payload: 3 }],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('zielField');
    expect(pfade).toContain('operationen[0].op');
    expect(pfade).toContain('operationen[0].anker.slot');
    expect(pfade).toContain('operationen[0].anker.ipOffset');
    expect(pfade).toContain('operationen[0].guardHash');
    expect(pfade).toContain('operationen[0].payload');
  });

  it('variables: Bank-/Adressbereiche', () => {
    const errors = validateVariablesDoc({
      schemaVersion: 1,
      benannt: [{ name: '', bank: 16, adresse: 300 }],
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('benannt[0].name');
    expect(pfade).toContain('benannt[0].bank');
    expect(pfade).toContain('benannt[0].adresse');
  });

  it('enemy: Modell-Art, Affinitäten und Statuslisten sind geschlossen', () => {
    const errors = validateEnemyDoc({
      ...enemyDoc,
      modell: { art: 'nachbau' },
      affinitaeten: { elemente: { magma: 'schwach', feuer: 'schmeckt' }, statusImmunitaeten: ['muede'] },
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('modell.art');
    expect(pfade).toContain('affinitaeten.elemente.magma');
    expect(pfade).toContain('affinitaeten.elemente.feuer');
    expect(pfade).toContain('affinitaeten.statusImmunitaeten[0]');
  });

  it('enemy: Stats-Objekt verlangt alle zwölf Werte als Zahlen', () => {
    const errors = validateEnemyDoc({ ...enemyDoc, stats: { hp: 'viel' } });
    const pfade = errors.map((e) => e.pfad);
    for (const key of Object.keys(enemyDoc.stats)) {
      expect(pfade).toContain(`stats.${key}`);
    }
  });

  it('enemy: Verhalten — geschlossene Bedingungs-Menge, typisierte Parameter, prioritaeten', () => {
    expect(VERHALTENS_BEDINGUNGEN).toEqual([
      'hp_unter',
      'runde_jede',
      'ziel_hat_status',
      'gruppenmitglieder_unter',
      'mp_unter',
      'immer',
    ]);
    const errors = validateEnemyDoc({
      ...enemyDoc,
      verhalten: {
        art: 'zufall',
        regeln: [
          { wenn: { art: 'laune' }, dann: 'biss', gewicht: 1 },
          { wenn: { art: 'hp_unter', prozent: 120 }, dann: 'biss', gewicht: 1 },
          { wenn: { art: 'runde_jede', n: 0 }, dann: 'biss', gewicht: 1 },
          { wenn: { art: 'ziel_hat_status', status: 'muede' }, dann: 'biss', gewicht: 1 },
          { wenn: { art: 'immer' }, dann: 'biss', gewicht: 0 },
        ],
      },
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('verhalten.art');
    expect(pfade).toContain('verhalten.regeln[0].wenn.art');
    expect(pfade).toContain('verhalten.regeln[1].wenn.prozent');
    expect(pfade).toContain('verhalten.regeln[2].wenn.n');
    expect(pfade).toContain('verhalten.regeln[3].wenn.status');
    expect(pfade).toContain('verhalten.regeln[4].gewicht');
  });

  it('enemy: Angriff verlangt id/name/Effekt; Beute-Einträge verlangen itemRef/rate', () => {
    const errors = validateEnemyDoc({
      ...enemyDoc,
      angriffe: [{ name: 'Biss', effekt: { art: 'schaden', ziel: 'selbst', staerke: { fest: 1 } } }],
      beute: { drops: [{ rate: 'hoch' }], stehlen: [{}], morph: 7 },
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('angriffe[0].id');
    expect(pfade).toContain('beute.drops[0].itemRef');
    expect(pfade).toContain('beute.drops[0].rate');
    expect(pfade).toContain('beute.stehlen[0].itemRef');
    expect(pfade).toContain('beute.morph');
  });

  it('battle: Arena-, Regel- und Verknüpfungs-Enumerationen sind geschlossen', () => {
    const errors = validateBattleDoc({
      ...battleDoc,
      arena: { art: 'screenshot' },
      regeln: { flucht: 'vielleicht', hinterhalt: 'ueberrumpelt', siegbedingung: 'boss-besiegt' },
      musikRef: 42,
      verknuepfung: { ort: 'irgendwo' },
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('arena.art');
    expect(pfade).toContain('regeln.flucht');
    expect(pfade).toContain('regeln.hinterhalt');
    expect(pfade).toContain('regeln.siegbedingung');
    expect(pfade).toContain('musikRef');
    expect(pfade).toContain('verknuepfung');
  });

  it('battle: Formation verlangt enemyRef, ganzzahlige anzahl, position {x,z}, maxGleichzeitig ≥ 1', () => {
    const errors = validateBattleDoc({
      ...battleDoc,
      formation: {
        reihen: [{ enemyRef: '', anzahl: 1.5, position: { x: 0 }, flags: 'keine' }],
        maxGleichzeitig: 0,
      },
      verknuepfung: { feldRef: 'field:md8_1' },
    });
    const pfade = errors.map((e) => e.pfad);
    expect(pfade).toContain('formation.reihen[0].enemyRef');
    expect(pfade).toContain('formation.reihen[0].anzahl');
    expect(pfade).toContain('formation.reihen[0].position');
    expect(pfade).toContain('formation.reihen[0].flags');
    expect(pfade).toContain('formation.maxGleichzeitig');
    expect(pfade).toContain('verknuepfung.encounterZone');
  });

  it('battle: verknuepfung als scriptStart-Variante ist strukturell gültig', () => {
    expect(validateBattleDoc({ ...battleDoc, verknuepfung: { scriptStart: 'lina.interaktion' } })).toEqual([]);
    expect(validateBattleDoc({ ...battleDoc, arena: { art: 'nutzerbild', asset: 'assets/arena.png' } })).toEqual([]);
  });
});

describe('Taxonomie-Konstanten', () => {
  it('kennt exakt die neun Kategorien und fünf Slot-Arten', () => {
    expect(SCRIPT_KATEGORIEN).toHaveLength(9);
    expect(SLOT_ARTEN).toEqual(['init', 'main', 'interaktion', 'beruehrung', 'timer']);
  });
});

describe('Delta-Provenienz (B.7): kein Originaltext transportierbar', () => {
  it('das Typsystem bietet kein Feld für Originaltext', () => {
    // Kompilier-Zeit-Audit: DialogueDelta hat exakt diese Schlüssel.
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    const deltaKeys: Equal<keyof DialogueDelta, 'guardHash' | 'ersetztOriginalIndex'> = true;
    expect(deltaKeys).toBe(true);
  });

  it('ein serialisiertes Delta enthält nur guardHash + optionalen Index', () => {
    const eintrag = dialogueDoc.eintraege[1]!;
    const serialisiert = JSON.parse(JSON.stringify(eintrag.delta)) as Record<string, unknown>;
    for (const key of Object.keys(serialisiert)) {
      expect(['guardHash', 'ersetztOriginalIndex']).toContain(key);
      expect(key.toLowerCase()).not.toMatch(/originaltext|originaltexte|originalseiten/);
    }
    // Es gibt keinen Weg, Originaltext durch das Schema zu schmuggeln.
    expect(validateDialogueDoc(dialogueDoc)).toEqual([]);
  });
});
