import { describe, expect, it } from 'vitest';
import type { Command } from './commands.js';
import { canonicalJson } from './json.js';
import { StudioProject } from './project.js';
import type { DialogueDoc, DialogueEntry, DialoguePage } from './documents.js';

/* --- Command-Bausteine für Dialogdokumente (apply/invert strikt invers) --- */

const clone = <T>(v: T): T => structuredClone(v);

export function cmdAddEintrag(eintrag: DialogueEntry): Command<DialogueDoc> {
  const snap = clone(eintrag);
  return {
    name: 'dlg.addEintrag',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege.push(clone(snap));
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      const i = d.eintraege.findIndex((x) => x.id === snap.id);
      d.eintraege.splice(i, 1);
      return d;
    },
  };
}

export function cmdRemoveEintrag(index: number, entfernt: DialogueEntry): Command<DialogueDoc> {
  const snap = clone(entfernt);
  return {
    name: 'dlg.removeEintrag',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege.splice(index, 1);
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      d.eintraege.splice(index, 0, clone(snap));
      return d;
    },
  };
}

export function cmdSetText(ei: number, pi: number, alterText: string, neuerText: string): Command<DialogueDoc> {
  return {
    name: 'dlg.setText',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten[pi]!.text = neuerText;
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten[pi]!.text = alterText;
      return d;
    },
  };
}

export function cmdAddSeite(ei: number, seite: DialoguePage): Command<DialogueDoc> {
  const snap = clone(seite);
  return {
    name: 'dlg.addSeite',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten.push(clone(snap));
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten.pop();
      return d;
    },
  };
}

export function cmdRemoveSeite(ei: number, pi: number, entfernt: DialoguePage): Command<DialogueDoc> {
  const snap = clone(entfernt);
  return {
    name: 'dlg.removeSeite',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten.splice(pi, 1);
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.seiten.splice(pi, 0, clone(snap));
      return d;
    },
  };
}

export function cmdSetSprecher(ei: number, alt: string | undefined, neu: string | undefined): Command<DialogueDoc> {
  return {
    name: 'dlg.setSprecher',
    apply: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.sprecher = neu;
      return d;
    },
    invert: (doc) => {
      const d = clone(doc);
      d.eintraege[ei]!.sprecher = alt;
      return d;
    },
  };
}

/* --- Zufallsgenerator (deterministisch, mulberry32) --- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZEICHEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜß0123456789 ,.!?—…';

function randomText(rnd: () => number): string {
  const len = Math.floor(rnd() * 40);
  let out = '';
  for (let i = 0; i < len; i++) out += ZEICHEN[Math.floor(rnd() * ZEICHEN.length)];
  return out;
}

function randomSeite(rnd: () => number): DialoguePage {
  const seite: DialoguePage = { text: randomText(rnd) };
  if (rnd() < 0.3) {
    const arten = ['farbe', 'pause', 'variable', 'auswahl'] as const;
    seite.steuerelemente = [{ art: arten[Math.floor(rnd() * 4)]!, wert: randomText(rnd).slice(0, 8) }];
  }
  return seite;
}

function randomEintrag(rnd: () => number, id: string): DialogueEntry {
  const eintrag: DialogueEntry = { id, seiten: [] };
  const seiten = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < seiten; i++) eintrag.seiten.push(randomSeite(rnd));
  if (rnd() < 0.5) eintrag.sprecher = randomText(rnd).slice(0, 12);
  return eintrag;
}

/** Erzeugt ein zum aktuellen Dokumentstand passendes Zufalls-Command. */
function randomCommand(rnd: () => number, doc: DialogueDoc, naechsteId: () => string): Command<DialogueDoc> {
  const n = doc.eintraege.length;
  const wahl = rnd();
  if (n === 0 || wahl < 0.25) return cmdAddEintrag(randomEintrag(rnd, naechsteId()));

  const ei = Math.floor(rnd() * n);
  const eintrag = doc.eintraege[ei]!;
  const art = Math.floor(rnd() * 5);
  switch (art) {
    case 0:
      return cmdRemoveEintrag(ei, eintrag);
    case 1: {
      const seite = randomSeite(rnd);
      return cmdAddSeite(ei, seite);
    }
    case 2: {
      if (eintrag.seiten.length === 0) return cmdAddSeite(ei, randomSeite(rnd));
      const pi = Math.floor(rnd() * eintrag.seiten.length);
      return cmdRemoveSeite(ei, pi, eintrag.seiten[pi]!);
    }
    case 3: {
      if (eintrag.seiten.length === 0) return cmdAddSeite(ei, randomSeite(rnd));
      const pi = Math.floor(rnd() * eintrag.seiten.length);
      return cmdSetText(ei, pi, eintrag.seiten[pi]!.text, randomText(rnd));
    }
    default:
      return cmdSetSprecher(ei, eintrag.sprecher, rnd() < 0.5 ? randomText(rnd).slice(0, 12) : undefined);
  }
}

/* --- Tests --- */

const PFAD = 'dialogues/property.de.json';

describe('Command-Bus: Undo/Redo-Inversion', () => {
  it('Property-Test: 1000 zufällige Commands führen bitverlustfrei zurück zum Ausgangsstand', () => {
    const rnd = mulberry32(0xc0ffee);
    const project = new StudioProject({ byteBudget: 64 * 1024 * 1024 });
    const initial: DialogueDoc = { schemaVersion: 1, field: 'field:prop', locale: 'de', eintraege: [] };
    project.addDocument(PFAD, initial);
    const ausgangsstand = canonicalJson(initial);

    let counter = 0;
    for (let i = 0; i < 1000; i++) {
      const current = project.getDocument<DialogueDoc>(PFAD)!;
      project.mutate(PFAD, randomCommand(rnd, current, () => `e${counter++}`));
    }
    const endstand = canonicalJson(project.getDocument(PFAD));
    expect(project.bus.history.length).toBe(1000);

    for (let i = 0; i < 1000; i++) expect(project.bus.undo()).toBe(true);
    expect(project.bus.undo()).toBe(false);
    expect(canonicalJson(project.getDocument(PFAD))).toBe(ausgangsstand);

    for (let i = 0; i < 1000; i++) expect(project.bus.redo()).toBe(true);
    expect(project.bus.redo()).toBe(false);
    expect(canonicalJson(project.getDocument(PFAD))).toBe(endstand);
  });

  it('Gesten-Gruppierung: 3 Applies in einer Geste = 1 Undo-Schritt', () => {
    const project = new StudioProject();
    const initial: DialogueDoc = {
      schemaVersion: 1,
      field: 'field:g',
      locale: 'de',
      eintraege: [{ id: 'a', seiten: [{ text: 'eins' }] }],
    };
    project.addDocument(PFAD, initial);

    project.bus.beginGesture('drag');
    project.mutate(PFAD, cmdSetText(0, 0, 'eins', 'zwei'));
    project.mutate(PFAD, cmdAddSeite(0, { text: 'neu' }));
    project.mutate(PFAD, cmdSetSprecher(0, undefined, 'Lina'));
    project.bus.endGesture();

    expect(project.bus.history.length).toBe(1);
    const endstand = canonicalJson(project.getDocument(PFAD));

    expect(project.bus.undo()).toBe(true);
    expect(canonicalJson(project.getDocument(PFAD))).toBe(canonicalJson(initial));
    expect(project.bus.history.canUndo).toBe(false);

    expect(project.bus.redo()).toBe(true);
    expect(canonicalJson(project.getDocument(PFAD))).toBe(endstand);
  });

  it('meldet Änderungen (dispatch/undo/redo) an Subscriber', () => {
    const project = new StudioProject();
    project.addDocument(PFAD, { schemaVersion: 1, field: 'field:x', locale: 'de', eintraege: [] });
    const gesehen: string[] = [];
    project.subscribe((pfad) => gesehen.push(pfad));
    project.mutate(PFAD, cmdAddEintrag({ id: 'n', seiten: [{ text: 't' }] }));
    project.bus.undo();
    project.bus.redo();
    expect(gesehen).toEqual([PFAD, PFAD, PFAD]);
  });
});
