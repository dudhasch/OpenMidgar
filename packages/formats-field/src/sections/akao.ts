import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION } from '../nam.js';

/**
 * AKAO-/Tutorial-Blöcke — die „Sektion 2" **innerhalb** von Sektion 1.
 *
 * 🟢 **Formatfakt (Makou, `docs/quellen/makoureactor.md` §3.2/§4).**
 * Hinter der Entity-Namenstabelle steht eine Tabelle aus `nAkao` u32-Offsets,
 * jeder **relativ zum Sektionsanfang**. Beide Blocksorten — Musik/Klang und
 * Tutorial-Bytecode — liegen in DERSELBEN Tabelle; unterschieden wird am
 * Inhalt: beginnt der Block mit ASCII `AKAO`, ist es ein Musik-/Klangblock,
 * sonst ein Tutorial-Skript.
 *
 * 🟢 **Der AKAO-Blockkopf** (Makou §4.1):
 *   +0x00  4 B   Magic `AKAO`
 *   +0x04  u16   AKAO-ID — **das ist die Musik-/Klangnummer**
 *   +0x06  u16   Länge
 *   +0x14  u16   Offset der ersten Kanaldaten ⇒ Kanalzahl = wert/2 + 1
 *
 * 🟢 **Warum das hier steht — die MUSIC-Kette.** Der Operand des
 * `MUSIC`-Opcodes ist **kein globaler Titel**, sondern ein **field-lokaler
 * Index in genau diese Offsettabelle**. Messung über alle 702 Fields
 * (1241 MUSIC-Vorkommen):
 *   - Vorhersage „Operand < nAkao des EIGENEN Fields": **1228/1241 = 98,95 %**.
 *     Kontrolle Nachbarfield 71,88 %, Kontrolle Byte-davor 49,88 %.
 *   - An `akaoOffsets[operand]` steht in **1154/1156 = 99,83 %** das Magic
 *     `AKAO`; der u16 bei +4 liegt ebenso oft im Band 1…98.
 *   - Gegenprobe: die Kujata-Angabe „musicId = u8 bei +50" trifft nur 32,87 %
 *     und liegt damit UNTER den Versatzkontrollen — sie fällt durch.
 * Kette: `MUSIC v → akaoOffsets[v] → AKAO-Kopf → u16@+4 = musicId (1…98)
 *         → music.idx[musicId − 1] → OGG`.
 *
 * 🟢 **Belegter Datenfehler** (Makou §4.2): In Originaldaten existieren Blöcke
 * mit **abgeschnittenem Magic** — `KAO…` (1 Byte fehlt) oder `AO…` (2 Byte
 * fehlen). Dann rutscht der gesamte Kopf um 1 bzw. 2 Byte nach vorn, die ID
 * steht also bei +3 bzw. +2. Beides wird hier erkannt und **benannt** gemeldet
 * (`W-FLD-AKAOMAG`), nicht geraten und nicht stillschweigend geschluckt.
 *
 * ---
 * ✅ **Nachmessung mit diesem Leser** (`tools/realdata-scan/src/akao-music-chain.rdtest.ts`,
 * 702 Fields, 2026-08-11) — die Zahlen, an denen die Deutung hängt:
 *
 * | Vorhersage | Treffer | Kontrolle |
 * |---|---|---|
 * | Operand < `nAkao` des eigenen Fields | 1230/1243 = **98,95 %** | Nachbarfield 71,92 %, Byte-davor 49,88 % |
 * | `akaoOffsets[v]` trägt `AKAO` | 1228/1230 = **99,84 %** | Versatz +4: **0,00 %**, Zufallsoffset: **0,00 %** |
 * | `musicId` im Band 1…98 (`music.idx`) | 1230/1230 = **100,00 %** | u16 zwei Byte weiter (Länge): 14,63 % |
 * | Gegenhypothese Kujata (`u8@+50`) | 382/1230 = 31,06 % | **fällt durch** — unter der Längenkontrolle liegt sie zwar nicht, unter der Vorhersage aber um 69 Punkte |
 *
 * **Die beiden Fehlschläge sind exakt die belegten Defekte.** Alle 1342
 * AKAO-Offsets des Bestands zerfallen in 1318 `akao`, **4 `akao-truncated`**
 * und 20 `tutorial` — kein einziger unklassifizierbarer Block. Die vier
 * abgeschnittenen liegen in **`junair2`, `junone7`, `sininb1`, `sininb2`**,
 * alle mit demselben Muster `4b 41 4f 0a 00 …` (`KAO`, ID 10). Zwei davon
 * werden von einem MUSIC-Operanden erreicht — genau die 2 aus 1230. Mit dem
 * Versatzausgleich hier lösen **1230/1230 = 100 %** auf.
 *
 * **Die aussagekräftigste Nebenbeobachtung.** Der Operand nimmt über 1243
 * Vorkommen nur **17 verschiedene Werte** an (0:688, 1:296, 2:137, 3:69 …) —
 * eine abklingende Kleinzahlverteilung, wie sie ein Index hat. Die daraus
 * aufgelöste `musicId` nimmt **86 verschiedene Werte im Bereich 1…96** an —
 * wie es eine Titelnummer tut. Allein daran ist zu sehen, dass der Operand
 * niemals der Titel gewesen sein kann.
 */

/** Magic eines Musik-/Klangblocks. */
export const AKAO_MAGIC = 'AKAO';
/** Kopfgröße bis einschließlich des Kanal-Offsets (+0x14 u16). */
export const AKAO_HEADER_LEN = 0x16;
/**
 * 🟢 Höchster im Bestand vorkommender Musik-Index (94 OGG-Titel, `music.idx`
 * mit 98 Zeilen). Dient NUR als Plausibilitätsband für Diagnosen.
 */
export const AKAO_MUSIC_ID_MAX = 98;
/**
 * 🟢 Höchstes gültiges Tutorial-Opcode-Byte (Makou §4.3: 0x00…0x12, dazu
 * 0xFF = NOP). Ein erstes Byte dazwischen heißt „kaputt", nicht „Tutorial".
 */
export const TUTORIAL_OPCODE_MAX = 0x12;

export type AkaoBlockKind =
  /** Vollständiges Magic `AKAO` — Musik-/Klangblock. */
  | 'akao'
  /** Magic vorn abgeschnitten (`KAO…`/`AO…`) — Musik-/Klangblock. */
  | 'akao-truncated'
  /** Kein Magic, aber ein gültiges Tutorial-Opcode-Byte am Blockanfang. */
  | 'tutorial'
  /** Weder Magic noch gültiges Tutorial-Opcode-Byte. */
  | 'unknown'
  /** Offset außerhalb der Sektion oder Block zu kurz für den Kopf. */
  | 'out-of-range';

export interface AkaoBlock {
  /** Byteposition in Sektion 1, so wie sie in der Offsettabelle steht. */
  at: number;
  kind: AkaoBlockKind;
  /**
   * AKAO-ID aus dem Kopf (u16, bei abgeschnittenem Magic entsprechend
   * verschoben). `null`, sobald der Block kein Musik-/Klangblock ist.
   */
  musicId: number | null;
  /** Fehlende Magic-Bytes: 0 (vollständig), 1 (`KAO…`) oder 2 (`AO…`). */
  missingMagicBytes: number;
  /** u16 bei +0x06 des (gedachten) vollständigen Kopfes; null wenn unlesbar. */
  length: number | null;
  /** Erstes Byte des Blocks — für Diagnosen bei `tutorial`/`unknown`. */
  firstByte: number | null;
}

const A = 0x41;
const K = 0x4b;
const O = 0x4f;

/**
 * Liest den Kopf des AKAO-/Tutorial-Blocks an `at` (sektionsrelativ).
 *
 * Bewusst **wertfrei**: die Funktion urteilt nicht, sie klassifiziert. Ob eine
 * Klasse ein Fehler ist, entscheidet der Aufrufer — ein Tutorial-Block ist
 * völlig normaler Inhalt, ein Tutorial-Block **am Ziel eines MUSIC-Operanden**
 * dagegen ein Befund.
 */
export function parseAkaoBlock(section1: Uint8Array, at: number): AkaoBlock {
  const miss = (kind: AkaoBlockKind, firstByte: number | null): AkaoBlock => ({
    at,
    kind,
    musicId: null,
    missingMagicBytes: 0,
    length: null,
    firstByte,
  });

  if (!Number.isInteger(at) || at < 0 || at >= section1.length) return miss('out-of-range', null);
  const first = section1[at]!;
  // Der kürzeste sinnvolle Musik-Kopf braucht Magic + ID + Länge.
  const b = (i: number): number | null => (at + i < section1.length ? section1[at + i]! : null);

  let missing = -1;
  if (b(0) === A && b(1) === K && b(2) === A && b(3) === O) missing = 0;
  else if (b(0) === K && b(1) === A && b(2) === O) missing = 1;
  else if (b(0) === A && b(1) === O) missing = 2;

  if (missing >= 0) {
    // Bei abgeschnittenem Magic beginnt der Restkopf um `missing` Byte früher.
    const idAt = at + 4 - missing;
    const lenAt = at + 6 - missing;
    if (idAt + 2 > section1.length) return miss('out-of-range', first);
    const view = new DataView(section1.buffer, section1.byteOffset, section1.byteLength);
    return {
      at,
      kind: missing === 0 ? 'akao' : 'akao-truncated',
      musicId: view.getUint16(idAt, true),
      missingMagicBytes: missing,
      length: lenAt + 2 <= section1.length ? view.getUint16(lenAt, true) : null,
      firstByte: first,
    };
  }

  // Kein Magic ⇒ Tutorial-Bytecode. Makou hält einen Block für kaputt, wenn
  // das erste Byte > 0x12 und < 0xFF ist — außerhalb des Opcode-Bereichs.
  if (first <= TUTORIAL_OPCODE_MAX || first === 0xff) return miss('tutorial', first);
  return miss('unknown', first);
}

/**
 * Meldet die strukturellen Befunde eines Blocks als benannte Diagnosen.
 * Tutorial-Blöcke sind KEIN Befund (normaler Inhalt) und bleiben still.
 */
export function diagnoseAkaoBlock(
  block: AkaoBlock,
  index: number,
  field: string,
  diagnostics: FieldDiagnostic[],
): void {
  switch (block.kind) {
    case 'out-of-range':
      diagnostics.push(
        fdiag('E-FLD-AKAOOFF', field, `AKAO-Block ${index}: Offset ${block.at} außerhalb der Sektion`, SECTION.SCRIPT),
      );
      break;
    case 'akao-truncated':
      diagnostics.push(
        fdiag(
          'W-FLD-AKAOMAG',
          field,
          `AKAO-Block ${index} @${block.at}: Magic um ${block.missingMagicBytes} Byte abgeschnitten (${block.missingMagicBytes === 1 ? 'KAO…' : 'AO…'}), ID bei +${4 - block.missingMagicBytes} gelesen = ${block.musicId}`,
          SECTION.SCRIPT,
        ),
      );
      break;
    case 'unknown':
      diagnostics.push(
        fdiag(
          'W-FLD-AKAOUNK',
          field,
          `AKAO-Block ${index} @${block.at}: erstes Byte 0x${(block.firstByte ?? 0).toString(16)} ist weder AKAO-Magic noch gültiger Tutorial-Opcode`,
          SECTION.SCRIPT,
        ),
      );
      break;
    default:
      break;
  }
}

export interface MusicResolution {
  /** Musik-/Klangnummer aus dem AKAO-Kopf; null = nicht auflösbar. */
  musicId: number | null;
  /** 0-basierter Index in `music.idx` (= `musicId − 1`); null = nicht auflösbar. */
  musicIndex: number | null;
  /** Der aufgelöste Block — auch bei Fehlschlag zur Diagnose vorhanden. */
  block: AkaoBlock | null;
  /** Warum es (nicht) ging — als kurzer, prüfbarer Grund. */
  reason:
    | 'ok'
    | 'ok-truncated-magic'
    | 'operand-out-of-range'
    | 'tutorial-block'
    | 'no-magic'
    | 'offset-out-of-range';
}

/**
 * Die vollständige erste Hälfte der MUSIC-Kette:
 * `Operand → akaoOffsets[operand] → AKAO-Kopf → musicId`.
 *
 * Der Rest (`music.idx[musicId − 1] → OGG`) gehört nicht in `formats-field`,
 * weil er Installationsdateien braucht — `musicIndex` ist die Nahtstelle.
 */
export function resolveFieldMusic(
  akaoOffsets: readonly number[],
  section1: Uint8Array,
  operand: number,
  field: string,
  diagnostics: FieldDiagnostic[],
): MusicResolution {
  if (!Number.isInteger(operand) || operand < 0 || operand >= akaoOffsets.length) {
    diagnostics.push(
      fdiag(
        'E-FLD-AKAOOFF',
        field,
        `MUSIC-Operand ${operand} liegt außerhalb der ${akaoOffsets.length} AKAO-Blöcke dieses Fields`,
        SECTION.SCRIPT,
      ),
    );
    return { musicId: null, musicIndex: null, block: null, reason: 'operand-out-of-range' };
  }

  const block = parseAkaoBlock(section1, akaoOffsets[operand]!);
  switch (block.kind) {
    case 'akao':
    case 'akao-truncated': {
      if (block.kind === 'akao-truncated') diagnoseAkaoBlock(block, operand, field, diagnostics);
      const id = block.musicId!;
      return {
        musicId: id,
        musicIndex: id - 1,
        block,
        reason: block.kind === 'akao' ? 'ok' : 'ok-truncated-magic',
      };
    }
    case 'tutorial':
      diagnostics.push(
        fdiag(
          'W-FLD-AKAOTUT',
          field,
          `MUSIC-Operand ${operand} zeigt auf einen Tutorial-Block @${block.at} (erstes Byte 0x${(block.firstByte ?? 0).toString(16)}), nicht auf einen AKAO-Block`,
          SECTION.SCRIPT,
        ),
      );
      return { musicId: null, musicIndex: null, block, reason: 'tutorial-block' };
    case 'unknown':
      diagnoseAkaoBlock(block, operand, field, diagnostics);
      return { musicId: null, musicIndex: null, block, reason: 'no-magic' };
    default:
      diagnoseAkaoBlock(block, operand, field, diagnostics);
      return { musicId: null, musicIndex: null, block, reason: 'offset-out-of-range' };
  }
}
