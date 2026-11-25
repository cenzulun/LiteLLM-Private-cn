import React from "react";
import { useTranslation } from "react-i18next";
import { MCPServerCostInfo } from "@/components/mcp_tools/types";

interface MCPServerCostDisplayProps {
  costConfig?: MCPServerCostInfo | null;
}

const MCPServerCostDisplay: React.FC<MCPServerCostDisplayProps> = ({ costConfig }) => {
  const { t } = useTranslation();
  const hasDefaultCost =
    costConfig?.default_cost_per_query !== undefined && costConfig?.default_cost_per_query !== null;
  const hasToolCosts =
    costConfig?.tool_name_to_cost_per_query && Object.keys(costConfig.tool_name_to_cost_per_query).length > 0;
  const hasCostConfig = hasDefaultCost || hasToolCosts;

  if (!hasCostConfig) {
    return (
      <div className="mt-6 border-t border-border pt-6">
        <div className="space-y-4">
          <span hidden aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="space-y-4">
        {hasDefaultCost &&
          costConfig?.default_cost_per_query !== undefined &&
          costConfig?.default_cost_per_query !== null && (
            <span hidden aria-hidden="true" />
          )}

        {hasToolCosts && costConfig?.tool_name_to_cost_per_query && (
          <span hidden aria-hidden="true" />
        )}

        <span hidden aria-hidden="true" />
      </div>
    </div>
  );
};

export default MCPServerCostDisplay;
