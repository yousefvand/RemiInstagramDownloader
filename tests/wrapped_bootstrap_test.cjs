'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let inspected=[];
const fakeScript={textContent:'require("ScheduledServerJS").handle({"data":{"shortcode_media":{"code":"SOLO_REEL","video_versions":[{"url":"https://scontent.fbcdn.net/solo.mp4"}]}}});',nodeName:'SCRIPT'};
const document={documentElement:{nodeName:'HTML'},querySelectorAll:()=>[fakeScript]};
class MutationObserver{observe(){}}
const win={};win.top=win;win.fetch=async()=>new Response('[]');win.postMessage=message=>inspected.push(message);
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-observer.js'),'utf8'),{
 window:win,document,location:{origin:'https://www.instagram.com',href:'https://www.instagram.com/reel/SOLO_REEL/'},URL,JSON,Response,MutationObserver,Object,Promise
});
const entries=inspected.flatMap(x=>x.entries||[]);
assert(entries.some(x=>x.code==='SOLO_REEL' && x.videoUrls.some(v=>v.url.includes('solo.mp4'))),JSON.stringify(entries));
console.log('PASS: JSON media metadata inside ScheduledServerJS bootstrap wrapper is parsed safely');
