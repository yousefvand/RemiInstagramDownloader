"""Regression: a video rendered as IMG must not try the image downloader by default.
No Instagram network requests. Uses synthetic page metadata and a Chrome API stub.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
CONTENT = (ROOT / 'content.js').read_text().replace("attachShadow({mode:'closed'})", "attachShadow({mode:'open'})")
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':760})
    page.on('pageerror',lambda e:print('PAGEERROR',e))
    page.on('console',lambda m:print('CONSOLE',m.type,m.text))
    page.set_content('''<html><body style="margin:0;padding:0">
      <article style="display:flex;gap:30px;padding:60px 20px">
        <a href="/p/SLIDES/" id="photo"><img style="width:300px;height:300px" alt="still photo" src="https://scontent.cdninstagram.com/stillphoto.jpg"></a>
        <a href="/p/SLIDES/" id="video"><img style="width:300px;height:300px" alt="video thumbnail" src="https://scontent.cdninstagram.com/video-poster.jpg"></a>
        <a href="/reel/REEL5/" id="reel"><img style="width:300px;height:300px" alt="reel cover" src="https://scontent.cdninstagram.com/reel-cover.jpg"></a>
      </article></body></html>''')
    page.evaluate('''() => {
      window.__starts=[];window.__stored={};
      Object.defineProperty(window.crypto,'randomUUID',{value:()=>('testid'+Math.random().toString(36).slice(2).padEnd(13,'0'))});
      window.chrome={storage:{local:{get:async()=>({...window.__stored}),set:async object=>Object.assign(window.__stored,object)}},runtime:{
        onMessage:{addListener:(fn)=>window.__handler=fn},
        sendMessage:async message=>{window.__starts.push(message);return {ok:true}}
      }};
    }''')
    page.add_script_tag(content=CONTENT)
    host=page.locator('#remi-instagram-downloader-host')
    host.locator('.widget').first.wait_for()
    assert host.locator('.widget:visible').count()==3
    photo=host.locator('.widget').nth(0)
    video=host.locator('.widget').nth(1)
    reel=host.locator('.widget').nth(2)
    assert photo.locator('.dl').get_attribute('aria-label')=='Download image from this media'
    assert video.locator('.dl').get_attribute('aria-label')=='Download image from this media'
    assert reel.locator('.dl').get_attribute('aria-label')=='Download video from this media'
    # Media API response arrives after initial DOM render, within same shortcode.
    # Only a poster that matches the video metadata should be promoted.
    page.evaluate('''() => window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{
      channel:'RemiInstagramDownloader:media',entries:[{
        code:'SLIDES',mediaId:'V02',
        imageUrls:[{url:'https://scontent.cdninstagram.com/video-poster.jpg',width:720}],
        videoUrls:[{url:'https://scontent.cdninstagram.com/real-video.mp4',width:720}],
        audioUrls:['https://scontent.cdninstagram.com/video-sound.m4a']
      }]
    }}))''')
    page.wait_for_function('''() => {
      const widgets=document.querySelector('#remi-instagram-downloader-host').shadowRoot.querySelectorAll('.widget');
      return widgets[1].querySelector('.dl').getAttribute('aria-label')==='Download video from this media';
    }''')
    assert photo.locator('.dl').get_attribute('aria-label')=='Download image from this media', 'neighboring photo should never inherit video kind from same shortcode'
    video.locator('.dl').click()
    page.wait_for_function('window.__starts.some(x=>x.type==="START")')
    started=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert started['preference']=='video', started
    assert started['media']['videoUrls'][0].endswith('real-video.mp4'), started
    assert started['media']['imageUrls'][0].endswith('video-poster.jpg')
    page.evaluate('id=>window.__handler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',started['id'])
    # User may explicitly ask for the video's preview Image: keep that choice.
    video.locator('.dots').click()
    video.locator('summary').filter(has_text='Image').click()
    video.locator('.dl').click()
    manual=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert manual['preference']=='image',manual
    assert manual['media']['imageUrls'][0].endswith('video-poster.jpg')
    page.evaluate('id=>window.__handler({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',manual['id'])
    # Metadata refresh should not overwrite the explicit user choice.
    page.evaluate('''() => window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{
      channel:'RemiInstagramDownloader:media',entries:[{code:'SLIDES',mediaId:'V02',
        imageUrls:[{url:'https://scontent.cdninstagram.com/video-poster.jpg',width:720}],
        videoUrls:[{url:'https://scontent.cdninstagram.com/real-video.mp4',width:720}]}]}}))''')
    page.wait_for_timeout(150)
    assert video.locator('.dl').get_attribute('aria-label')=='Download image from this media'
    photo.locator('.dl').click()
    neighboring=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert neighboring['preference']=='image'
    assert neighboring['media']['imageUrls'][0].endswith('stillphoto.jpg'), neighboring
    assert not neighboring['media']['videoUrls'],neighboring
    print('PASS: video IMG auto-classifies as video from matching metadata; photo with same shortcode stays image; explicit Image override is preserved')
    browser.close()
