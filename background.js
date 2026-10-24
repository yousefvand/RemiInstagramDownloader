/* RemiInstagramDownloader 0.1.0: per-tab observed media, jobs, and native Downloads. */
'use strict';
const jobs = new Map();
const downloadJobs = new Map();
const captures = new Map();
const playbackOwners = new Map();
const MAX_CAPTURES = 100;
const CAPTURE_TTL = 3 * 60 * 1000;
const PLAYBACK_TTL = 45 * 1000;
let offscreenCreation;

function allowedMediaHost(raw) {
  try {
    const u=new URL(raw);
    return u.protocol==='https:' && (u.hostname==='instagram.com' || u.hostname.endsWith('.instagram.com') || u.hostname.endsWith('.cdninstagram.com') || u.hostname.endsWith('.fbcdn.net'));
  }catch{return false;}
}
function mediaKind(raw, resourceType, contentType='') {
  if(!allowedMediaHost(raw))return null;
  const url=new URL(raw);
  const path=url.pathname.toLowerCase();
  const mime=(contentType || url.searchParams.get('mime_type') || url.searchParams.get('mime') || '').toLowerCase();
  // MIME from an actual response outranks the ambiguous .mp4 CDN filename.
  if(mime.startsWith('audio/') || /(?:audio[_\/-]?mp4|\/audio\/)/.test(path))return 'audio';
  if(mime.startsWith('video/') || /(?:video[_\/-]?mp4|\/video\/)/.test(path))return 'video';
  if(mime.startsWith('image/'))return 'image';
  if(/\.(?:m4a|mp3|aac|oga|ogg)$/.test(path))return 'audio';
  if(/\.(?:mp4|m4v|webm)$/.test(path))return 'video';
  if(resourceType==='image' && /\.(?:jpg|jpeg|png|webp|avif)$/.test(path))return 'image';
  return null;
}
function stripByteRange(raw) {
  try {
    const url = new URL(raw);
    for (const key of ['bytestart', 'byteend', 'bytes', 'range']) url.searchParams.delete(key);
    return url.href;
  } catch { return raw; }
}
function recordRequest(details, kind) {
  if(details.tabId < 0 || !kind || !allowedMediaHost(details.url))return;
  const now=Date.now(), raw=stripByteRange(details.url);
  const owner=playbackOwners.get(details.tabId);
  const activeOwner=owner && now-owner.time<PLAYBACK_TTL ? owner : null;
  const code=activeOwner?.code||'';
  const token=activeOwner?.token||'';
  const current=captures.get(details.tabId)||[];
  // A CDN .mp4 may actually be audio/mp4. Verified response MIME replaces any
  // filename-only guess, rather than leaving a duplicate mislabeled video.
  if(details.fromHeaders){
    for(let i=current.length-1;i>=0;i--){
      if(current[i].url===raw && current[i].kind!==kind)current.splice(i,1);
    }
  }
  const index=current.findIndex(item=>item.url===raw && item.kind===kind);
  const previous=index>=0 ? current.splice(index,1)[0]:null;
  current.unshift({url:raw,rawUrl:details.url,kind,time:now,
    code:code || previous?.code || '', playbackToken:token || previous?.playbackToken || '',
    fromHeaders:!!details.fromHeaders});
  captures.set(details.tabId,current.filter(item=>now-item.time<CAPTURE_TTL).slice(0,MAX_CAPTURES));
  if(!recordRequest.pending)recordRequest.pending=new Map();
  if(recordRequest.pending.has(details.tabId))clearTimeout(recordRequest.pending.get(details.tabId));
  recordRequest.pending.set(details.tabId,setTimeout(()=>{
    recordRequest.pending.delete(details.tabId);
    chrome.storage.session.set({['remi_requests_'+details.tabId]:captures.get(details.tabId)||[]}).catch(()=>{});
  },700));
}
const mediaFilter={urls:['https://*.fbcdn.net/*','https://*.cdninstagram.com/*','https://*.instagram.com/*']};
chrome.webRequest.onBeforeRequest.addListener(details=>{
  if(details.tabId < 0)return;
  const kind=mediaKind(details.url,details.type);
  if(kind)recordRequest(details,kind);
},mediaFilter);
if(chrome.webRequest.onHeadersReceived){
  chrome.webRequest.onHeadersReceived.addListener(details=>{
    if(details.tabId<0)return;
    const type=details.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value||'';
    const kind=mediaKind(details.url,details.type,type);
    if(kind)recordRequest({...details,fromHeaders:true},kind);
  },mediaFilter,['responseHeaders']);
}
chrome.tabs.onRemoved.addListener(tabId => {
  captures.delete(tabId);
  playbackOwners.delete(tabId);
  chrome.storage.session.remove('remi_requests_'+tabId).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    captures.delete(tabId);
    playbackOwners.delete(tabId);
    chrome.storage.session.remove('remi_requests_'+tabId).catch(() => {});
  }
});
async function allObservedForTab(tabId){
  let found=captures.get(tabId);
  if(!found?.length){const stored=await chrome.storage.session.get('remi_requests_'+tabId);found=stored['remi_requests_'+tabId]||[];}
  return found.filter(item=>Date.now()-item.time<CAPTURE_TTL);
}
async function observedForTab(tabId,kind){
  return (await allObservedForTab(tabId)).filter(item=>item.kind===kind).map(item=>item.url);
}
async function ensureOffscreen() {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = (async () => {
    const existing = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if (!existing.length) await chrome.offscreen.createDocument({
      url:'offscreen.html', reasons:['BLOBS'],
      justification:'Read media in the signed-in browser, merge separate video and audio tracks and save locally.'
    });
  })().finally(() => {offscreenCreation = null;});
  return offscreenCreation;
}
const sendOffscreen = msg => chrome.runtime.sendMessage({to:'remi-offscreen',...msg});
function notify(job, message) {
  if (job && Number.isInteger(job.tabId)) chrome.tabs.sendMessage(job.tabId, {from:'remi-background', id:job.id, ...message}).catch(()=>{});
}
function finalize(job, state, message, details={}) {
  if (!job || job.finished) return;
  job.finished = true;
  clearInterval(job.poll);
  notify(job,{type:'FINISH',state,message,...details});
  if(job.blobUrl) sendOffscreen({type:'REVOKE',url:job.blobUrl}).catch(()=>{});
  if(job.downloadId != null) {
    downloadJobs.delete(job.downloadId);
    chrome.storage.session.remove('remi_download_'+job.downloadId).catch(()=>{});
  }
  jobs.delete(job.id);
}
async function updateDownload(job) {
  if (!job || job.finished || job.downloadId == null) return;
  const [entry] = await chrome.downloads.search({id:job.downloadId});
  if (!entry) {
    job.notFoundSince ||= Date.now();
    if(Date.now()-job.notFoundSince>10000)finalize(job,'error',
      'Chrome did not register the download. Check chrome://downloads and extension permissions.');
    return;
  }
  job.notFoundSince=0;
  if (entry.state === 'complete') {
    if(entry.fileSize===0 || entry.bytesReceived===0)
      finalize(job,'error','Chrome reported an empty download; no usable file was saved.');
    else finalize(job,job.notice?'warning':'done',
      job.notice || ('Saved: '+(entry.filename?.split(/[\\/]/).slice(-2).join('/')||'Downloads/RemiInstagramDownloader')));
  }
  else if (entry.state === 'interrupted') finalize(job,job.cancelled?'cancelled':'error',job.cancelled?'Cancelled':(entry.error||'Chrome download interrupted'));
  else if(entry.state === 'in_progress') {
    const fraction = entry.totalBytes > 0 ? entry.bytesReceived / entry.totalBytes : 0;
    notify(job,{type:'PROGRESS',percent:Math.min(99,96+Math.round(fraction*3)),message:'Saving file…'});
  }
}
async function startDownload(job,url,filename) {
  if(job.cancelled) throw Error('Cancelled');
  if (!/^https:\/\//.test(url) && !/^blob:chrome-extension:\/\//.test(url)) throw Error('Unsupported download URL');
  const downloadId = await chrome.downloads.download({url,filename:`RemiInstagramDownloader/${filename}`,conflictAction:'uniquify',saveAs:false});
  if(!Number.isInteger(downloadId))throw Error('Chrome Downloads did not return a valid download ID.');
  job.downloadId = downloadId;
  downloadJobs.set(downloadId,job.id);
  // A Manifest V3 worker may go idle while Chrome saves a large file.
  // Persist enough state to reconcile a later download-complete event.
  await chrome.storage.session.set({['remi_download_'+downloadId]:{
    id:job.id,tabId:job.tabId,downloadId,blobUrl:job.blobUrl,notice:job.notice
  }});
  job.poll = setInterval(()=>updateDownload(job).catch(()=>{}),600);
  if(job.cancelled) await chrome.downloads.cancel(downloadId).catch(()=>{});
  else notify(job,{type:'PROGRESS',percent:96,message:'Saving file…'});
  updateDownload(job).catch(()=>{});
  return downloadId;
}
chrome.runtime.onMessage.addListener((msg,sender,respond) => {
  if (!msg || typeof msg !== 'object' || msg.to === 'remi-offscreen') return false;
  if (msg.type==='PLAYBACK' && sender.tab?.id != null){
    const data=msg.playback;
    if(data && /^[\w-]{3,90}$/.test(data.code||'') && /^[\w-]{10,90}$/.test(data.token||''))
      playbackOwners.set(sender.tab.id,{code:data.code,token:data.token,time:Date.now()});
    else if(data && /^[\w-]{3,90}$/.test(data.code||''))
      playbackOwners.set(sender.tab.id,{code:data.code,token:'',time:Date.now()});
    else playbackOwners.delete(sender.tab.id);
    respond({ok:true});return false;
  }
  if (msg.type === 'START' && sender.tab?.id != null) {
    const id=String(msg.id||'');
    if (!/^[\w-]{10,90}$/.test(id) || !['video','audio','image'].includes(msg.preference)) {respond({ok:false,error:'Invalid download request'});return false;}
    if(jobs.has(id)){respond({ok:false,error:'Duplicate job'});return false;}
    const job={id,tabId:sender.tab.id,cancelled:false,finished:false,downloadId:null,blobUrl:null,poll:null,notice:''};
    jobs.set(id,job);
    (async()=>{
      try {
        await ensureOffscreen();
        if(job.cancelled)return;
        const media={...(msg.media||{})};
        const chosenVideo=typeof media.selectedVideoUrl==='string' ? stripByteRange(media.selectedVideoUrl):'';
        const unique=items=>[...new Set((items||[]).filter(x=>typeof x==='string' && x))].slice(0,30);
        // RECORD-BOUND POLICY (yt-dlp/Cobalt): qualities are drawn exclusively
        // from the selected Instagram media record, never from tab-level
        // network observations or a playback-time bucket. Such buckets can
        // contain preloaded audio/video from neighbouring Reels.
        // A directly exposed HTMLVideoElement URL is also an exact source.
        const declaredVideo=unique(media.videoUrls||[]).filter(allowedMediaHost);
        if(chosenVideo && !declaredVideo.includes(chosenVideo)) {
          throw Error('The selected quality does not belong to this media record. Reload and retry.');
        }
        media.videoUrls=chosenVideo?[chosenVideo]:declaredVideo;
        media.probeVideoQuality=false;
        // Never use separately observed audio, sound-library URLs or a
        // manually selected audio URL as a soundtrack pairing credential.
        media.audioUrls=[];
        media.selectedAudioUrl=null;
        media.pairedVideoUrls=[];
        media.audioBinding=media.audioBinding==='same-manifest' &&
          typeof media.dash==='string' && media.dash.length>0
          ?'same-manifest':'none';
        if(media.audioBinding!=='same-manifest')media.dash=null;
        media.imageUrls=unique(media.imageUrls||[]);
        if(!media.videoUrls.length && !media.dash && media.scopedToElement===true){
          media.captureDiagnostic='Instagram did not provide an identifiable video record for this item. Open the post directly and retry. For carousels, the selected slide must match its own media record.';
        }
        notify(job,{type:'PROGRESS',percent:2,message:'Resolving Instagram media streams…'});
        const result=await sendOffscreen({type:'PROCESS',id,preference:msg.preference,config:msg.config||{},media});
        if(!result?.ok && !job.finished && !job.cancelled)throw Error(result?.error||'Processor did not start');
      } catch(e) {finalize(job,job.cancelled?'cancelled':'error',job.cancelled?'Cancelled':(e.message||String(e)));}
    })();
    respond({ok:true});return false;
  }
  if (msg.type==='CANCEL' && sender.tab?.id != null) {
    const job=jobs.get(String(msg.id));
    if(!job || sender.tab.id !== job.tabId){respond({ok:false});return false;}
    job.cancelled=true;
    sendOffscreen({type:'CANCEL',id:job.id}).catch(()=>{});
    if (job.downloadId != null) chrome.downloads.cancel(job.downloadId).then(()=>updateDownload(job)).catch(()=>finalize(job,'cancelled','Cancelled'));
    else finalize(job,'cancelled','Cancelled');
    respond({ok:true});return false;
  }
  if (msg.to !== 'remi-background') return false;
  const job=jobs.get(String(msg.id));
  if(!job || sender.id!==chrome.runtime.id){respond({ok:false});return false;}
  if (msg.type==='PROGRESS') {
    if(!job.finished && !job.cancelled)notify(job,{type:'PROGRESS',percent:Math.max(0,Math.min(95,Number(msg.percent)||0)),message:String(msg.message||'Downloading…').slice(0,160)});
    respond({ok:true});return false;
  }
  if (msg.type==='FAIL') {
    finalize(job,job.cancelled?'cancelled':'error',job.cancelled?'Cancelled':String(msg.error||'Media download failed'));
    respond({ok:true});return false;
  }
  if (msg.type==='SAVE') {
    if(job.cancelled || job.finished){respond({ok:false,error:'Cancelled'});return false;}
    job.blobUrl=msg.blobUrl||null;
    job.notice=String(msg.notice||'').slice(0,220);
    startDownload(job,String(msg.url||''),String(msg.filename||'download.bin').replace(/[^\w.\-]/g,'_'))
      .then(downloadId=>respond({ok:true,downloadId}))
      .catch(e=>{finalize(job,job.cancelled?'cancelled':'error',e.message||String(e));respond({ok:false,error:e.message});});
    return true;
  }
  return false;
});
chrome.downloads.onChanged.addListener(delta => {
  const jobId=downloadJobs.get(delta.id);
  if(jobId){updateDownload(jobs.get(jobId)).catch(()=>{});return;}
  // Reconcile completed downloads after the background worker was restarted.
  (async()=>{
    const key='remi_download_'+delta.id;
    const saved=(await chrome.storage.session.get(key))[key];
    if(!saved)return;
    const job=jobs.get(saved.id)||{...saved,finished:false,cancelled:false,poll:null};
    await updateDownload(job);
  })().catch(()=>{});
});
