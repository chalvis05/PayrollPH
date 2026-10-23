// Bundle the API for production. @payrollph/shared ships TypeScript source, so it (and its own
// dependencies) are inlined; the API's runtime dependencies stay external and come from
// node_modules in the image (argon2 is native, pdfkit loads font files from its package).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@payrollph/shared');

await build({
  entryPoints: {
    server: 'src/server.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
    backup: 'src/scripts/backupCli.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Externals by package name, including subpaths like drizzle-orm/pg-core.
  external: external.flatMap((d) => [d, `${d}/*`]),
  // ESM bundles have no `require`; some CJS-only deps inlined from shared might need it.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
