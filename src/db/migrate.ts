import { runMigrations } from "./index.js";

// One-shot migration runner: `npm run migrate`.
runMigrations()
  .then(() => {
    console.log("[db] migrations complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error("[db] migration failed:", e);
    process.exit(1);
  });
