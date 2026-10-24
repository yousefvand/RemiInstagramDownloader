/* Regression: response MIME identifies opaque CDN audio/video, and only
   requests tagged with this media's active playback shortcode are reused. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let before,headers,message,processed;
const store={};
const chrome={
 webRequest:{
  onBeforeRequest:{addListener:f=>before=f},
  onHeadersReceived:{addListener:(f,filter,extras)=>{headers=f;assert(extras.includes('responseHeaders'));}},
  onCompleted:{addListener(){}},onErrorOccurred:{addListener(){}}
 },
 tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async()=>{}},
 storage:{session:{set:async x=>Object.assign(store,x),get:async k=>({[k]:store[k]}),remove:async()=>{}}},
 runtime:{id:'unit',onMessage:{addListener:f=>message=f},getContexts:async()=>[],sendMessage:async msg=>{if(msg.type==='PROCESS')processed=msg;return {ok:true};}},
 offscreen:{createDocument:async()=>{}},
 downloads:{onChanged:{addListener(){}},download:async()=>1,search:async()=>[],cancel:async()=>{}}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL,Date,Map,Set,clearInterval,setInterval,clearTimeout,setTimeout});
const sender={tab:{id:33}};
message({type:'PLAYBACK',playback:{code:'SELECTED_R1'}},sender,()=>{});
function emit(url,kind,id){
 const details={tabId:33,url,requestId:id,type:'xmlhttprequest'};
 before(details);
 headers({...details,responseHeaders:[{name:'Content-Type',value:kind}]});
}
emit('https://video.cdninstagram.com/media_without_extension?oh=a','video/mp4','1');
emit('https://audio.cdninstagram.com/opaque_track?oh=b','audio/mp4','2');
message({type:'PLAYBACK',playback:{code:'OTHER_R2'}},sender,()=>{});
emit('https://audio.cdninstagram.com/different_track?oh=c','audio/mp4','3');
message({type:'PLAYBACK',playback:{code:'SELECTED_R1'}},sender,()=>{});
message({type:'START',id:'job_0123456789',preference:'video',media:{code:'SELECTED_R1',scopedToElement:true,playbackTagged:true,allowTabWideFallback:false,
  videoUrls:['https://video.cdninstagram.com/media_without_extension?oh=a'],
  audioBinding:'exact-asset',
  pairedVideoUrls:['https://video.cdninstagram.com/media_without_extension?oh=a'],
  audioUrls:['https://audio.cdninstagram.com/opaque_track?oh=b']}},sender,()=>{});
setTimeout(()=>{
 try{
 assert(processed);
 const video=Array.from(processed.media.videoUrls),audio=Array.from(processed.media.audioUrls);
 assert.deepEqual(video,['https://video.cdninstagram.com/media_without_extension?oh=a']);
 assert.deepEqual(audio,[], 'Untrusted exact-asset tag must not authorize an unrelated soundtrack');
 assert(!audio.some(x=>x.includes('different_track')));
 // A shortcode-only playback tag must NOT authorize unlisted audio. A
 // carousel sibling can have the same code and a completely different song.
 message({type:'START',id:'job_9876543210',preference:'video',media:{code:'SELECTED_R1',scopedToElement:true,playbackTagged:true,
  videoUrls:['https://video.cdninstagram.com/media_without_extension?oh=a'],audioUrls:[]}},sender,()=>{});
 setTimeout(()=>{
   assert.deepEqual(Array.from(processed.media.audioUrls),[]);
   console.log('PASS: opaque CDN MIME classified; only URLs explicitly belonging to selected item are reused');
   process.exit(0);
 },120);
 }catch(e){console.error(e);process.exit(1);}
},120);
