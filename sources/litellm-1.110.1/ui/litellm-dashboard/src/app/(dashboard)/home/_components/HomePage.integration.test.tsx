import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyActivityAggregatedResponse } from "@/components/UsagePage/dailyActivityApi";
import { EMPTY_DAILY_ACTIVITY_METADATA } from "@/components/UsagePage/dailyActivityApi";
import { all_admin_roles } from "@/utils/roles";
import i18n from "@/i18n/i18n";
import HomePage from "./HomePage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const auth = vi.hoisted(() => ({ accessToken: "sk-test", userRole: "", userId: "u1", isViewOnly: false, isAuthorized: true, isLoading: false }));
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({ default: () => auth }));
const network = vi.hoisted(() => ({ aggregated: vi.fn(), gateway: vi.fn(), userInfo: vi.fn() }));
vi.mock("@/components/networking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/networking")>()),
  dailyActivityAggregatedCall: (...args: unknown[]) => network.aggregated(...args),
  gatewayDailyActivityCall: (...args: unknown[]) => network.gateway(...args),
  userGetInfoV2: (...args: unknown[]) => network.userInfo(...args),
  getProxyBaseUrl: () => "http://proxy.test",
}));

const dayResult = (date: string, model: string, tokens: number) => {
  const metrics = { spend: 501.74, prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens,
    api_requests: 1, successful_requests: 1, failed_requests: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return { date, metrics, breakdown: { models: {}, model_groups: { [model]: { metrics, metadata: {}, api_key_breakdown: {} } },
    providers: {}, api_keys: {}, entities: {}, mcp_servers: {} } };
};
const activity: DailyActivityAggregatedResponse = {
  results: [dayResult("2026-10-08", "Qwen3-235B", 900), dayResult("2026-10-09", "DeepSeek-V4-Flash", 100)] as unknown as DailyActivityAggregatedResponse["results"],
  metadata: { ...EMPTY_DAILY_ACTIVITY_METADATA, total_spend: 501.74, total_api_requests: 5118,
    total_successful_requests: 5075, total_failed_requests: 43, total_tokens: 98_600_000,
    total_prompt_tokens: 90_000_000, total_completion_tokens: 8_600_000 },
};
const renderHome = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HomePage /></QueryClientProvider>);
const forbidden = /美元|费用|花费|预算|成本|计价|\$|USD|LiteLLM|GitHub|ChatGPT|Claude/i;

describe("首页总览", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    auth.isViewOnly = false;
    auth.userRole = all_admin_roles[0]!;
    network.aggregated.mockReset().mockResolvedValue(activity);
    network.gateway.mockReset().mockResolvedValue({ total_successful_requests: 0, total_failed_requests: 0 });
    network.userInfo.mockReset().mockResolvedValue({ user_info: { max_budget: 1500 } });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({}))));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("首页使用真实输入输出令牌和请求数据，接口返回金额与预算时也不展示", async () => {
    const { container } = renderHome();
    expect(await screen.findByText("5,118")).toBeInTheDocument();
    expect(screen.getByTitle("90,000,000 个令牌")).toBeInTheDocument();
    expect(screen.getByTitle("8,600,000 个令牌")).toBeInTheDocument();
    expect(screen.getByTitle("98,600,000 个令牌")).toBeInTheDocument();
    expect(network.aggregated).toHaveBeenCalledWith("user", expect.objectContaining({ accessToken: "sk-test" }));
    expect(container).not.toHaveTextContent(forbidden);
    expect(container).not.toHaveTextContent("501.74");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "查看令牌明细" }));
    expect(await screen.findByRole("dialog", { name: "令牌明细" })).not.toHaveTextContent(forbidden);
  });

  it("查询失败显示重试提示，不将失败视为零用量", async () => {
    network.aggregated.mockRejectedValueOnce(new Error("synthetic failure"));
    renderHome();
    expect(await screen.findByText(i18n.t("home.page.usageFailed"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看令牌明细" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("home.page.retry") }));
    expect(await screen.findByText("5,118")).toBeInTheDocument();
    expect(network.aggregated).toHaveBeenCalledTimes(2);
  });

  it("排名使用令牌占比，首页不请求公网资讯", async () => {
    renderHome();
    const board = screen.getByTestId("home-leaderboard");
    expect(await within(board).findByText("Qwen3-235B")).toBeInTheDocument();
    const rows = within(board).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Qwen3-235B")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("90.0%")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("DeepSeek-V4-Flash")).toBeInTheDocument();
    expect(screen.queryByTestId("home-whats-new")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-updates")).not.toBeInTheDocument();
    for (const [input] of vi.mocked(fetch).mock.calls) {
      expect(String(input)).not.toMatch(/https:\/\/|blog_posts/);
    }
  });
});
