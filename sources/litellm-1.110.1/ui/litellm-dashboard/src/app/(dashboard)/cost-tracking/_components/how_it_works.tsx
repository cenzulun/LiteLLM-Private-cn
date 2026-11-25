import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import CodeBlock from "@/components/CodeBlock";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HowItWorks: React.FC = () => {
  const { t } = useTranslation();
  const [responseCost, setResponseCost] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");

  const calculatedDiscount = useMemo(() => {
    const cost = parseFloat(responseCost);
    const discount = parseFloat(discountAmount);
    const hasInvalidCost = isNaN(cost) || cost === 0;
    const hasInvalidDiscount = isNaN(discount) || discount === 0;

    if (hasInvalidCost || hasInvalidDiscount) {
      return null;
    }

    const originalCost = cost + discount;
    const discountPercentage = (discount / originalCost) * 100;

    return {
      originalCost: originalCost.toFixed(10),
      finalCost: cost.toFixed(10),
      discountAmount: discount.toFixed(10),
      discountPercentage: discountPercentage.toFixed(2),
    };
  }, [responseCost, discountAmount]);

  return (
    <div className="space-y-4 pt-2">
      <span hidden aria-hidden="true" />
      <div>
        <h3 className="mb-1 text-sm font-medium text-foreground">{t("costTracking.howItWorks.example.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("costTracking.howItWorks.example.body")}</p>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium text-foreground">{t("costTracking.howItWorks.validRange.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("costTracking.howItWorks.validRange.body")}</p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium text-foreground">{t("costTracking.howItWorks.validating.title")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{t("costTracking.howItWorks.validating.body")}</p>
        <CodeBlock
          language="bash"
          code={`curl -X POST -i http://your-proxy:4000/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <your-master-key>" \\
  -d '{
    "model": "gemini/gemini-2.5-pro",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
        />
        <p className="mb-2 mt-3 text-xs text-muted-foreground">{t("costTracking.howItWorks.validating.lookFor")}</p>
        <div className="space-y-1.5">
          <span hidden aria-hidden="true" />
          <span hidden aria-hidden="true" />
          <span hidden aria-hidden="true" />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">{t("costTracking.howItWorks.calculator.title")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{t("costTracking.howItWorks.calculator.body")}</p>
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <span hidden aria-hidden="true" />
          <span hidden aria-hidden="true" />
        </div>

        {calculatedDiscount && (
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">{t("costTracking.howItWorks.results.title")}</p>
            <div className="space-y-2">
              <span hidden aria-hidden="true" />
              <span hidden aria-hidden="true" />
              <span hidden aria-hidden="true" />
              <span hidden aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HowItWorks;
