"""Isolated Chromium integration: blob-backed Reel resolved from /api/v1/media/{PK}/info/.
This uses synthetic Instagram markup and a stubbed API, not Instagram's live service.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
VIDEO='https://video.cdninstagram.com/this_reel.mp4'
DASH='<MPD><Period><AdaptationSet contentType="video"><Representation><BaseURL>https://video.cdninstagram.com/this_reel.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation><BaseURL>https://audio.cdninstagram.com/this_reel.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>'
def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':980,'height':840})
        page.route('https://**/*',lambda route: route.abort())
        page.set_content('''<html><body><article><a href="/reel/REELabc4/"><video playsinline muted poster="https://scontent.cdninstagram.com/a-different-poster.jpg" style="width:500px;height:600px"></video></a></article></body></html>''',wait_until='domcontentloaded')
        page.evaluate('''() => {
          window.__sent=[];window.__requested=[];
          Object.defineProperty(window.crypto,'randomUUID',{value:()=>('testid'+Math.random().toString(36).slice(2).padEnd(13,'0'))});
          window.fetch=async function(url,opts){
            window.__requested.push({url:String(url),headers:opts?.headers||{}});
            if(String(url).includes('/api/v1/media/'))return new Response(JSON.stringify({items:[{
              code:'REELabc4',pk:'1000123456789',video_versions:[{url:'https://video.cdninstagram.com/this_reel.mp4',width:1080}],
              image_versions2:{candidates:[{url:'https://scontent.cdninstagram.com/completely-different-metadata-cover.jpg',width:1080}]},
              video_dash_manifest:'<MPD><Period><AdaptationSet contentType="video"><Representation><BaseURL>https://video.cdninstagram.com/this_reel.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation><BaseURL>https://audio.cdninstagram.com/this_reel.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>'
            }]}),{status:200,headers:{'Content-Type':'application/json'}});
            return new Response('rejected',{status:404});
          };
          window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{onMessage:{addListener:()=>{}},sendMessage:async msg=>{window.__sent.push(msg);return {ok:true};}}};
        }''')
        observer=(ROOT/'page-observer.js').read_text().replace('location.origin','"*"').replace('event.origin!=="*"','false').replace('event.origin==="*"','true')
        page.add_script_tag(content=observer)
        content=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})","attachShadow({mode:'open'})").replace('location.origin','"*"').replace('event.origin!=="*"','false').replace('event.origin==="*"','true')
        page.add_script_tag(content=content)
        dl=page.locator('#remi-instagram-downloader-host .widget .dl').first
        dl.wait_for(timeout=7000)
        dl.click()
        try:
            page.wait_for_function("window.__sent.some(x=>x.type==='START')",timeout=7000)
        except Exception:
            print('DEBUG',page.evaluate("() => ({requested:window.__requested,sent:window.__sent,ui:[...document.querySelectorAll('#remi-instagram-downloader-host')].map(e=>e.shadowRoot?.querySelector('.message')?.textContent)})"))
            raise
        data=page.evaluate('window.__sent.find(x=>x.type==="START")')
        assert data['media']['videoUrls']==[VIDEO],data['media']
        assert data['media']['audioBinding']=='same-manifest',data['media']
        assert 'this_reel.m4a' in data['media']['dash'],data['media']
        assert page.evaluate("window.__requested.some(r=>r.url.startsWith('/api/v1/media/'))")
        browser.close()
        print('PASS browser: exact post media-info resolves blob player despite nonmatching poster, no shared stream inference')
if __name__=='__main__':main()
