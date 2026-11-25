"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AreaChart, BarChart, CustomLegend, DonutChart, SEQUENTIAL_COLOR_RAMP } from "@/components/shared/charts";
import AdvancedDatePicker from "@/components/shared/advanced_date_picker";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useCan from "@/app/(dashboard)/hooks/useCan";
import { getToolSpend, ToolSpendResponse } from "@/components/networking";
import {
  buildDailyToolSeries,
  formatRangeLabel,
  localIsoDay,
  MAX_POINTS_WITH_DOTS,
  SAVINGS_COLORS,
  SAVINGS_DRIVERS,
  SAVINGS_SERIES,
  SavingsAccumulation,
  SavingsPoint,
  savingsSeriesOf,
  shortDate,
  sumOverDays,
  toCumulative,
  topToolsBySpend,
  usd,
  withStartAnchor,
} from "./costOptimizationUtils";
import SavingsTiles from "@/components/shared/SavingsTiles";
import { DailyActivityRange } from "./useDailyActivityRange";

interface UsageTabProps {
  accessToken: string | null;
  activity: DailyActivityRange;
}

const EMPTY_TOOL_SPEND: ToolSpendResponse = {
  by_tool: [],
  daily: [],
  start_date: null,
  end_date: null,
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const UsageTab: React.FC<UsageTabProps> = ({ accessToken, activity }) => {
  const { t } = useTranslation();
  const { dateValue, onDateChange, results, loading } = activity;

  const startTime = dateValue.from ?? null;
  const endTime = dateValue.to ?? null;

  const canViewProxyWideCostData = useCan("viewProxyWideCostData");
  const toolSpendEnabled = canViewProxyWideCostData && !!accessToken && !!startTime && !!endTime;
  const rangeKey = startTime && endTime ? `${isoDay(startTime)}|${isoDay(endTime)}` : "";
  const [toolSpendState, setToolSpendState] = useState<{ key: string; data: ToolSpendResponse } | null>(null);

  useEffect(() => {
    if (!canViewProxyWideCostData || !accessToken || !startTime || !endTime) return;
    let cancelled = false;
    getToolSpend(accessToken, isoDay(startTime), isoDay(endTime))
      .then((res) => {
        if (!cancelled) setToolSpendState({ key: rangeKey, data: res });
      })
      .catch(() => {
        if (!cancelled) setToolSpendState({ key: rangeKey, data: EMPTY_TOOL_SPEND });
      });
    return () => {
      cancelled = true;
    };
  }, [canViewProxyWideCostData, accessToken, startTime, endTime, rangeKey]);

  const toolSpend = toolSpendState?.key === rangeKey ? toolSpendState.data : null;
  const toolSpendLoading = toolSpendEnabled && toolSpend === null;

  const [accumulation, setAccumulation] = useState<SavingsAccumulation>("cumulative");

  const perInterval = useMemo<SavingsPoint[]>(() => savingsSeriesOf(results), [results]);

  // Cumulative anchors on a synthetic $0 point at the range start so a short
  // range (down to a single day) rises from zero instead of floating as one dot.
  const overTime = useMemo(() => {
    if (accumulation !== "cumulative") return perInterval;
    const startLabel = startTime ? shortDate(localIsoDay(startTime)) : "";
    return withStartAnchor(toCumulative(perInterval), startLabel);
  }, [accumulation, perInterval, startTime]);

  const intervalLabel = t("costOptimization.usage.perDay");
  const rangeLabel = formatRangeLabel(startTime ?? undefined, endTime ?? undefined);
  const savingsSubtitle = [
    accumulation === "cumulative"
      ? t("costOptimization.usage.savings.runningTotal")
      : t("costOptimization.usage.savings.savedPerInterval", { interval: intervalLabel.toLowerCase() }),
    rangeLabel && t("costOptimization.usage.savings.rangeUtc", { range: rangeLabel }),
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  // A driver can come out negative (auto-router pays a cold-cache write on every
  // model switch), and a negative slice has no meaning in a donut, so only drivers
  // that actually saved are plotted; the range total keeps the signed truth.
  const byDriver = useMemo(
    () =>
      SAVINGS_DRIVERS.map(({ name, color, of }) => ({
        driver: name,
        color,
        usd: sumOverDays(results, of),
      })).filter((d) => d.usd > 0),
    [results],
  );
  const plottedDriverTotal = useMemo(() => byDriver.reduce((sum, d) => sum + d.usd, 0), [byDriver]);

  const topTools = useMemo(() => topToolsBySpend(toolSpend?.by_tool ?? []), [toolSpend]);
  const topToolNames = useMemo(() => topTools.map((t) => t.tool_name), [topTools]);
  const topToolsChart = useMemo<Record<string, string | number>[]>(
    () => topTools.map((t) => ({ tool_name: t.tool_name, spend: t.spend })),
    [topTools],
  );
  const dailyToolSeries = useMemo(
    () =>
      buildDailyToolSeries(toolSpend?.daily ?? [], topToolNames).map((point) => ({
        ...point,
        date: shortDate(String(point.date)),
      })),
    [toolSpend, topToolNames],
  );
  const toolColors = useMemo(() => SEQUENTIAL_COLOR_RAMP.slice(0, Math.max(topToolNames.length, 1)), [topToolNames]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <span className="text-sm text-muted-foreground">{t("costOptimization.usage.bucketedByUtcDay")}</span>
        <AdvancedDatePicker value={dateValue} onValueChange={onDateChange} />
      </div>

      <SavingsTiles results={results} isLoading={loading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <span hidden aria-hidden="true" />
        <span hidden aria-hidden="true" />
      </div>

      {canViewProxyWideCostData && (
        <span hidden aria-hidden="true" />
      )}
    </div>
  );
};

export default UsageTab;
