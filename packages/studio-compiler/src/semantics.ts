/**
 * Semantikvalidierung des Compilers (B.3, C.1/C.2) — ergänzt die
 * studio-core-Validierung (Struktur, fachliche Regeln, tote Referenzen,
 * Walkmesh-Invarianten) um die compilezeitigen Heuristiken:
 * Dialogmetrik, Script-Erreichbarkeit, Wartezyklen. Alle Befunde sind
 * Warnungen — sie blockieren die Paketierung nicht (Masterplan 5.2:
 * Metriküberlauf ist Warnung, nie Fehler).
 */

import {
  documentKindForPath,
  GESPERRTE_ENEMY_MODELLARTEN,
  type BattleDoc,
  type Befund,
  type BefundKlasse,
  type DialogueDoc,
  type EnemyDoc,
  type ScriptGraphDoc,
  type StudioProject,
} from '@webmidgar/studio-core';
import { erreichbareKnoten, incomingCounts, startKnoten, wartezyklen } from './scripts.js';

/** Heuristische Fenstermetrik (A-ST-9): 3 Zeilen à ~48 Zeichen. */
export const DIALOG_ZEILEN_LIMIT = 3;
export const DIALOG_ZEICHEN_PRO_ZEILE = 48;

function emit(out: Befund[], dokument: string, pfad: string, meldung: string, fixHint?: string): void {
  out.push({ dokument, pfad, klasse: 'warnung', meldung, ...(fixHint !== undefined ? { fixHint } : {}) });
}

function emitKlasse(out: Befund[], dokument: string, pfad: string, klasse: BefundKlasse, meldung: string, fixHint?: string): void {
  out.push({ dokument, pfad, klasse, meldung, ...(fixHint !== undefined ? { fixHint } : {}) });
}

/** Geschätzte Zeilenzahl eines Seitentexts (harte Umbrüche + Umfließen). */
export function dialogZeilen(text: string): number {
  return text
    .split('\n')
    .reduce((summe, zeile) => summe + Math.max(1, Math.ceil(zeile.length / DIALOG_ZEICHEN_PRO_ZEILE)), 0);
}

function checkDialogMetrik(dokument: string, doc: DialogueDoc, out: Befund[]): void {
  doc.eintraege.forEach((e, i) => {
    e.seiten.forEach((s, j) => {
      const zeilen = dialogZeilen(s.text);
      if (zeilen > DIALOG_ZEILEN_LIMIT) {
        emit(
          out,
          dokument,
          `eintraege[${i}].seiten[${j}].text`,
          `Dialog '${e.id}' Seite ${j} überläuft die Fenstermetrik: ~${zeilen} Zeilen (Limit ${DIALOG_ZEILEN_LIMIT} à ~${DIALOG_ZEICHEN_PRO_ZEILE} Zeichen, heuristisch).`,
          'Text kürzen oder auf weitere Seiten aufteilen.',
        );
      }
    });
  });
}

function checkScriptSemantik(dokument: string, doc: ScriptGraphDoc, out: Befund[]): void {
  if (doc.knoten.length === 0) return;
  const ids = new Set(doc.knoten.map((n) => n.id));

  // Startknoten: genau ein Knoten ohne eingehende Kante.
  const incoming = incomingCounts(doc);
  const ohneEingehend = doc.knoten
    .filter((n) => (incoming.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort();
  const start = startKnoten(doc);
  if (ohneEingehend.length === 0) {
    emit(out, dokument, 'knoten', 'Script-Graph hat keinen Startknoten (jeder Knoten hat eine eingehende Kante — reiner Zyklus).');
  } else {
    for (const id of ohneEingehend) {
      if (start !== null && id !== start.id) {
        emit(
          out,
          dokument,
          'knoten',
          `Knoten '${id}' hat keine eingehende Kante und ist nicht der Startknoten ('${start.id}') — toter paralleler Einstieg.`,
          'Knoten an den Kontrollfluss anschließen oder entfernen.',
        );
      }
    }
  }

  // Erreichbarkeit vom Startknoten.
  const erreichbar = erreichbareKnoten(doc);
  for (const id of [...ids].sort()) {
    if (!erreichbar.has(id)) {
      emit(
        out,
        dokument,
        'knoten',
        `Knoten '${id}' ist vom Startknoten '${start?.id ?? '?'}' aus unerreichbar.`,
        'Kante zum Knoten ergänzen oder Knoten entfernen.',
      );
    }
  }

  // Wartezyklen: Zyklus, in dem alle Knoten blockierend sind.
  for (const zyklus of wartezyklen(doc)) {
    emit(
      out,
      dokument,
      'knoten',
      `Wartezyklus: die Knoten ${zyklus.map((id) => `'${id}'`).join(', ')} bilden einen Zyklus aus ausschließlich blockierenden Knoten — das Script kann sich gegenseitig dauerhaft blockieren.`,
      'Mindestens einen Knoten des Zyklus nicht-blockierend machen oder eine Ausstiegskante ergänzen.',
    );
  }
}

/**
 * Battle-Semantik (MS16, Stub-Validierung bis zum Battle-Modul):
 * Erreichbarkeit der Szene und Modellarten-Sperre der Formation —
 * auflösbar nur mit Referenzgraph, daher hier statt in studio-core.
 */
function checkBattleSemantik(dokument: string, doc: BattleDoc, project: StudioProject, out: Befund[]): void {
  if (doc.verknuepfung === undefined) {
    emitKlasse(
      out,
      dokument,
      'verknuepfung',
      'warnung',
      `Battle '${doc.id}' hat keine verknuepfung — die Szene ist nirgends erreichbar.`,
      'Encounter-Zone eines Fields oder einen Script-Start verknüpfen.',
    );
  }
  // Info, wenn ALLE referenzierten Gegner gesperrte Modellarten nutzen
  // (baukasten/gltf) — die Szene ist dann vollständig MS9/MS6-blockiert.
  const modId = project.modId();
  const graph = project.referenceGraph();
  const modellArten: string[] = [];
  for (const reihe of doc.formation.reihen) {
    if (typeof reihe?.enemyRef !== 'string') continue;
    const ref = reihe.enemyRef.startsWith('mod:') || modId === null ? reihe.enemyRef : `mod:${modId}/enemy/${reihe.enemyRef}`;
    const quelle = graph.provides.get(ref);
    const enemy = quelle !== undefined ? project.getDocument<EnemyDoc>(quelle) : undefined;
    if (enemy?.modell !== undefined && typeof enemy.modell.art === 'string') modellArten.push(enemy.modell.art);
  }
  if (modellArten.length > 0 && modellArten.every((art) => GESPERRTE_ENEMY_MODELLARTEN[art] !== undefined)) {
    const sperren = [...new Set(modellArten.map((art) => GESPERRTE_ENEMY_MODELLARTEN[art]))].sort().join('/');
    emitKlasse(
      out,
      dokument,
      'formation.reihen',
      'info',
      `Alle Gegner der Formation nutzen gesperrte Modellarten (${[...new Set(modellArten)].sort().join(', ')}) — die Szene ist bis ${sperren} nicht aktivierbar.`,
    );
  }
}

/** Vollständige Semantik-Befundliste über alle Projektdokumente (total). */
export function semanticBefunde(project: StudioProject): Befund[] {
  const out: Befund[] = [];
  for (const pfad of project.documents()) {
    const kind = documentKindForPath(pfad);
    const doc = project.getDocument(pfad);
    if (kind === null || doc === undefined) continue;
    // Semantik setzt valide Struktur voraus — Strukturfehler meldet die
    // studio-core-Validierung; hier defensiv auf Form prüfen.
    if (kind === 'dialogue') {
      const d = doc as DialogueDoc;
      if (Array.isArray(d.eintraege)) checkDialogMetrik(pfad, d, out);
    } else if (kind === 'scriptGraph') {
      const s = doc as ScriptGraphDoc;
      if (Array.isArray(s.knoten) && Array.isArray(s.kanten)) checkScriptSemantik(pfad, s, out);
    } else if (kind === 'battle') {
      const b = doc as BattleDoc;
      if (b.formation !== undefined && Array.isArray(b.formation.reihen)) checkBattleSemantik(pfad, b, project, out);
    }
  }
  return out;
}
