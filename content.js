/* RemiInstagramDownloader 0.1.0 — per-media overlays, exactly two permanent buttons per item. */
(() => {
  'use strict';
  if (window !== window.top || document.getElementById('remi-instagram-downloader-host')) return;

  const CHANNEL = 'RemiInstagramDownloader:media';
  const defaults = {
    videoQuality:'best', videoSound:'yes',
    audioQuality:'best', audioSource:'auto',
    imageResolution:'best', imageFormat:'original'
  };
  // There is no mutable global download configuration. Every media control owns
  // an isolated copy, with defaults applying only when that media has no override.
  const STORE_KEY = 'remi_item_config_v1';
  const itemPreferences = new Map();
  let persistQueue = Promise.resolve();
  const labels = {video:'Video', audio:'Audio', image:'Image'};
  const captured = [];
  const entries = new Map();  // One overlay and independent job state for each visible media element.
  const jobs = new Map();
  let opened = null;
  let syncScheduled = false;
  const host = document.createElement('div');
  host.id = 'remi-instagram-downloader-host';
  const shadow = host.attachShadow({mode:'closed'});
  shadow.innerHTML = `
    <style>
      :host {all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;
        font:12px/1.35 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#fff}
      * {box-sizing:border-box}
      button,select {font:inherit}
      button {border:0;color:inherit;cursor:pointer;padding:0;appearance:none;-webkit-appearance:none}
      .widget {position:fixed;pointer-events:none;z-index:1}
      .buttons {display:flex;align-items:center;gap:3px;pointer-events:auto}
      .dl,.dots {height:36px;width:18px;min-width:18px;border-radius:9px;background:#7c3aed;
        box-shadow:0 3px 12px #1e103f88;display:flex;align-items:center;
        justify-content:center;padding:0;line-height:0;vertical-align:middle}
      .dl:hover,.dots:hover {background:#6d28d9}
      .dl:disabled,.dots:disabled {opacity:.55;cursor:wait}
      .dl svg {display:block;width:13px;height:17px;flex-shrink:0}
      .dots svg {display:block;width:14px;height:19px;flex-shrink:0}
      button:focus-visible,summary:focus-visible,select:focus-visible {outline:2px solid white;outline-offset:2px}
      .menu,.progress {position:absolute;top:44px;left:0;width:258px;background:#241633;
        color:#fff;border:1px solid #7351a0;border-radius:11px;padding:8px;
        box-shadow:0 8px 28px #130d1d99;pointer-events:auto}
      .menu {max-height:min(70vh,420px);overflow-y:auto}
      .menu-title {font-size:12px;font-weight:700;color:#e9d5ff;margin:4px 4px 7px}
      details {margin:3px 0;border:1px solid transparent;border-radius:8px;background:#322044}
      details[data-selected="true"] {border-color:#9a70e9;background:#402761}
      summary {list-style:none;cursor:pointer;font-weight:650;padding:9px;display:flex;align-items:center;gap:7px}
      summary::-webkit-details-marker {display:none}
      summary::before {content:'○';color:#b7a7d4;font-size:16px}
      details[data-selected="true"] summary::before {content:'●';color:#d8b4fe}
      summary::after {content:'▸';margin-left:auto;color:#c4b5fd}
      details[open] summary::after {content:'▾'}
      .settings {display:grid;gap:7px;padding:0 9px 10px}
      label {display:grid;gap:4px;color:#e9d5ff}
      select {color:#fff;background:#422b5c;border:1px solid #8666ad;border-radius:6px;padding:6px;width:100%}
      .footer {font-size:11px;color:#d4bff3;padding:7px 4px 2px}
      .stream-choices[hidden] {display:none!important}
      .stream-heading {font-weight:700;margin-bottom:6px;color:#e9d5ff}
      .stream-note {color:#e6d5ff;font-size:11px;margin-bottom:6px}
      .stream-option {display:grid;gap:5px;border-top:1px solid #70528e;padding:7px 0}
      .stream-option video {width:100%;max-height:124px;background:#171020;border-radius:5px}
      .stream-option audio {width:100%;height:40px}
      .stream-option button {padding:7px;border-radius:6px;background:#7854bc;font-weight:600;line-height:1.3}
      .stream-option button[aria-pressed="true"] {background:#1e805d}
      .stream-option small {color:#e4d5f1}
      .progress {width:230px;padding:10px;overflow-wrap:anywhere}
      .message {margin:0 0 8px}
      .bar {height:7px;width:100%;border-radius:8px;background:#5a3d7e;overflow:hidden}
      .fill {width:0;height:100%;background:#c4b5fd;transition:width .15s}
      .progress-row {display:flex;align-items:center;justify-content:space-between;margin-top:8px}
      .cancel {background:#ad2563;border-radius:7px;padding:6px 10px}
      .cancel:hover {background:#ca2773}
      .progress[data-state="warning"] {border-color:#eab308}
      .progress[data-state="error"] {border-color:#f87171}
      [hidden] {display:none!important}
      @media(prefers-reduced-motion:reduce) {.fill {transition:none}}
    </style>
    <div class="overlays" aria-label="Instagram per-media download tools"></div>`;
  const overlays = shadow.querySelector('.overlays');
  const SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>`;
  const DOTS_SVG = `<svg viewBox="0 0 18 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="9" cy="19" r="2"/></svg>`;
  const MENU = `<div class="menu-title">Download configuration</div>
    <details data-section="video"><summary>Video</summary><div class="settings">
      <label>Quality<select data-setting="videoQuality"><option value="best">Highest available</option><option value="balanced">Balanced</option><option value="small">Smaller file</option></select></label>
      <label>Audio track<select data-setting="videoSound"><option value="yes">Include audio</option><option value="no">Silent video</option></select></label>
    </div></details>
    <details data-section="audio"><summary>Audio</summary><div class="settings">
      <label>Source<select data-setting="audioSource"><option value="auto">Separate stream or extract from video</option><option value="separate">Separate audio only</option></select></label>
      <label>Quality<select data-setting="audioQuality"><option value="best">Highest available</option><option value="balanced">Balanced</option></select></label>
    </div></details>
    <details data-section="image"><summary>Image</summary><div class="settings">
      <label>Resolution<select data-setting="imageResolution"><option value="best">Highest available</option><option value="visible">Current displayed image</option></select></label>
      <label>Format<select data-setting="imageFormat"><option value="original">Original</option><option value="jpeg">Convert to JPEG</option></select></label>
    </div></details>
    <div class="footer">Selected: <strong class="selection-name">Video</strong>. Press ↓ on this media.</div>`;

  function attach() {
    if (!host.isConnected) (document.body || document.documentElement).append(host);
    requestSync();
  }
  attach();
  document.addEventListener('DOMContentLoaded', attach, {once:true});
  // Settings have stable identities per *item*, not per tab or media type. Only
  // fingerprints of media paths are saved, never private CDN URLs or tokens.
  function fingerprint(input){
    let h=2166136261;
    for(let i=0;i<input.length;i++){
      h=Math.imul(h ^ input.charCodeAt(i),16777619)>>>0;
    }
    return `${h.toString(36)}-${input.length.toString(36)}`;
  }
  function mediaIdentity(element,type){
    const code=postCode(element);
    const mediaUrl=type==='video'
      ? (element.poster || element.currentSrc || element.getAttribute('src'))
      : (element.currentSrc || element.getAttribute('src') || bestSrcset(element.getAttribute('srcset')));
    let path='';
    try{
      if(mediaUrl){
        const url=new URL(mediaUrl,location.href);
        if(url.protocol==='https:' && /(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/.test(url.hostname))path=url.hostname+url.pathname;
      }
    }catch{}
    // A shortcode alone does NOT identify a carousel slide. If no media asset
    // path or poster is available (for example a blob: video), keep that
    // element's settings in memory only instead of letting multiple slides
    // silently share the same persisted overrides.
    if(!path)return null;
    return `item:${code||'no-code'}:${type}:${fingerprint(path)}`;
  }
  function validConfig(candidate){
    const out={...defaults};
    if(!candidate || typeof candidate!=='object')return out;
    const options={
      videoQuality:['best','balanced','small'],videoSound:['yes','no'],
      audioQuality:['best','balanced'],audioSource:['auto','separate'],
      imageResolution:['best','visible'],imageFormat:['original','jpeg']
    };
    for(const [key,allowed] of Object.entries(options))if(allowed.includes(candidate[key]))out[key]=candidate[key];
    return out;
  }
  function restoreEntry(entry){
    const saved=entry.key && itemPreferences.get(entry.key);
    entry.config=validConfig(saved?.config);
    entry.selected=labels[saved?.selected] ? saved.selected : entry.type;
    // Only a deliberate menu selection may override newly detected media type.
    // Older records did not store this flag; a nondefault type indicates intent.
    entry.selectedExplicit=saved?.selectedExplicit===true ||
      (saved?.selectedExplicit===undefined && !!saved && entry.selected!==entry.type);
    syncSelectOptions(entry);
    selectType(entry,entry.selected,false);
  }
  function persistEntry(entry){
    // Persist only this item's choices; never mutate defaults or other items.
    entry.dirty=true;
    if(!entry.key)return;
    itemPreferences.set(entry.key,{
      selected:entry.selected,selectedExplicit:entry.selectedExplicit===true,
      config:{...entry.config},updated:Date.now()
    });
    // Cap storage to keep local storage small even on long Instagram sessions.
    const sorted=[...itemPreferences.entries()].sort((a,b)=>b[1].updated-a[1].updated).slice(0,200);
    itemPreferences.clear();
    for(const [key,value] of sorted)itemPreferences.set(key,value);
    const snapshot=Object.fromEntries(itemPreferences);
    persistQueue=persistQueue.catch(()=>{}).then(()=>chrome.storage.local.set({[STORE_KEY]:snapshot}));
    persistQueue.catch(()=>{});
  }
  chrome.storage.local.get([STORE_KEY]).then(stored=>{
    const saved=stored[STORE_KEY];
    if(saved && typeof saved==='object'){
      for(const [key,value] of Object.entries(saved)){
        if(!key.startsWith('item:')||!value||typeof value!=='object'||itemPreferences.has(key))continue;
        itemPreferences.set(key,{
          selected:labels[value.selected]?value.selected:'image',
          selectedExplicit:value.selectedExplicit,
          config:validConfig(value.config),updated:Number(value.updated)||0
        });
      }
    }
    entries.forEach(entry=>{if(!entry.dirty)restoreEntry(entry);});
    // A user may change a menu before storage has finished loading.
    // Keep those local edits and persist them together with restored settings.
    entries.forEach(entry=>{if(entry.dirty)persistEntry(entry);});
  }).catch(()=>{});
  function syncSelectOptions(entry){
    entry.node.querySelectorAll('select').forEach(select=>{
      const wanted=entry.config[select.dataset.setting];
      if([...select.options].some(option=>option.value===wanted))select.value=wanted;
    });
  }
  function selectType(entry,type,persist=true){
    if(!(type in labels))return;
    if(persist)entry.selectedExplicit=true;
    entry.selected=type;
    entry.node.querySelectorAll('details').forEach(detail=>{
      const chosen=detail.dataset.section===type;
      detail.open=chosen;
      detail.dataset.selected=String(chosen);
    });
    entry.node.querySelector('.selection-name').textContent=labels[type];
    const download=entry.node.querySelector('.dl');
    download.title=`Download ${type} from this media`;
    download.setAttribute('aria-label',download.title);
    if(persist)persistEntry(entry);
  }
  function setOpen(entry, expanded){
    if(opened && opened!==entry){opened.menu.hidden=true;opened.dots.setAttribute('aria-expanded','false');}
    entry.menu.hidden=!expanded;
    entry.dots.setAttribute('aria-expanded',String(expanded));
    opened=expanded?entry:null;
    if(expanded)entry.panel.hidden=true;
    else if(entry.awaitingSelection)entry.panel.hidden=false;
    place(entry);
  }
  function createEntry(element, type) {
    const node=document.createElement('div');
    node.className='widget';
    node.innerHTML=`<div class="buttons" role="group" aria-label="Download this Instagram media">
      <button class="dl" type="button">${SVG}</button>
      <button class="dots" type="button" title="Configure this media download" aria-label="Configure this media download" aria-expanded="false">${DOTS_SVG}</button>
    </div>
    <div class="menu" hidden>${MENU}</div>
    <div class="progress" role="status" aria-live="polite" hidden>
      <p class="message">Preparing…</p><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill"></div></div>
      <div class="progress-row"><span class="percent">0%</span><button class="cancel" type="button">Cancel</button></div>
    </div>`;
    overlays.append(node);
    const entry={element,type,key:mediaIdentity(element,type),config:{...defaults},dirty:false,selectedExplicit:false,node,selected:type,menu:node.querySelector('.menu'),dots:node.querySelector('.dots'),panel:node.querySelector('.progress'),jobId:null,hideTimer:null,
      streamChoices:null,selectedVideoUrl:null,selectedAudioUrl:null,streamIdentity:null,streamToken:null,awaitingSelection:false};
    entries.set(element,entry);
    restoreEntry(entry);
    entry.dots.addEventListener('click',()=>{if(!entry.jobId)setOpen(entry,entry.menu.hidden);});
    node.querySelector('.dl').addEventListener('click',()=>begin(entry));
    node.querySelector('.cancel').addEventListener('click',()=>cancel(entry));
    node.querySelectorAll('details').forEach(detail=>detail.querySelector('summary').addEventListener('click',event=>{
      event.preventDefault();selectType(entry,detail.dataset.section);
    }));
    node.querySelectorAll('select').forEach(select=>select.addEventListener('change',()=>{
      entry.config[select.dataset.setting]=select.value;
      persistEntry(entry);
    }));
    return entry;
  }
  function clearStreamChoices(entry){
    entry.streamChoices=null;entry.selectedVideoUrl=null;entry.selectedAudioUrl=null;
    entry.streamIdentity=null;
    entry.streamToken=null;
  }
  function clearEntry(entry){
    if(entry===opened)opened=null;
    clearTimeout(entry.hideTimer);
    // Keep the overlay for an in-flight job, including while its source scrolls away.
    if(entry.jobId){entry.node.hidden=true;return;}
    entry.node.remove();entries.delete(entry.element);
  }

  function clipped(element) {
    let rect=element.getBoundingClientRect();
    if(rect.width<145 || rect.height<140)return null;
    const style=getComputedStyle(element);
    if(style.visibility==='hidden'||style.display==='none'||Number(style.opacity)===0)return null;
    let left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);
    for(let p=element.parentElement;p&&p!==document.documentElement;p=p.parentElement){
      const ps=getComputedStyle(p);
      if(ps.visibility==='hidden'||ps.display==='none')return null;
      if(/hidden|clip|auto|scroll/.test(ps.overflowX)){const b=p.getBoundingClientRect();left=Math.max(left,b.left);right=Math.min(right,b.right);}
      if(/hidden|clip|auto|scroll/.test(ps.overflowY)){const b=p.getBoundingClientRect();top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}
    }
    if(right-left<105||bottom-top<95)return null;
    return {left,top,right,bottom,width:right-left,height:bottom-top,original:rect};
  }
  function intersectionRatio(a,b){
    const w=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
    const h=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    return w*h / Math.max(1,Math.min(a.width*a.height,b.width*b.height));
  }
  function eligibleImage(image){
    if(!image.getAttribute('src')&&!image.getAttribute('srcset'))return false;
    if(image.closest('button,header,nav'))return false;
    const alt=(image.getAttribute('alt')||'').toLowerCase();
    if(/profile picture|avatar|emoji/.test(alt))return false;
    return true;
  }
  // Instagram may display a video as an <img> cover, especially on /p/ pages
  // and in feed grids. Its parent is not necessarily a /reel/ link. Use only
  // an exact thumbnail-to-video metadata match, never a shared shortcode alone,
  // so a neighboring carousel photo is not promoted into a video.
  function hasMatchedVideoMetadata(image){
    if(image.tagName!=='IMG')return false;
    const src=safeUrl(image.currentSrc||image.src)||safeUrl(bestSrcset(image.getAttribute('srcset')));
    if(!src)return false;
    const code=postCode(image);
    return captured.some(packet=>
      (packet.videoUrls.length>0 || !!packet.dash) &&
      (!code || packet.code===code) &&
      packet.imageUrls.some(candidate=>urlIdentity(candidate.url,src))
    );
  }
  function isVideoPreview(image){
    if(image.tagName!=='IMG')return false;
    if(image.closest('a[href*="/reel/"],a[href*="/reels/"],a[href*="/tv/"]'))return true;
    // Grid posts at /p/ often use an IMG as a video cover and a play glyph.
    // Scope the marker to the SAME tile link, never the whole article.
    const tile=image.closest('a[href*="/p/"]');
    if(tile?.querySelector('svg[aria-label="Video"],svg[aria-label="Reel"],svg[aria-label="Clip"],svg[aria-label="Play"],[aria-label="Play video"]'))return true;
    return hasMatchedVideoMetadata(image);
  }
  function findMedia(){
    const seen=[];
    const videos=[...document.querySelectorAll('video')].map(element=>({element,type:'video',box:clipped(element)})).filter(x=>x.box);
    // Preserve visual DOM order, but prefer video over identical poster imagery.
    for(const element of document.querySelectorAll('img,video')){
      if(element.tagName==='VIDEO'){
        const match=videos.find(v=>v.element===element);
        if(match)seen.push(match);
        continue;
      }
      if(!eligibleImage(element))continue;
      const box=clipped(element);
      if(!box || videos.some(item=>intersectionRatio(item.box,box)>.78) || seen.some(item=>intersectionRatio(item.box,box)>.85))continue;
      seen.push({element,type:isVideoPreview(element)?'video':'image',box});
    }
    return seen;
  }
  function place(entry,box=clipped(entry.element)) {
    if(!box){entry.node.hidden=true;return;}
    entry.node.hidden=false;
    const left=Math.min(innerWidth-42,Math.max(1,box.left+8));
    const top=Math.max(1,box.top+8);
    entry.node.style.left=`${left}px`;entry.node.style.top=`${top}px`;
    const shift=Math.min(0,innerWidth-left-270);
    entry.menu.style.left=`${shift}px`;
    entry.panel.style.left=`${Math.min(0,innerWidth-left-242)}px`;
    const spaceBelow=innerHeight-(top+44);
    const topOffset=spaceBelow>200?44:Math.max(-400,Math.min(-130,-entry.menu.scrollHeight-4));
    entry.menu.style.top=`${topOffset}px`;
    entry.panel.style.top=`${spaceBelow>130?44:-105}px`;
  }
  function adoptDetectedType(entry, detected){
    if(entry.type===detected || entry.jobId)return;
    clearStreamChoices(entry);
    entry.type=detected;
    entry.key=mediaIdentity(entry.element,detected);
    if(entry.selectedExplicit){
      // User explicitly asked for Image/Audio/Video. Respect that override,
      // even when a later API response reveals the underlying file type.
      persistEntry(entry);
      selectType(entry,entry.selected,false);
    }else{
      entry.dirty=false;
      restoreEntry(entry);
    }
  }
  function sync() {
    syncScheduled=false;
    if(!host.isConnected){attach();return;}
    const present=findMedia();
    const visibleElements=new Set(present.map(item=>item.element));
    for(const item of present){
      const entry=entries.get(item.element)||createEntry(item.element,item.type);
      adoptDetectedType(entry,item.type);
      const key=mediaIdentity(item.element,item.type);
      if(entry.key!==key && !entry.jobId){
        clearStreamChoices(entry);
        entry.key=key;
        entry.dirty=false;
        restoreEntry(entry);
      }
      place(entry,item.box);
    }
    for(const [element,entry] of [...entries])if(!visibleElements.has(element))clearEntry(entry);
  }
  function requestSync(){if(syncScheduled)return;syncScheduled=true;requestAnimationFrame(sync);}
  const observer=new MutationObserver(mutations=>{
    if(mutations.every(m=>host.contains(m.target)||m.target===host))return;
    requestSync();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset','style','class','aria-hidden']});
  document.addEventListener('scroll',requestSync,{capture:true,passive:true});
  window.addEventListener('resize',requestSync,{passive:true});
  window.addEventListener('popstate',requestSync);
  document.addEventListener('click',event=>{
    if(opened&&!event.composedPath().includes(host))setOpen(opened,false);
    // Instagram frequently changes slides or pages after clicks.
    requestSync();
  },true);
  const periodic=setInterval(requestSync,1800);
  window.addEventListener('pagehide',()=>clearInterval(periodic),{once:true});
  requestSync();

  function safeUrl(raw){
    if(typeof raw!=='string')return null;
    try{const u=new URL(raw.replace(/&amp;/g,'&'),location.href),h=u.hostname.toLowerCase();
      return u.protocol==='https:'&&(h==='instagram.com'||h.endsWith('.instagram.com')||h.endsWith('.cdninstagram.com')||h.endsWith('.fbcdn.net'))?u.href:null;
    }catch{return null;}
  }
  function bestSrcset(value){
    const parts=(value||'').split(',').map(s=>s.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)([wx])$/)).filter(Boolean);
    parts.sort((a,b)=>Number(b[2])-Number(a[2]));return parts[0]?.[1]||null;
  }
  function postCode(element){
    const a=element.closest('a[href*="/reel/"],a[href*="/p/"],a[href*="/tv/"]');
    const article=element.closest('article,[role="dialog"]');
    const relative=a?.getAttribute('href')||article?.querySelector('a[href*="/p/"],a[href*="/reel/"]')?.getAttribute('href')||location.pathname;
    return relative.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1]||null;
  }
  function urlIdentity(a,b){
    const one=safeUrl(a),two=safeUrl(b);
    if(!one||!two)return false;
    const x=new URL(one),y=new URL(two);
    if(x.pathname===y.pathname)return true;
    // Different CDN renditions can have _n/_s or a different extension while
    // retaining the same long image asset ID. Compare the identifying THREE
    // numeric components, never a generic post ID or arbitrary filename text.
    const id=str=>str.pathname.match(/(?:^|\/)(\d{10,}_\d+_\d+)(?:_[a-z0-9]+)?\.(?:jpg|jpeg|webp|avif|png)/i)?.[1];
    return Boolean(id(x)&&id(x)===id(y));
  }
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL||!Array.isArray(event.data.entries))return;
    for(const packet of event.data.entries.slice(0,30)){
      if(!packet||typeof packet!=='object')continue;
      const obj={
        code:String(packet.code||'').slice(0,90),mediaId:String(packet.mediaId||'').slice(0,50),timestamp:Date.now(),
        videoUrls:(packet.videoUrls||[]).slice(0,15).map(v=>({url:safeUrl(v?.url),width:Number(v?.width)||0})).filter(v=>v.url),
        imageUrls:(packet.imageUrls||[]).slice(0,15).map(v=>({url:safeUrl(v?.url),width:Number(v?.width)||0})).filter(v=>v.url),
        audioUrls:(packet.audioUrls||[]).slice(0,12).map(safeUrl).filter(Boolean),
        dash:typeof packet.dash==='string'?packet.dash.slice(0,500000):'',hasAudio:packet.hasAudio,
        source:packet.source==='media-info'?'media-info':'observed',
        rootMediaId:String(packet.rootMediaId||'').slice(0,40),
        carouselTotal:Number(packet.carouselTotal)||0,
        carouselIndex:Number.isInteger(packet.carouselIndex)?packet.carouselIndex:-1
      };
      if(!(obj.videoUrls.length||obj.imageUrls.length||obj.audioUrls.length||obj.dash))continue;
      captured.unshift(obj);
    }
    if(captured.length>180)captured.length=180;
    // Metadata can arrive AFTER Instagram renders its video poster as an IMG.
    // Re-evaluate each visible item instead of leaving its default on Image.
    requestSync();
  });
  function scriptFallback(code){
    if(!code)return [];
    const out=[];
    for(const script of document.scripts){
      const txt=script.textContent||'';
      if(txt.length>4_000_000||!txt.includes(code)||!txt.includes('video_versions'))continue;
      // Only use a source when one video's URL and a shortcode occur in the same modest chunk.
      const start=txt.indexOf('"code":"'+code+'"');
      if(start<0)continue;
      const part=txt.slice(start,start+50000);
      const urls=[...part.matchAll(/"url":"(https:\/\/[^"\\]+(?:\\\/[^"\\]+)*)"/g)]
        .map(m=>safeUrl(m[1].replace(/\\\//g,'/'))).filter(Boolean);
      if(urls.length===1)out.push({code,videoUrls:[{url:urls[0],width:0}],imageUrls:[],audioUrls:[],dash:''});
    }
    return out;
  }
  function sourceData(entry){
    const el=entry.element, code=postCode(el);
    const elementImg=el.tagName==='IMG'?el:null;
    const elementVideo=el.tagName==='VIDEO'?el:null;
    const visibleSrc=elementImg?safeUrl(elementImg.currentSrc||elementImg.src):safeUrl(elementVideo?.poster);
    const highSrc=elementImg?safeUrl(bestSrcset(elementImg.getAttribute('srcset')))||visibleSrc:visibleSrc;
    const directVideo=elementVideo?safeUrl(elementVideo.currentSrc||elementVideo.src):null;
    const directPoster=elementVideo?safeUrl(elementVideo.poster):null;
    // Only associate a packet with this element when it shares a concrete
    // media asset (video URL, poster, or image derivative). A shortcode names
    // the *post*, not an individual carousel slide, so code-only guesses can
    // silently download a different video and its unrelated soundtrack.
    const assetMatch=p=>
      p.imageUrls.some(x=>urlIdentity(x.url,visibleSrc||directPoster)) ||
      p.videoUrls.some(x=>urlIdentity(x.url,directVideo));
    const exact=captured.filter(p=>
      (!code || !p.code || p.code===code) && assetMatch(p));
    const dedup=new Map();
    for(const p of exact){
      const id=p.mediaId||p.videoUrls[0]?.url||p.imageUrls[0]?.url||p.dash;
      if(!dedup.has(id))dedup.set(id,p);
    }
    // Do not infer a carousel child's identity from the post shortcode or
    // a sole playing element. Established downloaders resolve the individual
    // media record and its own video_versions/video_dash_manifest instead.
    // A missing asset match must remain unresolved rather than stealing a
    // neighbouring Reel's stream or soundtrack.
    // Multiple different packets claiming the same poster are ambiguous too.
    // Refuse them rather than selecting whichever arrived most recently.
    let candidates=dedup.size===1?[...dedup.values()]:[];
    // The normal video player is often blob:-backed and its poster URL may
    // differ from image_versions2 due to Instagram CDN transformations.
    // For a NON-carousel post, a post-code-verified media-info API response
    // uniquely names its only media item, so its video does not need a poster
    // URL match. Never apply this fallback to a carousel or a generic capture.
    if(!candidates.length && code && (entry.type==='video'||entry.selected==='video'||entry.selected==='audio')){
      const verified=captured.filter(p=>p.code===code && p.source==='media-info' &&
        p.carouselTotal===1 && (p.videoUrls.length || p.dash));
      const uniqueIds=new Map(verified.filter(p=>p.mediaId).map(p=>[p.mediaId,p]));
      if(uniqueIds.size===1)candidates=[...uniqueIds.values()];
    }
    // The previous 'exact-asset' binding was UNSAFE: it promoted nested
    // original_sound_info/music_info URLs into a media soundtrack. A matching
    // poster/shortcode does not mean a reusable sound asset is synchronized
    // to the video. Only tracks in the SAME selected item's video DASH MPD
    // may be paired, and only after selecting a video representation in it.
    const manifestOwner=candidates.length===1 &&
      (exact.includes(candidates[0]) || (candidates[0].source==='media-info' &&
        candidates[0].carouselTotal===1 && candidates[0].code===code)) &&
      candidates[0].dash && (candidates[0].videoUrls.length || candidates[0].imageUrls.length)
        ? candidates[0] : null;
    const allowTabWideFallback=false; // Never borrow tab-wide media for per-item controls.
    // Never use a different carousel slide's thumbnail merely because it shares
    // a post shortcode. Match the clicked image against its own derivative URLs.
    const matchedImages=candidates.flatMap(c=>c.imageUrls).filter(img=>urlIdentity(img.url,visibleSrc||directPoster));
    const unique=items=>[...new Set(items.filter(Boolean))].slice(0,20);
    return {
      code:code||'media', pageUrl:location.href, scopedToElement:true, allowTabWideFallback,
      selectedVideoUrl:entry.selectedVideoUrl,
      selectedAudioUrl:entry.selectedAudioUrl,
      // A playing shortcode is insufficient proof of stream identity (carousels).
      // Network captures must have the exact URL already identified for this item.
      playbackTagged:false,
      // A playback token is issued only for the exact video element clicked;
      // the worker can use it to match fresh network traffic without borrowing
      // another carousel slide's or an unrelated feed video's URL.
      playbackToken:((entry.selectedVideoUrl||entry.selectedAudioUrl) && entry.streamToken) ||
        (elementVideo && videoIsSolePlayer(el) ? playbackToken(el) : null),
      poster:directPoster||visibleSrc||null,
      // Only this exact media record supplies alternative qualities. A playing
      // video's direct URL is trustworthy for THAT element, not for every
      // network capture grouped under the same playback token.
      videoUrls:unique([directVideo,...candidates.flatMap(c=>[...c.videoUrls].sort((a,b)=>b.width-a.width).map(v=>v.url))]),
      // Do not expose arbitrary audio CDN URLs to the processor.
      audioUrls:[],
      audioBinding:manifestOwner?'same-manifest':'none',
      pairedVideoUrls:[],
      imageUrls:unique(entry.config.imageResolution==='visible'
        ?[visibleSrc,highSrc]
        :[...matchedImages.sort((a,b)=>b.width-a.width).map(x=>x.url),highSrc,visibleSrc]),
      dash:manifestOwner?.dash||null,
      expectsAudio:manifestOwner
        ?(candidates.find(c=>c.hasAudio!==null&&c.hasAudio!==undefined)?.hasAudio??null)
        :null,
      hasVisibleVideo:entry.type==='video',
      matchedMediaId:candidates[0]?.mediaId||null,
      ambiguousMatching:dedup.size>1
    };
  }
  function resolvePostMetadata(entry) {
    const code=postCode(entry.element);
    if(!code)return Promise.resolve();
    const a=entry.element.closest('a[href*="/reel/"],a[href*="/p/"]');
    const kind=(a?.getAttribute('href')||location.pathname).includes('/reel/')?'reel':'p';
    const nonce=crypto.randomUUID().replace(/-/g,'');
    return new Promise(resolve=>{
      let settled=false;
      const finish=()=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        window.removeEventListener('message',listener);
        resolve();
      };
      const listener=event=>{
        if(event.source===window&&event.origin===location.origin &&
           event.data?.channel==='RemiInstagramDownloader:resolved' && event.data?.nonce===nonce)finish();
      };
      const timer=setTimeout(finish,5000);
      window.addEventListener('message',listener);
      window.postMessage({channel:'RemiInstagramDownloader:resolve',code,kind,nonce},location.origin);
    });
  }
  // Associate observed CDN requests with the sole active video instead of a random
  // neighbouring tile. Autoplay events are ignored when multiple videos are playing.
  let lastPlaybackSignal='';
  const playbackTokens=new WeakMap();
  function playbackToken(video){
    if(!playbackTokens.has(video))playbackTokens.set(video,crypto.randomUUID().replace(/-/g,''));
    return playbackTokens.get(video);
  }
  function videoIsSolePlayer(video){
    // readyState may still be 0 when the initial network request begins.
    return !video.paused && !video.ended &&
      [...document.querySelectorAll('video')].filter(v=>!v.paused && !v.ended).length===1;
  }
  function playbackContext() {
    const active=[...document.querySelectorAll('video')].filter(v => !v.paused && !v.ended);
    if(active.length!==1)return null;
    const video=active[0];
    const code=postCode(video);
    if(!code)return null;
    return {code,token:playbackToken(video),src:safeUrl(video.currentSrc||video.src),poster:safeUrl(video.poster)};
  }
  function reportPlayback(force=false){
    const info=playbackContext();
    const signature=info ? `${info.code}:${info.token}` : '';
    if(!force && signature===lastPlaybackSignal)return;
    lastPlaybackSignal=signature;
    chrome.runtime.sendMessage({type:'PLAYBACK',playback:info}).catch(()=>{});
  }
  // 'play' occurs before readyState is populated and before 'playing': the
  // earlier signal is essential for attributing initial CDN requests.
  document.addEventListener('play',()=>reportPlayback(true),true);
  document.addEventListener('playing',()=>reportPlayback(true),true);
  document.addEventListener('pause',()=>reportPlayback(true),true);
  document.addEventListener('ended',()=>reportPlayback(true),true);
  document.addEventListener('timeupdate',()=>reportPlayback(),true);
  window.addEventListener('pagehide',()=>{lastPlaybackSignal='';}, {once:true});

  function update(entry,percent,message){
    const p=Math.max(0,Math.min(100,Math.round(percent)||0));
    entry.panel.hidden=false;
    entry.node.querySelector('.message').textContent=message;
    entry.node.querySelector('.fill').style.width=p+'%';
    entry.node.querySelector('.percent').textContent=p+'%';
    entry.node.querySelector('.bar').setAttribute('aria-valuenow',String(p));
  }
  function complete(entry,state,message){
    if(entry.jobId)jobs.delete(entry.jobId);
    entry.jobId=null;
    entry.preparing=false;
    entry.awaitingSelection=false;
    update(entry,state==='done'||state==='warning'?100:0,message||state);
    entry.panel.dataset.state=state;
    entry.node.querySelector('.cancel').hidden=true;
    entry.node.querySelector('.cancel').disabled=false;
    entry.node.querySelector('.dl').disabled=false;
    entry.dots.disabled=false;
    clearTimeout(entry.hideTimer);
    entry.hideTimer=setTimeout(()=>{entry.panel.hidden=true;
      if(!clipped(entry.element)){entry.node.remove();entries.delete(entry.element);}
    },state==='error'||state==='warning'?14000:8500);
    requestSync();
  }
  async function begin(entry){
    if(entry.jobId)return;
    setOpen(entry,false);
    entry.awaitingSelection=false;
    clearTimeout(entry.hideTimer);
    // Refresh playback ownership synchronously before asking the worker for streams.
    reportPlayback(true);
    // Final synchronous check handles the case where video metadata arrived
    // just before a click but before the scheduled layout refresh.
    if(entry.element.tagName==='IMG' && isVideoPreview(entry.element))adoptDetectedType(entry,'video');
    if(entry.streamIdentity && entry.streamIdentity !== (mediaIdentity(entry.element,entry.type) ||
       [postCode(entry.element),entry.element.poster,entry.element.currentSrc].join('|')))
      clearStreamChoices(entry);
    let media=sourceData(entry);
    const requestedKey=mediaIdentity(entry.element,entry.type);
    const requestedVisibleUrl=entry.element.currentSrc||entry.element.src||entry.element.poster||'';
    const type=entry.selected;
    if(type==='image'&&!media.imageUrls.length){complete(entry,'error','No image is available for this item.');return;}
    const id=crypto.randomUUID();entry.jobId=id;jobs.set(id,entry);
    entry.node.querySelector('.cancel').hidden=false;
    entry.node.querySelector('.dl').disabled=true;entry.dots.disabled=true;
    entry.panel.dataset.state='working';
    update(entry,0,`Finding ${type} for this item…`);
    entry.preparing=true;
    try{
      // Resolve the selected post for its soundtrack even when a video URL
      // already exists: the first detected MP4 is often a silent DASH track.
      if(type!=='image' && (!media.videoUrls.length && !media.audioUrls.length && !media.dash ||
          type==='video' && entry.config.videoSound!=='no' && !media.audioUrls.length && !media.dash ||
          type==='audio' && !media.audioUrls.length && !media.dash)){
        update(entry,1,'Checking the selected post for playable streams…');
        await resolvePostMetadata(entry);
        if(entry.jobId!==id)return;
        const visibleNow=entry.element.currentSrc||entry.element.src||entry.element.poster||'';
        if ((requestedKey && mediaIdentity(entry.element,entry.type)!==requestedKey) ||
            (requestedVisibleUrl && visibleNow!==requestedVisibleUrl))
          throw Error('The carousel changed while resolving this item. Select the intended item and try again.');
        media=sourceData(entry);
      }
      entry.preparing=false;
      if(entry.jobId!==id)return;
      const result=await chrome.runtime.sendMessage({type:'START',id,preference:type,config:{...entry.config},media});
      if(!result?.ok && entry.jobId===id)throw Error(result?.error||'Unable to start the download');
    }catch(e){if(entry.jobId===id)complete(entry,'error',e.message||'Download failed');}
  }
  async function cancel(entry){
    if(!entry.jobId)return;
    const id=entry.jobId;
    if(entry.preparing){entry.preparing=false;complete(entry,'cancelled','Cancelled');return;}
    entry.node.querySelector('.cancel').disabled=true;
    update(entry,Number(entry.node.querySelector('.percent').textContent.replace('%',''))||0,'Cancelling…');
    try{await chrome.runtime.sendMessage({type:'CANCEL',id});}
    catch{if(entry.jobId===id)complete(entry,'cancelled','Cancelled');}
  }
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.from!=='remi-background')return;
    const entry=jobs.get(message.id);
    if(!entry)return;
    if(message.type==='PROGRESS')update(entry,message.percent,message.message);
    if(message.type==='FINISH')complete(entry,message.state,message.message);
  });
})();
