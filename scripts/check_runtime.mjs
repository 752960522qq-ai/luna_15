// Use the same GLTFLoader, AnimationMixer and skinned-shoe correction as the app.
// Texture decoding and GPU rendering are covered by Android instrumentation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/vendor/three.module.js';
import { GLTFLoader } from '../web/vendor/GLTFLoader.js';

const bytes = fs.readFileSync(new URL('../web/assets/jill-heels-locomotion.glb', import.meta.url));
const loader = new GLTFLoader();
loader.register(() => ({name:'headless-textures', loadTexture:()=>Promise.resolve(null)}));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), '');
const actor = new THREE.Group(); actor.add(gltf.scene); actor.updateMatrixWorld(true);
const body = gltf.scene.getObjectByName('Bodyspine_2');
const head = gltf.scene.getObjectByName('Headspine_2');
const offset = body.matrixWorld.clone().invert().multiply(head.matrixWorld);
const shoe = gltf.scene.getObjectByName('Bodypl2020_Boots_Mat');
assert.ok(shoe?.isSkinnedMesh);
const position = shoe.geometry.getAttribute('position');
const indices = [];
for(let i=0;i<position.count;i++)if(position.getY(i)<.048)indices.push(i);
const sampled = indices.filter((_,i)=>i%3===0);
const mixer = new THREE.AnimationMixer(gltf.scene);
const actions = gltf.animations.map(clip=>({name:clip.name,duration:clip.duration,action:mixer.clipAction(clip).play()}));
assert.equal(actions.length,4);
const blends = [];
for(let i=0;i<4;i++){const weights=Array(4).fill(0);weights[i]=1;blends.push(weights);}
for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)for(const amount of [.25,.5,.75]){
  const weights=Array(4).fill(0);weights[i]=1-amount;weights[j]=amount;blends.push(weights);
}
const vertex = new THREE.Vector3(), local = new THREE.Matrix4();
function minimum(chosen){
  let low=Infinity;
  for(const i of chosen){vertex.fromBufferAttribute(position,i);shoe.applyBoneTransform(i,vertex);shoe.localToWorld(vertex);low=Math.min(low,vertex.y);}
  return low;
}
let correctedMinimum=Infinity, maximumHeadError=0, maximumLift=0, poses=0;
for(const weights of blends)for(let frame=0;frame<17;frame++){
  actor.position.y=0;
  for(let i=0;i<4;i++){actions[i].action.time=frame/17*actions[i].duration;actions[i].action.setEffectiveWeight(weights[i]);}
  mixer.update(0);actor.updateMatrixWorld(true);
  local.copy(head.parent.matrixWorld).invert().multiply(body.matrixWorld).multiply(offset);
  local.decompose(head.position,head.quaternion,head.scale);head.updateMatrixWorld(true);
  const expected=body.matrixWorld.clone().multiply(offset);
  maximumHeadError=Math.max(maximumHeadError,...head.matrixWorld.elements.map((n,i)=>Math.abs(n-expected.elements[i])));
  const low=minimum(sampled);
  if(low<.001){actor.position.y=.001-low;actor.updateMatrixWorld(true);}
  maximumLift=Math.max(maximumLift,actor.position.y);
  correctedMinimum=Math.min(correctedMinimum,minimum(indices));poses++;
}
assert.ok(maximumHeadError<1e-5,'independent head skin follows the blended body');
assert.ok(correctedMinimum>-.002,'sampled runtime correction prevents meaningful shoe penetration');
console.log(JSON.stringify({status:'passed',poses,blends:blends.length,
  correctedShoeMinimumM:correctedMinimum,maximumBlendLiftM:maximumLift,maximumHeadMatrixError:maximumHeadError},null,2));
