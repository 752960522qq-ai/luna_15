import * as THREE from './vendor/three.module.js';
import {CITY_SCALE,DISTRICT_SCALE,DISTRICT_ORIGIN} from './world-config.js';

// Only the city is scaled; the separately loaded character keeps its size.
export {CITY_SCALE};

// Bake coordinates are metres. The runtime kerb height becomes 0.144 m.
export function cityWorld(gltf,district=null) {
  const original=gltf.parser.json.scenes[gltf.parser.json.scene||0]?.extras;
  if(original?.unit!=='metre'||!original.bounds||!original.obstacles?.length)throw new Error('City metadata is incomplete');
  gltf.scene.scale.setScalar(CITY_SCALE);
  gltf.scene.traverse(obj=>{
    if(!obj.isMesh)return;
    obj.castShadow=true;obj.receiveShadow=true;
  });
  gltf.scene.updateMatrixWorld(true);
  const world={...original,scale:CITY_SCALE,sourceUnitToMetres:original.sourceUnitToMetres*CITY_SCALE,
    groundY:original.groundY*CITY_SCALE,
    spawn:{...original.spawn,x:original.spawn.x*CITY_SCALE,z:original.spawn.z*CITY_SCALE},
    bounds:Object.fromEntries(Object.entries(original.bounds).map(([key,value])=>[key,value*CITY_SCALE])),
    obstacles:original.obstacles.map(box=>({...box,min:box.min.map(v=>v*CITY_SCALE),max:box.max.map(v=>v*CITY_SCALE)}))};
  if(district){
    const extra=district.parser.json.scenes[0].extras;if(extra.unit!=='metre'||!extra.obstacles?.length)throw new Error('新增街区数据不完整');
    district.scene.scale.setScalar(DISTRICT_SCALE);district.scene.position.set(DISTRICT_ORIGIN.x,0,DISTRICT_ORIGIN.z);district.scene.name='City_EastDistrict';district.scene.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=true;}});
    // Attach with inverse city scale so both coordinate systems remain metric.
    const holder=new THREE.Group();holder.scale.setScalar(1/CITY_SCALE);gltf.scene.add(holder);holder.add(district.scene);gltf.scene.updateMatrixWorld(true);
    for(const box of extra.obstacles)world.obstacles.push({...box,name:'East '+box.name,min:box.min.map((v,i)=>v*DISTRICT_SCALE+(i===0?DISTRICT_ORIGIN.x:i===2?DISTRICT_ORIGIN.z:0)),max:box.max.map((v,i)=>v*DISTRICT_SCALE+(i===0?DISTRICT_ORIGIN.x:i===2?DISTRICT_ORIGIN.z:0))});
    for(const [key,axis] of [['minX','x'],['maxX','x'],['minZ','z'],['maxZ','z']]){const value=extra.bounds[key]*DISTRICT_SCALE+DISTRICT_ORIGIN[axis];world.bounds[key]=key.startsWith('min')?Math.min(world.bounds[key],value):Math.max(world.bounds[key],value);}
    // A ground apron joins the street ends; building boxes still block it.
    world.bounds.maxZ=Math.max(world.bounds.maxZ,extra.bounds.maxZ*DISTRICT_SCALE+8);
    const width=world.bounds.maxX-world.bounds.minX,depth=world.bounds.maxZ-world.bounds.minZ,apron=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshStandardMaterial({color:'#54555b',roughness:1}));apron.name='City_ConnectionGround';apron.rotation.x=-Math.PI/2;apron.position.set((world.bounds.minX+world.bounds.maxX)/2,-.035,(world.bounds.minZ+world.bounds.maxZ)/2);apron.receiveShadow=true;holder.add(apron);
    world.district={name:extra.name,scale:DISTRICT_SCALE,origin:DISTRICT_ORIGIN,drawMeshes:extra.drawMeshes};world.drawMeshes+=extra.drawMeshes+1;
  }
  return world;
}

export function groundSampler(scene){
  const ground=scene.getObjectByName('City_RoadsGround');
  if(!ground?.isMesh)throw new Error('City road surface is missing');
  scene.updateMatrixWorld(true);
  const grounds=[ground];scene.traverse(n=>{if(n.isMesh&&(n.name.startsWith('District_Ground_')||n.name==='City_ConnectionGround'))grounds.push(n);});
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,1);
  return (x,z)=>{
    ray.ray.origin.set(x,.65,z);
    const hit=ray.intersectObjects(grounds,false).find(h=>h.face.normal.y>.6||h.object.name==='City_ConnectionGround');
    if(!hit)return 0;
    return Math.abs(hit.point.y)<1e-5?0:hit.point.y;
  };
}

// Shorten the camera boom before it enters a building or the parked vehicle.
// A small clearance prevents the near plane from clipping through the facade.
export function cameraFraction(world, target, desired) {
  if(!world)return 1;
  let fraction=1;
  for(const box of world.obstacles){
    let enter=0,exit=1;
    for(let i=0;i<3;i++){
      const key=['x','y','z'][i],start=target[key],delta=desired[key]-start;
      const min=box.min[i]-.16,max=box.max[i]+.16;
      if(Math.abs(delta)<1e-8){if(start<min||start>max){enter=2;break;}continue;}
      let a=(min-start)/delta,b=(max-start)/delta;
      if(a>b)[a,b]=[b,a];
      enter=Math.max(enter,a);exit=Math.min(exit,b);
      if(enter>exit)break;
    }
    if(enter<=exit&&enter>=0&&enter<=1)fraction=Math.min(fraction,enter);
  }
  return fraction;
}
