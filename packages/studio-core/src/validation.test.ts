import { describe, expect, it } from 'vitest';
import type {
  BattleDoc,
  CharacterDoc,
  DialogueDoc,
  EnemyDoc,
  FieldDeltaDoc,
  FieldDoc,
  ProjectDoc,
  ScriptGraphDoc,
  VariablesDoc,
} from './documents.js';
import { StudioProject } from './project.js';
import { IncrementalValidator, type Befund } from './validation.js';
import { cmdSetText } from './commands.test.js';

/* --- Fixtures --- */

const projectDoc: ProjectDoc = {
  schemaVersion: 1,
  modId: 'de.example.midgarquest',
  name: 'Midgar Quest',
  version: '0.1.0',
  engineCompat: '^0.11.0',
  primaersprache: 'de',
  sprachen: ['de', 'en'],
  manifestZielversion: 2,
};

function dialogue(...eintraege: DialogueDoc['eintraege']): DialogueDoc {
  return { schemaVersion: 1, field: 'field:md1stin', locale: 'de', eintraege };
}

function scriptGraph(overrides?: Partial<ScriptGraphDoc>): ScriptGraphDoc {
  return {
    schemaVersion: 1,
    entitaet: 'lina',
    slot: 'init',
    knoten: [
      { id: 'n1', kategorie: 'kontrollfluss', op: 'JMPF', blockierend: false, position: { x: 0, y: 0 } },
      { id: 'n2', kategorie: 'dialog', op: 'MESSAGE', blockierend: true, position: { x: 10, y: 0 } },
    ],
    kanten: [{ von: 'n1', zu: 'n2' }],
    ...overrides,
  };
}

function character(overrides?: Partial<CharacterDoc>): CharacterDoc {
  return {
    schemaVersion: 1,
    id: 'lina',
    name: 'Lina',
    modell: { art: 'referenz', ref: 'lgp:char/aaaa' },
    kollision: { radius: 24, hoehe: 60 },
    auftritte: [],
    ...overrides,
  };
}

function field(overrides?: Partial<FieldDoc>): FieldDoc {
  return {
    schemaVersion: 1,
    id: 'slumchurch_ext',
    walkmesh: {
      dreiecke: [
        { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], adjazent: [1, null, null] },
        { a: [1, 0, 0], b: [1, 1, 0], c: [0, 1, 0], adjazent: [null, null, 0] },
      ],
    },
    kameras: [{ position: { x: 0, y: 0, z: 10 }, ziel: { x: 0, y: 0, z: 0 }, fovBasis: 1 }],
    trigger: [],
    gateways: [],
    ...overrides,
  };
}

const fieldDelta: FieldDeltaDoc = {
  schemaVersion: 1,
  zielField: 'field:md1stin',
  operationen: [{ op: 'replace-span', anker: { entity: 'cloud', slot: 'init', ipOffset: 4 }, guardHash: 'fnv:1' }],
};

const variables: VariablesDoc = {
  schemaVersion: 1,
  benannt: [{ name: 'fortschritt', bank: 1, adresse: 10 }],
};

function enemy(overrides?: Partial<EnemyDoc>): EnemyDoc {
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
    ...overrides,
  };
}

function battle(overrides?: Partial<BattleDoc>): BattleDoc {
  return {
    schemaVersion: 1,
    id: 'slum_hinterhof',
    name: 'Slum-Hinterhof ×3',
    arena: { art: 'referenz', ref: 'field:md8_1/battle-arena' },
    formation: {
      reihen: [{ enemyRef: 'rostwolf', anzahl: 3, position: { x: 1, z: 2 } }],
      maxGleichzeitig: 4,
    },
    regeln: { flucht: 'erlaubt', siegbedingung: 'alle-besiegt' },
    belohnung: { garantierteDrops: [{ itemRef: 'kernel:item/potion' }] },
    verknuepfung: { feldRef: 'field:md8_1', encounterZone: 'zone_sued' },
    ...overrides,
  };
}

function makeProject(docs: Record<string, unknown>): StudioProject {
  const project = new StudioProject();
  for (const [pfad, doc] of Object.entries(docs)) project.addDocument(pfad, doc);
  return project;
}

const byKlasse = (befunde: Befund[], klasse: Befund['klasse']) => befunde.filter((b) => b.klasse === klasse);
const hatMeldung = (befunde: Befund[], teil: string) => befunde.some((b) => b.meldung.includes(teil));

/* --- Tests --- */

describe('Validierung: project', () => {
  it('gültiges Projekt ohne Befunde; modId-Format als Fehler; Primärsprache als Warnung', () => {
    const ok = new IncrementalValidator(makeProject({ 'project.json': projectDoc }));
    expect(ok.validateAll()).toEqual([]);

    const schlecht = new IncrementalValidator(
      makeProject({ 'project.json': { ...projectDoc, modId: 'Keine ID' } }),
    );
    expect(hatMeldung(byKlasse(schlecht.validateAll(), 'fehler'), 'reverse-DNS-Format')).toBe(true);

    const warnung = new IncrementalValidator(
      makeProject({ 'project.json': { ...projectDoc, sprachen: ['en'] } }),
    );
    expect(hatMeldung(byKlasse(warnung.validateAll(), 'warnung'), 'primaersprache')).toBe(true);
  });
});

describe('Validierung: dialogue', () => {
  it('Eintrag ohne Seiten = Fehler; leerer Seitentext = Warnung; doppelte ID = Fehler', () => {
    const doc = dialogue(
      { id: 'a', seiten: [] },
      { id: 'b', seiten: [{ text: '   ' }] },
      { id: 'b', seiten: [{ text: 'ok' }] },
    );
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'dialogues/x.de.json': doc }));
    const be = v.validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), 'keine Seiten')).toBe(true);
    expect(hatMeldung(byKlasse(be, 'warnung'), 'leeren Text')).toBe(true);
    expect(hatMeldung(byKlasse(be, 'fehler'), "Doppelte Eintrags-ID 'b'")).toBe(true);
  });

  it('sauberer Dialog (inkl. Delta ohne Originaltext) ohne Befunde', () => {
    const doc = dialogue({ id: 'a', seiten: [{ text: 'Neuer Text.' }], delta: { guardHash: 'fnv:x', ersetztOriginalIndex: 2 } });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'dialogues/x.de.json': doc }));
    expect(v.validateAll()).toEqual([]);
  });
});

describe('Validierung: scriptGraph', () => {
  it('Kante zu unbekanntem Knoten = Fehler; gesperrte Kategorie = Warnung; doppelte Knoten-ID', () => {
    const doc = scriptGraph({
      knoten: [
        { id: 'n1', kategorie: 'entity-bewegung', op: 'MOVE', blockierend: true, position: { x: 0, y: 0 } },
        { id: 'n1', kategorie: 'kontrollfluss', op: 'RET', blockierend: false, position: { x: 1, y: 0 } },
      ],
      kanten: [{ von: 'n1', zu: 'gibtsNicht' }],
    });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'scripts/lina.init.json': doc }));
    const be = v.validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "unbekannten Knoten 'gibtsNicht'")).toBe(true);
    expect(hatMeldung(byKlasse(be, 'warnung'), "Kategorie 'entity-bewegung' ist im Editor gesperrt")).toBe(true);
    expect(hatMeldung(byKlasse(be, 'fehler'), "Doppelte Knoten-ID 'n1'")).toBe(true);
  });

  it('gültiger Graph ohne Befunde', () => {
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'scripts/lina.init.json': scriptGraph() }));
    expect(v.validateAll()).toEqual([]);
  });
});

describe('Validierung: character', () => {
  it('Kollision > 0 und kanonische Modell-Referenz', () => {
    const doc = character({ kollision: { radius: 0, hoehe: -1 }, modell: { art: 'referenz', ref: 'mod:fremd/char/x' } });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'characters/lina.json': doc }));
    const be = byKlasse(v.validateAll(), 'fehler');
    expect(hatMeldung(be, 'Kollisionsradius')).toBe(true);
    expect(hatMeldung(be, 'Kollisionshöhe')).toBe(true);
    expect(hatMeldung(be, 'lgp:char/')).toBe(true);
  });

  it('gültiger Charakter ohne Befunde', () => {
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'characters/lina.json': character() }));
    expect(v.validateAll()).toEqual([]);
  });
});

describe('Validierung: field (Walkmesh-Invarianten)', () => {
  it('symmetrisches Walkmesh ohne Befunde', () => {
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/f.json': field() }));
    expect(v.validateAll()).toEqual([]);
  });

  it('degeneriertes Dreieck (Fläche 0) = Fehler', () => {
    const doc = field({
      walkmesh: {
        dreiecke: [{ a: [0, 0, 0], b: [1, 1, 1], c: [2, 2, 2], adjazent: [null, null, null] }],
      },
    });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/f.json': doc }));
    expect(hatMeldung(byKlasse(v.validateAll(), 'fehler'), 'degeneriert')).toBe(true);
  });

  it('asymmetrische Adjazenz = Fehler mit fixHint', () => {
    const doc = field({
      walkmesh: {
        dreiecke: [
          { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], adjazent: [1, null, null] },
          { a: [1, 0, 0], b: [1, 1, 0], c: [0, 1, 0], adjazent: [null, null, null] }, // listet 0 nicht
        ],
      },
    });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/f.json': doc }));
    const be = byKlasse(v.validateAll(), 'fehler');
    expect(hatMeldung(be, 'Adjazenz nicht symmetrisch')).toBe(true);
    expect(be.find((b) => b.meldung.includes('Adjazenz'))!.fixHint).toBeDefined();
  });

  it('Adjazenz außerhalb des Dreiecksindex = Fehler; Trigger mit < 3 Eckpunkten; fovBasis 0', () => {
    const doc = field({
      walkmesh: {
        dreiecke: [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], adjazent: [9, null, null] }],
      },
      kameras: [{ position: { x: 0, y: 0, z: 1 }, ziel: { x: 0, y: 0, z: 0 }, fovBasis: 0 }],
      trigger: [{ id: 't', eckpunkte: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], scriptRef: 'lina.init' }],
    });
    const v = new IncrementalValidator(
      makeProject({ 'project.json': projectDoc, 'fields/f.json': doc, 'scripts/lina.init.json': scriptGraph() }),
    );
    const be = byKlasse(v.validateAll(), 'fehler');
    expect(hatMeldung(be, 'nicht existentes Dreieck 9')).toBe(true);
    expect(hatMeldung(be, 'mindestens 3 Eckpunkte')).toBe(true);
    expect(hatMeldung(be, 'fovBasis')).toBe(true);
  });
});

describe('Validierung: fieldDelta', () => {
  it('Delta auf kanonische ID ok; Delta auf Mod-ID = Fehler', () => {
    const ok = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/md1stin.delta.json': fieldDelta }));
    expect(ok.validateAll()).toEqual([]);

    const schlecht = new IncrementalValidator(
      makeProject({ 'project.json': projectDoc, 'fields/x.delta.json': { ...fieldDelta, zielField: 'mod:de.example.midgarquest/field/y' } }),
    );
    expect(hatMeldung(byKlasse(schlecht.validateAll(), 'fehler'), 'kanonische Original-ID')).toBe(true);
  });
});

describe('Validierung: variables', () => {
  it('doppelte Namen = Fehler; gültig ohne Befunde', () => {
    const dup = new IncrementalValidator(
      makeProject({ 'project.json': projectDoc, 'variables.json': { schemaVersion: 1, benannt: [{ name: 'x' }, { name: 'x' }] } }),
    );
    expect(hatMeldung(byKlasse(dup.validateAll(), 'fehler'), "Doppelter Variablenname 'x'")).toBe(true);

    const ok = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'variables.json': variables }));
    expect(ok.validateAll()).toEqual([]);
  });
});

describe('Validierung: enemy (MS15)', () => {
  const projektMit = (doc: unknown) => makeProject({ 'project.json': projectDoc, 'enemies/rostwolf.json': doc });

  it('gültiger Gegner ohne Befunde', () => {
    expect(new IncrementalValidator(projektMit(enemy())).validateAll()).toEqual([]);
  });

  it('reservierte Modellarten baukasten/gltf = Info „gesperrt bis MS9/MS6"', () => {
    const baukasten = new IncrementalValidator(projektMit(enemy({ modell: { art: 'baukasten' } }))).validateAll();
    expect(hatMeldung(byKlasse(baukasten, 'info'), "Modellart 'baukasten' ist reserviert und bis MS9 gesperrt")).toBe(true);
    expect(byKlasse(baukasten, 'fehler')).toEqual([]);

    const gltf = new IncrementalValidator(projektMit(enemy({ modell: { art: 'gltf' } }))).validateAll();
    expect(hatMeldung(byKlasse(gltf, 'info'), "Modellart 'gltf' ist reserviert und bis MS6 gesperrt")).toBe(true);
  });

  it('Stats außerhalb der Bänder = Warnung, innerhalb ohne Befund', () => {
    const doc = enemy();
    doc.stats.hp = 200000;
    doc.stats.level = 0;
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'warnung'), "Stat 'hp' (200000) liegt außerhalb des sinnvollen Bands")).toBe(true);
    expect(hatMeldung(byKlasse(be, 'warnung'), "Stat 'level' (0)")).toBe(true);
    expect(byKlasse(be, 'fehler')).toEqual([]);
  });

  it('leere angriffe-Liste = Warnung; doppelte Angriffs-ID = Fehler', () => {
    const leer = new IncrementalValidator(projektMit(enemy({ angriffe: [], verhalten: { art: 'prioritaeten', regeln: [] } })));
    expect(hatMeldung(byKlasse(leer.validateAll(), 'warnung'), 'leere angriffe-Liste')).toBe(true);

    const dup = enemy({ angriffe: [enemy().angriffe[0]!, enemy().angriffe[0]!] });
    const be = new IncrementalValidator(projektMit(dup)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "Doppelte Angriffs-ID 'biss'")).toBe(true);
  });

  it('unbekannte Bedingung = Fehler (geschlossene Menge, ADR-024)', () => {
    const doc = enemy({
      verhalten: { art: 'prioritaeten', regeln: [{ wenn: { art: 'laune' as never }, dann: 'biss', gewicht: 1 }] },
    });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), 'Unbekannte Bedingung')).toBe(true);
  });

  it('angriffRef ohne passenden Angriff = Fehler', () => {
    const doc = enemy({
      verhalten: { art: 'prioritaeten', regeln: [{ wenn: { art: 'immer' }, dann: 'feuerball', gewicht: 1 }] },
    });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "referenziert Angriff 'feuerball', der nicht in angriffe[] deklariert ist")).toBe(true);
  });

  it('Regeln nach einer immer-Regel sind unerreichbar = Warnung; davor erreichbar', () => {
    const doc = enemy({
      verhalten: {
        art: 'prioritaeten',
        regeln: [
          { wenn: { art: 'mp_unter', prozent: 10 }, dann: 'heulen', gewicht: 1 },
          { wenn: { art: 'immer' }, dann: 'biss', gewicht: 1 },
          { wenn: { art: 'runde_jede', n: 3 }, dann: 'biss', gewicht: 1 },
        ],
      },
    });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    const warnungen = byKlasse(be, 'warnung');
    expect(hatMeldung(warnungen, 'Regel 2 ist unerreichbar')).toBe(true);
    expect(hatMeldung(warnungen, 'Regel 0 ist unerreichbar')).toBe(false);
    expect(hatMeldung(warnungen, 'Regel 1 ist unerreichbar')).toBe(false);
  });

  it('Drop-Rate außerhalb 0..1 = Fehler (drops und stehlen), 0..1 ohne Befund', () => {
    const doc = enemy({
      beute: { drops: [{ itemRef: 'kernel:item/potion', rate: 1.2 }], stehlen: [{ itemRef: 'kernel:item/ether', rate: -0.1 }] },
    });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), 'Drop-Rate 1.2 liegt außerhalb 0..1')).toBe(true);
    expect(hatMeldung(byKlasse(be, 'fehler'), 'Drop-Rate -0.1 liegt außerhalb 0..1')).toBe(true);

    const ok = enemy({ beute: { drops: [{ itemRef: 'kernel:item/potion', rate: 0 }], stehlen: [{ itemRef: 'kernel:item/ether', rate: 1 }] } });
    expect(new IncrementalValidator(projektMit(ok)).validateAll()).toEqual([]);
  });
});

describe('Validierung: battle (MS16)', () => {
  const projektMit = (doc: unknown, mitGegner = true) =>
    makeProject({
      'project.json': projectDoc,
      'battles/slum_hinterhof.json': doc,
      ...(mitGegner ? { 'enemies/rostwolf.json': enemy() } : {}),
    });

  it('gültige Szene ohne Befunde (enemyRef über Referenzgraph aufgelöst)', () => {
    expect(new IncrementalValidator(projektMit(battle())).validateAll()).toEqual([]);
  });

  it('leere Formation = Fehler', () => {
    const doc = battle({ formation: { reihen: [], maxGleichzeitig: 4 } });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), 'leere Formation')).toBe(true);
  });

  it('anzahl < 1 oder > maxGleichzeitig = Fehler', () => {
    const doc = battle({
      formation: {
        reihen: [
          { enemyRef: 'rostwolf', anzahl: 0, position: { x: 0, z: 0 } },
          { enemyRef: 'rostwolf', anzahl: 5, position: { x: 1, z: 1 } },
        ],
        maxGleichzeitig: 4,
      },
    });
    const be = byKlasse(new IncrementalValidator(projektMit(doc)).validateAll(), 'fehler');
    expect(hatMeldung(be, 'anzahl der Reihe 0 muss ≥ 1 sein')).toBe(true);
    expect(hatMeldung(be, 'anzahl (5) der Reihe 1 überschreitet maxGleichzeitig (4)')).toBe(true);
  });

  it('toter enemyRef = Fehler über den Referenzgraph', () => {
    const doc = battle({ formation: { reihen: [{ enemyRef: 'geist', anzahl: 1, position: { x: 0, z: 0 } }], maxGleichzeitig: 4 } });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/enemy/geist'")).toBe(true);
  });

  it('toter itemRef in garantierteDrops/beute = Fehler; kernel:item ist extern', () => {
    const doc = battle({ belohnung: { garantierteDrops: [{ itemRef: 'phoenix_feder' }] } });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/item/phoenix_feder'")).toBe(true);

    const beuteDoc = enemy({ beute: { drops: [{ itemRef: 'mod:de.example.midgarquest/item/elixier', rate: 1 }], stehlen: [] } });
    const beuteProject = makeProject({ 'project.json': projectDoc, 'enemies/rostwolf.json': beuteDoc });
    const be2 = new IncrementalValidator(beuteProject).validateAll();
    expect(hatMeldung(byKlasse(be2, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/item/elixier'")).toBe(true);
  });

  it('flucht verboten ohne garantierteDrops = Info-Hinweis; mit Drops ohne Befund', () => {
    const ohne = battle({ regeln: { flucht: 'verboten', siegbedingung: 'alle-besiegt' }, belohnung: {} });
    const be = new IncrementalValidator(projektMit(ohne)).validateAll();
    expect(hatMeldung(byKlasse(be, 'info'), 'Flucht ist verboten, aber belohnung.garantierteDrops ist leer')).toBe(true);

    const mit = battle({ regeln: { flucht: 'verboten', siegbedingung: 'alle-besiegt' } });
    const ok = new IncrementalValidator(projektMit(mit)).validateAll();
    expect(hatMeldung(byKlasse(ok, 'info'), 'Flucht ist verboten')).toBe(false);
  });

  it('musikRef ohne music:-Präfix = Info (Musik-Feature ist Zukunft)', () => {
    const doc = battle({ musikRef: 'kampf_theme' });
    const be = new IncrementalValidator(projektMit(doc)).validateAll();
    expect(hatMeldung(byKlasse(be, 'info'), "musikRef 'kampf_theme' hat kein 'music:'-Präfix")).toBe(true);

    const ok = battle({ musikRef: 'music:fight' });
    const beOk = new IncrementalValidator(projektMit(ok)).validateAll();
    expect(hatMeldung(byKlasse(beOk, 'info'), 'music:')).toBe(false);
  });
});

describe('Validierung: Referenzgraph (B.2)', () => {
  it('tote Referenz = Fehler; nach Anlegen des Zieldokuments verschwindet sie inkrementell', () => {
    const doc = field({ trigger: [{ id: 't', eckpunkte: [0, 1, 2].map((x) => ({ x, y: 0, z: 0 })), scriptRef: 'lina.init' }] });
    const project = makeProject({ 'project.json': projectDoc, 'fields/f.json': doc });
    const validiert: string[] = [];
    const v = new IncrementalValidator(project, { onValidate: (pfad) => validiert.push(pfad) });

    const vorher = v.validateAll();
    expect(hatMeldung(byKlasse(vorher, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/script/lina.init'")).toBe(true);

    validiert.length = 0;
    project.addDocument('scripts/lina.init.json', scriptGraph());
    const nachher = v.revalidate(['scripts/lina.init.json']);
    // Provides-Änderung invalidiert das referenzierende Field-Dokument mit.
    expect(validiert.sort()).toEqual(['fields/f.json', 'scripts/lina.init.json']);
    expect(hatMeldung(nachher, 'Tote Referenz')).toBe(false);
  });

  it('enemy/battle sind im Referenzgraphen verdrahtet; Entfernen des Gegners erzeugt tote Referenz inkrementell', () => {
    const project = makeProject({
      'project.json': projectDoc,
      'enemies/rostwolf.json': enemy(),
      'battles/slum_hinterhof.json': battle(),
    });
    const graph = project.referenceGraph();
    expect(graph.provides.get('mod:de.example.midgarquest/enemy/rostwolf')).toBe('enemies/rostwolf.json');
    expect(graph.provides.get('mod:de.example.midgarquest/battle/slum_hinterhof')).toBe('battles/slum_hinterhof.json');
    expect(graph.references.get('battles/slum_hinterhof.json')).toEqual(['mod:de.example.midgarquest/enemy/rostwolf']);
    // kernel:item/lgp:-Referenzen sind kanonisch extern und tauchen nicht im Graphen auf.
    expect(graph.references.get('enemies/rostwolf.json')).toEqual([]);

    const v = new IncrementalValidator(project);
    expect(v.validateAll()).toEqual([]);
    project.removeDocument('enemies/rostwolf.json');
    const nachher = v.revalidate(['enemies/rostwolf.json']);
    expect(hatMeldung(byKlasse(nachher, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/enemy/rostwolf'")).toBe(true);
  });

  it('enemy referenziert modellRef im mod:-Namensraum (geprüft); lgp: ist extern', () => {
    const doc = enemy({ modell: { art: 'referenz', ref: 'mod:de.example.midgarquest/char/basis' } });
    const project = makeProject({ 'project.json': projectDoc, 'enemies/rostwolf.json': doc });
    expect(project.referenceGraph().references.get('enemies/rostwolf.json')).toEqual(['mod:de.example.midgarquest/char/basis']);
    const be = new IncrementalValidator(project).validateAll();
    expect(hatMeldung(byKlasse(be, 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/char/basis'")).toBe(true);
  });

  it('variablenRefs verweisen auf variables.json; Fremd- und deformierte IDs', () => {
    const graph = scriptGraph({ variablenRefs: ['fortschritt'] });
    const ohneVars = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'scripts/lina.init.json': graph }));
    expect(hatMeldung(byKlasse(ohneVars.validateAll(), 'fehler'), "Tote Referenz 'mod:de.example.midgarquest/var/fortschritt'")).toBe(true);

    const mitVars = new IncrementalValidator(
      makeProject({ 'project.json': projectDoc, 'scripts/lina.init.json': graph, 'variables.json': variables }),
    );
    expect(mitVars.validateAll()).toEqual([]);
  });

  it('Namensraum-Konvention: deformierte mod:-Referenz = Fehler', () => {
    const doc = field({ trigger: [{ id: 't', eckpunkte: [0, 1, 2].map((x) => ({ x, y: 0, z: 0 })), scriptRef: 'mod:BÖSE' }] });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/f.json': doc }));
    expect(hatMeldung(byKlasse(v.validateAll(), 'fehler'), 'ID-Namensraum-Konvention')).toBe(true);
  });

  it('kanonische Referenzen (field:/lgp:) sind extern und nie tot', () => {
    const doc = field({ gateways: [{ zielField: 'field:md1stin', zielDreieck: 0, zielPosition: { x: 0, y: 0, z: 0 } }] });
    const v = new IncrementalValidator(makeProject({ 'project.json': projectDoc, 'fields/f.json': doc }));
    expect(v.validateAll()).toEqual([]);
  });
});

describe('Inkrementelle Validierung', () => {
  it('Änderung an Dokument A prüft unabhängige Dokumente nicht neu', () => {
    const dialogA = dialogue({ id: 'a', seiten: [{ text: 'hallo' }] });
    const dialogB = dialogue({ id: 'b', seiten: [{ text: '  ' }] }); // Warnung bleibt gecacht
    const project = makeProject({
      'project.json': projectDoc,
      'dialogues/a.de.json': dialogA,
      'dialogues/b.de.json': dialogB,
    });
    const validiert: string[] = [];
    const v = new IncrementalValidator(project, { onValidate: (pfad) => validiert.push(pfad) });

    const initial = v.validateAll();
    expect(validiert.sort()).toEqual(['dialogues/a.de.json', 'dialogues/b.de.json', 'project.json']);
    expect(hatMeldung(byKlasse(initial, 'warnung'), 'leeren Text')).toBe(true);

    validiert.length = 0;
    project.mutate<DialogueDoc>('dialogues/a.de.json', cmdSetText(0, 0, 'hallo', 'welt'));
    const danach = v.revalidate(['dialogues/a.de.json']);

    expect(validiert).toEqual(['dialogues/a.de.json']); // nur A neu geprüft
    // Gesamtliste enthält weiterhin die gecachte Warnung von B.
    expect(hatMeldung(byKlasse(danach, 'warnung'), 'leeren Text')).toBe(true);
  });

  it('project.json-Änderung invalidiert namensraumweit', () => {
    const project = makeProject({ 'project.json': projectDoc, 'dialogues/a.de.json': dialogue({ id: 'a', seiten: [{ text: 'x' }] }) });
    const validiert: string[] = [];
    const v = new IncrementalValidator(project, { onValidate: (pfad) => validiert.push(pfad) });
    v.validateAll();
    validiert.length = 0;
    project.mutate<ProjectDoc>('project.json', {
      name: 'proj.setName',
      apply: (d) => ({ ...d, name: 'Neuer Name' }),
      invert: (d) => ({ ...d, name: 'Midgar Quest' }),
    });
    v.revalidate(['project.json']);
    expect(validiert.sort()).toEqual(['dialogues/a.de.json', 'project.json']);
  });
});
