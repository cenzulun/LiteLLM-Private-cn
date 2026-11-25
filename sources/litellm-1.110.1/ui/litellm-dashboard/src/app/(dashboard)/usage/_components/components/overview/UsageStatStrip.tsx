"use client";

import React, { useMemo } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { DailyData } from "@/components/UsagePage/types";
import { cn } from "@/lib/cva.config";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { dailyTotals, type OverviewTotals } from "./overviewData";
import { PANEL_INSET_X, Sparkline, Stat } from "./Primitives";

const BRAND = "#2b3fd6";

interface UsageStatStripProps {
  results: readonly DailyData[];
  totals: OverviewTotals;
  loading: boolean;
  requestCountsPending: boolean;
}

/** Input/output tokens, total tokens and requests for a range. */
export default function UsageStatStrip({
  results,
  totals,
  loading,
  requestCountsPending,
}: UsageStatStripProps) {
  const { t } = useTranslation();
  const daily = useMemo(() => dailyTotals(results), [results]);
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
      <StatCell trend={<Sparkline data={daily} dataKey="inputTokens" color={BRAND} className="h-14" />}>
        <Stat
          label={t("usage.statStrip.inputTokens")}
          value={loading ? null : t("format.compactNumber", { val: totals.inputTokens })}
          pending={loading}
          exact={t("usage.statStrip.exactTokens", { tokens: t("format.number", { val: totals.inputTokens }) })}
        />
      </StatCell>
      <StatCell trend={<Sparkline data={daily} dataKey="requests" color={BRAND} className="h-14" />}>
        <Stat
          label={t("usage.statStrip.totalRequests")}
          value={t("format.number", { val: totals.requests })}
          pending={requestCountsPending}
        />
        {!requestCountsPending && (
          <div className="mt-0.5 flex gap-3 text-xs leading-4 text-muted-foreground">
            <span>
              <Trans
                i18nKey="usage.statStrip.successfulCount"
                components={{
                  count: (
                    <span className="text-success tabular-nums">{t("format.number", { val: totals.successful })}</span>
                  ),
                }}
              />
            </span>
            <span>
              <Trans
                i18nKey="usage.statStrip.failedCount"
                components={{
                  count: (
                    <span className={totals.failed > 0 ? "text-destructive tabular-nums" : "tabular-nums"}>
                      {t("format.number", { val: totals.failed })}
                    </span>
                  ),
                }}
              />
            </span>
          </div>
        )}
      </StatCell>
      <StatCell trend={<Sparkline data={daily} dataKey="tokens" color={BRAND} className="h-14" />}>
        <Stat
          label={t("usage.statStrip.totalTokens")}
          value={loading ? null : t("format.compactNumber", { val: totals.tokens })}
          exact={t("usage.statStrip.exactTokens", { tokens: t("format.number", { val: totals.tokens }) })}
          pending={loading}
          hint={
            loading
              ? undefined
              : t("usage.statStrip.cacheReadHint", {
                  tokens: t("format.compactNumber", { val: totals.cacheReadTokens }),
                })
          }
        />
        {!loading && (
          <Popover>
            <PopoverTrigger className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
              {t("usage.statStrip.viewTokenBreakdown")}
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-80 gap-3">
              <PopoverTitle>{t("usage.statStrip.tokenPopover.title")}</PopoverTitle>
              <dl className="space-y-2 text-sm tabular-nums">
                <div className="flex justify-between gap-4">
                  <dt>{t("usage.statStrip.tokenPopover.inputTokens")}</dt>
                  <dd>{t("format.number", { val: totals.inputTokens })}</dd>
                </div>
                <div className="flex justify-between gap-4 pl-3 text-xs text-muted-foreground">
                  <dt>{t("usage.statStrip.tokenPopover.cacheReads")}</dt>
                  <dd>{t("format.number", { val: totals.cacheReadTokens })}</dd>
                </div>
                <div className="flex justify-between gap-4 pl-3 text-xs text-muted-foreground">
                  <dt>{t("usage.statStrip.tokenPopover.cacheWrites")}</dt>
                  <dd>{t("format.number", { val: totals.cacheWriteTokens })}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>{t("usage.statStrip.tokenPopover.outputTokens")}</dt>
                  <dd>{t("format.number", { val: totals.outputTokens })}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                  <dt>{t("usage.statStrip.tokenPopover.totalTokens")}</dt>
                  <dd>{t("format.number", { val: totals.tokens })}</dd>
                </div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">{t("usage.statStrip.tokenPopover.clientNote")}</p>
            </PopoverContent>
          </Popover>
        )}
      </StatCell>
      <StatCell trend={<Sparkline data={daily} dataKey="outputTokens" color={BRAND} className="h-14" />}>
        <Stat
          label={t("usage.statStrip.outputTokens")}
          value={loading ? null : t("format.compactNumber", { val: totals.outputTokens })}
          exact={t("usage.statStrip.exactTokens", { tokens: t("format.number", { val: totals.outputTokens }) })}
          pending={loading}
        />
      </StatCell>
    </div>
  );
}

function StatCell({ children, trend }: { children: React.ReactNode; trend?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between gap-3 border-b py-4 last:border-b-0 lg:border-b-0",
        PANEL_INSET_X,
      )}
    >
      <div className="min-w-0">{children}</div>
      {trend}
    </div>
  );
}
