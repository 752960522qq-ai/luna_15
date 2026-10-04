import {TEST_WARDROBE_ITEMS} from './life-data.js';
import {CITY_SCALE} from './world-config.js';
// The sole persistent player state. Scene objects and UI never own copies.
export function createPlayerState(){return {version:1,hp:100,stamina:100,money:500,
  position:{x:0,y:0,z:10.3,yaw:Math.PI},area:'home',cityScale:CITY_SCALE,
  outfit:{preset:'original',top:null,bottom:null,shoes:null,dress:null,accessory:null},
  weapon:null,vehicle:null,mission:{activeId:null,progress:{},completed:[]},
  ownedItems:['original','black-heels',...TEST_WARDROBE_ITEMS],inventory:[],timeMinutes:720,
  settings:{quality:'balanced',cameraDistance:2.2},flags:{exhausted:false}};}
export const PlayerState=createPlayerState();
export function replacePlayerState(target,value){for(const key of Object.keys(target))delete target[key];Object.assign(target,value);return target;}
