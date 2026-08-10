/**
 * Paket-/Publish-Logik (paket.md): Adapter vom Mock-Projektbestand
 * (mock-project.ts, unverändert) auf ein echtes `StudioProject`
 * (@webmidgar/studio-core, MemoryProjectStore) sowie Anbindung des
 * echten Compilers `compileProject` (@webmidgar/studio-compiler).
 *
 * Adapter-Normalisierung: Die Mock-Dokumente tragen teils volle
 * Mod-IDs (`mod:…/field/slumkirche_aussen`) und pfadartige
 * Script-Referenzen (`scripts/lina.interaktion.json`), während
 * studio-core kurze Namen im Mod-Namensraum erwartet (vgl.
 * packages/studio-compiler/src/test-helpers.ts). Die Adapter-Funktionen
 * normalisieren diese Formen beim Aufbau des StudioProject — die
 * Mock-Quelle bleibt davon unberührt.
 */
import {
  canonicalJson,
  IncrementalValidator,
  MemoryProjectStore,
  StudioProject,
  utf8Bytes,
  type Befund,
  type CharacterDoc,
  type ProjectDoc,
  type SlotArt,
} from '@webmidgar/studio-core';
import {
  compileProject,
  semanticBefunde,
  sha256Hex,
  type PaketAudit,
} from '@webmidgar/studio-compiler';
import {
  demoCharakter,
  demoDialoge,
  demoField,
  demoFieldDelta,
  demoProject,
  demoScriptGraph,
  demoVariablen,
  type StudioBefund,
} from '@/lib/mock-project';

/* ------------------------------------------------------------------ */
/* Manifest-Formularzustand                                            */
/* ------------------------------------------------------------------ */

export interface ManifestForm {
  modId: string;
  name: string;
  version: { major: number; minor: number; patch: number };
  /** UI-Werte: `>=0.4.0` | `>=0.3.0` | `=0.4.0`. */
  engineCompat: string;
  beschreibung: string;
  autoren: string[];
  spracheEn: boolean;
}

export const BESCHREIBUNG_LIMIT = 280;

export function initialManifestForm(): ManifestForm {
  return {
    modId: demoProject.modId,
    name: demoProject.name,
    version: { major: 0, minor: 1, patch: 0 },
    engineCompat: '>=0.4.0',
    beschreibung:
      'Neue Nebenquest rund um NPC „Lina" in der Slumkirche: zwei Dialoge (einer ersetzt einen Original-Eintrag), ein verzweigtes Interaktions-Script, ein neues Field „Slumkirche außen" und drei benannte Variablen.',
    autoren: ['du'],
    spracheEn: true,
  };
}

export function semverString(v: ManifestForm['version']): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** UI-Auswahl → project.json-Range-String. */
export function engineCompatRange(ui: string): string {
  if (ui === '=0.4.0') return '0.4.0';
  if (ui === '>=0.3.0') return '^0.3.0';
  return '^0.4.0';
}

/* ------------------------------------------------------------------ */
/* modId-Live-Validierung                                              */
/* ------------------------------------------------------------------ */

export const MOD_ID_REGEX = /^[a-z0-9.-]{3,64}$/;

/** null = valide; sonst Fehlertext für die Inline-Meldung. */
export function modIdFehler(modId: string): string | null {
  if (!MOD_ID_REGEX.test(modId)) {
    return 'Kleinbuchstaben, Punkte als Trenner, mindestens zwei Segmente.';
  }
  if (modId.split('.').filter(Boolean).length < 2) {
    return 'Kleinbuchstaben, Punkte als Trenner, mindestens zwei Segmente.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Abgeleitete Capabilities (read-only, live aus Projektinhalt)        */
/* ------------------------------------------------------------------ */

export interface CapabilityInfo {
  /** Manifest-v2-Capability-Key (Mono-Label). */
  key: string;
  /** Kurzbeschreibung für den Tooltip. */
  beschreibung: string;
  /** Icon-Schlüssel (Mapping in der Komponente). */
  icon: 'dialog-replace' | 'dialog-add' | 'script' | 'entity' | 'field' | 'patch' | 'variablen' | 'textur';
}

/**
 * Leitet die Capability-Liste aus dem Mock-Projektinhalt ab — spiegelt
 * die Ableitungsregeln des Compilers (buildManifest in
 * packages/studio-compiler/src/compiler.ts), ohne zu kompilieren.
 */
export function leiteCapabilitiesAb(): CapabilityInfo[] {
  const caps: CapabilityInfo[] = [];
  const hatDialogReplace = demoDialoge.some((d) => d.eintraege.some((e) => e.delta !== undefined));
  const hatDialogAdd = demoDialoge.some((d) => d.eintraege.some((e) => e.delta === undefined));
  if (hatDialogReplace) {
    caps.push({ key: 'dialogue-replace', beschreibung: 'Dialogeintrag ersetzt einen Original-Eintrag (guardHash-verankert).', icon: 'dialog-replace' });
  }
  if (hatDialogAdd) {
    caps.push({ key: 'dialogue-add', beschreibung: 'Neue Dialogeinträge werden hinzugefügt.', icon: 'dialog-add' });
  }
  if (demoScriptGraph.knoten.length > 0) {
    caps.push({ key: 'script-add', beschreibung: 'Vollständig neues Script aus dem Graph-Editor.', icon: 'script' });
  }
  if (demoCharakter.auftritte.length > 0) {
    caps.push({ key: 'entity-add', beschreibung: 'Neue Entität wird in einem Field platziert.', icon: 'entity' });
  }
  if (demoField.walkmesh.dreiecke.length > 0) {
    caps.push({ key: 'field-add', beschreibung: 'Komplett neues Field mit eigenem Walkmesh.', icon: 'field' });
  }
  if (demoFieldDelta.operationen.length > 0) {
    caps.push({ key: 'script-patch', beschreibung: 'Deklarativer Patch auf ein Original-Field (nur referenziert).', icon: 'patch' });
  }
  if (demoVariablen.benannt.length > 0) {
    caps.push({ key: 'variable-claim', beschreibung: `Reservierung benannter Variablenslots (Bank 15, ${demoVariablen.benannt.length} Namen).`, icon: 'variablen' });
  }
  if (demoCharakter.modell.art === 'textur-override') {
    caps.push({ key: 'texture-override', beschreibung: 'Textur-Override auf ein Original-Modell.', icon: 'textur' });
  }
  return caps;
}

/** Capabilities, die Engine ≥ 0.4.0 voraussetzen (Manifest v2). */
const ENGINE_04_CAPS = ['dialogue-replace', 'dialogue-add', 'script-add', 'entity-add', 'variable-claim'];

/** Amber-Inline-Hinweis, wenn die gewählte Engine zu alt für genutzte Capabilities ist. */
export function engineCompatWarnung(engineCompatUi: string): string | null {
  if (engineCompatUi !== '>=0.3.0') return null;
  const betroffen = leiteCapabilitiesAb().filter((c) => ENGINE_04_CAPS.includes(c.key)).map((c) => c.key);
  if (betroffen.length === 0) return null;
  return `Das Projekt nutzt ${betroffen.join(', ')} — diese Capabilities benötigen Engine ≥ 0.4.0.`;
}

/* ------------------------------------------------------------------ */
/* Provenienz: referenzierte Original-IDs (aus Projektstand aggregiert) */
/* ------------------------------------------------------------------ */

export interface OriginalReferenz {
  refId: string;
  guardHash?: string;
}

export function aggregiereOriginalReferenzen(): OriginalReferenz[] {
  const refs: OriginalReferenz[] = [];
  for (const d of demoDialoge) {
    if (d.field.startsWith('field:')) refs.push({ refId: d.field });
    for (const e of d.eintraege) {
      if (e.delta) refs.push({ refId: `${e.id} (Original-Index ${e.delta.ersetztOriginalIndex ?? '?'})`, guardHash: e.delta.guardHash });
    }
  }
  for (const op of demoFieldDelta.operationen) {
    refs.push({ refId: `${demoFieldDelta.zielField} · ${op.anker.entity}.${op.anker.slot}`, guardHash: op.guardHash });
  }
  refs.push({ refId: demoCharakter.modell.ref });
  return refs;
}

/* ------------------------------------------------------------------ */
/* Adapter: Mock-Bestand → StudioProject (MemoryProjectStore)          */
/* ------------------------------------------------------------------ */

/** `scripts/lina.interaktion.json` → `lina.interaktion` (ID statt Pfad, B.2). */
function normalisiereSkriptRef(ref: string): string {
  const m = /^scripts\/([^/]+)\.json$/.exec(ref);
  return m ? m[1]! : ref;
}

/** `mod:<modId>/(field|char|script)/<name>` → `<name>` (Kurzname im Mod-Namensraum). */
function kurzName(id: string): string {
  const m = /^mod:[a-z0-9.-]+\/(?:field|char|script)\/(.+)$/.exec(id);
  return m ? m[1]! : id;
}

/** Pfad des Demo-Hintergrundassets im Projektbestand (`assets/…`, Herkunft user-asset). */
export const DEMO_BG_ASSET_PFAD = 'assets/field-bg-slumkirche.png';

export type AssetLader = () => Promise<Uint8Array>;

/** Standard-Asset-Lader: lädt das Demo-Hintergrundbild aus public/. */
export const standardAssetLader: AssetLader = async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}field-bg-slumkirche.png`);
  if (!res.ok) throw new Error(`Demo-Asset field-bg-slumkirche.png nicht ladbar (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
};

export interface GebautesProjekt {
  project: StudioProject;
  assets: Map<string, Uint8Array>;
}

/**
 * Baut das Demo-Projekt als echtes StudioProject über dem
 * MemoryProjectStore — inklusive Manifest-Feldern aus dem Formular.
 * Dokumente werden in den Namensraum-Formen normalisiert, die
 * studio-core/studio-compiler erwarten (siehe Modulkopf).
 */
export async function baueStudioProjekt(form: ManifestForm, ladeAsset: AssetLader = standardAssetLader): Promise<GebautesProjekt> {
  const projectDoc: ProjectDoc = {
    schemaVersion: 1,
    modId: form.modId,
    name: form.name,
    version: semverString(form.version),
    engineCompat: engineCompatRange(form.engineCompat),
    primaersprache: 'de',
    sprachen: form.spracheEn ? ['de', 'en'] : ['de'],
    manifestZielversion: 2,
  };

  const scripts: Partial<Record<SlotArt, string>> = {};
  for (const [slot, ref] of Object.entries(demoCharakter.auftritte[0]?.scripts ?? {})) {
    const norm = normalisiereSkriptRef(ref);
    // Nur Referenzen behalten, die ein Dokument im Projekt auch liefert
    // (Mock trägt einen Slot „main" ohne zugehöriges Script-Dokument).
    if (norm === `${demoScriptGraph.entitaet}.${demoScriptGraph.slot}`) {
      scripts[slot as SlotArt] = norm;
    }
  }

  const charakter: CharacterDoc = {
    ...demoCharakter,
    id: kurzName(demoCharakter.id),
    auftritte: demoCharakter.auftritte.map((a) => ({ ...a, field: kurzName(a.field), scripts })),
  };

  const docs: Record<string, unknown> = {
    'project.json': projectDoc,
    'dialogues/md1_1.de.json': demoDialoge[0],
    'dialogues/slumkirche.de.json': demoDialoge[1],
    'scripts/lina.interaktion.json': demoScriptGraph,
    'characters/lina.json': charakter,
    'fields/slumkirche_aussen.json': {
      ...demoField,
      id: kurzName(demoField.id),
      hintergrundAsset: DEMO_BG_ASSET_PFAD,
      trigger: demoField.trigger.map((t) => ({ ...t, scriptRef: normalisiereSkriptRef(t.scriptRef) })),
    },
    'fields/md1_1.delta.json': demoFieldDelta,
    'variables.json': demoVariablen,
  };

  const store = new MemoryProjectStore();
  for (const [pfad, doc] of Object.entries(docs)) {
    await store.save(pfad, utf8Bytes(canonicalJson(doc)));
  }
  const assets = new Map<string, Uint8Array>([[DEMO_BG_ASSET_PFAD, await ladeAsset()]]);
  return { project: await StudioProject.open(store), assets };
}

/* ------------------------------------------------------------------ */
/* Befund-Mapping (Compiler-Befund → StudioBefund mit Editor-Route)    */
/* ------------------------------------------------------------------ */

export function routeFuerDokument(dokument: string): string {
  if (dokument.startsWith('dialogues/')) return '/dialoge';
  if (dokument.startsWith('scripts/')) return '/quests';
  if (dokument.startsWith('characters/')) return '/charaktere';
  if (dokument.startsWith('fields/')) return '/felder';
  return '/paket';
}

export function zuStudioBefunde(befunde: Befund[]): StudioBefund[] {
  return befunde.map((b) => ({ ...b, quelle: 'kompilierung' as const, zielRoute: routeFuerDokument(b.dokument) }));
}

/* ------------------------------------------------------------------ */
/* Kompilierung: echter Pfad + markierter Simulations-Fallback         */
/* ------------------------------------------------------------------ */

export interface PaketBuild {
  nr: number;
  zeitpunkt: Date;
  version: string;
  ok: boolean;
  /** true = Download erlaubt, aber Warnungen vorhanden. */
  mitWarnungen: boolean;
  befunde: StudioBefund[];
  audit: PaketAudit[];
  paket?: Uint8Array;
  dateiname: string;
  groesseBytes: number;
  dateiAnzahl: number;
  /** SHA-256 des Pakets (Lauf 1). */
  digest?: string;
  /** SHA-256 des Doppellaufs (Determinismus-Nachweis). */
  digestDoppellauf?: string;
  /** true = Fallback-Spur (echte Kompilierung im Browser gescheitert). */
  simuliert: boolean;
}

function fehlerBefund(meldung: string, fixHint?: string): StudioBefund {
  return { dokument: 'project.json', pfad: '', klasse: 'fehler', meldung, ...(fixHint ? { fixHint } : {}), quelle: 'kompilierung', zielRoute: '/paket' };
}

/**
 * Echte Kompilierung: StudioProject aus dem Mock-Bestand +
 * `compileProject` (Struktur → Referenzen → Semantik → Manifest →
 * Paketierung laufen im Compiler). Bei Erfolg wird ein Doppellauf zur
 * Determinismus-Kontrolle ausgeführt (Digest-Vergleich).
 *
 * Scheitert der echte Pfad im Browser (Ausnahme), wird eine klar
 * markierte Simulations-Fallback-Spur erzeugt und der Fehler als
 * Befund ausgewiesen.
 */
export async function kompiliereProjekt(form: ManifestForm, buildNr: number): Promise<PaketBuild> {
  const basis = {
    nr: buildNr,
    zeitpunkt: new Date(),
    version: semverString(form.version),
    dateiname: `${form.modId}-${semverString(form.version)}.wmmod`,
  };
  try {
    const { project, assets } = await baueStudioProjekt(form);
    const res = await compileProject(project, { assets });
    const befunde = zuStudioBefunde(res.befunde);
    const mitWarnungen = res.befunde.some((b) => b.klasse === 'warnung');
    if (!res.ok || res.paket === undefined) {
      return { ...basis, ok: false, mitWarnungen, befunde, audit: [], groesseBytes: 0, dateiAnzahl: 0, simuliert: false };
    }
    const digest = await sha256Hex(res.paket);
    // Doppellauf: gleicher Projektstand muss byteidentisch paketieren.
    const zweitlauf = await compileProject(project, { assets });
    const digestDoppellauf = zweitlauf.paket !== undefined ? await sha256Hex(zweitlauf.paket) : undefined;
    return {
      ...basis,
      ok: true,
      mitWarnungen,
      befunde,
      audit: res.audit,
      paket: res.paket,
      groesseBytes: res.paket.byteLength,
      dateiAnzahl: res.audit.length,
      digest,
      ...(digestDoppellauf !== undefined ? { digestDoppellauf } : {}),
      simuliert: false,
    };
  } catch (err) {
    // Simulations-Fallback (klar markiert): echte Kompilierung im Browser
    // an dieser Stelle gescheitert — Fehler als Befund ausweisen.
    const meldung = err instanceof Error ? err.message : String(err);
    const caps = leiteCapabilitiesAb().map((c) => c.key);
    const simManifest = {
      manifestVersion: '2.0.0',
      id: form.modId,
      version: semverString(form.version),
      name: form.name,
      engineCompat: engineCompatRange(form.engineCompat),
      simuliert: true,
      capabilities: caps,
    };
    const manifestBytes = utf8Bytes(canonicalJson(simManifest));
    const simHash = await sha256Hex(manifestBytes).catch(() => '0'.repeat(64));
    const audit: PaketAudit[] = [
      { pfad: 'manifest.json', herkunft: 'generated', bytes: manifestBytes.byteLength, sha256: simHash },
      { pfad: 'content/assets/field-bg-slumkirche.png', herkunft: 'user-asset', bytes: 0, sha256: '0'.repeat(64) },
    ];
    return {
      ...basis,
      ok: true,
      mitWarnungen: true,
      befunde: [
        fehlerBefund(
          `Echte Kompilierung im Browser fehlgeschlagen: ${meldung}`,
          'Details in der Browser-Konsole. Es wird eine klar markierte Simulations-Fallback-Spur angezeigt.',
        ),
        {
          dokument: 'project.json',
          pfad: '',
          klasse: 'warnung',
          meldung: 'Simulations-Fallback aktiv — Paket und Audit sind simuliert, nicht vom Compiler erzeugt.',
          quelle: 'kompilierung',
          zielRoute: '/paket',
        },
      ],
      audit,
      paket: manifestBytes,
      groesseBytes: manifestBytes.byteLength,
      dateiAnzahl: audit.length,
      digest: simHash,
      digestDoppellauf: simHash,
      simuliert: true,
    };
  }
}

/** „Nur validieren": Struktur + Referenzen + Semantik ohne Paketierung. */
export async function validiereProjekt(form: ManifestForm): Promise<StudioBefund[]> {
  try {
    const { project } = await baueStudioProjekt(form);
    const befunde = [...new IncrementalValidator(project).validateAll(), ...semanticBefunde(project)];
    return zuStudioBefunde(befunde);
  } catch (err) {
    return [fehlerBefund(`Validierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)];
  }
}

/* ------------------------------------------------------------------ */
/* Download + Formatierung                                             */
/* ------------------------------------------------------------------ */

/** Löst den `.wmmod`-Download aus (Uint8Array → Blob → Anchor-Klick). */
export function ladePaketHerunter(paket: Uint8Array, dateiname: string): void {
  const bytes = new Uint8Array(paket.byteLength);
  bytes.set(paket);
  const blob = new Blob([bytes.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function formatiereBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Digest-Anzeige: `9f3c1a2b…c4d5`. */
export function kurzDigest(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/** Relativzeit grob (Sidebar). */
export function relativZeit(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 10) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  return `vor ${Math.round(m / 60)} h`;
}
