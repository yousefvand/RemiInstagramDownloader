"""A sole blob: video can use a uniquely matching shortcode packet, but not ambiguous carousel data."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})", "attachShadow({mode:'open'})")
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1100,'height':750})
    page.set_content('''<article><a href="/reel/SOLO_REEL/"><video id="v" poster="https://scontent.fbcdn.net/opaque-poster.jpg" style="width:450px;height:420px"></video></a></article>''')
    page.evaluate('''() => {
      window.__starts=[];
      let seq=0;
      window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},
        runtime:{onMessage:{addListener:cb=>window.__remiListener=cb},sendMessage:async msg=>{window.__starts.push(msg);return {ok:true}}}};
      Object.defineProperty(document.querySelector('video'),'paused',{get:()=>false});
      Object.defineProperty(document.querySelector('video'),'ended',{get:()=>false});
      Object.defineProperty(document.querySelector('video'),'currentSrc',{get:()=> 'blob:https://www.instagram.com/placeholder'});
      window.postMessage = data=>{
        if(data.channel==='RemiInstagramDownloader:resolve')window.dispatchEvent(new MessageEvent('message',{
           source:window,origin:location.origin,data:{channel:'RemiInstagramDownloader:resolved',nonce:data.nonce}
        }));
      };
    }''')
    page.add_script_tag(content=JS)
    page.wait_for_function('''() => document.querySelector('#remi-instagram-downloader-host')?.shadowRoot?.querySelector('.widget')''')
    page.evaluate('''() => window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{
      channel:'RemiInstagramDownloader:media',entries:[
        {code:'SOLO_REEL',mediaId:'sole_media',videoUrls:[{url:'https://scontent.fbcdn.net/sole.mp4',width:640}],imageUrls:[]}
      ]}}))''')
    page.locator('#remi-instagram-downloader-host').locator('.dl').click()
    page.wait_for_function('''() => window.__starts.some(x=>x.type==='START')''')
    start=page.evaluate('window.__starts.find(x=>x.type==="START")')
    assert start['media']['videoUrls']==['https://scontent.fbcdn.net/sole.mp4'],start
    assert start['media']['playbackToken'],start
    print('PASS: blob video recovers uniquely identified Reel while retaining scoped playback token')
    browser.close()
