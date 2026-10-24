const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const out=[];
const fixture={data:{xdt_shortcode_media:{
  code:'REEL123',video_versions:[{url:'https://scontent.cdninstagram.com/v.mp4',width:720}],
  video_dash_manifest:'<MPD>example</MPD>',has_audio:true,
  image_versions2:{candidates:[{url:'https://scontent.cdninstagram.com/photo.jpg'}]},
  progressive_download_url:'https://scontent.cdninstagram.com/a.m4a'
}}};
const win={};win.top=win;
win.fetch=async()=>new Response(JSON.stringify(fixture),{status:200,headers:{'content-type':'application/json'}});
win.postMessage=(msg,origin)=>out.push({msg,origin});
const context={window:win,location:{origin:'https://www.instagram.com',href:'https://www.instagram.com/reel/REEL123/'},URL,Response,JSON,Object,Promise};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-observer.js'),'utf8'),context);
(async()=>{
  const response=await win.fetch('https://www.instagram.com/graphql/query/');
  assert.equal(response.status,200);
  for(let i=0;i<20&&!out.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(out[0]?.msg.channel,'RemiInstagramDownloader:media');
  const entry=out[0].msg.entries[0];
  assert.equal(entry.code,'REEL123');
  assert.equal(entry.videoUrls[0].url,'https://scontent.cdninstagram.com/v.mp4');
  assert.deepEqual(Array.from(entry.audioUrls),[], 'Standalone media audio is not a synchronized soundtrack');
  assert.equal(entry.dash,'<MPD>example</MPD>');
  console.log('PASS: Instagram GraphQL video/audio/DASH page-response observer');
})().catch(e=>{console.error(e);process.exitCode=1});
