// Render the running application; no generated imagery and no Android build.
// Optional env: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, PREVIEW_OUTPUT,
// PREVIEW_CAPTURE=0 to run the browser checks without recapturing stills.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../web/',import.meta.url));
const output=path.resolve(process.env.PREVIEW_OUTPUT||'artifacts/city-preview');
await fs.mkdir(output,{recursive:true});
const types={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',glb:'model/gltf-binary',svg:'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!filename.startsWith(root))throw new Error('Invalid path');
    const bytes=await fs.readFile(filename);
    res.writeHead(200,{'Content-Type':types[filename.split('.').pop()]||'application/octet-stream','Content-Length':bytes.length});
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true,
    ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),
    args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.setDefaultTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/?diagnostics=1`);
  await page.waitForFunction(()=>window.__heelMotionSnapshot?.().loaded&&window.__heelMotionSnapshot().shoeClearance!==null,{timeout:120000});
  const initial=await page.evaluate(()=>window.__heelMotionSnapshot());
  assert.equal(initial.city.drawMeshes,22);assert.equal(initial.animations.length,4);
  assert.equal(initial.cameraDistance,3.5);assert.equal(initial.groundY,0);
  assert.ok(initial.shoeClearance>=.00099,'heels rest on asphalt');
  const captureStyle=await page.addStyleTag({content:'#app > :not(canvas){visibility:hidden!important}'});
  const views={
    'luna15-city-preview':{position:[3,3.3,10],target:[-2,2,-18]},
    'city-overview':{position:[105,145,115],target:[-45,0,-30]}
  };
  for(const [name,camera] of process.env.PREVIEW_CAPTURE==='0'?[]:Object.entries(views)){
    const previous=await page.evaluate(camera=>{window.__heelMotionPreviewCamera(camera);return window.__heelMotionSnapshot().frames;},camera);
    await page.waitForFunction(previous=>window.__heelMotionSnapshot().frames>previous+2,previous);
    await page.screenshot({path:path.join(output,name+'.png')});
  }
  // Use actual keyboard and visible-button events to exercise all four clips.
  await captureStyle.evaluate(element=>element.remove());
  await page.evaluate(()=>window.__heelMotionPreviewCamera(null));
  const states=[];
  for(const run of [false,true]){
    await page.locator('#reset').click({force:true});
    if(run)await page.locator('#run').click({force:true});
    await page.keyboard.down('KeyW');
    await page.waitForFunction(run=>{
      const state=window.__heelMotionSnapshot();
      return state.speed>(run?2:.7)&&state.state===(run?'跑步':'走路')&&state.weights[run?'Run_Heels':'Walk_Heels']>.8;
    },run);
    const state=await page.evaluate(()=>window.__heelMotionSnapshot());
    assert.ok(state.position.z<0,'camera-relative forward travels north on the street');
    assert.ok(state.shoeClearance>=.00099);
    states.push(state.state);
    await page.keyboard.up('KeyW');
    await page.waitForFunction(()=>window.__heelMotionSnapshot().speed===0);
  }
  await page.locator('#aim').click({force:true});
  await page.waitForFunction(()=>window.__heelMotionSnapshot().weights.Rifle_Aim_Idle>.99);
  states.push((await page.evaluate(()=>window.__heelMotionSnapshot())).state);
  assert.deepEqual(states,['走路','跑步','瞄准待机']);
  assert.deepEqual(errors,[]);
  const report={status:'passed',loaded:initial.loaded,animations:initial.animations,
    city:initial.city,shoeClearanceMetres:initial.shoeClearance,states,browserErrors:errors};
  await fs.writeFile(path.join(output,'preview-check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();server.close();
}
