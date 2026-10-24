/* Simulate real asynchronous Chrome Downloads states: progress 96 is not success.
   The extension must wait for Chrome's complete state and differentiate warning. */
'use strict';
const {strict:assert}=require('assert');
const fs=require('fs'),vm=require('vm'),path=require('path');
let listener, changed, current={state:'in_progress',bytesReceived:0,totalBytes:70179};
const msgs=[], chrome={
  runtime:{id:'test-extension',onMessage:{addListener(fn){listener=fn}},getContexts:async()=>[],sendMessage:async()=>({ok:true})},
  webRequest:{onBeforeRequest:{addListener(){}},onHeadersReceived:{addListener(){}}},
  tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async(tabId,msg)=>{msgs.push(msg)}},
  offscreen:{createDocument:async()=>{}},
  storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},
  downloads:{
    onChanged:{addListener(fn){changed=fn}},
    download:async()=>42,
    search:async()=>[{id:42,...current,filename:'/tmp/Downloads/RemiInstagramDownloader/instagram_TEST_video_only.mp4'}],
    cancel:async()=>{}
  }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,Map,Set,URL,Date,Number,Math,clearInterval,setInterval,clearTimeout,setTimeout});
function send(msg,sender){return new Promise(resolve=>listener(msg,sender,resolve));}
(async()=>{
 const id='completiontest_12345';
 await send({type:'START',id,preference:'video',media:{code:'TEST',videoUrls:['https://scontent.cdninstagram.com/video.mp4']}},{tab:{id:55}});
 await send({to:'remi-background',type:'SAVE',id,url:'blob:chrome-extension://abcd/0123',blobUrl:'blob:chrome-extension://abcd/0123',filename:'instagram_TEST_video_only.mp4',notice:'Saved VIDEO ONLY: audio missing.'},{id:'test-extension'});
 await new Promise(r=>setTimeout(r,60));
 assert(!msgs.some(x=>x.type==='FINISH'), 'must NOT claim success before Chrome completes the download');
 current={state:'complete',bytesReceived:70179,totalBytes:70179,fileSize:70179};
 changed({id:42,state:{current:'complete'}});
 await new Promise(r=>setTimeout(r,80));
 const finish=msgs.find(x=>x.type==='FINISH');
 assert(finish && finish.state==='warning' && /VIDEO ONLY/.test(finish.message),finish);
 assert(!msgs.some(x=>x.type==='FINISH' && x.state==='done'),'do not mislabel silent fallback');
 console.log('PASS: no false completion; actual Chrome completion produces explicit video-only warning');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
