import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Separater Lauf: `npx vitest run --config vitest.realdata.config.ts` */
export default defineConfig({
  resolve: {
    alias: {
      '@webmidgar/formats-lgp': r('./packages/formats-lgp/src/index.ts'),
      '@webmidgar/formats-field': r('./packages/formats-field/src/index.ts'),
      '@webmidgar/convert': r('./packages/convert/src/index.ts'),
      '@webmidgar/walkmesh': r('./packages/walkmesh/src/index.ts'),
      '@webmidgar/field-runtime': r('./packages/field-runtime/src/index.ts'),
      '@webmidgar/formats-kernel': r('./packages/formats-kernel/src/index.ts'),
      '@webmidgar/formats-save': r('./packages/formats-save/src/index.ts'),
      '@webmidgar/dialog': r('./packages/dialog/src/index.ts'),
      '@webmidgar/app-shell': r('./packages/app-shell/src/index.ts'),
      '@webmidgar/modding': r('./packages/modding/src/index.ts'),
      '@webmidgar/audio': r('./packages/audio/src/index.ts'),
      '@webmidgar/interpreter': r('./packages/interpreter/src/index.ts'),
      '@webmidgar/formats-model': r('./packages/formats-model/src/index.ts'),
      '@webmidgar/render-actor': r('./packages/render-actor/src/index.ts'),
      '@webmidgar/interpreter-debug': r('./packages/interpreter-debug/src/index.ts'),
      '@webmidgar/render-field': r('./packages/render-field/src/index.ts'),
      '@webmidgar/pipeline': r('./packages/pipeline/src/index.ts'),
      '@webmidgar/telemetry': r('./packages/telemetry/src/index.ts'),
      '@webmidgar/io': r('./packages/io/src/index.ts'),
      '@webmidgar/cache': r('./packages/cache/src/index.ts'),
      '@webmidgar/studio-core': r('./packages/studio-core/src/index.ts'),
      '@webmidgar/studio-compiler': r('./packages/studio-compiler/src/index.ts'),
      '@webmidgar/fixture-gen': r('./tools/fixture-gen/src/index.ts'),
    },
  },
  test: {
    include: ['tools/realdata-scan/src/**/*.rdtest.ts'],
    environment: 'node',
  },
});
