/**
 * Composer für die Model-Loader-Sektion (Field-Sektion 3) — codegetrennt vom
 * Parser in formats-field (Dualitätsprinzip). Die Grammatik ist
 * realdaten-validiert (S10-Accounting, 702/702 byteexakt); siehe
 * `sections/model-loader.ts` für die Herleitung.
 */

export interface ModelAnimationSpec {
  /** Animationsdatei, z. B. `aaaa.a`. */
  name: string;
  /** u16 hinter dem Namen; im Original durchgehend 1. */
  tail?: number | undefined;
}

export interface ModelEntrySpec {
  /** Beschreibender Name (im Original 19…27 Zeichen). */
  name: string;
  /** Modelldatei, z. B. `aaaa.hrc`. */
  file: string;
  /** Skala; wird als ASCII-Ziffern direkt hinter die Endung geschrieben. */
  scale?: number | undefined;
  /** u16 hinter dem Namen; im Original durchgehend 0. */
  unknownAfterName?: number | undefined;
  /** 30-B-Block; fehlt → Nullen. */
  block?: Uint8Array | undefined;
  animations?: ModelAnimationSpec[] | undefined;
}

export interface ModelLoaderSectionSpec {
  /** Globale Skala im Kopf; im Original 512 in 643/702 Fields. */
  scaleGlobal?: number | undefined;
  models?: ModelEntrySpec[] | undefined;
}

export const MDL_FILE_FIELD_LEN = 12;
export const MDL_BLOCK_LEN = 30;

const putAscii = (target: Uint8Array, offset: number, text: string): void => {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
};

/** Baut das 12-Byte-Dateifeld: Name + Skalatext, mit Nullen aufgefüllt. */
export function composeModelFileField(file: string, scale?: number | undefined): Uint8Array {
  const text = scale === undefined ? file : `${file}${scale}`;
  if (text.length > MDL_FILE_FIELD_LEN) {
    throw new RangeError(`Dateifeld "${text}" überschreitet ${MDL_FILE_FIELD_LEN} Bytes`);
  }
  const out = new Uint8Array(MDL_FILE_FIELD_LEN);
  putAscii(out, 0, text);
  return out;
}

export function composeModelLoaderSection(spec: ModelLoaderSectionSpec = {}): Uint8Array {
  const models = spec.models ?? [];
  let size = 6;
  for (const model of models) {
    size += 2 + model.name.length + 2 + MDL_FILE_FIELD_LEN + 2 + MDL_BLOCK_LEN;
    for (const anim of model.animations ?? []) size += 2 + anim.name.length + 2;
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true); // blank
  view.setUint16(2, models.length, true);
  view.setUint16(4, spec.scaleGlobal ?? 512, true);

  let o = 6;
  for (const model of models) {
    view.setUint16(o, model.name.length, true);
    o += 2;
    putAscii(bytes, o, model.name);
    o += model.name.length;
    view.setUint16(o, model.unknownAfterName ?? 0, true);
    o += 2;
    bytes.set(composeModelFileField(model.file, model.scale), o);
    o += MDL_FILE_FIELD_LEN;
    const anims = model.animations ?? [];
    view.setUint16(o, anims.length, true);
    o += 2;
    if (model.block) bytes.set(model.block.subarray(0, MDL_BLOCK_LEN), o);
    o += MDL_BLOCK_LEN;
    for (const anim of anims) {
      view.setUint16(o, anim.name.length, true);
      o += 2;
      putAscii(bytes, o, anim.name);
      o += anim.name.length;
      view.setUint16(o + 0, anim.tail ?? 1, true);
      o += 2;
    }
  }
  return bytes;
}
