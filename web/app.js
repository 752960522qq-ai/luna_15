import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {MovementController} from './movement.js';
import {cityWorld,cameraFraction,groundSampler} from './city.js';
import {PlayerState,createPlayerState,replacePlayerState} from './player-state.js';
import {GameClock,MissionSystem,ShopSystem,SaveSystem} from './game-systems.js';
import {InteractionSystem} from './interaction.js';
import {NavigationNetwork,pointWalkable} from './navigation.js';
import {NPCManager} from './npcs.js';
import {Avatar} from './avatar.js';
import {createHome,addCityProps,marker} from './world-props.js';
import {LOCATIONS} from './life-data.js';
import {MobileControls} from './controls.js';
import {GameUI} from './game-ui.js';

const $=id=>document.getElementById(id),player=PlayerState;
const canvas=$('scene'),controller=new MovementController(),actor=new THREE.Group();
const cameraState={yaw:.3,pitch:.22,foot:false};
let renderer,scene,camera,world,sampleCity,network,npcs,props,avatars,selectedAvatar,cityRoot;
let ready=false,mode='loading',frames=0,groundY=0,actualCameraDistance=0,lastFrame=performance.now(),lastHud=0,autosave=0,visualTime=0,talking=null,previewCamera=null,settingsChanged=false;
const home=createHome(),npcGroup=new THREE.Group(),propGroup=new THREE.Group();
const saveSystem=new SaveSystem(localStorage),clock=new GameClock(player);
let saved=saveSystem.load();if(saved)Object.assign(player.settings,saved.settings);
const missions=new MissionSystem(player,m=>{ui.toast(`${m.name}完成 · +¥ ${m.reward}`);saveGame(false);});
const shop=new ShopSystem(player,()=>{applyOutfit();missions.updateLocation();});
const interactions=new InteractionSystem(player);
const ui=new GameUI(player,missions,{action:handleAction,world:()=>world,modal:enabled=>{
  controls.enable(!enabled&&mode==='play');controller.setInteract(enabled&&mode==='play');
  if(!enabled&&talking){npcs.talk(talking,false);talking=null;}
}});
const controls=new MobileControls(canvas,cameraState,{aim:()=>controller.setAim(!controller.aiming),interact:()=>interactions.interact(),pause:()=>{
  if(mode!=='play')return;if(ui.view)ui.close();else ui.open('pause');
}});

function fail(message,error){ready=false;mode='error';controls.enable(false);$('loading').hidden=false;$('loading').classList.add('error');$('loading').querySelector('strong').textContent='场景暂时无法载入';$('load-detail').textContent=message;$('retry').hidden=false;console.error(error||message);}
$('retry').addEventListener('click',()=>location.reload());
function saveGame(show=true){if(!ready||mode==='main')return false;try{syncPosition();saveSystem.save(player);saved=saveSystem.load();if(show)ui.toast('游戏已保存');return true;}catch(error){ui.toast(error.message);return false;}}
function syncPosition(){Object.assign(player.position,{x:controller.x,y:groundY,z:controller.z,yaw:controller.yaw});}
function applyOutfit(){if(!avatars)return;selectedAvatar=player.outfit.shoes==='black-heels'?avatars.heels:avatars.barefoot;for(const avatar of Object.values(avatars)){avatar.root.visible=avatar===selectedAvatar;avatar.outfit(player.outfit);}}
function activeWorld(){return player.area==='city'?world:home.world;}
function ground(x,z){return player.area==='city'?sampleCity(x,z):0;}
function setArea(area,position=null){
  player.area=area;controller.setWorld(activeWorld());const pose=position||{...(area==='city'?LOCATIONS.citySpawn:home.world.spawn),yaw:Math.PI};
  if(!pointWalkable(activeWorld(),pose.x,pose.z,.26)){Object.assign(pose,area==='city'?LOCATIONS.citySpawn:home.world.spawn);}
  controller.setPose(pose);groundY=ground(controller.x,controller.z);syncPosition();
  home.group.visible=area==='home';cityRoot.visible=propGroup.visible=npcGroup.visible=area==='city';
  npcs?.update(0);cameraState.yaw=.3;camera.position.set(0,0,0);look.set(controller.x,groundY+.95,controller.z);missions.updateLocation();
}
function startNew(){if(!ready)return;saveSystem.clear();const preferences={...player.settings};replacePlayerState(player,createPlayerState());Object.assign(player.settings,preferences);settingsChanged=false;mode='play';ui.close();$('main-menu').hidden=true;$('hud').hidden=false;applyQuality();applyOutfit();setArea('home');controls.enable(true);autosave=0;saveGame(false);ui.toast('欢迎来到 Luna。走到门口开始探索。');}
function continueGame(){if(!ready)return;const value=saveSystem.load();if(!value){ui.toast('还没有可恢复的存档');return;}const preferences={...player.settings};replacePlayerState(player,value);if(settingsChanged)Object.assign(player.settings,preferences);settingsChanged=false;mode='play';ui.close();$('main-menu').hidden=true;$('hud').hidden=false;applyQuality();applyOutfit();setArea(player.area,{...player.position});controls.enable(true);autosave=0;}
function mainMenu(){saveGame(false);ui.close();mode='main';controls.enable(false);controller.setInteract(false);$('hud').hidden=true;$('main-menu').hidden=false;saved=saveSystem.load();$('continue-game').disabled=!saved;}
$('new-game').addEventListener('click',()=>{if(saved){ui.open('new-confirm');$('panel-title').textContent='开始新的生活？';$('panel-content').innerHTML='<p class="dialog-text">新的生活将替换当前存档。</p><div class="row"><button data-action="new" class="primary">开始新游戏</button><button data-action="resume">取消</button></div>';}else startNew();});
$('continue-game').addEventListener('click',continueGame);$('main-settings').addEventListener('click',()=>ui.open('settings'));
function openDialog(npc){talking=npc.id;npcs.talk(npc.id,true);missions.event('talk',{npc:npc.id});ui.open('dialog',npc);}
function handleAction(action,value){
  if(action==='resume'){ui.close();return;}if(action==='new'){startNew();return;}if(action==='main'){mainMenu();return;}
  if(['map','missions','wardrobe','settings','rest'].includes(action)){ui.open(action);return;}
  if(action==='accept'){const m=missions.accept(value);ui.toast(`已接取：${m.name}`);saveGame(false);ui.refresh();return;}
  if(action==='shop'){if(!shopOpen())return;ui.open('shop');return;}
  if(action==='gift'){if(missions.active?.id!=='new-life'||missions.step?.kind!=='own')throw new Error('当前没有可领取的服装');shop.grant(['street-top','city-bottom']);shop.equip('street');saveGame(false);ui.toast('获得街头套装，请返回公寓');ui.refresh();return;}
  if(action==='deliver'){if(!missions.event('deliver',{npc:'npc-recipient'}))throw new Error('没有可交付的包裹');ui.toast('包裹已送达');saveGame(false);ui.refresh();return;}
  if(action==='buy'){const item=shop.buy(value);missions.updateLocation();saveGame(false);ui.toast(`已购买 ${item.name}`);ui.refresh();return;}
  if(action==='outfit'){shop.equip(value);saveGame(false);ui.refresh();return;}
  if(action==='slot'){const [type,id]=value.split(':');shop.equipSlot(type,id==='none'?null:id);saveGame(false);ui.refresh();return;}
  if(action==='time'){clock.skipTo(Number(value));missions.updateLocation();saveGame(false);ui.close();ui.toast(`休息到 ${String(value).padStart(2,'0')}:00`);return;}
  if(action==='quality'){player.settings.quality=value;settingsChanged=true;applyQuality();saveGame(false);ui.refresh();return;}
  if(action==='distance'){player.settings.cameraDistance=Number(value);settingsChanged=true;saveGame(false);ui.refresh();return;}
  if(action==='foot'){cameraState.foot=!cameraState.foot;ui.close();return;}
  if(action==='reset'){setArea('home');cameraState.foot=false;ui.close();saveGame(false);return;}
  if(action==='save'){saveGame();return;}
}
function shopOpen(){const h=player.timeMinutes/60;if(h<8||h>=20){ui.toast('服装店营业时间 08:00～20:00');return false;}return true;}
function registerInteractions(){
  const register=(id,type,area,position,label,interact,extra={})=>interactions.register({id,type,area,position,label,interact,...extra});
  register('home-exit','door','home',{x:0,z:7.65},'出门',()=>{setArea('city');saveGame(false);});
  register('home-door','door','city',LOCATIONS.homeDoor,'回家',()=>{setArea('home');saveGame(false);});
  register('wardrobe','wardrobe','home',{x:-2,z:10.5},'衣柜',()=>ui.open('wardrobe'));
  register('save','save','home',{x:2,z:10.5},'保存',()=>saveGame());
  register('bed','rest','home',{x:-1,z:8.5},'休息',()=>ui.open('rest'));
  register('mission-board','task','home',{x:0,z:12.3},'任务',()=>ui.open('missions'));
  register('shop','shop','city',LOCATIONS.shop,'商店',()=>{if(shopOpen())ui.open('shop');}, {radius:.65});
  register('parcel','pickup','city',LOCATIONS.parcel,'拾取',()=>{if(!player.inventory.includes('parcel'))player.inventory.push('parcel');missions.event('pickup',{item:'parcel'});ui.toast('已接取包裹');saveGame(false);},{enabled:()=>missions.active?.id==='delivery'&&missions.step?.kind==='pickup'});
  for(const n of npcs.npcs)register(n.id,'npc','city',()=>n.position,'交谈',()=>openDialog(n),{radius:1.6});
  // A vehicle can register the same interface later; driving is not active.
}
function applyQuality(){if(!renderer)return;const low=player.settings.quality==='low';renderer.setPixelRatio(low?1:Math.min(devicePixelRatio||1,1.35));renderer.shadowMap.enabled=!low;resize();}
function resize(){if(!renderer||!camera)return;const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
const target=new THREE.Vector3(),desired=new THREE.Vector3(),look=new THREE.Vector3(),offset=new THREE.Vector3(16,28,12),lightTarget=new THREE.Vector3(),shoulder=new THREE.Vector3();
let sun,hemi,roomLight,nightLights=[],lastLighting=-100;
const timeColors=[new THREE.Color('#101c3c'),new THREE.Color('#d8b4a0'),new THREE.Color('#a9c7dd'),new THREE.Color('#bb928b'),new THREE.Color('#101c3c')],sunColors=[new THREE.Color('#98aad4'),new THREE.Color('#ffd1a0'),new THREE.Color('#fff1dc'),new THREE.Color('#ffbc88'),new THREE.Color('#98aad4')];
function lighting(){const t=player.timeMinutes/360,i=Math.floor(t),f=t-i;scene.background.copy(timeColors[i]).lerp(timeColors[i+1],f);scene.fog.color.copy(scene.background);const day=Math.max(0,Math.sin((player.timeMinutes-360)/1440*Math.PI*2));sun.intensity=.18+day*2.9;sun.color.copy(sunColors[i]).lerp(sunColors[i+1],f);hemi.intensity=.65+day*1.55;roomLight.visible=player.area==='home';const night=1-day;for(const lamp of props.lamps)lamp.material.emissiveIntensity=night*2.5;const nearest=[...props.lamps].sort((a,b)=>a.position.distanceToSquared(actor.position)-b.position.distanceToSquared(actor.position));for(let n=0;n<nightLights.length;n++){nightLights[n].visible=player.area==='city'&&night>.2;nightLights[n].intensity=night*10;nightLights[n].position.copy(nearest[n].position);}lastLighting=visualTime;}

async function load(){
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    scene=new THREE.Scene();scene.background=new THREE.Color('#a9c7dd');scene.fog=new THREE.Fog('#a9c7dd',90,240);camera=new THREE.PerspectiveCamera(46,1,.03,300);
    hemi=new THREE.HemisphereLight('#d6eef7','#727b62',2.2);scene.add(hemi);sun=new THREE.DirectionalLight('#fff2de',3.1);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:.5,far:65});sun.shadow.bias=-.0001;sun.shadow.normalBias=.015;scene.add(sun,sun.target);roomLight=new THREE.PointLight('#ffe0bb',12,8,2);roomLight.position.set(0,2.6,10);scene.add(roomLight);for(let i=0;i<2;i++){const light=new THREE.PointLight('#ffd38f',8,11,2);scene.add(light);nightLights.push(light);}
    scene.add(actor,home.group,npcGroup,propGroup);applyQuality();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    const loader=new GLTFLoader();let done=0;const progress=name=>{done++;$('load-progress').style.width=`${Math.round(done/4*100)}%`;$('load-detail').textContent=name;};
    const [city,barefoot,heels]=await Promise.all([
      loader.loadAsync('./assets/city-neighborhood.glb').then(g=>{progress('街区已读取');return g;}),
      loader.loadAsync('./assets/jill-barefoot-locomotion.glb').then(g=>{progress('默认人物已读取');return g;}),
      loader.loadAsync('./assets/jill-heels-locomotion.glb').then(g=>{progress('高跟鞋姿态已读取');return g;})]);
    world=cityWorld(city);cityRoot=city.scene;scene.add(cityRoot);sampleCity=groundSampler(cityRoot);network=new NavigationNetwork(world);props=addCityProps(propGroup);marker(home.group,{x:0,z:7.65},'#8bddca');
    avatars={barefoot:new Avatar(barefoot,controller),heels:new Avatar(heels,controller)};actor.add(avatars.barefoot.root,avatars.heels.root);applyOutfit();
    npcs=new NPCManager(network,player,npcGroup,sampleCity);await npcs.load(loader);progress('市民和街道导航准备完成');registerInteractions();
    ready=true;setArea('home');mode='main';$('loading').hidden=true;$('main-menu').hidden=false;$('continue-game').disabled=!saved;lighting();
    requestAnimationFrame(frame);
  }catch(error){fail('离线资源或图形环境加载失败，请点击重新加载。',error);}
}
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;if(document.hidden)return;visualTime+=dt;
  if(mode==='play'&&!ui.view){
    const running=controls.run&&!player.flags.exhausted;controller.update(dt,controls.input(),cameraState.yaw,running);
    if(running&&controller.speed>1.05){player.stamina=Math.max(0,player.stamina-dt*4.5);if(player.stamina===0)player.flags.exhausted=true;}else{player.stamina=Math.min(100,player.stamina+dt*8);if(player.stamina>=25)player.flags.exhausted=false;}
    groundY=ground(controller.x,controller.z);syncPosition();clock.update(dt);missions.updateLocation();npcs.update(dt);autosave+=dt;if(autosave>=15){saveGame(false);autosave=0;}
  }else{controller.update(dt,{x:0,forward:0},cameraState.yaw,false);}
  actor.position.set(controller.x,groundY,controller.z);actor.rotation.y=controller.yaw;selectedAvatar.update(controller.weights,controller.phase,controller.elapsed);actor.updateMatrixWorld(true);selectedAvatar.ground(actor,ground,groundY);
  props.markers.parcel.visible=!player.inventory.includes('parcel')&&!player.mission.completed.includes('delivery');
  lightTarget.set(controller.x,groundY,controller.z);sun.target.position.copy(lightTarget);sun.position.copy(lightTarget).add(offset);if(visualTime-lastLighting>.4)lighting();
  const aiming=controller.aiming&&!cameraState.foot,height=cameraState.foot?.27:aiming?1.18:.95,distance=cameraState.foot?1.5:aiming?1.85:player.settings.cameraDistance,pitch=cameraState.foot?.1:cameraState.pitch;
  target.set(controller.x,groundY+height,controller.z);shoulder.copy(target);if(aiming){shoulder.x+=Math.cos(cameraState.yaw)*.24;shoulder.z-=Math.sin(cameraState.yaw)*.24;shoulder.lerpVectors(target,shoulder,cameraFraction(activeWorld(),target,shoulder));}
  desired.set(shoulder.x+Math.sin(cameraState.yaw)*distance*Math.cos(pitch),shoulder.y+Math.sin(pitch)*distance,shoulder.z+Math.cos(cameraState.yaw)*distance*Math.cos(pitch));desired.lerpVectors(shoulder,desired,cameraFraction(activeWorld(),shoulder,desired));desired.y=Math.max(groundY+.18,desired.y);
  if(camera.position.lengthSq()===0)camera.position.copy(desired);else camera.position.lerp(desired,1-Math.exp(-dt*9));camera.position.lerpVectors(shoulder,camera.position,cameraFraction(activeWorld(),shoulder,camera.position));look.lerp(shoulder,1-Math.exp(-dt*12));camera.lookAt(look);if(previewCamera){camera.position.fromArray(previewCamera.position);target.fromArray(previewCamera.target);camera.lookAt(target);}actualCameraDistance=camera.position.distanceTo(shoulder);
  if(now-lastHud>120){ui.hud(interactions.update(),controller);lastHud=now;}
  renderer.render(scene,camera);frames++;
}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('图形环境已暂停，请点击重新加载。');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame(false);lastFrame=performance.now();});window.addEventListener('pagehide',()=>saveGame(false));window.addEventListener('blur',()=>saveGame(false));

if(new URLSearchParams(location.search).get('diagnostics')==='1'){
  const snapshot=()=>({...controller.snapshot(),stateId:controller.stateId,running:controls.run,stick:{x:controls.stick.x,forward:controls.stick.forward,pointer:controls.stick.pointer},loaded:ready,mode,animations:selectedAvatar?Object.keys(selectedAvatar.actions):[],weights:controller.weights,frames,footView:cameraState.foot,cameraDistance:player.settings.cameraDistance,actualCameraDistance,host:location.hostname,characterScale:actor.scale.toArray(),groundY,shoeClearance:selectedAvatar?.clearance??null,player:JSON.parse(JSON.stringify(player)),modal:ui.view,interaction:interactions.closest?.id||null,city:world?{name:world.name,unit:world.unit,scale:world.scale,bounds:world.bounds,drawMeshes:world.drawMeshes}:null,navigationNodes:network?.nodes.length||0,npcs:npcs?.snapshot()||[],npcDebug:npcs?.debug,drawCalls:renderer?.info.render.calls||0,saveError:saveSystem.error,cameraPosition:camera?.position.toArray()});
  window.__heelMotionSnapshot=snapshot;window.__lifeSnapshot=snapshot;
  window.__heelMotionPreviewCamera=value=>{if(value===null){previewCamera=null;return;}for(const k of ['position','target'])if(!Array.isArray(value?.[k])||value[k].length!==3||!value[k].every(Number.isFinite))throw new Error('Expected camera vectors');previewCamera=value;};
  // Only enabled in an explicitly requested diagnostic launch. Business flows
  // still use the same UI and interact(player), with normal proximity checks.
  window.__lifeTest={teleport:(area,x,z,yaw=Math.PI)=>{if(!ready)throw new Error('Not ready');if(!pointWalkable(area==='city'?world:home.world,x,z,.26))throw new Error('Position is blocked');ui.close();setArea(area,{x,z,yaw});interactions.update();ui.hud(interactions.closest,controller);},time:hour=>clock.skipTo(hour),simulateNPCs:seconds=>{for(let t=0;t<seconds;t+=.05)npcs.update(.05);return npcs.snapshot();}};
}
load();
