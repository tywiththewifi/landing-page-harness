/**
 * Just enough of GitHub's REST API for the publisher: contents, refs, trees, commits,
 * pull requests, labels and review requests, in memory. Requests are recorded so tests
 * can check what was sent.
 */
export function fakeGitHub(repo: string, files: Record<string, string> = {}) {
  let n = 0;
  const id = () => (++n).toString(16).padStart(40, "0");
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const pulls: { number: number; head: string; base: string; title: string; body: string; state: string; labels: Set<string>; reviewers: string[]; teams: string[] }[] = [];
  const requests: { method: string; path: string; body?: unknown }[] = [];

  const tree0 = id();
  trees.set(tree0, new Map(Object.entries(files)));
  const commit0 = id();
  commits.set(commit0, { tree: tree0, parents: [], message: "Initial" });
  refs.set("main", commit0);

  const json = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const prefix = `/repos/${repo}`;

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.headers.get("authorization") !== "Bearer test-token") return json({ message: "Bad credentials" }, 401);
    if (!url.pathname.startsWith(prefix)) return json({ message: "Not Found" }, 404);
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.json();
    requests.push({ method: req.method, path: path + url.search, body });
    let m: RegExpMatchArray | null;

    if (req.method === "GET" && (m = path.match(/^\/contents\/(.+)$/))) {
      const ref = url.searchParams.get("ref") ?? "main";
      const content = trees.get(commits.get(refs.get(ref)!)!.tree)!.get(m[1]!);
      return content === undefined ? json({ message: "Not Found" }, 404) : json({ type: "file", encoding: "base64", content: b64(content), sha: "x" });
    }
    if (req.method === "GET" && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = refs.get(m[1]!);
      return sha ? json({ object: { sha } }) : json({ message: "Not Found" }, 404);
    }
    if (req.method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = commits.get(m[1]!);
      return c ? json({ sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : json({ message: "Not Found" }, 404);
    }
    if (req.method === "POST" && path === "/git/trees") {
      const { base_tree, tree } = body as { base_tree: string; tree: { path: string; content?: string; sha?: null }[] };
      const next = new Map(trees.get(base_tree));
      for (const e of tree) {
        if (e.sha === null) {
          if (!next.has(e.path)) return json({ message: "GitHub would refuse to delete a missing path" }, 422);
          next.delete(e.path);
        } else next.set(e.path, e.content!);
      }
      // Same content, same tree, as in git.
      const same = [...trees].find(([, t]) => t.size === next.size && [...next].every(([k, v]) => t.get(k) === v));
      if (same) return json({ sha: same[0] }, 201);
      const sha = id();
      trees.set(sha, next);
      return json({ sha }, 201);
    }
    if (req.method === "POST" && path === "/git/commits") {
      const { tree, parents, message } = body as { tree: string; parents: string[]; message: string };
      const sha = id();
      commits.set(sha, { tree, parents, message });
      return json({ sha }, 201);
    }
    if (req.method === "POST" && path === "/git/refs") {
      const { ref, sha } = body as { ref: string; sha: string };
      const name = ref.replace("refs/heads/", "");
      if (refs.has(name)) return json({ message: "Reference already exists" }, 422);
      refs.set(name, sha);
      return json({ ref, object: { sha } }, 201);
    }
    if (req.method === "PATCH" && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      refs.set(m[1]!, (body as { sha: string }).sha);
      return json({ object: { sha: refs.get(m[1]!) } });
    }
    if (req.method === "GET" && path === "/pulls") {
      const head = url.searchParams.get("head")!.split(":")[1];
      return json(pulls.filter((p) => p.head === head && p.state === "open").map((p) => ({ number: p.number, html_url: `https://github.com/${repo}/pull/${p.number}` })));
    }
    if (req.method === "POST" && path === "/pulls") {
      const { title, head, base, body: text } = body as { title: string; head: string; base: string; body: string };
      const pr = { number: pulls.length + 1, head, base, title, body: text, state: "open", labels: new Set<string>(), reviewers: [], teams: [] };
      pulls.push(pr);
      return json({ number: pr.number, html_url: `https://github.com/${repo}/pull/${pr.number}` }, 201);
    }
    if (req.method === "PATCH" && (m = path.match(/^\/pulls\/(\d+)$/))) {
      Object.assign(pulls[Number(m[1]) - 1]!, body);
      return json({});
    }
    if (req.method === "POST" && (m = path.match(/^\/issues\/(\d+)\/labels$/))) {
      for (const l of (body as { labels: string[] }).labels) pulls[Number(m[1]) - 1]!.labels.add(l);
      return json([]);
    }
    if (req.method === "DELETE" && (m = path.match(/^\/issues\/(\d+)\/labels\/(.+)$/))) {
      const labels = pulls[Number(m[1]) - 1]!.labels;
      return labels.delete(m[2]!) ? json([]) : json({ message: "Label does not exist" }, 404);
    }
    if (req.method === "POST" && (m = path.match(/^\/pulls\/(\d+)\/requested_reviewers$/))) {
      const pr = pulls[Number(m[1]) - 1]!;
      const { reviewers, team_reviewers } = body as { reviewers: string[]; team_reviewers: string[] };
      if (reviewers.includes("me")) return json({ message: "Review cannot be requested from pull request author." }, 422);
      pr.reviewers.push(...reviewers);
      pr.teams.push(...team_reviewers);
      return json({}, 201);
    }
    return json({ message: `Fake GitHub has no ${req.method} ${path}` }, 501);
  };

  /** The files on a branch, as git would check them out. */
  const filesOn = (branch: string) => Object.fromEntries(trees.get(commits.get(refs.get(branch)!)!.tree)!);
  /** Merges a branch into main, as the auto-merge workflow would. */
  const merge = (branch: string) => {
    const sha = id();
    commits.set(sha, { tree: commits.get(refs.get(branch)!)!.tree, parents: [refs.get("main")!, refs.get(branch)!], message: `Merge ${branch}` });
    refs.set("main", sha);
    for (const p of pulls) if (p.head === branch) p.state = "merged";
  };
  const push = (branch: string, path: string, content: string) => {
    const t = new Map(trees.get(commits.get(refs.get(branch)!)!.tree));
    t.set(path, content);
    const tree = id();
    trees.set(tree, t);
    const sha = id();
    commits.set(sha, { tree, parents: [refs.get(branch)!], message: "Someone else" });
    refs.set(branch, sha);
  };

  return { fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)), requests, pulls, refs, filesOn, merge, push };
}
