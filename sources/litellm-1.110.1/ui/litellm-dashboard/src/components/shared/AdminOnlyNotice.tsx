"use client";

import React from "react";
import { useTranslation } from "react-i18next";

interface AdminOnlyNoticeProps {
  pageTitle: string;
}

export const AdminOnlyNotice: React.FC<AdminOnlyNoticeProps> = ({ pageTitle }) => {
  const { t } = useTranslation();
  return (
    <div className="p-4 w-full min-w-0 flex-1">
      <p className="text-sm text-muted-foreground">{t("shell.adminOnlyNotice.description", { pageTitle })}</p>
    </div>
  );
};
