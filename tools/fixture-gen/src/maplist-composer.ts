/**
 * `maplist`-Composer für Golden Fixtures — codegetrennt vom Parser in
 * formats-field (Dualitätsprinzip). Layout realdaten-validiert (S11):
 * u16 Anzahl + Anzahl × 32-B-Namen, ASCII, mit Nullen aufgefüllt.
 */

export const MAPLIST_NAME_LEN = 32;

export function composeMaplist(names: readonly string[]): Uint8Array {
  const bytes = new Uint8Array(2 + names.length * MAPLIST_NAME_LEN);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, names.length, true);
  names.forEach((name, i) => {
    if (name.length > MAPLIST_NAME_LEN) {
      throw new RangeError(`Name "${name}" überschreitet ${MAPLIST_NAME_LEN} Bytes`);
    }
    const base = 2 + i * MAPLIST_NAME_LEN;
    for (let c = 0; c < name.length; c++) bytes[base + c] = name.charCodeAt(c);
  });
  return bytes;
}
