/** userlens RUN 2단 — 실제 수집 풀플로우 체감 채집 */
import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9540',defaultViewport:null,protocolTimeout:0});
const p=(await b.pages()).find(x=>/index\.html/.test(x.url()));
const log=async()=>p.evaluate(()=>document.body.innerText.split('\n').filter(l=>/^\[/.test(l.trim())).slice(-4));

// 사용자처럼: 주소 붙여넣고, 옵션 보고, 시작
await p.evaluate(()=>{
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  const sp=document.getElementById('save-path'); if(sp){set.call(sp,'C:\\Users\\darli\\Downloads\\rc_qa'); sp.dispatchEvent(new Event('input',{bubbles:true}));}
  const i=document.getElementById('product-url');
  set.call(i,'https://brand.naver.com/braun/products/13726480753'); i.dispatchEvent(new Event('input',{bubbles:true}));
  const c=[...document.querySelectorAll('button,label,div')].find(e=>(e.textContent||'').trim()==='100개'); c&&c.click();
});
await sleep(800);
console.log('[3-입력후]', JSON.stringify(await p.evaluate(()=>({
  url:document.getElementById('product-url').value.slice(0,40),
  저장경로:document.getElementById('save-path').value,
  시작버튼disabled:document.getElementById('start-btn').disabled
}))));
await p.evaluate(()=>{const x=[...document.querySelectorAll('button')].find(e=>/수집 시작/.test(e.textContent||'')); x&&x.click();});
console.log('[4-시작클릭] 진행 관찰...');
for(let i=0;i<24;i++){
  await sleep(6000);
  const L=await log();
  console.log(`  ${(i+1)*6}s: ${L.slice(-1)[0]||''}`);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/크롤링이 완료|크롤링이 종료|\[오류\]|\[실패\]/.test(t)) { console.log('  --- 종료 ---'); break; }
}
console.log('[5-최종]', JSON.stringify(await log()));
await b.disconnect();
