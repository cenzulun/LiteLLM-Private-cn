"use client";

import { Children, isValidElement, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cva.config";
import { useDashboardPage } from "./DashboardPageContext";

export function PageHeader({ className, children, ...props }: ComponentProps<"div">) {
  const dashboard = useDashboardPage();
  const content = dashboard
    ? Children.toArray(children).filter(
        (child) => !isValidElement(child) || (child.type !== PageHeaderTitle && child.type !== PageHeaderDescription),
      )
    : children;
  if (dashboard && !Children.count(content)) return null;
  return (
    <div
      className={cn(
        dashboard ? "page-toolbar flex min-w-0 shrink-0 flex-wrap items-center justify-start gap-2" : "shrink-0",
        className,
      )}
      {...props}
    >
      {content}
    </div>
  );
}

export function PageHeaderTitle({ className, ...props }: ComponentProps<"h1">) {
  const dashboard = useDashboardPage();
  if (dashboard) return null;
  return (
    <h1
      className={cn(
        "flex items-center gap-2 text-lg font-semibold text-foreground [&_svg]:size-4 [&_svg]:flex-none",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeaderDescription({ className, ...props }: ComponentProps<"p">) {
  const dashboard = useDashboardPage();
  if (dashboard) return null;
  return <p className={cn("mt-1.5 text-sm text-muted-foreground", className)} {...props} />;
}

export function PageHeaderControls({ className, ...props }: ComponentProps<"div">) {
  const { t } = useTranslation();
  const dashboard = useDashboardPage();
  return (
    <div
      role="group"
      aria-label={t("shell.pageHeader.controls")}
      className={cn("flex min-h-9 min-w-0 max-w-full flex-wrap items-center gap-2", !dashboard && "mt-3", className)}
      {...props}
    />
  );
}
