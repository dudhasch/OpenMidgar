import * as THREE from 'three';
import { ff7DirToScene } from '@webmidgar/convert';
import { texToRgba, type AnimationFrame, type MeshSource, type Skeleton, type TextureSource } from '@webmidgar/formats-model';
import { EULER_ORDER, ROOT_FRAME_FIX_DEG, rootFrameTranslationToModel } from './pose.js';

/**
 * GPU-Adapter der Modellkette: Skeleton → Three-Bone-Hierarchie mit starren
 * Segment-Meshes (FF7-Field-Modelle sind rigid-segmentiert, kein Skinning).
 *
 * Aufbau: `root` (Scene-Space-Wrapper — trägt als EINZIGE Stelle die zentrale
 * FF7→Scene-Basis aus packages/convert, ADR-009) → `model` (FF7-Modellraum,
 * erhält Wurzeltranslation/-rotation je Frame) → Bone-Gruppen (Kindversatz
 * (0,0,parentLength), Eulerorder 'YXZ' — Referenzmathematik in pose.ts).
 */

export interface ActorMeshBundle {
  mesh: MeshSource;
  /** Je RSD-Texturslot eine Textur oder null (→ Platzhalter). */
  textures: (TextureSource | null)[];
}

export interface Actor {
  root: THREE.Group;
  model: THREE.Group;
  boneGroups: THREE.Group[];
}

/** Wrapper-Rotation aus der zentralen Konvertierung (keine lokalen Flips). */
export function sceneBasisMatrix(): THREE.Matrix4 {
  const x = ff7DirToScene([1, 0, 0]);
  const y = ff7DirToScene([0, 1, 0]);
  const z = ff7DirToScene([0, 0, 1]);
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x),
    new THREE.Vector3(...y),
    new THREE.Vector3(...z),
  );
}

/** Hochachse im FF7-Modellraum (dritte Komponente, s. convert/ff7-to-scene). */
const FF7_UP = new THREE.Vector3(0, 0, 1);
/** Wiederverwendet — `setActorFacing` läuft je Figur und Takt, darf nicht allozieren. */
const yawScratch = new THREE.Quaternion();

/**
 * Blickrichtung einer Figur setzen, OHNE die Scene-Basis zu verlieren.
 *
 * `root.quaternion` trägt die zentrale FF7→Scene-Basis (s. buildActor,
 * ADR-009). Wer stattdessen `root.rotation.y` schreibt, ersetzt das Quaternion
 * vollständig und löscht die Basis — die Figur steht dann im rohen
 * FF7-Modellraum, also flach auf dem Boden, und der Gierwinkel dreht den
 * liegenden Körper in der Bodenebene (F20, 2026-08-10: betraf jede
 * Field-Aufnahme der Demo).
 *
 * Deshalb wird der Gierwinkel um die FF7-Hochachse **auf** die Basis
 * multipliziert: `root.quaternion = Basis ∘ R_z(−facing)`. Das Vorzeichen ist
 * dasselbe wie zuvor in der Demo — die Basis bildet FF7-z auf Scene-y ab, eine
 * Drehung um FF7-z ist also dieselbe Drehung wie zuvor um Scene-y.
 */
/**
 * 🟡 Modell-Vorderseiten-Versatz: Die Feldmodelle schauen im Modellraum nicht
 * entlang der Achse, die die erste Fassung annahm — Sichtbefund (Runde 3):
 * „runter" blickte nach rechts, „hoch" nach links, konsistent 90° verdreht.
 * Der Wert wird per Sichtsweep gegen Original-Screenshots kalibriert.
 */
export let MODEL_FRONT_OFFSET_DEG = -90;

/** Nur für die Sichtkalibrierung der Demo — kein Spielzustand. */
export function setModelFrontOffset(deg: number): void {
  MODEL_FRONT_OFFSET_DEG = deg;
}

export function setActorFacing(actor: Actor, degrees: number): void {
  actor.root.quaternion
    .setFromRotationMatrix(sceneBasisMatrix())
    .multiply(yawScratch.setFromAxisAngle(FF7_UP, (-(degrees + MODEL_FRONT_OFFSET_DEG) * Math.PI) / 180));
}

const PLACEHOLDER_COLOR = 0xff00ff; // Magenta-Platzhalter (Debug-Konvention)

/**
 * Schwelle des Farbschlüssels. 🟢 **Realdatenbeleg** (`tex-alpha-probe`): Der
 * Bestand kennt praktisch nur die Alphawerte 255 (28209 Einträge), 0 (2213)
 * und 254 (858) — es gibt keine Halbtransparenz, die eine feinere Schwelle
 * verlangte. Ein harter Schnitt in der Mitte ist deshalb kein Kompromiss,
 * sondern die exakte Semantik.
 *
 * `alphaTest` statt `transparent: true`: Verworfene Fragmente schreiben auch
 * die Tiefe nicht. Genau darauf kommt es an — sonst verdeckte die unsichtbare
 * Fläche des Aufklebers das Gesicht ebenso zuverlässig wie die sichtbare, und
 * man hätte statt eines schwarzen Rechtecks ein Loch.
 */
const ALPHA_TEST = 0.5;

/**
 * Tiefenvorzug für texturierte Flächen (Aufkleber-Versatz).
 *
 * 🟡 **Renderentscheidung, kein Formatfakt.** FF7 legt Augen und Mund als
 * Aufkleber EXAKT auf die Gesichtsfläche. Ohne Vorzug entscheidet der
 * Rundungsfehler je Pixel, wer gewinnt; sichtbar wurde das als Streifenmuster
 * über den Augen (Sichtprüfung 2026-08-10).
 *
 * Dass ausgerechnet die texturierten Flächen die Aufkleber sind, ist gemessen
 * und nicht geraten: Von 4710 Submeshes des Bestands sind nur **626**
 * texturiert (13,3 %), und 187 Ressourcen tragen genau drei Texturen — Gesicht
 * plus zwei Augen. Die Grundgeometrie ist vertexgefärbt.
 *
 * **Wirkung und Richtung sind belegt** (2026-08-10, O4-Resttafel): Die Regel
 * wurde 2/2 als richtig beurteilt, die **umgekehrte Kontrollregel** (Vorzug
 * für die untexturierten Flächen) 2/2 als falsch, und „gar kein Vorzug"
 * ebenfalls 2/2 als falsch. Damit ist ausgeschlossen, dass die Regel
 * wirkungslos ist oder in die falsche Richtung zeigt — genau das hätte die
 * Kontrollzelle aufgedeckt.
 *
 * **Der Rest dieser Annahme ist jetzt geschlossen.** Die frühere Fassung gab
 * den Vorzug JEDEM texturierten Submesh und führte als offenen Punkt: „Ein
 * texturiertes Submesh, das KEIN Aufkleber ist, bekäme ihn ebenfalls." Seit
 * der Schattierungsmodus mitgelesen wird, gibt es dafür ein Merkmal statt
 * einer Vermutung — Aufkleber sind FLACH schattiert.
 *
 * 🟢 **Gemessen** (`joint-overlap-probe`, alle 4060 Bone-Meshes von
 * `char.lgp`): 626 texturierte Submeshes, davon **618 flach** (die Aufkleber)
 * und **8 Gouraud**. Genau diese 8 — in `avia`, `avjb`, `bydf`, `byee`,
 * `hjgc`, `hjgf`, `hrda`, `hrdf` — bekamen den Vorzug bisher zu Unrecht:
 * texturierte KÖRPERgeometrie, die dadurch minimal vor ihre Nachbarsegmente
 * gezogen wurde. Die Bedingung lautet deshalb jetzt `textured && flatShaded`.
 */
const DECAL_OFFSET_FACTOR = -1;
const DECAL_OFFSET_UNITS = -1;

/**
 * 🟡 **Offen: Punktabtastung oder lineare Filterung?**
 *
 * Wir tasten punktgenau ab. Das Dekompilat spricht dagegen: `D3D5ApplyRenderState`
 * (0x006A3D30) setzt unter Maskenbit `0x4` `D3DFILTER_LINEAR` — und Bit `0x4`
 * steht in jedem texturierten Block (`stateBits` 0x3820E). **Entschieden ist
 * damit nichts**, denn die `changedMask` der Blöcke ist 0x20002 und enthält
 * 0x4 nicht: Der Filter wird vom Block nie ausgegeben, es gilt der globale
 * Gerätezustand, und den hat niemand vermessen. Zusätzlich zwingt das Original
 * auf Nearest zurück, sobald `forceSoftwareDevice` gesetzt ist.
 *
 * Das Auge entscheidet, was die Messung nicht kann — deshalb ein Schalter statt
 * einer Vorgabe. Nur für die Sichtkalibrierung (`farbcheck.html`), kein
 * Spielzustand.
 */
export let MODEL_TEXTURE_LINEAR = false;

/** Nur für die Sichtkalibrierung der Demo — kein Spielzustand. */
export function setModelTextureFilter(linear: boolean): void {
  MODEL_TEXTURE_LINEAR = linear;
}

function buildTexture(tex: TextureSource): THREE.DataTexture {
  const texture = new THREE.DataTexture(texToRgba(tex), tex.width, tex.height, THREE.RGBAFormat);
  if (MODEL_TEXTURE_LINEAR) {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
  texture.magFilter = THREE.NearestFilter; // authentischer Look, keine Palettensäume
  texture.minFilter = THREE.NearestFilter;
  // F41: Gespiegelte Aufkleber (das zweite Auge nutzt UVs außerhalb von
  // [0,1]) brauchen Wiederholung — mit Clamp-to-Edge (three-Vorgabe)
  // verschmierte der Randtexel das Decal zu einer leeren Fläche.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Feldlicht je Modell (F42) — Sektion-2-Block: drei gerichtete Lichter
 * (RGB + i16-Richtungsvektor, 4096er-Festkomma) plus Umgebungsfarbe.
 */
export interface ActorLighting {
  lights: { color: [number, number, number]; direction: [number, number, number] }[];
  ambient: [number, number, number];
}

/**
 * Festkommaeinheit der Richtungsvektoren.
 *
 * 🟡 **Herkunft** (ADR-028): `ff7_en.exe`, `Field_InstantiateModels`
 * (0x0063E4EB) bildet jede Komponente als `-(i16) / DAT_007B78AC`; die
 * Konstante steht im Abbild als `0x45800000` = **4096.0f**. (Der Fließtext der
 * vorliegenden Dekompilat-Notizen nennt an dieser Stelle 360 — das ist der
 * Divisor des Skalenfeldes daneben, nicht der der Richtung.)
 *
 * 🟢 **Gegenprobe an unseren Daten bestanden**: Über alle 5454
 * Modellblöcke liegt der Median der Vektorbeträge bei 4108,5 (IQR 9,2), 96,4 %
 * innerhalb ±10 % — auf 4096 normierte Vektoren. Zwei unabhängige Quellen,
 * derselbe Wert.
 */
const LIGHT_DIR_SCALE = 1 / 4096;

/**
 * Vorberechnetes Lichtwerk eines Modells: die 3×3-Matrix `C·D` und die
 * Umgebungsfarbe. Siehe {@link buildLightSet} für die Herleitung.
 */
export interface ActorLightSet {
  /** `C·D` — Zeile = Farbkanal (R,G,B), Spalte = Richtungskomponente. */
  colorDir: THREE.Matrix3;
  /** Umgebungsfarbe, 0…1. */
  ambient: THREE.Vector3;
}

/**
 * Das Lichtwerk des Originals, nachgebaut.
 *
 * 🟡 **Herkunft** (ADR-028): Dekompilat `ff7_en.exe`. Die Kette ist
 * `Field_InstantiateModels` (0x0063E4EB) → `Gfx_CreateLightSet` (0x0069CA53) →
 * `FUN_0069C5EE` → `FUN_0069C25A` / `FUN_0069C2E8` / `MultiplyMatrix4x4Core`,
 * je Bone und Bild dann `ApplyLightSet` (0x0069C69F) und der Vertexkern
 * `FUN_0068DD1E` bzw. `Gfx_LightVertexDiffuse` (0x0068DAE1).
 *
 * Aufbau, Schritt für Schritt:
 *
 *  1. **Richtung** je Licht L: `d_L = −roh_L / 4096`, danach gedreht mit der
 *     Feldlichtbasis `(x, y, z) → (x, z, −y)` (im Original `FUN_006390D5`, eine
 *     Identität mit `m[5]=0, m[6]=1, m[9]=−1, m[10]=0`). Die Vektoren werden
 *     **nicht** normiert — ihr Betrag ist Teil der Helligkeit.
 *  2. **Richtungsmatrix** `D`: Zeile L ist `d_L`.
 *  3. **Farbmatrix** `C`: `C[r][L] = Farbkanal r von Licht L / 255`.
 *  4. `C·D` — die Matrix, die eine Normale direkt auf ein RGB-Intensitätstripel
 *     abbildet.
 *
 * Je Bone kommt die Bone-Weltrotation dazu (siehe {@link buildMeshObject}), je
 * Vertex dann `I = C·D·R·n + ambient`.
 *
 * **Zwei Abweichungen der bisherigen Lambert-Hypothese sind damit belegt
 * falsch:** die Richtung war nicht negiert (Licht kam von der Gegenseite), und
 * es gibt **kein** `max(0, n·l)` je Licht — ein wegzeigendes Licht zieht im
 * Original ab. Der frühere Deckel `min(1.25, …)` war frei erfunden.
 */
export function buildLightSet(licht: ActorLighting): ActorLightSet {
  const dir: [number, number, number][] = [];
  for (let l = 0; l < 3; l++) {
    const roh = licht.lights[l]?.direction ?? [0, 0, 0];
    const x = -roh[0] * LIGHT_DIR_SCALE;
    const y = -roh[1] * LIGHT_DIR_SCALE;
    const z = -roh[2] * LIGHT_DIR_SCALE;
    dir.push([x, z, -y]); // Feldlichtbasis
  }

  // (C·D)[r][k] = Σ_L (Farbe_L,r / 255) · d_L[k]
  const e: number[] = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) {
      let summe = 0;
      for (let l = 0; l < 3; l++) {
        summe += ((licht.lights[l]?.color?.[r] ?? 0) / 255) * dir[l]![k]!;
      }
      e[r * 3 + k] = summe;
    }
  }

  return {
    // Matrix3.set nimmt zeilenweise entgegen — genau unsere Anordnung.
    colorDir: new THREE.Matrix3().set(e[0]!, e[1]!, e[2]!, e[3]!, e[4]!, e[5]!, e[6]!, e[7]!, e[8]!),
    ambient: new THREE.Vector3(
      licht.ambient[0] / 255,
      licht.ambient[1] / 255,
      licht.ambient[2] / 255,
    ),
  };
}

/** Szenenbasis als Quaternion, einmalig — zum Herausrechnen im Lichtpfad. */
const SCENE_BASIS_INVERSE = new THREE.Quaternion()
  .setFromRotationMatrix(sceneBasisMatrix())
  .invert();

// Wiederverwendet — der Lichtpfad läuft je Mesh und Bild, darf nicht allozieren.
const lightQuatScratch = new THREE.Quaternion();
const lightMat4Scratch = new THREE.Matrix4();
const lightMat3Scratch = new THREE.Matrix3();

/**
 * Der Vertexkern des Originals, als Einschub in three's `MeshBasicMaterial`.
 *
 * 🟡 **Herkunft** (ADR-028): `FUN_0068DD1E` — je Kanal
 * `I < ambient ? ambient : I`, dann `min(farbe · I, 255)`. Die Untergrenze ist
 * die Umgebungsfarbe, **nicht** null: Der Schalter dafür ist das Kartenfeld
 * `g_FieldModelNoShadow`, und `Field_InitMapConfigTable` (0x0060EFF9) setzt es
 * für alle 1200 Karten auf 0 und danach für genau **12** Karten (Liste bei
 * 0x00905AE0) auf 1. Der Regelfall — 1188 von 1200 Feldkarten — ist damit die
 * Variante mit Umgebungs-Untergrenze; nur jene 12 nutzen `Gfx_LightVertexDiffuse`
 * mit Untergrenze null.
 *
 * `vColor` ist an dieser Stelle bereits die Vertexfarbe (0…1); das Ergebnis
 * wird im Fragment mit dem Texel multipliziert — das ist D3DTBLEND_MODULATE,
 * das `D3D5ApplyRenderState` (0x006A3D30) für Modellgeometrie setzt.
 */
function applyLightShader(material: THREE.MeshBasicMaterial, set: ActorLightSet): {
  matrix: { value: THREE.Matrix3 };
  ambient: { value: THREE.Vector3 };
} {
  const uniforms = {
    matrix: { value: new THREE.Matrix3().copy(set.colorDir) },
    ambient: { value: set.ambient },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFf7LightMatrix = uniforms.matrix;
    shader.uniforms.uFf7Ambient = uniforms.ambient;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mat3 uFf7LightMatrix;\nuniform vec3 uFf7Ambient;',
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
{
  vec3 ff7Intensity = uFf7LightMatrix * normal + uFf7Ambient;
  ff7Intensity = max(ff7Intensity, uFf7Ambient);
  vColor.rgb = min(vColor.rgb * ff7Intensity, vec3(1.0));
}`,
      );
  };
  // Ohne eigenen Schlüssel gäbe three uns das zwischengespeicherte Programm
  // einer gleich parametrisierten, aber UNbeleuchteten Basisvariante.
  material.customProgramCacheKey = () => 'ff7-field-light';
  return uniforms;
}

/**
 * Ein `.p`-Mesh als Three-Objekt — Submesh-Gruppen, Texturen, Vertexfarben,
 * Aufkleber-Versatz. Exportiert, weil die Kampfbühne (render-battle) DIESELBE
 * Geometrie- und Texturkette benutzt, aber kein Skelett hat: sie braucht den
 * Mesh-Bau ohne den Bone-Baum drumherum. Zwei Implementierungen desselben
 * Materialaufbaus würden sonst unbemerkt auseinanderlaufen.
 */
/**
 * Vertexfarben als RGB — die Alphakomponente der `.p`-Farben wird bewusst
 * fallengelassen.
 *
 * 🟡 **Herkunft** (ADR-028): `D3D5BuildVertexArray` (0x006A37F5) übernimmt
 * das RGB von `polygon_data+0x50` unverändert — „ein glatter dword-Kopiervorgang,
 * ohne Multiplikation, Skalierung, Gamma oder Vormultiplikation" —, ruft danach
 * aber `ApplyGlobalColorModulate` (0x006A3BEE) auf, und das überschreibt das
 * **Alphabyte** jedes Vertex mit `p_hundred+0x5C`. (Dieses Feld heißt in
 * älteren Notizen „alphaRef"; das ist falsch — der Zeichenzeit-`ALPHAREF` sitzt
 * auf `+0x40`, und `+0x5C` ist ein erzwungenes Alpha.)
 *
 * Für `char.lgp` ist der Wert in 4852 von 4875 Blöcken 255 — das gespeicherte
 * Vertexalpha erreicht das Gerät also praktisch nie. Behielten wir es bei,
 * würde three es (als vierkomponentiges Farbattribut) auf die Fragment-
 * deckkraft multiplizieren und Vertices ausbleichen, die im Original voll
 * deckend sind.
 */
/**
 * FF7-Blendmodus (`p_hundred+0x44`) → Materialzustand.
 *
 * 🟡 **Herkunft** (ADR-028): `Pfile_SetHundredBlendMode` (0x00694C80) setzt je
 * Modus ein Faktorenpaar UND das erzwungene Vertexalpha `+0x5C`, das
 * `ApplyGlobalColorModulate` danach in jeden Vertex schreibt:
 *
 * | Modus | src / dest | erzwungenes Alpha | Wirkung |
 * |---|---|---|---|
 * | 0 | SRCALPHA / INVSRCALPHA | 0x80 | normales Alpha, halb |
 * | 1 | SRCALPHA / ONE | 0x80 | additiv, halb |
 * | 2 | INVSRCCOLOR / ONE | 0xFF | additiv, nach Helligkeit gedämpft |
 * | 3 | SRCALPHA / ONE | 0x40 | additiv, ein Viertel |
 * | 4 | ONE / ZERO | 0xFF | deckend (löscht zusätzlich das Blend-Bit) |
 *
 * Weil das Alpha je Gruppe KONSTANT ist, trägt es hier `opacity` statt eines
 * Vertexattributs — dasselbe Ergebnis, ohne den Puffer aufzublähen.
 *
 * `depthWrite` bleibt an: Das Original schaltet ZWRITEENABLE nie ab (Bit
 * 0x10000 steht in jedem Block), und die Modi 0..3 sind dort keine
 * Sortierklasse, sondern nur ein anderes Faktorenpaar in derselben Reihenfolge.
 *
 * 🟢 **Am Bestand gemessen** (`model-shading-probe`): 4852 der 4875
 * `char.lgp`-Blöcke sind Modus 4. Die 23 übrigen — 10× Modus 0, 2× Modus 1,
 * 11× Modus 3, kein Modus 2 — sitzen in 23 verschiedenen Dateien, jeweils als
 * Gruppe 0 oder 1. Modus 2 ist damit im Feldbestand unbelegt und hier
 * Vorsorge.
 */
function blendState(mode: number): { params: THREE.MeshBasicMaterialParameters; alpha: number } {
  const mit = (alpha: number, rest: THREE.MeshBasicMaterialParameters) => ({
    params: { transparent: true, opacity: alpha, ...rest },
    alpha,
  });
  switch (mode) {
    case 0:
      return mit(0x80 / 255, { blending: THREE.NormalBlending });
    case 1:
      return mit(0x80 / 255, { blending: THREE.AdditiveBlending });
    case 2:
      return mit(1, {
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneMinusSrcColorFactor,
        blendDst: THREE.OneFactor,
      });
    case 3:
      return mit(0x40 / 255, { blending: THREE.AdditiveBlending });
    default:
      return { params: {}, alpha: 1 }; // Modus 4: deckend, three-Vorgaben
  }
}

function vertexColorsRgb(colors: Uint8Array): Uint8Array {
  const anzahl = Math.floor(colors.length / 4);
  const out = new Uint8Array(anzahl * 3);
  for (let v = 0; v < anzahl; v++) {
    out[v * 3] = colors[v * 4]!;
    out[v * 3 + 1] = colors[v * 4 + 1]!;
    out[v * 3 + 2] = colors[v * 4 + 2]!;
  }
  return out;
}

export function buildMeshObject(bundle: ActorMeshBundle, licht?: ActorLighting): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(bundle.mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(bundle.mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(bundle.mesh.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColorsRgb(bundle.mesh.colors), 3, true));
  geometry.setIndex(new THREE.BufferAttribute(bundle.mesh.indices, 1));

  const set = licht ? buildLightSet(licht) : null;
  const lichtUniforms: { matrix: { value: THREE.Matrix3 } }[] = [];
  const basisMaterial = (opts: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial => {
    const material = new THREE.MeshBasicMaterial(opts);
    if (set && opts.vertexColors) lichtUniforms.push(applyLightShader(material, set));
    return material;
  };

  const materials: THREE.Material[] = [];
  bundle.mesh.submeshes.forEach((sub, s) => {
    geometry.addGroup(sub.start, sub.count, s);
    const blend = blendState(sub.blendMode);
    // Der Farbschlüssel muss die Gruppendeckkraft überleben. three prüft den
    // Alphatest gegen `opacity · Texelalpha`; bei einer Vierteldeckkraft läge
    // das Produkt (0,25) unter der festen Schwelle 0,5 und JEDES Fragment
    // fiele weg. Die Schwelle wandert deshalb mit — das Texelalpha ist binär
    // (0 oder ~1), die halbe Deckkraft trennt beide Fälle sauber.
    const alphaTest = ALPHA_TEST * blend.alpha;
    if (sub.textured) {
      const tex = bundle.textures[sub.textureIndex];
      materials.push(
        tex
          ? basisMaterial({
              ...blend.params,
              map: buildTexture(tex),
              // Textur × Vertexfarbe. 🟡 Beleg (ADR-028):
              // `D3D5ApplyRenderState` (0x006A3D30) setzt für Modellgeometrie
              // `D3DRENDERSTATE_TEXTUREMAPBLEND = D3DTBLEND_MODULATE` — das
              // Endergebnis ist genau Texel × Vertexfarbe. Eine Verdopplung
              // (`*2`) oder eine 128-=-1,0-Halbskala, wie sie PSX-Pipelines
              // kennen, gibt es im PC-Build an keiner Stelle.
              vertexColors: true,
              alphaTest,
              // Nur echte Aufkleber (flach schattiert) — s. DECAL_OFFSET_*.
              polygonOffset: sub.flatShaded,
              polygonOffsetFactor: sub.flatShaded ? DECAL_OFFSET_FACTOR : 0,
              polygonOffsetUnits: sub.flatShaded ? DECAL_OFFSET_UNITS : 0,
            })
          : new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR }),
      );
    } else {
      materials.push(basisMaterial({ ...blend.params, vertexColors: true }));
    }
  });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.frustumCulled = false;

  if (set && lichtUniforms.length > 0) {
    /**
     * Die Lichtmatrix hängt an der **Weltdrehung des Bones** und ändert sich
     * daher je Bild — mit jedem Schritt der Figur und jeder Drehung.
     *
     * 🟡 **Herkunft** (ADR-028): `Anim_DrawSkeletonFrame` (0x006840DA) ruft
     * je Bone `ApplyLightSet` mit der eben berechneten Bone-Weltmatrix, und
     * `FUN_0069C3D7` bildet daraus `M = (C·D) · Wᵀ`. Weil `W` zeilenvektorisch
     * abgelegt ist, ist `Wᵀ·n` die Normale im Weltraum — die Beleuchtung findet
     * also im FF7-Weltraum statt, nicht im Modellraum.
     *
     * Deshalb `onBeforeRender`: three hat dort die Weltmatrix bereits
     * aktualisiert, und es braucht keinerlei Verdrahtung beim Aufrufer. Die
     * Szenenbasis (ADR-009) wird herausgerechnet, die Blickrichtung der Figur
     * NICHT — sie steckt im Original ebenso in `W`. Der Weg über das Quaternion
     * lässt zugleich die Modellskalierung draußen, die sonst als Helligkeits-
     * faktor durchschlüge.
     */
    mesh.onBeforeRender = (): void => {
      mesh.getWorldQuaternion(lightQuatScratch).premultiply(SCENE_BASIS_INVERSE);
      lightMat3Scratch.setFromMatrix4(lightMat4Scratch.makeRotationFromQuaternion(lightQuatScratch));
      for (const u of lichtUniforms) u.matrix.value.multiplyMatrices(set.colorDir, lightMat3Scratch);
    };
  }
  return mesh;
}

/**
 * Actor aus Skeleton + aufgelösten Ressourcen bauen. `resolve` liefert je
 * Bone die Mesh-/Texturbündel (leer = reines Gelenk).
 */
export function buildActor(
  skeleton: Skeleton,
  resolve: (boneIndex: number) => ActorMeshBundle[],
  licht?: ActorLighting,
): Actor {
  const root = new THREE.Group();
  root.name = `actor:${skeleton.name}`;
  root.quaternion.setFromRotationMatrix(sceneBasisMatrix());

  const model = new THREE.Group();
  model.name = 'model';
  model.rotation.order = EULER_ORDER;
  root.add(model);

  const boneGroups: THREE.Group[] = [];
  skeleton.bones.forEach((bone, i) => {
    const group = new THREE.Group();
    group.name = `bone:${bone.name}#${i}`;
    group.rotation.order = EULER_ORDER;
    if (bone.parentIndex < 0) {
      model.add(group);
    } else {
      // Kindversatz entgegen der Bone-Achse (R4, sichtgeprüft) — muss mit
      // `computePose` in pose.ts übereinstimmen, sonst bricht die Dualität.
      group.position.set(0, 0, -skeleton.bones[bone.parentIndex]!.length);
      boneGroups[bone.parentIndex]!.add(group);
    }
    for (const bundle of resolve(i)) group.add(buildMeshObject(bundle, licht));
    boneGroups.push(group);
  });
  return { root, model, boneGroups };
}

const DEG2RAD = Math.PI / 180;

/**
 * Frame anwenden — die Konventionen der Referenzmathematik (pose.ts) inklusive
 * der Wurzelrahmen-Korrektur.
 *
 * `rootFrameFix` ist **Vorgabe**, seit die Sichtprüfung und die Algebra
 * unabhängig auf denselben Wert führen (s. `ROOT_FRAME_FIX_DEG`). Der Schalter
 * bleibt, damit Sweeps und die Dualitätstests das rohe Verhalten weiterhin
 * ansteuern können.
 */
export function applyFrame(
  actor: Actor,
  skeleton: Skeleton,
  frame: AnimationFrame,
  rootFrameFix = true,
): void {
  const t = rootFrameFix ? rootFrameTranslationToModel(frame.rootTranslation) : frame.rootTranslation;
  const pitch = rootFrameFix ? ROOT_FRAME_FIX_DEG : 0;
  actor.model.position.set(t[0], t[1], t[2]);
  actor.model.rotation.set(
    (frame.rootRotation[0] + pitch) * DEG2RAD,
    frame.rootRotation[1] * DEG2RAD,
    frame.rootRotation[2] * DEG2RAD,
    EULER_ORDER,
  );
  skeleton.bones.forEach((bone, i) => {
    const rx = frame.rotations[bone.fileOrder * 3] ?? 0;
    const ry = frame.rotations[bone.fileOrder * 3 + 1] ?? 0;
    const rz = frame.rotations[bone.fileOrder * 3 + 2] ?? 0;
    actor.boneGroups[i]!.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, EULER_ORDER);
  });
}

/** Bone-Matrix im FF7-Modellraum (Wrapper herausgerechnet) — für Tests/Debug. */
export function boneModelMatrix(actor: Actor, boneIndex: number): THREE.Matrix4 {
  actor.root.updateMatrixWorld(true);
  const rootInverse = actor.root.matrixWorld.clone().invert();
  return rootInverse.multiply(actor.boneGroups[boneIndex]!.matrixWorld);
}

/** Kapsel-Platzhalter (E-HRC-Fallback laut Validierungsmatrix). */
export function buildFallbackActor(height = 20): Actor {
  const root = new THREE.Group();
  root.name = 'actor:fallback';
  root.quaternion.setFromRotationMatrix(sceneBasisMatrix());
  const model = new THREE.Group();
  root.add(model);
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(height / 4, height / 2, 4, 8),
    new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR, wireframe: true }),
  );
  capsule.position.z = height / 2;
  capsule.rotation.x = Math.PI / 2; // Kapselachse auf Modell-Z (Höhenachse)
  model.add(capsule);
  return { root, model, boneGroups: [] };
}
