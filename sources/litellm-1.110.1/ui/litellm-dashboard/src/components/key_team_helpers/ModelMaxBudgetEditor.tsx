import { SearchSelect } from "@/components/shared/SearchSelect";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import i18n from "@/i18n/i18n";
import { Plus, X } from "lucide-react";
import React, { useState } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";

export interface ModelBudgetConfig {
  budget_limit: number;
  time_period: string;
  /** BudgetConfig also carries tpm_limit and rpm_limit, which this editor does not model. */
  [passthrough: string]: unknown;
}

export type ModelMaxBudget = Record<string, ModelBudgetConfig>;

export interface ModelBudgetUsage {
  current_spend: number;
  budget_limit: number | null;
  time_period: string | null;
}

interface ModelBudgetEntry {
  id: string;
  model: string | null;
  budgetLimit: number | null;
  timePeriod: string;
  extra: Readonly<Record<string, unknown>>;
}

// BudgetConfig aliases budget_limit onto max_budget and time_period onto
// budget_duration, and the proxy stores whichever spelling the client sent.
const MODELLED_FIELDS: readonly string[] = ["budget_limit", "time_period", "max_budget", "budget_duration"];

const readNumber = (raw: unknown): number | null => {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const readPeriod = (raw: unknown): string | null => (typeof raw === "string" && raw !== "" ? raw : null);

export const MODEL_BUDGET_PERIOD_OPTIONS: readonly { value: string; labelKey: ParseKeys }[] = [
  { value: "1h", labelKey: "keyTeamHelpers.modelMaxBudgetEditor.periods.hourly" },
  { value: "24h", labelKey: "keyTeamHelpers.modelMaxBudgetEditor.periods.daily" },
  { value: "7d", labelKey: "keyTeamHelpers.modelMaxBudgetEditor.periods.weekly" },
  { value: "30d", labelKey: "keyTeamHelpers.modelMaxBudgetEditor.periods.monthly" },
  { value: "1mo", labelKey: "keyTeamHelpers.modelMaxBudgetEditor.periods.calendarMonth" },
];

const DEFAULT_PERIOD = "30d";

const MODEL_PATTERN_VALUE = {
  hintKey: "keyTeamHelpers.modelMaxBudgetEditor.modelPattern" as ParseKeys,
  accepts: (typed: string) => typed.includes("*"),
};

export const entriesToModelMaxBudget = (entries: readonly ModelBudgetEntry[]): ModelMaxBudget =>
  Object.fromEntries(
    entries
      .filter(
        (entry): entry is ModelBudgetEntry & { model: string; budgetLimit: number } =>
          entry.model !== null && entry.budgetLimit !== null,
      )
      .map((entry) => [
        entry.model,
        { ...entry.extra, budget_limit: entry.budgetLimit, time_period: entry.timePeriod },
      ]),
  );

export const modelMaxBudgetToEntries = (budget: ModelMaxBudget | null | undefined): ModelBudgetEntry[] =>
  Object.entries(budget ?? {}).map(([model, config], index) => ({
    id: `existing-${index}`,
    model,
    budgetLimit: readNumber(config?.budget_limit) ?? readNumber(config?.max_budget),
    timePeriod: readPeriod(config?.time_period) ?? readPeriod(config?.budget_duration) ?? DEFAULT_PERIOD,
    extra: Object.fromEntries(Object.entries(config ?? {}).filter(([field]) => !MODELLED_FIELDS.includes(field))),
  }));

export const MODEL_MAX_BUDGET_PREMIUM_HINT: ParseKeys = "keyTeamHelpers.modelMaxBudgetEditor.premiumHint";

interface ModelMaxBudgetEditorProps {
  value: ModelMaxBudget;
  onChange: (value: ModelMaxBudget) => void;
  availableModels: string[];
  /** The proxy rejects a populated model_max_budget without an enterprise license. */
  premiumUser: boolean;
  usage?: Record<string, ModelBudgetUsage> | null;
}

export function ModelMaxBudgetEditor({
  value,
  onChange,
  availableModels,
  premiumUser,
  usage,
}: ModelMaxBudgetEditorProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ModelBudgetEntry[]>(() => modelMaxBudgetToEntries(value));

  const incoming = JSON.stringify(value ?? {});
  const [syncedValue, setSyncedValue] = useState(incoming);
  if (incoming !== syncedValue) {
    setSyncedValue(incoming);
    if (incoming !== JSON.stringify(entriesToModelMaxBudget(entries))) setEntries(modelMaxBudgetToEntries(value));
  }

  const emitChange = (updated: ModelBudgetEntry[]) => {
    setEntries(updated);
    onChange(entriesToModelMaxBudget(updated));
  };

  const addEntry = () =>
    emitChange([
      ...entries,
      { id: Date.now().toString(), model: null, budgetLimit: null, timePeriod: DEFAULT_PERIOD, extra: {} },
    ]);

  const removeEntry = (id: string) => emitChange(entries.filter((entry) => entry.id !== id));

  const updateEntry = (id: string, patch: Partial<ModelBudgetEntry>) =>
    emitChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  const usedModels = new Set(entries.map((entry) => entry.model).filter(Boolean));
  const hintWhenLocked = premiumUser ? undefined : t(MODEL_MAX_BUDGET_PREMIUM_HINT);
  const periodItems = MODEL_BUDGET_PERIOD_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
  const modelPatternValue = { hint: t(MODEL_PATTERN_VALUE.hintKey), accepts: MODEL_PATTERN_VALUE.accepts };

  const blurb = (
    <span hidden aria-hidden="true" />
  );

  if (entries.length === 0) {
    return (
      <span hidden aria-hidden="true" />
    );
  }

  return (
    <span hidden aria-hidden="true" />
  );
}

interface ModelMaxBudgetFieldProps extends ModelMaxBudgetEditorProps {
  hint: string;
  label?: string;
}

/** The editor with its label, so every form that offers it presents it the same way. */
export function ModelMaxBudgetField({
  hint,
  label = i18n.t("keyTeamHelpers.modelMaxBudgetEditor.fieldLabel"),
  ...editorProps
}: ModelMaxBudgetFieldProps) {
  return (
    <Field>
      <FieldLabel>
        <span title={hint}>{label}</span>
      </FieldLabel>
      <ModelMaxBudgetEditor {...editorProps} />
    </Field>
  );
}
