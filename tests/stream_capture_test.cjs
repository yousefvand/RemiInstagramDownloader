/* The network sniffer can collect diagnostic requests, but those are NOT
   eligible as output sources for a per-media download. */
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
let onBefore,onMessage,processed;
const chrome={webRequest:{onBeforeRequest:{addListener:f=>onBefore=f}},
 tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async()=>{}},
 storage:{session:{set:async()=>{},get:async()=>({}),remove:async()=>{}}},
 runtime:{id:'unit',onMessage:{addListener:f=>onMessage=f},getContexts:async()=>[],sendMessage:async m=>{if(m.type==='PROCESS')processed=m;return {ok:true}}},
 offscreen:{createDocument:async()=>{}},downloads:{onChanged:{addListener(){}},download:async()=>9,search:async()=>[],cancel:async()=>{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL,Date,Map,Set,clearInterval,setInterval,clearTimeout,setTimeout});
onBefore({tabId:17,type:'media',url:'https://scontent.cdninstagram.com/other.mp4?bytestart=1&byteend=8'});
onBefore({tabId:17,type:'media',url:'https://scontent.cdninstagram.com/other.m4a'});
let ack;
onMessage({type:'START',id:'media_job_123456789',preference:'video',media:{scopedToElement:true,code:'RIGHT',videoUrls:['https://scontent.cdninstagram.com/right.mp4'],audioUrls:[],imageUrls:[]}},{tab:{id:17}},x=>ack=x);
assert.equal(ack.ok,true);
setTimeout(()=>{
 assert(processed);assert.deepEqual(Array.from(processed.media.videoUrls),['https://scontent.cdninstagram.com/right.mp4']);
 assert.deepEqual(Array.from(processed.media.audioUrls),[]);
 console.log('PASS: unrelated captured media never enters per-item download');process.exit(0);
},90);
