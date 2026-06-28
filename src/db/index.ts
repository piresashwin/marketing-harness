import pg from "pg";
import { env } from "../config/env.js";
import { MIGRATIONS } from "./migrations.js";

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         id integer PRIMARY KEY,
         name text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ id: number }>(
      "SELECT id FROM _migrations",
    );
    const applied = new Set(rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        if (m.sql !== undefined) {
          await client.query(m.sql);
        } else {
          await m.run(client);
        }
        await client.query(
          "INSERT INTO _migrations (id, name) VALUES ($1, $2)",
          [m.id, m.name],
        );
        await client.query("COMMIT");
        console.log(`[db] applied migration ${m.id}: ${m.name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    client.release();
  }
}
