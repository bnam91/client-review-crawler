/** ★2차 검수(Codex) 지적분을 «재는» 검사. */
import { readFileSync } from 'fs';
import { attachReviewApiTemplate, collectReviewsViaApi } from '../../electron/services/naver/naverReviewApi.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('\n[T9] 헤더 «이름» 토큰 규칙 — fetch가 «동기»로 던지면 안전망을 못 탄다');
{
  const h = []; const fp = { on: (_e, x) => h.push(x), off: () => {} };
  const w = attachReviewApiTemplate(fp);
  h[0]({
    url: () => 'https://smartstore.naver.com/i/v1/contents/reviews/query-pages',
    method: () => 'POST',
    postData: () => JSON.stringify({ page: 1, pageSize: 20 }),
    headers: () => ({
      'x-client-rtk': 't21:OK',
      'x client': 'space',        // 공백 = 토큰 규칙 위반
      'bad(name)': 'paren',       // 괄호 = 구분자
      'x-ok_name.1': 'fine',      // tchar 안에 드는 문자들
    }),
  });
  const t = w.get();
  ok(!('x client' in t.headers), '공백 든 헤더 이름 제외됨');
  ok(!('bad(name)' in t.headers), '구분자 든 헤더 이름 제외됨');
  ok(t.headers['x-ok_name.1'] === 'fine', '정상 tchar 이름은 살아남음');
  ok(t.headers['x-client-rtk'] === 't21:OK', '인증헤더 보존');
}

console.log('\n[T10] 사다리 단축이 «되돌아오는가» — 한 런 안에서 429 성격이 바뀔 수 있다');
{
  const src = readFileSync('electron/services/naver/naverReviewApi.js', 'utf8');
  // «대기»로 회복한 자리에서 refreshIsTheRemedy가 false로 돌아가야 한다
  const waitRecovery = src.slice(src.indexOf('속도제한에서 회복') - 400, src.indexOf('속도제한에서 회복'));
  ok(/refreshIsTheRemedy = false/.test(waitRecovery), '대기로 회복하면 사다리 단축이 해제됨');
  ok(/refreshIsTheRemedy = true/.test(src), '갱신으로 회복하면 단축이 켜짐');
}

console.log('\n[T11] 런이 «끝나긴 하는가» — 전진 불변식');
{
  // 매 429마다 갱신이 성공하지만 1페이지씩만 나아가는 최악 시나리오
  let gen = 0, refreshes = 0;
  const sim = {
    evaluate: async (_fn, tpl, _g, start) => {
      const fresh = tpl.headers && tpl.headers['x-client-rtk'] === ('t' + gen);
      if (!fresh) return { rows: [], problems: [], meta: null, rateLimitedAt: start, stoppedAt: null, nextPage: start };
      const rows = [];
      for (let i = 0; i < 20; i++) rows.push({ id: start + '-' + i, reviewScore: '5', reviewerName: 'a', reviewDate: 'd', content: 'c', reviewType: '일반리뷰', photoUrls: [] });
      gen++;  // 한 페이지 받고 나면 토큰이 곧바로 늙는다 (최악)
      return { rows, problems: [], meta: { totalElements: 200, totalPages: 10, size: 20 }, rateLimitedAt: null, stoppedAt: null, nextPage: start + 1 };
    },
  };
  const body = JSON.stringify({ page: 1, pageSize: 20 });
  const t0 = Date.now();
  const run = await collectReviewsViaApi(sim, {
    targetCount: Infinity,
    template: { url: 'u', method: 'POST', postData: body, headers: { 'x-client-rtk': 't0' } },
    gapMs: 0, batchSize: 1, backoffMs: [1],
    refreshTemplate: async () => { refreshes++; return { url: 'u', method: 'POST', postData: body, headers: { 'x-client-rtk': 't' + gen } }; },
    sendLog: () => {},
  });
  ok(Date.now() - t0 < 20000, '최악 시나리오에서도 유한 시간에 끝남 (무한루프 없음)');
  ok(run.collected > 0, '진전이 있었다 (' + run.collected + '건)');
  ok(typeof run.terminationReason === 'string', '종료 사유가 남는다 (' + run.terminationReason + ')');
}

console.log('\n===== ' + pass + ' 통과 / ' + fail + ' 실패 =====');
process.exit(fail ? 1 : 0);
