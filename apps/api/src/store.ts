import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Brief } from "@lph/brief";
import type { DeliveryResult, Submission } from "@lph/forms";
import type { Page } from "@lph/page";
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

export class PageStore extends JsonStore<Page> {
  async listFor(briefId: string): Promise<(Pick<Page, "id" | "title" | "slug" | "updatedAt"> & { versions: number })[]> {
    return (await this.all())
      .filter((p) => p.briefId === briefId)
      .map(({ id, title, slug, updatedAt, variants }) => ({ id, title, slug, updatedAt, versions: variants.length }));
  }
}

/** A lead as the form endpoint received it, with what happened when it was sent on. */
export interface StoredSubmission extends Submission {
  id: string;
  pageId: string;
  receivedAt: string;
  updatedAt: string;
  delivery: Pick<DeliveryResult, "status" | "detail"> & { connector: string };
}

/**
 * Leads kept by the studio's own API, so a page can be tested before a connector is set
 * up and a failed delivery isn't lost. They hold personal data: the data directory
 * should be treated like the CRM it stands in for.
 */
export class SubmissionStore extends JsonStore<StoredSubmission> {
  async listFor(pageId: string, limit = 50): Promise<StoredSubmission[]> {
    return (await this.all()).filter((s) => s.pageId === pageId).slice(0, limit);
  }
}
