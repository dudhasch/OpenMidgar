import { layoutText, type LayoutOptions, type TextPage } from './layout.js';

/**
 * Dialogablauf (S15) als reines Zustandsmodell.
 *
 * Der S6-Vertrag bleibt unangetastet: Der Interpreter geht bei MESSAGE/ASK in
 * `waitState { kind: 'dialogue', requestId }` und wird über ein Ereignis
 * fortgesetzt. Dieses Modul entscheidet nur, *wann* diese Antwort kommt —
 * abhängig von Seitenfortschritt, Textgeschwindigkeit und Auswahl.
 *
 * Alles hier ist Datenübergang ohne Zeitquelle: Fortschritt kommt in Takten
 * herein, nicht in Millisekunden. Nur so bleibt der Dialog replay-fähig.
 */

export interface DialogRequest {
  requestId: number;
  text: string;
  /** Auswahlmodus (ASK): Zeilenbereich, aus dem gewählt wird. */
  choice?: { firstLine: number; lastLine: number } | undefined;
}

export interface DialogWindowState {
  requestId: number;
  pages: TextPage[];
  pageIndex: number;
  /** Wie viele Zeichen der aktuellen Seite bereits sichtbar sind. */
  revealed: number;
  /** Gesamtzeichenzahl der aktuellen Seite. */
  pageLength: number;
  /** Aktuelle Auswahl (ASK), sonst null. */
  selection: number | null;
  choiceRange: { firstLine: number; lastLine: number } | null;
  done: boolean;
}

export interface DialogInput {
  confirm: boolean;
  cancel: boolean;
  /** −1 = hoch, +1 = runter, 0 = keine Bewegung (Auswahl). */
  moveY: number;
}

export const NEUTRAL_DIALOG_INPUT: DialogInput = { confirm: false, cancel: false, moveY: 0 };

export interface DialogOptions extends LayoutOptions {
  /** Sichtbar werdende Zeichen je Takt; 0 = Text sofort vollständig. */
  charsPerTick?: number | undefined;
}

export interface DialogStepResult {
  /** Gesetzt, sobald der Dialog beantwortet ist — der Wert geht an den Interpreter. */
  resolved: { requestId: number; choice: number } | null;
}

const DEFAULT_CHARS_PER_TICK = 4;

/**
 * Ein Dialogfenster. Die Bedienung folgt der Erwartung des Originals:
 * Bestätigen lässt erst den restlichen Text der Seite erscheinen, dann
 * blättert es weiter, und auf der letzten Seite schließt es das Fenster.
 * Diese Staffelung ist der Grund, warum „Bestätigen" nicht einfach beendet.
 */
export class DialogSession {
  readonly charsPerTick: number;
  state: DialogWindowState | null = null;

  constructor(private readonly opts: DialogOptions) {
    this.charsPerTick = opts.charsPerTick ?? DEFAULT_CHARS_PER_TICK;
  }

  open(request: DialogRequest): void {
    const laid = layoutText(request.text, this.opts);
    const pages = laid.pages.length > 0 ? laid.pages : [{ lines: [''] }];
    this.state = {
      requestId: request.requestId,
      pages,
      pageIndex: 0,
      revealed: this.charsPerTick === 0 ? Number.MAX_SAFE_INTEGER : 0,
      pageLength: pageLength(pages[0]!),
      selection: request.choice ? request.choice.firstLine : null,
      choiceRange: request.choice ?? null,
      done: false,
    };
  }

  /** Sichtbarer Text der aktuellen Seite, auf `revealed` Zeichen gekürzt. */
  visibleLines(): string[] {
    const s = this.state;
    if (!s) return [];
    const page = s.pages[s.pageIndex];
    if (!page) return [];
    let budget = s.revealed;
    const out: string[] = [];
    for (const line of page.lines) {
      if (budget <= 0) break;
      out.push(line.slice(0, budget));
      budget -= line.length;
    }
    return out;
  }

  tick(input: DialogInput = NEUTRAL_DIALOG_INPUT): DialogStepResult {
    const s = this.state;
    if (!s || s.done) return { resolved: null };

    if (s.revealed < s.pageLength) s.revealed += this.charsPerTick;

    if (s.choiceRange && input.moveY !== 0 && s.selection !== null) {
      const { firstLine, lastLine } = s.choiceRange;
      const span = lastLine - firstLine + 1;
      // Umlaufende Auswahl — ohne Umlauf bliebe man an den Rändern hängen.
      s.selection = firstLine + (((s.selection - firstLine + input.moveY) % span) + span) % span;
    }

    if (!input.confirm) return { resolved: null };

    if (s.revealed < s.pageLength) {
      // Erste Stufe: restlichen Text der Seite sofort zeigen.
      s.revealed = s.pageLength;
      return { resolved: null };
    }
    if (s.pageIndex + 1 < s.pages.length) {
      // Zweite Stufe: weiterblättern.
      s.pageIndex++;
      s.pageLength = pageLength(s.pages[s.pageIndex]!);
      s.revealed = this.charsPerTick === 0 ? Number.MAX_SAFE_INTEGER : 0;
      return { resolved: null };
    }
    // Dritte Stufe: schließen und antworten.
    s.done = true;
    return {
      resolved: {
        requestId: s.requestId,
        choice: s.choiceRange && s.selection !== null ? s.selection - s.choiceRange.firstLine : 0,
      },
    };
  }
}

function pageLength(page: TextPage): number {
  return page.lines.reduce((n, l) => n + l.length, 0);
}
