/**
 * Ergebnisbildschirm nach dem Sieg (N7) — **Darstellung, nicht Rechnung**.
 *
 * 🔵 Abgrenzung: Die Verbuchung liegt bereits in
 * `@webmidgar/battle-runtime` (`applyExperience`, `expTotalForLevel`,
 * deterministischer Beutewurf, S33). Dieses Modul rechnet NICHTS aus; es
 * bekommt das Ergebnis als Daten und ordnet es in der am Original
 * vermessenen Fensterfolge an. Wer hier eine Formel findet, hat einen Fehler
 * gefunden.
 *
 * 🟢 Der Ablauf des Originals ist an den Referenzbildern ablesbar: zuerst
 * die Meldung „Gained EXP and AP." mit den Summen, dann je Gruppenmitglied
 * eine Zeile mit Porträt, Name, EXP-Stand, Level und Rest bis zum nächsten
 * Level; ein Stufenaufstieg legt ein gelbes „LEVEL UP"-Schild über die
 * Levelzeile (`…223349_1.jpg`).
 *
 * 🟡 Die Folgeseiten („Received N gil.", erbeutete Gegenstände) sind in den
 * Referenzbildern NICHT enthalten. Sie sind hier als weitere Seiten desselben
 * Meldungsfensters umgesetzt, weil der Sieg sonst Gil und Beute überhaupt
 * nicht zeigt — die Formulierung ist übernommen aus dem, was das Spiel im
 * ersten Bild sprachlich vorgibt, die Seitenfolge selbst ist Annahme.
 */

import {
  HUD_FRAME,
  HUD_TYPE,
  RESULT_COLORS,
  RESULT_LAYOUT,
  RESULT_MEMBER_COLUMNS,
  gaugeGradient,
  resultMemberRect,
  rgbCss,
  type Rect,
} from './layout.js';
import type { HudBox } from './model.js';

export interface ResultMemberView {
  name: string;
  level: number;
  /** Gesamt-EXP nach der Verbuchung. */
  exp: number;
  /** Fehlende EXP bis zum nächsten Level (0, wenn Level 99). */
  toNextLevel: number;
  /** Fortschritt im laufenden Level, 0…1 — vom Aufrufer berechnet. */
  levelProgress: number;
  levelsGained: number;
  /** Bildquelle des Porträts (data:/blob:). Fehlt sie, bleibt die Kachel leer. */
  portrait?: string | null;
}

export interface ResultScreenModel {
  /** Seiten des Meldungsfensters; `page` zeigt die aktuelle. */
  messages: string[];
  page: number;
  gainedExp: number;
  gainedAp: number;
  members: ResultMemberView[];
}

/**
 * Baut die Standardseitenfolge. Gil und Beute stehen bewusst als eigene
 * Seiten — so bleibt sichtbar, dass sie vergeben wurden, auch wenn die
 * Savemap-Verbuchung noch nicht angeschlossen ist.
 */
export function resultMessages(gil: number, drops: readonly string[]): string[] {
  const pages = ['Gained EXP and AP.'];
  if (gil > 0) pages.push(`Received ${gil} gil.`);
  for (const d of drops) pages.push(`Received "${d}".`);
  return pages;
}

function text(
  id: string,
  rect: Rect,
  content: string,
  align: 'left' | 'right' | 'center',
  fontSize: number,
  color?: string,
): HudBox {
  const box: HudBox = { id, kind: 'value', rect, text: content, align, fontSize };
  if (color !== undefined) box.color = color;
  return box;
}

/**
 * Kastenliste des Ergebnisbildschirms in Koordinaten der 640×480-Fläche.
 * Reine Funktion wie `hudBoxes`.
 */
export function resultBoxes(model: ResultScreenModel): HudBox[] {
  const boxes: HudBox[] = [];

  // 1) Meldungsfenster.
  boxes.push({ id: 'result.message.window', kind: 'window', rect: RESULT_LAYOUT.message });
  boxes.push(
    text(
      'result.message.text',
      {
        x: RESULT_LAYOUT.message.x + RESULT_LAYOUT.messageText.x,
        y: RESULT_LAYOUT.message.y + RESULT_LAYOUT.messageText.dy - 4,
        w: RESULT_LAYOUT.message.w - RESULT_LAYOUT.messageText.x - HUD_FRAME,
        h: 24,
      },
      model.messages[model.page] ?? '',
      'left',
      HUD_TYPE.valueSize,
    ),
  );

  // 2) EXP- und AP-Fenster.
  boxes.push({ id: 'result.exp.window', kind: 'window', rect: RESULT_LAYOUT.exp });
  boxes.push({ id: 'result.ap.window', kind: 'window', rect: RESULT_LAYOUT.ap });
  const bandDy = 14;
  boxes.push(
    text(
      'result.exp.label',
      { x: RESULT_LAYOUT.exp.x + RESULT_LAYOUT.expLabel, y: RESULT_LAYOUT.exp.y + bandDy, w: 120, h: 24 },
      'EXP',
      'left',
      HUD_TYPE.valueSize,
    ),
  );
  boxes.push(
    text(
      'result.exp.value',
      { x: RESULT_LAYOUT.exp.x + HUD_FRAME, y: RESULT_LAYOUT.exp.y + bandDy, w: RESULT_LAYOUT.expValueRight - HUD_FRAME, h: 24 },
      `${model.gainedExp}p`,
      'right',
      HUD_TYPE.valueSize,
    ),
  );
  boxes.push(
    text(
      'result.ap.label',
      { x: RESULT_LAYOUT.ap.x + RESULT_LAYOUT.apLabel, y: RESULT_LAYOUT.ap.y + bandDy, w: 120, h: 24 },
      'AP',
      'left',
      HUD_TYPE.valueSize,
    ),
  );
  boxes.push(
    text(
      'result.ap.value',
      { x: RESULT_LAYOUT.ap.x + HUD_FRAME, y: RESULT_LAYOUT.ap.y + bandDy, w: RESULT_LAYOUT.apValueRight - HUD_FRAME, h: 24 },
      `${model.gainedAp}p`,
      'right',
      HUD_TYPE.valueSize,
    ),
  );

  // 3) Drei Figurenfenster — auch leere, denn das Original zeigt sie immer.
  for (let i = 0; i < RESULT_LAYOUT.memberCount; i++) {
    const r = resultMemberRect(i);
    boxes.push({ id: `result.member${i}.window`, kind: 'window', rect: r });
    const m = model.members[i];
    if (!m) continue;

    const p = RESULT_MEMBER_COLUMNS.portrait;
    const portraitBox: HudBox = {
      id: `result.member${i}.portrait`,
      kind: 'portrait',
      rect: { x: p.x, y: r.y + p.dy, w: p.w, h: p.h },
    };
    if (m.portrait) portraitBox.background = `url(${m.portrait}) center/cover no-repeat`;
    boxes.push(portraitBox);

    boxes.push(
      text(
        `result.member${i}.name`,
        { x: RESULT_MEMBER_COLUMNS.name, y: r.y + RESULT_MEMBER_COLUMNS.nameDy, w: 200, h: 24 },
        m.name,
        'left',
        HUD_TYPE.valueSize,
      ),
    );
    boxes.push(
      text(
        `result.member${i}.expLabel`,
        { x: RESULT_MEMBER_COLUMNS.expLabel, y: r.y + RESULT_MEMBER_COLUMNS.nameDy, w: 120, h: 24 },
        'EXP:',
        'left',
        HUD_TYPE.valueSize,
      ),
    );
    boxes.push(
      text(
        `result.member${i}.exp`,
        { x: HUD_FRAME, y: r.y + RESULT_MEMBER_COLUMNS.nameDy, w: RESULT_MEMBER_COLUMNS.expValueRight - HUD_FRAME, h: 24 },
        `${m.exp}p`,
        'right',
        HUD_TYPE.valueSize,
      ),
    );

    const b = RESULT_MEMBER_COLUMNS.expBar;
    boxes.push({
      id: `result.member${i}.expBar.frame`,
      kind: 'barFrame',
      rect: { x: b.x, y: r.y + b.dy, w: b.w, h: b.h },
      background: 'rgb(224,224,224)',
    });
    const innerW = Math.round((b.w - 8) * Math.max(0, Math.min(1, m.levelProgress)));
    if (innerW > 0) {
      boxes.push({
        id: `result.member${i}.expBar.fill`,
        kind: 'barFill',
        rect: { x: b.x + 4, y: r.y + b.dy + 3, w: innerW, h: b.h - 6 },
        background: gaugeGradient(RESULT_COLORS.expBar),
      });
    }

    boxes.push(
      text(
        `result.member${i}.levelLabel`,
        { x: RESULT_MEMBER_COLUMNS.levelLabel, y: r.y + RESULT_MEMBER_COLUMNS.levelDy, w: 120, h: 24 },
        'Level:',
        'left',
        HUD_TYPE.valueSize,
      ),
    );
    boxes.push(
      text(
        `result.member${i}.level`,
        { x: HUD_FRAME, y: r.y + RESULT_MEMBER_COLUMNS.levelDy, w: RESULT_MEMBER_COLUMNS.levelValueRight - HUD_FRAME, h: 24 },
        String(m.level),
        'right',
        HUD_TYPE.valueSize,
      ),
    );
    boxes.push(
      text(
        `result.member${i}.nextLabel`,
        { x: RESULT_MEMBER_COLUMNS.nextLabel, y: r.y + RESULT_MEMBER_COLUMNS.levelDy, w: 200, h: 24 },
        'next level:',
        'left',
        HUD_TYPE.valueSize,
      ),
    );
    boxes.push(
      text(
        `result.member${i}.next`,
        { x: HUD_FRAME, y: r.y + RESULT_MEMBER_COLUMNS.levelDy, w: RESULT_MEMBER_COLUMNS.nextValueRight - HUD_FRAME, h: 24 },
        `${m.toNextLevel}p`,
        'right',
        HUD_TYPE.valueSize,
      ),
    );

    if (m.levelsGained > 0) {
      const badge = RESULT_MEMBER_COLUMNS.levelUpBadge;
      boxes.push({
        id: `result.member${i}.levelUp`,
        kind: 'badge',
        rect: { x: badge.x, y: r.y + badge.dy, w: badge.w, h: badge.h },
        text: 'LEVEL UP',
        align: 'center',
        fontSize: HUD_TYPE.valueSize,
        color: rgbCss(RESULT_COLORS.levelUpText),
      });
    }
  }
  return boxes;
}
