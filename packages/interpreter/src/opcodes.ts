/**
 * Opcode-Tabellen für das Interpreter-Grundgerüst (S6) — Clean-Room:
 * Nummern, Operandenlängen und Semantikbeschreibungen stammen ausschließlich
 * aus öffentlicher Community-Dokumentation (Qhimm-Wiki-Opcode-Liste) und
 * eigener Verhaltensbeobachtung; kein Original-Disassembly.
 *
 * S6-Scope (Masterplan 4.1): Kontrollfluss, Variablen, Dialog-Stub.
 * Alles andere folgt der UNKNOWN-Politik (🔵): Länge bekannt → überspringen
 * + Telemetriezähler; Länge unbekannt → kontrollierter Kontext-Fault.
 */

export const OP = {
  // Kontrollfluss & Synchronisation
  RET: 0x00,
  REQ: 0x01,
  REQSW: 0x02,
  REQEW: 0x03,
  RETTO: 0x07,
  JMPF: 0x10,
  JMPFL: 0x11,
  JMPB: 0x12,
  JMPBL: 0x13,
  IFUB: 0x14,
  IFUBL: 0x15,
  IFSW: 0x16,
  IFSWL: 0x17,
  IFUW: 0x18,
  IFUWL: 0x19,
  WAIT: 0x24,
  // Dialog-Stub
  MESSAGE: 0x40,
  ASK: 0x48,
  WINDOW: 0x50,
  /**
   * Fenstermodus setzen. Operanden: Fenster-ID, Modus, Sperrflag (Länge 3,
   * realdaten-gemessen, n=423).
   *
   * ⚠️ **Namenskorrektur (2026-08-11):** Dieser Opcode hieß bei uns `WCLSE`.
   * Das ist falsch: `WCLSE` liegt auf `0x54`. Die Referenz führt 0x52 mit
   * Gesamtlänge 4 (⇒ Operand 3, deckt sich mit unserer gemessenen 3) und 0x54
   * mit Gesamtlänge 2 (⇒ Operand 1, deckt sich mit `SKIP_OPERAND_LEN[0x54]`).
   * Beide Längen waren also längst richtig — nur der Name hing am falschen
   * Opcode, genau wie damals bei `DIR`/`TURA`. Da beide heute reine Stubs ohne
   * Operandenauswertung sind, ändert die Korrektur **kein Verhalten**; sie
   * verhindert, dass später die Fensterschließ-Semantik an den Modus-Opcode
   * gehängt wird.
   */
  WMODE: 0x52,
  /**
   * Fenster schließen. **Nicht implementiert** — steht weiterhin auf dem
   * Skip-Pfad (`SKIP_OPERAND_LEN[0x54] = 1`). Der Name ist hier nur
   * festgehalten, damit die Zuordnung nicht erneut verrutscht.
   */
  WCLSE: 0x54,
  /**
   * Menü öffnen (S21). Operanden: Bankbyte, Auswahl, Parameter.
   *
   * ✅ **Operandenform realdaten-vermessen** (296 Vorkommen über 702 Fields):
   * Das erste Byte trägt in **98,6 %** denselben Wert — die Signatur eines
   * Bankbytes mit Literaloperanden, wie sie auch `BATTLE` zeigt. Das zweite
   * nimmt 22 Werte an und ist mit 40,5 % auf einen konzentriert (Auswahl), das
   * dritte 67 Werte (freier Parameter). Zum Vergleich: Bei den übrigen
   * Opcodes mit drei Operandenbytes streut die erste Spalte regelmäßig über
   * 30–220 Werte.
   *
   * 🟡 **Welcher Auswahlwert welche Ansicht meint, ist NICHT gemessen** — das
   * ist aus den Field-Skripten allein auch nicht ableitbar. Der Interpreter
   * reicht den Rohwert durch.
   */
  MENU: 0x49,
  /** Menü-Zugriffssperre. 🟡 Ein Operandenbyte, sechs Werte im Bestand. */
  MENU2: 0x4a,
  // Variablen (saturierende Varianten mit "!")
  PLUS_S: 0x76,
  PLUS2_S: 0x77,
  MINUS_S: 0x78,
  MINUS2_S: 0x79,
  INC_S: 0x7a,
  INC2_S: 0x7b,
  DEC_S: 0x7c,
  DEC2_S: 0x7d,
  SETBYTE: 0x80,
  SETWORD: 0x81,
  BITON: 0x82,
  BITOFF: 0x83,
  BITXOR: 0x84,
  PLUS: 0x85,
  PLUS2: 0x86,
  MINUS: 0x87,
  MINUS2: 0x88,
  MUL: 0x89,
  MUL2: 0x8a,
  DIV: 0x8b,
  DIV2: 0x8c,
  MOD: 0x8d,
  MOD2: 0x8e,
  AND: 0x8f,
  AND2: 0x90,
  OR: 0x91,
  OR2: 0x92,
  XOR: 0x93,
  XOR2: 0x94,
  INC: 0x95,
  INC2: 0x96,
  DEC: 0x97,
  DEC2: 0x98,
  RANDOM: 0x99,
  // Entität & Bewegung (S12). Längen sind realdaten-abgeleitet; die
  // Feldaufteilung INNERHALB der Operanden ist gesondert geprüft.
  PC: 0xa0,
  CHAR: 0xa1,
  DFANM: 0xa2,
  ANIME1: 0xa3,
  VISI: 0xa4,
  XYZI: 0xa5,
  /**
   * Position + Walkmesh-Dreieck OHNE Höhe. Operanden (Länge 8): zwei
   * Bankpaarbytes, i16 x, i16 y, u16 Dreiecksindex.
   *
   * ✅ **Länge und Aufteilung realdaten-belegt (2026-08-11)**, gegen drei
   * unabhängige Gütefunktionen und mit Eichung an `XYZI`:
   *
   *  - *Struktursonde:* Bankadressierte Wertfelder müssen ein hohes Byte 0
   *    tragen (Bänke sind 256 B), literale müssen in den Walkmesh-Bereich
   *    fallen, der Dreiecksindex muss existieren. Trefferquote **90,6 %**
   *    (29/32) gegen **15,6 %** bei um ein Byte verschobener Lesart. Eichung an
   *    `XYZI` mit bekannter Aufteilung: 99,2 % gegen 0,0 % verschoben.
   *  - *Grenzplausibilität:* Der Log-Quotient „sieht wie ein
   *    Instruktionsanfang aus" liegt bei Länge 8 auf **2,37 ± 0,37** — über dem
   *    Kontrollniveau echter Instruktionsanfänge (1,23) und weit über allen
   *    zwölf Alternativen (nächstbeste 1,14). Die bisherige Länge 2 liegt bei
   *    −1,50, also auf dem Niveau von Operandenbytes (−1,16).
   *  - *Spannen-Abschluss:* **unverändert** 32/32 — diese Gütefunktion ist hier
   *    blind, weil sich der Strom nach wenigen Instruktionen selbst
   *    resynchronisiert. Das ist der Grund, warum O9 den Posten offenließ.
   *
   * **Folge der alten Länge 2:** Der Strom lief in die Operanden hinein; im
   * häufigsten Muster (`a6 66 60 13 00 15 00 19 00`) wurde `13 00 15` als
   * `JMPBL` mit Sprungweite 0x1500 ausgeführt — ein wilder Rücksprung.
   */
  XYI: 0xa6,
  /**
   * Position MIT Höhe, ohne Dreiecksindex. Operanden (Länge 8): zwei
   * Bankpaarbytes, i16 x, i16 y, i16 z.
   *
   * ✅ **Länge und Aufteilung realdaten-belegt (2026-08-11)**: Struktursonde
   * **88,1 %** (37/42) gegen **0,0 %** bei Versatz +1. Die Grenzplausibilität
   * allein hätte hier in die Irre geführt — sie bevorzugt Länge 4 (2,34) knapp
   * vor 8 (1,76). Entschieden hat die Kontrolle am dritten Wertfeld: Liegt es
   * auf @7, trifft es zu 88,1 %; liegt es auf @9 (wie es bei Länge 4 der Fall
   * wäre, weil dort schon die nächste Instruktion begänne), nur zu 45,2 %.
   * Das dritte Wertfeld gehört also zur Instruktion, und die Länge ist ≥ 8.
   */
  XYZ: 0xa7,
  MOVE: 0xa8,
  /**
   * Blickrichtung setzen. Operanden: Bank-Byte + u8 Richtung.
   *
   * ⚠️ **Korrektur (2026-08-10):** Stand vorher auf `0xab` — das ist in
   * Wahrheit `TURA` (Drehen über Zeit, eigener Operandensatz). `DIR` liegt auf
   * `0xb3`. Aufgefallen beim Abgleich gegen die positionsgeordnete
   * Opcode-Liste aus Makou Reactor. Die aus den Realdaten abgeleitete
   * Operandenlänge für 0xb3 ist 2 und deckt sich mit der Referenzstruktur
   * `{ banks, direction }` — die Länge war also längst richtig, nur der Name
   * hing am falschen Opcode.
   */
  DIR: 0xb3,
  // Audio (S17). Die abgeleiteten Längen (1 bzw. 4) decken sich mit der
  // öffentlichen Dokumentation — zwei unabhängige Quellen, die übereinstimmen.
  MUSIC: 0xf0,
  SOUND: 0xf1,
  /**
   * Field-Wechsel. ✅ Aus den Realdaten identifiziert (S17): Von allen 256
   * Opcodes und allen Operandenpositionen ist einzig `0x60` an Position 0 ein
   * echter Zielfield-Index — der daraus gebaute Field-Graph hat **39,4 %
   * Rückkanten** gegen **0,9 %** bei verschobener maplist (Faktor 44). Alle
   * anderen Kandidaten bleiben unter 2,2 % und damit im Rauschen.
   */
  MAPJUMP: 0x60,
  /**
   * Kampfstart. Operanden: Bank-Byte, dann u16 Formationsnummer.
   *
   * ✅ Identifiziert (S17, zweiter Anlauf). Der erste Anlauf suchte den Opcode
   * über die Encounter-Tabelle des eigenen Fields (Sektion 7) und **musste**
   * scheitern: `battleID` ist eine **globale** Formationsnummer, keine Nummer
   * aus dieser Tabelle. Sektion 7 beschreibt die Zufallskämpfe eines Fields,
   * `BATTLE` löst einen skriptierten Kampf aus. Realdaten-Nachweis: Die
   * Nummer steht in Sektion 7 des eigenen Fields genau **1/173 mal** — und im
   * Nachbarfield exakt gleich oft. Es gab dort schlicht nichts zu finden.
   *
   * Bestätigt über zwei unabhängige Prüfungen: 184 Vorkommen über 702 Fields,
   * davon 173 mit Literaloperanden; 169 der 173 Formationsnummern liegen unter
   * 1024 (Median 468) — bei einem falsch gedeuteten Bytepaar läge der Median
   * bei ~32768. Zusätzlich deckt sich die Operandenlänge 3 mit der aus den
   * Realdaten abgeleiteten Längentabelle, und der Nachbaropcode `MAPJUMP`
   * (0x60) war bereits unabhängig aus den Daten bestimmt.
   */
  BATTLE: 0x70,
  /** Zufallskämpfe an/aus. 1 Operandenbyte; 102 Vorkommen im Bestand. */
  BTLON: 0x71,
  /**
   * Hintergrund-Zustandsschaltung (F22-Mechanismus). 🟢 Belegt (Makou
   * Reactor, Script::backgroundParams / Opcode.cpp): BGON setzt Bit
   * `1 << state` des Parameters, BGOFF löscht es, BGCLR löscht alle.
   */
  BGON: 0xe0,
  BGOFF: 0xe1,
  BGCLR: 0xe4,
} as const;

export type OpCategory =
  | 'control'
  | 'variable'
  | 'dialog'
  | 'menu'
  | 'unknown-skipped'
  | 'unknown-fault';

/**
 * Operandenlängen (Bytes NACH dem Opcode-Byte) der implementierten Ops.
 * 🟡 Wortvergleiche: Adresse als u8 angenommen (Bankbreite 256 Bytes),
 * `Zu validieren` gegen Realverhalten.
 */
export const IMPL_OPERAND_LEN: Readonly<Record<number, number>> = {
  [OP.RET]: 0,
  [OP.REQ]: 2,
  [OP.REQSW]: 2,
  [OP.REQEW]: 2,
  [OP.RETTO]: 1,
  [OP.JMPF]: 1,
  [OP.JMPFL]: 2,
  [OP.JMPB]: 1,
  [OP.JMPBL]: 2,
  [OP.IFUB]: 5,
  [OP.IFUBL]: 6,
  // O9: Bei den WORT-Varianten ist auch die linke Adresse zwei Byte breit.
  // 0x16 und 0x17 sind gemessen (Spannen-Abschluss steigt, n=4733 bzw. 300);
  // 0x18 und 0x19 sind auf der Messung **indifferent** und werden aus
  // Formgleichheit mitgezogen — dieselbe Instruktionsform muss dieselbe Länge
  // haben. Kontrolle: dieselben vier je ein Byte zu weit verschlechtern
  // deutlich (99,52 % gegen 99,92 %).
  [OP.IFSW]: 7,
  [OP.IFSWL]: 8,
  [OP.IFUW]: 7, // 🟡 aus Formgleichheit, nicht aus der Messung
  [OP.IFUWL]: 8, // 🟡 dito
  [OP.WAIT]: 2,
  [OP.MESSAGE]: 2,
  [OP.ASK]: 6,
  [OP.WINDOW]: 9,
  // O9: 1 → 3 gemessen (n=423). Der Name ist seit 2026-08-11 korrigiert
  // (0x52 = WMODE, nicht WCLSE); die Länge war davon nie betroffen.
  [OP.WMODE]: 3,
  // Menü (S21) — beide Längen stammen aus derselben S12-Ableitung wie die
  // übrigen und ändern den Instruktionsstrom deshalb nicht.
  [OP.MENU]: 3,
  [OP.MENU2]: 1,
  [OP.PLUS_S]: 3,
  [OP.PLUS2_S]: 4,
  [OP.MINUS_S]: 3,
  [OP.MINUS2_S]: 4,
  [OP.INC_S]: 2,
  [OP.INC2_S]: 2,
  [OP.DEC_S]: 2,
  [OP.DEC2_S]: 2,
  [OP.SETBYTE]: 3,
  [OP.SETWORD]: 4,
  [OP.BITON]: 3,
  [OP.BITOFF]: 3,
  [OP.BITXOR]: 3,
  [OP.PLUS]: 3,
  [OP.PLUS2]: 4,
  [OP.MINUS]: 3,
  [OP.MINUS2]: 4,
  [OP.MUL]: 3,
  [OP.MUL2]: 4,
  [OP.DIV]: 3,
  [OP.DIV2]: 4,
  [OP.MOD]: 3,
  [OP.MOD2]: 4,
  [OP.AND]: 3,
  [OP.AND2]: 4,
  [OP.OR]: 3,
  [OP.OR2]: 4,
  [OP.XOR]: 3,
  [OP.XOR2]: 4,
  [OP.INC]: 2,
  [OP.INC2]: 2,
  [OP.DEC]: 2,
  [OP.DEC2]: 2,
  [OP.RANDOM]: 2,
  // Entität & Bewegung — Längen aus dem Spannen-Abschluss (S12).
  [OP.PC]: 1,
  [OP.CHAR]: 1,
  [OP.DFANM]: 2,
  [OP.ANIME1]: 2,
  [OP.VISI]: 1,
  [OP.XYZI]: 10,
  // Bündelübernahme 2026-08-11 (Begründung in der OP-Tabelle oben):
  // 0xA6 2 → 8, 0xA7 6 → 8. Beide waren vorher auf dem Skip-Pfad.
  [OP.XYI]: 8,
  [OP.XYZ]: 8,
  [OP.MOVE]: 5,
  [OP.DIR]: 2,
  [OP.MUSIC]: 1,
  [OP.SOUND]: 4,
  [OP.MAPJUMP]: 9,
  [OP.BATTLE]: 3,
  [OP.BTLON]: 1,
  // Längen identisch zur bisherigen Skip-Tabelle (dort realdaten-geeicht).
  [OP.BGON]: 3,
  [OP.BGOFF]: 3,
  [OP.BGCLR]: 2,
};

/**
 * UNKNOWN-Politik, Stufe „Länge bekannt": Operandenlängen nicht
 * implementierter Ops — werden übersprungen und gezählt.
 *
 * **Diese Tabelle ist aus den Realdaten ABGELEITET, nicht abgeschrieben**
 * (S12). Gütefunktion ist der Spannen-Abschluss: Jede der 48.041
 * Script-Spannen des Bestands ist ein zusammenhängender Instruktionsstrom, der
 * beim linearen Durchlaufen **exakt** auf seinem Ende landen muss. Eine
 * falsche Länge verrutscht den Strom und verfehlt das Ende. Ein
 * Koordinatenabstieg über die Längen 0…16 hebt die Abschlussquote von
 * **43,19 % auf 99,73 %**, bei 0,04 % unbekannt und 0,23 % Überlauf.
 *
 * Absicherung gegen Überanpassung: Alle vom Interpreter tatsächlich
 * ausgeführten Opcodes (`IMPL_OPERAND_LEN`) waren beim Abstieg **eingefroren**
 * — ein freier Lauf verbog sonst nachweislich richtige Längen (REQ 2→0,
 * MUL 3→0), weil sich 256 freie Parameter leicht gegen eine einzelne Kennzahl
 * optimieren lassen. Bei Gleichstand blieb der Ausgangswert stehen.
 *
 * 🟡 **48 der hier gelisteten Längen sind mehrdeutig** (mehrere Werte erreichen
 * dieselbe Güte, weil der Opcode zu selten vorkommt). Sie sind für den
 * Skip-Pfad brauchbar, taugen aber nicht als Beleg für die Recordstruktur —
 * wer einen dieser Opcodes implementiert, muss seine Länge einzeln prüfen.
 *
 * **S-DEADSKIP bereinigt (2026-08-11).** Bis dahin standen 17 Opcodes in
 * BEIDEN Tabellen (0x02, 0x03, 0x49, 0x4A, 0x60, 0x70, 0x71, 0xA0–0xA5, 0xA8,
 * 0xB3, 0xF0, 0xF1). Diese Einträge waren **unerreichbar**, weil `vm.ts`
 * zuerst `IMPL_OPERAND_LEN` fragt. Alle 17 Paare stimmten überein — und genau
 * das machte sie gefährlich: Ein toter Eintrag, der zufällig richtig ist, sieht
 * aus wie eine Absicherung und ist in Wahrheit eine Sollbruchstelle, sobald
 * jemand nur eine der beiden Tabellen pflegt. `interpreter.test.ts` erzwingt
 * die Disjunktheit jetzt und prüft zugleich, dass beide Tabellen zusammen mit
 * KAWAI alle 256 Opcodes abdecken.
 */
export const SKIP_OPERAND_LEN: Readonly<Record<number, number>> = {
  0x04: 3, 0x05: 1, 0x06: 2, 0x08: 1, 0x09: 0, 0x0a: 0,
  0x0b: 0, 0x0c: 0, 0x0d: 0, 0x0e: 1, 0x0f: 0, 0x1a: 0, 0x1b: 0, 0x1c: 0,
  // 🔴 **0x20 MINIGAME bleibt auf 0 — die Referenzlänge 10 ist WIDERLEGT.**
  // Vorkommen: **134-mal in 78 Fields**. Die Referenz führt Gesamtlänge 11
  // (⇒ Operand 10). Dagegen steht eine harte, statistikfreie Schranke: In vier
  // Spannen (Field `ancnt1`) liegt der Opcode nur **6 Byte** vor dem
  // Spannenende, in vier weiteren 8 Byte. Zehn Operandenbytes passen dort
  // nicht hinein — die Länge kann höchstens 5 sein. Passend dazu verliert der
  // Spannen-Abschluss auf der betroffenen Teilmenge (110/118 mit Länge 0 gegen
  // 104/118 mit Länge 10), und die Grenzplausibilität bleibt für JEDE der 13
  // geprüften Längen unter dem Kontrollniveau (Bestwert 0,14 ± 0,14 bei
  // Länge 8; Instruktionsanfänge liegen bei 1,23).
  //
  // Damit ist der Posten **nicht** stillschweigend zu übernehmen. Er bleibt
  // ein offener Befund: Entweder ist 0x20 in diesem Bestand nicht durchgängig
  // MINIGAME, oder die Instruktion ist variabel lang. Beides ist mit dem
  // Field-Bytecode allein nicht zu entscheiden. **Wirkung heute:** Steht die
  // Länge zu niedrig, führt die VM Operandenbytes als Instruktionen aus; steht
  // sie zu hoch, überspringt sie echte. Solange keine der beiden Varianten
  // belegt ist, bleibt der gemessen bessere Ist-Wert stehen.
  0x1d: 4, 0x1e: 0, 0x1f: 0, 0x20: 0, 0x21: 0, 0x22: 1, 0x23: 4, 0x25: 8,
  // 🔴 0x27 BGMOVIE: 36 Vorkommen in 13 Fields. Referenz 1, Ist 0. Der
  // Spannen-Abschluss ist indifferent (18/18 für 0, 1 und 2), die
  // Grenzplausibilität stellt die Referenz SCHLECHTER als den Ist-Wert
  // (−1,56 gegen −0,43; Bestwert 0,27 ± 0,54 bei Länge 2, also Rauschen).
  // Zusätzlich gilt die harte Schranke Länge ≤ 3 (kleinster Abstand zum
  // Spannenende 4). Nicht übernommen.
  0x26: 1, 0x27: 0, 0x29: 0, 0x2a: 1, 0x2b: 1, 0x2c: 0, 0x2d: 6, 0x2e: 1,
  0x2f: 8, 0x30: 3, 0x31: 2, 0x32: 1, 0x33: 1, 0x34: 1, 0x35: 3, 0x36: 4,
  0x37: 7, 0x38: 0, 0x39: 0, 0x3a: 4, 0x3b: 4, 0x3c: 0, 0x3d: 0, 0x3e: 0,
  0x3f: 0, 0x41: 1, 0x42: 0, 0x43: 1, 0x44: 0, 0x45: 0, 0x46: 0, 0x47: 4,
  0x4b: 0, 0x4c: 7, 0x4d: 1, 0x4e: 14, 0x4f: 10, 0x51: 3,
  0x53: 1, 0x54: 1, 0x55: 1, 0x56: 3, 0x57: 8, 0x58: 4, 0x59: 2, 0x5a: 1,
  0x5b: 3, 0x5c: 5, 0x5d: 0, 0x5e: 7, 0x5f: 1, 0x61: 10, 0x62: 4,
  0x63: 5, 0x64: 5, 0x65: 0, 0x66: 8, 0x67: 0, 0x68: 8, 0x69: 6, 0x6a: 6,
  0x6b: 8, 0x6c: 0, 0x6d: 3, 0x6e: 2, 0x6f: 9, 0x72: 1,
  0x73: 3, 0x74: 3, 0x75: 7, 0x7e: 1, 0x7f: 2, 0x9a: 1, 0x9b: 0, 0x9c: 1,
  0x9d: 1, 0x9e: 0, 0x9f: 0,
  0xa9: 5, 0xaa: 1, 0xab: 3, 0xac: 0,
  0xad: 5, 0xae: 2, 0xaf: 2, 0xb0: 4, 0xb1: 4, 0xb2: 3, 0xb4: 5,
  0xb5: 3, 0xb6: 1, 0xb7: 2, 0xb8: 4, 0xb9: 3, 0xba: 2, 0xbb: 4, 0xbc: 4,
  0xbd: 3, 0xbe: 3, 0xbf: 1, 0xc0: 9, 0xc1: 7, 0xc2: 14, 0xc3: 10, 0xc4: 0,
  0xc5: 2, 0xc6: 2, 0xc7: 1, 0xc8: 1, 0xc9: 1, 0xca: 3, 0xcb: 2, 0xcc: 0,
  0xcd: 2, 0xce: 0, 0xcf: 0, 0xd0: 13, 0xd1: 1, 0xd2: 1, 0xd3: 1, 0xd4: 0,
  0xd5: 1, 0xd6: 1, 0xd7: 2, 0xd8: 2, 0xd9: 2, 0xda: 0, 0xdb: 2, 0xdc: 3,
  // 0xe0/0xe1/0xe4 sind seit F22/BGON implementiert (IMPL_OPERAND_LEN).
  //
  // 🔴 **0xE2 BGROL / 0xE3 BGROL2 bleiben bewusst auf dem Skip-Pfad.** Die
  // Referenz führt für beide Operandenlänge 2 (banks, param). Gemessen
  // (2026-08-11, 702 Fields): 0xE2 kommt **13-mal in 6 Fields** vor, 0xE3
  // **5-mal in 2 Fields**. Keine der drei Gütefunktionen belegt eine Länge:
  // Der Spannen-Abschluss ist indifferent (9/9 bzw. 2/2 für jede geprüfte
  // Länge), die Grenzplausibilität liefert bei n=9 einen Bestwert von
  // 0,83 ± 0,68 — Rauschen —, und die Struktursonde widerlegt die
  // Referenzaufteilung sogar: Das Parameterbyte an @+2 trifft nur in **11,1 %**
  // (1/9) einen Parameter, den dasselbe Field per BGON/BGOFF schaltet, gegen
  // ein Kontrollniveau von **22,2 %** bei den BGON-Parametern eines FREMDEN
  // Fields. Die Variante @+1 trifft zu 11,1 %, davon 7 von 9 mit dem Wert 0
  // (Nullwerte bestehen den Test trivial). Zum Vergleich das Niveau eines
  // belegten Opcodes: BGON trifft an derselben Stelle **98,0 %** (1963/2003)
  // gegen 46,7 % fremd.
  //
  // Damit ist BGROL **nicht implementierbar**: Ohne belegte Operandenlage wäre
  // jede Rotationssemantik geraten und würde die BGON-Maske derselben Gruppe
  // beschädigen — schlimmer als der heutige Übersprung. Was fehlt, ist ein
  // Bestand mit mehr Vorkommen, nicht eine weitere Auswertung dieses hier.
  0xdd: 0, 0xde: 0, 0xdf: 0, 0xe2: 1, 0xe3: 2,
  0xe5: 4, 0xe6: 4, 0xe7: 4, 0xe8: 4, 0xe9: 9, 0xea: 14, 0xeb: 1, 0xec: 3,
  0xed: 3, 0xee: 0, 0xef: 0, 0xf2: 6, 0xf3: 3, 0xf4: 3,
  // 🔴 0xFB MVCAM: 55 Vorkommen in 23 Fields. Referenz 1, Ist 0. Die Referenz
  // schneidet auf der Grenzplausibilität zwar besser ab als der Ist-Wert
  // (−0,46 gegen −1,42), bleibt aber weit unter dem Kontrollniveau echter
  // Instruktionsanfänge (1,23) — kein Kandidat erreicht es (Bestwert −0,11 bei
  // Länge 3). Der Spannen-Abschluss verschlechtert sich sogar (31/38 gegen
  // 34/38). Nicht übernommen; harte Schranke Länge ≤ 3.
  0xf5: 1, 0xf6: 1, 0xf7: 8, 0xf8: 1, 0xf9: 0, 0xfa: 2, 0xfb: 0, 0xfc: 1,
  0xfd: 0, 0xfe: 3, 0xff: 1,
};

/**
 * 🟡 KAWAI (0x28) ist variabel lang: erstes Operandenbyte = Gesamtlänge der
 * Instruktion inkl. Opcode und Längenbyte (`Zu validieren`).
 */
export const OP_KAWAI = 0x28;

/** Vergleichsoperatoren der IF-Familie (öffentlich dokumentiert). */
export const CMP = {
  EQ: 0,
  NE: 1,
  GT: 2,
  LT: 3,
  GE: 4,
  LE: 5,
  AND: 6,
  XOR: 7,
  OR: 8,
  BITON: 9,
  BITOFF: 10,
} as const;

export function evalComparison(a: number, b: number, op: number): boolean | null {
  switch (op) {
    case CMP.EQ: return a === b;
    case CMP.NE: return a !== b;
    case CMP.GT: return a > b;
    case CMP.LT: return a < b;
    case CMP.GE: return a >= b;
    case CMP.LE: return a <= b;
    case CMP.AND: return (a & b) !== 0;
    case CMP.XOR: return (a ^ b) !== 0;
    case CMP.OR: return (a | b) !== 0;
    case CMP.BITON: return (a & (1 << b)) !== 0;
    case CMP.BITOFF: return (a & (1 << b)) === 0;
    default: return null; // unbekannter Vergleich → Fault beim Aufrufer
  }
}
