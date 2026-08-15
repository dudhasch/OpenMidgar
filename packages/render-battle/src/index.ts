export * from './composition.js';
/**
 * Der Clip-Typ gehört der Modellkette, nicht diesem Paket — er wird nur
 * durchgereicht, damit Aufrufer von `battleAnimationToClip` ihn benennen
 * können, ohne `formats-model` zusätzlich einzubinden.
 */
export type { AnimationClipSource } from '@webmidgar/formats-model';
export * from './view-model.js';
export * from './battle-actor.js';
export * from './model-loader.js';
export * from './party-models.js';
export * from './stage-actor.js';
