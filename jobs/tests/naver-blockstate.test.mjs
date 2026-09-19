/** ★「막힌 상태」 판정 검사 — 부재를 정상으로 읽지 않는지 «재는» 검사.
 *  waitForCaptchaIfNeeded는 page.evaluate로 도니, 가짜 page로 각 상태를 흉내낸다.
 */
import { readFileSync } from 'fs';
import { waitForCaptchaIfNeeded } from '../../electron/services/naver/naverTabActions.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

/** 지정한 상태를 돌려주는 가짜 page. states 배열을 순서대로 소비한다. */
function fakePage(states) {
  let i = 0;
  return {
    evaluate: async () => {
      const s = states[Math.min(i++, states.length - 1)];
      return { captcha: !!s.captcha, serviceUnavailable: !!s.outage, loginWall: !!s.login };
    },
    reload: async () => {},
  };
}

console.log('\n[B1] 정상 페이지는 «즉시» 통과한다 (회귀 방지)');
{
  const t0 = Date.now();
  const r = await waitForCaptchaIfNeeded(fakePage([{}]), null, 5000);
  ok(r === true, '정상 페이지 → true');
  ok(Date.now() - t0 < 2000, '지연 없이 통과 (' + (Date.now() - t0) + 'ms)');
}

console.log('\n[B2] ★로그인 벽을 «정상»으로 읽지 않는다');
{
  const logs = [];
  const r = await waitForCaptchaIfNeeded(fakePage([{ login: true }]), (m) => logs.push(m), 3000);
  ok(r === false, '로그인 벽이 안 풀리면 false (조용한 통과 없음)');
  ok(logs.some((m) => /로그인/.test(m)), '사용자에게 «로그인 필요»를 알린다');
  ok(!logs.some((m) => /회복/.test(m)), '⛔「회복」이라고 «말하지 않는다»');
}

console.log('\n[B3] 로그인을 마치면 이어서 진행한다');
{
  const logs = [];
  // 처음엔 로그인 벽 → 이후 정상
  const r = await waitForCaptchaIfNeeded(fakePage([{ login: true }, { login: true }, {}]), (m) => logs.push(m), 20000);
  ok(r === true, '로그인 완료 후 true');
  ok(logs.some((m) => /로그인 완료/.test(m)), '완료를 알린다');
}

console.log('\n[B4] ★장애 → 로그인으로 «바뀌는» 경로 (2026-09-19 실측 재현)');
{
  const logs = [];
  // 장애 페이지 → 새로고침 후 로그인 페이지 → 끝까지 로그인
  const r = await waitForCaptchaIfNeeded(fakePage([{ outage: true }, { login: true }]), (m) => logs.push(m), 4000);
  ok(r === false, '로그인 페이지로 바뀌면 통과시키지 않는다');
  ok(!logs.some((m) => /서비스 회복/.test(m)), '⛔로그인 화면을 「서비스 회복」이라 선언하지 않는다');
}

console.log('\n[B5] 판정은 «호스트»로 한다 — 쿼리스트링 오탐 없음');
{
  const src = readFileSync('electron/services/naver/naverTabActions.js', 'utf8');
  ok(/location\.hostname === 'nid\.naver\.com'/.test(src), 'hostname 기반 판정');
  ok(!/\/nid\\\.naver\\\.com\\\/\(nidlogin\|login\)\/\.test\(location\.href\)/.test(src), 'URL 전체 정규식 방식 아님');
}

console.log('\n[B6] 0건 안내가 «사유별»로 갈린다');
{
  const src = readFileSync('electron/services/naverService.js', 'utf8');
  const n = (src.match(/terminationReason === 'no_scroll_container'/g) || []).length;
  ok(n === 4, '리뷰·Q&A 4곳 전부 분기 (' + n + '곳)');
  ok(/로그인이나 보안확인 화면이었다면/.test(src), '로그인 가능성을 «지목»한다');
}

console.log('\n[B7] ★안쪽 메시지가 «원인을 단정»하지 않는다 (Codex 3차 지적)');
{
  const rev = readFileSync('electron/services/naver/naverPagination.js', 'utf8');
  const qna = readFileSync('electron/services/naver/naverQnAPagination.js', 'utf8');
  ok(!/화면 구조가 바뀌어 리뷰 목록을 스크롤할 수 없습니다 — 앱 업데이트가 필요합니다/.test(rev),
     '리뷰: 「구조 변경·앱 업데이트 필요」 단정 제거됨');
  ok(!/화면 구조가 바뀌어 Q&A 목록을 스크롤할 수 없습니다 — 앱 업데이트가 필요합니다/.test(qna),
     'Q&A: 같은 단정 제거됨');
  ok(/리뷰 목록을 화면에서 찾지 못했습니다/.test(rev), '리뷰: «본 것»만 말한다');
  ok(/Q&A 목록을 화면에서 찾지 못했습니다/.test(qna), 'Q&A: «본 것»만 말한다');
}

console.log('\n[B8] 타임아웃 문구가 «총 대기»임을 밝힌다 (예산 공유 지적)');
{
  const src = readFileSync('electron/services/naver/naverTabActions.js', 'utf8');
  ok(/총 \$\{mins\}분을 기다렸지만/.test(src), '「총 N분」으로 표기 — 새로 5분 준 것처럼 읽히지 않음');
  ok(/마지막까지/.test(src), '«마지막 상태»를 명시');
}

console.log('\n===== ' + pass + ' 통과 / ' + fail + ' 실패 =====');
process.exit(fail ? 1 : 0);
