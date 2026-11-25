import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "./LoginPage";

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: mockReplace,
  })),
}));

vi.mock("@/app/(dashboard)/hooks/uiConfig/useUIConfig", () => ({
  useUIConfig: vi.fn(),
}));

vi.mock("@/utils/cookieUtils", () => ({
  clearTokenCookies: vi.fn(),
  getCookieFromDocument: vi.fn(),
}));

vi.mock("@/utils/jwtUtils", () => ({
  isJwtExpired: vi.fn(),
}));

vi.mock("@/components/networking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/networking")>();
  return {
    ...actual,
    getProxyBaseUrl: vi.fn().mockReturnValue("http://localhost:4000"),
  };
});

vi.mock("@/app/(dashboard)/hooks/login/useLogin", () => ({
  useLogin: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
}));

vi.mock("@/hooks/useWorker", () => ({
  useWorker: vi.fn(() => ({
    isControlPlane: false,
    workers: [],
    selectedWorkerId: null,
    selectedWorker: null,
    selectWorker: vi.fn(),
    disconnectFromWorker: vi.fn(),
  })),
}));

import { useUIConfig } from "@/app/(dashboard)/hooks/uiConfig/useUIConfig";
import { useLogin } from "@/app/(dashboard)/hooks/login/useLogin";
import { getCookieFromDocument } from "@/utils/cookieUtils";
import { isJwtExpired } from "@/utils/jwtUtils";

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

describe("private local login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLogin).mockReturnValue({ mutate: vi.fn(), isPending: false, error: null } as unknown as ReturnType<typeof useLogin>);
    vi.mocked(useUIConfig).mockReturnValue({
      data: { auto_redirect_to_sso: true, sso_configured: true, admin_ui_disabled: false },
      isLoading: false,
    } as ReturnType<typeof useUIConfig>);
    vi.mocked(getCookieFromDocument).mockReturnValue(null);
    vi.mocked(isJwtExpired).mockReturnValue(true);
  });

  it.each([true, false])("renders local login for inherited single sign-on setting %s", async (configured) => {
    vi.mocked(useUIConfig).mockReturnValue({
      data: { auto_redirect_to_sso: true, sso_configured: configured, admin_ui_disabled: false },
      isLoading: false,
    } as ReturnType<typeof useUIConfig>);
    render(<QueryClientProvider client={createQueryClient()}><LoginPage /></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "登录" })).toBeEnabled();
    expect(screen.getByLabelText("AI大模型智能网关平台")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sso|单点|统一身份/i })).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects an existing valid session", async () => {
    vi.mocked(getCookieFromDocument).mockReturnValue("valid-session");
    vi.mocked(isJwtExpired).mockReturnValue(false);
    render(<QueryClientProvider client={createQueryClient()}><LoginPage /></QueryClientProvider>);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/ui"));
  });

  it("honors disabled admin UI", async () => {
    vi.mocked(useUIConfig).mockReturnValue({ data: { admin_ui_disabled: true }, isLoading: false } as ReturnType<typeof useUIConfig>);
    render(<QueryClientProvider client={createQueryClient()}><LoginPage /></QueryClientProvider>);
    expect(await screen.findByText("管理页面已停用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
  });

  it("shows a Chinese login error without upstream deployment details", async () => {
    vi.mocked(useLogin).mockReturnValue({ mutate: vi.fn(), isPending: false, error: new Error("Invalid credentials used to access UI. Check UI_USERNAME and UI_PASSWORD") } as unknown as ReturnType<typeof useLogin>);
    render(<QueryClientProvider client={createQueryClient()}><LoginPage /></QueryClientProvider>);
    expect(await screen.findByText("账号或密码不正确，请检查后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid credentials|UI_USERNAME|UI_PASSWORD/)).not.toBeInTheDocument();
  });
});
