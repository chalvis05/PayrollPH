import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the schema file; it does not need a live database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
