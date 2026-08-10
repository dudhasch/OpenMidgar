/**
 * Studio-Compiler (B.3, ADR-013): total, deterministisch, lauffähig in
 * Node und Browser. Pipeline: Strukturvalidierung je Dokument →
 * Referenzauflösung über den ID-Graphen (studio-core) →
 * Semantikvalidierung (tote Referenzen, Walkmesh-Invarianten via
 * studio-core; Dialogmetrik, Script-Erreichbarkeit, Wartezyklen hier) →
 * Manifest-v2-Erzeugung mit abgeleiteten Capabilities →
 * deterministische `.wmmod`-Paketierung mit Paket-Audit.
 *
 * Der Compiler bricht nie beim ersten Fehler ab: Jeder Befund ist ein
 * strukturierter Eintrag; Manifest und Paket werden nur erzeugt, wenn
 * kein Befund der Klasse `fehler` vorliegt.
 */

import {
  canonicalJson,
  documentKindForPath,
  IncrementalValidator,
  utf8Bytes,
  type BattleDoc,
  type Befund,
  type CharacterDoc,
  type DialogueDoc,
  type EnemyDoc,
  type FieldDeltaDoc,
  type FieldDoc,
  type ProjectDoc,
  type ScriptGraphDoc,
  type StudioProject,
  type VariablesDoc,
} from '@webmidgar/studio-core';
import { sha256Hex } from './hash.js';
import {
  MANIFEST_CAPABILITIES,
  V3_KANDIDATEN_CAPABILITIES,
  type ManifestAsset,
  type ManifestBattle,
  type ManifestCapability,
  type ManifestDialogue,
  type ManifestEnemy,
  type ManifestEntity,
  type ManifestField,
  type ManifestPatch,
  type ManifestScript,
  type ManifestV2,
  type ManifestV3Kandidaten,
  type V3KandidatCapability,
} from './manifest.js';
import { paketiere, type PaketAudit, type PaketDatei } from './packaging.js';
import { semanticBefunde } from './semantics.js';
import { assembleScript } from './scripts.js';

export interface CompileResult {
  /** true, wenn kein Befund der Klasse `fehler` vorliegt. */
  ok: boolean;
  /** Vollständige Befundliste (Fehler, Warnungen, Infos) — nie abgeschnitten. */
  befunde: Befund[];
  manifest?: ManifestV2 | undefined;
  paket?: Uint8Array | undefined;
  /** Provenienz-Liste aller Paketdateien (B.7); leer, wenn nicht paketiert wurde. */
  audit: PaketAudit[];
}

export interface CompileOptions {
  /**
   * Nutzerassets des Projekts: Projektpfad (`assets/…`) → Bytes. Alle
   * referenzierten Assets (Textur-Overrides, Field-Hintergründe) müssen
   * hier enthalten sein — nur diese Herkunft (`user-asset`) ist für
   * Paketinhalte zulässig (B.7).
   */
  assets?: ReadonlyMap<string, Uint8Array> | undefined;
}

/** MVP-Festlegung variable-claim: Mod-Bereich ist Variablenbank 15 (RS2 offen). */
export const MOD_VARIABLEN_BANK = 15;

const ASSET_PREFIX = 'assets/';
const CONTENT_ASSET_PREFIX = 'content/assets/';

/* ------------------------------------------------------------------ */
/* ID-Normalisierung (spiegelt studio-core extractReferences)          */
/* ------------------------------------------------------------------ */

function normalizeRef(value: string, modId: string, typ: 'field' | 'script' | 'enemy' | 'item'): string {
  const externePraefixe = ['mod:', 'field:', 'lgp:', 'kernel:', 'music:'];
  if (externePraefixe.some((p) => value.startsWith(p))) return value;
  return `mod:${modId}/${typ}/${value}`;
}

/* ------------------------------------------------------------------ */
/* Asset-Referenzen (Provenienz: nur user-asset aus assets/)           */
/* ------------------------------------------------------------------ */

interface AssetReferenz {
  dokument: string;
  pfad: string;
  assetPfad: string;
}

function assetReferenzen(project: StudioProject): AssetReferenz[] {
  const refs: AssetReferenz[] = [];
  for (const pfad of project.documents()) {
    const kind = documentKindForPath(pfad);
    if (kind === 'character') {
      const doc = project.getDocument<CharacterDoc>(pfad);
      if (doc?.modell.art === 'textur-override') {
        refs.push({ dokument: pfad, pfad: 'modell.texturAsset', assetPfad: doc.modell.texturAsset });
      }
    } else if (kind === 'enemy') {
      const doc = project.getDocument<EnemyDoc>(pfad);
      if (doc?.modell.art === 'textur-override') {
        refs.push({ dokument: pfad, pfad: 'modell.texturAsset', assetPfad: doc.modell.texturAsset });
      }
    } else if (kind === 'battle') {
      const doc = project.getDocument<BattleDoc>(pfad);
      if (doc?.arena.art === 'nutzerbild') {
        refs.push({ dokument: pfad, pfad: 'arena.asset', assetPfad: doc.arena.asset });
      }
    } else if (kind === 'field') {
      const doc = project.getDocument<FieldDoc>(pfad);
      if (typeof doc?.hintergrundAsset === 'string') {
        refs.push({ dokument: pfad, pfad: 'hintergrundAsset', assetPfad: doc.hintergrundAsset });
      }
    }
  }
  return refs;
}

/** Prüft Asset-Referenzen: Pfad muss unter assets/ liegen und im Bestand sein. */
function assetBefunde(project: StudioProject, assets: ReadonlyMap<string, Uint8Array>): Befund[] {
  const out: Befund[] = [];
  for (const ref of assetReferenzen(project)) {
    if (!ref.assetPfad.startsWith(ASSET_PREFIX)) {
      out.push({
        dokument: ref.dokument,
        pfad: ref.pfad,
        klasse: 'fehler',
        meldung: `Asset-Referenz '${ref.assetPfad}' liegt nicht unter ${ASSET_PREFIX} — Paketinhalte dürfen ausschließlich die Herkunft user-asset haben (B.7).`,
        fixHint: 'Datei über den geprüften Dateiimport nach assets/ importieren und hier referenzieren.',
      });
    } else if (!assets.has(ref.assetPfad)) {
      out.push({
        dokument: ref.dokument,
        pfad: ref.pfad,
        klasse: 'fehler',
        meldung: `Referenziertes Asset '${ref.assetPfad}' fehlt im Projektbestand.`,
        fixHint: 'Datei nach assets/ importieren oder Referenz korrigieren.',
      });
    }
  }
  return out;
}

/** Paketpfad eines Nutzerassets (`assets/x/y.png` → `content/assets/x/y.png`). */
function paketPfadFuerAsset(assetPfad: string): string {
  return CONTENT_ASSET_PREFIX + assetPfad.slice(ASSET_PREFIX.length);
}

/** Override-Format aus Dateiendung (v1-Format-Enum). */
function assetFormat(assetPfad: string): string {
  const lower = assetPfad.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.ktx2')) return 'ktx2';
  if (lower.endsWith('.gltf') || lower.endsWith('.glb')) return 'gltf-subset';
  return 'bin';
}

/* ------------------------------------------------------------------ */
/* Manifest-Erzeugung (Capabilities abgeleitet, nie gepflegt, A-ST-2)  */
/* ------------------------------------------------------------------ */

interface ManifestBuild {
  manifest: ManifestV2;
  /** Inhaltsdateien mit Herkunft user-asset (manifest.json kommt hinzu). */
  contentDateien: PaketDatei[];
}

async function buildManifest(project: StudioProject, assets: ReadonlyMap<string, Uint8Array>): Promise<ManifestBuild> {
  const projectDoc = project.getDocument<ProjectDoc>('project.json')!;
  const modId = projectDoc.modId;
  const capabilities = new Set<ManifestCapability>();

  const assetRecords: ManifestAsset[] = [];
  const entities: ManifestEntity[] = [];
  const scripts: ManifestScript[] = [];
  const dialogues: ManifestDialogue[] = [];
  const fields: ManifestField[] = [];
  const patches: ManifestPatch[] = [];
  let variables: ManifestV2['variables'];
  const v3Capabilities = new Set<V3KandidatCapability>();
  const enemies: ManifestEnemy[] = [];
  const battles: ManifestBattle[] = [];
  const contentDateien: PaketDatei[] = [];
  const gepackteAssets = new Set<string>();

  const packeAsset = (assetPfad: string): string => {
    const paketPfad = paketPfadFuerAsset(assetPfad);
    if (!gepackteAssets.has(assetPfad)) {
      gepackteAssets.add(assetPfad);
      contentDateien.push({ pfad: paketPfad, herkunft: 'user-asset', bytes: assets.get(assetPfad)! });
    }
    return paketPfad;
  };

  for (const pfad of project.documents()) {
    const kind = documentKindForPath(pfad);
    switch (kind) {
      case 'character': {
        const doc = project.getDocument<CharacterDoc>(pfad)!;
        if (doc.modell.art === 'textur-override') {
          capabilities.add('texture-override');
          assetRecords.push({
            target: doc.modell.ref,
            source: packeAsset(doc.modell.texturAsset),
            format: assetFormat(doc.modell.texturAsset),
          });
        }
        if (doc.auftritte.length > 0) {
          capabilities.add('entity-add');
          doc.auftritte.forEach((a, i) => {
            const basis = `mod:${modId}/char/${doc.id}`;
            entities.push({
              id: doc.auftritte.length === 1 ? basis : `${basis}.${i}`,
              field: normalizeRef(a.field, modId, 'field'),
              modellRef: doc.modell.ref,
              platzierung: { dreieck: a.dreieck, position: a.position, richtung: a.richtung },
              kollision: doc.kollision,
              scripts: Object.fromEntries(
                Object.entries(a.scripts).map(([slot, ref]) => [slot, normalizeRef(ref, modId, 'script')]),
              ),
            });
          });
        }
        break;
      }
      case 'scriptGraph': {
        const doc = project.getDocument<ScriptGraphDoc>(pfad)!;
        capabilities.add('script-add');
        scripts.push({
          id: `mod:${modId}/script/${doc.entitaet}.${doc.slot}`,
          payload: assembleScript(doc),
          quelle: await sha256Hex(utf8Bytes(canonicalJson(doc))),
        });
        break;
      }
      case 'dialogue': {
        const doc = project.getDocument<DialogueDoc>(pfad)!;
        const replace = doc.eintraege.filter((e) => e.delta !== undefined);
        const add = doc.eintraege.filter((e) => e.delta === undefined);
        if (replace.length > 0) {
          capabilities.add('dialogue-replace');
          dialogues.push({ field: doc.field, locale: doc.locale, mode: 'replace', eintraege: replace });
        }
        if (add.length > 0) {
          capabilities.add('dialogue-add');
          dialogues.push({ field: doc.field, locale: doc.locale, mode: 'add', eintraege: add });
        }
        break;
      }
      case 'field': {
        const doc = project.getDocument<FieldDoc>(pfad)!;
        capabilities.add('field-add');
        fields.push({
          id: `mod:${modId}/field/${doc.id}`,
          ...(doc.hintergrundAsset !== undefined ? { hintergrundAsset: packeAsset(doc.hintergrundAsset) } : {}),
          walkmesh: doc.walkmesh,
          kameras: doc.kameras,
          trigger: doc.trigger,
          gateways: doc.gateways,
        });
        break;
      }
      case 'fieldDelta': {
        const doc = project.getDocument<FieldDeltaDoc>(pfad)!;
        for (const op of doc.operationen) {
          if (op.payload !== undefined) capabilities.add('script-patch');
          patches.push({
            field: doc.zielField,
            anchor: op.anker,
            operation: op.op,
            ...(op.payload !== undefined ? { payload: op.payload } : {}),
            guardHash: op.guardHash,
          });
        }
        break;
      }
      case 'enemy': {
        // v3-Kandidat (MS15): Record enemies[] im Erweiterungsfeld, v2-Schema unberührt.
        const doc = project.getDocument<EnemyDoc>(pfad)!;
        v3Capabilities.add('enemy-add');
        if (doc.modell.art === 'textur-override') {
          capabilities.add('texture-override');
          assetRecords.push({
            target: doc.modell.ref,
            source: packeAsset(doc.modell.texturAsset),
            format: assetFormat(doc.modell.texturAsset),
          });
        }
        const { schemaVersion: _schemaVersion, id, ...rest } = doc;
        enemies.push({ id: `mod:${modId}/enemy/${id}`, ...rest });
        break;
      }
      case 'battle': {
        // v3-Kandidat (MS16): Record battles[] im Erweiterungsfeld; Arena-
        // Nutzerbilder folgen der Hintergrund-Asset-Pipeline (A-ST-16).
        const doc = project.getDocument<BattleDoc>(pfad)!;
        v3Capabilities.add('battle-add');
        const arena =
          doc.arena.art === 'nutzerbild' ? { art: 'nutzerbild' as const, asset: packeAsset(doc.arena.asset) } : doc.arena;
        const belohnung: ManifestBattle['belohnung'] = {
          ...(doc.belohnung.expMod !== undefined ? { expMod: doc.belohnung.expMod } : {}),
          ...(doc.belohnung.apMod !== undefined ? { apMod: doc.belohnung.apMod } : {}),
          ...(doc.belohnung.gilMod !== undefined ? { gilMod: doc.belohnung.gilMod } : {}),
          ...(doc.belohnung.garantierteDrops !== undefined
            ? {
                garantierteDrops: doc.belohnung.garantierteDrops.map((d) => ({
                  itemRef: normalizeRef(d.itemRef, modId, 'item'),
                })),
              }
            : {}),
        };
        const verknuepfung =
          doc.verknuepfung === undefined
            ? undefined
            : 'feldRef' in doc.verknuepfung
              ? {
                  feldRef: normalizeRef(doc.verknuepfung.feldRef, modId, 'field'),
                  encounterZone: doc.verknuepfung.encounterZone,
                }
              : doc.verknuepfung;
        battles.push({
          id: `mod:${modId}/battle/${doc.id}`,
          name: doc.name,
          arena,
          formation: {
            reihen: doc.formation.reihen.map((r) => ({
              enemyRef: normalizeRef(r.enemyRef, modId, 'enemy'),
              anzahl: r.anzahl,
              position: r.position,
              ...(r.flags !== undefined ? { flags: r.flags } : {}),
            })),
            maxGleichzeitig: doc.formation.maxGleichzeitig,
          },
          regeln: doc.regeln,
          ...(doc.musikRef !== undefined ? { musikRef: doc.musikRef } : {}),
          belohnung,
          ...(verknuepfung !== undefined ? { verknuepfung } : {}),
        });
        break;
      }
      case 'variables': {
        const doc = project.getDocument<VariablesDoc>(pfad)!;
        if (doc.benannt.length > 0) {
          capabilities.add('variable-claim');
          const benannteSlots = [...doc.benannt].sort((a, b) => a.name.localeCompare(b.name));
          const adressen = doc.benannt.map((b) => b.adresse).filter((a): a is number => a !== undefined);
          variables = {
            bereich: {
              bank: MOD_VARIABLEN_BANK,
              von: adressen.length > 0 ? Math.min(...adressen) : 0,
              bis: adressen.length > 0 ? Math.max(...adressen) : 255,
            },
            benannteSlots,
          };
        }
        break;
      }
      default:
        break; // project.json: Wurzelfelder
    }
  }

  // Integrität deckt alle Inhaltsdateien (manifest.json trägt die Hashes
  // und kann sich nicht selbst hashen).
  const hashes: Record<string, string> = {};
  for (const datei of [...contentDateien].sort((a, b) => a.pfad.localeCompare(b.pfad))) {
    hashes[datei.pfad] = await sha256Hex(datei.bytes);
  }

  // v3-Kandidaten (kanonische Reihenfolge der Capability-Liste; Records in
  // sortierter Dokumentreihenfolge — Determinismus, A-ST-3).
  let v3Kandidaten: ManifestV3Kandidaten | undefined;
  if (v3Capabilities.size > 0) {
    v3Kandidaten = {
      capabilities: V3_KANDIDATEN_CAPABILITIES.filter((c) => v3Capabilities.has(c)),
      ...(enemies.length > 0 ? { enemies } : {}),
      ...(battles.length > 0 ? { battles } : {}),
    };
  }

  const manifest: ManifestV2 = {
    manifestVersion: '2.0.0',
    id: modId,
    version: projectDoc.version,
    name: projectDoc.name,
    engineCompat: projectDoc.engineCompat,
    // project.json trägt (noch) keine Dependency-/Konflikt-Deklaration.
    dependencies: [],
    conflicts: [],
    capabilities: MANIFEST_CAPABILITIES.filter((c) => capabilities.has(c)),
    ...(assetRecords.length > 0 ? { assets: assetRecords } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
    ...(dialogues.length > 0 ? { dialogues } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    ...(patches.length > 0 ? { patches } : {}),
    ...(variables !== undefined ? { variables } : {}),
    ...(v3Kandidaten !== undefined ? { v3Kandidaten } : {}),
    integrity: { algo: 'sha256', hashes },
  };
  return { manifest, contentDateien };
}

/* ------------------------------------------------------------------ */
/* Compiler-Einstieg (total)                                           */
/* ------------------------------------------------------------------ */

/**
 * Kompiliert ein Studio-Projekt zu Manifest v2 + `.wmmod`-Paket.
 * Liefert stets die vollständige Befundliste; Manifest und Paket nur,
 * wenn kein Fehler vorliegt.
 */
export async function compileProject(project: StudioProject, options?: CompileOptions): Promise<CompileResult> {
  const assets = options?.assets ?? new Map<string, Uint8Array>();
  const befunde: Befund[] = [
    ...new IncrementalValidator(project).validateAll(),
    ...semanticBefunde(project),
    ...assetBefunde(project, assets),
  ];
  const ok = !befunde.some((b) => b.klasse === 'fehler');
  if (!ok) {
    return { ok, befunde, audit: [] };
  }
  const { manifest, contentDateien } = await buildManifest(project, assets);
  const dateien: PaketDatei[] = [
    { pfad: 'manifest.json', herkunft: 'generated', bytes: utf8Bytes(canonicalJson(manifest)) },
    ...contentDateien,
  ];
  const { paket, audit } = await paketiere(dateien);
  return { ok, befunde, manifest, paket, audit };
}
