"use client";

import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { all_admin_roles, internalUserRoles } from "@/utils/roles";
import RouteCanvas from "@/components/routing_canvas/RouteCanvas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { autoRouterCreationScope } from "@/utils/modelPermissions";

import { AutoRoutersPanel } from "../components/AutoRouters/AutoRoutersPanel";

/**
 * Owns the permission decision for the Auto-Routers tab so the panel stays a renderer.
 * Auto routers also admit members of teams that enabled their dedicated management grant.
 * Viewer roles reach the list without write affordances.
 */
export default function AutoRoutersTabPanel() {
  const { accessToken, userRole, userId: userID, isViewOnly } = useAuthorized();
  const { data: teams } = useTeams();
  const { data: uiSettings } = useUISettings();

  const isInternalUser = userRole != null && internalUserRoles.includes(userRole);
  const scope = autoRouterCreationScope(
    { userRole, userID, isViewOnly },
    {
      teams: teams ?? null,
      disabledForInternalUsers: isInternalUser && uiSettings?.values?.disable_model_add_for_internal_users === true,
    },
  );

  return (
    <Tabs defaultValue={all_admin_roles.includes(userRole ?? "") ? "canvas" : "classification"}>
      <TabsList>
        <TabsTrigger value="canvas" disabled={!all_admin_roles.includes(userRole ?? "")}>
          路由画布
        </TabsTrigger>
        <TabsTrigger value="classification">模型分类路由</TabsTrigger>
      </TabsList>
      <TabsContent value="canvas" className="pt-4">
        <RouteCanvas accessToken={accessToken} userRole={isViewOnly ? "Admin Viewer" : userRole ?? ""} />
      </TabsContent>
      <TabsContent value="classification" className="pt-4">
        <AutoRoutersPanel
          accessToken={accessToken}
          userRole={userRole ?? ""}
          userID={userID ?? null}
          isViewOnly={isViewOnly}
          teams={teams ?? null}
          createScope={scope}
        />
      </TabsContent>
    </Tabs>
  );
}
