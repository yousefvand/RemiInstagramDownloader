"""Browser-only tests of UI and offscreen processing, no web navigation needed.
Chrome UI events and download API are stubbed. Uses real h264/AAC fixture bytes.
This is not a live Instagram integration test.
"""
import base64, json, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
MEDIA=ROOT/'tests'

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-features=MediaRecorder'])
        page=browser.new_page()
        page.on('pageerror', lambda e: print('PAGEERROR',e))
        page.on('console', lambda m: print('CONSOLE',m.type,m.text[:400]))
        page.set_viewport_size({'width':1240,'height':940})
        page.set_content('''<html><body style="margin:0;padding:0">
          <main style="display:flex;gap:14px;padding:50px 12px">
            <article><a href="/p/PHOTO1/"><img alt="landscape" style="width:300px;height:300px"
              src="https://scontent.cdninstagram.com/photo1.jpg"></a></article>
            <article><a href="/p/PHOTO2/"><img alt="scene" style="width:300px;height:300px"
              src="https://scontent.cdninstagram.com/photo2.jpg"></a></article>
            <article><a href="/reel/VIDEO3/"><video style="width:300px;height:300px"
              src="https://scontent.cdninstagram.com/video3.mp4"></video></a></article>
            <img alt="profile picture" style="width:190px;height:190px" src="https://scontent.cdninstagram.com/avatar.jpg">
          </main>
          <div style="height:1300px"></div>
          <article><a href="/p/PHOTO4/"><img style="width:300px;height:300px" src="https://scontent.cdninstagram.com/photo4.jpg"></a></article>
        </body></html>''',wait_until='domcontentloaded')
        page.evaluate("""() => {
          window.__events=[];window.__starts=[]; Object.defineProperty(window.crypto,'randomUUID',{value:()=>('testid'+Math.random().toString(36).slice(2).padEnd(13,'0'))});
          window.__stored={};window.chrome={storage:{local:{get:async()=>({...window.__stored}),set:async obj=>Object.assign(window.__stored,obj)}},runtime:{
            onMessage:{addListener:(fn)=>{window.__contentHandler=fn}},
            sendMessage:async msg=>{window.__starts.push(msg);return {ok:true}}
          }};
        }""")
        page.add_script_tag(content=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})","attachShadow({mode:'open'})"))
        host=page.locator('#remi-instagram-downloader-host')
        host.wait_for(timeout=7000)
        host.locator('.widget').first.wait_for()
        assert host.locator('.widget:visible').count()==3, f"expected per-media controls: {host.locator('.widget:visible').count()}"
        assert host.locator('.widget:visible .dl').count()==3
        assert host.locator('.widget:visible .dots').count()==3
        assert host.locator('.widget:visible .buttons button').count()==6
        # Both permanent controls are now half the previous 36px width.
        assert host.locator('.widget').first.locator('.dl').evaluate('(e)=>getComputedStyle(e).width')=='18px'
        assert host.locator('.widget').first.locator('.dots').evaluate('(e)=>getComputedStyle(e).width')=='18px'
        assert host.locator('.widget').first.locator('.dots svg circle').count()==3
        # SVG centers must align exactly with the narrow button center on both axes.
        for cls in ('dl','dots'):
            alignment=host.locator('.widget').first.locator('.'+cls).evaluate("""el => {
              const r=el.getBoundingClientRect(), s=el.querySelector('svg').getBoundingClientRect();
              return {dx: (s.left+s.right-r.left-r.right)/2, dy:(s.top+s.bottom-r.top-r.bottom)/2};
            }""")
            assert abs(alignment['dx'])<0.7 and abs(alignment['dy'])<0.7,alignment
        assert host.locator('.widget').nth(0).locator('.dl').get_attribute('aria-label')=='Download image from this media'
        assert host.locator('.widget').nth(2).locator('.dl').get_attribute('aria-label')=='Download video from this media'
        box=host.locator('.widget').nth(0).bounding_box()
        assert abs(box['y']-58)<3, box  # Positioned inside first media, not global top-left.
        first=host.locator('.widget').nth(0)
        second=host.locator('.widget').nth(1)
        first.locator('.dots').click()
        first.locator('summary').filter(has_text='Image').click()
        first.locator('[data-setting="imageFormat"]').select_option('jpeg')
        # Per-item settings must NOT propagate to the neighboring photo.
        second.locator('.dots').click()
        assert second.locator('[data-setting="imageFormat"]').input_value()=='original'
        assert second.locator('[data-setting="imageResolution"]').input_value()=='best'
        second.locator('[data-setting="imageResolution"]').select_option('visible')
        assert first.locator('[data-setting="imageFormat"]').input_value()=='jpeg'
        assert first.locator('[data-setting="imageResolution"]').input_value()=='best'
        # A mismatched API image for the same post must not replace the clicked image.
        page.evaluate('''() => window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{channel:'RemiInstagramDownloader:media',entries:[
          {code:'PHOTO1',mediaId:'NOT_THIS_SLIDE',imageUrls:[{url:'https://scontent.cdninstagram.com/wrong.jpg',width:2000}]}
        ]}}))''')
        page.wait_for_timeout(50)
        first.locator('.dl').click()
        sent=page.evaluate('window.__starts.find(x=>x.type==="START")')
        assert sent['preference']=='image' and sent['config']['imageFormat']=='jpeg'
        assert sent['media']['imageUrls'][0].endswith('photo1.jpg'),sent['media']
        assert sent['media']['scopedToElement'] is True
        assert sent['media']['allowTabWideFallback'] is False
        assert first.locator('.progress').is_visible()
        assert second.locator('.progress').is_hidden()
        jobid=sent['id']
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"PROGRESS",percent:54,message:"Fetching image…"})',jobid)
        assert first.locator('.percent').inner_text()=='54%'
        # Both items must maintain independent in-flight jobs.
        second.locator('.dl').click()
        concurrent=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
        assert concurrent['type']=='START' and concurrent['media']['imageUrls'][0].endswith('photo2.jpg')
        assert concurrent['config']['imageFormat']=='original',concurrent
        assert concurrent['config']['imageResolution']=='visible',concurrent
        assert first.locator('.percent').inner_text()=='54%'
        assert second.locator('.progress').is_visible()
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',concurrent['id'])
        first.locator('.cancel').click()
        assert page.evaluate('window.__starts.at(-1).type')=='CANCEL'
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"FINISH",state:"cancelled",message:"Cancelled"})',jobid)
        assert first.locator('.message').inner_text()=='Cancelled'
        second.locator('.dl').click()
        sent2=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
        assert sent2['media']['imageUrls'][0].endswith('photo2.jpg')
        assert sent2['media']['code']=='PHOTO2'
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',sent2['id'])
        third=host.locator('.widget').nth(2)
        third.locator('.dots').click()
        third.locator('summary').filter(has_text='Audio').click()
        third.locator('[data-setting="audioSource"]').select_option('separate')
        page.evaluate('''() => {window.postMessage=data=>{
          if(data.channel==='RemiInstagramDownloader:resolve')window.dispatchEvent(new MessageEvent('message',{
            source:window,origin:location.origin,data:{channel:'RemiInstagramDownloader:resolved',nonce:data.nonce}
          }));
        };}''')
        started_before=page.evaluate('window.__starts.filter(x=>x.type==="START").length')
        third.locator('.dl').click()
        page.wait_for_function('before=>window.__starts.filter(x=>x.type==="START").length>before',arg=started_before,timeout=8000)
        sent3=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
        assert sent3['preference']=='audio' and sent3['media']['code']=='VIDEO3'
        assert sent3['media']['videoUrls'][0].endswith('video3.mp4')
        assert sent3['config']['audioSource']=='separate'
        # Item overrides are saved under distinct item identities, not global defaults.
        page.wait_for_function("Object.keys(window.__stored.remi_item_config_v1 || {}).length >= 3")
        stored=page.evaluate('window.__stored.remi_item_config_v1')
        assert len(stored)>=3,stored
        bycode={key.split(':')[1]:value for key,value in stored.items()}
        assert bycode['PHOTO1']['config']['imageFormat']=='jpeg'
        assert bycode['PHOTO2']['config']['imageFormat']=='original'
        assert bycode['PHOTO2']['config']['imageResolution']=='visible'
        assert bycode['VIDEO3']['config']['audioSource']=='separate'
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',sent3['id'])
        # Scroll old media off and bring new media into view; controls follow the visible items.
        page.evaluate('window.scrollTo(0,1400)')
        page.wait_for_timeout(250)
        assert host.locator('.widget:visible').count()==1
        assert host.locator('.widget:visible .dl').count()==1
        host.locator('.widget:visible .dl').click()
        sent4=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
        assert sent4['media']['imageUrls'][0].endswith('photo4.jpg')
        assert sent4['config']['imageFormat']=='original', sent4
        assert sent4['config']['imageResolution']=='best', sent4
        page.evaluate('id=>window.__contentHandler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',sent4['id'])
        # Scrolling back creates fresh controls, which must restore ONLY their item settings.
        page.evaluate('window.scrollTo(0,0)')
        page.wait_for_timeout(300)
        assert host.locator('.widget:visible').count()==3
        first_again=host.locator('.widget:visible').nth(0)
        second_again=host.locator('.widget:visible').nth(1)
        assert first_again.locator('[data-setting="imageFormat"]').input_value()=='jpeg'
        assert second_again.locator('[data-setting="imageFormat"]').input_value()=='original'
        assert second_again.locator('[data-setting="imageResolution"]').input_value()=='visible'
        assert host.locator('.widget:visible').nth(2).locator('[data-setting="audioSource"]').input_value()=='separate'
        # Instagram can replace a DOM node while showing the same post. Identity-based
        # storage must restore the choice for the new element without affecting neighbors.
        page.evaluate('''() => {
          const photo=document.querySelector('a[href="/p/PHOTO1/"] img');
          photo.replaceWith(photo.cloneNode(true));
        }''')
        page.wait_for_timeout(300)
        assert host.locator('.widget:visible[style*="left: 20px"]').locator('[data-setting="imageFormat"]').input_value()=='jpeg'
        assert host.locator('.widget:visible[style*="left: 334px"]').locator('[data-setting="imageFormat"]').input_value()=='original'
        print('PASS: per-media independent selection, formats, resolutions, persistence across scroll / DOM replacement, progress, cancellation')
        page.close()

        media={name:base64.b64encode((MEDIA/name).read_bytes()).decode() for name in ('v.mp4','a.m4a','av.mp4','sample.jpg')}
        off=browser.new_page()
        off.set_content('<html><body></body></html>')
        off.evaluate('''data=>{
          window.__save=[]; window.__fail=[];window.__progress=[]; window.__lastDashB64='';
          window.__blobs=Object.fromEntries(Object.entries(data).map(([name,b64])=>[name,Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]));
          const nativeFetch=window.fetch.bind(window);
          window.fetch=async url=>{
            const name=new URL(url).pathname.split('/').at(-1);
            const bytes=window.__blobs[name];
            if(!bytes)return new Response('Not Found',{status:404});
            return new Response(bytes,{status:200,headers:{'content-type':name==='sample.jpg'?'image/jpeg':name==='a.m4a'?'audio/mp4':'video/mp4','content-length':String(bytes.length)}});
          };
          window.chrome={runtime:{onMessage:{addListener:fn=>{window.__offscreenHandler=fn}},
            sendMessage:async msg=>{
              if(msg.type==='SAVE') {
                const result=await (await fetchBlob(msg.url)).arrayBuffer();
                if(msg.filename.startsWith('instagram_DASH.')){
                  let binary=''; const data=new Uint8Array(result);
                  for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
                  window.__lastDashB64=btoa(binary);
                }
                window.__save.push({filename:msg.filename,size:result.byteLength,magic:String.fromCharCode(...new Uint8Array(result).slice(4,8))});
                return {ok:true};
              }
              if(msg.type==='FAIL')window.__fail.push(msg.error);
              if(msg.type==='PROGRESS')window.__progress.push(msg.message);
              return {ok:true};
            }
          }};
          window.fetchBlob=url=>window.__originalFetch(url);
          window.__originalFetch=nativeFetch;
          // Fetch URLs generated locally must be handled by the native fetch,
          // while fake Instagram CDN requests get the supplied binary fixtures.
          const mockFetch=window.fetch;
          window.fetch=(url,opts)=>String(url).startsWith('blob:')?window.__originalFetch(url,opts):mockFetch(url,opts);
        }''',media)
        off.add_script_tag(path=str(ROOT/'offscreen.js'))
        script='''async ({preference,media,config})=>{
          window.__save=[];window.__fail=[];window.__progress=[];
          window.__offscreenHandler({to:'remi-offscreen',type:'PROCESS',id:'test-'+Date.now(),preference,media,config},null,()=>{});
          for(let i=0;i<100;i++){
            if(window.__save.length||window.__fail.length)break;
            await new Promise(r=>setTimeout(r,100));
          }
          return {saved:window.__save,fail:window.__fail,progress:window.__progress.slice(-5)};
        }'''
        base='https://scontent.cdninstagram.com/'
        dash=f'<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet contentType="video" mimeType="video/mp4"><Representation bandwidth="500000" width="320" height="240" codecs="avc1.42E01E"><BaseURL>{base}v.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation bandwidth="128000" codecs="mp4a.40.2"><BaseURL>{base}a.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>'
        arguments=[
          dict(preference='image',media={'imageUrls':[base+'sample.jpg'],'code':'PIC'},config={'imageFormat':'jpeg'}),
          dict(preference='audio',media={'dash':dash,'code':'SONG'},config={'audioSource':'separate'}),
          dict(preference='video',media={'videoUrls':[base+'av.mp4'],'code':'AV'},config={'videoSound':'yes'}),
          dict(preference='video',media={'dash':dash,'code':'DASH'},config={'videoSound':'yes'}),
          dict(preference='audio',media={'videoUrls':[base+'av.mp4'],'code':'EMBED'},config={'audioSource':'auto'}),
          dict(preference='video',media={'videoUrls':[base+'av.mp4'],'code':'SILENT'},config={'videoSound':'no'}),
          # Regression for the user report: requesting sound must not silently
          # save a mute file when only video-only source is exposed.
          dict(preference='video',media={'videoUrls':[base+'v.mp4'],'code':'NO_AUDIO'},config={'videoSound':'yes'}),
          dict(preference='video',media={'videoUrls':[base+'v.mp4'],'audioUrls':[base+'missing_audio.m4a'],'code':'BROKEN_AUDIO'},config={'videoSound':'yes'}),
        ]
        for args in arguments:
            result=off.evaluate(script,args)
            print(args['preference'],args['media']['code'],json.dumps(result)[:750])
            if args['media']['code'] in ('NO_AUDIO','BROKEN_AUDIO'):
                assert not result['saved'] and result['fail'],result
                assert ('audio track' in result['fail'][0] or 'Audio could not' in result['fail'][0]),result
            else:
                assert result['saved'] and result['saved'][0]['size']>100 and not result['fail'],result
        # A recording with an audio track can still contain silence. Probe the
        # actually exported DASH WebM to make sure decoded soundtrack samples
        # survived the in-browser combine path (fixture is an audible sine).
        with tempfile.NamedTemporaryFile(suffix='.webm') as output:
            output.write(base64.b64decode(off.evaluate('window.__lastDashB64')))
            output.flush()
            tracks=subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type','-of','csv=p=0',output.name],text=True)
            assert 'audio' in tracks and 'video' in tracks,tracks
            audio=subprocess.run(['ffmpeg','-hide_banner','-i',output.name,'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,timeout=30)
            assert 'mean_volume:' in audio.stderr and 'mean_volume: -inf' not in audio.stderr,audio.stderr[-1300:]
            print('PASS: merged DASH output has decodable video AND non-silent audio samples')
        browser.close()

if __name__=='__main__':main()
