"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import OnlineRouteConfiguration from "@/components/OnlineRouteConfiguration";

export default function RouterSettingsPage() {
  const { accessToken, userRole } = useAuthorized();
  return <div className="space-y-6 p-6"><OnlineRouteConfiguration accessToken={accessToken} userRole={userRole} /></div>;
}
