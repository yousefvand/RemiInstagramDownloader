'use strict';
// A playback token is not a media identity. Any CDN request captured in that
// window may belong to a neighboring/preloaded Reel. NEVER promote such a
// request to an automatically selected video or audio track.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let before,headers,msgHandler;const operations=[];const store={};
const chrome={webRequest:{onBeforeRequest:{addListener:f=>before=f},onHeadersReceived:{addListener:f=>headers=f}},
 tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async()=>{}},
 storage:{session:{set:async v=>Object.assign(store,v),get:async k=>({[k]:store[k]}),remove:async()=>{}}},
 runtime:{id:'mock',onMessage:{addListener:f=>msgHandler=f},getContexts:async()=>[],sendMessage:async m=>{if(m.type==='PROCESS')operations.push(m);return {ok:true};}},
 offscreen:{createDocument:async()=>{}},downloads:{onChanged:{addListener(){}},download:async()=>11,search:async()=>[],cancel:async()=>{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL,Date,Map,Set,setTimeout,clearTimeout,setInterval,clearInterval});
const sender={tab:{id:51}},send=m=>new Promise(resolve=>msgHandler(m,sender,resolve));
function emit(name,mime,id){const d={tabId:51,url:`https://stream.fbcdn.net/${name}`,requestId:String(id),type:'xmlhttprequest'};before(d);headers({...d,responseHeaders:[{name:'content-type',value:mime}]});}
async function start(id,code,token,videoUrls=[]){
 const prior=operations.length;
 await send({type:'START',id,preference:'video',media:{code,scopedToElement:true,playbackToken:token,videoUrls,audioUrls:[],imageUrls:[]}});
 for(let i=0;i<30&&operations.length===prior;i++)await new Promise(r=>setTimeout(r,30));
 return operations.length>prior?operations.at(-1).media:null;
}
(async()=>{
 const code='REEL_ONLY',token='exactplayer012345';
 await send({type:'PLAYBACK',playback:{code,token}});
 emit('preloaded_other.mp4','video/mp4',1);emit('preloaded_sound.m4a','audio/mp4',2);
 let media=await start('no_record_1111111111',code,token);
 assert(media);
 assert.deepEqual(Array.from(media.videoUrls),[]);
 assert.deepEqual(Array.from(media.audioUrls),[]);
 assert.equal(media.probeVideoQuality,false);
 emit('also_other.mp4','video/mp4',3);
 media=await start('no_record_multiple_11111',code,token);
 assert.deepEqual(Array.from(media.videoUrls),[]);
 const EXACT='https://stream.fbcdn.net/right.mp4';
 media=await start('explicit_record_111111111',code,token,[EXACT]);
 assert.deepEqual(Array.from(media.videoUrls),[EXACT]);
 assert.deepEqual(Array.from(media.audioUrls),[]);
 console.log('PASS: playback-token CDN captures cannot become a media or audio identity');
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
