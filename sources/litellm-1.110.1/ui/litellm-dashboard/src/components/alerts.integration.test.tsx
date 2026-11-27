import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {renderWithProviders,screen,testQueryClient} from "../../tests/test-utils";
import AlertsPage from "@/app/(dashboard)/alerts/page";
vi.mock("@/app/(dashboard)/hooks/useAuthorized",()=>({default:()=>({accessToken:"test-only",isAuthorized:true,isLoading:false})}));
beforeEach(()=>{
 testQueryClient.clear();
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
  if(String(input).includes("/direct/snapshot"))return Response.json({sources:[],alerts:[{source_id:"a",name:"引擎一",summary:"采集异常",description:"鉴权失败",severity:"严重"}]});
  if(String(input).includes("/private/alerts"))return Response.json({events:[{id:1,source_id:"a",name:"引擎一",summary:"已恢复的排队告警",description:"阈值二十",severity:"警告",first_at:100,last_at:120,resolved_at:130}]});
  return Response.json({alerts:[],state:"unconfigured"});
 }));
});
afterEach(()=>vi.unstubAllGlobals());
it("未配置监控源时也汇总源采集活动告警和持久化历史",async()=>{
 renderWithProviders(<AlertsPage/>);
 expect(await screen.findByText("鉴权失败")).toBeVisible();
 expect(await screen.findByText("已恢复的排队告警")).toBeVisible();
 expect(screen.getByText("已恢复",{exact:true})).toBeVisible();
 expect(screen.queryByRole("button",{name:"配置源采集"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"配置监控源"})).not.toBeInTheDocument();
});
