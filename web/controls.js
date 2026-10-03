// Pointer ownership is independent for the stick, camera and action buttons.
export class MobileControls {
  constructor(canvas, camera, callbacks) {
    this.camera=camera; this.callbacks=callbacks; this.keys=new Set();
    this.stick={x:0,forward:0,pointer:null}; this.drag=null; this.enabled=false; this.running=false;
    const joystick=document.getElementById('joystick'),knob=document.getElementById('stick-knob');
    const move=e=>{const r=joystick.getBoundingClientRect(),radius=r.width*.35,dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,scale=Math.min(1,radius/Math.max(.001,Math.hypot(dx,dy)));this.stick.x=dx*scale/radius;this.stick.forward=-dy*scale/radius;knob.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;};
    joystick.addEventListener('pointerdown',e=>{if(!this.enabled||this.stick.pointer!==null)return;e.preventDefault();this.stick.pointer=e.pointerId;joystick.setPointerCapture(e.pointerId);joystick.classList.add('active');move(e);});
    joystick.addEventListener('pointermove',e=>{if(e.pointerId===this.stick.pointer)move(e);});
    const release=e=>{if(e.pointerId!==this.stick.pointer)return;this.stick.x=this.stick.forward=0;this.stick.pointer=null;knob.style.transform='';joystick.classList.remove('active');};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(name,release);
    canvas.addEventListener('pointerdown',e=>{if(!this.enabled||this.drag||e.clientX<innerWidth*.35)return;e.preventDefault();this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(this.drag?.id!==e.pointerId)return;this.camera.yaw-=(e.clientX-this.drag.x)*.006;this.camera.pitch=Math.max(-.035,Math.min(.65,this.camera.pitch+(e.clientY-this.drag.y)*.004));this.drag.x=e.clientX;this.drag.y=e.clientY;});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(this.drag?.id===e.pointerId)this.drag=null;});
    this.toggle('run',()=>this.setRun(!this.running));this.toggle('aim',()=>callbacks.aim());this.toggle('interact',()=>callbacks.interact());
    document.getElementById('pause').addEventListener('click',()=>callbacks.pause());
    window.addEventListener('keydown',e=>{if(e.code==='Escape'){callbacks.pause();return;}if(!this.enabled)return;if(e.code==='KeyE'&&!e.repeat)callbacks.interact();if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>this.clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
  }
  toggle(id,action){const button=document.getElementById(id);let touchPending=false;button.addEventListener('pointerdown',e=>{touchPending=e.pointerType==='touch'||e.pointerType==='pen';if(touchPending&&this.enabled){e.preventDefault();action();}});button.addEventListener('keydown',()=>{touchPending=false;});button.addEventListener('click',e=>{if(touchPending&&e.isTrusted){touchPending=false;return;}touchPending=false;if(this.enabled)action();});}
  setRun(value){this.running=!!value;document.getElementById('run').setAttribute('aria-pressed',String(this.running));}
  input(){const k=this.keys,x=Number(k.has('KeyD')||k.has('ArrowRight'))-Number(k.has('KeyA')||k.has('ArrowLeft')),forward=Number(k.has('KeyW')||k.has('ArrowUp'))-Number(k.has('KeyS')||k.has('ArrowDown'));return x||forward?{x,forward}:this.stick;}
  get run(){return this.running||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');}
  clear(){this.keys.clear();this.stick.x=this.stick.forward=0;this.stick.pointer=null;this.drag=null;this.setRun(false);document.getElementById('stick-knob').style.transform='';document.getElementById('joystick').classList.remove('active');}
  enable(value){this.enabled=!!value;if(!value)this.clear();}
}
