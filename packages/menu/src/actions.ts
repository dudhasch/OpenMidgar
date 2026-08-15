import { inventoryCategory, INVENTORY_RANGES } from '@webmidgar/formats-kernel';
import { CHAR, type EquipSlotKind } from '@webmidgar/formats-save';
import { formatNumber } from './format.js';
import { characterLabel, type MenuData, type MenuRow, type MenuViewModel } from './model.js';

/**
 * **Handelnde Menüs (F07).**
 *
 * Bis Welle 4 war das Menü ausdrücklich lesend, und der Kopf von `model.ts`
 * begründet das gut: Was nicht da ist, kann keinen Spielstand beschädigen. Der
 * Preis war, dass „Ausrüsten" und „Speichern" in der Kommandospalte standen
 * und nichts taten.
 *
 * Dieses Modul löst das auf, ohne die Bauform aufzugeben:
 *
 * 🔵 **Die Sitzung bleibt ein reines Zustandsmodell.** Sie schreibt keine
 * Bytes und kennt keine Datenbank. Sie ruft den {@link MenuActionHost}, und
 * der liefert eine neue {@link MenuData} zurück. Damit bleibt das Menü in Node
 * prüfbar — die Tests setzen einen Wirt aus zwanzig Zeilen ein.
 *
 * 🔵 **Speichern ist asynchron, die Sitzung ist es nicht.** Der Wirt bekommt
 * eine Anforderung und meldet einen Text zurück; die Sitzung wartet auf
 * nichts. Ein `await` mitten in der Tastenbehandlung wäre der sichere Weg zu
 * einem Menü, das auf halbem Stand weiterläuft.
 *
 * 🔵 **Ohne Wirt ändert sich nichts.** Fehlt der Wirt oder liefert er keinen
 * Spielstand, sagen die Ansichten das hin — statt Tasten anzubieten, die
 * folgenlos bleiben. Das ist dieselbe Regel wie bisher, nur jetzt mit einem
 * Zweig, in dem tatsächlich etwas passiert.
 */

/** Ein Spielstandsplatz, wie ihn die Speicheransicht zeigt. */
export interface SaveSlotChoice {
  index: number;
  /** Anzeigezeile des Platzes („Leer" oder Ort/Spielzeit). */
  label: string;
  belegt: boolean;
}

export interface MenuActionHost {
  /**
   * Rohbytes des laufenden Spielstands (4340 B). `null` heißt: Es gibt keinen
   * beschreibbaren Stand — das Menü bleibt lesend, und die Ansichten sagen es.
   */
  slot(): Uint8Array | null;
  /**
   * Übernimmt einen geänderten Stand. Der Wirt hält ihn fest und baut die
   * Datensicht neu auf; die Sitzung übernimmt, was zurückkommt.
   */
  apply(slot: Uint8Array): MenuData;
  /** Plätze für die Speicheransicht. Fehlt sie, gibt es kein Speichern. */
  saveSlots?(): SaveSlotChoice[];
  /**
   * Fordert das Speichern an. Der Wirt arbeitet asynchron weiter; der
   * Rückgabetext ist die sofortige Rückmeldung an den Spieler.
   */
  requestSave?(index: number): string;
}

/** Was die Sitzung gerade auswählen lässt. */
export type PendingAction =
  | { kind: 'equip'; equipSlot: EquipSlotKind }
  | { kind: 'save' };

const EMPTY = 0xff;

const PLATZ_TITEL: Readonly<Record<EquipSlotKind, string>> = {
  weapon: 'Waffe',
  armor: 'Rüstung',
  accessory: 'Accessoire',
};

const PLATZ_BASIS: Readonly<Record<EquipSlotKind, number>> = {
  weapon: INVENTORY_RANGES.weaponBase,
  armor: INVENTORY_RANGES.armorBase,
  accessory: INVENTORY_RANGES.accessoryBase,
};

/** Ausrüstungsfeld der Figur je Platzart. */
export function equippedIndex(data: MenuData, characterIndex: number, kind: EquipSlotKind): number {
  const c = data.savemap.characters[characterIndex];
  if (!c) return EMPTY;
  return kind === 'weapon' ? c.weapon : kind === 'armor' ? c.armor : c.accessory;
}

/**
 * Auswahlliste für einen Ausrüstungsplatz: alle Inventareinträge der passenden
 * Kategorie, dazu eine Zeile zum Abnehmen.
 *
 * Die Liste filtert **nach Bereich**, nicht nach Namen — die Bereichskodierung
 * ist 🟢 belegt (F18), eine Namensprüfung wäre raten. Einträge ohne auflösbaren
 * Namen bleiben mit `?Kennung` stehen, damit eine Lücke sichtbar bleibt statt
 * zu verschwinden.
 */
export function buildEquipPickView(
  data: MenuData,
  characterIndex: number,
  kind: EquipSlotKind,
): MenuViewModel {
  const c = data.savemap.characters[characterIndex];
  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  const getragen = equippedIndex(data, characterIndex, kind);

  if (getragen !== EMPTY) {
    selectable.push(rows.length);
    rows.push({
      key: 'ab',
      label: '— abnehmen —',
      value: data.itemName(PLATZ_BASIS[kind] + getragen) ?? `?${getragen}`,
    });
  }

  for (const e of data.savemap.inventory) {
    const bereich = inventoryCategory(e.itemId);
    if (!bereich || bereich.category !== kind) continue;
    selectable.push(rows.length);
    const beschreibung = data.itemDescription?.(e.itemId) ?? null;
    rows.push({
      key: `pick${e.slot}`,
      label: data.itemName(e.itemId) ?? `?${e.itemId}`,
      value: `×${formatNumber(e.count)}`,
      ...(beschreibung ? { description: beschreibung } : {}),
    });
  }

  if (rows.length === 0) {
    rows.push({ key: 'leer', label: '', value: 'Nichts Passendes im Gepäck', static: true });
  }

  const titel = `${PLATZ_TITEL[kind]} — ${c ? characterLabel(c) : '—'}`;
  return { view: 'pick', title: titel, rows, selectable };
}

/**
 * Zu welchem Inventarplatz gehört eine Zeile der Auswahlliste? `null` heißt
 * „abnehmen". Die Zeile trägt ihre Herkunft im Schlüssel, damit die Zuordnung
 * nicht über die Zeilennummer läuft — die verschiebt sich, sobald die
 * Abnehmen-Zeile fehlt.
 */
export function pickTargetSlot(row: MenuRow | undefined): number | null | undefined {
  if (!row) return undefined;
  if (row.key === 'ab') return null;
  if (!row.key.startsWith('pick')) return undefined;
  const n = Number(row.key.slice(4));
  return Number.isInteger(n) ? n : undefined;
}

/** Speicheransicht: die Plätze des eigenen Spielstandsformats. */
export function buildSaveView(plaetze: readonly SaveSlotChoice[] | null): MenuViewModel {
  if (!plaetze) {
    return {
      view: 'save',
      title: 'Speichern',
      rows: [{ key: 'leer', label: '', value: 'Kein Spielstandspeicher angebunden', static: true }],
      selectable: [],
      notes: ['Der Wirt bietet keine Speicherplätze an — das Menü bleibt hier lesend'],
    };
  }
  const rows: MenuRow[] = plaetze.map((p) => ({
    key: `save${p.index}`,
    label: `Platz ${p.index + 1}`,
    value: p.label,
  }));
  return {
    view: 'save',
    title: 'Speichern',
    rows,
    selectable: rows.map((_, i) => i),
    notes: ['Gespeichert wird im eigenen, versionierten Format — die Installation wird nicht verändert'],
  };
}

/** Zeilenschlüssel → Speicherplatznummer. */
export function saveTargetIndex(row: MenuRow | undefined): number | undefined {
  if (!row?.key.startsWith('save')) return undefined;
  const n = Number(row.key.slice(4));
  return Number.isInteger(n) ? n : undefined;
}

/**
 * Wie viele Materiaplätze das gewählte Stück mitbringt, ist **nicht** Teil
 * dieser Handlung: Beim Waffenwechsel wandern im Original die Materia mit
 * bzw. fallen in den Vorrat, und welche Regel dort gilt, ist ungemessen. Die
 * Plätze bleiben deshalb unverändert stehen — sichtbar, statt still
 * umsortiert. Der Hinweis gehört in die Ansicht.
 */
export const MATERIA_HINWEIS =
  'Materia bleiben in ihren Plätzen — die Umverteilung beim Ausrüstungswechsel ist ungemessen (🔴)';

/** Zahl der belegten Materiaplätze einer Figur; nur für den Hinweistext. */
export function materiaBelegt(data: MenuData, characterIndex: number, kind: EquipSlotKind): number {
  const c = data.savemap.characters[characterIndex];
  if (!c || kind === 'accessory') return 0;
  const von = kind === 'weapon' ? 0 : CHAR.materiaWeaponSlots;
  const bis = kind === 'weapon' ? CHAR.materiaWeaponSlots : CHAR.materiaSlots;
  return c.materia.slice(von, bis).filter((m) => m.id !== EMPTY).length;
}
