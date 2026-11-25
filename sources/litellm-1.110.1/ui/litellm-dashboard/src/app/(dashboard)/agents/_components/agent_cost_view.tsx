import React from "react";
import { useTranslation } from "react-i18next";
import { Agent } from "@/components/agents/types";

interface AgentCostViewProps {
  agent: Agent;
}

const AgentCostView: React.FC<AgentCostViewProps> = ({ agent }) => {
  const { t } = useTranslation();
  const params = agent.litellm_params;

  if (params?.cost_per_query == null && params?.input_cost_per_token == null && params?.output_cost_per_token == null) {
    return null;
  }

  const rows = (
    [
      [t("agents.costView.costPerQuery"), params.cost_per_query],
      [t("agents.costView.inputCostPerToken"), params.input_cost_per_token],
      [t("agents.costView.outputCostPerToken"), params.output_cost_per_token],
    ] as const
  ).filter(([, value]) => value != null);

  return (
    <span hidden aria-hidden="true" />
  );
};

export default AgentCostView;
