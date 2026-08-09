import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S16-Nachprobe „audio.fmt-Eintragslayout", zweiter Anlauf.
 *
 * Der erste Anlauf suchte über **Teiler** der Dateigröße und über *alle*
 * u32-Feldpaare. Beides war zu grob:
 *
 *  - Die Teilersuche setzt stillschweigend voraus, dass die Datei KEINEN
 *    Vorspann hat. 54.668 = 2²·79·173 hat kaum Teiler, also blieben nur die
 *    unbrauchbaren Eintragsgrößen 4 und 79 übrig.
 *  - Ohne festgelegte Feldreihenfolge gewinnt bei „irgendein Paar aus u32"
 *    fast immer Rauschen.
 *
 * FFNx beschreibt den Eintrag als Folge von sechs u32 in fester Reihenfolge:
 * **length · offset · loop · count · loop_start · loop_end**, gefolgt von
 * einem WAVEFORMATEX. Entscheidend ist dabei, dass **die Länge VOR dem
 * Offset** steht — genau das hat der erste Anlauf nie festgehalten.
 *
 * Diese Probe sucht deshalb über `Vorspann × Eintragsgröße` (statt über
 * Teiler) und prüft die feste Feldreihenfolge gegen eine Kontrolle mit
 * vertauschten Feldern. Bewertet wird über drei Quoten, die eine echte
 * Bereichstabelle nahe 100 % erfüllen muss:
 *
 *  - Rahmen:              `offset + length <= |audio.dat|`
 *  - Monotonie:           Offsets steigen über die Einträge
 *  - Überlappungsfreiheit: `offset[i] + length[i] <= offset[i+1]`
 *
 * Urheberrecht/Datenschutz: Ausgabe ausschließlich Zähler, Quoten und
 * Layoutparameter — kein Audioinhalt, keine Rohbytefolgen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const FMT = join(REAL_DIR, 'data', 'sound', 'audio.fmt');
const DAT = join(REAL_DIR, 'data', 'sound', 'audio.dat');
const available = existsSync(FMT) && existsSync(DAT);

interface Bewertung {
  header: number;
  entrySize: number;
  entries: number;
  /** Byteposition des Längenfeldes bzw. des Offsetfeldes im Eintrag. */
  lenAt: number;
  offAt: number;
  rahmen: number;
  monoton: number;
  ohneUeberlappung: number;
  /** Rangkriterium: die schwächste der drei Quoten. */
  guete: number;
}

function bewerte(
  fmt: Uint8Array,
  datSize: number,
  header: number,
  entrySize: number,
  lenAt: number,
  offAt: number,
): Bewertung {
  const slots = Math.floor((fmt.length - header) / entrySize);
  const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  let rahmen = 0;
  let monoton = 0;
  let ohneUeberlappung = 0;
  let prevOff = -1;
  let prevEnd = 0;
  let vergleiche = 0;
  let entries = 0;
  for (let i = 0; i < slots; i++) {
    const at = header + i * entrySize;
    // Ungenutzte Slots überspringen. Dieselbe Lehre wie bei den Triggern:
    // Eine Tabelle fester Größe trägt genullte Reserveplätze, und die
    // zerschlagen jede Monotonie-Messung, wenn man sie mitzählt.
    let leer = true;
    for (let b = 0; b < entrySize; b++) {
      if (fmt[at + b] !== 0) {
        leer = false;
        break;
      }
    }
    if (leer) continue;
    entries++;
    const length = view.getUint32(at + lenAt, true);
    const offset = view.getUint32(at + offAt, true);
    if (offset + length <= datSize) rahmen++;
    if (prevOff >= 0) {
      vergleiche++;
      if (offset >= prevOff) monoton++;
      if (prevEnd <= offset) ohneUeberlappung++;
    }
    prevOff = offset;
    prevEnd = offset + length;
  }
  const q = (n: number, d: number): number => (d === 0 ? 0 : n / d);
  const r = q(rahmen, entries);
  const m = q(monoton, vergleiche);
  const u = q(ohneUeberlappung, vergleiche);
  return {
    header,
    entrySize,
    entries,
    lenAt,
    offAt,
    rahmen: r,
    monoton: m,
    ohneUeberlappung: u,
    guete: Math.min(r, m, u),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

describe.skipIf(!available)('Realdaten: audio.fmt-Eintragslayout (S16, zweiter Anlauf)', () => {
  it('Vorspann × Eintragsgröße mit fester Feldreihenfolge', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const datSize = statSync(DAT).size;

    const alle: Bewertung[] = [];
    // Vorspann 0…256, Eintragsgröße 8…256 — jede Kombination, die glatt
    // aufgeht. Das ist der Suchraum, den die reine Teilersuche verfehlt hat.
    for (let header = 0; header <= 256; header++) {
      const rest = fmt.length - header;
      if (rest <= 0) continue;
      for (let entrySize = 8; entrySize <= 256; entrySize += 2) {
        if (rest % entrySize !== 0) continue;
        const entries = rest / entrySize;
        if (entries < 32) continue; // eine Klangbank hat viele Einträge
        // FFNx-Reihenfolge: Länge bei +0, Offset bei +4.
        alle.push(bewerte(fmt, datSize, header, entrySize, 0, 4));
      }
    }
    alle.sort((a, b) => b.guete - a.guete);
    const best = alle[0];

    console.log(
      'audio.fmt (Feldreihenfolge length@0, offset@4):',
      JSON.stringify(
        {
          fmtGroesse: fmt.length,
          datGroesse: datSize,
          geprueteLayouts: alle.length,
          top: alle.slice(0, 5).map((b) => ({
            layout: `Vorspann ${b.header}, Eintrag ${b.entrySize} B, ${b.entries} Einträge`,
            rahmen: pct(b.rahmen),
            monoton: pct(b.monoton),
            ohneUeberlappung: pct(b.ohneUeberlappung),
          })),
        },
        null,
        1,
      ),
    );

    if (best && best.guete > 0.9) {
      // Kontrolle: dieselbe Aufteilung, aber Länge und Offset vertauscht.
      // Trägt die auch, misst die Probe nicht die Feldreihenfolge, sondern
      // nur „irgendwelche kleinen Zahlen".
      const vertauscht = bewerte(fmt, datSize, best.header, best.entrySize, 4, 0);
      // Zweite Kontrolle: Felder um 2 Byte verschoben.
      const verschoben = bewerte(fmt, datSize, best.header, best.entrySize, 2, 6);
      console.log(
        'Kontrollen zum besten Layout:',
        JSON.stringify(
          {
            belegt: { rahmen: pct(best.rahmen), monoton: pct(best.monoton), ohneUeberlappung: pct(best.ohneUeberlappung) },
            vertauscht: { rahmen: pct(vertauscht.rahmen), monoton: pct(vertauscht.monoton), ohneUeberlappung: pct(vertauscht.ohneUeberlappung) },
            verschoben: { rahmen: pct(verschoben.rahmen), monoton: pct(verschoben.monoton), ohneUeberlappung: pct(verschoben.ohneUeberlappung) },
          },
          null,
          1,
        ),
      );
      expect(best.guete).toBeGreaterThan(vertauscht.guete);
      expect(best.guete).toBeGreaterThan(verschoben.guete);
    }

    expect(alle.length).toBeGreaterThan(0);
  }, 300_000);

  /**
   * Die Eintragsgröße NICHT raten, sondern messen.
   *
   * In einer Eintragstabelle mit WAVEFORMATEX sind mehrere Felder über alle
   * Einträge hinweg konstant (Formatkennung, Abtastrate, Kanalzahl). Ein
   * konstanter Wert kehrt deshalb in **exakt dem Abstand der Eintragsgröße**
   * wieder. Statt Layouts durchzuprobieren, sammelt diese Messung häufige
   * u32-Werte und bildet ein Histogramm ihrer Positionsabstände: Der
   * dominante Abstand IST die Eintragsgröße.
   *
   * Das Verfahren ist selbstkontrollierend — findet sich kein dominanter
   * Abstand, ist die Datei keine Tabelle gleich großer Einträge.
   */
  it('Eintragsgröße aus wiederkehrenden Konstanten ableiten', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);

    // u32-Werte an JEDER Byteposition sammeln (die Ausrichtung ist unbekannt).
    const positionen = new Map<number, number[]>();
    for (let at = 0; at + 4 <= fmt.length; at++) {
      const v = view.getUint32(at, true);
      if (v === 0) continue; // Nullen sind Füllung, keine Konstante
      let list = positionen.get(v);
      if (!list) positionen.set(v, (list = []));
      list.push(at);
    }

    // Abstände häufiger Werte histogrammieren.
    const abstand = new Map<number, number>();
    let beitragendeWerte = 0;
    for (const list of positionen.values()) {
      if (list.length < 20) continue; // seltene Werte tragen nur Rauschen bei
      beitragendeWerte++;
      for (let i = 1; i < list.length; i++) {
        const d = list[i]! - list[i - 1]!;
        if (d < 8 || d > 4096) continue;
        abstand.set(d, (abstand.get(d) ?? 0) + 1);
      }
    }

    const top = [...abstand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const gesamt = [...abstand.values()].reduce((a, b) => a + b, 0);
    console.log(
      'Abstandshistogramm wiederkehrender u32-Konstanten:',
      JSON.stringify(
        {
          beitragendeWerte,
          abstaendeGesamt: gesamt,
          top: top.map(([d, n]) => `${d} B: ${n}× (${((n / gesamt) * 100).toFixed(1)}%)`),
        },
        null,
        1,
      ),
    );

    const [dominant, treffer] = top[0] ?? [0, 0];
    if (dominant > 0 && treffer / gesamt > 0.2) {
      // Der Vorspann folgt jetzt zwingend aus der gemessenen Eintragsgröße:
      // Es ist der Rest, den die Dateigröße lässt. (Der Umweg über die
      // Restklasse der Konstante wäre falsch — er schleppt die unbekannte
      // Feldlage der Konstante INNERHALB des Eintrags mit.)
      const header = fmt.length % dominant;
      const entries = (fmt.length - header) / dominant;
      console.log(
        'Abgeleitetes Layout:',
        JSON.stringify({ eintragsgroesse: dominant, vorspann: header, eintraege: entries }),
      );

      const datSize = statSync(DAT).size;
      // Mit gemessener Eintragsgröße die Feldpositionen durchsuchen, statt sie
      // anzunehmen: Welches u32-Paar erfüllt die drei Quoten?
      const kandidaten: Bewertung[] = [];
      for (let lenAt = 0; lenAt + 4 <= dominant; lenAt++) {
        for (let offAt = 0; offAt + 4 <= dominant; offAt++) {
          if (lenAt === offAt) continue;
          kandidaten.push(bewerte(fmt, datSize, header, dominant, lenAt, offAt));
        }
      }
      kandidaten.sort((a, b) => b.guete - a.guete);
      const ffnx = bewerte(fmt, datSize, header, dominant, 0, 4);
      console.log(
        'Beste Feldpositionen bei gemessener Eintragsgröße:',
        JSON.stringify(
          {
            genutzteEintraege: `${ffnx.entries}/${entries}`,
            'FFNx-Reihenfolge (length@0, offset@4)': {
              rahmen: pct(ffnx.rahmen),
              monoton: pct(ffnx.monoton),
              ohneUeberlappung: pct(ffnx.ohneUeberlappung),
            },
            top: kandidaten.slice(0, 5).map((b) => ({
              felder: `length@${b.lenAt}, offset@${b.offAt}`,
              rahmen: pct(b.rahmen),
              monoton: pct(b.monoton),
              ohneUeberlappung: pct(b.ohneUeberlappung),
            })),
          },
          null,
          1,
        ),
      );
    }

    expect(gesamt).toBeGreaterThan(0);
  }, 300_000);

  /**
   * Feinschnitt: Das Offsetfeld ist über die Monotonie schon lokalisiert
   * (95,8 % bei +4 — eine Quote, die kein beliebiges Feld erreicht). Gesucht
   * ist jetzt nur noch das Längenfeld. Statt weiter über Quoten zu raten,
   * werden die Werte je Kandidatenposition beschrieben: Ein Längenfeld muss
   * zur LÜCKE bis zum nächsten Offset passen.
   */
  it('Längenfeld über die Lücke zum nächsten Offset bestimmen', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
    const datSize = statSync(DAT).size;
    const ENTRY = 74;
    const HEADER = fmt.length % ENTRY;
    const N = (fmt.length - HEADER) / ENTRY;

    const offsets: number[] = [];
    for (let i = 0; i < N; i++) offsets.push(view.getUint32(HEADER + i * ENTRY + 4, true));

    // Die Lücke zum nächsten Offset ist die maximal mögliche Länge.
    const luecken: number[] = [];
    for (let i = 0; i < N - 1; i++) luecken.push(offsets[i + 1]! - offsets[i]!);

    let bestPos = -1;
    let bestExakt = -1;
    const bewertungen: { pos: number; exakt: number; passt: number }[] = [];
    for (let lenAt = 0; lenAt + 4 <= ENTRY; lenAt++) {
      if (lenAt === 4) continue;
      let exakt = 0;
      let passt = 0;
      for (let i = 0; i < N - 1; i++) {
        const len = view.getUint32(HEADER + i * ENTRY + lenAt, true);
        if (len === luecken[i]) exakt++;
        if (len > 0 && len <= luecken[i]!) passt++;
      }
      bewertungen.push({ pos: lenAt, exakt, passt });
      if (exakt > bestExakt) {
        bestExakt = exakt;
        bestPos = lenAt;
      }
    }
    bewertungen.sort((a, b) => b.exakt - a.exakt || b.passt - a.passt);

    console.log(
      'Längenfeld gegen die Lücke zum nächsten Offset:',
      JSON.stringify(
        {
          eintraege: N,
          offsetsMonotonSteigend: offsets.every((v, i) => i === 0 || v >= offsets[i - 1]!),
          offsetMax: offsets[N - 1],
          datGroesse: datSize,
          letzterOffsetPasstInDat: offsets[N - 1]! <= datSize,
          top: bewertungen.slice(0, 5).map((b) => ({
            position: `+${b.pos}`,
            exaktGleichLuecke: `${b.exakt}/${N - 1} (${((b.exakt / (N - 1)) * 100).toFixed(1)}%)`,
            passtInLuecke: `${b.passt}/${N - 1} (${((b.passt / (N - 1)) * 100).toFixed(1)}%)`,
          })),
        },
        null,
        1,
      ),
    );

    expect(bestPos).toBeGreaterThanOrEqual(0);
  }, 300_000);

  /**
   * Strukturkarte statt Ratespiel.
   *
   * Nach zwei Fehlversuchen ist klar, dass Quotenmaße hier in die Irre führen:
   * Ein großer Teil der Einträge trägt Nullen, und Nullen sind trivial
   * monoton, trivial rahmenkonform und trivial überlappungsfrei. Genau daran
   * ist schon die Prüfsummensuche einmal gescheitert.
   *
   * Diese Messung beschreibt den Eintrag deshalb nur noch: Wie viele
   * VERSCHIEDENE Werte trägt jede Byteposition über alle 738 Einträge? Ein
   * konstantes Feld (WAVEFORMATEX-Kopf: Formatkennung, Kanalzahl, Abtastrate)
   * hat sehr wenige; ein Datenfeld (Offset, Länge) sehr viele. Die Karte
   * trennt beide Bereiche, ohne eine Hypothese vorauszusetzen.
   */
  it('Strukturkarte: Wertevielfalt je Byteposition', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
    const ENTRY = 74;
    const HEADER = fmt.length % ENTRY;
    const N = (fmt.length - HEADER) / ENTRY;

    let leereEintraege = 0;
    for (let i = 0; i < N; i++) {
      const at = HEADER + i * ENTRY;
      if (fmt.subarray(at, at + ENTRY).every((b) => b === 0)) leereEintraege++;
    }

    const karte: string[] = [];
    for (let pos = 0; pos + 4 <= ENTRY; pos += 2) {
      const werte = new Map<number, number>();
      for (let i = 0; i < N; i++) {
        const v = view.getUint32(HEADER + i * ENTRY + pos, true);
        werte.set(v, (werte.get(v) ?? 0) + 1);
      }
      const haeufigster = [...werte.entries()].sort((a, b) => b[1] - a[1])[0]!;
      karte.push(
        `+${String(pos).padStart(2)}: ${String(werte.size).padStart(4)} versch., ` +
          `häufigster ${haeufigster[0]} (${((haeufigster[1] / N) * 100).toFixed(0)}%)`,
      );
    }

    console.log(
      `audio.fmt-Strukturkarte (${N} Einträge à ${ENTRY} B, Vorspann ${HEADER}, ` +
        `davon ${leereEintraege} vollständig genullt):\n  ` +
        karte.join('\n  '),
    );

    expect(N).toBe(738);
  }, 300_000);

  /**
   * Der Vorspann, direkt gemessen — und damit das ganze Layout.
   *
   * Die Strukturkarte hat ein WAVEFORMATEX sichtbar gemacht (Abtastrate
   * 44100, Formatkennung 2 = MS-ADPCM, 4 Bit je Sample, cbSize 32). Ein
   * WAVEFORMATEX mit 32 Byte Zusatzdaten ist **50 Byte** lang; zusammen mit
   * sechs u32-Kopffeldern ergibt das genau die gemessenen 74 Byte je Eintrag.
   *
   * Damit ist der Vorspann keine Annahme mehr, sondern messbar: Er ist der
   * Versatz, bei dem die drei Konstanten des WAVEFORMATEX in möglichst vielen
   * Einträgen an ihrer vorhergesagten Stelle stehen. Die Messung prüft ALLE
   * 74 möglichen Versätze und meldet den Abstand zum Zweitplatzierten — nur
   * ein deutlicher Abstand ist ein Befund.
   */
  it('Vorspann aus dem WAVEFORMATEX ableiten und das Layout schließen', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
    const datSize = statSync(DAT).size;
    const ENTRY = 74;
    const WFX = 24; // WAVEFORMATEX beginnt hinter den sechs u32-Kopffeldern

    const treffer: { header: number; n: number; geprueft: number }[] = [];
    for (let header = 0; header < ENTRY; header++) {
      const n = Math.floor((fmt.length - header) / ENTRY);
      let ok = 0;
      for (let i = 0; i < n; i++) {
        const at = header + i * ENTRY + WFX;
        if (at + 18 > fmt.length) break;
        const formatTag = view.getUint16(at, true);
        const bits = view.getUint16(at + 14, true);
        const cbSize = view.getUint16(at + 16, true);
        if (formatTag === 2 && bits === 4 && cbSize === 32) ok++;
      }
      treffer.push({ header, n: ok, geprueft: n });
    }
    treffer.sort((a, b) => b.n - a.n);
    const best = treffer[0]!;
    const zweiter = treffer[1]!;

    // Kopffelder mit dem gemessenen Vorspann auswerten.
    const n = Math.floor((fmt.length - best.header) / ENTRY);
    const felder: number[][] = [[], [], [], [], [], []];
    for (let i = 0; i < n; i++) {
      const at = best.header + i * ENTRY;
      for (let f = 0; f < 6; f++) felder[f]!.push(view.getUint32(at + f * 4, true));
    }
    const offsets = felder[1]!;
    const lengths = felder[0]!;
    const monoton = offsets.filter((v, i) => i === 0 || v >= offsets[i - 1]!).length;
    const rahmen = offsets.filter((v, i) => v + lengths[i]! <= datSize).length;
    const ohneUeberlappung = offsets.filter(
      (v, i) => i === 0 || offsets[i - 1]! + lengths[i - 1]! <= v,
    ).length;
    const luecke = offsets.filter(
      (v, i) => i + 1 < n && lengths[i]! === offsets[i + 1]! - v,
    ).length;

    console.log(
      'audio.fmt — Layout geschlossen:',
      JSON.stringify(
        {
          vorspann: best.header,
          eintraege: best.geprueft,
          wfxTreffer: `${best.n}/${best.geprueft}`,
          zweitbesterVorspann: `${zweiter.header} mit ${zweiter.n}/${zweiter.geprueft}`,
          restBytes: fmt.length - best.header - best.geprueft * ENTRY,
          kopffelder: {
            'length@0 + offset@4 im Rahmen': `${rahmen}/${n} (${((rahmen / n) * 100).toFixed(1)}%)`,
            'offsets monoton': `${monoton}/${n} (${((monoton / n) * 100).toFixed(1)}%)`,
            überlappungsfrei: `${ohneUeberlappung}/${n} (${((ohneUeberlappung / n) * 100).toFixed(1)}%)`,
            'length trifft Lücke exakt': `${luecke}/${n - 1} (${((luecke / (n - 1)) * 100).toFixed(1)}%)`,
          },
          maxOffset: Math.max(...offsets),
          datGroesse: datSize,
        },
        null,
        1,
      ),
    );

    // BELEGT ist nur die Eintragsgröße 74 — sie stammt aus dem
    // Abstandshistogramm und setzt keine Hypothese voraus. 738 Einträge à
    // 74 Byte passen in die Datei.
    expect(best.geprueft).toBe(738);

    // NICHT belegt ist der Vorspann: 10 trifft das WAVEFORMATEX in 265 von
    // 738 Einträgen, der Zweitplatzierte (0) in 198 — Faktor 1,34. Nach der
    // Projektregel ist das Rauschen mit Schlagseite, kein Befund. Die
    // Erwartung hält diesen Zustand ausdrücklich fest, statt ihn zu
    // beschönigen: Sobald jemand das Layout wirklich schließt, MUSS dieser
    // Test brechen und angepasst werden.
    expect(best.n).toBeLessThan(zweiter.n * 3);
  }, 300_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
