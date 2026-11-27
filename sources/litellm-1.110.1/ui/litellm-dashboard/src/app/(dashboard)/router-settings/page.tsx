"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import RouteCanvas from "@/components/routing_canvas/RouteCanvas";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { Page } from "@/components/shared/Page";

export default function RouterSettingsPage() {
  const { accessToken, userRole, isViewOnly, isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <RouteCanvas accessToken={accessToken} userRole={isViewOnly ? "Admin Viewer" : userRole} />
    </Page>
  );
}
