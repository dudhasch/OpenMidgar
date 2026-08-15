import { buildAsciiTable, decodeFfText, DEFAULT_ASCII_OFFSET, type FfTextTable } from '@webmidgar/formats-kernel';

/**
 * Savemap-Leser (S21) — die Feldlage **innerhalb** eines originalen 4340-Byte-
 * Slots. S14 hatte den Slot bewusst nur als Rohbytes geliefert; erst das Menü
 * braucht seinen Inhalt.
 *
 * **Alle Konstanten hier sind aus den Realdaten abgeleitet, keine übernommen**
 * (Probe `menu-savemap-probe.rdtest.ts`, Befunde in FINDINGS.md):
 *
 *  - Die **Schrittweite 132** kommt aus dem Namensraster: FF-Text-Namen (die
 *    Zeichentabelle ist seit S13 belegt) treffen bei 100 + i·132; dieselbe
 *    Suche auf verwürfelten Slots liefert **0 Treffer**.
 *  - Die **Basis 84** kommt aus der Kennungsspalte: Genau eine Spalte des
 *    Rasters trägt in jedem Record einen Wert ≤ 10 und nimmt neun verschiedene
 *    Werte an. Sie liegt 16 Byte vor dem Namen.
 *  - **Level** ist über die Konkordanz mit dem HP-Maximum belegt (0,974 gegen
 *    ein Kontrollniveau von 0,638 bei verwürfelter Zuordnung).
 *  - **HP/MP** über Ordnungspaare (aktuell ≤ Maximum, ausnahmslos) und ihre
 *    Wertebereiche: Die MP-Felder erreichen exakt 999.
 *  - **Gil und Spielzeit** über Duplikatgruppen (beide stehen zweimal im Slot)
 *    und werden über die Konkordanz beider Reihen auseinandergehalten (0,885).
 *  - **Party und Inventar** liegen unmittelbar hinter dem Recordarray; der
 *    Inventareintrag teilt sich in 7 Bit Anzahl und 9 Bit Kennung, entschieden
 *    über die Verteilung der Anzahl (nur diese Aufteilung kennt „Anzahl 1").
 *
 * Was nicht gemessen ist, steht als 🟡 an der Konstanten — und wird gelesen,
 * aber nicht gedeutet.
 */

/** Slotlänge des Originalformats (S14). */
export const SAVEMAP_SLOT_LEN = 4340;

/** Vorschaublock: Slot 4…83. Ergibt sich aus der Recordbasis, ist nicht gesetzt. */
export const SAVEMAP_PREVIEW_FROM = 4;
export const SAVEMAP_DATA_FROM = 84;

export const CHARACTER_RECORD_BASE = 84;
export const CHARACTER_RECORD_LEN = 132;
export const CHARACTER_RECORD_COUNT = 9;

/** Feldlage **innerhalb** eines Charakterrecords. */
export const CHAR = {
  /** Figurenkennung 0…10 (neun spielbare plus zwei Sonderfassungen). */
  id: 0,
  level: 1,
  /** 🟡 Sechs Grundwerte; die Reihenfolge ist aus dem Wertebereich plausibel, nicht belegt. */
  stats: 2,
  statsCount: 6,
  /**
   * 🟡 **Sechs „Quellen"-Boni** (Kraftquelle, Wächterquelle …), index-für-index
   * auf die Grundwerte addiert. Der wirksame Grundwert einer Figur ist also
   * `stats[i] + sourceBonus[i]` — wer nur `stats` liest, rechnet mit zu
   * kleinen Werten, sobald der Spieler Quellen benutzt hat.
   *
   * Die Lage folgt aus dem Recordraster: Sie füllt genau die sechs Bytes
   * zwischen den Grundwerten und der Limitstufe (@14), und nur diese Deutung
   * lässt keine Lücke.
   *
   * ⚠️ **An unseren Spielständen NICHT prüfbar**: alle sechs Bytes sind in
   * 63 von 63 Records null. Die Deutung stammt aus dem EXE-Bestand; eine
   * Wache in `savemap-felder.rdtest.ts` schlägt an, sobald ein Spielstand
   * benutzte Quellen trägt.
   */
  sourceBonus: 8,
  sourceBonusCount: 6,
  name: 16,
  nameLen: 12,
  /**
   * Ausrüstungskennungen — **Indizes in die jeweilige Kernel-Recordtabelle**,
   * nicht Inventarkennungen. 0xFF heißt „nichts ausgerüstet".
   *
   * 🟢 **Die Waffe (0x1C) ist über eine Kreuzprobe belegt** (F24-B, V2): Für
   * jeden der 49 spielbaren Charakterrecords der echten Spielstände ist in der
   * `equipableBy`-Maske des so bestimmten Waffenrecords das Bit der eigenen
   * Figurenkennung gesetzt — 49/49. Kontrollniveau ist dieselbe Prüfung mit
   * der Kennung der nächsten Figur: **0/49**. Die Probe ist trennscharf, weil
   * **keine** der 128 Waffen die Vollmaske trägt (0/128).
   *
   * 🟡 Rüstung (0x1D) und Accessoire (0x1E) sind nur über den Wertebereich
   * gestützt. Dieselbe Kreuzprobe kann sie nicht trennen: 30 der 32 Rüstungen
   * tragen die Vollmaske, also trifft dort auch die verschobene Zuordnung
   * 49/49. Das ist ein Befund über die Daten, kein Messfehler — und der Grund,
   * warum hier 🟡 und nicht 🟢 steht.
   */
  weapon: 28,
  armor: 29,
  accessory: 30,
  hp: 44,
  /**
   * 🟢 F12 gelöst (ff7tk `Type_FF7CHAR.h`): @46/@50 liegen die BASISWERTE
   * (ohne Ausrüstung), die echten Maxima inkl. Ausrüstungs-/Materiaboni bei
   * @56/@58 — dazwischen 4 Füllbytes. Die alte Lesung nahm die Basiswerte
   * als Maximum, daher Anzeigen wie „MP 122/116" (aktuell > Maximum).
   */
  hpBasis: 46,
  mp: 48,
  mpBasis: 50,
  hpMax: 56,
  mpMax: 58,
  /**
   * 16 Materiaplätze à 4 Byte (Kennung + 3 Byte Erfahrung).
   *
   * 🟢 F24-B belegt, welche Plätze wohin gehören: Plätze 0…7 sitzen in der
   * **Waffe**, 8…15 in der **Rüstung**. Über 141 belegte Plätze der echten
   * Spielstände liegt kein einziger jenseits der Platzzahl, die das jeweils
   * ausgerüstete Stück in `KERNEL.BIN` mitbringt (141/141). Kontrollniveau ist
   * dieselbe Rechnung mit vertauschtem Waffen-/Rüstungsbezug: 120/141 (85,1 %).
   */
  materia: 64,
  materiaSlots: 16,
  materiaEntryLen: 4,
  /** Materiaplätze 0…7 gehören zur Waffe, 8…15 zur Rüstung (🟢, siehe oben). */
  materiaWeaponSlots: 8,
  /**
   * 🟢 Limitstufe 1…4. Belegt: 63/63 benutzte Charakterrecords liegen im
   * Bereich, die vier Nachbarspalten 0x0C/0x0D/0x0F/0x10 dagegen **0/63**.
   */
  limitLevel: 14,
  /** 🟡 Limitbalken; 0xFF soll „bereit" heißen — der Wertebereich stützt das nicht allein. */
  limitBar: 15,
  /**
   * 🟡 **Der einzige Status, der den Kampf überdauert.** Bit `0x10` = Trauer,
   * Bit `0x20` = Wut; beide schließen einander aus. Alle übrigen Zustände
   * enden mit dem Kampf und stehen deshalb nicht im Spielstand.
   *
   * ⚠️ Unsere Messung („im Bestand durchgehend 0") bleibt richtig und ist
   * kein Gegenbeleg: Keine Figur der vorliegenden Spielstände war traurig
   * oder wütend. Der Wertebereich allein konnte die Bedeutung nicht hergeben.
   */
  condition: 31,
  CONDITION_SADNESS: 0x10,
  CONDITION_FURY: 0x20,
  /**
   * 🟢 Kampfreihe — und die alte Zweideutigkeit ist **aufgelöst**.
   *
   * Die Fremdquelle nannte zwei sich widersprechende Lesarten (0/1 gegen
   * 0xFE/0xFF), unsere Messung fand ausschließlich **0xFE und 0xFF**. Beide
   * hatten recht: Das Byte ist ein **Flagfeld, und nur Bit 0 trägt die
   * Reihe** (gesetzt = vordere Reihe). `0xFF` hat Bit 0 gesetzt, `0xFE`
   * nicht — die „0/1"-Lesart beschrieb das Bit, unsere Messung das ganze
   * Byte. Deshalb ist {@link istVordereReihe} eine Bitprüfung und kein
   * Wertevergleich: Sie überlebt es, wenn ein anderes Bit dieses Bytes je
   * belegt wird.
   */
  row: 32,
  ROW_FRONT_BIT: 0x01,
  /** 🟡 Fortschritt zur nächsten Stufe, 0…255. */
  tnl: 33,
  /**
   * 🟢 Gelernte Limits als u16-Bitmaske. Die Maske ist **löchrig** — belegt
   * sind nur die Bits {0,1,3,4,6,7,9} —, und genau das ist der Beleg: 63/63
   * Records halten das Muster ein, die Nachbarspalten 0x20/0x21/0x23/0x24
   * dagegen 0/0/45/49 von 63.
   */
  limitsLearned: 34,
  /** 🟡 Zahl der Kämpfe, in denen die Figur mitgewirkt hat. */
  kills: 36,
  /**
   * 🟢 Erfahrungspunkte (u32). Belegt über die Rangkonkordanz mit der Stufe:
   * **1,000** über alle Charakterpaare mit verschiedener Stufe; Kontrollniveau
   * ist dieselbe Rechnung mit rotierter Erfahrungsreihe (0,595).
   */
  exp: 60,
  /** 🟡 Erfahrung bis zur nächsten Stufe (u32). */
  expToNext: 128,
} as const;

/** Reihenwerte des Kampfsystems — 🟢 gemessen, siehe `CHAR.row`. */
export const ROW_FRONT = 0xff;
export const ROW_BACK = 0xfe;

/**
 * Steht die Figur in der **vorderen** Reihe? Geprüft wird **Bit 0**, nicht der
 * Bytewert — siehe `CHAR.row`: Das Feld ist ein Flagfeld, in dem heute nur
 * Bit 0 belegt ist. Ein Wertevergleich gegen `0xFF` würde falsch antworten,
 * sobald irgendetwas ein weiteres Bit setzt; diese Prüfung nicht.
 */
export function istVordereReihe(row: number): boolean {
  return (row & CHAR.ROW_FRONT_BIT) !== 0;
}

/** Trägt die Figur Trauer? (Bit `0x10` von `CHAR.condition`.) */
export function hatTrauer(condition: number): boolean {
  return (condition & CHAR.CONDITION_SADNESS) !== 0;
}

/** Trägt die Figur Wut? (Bit `0x20`.) Schließt {@link hatTrauer} aus. */
export function hatWut(condition: number): boolean {
  return (condition & CHAR.CONDITION_FURY) !== 0;
}

/**
 * Bitpositionen der gelernten Limits (`CHAR.limitsLearned`). Die Lücken sind
 * echt: Sieben Limitzeilen liegen in einem 16-Bit-Feld auf den Bits
 * {0,1,3,4,6,7,9}. 🟢 Über die Lückentreue belegt (63/63 gegen 0/63 der
 * Nachbarspalten).
 */
export const LIMIT_BITS: readonly number[] = [0, 1, 3, 4, 6, 7, 9];

/** Partyaufstellung: drei Figurenkennungen, unmittelbar hinter dem Recordarray. */
export const PARTY_OFFSET = CHARACTER_RECORD_BASE + CHARACTER_RECORD_COUNT * CHARACTER_RECORD_LEN;
export const PARTY_SIZE = 3;

export const INVENTORY_OFFSET = 1276;
export const INVENTORY_ENTRIES = 320;
/** Bits der Gegenstandskennung; die oberen 7 Bit tragen die Anzahl. */
export const INVENTORY_ID_BITS = 9;

/** Gil und Spielzeit stehen doppelt im Slot — hier die Fassung des Vorschaublocks. */
export const GIL_OFFSET = 32;
export const PLAYTIME_OFFSET = 36;
/** Zweitfassung in der Savemap; muss mit der ersten übereinstimmen. */
export const GIL_OFFSET_SAVEMAP = 2940;
export const PLAYTIME_OFFSET_SAVEMAP = 2944;

/**
 * 🟢 **Ortsname — der Befund, der die geratene Ortsanzeige ablöst (F24-B).**
 *
 * Auch der Ortsname steht zweimal im Slot: im Vorschaublock (0x0028, 32 Byte)
 * und in der Savemap selbst (0x0F0C, 24 Byte), beide in FF7-Textkodierung mit
 * Terminator 0xFF.
 *
 * **Messung** (Probe `menu-views-probe.rdtest.ts`, V1, alle 8 belegten Slots
 * der Installation): Ein Sweep über **jeden** der 4340 Offsets sucht Stellen,
 * an denen in allen Slots ein terminiertes, druckbares Namensfeld von
 * mindestens vier Zeichen steht (ein komplett leeres Feld ist erlaubt und
 * heißt „kein Ort eingetragen") und das über die Slots mindestens drei
 * verschiedene Werte annimmt. Nach Abzug der Schatten — ein Treffer bei
 * `at+1` ist dieselbe Zeichenkette ohne ihr erstes Zeichen — bleiben **genau
 * zwei** eigenständige Fundstellen übrig, und das sind diese beiden.
 *
 * **Kontrollniveau:** derselbe Sweep auf byteweise verwürfelten Slots findet
 * **0** Fundstellen. Die beiden Ablagen stimmen überein, wo beide gefüllt sind
 * (7/7); die achte ist ein Notspeicherstand, dessen Savemap-Feld leer ist,
 * während der Vorschaublock „Emergency Save" trägt — genau der Grund, den
 * Vorschaublock als Ersatzquelle zu führen und nicht zu verwerfen.
 */
export const LOCATION_NAME_OFFSET = 0x0f0c;
export const LOCATION_NAME_LEN = 24;
export const PREVIEW_LOCATION_OFFSET = 0x28;
export const PREVIEW_LOCATION_LEN = 32;

/** 🟡 Karten- und Ortskennung. Wertebereiche passen; die Zuordnung zu einer Tabelle ist offen. */
export const MAP_ID_OFFSET = 0x0b94;
export const LOCATION_ID_OFFSET = 0x0b96;

/**
 * Materiavorrat der Gruppe — 200 Einträge à 4 Byte, gleiche Aufteilung wie im
 * Charakterrecord. 🟡 Im Bestand ist der Vorrat nahezu leer (6 belegte
 * Einträge über alle Slots), die Lage ist damit **nicht** gegen Nachbarn
 * abgegrenzt: Bei durchgehend 0xFF trifft jeder Versatz gleich gut.
 */
export const PARTY_MATERIA_OFFSET = 0x077c;
export const PARTY_MATERIA_ENTRIES = 200;

/**
 * Menüsteuerung und Einstellungen. 🟡 Sämtlich unbelegt in dem Sinn, dass die
 * Bitbedeutungen nicht gemessen sind; gelesen werden sie **roh**, damit die
 * Konfigurationsansicht zeigen kann, was dasteht, statt es zu erfinden.
 */
export const MENU_VISIBLE_OFFSET = 0x0bc0;
export const MENU_LOCKED_OFFSET = 0x0bc2;
export const PHS_ALLOWED_OFFSET = 0x10a4;
export const PHS_VISIBLE_OFFSET = 0x10a6;
export const OPTIONS_OFFSET = 0x10da;
export const BATTLE_SPEED_OFFSET = 0x10d8;
export const BATTLE_MSG_SPEED_OFFSET = 0x10d9;
export const FIELD_MSG_SPEED_OFFSET = 0x10ec;
export const DISC_OFFSET = 0x0ea4;

/**
 * Reihenfolge der Menüeinträge, auf die sich `menuVisible`/`menuLocked`
 * beziehen. 🟡 Aus `docs/quellen/ff7tk.md` §2.5 übernommene
 * Tatsachenangabe; an den Realdaten **nicht** nachgemessen — dafür müsste man
 * ein Spiel mit gesperrten Menüpunkten aufzeichnen.
 */
export const MENU_ITEM_ORDER = [
  'item',
  'magic',
  'materia',
  'equip',
  'status',
  'formation',
  'limit',
  'config',
  'phs',
  'save',
] as const;
export type MenuItemKey = (typeof MENU_ITEM_ORDER)[number];

/** Leerer Platz — sowohl im Inventar als auch bei Figurenkennungen. */
export const EMPTY_SLOT = 0xff;
const EMPTY_ENTRY = 0xffff;

export interface MateriaSlot {
  /** 0xFF = leer. */
  id: number;
  /** 🟡 Erfahrungspunkte als u24; die Deutung ist nicht einzeln belegt. */
  ap: number;
}

/**
 * 🟢 Sentinel für „Maximum noch nicht berechnet" bei @56/@58.
 *
 * Das Original füllt diese Felder erst beim Laden eines Kampfes, in den
 * meisten Menübildern und bei jeder Gruppenänderung. Wer nie in der Gruppe
 * war, behält den Sentinel. **Gemessen an den echten Spielständen: 24 von 63
 * benannten Records** (38 %) — das ist kein Randfall, sondern der Normalfall
 * für Figuren, die noch nicht mitgekämpft haben.
 */
export const MAXIMUM_UNBERECHNET = 0xffff;

/**
 * Wirksames Maximum: das berechnete, sonst der Basiswert.
 *
 * Steht bewusst als eine Funktion da und nicht zweimal als Bedingung — die
 * Klemmung im Schreibpfad (`setCharacterPoints`) braucht dieselbe Regel wie
 * der Leser, und zwei Kopien wären zwei Wahrheiten. Ohne sie klemmte ein
 * „auf voll heilen" gegen 65535, also gar nicht.
 */
export function wirksamesMaximum(roh: number, basis: number): number {
  return roh === MAXIMUM_UNBERECHNET ? basis : roh;
}

export interface CharacterRecord {
  index: number;
  id: number;
  name: string;
  level: number;
  hp: number;
  /**
   * 🟢 **Wirksames** HP-Maximum. Das ist @56, **außer** die Datei trägt dort
   * `0xFFFF` — dann der Basiswert @46. Siehe {@link maximaBerechnet}.
   */
  hpMax: number;
  mp: number;
  /** 🟢 Wirksames MP-Maximum, gleiche Regel wie {@link hpMax} (@58 / @50). */
  mpMax: number;
  /** 🟢 Basiswert ohne Ausrüstung/Materia (@46), roh. */
  hpBasis: number;
  /** 🟢 Basiswert ohne Ausrüstung/Materia (@50), roh. */
  mpBasis: number;
  /**
   * 🟢 Ob die Datei bei @56/@58 **berechnete** Maxima trägt.
   *
   * `0xFFFF` heißt „noch nicht berechnet", nicht 65535. Das Original füllt die
   * Felder erst beim Laden eines Kampfes, in den meisten Menübildern und bei
   * jeder Gruppenänderung — Figuren, die nie in der Gruppe waren, behalten den
   * Sentinel. **Gemessen an den echten Spielständen: 24 von 63 benannten
   * Records** (38 %) tragen ihn, quer über mehrere Slots. Ohne diese
   * Unterscheidung ginge eine Figur mit `maxHp = 65535` in den Kampf.
   */
  maximaBerechnet: boolean;
  /** 🟡 Sechs Grundwerte in Speicherreihenfolge, bewusst unbenannt. */
  stats: number[];
  weapon: number;
  armor: number;
  accessory: number;
  materia: MateriaSlot[];
  /** 🟢 Limitstufe 1…4. */
  limitLevel: number;
  /** 🟡 Limitbalken 0…255. */
  limitBar: number;
  /** 🟢 Bitmaske der gelernten Limits; siehe {@link LIMIT_BITS}. */
  limitsLearned: number;
  /** 🟢 Kampfreihe, roh. Deutung über {@link istVordereReihe} (Bit 0). */
  row: number;
  /**
   * 🟡 Der einzige Status, der den Kampf überdauert: Bit `0x10` Trauer,
   * Bit `0x20` Wut (Deutung aus dem EXE-Bestand; im Bestand durchgehend 0,
   * also nicht nachgemessen). Zugriff über {@link hatTrauer} / {@link hatWut}.
   */
  condition: number;
  /**
   * 🟡 Sechs „Quellen"-Boni, index-für-index auf {@link stats} zu addieren.
   * Der wirksame Grundwert ist `stats[i] + sourceBonus[i]`. Im vorliegenden
   * Bestand durchgehend 0 — Deutung aus dem EXE-Bestand, nicht gemessen.
   */
  sourceBonus: number[];
  /** 🟡 Fortschritt zur nächsten Stufe 0…255. */
  tnl: number;
  /** 🟡 Zahl der bestrittenen Kämpfe. */
  kills: number;
  /** 🟢 Erfahrungspunkte. */
  exp: number;
  /** 🟡 Erfahrung bis zur nächsten Stufe. */
  expToNext: number;
  /** false, wenn der Record nie beschrieben wurde (kein Name, kein HP-Maximum). */
  used: boolean;
}

/** Menüsteuerung und Einstellungen — durchweg 🟡 und deshalb roh geführt. */
export interface SavemapSettings {
  menuVisible: number;
  menuLocked: number;
  phsAllowed: number;
  phsVisible: number;
  options: number;
  battleSpeed: number;
  battleMessageSpeed: number;
  fieldMessageSpeed: number;
  disc: number;
}

export interface InventoryEntry {
  slot: number;
  itemId: number;
  count: number;
}

export interface Savemap {
  schemaVersion: 1;
  characters: CharacterRecord[];
  /** Drei Plätze; `null` steht für einen unbesetzten Platz (Sentinel 0xFF). */
  party: Array<number | null>;
  inventory: InventoryEntry[];
  /** Materiavorrat der Gruppe (nicht ausgerüstet). 🟡 Lage nicht abgegrenzt. */
  partyMateria: MateriaSlot[];
  gil: number;
  /** Spielzeit. 🟡 Einheit Sekunden — plausibel, nicht bewiesen. */
  playtimeSeconds: number;
  /**
   * 🟢 Ortsname aus der Savemap (0x0F0C). Leerstring heißt „kein Ort
   * eingetragen" — das kommt vor und wird **nicht** durch die Vorschaufassung
   * ersetzt, ohne dass es sichtbar wird (siehe {@link Savemap.locationSource}).
   */
  locationName: string;
  /** 🟢 Ortsname aus dem Vorschaublock (0x0028). */
  previewLocationName: string;
  /**
   * Welche der beiden Ablagen den angezeigten Namen liefert. `'savemap'` ist
   * der Normalfall; `'preview'` heißt, dass die Savemap-Fassung leer war;
   * `'keiner'` heißt, dass beide leer sind.
   */
  locationSource: 'savemap' | 'preview' | 'keiner';
  /** Stimmen beide Ablagen überein, wo beide gefüllt sind? */
  locationConsistent: boolean;
  /** 🟡 Kartenkennung. */
  mapId: number;
  /** 🟡 Ortskennung. */
  locationId: number;
  /** 🟡 Menüsteuerung und Einstellungen, roh. */
  settings: SavemapSettings;
  /**
   * Stimmen die beiden Ablagen von Gil und Spielzeit überein? Sie tun es im
   * Bestand immer; eine Abweichung heißt, dass der Slot anders aufgebaut ist
   * als gemessen — das gehört gemeldet und nicht überlesen.
   */
  duplicatesConsistent: boolean;
}

const NAME_TABLE: FfTextTable = buildAsciiTable(DEFAULT_ASCII_OFFSET);

function readName(view: DataView, bytes: Uint8Array, at: number): string {
  void view;
  return decodeFfText(bytes, NAME_TABLE, at, CHAR.nameLen).text.trim();
}

/**
 * Liest einen Charakterrecord. Ein nie beschriebener Record wird **nicht**
 * unterdrückt, sondern als `used: false` gemeldet: Das Menü soll leere Plätze
 * zeigen können, und ein stillschweigend weggelassener Record wäre für die
 * Fehlersuche schlechter als ein sichtbar leerer.
 */
export function readCharacterRecord(slot: Uint8Array, index: number): CharacterRecord {
  const base = CHARACTER_RECORD_BASE + index * CHARACTER_RECORD_LEN;
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  const u8 = (o: number): number => slot[base + o] ?? 0;
  const u16 = (o: number): number => (base + o + 2 <= slot.length ? view.getUint16(base + o, true) : 0);

  const stats: number[] = [];
  for (let i = 0; i < CHAR.statsCount; i++) stats.push(u8(CHAR.stats + i));
  const sourceBonus: number[] = [];
  for (let i = 0; i < CHAR.sourceBonusCount; i++) sourceBonus.push(u8(CHAR.sourceBonus + i));

  const materia: MateriaSlot[] = [];
  for (let i = 0; i < CHAR.materiaSlots; i++) {
    const at = CHAR.materia + i * CHAR.materiaEntryLen;
    materia.push({ id: u8(at), ap: u8(at + 1) | (u8(at + 2) << 8) | (u8(at + 3) << 16) });
  }

  const u32 = (o: number): number => (base + o + 4 <= slot.length ? view.getUint32(base + o, true) : 0);

  const name = readName(view, slot, base + CHAR.name);

  /**
   * 🟢 `0xFFFF` bei @56/@58 heißt „noch nicht berechnet", nicht 65535 — dann
   * gilt der Basiswert. Gemessen an den echten Spielständen: **24 von 63**
   * benannten Records tragen den Sentinel, und zwar an BEIDEN Feldern
   * gleichzeitig, nie an nur einem. Die Fallunterscheidung steht trotzdem je
   * Feld, weil „nie einzeln" eine Beobachtung über diesen Bestand ist und
   * keine Zusicherung des Formats.
   */
  const hpBasis = u16(CHAR.hpBasis);
  const mpBasis = u16(CHAR.mpBasis);
  const hpMaxRoh = u16(CHAR.hpMax);
  const mpMaxRoh = u16(CHAR.mpMax);
  const maximaBerechnet =
    hpMaxRoh !== MAXIMUM_UNBERECHNET && mpMaxRoh !== MAXIMUM_UNBERECHNET;
  const hpMax = wirksamesMaximum(hpMaxRoh, hpBasis);

  return {
    index,
    id: u8(CHAR.id),
    name,
    level: u8(CHAR.level),
    hp: u16(CHAR.hp),
    hpMax,
    mp: u16(CHAR.mp),
    mpMax: wirksamesMaximum(mpMaxRoh, mpBasis),
    hpBasis,
    mpBasis,
    maximaBerechnet,
    stats,
    weapon: u8(CHAR.weapon),
    armor: u8(CHAR.armor),
    accessory: u8(CHAR.accessory),
    materia,
    limitLevel: u8(CHAR.limitLevel),
    limitBar: u8(CHAR.limitBar),
    limitsLearned: u16(CHAR.limitsLearned),
    row: u8(CHAR.row),
    condition: u8(CHAR.condition),
    sourceBonus,
    tnl: u8(CHAR.tnl),
    kills: u16(CHAR.kills),
    exp: u32(CHAR.exp),
    expToNext: u32(CHAR.expToNext),
    used: name.length > 0 && hpMax > 0,
  };
}

/**
 * Liest ein FF7-kodiertes Namensfeld fester Länge. Ein Feld aus lauter
 * Füllzeichen ergibt den Leerstring — das ist die Aussage „nichts eingetragen"
 * und wird bewusst nicht zu `null` verallgemeinert.
 */
function readTextField(slot: Uint8Array, at: number, len: number): string {
  if (at + len > slot.length) return '';
  return decodeFfText(slot, NAME_TABLE, at, len).text.trim();
}

/** Liest den Materiavorrat der Gruppe (🟡, siehe {@link PARTY_MATERIA_OFFSET}). */
export function readPartyMateria(slot: Uint8Array): MateriaSlot[] {
  const out: MateriaSlot[] = [];
  for (let i = 0; i < PARTY_MATERIA_ENTRIES; i++) {
    const at = PARTY_MATERIA_OFFSET + i * CHAR.materiaEntryLen;
    if (at + CHAR.materiaEntryLen > slot.length) break;
    const id = slot[at]!;
    if (id === EMPTY_SLOT) continue;
    out.push({ id, ap: slot[at + 1]! | (slot[at + 2]! << 8) | (slot[at + 3]! << 16) });
  }
  return out;
}

/**
 * Liest das Inventar. Leere Plätze (Sentinel 0xFFFF) fallen heraus, die
 * Plätznummer bleibt aber erhalten — sonst ließe sich eine Anzeige nicht mehr
 * auf den Speicher zurückführen.
 */
export function readInventory(slot: Uint8Array): InventoryEntry[] {
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  const maske = (1 << INVENTORY_ID_BITS) - 1;
  const out: InventoryEntry[] = [];
  for (let i = 0; i < INVENTORY_ENTRIES; i++) {
    const at = INVENTORY_OFFSET + i * 2;
    if (at + 2 > slot.length) break;
    const value = view.getUint16(at, true);
    if (value === EMPTY_ENTRY) continue;
    const count = value >>> INVENTORY_ID_BITS;
    if (count === 0) continue;
    out.push({ slot: i, itemId: value & maske, count });
  }
  return out;
}

/**
 * Liest einen kompletten Slot. Der Leser ist **rein lesend** und ohne
 * Seiteneffekt: S21 ist ausdrücklich eine Anzeigesession, es gibt keinen
 * Schreibpfad in die Savemap.
 */
export function readSavemap(slot: Uint8Array): Savemap | null {
  if (slot.length < SAVEMAP_SLOT_LEN) return null;
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);

  const characters: CharacterRecord[] = [];
  for (let i = 0; i < CHARACTER_RECORD_COUNT; i++) characters.push(readCharacterRecord(slot, i));

  const party: Array<number | null> = [];
  for (let i = 0; i < PARTY_SIZE; i++) {
    const v = slot[PARTY_OFFSET + i] ?? EMPTY_SLOT;
    party.push(v === EMPTY_SLOT ? null : v);
  }

  const gil = view.getUint32(GIL_OFFSET, true);
  const playtimeSeconds = view.getUint32(PLAYTIME_OFFSET, true);
  const duplicatesConsistent =
    view.getUint32(GIL_OFFSET_SAVEMAP, true) === gil &&
    view.getUint32(PLAYTIME_OFFSET_SAVEMAP, true) === playtimeSeconds;

  const locationName = readTextField(slot, LOCATION_NAME_OFFSET, LOCATION_NAME_LEN);
  const previewLocationName = readTextField(slot, PREVIEW_LOCATION_OFFSET, PREVIEW_LOCATION_LEN);
  const locationSource: Savemap['locationSource'] =
    locationName.length > 0 ? 'savemap' : previewLocationName.length > 0 ? 'preview' : 'keiner';
  const locationConsistent =
    locationName.length === 0 || previewLocationName.length === 0 || locationName === previewLocationName;

  const settings: SavemapSettings = {
    menuVisible: view.getUint16(MENU_VISIBLE_OFFSET, true),
    menuLocked: view.getUint16(MENU_LOCKED_OFFSET, true),
    phsAllowed: view.getUint16(PHS_ALLOWED_OFFSET, true),
    phsVisible: view.getUint16(PHS_VISIBLE_OFFSET, true),
    options: view.getUint16(OPTIONS_OFFSET, true),
    battleSpeed: slot[BATTLE_SPEED_OFFSET] ?? 0,
    battleMessageSpeed: slot[BATTLE_MSG_SPEED_OFFSET] ?? 0,
    fieldMessageSpeed: slot[FIELD_MSG_SPEED_OFFSET] ?? 0,
    disc: slot[DISC_OFFSET] ?? 0,
  };

  return {
    schemaVersion: 1,
    characters,
    party,
    inventory: readInventory(slot),
    partyMateria: readPartyMateria(slot),
    gil,
    playtimeSeconds,
    locationName,
    previewLocationName,
    locationSource,
    locationConsistent,
    mapId: view.getUint16(MAP_ID_OFFSET, true),
    locationId: view.getUint16(LOCATION_ID_OFFSET, true),
    settings,
    duplicatesConsistent,
  };
}

/** Spielzeit als `h:mm:ss` — die Darstellung des Originals. */
export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
