// Render the real game assets and wardrobe bindings, with no replacement imagery.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const sharp=(await import(process.env.SHARP_MODULE||'sharp')).default;
const root=path.resolve(fileURLToPath(new URL('../web/',import.meta.url)));
const output=path.resolve(process.env.ADA_PREVIEW_OUTPUT||'artifacts/ada-outfit');await fs.mkdir(output,{recursive:true});
const html=`<!doctype html><html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#c6ced7}canvas{width:100%;height:100%}</style><canvas></canvas><script type="module">
import * as T from '/vendor/three.module.js';import {GLTFLoader} from '/vendor/GLTFLoader.js';
import {Avatar} from '/avatar.js';import {MovementController} from '/movement.js';import {OUTFITS} from '/life-data.js';import {usesHeelPosture} from '/wardrobe-attachments.js';
const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene();scene.background=new T.Color('#c6ced7');scene.add(new T.HemisphereLight('#ffffff','#7b8390',2.2));const sun=new T.DirectionalLight('#fff3e9',3);sun.position.set(2.5,4,3.5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-1.8,right:1.8,top:2.5,bottom:-1.5,near:.1,far:12});sun.shadow.bias=-.00005;scene.add(sun);
const fill=new T.DirectionalLight('#e1edff',1.6);fill.position.set(-3,2,-2);scene.add(fill);
const floor=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshStandardMaterial({color:'#c6ced7',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const camera=new T.PerspectiveCamera(32,innerWidth/innerHeight,.01,40),actor=new T.Group();scene.add(actor);
const loader=new GLTFLoader(),[barefoot,heels,top,shoes]=await Promise.all(['jill-barefoot-locomotion','jill-heels-locomotion','ada-top','ada-shoes'].map(name=>loader.loadAsync('/assets/'+name+'.glb')));
const controller=new MovementController(),assets={top,shoes},avatars={barefoot:new Avatar(barefoot,controller,assets),heels:new Avatar(heels,controller,assets)};actor.add(avatars.barefoot.root,avatars.heels.root);
window.pose=(id,clip='Idle_Heels',phase=0,elapsed=0)=>{const outfit=OUTFITS.find(o=>o.id===id);if(!outfit)throw new Error('Unknown outfit');const active=usesHeelPosture(outfit.slots.shoes)?avatars.heels:avatars.barefoot;for(const a of Object.values(avatars)){a.root.visible=a===active;a.outfit(outfit.slots);}actor.position.set(0,0,0);active.update(Object.fromEntries(['Idle_Heels','Walk_Heels','Run_Heels','Rifle_Aim_Idle'].map(name=>[name,Number(name===clip)])),phase,elapsed);actor.updateMatrixWorld(true);active.ground(actor,()=>0,0);return {scale:actor.scale.toArray(),heelPosture:active===avatars.heels,clearance:active.clearance,topMeshes:active.attachments.meshes.top.filter(m=>m.visible).length,shoeMeshes:active.attachments.meshes.shoes.filter(m=>m.visible).length};};
window.view=name=>{const views={front:[[1.65,1.14,3.45],[0,.87,0]],back:[[-1.65,1.14,-3.45],[0,.87,0]],side:[[3.9,1.15,0],[0,.87,0]],shoes:[[.64,.38,.9],[0,.11,0]]};const [position,target]=views[name];camera.fov=name==='shoes'?28:32;camera.updateProjectionMatrix();camera.position.fromArray(position);camera.lookAt(...target);renderer.render(scene,camera);};window.pose('ada-set');window.view('front');window.ready=true;
</script></html>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!filename.startsWith(root+path.sep))throw new Error('Invalid path');const bytes=await fs.readFile(filename);res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'text/javascript':'application/octet-stream','Content-Length':bytes.length});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:760,height:1000}}),errors=[],records=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready,null,{timeout:60000});
 for(const [id,title,file,views] of [['ada-top-only','仅穿上衣 · 赤脚','ada-top-only-preview.png',['front','back']],['ada-shoes-only','仅穿高跟鞋','ada-shoes-only-preview.png',['back','shoes']],['ada-set','上衣＋高跟鞋','ada-top-and-shoes-preview.png',['front','back']]]){
  const stats=await page.evaluate(id=>window.pose(id),id),parts=[];for(const view of views){await page.evaluate(view=>window.view(view),view);parts.push(await page.screenshot());}
  const labels=views.map(view=>view==='front'?'正面穿着':view==='back'?'背面穿着':'鞋子穿着细节');
  const svg=Buffer.from('<svg width="1520" height="1140" xmlns="http://www.w3.org/2000/svg"><rect width="1520" height="1140" fill="#c6ced7"/><g fill="#263a49" font-family="Noto Sans CJK SC,sans-serif"><text x="42" y="50" font-size="30">JILL · '+title+'</text><text x="42" y="82" font-size="16">实际游戏模型 / 原始角色尺寸 / 独立衣柜槽位</text><text x="42" y="1118" font-size="17">'+labels[0]+'</text><text x="802" y="1118" font-size="17">'+labels[1]+'</text></g></svg>');
  const filename=path.join(output,file);await sharp(svg).composite(parts.map((input,i)=>({input,left:i*760,top:96}))).png().toFile(filename);records.push({id,filename,...stats});
 }
 if(process.env.ADA_POSE_QA==='1')for(const clip of ['Walk_Heels','Run_Heels','Rifle_Aim_Idle']){await page.evaluate(clip=>window.pose('ada-set',clip,.28,.28),clip);await page.evaluate(()=>window.view('front'));await page.screenshot({path:path.join(output,clip+'-fit.png')});}
 if(errors.length)throw new Error(errors.join('\n'));console.log(JSON.stringify({previews:records,errors},null,2));
}finally{await browser?.close();server.close();}
