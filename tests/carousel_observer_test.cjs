const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const observed=[];
const page={data:{xdt_shortcode_media:{code:'CAROUSEL999',carousel_media:[
  {id:'201',image_versions2:{candidates:[{url:'https://cdn.cdninstagram.com/first.jpg'}]}},
  {id:'202',image_versions2:{candidates:[{url:'https://cdn.cdninstagram.com/second.jpg'}]}},
  {id:'203',video_versions:[{url:'https://cdn.cdninstagram.com/third.mp4',width:1080}],progressive_download_url:'https://cdn.cdninstagram.com/third.m4a'}
]}}};
const win={};win.top=win;win.fetch=async()=>new Response(JSON.stringify(page),{status:200,headers:{'content-type':'application/json'}});
win.postMessage=data=>observed.push(data);
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-observer.js'),'utf8'),{window:win,location:{origin:'https://www.instagram.com',href:'https://www.instagram.com/p/CAROUSEL999/'},URL,Response,JSON,Object,Promise});
(async()=>{
  await win.fetch('https://www.instagram.com/graphql/query/');
  for(let i=0;i<30&&!observed.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const children=observed.flatMap(x=>x.entries).filter(x=>['201','202','203'].includes(x.mediaId));
  assert.equal(children.length,3);
  assert(children.every(x=>x.code==='CAROUSEL999'),JSON.stringify(children));
  console.log('PASS: carousel children inherit post shortcode but retain distinct media IDs');
})().catch(e=>{console.error(e);process.exitCode=1});
