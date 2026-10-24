/* Regression: neighboring Reels and carousel children must never be eligible
   as alternative qualities or audio sources for the clicked item. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const extracted=source.slice(source.indexOf('  function sourceData(entry)'),source.indexOf('  function resolvePostMetadata(entry)'));
assert(extracted.startsWith('  function sourceData(entry)'),'sourceData not found');
const video=(poster)=>({tagName:'VIDEO',poster,currentSrc:'blob:https://www.instagram.com/player',src:'blob:https://www.instagram.com/player'});
const url=(name)=>`https://scontent.cdninstagram.com/${name}`;
const mpd=(name)=>`<MPD><Period><AdaptationSet contentType="video"><Representation><BaseURL>${url(name+'.mp4')}</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation><BaseURL>${url(name+'.m4a')}</BaseURL></Representation></AdaptationSet></Period></MPD>`;
const record=(id)=>({code:'SHAREDPOST',mediaId:id,videoUrls:[{url:url(id+'.mp4'),width:800}],imageUrls:[{url:url(id+'.jpg'),width:800}],audioUrls:[],dash:mpd(id),hasAudio:true});
const context={captured:[record('OTHER'),record('RIGHT')],postCode:()=> 'SHAREDPOST',
 safeUrl:value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}},
 urlIdentity:(a,b)=>{try{return new URL(a).pathname===new URL(b).pathname;}catch{return false;}},
 videoIsSolePlayer:()=>true,playbackToken:()=> 'sole_playback_token',location:{href:'https://www.instagram.com/p/SHAREDPOST/'}};
vm.createContext(context);vm.runInContext(extracted,context);
function inspect(poster){const entry={element:video(poster),type:'video',selectedVideoUrl:null,selectedAudioUrl:null,streamToken:null,config:{imageResolution:'best'}};return context.sourceData(entry);}
const correct=inspect(url('RIGHT.jpg'));
assert.deepEqual(Array.from(correct.videoUrls),[url('RIGHT.mp4')]);
assert.equal(correct.matchedMediaId,'RIGHT');
assert(correct.dash.includes('RIGHT.m4a'));
assert(!correct.dash.includes('OTHER.m4a'));
assert.equal(correct.audioBinding,'same-manifest');
const missing=inspect(url('UNKNOWN.jpg'));
assert.equal(missing.audioBinding,'none');
assert.equal(missing.dash,null);
assert.equal(missing.videoUrls.length,0,'even when only one other stream is available, never borrow it');
console.log('PASS: media-record binding rejects neighbor video/audio and absent asset match');
