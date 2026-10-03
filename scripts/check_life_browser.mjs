// Offline browser integration: actual UI, GLBs, WebGL and multi-pointer input.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(fileURLToPath(new URL('../web/',import.meta.url)));
const output=path.resolve(process.env.LIFE_OUTPUT||'artifacts/life-v1');await fs.mkdir(output,{recursive:true});
const types={html:'text/html;charset=utf-8',js:'text/javascript',css:'text/css',glb:'model/gltf-binary',woff2:'font/woff2'};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!filename.startsWith(root+path.sep))throw new Error('Invalid path');const bytes=await fs.readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename).slice(1)]||'application/octet-stream','Content-Length':bytes.length});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:960,height:540},hasTouch:true,deviceScaleFactor:1});
 page=await context.newPage();page.setDefaultTimeout(90000);const errors=[],requests=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('console',e=>{if(e.type()==='error'){errors.push(e.text());console.error('CONSOLE',e.text());}});page.on('request',r=>requests.push(r.url()));
 const url=`http://127.0.0.1:${server.address().port}/?diagnostics=1`;
 await page.goto(url);await page.waitForFunction(()=>window.__lifeSnapshot?.().loaded&&window.__lifeSnapshot().frames>1,null,{timeout:120000});
 const snap=()=>page.evaluate(()=>window.__lifeSnapshot());const teleport=(area,x,z)=>page.evaluate(p=>window.__lifeTest.teleport(...p),[area,x,z]);const action=(name,value)=>page.locator(`[data-action="${name}"]${value===undefined?'':`[data-value="${value}"]`}`).click();
 console.log('loaded',JSON.stringify({city:(await snap()).city,npcCount:(await snap()).npcs.length}));await page.screenshot({path:path.join(output,'main-menu.png')});
 if(process.env.LIFE_SMOKE_ONLY==='1'){assert.deepEqual(errors,[]);console.log('SMOKE PASSED');}
 else{
 await page.locator('#new-game').click();assert.equal((await snap()).player.area,'home');
 await teleport('home',0,11.9);await page.locator('#interact').click();await action('accept','new-life');await page.locator('#close-panel').click();
 await teleport('home',0,7.9);await page.locator('#interact').click();assert.equal((await snap()).player.area,'city');
 await teleport('city',-1.1,-2.5);await page.locator('#interact').click();assert.equal((await snap()).modal,'dialog');await action('gift');assert.equal((await snap()).player.outfit.preset,'street');await action('shop');await action('buy','city-bag');await action('buy','night-dress');await action('wardrobe');await action('outfit','night');await page.locator('#close-panel').click();
 await teleport('city',0,0);await page.waitForFunction(()=>window.__lifeSnapshot().frames>5);await page.screenshot({path:path.join(output,'city-day.png')});
 await teleport('city',-3.1,2.2);await page.locator('#interact').click();let state=await snap();assert.ok(state.player.mission.completed.includes('new-life'));assert.equal(state.player.money,420); // 500 -80 -300 +300
 await teleport('home',0,11.9);await page.locator('#interact').click();await action('accept','delivery');await page.locator('#close-panel').click();await teleport('home',0,7.9);await page.locator('#interact').click();
 await teleport('city',-1.4,-5.8);await page.locator('#interact').click();assert.ok((await snap()).player.inventory.includes('parcel'));
 await teleport('city',15,-8.9);await page.locator('#interact').click();await action('deliver');await page.locator('#close-panel').click();assert.equal((await snap()).player.money,920);
 await teleport('city',.6,1.5);await page.locator('#interact').click();await action('accept','nightlife');await page.locator('#close-panel').click();
 await page.evaluate(()=>window.__lifeTest.time(0));await teleport('city',0,-15.8);await page.locator('#interact').click();await page.locator('#close-panel').click();state=await snap();assert.equal(state.player.money,1120);assert.equal(state.player.mission.completed.length,3);
 await page.screenshot({path:path.join(output,'city-night.png')});
 await teleport('city',-2.7,-2.5);await page.locator('#interact').click();assert.equal((await snap()).modal,null,'closed shop does not open at midnight');
 await page.evaluate(()=>window.__lifeTest.time(12));await teleport('city',0,0);await page.locator('#aim').click();await page.waitForFunction(()=>window.__lifeSnapshot().weights.Rifle_Aim_Idle>.99);assert.ok((await snap()).actualCameraDistance<2&& (await snap()).actualCameraDistance>1.6);await page.locator('#aim').click();
 // Genuine two-finger input: stick movement plus the run button.
 const cdp=await context.newCDPSession(page),stick=await page.locator('#joystick').boundingBox(),run=await page.locator('#run').boundingBox();
 const first={x:stick.x+stick.width/2,y:stick.y+stick.height*.17,id:1,radiusX:5,radiusY:5};const second={x:run.x+run.width/2,y:run.y+run.height/2,id:2,radiusX:5,radiusY:5};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});await page.waitForFunction(()=>window.__lifeSnapshot().speed>.6);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first,second]});await page.waitForFunction(()=>window.__lifeSnapshot().running,null,{timeout:5000});await page.waitForFunction(()=>window.__lifeSnapshot().speed>1.8&&window.__lifeSnapshot().stateId==='Run');assert.equal((await snap()).stateId,'Run');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>window.__lifeSnapshot().speed===0);assert.ok((await snap()).shoeClearance>=-.002);
 const npcPositions=await page.evaluate(()=>window.__lifeTest.simulateNPCs(180));assert.equal(npcPositions.length,8);assert.equal((await snap()).npcDebug.invalidPositions,0);
 await teleport('city',3.65,0);await page.waitForFunction(()=>window.__lifeSnapshot().actualCameraDistance<2.15);assert.ok((await snap()).actualCameraDistance<2.2,'camera shortens at facade');
 await teleport('city',0,2);await page.locator('#pause').click();await action('map');await page.screenshot({path:path.join(output,'city-map.png')});await page.locator('#close-panel').click();
 await page.locator('#pause').click();await action('wardrobe');await page.screenshot({path:path.join(output,'wardrobe.png')});await page.locator('#close-panel').click();
 await page.locator('#pause').click();await action('settings');await action('save');const before=(await snap()).player;await page.reload();await page.waitForFunction(()=>window.__lifeSnapshot?.().loaded,null,{timeout:120000});await page.locator('#continue-game').click();state=await snap();assert.equal(state.player.money,before.money);assert.deepEqual(state.player.mission.completed,before.mission.completed);assert.equal(state.player.outfit.preset,'night');assert.ok(Math.abs(state.player.position.x-before.position.x)<.01&&Math.abs(state.player.position.z-before.position.z)<.01);assert.ok(Math.abs(state.player.timeMinutes-before.timeMinutes)<3);
 for(const size of [{width:640,height:360},{width:866,height:390},{width:1280,height:720}]){await page.setViewportSize(size);await page.locator('#pause').click();await action('wardrobe');const box=await page.locator('.panel').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+.1&&box.y+box.height<=size.height+.1);await page.locator('#close-panel').click();const joystick=await page.locator('#joystick').boundingBox(),run=await page.locator('#run').boundingBox();assert.ok(joystick.x+joystick.width<run.x&&run.y+run.height<=size.height);}
 assert.ok(requests.every(r=>r.startsWith(`http://127.0.0.1:${server.address().port}/`)||r.startsWith('data:')||r.startsWith(`blob:http://127.0.0.1:${server.address().port}/`)),'no external runtime requests');assert.deepEqual(errors,[]);
 const report={status:'passed',missions:state.player.mission.completed,money:state.player.money,outfit:state.player.outfit,restored:true,multiTouch:true,layouts:[640,866,1280],npcCount:8,npcInvalidPositions:0,browserErrors:errors,city:state.city,offline:true};await fs.writeFile(path.join(output,'browser-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }
}catch(error){if(page){console.error('FAILURE',JSON.stringify(await page.evaluate(()=>window.__lifeSnapshot?.())));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}throw error;}finally{await browser?.close();server.close();}
