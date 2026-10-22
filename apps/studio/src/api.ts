import type { Brand, ContrastCheck } from "@lph/tokens";

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  brandId?: string;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  listBrands: () => request<Pick<Brand, "id" | "name" | "url" | "updatedAt">[]>("/api/brands"),
  importBrand: (url: string, productUrl?: string) =>
    request<Job>("/api/brands", { method: "POST", body: JSON.stringify({ url, productUrl: productUrl || undefined }) }),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  brand: (id: string) => request<Brand>(`/api/brands/${id}`),
  save: (brand: Brand) => request<Brand>(`/api/brands/${brand.id}`, { method: "PUT", body: JSON.stringify(brand) }),
  resolve: (id: string, conflictId: string, value: string) =>
    request<Brand>(`/api/brands/${id}/conflicts/${encodeURIComponent(conflictId)}`, { method: "POST", body: JSON.stringify({ value }) }),
  retry: (id: string) => request<Job>(`/api/brands/${id}/retry`, { method: "POST" }),
  designMd: (id: string) => request<string>(`/api/brands/${id}/design.md`),
  contrast: (id: string) => request<ContrastCheck[]>(`/api/brands/${id}/contrast`),
  confirm: (id: string) => request<{ dir: string; files: string[] }>(`/api/brands/${id}/confirm`, { method: "POST" }),
};

/** Polls a job until it finishes, reporting each step. */
export async function waitForJob(job: Job, onStep: (step: string) => void): Promise<Job> {
  let current = job;
  while (current.status === "running") {
    onStep(current.step);
    await new Promise((r) => setTimeout(r, 400));
    current = await api.job(job.id);
  }
  if (current.status === "failed") throw new Error(current.error ?? "Import failed");
  return current;
}
