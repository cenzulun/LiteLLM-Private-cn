import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Database,
  DatabaseBackup,
  DollarSign,
  Hash,
  History,
  Lightbulb,
  Wrench,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROMPT_CACHE_CREATION_TOOLTIP, PROMPT_CACHE_READ_TOOLTIP } from "@/utils/promptCacheUsage";

export interface TokenUsage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cost?: number;
  servedFromResponseCache?: boolean;
}

interface ResponseMetricsProps {
  timeToFirstToken?: number;
  totalLatency?: number;
  usage?: TokenUsage;
  toolName?: string;
}

interface MetricItemProps {
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  value: string;
}

function MetricItem({ label, tooltip, icon, value }: MetricItemProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex items-center gap-1" aria-label={`${label}: ${value}`} />}>
        {icon}
        <span>
          {label}: {value}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ResponseCacheIndicator() {
  const { t } = useTranslation();
  return (
    <MetricItem
      label={t("chatUi.responseMetrics.labels.responseCache")}
      tooltip={t("chatUi.responseMetrics.tooltips.responseCache")}
      icon={<History className="size-3" aria-hidden="true" />}
      value={t("chatUi.responseMetrics.labels.responseCacheHit")}
    />
  );
}

function PromptCacheChips({ usage }: { usage?: TokenUsage }) {
  const { t } = useTranslation();
  if (usage?.servedFromResponseCache) {
    return <ResponseCacheIndicator />;
  }

  const readTokens = usage?.cacheReadTokens ?? 0;
  const creationTokens = usage?.cacheCreationTokens ?? 0;

  return (
    <>
      {readTokens > 0 && (
        <MetricItem
          label={t("chatUi.responseMetrics.labels.cacheRead")}
          tooltip={t(PROMPT_CACHE_READ_TOOLTIP)}
          icon={<Database className="size-3" aria-hidden="true" />}
          value={String(readTokens)}
        />
      )}

      {creationTokens > 0 && (
        <MetricItem
          label={t("chatUi.responseMetrics.labels.cacheWrite")}
          tooltip={t(PROMPT_CACHE_CREATION_TOOLTIP)}
          icon={<DatabaseBackup className="size-3" aria-hidden="true" />}
          value={String(creationTokens)}
        />
      )}
    </>
  );
}

const ResponseMetrics: React.FC<ResponseMetricsProps> = ({ timeToFirstToken, totalLatency, usage, toolName }) => {
  const { t } = useTranslation();
  if (!timeToFirstToken && !totalLatency && !usage) return null;

  return (
    <span hidden aria-hidden="true" />
  );
};

export default ResponseMetrics;
