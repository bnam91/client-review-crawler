/**
 * 네이버 리뷰 «내부 API 직접 페이징» 수집기
 *
 * 왜 이게 필요한가 (2026-08-15 실측):
 *  - 모달 무한 스크롤은 li가 쌓일수록 «구조적으로» 느려진다. 실측 청크1 4.84건/s → 청크6 0.18건/s (27배 감속).
 *    11,737건 상품에서 47분을 돌고도 3,920건(33%)에서 상한으로 끊겼다 → 완주가 불가능한 방식이다.
 *  - 같은 상품을 query-pages API 직접 페이징으로 돌리면 11,752/11,752 (100%), 1,773초, 6.63건/s로 «전량 완주»했다.
 *
 * ★429의 구조 (실측):
 *  - 429는 «정확히 99페이지 간격»으로 발생했다(p152, p251, p350, p449, p585).
 *  - 요청 간격을 0.7초 → 2초로 3배 늦춰도 «막히는 자리는 같았다» ⇒ 속도가 원인이 아니다.
 *  - 전부 30초+60초(총 90초) 대기 후 «같은 페이지» 재요청으로 회복됐다. Retry-After 헤더는 없다.
 *  ⇒ 구조 = 「약 100페이지마다 예산 소진 → 90초쯤 기다리면 회복」
 *  ⇒ 대책은 «속도 낮추기»가 아니라 «대기 후 이어받기»다. 속도만 낮추면 152페이지에서 죽는다.
 *
 * ★설계 제약:
 *  - 한 번의 page.evaluate를 길게 잡으면 puppeteer protocolTimeout(기본 180초)에 걸린다(실측으로 물림).
 *    → ⑴페이징을 배치(기본 25페이지)로 쪼개고 ⑵배치 안에도 소프트 데드라인을 두고
 *      ⑶429 백오프 대기는 «브라우저 밖(Node)»에서 한다. 그래야 evaluate 1회가 항상 짧다.
 *  - 오래 걸리는 일에서 «무음»은 그 자체로 결함이다 → 배치마다·대기마다 sendLog로 진행을 찍는다.
 */

// ★「그룹상품」도 받는다 (2026-08-18 규명).
//   여러 상품이 묶인 상품(브라운·베베숲 등)은 경로에 group-products가 «하나 더» 낀다:
//     일반   POST /n/v1/contents/reviews/query-pages
//     그룹상품 POST /n/v1/contents/reviews/group-products/query-pages
//   본문 규약은 같다(page/pageSize/정렬 + JSON) → 같은 페이징 로직을 그대로 쓸 수 있다.
//   이 한 줄을 안 받아서 그룹상품이 «전부» 느린 DOM 폴백으로 떨어졌고,
//   리뷰가 많은 상품(⑧ 39,087건·⑩ 52,986건)은 3~8%만 받고 부분수집으로 끝났다.
// ★호스트마다 «경로 조각»이 다르다 (2026-09-18 실측 — 이가을 고객 건에서 규명)
//     브랜드스토어  brand.naver.com       POST /n/v1/contents/reviews/query-pages
//     스마트스토어  smartstore.naver.com  POST /i/v1/contents/reviews/query-pages
//   본문 규약은 «완전히 같다»(checkoutMerchantNo/originProductNo/page/pageSize/정렬).
//   ⚠️'n'을 박아두면 스마트스토어 상품이 «전부» 느린 DOM 폴백으로 떨어진다.
//     그 경로의 429는 네이버 프론트가 재요청을 멈춰 «이어받기 자체가 불가능»하다 ⇒ 부분수집으로 끝난다.
const QUERY_PAGES_URL_RE = /\/[a-z]\/v1\/contents\/reviews\/(?:group-products\/)?query-pages/;

// ★승계에서 빼는 헤더 이름.
//   ⚠️정확히 말하면 «금지 헤더라서 던지는» 게 아니다 — 금지 헤더(cookie/sec-ch-ua 등)는
//     fetch가 «조용히 무시»한다. 실제로 던지는 이름은 `:`로 시작하는 HTTP/2 의사헤더뿐이다.
//   그래도 빼는 이유: ⑴브라우저가 직접 채우는 값이라 물려줄 필요가 없고
//                    ⑵content-length는 본문을 갈아끼우므로 옛 길이가 남으면 해롭고
//                    ⑶cookie는 우리 객체에 «자격증명을 담지 않기» 위해서다(세션은 credentials:'include'가 붙인다).
const FORBIDDEN_HEADER_RE = /^(?::|host$|connection$|content-length$|cookie2?$|origin$|referer$|sec-|proxy-|accept-encoding$|accept-charset$|user-agent$|te$|trailer$|transfer-encoding$|upgrade$|via$|dnt$|keep-alive$|expect$|date$|access-control-request-)/i;

// ★값에 CR/LF/NUL이 섞이면 fetch가 «던진다» — 이름이 아니라 «값»이 진짜 크래시 축이다.
//   CDP는 중복 헤더를 개행으로 이어붙이는 관례가 있어 현실적으로 들어올 수 있다.
//   여기서 안 거르면 첫 배치에서 예외가 나고, 템플릿이 있는 한 DOM 폴백으로도 안 내려가
//   «부분수집»이 아니라 «0건»이 된다 (Evaluator 지적, 2026-09-18).
const UNSAFE_HEADER_VALUE_RE = /[\r\n\0]/;

/** 포착한 요청 헤더에서 되쏠 수 있는 것만 남긴다. */
function pickReusableHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (FORBIDDEN_HEADER_RE.test(k)) continue;
    if (typeof v !== 'string') continue;
    if (UNSAFE_HEADER_VALUE_RE.test(v)) continue;
    out[k] = v;
  }
  out['content-type'] = 'application/json';
  return out;
}

/** 이 템플릿이 «인증 헤더»를 들고 있는가 — 없으면 인증을 요구하는 상점에서 첫 페이지부터 429다. */
function hasAuthHeaders(headers) {
  return !!(headers && (headers['x-client-rtk'] || headers['x-client-rts']));
}

// 한 배치(evaluate 1회)의 상한 — protocolTimeout 180초 아래로 «항상» 유지하기 위한 값
const BATCH_SOFT_DEADLINE_MS = 100000;
const FETCH_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * query-pages 요청 «템플릿»(url/method/postData)을 포착한다.
 *
 * ★반드시 모달 진입 «전»에 붙여야 한다 — 모달을 여는 순간 첫 query-pages가 발사되기 때문.
 * ★«마지막» 요청을 유지한다(1회 포착 후 고정이 아님):
 *   모달은 기본 정렬(랭킹순)로 먼저 열리고, 사용자가 고른 정렬(최신순/평점낮은순)은 «그다음» 요청에 담긴다.
 *   첫 요청만 고정하면 사용자가 고른 정렬이 무시된 채 수집된다.
 *
 * @param {object} page - Puppeteer page 객체
 * @returns {{get: function(): ({url:string, method:string, postData:string}|null), detach: function(): void}}
 */
export function attachReviewApiTemplate(page) {
  let template = null;
  const onRequest = (req) => {
    let url = '';
    try { url = req.url(); } catch { return; }
    if (!QUERY_PAGES_URL_RE.test(url)) return;
    let postData = null;
    let method = 'POST';
    try {
      postData = req.postData();
      method = req.method();
    } catch { return; }
    if (!postData) return;
    // JSON이 아니면 템플릿으로 쓸 수 없다(page 필드를 갈아끼워야 하므로).
    // ★본문 «모양»까지 확인한다 (Codex 리뷰 2026-09-18).
    //   URL 패턴을 호스트 접두 한 글자([a-z])로 넓혔기 때문에, 우연히 같은 모양의 다른 요청이
    //   «마지막 요청이 이긴다» 규칙을 타고 템플릿을 조용히 오염시킬 여지가 생긴다.
    //   페이징에 실제로 필요한 키(page/pageSize)가 없으면 템플릿으로 받지 않는다.
    //   ⇒ 접두를 (?:n|i)로 좁히는 대신 이 가드를 둔다. 좁히면 «새 호스트 유형»에서 또 폴백으로
    //     떨어지는데, 우리는 이미 그 방식으로 두 번 물렸다(그룹상품 2026-08-18 / 스마트스토어 2026-09-18).
    try {
      const body = JSON.parse(postData);
      if (!body || typeof body !== 'object') return;
      if (!('page' in body) || !('pageSize' in body)) return;
    } catch { return; }
    // ★헤더도 «같이» 포착한다 (2026-09-18 실측으로 확정).
    //   스마트스토어는 `x-client-rtk`(봇 방지 토큰)·`x-client-rts`·`x-client-version`이 없으면
    //   같은 URL·같은 본문이어도 **1페이지부터 429**를 준다. A/B 실증:
    //     content-type만  → p1 HTTP 429 (12.5분 대기해도 안 풀림)
    //     헤더 승계        → totalElements 5,074 · 정상 200
    //   ⇒ 토큰은 우리가 만들 수 없다. «페이지가 쏜 진짜 요청»에서 빌려오는 것이 유일한 방법이다.
    let headers = {};
    let headersOk = true;
    try { headers = pickReusableHeaders(req.headers()); }
    catch { headers = { 'content-type': 'application/json' }; headersOk = false; }
    template = { url, method, postData, headers };
    // ★「인증 헤더를 실었는가」를 «판정 가능한 형태»로 남긴다.
    //   이게 없으면 다음에 429가 났을 때 «헤더 승계가 깨진 것»인지 «네이버가 바뀐 것»인지 구분이 안 된다.
    //   증상(429)만으로는 두 원인이 똑같이 보인다 (Evaluator 지적, 2026-09-18).
    const authed = hasAuthHeaders(headers);
    if (!headersOk) {
      console.log(`[NaverReviewApi] ⚠️ 템플릿은 잡았으나 «헤더를 못 읽었다» — 인증 헤더가 필요한 상점이면 429가 난다: ${url}`);
    } else {
      console.log(`[NaverReviewApi] 📡 리뷰 API 템플릿 포착/갱신: ${url} (헤더 ${Object.keys(headers).length}개, 인증헤더 ${authed ? '있음' : '⚠️없음'})`);
    }
  };
  try { page.on('request', onRequest); } catch { /* 페이지가 이미 닫힘 */ }
  return {
    get: () => template,
    detach: () => { try { page.off('request', onRequest); } catch {} },
  };
}

/**
 * [from..to] 페이지를 «브라우저 안»에서 순회한다.
 * - 429를 만나면 «즉시» 반환한다(대기는 Node가 한다 → evaluate가 길어지지 않는다).
 * - 소프트 데드라인을 넘기면 다음 시작 페이지를 nextPage로 돌려주고 반환한다.
 */
function runBatch(page, template, gapMs, from, to) {
  return page.evaluate(async (t, gap, start, end, softDeadlineMs, fetchTimeoutMs) => {
    const napMs = (ms) => new Promise((r) => setTimeout(r, ms));
    const body0 = JSON.parse(t.postData);
    const rows = [];
    const problems = [];
    let meta = null;
    let rateLimitedAt = null;
    let stoppedAt = null;
    let nextPage = end + 1;
    const startedAt = Date.now();

    const call = (p) => {
      // ★포착한 헤더를 «그대로» 되쏜다 — 봇 방지 토큰(x-client-rtk 등)이 여기 들어 있다.
      //   없으면 스마트스토어는 1페이지부터 429다(2026-09-18 A/B 실증).
      const headers = { ...(t.headers || {}), 'content-type': 'application/json' };
      const init = {
        method: t.method,
        headers,
        body: JSON.stringify({ ...body0, page: p }),
        credentials: 'include',
      };
      try {
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
          init.signal = AbortSignal.timeout(fetchTimeoutMs);
        }
      } catch {}
      // ★안전망 — 승계한 헤더 때문에 fetch가 «던지면» 최소 헤더로 «한 번» 다시 간다.
      //   그래야 최악이 «변경 전 동작»으로 내려앉는다. 안 그러면 템플릿이 있는 한 DOM 폴백도
      //   안 타므로 «부분수집»이 아니라 «0건»으로 끝난다 (Evaluator 지적).
      return fetch(t.url, init).catch((e) => {
        if (!(e instanceof TypeError)) throw e;
        return fetch(t.url, { ...init, headers: { 'content-type': 'application/json' } });
      });
    };

    for (let p = start; p <= end; p++) {
      if (p !== start) await napMs(gap);

      let res;
      try {
        res = await call(p);
      } catch (e) {
        problems.push({ page: p, reason: `요청 실패: ${String((e && e.message) || e).slice(0, 120)}` });
        stoppedAt = p; nextPage = p; break;
      }

      // ★429 = 「약 100페이지마다 예산 소진」. 여기서 기다리지 않고 Node에 넘긴다(대기는 밖에서).
      if (res.status === 429) { rateLimitedAt = p; nextPage = p; break; }
      if (res.status !== 200) {
        problems.push({ page: p, reason: `HTTP ${res.status}` });
        stoppedAt = p; nextPage = p; break;
      }

      let j;
      try { j = await res.json(); }
      catch { problems.push({ page: p, reason: '응답 JSON 파싱 실패' }); stoppedAt = p; nextPage = p; break; }

      if (!meta) {
        meta = {
          totalElements: j.totalElements,
          totalPages: j.totalPages,
          size: j.size || (j.contents || []).length || 20,
        };
      }

      const got = j.contents || [];
      if (got.length === 0) {
        problems.push({ page: p, reason: '빈 페이지' });
        stoppedAt = p; nextPage = p; break;
      }

      // ★필드 매핑 (2026-08-15 실측 확정) — DOM 추출기와 «같은» 원시 형태로 맞춘다.
      for (const c of got) {
        rows.push({
          id: c.id,
          reviewScore: c.reviewScore != null ? String(c.reviewScore) : '점수 없음',
          reviewerName: c.maskedWriterId || c.writerId || '이름 없음',
          reviewDate: (c.createDate || '').slice(0, 10) || '날짜 없음',
          content: (c.reviewContent || '').replace(/\s+/g, ' ').trim() || '내용 없음',
          reviewType: c.repurchase ? '재구매' : '일반리뷰',
          photoUrls: (c.reviewAttaches || []).map((a) => a && a.attachUrl).filter(Boolean),
        });
      }

      // 배치가 길어지면 여기서 끊는다 — evaluate 1회를 protocolTimeout 아래로 «항상» 유지.
      if (p < end && Date.now() - startedAt > softDeadlineMs) { nextPage = p + 1; break; }
    }

    return { rows, problems, meta, rateLimitedAt, stoppedAt, nextPage };
  }, template, gapMs, from, to, BATCH_SOFT_DEADLINE_MS, FETCH_TIMEOUT_MS);
}

/**
 * query-pages API를 직접 페이징해서 리뷰 원시 데이터를 «전량» 모은다.
 *
 * @param {object} page - Puppeteer page 객체 (상품 페이지 = API와 same-origin이어야 한다)
 * @param {object} options
 * @param {number} options.targetCount - 목표 개수 (Infinity면 전량)
 * @param {{url:string,method:string,postData:string}} options.template - attachReviewApiTemplate로 포착한 요청 템플릿
 * @param {Function|null} options.sendLog - sendLog(message, className, updateLast)
 * @param {object|null} options.flags - 공유 상태(rateLimitHits/endedByRateLimit/resumedAfterRateLimit/terminationReason/expectedTotalFromNetwork/usedApi)
 * @param {number} options.gapMs - 페이지 간 간격 (기본 2000 = 전량 완주가 실증된 값)
 * @param {number} options.batchSize - evaluate 1회가 도는 페이지 수 (기본 25)
 * @param {number[]} options.backoffMs - 429 대기 사다리 (기본 30s→60s→120s, 실측 회복은 30+60)
 * @param {number} options.maxPages - 0이면 무제한. 검증·디버그용 페이지 상한(환경변수 NAVER_REVIEW_API_MAX_PAGES로도 지정)
 * @returns {Promise<{rawReviews:Array, totalElements:number|null, totalPages:number|null, collected:number, rateEvents:Array, problems:Array, terminationReason:string, complete:boolean, lastPage:number}>}
 */
export async function collectReviewsViaApi(page, options = {}) {
  const {
    targetCount = Infinity,
    template,
    sendLog = null,
    flags = null,
    gapMs = 2000,
    batchSize = 25,
    backoffMs = [30000, 60000, 120000],
    maxPages = Number(process.env.NAVER_REVIEW_API_MAX_PAGES || 0),
    refreshTemplate = null,
    maxTemplateRefresh = 3,
    maxTemplateRefreshTotal = 40,
  } = options;

  if (!template) throw new Error('리뷰 API 템플릿이 없습니다 (모달 진입 전 attachReviewApiTemplate 필요)');
  if (flags) flags.usedApi = true;

  // ★토큰은 «늙는다» — 대기만으로는 안 풀리는 429가 있다 (2026-09-18 실측).
  //   124페이지까지 정상 수신 → p125에서 429 → 30/60/120초를 다 써도 그대로 429.
  //   리뷰 화면을 «다시 열어» 새 x-client-rtk를 받자마자 254페이지까지 완주했다.
  //   ⇒ 백오프를 다 쓰면 포기하지 말고 «템플릿을 새로 받아» 한 번 더 간다.
  let activeTemplate = template;
  let templateRefreshCount = 0;       // «연속» 실패 예산 (성공하면 리셋된다)
  let templateRefreshTotal = 0;       // 런 전체 총 갱신 횟수 — 폭주 방지용 절대 상한
  // ★갱신이 «해법»으로 판명되면 그 뒤로는 대기 사다리를 줄인다.
  //   429는 약 100페이지마다 온다(파일 머리 실측). 52,986건 상품이면 ~26회다.
  //   매번 30+60+120=210초를 태우면 갱신이 답인 걸 «알면서도» 1시간 반을 버린다 (Evaluator 지적).
  let refreshIsTheRemedy = false;

  const startedAt = Date.now();
  const seen = new Set();
  const rawReviews = [];
  const problems = [];
  const rateEvents = [];

  let totalElements = null;
  let totalPages = null;
  let pageSize = 20;
  let terminationReason = null;
  let lastPage = 0;

  const absorb = (rows) => {
    for (const row of rows) {
      const key = row.id != null ? `id:${row.id}` : `x:${row.reviewerName}|${row.reviewDate}|${row.content.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rawReviews.push(row);
    }
  };

  const takeMeta = (meta) => {
    if (!meta || totalElements !== null) return;
    if (typeof meta.totalElements === 'number') totalElements = meta.totalElements;
    if (typeof meta.totalPages === 'number') totalPages = meta.totalPages;
    if (meta.size > 0) pageSize = meta.size;
    if (flags && totalElements) flags.expectedTotalFromNetwork = totalElements;
  };

  const fmtTotal = () => (totalElements ? totalElements.toLocaleString() : '?');

  /** 429를 만난 «같은 페이지»를 대기 사다리대로 재요청한다. 회복하면 그 페이지 결과를 흡수하고 true. */
  const waitAndRetry = async (p) => {
    const ev = { page: p, waits: [], recovered: false, startedAt: Date.now() };
    // 갱신이 답으로 판명된 뒤엔 사다리를 «1단»만 돌고 곧장 갱신으로 간다.
    const ladder = refreshIsTheRemedy && typeof refreshTemplate === 'function'
      ? backoffMs.slice(0, 1)
      : backoffMs;
    for (let i = 0; i < ladder.length; i++) {
      const waitMs = ladder[i];
      ev.waits.push(waitMs);
      console.log(`[NaverReviewApi] ⏳ 429(p${p}) — ${waitMs / 1000}초 대기 후 같은 페이지 재요청 (${i + 1}/${ladder.length})`);
      sendLog?.(`[안내] 네이버 속도제한(429) — ${waitMs / 1000}초 대기 후 같은 지점(${p}페이지)에서 이어받습니다 (현재 ${rawReviews.length.toLocaleString()}/${fmtTotal()}건)`, 'warning');
      await sleep(waitMs);
      let r;
      try { r = await runBatch(page, activeTemplate, gapMs, p, p); }
      catch (e) { console.log(`[NaverReviewApi] 재요청 실패: ${e.message}`); continue; }
      if (r.rateLimitedAt == null && r.stoppedAt == null && r.rows.length > 0) {
        ev.recovered = true;
        ev.recoveredAfterMs = ev.waits.reduce((a, b) => a + b, 0);
        rateEvents.push(ev);
        takeMeta(r.meta);
        absorb(r.rows);
        sendLog?.(`[정보] 속도제한에서 회복 — ${p}페이지 다음부터 이어서 수집합니다 (${rawReviews.length.toLocaleString()}/${fmtTotal()}건)`, 'success');
        return true;
      }
    }
    // ★대기로 안 풀렸다 = «토큰이 늙은» 경우일 수 있다. 화면을 다시 열어 새 토큰을 받아 한 번 더.
    if (typeof refreshTemplate === 'function' && templateRefreshCount < maxTemplateRefresh && templateRefreshTotal < maxTemplateRefreshTotal) {
      templateRefreshCount++;
      templateRefreshTotal++;
      console.log(`[NaverReviewApi] 🔄 토큰 갱신 시도 (${templateRefreshCount}/${maxTemplateRefresh})`);
      sendLog?.(`[안내] 대기로 안 풀려 리뷰 화면을 다시 열어 «새 인증값»을 받습니다 (${templateRefreshCount}/${maxTemplateRefresh})`, 'warning');
      let fresh = null;
      try { fresh = await refreshTemplate(); }
      catch (e) { console.log(`[NaverReviewApi] 토큰 갱신 실패: ${e.message}`); }
      if (fresh && fresh.url && fresh.postData && hasAuthHeaders(fresh.headers)) {
        activeTemplate = fresh;
        ev.templateRefreshed = true;
        let r2 = null;
        try { r2 = await runBatch(page, activeTemplate, gapMs, p, p); }
        catch (e) { console.log(`[NaverReviewApi] 갱신 후 재요청 실패: ${e.message}`); }
        if (r2 && r2.rateLimitedAt == null && r2.stoppedAt == null && r2.rows.length > 0) {
          ev.recovered = true;
          ev.recoveredBy = 'template-refresh';
          // ★대기 합만 세면 «모달 재진입에 쓴 시간»이 빠져 회복 소요를 과소보고한다.
          ev.recoveredAfterMs = Date.now() - ev.startedAt;
          templateRefreshCount = 0;     // 회복했으면 «연속 실패» 카운터는 0으로 되돌린다
          refreshIsTheRemedy = true;    // 이 상품/세션에선 갱신이 답이다 — 다음부터 빨리 간다
          rateEvents.push(ev);
          takeMeta(r2.meta);
          absorb(r2.rows);
          sendLog?.(`[정보] 새 인증값으로 회복 — ${p}페이지 다음부터 이어서 수집합니다 (${rawReviews.length.toLocaleString()}/${fmtTotal()}건)`, 'success');
          return true;
        }
        console.log('[NaverReviewApi] 토큰을 갱신했는데도 429 — 포기');
      } else {
        console.log('[NaverReviewApi] 새 템플릿을 못 받았거나 «인증 헤더가 없다» — 포기');
      }
    }
    rateEvents.push(ev);
    problems.push({ page: p, reason: 'HTTP 429 (백오프 소진, 미회복)' });
    return false;
  };

  // ① 1페이지로 «계약»(분모)을 먼저 고정한다. 끝에 반드시 이 분모와 대조한다.
  const head = await runBatch(page, activeTemplate, gapMs, 1, 1);
  takeMeta(head.meta);
  absorb(head.rows);
  problems.push(...head.problems);
  lastPage = 1;

  // 첫 페이지부터 429면 «대기 후 이어받기»를 그대로 적용한다 (여기서 포기하면 100페이지 예산 소진 상태에서
  // 실행할 때마다 0건이 된다).
  if (head.rateLimitedAt != null) {
    if (flags) flags.rateLimitHits = (flags.rateLimitHits || 0) + 1;
    const recovered = await waitAndRetry(1);
    if (recovered && flags) flags.resumedAfterRateLimit = (flags.resumedAfterRateLimit || 0) + 1;
    if (!recovered) {
      terminationReason = 'api_rate_limited';
      if (flags) { flags.terminationReason = terminationReason; flags.endedByRateLimit = true; }
      return {
        rawReviews, totalElements, totalPages, collected: rawReviews.length,
        rateEvents, problems, terminationReason, complete: false, lastPage,
      };
    }
  }

  if (totalElements === null) {
    // 총건수를 못 받으면 «분모 없는 수집»이 된다 → 여기서 멈추고 호출자가 정직하게 판정하게 한다.
    terminationReason = 'api_no_contract';
    if (flags) flags.terminationReason = terminationReason;
    return {
      rawReviews, totalElements: null, totalPages: null, collected: rawReviews.length,
      rateEvents, problems, terminationReason, complete: false, lastPage,
    };
  }

  // 이번 실행에서 돌 페이지 상한 — 목표 개수/디버그 상한을 함께 반영
  const pagesForTarget = targetCount === Infinity ? totalPages : Math.min(totalPages, Math.ceil(targetCount / pageSize));
  const limitPages = maxPages > 0 ? Math.min(pagesForTarget, maxPages) : pagesForTarget;
  const totalText = totalElements.toLocaleString();

  console.log(`[NaverReviewApi] 계약 확보 — 총 ${totalElements}건 / ${totalPages}페이지 (이번 실행 ${limitPages}페이지)`);
  sendLog?.(`[정보] 리뷰 API 직접 수집 — 총 ${totalText}건 / ${totalPages}페이지 (이번 실행 ${limitPages}페이지)`, 'info');

  // ② 본 루프 — 배치로 쪼개 돈다. 429는 «대기 후 같은 페이지»로 이어받는다.
  let next = 2;

  while (next <= limitPages && rawReviews.length < targetCount) {
    const to = Math.min(next + batchSize - 1, limitPages);
    let r;
    try {
      r = await runBatch(page, activeTemplate, gapMs, next, to);
    } catch (e) {
      problems.push({ page: next, reason: `배치 실행 실패: ${e.message}` });
      terminationReason = 'api_exception';
      break;
    }

    takeMeta(r.meta);
    absorb(r.rows);
    problems.push(...r.problems);
    lastPage = Math.max(lastPage, Math.max(next, (r.nextPage || next) - 1));

    if (r.rateLimitedAt != null) {
      if (flags) flags.rateLimitHits = (flags.rateLimitHits || 0) + 1;
      const recovered = await waitAndRetry(r.rateLimitedAt);
      if (!recovered) {
        terminationReason = 'api_rate_limited';
        if (flags) flags.endedByRateLimit = true;
        break;
      }
      if (flags) flags.resumedAfterRateLimit = (flags.resumedAfterRateLimit || 0) + 1;
      lastPage = Math.max(lastPage, r.rateLimitedAt);
      next = r.rateLimitedAt + 1;
      continue;
    }

    if (r.stoppedAt != null) {
      const reason = (r.problems[r.problems.length - 1] || {}).reason || '';
      terminationReason = reason.includes('빈 페이지') ? 'api_empty_page' : 'api_http_error';
      break;
    }

    next = r.nextPage;
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = elapsed > 0 ? (rawReviews.length / elapsed).toFixed(1) : '0.0';
    sendLog?.(`[진행] 리뷰 수집 ${rawReviews.length.toLocaleString()}/${totalText}건 (${lastPage}/${limitPages}페이지, ${rate}건/s)`, 'info', true);
    if (next <= limitPages) await sleep(gapMs);
  }

  // ③ 종료 사유 확정 — «완료»를 부를 근거는 계약 대조뿐이다.
  const targetForRun = targetCount === Infinity ? totalElements : Math.min(targetCount, totalElements);
  if (!terminationReason) {
    if (rawReviews.length >= targetForRun) terminationReason = targetCount === Infinity ? 'api_complete' : 'api_target_reached';
    else if (maxPages > 0 && limitPages === maxPages && limitPages < pagesForTarget) terminationReason = 'api_max_pages';
    else terminationReason = 'api_incomplete';
  }

  // 목표 개수를 지정한 수집이면 초과분은 잘라낸다 (배치 단위로 돌기 때문에 최대 batchSize*pageSize만큼 넘칠 수 있다)
  const finalRows = targetCount === Infinity ? rawReviews : rawReviews.slice(0, targetCount);
  const complete = problems.length === 0 && finalRows.length >= targetForRun;

  if (flags) flags.terminationReason = terminationReason;

  const dur = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[NaverReviewApi] 수집 ${finalRows.length}/${totalElements} · ${dur}초 · 문제 ${problems.length}건 · 사유 ${terminationReason} · 완주=${complete}`);

  return {
    rawReviews: finalRows,
    totalElements,
    totalPages,
    collected: finalRows.length,
    rateEvents,
    problems,
    terminationReason,
    complete,
    lastPage,
  };
}
