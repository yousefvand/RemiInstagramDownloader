"""Regression: two stream variants from one player must auto-download at
its chosen resolution without a stream picker, with audio intact."""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def run():
    low=base64.b64encode((ROOT/'tests/quality_low.mp4').read_bytes()).decode()
    high=base64.b64encode((ROOT/'tests/quality_high.mp4').read_bytes()).decode()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page()
        page.set_content('<body></body>')
        page.evaluate('''({low,high}) => {
          const bytes=b64=>Uint8Array.from(atob(b64),x=>x.charCodeAt(0));
          const files={
            'https://cdn.fbcdn.net/item_high.mp4':bytes(high),
            'https://cdn.fbcdn.net/item_low.mp4':bytes(low)
          };
          const originalFetch=window.fetch.bind(window);
          window.fetch=async (url,opts)=>{
            if(String(url).startsWith('blob:'))return originalFetch(url,opts);
            const body=files[String(url)];
            if(!body)throw Error('Invalid media fetch: '+url);
            return new Response(body,{status:200,headers:{'content-type':'video/mp4','content-length':String(body.length)}});
          };
          window.__saved=[];window.__fail=[];
          window.chrome={runtime:{onMessage:{addListener(fn){window.__handler=fn;}},
            async sendMessage(msg){
              if(msg.type==='FAIL'){window.__fail.push(msg.error);return {ok:true};}
              if(msg.type==='SAVE'){
                const blob=await originalFetch(msg.url).then(r=>r.blob());
                window.__saved.push({id:msg.id,size:blob.size,base64: await new Promise(resolve=>{
                  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);
                  reader.readAsDataURL(blob);
                })});
              }
              return {ok:true};
            }} };
        }''',{'low':low,'high':high})
        page.add_script_tag(content=(ROOT/'offscreen.js').read_text())
        for i,(quality,expected_size) in enumerate([('best',len(base64.b64decode(high))),('small',len(base64.b64decode(low))),('balanced',len(base64.b64decode(low)))],1):
            id=f'quality_{quality}_{i}'
            page.evaluate('''({id,quality})=>window.__handler({to:'remi-offscreen',type:'PROCESS',id,
              preference:'video',config:{videoQuality:quality,videoSound:'yes'},
              media:{code:'VID',probeVideoQuality:true,videoUrls:[
                'https://cdn.fbcdn.net/item_low.mp4','https://cdn.fbcdn.net/item_high.mp4'],
                audioUrls:[],imageUrls:[]}}, {}, ()=>{})''',{'id':id,'quality':quality})
            page.wait_for_function('(id)=>window.__saved.some(s=>s.id===id)||window.__fail.length>0',arg=id,timeout=25000)
            fail=page.evaluate('window.__fail')
            assert not fail,fail
            selected=page.evaluate('(id)=>window.__saved.find(s=>s.id===id).size',id)
            assert selected==expected_size,(quality,selected,expected_size)
        print('PASS: Highest / Balanced / Smaller auto-select decoded resolution; no selection pause; sound preserved')
        browser.close()
if __name__=='__main__':run()
