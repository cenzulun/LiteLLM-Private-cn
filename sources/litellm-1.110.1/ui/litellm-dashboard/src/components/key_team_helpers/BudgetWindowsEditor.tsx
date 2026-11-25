import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import React from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";

export interface BudgetWindowEntry {
  budget_duration: string;
  max_budget: number | null;
}

export const BUDGET_WINDOW_OPTIONS: readonly { value: string; labelKey: ParseKeys; resetHintKey: ParseKeys }[] = [
  {
    value: "1h",
    labelKey: "keyTeamHelpers.budgetWindowsEditor.options.hourly.label",
    resetHintKey: "keyTeamHelpers.budgetWindowsEditor.options.hourly.resetHint",
  },
  {
    value: "24h",
    labelKey: "keyTeamHelpers.budgetWindowsEditor.options.daily.label",
    resetHintKey: "keyTeamHelpers.budgetWindowsEditor.options.daily.resetHint",
  },
  {
    value: "7d",
    labelKey: "keyTeamHelpers.budgetWindowsEditor.options.weekly.label",
    resetHintKey: "keyTeamHelpers.budgetWindowsEditor.options.weekly.resetHint",
  },
  {
    value: "30d",
    labelKey: "keyTeamHelpers.budgetWindowsEditor.options.monthly.label",
    resetHintKey: "keyTeamHelpers.budgetWindowsEditor.options.monthly.resetHint",
  },
];

interface BudgetWindowsEditorProps {
  value: BudgetWindowEntry[];
  onChange: (v: BudgetWindowEntry[]) => void;
}

export function BudgetWindowsEditor({ value, onChange }: BudgetWindowsEditorProps) {
  const { t } = useTranslation();
  const windowItems = BUDGET_WINDOW_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
  const addWindow = () => {
    onChange([...value, { budget_duration: "24h", max_budget: null }]);
  };

  const removeWindow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateWindow = (idx: number, field: keyof BudgetWindowEntry, fieldValue: string | number | null) => {
    const updated = value.map((w, i) => (i === idx ? { ...w, [field]: fieldValue } : w));
    onChange(updated);
  };

  return (
    <span hidden aria-hidden="true" />
  );
}
