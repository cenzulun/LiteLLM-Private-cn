import { Button } from "@/components/ui/button";
import { format, Status, statusText, timeText } from "./types";

export default function SourceOverview({ sources, select }: { sources: Status[]; select: (id: string) => void }) {
  const value = (source: Status, key: string) => {
    if (!source.fresh) return "暂无新鲜数据";
    return format(source.metrics.find((item) => item.key === key)?.value);
  };
  return (
    <div className="overflow-x-auto rounded-lg border" aria-label="全部采集实例概览">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-3">采集实例与模型</th>
            <th className="p-3">状态</th>
            <th className="p-3">运行 / 排队</th>
            <th className="p-3">输出令牌/秒</th>
            <th className="p-3">输入 / 输出累计令牌</th>
            <th className="p-3">最近采样</th>
            <th className="p-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr className="border-t" key={source.id}>
              <td className="p-3">
                <p>{source.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{source.model_names.join(" · ") || "尚无模型标签"}</p>
              </td>
              <td className="p-3">{statusText[source.state] ?? "状态未知"}</td>
              <td className="p-3 tabular-nums">
                {value(source, "engine_running")} / {value(source, "engine_waiting")}
              </td>
              <td className="p-3 tabular-nums">{value(source, "engine_output")}</td>
              <td className="p-3 tabular-nums">
                {value(source, "engine_input_total")} / {value(source, "engine_output_total")}
              </td>
              <td className="p-3">{timeText(source.sampled_at)}</td>
              <td className="p-3">
                <Button size="sm" variant="outline" onClick={() => select(source.id)}>
                  查看指标
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
