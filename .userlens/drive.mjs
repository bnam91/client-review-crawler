/** userlens RUN — 사용자로서 풀플로우 주행. ★defaultViewport:null 필수. */
import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9540',defaultViewport:null,protocolTimeout:0});
const p=(await b.pages()).find(x=>/index\.html/.test(x.url()));
const snap=async(label)=>{
  const s=await p.evaluate(()=>{
    const ov=document.getElementById('license-overlay');
    const vis=e=>e&&e.getBoundingClientRect().width>0;
    return {
      창:[window.innerWidth,window.innerHeight],
      문서채움: window.innerHeight-document.body.clientHeight===0,
      가로스크롤: document.documentElement.scrollWidth>window.innerWidth+1,
      세로스크롤: document.documentElement.scrollHeight>window.innerHeight+1,
      라이선스창: ov? getComputedStyle(ov).display!=='none' : false,
      잘린요소: [...document.querySelectorAll('button,input,select,.license-box')].filter(vis)
        .filter(e=>{const r=e.getBoundingClientRect(); return r.right>window.innerWidth+1||r.left<-1||r.bottom>window.innerHeight+1&&getComputedStyle(e).position==='fixed'})
        .map(e=>(e.id||e.className||e.tagName).toString().slice(0,24)).slice(0,6),
      시작버튼: (()=>{const x=document.getElementById('start-btn'); return x?{보임:vis(x),disabled:x.disabled}:null})(),
      로그끝: document.body.innerText.split('\n').filter(l=>/^\[/.test(l.trim())).slice(-2),
    };
  });
  console.log(`\n[${label}] ${JSON.stringify(s)}`);
  return s;
};
await snap('1-첫대면');
// 라이선스 창 닫지 않고 그대로 — 사용자는 등록키가 없을 수 있다
await snap('2-라이선스화면');
await b.disconnect();
