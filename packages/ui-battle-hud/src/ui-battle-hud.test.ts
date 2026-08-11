import { describe, expect, it } from 'vitest';
import { FF7_WINDOW_SKIN } from '@webmidgar/ui-window';
import {
  BATTLE_SURFACE,
  HUD_BAR,
  HUD_BAR_COLORS,
  HUD_COMMAND_WINDOW,
  HUD_FRAME,
  HUD_GAUGE_COLUMNS,
  HUD_GAUGE_WINDOW,
  HUD_HEADER_HEIGHT,
  HUD_ROW_COUNT,
  HUD_ROW_HEIGHT,
  HUD_STATUS_COLUMNS,
  HUD_STATUS_WINDOW,
  RESULT_LAYOUT,
  RESULT_MEMBER_COLUMNS,
  gaugeGradient,
  hudRowTop,
  resultMemberRect,
} from './layout.js';
import {
  ATB_MAX,
  DEFAULT_COMMANDS,
  atbColor,
  hudBoxes,
  type HudBox,
  type HudModel,
} from './model.js';
import { resultBoxes, resultMessages, type ResultScreenModel } from './results.js';
import { paintBoxes, type PaintElement, type PaintHost } from './paint.js';

/**
 * **Der Golden-Test des Kampf-HUD.**
 *
 * Die Referenztabelle unten ist keine Kopie der Konstanten, sondern die
 * Liste der an den Originalaufnahmen ABGELESENEN absoluten Pixelkanten
 * (`apps/demo/.shots/ref/20260810223335_1.jpg` und `…223327_1.jpg`,
 * beide 640×480 unskaliert). Getestet wird, dass die aus dem Modell
 * BERECHNETEN Kästen genau dort landen. Damit fällt jede Änderung an der
 * Ableitungskette (Kopfhöhe, Zeilenhöhe, Spaltenversätze) sofort auf.
 *
 * **Was der Test belegt und was nicht.** Die Balkenoberkante y=351 der
 * ersten Zeile ist ein unabhängig abgelesener Wert, der in die Herleitung
 * nicht eingegangen ist — er prüft die **Kopfhöhe 13** (Kontrolle: 12 ergäbe
 * 350, 14 ergäbe 352). Über die **Zeilenhöhe 29** sagt er nichts, denn Zeile
 * 0 liegt vor der ersten Vervielfachung; sie ist 🟡 hergeleitet und wird
 * unten nur auf innere Widerspruchsfreiheit geprüft (drei Zeilen füllen den
 * Innenraum restlos).
 */
const GEMESSEN = {
  statusFenster: { links: 1, oben: 333, rechts: 270, unten: 442 },
  gaugeFenster: { links: 275, oben: 333, rechts: 637, unten: 442 },
  kommandoFenster: { links: 145, oben: 341, rechts: 261, unten: 450 },
  /** Balkenrahmen der ERSTEN Gruppenzeile, unabhängig abgelesen. */
  barriereBalken: { links: 190, oben: 351, rechts: 263, unten: 366 },
  limitBalken: { links: 476, oben: 351, rechts: 549, unten: 366 },
  timeBalken: { links: 554, oben: 351, rechts: 627, unten: 366 },
  /** Beschriftungen (linke Tintenkante). */
  labelName: 28,
  labelHp: 288,
  labelMp: 420,
  /** Rechte Kante der rechtsbündigen Zahlen. */
  hpWertRechts: 342,
  hpMaxRechts: 406,
  mpWertRechts: 471,
} as const;

function box(boxes: HudBox[], id: string): HudBox {
  const b = boxes.find((x) => x.id === id);
  if (!b) throw new Error(`Kasten "${id}" fehlt — vorhanden: ${boxes.map((x) => x.id).join(', ')}`);
  return b;
}

function kanten(b: HudBox): { links: number; oben: number; rechts: number; unten: number } {
  return {
    links: b.rect.x,
    oben: b.rect.y,
    rechts: b.rect.x + b.rect.w - 1,
    unten: b.rect.y + b.rect.h - 1,
  };
}

const modell: HudModel = {
  members: [
    { id: 'cloud', name: 'Cloud', hp: 287, maxHp: 302, mp: 54, maxMp: 54, atb: 20000, alive: true },
    { id: 'barret', name: 'Barret', hp: 400, maxHp: 400, mp: 20, maxMp: 20, atb: ATB_MAX, alive: true, awaiting: true },
    { id: 'tifa', name: 'Tifa', hp: 0, maxHp: 250, mp: 30, maxMp: 30, atb: 0, alive: false },
  ],
  message: 'Machine Gun',
  command: null,
  floaters: [],
};

describe('Kampf-HUD — Fensterkanten auf den Pixel', () => {
  it('setzt die drei HUD-Fenster genau auf die vermessenen Kanten (F40)', () => {
    const boxes = hudBoxes({ ...modell, command: { entries: DEFAULT_COMMANDS, selected: 0, row: 0 } });
    expect(kanten(box(boxes, 'status.window'))).toEqual(GEMESSEN.statusFenster);
    expect(kanten(box(boxes, 'gauge.window'))).toEqual(GEMESSEN.gaugeFenster);
    expect(kanten(box(boxes, 'command.window'))).toEqual(GEMESSEN.kommandoFenster);
  });

  it('trifft die Balkenkanten der ersten Zeile, die NICHT in die Herleitung eingingen', () => {
    const boxes = hudBoxes(modell);
    expect(kanten(box(boxes, 'row0.barrier.frame'))).toEqual(GEMESSEN.barriereBalken);
    expect(kanten(box(boxes, 'row0.limit.frame'))).toEqual(GEMESSEN.limitBalken);
    expect(kanten(box(boxes, 'row0.time.frame'))).toEqual(GEMESSEN.timeBalken);
  });

  it('leitet die Zeilenhöhe so ab, dass drei Zeilen den Innenraum genau füllen', () => {
    const innen = HUD_STATUS_WINDOW.h - 2 * HUD_FRAME;
    expect(innen).toBe(100);
    expect(HUD_HEADER_HEIGHT + HUD_ROW_COUNT * HUD_ROW_HEIGHT).toBe(innen);
    // Die letzte Zeile endet genau an der Innenkante — keine Zeile ragt hinaus.
    const unten = hudRowTop(HUD_ROW_COUNT - 1) + HUD_ROW_HEIGHT;
    expect(unten).toBe(HUD_STATUS_WINDOW.y + HUD_STATUS_WINDOW.h - HUD_FRAME);
    // Kontrollniveau der Zeilenhöhe: 29 ist die EINZIGE ganze Zahl, die den
    // Zeilenraum restlos füllt. 28 ließe 3 px übrig, 30 überliefe um 3 px.
    const raum = innen - HUD_HEADER_HEIGHT;
    expect(raum % HUD_ROW_COUNT).toBe(0);
    expect(28 * HUD_ROW_COUNT).toBeLessThan(raum);
    expect(30 * HUD_ROW_COUNT).toBeGreaterThan(raum);
  });

  it('belegt die Kopfhöhe über die unabhängig abgelesene Balkenkante y=351', () => {
    // Zeile 0 hängt an Rahmen + Kopfhöhe, NICHT an der Zeilenhöhe.
    expect(hudRowTop(0)).toBe(GEMESSEN.timeBalken.oben);
    // Kontrolle: eine um 1 px andere Kopfhöhe verfehlt die Kante.
    const mitKopf = (h: number): number => HUD_STATUS_WINDOW.y + HUD_FRAME + h;
    expect(mitKopf(HUD_HEADER_HEIGHT - 1)).not.toBe(GEMESSEN.timeBalken.oben);
    expect(mitKopf(HUD_HEADER_HEIGHT + 1)).not.toBe(GEMESSEN.timeBalken.oben);
  });

  it('setzt Beschriftungen und rechtsbündige Zahlen auf die abgelesenen Spalten', () => {
    const boxes = hudBoxes(modell);
    expect(box(boxes, 'status.header.name').rect.x).toBe(GEMESSEN.labelName);
    expect(box(boxes, 'gauge.header.hp').rect.x).toBe(GEMESSEN.labelHp);
    expect(box(boxes, 'gauge.header.mp').rect.x).toBe(GEMESSEN.labelMp);
    const rechts = (id: string): number => {
      const b = box(boxes, id);
      return b.rect.x + b.rect.w;
    };
    expect(rechts('row0.hp')).toBe(GEMESSEN.hpWertRechts);
    expect(rechts('row0.hpMax')).toBe(GEMESSEN.hpMaxRechts);
    expect(rechts('row0.mp')).toBe(GEMESSEN.mpWertRechts);
  });

  it('hält jeden Kasten innerhalb seines Fensters', () => {
    const boxes = hudBoxes(modell);
    const innerhalb = (b: HudBox, w: { x: number; y: number; w: number; h: number }): boolean =>
      b.rect.x >= w.x + HUD_FRAME &&
      b.rect.y >= w.y + HUD_FRAME &&
      b.rect.x + b.rect.w <= w.x + w.w - HUD_FRAME &&
      b.rect.y + b.rect.h <= w.y + w.h - HUD_FRAME;
    for (const b of boxes) {
      if (b.id.startsWith('status.') && b.kind !== 'window') expect(innerhalb(b, HUD_STATUS_WINDOW)).toBe(true);
      if (b.id.startsWith('gauge.') && b.kind !== 'window') expect(innerhalb(b, HUD_GAUGE_WINDOW)).toBe(true);
      if (/^row\d\.(barrier|name)/.test(b.id)) expect(innerhalb(b, HUD_STATUS_WINDOW)).toBe(true);
      if (/^row\d\.(hp|mp|limit|time)/.test(b.id)) expect(innerhalb(b, HUD_GAUGE_WINDOW)).toBe(true);
    }
  });

  it('bleibt in der Renderfläche 640×480 und lässt die Spielfläche 640×448 unangetastet', () => {
    expect(BATTLE_SURFACE.width).toBe(640);
    expect(BATTLE_SURFACE.playHeight).toBe(448);
    // Die HUD-Fenster liegen vollständig in der Spielfläche …
    for (const w of [HUD_STATUS_WINDOW, HUD_GAUGE_WINDOW]) {
      expect(w.y + w.h).toBeLessThanOrEqual(BATTLE_SURFACE.playHeight);
    }
    // … das Kommandofenster ragt bewusst darunter (gemessen: Unterkante 450).
    expect(HUD_COMMAND_WINDOW.y + HUD_COMMAND_WINDOW.h).toBeGreaterThan(BATTLE_SURFACE.playHeight);
    expect(HUD_COMMAND_WINDOW.y + HUD_COMMAND_WINDOW.h).toBeLessThanOrEqual(BATTLE_SURFACE.height);
  });
});

describe('Kampf-HUD — Balken', () => {
  it('hat für alle drei Balken dasselbe Maß 74×16 mit 64×10 Innenfläche', () => {
    expect(HUD_BAR.width).toBe(74);
    expect(HUD_BAR.height).toBe(16);
    expect(HUD_BAR.innerWidth).toBe(64);
    expect(HUD_BAR.innerHeight).toBe(10);
  });

  it('färbt den Zeitbalken grün, solange er läuft — und sandgelb, wenn er voll ist', () => {
    expect(atbColor(0)).toEqual(HUD_BAR_COLORS.atbFilling);
    expect(atbColor(ATB_MAX - 1)).toEqual(HUD_BAR_COLORS.atbFilling);
    expect(atbColor(ATB_MAX)).toEqual(HUD_BAR_COLORS.atbFull);
    // Kontrolle: der Umschlag hängt am Füllstand, nicht am Zufall.
    expect(atbColor(ATB_MAX / 2)).not.toEqual(atbColor(ATB_MAX));
  });

  it('skaliert die Füllbreite ganzzahlig auf die 64 px Innenfläche', () => {
    const halb = hudBoxes({
      ...modell,
      members: [{ ...modell.members[0]!, atb: ATB_MAX / 2 }],
    });
    expect(box(halb, 'row0.time.fill').rect.w).toBe(32);
    const voll = hudBoxes({ ...modell, members: [{ ...modell.members[0]!, atb: ATB_MAX }] });
    expect(box(voll, 'row0.time.fill').rect.w).toBe(64);
    const leer = hudBoxes({ ...modell, members: [{ ...modell.members[0]!, atb: 0 }] });
    expect(leer.find((b) => b.id === 'row0.time.fill')).toBeUndefined();
  });

  it('zeigt für einen gefallenen Kämpfer keinen Zeitbalken', () => {
    const boxes = hudBoxes(modell);
    expect(boxes.find((b) => b.id === 'row2.time.fill')).toBeUndefined();
    expect(box(boxes, 'row2.name').opacity).toBeLessThan(1);
  });

  it('baut den Verlauf aus der Kennfarbe (Glanzlinie heller, Oberkante dunkler)', () => {
    const g = gaugeGradient(HUD_BAR_COLORS.atbFull);
    expect(g).toContain('rgb(227,181,129) 35%');
    expect(g).toContain('180deg');
    // Die Glanzlinie muss heller sein als die Kennfarbe.
    const stellen = [...g.matchAll(/rgb\((\d+),(\d+),(\d+)\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...stellen)).toBeGreaterThan(227);
    expect(Math.min(...stellen)).toBeLessThan(227);
  });
});

describe('Kampf-HUD — Kommandofenster und Trefferzahlen', () => {
  it('hängt das Kommandofenster an die Zeile des am Zug befindlichen Kämpfers', () => {
    const zeile0 = hudBoxes({ ...modell, command: { entries: DEFAULT_COMMANDS, selected: 0, row: 0 } });
    const zeile1 = hudBoxes({ ...modell, command: { entries: DEFAULT_COMMANDS, selected: 0, row: 1 } });
    expect(box(zeile1, 'command.window').rect.y - box(zeile0, 'command.window').rect.y).toBe(HUD_ROW_HEIGHT);
  });

  it('setzt den Zeiger genau vor den gewählten Eintrag', () => {
    const boxes = hudBoxes({ ...modell, command: { entries: DEFAULT_COMMANDS, selected: 2, row: 0 } });
    expect(box(boxes, 'command.cursor').rect.y).toBe(box(boxes, 'command.entry2').rect.y);
    expect(box(boxes, 'command.cursor').rect.x).toBeLessThan(box(boxes, 'command.entry2').rect.x);
  });

  it('lässt Trefferzahlen aufsteigen und verblassen (K7)', () => {
    const frisch = hudBoxes({
      ...modell,
      floaters: [{ actorId: 'enemy-0', text: '412', kind: 'damage', progress: 0, anchor: { x: 400, y: 200 } }],
    });
    const alt = hudBoxes({
      ...modell,
      floaters: [{ actorId: 'enemy-0', text: '412', kind: 'damage', progress: 1, anchor: { x: 400, y: 200 } }],
    });
    expect(box(alt, 'floater0').rect.y).toBeLessThan(box(frisch, 'floater0').rect.y);
    expect(box(alt, 'floater0').opacity).toBe(0);
    expect(box(frisch, 'floater0').opacity).toBe(1);
    expect(box(frisch, 'floater0').text).toBe('412');
  });

  it('macht eine nicht gemessene Glyphenmetrik SICHTBAR statt sie zu verschweigen', () => {
    const still = hudBoxes(modell);
    expect(still.find((b) => b.id === 'diagnostic.metrics')).toBeUndefined();
    const laut = hudBoxes({ ...modell, metricsMeasured: false });
    expect(box(laut, 'diagnostic.metrics').text).toContain('Ersatzwerte');
  });

  it('meldet die Effektabdeckung, statt 0 % zu verstecken', () => {
    const boxes = hudBoxes({ ...modell, effectCoverage: { covered: 0, substituted: 7 } });
    expect(box(boxes, 'diagnostic.effects').text).toBe('Effekte belegt 0/7');
  });
});

describe('Ergebnisbildschirm (N7)', () => {
  const ergebnis: ResultScreenModel = {
    messages: resultMessages(160, ['Potion']),
    page: 0,
    gainedExp: 32,
    gainedAp: 4,
    members: [
      { name: 'Cloud', level: 6, exp: 610, toNextLevel: 6, levelProgress: 0.9, levelsGained: 0 },
      { name: 'Barret', level: 7, exp: 700, toNextLevel: 307, levelProgress: 0.2, levelsGained: 1 },
    ],
  };

  it('teilt die volle Menüfläche 640×480 lückenlos in fünf Bänder', () => {
    const bänder = [
      RESULT_LAYOUT.message,
      { y: RESULT_LAYOUT.exp.y, h: RESULT_LAYOUT.exp.h },
      ...[0, 1, 2].map((i) => resultMemberRect(i)),
    ];
    let cursor = 0;
    for (const b of bänder) {
      expect(b.y).toBe(cursor);
      cursor += b.h;
    }
    expect(cursor).toBe(RESULT_LAYOUT.surface.height);
  });

  it('trifft die abgelesenen Bandkanten (0/68/120/240/360/480)', () => {
    expect(RESULT_LAYOUT.message.h).toBe(68);
    expect(RESULT_LAYOUT.exp.y).toBe(68);
    expect(RESULT_LAYOUT.exp.h).toBe(52);
    expect(resultMemberRect(0).y).toBe(120);
    expect(resultMemberRect(1).y).toBe(240);
    expect(resultMemberRect(2).y).toBe(360);
    expect(resultMemberRect(2).y + resultMemberRect(2).h).toBe(480);
  });

  it('zeigt immer drei Figurenfenster, auch wenn die Gruppe kleiner ist', () => {
    const boxes = resultBoxes(ergebnis);
    for (let i = 0; i < 3; i++) expect(box(boxes, `result.member${i}.window`).kind).toBe('window');
    expect(boxes.find((b) => b.id === 'result.member2.name')).toBeUndefined();
  });

  it('legt das LEVEL-UP-Schild nur bei echtem Aufstieg über die Levelzeile', () => {
    const boxes = resultBoxes(ergebnis);
    expect(boxes.find((b) => b.id === 'result.member0.levelUp')).toBeUndefined();
    const schild = box(boxes, 'result.member1.levelUp');
    const levelZeile = box(boxes, 'result.member1.levelLabel');
    expect(schild.rect.y).toBeLessThanOrEqual(levelZeile.rect.y);
    expect(schild.rect.y + schild.rect.h).toBeGreaterThan(levelZeile.rect.y);
    expect(schild.rect.x).toBe(RESULT_MEMBER_COLUMNS.levelUpBadge.x);
  });

  it('blättert Gil und Beute als eigene Seiten des Meldungsfensters', () => {
    expect(ergebnis.messages).toEqual(['Gained EXP and AP.', 'Received 160 gil.', 'Received "Potion".']);
    const seite2 = resultBoxes({ ...ergebnis, page: 1 });
    expect(box(seite2, 'result.message.text').text).toBe('Received 160 gil.');
    // Ohne Gil und ohne Beute bleibt genau eine Seite.
    expect(resultMessages(0, [])).toHaveLength(1);
  });

  it('rechnet NICHT — die gezeigten Zahlen sind exakt die übergebenen', () => {
    const boxes = resultBoxes(ergebnis);
    expect(box(boxes, 'result.exp.value').text).toBe('32p');
    expect(box(boxes, 'result.ap.value').text).toBe('4p');
    expect(box(boxes, 'result.member0.exp').text).toBe('610p');
    expect(box(boxes, 'result.member0.next').text).toBe('6p');
    expect(box(boxes, 'result.member1.level').text).toBe('7');
  });
});

describe('Maler', () => {
  function stubHost(): PaintHost & { elemente: Map<string, Record<string, string>> } {
    const elemente = new Map<string, Record<string, string>>();
    const existing = new Map<string, PaintElement>();
    return {
      elemente,
      existing,
      create(id: string): PaintElement {
        const props: Record<string, string> = {};
        elemente.set(id, props);
        const el: PaintElement = {
          style: {
            setProperty(name: string, value: string): void {
              props[name] = value;
            },
          },
          textContent: null,
          remove(): void {
            elemente.delete(id);
          },
        };
        return el;
      },
    };
  }

  it('holt die Fensteroptik aus der gemeinsamen Schale und schreibt keine eigene Farbe', () => {
    const host = stubHost();
    paintBoxes(host, hudBoxes(modell));
    const fenster = host.elemente.get('status.window')!;
    // Genau die Werte der Schale — nicht ein zweites Mal hingeschrieben.
    expect(fenster['border']).toBe(`${FF7_WINDOW_SKIN.border[1]!.width}px solid ${FF7_WINDOW_SKIN.border[1]!.color}`);
    expect(fenster['outline']).toBe(`${FF7_WINDOW_SKIN.border[0]!.width}px solid ${FF7_WINDOW_SKIN.border[0]!.color}`);
    expect(fenster['left']).toBe('1px');
    expect(fenster['top']).toBe('333px');
    expect(fenster['width']).toBe('270px');
    expect(fenster['height']).toBe('110px');
  });

  it('entfernt Kästen, die im neuen Modell fehlen', () => {
    const host = stubHost();
    paintBoxes(host, hudBoxes({ ...modell, command: { entries: DEFAULT_COMMANDS, selected: 0, row: 0 } }));
    expect(host.elemente.has('command.window')).toBe(true);
    paintBoxes(host, hudBoxes(modell));
    expect(host.elemente.has('command.window')).toBe(false);
    expect(host.elemente.has('status.window')).toBe(true);
  });
});
