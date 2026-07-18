import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "server/db/schema.prisma",
  migrations: {
    path: "server/db/migrations",
    seed: "tsx server/db/seed.ts",
  },
  // Migrate/introspect/studio need a direct (non-pooled) connection — PgBouncer
  // transaction pooling doesn't support the session-level commands they issue.
  // The running app uses DATABASE_URL (pooled) via server/db/client.ts instead.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
