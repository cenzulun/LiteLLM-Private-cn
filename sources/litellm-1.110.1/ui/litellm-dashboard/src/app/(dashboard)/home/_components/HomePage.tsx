"use client";

import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/shared/Page";
import { PageHeader, PageHeaderControls, PageHeaderTitle } from "@/components/shared/PageHeader";
import { uiHref } from "@/utils/uiHref";
import { Leaderboard, useBreakdown } from "@/app/(dashboard)/usage/_components/components/overview/BreakdownChart";
import { Panel } from "@/app/(dashboard)/usage/_components/components/overview/Primitives";
import UsageStatStrip from "@/app/(dashboard)/usage/_components/components/overview/UsageStatStrip";
import { HOME_USAGE_DAYS, useHomeUsage } from "./useHomeUsage";

const LEADERBOARD = { metric: "tokens", dimension: "model_groups" } as const;

export default function HomePage() {
  const { t } = useTranslation();
  const { isViewOnly } = useAuthorized();
  const usage = useHomeUsage();
  const { series, ranking } = useBreakdown(usage.results, LEADERBOARD, 8);

  return (
    <Page>
      <PageHeader>
        <PageHeaderTitle>{t("home.page.title")}</PageHeaderTitle>
        {!isViewOnly && (
          <PageHeaderControls>
            <Button render={<a href={uiHref("api-keys?create=true")} />}>
              <Plus />
              {t("home.page.createKey")}
            </Button>
          </PageHeaderControls>
        )}
      </PageHeader>

      <section aria-label={t("home.page.usageAria", { days: HOME_USAGE_DAYS })}>
        {usage.failed ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
            <span className="text-destructive">{t("home.page.usageFailed")}</span>
            <Button variant="outline" size="sm" onClick={usage.retry}>
              {t("home.page.retry")}
            </Button>
          </div>
        ) : (
          <UsageStatStrip
            results={usage.results}
            totals={usage.totals}
            loading={usage.loading}
            requestCountsPending={usage.requestCountsPending}
          />
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">


          <Panel
            title={t("home.page.leaderboard.title")}
            subtitle={t("home.page.leaderboard.subtitle", { days: HOME_USAGE_DAYS })}
            testId="home-leaderboard"
          >
            <Leaderboard
              ranking={ranking}
              series={series}
              metric={LEADERBOARD.metric}
              dimension={LEADERBOARD.dimension}
              columns={2}
              limit={10}
            />
          </Panel>
        </div>

        <section className="self-start space-y-3 rounded-xl border p-5"><h2 className="text-base font-semibold">接入与运行</h2><p className="text-sm text-muted-foreground">在模型管理中添加内网服务地址。同一模型的多个部署可组成副本池。</p><a className="text-sm underline" href={uiHref("models-and-endpoints")}>管理模型与部署</a><p className="text-sm text-muted-foreground">推理监控需配置内网监控源，未接入时不显示示例数据。</p><a className="text-sm underline" href={uiHref("inference-monitor")}>查看推理监控</a></section>
      </div>
    </Page>
  );
}
