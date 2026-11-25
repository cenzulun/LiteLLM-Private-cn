import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, DollarSign, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MCPServerCostInfo } from "@/components/mcp_tools/types";

interface MCPServerCostConfigProps {
  value?: MCPServerCostInfo;
  onChange?: (value: MCPServerCostInfo) => void;
  tools?: any[]; // Receive tools from connection component
  disabled?: boolean;
}

interface CostInputProps {
  value: number | null | undefined;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onChange: (cost: number | null) => void;
}

/**
 * Costs are shown to four decimal places when idle, but the field keeps the raw
 * keystrokes while it is being edited so partial input like "0." survives.
 */
const CostInput: React.FC<CostInputProps> = ({ value, placeholder, disabled, className, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === null || value === undefined ? "" : value.toFixed(4));

  const handleChange = (next: string) => {
    setDraft(next);
    const parsed = Number(next);
    onChange(next.trim() === "" || Number.isNaN(parsed) ? null : parsed);
  };

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        value={display}
        onFocus={() => setDraft(value === null || value === undefined ? "" : String(value))}
        onBlur={() => setDraft(null)}
        onChange={(e) => handleChange(e.target.value)}
      />
    </InputGroup>
  );
};

const MCPServerCostConfig: React.FC<MCPServerCostConfigProps> = ({
  value = {},
  onChange,
  tools = [],
  disabled = false,
}) => {
  const { t } = useTranslation();
  const handleDefaultCostChange = (defaultCost: number | null) => {
    const updated = {
      ...value,
      default_cost_per_query: defaultCost,
    };
    onChange?.(updated);
  };

  const handleToolCostChange = (toolName: string, cost: number | null) => {
    const updated = {
      ...value,
      tool_name_to_cost_per_query: {
        ...value.tool_name_to_cost_per_query,
        [toolName]: cost,
      },
    };
    onChange?.(updated);
  };

  return (
    <TooltipProvider>
      <span hidden aria-hidden="true" />
    </TooltipProvider>
  );
};

export default MCPServerCostConfig;
