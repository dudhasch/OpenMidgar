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
  /** Seitenzeiger der Gegenstandsliste. */
  page: number;
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
    // Die Rückmeldung einer Handlung gehört in die Ansicht, nicht in ein
    // Protokoll — dieselbe Regel, nach der `notes` überhaupt eingeführt wurde.
    const mit = this.state.message ? { ...vm, notes: [this.state.message, ...(vm.notes ?? [])] } : vm;
    return buildViewScreen(mit, this.data, this.state.cursor);
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
   * Links/rechts blättert **innerhalb** einer Ansicht, wenn sie Seiten hat, und
   * sonst zwischen den Ansichten. Ohne diese Unterscheidung wäre die
   * Gegenstandsliste ab Seite 2 nur über einen Umweg erreichbar.
   */
  private blaettern(richtung: number): void {
    /**
     * Auswahllisten blättern nicht. `VIEW_ORDER` kennt sie nicht, und ohne
     * diese Wache würde `indexOf` −1 liefern und der Spieler mit einem
     * Seitwärtsdruck aus der laufenden Handlung in die Gruppenansicht fallen —
     * mit einer `pending`-Handlung, die dann nirgends mehr sichtbar ist.
     */
    if (this.state.view === 'pick' || this.state.view === 'save') return;
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
