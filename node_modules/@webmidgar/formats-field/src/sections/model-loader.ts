import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldModelAnimation, type FieldModelEntry, type FieldModelManifest } from '../nam.js';

/**
 * Model-Loader-Sektion (Sektion 3) — Grammatik ✅ realdaten-validiert
 * (S10-Accounting über alle 702 Fields byteexakt, 0 Brüche):
 *
 *   u16 blank (0) · u16 modelCount (1…12) · u16 scaleGlobal (512 in 643/702)
 *   je Modell:
 *     u16 nameLen · char name[nameLen]          (19…27 Zeichen)
 *     u16 unknownAfterName                      (durchgehend 0, 🟡)
 *     byte fileField[12]                        ASCII "xxxx.hrc" + Skalatext
 *     u16 animCount
 *     byte block[30]                            (🟡 Zweck offen)
 *     je Animation:
 *       u16 nameLen · char name[nameLen]        (meist 8: "xxxx.yyy")
 *       u16 tail                                (durchgehend 1, 🟡)
 *
 * Der Weg dorthin: fünf Probeniterationen. Ein erstes Grammatikraster fand
 * KEINE passende Auslegung — erst der maskierte Bytestrom-Dump zeigte, dass
 * die Modelldatei nicht längenpräfixiert, sondern ein Festfeld ist. Das
 * Accounting entscheidet die Aufteilung der 14 Bytes hinter dem Namen nicht
 * (2+12 und 0+14 laufen identisch aus); der Dump belegt 2+12.
 */

export const MDL_FILE_FIELD_LEN = 12;
export const MDL_BLOCK_LEN = 30;
const MAX_MODELS = 32;
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
      animations.push({ name: cstring(data, o, aLen), tail: view.getUint16(o + aLen, true) });
      o += aLen + 2;
    }
    models.push({ name, modelFile: file, scale, fileFieldRaw, unknownAfterName, blockRaw, animations });
  }

  if (o !== data.length) {
    return fail('E-MDL-SIZE', `Accounting endet bei ${o}, Sektion ist ${data.length} B`);
  }
  return { schemaVersion: 1, blank, scaleGlobal, models };
}
