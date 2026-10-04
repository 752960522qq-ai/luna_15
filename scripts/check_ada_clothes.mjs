import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../web/vendor/three.module.js';
import {GLTFLoader} from '../web/vendor/GLTFLoader.js';
import {Avatar} from '../web/avatar.js';
import {MovementController} from '../web/movement.js';
import {usesHeelPosture} from '../web/wardrobe-attachments.js';
import {createPlayerState} from '../web/player-state.js';
import {OUTFITS} from '../web/life-data.js';
import {ShopSystem,SaveSystem,validateSave} from '../web/game-systems.js';
const loader=new GLTFLoader();loader.register(()=>({name:'headless-textures',loadTexture:()=>Promise.resolve(null)}));
async function glb(name){const b=fs.readFileSync(new URL('../web/assets/'+name+'.glb',import.meta.url));return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const manifest=JSON.parse(fs.readFileSync(new URL('../models/ada-clothing-manifest.json',import.meta.url)));
for(const [file,record] of Object.entries(manifest.assets)){const b=fs.readFileSync(new URL('../web/assets/'+file,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),record.sha256);assert.equal(b.length,record.byteLength);}
const assets={top:await glb('ada-top'),shoes:await glb('ada-shoes')};assert.equal(assets.top.parser.json.meshes.length,3);assert.equal(assets.shoes.parser.json.meshes.length,1);
for(const asset of Object.values(assets)){assert.equal(asset.parser.json.extras.sourceSha256,manifest.sourceSha256);assert.equal(asset.parser.json.animations,undefined);assert.equal(asset.parser.json.skins,undefined);}
const player=createPlayerState(),shop=new ShopSystem(player);let poses=0,minShoe=Infinity,maxLift=0;
for(const id of ['ada-top-only','ada-shoes-only','ada-set']){shop.equip(id);assert.equal(player.outfit.top,id==='ada-shoes-only'?null:'ada-top');assert.equal(player.outfit.shoes,id==='ada-top-only'?null:'ada-shoes');assert.equal(player.money,500);}
shop.equipSlot('top',null);assert.equal(player.outfit.shoes,'ada-shoes');shop.equipSlot('shoes',null);assert.equal(player.outfit.top,null);
const legacy=createPlayerState();legacy.ownedItems=['original','black-heels'];legacy.money=987;legacy.mission.completed=['delivery'];legacy.outfit={preset:'heels',...OUTFITS.find(o=>o.id==='heels').slots};const migrated=validateSave(legacy);assert.equal(migrated.money,987);assert.deepEqual(migrated.mission,legacy.mission);assert.equal(migrated.outfit.preset,'heels');assert.ok(migrated.ownedItems.includes('ada-top')&&migrated.ownedItems.includes('ada-shoes'));
const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},saves=new SaveSystem(storage);shop.equip('ada-set');saves.save(player);assert.deepEqual(saves.load().outfit,player.outfit);
const clips=['Idle_Heels','Walk_Heels','Run_Heels','Rifle_Aim_Idle'],v=new THREE.Vector3();
for(const variant of ['barefoot','heels']){
 const controller=new MovementController(),avatar=new Avatar(await glb('jill-'+variant+'-locomotion'),controller,assets),actor=new THREE.Group();actor.add(avatar.root);const attached=avatar.attachments,original=attached.fullPosition.array.slice(),normal=attached.fullNormal.array.slice(),boneCount=attached.body.skeleton.bones.length;
 for(const meshes of Object.values(attached.meshes))for(const mesh of meshes){assert.equal(mesh.skeleton,attached.body.skeleton);const index=mesh.geometry.attributes.skinIndex,weight=mesh.geometry.attributes.skinWeight;for(let i=0;i<weight.count;i++){let sum=0;for(let k=0;k<4;k++){const w=weight.array[i*4+k];sum+=w;if(w>0)assert.ok(index.array[i*4+k]<boneCount);}assert.ok(Math.abs(sum-1)<1e-5);}}
 for(const id of ['ada-top-only','ada-shoes-only','ada-set']){
  const outfit=OUTFITS.find(o=>o.id===id);avatar.outfit(outfit.slots);assert.equal(attached.meshes.top.every(m=>m.visible),id!=='ada-shoes-only');assert.equal(attached.meshes.shoes.every(m=>m.visible),id!=='ada-top-only');assert.equal(avatar.clothes.top.visible,false);assert.equal(usesHeelPosture(outfit.slots.shoes),id!=='ada-top-only');if(attached.originalBoots)assert.equal(attached.originalBoots.visible,id==='ada-top-only');
  if((variant==='heels')!==(id!=='ada-top-only'))continue;
  for(const clip of clips)for(let i=0;i<25;i++){
   actor.position.set(0,0,0);avatar.update(Object.fromEntries(clips.map(n=>[n,Number(n===clip)])),i/25,i*.113);actor.updateMatrixWorld(true);avatar.ground(actor,()=>0,0);assert.ok(Number.isFinite(avatar.clearance)&&avatar.clearance>=-.002);maxLift=Math.max(maxLift,actor.position.y);
   for(const meshes of Object.values(attached.meshes))for(const mesh of meshes)if(mesh.visible){const p=mesh.geometry.attributes.position;for(let k=0;k<p.count;k+=11){v.fromBufferAttribute(p,k);mesh.applyBoneTransform(k,v);mesh.localToWorld(v);assert.ok(v.toArray().every(Number.isFinite));}}
   if(outfit.slots.shoes){const mesh=attached.meshes.shoes[0],p=mesh.geometry.attributes.position;let lowest=Infinity;for(let k=0;k<p.count;k++){v.fromBufferAttribute(p,k);mesh.applyBoneTransform(k,v);mesh.localToWorld(v);lowest=Math.min(lowest,v.y);}assert.ok(lowest>=-.002,`${clip} phase ${i/25} shoe penetrates ${lowest}`);minShoe=Math.min(minShoe,lowest);}
   poses++;
  }
 }
 avatar.outfit(OUTFITS.find(o=>o.id==='original').slots);assert.deepEqual(attached.body.geometry.attributes.position.array,original);assert.deepEqual(attached.body.geometry.attributes.normal.array,normal);assert.ok(attached.meshes.top.every(m=>!m.visible)&&attached.meshes.shoes.every(m=>!m.visible));assert.equal(avatar.foot,attached.originalFoot);assert.equal(attached.body.skeleton.bones.length,boneCount);assert.deepEqual(actor.scale.toArray(),[1,1,1]);
}
console.log(JSON.stringify({status:'passed',outfits:3,slots:2,animationPoses:poses,minimumShoeClearanceM:minShoe,maximumGroundLiftM:maxLift,existingSaveMigration:true,originalBodyRestored:true,sourceSha256:manifest.sourceSha256},null,2));
