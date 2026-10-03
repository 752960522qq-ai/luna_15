import * as THREE from './vendor/three.module.js';

// The baked scene is already in metres, with asphalt at Y=0 and kerbs at 0.2.
export function cityWorld(gltf) {
  const world=gltf.parser.json.scenes[gltf.parser.json.scene||0]?.extras;
  if(world?.unit!=='metre'||!world.bounds||!world.obstacles?.length)throw new Error('City metadata is incomplete');
  gltf.scene.traverse(obj=>{
    if(!obj.isMesh)return;
    obj.castShadow=true;obj.receiveShadow=true;
  });
  return world;
}

export function groundSampler(scene){
  const ground=scene.getObjectByName('City_RoadsGround');
  if(!ground?.isMesh)throw new Error('City road surface is missing');
  scene.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,1);
  return (x,z)=>{
    ray.ray.origin.set(x,.65,z);
    const hit=ray.intersectObject(ground,false).find(h=>h.face.normal.y>.6);
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
