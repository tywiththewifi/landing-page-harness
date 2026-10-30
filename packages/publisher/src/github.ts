import { LABELS } from "./classify.ts";
import type { PublishPlan } from "./plan.ts";

export interface GitHubTarget {
  /** "owner/name". */
  repo: string;
  /** The branch pages are published into, usually "main". */
  base: string;
  /** A fine-grained token (or GitHub App token) with Contents and Pull requests write access to the repo only. */
  token: string;
  /** Users ("octocat") or teams ("my-org/web") asked to review pull requests that need one. */
  reviewers?: string[];
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface PublishResult {
  number: number;
  url: string;
  branch: string;
  commit: string;
  /** A pull request was opened, rather than an open one updated. */
  created: boolean;
  /** The branch already had exactly these files: only the description was refreshed. */
  unchanged: boolean;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Publishes through GitHub's REST API, with no git checkout: the publisher reads the
 * base branch, writes one commit with every file, points the page's branch at it and
 * opens (or updates) the pull request. Like Dependabot, the branch is rebuilt from the
 * base branch on each publish, so the pull request always shows a clean diff.
 */
export function github(target: GitHubTarget) {
  const apiUrl = (target.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const doFetch = target.fetch ?? fetch;
  const [owner] = target.repo.split("/");

  async function api<T>(method: string, path: string, body?: unknown, ok404 = false): Promise<T | null> {
    const res = await doFetch(`${apiUrl}/repos/${target.repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${target.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "softlander",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 404 && ok404) return null;
    if (res.status === 204) return null;
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) {
      const detail = data.message ?? res.statusText;
      if (res.status === 401) throw new GitHubError("GitHub refused the token. Check LPH_GITHUB_TOKEN.", 401);
      if (res.status === 403) throw new GitHubError(`The token can't write to ${target.repo}: ${detail}. It needs Contents and Pull requests write access.`, 403);
      if (res.status === 404) throw new GitHubError(`${target.repo} wasn't found, or the token can't see it.`, 404);
      throw new GitHubError(`GitHub answered ${res.status}: ${detail}`, res.status);
    }
    return data;
  }

  const ref = (branch: string) => api<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodePath(branch)}`, undefined, true);

  return {
    /** Reads a file as it is on the base branch. Null when it isn't there. */
    async read(path: string): Promise<string | null> {
      const file = await api<{ type: string; content?: string; encoding?: string; sha: string }>("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(target.base)}`, undefined, true);
      if (!file || file.type !== "file") return null;
      if (file.encoding === "base64" && file.content !== undefined) return decode(file.content);
      // Over 1 MB the contents API leaves the content out; the blob API has it.
      const blob = await api<{ content: string }>("GET", `/git/blobs/${file.sha}`);
      return decode(blob!.content);
    },

    /**
     * Writes the plan as one commit on the page's branch and opens or updates its pull
     * request. `expectedHead` is the commit the studio last published there: if someone
     * else pushed to the branch since, nothing is overwritten.
     */
    async publish(plan: PublishPlan, opts: { expectedHead?: string | null } = {}): Promise<PublishResult> {
      const base = await ref(target.base);
      if (!base) throw new GitHubError(`${target.repo} has no branch "${target.base}".`, 404);
      const baseCommit = await api<{ tree: { sha: string } }>("GET", `/git/commits/${base.object.sha}`);
      const existing = await ref(plan.branch);
      if (existing && opts.expectedHead && existing.object.sha !== opts.expectedHead) {
        throw new GitHubError(`Someone pushed to ${plan.branch} since it was last published. Merge or close its pull request, or delete the branch, then publish again.`, 409);
      }

      const tree = await api<{ sha: string }>("POST", "/git/trees", {
        base_tree: baseCommit!.tree.sha,
        tree: [
          ...plan.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
          ...plan.removed.map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
        ],
      });
      if (!existing && tree!.sha === baseCommit!.tree.sha) throw new GitHubError(`${target.base} already has this version of the page: there's nothing to publish.`, 409);
      let commit = existing?.object.sha ?? "";
      let unchanged = false;
      const head = existing ? await api<{ tree: { sha: string } }>("GET", `/git/commits/${existing.object.sha}`) : null;
      if (head?.tree.sha === tree!.sha) unchanged = true;
      else {
        const made = await api<{ sha: string }>("POST", "/git/commits", { message: plan.title, tree: tree!.sha, parents: [base.object.sha] });
        commit = made!.sha;
        if (existing) await api("PATCH", `/git/refs/heads/${encodePath(plan.branch)}`, { sha: commit, force: true });
        else await api("POST", "/git/refs", { ref: `refs/heads/${plan.branch}`, sha: commit });
      }

      const open = await api<{ number: number; html_url: string }[]>("GET", `/pulls?head=${encodeURIComponent(`${owner}:${plan.branch}`)}&base=${encodeURIComponent(target.base)}&state=open`);
      let pr = open?.[0] ?? null;
      const created = !pr;
      if (pr) await api("PATCH", `/pulls/${pr.number}`, { title: plan.title, body: plan.body });
      else pr = await api<{ number: number; html_url: string }>("POST", "/pulls", { title: plan.title, head: plan.branch, base: target.base, body: plan.body });

      // One risk label at a time. The site's CI decides again from the diff before merging.
      await api("POST", `/issues/${pr!.number}/labels`, { labels: plan.labels });
      for (const label of Object.values(LABELS)) if (!plan.labels.includes(label)) await api("DELETE", `/issues/${pr!.number}/labels/${encodeURIComponent(label)}`, undefined, true);

      if (plan.classification.risk === "review" && target.reviewers?.length) {
        const teams = target.reviewers.filter((r) => r.includes("/")).map((r) => r.split("/")[1]!);
        const users = target.reviewers.filter((r) => !r.includes("/"));
        // GitHub refuses to ask the token's own user to review; that isn't worth failing over.
        await api("POST", `/pulls/${pr!.number}/requested_reviewers`, { reviewers: users, team_reviewers: teams }).catch((err) => {
          if (!(err instanceof GitHubError && err.status === 422)) throw err;
        });
      }
      return { number: pr!.number, url: pr!.html_url, branch: plan.branch, commit, created, unchanged };
    },
  };
}
