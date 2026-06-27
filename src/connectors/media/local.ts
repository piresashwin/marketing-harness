import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../../config/env.js";
import type { MediaStore, PutResult } from "./store.js";

const cfg = env.media.local;

export class LocalMediaStore implements MediaStore {
  readonly kind = "local" as const;
  readonly dir = resolve(cfg.dir);

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    console.log(`[media] local store at ${this.dir}, served from ${cfg.baseUrl}`);
  }

  async put(key: string, body: Buffer): Promise<PutResult> {
    const full = join(this.dir, key);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body);
    return { key, url: `${cfg.baseUrl}/${key}` };
  }
}
