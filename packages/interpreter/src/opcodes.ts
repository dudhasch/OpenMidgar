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
  /**
   * Hintergrund-Zustand weiterschalten (`BGROL`) bzw. zurückschalten
   * (`BGROL2`). Operanden: Bankpaar, param — dieselbe Form wie `BGCLR`.
   *
   * ✅ **Operandenlänge 2 belegt (2026-08-11)** — nicht über eine Quote,
   * sondern über die Struktur EINER Spanne. Der Beleg steht ausführlich unten
   * am Eintrag `0xE2` in `SKIP_OPERAND_LEN`; kurz:
   * `hyou4` [2137, 2213) enthält fünf `0xE2`- und vier `0xE3`-Blöcke, die
   * byteidentisch gebaut sind (`24 07 00 . eX 00 01`). `0xE3` steht bei uns
   * seit jeher auf 2. Unter Länge 1 für `0xE2` zerfallen die fünf ersten
   * Blöcke in `BGROL 00 / REQ 24 07 / RET`, die vier letzten bleiben
   * `BGROL2(00,01) / WAIT(7)` — **dieselbe Konstruktion, zwei Lesarten in
   * derselben Spanne**. Unter Länge 2 lesen beide gleich.
   */
  BGROL: 0xe2,
  BGROL2: 0xe3,
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
  // 0xE2 wandert 1 → 2 (Beleg: Strukturargument `hyou4`, s. u.), 0xE3 behält
  // seine 2 und wechselt nur die Tabelle, weil beide jetzt ausgeführt werden.
  [OP.BGROL]: 2,
  [OP.BGROL2]: 2,
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
 * ⚠️ **Diese Tabelle ist KEIN Fixpunkt** (Korrektur 2026-08-11). Bis dahin
 * stand in der Roadmap, ein erneuter Abstieg übernehme nichts mehr. Das
 * stimmt nicht: Seit O9 sind vier Längen gewandert (0x16–0x19, 0x52,
 * 0xA6/0xA7), und jede davon verschiebt den Instruktionsstrom und damit die
 * Gütelandschaft aller übrigen Opcodes. Der Abstieg schlägt heute **acht**
 * Änderungen vor und erreicht damit 99,9417 % statt 99,9230 %.
 *
 * **Übernommen wurde davon keine** — sieben scheitern am O9-Kriterium
 * (mehrdeutiges Maximum oder Gleichstand), die achte (0x7f, 2 → 6) an einer
 * neu gemessenen **Rauschschwelle**: An 68 eingefrorenen, unabhängig gedeckten
 * Opcodes schlägt in 5 Fällen (7,4 %) eine nachweislich FALSCHE Länge die
 * richtige — mit einem Vorsprung von median 1 und maximal 3 Spannen (`MUL`
 * 0x89 um 2, `IFUWL` 0x19 um 3). Ein Vorsprung von einer Spanne, wie ihn 0x7f
 * bietet, ist damit exakt das Rauschniveau dieser Gütefunktion. Wer die
 * Tabelle künftig anfasst, muss diese Schwelle überbieten.
 * Messanlage: `tools/realdata-scan/src/oplen-abstieg-nachlese.rdtest.ts`.
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
 *
 * ---
 *
 * 🟡 **Kostenfreies Referenzbündel (2026-08-11): 53 Längen auf den
 * Referenzwert gesetzt.** Herkunft: Referenz (Makou-Längentafel), Status:
 * Annahme.
 *
 * **Warum überhaupt.** Eine falsche Länge erzeugt nicht nur an ihrem eigenen
 * Opcode Unsinn, sondern verschiebt den Instruktionsstrom aller nachfolgenden
 * Bytes einer Spanne. So entstehen **Phantom-Fundstellen**: Bytes, die auf
 * einer scheinbaren Instruktionsgrenze landen und wie ein Opcode aussehen.
 * Genau daran ist die BGROL-Auswertung gescheitert (Lehrstück weiter unten).
 * Wer Fundstellen zählt, zählt zuerst die Fehler seiner eigenen Längentabelle.
 *
 * **Das Kriterium.** Für jeden Opcode, an dem Ist- und Referenzwert
 * auseinanderlaufen, wurde der Referenzwert **isoliert** auf die Ist-Tabelle
 * gesetzt und der Spannen-Abschluss über alle 48.041 Spannen neu gemessen.
 * Aufgenommen wurde, was den Abschluss **nicht verschlechtert**. Das trifft
 * auf 53 von 85 Abweichungen zu; gemeinsam angewandt geht der Abschluss von
 * **48.004/31/6** (geschlossen/Überlauf/unbekannt) auf **48.006/29/6** — zwei
 * Spannen besser, zwei Überläufe weniger, kein neuer Abbruch. Für die beiden
 * namentlich geprüften Einzelfälle 0x42 MPRA2 (0 → 5) und 0xCE MMBLK (0 → 1)
 * ist die Wirkung isoliert wie gemeinsam **bitgleich** 48.004/31/6.
 *
 * ⚠️ **Kostenfreiheit ist KEIN Beleg für Richtigkeit.** Der Abschluss ist an
 * seltenen Opcodes blind: Ein Opcode mit acht Vorkommen kann jede Länge
 * tragen, ohne die Kennzahl zu bewegen. Übernommen wird hier also nicht
 * „was gemessen richtig ist", sondern „was die Referenz sagt, ohne dass unsere
 * Messung widerspricht". Der Gewinn ist die **gesenkte Phantomrate**, nicht
 * neues Wissen. Alle 53 sind deshalb 🟡 und nicht 🟢; wer einen davon
 * implementiert, muss seine Länge einzeln belegen — genau wie zuvor.
 *
 * **Was NICHT übernommen wurde** und warum:
 *  - **30 Abweichungen verschlechtern den Abschluss** (0x04 PREQ −72, 0x05
 *    PRQSW −14, 0x09 SPLIT −13, 0x20 MINIGAME −6, 0x31 IFKEYON −6, 0xFB MVCAM
 *    −3, 0xFE CHMST −3, …). Sie bleiben auf dem Ist-Wert.
 *  - **0x20 MINIGAME** zusätzlich wegen einer harten Schranke: In vier Spannen
 *    steht der Opcode nur 6 Byte vor dem Spannenende; die Referenzlänge 10
 *    passt dort nicht hinein.
 *  - **0xDF MPPAL / 0xEF ADPAL2** halten die Abschlusszahl, tauschen aber
 *    einen Abbruch gegen einen Überlauf (31/6 → 32/5). Das ist keine
 *    schlechtere Zahl, aber eine Verschiebung — sie bleiben draußen, bis
 *    jemand sie einzeln ansieht.
 *
 * Nachgerechnet wird das Bündel in
 * `tools/realdata-scan/src/bgrol-belegkette.rdtest.ts`.
 */
export const SKIP_OPERAND_LEN: Readonly<Record<number, number>> = {
  0x04: 3, 0x05: 1, 0x06: 2, 0x08: 1, 0x09: 0, 0x0a: 0,
  0x0b: 0, 0x0c: 0, 0x0d: 0, 0x0e: 1, 0x0f: 0, 0x1a: 0, 0x1b: 2, 0x1c: 0,
  // 🔴 **0x20 MINIGAME bleibt auf 0. Die Referenzlänge 10 ist widerlegt — aber
  // zwei der früheren Begründungen dafür sind es inzwischen auch.**
  //
  // *Was steht:* Die Referenz führt Gesamtlänge 11 (⇒ Operand 10). Der
  // Spannen-Abschluss über alle Längen 0…12 lautet bestandsweit 48006, 48007,
  // 48003, 48004, 48006, 48003, 48003, 48002, 47998, 47996, **48001**, 47998,
  // 47994. Länge 10 liegt fünf Spannen unter dem Ist-Wert und damit über der
  // gemessenen Rauschschwelle von 3 Spannen — sie ist verworfen. Das Maximum
  // (48007 bei Länge 1) liegt eine Spanne über dem Ist-Wert, also **unter**
  // der Schwelle: auch die Alternative ist nicht belegt.
  //
  // *Was gefallen ist — 1: die „harte Schranke".* Sie lautete: In vier Spannen
  // steht der Opcode nur 6 Byte vor dem Spannenende, also passen zehn
  // Operandenbytes physisch nicht. Der Byte-Kontext zeigt jedoch, dass
  // **sieben der acht engsten Stellen** direkt hinter der Folge `31 00` liegen
  // — das ist `IFKEYON` mit Tastenmaske `0x2000`, und das `0x20` ist deren
  // hohes Byte, kein Opcode. Sichtbar wird es nur, weil unsere Tabelle 0x31
  // mit Operandenlänge 2 führt statt der Referenzlänge 3. Setzt man 0x31 auf
  // 3, verschwinden diese Stellen — dafür sinkt der Abschluss um 6 Spannen.
  // Zwei Messungen, die sich widersprechen; keine schlägt die andere. Der
  // engste Abstand beträgt dann noch 7 Byte, die Schranke lautet also
  // ≤ 7 statt ≤ 5 — die Referenzlänge 10 bleibt in beiden Lesarten draußen.
  //
  // *Was gefallen ist — 2: „der Opcode kommt vor".* Hier stand, 118 verankerte
  // Fundstellen in 79 Fields belegten, dass die Suchmenge für einen späteren
  // Minispiel-Einstieg nicht leer sei. Beides trägt nicht mehr: Unter der
  // korrigierten Längentabelle sind es nur noch **67 in 49 Fields** (die
  // Hälfte waren Phantome der eigenen Tabelle), und die fehlende
  // Negativkontrolle liefert das Urteil: Dekodiert man dieselben Spannen ab
  // `spanStart + k` — ein nachweislich falsches Raster, in dem jede Fundstelle
  // per Konstruktion ein Phantom ist —, meldet die verankerte Zählung
  // **1318 / 652 / 717** Fundstellen für k = 1/2/3. Eine Zählung, die auf
  // falschem Raster zehnmal so viel findet wie auf richtigem, belegt kein
  // Vorkommen. Sie ist bestenfalls eine obere Schranke.
  //
  // **Wirkung heute:** Steht die Länge zu niedrig, führt die VM Operandenbytes
  // als Instruktionen aus; steht sie zu hoch, überspringt sie echte. Solange
  // keine Variante belegt ist, bleibt der gemessen beste Ist-Wert stehen.
  // Messanlage: `tools/realdata-scan/src/minigame-laengenfrage.rdtest.ts`.
  0x1d: 4, 0x1e: 0, 0x1f: 0, 0x20: 0, 0x21: 1, 0x22: 4, 0x23: 4, 0x25: 8,
  // 🟡 0x27 BGMOVIE: 0 → 1 (Referenz). Gehört zum Korrekturbündel unten. Die
  // frühere Ablehnung stützte sich auf die Grenzplausibilität, die die
  // Referenz schlechter stellte als den Ist-Wert (−1,56 gegen −0,43) — deren
  // Bestwert lag jedoch bei 0,27 ± 0,54 und damit selbst im Rauschen. Eine
  // Gütefunktion, die an dieser Stelle nicht trennt, darf hier auch nicht
  // ablehnen. Die harte Schranke Länge ≤ 3 ist mit 1 eingehalten.
  0x26: 1, 0x27: 1, 0x29: 0, 0x2a: 1, 0x2b: 1, 0x2c: 0, 0x2d: 6, 0x2e: 1,
  0x2f: 9, 0x30: 3, 0x31: 2, 0x32: 1, 0x33: 1, 0x34: 1, 0x35: 3, 0x36: 4,
  0x37: 7, 0x38: 5, 0x39: 0, 0x3a: 5, 0x3b: 3, 0x3c: 0, 0x3d: 0, 0x3e: 0,
  0x3f: 0, 0x41: 4, 0x42: 5, 0x43: 1, 0x44: 0, 0x45: 4, 0x46: 0, 0x47: 4,
  0x4b: 1, 0x4c: 0, 0x4d: 1, 0x4e: 0, 0x4f: 4, 0x51: 5,
  0x53: 1, 0x54: 1, 0x55: 2, 0x56: 6, 0x57: 6, 0x58: 4, 0x59: 4, 0x5a: 4,
  0x5b: 3, 0x5c: 7, 0x5d: 0, 0x5e: 7, 0x5f: 0, 0x61: 1, 0x62: 4,
  0x63: 5, 0x64: 5, 0x65: 0, 0x66: 8, 0x67: 0, 0x68: 8, 0x69: 1, 0x6a: 6,
  0x6b: 8, 0x6c: 0, 0x6d: 3, 0x6e: 2, 0x6f: 9, 0x72: 2,
  0x73: 3, 0x74: 3, 0x75: 7, 0x7e: 1, 0x7f: 2, 0x9a: 1, 0x9b: 4, 0x9c: 5,
  0x9d: 6, 0x9e: 6, 0x9f: 0,
  0xa9: 5, 0xaa: 1, 0xab: 3, 0xac: 0,
  0xad: 5, 0xae: 2, 0xaf: 2, 0xb0: 4, 0xb1: 4, 0xb2: 3, 0xb4: 5,
  0xb5: 5, 0xb6: 1, 0xb7: 3, 0xb8: 4, 0xb9: 3, 0xba: 2, 0xbb: 4, 0xbc: 4,
  0xbd: 3, 0xbe: 0, 0xbf: 1, 0xc0: 10, 0xc1: 7, 0xc2: 14, 0xc3: 11, 0xc4: 0,
  0xc5: 2, 0xc6: 2, 0xc7: 1, 0xc8: 1, 0xc9: 1, 0xca: 3, 0xcb: 2, 0xcc: 2,
  0xcd: 2, 0xce: 1, 0xcf: 1, 0xd0: 12, 0xd1: 1, 0xd2: 1, 0xd3: 1, 0xd4: 9,
  0xd5: 9, 0xd6: 3, 0xd7: 2, 0xd8: 2, 0xd9: 0, 0xda: 14, 0xdb: 1, 0xdc: 3,
  // 0xe0…0xe4 (BGON, BGOFF, BGROL, BGROL2, BGCLR) sind vollständig
  // implementiert und stehen in `IMPL_OPERAND_LEN`.
  //
  // ═══════════════════════════════════════════════════════════════════════
  // 📕 **Lehrstück: wie 0xE2 BGROL fälschlich für „nicht implementierbar"
  // erklärt wurde (2026-08-11, am selben Tag widerlegt).**
  //
  // Hier stand bis zur Gegenprobe ein langer Block, der BGROL für
  // unentscheidbar erklärte. Die Kette ist erhalten, weil jedes Glied ein
  // eigener, wiederholbarer Fehler ist:
  //
  //  1. **Zirkuläre Eichung.** Der erste Durchgang verglich das Byte an
  //     BGROL@+2 mit der Menge der Parameter, die BGON im selben Field
  //     schaltet (98,0 % „Treffer"). Diese Vergleichsmenge wird AUS BGON
  //     gebaut — BGON trifft sie per Konstruktion zu ~100 %. Ein Maßstab, den
  //     der Eichkörper definiert, misst nichts.
  //  2. **Richtige Ersatzeichung, falsche Fundstellenmenge.** Der Wechsel auf
  //     BGCLR (0xE4) als Eichkörper war methodisch zulässig. Nur waren von den
  //     neun BGROL-„Fundstellen" **acht Phantome**: Sie entstanden, weil
  //     falsche Längen an ganz anderen Opcodes (u. a. 0x42 MPRA2 und 0xCE
  //     MMBLK) den Instruktionsstrom verschoben, bis irgendwo ein 0xE2-Byte
  //     auf einer scheinbaren Instruktionsgrenze lag. Nach den kostenfreien
  //     Längenkorrekturen (s. Bündel oben) fällt 0xE2 von **13 Vorkommen in
  //     6 Fields auf 6 in 2 Fields**: fünf in `hyou4`, eine in `subin_2b`.
  //     `blackbg4`, `del1`, `frcyo` und `junair2` verschwinden vollständig —
  //     sie waren Phantome. 0xE3 fällt von 5 auf 4, alle in `hyou4`. Die
  //     verbleibende `subin_2b`-Stelle trägt Bankbyte 0xFF und Parameter 190,
  //     zu dem das Field keine Kachelgruppe hat; sie ist ihrerseits verdächtig.
  //  3. **n=1 als „disjunkte Intervalle" verkauft.** Die BGCLR-Eichung wurde
  //     auf 620 Vorkommen gerechnet, die BGROL-Zahl auf 8 — und beide Mengen
  //     lagen auf verschiedenen Fields. Gepaart auf denselben Fields hatte die
  //     Eichung n=1. Verglichen wurden also 273 fremde Fields gegen 5.
  //  4. **Pseudoreplikation.** Vier der neun Stellen lagen in `frcyo` als
  //     byteidentische Kopien derselben Sequenz. Sie sind eine Beobachtung,
  //     nicht vier.
  //  5. **Der Fehlschluss selbst.** Aus „meine Gütefunktionen trennen hier
  //     nicht" wurde „die Frage ist nicht entscheidbar". Das ist die
  //     eigentliche Lehre, und sie gilt über diesen Opcode hinaus:
  //     **Wenn eine Gütefunktion blind ist, folgt daraus, mit einem anderen
  //     Mittel zu entscheiden — nicht, dass es nichts zu entscheiden gibt.**
  //
  // Entschieden hat am Ende die **Struktur einer einzigen Spanne**, keine
  // Quote: `hyou4` [2137, 2213) enthält
  //
  //     e4 00 01 · e0 00 01 00 · 00 · e1 00 01 01 · e0 00 01 00
  //     dann NEUNMAL (24 07 00 · eX 00 01) — fünfmal eX = e2, viermal eX = e3
  //     · 12 41 · 00
  //
  // Die neun Blöcke sind byteidentisch gebaut. 0xE3 stand bei uns schon immer
  // auf Länge 2, also lesen sich die vier e3-Blöcke sauber als
  // `BGROL2(00,01) / WAIT(7)`. Unter der alten Länge 1 für 0xE2 zerfallen die
  // fünf e2-Blöcke dagegen in `BGROL 00 / REQ 24 07 / RET` — dieselbe
  // Konstruktion, zwei Lesarten in EINER Spanne. Unter Länge 2 lesen beide
  // gleich. Das ist statistikfrei und braucht keine Fundstellenmenge.
  //
  // Zwei unabhängige Stützen:
  //  - Der Rumpf ab 2145 schließt mit `JMPB 0x41` bei 2210. Unter Länge 2 ist
  //    das erste `RET` des Rumpfes die Marke bei 2212, also HINTER dem
  //    Rücksprung — eine geschlossene Schleife aus fünf Vorwärts- und vier
  //    Rückwärtsrollen, je durch `WAIT(7)` getrennt. Unter Länge 1 liegt das
  //    erste `RET` bei 2161, mitten im ersten Durchlauf: die Schleife wäre gar
  //    keine.
  //  - `hyou4` trägt zu param 1 die Zustände 0, 1, 2, 4, 8, 16, 32 — eine
  //    Sechsbild-Animation, genau das, was fünf Vorwärts- und vier
  //    Rückwärtsrollen durchschalten.
  //
  // 🟡 Die Fundstelle in `subin_2b` bleibt ein offener Rest: Passt die Länge,
  // müsste sie wie die übrigen Bankbyte 0x00 tragen. Sie ist als einzelne
  // Stelle kein Gegenbeleg gegen die Spannenstruktur, aber sie ist auch nicht
  // erklärt.
  //
  // Was `junonr2` beisteuert (`junonr2-bgfluss-probe.rdtest.ts`): Das Field
  // schreibt die Rotation, die BGROL in einer Instruktion tut, von Hand als
  // Paarfolge BGOFF(param, s) → BGON(param, s+1) über s = 0…7 aus. Das stützt
  // die *Semantik* und sagt über die Operandenlänge nichts — diese Trennung
  // war schon damals richtig und bleibt es.
  // ═══════════════════════════════════════════════════════════════════════
  0xdd: 0, 0xde: 0, 0xdf: 0,
  0xe5: 4, 0xe6: 4, 0xe7: 4, 0xe8: 6, 0xe9: 9, 0xea: 9, 0xeb: 4, 0xec: 3,
  0xed: 3, 0xee: 7, 0xef: 0, 0xf2: 6, 0xf3: 1, 0xf4: 1,
  // 🔴 0xFB MVCAM: 55 roh / 38 verankert in 23 Fields. Referenz 1, Ist 0. Die
  // Referenz schneidet auf der Grenzplausibilität zwar besser ab als der
  // Ist-Wert (−0,46 gegen −1,42), bleibt aber weit unter dem Kontrollniveau
  // echter Instruktionsanfänge (1,23) — kein Kandidat erreicht es (Bestwert
  // −0,11 bei Länge 3). Der Spannen-Abschluss verschlechtert sich sogar
  // (31/38 gegen 34/38). Nicht übernommen; harte Schranke Länge ≤ 3.
  //
  // Nachlese 2026-08-11, alle Längen 0…12: 34, 31, 35, 34, 31, 32, 34, 33, 30,
  // 34, 30, 29, 28 von 38. Bester Wert bei Länge 2 — mit **einer** Spanne
  // Vorsprung vor dem Ist-Wert und damit unter der Rauschschwelle (3 Spannen).
  0xf5: 1, 0xf6: 1, 0xf7: 3, 0xf8: 1, 0xf9: 0, 0xfa: 2, 0xfb: 0, 0xfc: 1,
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
