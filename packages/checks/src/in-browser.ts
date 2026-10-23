import { AXE_OPTIONS, type AxeOutcome, type AxeRule } from "./axe.ts";
import type { GateRunner } from "./gate.ts";

const SIZES = { mobile: 390, desktop: 1280 } as const;

/**
 * Runs axe on the page in a hidden, sandboxed frame (scripts allowed, no access to the
 * studio) and reads the results back by message. The frame is laid out at the real width
 * off-screen, since axe skips what isn't rendered.
 */
export function axeInFrame(html: string, axeSource: string, viewport: keyof typeof SIZES, timeoutMs = 30000): Promise<AxeOutcome> {
  const token = crypto.randomUUID();
  const report = `(function () {
    var keep = function (r) { return { id: r.id, impact: r.impact, tags: r.tags, help: r.help, helpUrl: r.helpUrl, nodes: r.nodes.map(function (n) { return { target: n.target }; }) }; };
    window.axe.run(document, ${JSON.stringify(AXE_OPTIONS)}).then(function (r) {
      parent.postMessage({ lphAxe: ${JSON.stringify(token)}, violations: r.violations.map(keep), incomplete: r.incomplete.map(keep) }, "*");
    }, function (e) { parent.postMessage({ lphAxe: ${JSON.stringify(token)}, error: String(e) }, "*"); });
  })();`;
  const scripts = `<script>${axeSource.replace(/<\/script/gi, "<\\/script")}</script><script>${report}</script>`;
  const doc = html.includes("</body>") ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${scripts}</body>`) : html + scripts;

  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${SIZES[viewport]}px;height:900px;border:0;`;
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.lphAxe !== token) return;
      done();
      if (e.data.error) reject(new Error(`axe failed: ${e.data.error}`));
      else resolve({ violations: e.data.violations as AxeRule[], incomplete: e.data.incomplete as AxeRule[] });
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("The accessibility check timed out."));
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

/** The gate's runner in the studio: DOMParser for the HTML checks, axe in a hidden frame, no lab timings. */
export function browserRunner(opts: { axeSource?: () => Promise<string> } = {}): GateRunner {
  return {
    environment: "browser",
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    ...(opts.axeSource && {
      axe: async (html, { viewport }) => axeInFrame(html, await opts.axeSource!(), viewport),
    }),
  };
}
