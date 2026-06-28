import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
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

  async deletePrefix(prefix: string): Promise<void> {
    const target = resolve(this.dir, prefix);
    // Guard against path escape: the resolved target must stay within the media
    // root (and never BE the root itself, which would wipe the whole store).
    if (target === this.dir || !target.startsWith(this.dir + sep)) {
      throw new Error("Refusing to delete outside the media root");
    }
    await rm(target, { recursive: true, force: true });
  }
}
