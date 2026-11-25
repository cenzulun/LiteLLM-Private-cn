"use client";

import { useTranslation } from "react-i18next";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getProxyBaseUrl } from "@/components/networking";
import { Button } from "@/components/ui/button";
import { SidebarHeader } from "@/components/shared/Sidebar";
import { uiHref } from "@/utils/uiHref";
import { productNames } from "@/i18n/untranslated/productNames";

export function SidebarBrand({
  homeHref = uiHref(""),
  homeLabel = "平台首页",
  collapsed = false,
  onToggleCollapsed,
  onHomeClick,
}: {
  accessToken: string | null;
  homeHref?: string;
  homeLabel?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onHomeClick?: () => void;
}) {
  const { t } = useTranslation();
  const baseUrl = getProxyBaseUrl();
  const logoSrc = `${baseUrl}/ui/realai-symbol.svg`;
  return (
    <SidebarHeader className="h-14 border-b border-border group-data-[collapsed=true]/sidebar:h-auto group-data-[collapsed=true]/sidebar:py-2">
      <div className="flex items-center justify-between gap-2 group-data-[collapsed=true]/sidebar:flex-col group-data-[collapsed=true]/sidebar:gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={homeHref} onClick={onHomeClick} className="flex min-w-0 items-center gap-2" aria-label={homeLabel}>
            <img src={logoSrc} alt={productNames.liteLLM} className="size-7" />
            {!collapsed && <span className="text-xs font-semibold leading-5">AI大模型<br />智能网关平台</span>}

          </Link>
        </div>
        {onToggleCollapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("shell.navbar.expandSidebar") : t("shell.navbar.collapseSidebar")}
            className="flex-none text-muted-foreground group-data-[collapsed=true]/sidebar:size-9"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
      </div>
    </SidebarHeader>
  );
}
