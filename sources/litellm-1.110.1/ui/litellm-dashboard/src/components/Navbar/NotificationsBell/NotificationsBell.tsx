"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { uiHref } from "@/utils/uiHref";
import type { ReactNode } from "react";

export function NotificationsBell({ deploymentHealthLink }: { accessToken: string | null; deploymentHealthLink?: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="运行通知" />}>
        <Bell className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>运行通知</PopoverTitle>
        <p className="text-sm text-muted-foreground">模型运行指标和当前告警统一显示在推理监控中。</p>
        <Link href={uiHref("inference-monitor")} className="text-sm text-primary underline underline-offset-4">查看推理监控与告警</Link>
        {deploymentHealthLink}
      </PopoverContent>
    </Popover>
  );
}
