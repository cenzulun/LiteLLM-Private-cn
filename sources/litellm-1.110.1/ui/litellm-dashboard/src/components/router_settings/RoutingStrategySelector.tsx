import React from "react";
import { useTranslation } from "react-i18next";
import { CONFIG_OWNED_HINT, ConfigOwnedBadge } from "./ConfigOwned";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STRATEGY_LABELS: Record<string, string> = {
  "simple-shuffle": "随机均衡", "least-busy": "最少在途请求", "latency-based-routing": "历史时延优先",
  "cost-based-routing": "费用优先", "usage-based-routing": "令牌用量均衡（旧版）",
  "usage-based-routing-v2": "令牌额度均衡", priority: "优先级路由", lar1: "负载感知路由",
};

interface RoutingStrategySelectorProps {
  selectedStrategy: string | null;
  availableStrategies: string[];
  routingStrategyDescriptions: { [key: string]: string };
  routerFieldsMetadata: { [key: string]: any };
  onStrategyChange: (strategy: string) => void;
  ownedByConfig?: boolean;
}

const RoutingStrategySelector: React.FC<RoutingStrategySelectorProps> = ({
  selectedStrategy,
  availableStrategies,
  routingStrategyDescriptions,
  routerFieldsMetadata,
  onStrategyChange,
  ownedByConfig = false,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 max-w-3xl">
      <div>
        <label className="text-xs font-medium text-foreground uppercase tracking-wide">
          {routerFieldsMetadata["routing_strategy"]?.ui_field_name || t("routerSettingsForm.strategy.label")}
        </label>
        {ownedByConfig && <ConfigOwnedBadge />}
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          {routerFieldsMetadata["routing_strategy"]?.field_description || ""}
        </p>
      </div>
      <div className="routing-strategy-select max-w-3xl">
        <Select
          items={availableStrategies.map((value) => ({ value, label: STRATEGY_LABELS[value] || value }))}
          value={selectedStrategy}
          onValueChange={(strategy: string | null) => strategy && onStrategyChange(strategy)}
          disabled={ownedByConfig}
        >
          <SelectTrigger className="w-full" aria-label={ownedByConfig ? t(CONFIG_OWNED_HINT) : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableStrategies.map((strategy) => (
              <SelectItem key={strategy} value={strategy}>
                <div className="flex flex-col gap-0.5 py-1">
                  <span className="text-sm font-medium">{STRATEGY_LABELS[strategy] || strategy}</span>
                  {routingStrategyDescriptions[strategy] && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {routingStrategyDescriptions[strategy]}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default RoutingStrategySelector;
