import {
  buildItemsView,
  buildKeyItemsView,
  buildPartyView,
  buildStatusView,
  buildTimeView,
  MAX_ITEM_SCROLL,
  VISIBLE_ITEM_ROWS,
  type MenuData,
  type MenuViewId,
  type MenuViewModel,
} from './model.js';
import {
  buildItemScreen,
  createItemScreenState,
  type ItemScreenState,
  type ItemSubmode,
  type ItemTab,
} from './item-screen.js';
import {
  buildConfigView,
  buildEquipView,
  buildLimitView,
  buildMagicView,
  buildMateriaView,
  buildPhsView,
} from './views.js';
import { buildMainScreen, buildViewScreen, COMMAND_LABELS, type MenuScreen } from './screen.js';
import {
  buildEquipPickView,
  buildSaveView,
  MATERIA_HINWEIS,
  pickTargetSlot,
  saveTargetIndex,
  type MenuActionHost,
  type PendingAction,
} from './actions.js';
import { equipItem, MENU_ITEM_ORDER, unequipItem, type EquipSlotKind } from '@webmidgar/formats-save';

/**
 * Menü-Ablauf (S21) als reines Zustandsmodell — dieselbe Bauform wie die
 * Dialogsitzung aus S15.
 *
 * **Das Menü hat keine Zustandswirkung auf die Spielwelt.** Es tickt den
 * Interpreter nicht, es schreibt keine Bank, es erzeugt keinen HostRequest.
 * Deshalb bleibt der Replay-Digest beim Öffnen und Schließen unverändert.
 *
 * ⚠️ **Seit Welle 4 gilt das für die Welt, nicht mehr für den Spielstand.**
 * Ausrüsten und Speichern (F07) verändern die Savemap — über den Wirt
 * ({@link MenuActionHost}), nie direkt. Der Replay-Digest bleibt davon
 * trotzdem unberührt, und das ist keine Nachlässigkeit: Er deckt den
 * Interpreterlauf ab, und der liest die Savemap nicht. Würde er es je tun,
 * müsste die Savemap in den Digest — dieser Absatz ist die Merkstelle dafür.
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
 * Kommando → Ansicht. `formation` hat weiterhin keine: Der Reihenwechsel ist
 * eine Handlung ohne gemessene Wirkung im Kampf, und ein Menüpunkt, der etwas
 * schreibt, das nirgends gelesen wird, wäre schlimmer als einer, der nichts
 * tut. `save` führt seit Welle 4 in die Speicheransicht (F07).
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
  save: 'save',
};

/** Zeilenreihenfolge der Ausrüstungsansicht — Anker der Auswahl. */
const EQUIP_ZEILEN: readonly EquipSlotKind[] = ['weapon', 'armor', 'accessory'];

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
  /**
   * Seitenzeiger — für die übrigen Listenansichten. Die Gegenstandsliste
   * blättert seit dieser Welle **nicht** mehr seitenweise, sondern läuft mit
   * einem Fenster von zehn Zeilen über alle 320 Plätze; ihr Stand steht in
   * {@link MenuState.item}.
   */
  page: number;
  /** Zustand des Gegenstands-Bildschirms (Reiter, Bildlauf, Untermodus). */
  item: ItemScreenState;
  /** Angezeigter Charakter der Statusansicht (Index im Recordarray). */
  characterIndex: number;
  /**
   * Laufende Handlung, während die Auswahlliste offen ist (F07). Sie steht im
   * Zustand und nicht in einer Instanzvariable, damit `changed` sie mitbekommt
   * und die Darstellung sich weiter allein am Zustand hängen kann.
   */
  pending: PendingAction | null;
  /** Rückmeldung der letzten Handlung — wird in der Ansicht gezeigt. */
  message: string | null;
  /** Ansicht, aus der die Auswahlliste geöffnet wurde. */
  pickReturn: MenuViewId | null;
}

export function createMenuState(): MenuState {
  return {
    open: false,
    view: 'party',
    root: 'party',
    cursor: 0,
    page: 0,
    item: createItemScreenState(),
    characterIndex: 0,
    pending: null,
    message: null,
    pickReturn: null,
  };
}

export class MenuSession {
  state: MenuState = createMenuState();
  /** Vorheriger Eingabezustand — das Menü wertet ausschließlich Flanken. */
  private prev: MenuInput = { ...NEUTRAL_MENU_INPUT };

  /**
   * Der Wirt der Handlungen (F07). Fehlt er, bleibt das Menü lesend — genau
   * wie bis Welle 3, und die Ansichten sagen es an der Stelle, an der die
   * Handlung stünde.
   */
  constructor(
    private data: MenuData,
    private actions: MenuActionHost | null = null,
  ) {}

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
    // 🟢 Der Gegenstands-Bildschirm setzt sich beim Betreten zurück und startet
    // in der Liste, nicht in der Reiterzeile (`Menu_ItemScreenInit`).
    if (this.state.view === 'items' || this.state.view === 'keyItems') {
      this.state.item = createItemScreenState();
    }
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
        // Der dritte Reiter zeigt eine andere Liste, aber denselben
        // Bildschirm — deshalb entscheidet der Reiter, nicht die Ansichts-ID.
        return this.state.item.tab === 2
          ? buildKeyItemsView(this.data, this.state.item.keyScroll)
          : buildItemsView(this.data, this.state.item.scroll);
      case 'keyItems':
        return buildKeyItemsView(this.data, this.state.item.keyScroll);
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
      case 'pick': {
        const p = this.state.pending;
        if (!p || p.kind !== 'equip') return null;
        return buildEquipPickView(this.data, this.state.characterIndex, p.equipSlot);
      }
      case 'save':
        return buildSaveView(this.actions?.saveSlots?.() ?? null);
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
    if (!vm) return null;
    if (this.state.view === 'items' || this.state.view === 'keyItems') {
      const mit = this.state.message ? { ...vm, notes: [this.state.message, ...(vm.notes ?? [])] } : vm;
      return buildItemScreen(mit, this.data, this.state.item);
    }
    // Die Rückmeldung einer Handlung gehört in die Ansicht, nicht in ein
    // Protokoll — dieselbe Regel, nach der `notes` überhaupt eingeführt wurde.
    const mit = this.state.message ? { ...vm, notes: [this.state.message, ...(vm.notes ?? [])] } : vm;
    return buildViewScreen(mit, this.data, this.state.cursor);
  }

  private clampCursor(): void {
    if (this.state.view === 'items' || this.state.view === 'keyItems') return this.clampItem();
    const vm = this.viewModel();
    if (!vm || vm.selectable.length === 0) {
      this.state.cursor = 0;
      return;
    }
    this.state.cursor = Math.max(0, Math.min(vm.selectable.length - 1, this.state.cursor));
  }

  /** Der Gegenstands-Bildschirm hat einen eigenen Zeiger — Fenster plus Zeile. */
  private clampItem(): void {
    const s = this.state.item;
    s.scroll = Math.max(0, Math.min(MAX_ITEM_SCROLL, s.scroll));
    s.row = Math.max(0, Math.min(VISIBLE_ITEM_ROWS - 1, s.row));
    const schluesselZeilen = Math.ceil(this.data.savemap.keyItems.length / 2);
    s.keyScroll = Math.max(0, Math.min(Math.max(0, schluesselZeilen - VISIBLE_ITEM_ROWS), s.keyScroll));
    s.keyRow = Math.max(0, Math.min(VISIBLE_ITEM_ROWS - 1, s.keyRow));
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
      // Der Gegenstands-Bildschirm hat eine eigene Bedienung: Reiterzeile,
      // Listenfenster und Aufklappfenster sind Untermodi wie im Original und
      // lassen sich nicht auf den einen Zeilenzeiger der übrigen Ansichten
      // abbilden. Erst wenn er selbst hinauswill, greift der allgemeine Weg.
      if (this.state.view === 'items' && this.gegenstandsSchritt(flanke)) {
        this.prev = { ...input };
        return { changed: JSON.stringify(this.state) !== before };
      }
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
        if (this.state.view === 'pick') {
          // Aus der Auswahlliste zurück in die Ansicht, die sie geöffnet hat —
          // nie direkt hinaus. Sonst verlöre ein versehentliches Abbrechen den
          // ganzen Menüpfad.
          this.state.view = this.state.pickReturn ?? 'equip';
          this.state.pending = null;
          this.state.pickReturn = null;
          this.state.cursor = 0;
          this.state.message = null;
          this.clampCursor();
        } else if (this.state.root === 'main' && this.state.view !== 'main') {
          this.state.view = 'main';
          this.state.cursor = 0;
          this.state.message = null;
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
   * Ein Bedienschritt im Gegenstands-Bildschirm. Rückgabe `true` heißt: Der
   * Bildschirm hat die Eingabe verbraucht. `false` gibt sie an den allgemeinen
   * Weg weiter — das passiert genau einmal, nämlich beim Abbrechen aus der
   * Reiterzeile, denn dann verlässt man den Bildschirm.
   *
   * 🟢 Die Übergänge stehen so im Original (Sprungtabelle `0x007175CA`):
   * Reiterzeile → Liste (Reiter 0) · → Sortierfenster (Reiter 1) · →
   * Schlüsselliste (Reiter 2); Abbrechen führt aus jedem der drei zurück in die
   * Reiterzeile und erst von dort aus dem Bildschirm heraus.
   */
  private gegenstandsSchritt(flanke: (key: keyof MenuInput) => boolean): boolean {
    const s = this.state.item;

    if (s.submode === 0) {
      // 🟢 Der Reitercursor läuft um (colWrapMode 1) und hat nur eine Zeile.
      if (flanke('left')) s.tab = ((s.tab + 2) % 3) as ItemTab;
      if (flanke('right')) s.tab = ((s.tab + 1) % 3) as ItemTab;
      if (flanke('confirm')) {
        s.submode = (s.tab === 0 ? 1 : s.tab === 1 ? 4 : 3) as ItemSubmode;
        if (s.tab === 1) s.arrangeRow = 0;
      }
      // Abbrechen verlässt den Bildschirm — das erledigt der allgemeine Weg.
      return !flanke('cancel');
    }

    if (flanke('cancel')) {
      s.submode = 0;
      // 🟢 Der Reiter bleibt stehen, wo er stand; das Original setzt ihn nicht
      // zurück (es schreibt in den Abbruchzweigen nur den Untermodus).
      return true;
    }

    if (s.submode === 4) {
      const n = 8;
      // 🟢 Der Zeiger des Aufklappfensters läuft um (rowWrapMode 1).
      if (flanke('up')) s.arrangeRow = (s.arrangeRow + n - 1) % n;
      if (flanke('down')) s.arrangeRow = (s.arrangeRow + 1) % n;
      // Bestätigen bliebe wirkungslos: Sortieren schreibt in den Spielstand und
      // ist in dieser Welle nicht umgesetzt (siehe `buildItemScreen`).
      return true;
    }

    if (s.submode === 3) {
      const zeilen = Math.max(1, Math.ceil(this.data.savemap.keyItems.length / 2));
      const maxScroll = Math.max(0, zeilen - VISIBLE_ITEM_ROWS);
      // 🟢 Zwei Spalten mit Übertrag in die Zeile (colWrapMode 2).
      if (flanke('left') && s.keyCol === 1) s.keyCol = 0;
      else if (flanke('left')) {
        s.keyCol = 1;
        this.keyHoch(maxScroll);
      }
      if (flanke('right') && s.keyCol === 0) s.keyCol = 1;
      else if (flanke('right')) {
        s.keyCol = 0;
        this.keyRunter(maxScroll, zeilen);
      }
      if (flanke('up')) this.keyHoch(maxScroll);
      if (flanke('down')) this.keyRunter(maxScroll, zeilen);
      return true;
    }

    // Untermodus 1 — die Gegenstandsliste.
    // 🟢 Kein Umlauf: Am oberen bzw. unteren Rand des Fensters wird gescrollt
    // (rowWrapMode 0 bei 320 Gesamtzeilen), der Zeiger bleibt dabei stehen.
    if (flanke('up')) {
      if (s.row > 0) s.row -= 1;
      else s.scroll = Math.max(0, s.scroll - 1);
    }
    if (flanke('down')) {
      if (s.row < VISIBLE_ITEM_ROWS - 1) s.row += 1;
      else s.scroll = Math.min(MAX_ITEM_SCROLL, s.scroll + 1);
    }
    // 🟢 Der Seitensprung des Originals liegt auf L1/R1 und verschiebt **nur**
    // die Oberkante um die Fensterhöhe; die Zeigerzeile bleibt stehen. Unser
    // Eingabemodell kennt keine Schultertasten, deshalb liegt er hier auf
    // links/rechts. Das kostet den Ansichtswechsel per Seitwärtsdruck — der
    // führt in diesem Bildschirm über die Reiterzeile und Abbrechen.
    if (flanke('left')) s.scroll = Math.max(0, s.scroll - VISIBLE_ITEM_ROWS);
    if (flanke('right')) s.scroll = Math.min(MAX_ITEM_SCROLL, s.scroll + VISIBLE_ITEM_ROWS);
    return true;
  }

  private keyHoch(maxScroll: number): void {
    const s = this.state.item;
    if (s.keyRow > 0) s.keyRow -= 1;
    else s.keyScroll = Math.max(0, Math.min(maxScroll, s.keyScroll - 1));
  }

  private keyRunter(maxScroll: number, zeilen: number): void {
    const s = this.state.item;
    if (s.keyRow < Math.min(VISIBLE_ITEM_ROWS, zeilen) - 1) s.keyRow += 1;
    else s.keyScroll = Math.min(maxScroll, s.keyScroll + 1);
  }

  /**
   * Links/rechts blättert **innerhalb** einer Ansicht, wenn sie Seiten hat, und
   * sonst zwischen den Ansichten. Der Gegenstands-Bildschirm kommt hier nicht
   * mehr an: Er verbraucht links/rechts selbst (siehe `gegenstandsSchritt`).
   */
  private blaettern(richtung: number): void {
    /**
     * Auswahllisten blättern nicht. `VIEW_ORDER` kennt sie nicht, und ohne
     * diese Wache würde `indexOf` −1 liefern und der Spieler mit einem
     * Seitwärtsdruck aus der laufenden Handlung in die Gruppenansicht fallen —
     * mit einer `pending`-Handlung, die dann nirgends mehr sichtbar ist.
     */
    if (this.state.view === 'pick' || this.state.view === 'save') return;
    const i = VIEW_ORDER.indexOf(this.state.view);
    const j = (i + richtung + VIEW_ORDER.length) % VIEW_ORDER.length;
    this.state.view = VIEW_ORDER[j]!;
    this.state.cursor = 0;
    this.clampCursor();
  }

  /**
   * Bestätigen.
   *
   * Vier Wege, in der Reihenfolge, in der sie geprüft werden: Hauptmenü öffnet
   * die Ansicht des Kommandos · Ausrüstung öffnet die Auswahlliste · die
   * Auswahlliste führt die Handlung aus · die Gruppenansicht öffnet den Status.
   * Überall sonst tut Bestätigen nichts, und das bleibt so: Eine Taste, die
   * scheinbar wirkt, ist schlimmer als eine, die erkennbar nicht wirkt.
   */
  private bestaetigen(): void {
    if (this.state.view === 'equip') return this.equipPlatzWaehlen();
    if (this.state.view === 'pick') return this.handlungAusfuehren();
    if (this.state.view === 'save') return this.speichern();
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
      if (ziel === 'items') this.state.item = createItemScreenState();
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

  // --- Handlungen (F07) ----------------------------------------------------

  /** Ist ein beschreibbarer Spielstand da? Wenn nicht: sagen, warum nicht. */
  private schreibbar(): Uint8Array | null {
    if (!this.actions) {
      this.state.message = 'Das Menü läuft ohne Wirt — es kann nur anzeigen';
      return null;
    }
    const slot = this.actions.slot();
    if (!slot) {
      this.state.message = 'Kein beschreibbarer Spielstand geladen — Ausrüsten ist gesperrt';
      return null;
    }
    return slot;
  }

  /** Ausrüstungsansicht: Zeile 0/1/2 öffnet die Auswahlliste des Platzes. */
  private equipPlatzWaehlen(): void {
    const kind = EQUIP_ZEILEN[this.state.cursor];
    if (!kind) return;
    if (!this.schreibbar()) return;
    this.state.pending = { kind: 'equip', equipSlot: kind };
    this.state.pickReturn = 'equip';
    this.state.view = 'pick';
    this.state.cursor = 0;
    this.state.message = MATERIA_HINWEIS;
    this.clampCursor();
  }

  /**
   * Auswahlliste bestätigen: ausrüsten oder abnehmen.
   *
   * Der Wirt schreibt, diese Sitzung übernimmt nur das Ergebnis. Schlägt die
   * Handlung fehl, bleibt die Liste offen und der Grund steht in der Ansicht —
   * ein stiller Fehlschlag wäre hier besonders teuer, weil der Spieler sonst
   * glaubt, seine Waffe sei getauscht.
   */
  private handlungAusfuehren(): void {
    const p = this.state.pending;
    if (!p || p.kind !== 'equip' || !this.actions) return;
    const slot = this.schreibbar();
    if (!slot) return;
    const vm = this.viewModel();
    const zeile = vm?.rows[vm.selectable[this.state.cursor] ?? -1];
    const ziel = pickTargetSlot(zeile);
    if (ziel === undefined) return;

    const ergebnis =
      ziel === null
        ? unequipItem(slot, this.state.characterIndex, p.equipSlot)
        : equipItem(slot, this.state.characterIndex, p.equipSlot, ziel);

    if (!ergebnis.ok) {
      this.state.message = `Nicht möglich: ${ergebnis.reason}`;
      return;
    }
    this.data = this.actions.apply(ergebnis.slot);
    this.state.view = this.state.pickReturn ?? 'equip';
    this.state.pending = null;
    this.state.pickReturn = null;
    this.state.cursor = 0;
    this.state.message =
      ziel === null ? 'Abgenommen' : (ergebnis.note ?? 'Ausgerüstet');
    this.clampCursor();
  }

  /** Speicheransicht bestätigen — die Anforderung geht an den Wirt. */
  private speichern(): void {
    const vm = this.viewModel();
    const zeile = vm?.rows[vm.selectable[this.state.cursor] ?? -1];
    const index = saveTargetIndex(zeile);
    if (index === undefined) return;
    if (!this.actions?.requestSave) {
      this.state.message = 'Kein Spielstandspeicher angebunden';
      return;
    }
    this.state.message = this.actions.requestSave(index);
  }

  /**
   * Der Wirt meldet das Ergebnis einer angeforderten Handlung nach — er
   * arbeitet asynchron, die Sitzung wartet nicht. Ohne diesen Weg stünde nach
   * einem Speichervorgang für immer „wird gespeichert…" in der Ansicht.
   */
  setMessage(text: string | null): void {
    this.state.message = text;
  }

  /** Datensicht ersetzen, nachdem der Wirt einen Stand geladen hat. */
  refresh(data: MenuData): void {
    this.data = data;
    this.clampCursor();
  }
}
