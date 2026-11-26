"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import TokenOverview from "@/components/TokenOverview";
import { Page } from "@/components/shared/Page";

export default function HomeRoutePage() {
  const { isLoading, isAuthorized } = useAuthorized();
  if (isLoading || !isAuthorized) {
    return <LoadingScreen />;
  }
  return <Page><TokenOverview /></Page>;
}
