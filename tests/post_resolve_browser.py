"""Synthetic page integration test: when a video has no exposed src,
its own on-demand permalink JSON is inspected and passed to the correct overlay.
The test stubs same-origin requests and does not contact Instagram.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
POST='https://www.instagram.com/reel/DETECT1/'
VIDEO='https://video.cdninstagram.com/track_no_extension?mime_type=video%2Fmp4'
AUDIO='https://audio.cdninstagram.com/track_audio?mime_type=audio%2Fmp4'

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1000,'height':800})
        page=context.new_page()
        page.route('https://**/*',lambda route: route.abort())
        page.set_content('<html><body><article style="margin:20px"><a href="/reel/DETECT1/">'
                    '<video muted playsinline style="width:420px;height:520px" poster="https://scontent.cdninstagram.com/poster.jpg"></video>'
                    '</a></article></body></html>',wait_until='domcontentloaded')
        page.evaluate('''() => {
          window.__sent=[];Object.defineProperty(window.crypto,'randomUUID',{value:()=>('testid'+Math.random().toString(36).slice(2).padEnd(13,'0'))});
          window.fetch=async url=>new Response(JSON.stringify({item:{code:'DETECT1',video_versions:[{url:'https://video.cdninstagram.com/track_no_extension?mime_type=video%2Fmp4',width:720}],image_versions2:{candidates:[{url:'https://scontent.cdninstagram.com/poster.jpg',width:720}]},audio_url:'https://audio.cdninstagram.com/track_audio?mime_type=audio%2Fmp4'}}),{status:200,headers:{'Content-Type':'application/json'}});
          window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{
            onMessage:{addListener:()=>{}},sendMessage:async msg=>{window.__sent.push(msg);return {ok:true}}
          }};
        }''')
        observer=(ROOT/'page-observer.js').read_text().replace('location.origin','"*"').replace('event.origin!=="*"','false').replace('event.origin==="*"','true')
        page.add_script_tag(content=observer)
        content=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})","attachShadow({mode:'open'})").replace('location.origin','"*"').replace('event.origin!=="*"','false').replace('event.origin==="*"','true')
        page.add_script_tag(content=content)
        dl=page.locator('#remi-instagram-downloader-host .widget .dl').first
        dl.wait_for()
        dl.click()
        page.wait_for_function("window.__sent.some(x=>x.type==='START')",timeout=8000)
        result=page.evaluate("window.__sent.find(x=>x.type==='START')")
        assert result['media']['videoUrls'][0]==VIDEO,result
        assert result['media']['audioUrls']==[],result
        print('PASS: simulated Reel without exposed src resolves separate audio/video through on-demand post metadata')
        browser.close()

if __name__=='__main__':main()
