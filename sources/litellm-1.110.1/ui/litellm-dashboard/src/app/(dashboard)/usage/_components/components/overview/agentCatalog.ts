import type { ParseKeys, TFunction } from "i18next";
import type { components } from "@/lib/http/schema";
import i18n from "@/i18n/i18n";
import type { DailyData, SpendMetrics } from "@/components/UsagePage/types";

/** One row of `GET /tag/summary`. */
export type TagSummaryRow = components["schemas"]["TagSummaryMetrics"];

export type AgentKind = "agent" | "sdk";

export enum UsageClient {
  ClaudeDesktop = "claude-desktop",
  ClaudeCode = "claude-code",
}

export const parseUsageClient = (value: string | null): UsageClient | null => {
  if (value === UsageClient.ClaudeDesktop) return UsageClient.ClaudeDesktop;
  if (value === UsageClient.ClaudeCode) return UsageClient.ClaudeCode;
  return null;
};

export interface AgentRow {
  id: string;
  label: string;
  description: string;
  kind: AgentKind;
  logo: string | null;
  spend: number;
  tokens: number;
  requests: number;
  users: number;
  /** The raw `User-Agent: ...` tags this agent was built from, used to filter User Agent Activity. */
  tags: string[];
}

interface AgentFamily {
  id: string;
  label: string;
  description: ParseKeys;
  kind: AgentKind;
  logo: string | null;
  /** Matched against the user-agent with its `User-Agent: ` prefix removed, case-insensitively. */
  match: RegExp;
}

/**
 * Most specific first. Coding agents beat the SDK they are built on, so `codex_sdk_ts` lands on
 * Codex and only a bare `OpenAI/...` client falls through to the OpenAI SDK. Codex wears OpenAI's
 * mark as in the Lens trace view; Claude clients use the bundled Claude brand mark.
 */
const FAMILIES: readonly AgentFamily[] = [
  {
    id: UsageClient.ClaudeDesktop,
    label: "Claude Desktop",
    description: "usage.agentCatalog.descriptions.claudeDesktop",
    kind: "agent",
    logo: null,
    match: /^claude[-_ ]desktop\b|^claude-cli\/[^\s]+\s+\((?:[^)]*,\s*)?claude-desktop-3p\s*[,)]/i,
  },
  {
    id: UsageClient.ClaudeCode,
    label: "Claude Code",
    description: "usage.agentCatalog.descriptions.claudeCode",
    kind: "agent",
    logo: null,
    match: /^(claude-code|claude_code|claude-user)\b|^claude-cli\/[^\s]+\s+\((?:[^)]*,\s*)?cli\s*[,)]/i,
  },
  {
    id: "claude-unspecified",
    label: "Claude (unspecified)",
    description: "usage.agentCatalog.descriptions.claudeUnspecified",
    kind: "agent",
    logo: null,
    match: /^claude-cli\b/i,
  },
  {
    id: "codex",
    label: "Codex",
    description: "usage.agentCatalog.descriptions.codex",
    kind: "agent",
    logo: "/ui/realai-symbol.svg",
    match: /^(codex[ _-]|codex$)/i,
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "usage.agentCatalog.descriptions.opencode",
    kind: "agent",
    logo: "/ui/realai-symbol.svg",
    match: /^opencode\b/i,
  },
  {
    id: "cursor",
    label: "Cursor",
    description: "usage.agentCatalog.descriptions.cursor",
    kind: "agent",
    logo: "/ui/realai-symbol.svg",
    match: /^cursor\b/i,
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    description: "usage.agentCatalog.descriptions.copilot",
    kind: "agent",
    logo: null,
    match: /^(github-?copilot|copilot)\b/i,
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    description: "usage.agentCatalog.descriptions.hermes",
    kind: "agent",
    logo: "/ui/realai-symbol.svg",
    match: /^hermes\b/i,
  },
  {
    id: "grok",
    label: "Grok",
    description: "usage.agentCatalog.descriptions.grok",
    kind: "agent",
    logo: "/ui/realai-symbol.svg",
    match: /^grok\b/i,
  },
  {
    id: "cline",
    label: "Cline",
    description: "usage.agentCatalog.descriptions.cline",
    kind: "agent",
    logo: null,
    match: /^cline\b/i,
  },
  {
    id: "kilo-code",
    label: "Kilo Code",
    description: "usage.agentCatalog.descriptions.kiloCode",
    kind: "agent",
    logo: null,
    match: /^kilo[- ]?code\b/i,
  },
  {
    id: "aider",
    label: "Aider",
    description: "usage.agentCatalog.descriptions.aider",
    kind: "agent",
    logo: null,
    match: /^aider\b/i,
  },
  {
    id: "openai-agents",
    label: "OpenAI Agents",
    description: "usage.agentCatalog.descriptions.openaiAgents",
    kind: "sdk",
    logo: "/ui/realai-symbol.svg",
    match: /^agents$/i,
  },
  {
    id: "langchain",
    label: "LangChain",
    description: "usage.agentCatalog.descriptions.langchain",
    kind: "sdk",
    logo: "/ui/realai-symbol.svg",
    match: /^(langchain|langgraph|deepagents)/i,
  },
  {
    id: "pydantic-ai",
    label: "Pydantic AI",
    description: "usage.agentCatalog.descriptions.pydanticAi",
    kind: "sdk",
    logo: "/ui/realai-symbol.svg",
    match: /^pydantic-ai\b/i,
  },
  {
    id: "github-actions",
    label: "GitHub Actions",
    description: "usage.agentCatalog.descriptions.githubActions",
    kind: "sdk",
    logo: null,
    match: /^github-actions\b/i,
  },
  {
    id: "litellm",
    label: "LiteLLM SDK",
    description: "usage.agentCatalog.descriptions.litellmSdk",
    kind: "sdk",
    logo: null,
    match: /^litellm\b/i,
  },
  {
    id: "openai-sdk",
    label: "OpenAI SDK",
    description: "usage.agentCatalog.descriptions.openaiSdk",
    kind: "sdk",
    logo: "/ui/realai-symbol.svg",
    match: /^(openai|asyncopenai)\b/i,
  },
  {
    id: "anthropic-sdk",
    label: "Anthropic SDK",
    description: "usage.agentCatalog.descriptions.anthropicSdk",
    kind: "sdk",
    logo: null,
    match: /^anthropic\b/i,
  },
  {
    id: "python",
    label: "Python",
    description: "usage.agentCatalog.descriptions.python",
    kind: "sdk",
    logo: null,
    match: /^(python|httpx|aiohttp|urllib|requests)/i,
  },
  {
    id: "node",
    label: "Node.js",
    description: "usage.agentCatalog.descriptions.node",
    kind: "sdk",
    logo: null,
    match: /^(node|bun|deno|axios|undici)\b/i,
  },
  {
    id: "curl",
    label: "curl",
    description: "usage.agentCatalog.descriptions.curl",
    kind: "sdk",
    logo: null,
    match: /^curl\b/i,
  },
];

const AGENT_LABEL_KEYS: Readonly<Record<string, ParseKeys>> = {
  "Claude (unspecified)": "usage.agentCatalog.labels.claudeUnspecified",
};

export const agentDisplayLabel = (label: string, _t: TFunction): string =>
  /[A-Za-z]/.test(label) ? "接口客户端" : label;

const USER_AGENT_PREFIX = /^user[- ]agent:\s*/i;

export const isUserAgentTag = (tag: string): boolean => USER_AGENT_PREFIX.test(tag.trim());

/** The user-agent product with its version and platform detail dropped: `claude-cli/2.1.263 (external)` -> `claude-cli`. */
export const userAgentProduct = (tag: string): string => {
  const ua = tag.trim().replace(USER_AGENT_PREFIX, "");
  return ua.split(/[/(;]/, 1)[0].trim();
};

const familyFor = (product: string): AgentFamily | null =>
  FAMILIES.find((family) => family.match.test(product)) ?? null;

export const usageClientFromUserAgent = (userAgent: string): UsageClient | null =>
  parseUsageClient(familyFor(userAgent.trim().replace(USER_AGENT_PREFIX, ""))?.id ?? null);

const isBareTag = (row: TagSummaryRow, product: string) =>
  row.tag.trim().replace(USER_AGENT_PREFIX, "").trim() === product;

/**
 * The rows that count toward a product. `/tag/summary` reports a bare tag (`claude-cli`) as the
 * rollup of its versioned children, and a request carries both, so a bare row alone stands for the
 * product. These same rows become the agent's drill-in filter, keeping it from double-counting.
 */
const contributingRows = (product: string, rows: readonly TagSummaryRow[]): readonly TagSummaryRow[] => {
  const bare = rows.find((row) => isBareTag(row, product));
  return bare ? [bare] : rows;
};

const agentFor = (product: string, rows: readonly TagSummaryRow[]): AgentRow => {
  const family = familyFor(product);
  return {
    id: family?.id ?? `ua:${product.toLowerCase()}`,
    label: `${family?.kind === "agent" ? "智能体客户端" : "接口客户端"}（${family ? FAMILIES.indexOf(family) + 1 : Array.from(product).reduce((hash, char) => (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0, 0)}）`,
    description: "通过内网接口发起的模型调用",
    kind: family?.kind ?? "sdk",
    logo: "/ui/realai-symbol.svg",
    spend: rows.reduce((sum, row) => sum + (row.total_spend || 0), 0),
    tokens: rows.reduce((sum, row) => sum + (row.total_tokens || 0), 0),
    requests: rows.reduce((sum, row) => sum + (row.total_requests || 0), 0),
    // Users overlap across a family's products, so the largest is the honest lower bound.
    users: Math.max(0, ...rows.map((row) => row.unique_users || 0)),
    tags: rows.map((row) => row.tag),
  };
};

const mergeAgents = (a: AgentRow, b: AgentRow): AgentRow => ({
  ...a,
  spend: a.spend + b.spend,
  tokens: a.tokens + b.tokens,
  requests: a.requests + b.requests,
  users: Math.max(a.users, b.users),
  tags: a.tags.length && b.tags.length ? [...a.tags, ...b.tags] : [],
});

const agentsForProduct = (product: string, rows: readonly TagSummaryRow[]): AgentRow[] => {
  if (product.toLowerCase() !== "claude-cli") return [agentFor(product, contributingRows(product, rows))];
  const bare = rows.find((row) => isBareTag(row, product));
  const versions = rows.filter((row) => !isBareTag(row, product));
  const versionAgents = versions.map((row) => agentFor(row.tag.trim().replace(USER_AGENT_PREFIX, ""), [row]));
  if (!bare) return versionAgents;
  const rollup = agentFor(product, [bare]);
  if (!versions.length) return [rollup];
  const emptyTotals = { spend: 0, tokens: 0, requests: 0, users: 0 };
  const totals = versionAgents.reduce(
    (sum, agent) => ({
      spend: sum.spend + agent.spend,
      tokens: sum.tokens + agent.tokens,
      requests: sum.requests + agent.requests,
      users: sum.users + agent.users,
    }),
    emptyTotals,
  );
  if (totals.spend > rollup.spend + 1e-9 || totals.tokens > rollup.tokens || totals.requests > rollup.requests) {
    return [rollup];
  }
  const residual = {
    ...rollup,
    spend: Math.max(0, rollup.spend - totals.spend),
    tokens: rollup.tokens - totals.tokens,
    requests: rollup.requests - totals.requests,
    users: Math.max(0, rollup.users - totals.users),
    // A bare tag also selects the identified clients, so it cannot filter the residual alone.
    tags: [],
  };
  return residual.spend > 1e-9 || residual.tokens > 0 || residual.requests > 0
    ? [...versionAgents, residual]
    : versionAgents;
};

/**
 * One row per agent from `/tag/summary`. Products are keyed case-sensitively: prod reports `python`
 * and `Python` as distinct products, and folding them let one rollup overwrite the other.
 */
export const topAgents = (rows: readonly TagSummaryRow[]): AgentRow[] => {
  const userAgentRows = rows.filter((row) => isUserAgentTag(row.tag) && userAgentProduct(row.tag));
  const products = [...new Set(userAgentRows.map((row) => userAgentProduct(row.tag)))];
  const perProduct = products.flatMap((product) =>
    agentsForProduct(
      product,
      userAgentRows.filter((row) => userAgentProduct(row.tag) === product),
    ),
  );
  const byAgent = perProduct.reduce<ReadonlyMap<string, AgentRow>>((acc, agent) => {
    const existing = acc.get(agent.id);
    return new Map([...acc, [agent.id, existing ? mergeAgents(existing, agent) : agent]]);
  }, new Map());
  return [...byAgent.values()]
    .filter((agent) => agent.spend > 0 || agent.tokens > 0 || agent.requests > 0)
    .sort((a, b) => b.tokens - a.tokens || b.spend - a.spend);
};

/**
 * Rewrites one day's `breakdown.entities` (keyed by raw tag) into one entry per agent, keyed by the
 * agent label, so the existing per-day series builders can stack agents the way they stack models.
 * Uses the same bare-vs-versioned rule as `topAgents`, per day, so no day double-counts a product.
 */
const agentEntitiesForDay = (
  entities: Readonly<Record<string, { metrics: SpendMetrics }>>,
): Record<string, { metrics: SpendMetrics }> => {
  const rows: TagSummaryRow[] = Object.entries(entities).map(([tag, { metrics }]) => ({
    tag,
    total_spend: metrics.spend,
    total_tokens: metrics.total_tokens,
    total_requests: metrics.api_requests,
    successful_requests: metrics.successful_requests,
    failed_requests: metrics.failed_requests,
    unique_users: 0,
  }));
  return Object.fromEntries(
    topAgents(rows).map((agent) => [
      agent.label,
      {
        metrics: {
          spend: agent.spend,
          total_tokens: agent.tokens,
          api_requests: agent.requests,
          prompt_tokens: 0,
          completion_tokens: 0,
          successful_requests: 0,
          failed_requests: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ]),
  );
};

/**
 * Tag daily activity with each day's raw tags folded into agents, written into `breakdown.models`
 * so `seriesBy(..., "models", ...)` stacks agents per day with no agent-specific chart code.
 */
export const agentDailyData = (days: readonly DailyData[]): DailyData[] =>
  days.map((day) => {
    const models = agentEntitiesForDay(day.breakdown.entities ?? {}) as DailyData["breakdown"]["models"];
    const agentTotal = (key: "spend" | "total_tokens" | "api_requests") =>
      Object.values(models).reduce((sum, entry) => sum + entry.metrics[key], 0);
    // The day total becomes the agents' own sum, so the chart's "Other" means agents past the top N,
    // not the untagged and non-agent traffic in the tag table's day total.
    return {
      ...day,
      metrics: {
        ...day.metrics,
        spend: agentTotal("spend"),
        total_tokens: agentTotal("total_tokens"),
        api_requests: agentTotal("api_requests"),
      },
      breakdown: { ...day.breakdown, models },
    };
  });
