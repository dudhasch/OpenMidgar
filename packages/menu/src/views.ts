import { INVENTORY_RANGES } from '@webmidgar/formats-kernel';
import {
  CHAR,
  LIMIT_BITS,
  MENU_ITEM_ORDER,
  ROW_BACK,
  ROW_FRONT,
  type CharacterRecord,
  type MateriaSlot,
} from '@webmidgar/formats-save';
import { formatNumber, formatRatio, barFill } from './format.js';
import { characterLabel, type MenuData, type MenuRow, type MenuViewModel } from './model.js';

/**
 * Die in Welle 1 fehlenden Menüansichten (F24-B, Teil 2) — **ausschließlich
 * lesend**.
 *
 * 🔵 Es gibt hier keinen Schreibpfad und keine Aktion. Ausrüsten, Benutzen,
 * Umsortieren und Materiatausch sind eine spätere Welle. Eine Ansicht, die
 * scheinbar handelt, aber nichts ändert, wäre schlechter als eine, die
 * erkennbar nur zeigt.
 *
 * **Belegstand der Felder, die diese Ansichten lesen** (Probe
 * `tools/realdata-scan/src/menu-views-probe.rdtest.ts`):
 *
 *  - 🟢 Waffe (0x1C): Kreuzprobe gegen `equipableBy` aus `KERNEL.BIN`, 49/49
 *    gegen Kontrollniveau 0/49.
 *  - 🟡 Rüstung (0x1D) und Accessoire (0x1E): nur über den Wertebereich. Die
 *    Kreuzprobe kann sie nicht stützen, weil 30 der 32 Rüstungen von jeder
 *    Figur getragen werden dürfen.
 *  - 🟢 Materiaplätze 0…7 gehören zur Waffe, 8…15 zur Rüstung: 141/141 gegen
 *    Kontrollniveau 120/141 (vertauschte Zuordnung).
 *  - 🟢 Limitstufe (0x0E) 63/63 gegen 0/63 der vier Nachbarspalten;
 *    Limitmaske (0x22) 63/63 gegen 0/0/45/49.
 *  - 🟢 Kampfreihe (0x20): im Bestand ausschließlich 0xFE/0xFF — damit ist die
 *    widersprüchliche Fremdbeschreibung entschieden.
 *  - 🟡 Materiastufe: Der Faktor zwischen gespeicherten AP und den
 *    Schwellwerten ist **nicht** entschieden. Faktor 1 ist widerlegt
 *    (13 Überläufe), 10 und 100 sind beide überlaufsfrei — die Stände liegen
 *    zu früh im Spiel, um sie zu trennen.
 *  - 🔴 Zauber je Materia: Die Attributbytes tragen nachweislich eine
 *    geordnete Indexfolge (0 steigende Records in beiden Kontrollfenstern),
 *    aber dass jeder Eintrag ein Zauberindex ist, ist offen.
 */

/** 🟡 Faktor zwischen gespeicherten AP und den Schwellen der Materiarecords. */
export const MATERIA_AP_FACTOR = 100;

/**
 * 🟢 Sättigungswert der AP-Spalte. Gemessen: Er kommt in den Spielständen der
 * Installation exakt 63-mal vor — und exakt so viele „Überläufe" erzeugte die
 * Stufenrechnung, bevor er ausgenommen wurde. Er ist keine AP-Zahl, sondern
 * die Marke „gemeistert".
 */
export const MATERIA_AP_MASTERED = 0xffffff;

const EMPTY = 0xff;

/** Name eines Ausrüstungsstücks über die bereichskodierte Inventarkennung (F18). */
function equipName(data: MenuData, index: number, base: number): string {
  if (index === EMPTY) return '—';
  return data.itemName(base + index) ?? `?${index}`;
}

function equipDescription(data: MenuData, index: number, base: number): string | null {
  if (index === EMPTY) return null;
  return data.itemDescription?.(base + index) ?? null;
}

function character(data: MenuData, characterIndex: number): CharacterRecord | null {
  return data.savemap.characters[characterIndex] ?? null;
}

function leereAnsicht(view: MenuViewModel['view'], titel: string): MenuViewModel {
  return {
    view,
    title: titel,
    rows: [{ key: 'leer', label: '', value: 'Kein Charakter', static: true }],
    selectable: [],
  };
}

// --- Ausrüstung -------------------------------------------------------------

/**
 * Ausrüstungsansicht: Waffe, Rüstung, Accessoire mit Beschreibung und der
 * Zahl der Materiaplätze, die das Stück mitbringt.
 *
 * Die Platzzahl wird **nicht** aus dem Kernel-Record gelesen, sondern aus den
 * tatsächlich belegten Materiaplätzen der Figur abgeleitet — das ist die
 * Angabe, die der Spieler sieht, und sie kommt ohne die Recordtabelle aus.
 * Die Aufteilung 0…7 Waffe / 8…15 Rüstung ist 🟢 belegt.
 */
export function buildEquipView(data: MenuData, characterIndex: number): MenuViewModel {
  const c = character(data, characterIndex);
  if (!c) return leereAnsicht('equip', 'Ausrüstung');

  const belegt = (von: number, bis: number): number =>
    c.materia.slice(von, bis).filter((m) => m.id !== EMPTY).length;

  const stueck = (key: string, label: string, index: number, base: number, plaetze: string): MenuRow => {
    const beschreibung = equipDescription(data, index, base);
    return {
      key: `c${c.index}.${key}`,
      label,
      value: `${equipName(data, index, base)}${plaetze}`,
      ...(beschreibung ? { description: beschreibung } : {}),
    };
  };

  const rows: MenuRow[] = [
    stueck('weapon', 'Waffe', c.weapon, INVENTORY_RANGES.weaponBase, `  ○${belegt(0, CHAR.materiaWeaponSlots)}`),
    stueck('armor', 'Rüstung', c.armor, INVENTORY_RANGES.armorBase, `  ○${belegt(CHAR.materiaWeaponSlots, 16)}`),
    stueck('accessory', 'Accessoire', c.accessory, INVENTORY_RANGES.accessoryBase, ''),
    {
      key: `c${c.index}.row`,
      label: 'Reihe',
      value: c.row === ROW_BACK ? 'hinten' : c.row === ROW_FRONT ? 'vorne' : `unbekannt (0x${c.row.toString(16)})`,
      static: true,
    },
  ];

  const notes = [
    'Rüstung und Accessoire 🟡 — die Kreuzprobe über `equipableBy` trennt sie nicht (30 von 32 Rüstungen sind für alle Figuren freigegeben)',
  ];
  return { view: 'equip', title: `Ausrüstung — ${characterLabel(c)}`, rows, selectable: [0, 1, 2], notes };
}

// --- Materia ----------------------------------------------------------------

export interface MateriaLevelInfo {
  /** Stufe 1…5; `null`, wenn keine Schwellen bekannt sind. */
  level: number | null;
  mastered: boolean;
  /** AP-Anzeige: Zahl oder „Meister". */
  apText: string;
}

/**
 * Stufe einer getragenen Materia. 🟡 in der Stufe, 🟢 in der Meistermarke —
 * siehe {@link MATERIA_AP_FACTOR} und {@link MATERIA_AP_MASTERED}.
 */
export function materiaLevel(slot: MateriaSlot, thresholdsRaw: readonly number[] | null): MateriaLevelInfo {
  if (slot.ap === MATERIA_AP_MASTERED) return { level: null, mastered: true, apText: 'Meister' };
  const apText = formatNumber(slot.ap);
  if (!thresholdsRaw || thresholdsRaw.length === 0) return { level: null, mastered: false, apText };
  const schwellen = thresholdsRaw.map((s) => s * MATERIA_AP_FACTOR).filter((s) => s > 0);
  return { level: 1 + schwellen.filter((s) => slot.ap >= s).length, mastered: false, apText };
}

/**
 * Materiaansicht einer Figur: 16 Plätze in Speicherreihenfolge. Ein leerer
 * Platz bleibt sichtbar leer — sonst ließe sich nicht erkennen, welcher Platz
 * frei ist, und genau das ist die Frage, die diese Ansicht beantwortet.
 */
export function buildMateriaView(data: MenuData, characterIndex: number): MenuViewModel {
  const c = character(data, characterIndex);
  if (!c) return leereAnsicht('materia', 'Materia');

  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  c.materia.forEach((m, i) => {
    const traeger = i < CHAR.materiaWeaponSlots ? 'W' : 'R';
    const key = `c${c.index}.m${i}`;
    if (m.id === EMPTY) {
      rows.push({ key, label: `${traeger}${(i % CHAR.materiaWeaponSlots) + 1}`, value: '— leer —', static: true });
      return;
    }
    selectable.push(rows.length);
    const rec = data.materiaRecords?.[m.id] ?? null;
    const stufe = materiaLevel(m, rec?.apLevelsRaw ?? null);
    const name = data.materiaName?.(m.id) ?? `?${m.id}`;
    const stufenText = stufe.mastered ? '★' : stufe.level === null ? '' : `Lv ${stufe.level}`;
    rows.push({
      key,
      label: `${traeger}${(i % CHAR.materiaWeaponSlots) + 1}  ${name}`,
      value: `${stufenText}  AP ${stufe.apText}`.trim(),
    });
  });

  const notes: string[] = [];
  if (!data.materiaName) notes.push('Keine Materia-Namensliste geladen — Kennungen statt Namen');
  if (!data.materiaRecords) notes.push('Keine Materia-Recordtabelle geladen — keine Stufe');
  else notes.push('Materiastufe 🟡 — der AP-Faktor (10 oder 100) ist an den vorhandenen Ständen nicht entscheidbar');

  return { view: 'materia', title: `Materia — ${characterLabel(c)}`, rows, selectable, notes };
}

/** Materiavorrat der Gruppe (nicht ausgerüstet). 🟡 Feldlage nicht abgegrenzt. */
export function buildPartyMateriaRows(data: MenuData): MenuRow[] {
  return data.savemap.partyMateria.map((m, i) => {
    const rec = data.materiaRecords?.[m.id] ?? null;
    const stufe = materiaLevel(m, rec?.apLevelsRaw ?? null);
    return {
      key: `pm${i}`,
      label: data.materiaName?.(m.id) ?? `?${m.id}`,
      value: `${stufe.mastered ? '★' : stufe.level === null ? '' : `Lv ${stufe.level}`}  AP ${stufe.apText}`.trim(),
    };
  });
}

// --- Zauber -----------------------------------------------------------------

/**
 * Zauberansicht: die Zauber, die die ausgerüstete Materia gewährt.
 *
 * 🔴 **Die Zuordnung ist eine Annahme, und die Ansicht sagt das.** Gemessen
 * ist nur, dass die sechs Attributbytes eines Materiarecords eine geordnete,
 * hinten mit 0xFF aufgefüllte Indexfolge tragen (45 von 79 Records streng
 * steigend; in beiden gleich großen Kontrollfenstern **0**). Dass jeder
 * Eintrag ein Index in die Zauberliste ist, folgt daraus nicht — und der
 * Versuch, die steigenden Records über den Materiatyp zu isolieren, ist
 * gescheitert.
 *
 * Deshalb: Die Ansicht zeigt die aufgelösten Namen, **nennt aber die Materia
 * dazu**, aus der sie stammen. So bleibt jede Zeile auf ihre Quelle
 * zurückführbar, und ein falsch aufgelöster Name fällt auf, statt sich als
 * Tatsache zu tarnen.
 */
export function buildMagicView(data: MenuData, characterIndex: number): MenuViewModel {
  const c = character(data, characterIndex);
  if (!c) return leereAnsicht('magic', 'Zauber');

  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  const gesehen = new Set<number>();
  for (const m of c.materia) {
    if (m.id === EMPTY) continue;
    const rec = data.materiaRecords?.[m.id];
    if (!rec) continue;
    const quelle = data.materiaName?.(m.id) ?? `?${m.id}`;
    for (const attr of rec.attributesRaw) {
      if (attr === EMPTY) break;
      if (gesehen.has(attr)) continue;
      gesehen.add(attr);
      const name = data.magicName?.(attr);
      if (!name) continue;
      selectable.push(rows.length);
      rows.push({ key: `z${attr}`, label: name, value: quelle });
    }
  }
  if (rows.length === 0) rows.push({ key: 'leer', label: '', value: 'Keine Zauber', static: true });

  const notes = ['Zauberzuordnung 🔴 — aus den Attributbytes der Materia abgeleitet, nicht belegt; die zweite Spalte nennt die Quelle'];
  if (!data.magicName) notes.push('Keine Zauber-Namensliste geladen');
  if (!data.materiaRecords) notes.push('Keine Materia-Recordtabelle geladen');
  return { view: 'magic', title: `Zauber — ${characterLabel(c)}`, rows, selectable, notes };
}

// --- Limit ------------------------------------------------------------------

/**
 * Limitansicht: Stufe, Balken und die sieben Limitzeilen. Welche Zeile gelernt
 * ist, steht in der Bitmaske `limitsLearned` — 🟢 über die Lückentreue der
 * Maske belegt (63/63 gegen 0/63 der Nachbarspalten).
 *
 * Die **Namen** der Limits stehen nicht in der Savemap; sie liegen in
 * `KERNEL.BIN` als Befehlsliste, deren Zuordnung zu Figur und Zeile hier nicht
 * gemessen ist. Die Ansicht zeigt deshalb Stufe und Zeile („1-1", „1-2", …)
 * statt erfundener Namen.
 */
export function buildLimitView(data: MenuData, characterIndex: number): MenuViewModel {
  const c = character(data, characterIndex);
  if (!c) return leereAnsicht('limit', 'Limit');

  const rows: MenuRow[] = [
    { key: `c${c.index}.limitlevel`, label: 'Limitstufe', value: formatNumber(c.limitLevel), static: true },
    {
      key: `c${c.index}.limitbar`,
      label: 'Limitbalken',
      value: c.limitBar >= 255 ? 'bereit' : `${formatNumber(c.limitBar)}/255`,
      fill: barFill(Math.min(c.limitBar, 255), 255),
      static: true,
    },
  ];
  LIMIT_BITS.forEach((bit, i) => {
    const stufe = Math.floor(i / 2) + 1;
    const zeile = (i % 2) + 1;
    rows.push({
      key: `c${c.index}.limit${bit}`,
      label: `Limit ${stufe}-${zeile}`,
      value: ((c.limitsLearned >> bit) & 1) === 1 ? 'gelernt' : '—',
      static: true,
    });
  });

  return {
    view: 'limit',
    title: `Limit — ${characterLabel(c)}`,
    rows,
    selectable: [],
    notes: ['Limitnamen 🔴 — die Zuordnung Figur × Zeile → Befehlsliste ist nicht gemessen; gezeigt wird die Zeilennummer'],
  };
}

// --- PHS (Gruppenwechsel) ---------------------------------------------------

/**
 * PHS-Ansicht: alle neun Figurenplätze mit ihrem Zustand — in der Gruppe,
 * verfügbar, oder nie beschrieben.
 *
 * `phsAllowed`/`phsVisible` werden **roh** mit angezeigt und nicht gedeutet:
 * In den Spielständen der Installation trägt `phsVisible` Bits jenseits der
 * neun Figurenplätze (gemessen 0x63F), was die dokumentierte Bitbedeutung
 * nicht hergibt. Statt die Abweichung wegzudeuten, steht sie in der Ansicht.
 */
export function buildPhsView(data: MenuData): MenuViewModel {
  const inGruppe = new Set(data.savemap.party.filter((p): p is number => p !== null));
  const rows: MenuRow[] = [];
  const selectable: number[] = [];

  data.savemap.characters.forEach((c) => {
    const key = `phs${c.index}`;
    if (!c.used) {
      rows.push({ key, label: `Platz ${c.index + 1}`, value: '— nicht im Spiel —', static: true });
      return;
    }
    const erlaubt = ((data.savemap.settings.phsAllowed >> c.id) & 1) === 1;
    const zustand = inGruppe.has(c.id) ? 'in der Gruppe' : erlaubt ? 'verfügbar' : 'gesperrt';
    selectable.push(rows.length);
    rows.push({
      key,
      label: characterLabel(c),
      value: `Lv ${formatNumber(c.level)}  HP ${formatRatio(c.hp, c.hpMax)}  ${zustand}`,
      fill: barFill(c.hp, c.hpMax),
    });
  });

  rows.push({
    key: 'phsroh',
    label: 'Bitmasken',
    value: `erlaubt 0x${data.savemap.settings.phsAllowed.toString(16).toUpperCase()} · sichtbar 0x${data.savemap.settings.phsVisible.toString(16).toUpperCase()}`,
    static: true,
  });

  return {
    view: 'phs',
    title: 'PHS — Gruppenwechsel',
    rows,
    selectable,
    notes: ['Wechseln ist nicht umgesetzt — diese Welle zeigt nur an', 'PHS-Bitmasken 🟡 — die Bitbedeutung ist nicht gemessen'],
  };
}

// --- Konfiguration ----------------------------------------------------------

/** Menüpunkte, die der Spielstand gerade zulässt (🟡, Bitreihenfolge übernommen). */
export function menuItemStates(
  data: MenuData,
): Array<{ key: (typeof MENU_ITEM_ORDER)[number]; visible: boolean; locked: boolean }> {
  const { menuVisible, menuLocked } = data.savemap.settings;
  return MENU_ITEM_ORDER.map((key, bit) => ({
    key,
    visible: ((menuVisible >> bit) & 1) === 1,
    locked: ((menuLocked >> bit) & 1) === 1,
  }));
}

/**
 * Konfigurationsansicht.
 *
 * 🟡 **Die Bitbedeutungen sind nicht gemessen.** Deshalb zeigt die Ansicht die
 * Rohwerte mit — wer sie deuten will, sieht die Zahl, aus der die Deutung
 * kommt. Das ist der Unterschied zwischen „Kamera: automatisch" und „Kamera:
 * automatisch (aus Optionen 0x4455, Bit 8)".
 */
export function buildConfigView(data: MenuData): MenuViewModel {
  const s = data.savemap.settings;
  const hex = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(4, '0')}`;
  const rows: MenuRow[] = [
    { key: 'cfg.options', label: 'Optionen (roh)', value: hex(s.options), static: true },
    { key: 'cfg.battlespeed', label: 'Kampftempo', value: `${formatNumber(s.battleSpeed)}/255`, fill: s.battleSpeed / 255, static: true },
    { key: 'cfg.battlemsg', label: 'Kampfmeldungen', value: `${formatNumber(s.battleMessageSpeed)}/255`, fill: s.battleMessageSpeed / 255, static: true },
    { key: 'cfg.fieldmsg', label: 'Feldmeldungen', value: `${formatNumber(s.fieldMessageSpeed)}/255`, fill: s.fieldMessageSpeed / 255, static: true },
    { key: 'cfg.disc', label: 'CD', value: formatNumber(s.disc), static: true },
    { key: 'cfg.menuvisible', label: 'Menü sichtbar', value: hex(s.menuVisible), static: true },
    { key: 'cfg.menulocked', label: 'Menü gesperrt', value: hex(s.menuLocked), static: true },
  ];
  for (const m of menuItemStates(data)) {
    rows.push({
      key: `cfg.item.${m.key}`,
      label: `  ${m.key}`,
      value: !m.visible ? 'ausgeblendet' : m.locked ? 'gesperrt' : 'frei',
      static: true,
    });
  }
  return {
    view: 'config',
    title: 'Konfiguration',
    rows,
    selectable: [],
    notes: ['Sämtliche Bitbedeutungen 🟡 — übernommene Tatsachenangabe, an den Realdaten nicht nachgemessen'],
  };
}
