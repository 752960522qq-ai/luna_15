// Screenshots of the running game, using its actual wardrobe and city assets.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const sharp=(await import(process.env.SHARP_MODULE||'sharp')).default;
const root=path.resolve(fileURLToPath(new URL('../web/',import.meta.url)));
const output=path.resolve(process.env.PREVIEW_OUTPUT||'artifacts/city-clothes');
await fs.mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(root+path.sep))throw Error('path');
  const bytes=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(bytes);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:720},hasTouch:true});page.setDefaultTimeout(20000);const errors=[],records=[],images=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?diagnostics=1');
 await page.waitForFunction(()=>window.__lifeSnapshot?.().loaded,null,{timeout:120000});
 await page.locator('#new-game').tap();await page.locator('#pause').tap();await page.locator('[data-action="wardrobe"]').tap();await page.locator('[data-action="outfit"][data-value="dress-dorsay"]').tap();await page.locator('#close-panel').tap();
 // The camera override affects only this diagnostics preview, not game defaults.
 for(const [name,x,z,position,target] of [
  ['city-expanded',0,9,[1.8,2.25,15],[0,1.02,9]],
  ['city-east-district',245,0,[246.3,2.25,6],[245,1.02,0]]
 ]){
  const before=await page.evaluate(p=>{window.__lifeTest.time(12);window.__lifeTest.teleport('city',p.x,p.z);window.__heelMotionPreviewCamera({position:p.position,target:p.target});return window.__lifeSnapshot().frames;},{x,z,position,target});
  await page.waitForFunction(f=>window.__lifeSnapshot().frames>f+3,before,{timeout:60000});
  await page.addStyleTag({content:'#toast{visibility:hidden}'});
  const screenshot=await page.screenshot();images.push(screenshot);await fs.writeFile(path.join(output,name+'.png'),screenshot);records.push(await page.evaluate(()=>window.__lifeSnapshot()));console.log(name);
 }
 const svg=Buffer.from('<svg width="1280" height="1620" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="1620" fill="#c6ced7"/><g fill="#263a49" font-family="Noto Sans CJK SC,sans-serif"><text x="32" y="44" font-size="28">城市比例＋60% · Jill 保持约 1.73 米</text><text x="32" y="76" font-size="17">现有街区 0.45 → 0.72 / 实际游戏画面 / 连衣裙与新高跟鞋</text><text x="32" y="856" font-size="28">上传城市场景 · 东侧新增街区</text><text x="32" y="888" font-size="17">独立米制坐标 / 建筑、停放车辆碰撞 / 街道导航与女性市民</text></g></svg>');
 await sharp(svg).composite(images.map((input,i)=>({input,left:0,top:96+i*812}))).png().toFile(path.join(output,'city-update-preview.png'));
 if(errors.length)throw Error(errors.join('\n'));
 await fs.writeFile(path.join(output,'world-render-check.json'),JSON.stringify({status:'passed',errors,records},null,2)+'\n');
}finally{await browser?.close();server.close();}
