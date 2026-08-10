import * as THREE from 'three';
import { decodeModelLightBlock, type FieldModelAnimation, type FieldModelEntry } from '@webmidgar/formats-field';
import {
  parseA,
  parseHrc,
  parseP,
  parseRsd,
  parseTex,
  type Skeleton,
  type TextureSource,
} from '@webmidgar/formats-model';
import { applyFrame, buildActor, type Actor, type ActorMeshBundle } from './actor.js';
import { bindClip, type BoundClip } from './binding.js';
import { bindPoseFrame } from './pose.js';

/**
 * Wiederverwendbare Auflösekette für Field-Charaktermodelle aus `char.lgp`
 * (vormals nur Demo-Code in apps/demo/field-model-demo.ts):
 *
 *   FieldModelEntry → hrc → je Bone resourceRefs → rsd → p + tex → buildActor
 *   FieldModelAnimation → a → bindClip
 *
 * Die Library kapselt IO (`readEntry` nach Eintragsnamen wie in char.lgp,
 * z. B. `aaaa.hrc`, `aaba.a`), cached geteilte Parse-Ergebnisse und gibt je
 * `load` ein eigenständiges Handle mit eigener Three-Instanz zurück —
 * mehrere Handles desselben Modells teilen die Quellobjekte (MeshSource,
 * Skeleton, gebundene Clips), nicht aber Geometrie-/Material-Instanzen.
 *
 * Fehlerpolitik wie in der Demo: fehlende/defekte Teilressourcen werden
 * übersprungen (Bone bleibt reines Gelenk, Textur wird Platzhalter), nur ein
 * fehlendes/unparsbares .hrc macht das Modell unladbar (`load` → null).
 * Fehlende/misslungene Animationen führen zur Bindpose, nie zur Exception.
 */

export type FieldActorScaleMode = 'model-over-128' | 'model-over-512' | 'model-over-global' | 'none';

export interface ActorLibraryOptions {
  /**
   * Maximale Einträge je Parse-Cache (hrc-Quellen, a-Clips, gebundene Clips).
   * Verdrängung in Einfüge-/Zugriffsreihenfolge (LRU); lebende Handles halten
   * ihre Quellen unabhängig vom Cache am Leben.
   */
  cacheLimit?: number;
  /**
   * 🟡 Skalierungshypothese — bisher nirgends sichtkalibriert. Community-üblich
   * gilt 512 als Normalgröße; `model-over-512` wendet `scale / 512` an.
   * `model-over-global` teilt stattdessen durch den Sektion-3-Kopfwert
   * (scaleGlobal, 512 in 643/702 Fields). Die Sichtkalibrierung entscheidet
   * später im Browser; bis dahin ist der Modus hier übersteuerbar.
   */
  scaleMode?: FieldActorScaleMode;
  /**
   * Diagnosehaken für übersprungene Teilressourcen (F21). Die Fehlerpolitik
   * bleibt unverändert — fehlende Teile werden weiterhin still übersprungen —,
   * aber sie werden nicht mehr **unsichtbar**: ohne diesen Haken war im Bild
   * nicht zu unterscheiden, ob eine magentafarbene Figur eine Ersatzkapsel
   * (Modell gar nicht geladen) oder ein Modell mit Platzhaltermaterial
   * (Textur fehlt) ist.
   */
  onMissing?: (info: { model: string; kind: 'hrc' | 'rsd' | 'p' | 'tex' | 'texSlot'; name: string }) => void;
}

export interface FieldActorHandle {
  /** Three-Instanz dieses Handles (aus buildActor) — nicht geteilt. */
  readonly actor: Actor;
  /** Geteiltes, gecachtes Skelett (nicht mutieren). */
  readonly skeleton: Skeleton;
  /** = entry.animations.length des geladenen Manifest-Eintrags. */
  readonly animationCount: number;
  /**
   * Animation nach Manifest-Index anfordern (lädt/bindet lazy). `id` ist der
   * Index in entry.animations — dieselbe Nummernebene wie
   * ActorRuntime.animation.id des Interpreters. Bis die Bindung fertig ist
   * (oder wenn sie scheitert), wendet advanceTick die Bindpose an.
   */
  setAnimation(index: number, speed: number, loop: boolean): void;
  /**
   * Einen Sitzungstakt (Fixed-Tick 30 Hz) weiterschalten und den aktuellen
   * Frame per applyFrame anwenden. Deterministisch: der erste Takt nach
   * setAnimation zeigt Frame 0.
   */
  advanceTick(): void;
  /** Test-/Host-Haken: aufgelöst, sobald die zuletzt per setAnimation angeforderte Bindung fertig (oder gescheitert) ist. */
  whenAnimationSettled(): Promise<void>;
  /** Three-Ressourcen dieses Handles freigeben (geteilte Quellen bleiben in der Library). */
  release(): void;
}

export interface ActorLibrary {
  /**
   * Modell des Manifest-Eintrags auflösen und als Handle liefern.
   * `scaleGlobal` ist der Sektion-3-Kopfwert des Fields (typ. 512).
   * null, wenn das .hrc fehlt oder unparsbar ist.
   */
  load(entry: FieldModelEntry, scaleGlobal: number): Promise<FieldActorHandle | null>;
  /** Alle lebenden Handles freigeben und Caches leeren. */
  dispose(): void;
}

/** Community-Konvention: Skala 512 = Normalgröße (🟡 s. ActorLibraryOptions.scaleMode). */
const SCALE_REFERENCE = 512;

/**
 * 🟢 **Sichtkalibrierter Bezugswert (F28, 2026-08-10).**
 *
 * Eingemessen gegen einen Original-Screenshot desselben Fields (`md1stin`,
 * Steam-Durchlauf, gleiche Spieldateien, gleiche Kamera): Der Bahnsteig-
 * Wächter ist im Original rund 108 px hoch. Ein Faktorsweep 1 / 2 / 3 / 3,5 /
 * 4 / 4,5 / 5 / 5,5 über dieselbe Szene trifft bei **4** Kopf und Füße
 * deckungsgleich (3,5 ⇒ 88 px zu klein, 4,5 ⇒ 127 px zu groß).
 *
 * `modelScale` ist im gesamten geprüften Bestand 512, `scaleGlobal` ebenfalls —
 * mit dem alten Bezugswert 512 ergab sich also Faktor 1, und JEDE Figur war um
 * denselben Faktor 4 zu klein. Der Bezugswert ist damit 512/4 = **128**.
 *
 * 🟡 Die Grenze gehört dazu: Belegt ist der Faktor an EINEM Field. Dass er
 * global gilt, ist plausibel (der Fehler war überall derselbe, und die
 * Gegenprobe in `farm`, `ncoin1`, `startmap`, `sinin1_1` sieht stimmig aus),
 * aber pixelgenau nachgemessen ist bisher nur `md1stin`. Ein Modell mit
 * abweichender Skala (`rkt_i` führt 384) skaliert damit auf 3 — die relativen
 * Größen bleiben also erhalten.
 */
const SCALE_REFERENCE_KALIBRIERT = 128;
const DEFAULT_CACHE_LIMIT = 64;

/** Geteilte, parse-fertige Quellen eines Modells (ein Cache-Eintrag je .hrc). */
interface ModelSources {
  skeleton: Skeleton;
  /** Je Bone die Mesh-/Texturbündel (leer = reines Gelenk). */
  bundles: ActorMeshBundle[][];
}

/** Kleiner LRU-Cache: Zugriff frischt auf, Überlauf verdrängt den ältesten Eintrag. */
class BoundedCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

function scaleFactor(mode: FieldActorScaleMode, modelScale: number | null, scaleGlobal: number): number {
  switch (mode) {
    case 'none':
      return 1;
    case 'model-over-128':
      // 🟢 Sichtkalibriert gegen das Original, s. SCALE_REFERENCE_KALIBRIERT.
      return (modelScale ?? SCALE_REFERENCE) / SCALE_REFERENCE_KALIBRIERT;
    case 'model-over-global': {
      const divisor = scaleGlobal > 0 ? scaleGlobal : SCALE_REFERENCE;
      return (modelScale ?? divisor) / divisor;
    }
    case 'model-over-512':
      // 🟡 Grundhypothese: 512 = Normalgröße → root.scale = modelScale / 512.
      // Kalibrierbar; die Sichtprüfung im Browser entscheidet später.
      return (modelScale ?? SCALE_REFERENCE) / SCALE_REFERENCE;
  }
}

/** Three-Ressourcen eines Actors freigeben (Geometrien, Materialien, Texturen). */
function disposeActor(actor: Actor): void {
  actor.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    (obj.geometry as THREE.BufferGeometry).dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      const map = (material as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      material.dispose();
    }
  });
}

class FieldActorHandleImpl implements FieldActorHandle {
  readonly actor: Actor;
  readonly skeleton: Skeleton;
  readonly animationCount: number;

  private readonly animations: readonly FieldModelAnimation[];
  private readonly loadClip: (animFile: string) => Promise<BoundClip | null>;
  private readonly onRelease: (handle: FieldActorHandleImpl) => void;
  /** Bindpose einmal je Handle — advanceTick soll nicht pro Takt allozieren. */
  private readonly bindPose;

  private clip: BoundClip | null = null;
  /**
   * 🟡 speed-Semantik: Die Demo schaltet mit festem 80-ms-Raster weiter und
   * wertet speed gar nicht aus — es gibt also noch keinen belegten Umrechner.
   * Grundhypothese hier: speed = Takte je Animationsframe (1 = 1 Frame pro
   * 30-Hz-Takt, größere Werte = langsamer). Kalibrierbar gegen das Original.
   */
  private ticksPerFrame = 1;
  private loop = true;
  private frameIndex = 0;
  private tickAccumulator = 0;
  /** Entwertet verspätete Bindungen, wenn setAnimation erneut gerufen wurde. */
  private requestToken = 0;
  private settled: Promise<void> = Promise.resolve();
  private released = false;

  constructor(
    actor: Actor,
    skeleton: Skeleton,
    animations: readonly FieldModelAnimation[],
    loadClip: (animFile: string) => Promise<BoundClip | null>,
    onRelease: (handle: FieldActorHandleImpl) => void,
  ) {
    this.actor = actor;
    this.skeleton = skeleton;
    this.animations = animations;
    this.animationCount = animations.length;
    this.loadClip = loadClip;
    this.onRelease = onRelease;
    this.bindPose = bindPoseFrame(skeleton);
  }

  setAnimation(index: number, speed: number, loop: boolean): void {
    const token = ++this.requestToken;
    this.ticksPerFrame = Math.max(1, Math.round(speed));
    this.loop = loop;

    const anim = this.animations[index];
    if (!anim) {
      // Index außerhalb der Manifest-Liste → Bindpose, keine Exception.
      this.clip = null;
      this.frameIndex = 0;
      this.tickAccumulator = 0;
      this.settled = Promise.resolve();
      return;
    }
    // F27/F36: Der ALTE Clip läuft weiter, bis der neue gebunden ist — sonst
    // fiele die Figur bei jedem Umschalten (Stehen↔Gehen) für die
    // Bindezeit in die Bindpose, und die ist keine Standhaltung.
    this.settled = this.loadClip(anim.file).then((bound) => {
      if (token !== this.requestToken || this.released) return;
      this.clip = bound && bound.frames.length > 0 ? bound : null;
      this.frameIndex = 0;
      this.tickAccumulator = 0;
    });
  }

  advanceTick(): void {
    if (this.released) return;
    const clip = this.clip;
    if (!clip) {
      applyFrame(this.actor, this.skeleton, this.bindPose);
      return;
    }
    applyFrame(this.actor, this.skeleton, clip.frames[this.frameIndex] ?? this.bindPose);
    this.tickAccumulator += 1;
    if (this.tickAccumulator >= this.ticksPerFrame) {
      this.tickAccumulator = 0;
      const next = this.frameIndex + 1;
      if (next >= clip.frames.length) {
        // Einmalanimation (ANIME1-Semantik) bleibt auf dem letzten Frame stehen.
        this.frameIndex = this.loop ? 0 : clip.frames.length - 1;
      } else {
        this.frameIndex = next;
      }
    }
  }

  whenAnimationSettled(): Promise<void> {
    return this.settled;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.clip = null;
    disposeActor(this.actor);
    this.onRelease(this);
  }
}

export function createActorLibrary(
  readEntry: (entryName: string) => Promise<Uint8Array | null>,
  options?: ActorLibraryOptions,
): ActorLibrary {
  const cacheLimit = options?.cacheLimit ?? DEFAULT_CACHE_LIMIT;
  const scaleMode = options?.scaleMode ?? 'model-over-128';

  /** hrc-Name → geteilte Modellquellen (null = Modell unladbar). */
  const modelCache = new BoundedCache<Promise<ModelSources | null>>(cacheLimit);
  /** `<hrcName>|<animFile>` → gebundener Clip (Bindung ist skelettabhängig). */
  const clipCache = new BoundedCache<Promise<BoundClip | null>>(cacheLimit);
  const liveHandles = new Set<FieldActorHandleImpl>();
  let disposed = false;

  const readSafe = async (name: string): Promise<Uint8Array | null> => {
    try {
      return await readEntry(name);
    } catch {
      // IO-Fehler wie „fehlt" behandeln — die Fehlerpolitik oben gilt einheitlich.
      return null;
    }
  };

  async function resolveModel(hrcName: string): Promise<ModelSources | null> {
    const fehlt = (kind: 'hrc' | 'rsd' | 'p' | 'tex' | 'texSlot', name: string): void =>
      options?.onMissing?.({ model: hrcName, kind, name });

    const hrcBytes = await readSafe(hrcName);
    if (!hrcBytes) {
      fehlt('hrc', hrcName);
      return null;
    }
    const skeleton = parseHrc(hrcBytes, hrcName).value;
    if (!skeleton) {
      fehlt('hrc', hrcName);
      return null;
    }

    const bundles: ActorMeshBundle[][] = [];
    for (const bone of skeleton.bones) {
      const boneBundles: ActorMeshBundle[] = [];
      for (const ref of bone.resourceRefs) {
        const rsdName = `${ref}.rsd`;
        const rsdBytes = await readSafe(rsdName);
        if (!rsdBytes) {
          fehlt('rsd', rsdName);
          continue;
        }
        const binding = parseRsd(rsdBytes, rsdName).value;
        if (!binding) {
          fehlt('rsd', rsdName);
          continue;
        }

        const pName = `${binding.meshRef}.p`;
        const pBytes = await readSafe(pName);
        if (!pBytes) {
          fehlt('p', pName);
          continue;
        }
        const mesh = parseP(pBytes, pName).value;
        if (!mesh) {
          fehlt('p', pName);
          continue;
        }

        const textures: (TextureSource | null)[] = [];
        for (const texRef of binding.textureRefs) {
          const texName = `${texRef}.tex`;
          const texBytes = await readSafe(texName);
          const texture = texBytes ? parseTex(texBytes, texName).value : null;
          if (!texture) fehlt('tex', texName);
          textures.push(texture);
        }
        // Der zweite Weg zum Magenta-Platzhalter: Das Submesh ist als
        // texturiert markiert, sein Slot liegt aber außerhalb der von der RSD
        // benannten Texturen. Dann greift in actor.ts `textures[index] ===
        // undefined` — ohne dass je eine Datei gefehlt hätte.
        for (const sub of mesh.submeshes) {
          if (sub.textured && !textures[sub.textureIndex]) {
            fehlt('texSlot', `${pName}#${sub.textureIndex}/${textures.length}`);
          }
        }
        boneBundles.push({ mesh, textures });
      }
      bundles.push(boneBundles);
    }
    return { skeleton, bundles };
  }

  function modelSources(hrcName: string): Promise<ModelSources | null> {
    const cached = modelCache.get(hrcName);
    if (cached) return cached;
    const promise = resolveModel(hrcName);
    modelCache.set(hrcName, promise);
    return promise;
  }

  function boundClip(hrcName: string, skeleton: Skeleton, animFile: string): Promise<BoundClip | null> {
    const key = `${hrcName}|${animFile}`;
    const cached = clipCache.get(key);
    if (cached) return cached;
    const promise = (async (): Promise<BoundClip | null> => {
      const bytes = await readSafe(animFile);
      if (!bytes) return null;
      const clip = parseA(bytes, animFile).value;
      if (!clip) return null;
      return bindClip(skeleton, clip, animFile);
    })();
    clipCache.set(key, promise);
    return promise;
  }

  return {
    async load(entry: FieldModelEntry, scaleGlobal: number): Promise<FieldActorHandle | null> {
      if (disposed) return null;
      const sources = await modelSources(entry.modelFile);
      if (!sources || disposed) return null;

      // Eigene Three-Instanz je Handle; Quellobjekte (MeshSource/Texturen)
      // kommen geteilt aus dem Cache. F42: Sektion-3-Licht des Eintrags wird
      // beim Bau in die Vertexfarben gebacken (Lambert-Hypothese 🟡).
      const lichtBlock = decodeModelLightBlock(entry.blockRaw);
      const actor = buildActor(
        sources.skeleton,
        (boneIndex) => sources.bundles[boneIndex] ?? [],
        lichtBlock ?? undefined,
      );
      actor.root.scale.setScalar(scaleFactor(scaleMode, entry.scale, scaleGlobal));

      const handle = new FieldActorHandleImpl(
        actor,
        sources.skeleton,
        entry.animations,
        (animFile) => boundClip(entry.modelFile, sources.skeleton, animFile),
        (h) => liveHandles.delete(h),
      );
      // Startzustand: Bindpose, damit das Handle ohne setAnimation posiert ist.
      applyFrame(actor, sources.skeleton, bindPoseFrame(sources.skeleton));
      liveHandles.add(handle);
      return handle;
    },

    dispose(): void {
      disposed = true;
      for (const handle of [...liveHandles]) handle.release();
      liveHandles.clear();
      modelCache.clear();
      clipCache.clear();
    },
  };
}
