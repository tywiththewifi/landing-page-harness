export function serveFixture(opts?: { name?: string; port?: number }): Promise<{ url: string; close: () => Promise<void> }>;
