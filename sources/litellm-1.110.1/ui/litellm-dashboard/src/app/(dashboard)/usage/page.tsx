"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import TokenOverview from "@/components/TokenOverview";
import LoadingScreen from "@/components/common_components/LoadingScreen";

export default function UsagePage() {
  const { isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return <main className="p-6"><TokenOverview compact /></main>;
}
