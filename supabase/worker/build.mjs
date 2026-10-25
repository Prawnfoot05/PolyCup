import { build } from 'esbuild';
await build({ entryPoints: ['main.ts'], outfile: 'dist/main.mjs', bundle: true,
  platform: 'node', target: 'node22', format: 'esm', packages: 'external' });
console.log('Built result worker (no deployment).');
