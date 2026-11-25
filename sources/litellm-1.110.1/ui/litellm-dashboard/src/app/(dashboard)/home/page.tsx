"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import TokenOverview from "@/components/TokenOverview";

export default function HomeRoutePage() {
  const { isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) {
    return <LoadingScreen />;
  }
  return <main className="p-6"><TokenOverview /></main>;
}
