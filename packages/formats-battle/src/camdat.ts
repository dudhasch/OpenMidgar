import { bdiag, type BattleDiagnostic } from './diagnostics.js';

/**
 * `camdat*.bin` — Container der Kampfkameraskripte (K11).
 *
 * **Warum es diesen Parser gibt.** K8 hat gezeigt, dass **keine** der drei
 * Kameras aus dem 48-B-Block der Szene die Ansicht der Originalaufnahme zeigt —
 * bei keinem Öffnungswinkel, entschieden über eine Invariante statt über eine
 * Statistik. Die Frage war damit nicht „welcher Zoom", sondern „welche
 * Kamera". `camdat` ist die Antwortquelle: Die Gegnerrecords tragen 16
 * Kamerabewegungs-IDs je Attacke (`attackCameraRaw` @0x68), und die zeigen
 * hierher.
 *
 * ---
 *
 * ## Was hier 🟢 belegt ist
 *
 * Der Container zerfällt in vier u32-Zeiger und danach dicht gepackte
 * Skriptkörper. **Alle Zeiger sind PSX-Absolutadressen** — dieselbe Erblast
 * wie in `coaster.lgp` (`xbinadr.bin`), nur ohne die dortige
 * Selbst-Rebasierung: Hier ist die Basis eine feste Konstante.
 *
 * ```
 * +0x0000  u32 eyeDir       Verzeichnis der Augen-Skripte
 * +0x0004  u32 focusDir     Verzeichnis der Fokus-Skripte
 * +0x0008  u32 altEyeDir    3 Einträge, einer je Kanal
 * +0x000C  u32 altFocusDir  dito
 * +0x0010  Skriptkörper, dicht gepackt und GETEILT
 * ```
 *
 * `takeCount = (focusDir − eyeDir) / 12` — je Take drei Kanäle à 4 Byte.
 *
 * **Fünf Invarianten, alle drei Dateien erfüllen alle fünf:**
 *
 * 1. `(focusDir − eyeDir)` ist durch 12 teilbar und positiv.
 * 2. `focusDir + 12·takeCount ≤ altEyeDir` (die Alternativkörper schließen an).
 * 3. `altFocusDir + 12 === Dateilänge`, **exakt**.
 * 4. Jeder Verzeichniszeiger landet im zugehörigen Körperbereich.
 * 5. Jeder Körper endet auf `0xFF`.
 *
 * **Messbild (2026-08-15, `data/battle/`):**
 *
 * | Datei | Bytes | eyeDir | focusDir | altEyeDir | altFocusDir | Takes | eigene Körper |
 * |---|---:|---|---|---|---|---:|---:|
 * | `camdat0.bin` | 49.044 | `0x99FC` | `0xAC74` | `0xBF7C` | `0xBF88` | **394** | 1020 |
 * | `camdat1.bin` | 42.552 | `0x8278` | `0x940C` | `0xA620` | `0xA62C` | **375** | 860 |
 * | `camdat2.bin` | 42.760 | `0x837C` | `0x9504` | `0xA6F0` | `0xA6FC` | **374** | 866 |
 *
 * **Kontrollniveau:** Die Basis `0x801A0000` wurde gegen fünf verschobene
 * Basen geprüft (±4, ±0x10000, +0x100000) und gegen „Zeiger sind schlichte
 * Dateiversätze". **Keine einzige** Variante besteht die fünf Invarianten an
 * auch nur einer der drei Dateien — 0 von 18. Schon eine Verschiebung um
 * **4 Byte** fällt durch. Die Invariantenmenge ist also nicht zu schwach.
 *
 * ---
 *
 * ## Was hier ausdrücklich NICHT steht
 *
 * 🔴 **Die Opcodes der beiden Kamera-VMs.** Dieser Parser liefert den
 * Container und die Körpergrenzen, nicht deren Bedeutung. Ein Körper ist hier
 * eine Bytefolge mit belegtem Anfang und belegtem Ende — mehr nicht.
 *
 * 🟡 **Die Zuordnung Layout-ID → Datei** (s. {@link camdatFileForLayout}) ist
 * aus dem EXE-Bestand übernommen und an unseren Daten **nicht** prüfbar: Die
 * Layout-ID steht im Setup-Record, aber welche Datei das Original daraufhin
 * öffnet, steht nirgends in den Daten. Bleibt 🟡, bis ein Sichtvergleich sie
 * trägt.
 *
 * 🟢 **Locale ist hier gegenstandslos:** `camdat0/1/2.bin` sind zwischen
 * `data/battle/` und `data/lang-en/battle/` byteidentisch (gemessen, F-LOC).
 */

/** Ladeadresse der PSX-Fassung; jeder Zeiger ist absolut dagegen. */
export const CAMDAT_PSX_BASE = 0x801a0000;

/** Vier u32-Zeiger. */
export const CAMDAT_HEADER_LEN = 16;

/** Augen- und Fokusskript je Kanal; drei Kanäle je Take. */
export const CAMDAT_CHANNELS = 3;

/** Ein Verzeichniseintrag je Kanal, 4 Byte — also 12 Byte je Take. */
export const CAMDAT_TAKE_STRIDE = CAMDAT_CHANNELS * 4;

export interface CamDatArchive {
  schemaVersion: 1;
  /** Dateiversätze, bereits von {@link CAMDAT_PSX_BASE} befreit. */
  eyeDir: number;
  focusDir: number;
  altEyeDir: number;
  altFocusDir: number;
  takeCount: number;
  bytes: Uint8Array;
  diagnostics: BattleDiagnostic[];
}

/**
 * 🟡 Layout-ID (u8 aus dem Setup-Record) → Dateiname. Aus dem EXE-Bestand;
 * an unseren Daten nicht prüfbar, weil die Zuordnung nirgends in den Daten
 * steht. Rückgabe `null` für Werte außerhalb 0…8 — geraten wird nicht.
 */
export function camdatFileForLayout(layoutId: number): string | null {
  if (!Number.isInteger(layoutId) || layoutId < 0 || layoutId > 8) return null;
  if (layoutId === 2) return 'camdat1.bin';
  if (layoutId >= 3 && layoutId <= 7) return 'camdat2.bin';
  return 'camdat0.bin'; // 0, 1, 8
}

/**
 * Parst den Container. `null` ⇔ eine der fünf Invarianten ist verletzt; die
 * Diagnose nennt welche. **Kein Teilergebnis** — ein halb bestandener
 * Containertest ist ein nicht bestandener, und ein Verzeichnis, dessen Basis
 * nicht stimmt, liefert lauter plausibel aussehenden Unsinn.
 */
export function parseCamDat(bytes: Uint8Array, asset: string): CamDatArchive | null {
  const diagnostics: BattleDiagnostic[] = [];
  const fehler = (message: string): null => {
    diagnostics.push(bdiag('E-BTL-CAMDAT', asset, message));
    return null;
  };
  if (bytes.length < CAMDAT_HEADER_LEN + 12) return fehler(`Datei zu kurz: ${bytes.length} B`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const zeiger = (at: number): number => view.getUint32(at, true) - CAMDAT_PSX_BASE;
  const eyeDir = zeiger(0);
  const focusDir = zeiger(4);
  const altEyeDir = zeiger(8);
  const altFocusDir = zeiger(12);

  const imBereich = (o: number): boolean => o >= 0 && o + 4 <= bytes.length;
  if (![eyeDir, focusDir, altEyeDir, altFocusDir].every(imBereich)) {
    return fehler(
      `Verzeichnis außerhalb der Datei (eye ${eyeDir}, focus ${focusDir}, ` +
        `altEye ${altEyeDir}, altFocus ${altFocusDir}, Länge ${bytes.length}) — ` +
        'meist ein Zeichen dafür, dass die Zeigerbasis nicht stimmt',
    );
  }

  // I1 — Takezahl geht auf.
  const spanne = focusDir - eyeDir;
  if (spanne <= 0 || spanne % CAMDAT_TAKE_STRIDE !== 0) {
    fehler(`I1: focusDir − eyeDir = ${spanne} ist kein positives Vielfaches von ${CAMDAT_TAKE_STRIDE}`);
    return null;
  }
  const takeCount = spanne / CAMDAT_TAKE_STRIDE;

  // I2 — die Alternativkörper schließen hinter dem Fokusverzeichnis an.
  const hauptEnde = focusDir + CAMDAT_TAKE_STRIDE * takeCount;
  if (hauptEnde > altEyeDir) {
    fehler(`I2: Fokusverzeichnis endet bei ${hauptEnde}, altEyeDir liegt davor (${altEyeDir})`);
    return null;
  }

  // I3 — das Alternativ-Fokusverzeichnis ist das Dateiende, byteexakt.
  if (altFocusDir + 12 !== bytes.length) {
    fehler(`I3: altFocusDir + 12 = ${altFocusDir + 12}, Dateilänge ${bytes.length}`);
    return null;
  }

  // I4 — jeder Verzeichniszeiger landet in seinem Körperbereich.
  //
  // Die Schrankenprüfung vor jedem Lesezugriff ist nicht Zierde: Bei falscher
  // Zeigerbasis liegt schon das Verzeichnis außerhalb, und ein geworfener
  // RangeError wäre ein Absturz statt einer Diagnose. Genau diesen Fall führt
  // die Kontrollprobe absichtlich herbei.
  /** Versatz → obere Schranke seines Körperbereichs (s. I5). */
  const koerper = new Map<number, number>();
  for (const dir of [eyeDir, focusDir]) {
    if (!imBereich(dir + (CAMDAT_CHANNELS * takeCount - 1) * 4)) {
      return fehler(`I4: Verzeichnis bei ${dir} reicht über das Dateiende hinaus`);
    }
    for (let i = 0; i < CAMDAT_CHANNELS * takeCount; i++) {
      const off = zeiger(dir + i * 4);
      if (off < CAMDAT_HEADER_LEN || off >= eyeDir) {
        return fehler(`I4: Hauptzeiger ${i} bei ${dir} zeigt auf ${off} (erlaubt [${CAMDAT_HEADER_LEN}, ${eyeDir}))`);
      }
      koerper.set(off, eyeDir);
    }
  }
  for (const dir of [altEyeDir, altFocusDir]) {
    if (!imBereich(dir + (CAMDAT_CHANNELS - 1) * 4)) {
      return fehler(`I4: Alternativverzeichnis bei ${dir} reicht über das Dateiende hinaus`);
    }
    for (let i = 0; i < CAMDAT_CHANNELS; i++) {
      const off = zeiger(dir + i * 4);
      if (off < hauptEnde || off >= altEyeDir) {
        return fehler(`I4: Alternativzeiger ${i} bei ${dir} zeigt auf ${off} (erlaubt [${hauptEnde}, ${altEyeDir}))`);
      }
      koerper.set(off, altEyeDir);
    }
  }

  /**
   * I5 — jeder Körper endet auf `0xFF`, und zwar **innerhalb seines eigenen
   * Bereichs**. Die Schranke ist nicht Zierde: Ohne sie läuft die Suche in die
   * Verzeichnisse weiter und findet dort irgendwann ein `0xFF`. Der Test wäre
   * damit fast immer bestanden und also blind — an den drei echten Dateien
   * fiel das nicht auf, eine Fixture mit ausgelöschten Abschlüssen schon.
   */
  for (const [off, grenze] of koerper) {
    let i = off;
    while (i < grenze && bytes[i] !== 0xff) i++;
    if (i >= grenze) return fehler(`I5: Körper bei ${off} endet vor ${grenze} nicht auf 0xFF`);
  }

  return { schemaVersion: 1, eyeDir, focusDir, altEyeDir, altFocusDir, takeCount, bytes, diagnostics };
}

function dirEintrag(a: CamDatArchive, dir: number, index: number): number {
  const view = new DataView(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
  return view.getUint32(dir + index * 4, true) - CAMDAT_PSX_BASE;
}

/**
 * Körperversatz des Augenskripts. `null` bei ungültigem Take oder Kanal —
 * das Original prüft hier **nicht** und dereferenziert notfalls Müll; wir tun
 * das nicht, weil ein Absturz mehr wert ist als ein erfundenes Skript.
 */
export function eyeBodyOffset(a: CamDatArchive, take: number, channel: number): number | null {
  if (take < 0 || take >= a.takeCount || channel < 0 || channel >= CAMDAT_CHANNELS) return null;
  return dirEintrag(a, a.eyeDir, take * CAMDAT_CHANNELS + channel);
}

/** Körperversatz des Fokusskripts; gleiche Schranken wie {@link eyeBodyOffset}. */
export function focusBodyOffset(a: CamDatArchive, take: number, channel: number): number | null {
  if (take < 0 || take >= a.takeCount || channel < 0 || channel >= CAMDAT_CHANNELS) return null;
  return dirEintrag(a, a.focusDir, take * CAMDAT_CHANNELS + channel);
}

/** Alternativskripte (Selektor −3), einer je Kanal. */
export function altEyeBodyOffset(a: CamDatArchive, channel: number): number | null {
  if (channel < 0 || channel >= CAMDAT_CHANNELS) return null;
  return dirEintrag(a, a.altEyeDir, channel);
}

/** Alternativskripte (Selektor −3), einer je Kanal. */
export function altFocusBodyOffset(a: CamDatArchive, channel: number): number | null {
  if (channel < 0 || channel >= CAMDAT_CHANNELS) return null;
  return dirEintrag(a, a.altFocusDir, channel);
}

/**
 * Rohbytes eines Körpers bis einschließlich des `0xFF`-Abschlusses.
 *
 * Die Körper sind **geteilt**: Viele Verzeichnisplätze zeigen auf denselben
 * Körper, auch über Takes hinweg (in `camdat0.bin` lösen 2364 Plätze auf nur
 * 1020 eigene Körper auf). Wer sie je bearbeitbar machen will, muss sie als
 * geteilten Speicher behandeln — eine Änderung trifft mehrere Takes.
 */
export function bodyBytes(a: CamDatArchive, offset: number): Uint8Array | null {
  if (offset < 0 || offset >= a.bytes.length) return null;
  // Dieselbe Bereichsschranke wie in I5 — ein Körper endet in seinem Bereich
  // oder gar nicht.
  const grenze = offset < a.eyeDir ? a.eyeDir : a.altEyeDir;
  let i = offset;
  while (i < grenze && a.bytes[i] !== 0xff) i++;
  if (i >= grenze) return null;
  return a.bytes.slice(offset, i + 1);
}
