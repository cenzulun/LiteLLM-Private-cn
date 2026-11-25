"use client";

import { useTranslation } from "react-i18next";

import { Meter, MeterIndicator, MeterTrack } from "@/components/shared/Meter";
import { getSpendBudgetMeterTone } from "@/components/shared/table_cells/spend_budget_cell";
import type { components } from "@/lib/http/schema";
import { formatBudgetResetUtc } from "@/utils/budgetUtils";
import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";

type CallerMembership = components["schemas"]["TeamListCallerMembership"];

interface TeamMemberSpendBudgetCellProps {
  teamSpend: number | null | undefined;
  teamMaxBudget: number | null | undefined;
  callerMembership?: CallerMembership | null;
}

interface BudgetLineProps {
  label: string;
  spend: number | null | undefined;
  maxBudget: number | null | undefined;
  resetAt?: string | null;
}

function BudgetLine({ label, spend, maxBudget, resetAt }: BudgetLineProps) {
  const { t } = useTranslation();
  const spendValue = typeof spend === "number" && Number.isFinite(spend) ? spend : 0;
  const budget = typeof maxBudget === "number" && Number.isFinite(maxBudget) ? maxBudget : null;
  const spendText = spendValue === 0 ? "$0.00" : getSpendString(spendValue, 2);
  const budgetText =
    budget === null ? t("teams.memberSpendBudgetCell.unlimited") : `$${formatNumberWithCommas(budget, 2)}`;
  const resetText = formatBudgetResetUtc(resetAt);

  return (
    <span hidden aria-hidden="true" />
  );
}

export function TeamMemberSpendBudgetCell({
  teamSpend,
  teamMaxBudget,
  callerMembership,
}: TeamMemberSpendBudgetCellProps) {
  const { t } = useTranslation();
  return (
    <span hidden aria-hidden="true" />
  );
}
