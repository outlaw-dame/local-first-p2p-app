/**
 * ADR-015 bundle budget gate: the MLS provider (library + glue),
 * bundled for the browser and minified, must gzip to at most 250 KB.
 * Runs as part of `pnpm build`, so CI enforces it on every PR.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BUDGET_BYTES = 250 * 1024;

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

const result = await build({
  entryPoints: [join(packageDir, 'src', 'index.ts')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  // The optional noble packages are dynamic-import fallbacks inside
  // ts-mls; the ones we actually install must be bundled, so nothing
  // is external.
  external: []
});

const [output] = result.outputFiles;
if (output === undefined) {
  console.error('bundle-budget: esbuild produced no output');
  process.exit(1);
}
const gzipped = gzipSync(output.contents).byteLength;
const report = `bundle-budget: ${(output.contents.byteLength / 1024).toFixed(1)} KB minified, ${(gzipped / 1024).toFixed(1)} KB min+gzip (budget ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`;

if (gzipped > BUDGET_BYTES) {
  console.error(`${report} — OVER BUDGET`);
  process.exit(1);
}
console.log(report);
