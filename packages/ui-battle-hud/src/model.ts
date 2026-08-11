/**
 * Ansichtsmodell des Kampf-HUD — **reine Daten, keine DOM-Berührung**.
 *
 * 🔵 Entwurfsgrund: Ein HUD, das direkt aus einer Sitzung heraus zeichnet,
 * lässt sich nur mit einem Browser prüfen. Hier entsteht stattdessen eine
 * Liste absolut platzierter Kästen (`HudBox[]`) in Koordinaten der
 * 640×480-Renderfläche. Der Golden-Test misst diese Liste gegen die am
 * Original abgelesenen Pixelkanten; der Maler (`paint.ts`) macht daraus nur
 * noch `div`-Elemente. Dieselbe Trennung wie bei `@webmidgar/ui-window`:
 * alles Entscheidbare ist entschieden, bevor DOM ins Spiel kommt.
 */

import {
  HUD_BAR,
  HUD_BAR_COLORS,
  HUD_COMMAND_WINDOW,
  HUD_FRAME,
  HUD_GAUGE_COLUMNS,
  HUD_GAUGE_WINDOW,
  HUD_HEADER_HEIGHT,
  HUD_MESSAGE_WINDOW,
  HUD_ROW_COUNT,
  HUD_ROW_HEIGHT,
  HUD_STATUS_COLUMNS,
  HUD_STATUS_WINDOW,
  HUD_TYPE,
  gaugeGradient,
  hudRowTop,
  rgbCss,
  type Rect,
  type Rgb,
} from './layout.js';

export const ATB_MAX = 65536;

/** Eine Gruppenzeile, wie das HUD sie anzeigt. */
export interface HudMemberView {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** ATB-Stand 0…65536 (der ganzzahlige Akkumulator der BattleSession). */
  atb: number;
  /** Limitbalken 0…255. 🟡 Die Limitmechanik ist nicht umgesetzt; 0 ist ehrlich. */
  limit?: number;
  /** BARRIER/MBARRIER-Stand 0…255. 🟡 wie oben. */
  barrier?: number;
  alive: boolean;
  /** Wartet auf ein Kommando (Zeiger + volle Zeitanzeige). */
  awaiting?: boolean;
}

export interface HudCommandView {
  entries: string[];
  selected: number;
  /** Zeile im HUD, an der das Kommandofenster hängt (0-basiert). */
  row: number;
}

/** Aufsteigende Trefferzahl aus dem `BattleViewModel` (K7). */
export interface HudFloater {
  actorId: string;
  text: string;
  kind: 'damage' | 'heal' | 'miss';
  /** 0 = frisch, 1 = verblasst. */
  progress: number;
  /** Ankerpunkt in Flächenkoordinaten; fehlt er, wählt `hudBoxes` einen Ersatz. */
  anchor?: { x: number; y: number };
}

export interface HudModel {
  members: HudMemberView[];
  /** Meldungsfenster über der Bühne (Aktionsname). Leer = Fenster aus. */
  message: string;
  command: HudCommandView | null;
  floaters: HudFloater[];
  /**
   * Diagnose, die SICHTBAR bleiben muss: `false` heißt, dass die
   * Glyphenmetrik nicht aus WINDOW.BIN kam. Welle 1 hat still auf Ersatzwerte
   * zurückgefallen — das soll nicht wieder passieren.
   */
  metricsMeasured?: boolean;
  /** Effektabdeckung aus dem BattleViewModel (belegt/ersetzt). */
  effectCoverage?: { covered: number; substituted: number };
}

export type HudBoxKind =
  | 'window'
  | 'label'
  | 'value'
  | 'name'
  | 'barFrame'
  | 'barFill'
  | 'cursor'
  | 'floater'
  | 'badge'
  | 'portrait'
  | 'diagnostic';

export interface HudBox {
  id: string;
  kind: HudBoxKind;
  rect: Rect;
  text?: string;
  align?: 'left' | 'right' | 'center';
  fontSize?: number;
  color?: string;
  /** Für `barFill`: der Verlauf; für `badge`: die Füllfarbe. */
  background?: string;
  opacity?: number;
}

/** 🟡 Vier Kommandozeilen — so viele zeigt das Original im Grundzustand. */
export const DEFAULT_COMMANDS = ['Angriff', 'Magie', 'Gegenstand', 'Flucht'];

function bar(
  x: number,
  y: number,
  fill: number,
  base: Rgb,
  id: string,
  boxes: HudBox[],
): void {
  boxes.push({
    id: `${id}.frame`,
    kind: 'barFrame',
    rect: { x, y, w: HUD_BAR.width, h: HUD_BAR.height },
    background: rgbCss(HUD_BAR_COLORS.empty),
  });
  const clamped = Math.max(0, Math.min(1, fill));
  const inner = Math.round(HUD_BAR.innerWidth * clamped);
  if (inner <= 0) return;
  boxes.push({
    id: `${id}.fill`,
    kind: 'barFill',
    rect: {
      x: x + HUD_BAR.frameX,
      y: y + HUD_BAR.frameY,
      w: inner,
      h: HUD_BAR.innerHeight,
    },
    // Das gemessene senkrechte Profil (Kennfarbe + Glanzlinie), nicht ein
    // Flächenton — siehe `gaugeGradient` in layout.ts.
    background: gaugeGradient(base),
  });
}

/**
 * 🟢 Die gemessene Farbregel des Zeitbalkens: grün, solange er läuft;
 * sandgelb, sobald er voll ist. Belegt durch den direkten Vergleich zweier
 * Aufnahmen desselben Kampfes (`…223335` grün/teilgefüllt gegen `…223327`
 * sandgelb/voll bei offenem Kommandofenster).
 */
export function atbColor(atb: number, awaiting = false): Rgb {
  return atb >= ATB_MAX || awaiting ? HUD_BAR_COLORS.atbFull : HUD_BAR_COLORS.atbFilling;
}

/**
 * Erzeugt die vollständige Kastenliste des Kampf-HUD in Flächenkoordinaten.
 * Reine Funktion — gleiches Modell ⇒ gleiche Liste.
 */
export function hudBoxes(model: HudModel): HudBox[] {
  const boxes: HudBox[] = [];

  if (model.message) {
    boxes.push({ id: 'message.window', kind: 'window', rect: HUD_MESSAGE_WINDOW });
    boxes.push({
      id: 'message.text',
      kind: 'value',
      rect: {
        x: HUD_MESSAGE_WINDOW.x + HUD_FRAME,
        y: HUD_MESSAGE_WINDOW.y + HUD_FRAME,
        w: HUD_MESSAGE_WINDOW.w - 2 * HUD_FRAME,
        h: HUD_MESSAGE_WINDOW.h - 2 * HUD_FRAME,
      },
      text: model.message,
      align: 'center',
      fontSize: HUD_TYPE.valueSize,
    });
  }

  boxes.push({ id: 'status.window', kind: 'window', rect: HUD_STATUS_WINDOW });
  boxes.push({ id: 'gauge.window', kind: 'window', rect: HUD_GAUGE_WINDOW });

  // Kopfzeile beider Fenster.
  const headerY = HUD_STATUS_WINDOW.y + HUD_FRAME;
  const header = (id: string, win: Rect, offset: number, text: string): void => {
    const x = win.x + offset;
    // Die Beschriftung darf nie über die Innenkante ihres Fensters laufen —
    // sonst schnitte sie in die Bordüre. 90 px sind der Wunschwert.
    const w = Math.min(90, win.x + win.w - HUD_FRAME - x);
    boxes.push({
      id,
      kind: 'label',
      rect: { x, y: headerY, w, h: HUD_HEADER_HEIGHT },
      text,
      align: 'left',
      fontSize: HUD_TYPE.labelSize,
    });
  };
  header('status.header.name', HUD_STATUS_WINDOW, HUD_STATUS_COLUMNS.nameLabel, 'NAME');
  header('status.header.barrier', HUD_STATUS_WINDOW, HUD_STATUS_COLUMNS.barrierBar, 'BARRIER');
  header('gauge.header.hp', HUD_GAUGE_WINDOW, HUD_GAUGE_COLUMNS.hpLabel, 'HP');
  header('gauge.header.mp', HUD_GAUGE_WINDOW, HUD_GAUGE_COLUMNS.mpLabel, 'MP');
  header('gauge.header.limit', HUD_GAUGE_WINDOW, HUD_GAUGE_COLUMNS.limitBar, 'LIMIT');
  header('gauge.header.time', HUD_GAUGE_WINDOW, HUD_GAUGE_COLUMNS.timeBar, 'TIME');

  const rows = model.members.slice(0, HUD_ROW_COUNT);
  rows.forEach((m, i) => {
    const top = hudRowTop(i);
    const textRect = (x: number, w: number): Rect => ({ x, y: top, w, h: HUD_ROW_HEIGHT });

    boxes.push({
      id: `row${i}.name`,
      kind: 'name',
      rect: textRect(HUD_STATUS_WINDOW.x + HUD_STATUS_COLUMNS.name, 150),
      text: m.name,
      align: 'left',
      fontSize: HUD_TYPE.valueSize,
      opacity: m.alive ? 1 : 0.55,
    });

    bar(
      HUD_STATUS_WINDOW.x + HUD_STATUS_COLUMNS.barrierBar,
      top,
      (m.barrier ?? 0) / 255,
      HUD_BAR_COLORS.empty,
      `row${i}.barrier`,
      boxes,
    );

    const gx = HUD_GAUGE_WINDOW.x;
    /**
     * Rechtsbündige Zahlen: die gemessene Größe ist die RECHTE Kante. Der
     * Kasten beginnt an der Fensterinnenkante, damit er nicht unter die
     * Bordüre läuft — die rechte Kante bleibt dabei unverändert.
     */
    const rightAligned = (rightOffset: number): Rect => ({
      x: gx + HUD_FRAME,
      y: top,
      w: rightOffset - HUD_FRAME,
      h: HUD_ROW_HEIGHT,
    });
    boxes.push({
      id: `row${i}.hp`,
      kind: 'value',
      rect: rightAligned(HUD_GAUGE_COLUMNS.hpValueRight),
      text: String(m.hp),
      align: 'right',
      fontSize: HUD_TYPE.valueSize,
      opacity: m.alive ? 1 : 0.55,
    });
    boxes.push({
      id: `row${i}.hpSlash`,
      kind: 'value',
      rect: textRect(gx + HUD_GAUGE_COLUMNS.hpSlash, 16),
      text: '/',
      align: 'left',
      fontSize: HUD_TYPE.valueSize,
    });
    boxes.push({
      id: `row${i}.hpMax`,
      kind: 'value',
      rect: rightAligned(HUD_GAUGE_COLUMNS.hpMaxRight),
      text: String(m.maxHp),
      align: 'right',
      fontSize: HUD_TYPE.valueSize,
    });
    boxes.push({
      id: `row${i}.mp`,
      kind: 'value',
      rect: rightAligned(HUD_GAUGE_COLUMNS.mpValueRight),
      text: String(m.mp),
      align: 'right',
      fontSize: HUD_TYPE.valueSize,
    });

    bar(
      gx + HUD_GAUGE_COLUMNS.limitBar,
      top,
      (m.limit ?? 0) / 255,
      HUD_BAR_COLORS.limit,
      `row${i}.limit`,
      boxes,
    );
    bar(
      gx + HUD_GAUGE_COLUMNS.timeBar,
      top,
      m.alive ? m.atb / ATB_MAX : 0,
      atbColor(m.atb, m.awaiting),
      `row${i}.time`,
      boxes,
    );
  });

  if (model.command) {
    const cmd = model.command;
    const rect: Rect = {
      ...HUD_COMMAND_WINDOW,
      y: HUD_COMMAND_WINDOW.y + cmd.row * HUD_ROW_HEIGHT,
    };
    boxes.push({ id: 'command.window', kind: 'window', rect });
    cmd.entries.forEach((entry, i) => {
      const y = rect.y + HUD_FRAME + i * HUD_TYPE.commandLineHeight;
      boxes.push({
        id: `command.entry${i}`,
        kind: 'value',
        rect: { x: rect.x + HUD_FRAME + 18, y, w: rect.w - 2 * HUD_FRAME - 18, h: HUD_TYPE.commandLineHeight },
        text: entry,
        align: 'left',
        fontSize: HUD_TYPE.commandSize,
      });
      if (i === cmd.selected) {
        boxes.push({
          id: 'command.cursor',
          kind: 'cursor',
          rect: { x: rect.x + HUD_FRAME, y, w: 18, h: HUD_TYPE.commandLineHeight },
          text: '▶',
          align: 'left',
          fontSize: HUD_TYPE.commandSize,
        });
      }
    });
  }

  // K7 — Trefferzahlen und Ersatzdarstellung.
  model.floaters.forEach((f, i) => {
    const anchor = f.anchor ?? { x: 320, y: 200 + i * 24 };
    const rise = Math.round(28 * f.progress);
    boxes.push({
      id: `floater${i}`,
      kind: 'floater',
      rect: { x: anchor.x - 60, y: anchor.y - rise, w: 120, h: 26 },
      text: f.text,
      align: 'center',
      fontSize: 24,
      color:
        f.kind === 'heal'
          ? rgbCss(HUD_BAR_COLORS.atbFilling)
          : f.kind === 'miss'
            ? '#cfd2ff'
            : '#ffffff',
      opacity: Math.max(0, 1 - f.progress),
    });
  });

  if (model.metricsMeasured === false) {
    boxes.push({
      id: 'diagnostic.metrics',
      kind: 'diagnostic',
      rect: { x: 8, y: 452, w: 400, h: 20 },
      text: 'Glyphenmetrik: Ersatzwerte (WINDOW.BIN nicht gelesen)',
      align: 'left',
      fontSize: 12,
      color: '#ffd050',
    });
  }
  if (model.effectCoverage) {
    const { covered, substituted } = model.effectCoverage;
    const total = covered + substituted;
    boxes.push({
      id: 'diagnostic.effects',
      kind: 'diagnostic',
      rect: { x: 420, y: 452, w: 212, h: 20 },
      text: `Effekte belegt ${covered}/${total}`,
      align: 'right',
      fontSize: 12,
      color: '#9fb4ff',
    });
  }
  return boxes;
}
