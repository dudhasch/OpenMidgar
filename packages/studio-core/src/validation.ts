/**
 * Inkrementelle Validierung (Masterplan B.3/B.5): Strukturregeln je
 * Dokumenttyp plus fachliche Regeln (tote Referenzen, ID-Namensraum,
 * Walkmesh-Invarianten). Dokumentänderungen invalidieren nur abhängige
 * Befunde — `revalidate(changedPaths)` prüft ausschließlich betroffene
 * Dokumente neu und liefert die Gesamt-Befundliste.
 */

import {
  documentKindForPath,
  ENEMY_STAT_BAND,
  GESPERRTE_ENEMY_MODELLARTEN,
  GESPERRTE_SCRIPT_KATEGORIEN,
  MOD_ID_PATTERN,
  SCHEMA_VERSIONS,
  STRUCTURAL_VALIDATORS,
  type BattleDoc,
  type CharacterDoc,
  type DialogueDoc,
  type EnemyDoc,
  type FieldDoc,
  type FieldDeltaDoc,
  type ProjectDoc,
  type ScriptGraphDoc,
  type VariablesDoc,
  type WalkmeshTriangle,
} from './documents.js';
import type { ReferenceGraph, StudioProject } from './project.js';

export type BefundKlasse = 'fehler' | 'warnung' | 'info';

export interface Befund {
  /** Projektpfad des Dokuments. */
  dokument: string;
  /** JSON-Pfad im Dokument. */
  pfad: string;
  klasse: BefundKlasse;
  meldung: string;
  fixHint?: string | undefined;
}

/** ID-Namensraum-Konvention für neue Inhalte (B.2) — enemy/battle/item ab MS15/MS16. */
export const NAMESPACE_PATTERN = /^mod:[a-z0-9.-]{3,64}\/(field|char|dlg|script|var|enemy|battle|item)\/[A-Za-z0-9_.-]+$/;

const GESPERRTE_KATEGORIEN_CHECK: ReadonlySet<string> = new Set(GESPERRTE_SCRIPT_KATEGORIEN);

const EPSILON_FLAECHE = 1e-9;

type Emit = (pfad: string, klasse: BefundKlasse, meldung: string, fixHint?: string) => void;

function makeEmitter(dokument: string, out: Befund[]): Emit {
  return (pfad, klasse, meldung, fixHint) => {
    out.push({ dokument, pfad, klasse, meldung, ...(fixHint !== undefined ? { fixHint } : {}) });
  };
}

/* ------------------------------------------------------------------ */
/* Fachliche Regeln je Dokumenttyp                                     */
/* ------------------------------------------------------------------ */

function checkProject(doc: ProjectDoc, emit: Emit): void {
  if (!MOD_ID_PATTERN.test(doc.modId)) {
    emit('modId', 'fehler', `modId '${doc.modId}' verletzt das reverse-DNS-Format [a-z0-9.-]{3,64}.`, 'modId anpassen, z. B. de.example.meinmod.');
  }
  if (!doc.sprachen.includes(doc.primaersprache)) {
    emit('sprachen', 'warnung', `primaersprache '${doc.primaersprache}' ist nicht in sprachen[] enthalten.`);
  }
}

function checkDialogue(doc: DialogueDoc, emit: Emit): void {
  const ids = new Set<string>();
  doc.eintraege.forEach((e, i) => {
    const p = `eintraege[${i}]`;
    if (ids.has(e.id)) emit(`${p}.id`, 'fehler', `Doppelte Eintrags-ID '${e.id}'.`);
    ids.add(e.id);
    if (e.seiten.length === 0) {
      emit(`${p}.seiten`, 'fehler', `Dialog-Eintrag '${e.id}' hat keine Seiten.`, 'Mindestens eine Seite mit Text anlegen.');
    }
    e.seiten.forEach((s, j) => {
      if (s.text.trim().length === 0) {
        emit(`${p}.seiten[${j}].text`, 'warnung', `Seite ${j} von '${e.id}' hat leeren Text.`);
      }
    });
  });
}

function checkScriptGraph(doc: ScriptGraphDoc, emit: Emit): void {
  const ids = new Set<string>();
  doc.knoten.forEach((n, i) => {
    if (ids.has(n.id)) emit(`knoten[${i}].id`, 'fehler', `Doppelte Knoten-ID '${n.id}'.`);
    ids.add(n.id);
    if (GESPERRTE_KATEGORIEN_CHECK.has(n.kategorie)) {
      emit(
        `knoten[${i}].kategorie`,
        'warnung',
        `Kategorie '${n.kategorie}' ist im Editor gesperrt (A-ST-5) — Semantik noch nicht implementiert.`,
      );
    }
  });
  doc.kanten.forEach((k, i) => {
    if (!ids.has(k.von)) emit(`kanten[${i}].von`, 'fehler', `Kante referenziert unbekannten Knoten '${k.von}'.`);
    if (!ids.has(k.zu)) emit(`kanten[${i}].zu`, 'fehler', `Kante referenziert unbekannten Knoten '${k.zu}'.`);
  });
}

function checkCharacter(doc: CharacterDoc, emit: Emit): void {
  if (!doc.modell.ref.startsWith('lgp:char/')) {
    emit('modell.ref', 'fehler', `Modell-Referenz '${doc.modell.ref}' muss kanonisch sein (lgp:char/…).`);
  }
  if (doc.kollision.radius <= 0) emit('kollision.radius', 'fehler', 'Kollisionsradius muss > 0 sein.');
  if (doc.kollision.hoehe <= 0) emit('kollision.hoehe', 'fehler', 'Kollisionshöhe muss > 0 sein.');
}

function triangleArea(t: WalkmeshTriangle): number {
  const [ax, ay, az] = t.a;
  const [bx, by, bz] = t.b;
  const [cx, cy, cz] = t.c;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

function checkField(doc: FieldDoc, emit: Emit): void {
  const dreiecke = doc.walkmesh.dreiecke;
  dreiecke.forEach((t, i) => {
    const p = `walkmesh.dreiecke[${i}]`;
    if (triangleArea(t) <= EPSILON_FLAECHE) {
      emit(p, 'fehler', `Dreieck ${i} ist degeneriert (Fläche ≤ 0).`, 'Eckpunkte so setzen, dass das Dreieck eine echte Fläche aufspannt.');
    }
    t.adjazent.forEach((nachbar, kante) => {
      if (nachbar === null) return;
      if (nachbar >= dreiecke.length) {
        emit(`${p}.adjazent[${kante}]`, 'fehler', `Adjazenz verweist auf nicht existentes Dreieck ${nachbar}.`);
        return;
      }
      const gegen = dreiecke[nachbar]!;
      if (!gegen.adjazent.includes(i)) {
        emit(
          `${p}.adjazent[${kante}]`,
          'fehler',
          `Adjazenz nicht symmetrisch: Dreieck ${i} → ${nachbar}, aber ${nachbar} listet ${i} nicht als Nachbarn.`,
          'Adjazenzen paarweise pflegen.',
        );
      }
    });
  });
  doc.kameras.forEach((k, i) => {
    if (k.fovBasis <= 0) emit(`kameras[${i}].fovBasis`, 'fehler', 'fovBasis muss > 0 sein.');
  });
  doc.trigger.forEach((t, i) => {
    if (t.eckpunkte.length < 3) {
      emit(`trigger[${i}].eckpunkte`, 'fehler', `Trigger '${t.id}' braucht mindestens 3 Eckpunkte.`);
    }
  });
}

function checkFieldDelta(doc: FieldDeltaDoc, emit: Emit): void {
  if (!doc.zielField.startsWith('field:')) {
    emit(
      'zielField',
      'fehler',
      `Field-Delta muss auf eine kanonische Original-ID zeigen (field:…), nicht '${doc.zielField}'.`,
      'Änderungen an Mod-Fields direkt im Field-Dokument vornehmen — Deltas nur für Originale.',
    );
  }
}

function checkVariables(doc: VariablesDoc, emit: Emit): void {
  const namen = new Set<string>();
  doc.benannt.forEach((b, i) => {
    if (namen.has(b.name)) emit(`benannt[${i}].name`, 'fehler', `Doppelter Variablenname '${b.name}'.`);
    namen.add(b.name);
  });
}

function checkEnemy(doc: EnemyDoc, emit: Emit): void {
  // Gesperrte Modellarten (MS15-UI-Regel: „gesperrt bis MS9/MS6“).
  const sperre = GESPERRTE_ENEMY_MODELLARTEN[doc.modell.art];
  if (sperre !== undefined) {
    emit(
      'modell.art',
      'info',
      `Modellart '${doc.modell.art}' ist reserviert und bis ${sperre} gesperrt — das Dokument ist paketierbar, die Aktivierung folgt dem Meilenstein.`,
    );
  }

  // Stats-Bänder (Konstanten ENEMY_STAT_BAND, Warnungen — nie Fehler).
  for (const [key, band] of Object.entries(ENEMY_STAT_BAND)) {
    const wert = doc.stats[key as keyof EnemyDoc['stats']];
    if (wert < band.min || wert > band.max) {
      emit(
        `stats.${key}`,
        'warnung',
        `Stat '${key}' (${wert}) liegt außerhalb des sinnvollen Bands ${band.min}..${band.max} (Orientierung Original-Level-Bänder).`,
      );
    }
  }

  // Angriffsliste.
  if (doc.angriffe.length === 0) {
    emit('angriffe', 'warnung', `Gegner '${doc.id}' hat eine leere angriffe-Liste.`, 'Mindestens einen Angriff deklarieren.');
  }
  const angriffIds = new Set<string>();
  doc.angriffe.forEach((a, i) => {
    if (angriffIds.has(a.id)) emit(`angriffe[${i}].id`, 'fehler', `Doppelte Angriffs-ID '${a.id}'.`);
    angriffIds.add(a.id);
  });

  // Verhalten: angriffRef muss einen deklarierten Angriff treffen; Regeln
  // hinter einer 'immer'-Regel sind unerreichbar (erste zutreffende Regel
  // gewinnt, ADR-024).
  let immerGesehen = false;
  doc.verhalten.regeln.forEach((r, i) => {
    const p = `verhalten.regeln[${i}]`;
    if (immerGesehen) {
      emit(`${p}.wenn`, 'warnung', `Regel ${i} ist unerreichbar — eine vorgeschaltete 'immer'-Regel greift vorher.`);
    }
    if (!angriffIds.has(r.dann)) {
      emit(
        `${p}.dann`,
        'fehler',
        `Verhaltensregel ${i} referenziert Angriff '${r.dann}', der nicht in angriffe[] deklariert ist.`,
        'Angriff mit dieser ID anlegen oder Referenz korrigieren.',
      );
    }
    if (r.wenn.art === 'immer') immerGesehen = true;
  });

  // Drop-Raten (Fehler außerhalb 0..1).
  const pruefeRate = (eintrag: { rate: number }, pfad: string) => {
    if (eintrag.rate < 0 || eintrag.rate > 1) {
      emit(`${pfad}.rate`, 'fehler', `Drop-Rate ${eintrag.rate} liegt außerhalb 0..1.`);
    }
  };
  doc.beute.drops.forEach((d, i) => pruefeRate(d, `beute.drops[${i}]`));
  doc.beute.stehlen.forEach((d, i) => pruefeRate(d, `beute.stehlen[${i}]`));
}

function checkBattle(doc: BattleDoc, emit: Emit): void {
  if (doc.formation.reihen.length === 0) {
    emit('formation.reihen', 'fehler', `Battle '${doc.id}' hat eine leere Formation.`, 'Mindestens eine Reihe mit enemyRef platzieren.');
  }
  doc.formation.reihen.forEach((r, i) => {
    const p = `formation.reihen[${i}].anzahl`;
    if (r.anzahl < 1) emit(p, 'fehler', `anzahl der Reihe ${i} muss ≥ 1 sein.`);
    if (r.anzahl > doc.formation.maxGleichzeitig) {
      emit(p, 'fehler', `anzahl (${r.anzahl}) der Reihe ${i} überschreitet maxGleichzeitig (${doc.formation.maxGleichzeitig}).`);
    }
  });
  if (doc.regeln.flucht === 'verboten' && (doc.belohnung.garantierteDrops ?? []).length === 0) {
    emit(
      'regeln.flucht',
      'info',
      'Flucht ist verboten, aber belohnung.garantierteDrops ist leer — Spieler können den Kampf nicht verlassen und erhalten keine Ausgleichsbeute.',
    );
  }
  if (doc.musikRef !== undefined && !doc.musikRef.startsWith('music:')) {
    emit(
      'musikRef',
      'info',
      `musikRef '${doc.musikRef}' hat kein 'music:'-Präfix — das Musik-Feature (MS12) ist Zukunft; die Referenz wird vorerst nur mitgeführt.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Dokument-Validierung (Struktur + Fachlich + Referenzen)             */
/* ------------------------------------------------------------------ */

function validateDocument(project: StudioProject, pfad: string, graph: ReferenceGraph): Befund[] {
  const out: Befund[] = [];
  const emit = makeEmitter(pfad, out);
  const kind = documentKindForPath(pfad);
  const doc = project.getDocument(pfad);
  if (kind === null || doc === undefined) return out;

  const structure = STRUCTURAL_VALIDATORS[kind](doc);
  for (const e of structure) emit(e.pfad, 'fehler', e.meldung, 'Struktur gemäß schemaVersion korrigieren.');
  if (structure.length > 0) return out; // fachliche Regeln brauchen valide Struktur

  const rec = doc as Record<string, unknown>;
  if (rec['schemaVersion'] !== SCHEMA_VERSIONS[kind]) {
    emit('schemaVersion', 'warnung', `schemaVersion ${String(rec['schemaVersion'])} weicht von der aktuellen (${SCHEMA_VERSIONS[kind]}) ab.`);
  }

  switch (kind) {
    case 'project':
      checkProject(doc as ProjectDoc, emit);
      break;
    case 'dialogue':
      checkDialogue(doc as DialogueDoc, emit);
      break;
    case 'scriptGraph':
      checkScriptGraph(doc as ScriptGraphDoc, emit);
      break;
    case 'character':
      checkCharacter(doc as CharacterDoc, emit);
      break;
    case 'field':
      checkField(doc as FieldDoc, emit);
      break;
    case 'fieldDelta':
      checkFieldDelta(doc as FieldDeltaDoc, emit);
      break;
    case 'variables':
      checkVariables(doc as VariablesDoc, emit);
      break;
    case 'enemy':
      checkEnemy(doc as EnemyDoc, emit);
      break;
    case 'battle':
      checkBattle(doc as BattleDoc, emit);
      break;
  }

  // ID-Namensraum + tote Referenzen (B.2)
  for (const ref of graph.references.get(pfad) ?? []) {
    if (!NAMESPACE_PATTERN.test(ref)) {
      emit('', 'fehler', `Referenz '${ref}' verletzt die ID-Namensraum-Konvention mod:<modId>/<typ>/<name>.`);
    } else if (!graph.provides.has(ref)) {
      emit('', 'fehler', `Tote Referenz '${ref}' — kein Dokument im Projekt liefert diese ID.`, 'Zieldokument anlegen oder Referenz korrigieren.');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Inkrementeller Validator                                            */
/* ------------------------------------------------------------------ */

export interface IncrementalValidatorOptions {
  /** Instrumentierung (Tests/Diagnose): wird je tatsächlich neu geprüftem Dokument aufgerufen. */
  onValidate?: ((pfad: string) => void) | undefined;
}

export class IncrementalValidator {
  private readonly cache = new Map<string, Befund[]>();
  private readonly providesCache = new Map<string, string[]>();

  constructor(
    private readonly project: StudioProject,
    private readonly options?: IncrementalValidatorOptions,
  ) {}

  validateAll(): Befund[] {
    return this.revalidate(this.project.documents());
  }

  /**
   * Invalidiert nur abhängige Befunde: das geänderte Dokument selbst,
   * alle Dokumente bei project.json-Änderung (modId wirkt namensraumweit)
   * sowie referenzierende Dokumente, wenn sich Provides-Mengen ändern.
   */
  revalidate(changedPaths: string[]): Befund[] {
    const changed = new Set(changedPaths);
    const docs = this.project.documents();
    const docSet = new Set(docs);

    // Entfernte Dokumente: Cache aufräumen; ihre Provides könnten gefehlt haben.
    let providesChanged = false;
    for (const pfad of [...this.cache.keys()]) {
      if (!docSet.has(pfad)) {
        this.cache.delete(pfad);
        if ((this.providesCache.get(pfad) ?? []).length > 0) providesChanged = true;
        this.providesCache.delete(pfad);
      }
    }

    const affected = new Set<string>();
    for (const p of changed) if (docSet.has(p)) affected.add(p);

    // project.json trägt die modId → namensraumweite Invalidierung.
    if (changed.has('project.json')) {
      for (const p of docs) affected.add(p);
      providesChanged = true;
    }

    // Provides-Diff: Änderung an gelieferten IDs invalidiert Referenzierende.
    const graph = this.project.referenceGraph();
    for (const p of docs) {
      const next = graph.providesOf(p);
      const prev = this.providesCache.get(p);
      const diff = prev === undefined ? next.length > 0 : prev.join('\n') !== next.join('\n');
      if (diff) providesChanged = true;
      this.providesCache.set(p, next);
    }
    if (providesChanged) {
      for (const p of docs) {
        if ((graph.references.get(p) ?? []).length > 0) affected.add(p);
      }
    }

    for (const pfad of affected) {
      this.options?.onValidate?.(pfad);
      this.cache.set(pfad, validateDocument(this.project, pfad, graph));
    }

    const all: Befund[] = [];
    for (const pfad of docs) all.push(...(this.cache.get(pfad) ?? []));
    return all;
  }
}
