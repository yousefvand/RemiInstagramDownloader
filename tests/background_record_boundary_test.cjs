/* Network captures are never accepted as alternative resolutions or audio
   for a specific post even if they share its playback token. */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
let onMessage,onBefore,processMsg;
const chrome={
 webRequest:{onBeforeRequest:{addListener:f=>onBefore=f}},
 tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async()=>{}},
 storage:{session:{set:async()=>{},get:async()=>({}),remove:async()=>{}}},
 runtime:{id:'unit',onMessage:{addListener:f=>onMessage=f},getContexts:async()=>[],sendMessage:async msg=>{console.log('SEND',msg.type,msg.error||''); if(msg.type==='PROCESS')processMsg=msg;return {ok:true}}},
 offscreen:{createDocument:async()=>{}},
 downloads:{onChanged:{addListener(){}},download:async()=>1,search:async()=>[],cancel:async()=>{}}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL,Date,Map,Set,clearInterval,setInterval,setTimeout,clearTimeout});
const VIDEO='https://scontent.cdninstagram.com/RIGHT.mp4';
const AUDIO='https://scontent.cdninstagram.com/WRONG.m4a';
onMessage({type:'PLAYBACK',playback:{code:'POST',token:'sole_playback_token'}},{tab:{id:7}},()=>{});
onBefore({tabId:7,type:'media',url:'https://scontent.cdninstagram.com/WRONG.mp4'});
onBefore({tabId:7,type:'media',url:AUDIO});
onMessage({type:'START',id:'record_1234567890',preference:'video',config:{videoSound:'yes',videoQuality:'best'},media:{code:'POST',videoUrls:[VIDEO],audioUrls:[AUDIO],audioBinding:'none',scopedToElement:true,playbackToken:'sole_playback_token'}},{tab:{id:7}},x=>console.log('ACK',x));
setTimeout(()=>{
 assert(processMsg);
 assert.deepEqual(Array.from(processMsg.media.videoUrls),[VIDEO]);
 assert.deepEqual(Array.from(processMsg.media.audioUrls),[]);
 assert.equal(processMsg.media.dash,null);
 assert.equal(processMsg.media.audioBinding,'none');
 console.log('PASS: playback-network bucket cannot poison per-record video quality or audio');process.exit(0);
},100);
