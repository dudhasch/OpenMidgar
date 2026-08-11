export {
  blockIndexToCell,
  cellToBlockIndex,
  wrapCell,
  blockOrigin,
  meshOrigin,
  cellAt,
  type BlockCell,
} from './layout.js';
export {
  buildMeshGeometry,
  buildTexturedMeshGeometry,
  type MeshGeometry,
  type TexturedMeshGeometry,
  type TexturedGeometryOptions,
} from './geometry.js';
export {
  measureTextureUvRanges,
  buildWorldTextureTable,
  measureTextureFit,
  minimalDimension,
  feasibleOffsets,
  chooseOffset,
  CLTR_QUIRK_U,
  CLTR_NAME,
  VRAM_OFFSET_GRID,
  type TextureUvRange,
  type TextureSize,
  type TextureTableEntry,
  type TextureTableResult,
  type BuildTextureTableInput,
  type FitMeasurement,
} from './texture-table.js';
export {
  buildWorldTextureAtlas,
  countAtlasOverlaps,
  atlasUvForLocalPixel,
  WORLD_ATLAS_PADDING,
  type WorldAtlasImage,
  type WorldAtlasPlacement,
  type WorldTextureAtlas,
} from './texture-atlas.js';
export {
  buildWorldTextureSet,
  type WorldTextureSet,
  type WorldTextureSetInput,
  type WorldTextureSetReport,
} from './texture-setup.js';
export {
  collectAtlasImages,
  measureTextureCooccurrence,
  paletteExtremes,
  substituteAnimatedPalette,
  colorizeIndexed,
  ANIMATED_PALETTE_ENTRIES,
  type StaticTextureImage,
  type AtlasImageInput,
  type AtlasImageResult,
} from './texture-images.js';
export {
  worldUvToLocal,
  resolveTriangleUv,
  type WorldTextureMeta,
  type WorldTextureTable,
  type TriangleUv,
} from './uv.js';
export { sampleGround, type GroundSample } from './height.js';
export { WorldStreamer, type StreamSlot, type StreamUpdate } from './streaming.js';
export {
  followCameraPose,
  DEFAULT_FOLLOW_CAMERA,
  type FollowCameraParams,
  type CameraPose,
} from './camera.js';
