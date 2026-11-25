"use client";

import { useLogin } from "@/app/(dashboard)/hooks/login/useLogin";
import { useUIConfig } from "@/app/(dashboard)/hooks/uiConfig/useUIConfig";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import {
  getRuntimeBackendBaseUrl,
  getUiPageUrl,
  switchToWorkerUrl,
} from "@/components/networking";
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UiLoadingSpinner } from "@/components/ui/ui-loading-spinner";
import { useZodForm } from "@/lib/forms/useZodForm";
import { clearTokenCookies, getCookieFromDocument } from "@/utils/cookieUtils";
import { isJwtExpired } from "@/utils/jwtUtils";
import { consumeReturnUrl } from "@/utils/returnUrlUtils";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useWorker } from "@/hooks/useWorker";
import i18n from "@/i18n/i18n";
import { productNames } from "@/i18n/untranslated/productNames";
import { loginErrorMessage } from "./loginErrorMessage";

const loginSchema = z.object({
  username: z.string().min(1, { error: () => i18n.t("login.schema.usernameRequired") }),
  password: z.string().min(1, { error: () => i18n.t("login.schema.passwordRequired") }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginPageContent() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const { data: uiConfig, isLoading: isConfigLoading } = useUIConfig();
  const loginMutation = useLogin();
  const router = useRouter();
  const { workers, selectWorker } = useWorker();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const workerFieldId = useId();
  const form = useZodForm(loginSchema, { defaultValues: { username: "", password: "" } });

  // Pre-select worker from URL param (e.g. /ui/login?worker=team-b)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workerParam = params.get("worker");
    if (workerParam) {
      setSelectedWorkerId(workerParam);
    }
  }, []);

  useEffect(() => {
    if (isConfigLoading) {
      return;
    }

    // Check if admin UI is disabled
    if (uiConfig && uiConfig.admin_ui_disabled) {
      setIsLoading(false);
      return;
    }

    // If switching workers on a control plane, clear the old token and show login
    const switchingWorker = new URLSearchParams(window.location.search).has("worker");
    if (switchingWorker && uiConfig?.is_control_plane) {
      clearTokenCookies();
      setIsLoading(false);
      return;
    }

    const rawToken = getCookieFromDocument("token");
    if (rawToken && !isJwtExpired(rawToken)) {
      // User already logged in - redirect to return URL or default
      const returnUrl = consumeReturnUrl(getRuntimeBackendBaseUrl());
      if (returnUrl) {
        router.replace(getUiPageUrl(returnUrl, true));
      } else {
        router.replace("/ui");
      }
      return;
    }


    setIsLoading(false);
  }, [isConfigLoading, router, uiConfig]);

  const handleSubmit = ({ username, password }: LoginFormValues) => {
    // If a worker is selected, point proxyBaseUrl at it before login
    const selectedWorker = workers.find((w) => w.worker_id === selectedWorkerId);
    if (selectedWorker) {
      switchToWorkerUrl(selectedWorker.url);
    }

    loginMutation.mutate(
      { username, password, useV3: !!selectedWorker },
      {
        onSuccess: (data) => {
          // Update the worker context with the selected worker
          if (selectedWorker) {
            selectWorker(selectedWorker.worker_id);
            // Stay on the CP's UI — proxyBaseUrl already points at the worker
            router.push("/ui/?login=success");
          } else {
            // Normal (non-control-plane) login — follow the server's redirect
            const returnUrl = consumeReturnUrl(getRuntimeBackendBaseUrl());
            if (returnUrl) {
              router.push(getUiPageUrl(returnUrl, true));
            } else {
              router.push(getUiPageUrl(data.redirect_url, true));
            }
          }
        },
        onError: () => {
          // Reset proxyBaseUrl on login failure
          if (selectedWorker) {
            switchToWorkerUrl(null);
          }
        },
      },
    );
  };

  const error = loginErrorMessage(loginMutation.error);
  const isLoginLoading = loginMutation.isPending;

  if (isConfigLoading || isLoading) {
    return <LoadingScreen />;
  }

  // Show disabled message if admin UI is disabled
  if (uiConfig && uiConfig.admin_ui_disabled) {
    return (
      <div className="realai-login min-h-screen flex items-center justify-center bg-muted">
        <Card className="realai-login-card w-full max-w-lg">
          <CardContent>
            <div className="flex w-full flex-col gap-4">
              <div className="text-center">
                <h2 className="text-3xl font-semibold text-foreground">{productNames.liteLLMWithLogo}</h2>
              </div>

              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>{t("login.adminDisabled.title")}</AlertTitle>
                <AlertDescription>
                  <p className="text-sm">{t("login.adminDisabled.description")}</p>
                  <p className="mt-2 text-sm">
                    <code className="bg-muted px-1 py-0.5 rounded-sm text-xs">DISABLE_ADMIN_UI=False</code>
                  </p>
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="realai-login min-h-screen flex items-center justify-center bg-muted">
      <div className="realai-login-shell w-full max-w-lg">
        <div className="realai-login-brand" aria-label={productNames.liteLLMWithLogo}>{productNames.liteLLMWithLogo}</div>
      <Card className="realai-login-card w-full">
        <CardContent>

            <div className="flex w-full flex-col gap-4">
              <div className="text-center">
                <h3 className="text-2xl font-semibold text-foreground">{t("login.form.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("login.form.subtitle")}</p>
              </div>


              {error && (
                <Alert variant="error">
                  <CircleAlert />
                  <AlertTitle>{error}</AlertTitle>
                </Alert>
              )}

              <form onSubmit={form.handleSubmit(handleSubmit)}>
                <FieldGroup>
                  {uiConfig?.is_control_plane && workers.length > 0 && (
                    <Field>
                      <FieldLabel htmlFor={workerFieldId}>{t("login.form.worker.label")}</FieldLabel>
                      <Select
                        items={workers.map((worker) => ({ label: worker.name, value: worker.worker_id }))}
                        value={selectedWorkerId}
                        onValueChange={(value: string | null) => setSelectedWorkerId(value)}
                      >
                        <SelectTrigger id={workerFieldId} className="h-10 w-full">
                          <SelectValue placeholder={t("login.form.worker.placeholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {workers.map((worker) => (
                            <SelectItem key={worker.worker_id} value={worker.worker_id}>
                              {worker.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <FormField control={form.control} name="username" label={t("login.form.username.label")}>
                    {({ ref, ...field }) => (
                      <Input
                        {...field}
                        ref={ref}
                        placeholder={t("login.form.username.placeholder")}
                        autoComplete="username"
                        disabled={isLoginLoading}
                        className="h-10 rounded-md"
                      />
                    )}
                  </FormField>

                  <FormField control={form.control} name="password" label={t("login.form.password.label")}>
                    {({ ref, ...field }) => (
                      <PasswordInput
                        {...field}
                        ref={ref}
                        placeholder={t("login.form.password.placeholder")}
                        autoComplete="current-password"
                        disabled={isLoginLoading}
                        groupClassName="h-10"
                      />
                    )}
                  </FormField>

                  <Button type="submit" size="lg" disabled={isLoginLoading} className="w-full">
                    {isLoginLoading && (
                      <UiLoadingSpinner className="size-4" role="img" aria-label={t("login.form.loading")} />
                    )}
                    {isLoginLoading ? t("login.form.submitting") : t("login.form.submit")}
                  </Button>

                </FieldGroup>
              </form>
            </div>

        </CardContent>
      </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
