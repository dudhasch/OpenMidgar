import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import {
  SECTION,
  type FieldGateway,
  type FieldTriggers,
  type FieldTriggerVolume,
  type Vec3,
} from '../nam.js';

/**
 * Trigger-/Gateway-Sektion (Masterplan Phase 1.4):
 * 🟢 Grundstruktur: Field-Name, Kamerasteuerfelder, Kamerarange, feste Slots
 * für 12 Gateways (Austrittslinie, Zielposition, Ziel-Field-ID) und
 * 12 Trigger-Volumen (Eckpunkte, Hintergrund-Schaltparameter).
 * 🟡 Zu validieren: exakte Feldbelegung des BG-Layer-Parameterblocks, die
 * Inaktiv-Sentinel der Gateways (hier 0x7FFF) und die Restbytes je
 * Gateway-Record — alles roh konserviert, Layout zentral in diesen Konstanten.
 */

export const TRG_NAME_LEN = 9;
export const TRG_BG_PARAMS_LEN = 16;
export const TRG_GATEWAY_COUNT = 12;
export const TRG_GATEWAY_LEN = 24;
export const TRG_TRIGGER_COUNT = 12;
export const TRG_TRIGGER_LEN = 16;
export const TRG_HEADER_LEN = TRG_NAME_LEN + 1 + 2 + 8 + TRG_BG_PARAMS_LEN; // 36
export const TRG_SECTION_LEN =
  TRG_HEADER_LEN + TRG_GATEWAY_COUNT * TRG_GATEWAY_LEN + TRG_TRIGGER_COUNT * TRG_TRIGGER_LEN; // 516

/** 🟡 Ziel-Field-ID inaktiver Gateway-Slots (Zu validieren). */
export const TRG_INACTIVE_FIELD = 0x7fff;

export function parseTriggersSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldTriggers | null {
  if (data.length < TRG_SECTION_LEN) {
    diagnostics.push(
      fdiag('E-TRG-SIZE', field, `Sektionslänge ${data.length} < ${TRG_SECTION_LEN}`, SECTION.TRIGGERS),
    );
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let name = '';
  for (let i = 0; i < TRG_NAME_LEN; i++) {
    const b = data[i]!;
    if (b === 0) break;
    name += String.fromCharCode(b);
  }
  const control = view.getUint8(TRG_NAME_LEN);
  const cameraFocusHeight = view.getInt16(TRG_NAME_LEN + 1, true);
  const rangeBase = TRG_NAME_LEN + 3;
  const cameraRange = [0, 1, 2, 3].map((i) => view.getInt16(rangeBase + i * 2, true)) as [
    number,
    number,
    number,
    number,
  ];
  const bgLayerParamsRaw = [...data.subarray(rangeBase + 8, rangeBase + 8 + TRG_BG_PARAMS_LEN)];

  const readVec3 = (o: number): Vec3 => [
    view.getInt16(o, true),
    view.getInt16(o + 2, true),
    view.getInt16(o + 4, true),
  ];

  const gwBase = TRG_HEADER_LEN;
  const gateways: FieldGateway[] = [];
  for (let g = 0; g < TRG_GATEWAY_COUNT; g++) {
    const o = gwBase + g * TRG_GATEWAY_LEN;
    const destFieldId = view.getUint16(o + 18, true);
    gateways.push({
      exitLine: [readVec3(o), readVec3(o + 6)],
      destination: readVec3(o + 12),
      destFieldId,
      active: destFieldId !== TRG_INACTIVE_FIELD,
      unknownRaw: [...data.subarray(o + 20, o + TRG_GATEWAY_LEN)],
    });
  }

  const trBase = gwBase + TRG_GATEWAY_COUNT * TRG_GATEWAY_LEN;
  const triggers: FieldTriggerVolume[] = [];
  for (let t = 0; t < TRG_TRIGGER_COUNT; t++) {
    const o = trBase + t * TRG_TRIGGER_LEN;
    triggers.push({
      corners: [readVec3(o), readVec3(o + 6)],
      bgGroup: view.getUint8(o + 12),
      bgFrame: view.getUint8(o + 13),
      behavior: view.getUint8(o + 14),
      soundId: view.getUint8(o + 15),
    });
  }

  return {
    schemaVersion: 1,
    name,
    control,
    cameraFocusHeight,
    cameraRange,
    bgLayerParamsRaw,
    gateways,
    triggers,
  };
}
