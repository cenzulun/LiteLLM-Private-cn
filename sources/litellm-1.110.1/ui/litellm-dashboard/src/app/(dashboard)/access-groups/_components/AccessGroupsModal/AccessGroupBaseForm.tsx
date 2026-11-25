"use client";

import { BotIcon, InfoIcon, LayersIcon, ServerIcon, SparklesIcon } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { useAgents } from "@/app/(dashboard)/hooks/agents/useAgents";
import { useMCPServers } from "@/app/(dashboard)/hooks/mcpServers/useMCPServers";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import MCPToolPermissions from "@/components/mcp_server_management/MCPToolPermissions";
import { ModelSelect } from "@/components/ModelSelect/ModelSelect";
import { FieldGroup } from "@/components/ui/field";
import { FormField } from "@/components/shared/form/FormField";
import { MultiSelect } from "@/components/shared/MultiSelect";
import SkillSelector from "@/components/skills/SkillSelector";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import i18n from "@/i18n/i18n";

export const accessGroupFormSchema = z.object({
  name: z.string().min(1, { error: () => i18n.t("accessGroups.form.name.required") }),
  description: z.string(),
  modelIds: z.array(z.string()),
  mcpServerIds: z.array(z.string()),
  mcpToolPermissions: z.record(z.string(), z.array(z.string())),
  agentIds: z.array(z.string()),
  skillNames: z.array(z.string()),
});

export type AccessGroupFormValues = z.output<typeof accessGroupFormSchema>;

export const GENERAL_TAB = "general";
export const MODELS_TAB = "models";
export const MCP_SERVERS_TAB = "mcp-servers";
export const AGENTS_TAB = "agents";
export const SKILLS_TAB = "skills";

interface AccessGroupBaseFormProps {
  form: UseFormReturn<AccessGroupFormValues>;
  isNameDisabled?: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  initialServerIds?: readonly string[];
}

export function AccessGroupMCPToolPermissions({
  selectedServers,
  toolPermissions,
  onChange,
  preserveUnrestrictedServers,
}: {
  selectedServers: string[];
  toolPermissions: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  preserveUnrestrictedServers?: readonly string[];
}) {
  const { accessToken } = useAuthorized();

  if (selectedServers.length === 0) {
    return null;
  }

  return (
    <div className="pt-4">
      <span hidden aria-hidden="true" />
    </div>
  );
}

export function AccessGroupBaseForm({
  form,
  isNameDisabled = false,
  activeTab,
  onTabChange,
  initialServerIds,
}: AccessGroupBaseFormProps) {
  const { t } = useTranslation();
  const { accessToken } = useAuthorized();
  const { data: agentsData } = useAgents();
  const { data: mcpServersData } = useMCPServers();

  const mcpServerOptions = (mcpServersData ?? []).map((server) => ({
    value: server.server_id,
    label: server.server_name ?? server.server_id,
  }));
  const agentOptions = (agentsData?.agents ?? []).map((agent) => ({
    value: agent.agent_id,
    label: agent.agent_name,
  }));

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="w-full">
        <TabsTrigger value={GENERAL_TAB}>
          <InfoIcon size={16} />
          {t("accessGroups.form.tabs.general")}
        </TabsTrigger>
        <TabsTrigger value={MODELS_TAB}>
          <LayersIcon size={16} />
          {t("accessGroups.form.tabs.models")}
        </TabsTrigger>
        <span hidden aria-hidden="true" />
        <span hidden aria-hidden="true" />
        <span hidden aria-hidden="true" />
      </TabsList>

      <TabsContent value={GENERAL_TAB} className="pt-4">
        <FieldGroup>
          <FormField control={form.control} name="name" label={t("accessGroups.form.name.label")}>
            {({ ref, ...field }) => (
              <Input
                {...field}
                ref={ref}
                placeholder={t("accessGroups.form.name.placeholder")}
                disabled={isNameDisabled}
              />
            )}
          </FormField>
          <FormField control={form.control} name="description" label={t("accessGroups.form.description.label")}>
            {({ ref, ...field }) => (
              <Textarea {...field} ref={ref} rows={4} placeholder={t("accessGroups.form.description.placeholder")} />
            )}
          </FormField>
        </FieldGroup>
      </TabsContent>

      <TabsContent value={MODELS_TAB} className="pt-4">
        <FormField control={form.control} name="modelIds" label={t("accessGroups.form.models.label")}>
          {(field) => <ModelSelect context="global" value={field.value} onChange={field.onChange} />}
        </FormField>
      </TabsContent>

      <span hidden aria-hidden="true" />

      <span hidden aria-hidden="true" />

      <span hidden aria-hidden="true" />
    </Tabs>
  );
}
