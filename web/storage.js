// Android commits its private storage before returning. Browser builds keep
// the same two-slot/checksum format in localStorage. Older WebView saves can
// still be read and are migrated into native storage at the next save.
export function persistentStorage(native=globalThis.LunaLocalStore,web=globalThis.localStorage){
  if(!native||typeof native.getItem!=='function')return web;
  return {
    backend:'android-shared-preferences',
    getItem:key=>native.getItem(key)??web.getItem(key),
    setItem(key,value){if(native.setItem(key,value)!==true)throw new Error('Native storage commit failed');try{web.setItem(key,value);}catch{}},
    removeItem(key){if(native.removeItem(key)!==true)throw new Error('Native storage removal failed');try{web.removeItem(key);}catch{}}
  };
}
