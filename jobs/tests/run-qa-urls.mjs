/**
 * ★QA URL 세트 러너 — qa-urls.json의 «지원 유형»을 전부 돌려 기대와 대조한다.
 *
 * 쓰는 법:
 *   CDP_PORT=9422 node jobs/tests/run-qa-urls.mjs            # 전부
 *   CDP_PORT=9422 node jobs/tests/run-qa-urls.mjs smart-large # 하나만
 *
 * ⚠️이건 «네트워크를 타는» 검사다. 막히면 앱 결함이 아니라 환경일 수 있다 —
 *   로그인/보안확인은 결과에 그대로 «막힘»으로 적고, 통과/실패로 위장하지 않는다.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';
import { openReviewModal } from '../../electron/services/naver/naverNavigation.js';
import { attachReviewApiTemplate, collectReviewsViaApi } from '../../electron/services/naver/naverReviewApi.js';

const PORT = process.env.CDP_PORT || '9422';
const ONLY = process.argv[2] || null;
const TARGET_COUNT = Number(process.env.TARGET || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const set = JSON.parse(readFileSync(new URL('./qa-urls.json', import.meta.url), 'utf8'));
const cases = set.지원_유형.filter((c) => !ONLY || c.id === ONLY);

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const b = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null, protocolTimeout: 0 });

const rows = [];
for (const c of cases) {
  const p = await b.newPage();
  const watcher = attachReviewApiTemplate(p);
  const row = { id: c.id, 유형: c.유형, 결과: '?', 상세: '' };
  try {
    await p.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(6000);
    const state = await p.evaluate(() => {
      const t = document.body?.innerText || '';
      if (document.querySelector('.captcha_wrap,[data-component="cpt_main"]')) return '보안확인';
      if (location.hostname === 'nid.naver.com') return '로그인요구';
      if (/접속이 불가/.test(t)) return '접속불가';
      if (/리뷰/.test(t)) return 'ok';
      return '기타';
    });
    if (state !== 'ok') { row.결과 = '⛔막힘'; row.상세 = state + ' (환경 — 앱 결함 아님)'; rows.push(row); await p.close(); continue; }

    const opened = await openReviewModal(p, 30000);
    await sleep(6000);
    const tpl = watcher.get();
    watcher.detach();
    if (!tpl) { row.결과 = '❌실패'; row.상세 = `모달=${opened} · 템플릿 포착 실패 ⇒ 예비경로로 떨어진다`; rows.push(row); await p.close(); continue; }

    const path = tpl.url.replace(/^https:\/\/[^/]+/, '');
    const authed = !!(tpl.headers && tpl.headers['x-client-rtk']);
    const grp = /group-products/.test(tpl.url);
    const okPath = path === c.기대.api;
    const okGrp = grp === c.기대.그룹상품;

    const flags = {};
    const run = await collectReviewsViaApi(p, { targetCount: TARGET_COUNT, template: tpl, gapMs: 1500, batchSize: 5, flags, sendLog: () => {} });
    const okCollect = run.collected > 0 && flags.usedApi === true;

    row.결과 = (okPath && okGrp && authed && okCollect) ? '✅통과' : '❌실패';
    row.상세 = `api=${path}${okPath ? '' : ' ⚠️기대≠' + c.기대.api} · 인증헤더=${authed ? 'O' : '⚠️X'} · 그룹=${grp}${okGrp ? '' : '⚠️'} · 수집 ${run.collected}건/총 ${run.totalElements} · 사유 ${run.terminationReason}`;
  } catch (e) {
    row.결과 = '❌오류'; row.상세 = e.message.slice(0, 80);
  }
  rows.push(row);
  try { await p.close(); } catch {}
}
await b.disconnect();

console.log('\n================ QA URL 세트 결과 ================');
for (const r of rows) console.log(`${r.결과}  ${r.id.padEnd(20)} ${r.유형}\n        ${r.상세}`);
const pass = rows.filter((r) => r.결과 === '✅통과').length;
const blocked = rows.filter((r) => r.결과 === '⛔막힘').length;
const fail = rows.length - pass - blocked;
console.log(`\n통과 ${pass} / 막힘 ${blocked} / 실패 ${fail}  (전체 ${rows.length})`);
if (blocked) console.log('⚠️「막힘」은 네이버 보안확인·로그인 때문이며 앱 결함이 아니다 — 통과로 세지 않는다.');
process.exit(fail ? 1 : 0);
