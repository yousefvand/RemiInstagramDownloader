/* Runs at document_start in Instagram's MAIN world. Observes only Instagram's
   ordinary API responses. Does not change request bodies or page playback. */
(() => {
  'use strict';
  if (window !== window.top || window.__remiMediaObserverV2) return;
  Object.defineProperty(window,'__remiMediaObserverV2',{value:true,configurable:false});
  const CHANNEL='RemiInstagramDownloader:media';
  const valid = candidate => {
    if (typeof candidate !== 'string') return null;
    try {
      const u=new URL(candidate.replace(/&amp;/g,'&'),location.href);
      if(u.protocol!=='https:')return null;
      const h=u.hostname.toLowerCase();
      return (h==='instagram.com'||h.endsWith('.instagram.com')||h.endsWith('.cdninstagram.com')||h.endsWith('.fbcdn.net'))?u.href:null;
    }catch{return null;}
  };
  const choose=(obj,keys)=>keys.map(k=>obj?.[k]).find(v=>typeof v==='string')||'';
  function identify(root) {
    const result=[];
    const queue=[{item:root,depth:0,inheritedCode:''}];
    // Music attribution and original-sound metadata describe reusable audio
    // assets, not the synchronized soundtrack of a particular rendition.
    // Never promote nested audio URLs to a video/audio binding.
    const visited=new WeakSet();
    let count=0;
    while(queue.length && count++<12500 && result.length<40) {
      const {item,depth,inheritedCode}=queue.shift();
      // Server-rendered Relay payloads sometimes place JSON inside JSON strings.
      // Parse bounded embedded objects without evaluating page JavaScript.
      if(typeof item==='string'){
        if(depth<12 && item.length<2_000_000 &&
           /video_versions|video_dash_manifest|video_url|dash_manifest/.test(item) &&
           /^[\s]*[\[{]/.test(item)){
          try{queue.push({item:JSON.parse(item),depth:depth+1,inheritedCode});}catch{}
        }
        continue;
      }
      if(!item||typeof item!=='object'||visited.has(item))continue;
      visited.add(item);
      if(Array.isArray(item)){
        if(depth<24)for(const value of item.slice(0,300))if(value && typeof value==='object')queue.push({item:value,depth:depth+1,inheritedCode});
        continue;
      }
      const code=choose(item,['code','shortcode','media_code','media_shortcode'])||inheritedCode;
      const video=[];const image=[];const audio=[];
      const versions=item.video_versions||item.video_versions2||item.video_resources||[];
      if(Array.isArray(versions))for(const v of versions.slice(0,18)){
        const url=valid(v?.url||v?.src);if(url)video.push({url,width:Number(v?.width||v?.width_in_pixels||0),height:Number(v?.height||0)});
      }
      for(const field of ['video_url','video_playback_url','playback_url','fallback_url']){
        const u=valid(item[field]);if(u)video.push({url:u,width:0,height:0});
      }
      const imageVersions=item.image_versions2?.candidates||item.display_resources||item.image_versions?.candidates||[];
      if(Array.isArray(imageVersions))for(const v of imageVersions.slice(0,12)){
        const url=valid(v?.url||v?.src);if(url)image.push({url,width:Number(v?.width||v?.config_width||0)});
      }
      for(const field of ['display_url','display_src','thumbnail_src']){
        const u=valid(item[field]);if(u)image.push({url:u,width:0});
      }
      for(const field of ['progressive_download_url','audio_url','audio_src','audio_file_url']){
        const u=valid(item[field]);if(u)audio.push(u);
      }
      const dash=choose(item,['video_dash_manifest','dash_manifest','video_dash_manifest_xml','dash_manifest_xml']) ||
        choose(item?.dash_info,['video_dash_manifest','dash_manifest']);
      let ownPacket=null;
      if((video.length||image.length||audio.length||dash) && (code||video.length||dash)) {
        ownPacket={code,mediaId:String(item.id||item.pk||'').slice(0,35),videoUrls:video,imageUrls:image,
          // URLs from sound-info/music-info are NOT proof of playback pairing.
          audioUrls:[],dash:dash.slice(0,500000),hasAudio:typeof item.has_audio==='boolean'?item.has_audio:null};
        result.push(ownPacket);
      }
      if(depth<24)for(const [key,value] of Object.entries(item).slice(0,115)){
        if((value && typeof value==='object' || typeof value==='string' && value.length>100)
           && key!=='owner' && key!=='user' && key!=='users'){
          queue.push({item:value,depth:depth+1,inheritedCode:code});
        }
      }
    }
    return result;
  }
  // yt-dlp's authenticated route retrieves the selected post's media-info
  // record by numeric PK. This avoids guessing which CDN request belongs to
  // the Reel currently on screen. A carousel item retains its own PK and MPD.
  function shortcodeToPk(code) {
    const digits='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if(typeof code!=='string' || !/^[A-Za-z0-9_-]{3,28}$/.test(code))return null;
    let pk=0n;
    for(const char of code){
      const digit=digits.indexOf(char);
      if(digit<0)return null;
      pk=pk*64n+BigInt(digit);
    }
    return pk.toString();
  }
  function resolveMediaInfo(payload, expectedCode){
    const root=Array.isArray(payload?.items)?payload.items[0]:null;
    if(!root || typeof root!=='object')return [];
    const rootCode=root.code||root.shortcode;
    // Never promote a server record for another post into the selected post.
    // A numeric PK check also rejects response swaps with an omitted code.
    const wantedPk=shortcodeToPk(expectedCode);
    if(rootCode!==expectedCode && String(root.pk||root.id||'').split('_')[0]!==wantedPk)return [];
    const children=Array.isArray(root.carousel_media)&&root.carousel_media.length
      ?root.carousel_media:[root];
    const isCarousel=children.length>1;
    const collect=(item,idx)=>{
      const video=[];const images=[];
      const versions=item.video_versions||item.video_resources||[];
      for(const v of Array.isArray(versions)?versions:[]){
        const u=valid(v?.url||v?.src);
        if(u)video.push({url:u,width:Number(v.width)||0,height:Number(v.height)||0});
      }
      for(const field of ['video_url','video_playback_url']){
        const u=valid(item[field]);if(u)video.push({url:u,width:0,height:0});
      }
      const variants=item.image_versions2?.candidates||item.display_resources||[];
      for(const v of Array.isArray(variants)?variants:[]){
        const u=valid(v?.url||v?.src);if(u)images.push({url:u,width:Number(v.width)||0});
      }
      for(const field of ['display_url','thumbnail_src']){
        const u=valid(item[field]);if(u)images.push({url:u,width:0});
      }
      const dash=choose(item,['video_dash_manifest','dash_manifest'])||'';
      if(!video.length&&!images.length&&!dash)return null;
      return {code:expectedCode,mediaId:String(item.pk||item.id||'').split('_')[0],
        videoUrls:video,imageUrls:images,audioUrls:[],dash:dash.slice(0,500000),
        hasAudio:typeof item.has_audio==='boolean'?item.has_audio:null,
        source:'media-info',rootMediaId:String(root.pk||root.id||'').split('_')[0],
        carouselTotal:children.length,carouselIndex:isCarousel?idx:-1};
    };
    return children.map(collect).filter(Boolean);
  }
  function extractJSONObject(code){
    const start=code.indexOf('{');
    if(start<0)return null;
    let inString=false,slash=false,depth=0;
    for(let i=start;i<code.length;i++){
      const c=code[i];
      if(inString){if(slash){slash=false;continue;}if(c==='\\'){slash=true;continue;}if(c==='"')inString=false;continue;}
      if(c==='"'){inString=true;continue;}
      if(c==='{')depth++;
      if(c==='}'&&!--depth)return code.slice(start,i+1);
    }
    return null;
  }
  function inspect(text) {
    if(typeof text!=='string'||text.length<50||text.length>12_000_000)return;
    if(!/video_versions|video_dash_manifest|image_versions2|progressive_download_url|dash_manifest|video_url/.test(text))return;
    const clean=text.replace(/^for\s*\(\s*;;\s*\)\s*;/,'').trim();
    let packet;
    try {packet=JSON.parse(clean);}
    catch {
      // Instagram also embeds strict-JSON state inside wrappers such as
      // require("ScheduledServerJS").handle({...}). Decode only balanced
      // JSON objects; never evaluate the surrounding executable JavaScript.
      if(!/(?:^|\b)(?:_sharedData|__additionalDataLoaded|__initialData|ScheduledServerJS)/.test(clean))return;
      const candidate=extractJSONObject(clean);
      if(!candidate)return;
      try{packet=JSON.parse(candidate);}catch{return;}
    }
    const entries=identify(packet);
    if(entries.length)window.postMessage({channel:CHANNEL,entries},location.origin);
  }
  // Inspect server-provided inline state on load and on SPA insertions.
  // A WeakSet avoids repeatedly walking unchanged scripts.
  const scannedScripts=new WeakSet();
  function scanScripts(scope=document){
    const found=scope.querySelectorAll?.('script:not([src])')||[];
    for(const script of found){
      if(scannedScripts.has(script))continue;
      scannedScripts.add(script);
      if(script.textContent && script.textContent.length<12_000_000)inspect(script.textContent);
    }
    if(scope.nodeName==='SCRIPT' && !scannedScripts.has(scope)){
      scannedScripts.add(scope);inspect(scope.textContent||'');
    }
  }
  function beginScan(){
    scanScripts();
    const root=document.documentElement;
    if(!root)return;
    const scanObserver=new MutationObserver(mutations=>{
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(node.nodeType===1 && (node.nodeName==='SCRIPT' || node.querySelector?.('script:not([src])')))scanScripts(node);
        }
      }
    });
    scanObserver.observe(root,{childList:true,subtree:true});
  }
  if(typeof document!=='undefined') {
    if(document.documentElement)beginScan();
    else document.addEventListener('DOMContentLoaded',beginScan,{once:true});
  }
  // Optional user-triggered resolution for a particular post. Page-local,
  // credentialed GET only; no unofficial tokens, remote servers, or broad crawl.
  const requestedPosts=new Map();
  if(typeof window.addEventListener==='function')window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==window || event.origin!==location.origin ||
       data?.channel!=='RemiInstagramDownloader:resolve' ||
       !/^[\w-]{4,80}$/.test(data.code||'') ||
       !/^[\w-]{8,90}$/.test(data.nonce||''))return;
    const now=Date.now();
    const previous=requestedPosts.get(data.code);
    if(previous && now-previous<5000){
      window.postMessage({channel:'RemiInstagramDownloader:resolved',nonce:data.nonce},location.origin);
      return;
    }
    requestedPosts.set(data.code,now);
    (async()=>{
      const kind=data.kind==='reel'?'reel':'p';
      try{
        // First use the same media-info endpoint that mature extractors use.
        // A failed/restricted response falls through to the normal post HTML.
        const pk=shortcodeToPk(data.code);
        if(pk){
          try{
            const info=await originalFetch.call(window,`/api/v1/media/${pk}/info/`,{
              method:'GET',credentials:'include',redirect:'follow',
              headers:{'X-IG-App-ID':'936619743392459','X-ASBD-ID':'359341','Accept':'application/json'}
            });
            if(info.ok){
              const payload=await info.json();
              const records=resolveMediaInfo(payload,data.code);
              if(records.length){
                window.postMessage({channel:CHANNEL,entries:records},location.origin);
                return;
              }
            }
          }catch{}
        }
        const url=`/${kind}/${encodeURIComponent(data.code)}/`;
        const response=await originalFetch.call(window,url,{credentials:'include',redirect:'follow'});
        if(!response.ok)return;
        const text=await response.text();
        if(text.length>12_000_000)return;
        if(text.trimStart().startsWith('{'))inspect(text);
        else if(/video_versions|video_dash_manifest|video_url|dash_manifest/.test(text)){
          const doc=new DOMParser().parseFromString(text,'text/html');
          for(const script of [...doc.querySelectorAll('script:not([src])')].slice(0,180)){
            if(script.textContent?.length<12_000_000)inspect(script.textContent);
          }
        }
      }catch{}finally{
        window.postMessage({channel:'RemiInstagramDownloader:resolved',nonce:data.nonce},location.origin);
      }
    })();
  });
  function isInstagramRequest(request) {
    try {const url=new URL(typeof request==='string'?request:request.url,location.href);
      return url.origin===location.origin && !/\/direct_v2\//.test(url.pathname);
    }catch{return false;}
  }
  const originalFetch=window.fetch;
  if(typeof originalFetch==='function') {
    window.fetch=function(...args) {
      const promise=Reflect.apply(originalFetch,this,args);
      try {
        if(isInstagramRequest(args[0]))promise.then(response=>{
          const type=response.headers.get('content-type')||'';
          if(type.includes('json')||type.includes('text/plain')||type.includes('javascript')||type.includes('text/html'))response.clone().text().then(inspect).catch(()=>{});
        }).catch(()=>{});
      }catch{}
      return promise;
    };
  }
  const proto=window.XMLHttpRequest?.prototype;
  if(proto){
    const originalOpen=proto.open, originalSend=proto.send;
    proto.open=function(method,url,...rest){
      this.__remiTracked=isInstagramRequest(url);
      return Reflect.apply(originalOpen,this,[method,url,...rest]);
    };
    proto.send=function(...args){
      if(this.__remiTracked)this.addEventListener('load',()=>{
        try{if(!this.responseType||this.responseType==='text')inspect(this.responseText);}catch{}
      },{once:true});
      return Reflect.apply(originalSend,this,args);
    };
  }
})();
