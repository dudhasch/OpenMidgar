/**
 * NAM-Typen der Kampfdaten (S30). Grundlage sind ausschließlich die
 * realdaten-belegten Fakten aus `tools/realdata-scan/FINDINGS.md` (Abschnitt
 * S30): Containergrammatik 256/256 Szenen à 7808 B byteexakt (Füllung
 * ausnahmslos 0xFF), Partition der Szene mit KI-Tabellen bei 0xC80/0xE80
 * (Sweep-Sieger 241/256 gegen 15/256; die verbreitete Community-Angabe 0xF00
 * ist widerlegt — dort steht Text), Referenzschlüsse Formation→Gegner
 * 2414/2414 und Gegner→Attacktabelle 2509/2509 (Kontrollen 25 %/29 %).
 *
 * Farblegende der Feldkommentare: ✅ realdaten-belegt · 🟡 Community-Deutung,
 * roh mitkonserviert · Werte ohne Deutung bleiben in `raw`.
 */

/** scene.bin: Blöcke à 0x2000 B; je Block 16 u32-Zeiger in 4-Byte-Einheiten. */
export const SCENE_BLOCK_BYTES = 0x2000;
export const SCENE_PTRS_PER_BLOCK = 16;
/** Jede Szene entpackt exakt hierauf (256/256). */
export const SCENE_DECOMPRESSED_LEN = 0x1e80;
/** 4 Formationen je Szene → 1024 adressierbare Kampf-IDs (= 10-Bit-Raum). */
export const FORMATIONS_PER_SCENE = 4;
export const ENEMY_SLOTS_PER_FORMATION = 6;
export const ENEMY_TYPES_PER_SCENE = 3;
export const ATTACKS_PER_SCENE = 32;

/** Partition der entpackten Szene (byteexakt, s. Probe). */
export const SCENE_OFF = {
  enemyIds: 0x000,
  setup: 0x008,
  camera: 0x058,
  formation: 0x118,
  enemy: 0x298,
  attack: 0x4c0,
  attackIds: 0x840,
  attackNames: 0x880,
  formationAi: 0xc80,
  enemyAi: 0xe80,
} as const;

export const SETUP_RECORD_LEN = 20;
export const CAMERA_RECORD_LEN = 48;
export const FORMATION_SLOT_LEN = 16;
export const ENEMY_RECORD_LEN = 184;
export const ATTACK_RECORD_LEN = 28;

/** Ein Platz in einer Formation (16 B). */
export interface FormationSlot {
  /** ✅ Verweis auf einen der 3 Szenen-Gegnertypen; 0xFFFF = leer (2414/2414). */
  enemyTypeId: number;
  /** 🟡 Aufstellungsposition (i16 x,y,z @2/4/6) — Sichtnachweis steht aus (S32). */
  x: number;
  y: number;
  z: number;
  /** 🟡 Reihe (u16@8). */
  row: number;
  /** 🟡 Deckungsflags (u16@10). */
  coverFlags: number;
  /** 🟡 Anfangszustand (u32@12). */
  initialState: number;
  raw: Uint8Array;
}

/** Gegnertyp-Record (184 B). Nur belegte Felder sind typisiert. */
export interface EnemyRecord {
  /** FF-Text, roh — Dekodierung ist Sache des Aufrufers (Zeichentabelle S13). */
  nameRaw: Uint8Array;
  /** ✅ u8@0x20 ∈ [1,99] in 627/627 belegten Records. */
  level: number;
  /**
   * 🟡 u8@0x21..0x27 laut Community: speed, luck, evade, strength, defense,
   * magic, mdefense — die REIHENFOLGE ist nicht realdaten-belegt (u8-Werte
   * tragen keine messbare Ordnung). Verbindlich erst nach Sichtabgleich.
   */
  statsRaw: Uint8Array;
  /** 🟡 8×u8 Elementtypen + 8×u8 Elementraten (@0x28). */
  elementRaw: Uint8Array;
  /** 🟡 16×u8 Animationsindizes (@0x38). */
  animationIds: Uint8Array;
  /** ✅ 16×u16 @0x48 — jede belegte ID liegt in der Szenen-Attacktabelle (2509/2509). */
  attackIds: Uint16Array;
  /** 🟡 16×u16 Kamerabewegungs-IDs je Attacke (@0x68). */
  attackCameraRaw: Uint16Array;
  /** 🟡 4×u8 Dropraten + 4×u16 Item-IDs (@0x88). */
  itemRaw: Uint8Array;
  /** 🟡 u16@0x9C. */
  mp: number;
  /** 🟡 u16@0x9E. */
  ap: number;
  /**
   * ✅ u8@0xA2 — **Rückenangriffs-Faktor in Achteln** (`schaden * v >> 3`).
   *
   * Hypothese aus dem Prior-Art-Vergleich (Braver: `BackDamageMultiplier =
   * ReadByte() / 8f`), an unseren Daten entschieden: **592 von 615** belegten
   * Records tragen exakt `16` = ×2,0 — der bekannte doppelte Rückenschaden.
   * Die übrigen Werte sind `32` (×4), `40` (×5), `64` (×8) und `255`
   * (Sentinel, 20 Records).
   *
   * Die Gütefunktion ist **nicht** „wenige verschiedene Werte", sondern die
   * scharfe Vorhersage der Achtel-Deutung: Alle Nicht-Sentinel-Werte müssen
   * **Vielfache von 8** sein. Kontrolle über alle 184 Byteversätze des
   * Records: **2 von 184** erfüllen sie (Faktor 92). Der zweite Treffer
   * `+0x8B` liegt im Dropraten-Block und hat einen eigenen Grund.
   */
  backAttackScale: number;
  /** ✅ u32@0xA4 ∈ [1,1e6] in 627/627 (Kontrolle @0xA3: 76 %). */
  hp: number;
  /** ✅ u32@0xA8 — Konkordanz mit Level 0,869 gegen 0,642 verschoben. */
  exp: number;
  /** 🟡 u32@0xAC (strukturgleich zu exp, nicht einzeln belegt). */
  gil: number;
  /**
   * ✅ u32@0xB0 — **erlaubte** Zustände, nicht Immunitäten. Bit gesetzt =
   * der Zustand darf wirken.
   *
   * Der frühere Name `statusImmunity` war das Gegenteil und lud zu einem
   * Vorzeichenfehler ein. Entschieden an den Daten, nicht am Namen: Im Mittel
   * sind **26,2 von 32 Bits gesetzt**, und **201 von 615** belegten Records
   * tragen `0xFFFFFFFF`. Als Immunitätsmaske gelesen hieße das: Der
   * Durchschnittsgegner ist gegen 26 Zustände immun und ein Drittel aller
   * Gegner gegen *alle* — das ist kein Spiel. Als Erlaubnismaske gelesen ist
   * es der Normalfall.
   *
   * Zur Laufzeit gilt `immunitaet = ~statusesAllowed`; das Original legt genau
   * diese Negation im Aktorrecord ab. Wer eine Immunitätsmaske braucht, muss
   * invertieren — deshalb heißt das Feld hier nach dem, was auf der Platte
   * steht.
   */
  statusesAllowed: number;
  /** Der vollständige 184-B-Record — maßgeblich für alles Ungedeutete. */
  raw: Uint8Array;
}

/** Attack-Record (28 B) — Layout identisch in Szene und kernel-Sektion 1. */
/**
 * Angriffsdatensatz (28 B). 🟢 Feldlage aus der eigenen Codeanalyse
 * (ADR-028) und über das `damageCalc`-Histogramm an 8320 Datensätzen
 * gegengezählt. `raw` bleibt maßgeblich.
 */
export interface AttackRecord {
  /** u8@0x00 Trefferquote; `255` heißt „kann nicht danebengehen". */
  accuracy: number;
  /** u8@0x01 Aufschlageffekt; `0xFF` = den vorigen Wert stehen lassen. */
  impactEffectId: number;
  /** u8@0x02 Zielpose. */
  targetPoseClass: number;
  /** u16@0x04 MP-Kosten. */
  mpCost: number;
  /** i16@0x06 Klang-/Einblendungskennung. */
  soundOrPopupId: number;
  /** u16@0x08 bzw. @0x0A Kamerabewegung bei einem bzw. mehreren Zielen. */
  cameraSingle: number;
  cameraMulti: number;
  /** u8@0x0C Zielflags (Reichweite, Aufteilung). */
  targetFlags: number;
  /** u8@0x0D Angriffseffekt. */
  attackEffectId: number;
  /** u8@0x0E **das Schadensbyte** — hohes Nibble Trefferprogramm, niederes Formel. */
  damageCalc: number;
  /** u8@0x0F Stärke; `0` unterdrückt die Formel ganz. */
  power: number;
  /** u8@0x11 Statusmodus: Eimer `>>6`, Rate `(&0x3F)<<2`. */
  statusMode: number;
  /** u8@0x12 Zusatzeffekt (`0xFF` = keiner) und sein Argument. */
  addedEffectId: number;
  addedEffectArg: number;
  /** u32@0x14 Statusmaske; `0xFFFFFFFF` = keine. */
  statusMask: number;
  /** i16@0x18 Elementmaske — `0xFFFF` ist auf **0** normiert („kein Element"). */
  elementMask: number;
  /** u16@0x1A Sonderflags; **aktiv-niedrig** außer Bit 2. */
  specialFlags: number;
  /** Rohbytes — maßgeblich; die Felder oben sind Bequemlichkeit. */
  raw: Uint8Array;
}

export interface BattleFormation {
  slots: FormationSlot[];
  /** 20-B-Setup, roh (🟡; u16@0 gilt als Stage-/Location-Kennung). */
  setupRaw: Uint8Array;
  /** 🟡 u16@0 aus dem Setup. */
  location: number;
  /** 48-B-Kamerablock, roh (S32-Gegenstand). */
  cameraRaw: Uint8Array;
  /** KI-Skript der Formation (leer, wenn keins). */
  aiScript: Uint8Array;
}

export interface BattleScene {
  sceneIndex: number;
  /** ✅ 3×u16; 0xFFFF = unbenutzter Slot. */
  enemyTypeIds: number[];
  formations: BattleFormation[];
  enemies: (EnemyRecord | null)[];
  attacks: AttackRecord[];
  /** ✅ 32×u16 Attack-IDs (0xFFFF = leer). */
  attackIds: Uint16Array;
  /** 32×32 B Attack-Namen, roh (FF-Text). */
  attackNamesRaw: Uint8Array;
  /** KI-Skripte je Gegnertyp (null = keins). */
  enemyAiScripts: (Uint8Array | null)[];
}

/** Eine Kampf-ID (0..1023) adressiert Szene `id >> 2`, Formation `id & 3`. */
export function formationAddress(battleId: number): { sceneIndex: number; formationIndex: number } {
  return { sceneIndex: battleId >> 2, formationIndex: battleId & 3 };
}

// --- kernel.bin Sektionen 0–2 (S13 roh konserviert, S30 typisiert) ---------

export const KERNEL_COMMAND_COUNT = 32;
export const KERNEL_COMMAND_LEN = 8;
export const KERNEL_ATTACK_COUNT = 128;

/** Command-Record (8 B) — Deutung 🟡, roh maßgeblich. */
export interface CommandRecord {
  raw: Uint8Array;
}

/** Charakter-Record der Growth-Sektion (56 B). */
export interface GrowthCharacter {
  /** ✅ Kurvenindizes: 6 Primärstatistiken, dann HP/MP/EXP (alle < 64; die
   * Bänder 37–45/46–54/55–63 sind im Bestand exakt getrennt). */
  curveIndexes: {
    primary: number[];
    hp: number;
    mp: number;
    exp: number;
  };
  /** 🟡 u8@0x0A Startlevel (Werte wie 254 deuten auf Sonderbelegung). */
  startLevelRaw: number;
  raw: Uint8Array;
}

/** Eine Wachstumskurve: 8 Paare (gradient, base) für Levelabschnitte. */
export interface GrowthCurve {
  gradients: Uint8Array;
  bases: Uint8Array;
}

export interface GrowthSection {
  characters: GrowthCharacter[];
  /** ✅ 12 B @0x1F8, monoton. */
  statGain: Uint8Array;
  /** ✅ 12 B @0x204, monoton. */
  hpGain: Uint8Array;
  /** ✅ 12 B @0x210, monoton. */
  mpGain: Uint8Array;
  /** ✅ 64 Kurven à 16 B @0x21C (Basis aus den Daten abgeleitet; EXP-Kurven
   * 55–63 tragen in allen 8 Paaren Basis 0). */
  curves: GrowthCurve[];
  /** [0x61C, Ende) — 2424 B ungedeutet (🟡), roh konserviert. */
  tailRaw: Uint8Array;
}

export interface KernelBattleData {
  commands: CommandRecord[];
  attacks: AttackRecord[];
  growth: GrowthSection;
}

// --- Battle-Skelett (`<präfix>aa` in battle.lgp) ---------------------------

export const SKELETON_HEADER_LEN = 52;
export const SKELETON_BONE_LEN = 12;

export interface BattleBone {
  /** ✅ i32: Elternindex, −1 = Wurzel; Vorwärtskette 11026/11026. */
  parent: number;
  /** ✅ f32: Bone-Länge (im Bestand fast ausnahmslos negativ — dieselbe
   * −len-Konvention wie bei R4-B1 gemessen). */
  length: number;
  /** ✅ u32 ∈ {0,1}: 1 = trägt Geometrie (Kompositionsregel 🟡, S32). */
  hasGeometry: boolean;
}

export interface BattleSkeleton {
  boneCount: number;
  bones: BattleBone[];
  /** 13×u32-Kopf, roh — nur u32[3] (boneCount) ist gedeutet. */
  headerRaw: Uint32Array;
}
