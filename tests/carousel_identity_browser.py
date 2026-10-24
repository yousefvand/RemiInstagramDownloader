"""Regression: a shared carousel shortcode never licenses sibling video/audio URLs."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})", "attachShadow({mode:'open'})")

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1340,'height':760})
    page.set_default_timeout(5000)
    page.on('pageerror',lambda e:print('PAGEERROR',e,flush=True))
    page.set_content('''<main style="display:flex;gap:20px;padding:30px">
      <a href="/p/SHARED/" id="one"><img alt="first reel" src="https://scontent.cdninstagram.com/one-cover.jpg" style="width:320px;height:320px"></a>
      <a href="/p/SHARED/" id="two"><img alt="second reel" src="https://scontent.cdninstagram.com/two-cover.jpg" style="width:320px;height:320px"></a>
      <a href="/p/SHARED/" id="three"><img alt="still image" src="https://scontent.cdninstagram.com/photo-cover.jpg" style="width:320px;height:320px"></a>
    </main>''',wait_until='domcontentloaded')
    page.evaluate('''() => { window.__starts=[];window.__stored={};
      window.postMessage=data=>{if(data.channel==='RemiInstagramDownloader:resolve')window.dispatchEvent(new MessageEvent('message',{
        source:window,origin:location.origin,data:{channel:'RemiInstagramDownloader:resolved',nonce:data.nonce}
      }));};
      Object.defineProperty(window.crypto,'randomUUID',{value:()=>('testid'+Math.random().toString(36).slice(2).padEnd(13,'0'))});
      window.chrome={storage:{local:{get:async()=>({...window.__stored}),set:async data=>Object.assign(window.__stored,data)}},
        runtime:{onMessage:{addListener:fn=>window.__onMessage=fn},sendMessage:async msg=>{window.__starts.push(msg);return {ok:true}}}};
    }''')
    page.add_script_tag(content=JS)
    host=page.locator('#remi-instagram-downloader-host')
    host.locator('.widget').first.wait_for()
    assert host.locator('.widget:visible').count()==3
    page.evaluate('''() => window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{
      channel:'RemiInstagramDownloader:media',entries:[
        {code:'SHARED',mediaId:'MEDIA_ONE',videoUrls:[{url:'https://scontent.cdninstagram.com/one.mp4',width:720}],
          imageUrls:[{url:'https://scontent.cdninstagram.com/one-cover.jpg',width:720}],audioUrls:['https://scontent.cdninstagram.com/one.m4a']},
        {code:'SHARED',mediaId:'MEDIA_TWO',videoUrls:[{url:'https://scontent.cdninstagram.com/two.mp4',width:720}],
          imageUrls:[{url:'https://scontent.cdninstagram.com/two-cover.jpg',width:720}],audioUrls:['https://scontent.cdninstagram.com/two.m4a']}
      ]}}))''')
    page.wait_for_function('''() => Array.from(document.querySelector('#remi-instagram-downloader-host').shadowRoot.querySelectorAll('.dl')).slice(0,2).every(e=>e.ariaLabel==='Download video from this media')''')
    one,two,photo=[host.locator('.widget').nth(i) for i in range(3)]
    one.locator('.dl').click()
    try:
        page.wait_for_function('window.__starts.some(x=>x.type==="START")')
    except Exception:
        print('DEBUG',page.evaluate("""() => ({starts:window.__starts,
          widgets:[...document.querySelector('#remi-instagram-downloader-host').shadowRoot.querySelectorAll('.widget')].map(x=>x.querySelector('.message')?.textContent)
        })"""),flush=True)
        raise
    job=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert job['media']['videoUrls']==['https://scontent.cdninstagram.com/one.mp4'], job
    assert job['media']['audioUrls']==[], job
    assert job['media']['audioBinding']=='none'
    assert job['media']['pairedVideoUrls']==[]
    page.evaluate('id=>window.__onMessage({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',job['id'])
    two.locator('.dl').click()
    page.wait_for_function('window.__starts.filter(x=>x.type==="START").length>=2')
    job=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert job['media']['videoUrls']==['https://scontent.cdninstagram.com/two.mp4'], job
    assert job['media']['audioUrls']==[], job
    assert job['media']['audioBinding']=='none'
    assert job['media']['pairedVideoUrls']==[]
    page.evaluate('id=>window.__onMessage({from:"remi-background",id,type:"FINISH",state:"done",message:"Saved"})',job['id'])
    photo.locator('.dl').click()
    page.wait_for_function('window.__starts.filter(x=>x.type==="START").length>=3')
    job=page.evaluate('window.__starts.filter(x=>x.type==="START").at(-1)')
    assert job['preference']=='image' and not job['media']['videoUrls'] and not job['media']['audioUrls'],job
    print('PASS: 2 videos share a shortcode, but both resolve their own video without borrowing audio; the photo stays isolated')
    browser.close()
