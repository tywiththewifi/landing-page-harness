import type { SiteMcpTool } from "@lph/tokens";

/** The parts of an MCP tool definition Softlander looks at. */
export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: unknown }>; required?: string[] };
  annotations?: { title?: string; readOnlyHint?: boolean };
}

const QUERY_NAMES = /^(query|q|search|topic|term|keywords?|question|text)$/i;

/**
 * Decides whether and how Softlander may call a tool on a site's MCP server. Only tools
 * the server marks read-only are called, unless a person allows one, and only when their
 * inputs can be filled: none required, or one search input (query, q, topic…) that gets the page's topic.
 * A missing annotation counts as not read-only, as in the MCP spec.
 */
export function toolUse(tool: ToolInfo, allowed = false): Pick<SiteMcpTool, "use" | "arg" | "reason"> {
  const readOnly = tool.annotations?.readOnlyHint === true;
  if (!readOnly && !allowed) return { use: null, reason: "Not marked read-only, so it's only called if you allow it." };
  const who = readOnly ? "Read-only" : "Allowed by you";
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const isText = (name: string) => props[name]?.type === "string" || props[name]?.type === undefined;
  if (!required.length) {
    const optionalQuery = Object.keys(props).find((k) => QUERY_NAMES.test(k) && isText(k));
    return optionalQuery
      ? { use: "query", arg: optionalQuery, reason: `${who}. Called with the page's topic as "${optionalQuery}".` }
      : { use: "auto", reason: `${who}, with no inputs, so it's called as is.` };
  }
  // Only a search-like input gets the topic; an input like "page" or "slug" needs a real value.
  if (required.length === 1 && QUERY_NAMES.test(required[0]!) && isText(required[0]!)) {
    return { use: "query", arg: required[0], reason: `${who}. Called with the page's topic as "${required[0]}".` };
  }
  return { use: null, reason: `Needs inputs Softlander can't fill (${required.join(", ")}).` };
}

/** A tool definition as the studio shows it. */
export const describeTool = (t: ToolInfo, allowed: string[] = []): SiteMcpTool => ({
  name: t.name,
  title: t.title ?? t.annotations?.title ?? t.name,
  description: t.description ?? "",
  readOnly: t.annotations?.readOnlyHint === true,
  fillable: toolUse(t, true).use !== null,
  ...toolUse(t, allowed.includes(t.name)),
});
