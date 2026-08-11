import {
  MenuSession,
  NEUTRAL_MENU_INPUT,
  type MenuData,
  type MenuInput,
  type MenuViewModel,
} from '@webmidgar/menu';
import { readSavemap, parseOriginalSave } from '@webmidgar/formats-save';
import {
  indexKernelSections,
  inventoryNameLookup,
  parseKernelContainer,
  resolveKernelNameLists,
  type InventoryNameLookup,
} from '@webmidgar/formats-kernel';
import { composeSavemapSlot, type FixtureSavemap } from '@webmidgar/fixture-gen';

/**
 * S21-Demoseite: das lesende Menü.
 *
 * Zwei Quellen sind wählbar — ein Fixture-Spielstand (immer verfügbar) und eine
 * echte `save*.ff7` samt `KERNEL.BIN` aus der lokalen Installation. Beides
 * läuft rein clientseitig; es wird nichts hochgeladen.
 *
 * `window.menuDebug` ist der Automatisierungshaken derselben Bauart wie
 * `walkerDebug` aus S5: Er erlaubt einer Prüfung, das Menü ohne Tastatur zu
 * bedienen und den Zustand als Daten abzuholen.
 */

const FIXTURE: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 12, hp: 340, hpMax: 480, mp: 22, mpMax: 40, stats: [21, 18, 15, 14, 17, 9] },
    { id: 1, name: 'Barret', level: 11, hp: 500, hpMax: 500, mp: 8, mpMax: 30, stats: [24, 20, 9, 11, 12, 7] },
    { id: 2, name: 'Tifa', level: 10, hp: 260, hpMax: 300, mp: 30, mpMax: 30, stats: [19, 16, 13, 15, 20, 12] },
  ],
  party: [0, 2, null],
  inventory: [
    { itemId: 0, count: 12 },
    { itemId: 1, count: 3 },
    { itemId: 4, count: 1 },
  ],
  gil: 1234567,
  playtimeSeconds: 3725,
};

const fixtureNames = (): ((id: number) => string | null) => {
  const namen: Record<number, string> = { 0: 'Trank', 1: 'Äther', 4: 'Phönixfeder' };
  return (id) => namen[id] ?? null;
};

let data: MenuData = {
  savemap: readSavemap(composeSavemapSlot(FIXTURE))!,
  itemName: fixtureNames(),
  locationName: 'Fixture-Feld',
};
const session = new MenuSession(data);
session.open('party');

const view = document.getElementById('view')!;
const quelle = document.getElementById('quelle')!;

function render(): void {
  const vm = session.viewModel();
  if (!vm) {
    view.innerHTML = '<p class="zu">Menü geschlossen — Taste <kbd>M</kbd> öffnet es.</p>';
    return;
  }
  view.innerHTML = `<h2>${escape(vm.title)}</h2>${zeilen(vm)}`;
}

function zeilen(vm: MenuViewModel): string {
  const auswahl = vm.selectable[session.state.cursor];
  return `<table>${vm.rows
    .map((r, i) => {
      const marke = i === auswahl ? '▶' : '';
      const balken =
        r.fill === undefined ? '' : `<div class="bar"><span style="width:${(r.fill * 100).toFixed(1)}%"></span></div>`;
      return `<tr class="${r.static ? 'statisch' : ''}"><td class="marke">${marke}</td><td>${escape(
        r.label,
      )}</td><td>${escape(r.value)}${balken}</td></tr>`;
    })
    .join('')}</table>`;
}

function escape(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
}

/** Tastenbelegung → Eingabemodell. Nur Flanken wirken (siehe MenuSession). */
const TASTEN: Record<string, keyof MenuInput> = {
  KeyM: 'toggle',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  Escape: 'cancel',
};

for (const [typ, wert] of [
  ['keydown', true],
  ['keyup', false],
] as const) {
  window.addEventListener(typ, (ev) => {
    const taste = TASTEN[(ev as KeyboardEvent).code];
    if (!taste) return;
    ev.preventDefault();
    session.step({ ...NEUTRAL_MENU_INPUT, [taste]: wert });
    render();
  });
}

/**
 * Echte Installation laden. Der Spielstand liefert die Savemap, `KERNEL.BIN`
 * die Gegenstandsnamen — welche Sektion das ist, bestimmt der Leser selbst.
 */
document.getElementById('laden')!.addEventListener('click', async () => {
  const picker = (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  if (!picker) {
    quelle.textContent = 'Dieser Browser bietet keine Dateiauswahl (File System Access API).';
    return;
  }
  try {
    const [saveHandle] = await (
      picker as (o: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>
    )({ types: [{ description: 'FF7-Spielstand', accept: { 'application/octet-stream': ['.ff7'] } }] });
    const saveBytes = new Uint8Array(await (await saveHandle!.getFile()).arrayBuffer());
    const parsed = parseOriginalSave(saveBytes, 'save.ff7');
    const slot = parsed?.slots.find((s) => s.occupied);
    if (!slot) {
      quelle.textContent = 'Kein belegter Slot in dieser Datei.';
      return;
    }
    const savemap = readSavemap(slot.raw);
    if (!savemap) {
      quelle.textContent = 'Slot ist zu kurz für eine Savemap.';
      return;
    }

    let itemName: InventoryNameLookup = () => null;
    let kernelHinweis = 'ohne KERNEL.BIN — Gegenstandsnamen bleiben leer';
    try {
      const [kernelHandle] = await (
        picker as (o: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>
      )({ types: [{ description: 'KERNEL.BIN', accept: { 'application/octet-stream': ['.bin'] } }] });
      const kernelBytes = new Uint8Array(await (await kernelHandle!.getFile()).arrayBuffer());
      const container = await parseKernelContainer(kernelBytes, 'kernel.bin');
      // F18: bereichskodierte Auflösung über alle vier Inventarbereiche statt
      // einer einzigen Liste (die traf die Zauberliste mit 256 Einträgen).
      const listen = container ? resolveKernelNameLists(indexKernelSections(container)) : null;
      itemName = listen ? inventoryNameLookup(listen) : () => null;
      kernelHinweis =
        listen && listen.reason === null
          ? `Namen aus den Sektionen ${listen.items!.sectionIndex}/${listen.weapons!.sectionIndex}/${listen.armor!.sectionIndex}/${listen.accessories!.sectionIndex} (Gegenstände/Waffen/Rüstungen/Accessoires)`
          : `Namenslisten nicht zuordenbar: ${listen?.reason ?? 'keine KERNEL.BIN'}`;
    } catch {
      // Abbruch der zweiten Auswahl ist kein Fehler — dann eben ohne Namen.
    }

    data = { savemap, itemName, locationName: null };
    session.setData(data);
    session.open('party');
    quelle.textContent = `Slot ${slot.index} geladen (${kernelHinweis}).`;
    render();
  } catch (err) {
    quelle.textContent = `Nicht geladen: ${(err as Error).message}`;
  }
});

render();

/** Automatisierungshaken (wie `walkerDebug` aus S5). */
(window as unknown as { menuDebug: unknown }).menuDebug = {
  state: () => structuredClone(session.state),
  view: () => session.viewModel(),
  press: (taste: keyof MenuInput) => {
    session.step({ ...NEUTRAL_MENU_INPUT, [taste]: true });
    session.step(NEUTRAL_MENU_INPUT);
    render();
    return session.viewModel();
  },
  savemap: () => data.savemap,
};
