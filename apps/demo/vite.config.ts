import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { ff7DataPlugin } from './ff7data-plugin';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [ff7DataPlugin(r('.'))],
  resolve: {
    alias: {
      '@webmidgar/formats-lgp': r('../../packages/formats-lgp/src/index.ts'),
      '@webmidgar/io': r('../../packages/io/src/index.ts'),
      '@webmidgar/cache': r('../../packages/cache/src/index.ts'),
      '@webmidgar/formats-field': r('../../packages/formats-field/src/index.ts'),
      '@webmidgar/convert': r('../../packages/convert/src/index.ts'),
      '@webmidgar/render-field': r('../../packages/render-field/src/index.ts'),
      '@webmidgar/walkmesh': r('../../packages/walkmesh/src/index.ts'),
      '@webmidgar/field-runtime': r('../../packages/field-runtime/src/index.ts'),
      '@webmidgar/formats-kernel': r('../../packages/formats-kernel/src/index.ts'),
      '@webmidgar/formats-save': r('../../packages/formats-save/src/index.ts'),
      '@webmidgar/dialog': r('../../packages/dialog/src/index.ts'),
      '@webmidgar/menu': r('../../packages/menu/src/index.ts'),
      '@webmidgar/app-shell': r('../../packages/app-shell/src/index.ts'),
      '@webmidgar/modding': r('../../packages/modding/src/index.ts'),
      '@webmidgar/audio': r('../../packages/audio/src/index.ts'),
      '@webmidgar/interpreter': r('../../packages/interpreter/src/index.ts'),
      '@webmidgar/formats-model': r('../../packages/formats-model/src/index.ts'),
      '@webmidgar/render-actor': r('../../packages/render-actor/src/index.ts'),
      '@webmidgar/interpreter-debug': r('../../packages/interpreter-debug/src/index.ts'),
      '@webmidgar/license-steam': r('../../packages/license-steam/src/index.ts'),
      '@webmidgar/input': r('../../packages/input/src/index.ts'),
      '@webmidgar/formats-world': r('../../packages/formats-world/src/index.ts'),
      '@webmidgar/render-world': r('../../packages/render-world/src/index.ts'),
      '@webmidgar/world-runtime': r('../../packages/world-runtime/src/index.ts'),
      '@webmidgar/formats-battle': r('../../packages/formats-battle/src/index.ts'),
      '@webmidgar/battle-runtime': r('../../packages/battle-runtime/src/index.ts'),
      '@webmidgar/render-battle': r('../../packages/render-battle/src/index.ts'),
      '@webmidgar/fixture-gen': r('../../tools/fixture-gen/src/index.ts'),
      '@webmidgar/nfr-run': r('../../tools/nfr-run/src/index.ts'),
      '@webmidgar/pipeline': r('../../packages/pipeline/src/index.ts'),
      '@webmidgar/telemetry': r('../../packages/telemetry/src/index.ts'),
      '@webmidgar/ui-window': r('../../packages/ui-window/src/index.ts'),
      '@webmidgar/ui-battle-hud': r('../../packages/ui-battle-hud/src/index.ts'),
      // Ergaenzt beim Kampf-HUD (K6): das neue Paket war in vitest.config.ts
      // registriert, hier aber nicht — dadurch war game.html mit
      // 'Failed to resolve import @webmidgar/atlas' gar nicht ladbar.
      '@webmidgar/atlas': r('../../packages/atlas/src/index.ts'),
    },
  },
  // Vite nimmt ohne diese Liste nur `index.html` als Einstiegspunkt — der
  // Produktionsbuild hätte die sechs Diagnoseseiten stillschweigend
  // weggelassen, obwohl sie im Entwicklungsserver erreichbar sind.
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        ['index', 'calibration', 'walkmesh', 'actor', 'background', 'field', 'field-model', 'nfr', 'beta', 'r9', 'mathprobe', 'colorprobe', 'farbcheck', 'modellcheck', 'menu', 'license', 'world', 'game', 'window-skin', 'battle-hud'].map(
          (name) => [name, r(`./${name}.html`)],
        ),
      ),
    },
  },
  server: { port: 5199 },
});
