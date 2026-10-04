import {CITY_LOCATION_SCALE,DISTRICT_ORIGIN} from './world-config.js';
const cityPoint=(x,z)=>({x:x*CITY_LOCATION_SCALE,z:z*CITY_LOCATION_SCALE});
export const LOCATIONS=Object.freeze(Object.fromEntries(Object.entries({homeDoor:{x:-3.15,z:2.2},citySpawn:{x:0,z:2.2},shop:{x:-2.7,z:-2.5},parcel:{x:-1.4,z:-5.8},delivery:{x:15,z:-8},night:{x:0,z:-15.8}}).map(([id,p])=>[id,cityPoint(p.x,p.z)])));
export const ADA_STARTER_ITEMS=Object.freeze(['ada-top','ada-shoes']);
export const TEST_WARDROBE_ITEMS=Object.freeze([...ADA_STARTER_ITEMS,'dorsay-shoes','city-dress']);
export const PRODUCTS=Object.freeze([
 {id:'street-top',name:'街头上衣',price:150,type:'top'},
 {id:'city-bottom',name:'城市短裙',price:100,type:'bottom'},
 {id:'black-heels',name:'黑色高跟鞋',price:200,type:'shoes'},
 {id:'ada-top',name:'Ada 白色蕾丝上衣',price:180,type:'top'},
 {id:'ada-shoes',name:'Ada 黑色高跟鞋',price:200,type:'shoes'},
 {id:'dorsay-shoes',name:'D’Orsay 侧空高跟鞋',price:280,type:'shoes'},
 {id:'city-dress',name:'黑色吊带连衣裙',price:350,type:'dress'},
 {id:'night-dress',name:'夜色连衣裙',price:300,type:'dress'},
 {id:'city-bag',name:'街头挎包',price:80,type:'accessory'}]);
export const OUTFITS=Object.freeze([
 {id:'original',name:'原始装束 · 赤脚',requires:['original'],slots:{top:null,bottom:null,shoes:null,dress:null,accessory:null},style:'original'},
 {id:'heels',name:'高跟鞋装束',requires:['black-heels'],slots:{top:null,bottom:null,shoes:'black-heels',dress:null,accessory:null},style:'original'},
 {id:'street',name:'街头套装',requires:['street-top','city-bottom'],slots:{top:'street-top',bottom:'city-bottom',shoes:null,dress:null,accessory:null},style:'street'},
 {id:'night',name:'夜色套装',requires:['night-dress','black-heels'],slots:{top:null,bottom:null,shoes:'black-heels',dress:'night-dress',accessory:null},style:'night'},
 {id:'ada-top-only',name:'Ada · 仅上衣',requires:['ada-top'],slots:{top:'ada-top',bottom:null,shoes:null,dress:null,accessory:null},style:'ada'},
 {id:'ada-shoes-only',name:'Ada · 仅高跟鞋',requires:['ada-shoes'],slots:{top:null,bottom:null,shoes:'ada-shoes',dress:null,accessory:null},style:'ada'},
 {id:'ada-set',name:'Ada · 上衣和高跟鞋',requires:['ada-top','ada-shoes'],slots:{top:'ada-top',bottom:null,shoes:'ada-shoes',dress:null,accessory:null},style:'ada'},
 {id:'dorsay-set',name:'Ada 上衣 · D’Orsay 高跟鞋',requires:['ada-top','dorsay-shoes'],slots:{top:'ada-top',bottom:null,shoes:'dorsay-shoes',dress:null,accessory:null},style:'ada'},
 {id:'dress-only',name:'黑色连衣裙 · 赤脚',requires:['city-dress'],slots:{top:null,bottom:null,shoes:null,dress:'city-dress',accessory:null},style:'dress'},
 {id:'dress-dorsay',name:'黑色连衣裙 · D’Orsay 高跟鞋',requires:['city-dress','dorsay-shoes'],slots:{top:null,bottom:null,shoes:'dorsay-shoes',dress:'city-dress',accessory:null},style:'dress'}]);
export const MISSIONS=Object.freeze([
 {id:'new-life',name:'新生活',reward:300,steps:[
  {id:'leave',text:'离开公寓附近，走进街区',kind:'leave'},
  {id:'shop',text:'前往服装店',kind:'reach',location:'shop'},
  {id:'talk',text:'与店员阿晴交谈',kind:'talk',npc:'npc-clothier'},
  {id:'outfit',text:'领取或购买一套街头服装',kind:'own',items:['street-top','city-bottom']},
  {id:'home',text:'返回出生公寓',kind:'home'}]},
 {id:'delivery',name:'送货',reward:500,steps:[
  {id:'parcel',text:'在服装店北侧接取包裹',kind:'pickup',item:'parcel'},
  {id:'deliver',text:'将包裹交给仓库门口的阿成',kind:'deliver',npc:'npc-recipient'}]},
 {id:'nightlife',name:'夜生活',reward:200,steps:[
  {id:'night',text:'18:00～06:00 前往北街夜生活地点',kind:'night',location:'night'},
  {id:'talk',text:'与阿墨交谈',kind:'talk',npc:'npc-night'}]}]);
export const NPCS=Object.freeze([
 {id:'npc-guide',name:'阿岚',x:.65,z:.4,model:1,role:'guide'},
 {id:'npc-clothier',name:'阿晴',x:-2.2,z:-2.5,model:1,gender:'female',role:'clothier'},
 {id:'npc-recipient',name:'阿成',x:15,z:-8,model:4,role:'recipient'},
 {id:'npc-night',name:'阿墨',x:.8,z:-15.8,model:5,role:'night'},
 {id:'npc-citizen-1',name:'市民小林',x:2,z:9,model:1,role:'citizen',roam:true},
 {id:'npc-citizen-2',name:'市民老周',x:-14,z:10,model:2,role:'citizen',roam:true},
 {id:'npc-citizen-3',name:'市民阿伟',x:14,z:-18,model:4,role:'citizen',roam:true},
 {id:'npc-female-2',name:'市民小乔',x:1,z:7,model:2,gender:'female',role:'citizen',roam:true},
 {id:'npc-female-3',name:'市民小琪',x:1,z:-13,model:3,gender:'female',role:'citizen',roam:true},
 {id:'npc-female-4',name:'市民小夏',x:-12,z:12,model:4,gender:'female',role:'citizen',roam:true},
 {id:'npc-female-5',name:'东街小宁',x:DISTRICT_ORIGIN.x,z:18,absolute:true,model:5,gender:'female',role:'citizen',roam:true},
 {id:'npc-female-6',name:'东街小安',x:DISTRICT_ORIGIN.x,z:-15,absolute:true,model:6,gender:'female',role:'citizen',roam:true}
].map(n=>({...n,gender:n.gender||'male',...(n.absolute?{}:cityPoint(n.x,n.z))})));
export const ITEM_TYPES=Object.freeze({top:'上衣',bottom:'下装',shoes:'鞋子',dress:'连衣裙',accessory:'配饰'});
