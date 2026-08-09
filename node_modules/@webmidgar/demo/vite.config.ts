import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
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
      '@webmidgar/interpreter': r('../../packages/interpreter/src/index.ts'),
      '@webmidgar/formats-model': r('../../packages/formats-model/src/index.ts'),
      '@webmidgar/render-actor': r('../../packages/render-actor/src/index.ts'),
      '@webmidgar/interpreter-debug': r('../../packages/interpreter-debug/src/index.ts'),
      '@webmidgar/fixture-gen': r('../../tools/fixture-gen/src/index.ts'),
    },
  },
  server: { port: 5199 },
});
