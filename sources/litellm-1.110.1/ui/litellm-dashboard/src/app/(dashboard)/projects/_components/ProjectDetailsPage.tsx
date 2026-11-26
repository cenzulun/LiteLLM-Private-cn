import { useCanManageProjects } from "@/app/(dashboard)/hooks/projects/projectAccess";
import { useProjectDetails } from "@/app/(dashboard)/hooks/projects/useProjectDetails";
import { useTeam } from "@/app/(dashboard)/hooks/teams/useTeams";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { isUserTeamAdminForSingleTeam } from "@/utils/roles";
import { BarChart } from "@/components/shared/charts";
import { ArrowLeftIcon, DollarSignIcon, EditIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CopyButton from "@/components/shared/CopyButton";
import { UserReference } from "@/components/shared/UserReference";
import { StatusBadge } from "@/components/shared/table_cells/status_badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter, MeterIndicator, MeterTrack } from "@/components/shared/Meter";
import { UiLoadingSpinner } from "@/components/ui/ui-loading-spinner";
import { EditProjectModal } from "./ProjectModals/EditProjectModal";
import { ProjectKeysSection } from "./ProjectKeysSection";

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

const utilisationTone = (percent: number) => (percent >= 90 ? "over" : percent >= 70 ? "warning" : "default");

export function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const { t } = useTranslation();
  const { data: project, isLoading } = useProjectDetails(projectId);
  const { data: teamInfo } = useTeam(project?.team_id ?? undefined);
  const { userId } = useAuthorized();
  const canEditProject = useCanManageProjects(
    isUserTeamAdminForSingleTeam(teamInfo?.members_with_roles ?? null, userId ?? ""),
  );
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);

  const spend = project?.spend ?? 0;
  const maxBudget = project?.litellm_budget_table?.max_budget ?? null;
  const hasLimit = maxBudget != null && maxBudget > 0;
  const spendPercent = hasLimit ? Math.min((spend / maxBudget) * 100, 100) : 0;

  const modelSpendData = useMemo(() => {
    const raw = (project?.model_spend ?? {}) as Record<string, number>;
    return Object.entries(raw)
      .map(([model, value]) => ({ model, spend: value }))
      .sort((a, b) => b.spend - a.spend);
  }, [project?.model_spend]);

  if (isLoading) {
    return (
      <div className="p-6 px-12">
        <div
          role="status"
          aria-busy="true"
          aria-label={t("projects.detail.loading")}
          className="flex min-h-[300px] items-center justify-center"
        >
          <UiLoadingSpinner className="size-8 text-primary" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 px-12">
        <Button variant="ghost" size="icon" aria-label={t("projects.detail.back")} onClick={onBack} className="mb-4">
          <ArrowLeftIcon className="size-4" />
        </Button>
        <p className="py-8 text-center text-sm text-muted-foreground">{t("projects.detail.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="p-6 px-12">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label={t("projects.detail.back")} onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {project.project_alias ?? project.project_id}
              </h2>
              <StatusBadge
                tone={project.blocked ? "error" : "success"}
                label={project.blocked ? t("projects.detail.status.blocked") : t("projects.detail.status.active")}
              />
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>
                {t("projects.detail.idLabel")}
                {project.project_id}
              </span>
              <CopyButton value={project.project_id} label={t("projects.detail.copyId")} />
            </div>
          </div>
        </div>
        {canEditProject && (
          <Button onClick={() => setIsEditModalVisible(true)}>
            <EditIcon className="size-4" />
            {t("projects.detail.editButton")}
          </Button>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("projects.detail.detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("projects.detail.description")}</dt>
            <dd className="text-foreground">{project.description || "—"}</dd>
            <dt className="text-muted-foreground">{t("projects.detail.created")}</dt>
            <dd className="flex items-center gap-1 text-foreground">
              {new Date(project.created_at).toLocaleString()}
              {project.created_by && (
                <>
                  <span>{t("projects.detail.by")}</span>
                  <UserReference userId={project.created_by} />
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">{t("projects.detail.lastUpdated")}</dt>
            <dd className="flex items-center gap-1 text-foreground">
              {new Date(project.updated_at).toLocaleString()}
              {project.updated_by && (
                <>
                  <span>{t("projects.detail.by")}</span>
                  <UserReference userId={project.updated_by} />
                </>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <span hidden aria-hidden="true" />

        <span hidden aria-hidden="true" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProjectKeysSection projectId={projectId} />

        <span hidden aria-hidden="true" />
      </div>

      <EditProjectModal isOpen={isEditModalVisible} project={project} onClose={() => setIsEditModalVisible(false)} />
    </div>
  );
}
