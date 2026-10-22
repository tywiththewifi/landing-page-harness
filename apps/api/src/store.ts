import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Brand } from "@lph/tokens";

/**
 * File-backed brand store. One JSON file per brand keeps the prototype
 * dependency-free; the interface is small enough to swap for a database.
 */
export class BrandStore {
  constructor(private dir: string) {}

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid brand id");
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<Brand | null> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as Brand;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(brand: Brand): Promise<Brand> {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.file(brand.id) + ".tmp";
    await writeFile(tmp, JSON.stringify(brand, null, 2));
    await rename(tmp, this.file(brand.id));
    return brand;
  }

  async list(): Promise<Pick<Brand, "id" | "name" | "url" | "updatedAt">[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const brands = await Promise.all(files.map((f) => this.get(f.replace(/\.json$/, ""))));
    return brands
      .filter((b): b is Brand => !!b)
      .map(({ id, name, url, updatedAt }) => ({ id, name, url, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
