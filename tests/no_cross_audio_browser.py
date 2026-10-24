"""Regression: never mux audio inferred from playback timing alone.
A video with a proven per-asset audio URL does mux with its soundtrack.
Uses local H264/AAC fixtures; no Instagram account or network needed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, tempfile, subprocess
ROOT=Path(__file__).resolve().parents[1]

def run():
    blobs={
      'https://video.fbcdn.net/selected.mp4': (ROOT/'tests/v.mp4').read_bytes(),
      'https://audio.fbcdn.net/other.m4a': (ROOT/'tests/unrelated_880.m4a').read_bytes(),
      'https://audio.fbcdn.net/verified.m4a': (ROOT/'tests/verified_440.m4a').read_bytes(),
      'https://video.fbcdn.net/embedded.mp4': (ROOT/'tests/av.mp4').read_bytes(),
    }
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
          args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        page=browser.new_page()
        page.set_content('<html><body></body></html>')
        page.evaluate('''files=>{
          const nativeFetch=window.fetch.bind(window);
          const bin=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
          const data=Object.fromEntries(Object.entries(files).map(([url,encoded])=>[url,bin(encoded)]));
          window.fetch=(url,opts)=>{
            if(String(url).startsWith('blob:'))return nativeFetch(url,opts);
            if(!data[url])throw Error('Unexpected external URL: '+url);
            const bytes=data[url];
            return Promise.resolve(new Response(bytes,{status:200,headers:{
              'content-type':url.endsWith('m4a')?'audio/mp4':'video/mp4',
              'content-length':String(bytes.length)}}));
          };
          window.__saved=[];window.__errors=[];
          window.chrome={runtime:{onMessage:{addListener(fn){window.__receiver=fn}},
            async sendMessage(msg){
              if(msg.type==='FAIL')window.__errors.push({id:msg.id,error:msg.error});
              if(msg.type==='SAVE'){
                const bytes=new Uint8Array(await nativeFetch(msg.url).then(r=>r.arrayBuffer()));
                let b64='';for(const chunk of Array.from({length:Math.ceil(bytes.length/8192)},(_,i)=>bytes.subarray(i*8192,(i+1)*8192))){b64+=String.fromCharCode(...chunk)}
                window.__saved.push({id:msg.id,bytes:btoa(b64),filename:msg.filename});
              }
              return {ok:true};
            }}};
        }''',{url:base64.b64encode(data).decode() for url,data in blobs.items()})
        page.add_script_tag(content=(ROOT/'offscreen.js').read_text())
        def start(name,media):
            page.evaluate('''({name,media})=>window.__receiver({to:'remi-offscreen',type:'PROCESS',
              id:name,preference:'video',config:{videoSound:'yes',videoQuality:'best'},media}, {}, ()=>{})''',{
                'name':name,'media':media})
        # A captured audio URL with no verified association must not be used.
        start('unverified',{'code':'ONE','videoUrls':['https://video.fbcdn.net/selected.mp4'],
          'audioUrls':['https://audio.fbcdn.net/other.m4a'],'pairedVideoUrls':[], 'audioBinding':'none'})
        page.wait_for_function('window.__errors.some(x=>x.id==="unverified")',timeout=20000)
        assert not page.evaluate('window.__saved.some(x=>x.id==="unverified")')
        err=page.evaluate('window.__errors.find(x=>x.id==="unverified").error')
        assert 'not verified as belonging' in err,err
        # Even an 'exact-asset' marker must NOT make an original-sound library URL
        # into the synchronized soundtrack of a selected video.
        start('spoofed',{'code':'TWO','videoUrls':['https://video.fbcdn.net/selected.mp4'],
          'audioUrls':['https://audio.fbcdn.net/other.m4a'],
          'pairedVideoUrls':['https://video.fbcdn.net/selected.mp4'],
          'audioBinding':'exact-asset'})
        page.wait_for_function('window.__errors.some(x=>x.id==="spoofed")',timeout=20000)
        assert not page.evaluate('window.__saved.some(x=>x.id==="spoofed")')
        # Positive test: audio/video representations explicitly share ONE DASH
        # presentation, not just a shortcode, poster, or playback time.
        mpd="""<MPD><Period><AdaptationSet contentType="video" mimeType="video/mp4">
          <Representation bandwidth="1000000"><BaseURL>https://video.fbcdn.net/selected.mp4</BaseURL></Representation>
          </AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4">
          <Representation bandwidth="128000"><BaseURL>https://audio.fbcdn.net/verified.m4a</BaseURL></Representation>
          </AdaptationSet></Period></MPD>"""
        start('verified',{'code':'TWO','videoUrls':['https://video.fbcdn.net/selected.mp4'],
          'audioUrls':['https://audio.fbcdn.net/other.m4a'],
          'pairedVideoUrls':['https://video.fbcdn.net/selected.mp4'],
          'dash':mpd,'audioBinding':'same-manifest'})
        page.wait_for_function('window.__saved.some(x=>x.id==="verified") || window.__errors.some(x=>x.id==="verified")',timeout=30000)
        assert not page.evaluate('window.__errors.some(x=>x.id==="verified")'),page.evaluate('window.__errors')
        data=page.evaluate('window.__saved.find(x=>x.id==="verified")')
        with tempfile.NamedTemporaryFile(suffix='.webm') as f:
            f.write(base64.b64decode(data['bytes']));f.flush()
            details=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_type',
                                    '-of','csv=p=0',f.name],capture_output=True,text=True,check=True).stdout
            assert 'audio' in details and 'video' in details,details
            # Decode the *exported* soundtrack and confirm its dominant pitch
            # is the verified 440 Hz tone, not the neighboring 880 Hz audio.
            import numpy as np
            pcm=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',f.name,
                                '-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],
                                capture_output=True,check=True).stdout
            samples=np.frombuffer(pcm,dtype='<f4')
            assert samples.size>8000,'Muxed audio was missing or too short'
            segment=samples[4000:12000]
            amplitudes=np.abs(np.fft.rfft(segment*np.hanning(len(segment))))
            freqs=np.fft.rfftfreq(len(segment),1/8000)
            peak=float(freqs[np.argmax(amplitudes)])
            assert abs(peak-440)<12, f'WRONG SOUNDTRACK: dominant frequency {peak:.0f} Hz, expected 440 Hz'
        # Two different audio groups in one MPD are ambiguous; do not guess.
        ambiguous=mpd.replace('</Period>', '<AdaptationSet contentType="audio"><Representation><BaseURL>https://audio.fbcdn.net/other.m4a</BaseURL></Representation></AdaptationSet></Period>')
        start('ambiguous',{'code':'TWO','videoUrls':['https://video.fbcdn.net/selected.mp4'],
           'dash':ambiguous,'audioBinding':'same-manifest'})
        page.wait_for_function('window.__errors.some(x=>x.id==="ambiguous")',timeout=20000)
        assert not page.evaluate('window.__saved.some(x=>x.id==="ambiguous")')
        # An embedded soundtrack is preferred and no unrelated URL is used.
        start('embedded',{'code':'THREE','videoUrls':['https://video.fbcdn.net/embedded.mp4'],
          'audioUrls':['https://audio.fbcdn.net/other.m4a'],'audioBinding':'none'})
        page.wait_for_function('window.__saved.some(x=>x.id==="embedded") || window.__errors.some(x=>x.id==="embedded")',timeout=20000)
        assert page.evaluate('window.__saved.some(x=>x.id==="embedded")'),page.evaluate('window.__errors')
        print('PASS: nested/unverified sound refused; single-manifest audio merged; ambiguous groups refused; embedded soundtrack kept')
        browser.close()
if __name__=='__main__':run()
