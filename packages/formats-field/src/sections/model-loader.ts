import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldModelAnimation, type FieldModelEntry, type FieldModelManifest } from '../nam.js';

/**
 * Model-Loader-Sektion (Sektion 3) — Grammatik ✅ realdaten-validiert
 * (S10-Accounting über alle 702 Fields byteexakt, 0 Brüche):
 *
 *   u16 blank (0) · u16 modelCount (1…16) · u16 scaleGlobal (512 in 643/702)
 *   je Modell:
 *     u16 nameLen · char name[nameLen]          (15…30 Zeichen)
 *     u16 unknownAfterName                      (🟡 binäres Flag 0/1)
 *     byte fileField[12]                        ASCII "xxxx.hrc" + Skalatext
 *     u16 animCount                             (Modus 3, bis > 20)
 *     byte block[30]                            (🟡 vermutlich Beleuchtung)
 *     je Animation:
 *       u16 nameLen · char name[nameLen]        (ausnahmslos 8: "xxxx.yyy")
 *       u16 tail                                (🟡 1 in 97,1 %)
 *
 * Der Weg dorthin: fünf Probeniterationen. Ein erstes Grammatikraster fand
 * KEINE passende Auslegung — erst der maskierte Bytestrom-Dump zeigte, dass
 * die Modelldatei nicht längenpräfixiert, sondern ein Festfeld ist. Das
 * Accounting entscheidet die Aufteilung der 14 Bytes hinter dem Namen nicht
 * (2+12 und 0+14 laufen identisch aus); der Dump belegt 2+12.
 */

export const MDL_FILE_FIELD_LEN = 12;
export const MDL_BLOCK_LEN = 30;
/** Realdaten: bis 16 Modelle je Field — die Schranke fängt nur Unsinn ab. */
const MAX_MODELS = 64;
const MAX_ANIMS = 128;
const MAX_NAME = 64;

const ascii = (data: Uint8Array, from: number, len: number): string =>
  String.fromCharCode(...data.subarray(from, from + len));

/** ASCII bis zum ersten Nullbyte, kleingeschrieben (Namensnormalisierung). */
function cstring(data: Uint8Array, from: number, len: number): string {
  let end = from;
  const limit = from + len;
  while (end < limit && data[end] !== 0) end++;
  return ascii(data, from, end - from).toLowerCase();
}

/**
 * Zerlegt das 12-B-Dateifeld in Dateiname und Skalatext: `xxxx.hrc512`
 * → `{ file: 'xxxx.hrc', scale: 512 }`. Die Skala steht als ASCII-Ziffern
 * direkt hinter der Endung (realdaten-belegtes Format).
 */
export interface ModelLight {
  /** Richtung als i16-Tripel — im Original NICHT normiert (|v| streut 0…55882). */
  direction: [number, number, number];
  color: [number, number, number];
}

export interface ModelLightBlock {
  lights: [ModelLight, ModelLight, ModelLight];
  ambient: [number, number, number];
}

/**
 * 🟡 Deutungsvorschlag für den 30-B-Block: drei Lichtquellen à
 * (i16 x, i16 y, i16 z, u8 r, u8 g, u8 b) = 27 B plus 3 B Umgebungsfarbe.
 *
 * Realdaten-Befund (5454 Modelle): Die letzten drei Bytes sind mit
 * Mittelwerten 88,8/87,4/87,9 und praktisch ohne Nullen sehr plausibel eine
 * (graue) Umgebungsfarbe — die Gegenhypothese „Zähler" ist damit widerlegt.
 * Die Richtungstripel sind jedoch UNNORMIERT, und innerhalb jeder
 * 9-Byte-Einheit tragen drei Bytes auffällig wenige verschiedene Werte
 * (22–32 gegenüber 69–142). Die Aufteilung ist deshalb noch nicht bewiesen;
 * `blockRaw` bleibt maßgeblich, diese Funktion ist ein Arbeitsmittel für die
 * Sichtvalidierung in S11.
 */
export function decodeModelLightBlock(blockRaw: Uint8Array): ModelLightBlock | null {
  if (blockRaw.length < MDL_BLOCK_LEN) return null;
  const view = new DataView(blockRaw.buffer, blockRaw.byteOffset, blockRaw.byteLength);
  const light = (base: number): ModelLight => ({
    direction: [view.getInt16(base, true), view.getInt16(base + 2, true), view.getInt16(base + 4, true)],
    color: [blockRaw[base + 6]!, blockRaw[base + 7]!, blockRaw[base + 8]!],
  });
  return {
    lights: [light(0), light(9), light(18)],
    ambient: [blockRaw[27]!, blockRaw[28]!, blockRaw[29]!],
  };
}

/**
 * Zerlegt einen Animationsnamen: `xxxx.aki` → Datei `xxxx.a`, Kennung `aki`.
 * ✅ Realdaten-validiert: 26.212/26.212 Referenzen lösen so in `char.lgp` auf
 * (mit dem Rohnamen als Dateinamen: 0). Der Teil hinter dem Punkt ist also
 * keine Dateiendung, sondern eine 🟡 noch unerklärte Kennung.
 */
export function splitAnimationName(name: string): { file: string; tag: string } {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return { file: `${name}.a`, tag: '' };
  return { file: `${name.slice(0, dot)}.a`, tag: name.slice(dot + 1) };
}

export function splitModelFileField(raw: Uint8Array): { file: string; scale: number | null } {
  const text = cstring(raw, 0, raw.length);
  const m = /^(.*?\.[a-z]{1,4})(\d*)$/.exec(text);
  if (!m) return { file: text, scale: null };
  const digits = m[2] ?? '';
  return { file: m[1]!, scale: digits.length > 0 ? Number.parseInt(digits, 10) : null };
}

export function parseModelLoaderSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldModelManifest | null {
  const fail = (code: 'E-MDL-SIZE' | 'E-MDL-COUNT', detail: string): null => {
    diagnostics.push(fdiag(code, field, detail, SECTION.MODEL_LOADER));
    return null;
  };
  if (data.length < 6) return fail('E-MDL-SIZE', `Sektion zu kurz (${data.length} B)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blank = view.getUint16(0, true);
  const modelCount = view.getUint16(2, true);
  const scaleGlobal = view.getUint16(4, true);
  if (modelCount > MAX_MODELS) return fail('E-MDL-COUNT', `Modellzahl ${modelCount} unplausibel`);

  const models: FieldModelEntry[] = [];
  let o = 6;
  const need = (n: number, what: string): boolean => {
    if (o + n <= data.length) return true;
    fail('E-MDL-SIZE', `${what}: Sektionsende bei ${o}+${n} > ${data.length}`);
    return false;
  };

  for (let m = 0; m < modelCount; m++) {
    if (!need(2, `Modell ${m} Namenslänge`)) return null;
    const nameLen = view.getUint16(o, true);
    o += 2;
    if (nameLen < 1 || nameLen > MAX_NAME) return fail('E-MDL-SIZE', `Modell ${m}: Namenslänge ${nameLen}`);
    if (!need(nameLen + 2 + MDL_FILE_FIELD_LEN + 2, `Modell ${m} Kopf`)) return null;
    const name = cstring(data, o, nameLen);
    o += nameLen;
    const unknownAfterName = view.getUint16(o, true);
    o += 2;
    const fileFieldRaw = data.slice(o, o + MDL_FILE_FIELD_LEN);
    o += MDL_FILE_FIELD_LEN;
    const { file, scale } = splitModelFileField(fileFieldRaw);
    if (file.length === 0) {
      diagnostics.push(fdiag('W-MDL-NAME', field, `Modell ${m}: Dateifeld leer`, SECTION.MODEL_LOADER));
    } else if (scale === null) {
      diagnostics.push(fdiag('W-MDL-SCALE', field, `Modell ${m}: kein Skalatext im Dateifeld`, SECTION.MODEL_LOADER));
    }
    const animCount = view.getUint16(o, true);
    o += 2;
    if (animCount > MAX_ANIMS) return fail('E-MDL-COUNT', `Modell ${m}: ${animCount} Animationen unplausibel`);
    if (!need(MDL_BLOCK_LEN, `Modell ${m} Block`)) return null;
    const blockRaw = data.slice(o, o + MDL_BLOCK_LEN);
    o += MDL_BLOCK_LEN;

    const animations: FieldModelAnimation[] = [];
    for (let a = 0; a < animCount; a++) {
      if (!need(2, `Modell ${m} Animation ${a}`)) return null;
      const aLen = view.getUint16(o, true);
      o += 2;
      if (aLen < 1 || aLen > MAX_NAME) return fail('E-MDL-SIZE', `Modell ${m}/Anim ${a}: Namenslänge ${aLen}`);
      if (!need(aLen + 2, `Modell ${m} Animation ${a}`)) return null;
      const animName = cstring(data, o, aLen);
      const { file: animFile, tag } = splitAnimationName(animName);
      animations.push({ name: animName, file: animFile, tag, tail: view.getUint16(o + aLen, true) });
      o += aLen + 2;
    }
    models.push({ name, modelFile: file, scale, fileFieldRaw, unknownAfterName, blockRaw, animations });
  }

  if (o !== data.length) {
    return fail('E-MDL-SIZE', `Accounting endet bei ${o}, Sektion ist ${data.length} B`);
  }
  return { schemaVersion: 1, blank, scaleGlobal, models };
}
