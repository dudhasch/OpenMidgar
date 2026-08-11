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
import {
  buildConfigView,
  buildEquipView,
  buildLimitView,
  buildMagicView,
  buildMateriaView,
  buildPhsView,
} from './views.js';
import { buildMainScreen, buildViewScreen, COMMAND_LABELS, type MenuScreen } from './screen.js';
import { MENU_ITEM_ORDER } from '@webmidgar/formats-save';

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

/**
 * Reihenfolge, in der `links`/`rechts` durch die Ansichten blättert.
 *
 * Die vier Ansichten aus Welle 1 stehen bewusst vorn und in unveränderter
 * Folge — das Blätterverhalten ist in den Golden-Tests von S21 verankert, und
 * eine Umsortierung wäre eine Verhaltensänderung ohne Anlass. Die sechs neuen
 * Ansichten (F24-B) hängen hinten an.
 */
export const VIEW_ORDER: readonly MenuViewId[] = [
  'party',
  'items',
  'status',
  'time',
  'equip',
  'materia',
  'magic',
  'limit',
  'phs',
  'config',
];

/**
 * Kommando → Ansicht. `formation` und `save` haben in dieser Welle keine
 * Ansicht: Reihenwechsel ist eine Handlung (nicht mein Auftrag), Speichern ist
 * S24. Sie bleiben in der Kommandospalte sichtbar und tun nichts — das ist
 * ehrlicher als sie auszublenden, denn das Original hat sie.
 */
export const COMMAND_TO_VIEW: Readonly<Partial<Record<(typeof MENU_ITEM_ORDER)[number], MenuViewId>>> = {
  item: 'items',
  magic: 'magic',
  materia: 'materia',
  equip: 'equip',
  status: 'status',
  limit: 'limit',
  config: 'config',
  phs: 'phs',
};

export interface MenuState {
  open: boolean;
  view: MenuViewId;
  /**
   * Ansicht, zu der `Abbrechen` zurückkehrt. Wird beim Öffnen gesetzt.
   * Steht der Zeiger schon dort, schließt `Abbrechen` das Menü — dieselbe
   * zweistufige Regel wie im Original.
   */
  root: MenuViewId;
  /** Zeilenzeiger innerhalb der aktuellen Ansicht. */
  cursor: number;
  /** Seitenzeiger der Gegenstandsliste. */
  page: number;
  /** Angezeigter Charakter der Statusansicht (Index im Recordarray). */
  characterIndex: number;
}

export function createMenuState(): MenuState {
  return { open: false, view: 'party', root: 'party', cursor: 0, page: 0, characterIndex: 0 };
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
    this.state.root = this.state.view;
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
      case 'equip':
        return buildEquipView(this.data, this.state.characterIndex);
      case 'materia':
        return buildMateriaView(this.data, this.state.characterIndex);
      case 'magic':
        return buildMagicView(this.data, this.state.characterIndex);
      case 'limit':
        return buildLimitView(this.data, this.state.characterIndex);
      case 'phs':
        return buildPhsView(this.data);
      case 'config':
        return buildConfigView(this.data);
      case 'main':
        // Das Hauptmenü ist ein Bildschirm, keine Zeilenliste. Als
        // Zeilenmodell liefert es die Kommandospalte — so bleibt die
        // Zeigerlogik dieselbe wie überall.
        return this.mainAsViewModel();
    }
  }

  private mainAsViewModel(): MenuViewModel {
    const sichtbar = this.visibleCommands();
    return {
      view: 'main',
      title: 'Menü',
      rows: sichtbar.map((s) => ({
        key: `cmd.${s.key}`,
        label: COMMAND_LABELS[s.key],
        value: s.locked ? 'gesperrt' : '',
        ...(s.locked ? { static: true } : {}),
      })),
      selectable: sichtbar.map((s, i) => (s.locked ? -1 : i)).filter((i) => i >= 0),
    };
  }

  /** Die Kommandos, die der Spielstand gerade zeigt. */
  visibleCommands(): Array<{ key: (typeof MENU_ITEM_ORDER)[number]; locked: boolean }> {
    const sicht = this.data.savemap.settings?.menuVisible ?? 0xffff;
    const sperre = this.data.savemap.settings?.menuLocked ?? 0;
    return MENU_ITEM_ORDER.map((key, bit) => ({ key, bit }))
      .filter(({ bit }) => ((sicht >> bit) & 1) === 1)
      .map(({ key, bit }) => ({ key, locked: ((sperre >> bit) & 1) === 1 }));
  }

  /**
   * Der Bildschirm zur aktuellen Ansicht — **das** ist die Schnittstelle für
   * die Darstellung. Sie enthält Fenster, Zeilen, Spaltenanker und Balken;
   * die UI wendet nur noch `applyWindowSkin` an und setzt Text.
   */
  screen(): MenuScreen | null {
    if (!this.state.open) return null;
    if (this.state.view === 'main') {
      return buildMainScreen(this.data, { commandCursor: this.state.cursor, partyCursor: null });
    }
    const vm = this.viewModel();
    return vm ? buildViewScreen(vm, this.data, this.state.cursor) : null;
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
        /**
         * Zweistufig — aber **nur** im Hauptmenüfluss: Wurde das Menü mit
         * `main` geöffnet, führt Abbrechen aus einer Unteransicht zurück ins
         * Hauptmenü und erst von dort hinaus. Wurde es direkt auf einer
         * Listenansicht geöffnet (der Weg aus Welle 1, den der Menü-Opcode
         * nimmt), schließt Abbrechen sofort. Diese Fallunterscheidung ist
         * bewusst: Der zweite Weg hat kein Hauptmenü, in das er zurückkehren
         * könnte, und sein Verhalten ist in den S21-Tests verankert.
         */
        if (this.state.root === 'main' && this.state.view !== 'main') {
          this.state.view = 'main';
          this.state.cursor = 0;
          this.clampCursor();
        } else {
          this.close();
        }
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
    // Im Hauptmenü öffnet Bestätigen die Ansicht des gewählten Kommandos.
    if (this.state.view === 'main') {
      const sichtbar = this.visibleCommands();
      const auswahl = this.mainAsViewModel().selectable[this.state.cursor];
      const befehl = auswahl === undefined ? undefined : sichtbar[auswahl];
      const ziel = befehl ? COMMAND_TO_VIEW[befehl.key] : undefined;
      if (!ziel) return;
      this.state.view = ziel;
      this.state.cursor = 0;
      this.state.page = 0;
      this.clampCursor();
      return;
    }
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
