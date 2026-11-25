const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../motor/runtime/gateway.env"), "utf8").split(/\r?\n/).filter(Boolean).map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.goto("http://127.0.0.1:4200/ui/motor/");
  await page.getByLabel("账号", { exact: true }).fill(env.UI_USERNAME);
  await page.getByLabel("密码", { exact: true }).fill(env.UI_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/ui\/(?!login)/, { timeout: 30000 });
  await page.goto("http://127.0.0.1:4200/ui/motor/");
  await page.getByRole("main").getByRole("heading", { name: "Motor 推理调度" }).waitFor({ timeout: 30000 });
  await page.getByLabel("当前连接", { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText("调度未就绪", { exact: true }).waitFor({ timeout: 30000 });
  const output = path.resolve(__dirname, "../../.impeccable/review"); fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  await page.getByRole("main").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole("heading", { name: "实时吞吐与负载" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-metrics.png"), fullPage: true });
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  if (widths.content > widths.viewport) throw new Error("Mobile page has horizontal overflow");
  for (const name of ["实例纳管", "网关接入与测试", "操作记录", "连接配置"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.waitForFunction(label => [...document.querySelectorAll('[role="tab"]')].some(element =>
      element.textContent === label && element.getAttribute('aria-selected') === 'true'), name);
  }
  await page.getByRole("heading", { name: "调度配置" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-strategy.png"), fullPage: true });
  console.log(JSON.stringify({ url: page.url(), motorVisible: true, tabs: "passed", widths, realReadiness: false }));
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });

