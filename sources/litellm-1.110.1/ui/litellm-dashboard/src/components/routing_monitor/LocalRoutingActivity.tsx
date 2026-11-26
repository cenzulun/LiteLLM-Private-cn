import { formatNumber } from "./types";
export type LocalActivity = {
  model: string;
  deployment: string;
  completed: number;
  successes: number;
  failures: number;
  retries: number;
  fallbacks: number;
  average_duration: number | null;
};
export default function LocalRoutingActivity({
  rows,
  minutes,
  error,
}: {
  rows: LocalActivity[];
  minutes: number;
  error: string | null;
}) {
  const total = rows.reduce((sum, row) => sum + row.completed, 0);
  return (
    <section className="monitor-surface overflow-hidden" aria-label="实际分流记录统计">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold">实际分流记录统计</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          最近 {minutes} 分钟 ·
          来自网关持久化调用记录，无需外部监控源；仅统计已记录的完成尝试，受三十天及两万条保留上限约束。
        </p>
      </div>
      {error ? (
        <p role="alert" className="p-5 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {["模型 / 实例", "已完成尝试", "观测占比", "成功 / 失败", "重试 / 备用", "平均耗时"].map((label) => (
                  <th key={label} className="p-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.model}-${row.deployment}`} className="border-t">
                  <td className="p-3">
                    <p className="font-medium">{row.model}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{row.deployment.slice(0, 12)}</p>
                  </td>
                  <td className="p-3 tabular-nums">{row.completed}</td>
                  <td className="p-3 tabular-nums">{total ? formatNumber((row.completed / total) * 100) : "—"}%</td>
                  <td className="p-3 tabular-nums">
                    <span className={row.successes ? "text-emerald-700 dark:text-emerald-400" : ""}>
                      {row.successes}
                    </span>{" "}
                    / <span className={row.failures ? "text-destructive" : ""}>{row.failures}</span>
                  </td>
                  <td className="p-3 tabular-nums">
                    {row.retries} / {row.fallbacks}
                  </td>
                  <td className="p-3 tabular-nums">{formatNumber(row.average_duration)} 秒</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-6 text-sm text-muted-foreground">
                    当前时间范围尚无完成调用记录。产生真实模型请求后自动展示。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
