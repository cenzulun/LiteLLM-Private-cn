import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {fireEvent,renderWithProviders,screen,testQueryClient,waitFor} from "../../../tests/test-utils";
import MetricTrends from "./MetricTrends";
import type {Status} from "./types";
const source:Status={id:"engine-a",name:"测试实例",kind:"engine",deployment_id:"a",state:"connected",fresh:true,sampled_at:1,error:null,failures:0,model_names:["Qwen"],window_seconds:10,metric_count:2,reset:false,metrics:[{key:"engine_output",label:"输出令牌速率",unit:"令牌/秒",value:3,scope:"窗口",message:""},{key:"prefix_hit_ratio",label:"前缀缓存命中率",unit:"%",value:60,scope:"窗口",message:""}]};
const requests:string[]=[];
beforeEach(()=>{
 testQueryClient.clear();requests.length=0;
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{requests.push(String(input));return Response.json({series:{engine_output:[[1,3],[2,4]],prefix_hit_ratio:[[1,50],[2,60]]}});}));
});
afterEach(()=>vi.unstubAllGlobals());
describe("多指标趋势",()=>{
 it("全部指标一次批量查询，取消单个指标会更新查询和展示",async()=>{
  renderWithProviders(<MetricTrends source={source} accessToken="test"/>);
  expect(await screen.findByRole("img",{name:"输出令牌速率历史曲线"})).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox",{name:"全部指标"}));
  expect(await screen.findByRole("img",{name:"前缀缓存命中率历史曲线"})).toBeVisible();
  await waitFor(()=>expect(requests.some(path=>path.includes("/histories")&&path.includes("prefix_hit_ratio"))).toBe(true));
  fireEvent.click(screen.getByText(/自选指标/));
  fireEvent.click(screen.getByRole("checkbox",{name:"输出令牌速率"}));
  expect(screen.queryByRole("img",{name:"输出令牌速率历史曲线"})).not.toBeInTheDocument();
  expect(await screen.findByRole("img",{name:"前缀缓存命中率历史曲线"})).toBeVisible();
 });
});
