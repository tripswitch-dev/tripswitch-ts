import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/admin/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  outDir: 'dist',
});
