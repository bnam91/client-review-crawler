/** ★네트워크 없이 «바뀐 로직»만 시험한다. 가짜 page로 네이버 동작을 흉내낸다. */
import { attachReviewApiTemplate, collectReviewsViaApi } from '../../electron/services/naver/naverReviewApi.js';
let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++,console.log('  ✅ '+m)):(fail++,console.log('  ❌ '+m)); };

// ── T1: 포착기가 스마트스토어 URL + 헤더를 잡는가
console.log('\n[T1] 템플릿 포착 (URL 확장 + 헤더 승계)');
const handlers=[];
const fakePage={ on:(_e,h)=>handlers.push(h), off:()=>{} };
const w=attachReviewApiTemplate(fakePage);
const mkReq=(url,hdrs)=>({url:()=>url, method:()=>'POST',
  postData:()=>JSON.stringify({checkoutMerchantNo:1,originProductNo:2,page:1,pageSize:20,reviewSearchSortType:'REVIEW_LATEST'}),
  headers:()=>hdrs});
handlers[0](mkReq('https://smartstore.naver.com/i/v1/contents/reviews/query-pages',
  {'x-client-rtk':'t21:TOKEN','x-client-rts':'123','content-type':'application/json',
   'cookie':'SECRET=1','user-agent':'UA','referer':'R',':authority':'smartstore.naver.com','content-length':'99'}));
const t=w.get();
ok(!!t,'스마트스토어(/i/v1/) 포착됨');
ok(t && t.headers && t.headers['x-client-rtk']==='t21:TOKEN','x-client-rtk 승계됨');
ok(t && !('cookie' in t.headers),'cookie 제외됨');
ok(t && !('user-agent' in t.headers),'user-agent 제외됨');
ok(t && !('referer' in t.headers),'referer 제외됨');
ok(t && !(':authority' in t.headers),'HTTP/2 의사헤더 제외됨');
ok(t && !('content-length' in t.headers),'content-length 제외됨');
ok(JSON.stringify(t.headers)===JSON.stringify(JSON.parse(JSON.stringify(t.headers))),'headers가 구조화복제 가능');

// ── T2: 다른 리뷰 API가 템플릿을 «덮어쓰지» 않는가 (포착기는 마지막 요청을 유지한다)
console.log('\n[T2] 오탐 방지');
handlers[0](mkReq('https://smartstore.naver.com/i/v1/contents/reviews/product-summary/123',{'content-type':'application/json'}));
ok(w.get().url.includes('query-pages'),'product-summary가 템플릿을 덮어쓰지 않음');
handlers[0](mkReq('https://smartstore.naver.com/i/v1/contents/reviews/summary-tag/123',{'content-type':'application/json'}));
ok(w.get().url.includes('query-pages'),'summary-tag가 템플릿을 덮어쓰지 않음');

// ── T2b: 본문 «모양» 가드 (Codex MINOR-1 대응) — page/pageSize 없는 요청은 템플릿으로 안 받는다
console.log('\n[T2b] 본문 모양 가드');
const h2=[]; const fp2={on:(_e,h)=>h2.push(h), off:()=>{}};
const w2=attachReviewApiTemplate(fp2);
const mkReq2=(url,body)=>({url:()=>url,method:()=>'POST',postData:()=>JSON.stringify(body),headers:()=>({'content-type':'application/json'})});
h2[0](mkReq2('https://smartstore.naver.com/x/v1/contents/reviews/query-pages',{userInfoValues:[]}));
ok(w2.get()===null,'page/pageSize 없는 요청은 템플릿으로 안 잡힘');
h2[0](mkReq2('https://smartstore.naver.com/i/v1/contents/reviews/query-pages',{page:1,pageSize:20}));
ok(!!w2.get(),'정상 페이징 요청은 잡힘');
h2[0](mkReq2('https://smartstore.naver.com/i/v1/contents/reviews/query-pages',{notAPagingBody:true}));
ok(w2.get() && JSON.parse(w2.get().postData).page===1,'이상한 본문이 정상 템플릿을 덮어쓰지 않음');

// ── T3: 429 → 토큰 갱신 → 회복. 그리고 «정렬(postData)»이 보존되는가
console.log('\n[T3] 429 → 토큰 갱신 → 이어받기');
const GOOD='t21:FRESH';
let refreshCalls=0, seenPostData=[];
const simPage={
  evaluate: async (fn, tpl, gap, start, end) => {
    const rows=[]; let rateLimitedAt=null; let meta=null;
    seenPostData.push(tpl.postData);
    for(let p=start;p<=end;p++){
      const tokenOk = tpl.headers && tpl.headers['x-client-rtk']===GOOD;
      if(!tokenOk){ rateLimitedAt=p; break; }        // 토큰 늙으면 429
      if(!meta) meta={totalElements:60,totalPages:3,size:20};
      for(let i=0;i<20;i++) rows.push({id:`${p}-${i}`,reviewScore:'5',reviewerName:'a',reviewDate:'2026-01-01',content:'c',reviewType:'일반리뷰',photoUrls:[]});
    }
    return { rows, problems:[], meta, rateLimitedAt, stoppedAt:null, nextPage:end+1 };
  },
};
const ORIG_SORT=JSON.stringify({checkoutMerchantNo:1,originProductNo:2,page:1,pageSize:20,reviewSearchSortType:'REVIEW_LATEST'});
const staleTpl={url:'https://smartstore.naver.com/i/v1/contents/reviews/query-pages',method:'POST',postData:ORIG_SORT,headers:{'x-client-rtk':'t21:OLD'}};
const run=await collectReviewsViaApi(simPage,{
  targetCount:Infinity, template:staleTpl, gapMs:0, batchSize:3, backoffMs:[10,10],
  refreshTemplate: async ()=>{ refreshCalls++;
    return {url:staleTpl.url, method:'POST', headers:{'x-client-rtk':GOOD},
            postData:ORIG_SORT};            // ★정렬은 원본 유지가 계약
  },
  sendLog:()=>{},
});
ok(refreshCalls>0,`토큰 갱신이 실제로 호출됨 (${refreshCalls}회)`);
ok(run.collected===60,`갱신 후 전량 수집됨 (${run.collected}/60)`);
ok(run.complete===true,`complete=true (사유 ${run.terminationReason})`);
ok(seenPostData.every(s=>JSON.parse(s).reviewSearchSortType==='REVIEW_LATEST'),'모든 요청이 «사용자 정렬»을 유지함');
ok(run.rateEvents.some(e=>e.recoveredBy==='template-refresh'),'회복 경로가 rateEvents에 기록됨');

// ── T4: 갱신기가 null을 주면 «조용한 성공»이 아니라 부분수집으로 끝나는가
console.log('\n[T4] 갱신 실패 시 정직성');
const run2=await collectReviewsViaApi(simPage,{
  targetCount:Infinity, template:{...staleTpl}, gapMs:0, batchSize:3, backoffMs:[10],
  refreshTemplate: async ()=>null, sendLog:()=>{},
});
ok(run2.complete===false,'complete=false 로 끝남');
ok(run2.terminationReason==='api_rate_limited',`사유=${run2.terminationReason}`);
ok(run2.collected===0,`부분수집(${run2.collected}건)을 성공으로 위장하지 않음`);

console.log(`\n===== ${pass} 통과 / ${fail} 실패 =====`);
process.exit(fail?1:0);
