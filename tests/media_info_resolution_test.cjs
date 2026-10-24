/* Regression: Instagram's own post media-info, NOT neighboring CDN requests,
   resolves a blob-backed Reel and keeps carousel children independent. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const observer=fs.readFileSync(path.join(root,'page-observer.js'),'utf8');
const begin=observer.indexOf('  function shortcodeToPk(code)');
const end=observer.indexOf('  function extractJSONObject(code)');
assert(begin>0&&end>begin,'API resolver helpers missing');
const valid=raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname.endsWith('.cdninstagram.com')?u.href:null;}catch{return null;}};
const context={valid,choose:(obj,keys)=>keys.map(k=>obj?.[k]).find(x=>typeof x==='string')||''};
vm.createContext(context);
vm.runInContext(observer.slice(begin,end),context);
const url=id=>`https://example.cdninstagram.com/${id}`;
const video=id=>({pk:id,video_versions:[{url:url(`${id}.mp4`),width:720,height:1280}],image_versions2:{candidates:[{url:url(`${id}.jpg`),width:720}]},video_dash_manifest:`<MPD id="${id}"/>`,has_audio:true});
const reel=context.resolveMediaInfo({items:[{code:'REELabc4',...video('1000123456789')}]},'REELabc4');
assert.equal(reel.length,1);
assert.equal(reel[0].source,'media-info');
assert.equal(reel[0].carouselTotal,1);
assert.equal(reel[0].videoUrls[0].url,url('1000123456789.mp4'));
assert.equal(reel[0].dash,'<MPD id="1000123456789"/>');
const carousel=context.resolveMediaInfo({items:[{code:'CARabc4',pk:'3333333333333',carousel_media:[video('1111111111111'),video('2222222222222')]}]},'CARabc4');
assert.equal(carousel.length,2);
assert.equal(carousel[0].carouselTotal,2);
assert.equal(carousel[0].carouselIndex,0);
assert.equal(carousel[1].carouselIndex,1);
assert.equal(carousel[1].mediaId,'2222222222222');
assert(!carousel[0].dash.includes('2222222222222'));
assert.equal(context.resolveMediaInfo({items:[{code:'OTHERREEL',...video('1000123456789')}]},'REELabc4').length,0);
// Source-data resolution: a blob player/poster mismatch is recoverable only
// for a single media-info record that belongs to the exact selected shortcode.
const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
const cb=content.indexOf('  function sourceData(entry)');
const ce=content.indexOf('  function resolvePostMetadata(entry)');
assert(cb>0&&ce>cb);
const record={...reel[0],timestamp:Date.now()};
const safeUrl=raw=>{try{let u=new URL(raw);return u.protocol==='https:'?u.href:null;}catch{return null;}};
const fake={
  captured:[{...record,code:'OTHERREEL',mediaId:'neighbour',videoUrls:[{url:url('wrong.mp4'),width:1080}],dash:'<MPD id="wrong"/>'},record],
  postCode:()=> 'REELabc4',safeUrl,urlIdentity:(a,b)=>a===b,
  videoIsSolePlayer:()=>false,playbackToken:()=>null,
  location:{href:'https://www.instagram.com/reel/REELabc4/'},
};
vm.createContext(fake);
vm.runInContext(content.slice(cb,ce),fake);
const entry={element:{tagName:'VIDEO',poster:url('different-poster.jpg'),currentSrc:'blob:https://www.instagram.com/123',src:'blob:https://www.instagram.com/123'},type:'video',selected:'video',config:{imageResolution:'best'},selectedVideoUrl:null,selectedAudioUrl:null,streamToken:null};
const result=fake.sourceData(entry);
assert.equal(result.matchedMediaId,'1000123456789');
assert.equal(result.audioBinding,'same-manifest');
assert.deepEqual(Array.from(result.videoUrls),[url('1000123456789.mp4')]);
assert(!result.dash.includes('wrong'));
// The same fallback is forbidden for a two-item carousel.
fake.captured=carousel;
fake.postCode=()=> 'CARabc4';
const carouselResult=fake.sourceData(entry);
assert.equal(carouselResult.videoUrls.length,0);
assert.equal(carouselResult.dash,null);
console.log('PASS media-info record lookup + safe blob fallback + carousel isolation');
