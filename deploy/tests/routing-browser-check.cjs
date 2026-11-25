const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async()=>{
  const root=path.resolve(__dirname,'../..');
  const config=JSON.parse(execFileSync('docker',['compose','config','--format','json'],{cwd:path.join(root,'deploy'),encoding:'utf8'}));
  const env=config.services.gateway.environment;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1600,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const out=path.join(root,'.impeccable/review/routing-1.0.10');fs.mkdirSync(out,{recursive:true});
  try{
    await page.goto('http://127.0.0.1:4100/ui/login/');
    await page.getByLabel('账号',{exact:true}).fill(env.UI_USERNAME);
    await page.getByLabel('密码',{exact:true}).fill(env.UI_PASSWORD);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.waitForURL(/\/ui\/(?!login)/,{timeout:60000});
    await page.goto('http://127.0.0.1:4100/ui/routing-monitor/');
    await page.getByRole('heading',{name:'实例流量与压力',exact:true}).waitFor({timeout:60000});
    const main=page.getByRole('main');
    const initialModel=page.getByRole('combobox',{name:'模型',exact:true});
    const initialOptions=await initialModel.locator('option').allTextContents();
    const initialTestModel=initialOptions.find(value=>value.includes('验收'));
    if(initialTestModel){
      await initialModel.selectOption({label:initialTestModel});
      await page.getByRole('heading',{name:'实例流量与压力',exact:true}).waitFor();
    }
    await page.screenshot({path:path.join(out,'desktop.png')});
    const text=await main.innerText();
    if(/LiteLLM|github|ChatGPT|claude|美元|终身花费|游戏场/i.test(text))throw Error('界面存在禁用词');
    await page.getByRole('button',{name:'配置监控源',exact:true}).click();
    await page.getByRole('button',{name:'保存配置',exact:true}).waitFor();
    await page.getByRole('button',{name:'保存配置',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'configuration.png')});
    await page.keyboard.press('Escape');
    await page.goto('http://127.0.0.1:4100/ui/routing-monitor/');
    await page.getByRole('heading',{name:'实例流量与压力',exact:true}).waitFor();
    const model=page.getByRole('combobox',{name:'模型',exact:true});
    const options=await model.locator('option').allTextContents();
    const testModel=options.find(value=>value.includes('验收'));
    if(testModel){
      await model.selectOption({label:testModel});
      await page.getByRole('combobox',{name:'时间范围',exact:true}).selectOption('15');
      await page.getByRole('combobox',{name:'趋势指标',exact:true}).selectOption('route_output');
      await page.getByRole('button',{name:/查看 .* 的路由详情/}).first().click();
      await page.getByRole('region',{name:'实例路由详情'}).waitFor();
      await page.getByRole('region',{name:'实例路由详情'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,'instance.png')});
    }
    const link=await page.getByRole('link',{name:'调整路由策略'}).getAttribute('href');
    if(link!='/ui/router-settings/')throw Error('策略跳转地址无效');
    await page.setViewportSize({width:390,height:844});
    await page.goto('http://127.0.0.1:4100/ui/routing-monitor/');
    await page.getByRole('heading',{name:'实例流量与压力',exact:true}).waitFor();
    if(initialTestModel){
      await page.getByRole('combobox',{name:'模型',exact:true}).selectOption({label:initialTestModel});
      await page.getByRole('heading',{name:'实例流量与压力',exact:true}).waitFor();
    }
    await page.screenshot({path:path.join(out,'mobile.png')});
    await page.getByRole('heading',{name:'运行趋势',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'mobile-trends.png')});
    await page.getByRole('heading',{name:'近期路由记录',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'mobile-events.png')});
    const widths=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
    if(widths.content>widths.viewport)throw Error('小屏出现页面横向溢出');
    if(errors.length)throw Error('页面运行错误 '+errors.join(', '));
    console.log(JSON.stringify({status:'passed',filterTest:Boolean(testModel),widths,screenshots:out}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
