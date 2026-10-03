export class InteractionSystem{
 constructor(player){this.player=player;this.objects=[];this.closest=null;}
 register(object){if(!object.id||typeof object.interact!=='function')throw new Error('互动对象必须提供 id 和 interact(player)');this.objects.push(object);return object;}
 update(){let best=null,distance=Infinity;for(const obj of this.objects){if(obj.area!==this.player.area||obj.enabled?.()===false)continue;const pos=typeof obj.position==='function'?obj.position():obj.position;const d=Math.hypot(pos.x-this.player.position.x,pos.z-this.player.position.z);if(d<distance&&d<(obj.radius||1.6)){best=obj;distance=d;}}this.closest=best;return best;}
 interact(){const obj=this.update();if(!obj)return null;return obj.interact(this.player);}
}
