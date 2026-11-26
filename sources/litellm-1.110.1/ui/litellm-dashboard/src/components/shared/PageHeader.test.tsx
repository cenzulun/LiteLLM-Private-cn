import { renderWithProviders, screen, within } from "@/../tests/test-utils";
import { Users } from "lucide-react";
import { describe, expect, it } from "vitest";

import { PageHeader, PageHeaderControls, PageHeaderDescription, PageHeaderTitle } from "./PageHeader";
import { DashboardPageContext } from "./DashboardPageContext";
import i18n from "@/i18n/i18n";

describe("PageHeader", () => {
  it("keeps dashboard actions while omitting the duplicate heading and introduction", () => {
    renderWithProviders(
      <DashboardPageContext.Provider value={true}>
        <PageHeader>
          <PageHeaderTitle>模型管理</PageHeaderTitle>
          <PageHeaderDescription>重复的页面介绍</PageHeaderDescription>
          <PageHeaderControls>
            <button>添加模型</button>
          </PageHeaderControls>
        </PageHeader>
      </DashboardPageContext.Provider>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("重复的页面介绍")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加模型" })).toBeEnabled();
  });

  it("should name the page heading by its text alone when it carries an icon", () => {
    renderWithProviders(
      <PageHeader>
        <PageHeaderTitle>
          <Users />
          Teams
        </PageHeaderTitle>
        <PageHeaderDescription>Manage teams</PageHeaderDescription>
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeInTheDocument();
    expect(screen.getByText("Manage teams")).toBeInTheDocument();
  });

  it("should group the composed controls under one accessible label", () => {
    renderWithProviders(
      <PageHeader>
        <PageHeaderTitle>Teams</PageHeaderTitle>
        <PageHeaderControls>
          <button>Create Team</button>
          <button>Refresh</button>
        </PageHeaderControls>
      </PageHeader>,
    );

    const controls = screen.getByRole("group", { name: i18n.t("shell.pageHeader.controls") });
    expect(
      within(controls)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Create Team", "Refresh"]);
  });

  it("should forward native attributes to each part", () => {
    renderWithProviders(
      <PageHeader data-testid="header">
        <PageHeaderTitle id="page-title">Teams</PageHeaderTitle>
        <PageHeaderControls aria-label="Team controls" />
      </PageHeader>,
    );

    expect(screen.getByTestId("header")).toContainElement(screen.getByRole("heading", { name: "Teams" }));
    expect(screen.getByRole("heading", { name: "Teams" })).toHaveAttribute("id", "page-title");
    expect(screen.getByRole("group", { name: "Team controls" })).toBeInTheDocument();
  });
});
