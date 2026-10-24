"""Former stream-chooser regression, now checks that quality settings alone
start a download without a picker or paused state."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def main():
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1150,'height':900})
    page.set_content('''<article style="display:flex;gap:20px;margin:50px">
      <a href="/reel/ITEMA"><video src="https://scontent.cdninstagram.com/itemA.mp4" poster="https://scontent.cdninstagram.com/A.jpg" style="width:300px;height:310px"></video></a>
      <a href="/reel/ITEMB"><video src="https://scontent.cdninstagram.com/itemB.mp4" poster="https://scontent.cdninstagram.com/B.jpg" style="width:300px;height:310px"></video></a>
    </article>''')
    page.evaluate('''() => {
      window.sent=[];
      Object.defineProperty(window.crypto,'randomUUID',{value:()=>('uid'+Math.random().toString(36).slice(2).padEnd(15,'0'))});
      window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{
        onMessage:{addListener:f=>window.receive=f},sendMessage:async m=>{window.sent.push(m);return {ok:true}}}};
    }''')
    page.add_script_tag(content=(ROOT/'content.js').read_text().replace("attachShadow({mode:'closed'})","attachShadow({mode:'open'})"))
    host=page.locator('#remi-instagram-downloader-host')
    a=host.locator('.widget').nth(0)
    b=host.locator('.widget').nth(1)
    assert a.locator('.buttons button').count()==2
    assert b.locator('.buttons button').count()==2
    assert a.locator('.stream-choices').count()==0,'manual picker removed'
    a.locator('.dots').click()
    a.locator('[data-setting="videoQuality"]').select_option('small')
    a.locator('[data-setting="videoSound"]').select_option('no')
    a.locator('.dl').click()
    page.wait_for_function('window.sent.some(m=>m.type==="START")',timeout=10000)
    job=page.evaluate('window.sent.find(m=>m.type==="START")')
    assert job['config']['videoQuality']=='small',job
    assert job['config']['videoSound']=='no'
    assert a.locator('.menu').is_hidden()
    assert a.locator('.progress').is_visible()
    assert a.locator('.cancel').is_visible()
    assert b.locator('[data-setting="videoQuality"]').input_value()=='best'
    assert not page.evaluate('window.sent.some(m=>m.type==="SELECT_STREAM")')
    page.evaluate('id=>window.receive({from:"remi-background",type:"PROGRESS",id,percent:50,message:"Fetching video..."})',job['id'])
    assert a.locator('.percent').inner_text()=='50%'
    assert a.locator('.menu').is_hidden()
    a.locator('.cancel').click()
    assert page.evaluate('window.sent.at(-1).type')=='CANCEL'
    print('PASS: selected quality drives Download without a stream picker; other media keeps defaults; progress and Cancel remain')
    browser.close()

if __name__=='__main__':main()
