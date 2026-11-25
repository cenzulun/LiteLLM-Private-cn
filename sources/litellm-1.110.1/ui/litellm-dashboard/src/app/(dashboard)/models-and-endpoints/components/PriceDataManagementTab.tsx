import PriceDataReload from "@/components/price_data_reload";
import React from "react";
import { useTranslation } from "react-i18next";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useQueryClient } from "@tanstack/react-query";
import { modelCostMapKeys } from "../../hooks/models/useModelCostMap";

const PriceDataManagementTab = () => {
  const { t } = useTranslation();
  const { accessToken } = useAuthorized();
  const queryClient = useQueryClient();

  return (
    <div>
      <span hidden aria-hidden="true" />
    </div>
  );
};

export default PriceDataManagementTab;
