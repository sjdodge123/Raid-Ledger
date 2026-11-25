import { defineConfig } from 'drizzle-kit';

// L1 (ROK-1670): migrations live outside src/ so tsc never has to copy .sql
// and the runner finds one folder from both src/scripts and dist/scripts.
export default defineConfig({
  schema: './src/drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
});
