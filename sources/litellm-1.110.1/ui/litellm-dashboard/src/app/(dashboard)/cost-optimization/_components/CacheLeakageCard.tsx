"use client";

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import {
  CacheLeakageDimension,
  CacheLeakageRow,
  computeCacheLeakage,
  leakageRowsFromKeyRows,
  netSavingsPerCachedToken,
  pct,
  usd,
} from "./costOptimizationUtils";
import { DailyActivityRange } from "./useDailyActivityRange";
import { useCacheLeakageKeys } from "./useCacheLeakageKeys";

interface CacheLeakageCardProps {
  activity: DailyActivityRange;
}

type SortColumn = "uncachedPromptTokens" | "cacheHitRatio" | "potentialSavings";
interface SortState {
  column: SortColumn;
  dir: "asc" | "desc";
}

const NATURAL_DIR: Record<SortColumn, "asc" | "desc"> = {
  uncachedPromptTokens: "desc",
  cacheHitRatio: "asc",
  potentialSavings: "desc",
};

const compareRows = (a: CacheLeakageRow, b: CacheLeakageRow, sort: SortState): number => {
  const av = a[sort.column];
  const bv = b[sort.column];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return sort.dir === "asc" ? av - bv : bv - av;
};

const InfoTooltip = ({ info }: { info: string }) => (
  <Tooltip>
    <TooltipTrigger render={<span className="inline-flex" aria-label={info} />}>
      <Info className="h-3 w-3 text-muted-foreground" />
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">{info}</TooltipContent>
  </Tooltip>
);

const SortableHead = ({
  column,
  label,
  info,
  sort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  info: string;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) => {
  const { t } = useTranslation();
  const active = sort.column === column;
  const ActiveArrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  const Arrow = active ? ActiveArrow : ArrowUpDown;
  return (
    <TableHead className="text-right">
      <span className="inline-flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => onSort(column)}
          aria-label={t("costOptimization.cacheLeakage.sortBy", { label })}
          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
        >
          {label}
          <Arrow className={`h-3 w-3 ${active ? "text-foreground" : "text-muted-foreground"}`} />
        </button>
        <InfoTooltip info={info} />
      </span>
    </TableHead>
  );
};

const CacheLeakageCard: React.FC<CacheLeakageCardProps> = ({ activity }) => {
  const { t } = useTranslation();
  const { results, loading } = activity;
  const [dimension, setDimension] = useState<CacheLeakageDimension>("key");
  const [sort, setSort] = useState<SortState>({ column: "potentialSavings", dir: "desc" });
  const leakageRate = useMemo(() => netSavingsPerCachedToken(results), [results]);
  const keyLeakage = useCacheLeakageKeys(activity, dimension === "key");
  const unsortedRows = useMemo(
    () =>
      dimension === "key"
        ? leakageRowsFromKeyRows(keyLeakage.rows, leakageRate)
        : computeCacheLeakage(results, "model").rows,
    [dimension, keyLeakage.rows, leakageRate, results],
  );
  const rows = useMemo(() => [...unsortedRows].sort((a, b) => compareRows(a, b, sort)), [unsortedRows, sort]);
  const rowsLoading = dimension === "key" ? keyLeakage.loading : loading;

  const onSort = (column: SortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: NATURAL_DIR[column] },
    );

  const subject =
    dimension === "model"
      ? t("costOptimization.cacheLeakage.subjects.models")
      : t("costOptimization.cacheLeakage.subjects.keys");
  const firstColumn =
    dimension === "model"
      ? t("costOptimization.cacheLeakage.columns.model")
      : t("costOptimization.cacheLeakage.columns.key");
  const emptyNoun =
    dimension === "model"
      ? t("costOptimization.cacheLeakage.nouns.model")
      : t("costOptimization.cacheLeakage.nouns.key");
  const emptyMessage =
    dimension === "key" && keyLeakage.failed
      ? t("costOptimization.cacheLeakage.keyLoadFailed")
      : t("costOptimization.cacheLeakage.empty", { noun: emptyNoun });

  return (
    <TooltipProvider delay={300}>
      <span hidden aria-hidden="true" />
    </TooltipProvider>
  );
};

export default CacheLeakageCard;
