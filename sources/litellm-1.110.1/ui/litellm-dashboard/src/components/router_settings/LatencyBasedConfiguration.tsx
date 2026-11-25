import React from "react";
import { useTranslation } from "react-i18next";
import { CONFIG_OWNED_HINT, ConfigOwnedBadge } from "./ConfigOwned";
import { Input } from "@/components/ui/input";

interface routingStrategyArgs {
  ttl?: number;
  lowest_latency_buffer?: number;
}

const defaultLowestLatencyArgs: routingStrategyArgs = {
  ttl: 3600,
  lowest_latency_buffer: 0,
};

interface LatencyBasedConfigurationProps {
  routingStrategyArgs: { [key: string]: any };
  ownedByConfig?: boolean;
}

const LatencyBasedConfiguration: React.FC<LatencyBasedConfigurationProps> = ({
  routingStrategyArgs,
  ownedByConfig = false,
}) => {
  const { t } = useTranslation();
  const paramExplanation: { [key: string]: string } = {
    ttl: t("routerSettingsForm.latency.ttl"),
    lowest_latency_buffer: t("routerSettingsForm.latency.lowestLatencyBuffer"),
  };
  const paramLabels: Readonly<Record<string, string>> = {
    ttl: "历史样本窗口（秒）", lowest_latency_buffer: "时延容差比例",
    max_latency_list_size: "时延样本数量上限", ttft_percentile: "首令牌时延分位数",
  };

  return (
    <>
      <div className="space-y-6">
        <div className="max-w-3xl">
          <h3 className="text-sm font-medium text-foreground">
            {t("routerSettingsForm.latency.title")}
            {ownedByConfig && <ConfigOwnedBadge />}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">{t("routerSettingsForm.latency.description")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {Object.entries(routingStrategyArgs || defaultLowestLatencyArgs).map(([param, value]) => (
            <div key={param} className="space-y-2">
              <label className="block">
                <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                  {paramLabels[param] ?? "路由参数"}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{paramExplanation[param] || ""}</p>
                <Input
                  name={param}
                  defaultValue={typeof value === "object" ? JSON.stringify(value, null, 2) : value?.toString()}
                  disabled={ownedByConfig}
                  title={ownedByConfig ? t(CONFIG_OWNED_HINT) : undefined}
                  className="font-mono text-sm w-full"
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border" />
    </>
  );
};

export default LatencyBasedConfiguration;
