/**
 * 네이버 Q&A 모달 무한 스크롤 페이지네이션
 *
 * 리뷰 모달과 마찬가지로 페이지 번호 클릭 방식이 폐기되어
 * 모달 내부 scroll container의 scrollTop을 끝까지 보내며 li 개수가
 * 늘어나는 방식으로 동작.
 *
 * 리뷰 측 검증된 패턴(naverPagination.js)을 그대로 본뜨되,
 * Q&A 모달은 진단에서 스크롤 컨테이너 셀렉터가 명확히 적시되지 않아
 * 동적 탐색(overflow auto/scroll + scrollHeight>clientHeight) 헬퍼를 사용.
 */
import { QNA } from './naverSelectors.js';

/**
 * Q&A «총건수» 응답 URL 판별 정규식.
 *
 * ★2026-08-18 라이브 실측 (brand.naver.com/frankliin/products/10422056773):
 *   Q&A 모달을 여는 순간
 *     GET https://brand.naver.com/n/v1/qna/pages?page=1&pageSize=20&isMyQna=false
 *         &qnaStatus=ALL&excludeSecret=false&channelProductNo=...&channelNo=...
 *       → {qnaList:[20], page:1, size:20, totalElements:485, totalPages:25}
 *   스크롤로 다음 묶음을 받을 때도 같은 엔드포인트에 page만 바뀌어 나가고 totalElements는 485로 고정.
 *
 * ⇒ 리뷰의 query-pages(totalElements)와 «같은 구조»다. 화면 텍스트 파싱이 필요 없다.
 * ⚠️ excludeSecret 파라미터에 따라 총건수가 달라질 수 있으므로 «첫» 응답(=스크롤 루프가 실제로 읽는
 *    목록과 같은 조건)만 총계로 채택한다. 뒤늦게 조건이 바뀐 응답으로 분모를 갈아치우지 않는다.
 */
export const QNA_TOTAL_URL_RE = /\/v1\/qna\/pages/;

/**
 * Q&A API 응답에서 총건수를 뽑는다. (순수 함수 — 브라우저 없이 node로 검증 가능)
 * @param {string} url  응답 URL
 * @param {any} json    파싱된 응답 본문
 * @returns {number|null} 실패/비대상이면 null = "미확인" (절대 추정하지 않는다)
 */
export function pickQnATotalFromResponse(url, json) {
  if (typeof url !== 'string' || !QNA_TOTAL_URL_RE.test(url)) return null;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  // qnaList가 있는 응답만 «목록» 응답으로 인정한다 (다른 qna 엔드포인트의 totalElements 오채택 방지 —
  // 리뷰에서 gallery-attaches의 totalElements를 총 리뷰 수로 오인했던 사고와 같은 종류).
  if (!Array.isArray(json.qnaList)) return null;
  const n = json.totalElements;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Q&A 총건수 «네트워크» 감시자 — 리뷰의 attachReviewTotalWatcher와 «같은 구조»다.
 *
 * ★모달을 여는 순간 /v1/qna/pages가 발사되므로 «모달 진입 전»에 붙여야 한다.
 * @param {object} page
 * @param {object} options - flags: 캡처값을 올려둘 공유 객체 / onCapture: 1회 콜백
 * @returns {{get:()=>number|null, detach:()=>void}}
 */
export function attachQnATotalWatcher(page, options = {}) {
  const { flags = null, onCapture = null } = options;
  let total = null;
  const onResponse = (res) => {
    if (total !== null) return; // 한 번만 캡처
    let url = '';
    try { url = res.url(); } catch { return; }
    if (!QNA_TOTAL_URL_RE.test(url)) return;
    // 본문 파싱은 비동기 — 실패해도 수집을 방해하지 않도록 전부 삼킨다(총계는 실패 시 null = 미확인).
    Promise.resolve()
      .then(() => res.json())
      .then((json) => {
        if (total !== null) return;
        const n = pickQnATotalFromResponse(url, json);
        if (n === null) return;
        total = n;
        if (flags) flags.expectedQnATotalFromNetwork = n;
        console.log(`[NaverQnAPagination] 📡 Q&A 총건수 캡처(네트워크 totalElements): ${n}`);
        if (onCapture) { try { onCapture(n); } catch {} }
      })
      .catch(() => {});
  };
  try { page.on('response', onResponse); } catch { /* 페이지가 이미 닫힘 */ }
  return {
    get: () => total,
    detach: () => { try { page.off('response', onResponse); } catch {} },
  };
}

/**
 * 모달 내 현재 Q&A 개수 반환
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<number>} Q&A 개수
 */
export async function getQnACount(page) {
  try {
    const count = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, QNA.modalDialogSelector);
    return count;
  } catch (e) {
    console.log(`[NaverQnAPagination] Q&A 개수 확인 실패: ${e.message}`);
    return 0;
  }
}

/**
 * Q&A 모달 내부 스크롤 컨테이너 끝까지 스크롤 + 현재 scrollHeight 반환
 *
 * 진단에서 컨테이너 셀렉터가 명확히 적시되지 않았으므로,
 * page.evaluate 내부에서 동적으로 다음 우선순위로 컨테이너를 탐색한다:
 *   1) Q&A dialog 내부 element 중 overflowY:auto|scroll AND scrollHeight>clientHeight
 *      → 그 중 가장 큰 scrollHeight를 가진 컨테이너
 *   2) 못 찾으면 마지막 li[id^="QNA_ITEM_"]에 scrollIntoView({block:'end'}) 폴백
 *
 * @param {object} page
 * @returns {Promise<number>} scrollHeight (-1이면 컨테이너/모달 못 찾음)
 */
async function scrollQnAModalToBottom(page) {
  return page.evaluate((modalItemSel) => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const dialog = dialogs.find(d => d.querySelector(modalItemSel));
    if (!dialog) return -1;

    // 1) overflow auto/scroll + scrollHeight>clientHeight 컨테이너 동적 탐색
    const candidates = [];
    const all = dialog.querySelectorAll('*');
    for (const el of all) {
      try {
        const style = window.getComputedStyle(el);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          candidates.push(el);
        }
      } catch (e) { /* getComputedStyle 실패는 무시 */ }
    }

    let container = null;
    if (candidates.length > 0) {
      // scrollHeight 가장 큰 컨테이너 선택
      candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
      container = candidates[0];
    }

    if (container) {
      container.scrollTop = container.scrollHeight;
      return container.scrollHeight;
    }

    // 2) 폴백: 마지막 li를 화면 끝으로 스크롤
    const items = dialog.querySelectorAll(modalItemSel);
    if (items.length === 0) return -1;
    const last = items[items.length - 1];
    try {
      last.scrollIntoView({ block: 'end', behavior: 'instant' });
    } catch (e) {
      last.scrollIntoView(false);
    }
    // 폴백 시에는 dialog scrollHeight를 보고
    return dialog.scrollHeight;
  }, QNA.modalDialogSelector);
}

/**
 * 모달 내 scroll container를 끝까지 스크롤하여 추가 Q&A 로드
 * - targetCount: 도달 목표 Q&A 개수 (Infinity면 끝까지)
 * - 종료 조건 (안전 모드: 누락 방지 우선):
 *   1) targetCount 도달
 *   2) scrollHeight + Q&A 개수 모두 STABLE_THRESHOLD(3)회 연속 동일
 *      → 추가 대기로도 변동 없으면 종료
 *      → 단, 동결 직전에 HTTP 429가 관측됐으면 "Q&A 끝"이 아니라 «차단»으로 보고 경고한다
 *   3) MAX_ATTEMPTS(200)회 시도 또는 MAX_DURATION_MS(600s) 초과
 *
 * ★리뷰 쪽(naverPagination.js)에서 검증된 «무증상 종료 방지» 장치를 이식했다:
 *   ① terminationReason을 «항상» flags에 기록 ② 차단/구조파손 시 sendLog로 사용자 통지 ③ 429 감지.
 *   ④ v1.7.2 — 총계 대조는 «호출부»(naverService)가 attachQnATotalWatcher로 잡은 totalElements와
 *      이 함수가 돌려주는 최종 개수를 비교해서 판정한다. 이 함수 자체는 총계를 모른 채 돌아도 된다.
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetCount - 목표 Q&A 개수 (기본 Infinity)
 * @param {object} options
 *   - flags: 호출자 공유 상태 객체 — terminationReason(항상)/rateLimitHits/endedByRateLimit/endedByStall/endedByNoContainer 기록
 *   - sendLog: UI 로그 전송 함수 (차단·구조파손을 사용자에게 표시)
 *   - tuning.scrollWaitMs: 스크롤 간격 오버라이드 (속도 옵션)
 * @returns {Promise<number>} 최종 Q&A 개수
 */
export async function loadMoreQnAs(page, targetCount = Infinity, options = {}) {
  const { flags = null, sendLog = null, tuning = {} } = options;
  console.log(`[NaverQnAPagination] ♾️ Q&A 무한 스크롤 시작 (목표: ${targetCount === Infinity ? '전체' : targetCount}개)`);

  const MAX_ATTEMPTS = 200;
  const MAX_DURATION_MS = 600000;
  // 기본 3000 (리뷰와 동일 — 네이버 요청속도 제한 회피, 2026-07-07 실측)
  const SCROLL_WAIT_MS = tuning.scrollWaitMs ?? 3000;
  const STABLE_RECHECK_WAIT_MS = 2500;
  const STABLE_THRESHOLD = 3;

  // ③ 429 속도제한 감지 — 스크롤 중 네이버 응답에 429가 섞이면 기록해 둔다.
  //    동결이 "진짜 끝"인지 "차단"인지 이 기록으로 판별한다(리뷰 쪽과 동일 원리).
  const rateLimit = { last429At: 0, hits: 0, lastUrl: '' };
  const onResponse = (res) => {
    try {
      if (res.status() === 429 && res.url().includes('naver')) {
        rateLimit.last429At = Date.now();
        rateLimit.hits++;
        rateLimit.lastUrl = res.url();
        console.log(`[NaverQnAPagination]   🚦 HTTP 429 감지 (누적 ${rateLimit.hits}회): ${res.url().slice(0, 120)}`);
      }
    } catch {}
  };
  page.on('response', onResponse);

  // ① 종료 사유는 «항상» 기록한다 — 호출부가 무증상 종료를 판별할 수 있어야 한다.
  let terminationReason = null;
  const setTermination = (reason) => {
    terminationReason = reason;
    if (flags) flags.terminationReason = reason;
  };

  const startTime = Date.now();
  let lastScrollHeight = -1;
  let lastQnACount = -1;
  let stableScrollCount = 0;
  let stableCountCount = 0;
  let lastProgressAt = Date.now(); // 마지막으로 Q&A 개수가 늘어난 시각 (429 인과 판별용)

  let currentCount = await getQnACount(page);
  console.log(`[NaverQnAPagination]   📊 시작 Q&A 개수: ${currentCount}`);

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        console.log(`[NaverQnAPagination]   ⏱️ 최대 대기 시간(${MAX_DURATION_MS}ms) 초과로 종료`);
        setTermination('max_duration');
        // ② 시간 초과는 '끝까지 봤다'는 뜻이 아니다 — 조용히 끝내지 않는다.
        if (sendLog) sendLog(`[경고] ⚠️ Q&A 로딩이 제한 시간(10분)을 넘겨 중단했습니다 — ${currentCount}개까지만 수집됩니다 (부분수집)`, 'warning');
        break;
      }

      if (currentCount >= targetCount) {
        console.log(`[NaverQnAPagination]   🎯 목표 Q&A 개수(${targetCount}) 도달`);
        setTermination('target_reached');
        break;
      }

      // 스크롤 + scrollHeight 반환
      const scrollHeight = await scrollQnAModalToBottom(page);

      if (scrollHeight === -1) {
        // ② 구조 파손 — '완료'로 위장하지 말고 명시적 오류로 알린다.
        console.log(`[NaverQnAPagination]   ⚠️ scroll container/모달을 찾을 수 없습니다.`);
        if (sendLog) sendLog(`[오류] 네이버 화면 구조가 바뀌어 Q&A 목록을 스크롤할 수 없습니다 — 앱 업데이트가 필요합니다`, 'error');
        if (flags) flags.endedByNoContainer = true;
        setTermination('no_scroll_container');
        break;
      }

      // 새 Q&A 로드 대기
      await new Promise(resolve => setTimeout(resolve, SCROLL_WAIT_MS));

      const newCount = await getQnACount(page);

      if (scrollHeight === lastScrollHeight) {
        stableScrollCount++;
      } else {
        stableScrollCount = 0;
        lastScrollHeight = scrollHeight;
      }

      if (newCount === lastQnACount) {
        stableCountCount++;
      } else {
        stableCountCount = 0;
        lastQnACount = newCount;
      }

      if (newCount !== currentCount) {
        console.log(`[NaverQnAPagination]   📈 시도 ${attempt + 1}: ${currentCount} → ${newCount} (scrollHeight=${scrollHeight})`);
        lastProgressAt = Date.now();
      }

      currentCount = newCount;

      if (stableScrollCount >= STABLE_THRESHOLD && stableCountCount >= STABLE_THRESHOLD) {
        console.log(`[NaverQnAPagination]   🤔 ${STABLE_THRESHOLD}회 연속 동결 감지 — ${STABLE_RECHECK_WAIT_MS}ms 추가 대기 후 재확인`);
        await new Promise(resolve => setTimeout(resolve, STABLE_RECHECK_WAIT_MS));

        // 추가 대기 중에도 스크롤 한 번 더 시도하여 lazy load 트리거
        const recheckHeight = await scrollQnAModalToBottom(page);
        const recheckCount = await getQnACount(page);

        if (recheckHeight !== lastScrollHeight || recheckCount !== currentCount) {
          console.log(`[NaverQnAPagination]   🔄 추가 대기 후 변동 감지 (height: ${lastScrollHeight}→${recheckHeight}, count: ${currentCount}→${recheckCount}) — 종료 보류, 스크롤 계속`);
          stableScrollCount = 0;
          stableCountCount = 0;
          if (recheckHeight !== -1) lastScrollHeight = recheckHeight;
          if (recheckCount !== currentCount) lastProgressAt = Date.now();
          currentCount = recheckCount;
          lastQnACount = recheckCount;
          continue;
        }

        // 동결 확정 — 원인 판별: 마지막 진행 이후 429가 관측됐으면 "Q&A 끝"이 아니라 "차단"이다.
        if (rateLimit.last429At >= lastProgressAt && rateLimit.hits > 0) {
          console.log(`[NaverQnAPagination]   🛑 동결 원인 = 속도제한(429 누적 ${rateLimit.hits}회) — 부분수집 ${currentCount}개로 중단`);
          if (sendLog) sendLog(`[경고] ⚠️ 네이버 속도제한(429)으로 Q&A 수집이 중단되었습니다 — ${currentCount}개까지만 수집됨 (부분수집). '안정 수집'을 체크하고 다시 실행해 주세요.`, 'warning');
          if (flags) flags.endedByRateLimit = true;
          setTermination('rate_limit_stall');
          break;
        }

        console.log(`[NaverQnAPagination]   🛑 더 이상 Q&A가 로드되지 않습니다 (시도 ${attempt + 1}회, 추가 대기로도 변동 없음)`);
        if (flags) flags.endedByStall = true;
        setTermination('stable_threshold');
        break;
      }
    }
  } finally {
    page.off('response', onResponse);
    if (flags) flags.rateLimitHits = (flags.rateLimitHits || 0) + rateLimit.hits;
  }

  // for 소진(MAX_ATTEMPTS) 경로도 사유를 남긴다 — 사유 없는 종료를 만들지 않는다.
  if (!terminationReason) {
    setTermination('attempts_exhausted');
    if (sendLog) sendLog(`[경고] ⚠️ Q&A 스크롤 시도 횟수(${MAX_ATTEMPTS}회)를 모두 써서 중단했습니다 — ${currentCount}개까지만 수집됩니다 (부분수집)`, 'warning');
  }

  console.log(`[NaverQnAPagination] ✅ Q&A 무한 스크롤 완료. 최종 Q&A 개수: ${currentCount} (종료 사유: ${terminationReason})`);
  return currentCount;
}

/**
 * 다음 페이지 존재 여부 확인 (호환용 — 모달은 무한 스크롤이라 항상 false 반환)
 * naverService.js의 옛 호출부 안전 처리.
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<boolean>} 항상 false
 */
export async function hasNextQnAPage(page) {
  return false;
}

/**
 * 다음 페이지로 이동 (호환용 — 모달은 무한 스크롤이라 항상 false 반환)
 * naverService.js의 옛 호출부 안전 처리.
 * @param {object} page
 * @param {number} targetPage
 * @returns {Promise<boolean>} 항상 false
 */
export async function navigateToNextQnAPage(page, targetPage) {
  console.log(`[NaverQnAPagination] 모달 무한 스크롤 모드: navigateToNextQnAPage 호출 무시 (page ${targetPage})`);
  return false;
}
