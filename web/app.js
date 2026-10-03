import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MovementController, MOTION } from './movement.js?v=city-1';
import { cityWorld, cameraFraction, groundSampler } from './city.js?v=city-scale-045';

const $=id=>document.getElementById(id);
const canvas=$('scene'),loading=$('loading');
const controller=new MovementController();
const keys=new Set();
const stick={x:0,forward:0,pointer:null};
const CAMERA_DISTANCE=2.2,CAMERA_TARGET_HEIGHT=.9;
const cameraState={yaw:Math.PI+.30,pitch:.22,distance:CAMERA_DISTANCE,foot:false,drag:null};
let runMode=false,ready=false,mixer,actions={},actor=new THREE.Group(),lastFrame=performance.now(),lastHud=0;
let renderer,renderFrames=0,world=null,previewCamera=null,sampleGround=null,currentGroundY=0,lastShoeMinimum=null,reframeCamera=null,actualCameraDistance=0;
if(new URLSearchParams(location.search).get('diagnostics')==='1'){
  window.__heelMotionSnapshot=()=>({...controller.snapshot(),loaded:ready,running:runMode,
    animations:Object.keys(actions),weights:controller.weights,frames:renderFrames,footView:cameraState.foot,cameraDistance:cameraState.distance,host:location.hostname,
    groundY:currentGroundY,shoeClearance:lastShoeMinimum===null?null:lastShoeMinimum-currentGroundY,
    actualCameraDistance,characterScale:actor.scale.toArray(),
    city:world?{name:world.name,unit:world.unit,scale:world.scale,bounds:world.bounds,drawMeshes:world.drawMeshes}:null});
  // Development-only still rendering. The normal camera and controls keep
  // their existing close third-person defaults when diagnostics is absent.
  window.__heelMotionPreviewCamera=value=>{
    if(value===null){previewCamera=null;return;}
    for(const key of ['position','target'])if(!Array.isArray(value?.[key])||value[key].length!==3||!value[key].every(Number.isFinite))throw new Error('Expected two camera vectors');
    previewCamera={position:[...value.position],target:[...value.target]};
  };
}

function fail(message,error){
  ready=false;loading.hidden=false;loading.classList.add('error');
  loading.querySelector('strong').textContent='场景暂时无法载入';
  $('load-detail').textContent=message;$('retry').hidden=false;
  if(error)console.error(error);
}
$('retry').addEventListener('click',()=>location.reload());
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.1;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
}catch(error){fail('浏览器需要支持 WebGL 2，请换用新版浏览器。',error);}

if(renderer){
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#a9c7dd');
  scene.fog=new THREE.Fog('#a9c7dd',120,550);
  const camera=new THREE.PerspectiveCamera(46,1,.03,900);
  const hemi=new THREE.HemisphereLight('#d6eef7','#727b62',2.2);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff2de',3.1);sun.position.set(35,65,25);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-25;sun.shadow.camera.right=25;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-25;
  sun.shadow.camera.near=.5;sun.shadow.camera.far=130;sun.shadow.bias=-.0001;sun.shadow.normalBias=.015;
  scene.add(sun,sun.target);
  scene.add(actor);

  const target=new THREE.Vector3(0,1,0),cameraDesired=new THREE.Vector3(),look=new THREE.Vector3(),lightTarget=new THREE.Vector3(),lightOffset=new THREE.Vector3(35,65,25);
  reframeCamera=()=>{camera.position.set(0,0,0);look.set(controller.x,(sampleGround?.(controller.x,controller.z)||0)+CAMERA_TARGET_HEIGHT,controller.z);};
  const contactVertex=new THREE.Vector3();
  const leftContact=new THREE.Vector3(),rightContact=new THREE.Vector3();
  let shoeContact=null,headAnchor=null;
  function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);

  const loader=new GLTFLoader();
  let cityLoaded=false,modelLoaded=false,loadFailed=false;
  const progressByAsset={character:0,city:0};
  function assetProgress(name,event){
    progressByAsset[name]=event.total?event.loaded/event.total:0;
    const percent=Math.round(progressByAsset.character*61+progressByAsset.city*39);
    $('load-progress').style.width=`${percent}%`;
    $('load-detail').textContent=`人物与城市 ${percent}%`;
  }
  function finishLoading(){
    if(!cityLoaded||!modelLoaded||loadFailed)return;
    ready=true;loading.hidden=true;$('load-progress').style.width='100%';
    setAnimations();mixer.update(0);actor.updateMatrixWorld(true);
  }
  loader.load('./assets/city-neighborhood.glb?v=city-1',gltf=>{
    try{
      world=cityWorld(gltf);
      gltf.scene.traverse(obj=>{
        if(!obj.isMesh)return;
        const mats=Array.isArray(obj.material)?obj.material:[obj.material];
        for(const mat of mats)if(mat.map)mat.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
      });
      scene.add(gltf.scene);sampleGround=groundSampler(gltf.scene);controller.setWorld(world);
      cameraState.yaw=world.spawn.yaw+Math.PI+.30;
      reframeCamera();
      cityLoaded=true;progressByAsset.city=1;finishLoading();
    }catch(error){loadFailed=true;fail('城市加载失败，请点击重新加载。',error);}
  },event=>assetProgress('city',event),error=>{loadFailed=true;fail('城市加载失败，请点击重新加载。',error);});
  loader.load('./assets/jill-heels-locomotion.glb?v=motion-4-v2',gltf=>{
    actor.add(gltf.scene);
    actor.updateMatrixWorld(true);
    const bodySpine=gltf.scene.getObjectByName('Bodyspine_2'),headSpine=gltf.scene.getObjectByName('Headspine_2');
    if(bodySpine&&headSpine){
      const offset=bodySpine.matrixWorld.clone().invert().multiply(headSpine.matrixWorld);
      headAnchor={body:bodySpine,head:headSpine,offset,local:new THREE.Matrix4()};
    }
    gltf.scene.traverse(obj=>{
      if(!obj.isMesh)return;
      obj.frustumCulled=false;obj.castShadow=true;obj.receiveShadow=true;
      const materials=Array.isArray(obj.material)?obj.material:[obj.material];
      for(const mat of materials){
        if(mat.map)mat.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        // Preserve the supplied material/alpha configuration and all textures.
      }
    });
    // During crossfades, quaternion interpolation can lower the sole a little.
    // Sample the actual shoe skin, then raise the character just enough to
    // keep the sole above the city's flat road. Never pull airborne feet down.
    const shoe=gltf.scene.getObjectByName('Bodypl2020_Boots_Mat');
    if(shoe?.isSkinnedMesh){
      const position=shoe.geometry.getAttribute('position'),indices=[];
      for(let i=0;i<position.count;i++)if(position.getY(i)<.048)indices.push(i);
      shoeContact={mesh:shoe,position,indices:indices.filter((_,i)=>i%3===0)};
    }
    const walkDefinition=gltf.parser.json.animations.find(a=>a.name==='Walk_Heels');
    const referenceStride=walkDefinition?.extras?.referenceStrideDistance;
    if(Number.isFinite(referenceStride)&&referenceStride>0)controller.setWalkReference(referenceStride);
    const runDefinition=gltf.parser.json.animations.find(a=>a.name==='Run_Heels');
    const runStride=runDefinition?.extras?.referenceStrideDistance;
    if(Number.isFinite(runStride)&&runStride>0)controller.setRunReference(runStride);
    mixer=new THREE.AnimationMixer(gltf.scene);
    for(const name of ['Idle_Heels','Walk_Heels','Run_Heels','Rifle_Aim_Idle']){
      const clip=THREE.AnimationClip.findByName(gltf.animations,name);
      if(!clip){loadFailed=true;fail('动画文件不完整，请重新载入。');return;}
      const action=mixer.clipAction(clip);action.play();action.setEffectiveWeight(name==='Idle_Heels'?1:0);
      actions[name]={action,duration:clip.duration};
    }
    modelLoaded=true;progressByAsset.character=1;finishLoading();
  },event=>assetProgress('character',event),error=>{loadFailed=true;fail('模型加载失败，请点击重新加载。',error);});

  function setAnimations(){
    const weights=controller.weights;
    for(const [name,{action,duration}] of Object.entries(actions)){
      action.time=name==='Walk_Heels'||name==='Run_Heels'?controller.phase*duration:controller.elapsed%duration;
      action.setEffectiveWeight(weights[name]);
    }
  }

  function frame(now){
    requestAnimationFrame(frame);
    const dt=Math.min((now-lastFrame)/1000,.0333);lastFrame=now;
    if(document.hidden)return;
    let input={x:stick.x,forward:stick.forward};
    if(keys.size){
      const kx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
      const kz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
      if(kx||kz)input={x:kx,forward:kz};
    }
    if(ready){
      controller.update(dt,input,cameraState.yaw,runMode||keys.has('ShiftLeft')||keys.has('ShiftRight'));
      currentGroundY=sampleGround?.(controller.x,controller.z)||0;
      actor.position.set(controller.x,currentGroundY,controller.z);actor.rotation.y=controller.yaw;
      setAnimations();mixer.update(0);
      actor.updateMatrixWorld(true);
      if(headAnchor){
        const {body,head,offset,local}=headAnchor;
        local.copy(head.parent.matrixWorld).invert().multiply(body.matrixWorld).multiply(offset);
        local.decompose(head.position,head.quaternion,head.scale);head.updateMatrixWorld(true);
      }
      if(shoeContact){
        let minimum=Infinity,leftMinimum=Infinity,rightMinimum=Infinity;
        const {mesh,position,indices}=shoeContact;
        for(const i of indices){
          contactVertex.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,contactVertex);mesh.localToWorld(contactVertex);
          minimum=Math.min(minimum,contactVertex.y);
          if(position.getX(i)<0){
            if(contactVertex.y<leftMinimum){leftMinimum=contactVertex.y;leftContact.copy(contactVertex);}
          }else if(contactVertex.y<rightMinimum){rightMinimum=contactVertex.y;rightContact.copy(contactVertex);}
        }
        const lift=Math.max(0,currentGroundY+.001-minimum,
          Number.isFinite(leftMinimum)?(sampleGround?.(leftContact.x,leftContact.z)||0)+.001-leftMinimum:0,
          Number.isFinite(rightMinimum)?(sampleGround?.(rightContact.x,rightContact.z)||0)+.001-rightMinimum:0);
        if(lift){actor.position.y+=lift;actor.updateMatrixWorld(true);}
        lastShoeMinimum=minimum+lift;
      }
      lightTarget.set(controller.x,currentGroundY,controller.z);sun.target.position.copy(lightTarget);sun.position.copy(lightTarget).add(lightOffset);
      if(now-lastHud>100){$('speed').textContent=controller.speed.toFixed(2);$('motion-state').textContent=controller.state;$('speed-fill').style.width=`${controller.speed/MOTION.runSpeed*100}%`;lastHud=now;}
    }
    const height=cameraState.foot ? .28 : CAMERA_TARGET_HEIGHT;
    target.set(controller.x,currentGroundY+height,controller.z);
    const distance=cameraState.foot ? 1.5 : cameraState.distance;
    const pitch=cameraState.foot ? .105 : cameraState.pitch;
    const narrow=Math.max(1,Math.min(1.45,1/camera.aspect));
    cameraDesired.set(target.x+Math.sin(cameraState.yaw)*distance*Math.cos(pitch)*narrow,target.y+Math.sin(pitch)*distance,target.z+Math.cos(cameraState.yaw)*distance*Math.cos(pitch)*narrow);
    cameraDesired.lerpVectors(target,cameraDesired,cameraFraction(world,target,cameraDesired));
    cameraDesired.y=Math.max(currentGroundY+.22,cameraDesired.y);
    if(camera.position.lengthSq()===0)camera.position.copy(cameraDesired);
    else camera.position.lerp(cameraDesired,1-Math.exp(-dt*9));
    // Immediately correct an obstructed interpolated position after a turn.
    camera.position.lerpVectors(target,camera.position,cameraFraction(world,target,camera.position));
    look.lerp(target,1-Math.exp(-dt*12));camera.lookAt(look);
    if(previewCamera){camera.position.fromArray(previewCamera.position);camera.lookAt(new THREE.Vector3().fromArray(previewCamera.target));}
    actualCameraDistance=camera.position.distanceTo(target);
    renderer.render(scene,camera);renderFrames++;
  }
  requestAnimationFrame(frame);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('图形环境已暂停，请点击重新加载。');});
}

function setRun(value){runMode=!!value;$('run').setAttribute('aria-pressed',String(runMode));$('run-hint').textContent=runMode?'再次点击走路':'点击切换';}
// Use each touch pointer directly so another finger can toggle while the
// stick is held, and suppress the duplicate compatibility click.
function bindToggle(button,toggle){
  let touchClickPending=false;
  button.addEventListener('pointerdown',e=>{
    touchClickPending=e.pointerType==='touch'||e.pointerType==='pen';
    if(!touchClickPending)return;
    e.preventDefault();toggle();
  });
  button.addEventListener('keydown',()=>{touchClickPending=false;});
  button.addEventListener('click',e=>{
    // A primary touch may also synthesize a trusted click. Keyboard input
    // clears the pending touch, and programmatic clicks still work normally.
    if(e.isTrusted&&touchClickPending){touchClickPending=false;e.preventDefault();return;}
    touchClickPending=false;
    toggle();
  });
}
bindToggle($('run'),()=>setRun(!runMode));
function setAim(value){controller.setAim(value);$('aim').setAttribute('aria-pressed',String(controller.aiming));}
bindToggle($('aim'),()=>setAim(!controller.aiming));
function reset(){controller.reset();setRun(false);setAim(false);clearInput();cameraState.yaw=(world?.spawn.yaw||0)+Math.PI+.30;cameraState.pitch=.22;cameraState.distance=CAMERA_DISTANCE;actor.position.set(controller.x,0,controller.z);actor.rotation.y=controller.yaw;reframeCamera?.();}
$('reset').addEventListener('click',reset);
$('foot-view').addEventListener('click',()=>{cameraState.foot=!cameraState.foot;$('foot-view').setAttribute('aria-pressed',String(cameraState.foot));$('foot-view').textContent=cameraState.foot?'全身视角':'脚部视角';});

const joy=$('joystick'),knob=$('stick-knob');
function moveStick(e){
  if(e.pointerId!==stick.pointer)return;
  const rect=joy.getBoundingClientRect(),radius=rect.width*.34;
  let dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2);
  const length=Math.hypot(dx,dy);if(length>radius){dx*=radius/length;dy*=radius/length;}
  stick.x=dx/radius;stick.forward=-dy/radius;knob.style.transform=`translate(${dx}px,${dy}px)`;
}
joy.addEventListener('pointerdown',e=>{
  if(stick.pointer!==null)return;
  e.preventDefault();stick.pointer=e.pointerId;joy.setPointerCapture(e.pointerId);joy.classList.add('active');moveStick(e);
});
joy.addEventListener('pointermove',moveStick);
function releaseStick(e){if(e&&e.pointerId!==stick.pointer)return;stick.x=stick.forward=0;stick.pointer=null;knob.style.transform='translate(0px,0px)';joy.classList.remove('active');}
for(const event of ['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(event,releaseStick);
function clearInput(){keys.clear();releaseStick();cameraState.drag=null;}
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{clearInput();lastFrame=performance.now();});
window.addEventListener('keydown',e=>{if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}});
window.addEventListener('keyup',e=>keys.delete(e.code));

canvas.addEventListener('pointerdown',e=>{
  if(cameraState.drag||e.button>0)return;
  cameraState.drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
  const d=cameraState.drag;if(!d||d.id!==e.pointerId)return;
  cameraState.yaw-=(e.clientX-d.x)*.005;
  cameraState.pitch=THREE.MathUtils.clamp(cameraState.pitch+(e.clientY-d.y)*.004,-.035,.65);
  d.x=e.clientX;d.y=e.clientY;
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(cameraState.drag?.id===e.pointerId)cameraState.drag=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();cameraState.distance=THREE.MathUtils.clamp(cameraState.distance+e.deltaY*.004,1.4,4.1);},{passive:false});
document.addEventListener('contextmenu',e=>e.preventDefault());

// Feature-detected: the same actions as the visible controls, without a
// dependency on browser agent support or any network service.
const context=document.modelContext;
if(context?.registerTool){
  const lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(console.warn);}catch(error){console.warn(error);}};
  register({name:'read_locomotion_state',description:'Read the character movement state and current run setting.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return {...controller.snapshot(),running:runMode,loaded:ready};}});
  register({name:'set_run_mode',description:'Set the same run toggle shown on the test page.',inputSchema:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input.enabled!=='boolean'||Object.keys(input).length!==1)throw new Error('enabled must be a boolean');setRun(input.enabled);return {running:runMode};}});
  register({name:'reset_character',description:'Return the character to the starting position and switch to walking.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||Object.keys(input).length)throw new Error('No arguments accepted');reset();return controller.snapshot();}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
