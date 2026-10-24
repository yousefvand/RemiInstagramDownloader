/* Offscreen document: media downloading and browser-native A/V combination. */
(() => {
  'use strict';
  const active = new Map();
  const blobUrls = new Set();
  const MAX_BYTES = 600 * 1024 * 1024;
  const CHROME_HOSTS = /(^|\.)(?:instagram\.com|cdninstagram\.com|fbcdn\.net)$/i;

  function validatedUrl(candidate) {
    if(typeof candidate !== 'string') throw Error('Missing media URL');
    const url = new URL(candidate);
    if(url.protocol !== 'https:' || !CHROME_HOSTS.test(url.hostname)) {
      throw Error('Refused non-Instagram media URL');
    }
    return url.href;
  }
  const progress=(job, percent, message)=>{
    if(!job.cancelled) chrome.runtime.sendMessage({to:'remi-background',type:'PROGRESS',id:job.id,percent,message}).catch(()=>{});
  };
  const fail=(job,e)=>chrome.runtime.sendMessage({to:'remi-background',type:'FAIL',id:job.id,error:String(e?.message||e)}).catch(()=>{});

  function parseMpd(raw, config={}) {
    if(typeof raw !== 'string' || !raw) return null;
    // Instagram may HTML-escape the MPD inside its JSON payload.
    let xml=raw;
    // Keep &amp; in a real XML document: the XML parser must decode URL queries.
    if (xml.includes('&lt;MPD') || xml.includes('&lt;?xml')) {
      xml=xml.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    }
    if(!xml.includes('<MPD') && /^[A-Za-z0-9+/=\s]+$/.test(xml)) {
      try { xml=atob(xml.trim()); } catch {}
    }
    if(!xml.includes('<MPD')) return null;
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror')) return null;
    const nodes=[...doc.querySelectorAll('Representation')];
    function baseUrl(node) {
      let current=node;
      while(current && current.nodeType===1){
        const base=[...current.children].find(el=>el.localName==='BaseURL');
        if(base?.textContent?.trim())return base.textContent.trim();
        current=current.parentElement;
      }
      return null;
    }
    const tracks=[];
    for(const rep of nodes){
      const adaptation=rep.closest('AdaptationSet');
      const type=(adaptation?.getAttribute('contentType')||rep.getAttribute('mimeType')||adaptation?.getAttribute('mimeType')||'').toLowerCase();
      const mime=(rep.getAttribute('mimeType')||adaptation?.getAttribute('mimeType')||'').toLowerCase();
      const url=baseUrl(rep);
      if(!url)continue;
      let goodUrl;
      try {goodUrl=validatedUrl(url);}catch{continue;}
      const kind=type.includes('audio')||mime.includes('audio')?'audio':type.includes('video')||mime.includes('video')?'video':null;
      if(!kind)continue;
      const period=rep.closest('Period');
      tracks.push({kind,url:goodUrl,period,adaptation,codecs:rep.getAttribute('codecs')||'', bandwidth:Number(rep.getAttribute('bandwidth')||0),width:Number(rep.getAttribute('width')||0),height:Number(rep.getAttribute('height')||0)});
    }
    // An MPD can carry multiple periods or multiple language/sound groups.
    // Never select its video from one period and audio from another, or guess
    // between distinct audio AdaptationSets. Fail closed if ambiguous.
    const periods=[...new Set(tracks.map(t=>t.period))];
    const pairedPeriods=periods.filter(period=>tracks.some(t=>t.period===period&&t.kind==='video') &&
      tracks.some(t=>t.period===period&&t.kind==='audio'));
    const period=pairedPeriods.length===1?pairedPeriods[0]:null;
    const pairedTracks=period?tracks.filter(t=>t.period===period):[];
    const distinctAudioGroups=new Set(pairedTracks.filter(t=>t.kind==='audio').map(t=>t.adaptation));
    const usableTracks=distinctAudioGroups.size===1?pairedTracks:[];
    const videos=usableTracks.filter(t=>t.kind==='video').sort((a,b)=>{
      const support=t=>(/avc1|h264/.test(t.codecs)?3:/vp09|vp9/.test(t.codecs)?2:1);
      return support(b)-support(a) || b.width*b.height-a.width*a.height || b.bandwidth-a.bandwidth;
    });
    const audios=usableTracks.filter(t=>t.kind==='audio').sort((a,b)=>b.bandwidth-a.bandwidth);
    const vi=config.videoQuality==='small'?videos.at(-1):config.videoQuality==='balanced'?videos[Math.floor(videos.length/2)]:videos[0];
    const au=config.audioQuality==='balanced'?audios[Math.floor(audios.length/2)]:audios[0];
    return {video:vi||null, audio:au||null, videos, audios};
  }

  async function fetchMedia(job, url, label, startProgress, endProgress) {
    if(job.cancelled)throw Error('Cancelled');
    url=validatedUrl(url);
    const controller=new AbortController();
    job.controllers.add(controller);
    let response;
    try {
      response=await fetch(url,{signal:controller.signal,credentials:'include',redirect:'follow'});
      if(!response.ok)throw Error(`${label} request failed (HTTP ${response.status}). Expired signed link or unavailable media.`);
      const contentLength=Number(response.headers.get('content-length'))||0;
      if(contentLength>MAX_BYTES)throw Error('This file is too large for in-browser processing (600 MB limit).');
      const chunks=[];
      let received=0;
      const reader=response.body?.getReader();
      if(!reader) {
        const buffer=await response.arrayBuffer();
        return new Blob([buffer],{type:response.headers.get('content-type')||'application/octet-stream'});
      }
      let lastUpdate=0;
      while(true){
        if(job.cancelled){await reader.cancel();throw Error('Cancelled');}
        const {value,done}=await reader.read();
        if(done)break;
        chunks.push(value);received+=value.byteLength;
        if(received>MAX_BYTES)throw Error('This file exceeds the 600 MB in-browser limit.');
        const now=performance.now();
        if(now-lastUpdate>200){
          const pct=contentLength ? startProgress+(endProgress-startProgress)*(received/contentLength) : startProgress;
          progress(job,pct,`Fetching ${label}… ${(received/1048576).toFixed(1)} MB${contentLength?' / '+(contentLength/1048576).toFixed(1)+' MB':''}`);
          lastUpdate=now;
        }
      }
      progress(job,endProgress,`${label} received`);
      return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
    } finally {job.controllers.delete(controller);}
  }

  function waitMedia(el, label, job) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>cleanup(Error(`${label} could not be decoded by Chrome.`)),20000);
      const done=()=>cleanup();
      const bad=()=>cleanup(Error(`${label} failed to decode (unsupported DASH representation).`));
      const abort=()=>cleanup(Error('Cancelled'));
      function cleanup(error){
        clearTimeout(timer);
        el.removeEventListener('loadedmetadata',done);
        el.removeEventListener('error',bad);
        job.controller.signal.removeEventListener('abort',abort);
        if(error)reject(error);else resolve();
      }
      el.addEventListener('loadedmetadata',done,{once:true});
      el.addEventListener('error',bad,{once:true});
      job.controller.signal.addEventListener('abort',abort,{once:true});
      el.load();
    });
  }

  async function combineAudioVideo(job, videoBlob, audioBlob) {
    if(!('MediaRecorder' in window))throw Error('Chrome MediaRecorder is unavailable.');
    const vUrl=URL.createObjectURL(videoBlob), aUrl=URL.createObjectURL(audioBlob);
    let video, audio, audioContext, frameTimer, record, outputStream;
    try {
      video=document.createElement('video');
      audio=document.createElement('audio');
      video.muted=true;video.playsInline=true;video.preload='auto';video.src=vUrl;
      audio.preload='auto';audio.src=aUrl;
      // Keep media elements attached to ensure decoding in Chrome offscreen documents.
      video.style.cssText='width:1px;height:1px;position:absolute;left:-10000px';
      audio.style.cssText='position:absolute;left:-10000px';
      document.body.append(video,audio);
      progress(job,71,'Preparing audio and video tracks…');
      await Promise.all([waitMedia(video,'Video',job),waitMedia(audio,'Audio',job)]);
      if(job.cancelled)throw Error('Cancelled');
      if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('The DASH video does not expose a finite duration.');
      // Even a malformed or wrongly scoped manifest must not let a soundtrack
      // from a different-length clip masquerade as synchronized audio.
      if(!Number.isFinite(audio.duration)||audio.duration<=0 ||
         Math.abs(audio.duration-video.duration)>Math.max(1.5,video.duration*0.05)) {
        throw Error('The DASH audio and video durations disagree; refusing to combine potentially unrelated tracks.');
      }

      // The audio is routed to a MediaStreamDestination, NOT the speakers.
      audioContext=new AudioContext();
      const source=audioContext.createMediaElementSource(audio);
      const destination=audioContext.createMediaStreamDestination();
      source.connect(destination);
      await Promise.race([
        audioContext.resume(),
        new Promise((_, reject) => setTimeout(() => reject(Error('Chrome could not start the local audio processor (autoplay permission).')), 12000))
      ]);
      let vStream;
      try { vStream=typeof video.captureStream==='function' ? video.captureStream() : null; }catch{}
      let vTrack=vStream?.getVideoTracks()?.[0];
      if(!vTrack){
        const canvas=document.createElement('canvas');
        canvas.width=video.videoWidth||720;canvas.height=video.videoHeight||1280;
        const context=canvas.getContext('2d',{alpha:false});
        if(!context)throw Error('Unable to create video canvas');
        vStream=canvas.captureStream(30);
        vTrack=vStream.getVideoTracks()[0];
        frameTimer=setInterval(()=>{try{if(video.readyState>=2)context.drawImage(video,0,0,canvas.width,canvas.height);}catch{}},33);
      }
      if(!vTrack)throw Error('Chrome could not capture the video stream.');
      outputStream=new MediaStream([vTrack,...destination.stream.getAudioTracks()]);
      const types=['video/mp4;codecs="avc1.424028,mp4a.40.2"','video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
      const mimeType=types.find(x=>MediaRecorder.isTypeSupported(x));
      if(!mimeType)throw Error('Chrome cannot encode a combined video/audio file.');
      record=new MediaRecorder(outputStream,{mimeType,videoBitsPerSecond:3000000,audioBitsPerSecond:128000});
      job.recorder=record;
      const chunks=[];
      let recordingFailure=null;
      let lastTime=-1;
      let lastPlaybackProgress=performance.now();
      let settle;
      const finished=new Promise((resolve,reject)=>{settle={resolve,reject};});
      record.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      record.onerror=e=>settle.reject(Error(e.error?.message||'MediaRecorder failed'));
      record.onstop=()=>{
        if(job.cancelled)settle.reject(Error('Cancelled'));
        else if(recordingFailure)settle.reject(recordingFailure);
        else if(!chunks.length)settle.reject(Error('Chrome returned an empty recording.'));
        else settle.resolve(new Blob(chunks,{type:mimeType.includes('mp4')?'video/mp4':'video/webm'}));
      };
      const stop=()=>{if(record?.state!=='inactive')record.stop();};
      video.addEventListener('ended',stop,{once:true});
      video.addEventListener('error',stop,{once:true});
      audio.addEventListener('error',stop,{once:true});
      const tick=setInterval(()=>{
        if(job.cancelled){clearInterval(tick);stop();return;}
        if(video.currentTime!==lastTime){lastTime=video.currentTime;lastPlaybackProgress=performance.now();}
        else if(performance.now()-lastPlaybackProgress>20000){
          recordingFailure=Error('Video playback stalled during local audio/video combination.');
          clearInterval(tick);stop();return;
        }
        const fraction=video.duration ? Math.min(1,video.currentTime/video.duration) : 0;
        progress(job,72+Math.round(fraction*22),`Combining sound and video… ${Math.round(fraction*100)}% (real-time)`);
      },500);
      job.timers.add(tick);
      record.start(1000);
      try {
        await Promise.all([video.play(),audio.play()]);
      } catch(e) {
        stop();
        throw Error('Chrome blocked or cannot play one of the media tracks: '+(e.message||e));
      }
      const result=await finished;
      clearInterval(tick);job.timers.delete(tick);
      progress(job,95,'Sound and video combined');
      return result;
    } finally {
      try{if(record && record.state!=='inactive')record.stop();}catch{}
      try{video?.pause();audio?.pause();}catch{}
      try{outputStream?.getTracks().forEach(t=>t.stop());}catch{}
      if(frameTimer)clearInterval(frameTimer);
      try{await audioContext?.close();}catch{}
      video?.remove();audio?.remove();
      URL.revokeObjectURL(vUrl); URL.revokeObjectURL(aUrl);
      job.recorder=null;
    }
  }

  async function save(job, blob, filename, notice='') {
    if(job.cancelled)throw Error('Cancelled');
    if(!(blob instanceof Blob)||blob.size<100)throw Error('No usable media bytes were produced; nothing was saved.');
    const url=URL.createObjectURL(blob);
    blobUrls.add(url);
    progress(job,95,'Handing file to Chrome Downloads…');
    const reply=await chrome.runtime.sendMessage({to:'remi-background',type:'SAVE',id:job.id,url,blobUrl:url,filename,notice});
    if(!reply?.ok){blobUrls.delete(url);URL.revokeObjectURL(url);throw Error(reply?.error||'Could not save file');}
  }
  async function parseMp4AudioTrack(blob) {
    // Some Instagram MP4s place the `moov` atom (and its audio `hdlr`)
    // *after* the large `mdat`. Scanning only the first 1.5 MB incorrectly
    // declares these ordinary videos silent and used to discard their bytes.
    if(!/mp4|octet-stream|video\//i.test(blob.type||'video/mp4'))return false;
    const probe=async slice=>{
      const bytes=new Uint8Array(await slice.arrayBuffer());
      const dv=new DataView(bytes.buffer);
      for(let i=4;i+20<bytes.length;i++) {
        if(bytes[i]!==104||bytes[i+1]!==100||bytes[i+2]!==108||bytes[i+3]!==114)continue;
        const size=dv.getUint32(i-4,false);
        // ISO BMFF: size(4), `hdlr`(4), version+flags(4), pre_defined(4), handler(4)
        if(size>=24 && size<=100000 && i+16<bytes.length &&
           String.fromCharCode(...bytes.subarray(i+12,i+16))==='soun')return true;
      }
      return false;
    };
    const bytes=4*1024*1024;
    if(await probe(blob.slice(0,Math.min(blob.size,bytes))))return true;
    if(blob.size>bytes && await probe(blob.slice(Math.max(0,blob.size-bytes))))return true;
    return false;
  }
  async function appearsCompleteVideo(blob){
    // Prevent reporting an incomplete DASH range (styp/moof-only fragment) as a full download.
    const header=new Uint8Array(await blob.slice(0,24).arrayBuffer());
    const tag=String.fromCharCode(...header.slice(4,8));
    if(tag==='styp' || tag==='moof')return false;
    if(tag==='ftyp')return true;
    if(header[0]===0x1a&&header[1]===0x45&&header[2]===0xdf&&header[3]===0xa3)return true;
    return false;
  }
  function extension(blob,url,kind) {
    const type=(blob.type||'').toLowerCase();
    if(kind==='image')return type.includes('png')?'.png':type.includes('webp')?'.webp':'.jpg';
    if(kind==='audio')return type.includes('mpeg')?'.mp3':type.includes('ogg')?'.ogg':'.m4a';
    return '.mp4';
  }

  function fileExtension(blob,kind) {
    const mime=(blob.type||'').toLowerCase();
    if(kind==='image')return mime.includes('png')?'.png':mime.includes('webp')?'.webp':'.jpg';
    if(kind==='audio')return mime.includes('mpeg')?'.mp3':mime.includes('ogg')?'.ogg':mime.includes('webm')?'.webm':'.m4a';
    if(kind==='video')return mime.includes('webm')?'.webm':'.mp4';
    return '.bin';
  }
  async function trySources(job,urls,label,start,end) {
    let lastError;
    const candidates=[...new Set(urls.filter(Boolean))].slice(0,9);
    if(!candidates.length)throw Error(`No ${label} stream address was detected.`);
    for(let i=0;i<candidates.length;i++){
      if(job.cancelled)throw Error('Cancelled');
      try {
        progress(job,start,`Fetching ${label} (source ${i+1}/${candidates.length})…`);
        const blob=await fetchMedia(job,candidates[i],label,start,end);
        if(blob.size<100)throw Error('Media response was empty');
        if(/text\/html|application\/json|dash\+xml|mpegurl|application\/xml|text\/plain/i.test(blob.type))throw Error('Media URL returned a webpage or an unsupported playlist');
        return {blob,url:candidates[i]};
      }catch(e){lastError=e;if(job.cancelled)throw Error('Cancelled');}
    }
    throw Error(`Could not fetch ${label}: ${lastError?.message||'the captured links expired'}. Open the post, play it, and retry.`);
  }
  async function toJpeg(blob) {
    const bitmap=await createImageBitmap(blob);
    try {
      const canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('JPEG conversion not supported');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0);
      const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.93));
      if(!jpeg)throw Error('JPEG conversion failed');
      return jpeg;
    } finally {bitmap.close();}
  }
  async function muteVideo(job, blob) {
    if(!('MediaRecorder' in window))throw Error('Chrome cannot export silent video.');
    const url=URL.createObjectURL(blob),video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
    video.style.cssText='position:absolute;left:-10000px;width:1px;height:1px';
    document.body.appendChild(video);
    let recorder,trackStream,timer,frameTimer;
    try {
      await waitMedia(video,'Video',job);
      if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('Video has no finite playback duration.');
      let captured;
      try {captured=video.captureStream?.();}catch{}
      if(!captured?.getVideoTracks().length){
        const canvas=document.createElement('canvas');
        canvas.width=video.videoWidth||720;canvas.height=video.videoHeight||1280;
        const ctx=canvas.getContext('2d',{alpha:false});
        if(!ctx)throw Error('Canvas renderer unavailable.');
        captured=canvas.captureStream(30);
        frameTimer=setInterval(()=>{try{if(video.readyState>=2)ctx.drawImage(video,0,0,canvas.width,canvas.height);}catch{}},33);
      }
      trackStream=new MediaStream(captured.getVideoTracks());
      const mime=['video/mp4;codecs="avc1.42E01E"','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
      if(!mime)throw Error('Chrome does not have a video-only encoder.');
      recorder=new MediaRecorder(trackStream,{mimeType:mime,videoBitsPerSecond:2800000});
      job.recorder=recorder;
      const chunks=[];
      const result=new Promise((resolve,reject)=>{
        recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
        recorder.onerror=e=>reject(Error(e.error?.message||'Recorder failed'));
        recorder.onstop=()=>{
          if(job.cancelled)reject(Error('Cancelled'));
          else if(!chunks.length)reject(Error('Empty silent video'));
          else resolve(new Blob(chunks,{type:mime.includes('mp4')?'video/mp4':'video/webm'}));
        };
      });
      const stop=()=>{if(recorder.state!=='inactive')recorder.stop();};
      video.addEventListener('ended',stop,{once:true});
      video.addEventListener('error',stop,{once:true});
      timer=setInterval(()=>{
        if(job.cancelled){stop();return;}
        const pct=Math.min(1,video.currentTime/video.duration);
        progress(job,73+Math.floor(22*pct),`Removing soundtrack… ${Math.floor(pct*100)}% (real-time)`);
      },500);job.timers.add(timer);
      recorder.start(1000);await video.play();
      return await result;
    }finally{
      if(timer){clearInterval(timer);job.timers.delete(timer);}
      if(frameTimer)clearInterval(frameTimer);
      try{if(recorder?.state!=='inactive')recorder.stop();}catch{}
      try{video.pause();trackStream?.getTracks().forEach(t=>t.stop());}catch{}
      video.remove();URL.revokeObjectURL(url);job.recorder=null;
    }
  }
  async function extractAudio(job, videoBlob) {
    // Extract by browser-native decoding and recording. In-browser real-time;
    // mp4-audio when supported, otherwise webm/opus. No codecs downloaded.
    if(!('MediaRecorder' in window))throw Error('Chrome cannot record an audio-only file.');
    const src=URL.createObjectURL(videoBlob);
    const video=document.createElement('video');
    video.preload='auto';video.playsInline=true;video.src=src;
    video.style.cssText='position:absolute;left:-10000px;width:1px;height:1px';
    document.body.appendChild(video);
    let audioContext,recorder,stream,monitor;
    try {
      await waitMedia(video,'Source video',job);
      if(job.cancelled)throw Error('Cancelled');
      if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('The source cannot be decoded into audio.');
      audioContext=new AudioContext();
      stream=audioContext.createMediaStreamDestination();
      audioContext.createMediaElementSource(video).connect(stream);
      await audioContext.resume();
      const types=['audio/mp4;codecs="mp4a.40.2"','audio/webm;codecs=opus','audio/webm'];
      const mime=types.find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw Error('No audio encoder available in Chrome.');
      const chunks=[];
      recorder=new MediaRecorder(stream.stream,{mimeType:mime,audioBitsPerSecond:128000});
      job.recorder=recorder;
      const finished=new Promise((resolve,reject)=>{
        recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
        recorder.onerror=e=>reject(Error(e.error?.message||'Audio recorder error'));
        recorder.onstop=()=>{
          if(job.cancelled)reject(Error('Cancelled'));
          else if(!chunks.length)reject(Error('Audio extraction produced an empty file.'));
          else resolve(new Blob(chunks,{type:mime.includes('mp4')?'audio/mp4':'audio/webm'}));
        };
      });
      const stop=()=>{if(recorder.state!=='inactive')recorder.stop();};
      video.addEventListener('ended',stop,{once:true});
      video.addEventListener('error',stop,{once:true});
      monitor=setInterval(()=>{
        if(job.cancelled){stop();return;}
        const pct=Math.min(1,video.currentTime/video.duration);
        progress(job,46+Math.floor(49*pct),`Extracting audio… ${Math.floor(pct*100)}% (real-time)`);
      },500);
      job.timers.add(monitor);
      recorder.start(1000);
      await video.play();
      const result=await finished;
      progress(job,95,'Audio track extracted');
      return result;
    } finally {
      if(monitor){clearInterval(monitor);job.timers.delete(monitor);}
      try{if(recorder?.state!=='inactive')recorder.stop();}catch{}
      try{video.pause();stream?.stream.getTracks().forEach(t=>t.stop());}catch{}
      await audioContext?.close().catch(()=>{});
      video.remove();URL.revokeObjectURL(src);
      job.recorder=null;
    }
  }
  async function process(job, payload) {
    const media=payload.media||{};
    const cfg=payload.config||{};
    const pref=['video','audio','image'].includes(payload.preference)?payload.preference:'video';
    const mediaCode=String(media.code||'media').replace(/[^\w-]/g,'').slice(0,50)||'media';
    const prefix=`instagram_${mediaCode}`;
    const validList=items=>(Array.isArray(items)?items:[]).map(url=>{
      try{return validatedUrl(url);}catch{return null;}
    }).filter(Boolean);
    try {
      const trustedManifest=media.audioBinding==='same-manifest';
      const dash=trustedManifest?parseMpd(media.dash,cfg):null;
      const rawVideo=validList(media.videoUrls||[]);
      const pick=(arr,mode)=>mode==='small'||mode==='balanced'&&arr.length<=2?arr.at(-1):mode==='balanced'?arr[Math.floor(arr.length/2)]:arr[0];
      const videoChoice=pick(rawVideo,cfg.videoQuality);
      // Original progressive representations are checked for embedded sound;
      // adaptive DASH representations come only from the selected record's MPD.
      // Never treat network timing or a same-shortcode URL as a rendition.
      const videoUrls=validList([videoChoice,...rawVideo,...(dash?.videos||[]).map(t=>t.url)]);
      const imageUrls=validList(media.imageUrls||[]);
      // Extract audio *only* from a video-containing MPD belonging to the
      // clicked asset. Standalone sound-library URLs and independently tagged
      // CDN requests are NOT soundtrack evidence, even if code/poster matches.
      const audioUrls=validList([dash?.audio?.url]);
      const eligibleAudioForVideo=sourceUrl=>(sourceUrl && dash?.audio &&
        dash.videos?.some(t=>t.url===sourceUrl))?[dash.audio.url]:[];
      // In Chrome/Instagram a video/mp4 DASH representation is frequently
      // VIDEO ONLY, while a different progressive MP4 of the *same item*
      // contains embedded AAC. Search eligible sources for sound before
      // assuming we must mux or returning an incomplete video.
      // Instagram's blob player can request several rendition URLs without
      // exposing their width/height in the page data. Probe actual decoded
      // video dimensions before applying this *item's* quality preference.
      async function videoDimensions(blob) {
        const url=URL.createObjectURL(blob);
        const element=document.createElement('video');
        element.preload='metadata';element.muted=true;element.playsInline=true;
        element.src=url;
        try {
          const info=await new Promise(resolve=>{
            let settled=false;
            const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);
              resolve({pixels:(element.videoWidth||0)*(element.videoHeight||0),
                duration:Number.isFinite(element.duration)?element.duration:0});};
            const timer=setTimeout(finish,6000);
            element.addEventListener('loadedmetadata',finish,{once:true});
            element.addEventListener('error',finish,{once:true});
            try{element.load();}catch{finish();}
          });
          return info;
        }finally{element.removeAttribute('src');element.load();URL.revokeObjectURL(url);}
      }
      async function chooseVideoWithSound(start,end) {
        const options=[...new Set(videoUrls)].slice(0,8);
        let firstSilent=null,firstPairedSilent=null,lastError=null;
        // This mode is used only for multiple URLs recovered for the EXACT
        // playing element, never for arbitrary requests from the Instagram tab.
        if(media.probeVideoQuality && options.length>1) {
          const measured=[];
          for(let i=0;i<options.length;i++) {
            if(job.cancelled)throw Error('Cancelled');
            try{
              const from=start+(end-start)*i/options.length;
              const to=start+(end-start)*(i+1)/options.length;
              progress(job,from,`Checking quality ${i+1}/${options.length} for this video…`);
              const blob=await fetchMedia(job,options[i],'video',from,to);
              if(blob.size<100 || !await appearsCompleteVideo(blob))throw Error('Incomplete video representation');
              const [{pixels,duration},hasAudio]=await Promise.all([videoDimensions(blob),parseMp4AudioTrack(blob)]);
              measured.push({blob,pixels,duration,hasAudio,size:blob.size,index:i,sourceUrl:options[i]});
            }catch(e){lastError=e;}
          }
          if(!measured.length)throw Error('No complete video rendition could be downloaded: '+(lastError?.message||'media URLs expired'));
          // Resolution is authoritative when Chrome can decode it. Size is
          // only a tie-breaker, not a claim that filesize equals resolution.
          measured.sort((a,b)=>b.pixels-a.pixels || b.size-a.size || a.index-b.index);
          const quality=cfg.videoQuality||'best';
          const idx=quality==='small'?measured.length-1:quality==='balanced'?Math.floor(measured.length/2):0;
          let selected=measured[idx];
          // Keep the selected quality where possible. Only switch renditions
          // when the selected one is silent AND has no proven audio pairing.
          if(cfg.videoSound!=='no' && !selected.hasAudio &&
             !eligibleAudioForVideo(selected.sourceUrl).length){
            const withSound=measured.filter(x=>x.hasAudio ||
              eligibleAudioForVideo(x.sourceUrl).length);
            if(withSound.length){
              selected=withSound.reduce((best,x)=>
                Math.abs(measured.indexOf(x)-idx)<Math.abs(measured.indexOf(best)-idx)
                  ?x:best,withSound[0]);
            }
          }
          return {video:selected.blob,hasAudio:selected.hasAudio,sourceUrl:selected.sourceUrl};
        }
        for(let i=0;i<options.length;i++) {
          if(job.cancelled)throw Error('Cancelled');
          try {
            progress(job,start,`Checking video stream ${i+1}/${options.length} for sound…`);
            const blob=await fetchMedia(job,options[i],'video',start,end);
            if(blob.size<100)throw Error('Empty video stream');
            if(/text\/html|application\/json|dash\+xml|mpegurl|application\/xml|text\/plain/i.test(blob.type))throw Error('Media URL returned a webpage or playlist');
            if(!await appearsCompleteVideo(blob))throw Error('Incomplete DASH fragment');
            if(await parseMp4AudioTrack(blob))return {video:blob,hasAudio:true,sourceUrl:options[i]};
            if(!firstSilent)firstSilent={blob,sourceUrl:options[i]};
            if(eligibleAudioForVideo(options[i]).length){
              if(i===0)return {video:blob,hasAudio:false,sourceUrl:options[i]};
              if(!firstPairedSilent)firstPairedSilent={blob,sourceUrl:options[i]};
            }
          }catch(e){lastError=e;}
        }
        if(firstPairedSilent && cfg.videoSound!=='no')
          return {video:firstPairedSilent.blob,hasAudio:false,sourceUrl:firstPairedSilent.sourceUrl};
        if(firstSilent)return {video:firstSilent.blob,hasAudio:false,sourceUrl:firstSilent.sourceUrl};
        throw Error('No complete video stream could be fetched for this item: '+(lastError?.message||'no compatible URL'));
      }
      if(pref==='image') {
        if(!imageUrls.length)throw Error('No image URL was found for the visible post.');
        let blob;
        try {
          ({blob}=await trySources(job,imageUrls,'image',5,89));
        }catch(error){
          if(media.hasVisibleVideo){
            throw Error('The video cover image could not be fetched. Select Video in ⋮ to download the video instead. Details: '+error.message);
          }
          throw error;
        }
        if(cfg.imageFormat==='jpeg') {
          progress(job,91,'Converting image to JPEG…');
          blob=await toJpeg(blob);
        }
        await save(job,blob,`${prefix}${fileExtension(blob,'image')}`);
        return;
      }
      if(pref==='audio') {
        if(audioUrls.length){
          try {
            const {blob}=await trySources(job,audioUrls,'audio',5,91);
            await save(job,blob,`${prefix}_audio${fileExtension(blob,'audio')}`);
            return;
          }catch(e){
            if(cfg.audioSource==='separate')throw e;
            progress(job,10,'Separate audio unavailable; checking embedded soundtrack…');
          }
        }
        if(cfg.audioSource==='separate')throw Error('No separate audio stream was detected. Choose Auto in ⋯ Audio to extract embedded sound.');
        if(!videoUrls.length)throw Error('No audio stream or playable video was detected. Open the Reel, play it briefly, then retry.');
        const {video:blob,hasAudio}=await chooseVideoWithSound(8,43);
        if(!hasAudio)throw Error('No sound track was identified for this specific video. Open and play the Reel, then retry.');
        const extracted=await extractAudio(job,blob);
        await save(job,extracted,`${prefix}_audio${fileExtension(extracted,'audio')}`);
        return;
      }
      if(!videoUrls.length)throw Error(media.captureDiagnostic || 'No video stream detected. Open the selected Reel, play it, and try again.');
      const wantsSound=cfg.videoSound!=='no';
      const chosen=wantsSound
        ? await chooseVideoWithSound(5,audioUrls.length?51:86)
        : media.probeVideoQuality ? await chooseVideoWithSound(5,89) : {video:(await trySources(job,videoUrls,'video',5,89)).blob};
      const video=chosen.video;
      if(!await appearsCompleteVideo(video))throw Error('Instagram returned a DASH fragment, not a complete MP4. Open the Reel and retry.');
      if(!wantsSound){
        if(await parseMp4AudioTrack(video)) {
          progress(job,72,'Removing the embedded soundtrack locally…');
          const silent=await muteVideo(job,video);
          await save(job,silent,`${prefix}_silent${fileExtension(silent,'video')}`);
          return;
        }
        await save(job,video,`${prefix}_silent${fileExtension(video,'video')}`);
        return;
      }
      const alreadyHasAudio=chosen.hasAudio;
      if(alreadyHasAudio) {
        await save(job,video,`${prefix}${fileExtension(video,'video')}`);
        return;
      }
      const matchingAudio=eligibleAudioForVideo(chosen.sourceUrl);
      if(!matchingAudio.length) {
        if(media.expectsAudio===false && trustedManifest) {
          await save(job,video,`${prefix}${fileExtension(video,'video')}`,
            'This post reports no soundtrack; saved its original video.');
          return;
        }
        throw Error('Audio was not verified as belonging to this exact video, so no potentially unrelated soundtrack was merged. Nothing saved. Try playing this Reel again or choose Silent video in ⋮.');
      }
      if(matchingAudio.length>1) {
        throw Error('Multiple different soundtracks were listed for this video. Refusing to guess which one belongs to it. Nothing saved.');
      }
      try {
        const {blob:audio}=await trySources(job,matchingAudio,'audio',54,70);
        progress(job,71,'Combining separate video and audio locally…');
        const combined=await combineAudioVideo(job,video,audio);
        await save(job,combined,`${prefix}${fileExtension(combined,'video')}`);
      }catch(audioError){
        if(job.cancelled)throw audioError;
        // Never claim success by silently substituting video-only output when
        // the user selected Include audio. In particular, a media-ID mismatch
        // must not attach another post's soundtrack.
        throw Error('Audio could not be combined with this video, so nothing was saved: '+
          String(audioError.message||audioError).slice(0,155)+
          '. Retry playback or choose Silent video explicitly.');
      }
    } catch(e) {
      if(!job.cancelled)fail(job,e);
    } finally {
      job.controllers.forEach(c=>c.abort());
      for(const timer of job.timers)clearInterval(timer);
      active.delete(job.id);
    }
  }

  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(msg?.to!=='remi-offscreen')return false;
    if(msg.type==='PROCESS'){
      if(active.has(msg.id)){respond({ok:false});return false;}
      const job={id:msg.id,cancelled:false,controllers:new Set(),controller:new AbortController(),timers:new Set(),recorder:null};
      active.set(job.id,job);
      process(job,msg);
      respond({ok:true});return false;
    }
    if(msg.type==='CANCEL'){
      const job=active.get(msg.id);
      if(job){
        job.cancelled=true;
        job.controller.abort();
        for(const c of job.controllers)c.abort();
        try{if(job.recorder?.state!=='inactive')job.recorder.stop();}catch{}
        for(const timer of job.timers)clearInterval(timer);
      }
      respond({ok:true});return false;
    }
    if(msg.type==='REVOKE'){
      if(blobUrls.has(msg.url)){blobUrls.delete(msg.url);URL.revokeObjectURL(msg.url);}
      respond({ok:true});return false;
    }
    return false;
  });
})();
