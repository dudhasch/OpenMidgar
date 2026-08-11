import type { KernelContainer } from './container.js';
import { NAME_LIST_COUNTS } from './records.js';

/**
 * Typisierte Recordtabellen von `kernel.bin` — Gegenstände, Waffen, Rüstungen,
 * Accessoires, Materia (F18/F24-A, Zusatzteil).
 *
 * Bis hierher kannte `formats-kernel` von diesen Sektionen nur die
 * *Schrittweitenerkennung* (`smallestStride`) — eine Zahl ohne Belegung. Die
 * Feldlagen stammen aus `docs/fremdquellen/elena.md` §4 (Tatsachenbeschreibung,
 * kein Fremdcode). Übernommen wird davon **nichts ungeprüft**: Was an den
 * Realdaten nachgemessen ist, steht als 🟢 an der Zeile, alles andere als 🟡.
 *
 * **Was gemessen ist** (`data/kernel/KERNEL.BIN` der Installation, deutsche
 * Fassung; Probe `tools/realdata-scan/src/kernel-records-probe.rdtest.ts`):
 *
 *  - 🟢 **Accounting aller fünf Sektionen geht byteexakt auf:**
 *    128 × 28 = 3584 · 128 × 44 = 5632 · 32 × 36 = 1152 · 32 × 16 = 512 ·
 *    96 × 20 = 1920. Die Recordzahlen sind dabei nicht angenommen, sondern
 *    die Stringanzahlen der zugehörigen Namenslisten.
 *  - 🟢 **Waffe 0x06 = Wachstumsrate:** nimmt über alle 128 Records nur die
 *    Werte 0…3 an (21 · 85 · 20 · 2). Kontrollniveau sind die Nachbarspalten
 *    0x05, 0x07, 0x08 — sie reichen bis 255.
 *  - 🟢 **Materia 0x00…0x07 = vier aufsteigende AP-Schwellen:** in 79 von 79
 *    belegten Records gilt AP2 ≤ AP3 ≤ AP4 ≤ AP5, in 0 von 79 die
 *    Gegenrichtung. Kontrollniveau sind dieselben Monotonieproben auf den
 *    u16-Quadrupeln ab 0x08/0x0A/0x0C: 27/96, 41/96, 41/96.
 *  - 🟢 **Restriktionsfelder sind bitinvertiert:** Bei den Gegenständen tragen
 *    128 von 128 Records an 0x0A die Bits 3–15 gesetzt, während die unteren
 *    drei Bits sechs verschiedene Belegungen annehmen. Ein Feld, das oben
 *    durchgehend 1 ist und unten variiert, ist eine **Verbots**maske; die
 *    Erlaubnismaske ist ihr Komplement.
 *
 * 🔴 Offen: Elena liest das Accessoire-Feld 0x08 als `u32`, castet es aber auf
 * einen Index-Enum; bei 16 Byte Recordlänge kann beides nicht stimmen. Das Feld
 * bleibt hier **roh** und ohne Deutung.
 */

export type KernelDataRole = 'item' | 'weapon' | 'armor' | 'accessory' | 'materia';

/**
 * Recordgrößen. 🟢 An den Realdaten über Accounting belegt (Recordzahl ×
 * Größe == Sektionslänge, für alle fünf Sektionen exakt).
 */
export const RECORD_SIZES: Readonly<Record<KernelDataRole, number>> = {
  item: 28,
  weapon: 44,
  armor: 36,
  accessory: 16,
  materia: 20,
};

/**
 * Reihenfolge des Recordblocks. 🟢 Realdaten: Die fünf Tabellen liegen als
 * geschlossener Lauf in genau dieser Folge; das Accounting geht nur an einer
 * einzigen Stelle der Datei auf (siehe `resolveKernelDataSections`).
 */
export const DATA_ROLE_ORDER: readonly KernelDataRole[] = ['item', 'weapon', 'armor', 'accessory', 'materia'];

/** Recordzahl je Rolle — identisch mit der Stringanzahl der Namensliste. */
export const RECORD_COUNTS: Readonly<Record<KernelDataRole, number>> = {
  item: NAME_LIST_COUNTS.items,
  weapon: NAME_LIST_COUNTS.weapons,
  armor: NAME_LIST_COUNTS.armor,
  accessory: NAME_LIST_COUNTS.accessories,
  materia: NAME_LIST_COUNTS.materia,
};

export interface KernelDataSection {
  role: KernelDataRole;
  sectionIndex: number;
  recordSize: number;
  recordCount: number;
  /** Sektionslänge in Byte; per Definition `recordSize * recordCount`. */
  length: number;
}

export interface KernelDataSections {
  item: KernelDataSection | null;
  weapon: KernelDataSection | null;
  armor: KernelDataSection | null;
  accessory: KernelDataSection | null;
  materia: KernelDataSection | null;
  reason: string | null;
}

/**
 * Findet die fünf Recordtabellen über **Accounting**, nicht über feste
 * Sektionsnummern: Gesucht wird der Lauf von fünf aufeinanderfolgenden
 * Sektionen, deren Längen der Reihe nach `recordCount × recordSize` ergeben.
 *
 * Warum ein Lauf und nicht Sektion für Sektion? Weil die Einzellänge
 * mehrdeutig ist: In der Realdatei tragen die Sektionen 1 und 4 beide 3584
 * Byte (Angriffsdaten 256 × 14 gegen Gegenstände 128 × 28). Erst die
 * Forderung, dass alle fünf Längen *in Folge* aufgehen, ist eindeutig — sie
 * trifft in der Realdatei genau einmal zu.
 *
 * Gibt es keinen oder mehr als einen Lauf, wird **nicht geraten**.
 */
export function resolveKernelDataSections(
  container: KernelContainer,
  counts: Readonly<Record<KernelDataRole, number>> = RECORD_COUNTS,
): KernelDataSections {
  const erwartet = DATA_ROLE_ORDER.map((role) => ({ role, size: RECORD_SIZES[role], count: counts[role] }));
  const treffer: number[] = [];
  for (let i = 0; i + erwartet.length <= container.sections.length; i++) {
    let passt = true;
    for (let k = 0; k < erwartet.length; k++) {
      const s = container.sections[i + k]!;
      const e = erwartet[k]!;
      if (!s.ok || s.data.length !== e.size * e.count) {
        passt = false;
        break;
      }
    }
    if (passt) treffer.push(i);
  }
  const leer: KernelDataSections = { item: null, weapon: null, armor: null, accessory: null, materia: null, reason: null };
  if (treffer.length === 0) {
    return { ...leer, reason: `kein Sektionslauf mit den Längen ${erwartet.map((e) => e.size * e.count).join('/')}` };
  }
  if (treffer.length > 1) {
    return { ...leer, reason: `Sektionslauf mehrdeutig: ${treffer.length} Treffer (ab Sektion ${treffer.join(', ')})` };
  }
  const start = treffer[0]!;
  const out: KernelDataSections = { ...leer };
  erwartet.forEach((e, k) => {
    out[e.role] = {
      role: e.role,
      sectionIndex: start + k,
      recordSize: e.size,
      recordCount: e.count,
      length: e.size * e.count,
    };
  });
  return out;
}

// --- Restriktionen ----------------------------------------------------------

/**
 * Erlaubnisse eines Ausrüstungs-/Gegenstandsrecords.
 *
 * ⚠️ **Die Datei speichert Verbote.** Das u16-Feld ist bitinvertiert: Ein
 * gesetztes Bit heißt „darf nicht". 🟢 An den Realdaten belegt (siehe
 * Modulkopf); die Bedeutung der einzelnen Bits ist 🟡 (Quelle: elena §4.6).
 */
export interface Restrictions {
  /** 🟡 Bit 0 der Erlaubnismaske. */
  canBeSold: boolean;
  /** 🟡 Bit 1. */
  canBeUsedInBattle: boolean;
  /** 🟡 Bit 2. */
  canBeUsedInMenu: boolean;
  /** Rohwert aus der Datei (Verbotsmaske) — für Diagnosen unverändert erhalten. */
  raw: number;
}

export const RESTRICTION_SOLD = 1;
export const RESTRICTION_BATTLE = 2;
export const RESTRICTION_MENU = 4;

/** Wandelt die gespeicherte Verbotsmaske in Erlaubnisse (bitinvertiert). */
export function decodeRestrictions(raw: number): Restrictions {
  const allowed = ~raw & 0xffff;
  return {
    canBeSold: (allowed & RESTRICTION_SOLD) !== 0,
    canBeUsedInBattle: (allowed & RESTRICTION_BATTLE) !== 0,
    canBeUsedInMenu: (allowed & RESTRICTION_MENU) !== 0,
    raw,
  };
}

// --- Recordtypen ------------------------------------------------------------

/** Ein Materiaplatz einer Waffe/Rüstung — Rohbyte, Deutung 🟡 (elena §4.11). */
export type MateriaSlotRaw = number;

export interface ItemRecord {
  index: number;
  /** 🟡 Kamerafahrt bei Benutzung. */
  cameraMovementId: number;
  /** 🟢 bitinvertiert gespeichert; Bitbedeutung 🟡. */
  restrictions: Restrictions;
  /** 🟡 Zielauswahl-Flags (elena §4.7). */
  targetData: number;
  /** 🟡 */
  attackEffectId: number;
  /** 🟡 */
  damageCalculationId: number;
  /** 🟡 */
  attackPower: number;
  /** 🟡 Statusbitmaske. */
  status: number;
  /** 🟡 Elementbitmaske. */
  element: number;
}

export interface WeaponRecord {
  index: number;
  /** 🟡 */
  targetData: number;
  /** 🟡 */
  damageCalculationId: number;
  /** 🟡 */
  attackStrength: number;
  /** 🟡 Status als **Index**, nicht als Maske (elena §4.8). */
  statusIndex: number;
  /** 🟢 nimmt in den Realdaten nur 0…3 an (0 keine, 1 normal, 2 doppelt, 3 dreifach — Deutung 🟡). */
  growthRate: number;
  /** 🟡 */
  criticalRate: number;
  /** 🟡 */
  accuracyRate: number;
  /** 🟡 */
  modelId: number;
  /** 🟡 u16-Maske über die neun Figuren. */
  equipableBy: number;
  /** 🟡 */
  attackElements: number;
  /** 🟡 acht Materiaplätze, roh. */
  materiaSlots: MateriaSlotRaw[];
  /** 🟢 bitinvertiert; Bitbedeutung 🟡. */
  restrictions: Restrictions;
}

export interface ArmorRecord {
  index: number;
  /** 🟡 0 absorbiert, 1 nullt, 2 halbiert, 0xFF normal. */
  elementDamageModifier: number;
  /** 🟡 */
  defense: number;
  /** 🟡 */
  magicDefense: number;
  /** 🟡 */
  evade: number;
  /** 🟡 */
  magicEvade: number;
  /** 🟡 Status als Index. */
  statusIndex: number;
  /** 🟡 acht Materiaplätze, roh. */
  materiaSlots: MateriaSlotRaw[];
  /** 🟡 */
  growthRate: number;
  /** 🟡 */
  equipableBy: number;
  /** 🟡 */
  elementalDefense: number;
  /** 🟡 vier verstärkte Grundwerte (0xFF = keiner) mit Bonus. */
  boostedStats: Array<{ stat: number; bonus: number }>;
  /** 🟢 bitinvertiert; Bitbedeutung 🟡. */
  restrictions: Restrictions;
}

export interface AccessoryRecord {
  index: number;
  /** 🟡 zwei verstärkte Grundwerte mit Bonus. */
  boostedStats: Array<{ stat: number; bonus: number }>;
  /** 🟡 */
  elementalDamageModifier: number;
  /** 🟡 Sondereffekt (elena §4.12). */
  specialEffect: number;
  /** 🟡 */
  elementalDefense: number;
  /** 🔴 Elena liest hier u32 und castet auf einen Index-Enum — das widerspricht
   * sich bei 16 B Recordlänge. Bleibt roh und ohne Deutung. */
  statusDefenseRaw: number;
  /** 🟡 */
  equipableBy: number;
  /** 🟢 bitinvertiert; Bitbedeutung 🟡. */
  restrictions: Restrictions;
}

export interface MateriaRecord {
  index: number;
  /**
   * 🟢 vier aufsteigende AP-Schwellen für die Stufen 2…5 (Monotonie 79/79
   * gegen Kontrolle 27…41/96). 🟡 Der Faktor 100 („Wert × 100 = echte AP")
   * ist **nicht** nachgemessen — deshalb steht hier der Rohwert.
   */
  apLevelsRaw: number[];
  /** 🟡 Element als Index 0x00…0x0F, nicht als Maske. */
  elementIndex: number;
  /** 🟡 Materiatyp, nur die unteren vier Bit von 0x0D. */
  typeNibble: number;
  /** Vollständiges Byte 0x0D — die oberen vier Bit sind 🔴 ungedeutet. */
  typeRaw: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function slots(bytes: Uint8Array, base: number, from: number): MateriaSlotRaw[] {
  const out: MateriaSlotRaw[] = [];
  for (let i = 0; i < 8; i++) out.push(bytes[base + from + i]!);
  return out;
}

/** Zerlegt eine Recordsektion in Records fester Größe. `null`, wenn die Länge nicht aufgeht. */
function records(container: KernelContainer, sec: KernelDataSection | null): { data: Uint8Array; base: (i: number) => number } | null {
  if (!sec) return null;
  const section = container.sections[sec.sectionIndex];
  if (!section || !section.ok || section.data.length !== sec.length) return null;
  return { data: section.data, base: (i: number) => i * sec.recordSize };
}

export function readItemRecords(container: KernelContainer, sections: KernelDataSections): ItemRecord[] {
  const r = records(container, sections.item);
  if (!r) return [];
  const v = view(r.data);
  const out: ItemRecord[] = [];
  for (let i = 0; i < sections.item!.recordCount; i++) {
    const b = r.base(i);
    out.push({
      index: i,
      cameraMovementId: v.getUint16(b + 0x08, true),
      restrictions: decodeRestrictions(v.getUint16(b + 0x0a, true)),
      targetData: r.data[b + 0x0c]!,
      attackEffectId: r.data[b + 0x0d]!,
      damageCalculationId: r.data[b + 0x0e]!,
      attackPower: r.data[b + 0x0f]!,
      status: v.getUint32(b + 0x14, true),
      element: v.getUint16(b + 0x18, true),
    });
  }
  return out;
}

export function readWeaponRecords(container: KernelContainer, sections: KernelDataSections): WeaponRecord[] {
  const r = records(container, sections.weapon);
  if (!r) return [];
  const v = view(r.data);
  const out: WeaponRecord[] = [];
  for (let i = 0; i < sections.weapon!.recordCount; i++) {
    const b = r.base(i);
    out.push({
      index: i,
      targetData: r.data[b + 0x00]!,
      damageCalculationId: r.data[b + 0x02]!,
      attackStrength: r.data[b + 0x04]!,
      statusIndex: r.data[b + 0x05]!,
      growthRate: r.data[b + 0x06]!,
      criticalRate: r.data[b + 0x07]!,
      accuracyRate: r.data[b + 0x08]!,
      modelId: r.data[b + 0x09]!,
      equipableBy: v.getUint16(b + 0x0e, true),
      attackElements: v.getUint16(b + 0x10, true),
      materiaSlots: slots(r.data, b, 0x1c),
      restrictions: decodeRestrictions(v.getUint16(b + 0x2a, true)),
    });
  }
  return out;
}

export function readArmorRecords(container: KernelContainer, sections: KernelDataSections): ArmorRecord[] {
  const r = records(container, sections.armor);
  if (!r) return [];
  const v = view(r.data);
  const out: ArmorRecord[] = [];
  for (let i = 0; i < sections.armor!.recordCount; i++) {
    const b = r.base(i);
    const boostedStats = [0, 1, 2, 3].map((k) => ({ stat: r.data[b + 0x18 + k]!, bonus: r.data[b + 0x1c + k]! }));
    out.push({
      index: i,
      elementDamageModifier: r.data[b + 0x01]!,
      defense: r.data[b + 0x02]!,
      magicDefense: r.data[b + 0x03]!,
      evade: r.data[b + 0x04]!,
      magicEvade: r.data[b + 0x05]!,
      statusIndex: r.data[b + 0x06]!,
      materiaSlots: slots(r.data, b, 0x09),
      growthRate: r.data[b + 0x11]!,
      equipableBy: v.getUint16(b + 0x12, true),
      elementalDefense: v.getUint16(b + 0x14, true),
      boostedStats,
      restrictions: decodeRestrictions(v.getUint16(b + 0x20, true)),
    });
  }
  return out;
}

export function readAccessoryRecords(container: KernelContainer, sections: KernelDataSections): AccessoryRecord[] {
  const r = records(container, sections.accessory);
  if (!r) return [];
  const v = view(r.data);
  const out: AccessoryRecord[] = [];
  for (let i = 0; i < sections.accessory!.recordCount; i++) {
    const b = r.base(i);
    out.push({
      index: i,
      boostedStats: [0, 1].map((k) => ({ stat: r.data[b + k]!, bonus: r.data[b + 0x02 + k]! })),
      elementalDamageModifier: r.data[b + 0x04]!,
      specialEffect: r.data[b + 0x05]!,
      elementalDefense: v.getUint16(b + 0x06, true),
      statusDefenseRaw: v.getUint32(b + 0x08, true),
      equipableBy: v.getUint16(b + 0x0c, true),
      restrictions: decodeRestrictions(v.getUint16(b + 0x0e, true)),
    });
  }
  return out;
}

export function readMateriaRecords(container: KernelContainer, sections: KernelDataSections): MateriaRecord[] {
  const r = records(container, sections.materia);
  if (!r) return [];
  const v = view(r.data);
  const out: MateriaRecord[] = [];
  for (let i = 0; i < sections.materia!.recordCount; i++) {
    const b = r.base(i);
    out.push({
      index: i,
      apLevelsRaw: [0, 2, 4, 6].map((o) => v.getUint16(b + o, true)),
      elementIndex: r.data[b + 0x0c]!,
      typeNibble: r.data[b + 0x0d]! & 0x0f,
      typeRaw: r.data[b + 0x0d]!,
    });
  }
  return out;
}
