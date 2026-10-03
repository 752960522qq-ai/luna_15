// Activate menu buttons from pointer release as well as mouse/keyboard clicks.
// Android WebView can deliver touch pointers without a compatibility click.
export function installTouchButtons(root=document){
  const active=new Map(),suppressClick=new WeakSet();
  const immediate=new Set(['run','aim','interact']);
  const buttonFor=event=>event.target.closest?.('button');
  root.addEventListener('pointerdown',event=>{
    const button=buttonFor(event);
    if(!button)return;
    suppressClick.delete(button);
    if(button.disabled||immediate.has(button.id)||!['touch','pen'].includes(event.pointerType))return;
    event.preventDefault();
    active.set(event.pointerId,{button,x:event.clientX,y:event.clientY,moved:false});
  },{capture:true,passive:false});
  root.addEventListener('pointermove',event=>{
    const press=active.get(event.pointerId);
    if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>12)press.moved=true;
  },{capture:true,passive:true});
  root.addEventListener('pointerup',event=>{
    const press=active.get(event.pointerId);
    if(!press)return;
    active.delete(event.pointerId);
    event.preventDefault();
    const button=press.button;
    suppressClick.add(button);
    if(press.moved||!button.isConnected||button.disabled||!button.getClientRects().length)return;
    const rect=button.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;
    button.click();
  },{capture:true,passive:false});
  root.addEventListener('pointercancel',event=>{
    const press=active.get(event.pointerId);
    if(press)suppressClick.add(press.button);
    active.delete(event.pointerId);
  },{capture:true,passive:true});
  root.addEventListener('click',event=>{
    const button=buttonFor(event);
    if(button&&event.isTrusted&&event.detail>0&&suppressClick.has(button)){
      suppressClick.delete(button);
      event.preventDefault();event.stopImmediatePropagation();
    }
  },{capture:true,passive:false});
  root.addEventListener('keydown',event=>{
    const button=buttonFor(event);if(button)suppressClick.delete(button);
  },true);
  globalThis.addEventListener('blur',()=>active.clear());
}
