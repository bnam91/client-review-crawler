/** ★Evaluator 지적분을 «재는» 검사 — 지적한 자리마다 검사를 같이 둔다. */
import { readFileSync } from 'fs';
import { attachReviewApiTemplate, collectReviewsViaApi } from '../../electron/services/naver/naverReviewApi.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('\n[T5] 헤더 «값» 안전성 — CR/LF/NUL은 fetch를 던지게 만든다');
{
  const h = []; const fp = { on: (_e, x) => h.push(x), off: () => {} };
  const w = attachReviewApiTemplate(fp);
  const NL = String.fromCharCode(10);
  const NUL = String.fromCharCode(0);
  h[0]({
    url: () => 'https://smartstore.naver.com/i/v1/contents/reviews/query-pages',
    method: () => 'POST',
    postData: () => JSON.stringify({ page: 1, pageSize: 20 }),
    headers: () => ({
      'x-client-rtk': 't21:OK',
      'x-bad': 'AAA' + NL + 'BBB',
      'x-nul': 'a' + NUL + 'b',
      'sec-ch-ua': '"Chrome"',
      'dnt': '1',
      'via': 'x',
    }),
  });
  const t = w.get();
  ok(!('x-bad' in t.headers), '개행 든 헤더값 제외됨');
  ok(!('x-nul' in t.headers), 'NUL 든 헤더값 제외됨');
  ok(!('sec-ch-ua' in t.headers), 'sec- 접두 전체 제외됨');
  ok(!('dnt' in t.headers) && !('via' in t.headers), 'dnt/via 제외됨');
  ok(t.headers['x-client-rtk'] === 't21:OK', '정상 인증헤더는 살아남음');
}

console.log('\n[T6] 갱신 «성공» 시 예산 리셋 — 대형 상품이 4번째 429에서 죽지 않는가');
{
  const TOK = 't21:FRESH';
  let refreshes = 0, gen = 0, aliveUntil = 60;   // 60페이지마다 토큰이 늙는 상품
  const sim = {
    evaluate: async (_fn, tpl, _gap, start, end) => {
      const rows = []; let rateLimitedAt = null; let meta = null;
      for (let p = start; p <= end; p++) {
        const fresh = tpl.headers && tpl.headers['x-client-rtk'] === (TOK + gen);
        if (!fresh || p > aliveUntil) { rateLimitedAt = p; break; }
        if (!meta) meta = { totalElements: 6000, totalPages: 300, size: 20 };
        for (let i = 0; i < 20; i++) rows.push({ id: p + '-' + i, reviewScore: '5', reviewerName: 'a', reviewDate: 'd', content: 'c', reviewType: '일반리뷰', photoUrls: [] });
      }
      return { rows, problems: [], meta, rateLimitedAt, stoppedAt: null, nextPage: end + 1 };
    },
  };
  const body = JSON.stringify({ page: 1, pageSize: 20, reviewSearchSortType: 'REVIEW_LATEST' });
  const run = await collectReviewsViaApi(sim, {
    targetCount: Infinity,
    template: { url: 'u', method: 'POST', postData: body, headers: { 'x-client-rtk': TOK + '0' } },
    gapMs: 0, batchSize: 10, backoffMs: [5],
    refreshTemplate: async () => {
      refreshes++; gen++; aliveUntil += 60;
      return { url: 'u', method: 'POST', postData: body, headers: { 'x-client-rtk': TOK + gen } };
    },
    sendLog: () => {},
  });
  ok(refreshes > 3, '갱신이 4회 넘게 가능 (' + refreshes + '회) — 런 전체 예산 3에 안 갇힘');
  ok(run.collected === 6000, '대형 상품 전량 수집 (' + run.collected + '/6000)');
  ok(run.complete === true, 'complete=true');
}

console.log('\n[T7] 갱신이 «해법»으로 판명되면 사다리를 줄이는가');
{
  const src = readFileSync('electron/services/naver/naverReviewApi.js', 'utf8');
  ok(/refreshIsTheRemedy/.test(src) && /backoffMs\.slice\(0, 1\)/.test(src), '사다리 단축 로직 존재');
  ok(/templateRefreshTotal < maxTemplateRefreshTotal/.test(src), '총량 절대상한 가드 존재');
  ok(/templateRefreshCount = 0;/.test(src), '회복 시 연속실패 예산 리셋');
}

console.log('\n[T8] 갱신기 계약 — 캡차 대기·원본 URL·watcher 해제·사용자 통지');
{
  const src = readFileSync('electron/services/naverService.js', 'utf8');
  ok(/waitForCaptchaIfNeeded\(page, sendLog\)/.test(src), '재진입 «전»에 캡차를 기다린다');
  ok(/url: originalTemplate\.url/.test(src), 'URL은 원본 고정 (쿼리 뒤섞임 방지)');
  ok(/finally \{[\s\S]{0,200}watcher\?\.detach\(\)/.test(src), 'watcher를 finally에서 해제');
  ok(/네이버 확인 화면/.test(src), '캡차 실패를 «사용자에게» 알린다');
  ok(!/if \(scrollFlags\.usedApi\) \{\s*\n\s*sendLog\(`\[안내\] 잠시\(5~10분\)[\s\S]{0,80}\} else \{\s*\n\s*\/\/ ★2026-09-18/.test(src), '도달 불가 분기 제거됨');
}

console.log('\n===== ' + pass + ' 통과 / ' + fail + ' 실패 =====');
process.exit(fail ? 1 : 0);
