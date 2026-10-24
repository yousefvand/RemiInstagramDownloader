'use strict';
// Nested soundtrack metadata must be attached to its individual parent video,
// never to its sibling with the same carousel shortcode.
const {strict:assert}=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const packets=[];
const payload={data:{xdt_shortcode_media:{code:'CAR2026',carousel_media:[
  {id:'movie_A',video_versions:[{url:'https://cdn.cdninstagram.com/A.mp4'}],
   image_versions2:{candidates:[{url:'https://cdn.cdninstagram.com/A.jpg'}]},
   clips_metadata:{original_sound_info:{progressive_download_url:'https://cdn.cdninstagram.com/A.m4a'}}},
  {id:'movie_B',video_versions:[{url:'https://cdn.cdninstagram.com/B.mp4'}],
   image_versions2:{candidates:[{url:'https://cdn.cdninstagram.com/B.jpg'}]},
   clips_metadata:{music_info:{music_asset_info:{progressive_download_url:'https://cdn.cdninstagram.com/B.m4a'}}}}
]}}};
const win={};win.top=win;win.fetch=async()=>new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
win.postMessage=msg=>packets.push(msg);
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-observer.js'),'utf8'),{window:win,location:{href:'https://www.instagram.com/p/CAR2026/',origin:'https://www.instagram.com'},URL,Response,Object,JSON,Promise});
(async()=>{
  await win.fetch('https://www.instagram.com/graphql/query/');
  for(let i=0;i<20&&!packets.length;i++)await new Promise(r=>setTimeout(r,10));
  const items=packets.flatMap(x=>x.entries);
  const a=items.find(x=>x.mediaId==='movie_A'),b=items.find(x=>x.mediaId==='movie_B');
  assert(a&&b,JSON.stringify(items));
  assert.deepEqual(Array.from(a.audioUrls),[]);
  assert.deepEqual(Array.from(b.audioUrls),[]);
  console.log('PASS: nested sound-library URLs are not promoted to video soundtracks');
})().catch(e=>{console.error(e);process.exitCode=1});
