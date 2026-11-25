import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConnectionForm from "./ConnectionForm";

describe("调度连接配置", () => {
  it("prefills bundled service URLs and submits the actual engine identifier unchanged", () => {
    const save = vi.fn();
    render(<ConnectionForm busy={false} readOnly={false} onSave={save} onTest={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /推理地址/ })).toHaveValue("http://motor:1025");
    expect(screen.getByRole("textbox", { name: /管理地址/ })).toHaveValue("http://motor:1026");
    expect(screen.getByRole("textbox", { name: /观测地址/ })).toHaveValue("http://motor:1027");
    expect(screen.getByRole("textbox", { name: /控制器地址/ })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: /连接名称/ }), { target: { value: "模型推理池" } });
    fireEvent.change(screen.getByRole("textbox", { name: /引擎模型名称/ }), {
      target: { value: "company/Qwen3-235B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: "company/Qwen3-235B",
        inference_url: "http://motor:1025",
        mode: "union",
      }),
    );
    expect(screen.getByRole("textbox", { name: /观测地址/ })).toHaveAccessibleDescription(/不是 Prometheus 地址/);
  });
});
