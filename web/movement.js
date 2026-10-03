// Pure movement state. Speeds are metres/second; forward is the model's +Z.
export const MOTION = Object.freeze({ walkSpeed: .95, runSpeed: 2.4, walkPeriod: 1.166666627, runPeriod: .7, deadZone: .10, arenaRadius: 22 });
export const CHARACTER_STATES=Object.freeze({Idle:'Idle',Walk:'Walk',Run:'Run',Aim:'Aim',Interact:'Interact',Vehicle:'Vehicle'});
export class MovementController {
  constructor() { this.walkStride=MOTION.walkSpeed*MOTION.walkPeriod; this.runStride=MOTION.runSpeed*MOTION.runPeriod; this.reset(); }
  setWalkReference(stride) {
    if(!Number.isFinite(stride)||stride<=0)throw new Error('Walk stride must be a positive distance');
    this.walkStride=stride;
  }
  setRunReference(stride) {
    if(!Number.isFinite(stride)||stride<=0)throw new Error('Run stride must be a positive distance');
    this.runStride=stride;
  }
  setAim(enabled) { this.aiming=!!enabled; }
  setInteract(enabled) { this.interacting=!!enabled;if(enabled)this.vx=this.vz=0; }
  setPose(position) { if(!Number.isFinite(position.x)||!Number.isFinite(position.z))throw new Error('Invalid player position');this.x=position.x;this.z=position.z;this.yaw=position.yaw||0;this.vx=this.vz=0; }
  setWorld(world) { this.world=world; this.reset(); }
  reset() { this.x=this.world?.spawn.x||0; this.z=this.world?.spawn.z||0; this.vx=0; this.vz=0; this.yaw=this.world?.spawn.yaw||0; this.phase=0; this.runMix=0; this.moveMix=0; this.aimMix=0; this.aiming=false; this.interacting=false; this.elapsed=0; }
  update(dt, input, cameraYaw, running) {
    dt=Math.min(Math.max(dt,0),.05); this.elapsed+=dt;
    if(this.interacting){input={x:0,forward:0};running=false;}
    let ix=Number.isFinite(input.x)?input.x:0, iz=Number.isFinite(input.forward)?input.forward:0;
    let strength=Math.min(1,Math.hypot(ix,iz));
    const length=Math.hypot(ix,iz);
    if(length>MOTION.deadZone){ ix/=length; iz/=length; strength=(strength-MOTION.deadZone)/(1-MOTION.deadZone); }
    else { ix=iz=strength=0; }
    const maxSpeed=running?MOTION.runSpeed:MOTION.walkSpeed;
    const tx=(ix*Math.cos(cameraYaw)-iz*Math.sin(cameraYaw))*maxSpeed*strength;
    const tz=(-ix*Math.sin(cameraYaw)-iz*Math.cos(cameraYaw))*maxSpeed*strength;
    const dx=tx-this.vx,dz=tz-this.vz,change=Math.hypot(dx,dz);
    const acceleration=strength===0?8:running?5.5:4;
    const step=change?Math.min(1,acceleration*dt/change):0;
    this.vx+=dx*step;this.vz+=dz*step;
    if(Math.hypot(this.vx,this.vz)<.003&&strength===0)this.vx=this.vz=0;
    const previousX=this.x,previousZ=this.z;
    if(this.world){
      const {bounds,obstacles,characterRadius:r=.26}=this.world;
      // Move each axis separately to slide along facades. A frame can travel
      // at most 0.12 m, far less than the thinnest building footprint.
      this.x=Math.max(bounds.minX+r,Math.min(bounds.maxX-r,this.x+this.vx*dt));
      for(const box of obstacles){
        if(this.z<=box.min[2]-r||this.z>=box.max[2]+r)continue;
        if(this.x>box.min[0]-r&&this.x<box.max[0]+r){
          this.x=this.vx>0?box.min[0]-r:box.max[0]+r;
        }
      }
      this.z=Math.max(bounds.minZ+r,Math.min(bounds.maxZ-r,this.z+this.vz*dt));
      for(const box of obstacles){
        if(this.x<=box.min[0]-r||this.x>=box.max[0]+r)continue;
        if(this.z>box.min[2]-r&&this.z<box.max[2]+r){
          this.z=this.vz>0?box.min[2]-r:box.max[2]+r;
        }
      }
      // Animate only the distance actually travelled, including wall sliding.
      if(dt>0){this.vx=(this.x-previousX)/dt;this.vz=(this.z-previousZ)/dt;}
    }else{
      this.x+=this.vx*dt;this.z+=this.vz*dt;
      const radius=Math.hypot(this.x,this.z);
      if(radius>MOTION.arenaRadius){
        const nx=this.x/radius,nz=this.z/radius;
        this.x=nx*MOTION.arenaRadius;this.z=nz*MOTION.arenaRadius;
        const outward=this.vx*nx+this.vz*nz;
        if(outward>0){this.vx-=nx*outward;this.vz-=nz*outward;}
      }
    }
    const speed=this.speed;
    if(speed>.025){
      const targetYaw=Math.atan2(this.vx,this.vz);
      const turn=Math.atan2(Math.sin(targetYaw-this.yaw),Math.cos(targetYaw-this.yaw));
      this.yaw+=turn*(1-Math.exp(-dt*13));
    }
    const runTarget=Math.max(0,Math.min(1,(speed-.95)/1.45));
    this.runMix+=(runTarget-this.runMix)*(1-Math.exp(-dt*9));
    const moveTarget=Math.min(1,speed/.22);
    this.moveMix+=(moveTarget-this.moveMix)*(1-Math.exp(-dt*12));
    this.aimMix+=((this.aiming?1:0)-this.aimMix)*(1-Math.exp(-dt*10));
    const stride=this.walkStride*(1-this.runMix)+this.runStride*this.runMix;
    this.phase=(this.phase+dt*speed/stride)%1;
  }
  get speed(){return Math.hypot(this.vx,this.vz);}
  get stateId(){return this.interacting?CHARACTER_STATES.Interact:this.speed<.035?(this.aiming?CHARACTER_STATES.Aim:CHARACTER_STATES.Idle):this.runMix>.48?CHARACTER_STATES.Run:CHARACTER_STATES.Walk;}
  get state(){return this.speed<.035?(this.aiming?"瞄准待机":"待机"):this.runMix>.48?"跑步":"走路";}
  get weights(){return {Idle_Heels:(1-this.moveMix)*(1-this.aimMix),Rifle_Aim_Idle:(1-this.moveMix)*this.aimMix,Walk_Heels:this.moveMix*(1-this.runMix),Run_Heels:this.moveMix*this.runMix};}
  snapshot(){return {state:this.state,aiming:this.aiming,speed:Number(this.speed.toFixed(3)),position:{x:Number(this.x.toFixed(3)),z:Number(this.z.toFixed(3))},phase:this.phase};}
}
