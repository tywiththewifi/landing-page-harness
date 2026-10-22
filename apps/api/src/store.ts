import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Brief } from "@lph/brief";
import type { Brand } from "@lph/tokens";

/**
 * File-backed store, one JSON file per record. It keeps the prototype
 * dependency-free; the interface is small enough to swap for a database.
 */
export class JsonStore<T extends { id: string; updatedAt: string }> {
  constructor(private dir: string) {}

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid id");
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(record: T): Promise<T> {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.file(record.id) + ".tmp";
    await writeFile(tmp, JSON.stringify(record, null, 2));
    await rename(tmp, this.file(record.id));
    return record;
  }

  /** Every record, most recently updated first. */
  async all(): Promise<T[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const records = await Promise.all(files.map((f) => this.get(f.replace(/\.json$/, ""))));
    return records.filter((r): r is Awaited<T> => !!r).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export class BrandStore extends JsonStore<Brand> {
  async list(): Promise<Pick<Brand, "id" | "name" | "url" | "updatedAt">[]> {
    return (await this.all()).map(({ id, name, url, updatedAt }) => ({ id, name, url, updatedAt }));
  }
}

export class BriefStore extends JsonStore<Brief> {
  async listFor(brandId: string): Promise<Pick<Brief, "id" | "title" | "prompt" | "funnelStage" | "updatedAt">[]> {
    return (await this.all())
      .filter((b) => b.brandId === brandId)
      .map(({ id, title, prompt, funnelStage, updatedAt }) => ({ id, title, prompt, funnelStage, updatedAt }));
  }
}
