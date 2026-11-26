"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import TokenOverview from "@/components/TokenOverview";
import { Page } from "@/components/shared/Page";
import LoadingScreen from "@/components/common_components/LoadingScreen";

export default function UsagePage() {
  const { isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return <Page><TokenOverview compact /></Page>;
}
