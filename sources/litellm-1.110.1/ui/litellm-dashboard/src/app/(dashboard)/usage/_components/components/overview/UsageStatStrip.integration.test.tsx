import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/i18n";
import type { OverviewTotals } from "./overviewData";
import UsageStatStrip from "./UsageStatStrip";

const totals: OverviewTotals = {
  spend: 501.74, requests: 10, successful: 8, failed: 2,
  tokens: 9123456, inputTokens: 8123456, outputTokens: 1000000,
  cacheReadTokens: 5123456, cacheWriteTokens: 2000000,
  avgCostPerRequest: 50.174, avgLatencyMs: 250, successRate: 80,
};
const defaultProps = { results: [], totals, loading: false, requestCountsPending: false };
const forbidden = /美元|费用|花费|预算|成本|计价|\$|USD|LiteLLM|GitHub|ChatGPT|Claude/i;

describe("总览令牌统计", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });

  it("展示实际令牌和请求数，即使接口返回非零金额也不渲染货币", () => {
    const { container } = render(<UsageStatStrip {...defaultProps} />);
    for (const label of ["输入令牌", "输出令牌", "令牌总数", "请求总数"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const count of [8123456, 1000000, 9123456]) {
      expect(screen.getByTitle(`${count.toLocaleString("zh-CN")} 个令牌`)).toBeInTheDocument();
    }
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbidden);
    expect(container).not.toHaveTextContent("501.74");
  });

  it("展开明细后保留精确令牌数，说明中也不包含费用信息", async () => {
    const user = userEvent.setup();
    render(<UsageStatStrip {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: "查看令牌明细" }));
    const breakdown = await screen.findByRole("dialog", { name: "令牌明细" });
    expect(breakdown).toHaveTextContent(/输入令牌\s*8,123,456/);
    expect(breakdown).toHaveTextContent(/缓存读取\s*5,123,456/);
    expect(breakdown).toHaveTextContent(/缓存写入\s*2,000,000/);
    expect(breakdown).toHaveTextContent(/输出令牌\s*1,000,000/);
    expect(breakdown).toHaveTextContent(/令牌总数\s*9,123,456/);
    expect(breakdown).not.toHaveTextContent(forbidden);
  });

  it("加载期间不把旧数据或空值显示为已完成统计", () => {
    const { container } = render(<UsageStatStrip {...defaultProps} loading requestCountsPending />);
    expect(screen.queryByRole("button", { name: "查看令牌明细" })).not.toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(screen.queryByTitle("9,123,456 个令牌")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbidden);
  });

  it("零用量也不渲染费用或预算空态", () => {
    const zero = Object.fromEntries(Object.keys(totals).map(key => [key, 0])) as unknown as OverviewTotals;
    const { container } = render(<UsageStatStrip {...defaultProps} totals={zero} />);
    expect(screen.getAllByTitle("0 个令牌")).toHaveLength(3);
    expect(container).not.toHaveTextContent(forbidden);
  });
});
