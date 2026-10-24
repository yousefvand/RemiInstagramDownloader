/* Regression: server-provided inline Instagram JSON and nested Relay JSON. */
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const found=[];
const inlineScript={nodeName:'SCRIPT',textContent:`window.__additionalDataLoaded('/reel/BOOT1/', {"graphql":{"shortcode_media":{"shortcode":"BOOT1","video_url":"https://video.cdninstagram.com/boot.mp4","video_dash_manifest":"<MPD><Period/></MPD>"}}});`};
const root={nodeName:'HTML',querySelectorAll:()=>[inlineScript]};
const document={documentElement:root,querySelectorAll:()=>[inlineScript],addEventListener() {}};
const handlers={};
const window={top:null,fetch:async()=>{},XMLHttpRequest:null,addEventListener:(name,fn)=>handlers[name]=fn,postMessage:msg=>found.push(msg)};
window.top=window;
class MutationObserver{observe(){}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-observer.js'),'utf8'),{window,document,location:{href:'https://www.instagram.com/reel/BOOT1/',origin:'https://www.instagram.com'},URL,WeakSet,Map,MutationObserver,DOMParser:class{},Date});
assert(found.some(x=>x.entries?.some(e=>e.code==='BOOT1' && e.videoUrls[0].url.includes('boot.mp4'))));
console.log('PASS: initial inline Instagram media JSON is discovered on document load');
