/* Regression test: media on one tile must not inherit another tile's captured URLs. */
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
let listenReq, listenMessage, sent;
const chrome={
  webRequest:{onBeforeRequest:{addListener:f=>listenReq=f}},
  tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async()=>{}},
  storage:{session:{set:async()=>{},get:async()=>({}),remove:async()=>{}}},
  runtime:{id:'unit',onMessage:{addListener:f=>listenMessage=f},getContexts:async()=>[],sendMessage:async data=>{if(data.type==='PROCESS')sent=data;return {ok:true}}},
  offscreen:{createDocument:async()=>{}},
  downloads:{onChanged:{addListener(){}},download:async()=>1,search:async()=>[],cancel:async()=>{}}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{
  chrome,URL,Date,Map,Set,clearInterval,setInterval,clearTimeout,setTimeout
});
listenReq({tabId:21,type:'media',url:'https://scontent.cdninstagram.com/another_post.mp4'});
listenReq({tabId:21,type:'media',url:'https://scontent.cdninstagram.com/another_audio.m4a'});
const media={code:'SCOPE1',scopedToElement:true,allowTabWideFallback:false,
  videoUrls:['https://scontent.cdninstagram.com/right_post.mp4'],imageUrls:[],audioUrls:[]};
let ack;
listenMessage({type:'START',id:'isolated_0123456789',preference:'video',media},{tab:{id:21}},x=>ack=x);
assert.equal(ack.ok,true);
setTimeout(()=>{
  assert(sent,'expected offscreen processing');
  assert.deepEqual(Array.from(sent.media.videoUrls),media.videoUrls);
  assert.deepEqual(Array.from(sent.media.audioUrls),[]);
  assert(!sent.media.videoUrls.includes('https://scontent.cdninstagram.com/another_post.mp4'));
  console.log('PASS: per-tile media does not inherit unrelated video or audio requests');
  process.exit(0);
},80);
