import React, { useId } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/shared/form/FormField";
import { Badge } from "@/components/ui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import i18n from "@/i18n/i18n";
import { useZodForm } from "@/lib/forms/useZodForm";

const budgetShape = {
  budget_id: z.string().min(1, { error: () => i18n.t("budgets.form.errors.budgetIdRequired") }),
  tpm_limit: z.number().nullish(),
  rpm_limit: z.number().nullish(),
  tpd_limit: z.number().nullish(),
  max_budget: z.number().nullish(),
  budget_duration: z.string().nullish(),
};

const budgetSchema = z.object(budgetShape);

export type BudgetFormValues = z.output<typeof budgetSchema>;

export const useBudgetForm = (defaultValues: z.input<typeof budgetSchema>) =>
  useZodForm(budgetSchema, { defaultValues });

type BudgetForm = ReturnType<typeof useBudgetForm>;
type NumberFieldName = "tpm_limit" | "rpm_limit" | "tpd_limit" | "max_budget";

const NO_RESET = "never";

const RESET_OPTIONS: readonly { value: string; labelKey: ParseKeys }[] = [
  { value: NO_RESET, labelKey: "budgets.form.resetOptions.inTotal" },
  { value: "24h", labelKey: "budgets.form.resetOptions.perDay" },
  { value: "7d", labelKey: "budgets.form.resetOptions.perWeek" },
  { value: "30d", labelKey: "budgets.form.resetOptions.perMonth" },
];

const numberProps = <T extends { value?: number | null; onChange: (value: number | null) => void }>({
  value,
  onChange,
  ...field
}: T) => ({
  ...field,
  type: "number",
  value: value ?? "",
  placeholder: i18n.t("budgets.form.noLimit"),
  onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.value === "" ? null : event.target.valueAsNumber),
});

const OptionalBadge = () => {
  const { t } = useTranslation();
  return <Badge variant="secondary">{t("budgets.form.optional")}</Badge>;
};

function SpendLimitField({ form }: { form: BudgetForm }) {
  const { t } = useTranslation();
  const amountId = useId();
  const resetItems = RESET_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
  return (
    <span hidden aria-hidden="true" />
  );
}

function RateLimitField({ form, name, label }: { form: BudgetForm; name: NumberFieldName; label: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      label={label}
      orientation="horizontal"
      className="justify-between *:data-[slot=field-label]:flex-none"
    >
      {(control) => <Input {...numberProps(control)} className="w-36" />}
    </FormField>
  );
}

export function BudgetFormFields({ form, isEditing }: { form: BudgetForm; isEditing: boolean }) {
  const { t } = useTranslation();
  return (
    <FieldGroup className="gap-4">
      <span hidden aria-hidden="true" />
      <SpendLimitField form={form} />
      <FieldSeparator />
      <FieldSet className="gap-3">
        <FieldLegend className="mb-4 flex items-center gap-2 text-[15px] leading-[22px] font-semibold">
          {t("budgets.form.rateLimits")}
          <OptionalBadge />
        </FieldLegend>
        <RateLimitField form={form} name="tpm_limit" label={t("budgets.form.tpmLimit")} />
        <RateLimitField form={form} name="rpm_limit" label={t("budgets.form.rpmLimit")} />
        <RateLimitField form={form} name="tpd_limit" label={t("budgets.form.tpdLimit")} />
        <FieldDescription>{t("budgets.form.batchNote")}</FieldDescription>
      </FieldSet>
    </FieldGroup>
  );
}
