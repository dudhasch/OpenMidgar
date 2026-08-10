import {
  buildItemsView,
  buildPartyView,
  buildStatusView,
  buildTimeView,
  itemPageCount,
  type MenuData,
  type MenuViewId,
  type MenuViewModel,
} from './model.js';

/**
 * Menü-Ablauf (S21) als reines Zustandsmodell — dieselbe Bauform wie die
 * Dialogsitzung aus S15.
 *
 * **Das Menü hat keine Zustandswirkung auf die Spielwelt.** Es liest die
 * Savemap und sonst nichts; es tickt den Interpreter nicht, es schreibt keine
 * Bank, es erzeugt keinen HostRequest. Genau deshalb bleibt der Replay-Digest
 * beim Öffnen und Schließen unverändert — das ist nicht Absicht der
 * Implementierung, sondern Folge davon, dass es hier nichts zu schreiben gibt.
 */

export interface MenuInput {
  /** Öffnen bzw. Schließen (Flanke). */
  toggle: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
}

export const NEUTRAL_MENU_INPUT: MenuInput = {
  toggle: false,
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  cancel: false,
};

/** Reihenfolge, in der `links`/`rechts` durch die Ansichten blättert. */
export const VIEW_ORDER: readonly MenuViewId[] = ['party', 'items', 'status', 'time'];

export interface MenuState {
  open: boolean;
  view: MenuViewId;
  /** Zeilenzeiger innerhalb der aktuellen Ansicht. */
  cursor: number;
  /** Seitenzeiger der Gegenstandsliste. */
  page: number;
  /** Angezeigter Charakter der Statusansicht (Index im Recordarray). */
  characterIndex: number;
}

export function createMenuState(): MenuState {
  return { open: false, view: 'party', cursor: 0, page: 0, characterIndex: 0 };
}

export class MenuSession {
  state: MenuState = createMenuState();
  /** Vorheriger Eingabezustand — das Menü wertet ausschließlich Flanken. */
  private prev: MenuInput = { ...NEUTRAL_MENU_INPUT };

  constructor(private data: MenuData) {}

  /** Datenquelle austauschen (neuer Spielstand geladen). */
  setData(data: MenuData): void {
    this.data = data;
    this.clampCursor();
  }

  /**
   * Öffnen von außen — der Weg, den der Menü-Opcode nimmt. `view` ist optional,
   * weil der Opcode im Bestand nicht immer eine Ansicht nennt.
   */
  open(view?: MenuViewId): void {
    this.state.open = true;
    if (view) this.state.view = view;
    this.state.cursor = 0;
    this.clampCursor();
  }

  close(): void {
    this.state.open = false;
  }

  viewModel(): MenuViewModel | null {
    if (!this.state.open) return null;
    switch (this.state.view) {
      case 'party':
        return buildPartyView(this.data);
      case 'items':
        return buildItemsView(this.data, this.state.page);
      case 'status':
        return buildStatusView(this.data, this.state.characterIndex);
      case 'time':
        return buildTimeView(this.data);
    }
  }

  private clampCursor(): void {
    const vm = this.viewModel();
    if (!vm || vm.selectable.length === 0) {
      this.state.cursor = 0;
      return;
    }
    this.state.cursor = Math.max(0, Math.min(vm.selectable.length - 1, this.state.cursor));
  }

  /**
   * Ein Bedienschritt. Rückgabe sagt, ob sich etwas geändert hat — die
   * Darstellung kann sich daran hängen, statt jeden Takt neu aufzubauen.
   */
  step(input: MenuInput): { changed: boolean } {
    const flanke = (key: keyof MenuInput): boolean => input[key] && !this.prev[key];
    const before = JSON.stringify(this.state);

    if (flanke('toggle')) {
      if (this.state.open) this.close();
      else this.open();
    } else if (this.state.open) {
      if (flanke('cancel')) {
        this.close();
      } else {
        const vm = this.viewModel();
        const n = vm?.selectable.length ?? 0;
        if (flanke('up') && n > 0) this.state.cursor = (this.state.cursor - 1 + n) % n;
        if (flanke('down') && n > 0) this.state.cursor = (this.state.cursor + 1) % n;
        if (flanke('left')) this.blaettern(-1);
        if (flanke('right')) this.blaettern(+1);
        if (flanke('confirm')) this.bestaetigen();
      }
    }

    this.prev = { ...input };
    return { changed: JSON.stringify(this.state) !== before };
  }

  /**
   * Links/rechts blättert **innerhalb** einer Ansicht, wenn sie Seiten hat, und
   * sonst zwischen den Ansichten. Ohne diese Unterscheidung wäre die
   * Gegenstandsliste ab Seite 2 nur über einen Umweg erreichbar.
   */
  private blaettern(richtung: number): void {
    if (this.state.view === 'items') {
      const seiten = itemPageCount(this.data);
      const naechste = this.state.page + richtung;
      if (naechste >= 0 && naechste < seiten) {
        this.state.page = naechste;
        this.state.cursor = 0;
        return;
      }
    }
    const i = VIEW_ORDER.indexOf(this.state.view);
    const j = (i + richtung + VIEW_ORDER.length) % VIEW_ORDER.length;
    this.state.view = VIEW_ORDER[j]!;
    this.state.cursor = 0;
    if (this.state.view === 'items') {
      // Beim Rückwärtsblättern in die Gegenstandsliste auf deren letzte Seite
      // springen — sonst überspringt ein Rückwärtslauf den Listeninhalt.
      this.state.page = richtung < 0 ? itemPageCount(this.data) - 1 : 0;
    }
    this.clampCursor();
  }

  /**
   * Bestätigen. In der Gruppenansicht öffnet es den Status der gewählten Figur;
   * überall sonst tut es **nichts** — es gibt in dieser Session keine Aktion,
   * die etwas verändern könnte, und eine Taste, die scheinbar wirkt, wäre
   * schlimmer als eine, die erkennbar nicht wirkt.
   */
  private bestaetigen(): void {
    if (this.state.view !== 'party') return;
    const vm = buildPartyView(this.data);
    const zeile = vm.selectable[this.state.cursor];
    if (zeile === undefined) return;
    const slot = Number(vm.rows[zeile]!.key.slice(1));
    const id = this.data.savemap.party[slot];
    if (id === null || id === undefined) return;
    const index = this.data.savemap.characters.findIndex((c) => c.id === id);
    if (index < 0) return;
    this.state.characterIndex = index;
    this.state.view = 'status';
    this.state.cursor = 0;
  }
}
