import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MovementController, MOTION } from './movement.js?v=motion-4-v2';

const $=id=>document.getElementById(id);
const canvas=$('scene'),loading=$('loading');
const controller=new MovementController();
const keys=new Set();
const stick={x:0,forward:0,pointer:null};
const cameraState={yaw:Math.PI+.30,pitch:.22,distance:3.5,foot:false,drag:null};
let runMode=false,ready=false,mixer,actions={},actor=new THREE.Group(),lastFrame=performance.now(),lastHud=0;
let renderer,renderFrames=0;
if(new URLSearchParams(location.search).get('diagnostics')==='1'){
  window.__heelMotionSnapshot=()=>({...controller.snapshot(),loaded:ready,running:runMode,
    animations:Object.keys(actions),weights:controller.weights,frames:renderFrames,footView:cameraState.foot,cameraDistance:cameraState.distance,host:location.hostname});
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
  scene.background=new THREE.Color('#101b27');
  scene.fog=new THREE.Fog('#101b27',13,40);
  const camera=new THREE.PerspectiveCamera(43,1,.03,80);
  const hemi=new THREE.HemisphereLight('#d6eef7','#344351',2.5);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff2de',3.4);sun.position.set(4,7,4);
  sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-5;sun.shadow.camera.right=5;sun.shadow.camera.top=5;sun.shadow.camera.bottom=-5;
  sun.shadow.camera.near=.5;sun.shadow.camera.far=18;sun.shadow.bias=-.00015;sun.shadow.normalBias=.008;
  scene.add(sun,sun.target);
  const rim=new THREE.DirectionalLight('#79b4db',2.2);rim.position.set(-3,4,-4);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#1a2c38',roughness:.93,metalness:.08}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(50,50,'#4d8592','#2c4857');grid.position.y=.002;grid.material.transparent=true;grid.material.opacity=.5;scene.add(grid);
  const origin=new THREE.Mesh(new THREE.RingGeometry(.38,.4,64),new THREE.MeshBasicMaterial({color:'#71dbc9',side:THREE.DoubleSide,transparent:true,opacity:.5}));origin.rotation.x=-Math.PI/2;origin.position.y=.003;scene.add(origin);
  scene.add(actor);

  const target=new THREE.Vector3(0,1,0),cameraDesired=new THREE.Vector3(),look=new THREE.Vector3(),lightTarget=new THREE.Vector3(),lightOffset=new THREE.Vector3(4,7,4);
  const contactVertex=new THREE.Vector3();
  let shoeContact=null,headAnchor=null;
  function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);

  const loader=new GLTFLoader();
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
    // keep the sole above this flat test floor. Never pull airborne feet down.
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
      if(!clip){fail('动画文件不完整，请重新载入。');return;}
      const action=mixer.clipAction(clip);action.play();action.setEffectiveWeight(name==='Idle_Heels'?1:0);
      actions[name]={action,duration:clip.duration};
    }
    ready=true;loading.hidden=true;
    $('load-progress').style.width='100%';
    setAnimations();mixer.update(0);
    actor.updateMatrixWorld(true);
  },progress=>{
    if(progress.total){const p=Math.round(progress.loaded/progress.total*100);$('load-progress').style.width=`${p}%`;$('load-detail').textContent=`载入模型 ${p}%`;}
    else $('load-detail').textContent=`已载入 ${(progress.loaded/1048576).toFixed(1)} MB`;
  },error=>fail('模型加载失败，请点击重新加载。',error));

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
      actor.position.set(controller.x,0,controller.z);actor.rotation.y=controller.yaw;
      setAnimations();mixer.update(0);
      actor.updateMatrixWorld(true);
      if(headAnchor){
        const {body,head,offset,local}=headAnchor;
        local.copy(head.parent.matrixWorld).invert().multiply(body.matrixWorld).multiply(offset);
        local.decompose(head.position,head.quaternion,head.scale);head.updateMatrixWorld(true);
      }
      if(shoeContact){
        let minimum=Infinity;
        const {mesh,position,indices}=shoeContact;
        for(const i of indices){
          contactVertex.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,contactVertex);mesh.localToWorld(contactVertex);
          minimum=Math.min(minimum,contactVertex.y);
        }
        if(minimum<.001){actor.position.y+=.001-minimum;actor.updateMatrixWorld(true);}
      }
      lightTarget.set(controller.x,0,controller.z);sun.target.position.copy(lightTarget);sun.position.copy(lightTarget).add(lightOffset);
      if(now-lastHud>100){$('speed').textContent=controller.speed.toFixed(2);$('motion-state').textContent=controller.state;$('speed-fill').style.width=`${controller.speed/MOTION.runSpeed*100}%`;lastHud=now;}
    }
    const height=cameraState.foot ? .28 : 1.02;
    target.set(controller.x,height,controller.z);
    const distance=cameraState.foot ? 1.5 : cameraState.distance;
    const pitch=cameraState.foot ? .105 : cameraState.pitch;
    const narrow=Math.max(1,Math.min(1.45,1/camera.aspect));
    cameraDesired.set(target.x+Math.sin(cameraState.yaw)*distance*Math.cos(pitch)*narrow,target.y+Math.sin(pitch)*distance,target.z+Math.cos(cameraState.yaw)*distance*Math.cos(pitch)*narrow);
    if(camera.position.lengthSq()===0)camera.position.copy(cameraDesired);
    else camera.position.lerp(cameraDesired,1-Math.exp(-dt*9));
    look.lerp(target,1-Math.exp(-dt*12));camera.lookAt(look);
    renderer.render(scene,camera);renderFrames++;
  }
  requestAnimationFrame(frame);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('图形环境已暂停，请点击重新加载。');});
}

function setRun(value){runMode=!!value;$('run').setAttribute('aria-pressed',String(runMode));$('run-hint').textContent=runMode?'再次点击走路':'点击切换';}
$('run').addEventListener('click',()=>setRun(!runMode));
function setAim(value){controller.setAim(value);$('aim').setAttribute('aria-pressed',String(controller.aiming));}
$('aim').addEventListener('click',()=>setAim(!controller.aiming));
function reset(){controller.reset();setRun(false);setAim(false);clearInput();cameraState.yaw=Math.PI+.30;cameraState.pitch=.22;cameraState.distance=3.5;actor.position.set(0,0,0);actor.rotation.y=0;}
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
canvas.addEventListener('wheel',e=>{e.preventDefault();cameraState.distance=THREE.MathUtils.clamp(cameraState.distance+e.deltaY*.004,2.2,6.5);},{passive:false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());

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
