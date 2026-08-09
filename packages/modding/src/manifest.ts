/**
 * Mod-Manifest und seine Validierung (S19, Masterplan 5.2).
 *
 * Die Validierung ist bewusst **mod-lokal**: Jeder Fehler nennt Datei und
 * Feld, und ein defektes Mod macht nur sich selbst unbrauchbar. Ein Nutzer mit
 * zwanzig Mods soll erfahren, *welches* kaputt ist — nicht, dass „das Laden
 * fehlgeschlagen" ist.
 */

export type ModCapability =
  | 'texture-override'
  | 'background-override'
  | 'model-override'
  | 'entity-add'
  | 'script-add'
  | 'dialogue-add'
  | 'variable-claim';

/**
 * Im MVP tatsächlich ausgeführte Capabilities. Die übrigen sind dem Schema
 * **bekannt** — ein Manifest, das sie nennt, ist gültig, ihre Aktivierung wird
 * aber mit Diagnose verweigert. So bleiben künftige Mods vorwärtskompatibel,
 * ohne dass heute etwas stillschweigend wirkungslos bliebe.
 */
export const MVP_CAPABILITIES: readonly ModCapability[] = ['texture-override', 'background-override'];

export const ALL_CAPABILITIES: readonly ModCapability[] = [
  'texture-override',
  'background-override',
  'model-override',
  'entity-add',
  'script-add',
  'dialogue-add',
  'variable-claim',
];

export interface ModOverride {
  /** Kanonische Asset-Kennung, z. B. `lgp:flevel/md1stin`. */
  target: string;
  /** Pfad der Ersatzdatei innerhalb des Mod-Pakets. */
  file: string;
  /** SHA-256 der Ersatzdatei — Grundlage für Cache-Schlüssel und Integrität. */
  assetHash: string;
  capability: ModCapability;
}

export interface ModManifest {
  schemaVersion: 2;
  modId: string;
  modVersion: string;
  name: string;
  /** Engine-Version, gegen die das Mod gebaut wurde. */
  engineCompatVersion: string;
  capabilities: ModCapability[];
  overrides: ModOverride[];
}

export type ModDiagnosticCode =
  | 'E-MOD-SCHEMA'
  | 'E-MOD-FIELD'
  | 'E-MOD-CAPABILITY'
  | 'E-MOD-DUPLICATE'
  | 'E-MOD-HASH';

export interface ModDiagnostic {
  code: ModDiagnosticCode;
  /** Mod, zu dem der Fehler gehört — nie global. */
  modId: string;
  /** Feldpfad im Manifest, z. B. `overrides[2].assetHash`. */
  field: string;
  detail: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TARGET_PATTERN = /^[a-z0-9]+:[a-z0-9._/-]+$/;

export interface ValidationResult {
  manifest: ModManifest | null;
  diagnostics: ModDiagnostic[];
}

/**
 * Prüft ein rohes Manifest vollständig. Es wird **nicht** beim ersten Fehler
 * abgebrochen: Wer ein Mod repariert, will alle Mängel auf einmal sehen.
 */
export function validateManifest(raw: unknown, sourceLabel = '<unbekannt>'): ValidationResult {
  const diagnostics: ModDiagnostic[] = [];
  const modIdOf = (o: unknown): string =>
    typeof o === 'object' && o !== null && typeof (o as { modId?: unknown }).modId === 'string'
      ? (o as { modId: string }).modId
      : sourceLabel;
  const modId = modIdOf(raw);
  const fail = (code: ModDiagnosticCode, field: string, detail: string): void => {
    diagnostics.push({ code, modId, field, detail });
  };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('E-MOD-SCHEMA', '$', 'Manifest ist kein Objekt');
    return { manifest: null, diagnostics };
  }
  const m = raw as Partial<ModManifest> & Record<string, unknown>;

  if (m.schemaVersion !== 2) {
    fail('E-MOD-SCHEMA', 'schemaVersion', `erwartet 2, gefunden ${String(m.schemaVersion)}`);
  }
  if (typeof m.modId !== 'string' || !ID_PATTERN.test(m.modId)) {
    fail('E-MOD-FIELD', 'modId', 'fehlt oder verletzt das Kennungsmuster (klein, 2–64 Zeichen)');
  }
  if (typeof m.modVersion !== 'string' || !VERSION_PATTERN.test(m.modVersion)) {
    fail('E-MOD-FIELD', 'modVersion', 'fehlt oder ist keine Version im Format x.y.z');
  }
  if (typeof m.engineCompatVersion !== 'string' || !VERSION_PATTERN.test(m.engineCompatVersion)) {
    fail('E-MOD-FIELD', 'engineCompatVersion', 'fehlt oder ist keine Version im Format x.y.z');
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') {
    fail('E-MOD-FIELD', 'name', 'fehlt oder ist leer');
  }

  if (!Array.isArray(m.capabilities)) {
    fail('E-MOD-FIELD', 'capabilities', 'fehlt oder ist keine Liste');
  } else {
    for (const [i, cap] of m.capabilities.entries()) {
      if (!ALL_CAPABILITIES.includes(cap as ModCapability)) {
        fail('E-MOD-CAPABILITY', `capabilities[${i}]`, `unbekannte Capability "${String(cap)}"`);
      }
    }
  }

  if (!Array.isArray(m.overrides)) {
    fail('E-MOD-FIELD', 'overrides', 'fehlt oder ist keine Liste');
  } else {
    const seen = new Set<string>();
    for (const [i, ovRaw] of m.overrides.entries()) {
      const at = `overrides[${i}]`;
      if (typeof ovRaw !== 'object' || ovRaw === null) {
        fail('E-MOD-SCHEMA', at, 'Eintrag ist kein Objekt');
        continue;
      }
      const ov = ovRaw as Partial<ModOverride>;
      if (typeof ov.target !== 'string' || !TARGET_PATTERN.test(ov.target)) {
        fail('E-MOD-FIELD', `${at}.target`, 'fehlt oder ist keine kanonische Asset-Kennung (`archiv:pfad`)');
      } else if (seen.has(ov.target)) {
        // Zwei Einträge desselben Mods für dasselbe Ziel: nicht entscheidbar,
        // welcher gewinnt — also ein Fehler, kein stilles „letzter gewinnt".
        fail('E-MOD-DUPLICATE', `${at}.target`, `Ziel "${ov.target}" ist im selben Mod mehrfach belegt`);
      } else {
        seen.add(ov.target);
      }
      if (typeof ov.file !== 'string' || ov.file.trim() === '' || ov.file.includes('..')) {
        fail('E-MOD-FIELD', `${at}.file`, 'fehlt, ist leer oder verlässt das Mod-Verzeichnis');
      }
      if (typeof ov.assetHash !== 'string' || !HASH_PATTERN.test(ov.assetHash)) {
        fail('E-MOD-HASH', `${at}.assetHash`, 'fehlt oder ist kein SHA-256 in Hexform');
      }
      if (!ALL_CAPABILITIES.includes(ov.capability as ModCapability)) {
        fail('E-MOD-CAPABILITY', `${at}.capability`, `unbekannte Capability "${String(ov.capability)}"`);
      } else if (Array.isArray(m.capabilities) && !m.capabilities.includes(ov.capability as ModCapability)) {
        fail(
          'E-MOD-CAPABILITY',
          `${at}.capability`,
          `"${String(ov.capability)}" wird benutzt, ist aber nicht in capabilities angemeldet`,
        );
      }
    }
  }

  return { manifest: diagnostics.length === 0 ? (m as ModManifest) : null, diagnostics };
}

/** Capabilities, deren Aktivierung im MVP verweigert wird (mit Diagnose). */
export function unsupportedCapabilities(manifest: ModManifest): ModCapability[] {
  return manifest.capabilities.filter((c) => !MVP_CAPABILITIES.includes(c));
}
