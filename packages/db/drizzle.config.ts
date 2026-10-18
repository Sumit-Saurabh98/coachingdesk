import { defineConfig } from 'drizzle-kit';

// Local dev reads the repo-root .env; CI/prod set DATABASE_URL directly.
try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env file: fine outside local dev
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Run: cp .env.example .env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: databaseUrl },
  // camelCase in TypeScript (instituteId) <-> snake_case in Postgres (institute_id)
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
