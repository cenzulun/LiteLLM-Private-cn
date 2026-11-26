"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import OnlineRouteConfiguration from "@/components/OnlineRouteConfiguration";
import RouteCanvas from "@/components/routing_canvas/RouteCanvas";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { Page } from "@/components/shared/Page";

export default function RouterSettingsPage() {
  const { accessToken, userRole, isViewOnly, isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <h1 className="text-2xl font-semibold">路由策略</h1>
      <RouteCanvas accessToken={accessToken} userRole={isViewOnly ? "Admin Viewer" : userRole} />
      <details className="monitor-surface p-5">
        <summary className="cursor-pointer font-medium">高级配置文件编辑</summary>
        <div className="mt-4">
          <OnlineRouteConfiguration accessToken={accessToken} userRole={isViewOnly ? "Admin Viewer" : userRole} />
        </div>
      </details>
    </Page>
  );
}
