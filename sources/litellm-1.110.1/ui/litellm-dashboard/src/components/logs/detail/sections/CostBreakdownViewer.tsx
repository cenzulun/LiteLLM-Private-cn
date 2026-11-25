import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumberWithCommas } from "@/utils/dataUtils";

export interface CostBreakdown {
  input_cost?: number;
  cache_read_cost?: number;
  cache_creation_cost?: number;
  output_cost?: number;
  total_cost?: number;
  tool_usage_cost?: number;
  additional_costs?: Record<string, number>;
  original_cost?: number;
  discount_percent?: number;
  discount_amount?: number;
  margin_percent?: number;
  margin_fixed_amount?: number;
  margin_total_amount?: number;
}

interface CostBreakdownViewerProps {
  costBreakdown: CostBreakdown | null | undefined;
  totalSpend: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheHit?: string;
  rawInputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

const formatCost = (cost: number | undefined): string => {
  if (cost === undefined || cost === null) return "-";
  return `$${formatNumberWithCommas(cost, 8)}`;
};

const formatPercent = (percent: number | undefined): string => {
  if (percent === undefined || percent === null) return "-";
  return `${(percent * 100).toFixed(2)}%`;
};

export const CostBreakdownViewer: React.FC<CostBreakdownViewerProps> = ({
  costBreakdown,
  totalSpend,
  promptTokens,
  completionTokens,
  cacheHit,
  rawInputTokens,
  cacheReadTokens,
  cacheCreationTokens,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isCached = cacheHit?.toLowerCase() === "true";
  const hasTokenCounts = promptTokens !== undefined || completionTokens !== undefined;

  const hasCostBreakdown = costBreakdown?.input_cost !== undefined || costBreakdown?.output_cost !== undefined;
  const hasAdditionalCosts =
    costBreakdown?.additional_costs &&
    Object.entries(costBreakdown.additional_costs).some(([, value]) => value != null && value !== 0);
  const hasMeaningfulData =
    hasCostBreakdown ||
    hasTokenCounts ||
    hasAdditionalCosts ||
    (costBreakdown &&
      ((costBreakdown.discount_percent !== undefined && costBreakdown.discount_percent !== 0) ||
        (costBreakdown.discount_amount !== undefined && costBreakdown.discount_amount !== 0) ||
        (costBreakdown.margin_percent !== undefined && costBreakdown.margin_percent !== 0) ||
        (costBreakdown.margin_fixed_amount !== undefined && costBreakdown.margin_fixed_amount !== 0) ||
        (costBreakdown.margin_total_amount !== undefined && costBreakdown.margin_total_amount !== 0)));

  if (!hasMeaningfulData) {
    return null;
  }

  const hasDiscount =
    costBreakdown &&
    ((costBreakdown.discount_percent !== undefined && costBreakdown.discount_percent !== 0) ||
      (costBreakdown.discount_amount !== undefined && costBreakdown.discount_amount !== 0));

  const hasMargin =
    costBreakdown &&
    ((costBreakdown.margin_percent !== undefined && costBreakdown.margin_percent !== 0) ||
      (costBreakdown.margin_fixed_amount !== undefined && costBreakdown.margin_fixed_amount !== 0) ||
      (costBreakdown.margin_total_amount !== undefined && costBreakdown.margin_total_amount !== 0));

  // When cached, show $0 (authoritative total) instead of pre-cache costs from cost_breakdown
  const inputCost = isCached ? 0 : costBreakdown?.input_cost;
  const outputCost = isCached ? 0 : costBreakdown?.output_cost;
  const originalCost = isCached ? 0 : costBreakdown?.original_cost;
  const totalCost = isCached ? 0 : costBreakdown?.total_cost ?? totalSpend;

  return (
    <div className="bg-card rounded-lg shadow-sm w-full max-w-full overflow-hidden mb-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left">
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span hidden aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-6 space-y-4">
            {/* Step 1: Base Token Costs */}
            <div className="space-y-2 max-w-2xl">
              {(() => {
                const hasCacheBreakdown =
                  costBreakdown?.cache_read_cost !== undefined || costBreakdown?.cache_creation_cost !== undefined;
                if (hasCacheBreakdown) {
                  // Separate line items: Input / Cache Read / Cache Write
                  const rawCost = isCached
                    ? 0
                    : (inputCost ?? 0) -
                      (costBreakdown?.cache_read_cost ?? 0) -
                      (costBreakdown?.cache_creation_cost ?? 0);
                  return (
                    <>
                      <span hidden aria-hidden="true" />
                      {(costBreakdown?.cache_read_cost ?? 0) > 0 && (
                        <span hidden aria-hidden="true" />
                      )}
                      {(costBreakdown?.cache_creation_cost ?? 0) > 0 && (
                        <span hidden aria-hidden="true" />
                      )}
                    </>
                  );
                }
                return (
                  <span hidden aria-hidden="true" />
                );
              })()}
              <span hidden aria-hidden="true" />
              {costBreakdown?.tool_usage_cost !== undefined && costBreakdown.tool_usage_cost > 0 && (
                <span hidden aria-hidden="true" />
              )}
              {costBreakdown?.additional_costs &&
                Object.entries(costBreakdown.additional_costs)
                  .filter(([, value]) => value != null && value !== 0)
                  .map(([key, value]) => (
                    <div key={key} className="flex text-sm">
                      <span className="text-muted-foreground font-medium w-1/3">{key}:</span>
                      <span className="text-foreground">{formatCost(value)}</span>
                    </div>
                  ))}
            </div>

            {/* Subtotal / Original Cost - hide when cached since it would be $0 */}
            {!isCached && (
              <div className="pt-2 border-t border-border max-w-2xl">
                <span hidden aria-hidden="true" />
              </div>
            )}

            {/* Step 2: Adjustments (Discount & Margin) */}
            {(hasDiscount || hasMargin) && (
              <div className="pt-2 space-y-2 max-w-2xl">
                {/* Discounts */}
                {hasDiscount && (
                  <div className="space-y-2">
                    {costBreakdown.discount_percent !== undefined && costBreakdown.discount_percent !== 0 && (
                      <span hidden aria-hidden="true" />
                    )}
                    {costBreakdown.discount_amount !== undefined && costBreakdown.discount_percent === undefined && (
                      <span hidden aria-hidden="true" />
                    )}
                  </div>
                )}

                {/* Margins */}
                {hasMargin && (
                  <div className="space-y-2">
                    {costBreakdown.margin_percent !== undefined && costBreakdown.margin_percent !== 0 && (
                      <span hidden aria-hidden="true" />
                    )}
                    {costBreakdown.margin_fixed_amount !== undefined && costBreakdown.margin_fixed_amount !== 0 && (
                      <span hidden aria-hidden="true" />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Final Summary */}
            <div className="mt-4 pt-4 border-t border-border max-w-2xl">
              <span hidden aria-hidden="true" />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default CostBreakdownViewer;
