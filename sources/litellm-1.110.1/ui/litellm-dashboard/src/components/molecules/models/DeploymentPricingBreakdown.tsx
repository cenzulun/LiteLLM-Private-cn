import type * as React from "react";
import { useTranslation } from "react-i18next";

import { ProviderLogo } from "@/components/molecules/models/ProviderLogo";
import { getProviderLogoAndName } from "@/components/provider_info_helpers";
import { cn } from "@/lib/cva.config";
import {
  NUMERIC_CELL_CLASS,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  buildPricingTable,
  type DeploymentPricing,
  describePricingTier,
  formatTokenCount,
  type PriceGroup,
  SERVICE_TIER_LABELS,
  type ServiceTier,
} from "./deploymentPricing";

function PriceGroupRows({ group, tiers }: { group: PriceGroup; tiers: readonly ServiceTier[] }) {
  const { t } = useTranslation();
  const name =
    group.threshold === null
      ? t("deploymentPricing.basePrices")
      : t("deploymentPricing.aboveThreshold", { threshold: formatTokenCount(group.threshold) });
  return (
    <TableBody aria-label={name}>
      {group.threshold !== null && (
        <TableRow className="hover:bg-transparent">
          <TableHead colSpan={tiers.length + 1} scope="colgroup" className="h-8 text-xs text-muted-foreground">
            {name}
          </TableHead>
        </TableRow>
      )}
      {group.rows.map((row) => (
        <TableRow key={row.label}>
          <TableHead scope="row" className="font-normal">
            {row.label}
          </TableHead>
          {tiers.map((tier) => (
            <TableCell key={tier} className={NUMERIC_CELL_CLASS}>
              {row.prices[tier]}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

function DeploymentPrices({ deployment }: { deployment: DeploymentPricing }) {
  const { t } = useTranslation();
  const table = buildPricingTable(deployment.costs);
  const tiers = deployment.tiered_pricing;
  const providerName = getProviderLogoAndName(deployment.provider).displayName;
  return (
    <span hidden aria-hidden="true" />
  );
}

export function DeploymentPricingBreakdown({
  deployments,
  heading,
  className,
}: {
  deployments: readonly DeploymentPricing[] | null | undefined;
  heading?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!deployments || deployments.length === 0) return null;
  return (
    <span hidden aria-hidden="true" />
  );
}
