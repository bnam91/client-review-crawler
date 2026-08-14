/**
 * 네이버 리뷰 모달 무한 스크롤 페이지네이션
 *
 * 리뉴얼 후 페이지 번호 클릭 방식이 폐기되어 모달 내부 scroll container의
 * scrollTop을 끝까지 보내며 li 개수가 늘어나는 방식으로 동작.
 */
import { REVIEW } from './naverSelectors.js';

/**
 * 모달 내 현재 리뷰 개수 반환
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<number>} 리뷰 개수
 */
export async function getReviewCount(page) {
  try {
    const count = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, REVIEW.modalDialogSelector);
    return count;
  } catch (e) {
    console.log(`[NaverPagination] 리뷰 개수 확인 실패: ${e.message}`);
    return 0;
  }
}

/**
 * 모달 내 scroll container를 끝까지 스크롤하여 추가 리뷰 로드
 * - targetCount: 도달 목표 리뷰 개수 (Infinity면 끝까지)
 * - 종료 조건 (안전 모드: 누락 방지 우선):
 *   1) targetCount 도달
 *   2) scrollHeight + 리뷰 개수 모두 3회 연속 동일 (네이버 응답 지연 안전 마진)
 *      → 단, 직전 추가 대기로도 변동 발생 시 stable 카운트 리셋
 *      → 동결이 네이버 속도제한(HTTP 429) 때문이면 "리뷰 끝"이 아님:
 *        단계적 대기(기본 30s→60s→120s) 후 이어받기, 전부 소진 시에만 부분수집 종료
 *      → 429가 아닌 동결도 "리뷰 끝"이라 단정하지 않음: 재점화 + 8s/10s 대기로 2회 재확인(UI에 대기 표시)
 *   3) max 200회 시도 또는 max 10분 (429 대기 시간은 미산입)
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetCount - 목표 리뷰 개수 (기본 Infinity)
 * @param {object} options
 *   - diagnostic: 진단 수집 객체 (옵트인)
 *   - chunkNum: 청크 번호 (로그용)
 *   - flags: 호출자 공유 상태 객체 — rateLimitHits/endedByRateLimit/resumedAfterRateLimit,
 *            terminationReason(항상)/endedByStall/endedByNoContainer/usedContainerFallback 기록
 *   - sendLog: UI 로그 전송 함수 (대기/재개 상황을 사용자에게 표시)
 *   - backoffScheduleMs / tuning: 테스트용 오버라이드
 * @returns {Promise<number>} 최종 리뷰 개수
 */
export async function loadMoreReviews(page, targetCount = Infinity, options = {}) {
  const {
    diagnostic = null,
    chunkNum = 1,
    flags = null,
    sendLog = null,
    // 라이브 실측(2026-07-07 스토케 2회): 네이버 429는 시간제한이 아니라 세션당 조회깊이 상한(~198페이지)에
    // 가깝고, 프론트가 429 후 재요청을 영구 중단해 긴 대기가 무의미 → 3단계(총 3.5분)로 제한.
    // 짧은 일시 차단(transient) 케이스만 이어받기를 노린다.
    backoffScheduleMs = [30000, 60000, 120000],
    tuning = {},
  } = options;
  console.log(`[NaverPagination] ♾️ 무한 스크롤 시작 (목표: ${targetCount === Infinity ? '전체' : targetCount}개)`);

  const MAX_ATTEMPTS = 200;            // 30→200 (대량 리뷰 대응)
  const MAX_DURATION_MS = 600000;      // 30s→600s (10분, 대량 리뷰 대응)
  // 1500→3000 (2026-07-07 라이브 실측): 네이버 429는 요청속도 기반 제한 —
  // 1.5s 간격은 120~198페이지에서 차단(중단점 환경별 변동), 3s 간격은 4,630개 전량 무차단 완주.
  // 소형 상품은 스크롤 횟수가 적어 체감 손해 미미, 대형 상품은 이 값이어야 전량 수집됨.
  const SCROLL_WAIT_MS = tuning.scrollWaitMs ?? 3000;
  const STABLE_RECHECK_WAIT_MS = tuning.stableRecheckWaitMs ?? 2500; // 동결 의심 시 추가 한 번 대기
  const STABLE_THRESHOLD = 3;          // 2→3회 연속 동결 필요
  // 429가 «아닌» 동결(네이버 lazy-load 일시 정지/실패) 재시도 스케줄.
  // "약 7초 무변동 = 리뷰 끝"이라는 단일 휴리스틱이 부분수집을 '완료'로 위장시켜 온 지점이라
  // 종료를 확정하기 전에 재점화 + 긴 대기를 최대 2회 더 준다(대기 사실은 UI에 표시).
  const STALL_RETRY_WAITS_MS = tuning.stallRetryWaitsMs ?? [8000, 10000];

  // 429 속도제한 감지 — 스크롤 중 네이버 응답에 429가 섞이면 기록해 둔다.
  // 동결(리뷰 안 늘어남)이 "진짜 끝"인지 "차단"인지 이 기록으로 판별한다.
  const rateLimit = { last429At: 0, hits: 0, lastUrl: '', retryAfterSec: 0 };
  const onResponse = (res) => {
    try {
      if (res.status() === 429 && res.url().includes('naver')) {
        rateLimit.last429At = Date.now();
        rateLimit.hits++;
        rateLimit.lastUrl = res.url();
        // 서버가 Retry-After를 주면 그 시간을 존중 (best-effort)
        const ra = parseInt((res.headers()['retry-after'] || ''), 10);
        if (!isNaN(ra) && ra > 0) rateLimit.retryAfterSec = ra;
        console.log(`[NaverPagination]   🚦 HTTP 429 감지 (누적 ${rateLimit.hits}회${ra > 0 ? `, Retry-After ${ra}s` : ''}): ${res.url().slice(0, 120)}`);
      }
    } catch {}
  };
  page.on('response', onResponse);

  // 진단 — 첫 청크 시작 시점에 모달 내부 구조 dump (사용자 환경에서 scroll container 매치 여부 확인용)
  if (diagnostic && chunkNum === 1 && !diagnostic.scrollContainer) {
    try {
      diagnostic.scrollContainer = await page.evaluate((sel) => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const dialog = dialogs.find(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
        const hardcoded = document.querySelector(sel);
        const candidates = dialog ? Array.from(dialog.querySelectorAll('*')).filter(el => {
          const cs = getComputedStyle(el);
          return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        }).slice(0, 10).map(el => ({
          tag: el.tagName,
          class: (el.className || '').toString().slice(0, 100),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        })) : [];
        return {
          hardcodedSelector: sel,
          hardcodedMatched: !!hardcoded,
          hardcodedInfo: hardcoded ? {
            scrollHeight: hardcoded.scrollHeight,
            clientHeight: hardcoded.clientHeight,
            overflow: getComputedStyle(hardcoded).overflowY,
          } : null,
          dialogFound: !!dialog,
          dialogLiCount: dialog ? dialog.querySelectorAll('li[id^="REVIEW_ITEM_"]').length : 0,
          candidates,
        };
      }, REVIEW.scrollContainerSelector);
    } catch (e) {
      diagnostic.scrollContainer = { error: e.message };
    }
  }

  // 종료 사유는 «항상» 기록한다 — 진단 옵트인(diagnostic)이 꺼져 있어도 flags로 호출부에 노출.
  // (기존에는 MAX_DURATION 초과·시도 소진 경로가 사유를 남기지 않아 원인 규명이 불가능했다)
  let terminationReason = null;
  const setTermination = (reason, onlyIfEmpty = false) => {
    terminationReason = reason;
    if (diagnostic && !(onlyIfEmpty && diagnostic.terminationReason)) diagnostic.terminationReason = reason;
    if (flags) flags.terminationReason = reason;
  };

  // 스크롤 컨테이너 조회 — 하드코딩 셀렉터가 «1순위»(기존 동작 100% 보존),
  // null일 때에 «한해» 모달 내부 동적 탐색으로 폴백한다.
  const probeContainer = (scrollToBottom) => page.evaluate((containerSel, doScroll) => {
    let usedFallback = false;
    let container = document.querySelector(containerSel);
    if (!container) {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
      if (dialog) {
        container = Array.from(dialog.querySelectorAll('*')).find(el => {
          const cs = getComputedStyle(el);
          return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
            && el.scrollHeight > el.clientHeight
            && el.querySelector('li[id^="REVIEW_ITEM_"]');
        }) || null;
      }
      usedFallback = !!container;
    }
    if (!container) return { scrollHeight: -1, usedFallback: false };
    if (doScroll) container.scrollTop = container.scrollHeight;
    return { scrollHeight: container.scrollHeight, usedFallback };
  }, REVIEW.scrollContainerSelector, !!scrollToBottom);

  // 로더 재점화 — 네이버 프론트는 차단/장애를 만나면 재요청을 멈추는 것으로 관측됨(라이브 실측).
  // ① 모달 안 재시도 버튼 클릭 ② 없으면 위로 2뷰포트 스크롤해서 다음 바닥 스크롤 때 sentinel을 재교차시킨다.
  const retriggerLoader = async () => {
    try {
      const retriggered = await page.evaluate((sel) => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const dialog = dialogs.find(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
        if (dialog) {
          const btn = Array.from(dialog.querySelectorAll('button'))
            .find(b => /다시\s*시도|재시도|새로고침/.test(b.textContent || ''));
          if (btn) { btn.click(); return 'retry-button'; }
        }
        let c = document.querySelector(sel);
        if (!c && dialog) {
          c = Array.from(dialog.querySelectorAll('*')).find(el => {
            const cs = getComputedStyle(el);
            return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
              && el.scrollHeight > el.clientHeight
              && el.querySelector('li[id^="REVIEW_ITEM_"]');
          }) || null;
        }
        if (c) c.scrollTop = Math.max(0, c.scrollTop - Math.max(1200, c.clientHeight * 2));
        return 'scroll-cycle';
      }, REVIEW.scrollContainerSelector);
      console.log(`[NaverPagination]   🔁 로더 재점화: ${retriggered}`);
    } catch {}
  };

  const startTime = Date.now();
  let lastScrollHeight = -1;
  let lastReviewCount = -1;
  let stableScrollCount = 0;
  let stableCountCount = 0;
  let stallRetryIdx = 0;           // 429가 아닌 동결 재시도 횟수 (진행 재개 시 리셋)
  let fallbackNotified = false;    // 컨테이너 폴백 경고를 1회만 표시
  let lastProgressAt = Date.now(); // 마지막으로 리뷰 개수가 늘어난 시각 (429 인과 판별용)
  let totalBackoffMs = 0;          // 속도제한 대기 누적 (MAX_DURATION에 미산입)
  let backoffIdx = 0;              // 다음에 쓸 대기 단계 (진행 재개 시 리셋)

  let currentCount = await getReviewCount(page);
  console.log(`[NaverPagination]   📊 시작 리뷰 개수: ${currentCount}`);

  try {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 시간 초과 체크 (429 대기 시간은 제외 — 대기가 시간예산을 잡아먹으면 이어받기가 무의미)
    if (Date.now() - startTime - totalBackoffMs > MAX_DURATION_MS) {
      console.log(`[NaverPagination]   ⏱️ 최대 대기 시간(${MAX_DURATION_MS}ms) 초과로 종료`);
      setTermination('max_duration');
      break;
    }

    // 목표 도달 체크
    if (currentCount >= targetCount) {
      console.log(`[NaverPagination]   🎯 목표 리뷰 개수(${targetCount}) 도달`);
      setTermination('target_reached', true);
      break;
    }

    // 스크롤 컨테이너 끝까지 스크롤 + 현재 scrollHeight 반환
    const scrolled = await probeContainer(true);
    const scrollHeight = scrolled.scrollHeight;

    if (scrolled.usedFallback && !fallbackNotified) {
      // 조용한 실패 방지 — 폴백이 발동했다는 사실 자체를 사용자에게 알린다.
      fallbackNotified = true;
      console.log(`[NaverPagination]   ⚠️ 하드코딩 scroll container 미매치 — 모달 내부 동적 탐색으로 폴백`);
      if (sendLog) sendLog(`[주의] 네이버 화면 구조가 바뀌어 대체 경로로 수집합니다 — 수집 개수를 꼭 확인해 주세요`, 'warning');
      if (flags) flags.usedContainerFallback = true;
    }

    if (scrollHeight === -1) {
      // 하드코딩 셀렉터도 폴백 탐색도 실패 — '완료'로 위장하지 말고 명시적 오류로 알린다.
      console.log(`[NaverPagination]   ⚠️ scroll container를 찾을 수 없습니다.`);
      if (sendLog) sendLog(`[오류] 네이버 화면 구조가 바뀌어 리뷰 목록을 스크롤할 수 없습니다 — 앱 업데이트가 필요합니다`, 'error');
      if (flags) flags.endedByNoContainer = true;
      setTermination('no_scroll_container');
      break;
    }

    // 새 리뷰 로드 대기
    await new Promise(resolve => setTimeout(resolve, SCROLL_WAIT_MS));

    const newCount = await getReviewCount(page);

    // scrollHeight 변화 감지
    if (scrollHeight === lastScrollHeight) {
      stableScrollCount++;
    } else {
      stableScrollCount = 0;
      lastScrollHeight = scrollHeight;
    }

    // 리뷰 개수 변화 감지
    if (newCount === lastReviewCount) {
      stableCountCount++;
    } else {
      stableCountCount = 0;
      lastReviewCount = newCount;
    }

    if (newCount !== currentCount) {
      console.log(`[NaverPagination]   📈 시도 ${attempt + 1}: ${currentCount} → ${newCount} (scrollHeight=${scrollHeight})`);
      lastProgressAt = Date.now();
      stallRetryIdx = 0; // 다시 늘어남 = 동결 해소, 재시도 예산 회복
      if (backoffIdx > 0) {
        // 속도제한 대기 후 실제로 다시 늘어남 = 이어받기 성공
        console.log(`[NaverPagination]   ▶️ 속도제한 해제 확인 — 수집 재개 (${currentCount} → ${newCount})`);
        if (sendLog) sendLog(`[재개] 네이버 속도제한이 풀려 수집을 이어갑니다 (${newCount}개째)`, 'success');
        if (flags) flags.resumedAfterRateLimit = (flags.resumedAfterRateLimit || 0) + 1;
        backoffIdx = 0; // 다음 차단 때 다시 30초부터
      }
    }

    // 진단 — 매 시도 결과 push (chunk 단위로 묶어서)
    if (diagnostic) {
      diagnostic.scrollAttempts.push({
        chunk: chunkNum,
        attempt: attempt + 1,
        before: currentCount,
        after: newCount,
        delta: newCount - currentCount,
        scrollHeight,
      });
    }

    currentCount = newCount;

    // 종료 의심 — 추가 대기로 lazy load 응답 한 번 더 확인
    if (stableScrollCount >= STABLE_THRESHOLD && stableCountCount >= STABLE_THRESHOLD) {
      console.log(`[NaverPagination]   🤔 ${STABLE_THRESHOLD}회 연속 동결 감지 — ${STABLE_RECHECK_WAIT_MS}ms 추가 대기 후 재확인`);
      await new Promise(resolve => setTimeout(resolve, STABLE_RECHECK_WAIT_MS));
      const recheckHeight = (await probeContainer(false)).scrollHeight;
      const recheckCount = await getReviewCount(page);

      if (recheckHeight !== lastScrollHeight || recheckCount !== currentCount) {
        // 늦게 도착함 → 카운트 리셋하고 계속 스크롤
        console.log(`[NaverPagination]   🔄 추가 대기 후 변동 감지 (height: ${lastScrollHeight}→${recheckHeight}, count: ${currentCount}→${recheckCount}) — 종료 보류, 스크롤 계속`);
        stableScrollCount = 0;
        stableCountCount = 0;
        if (recheckHeight !== -1) lastScrollHeight = recheckHeight;
        currentCount = recheckCount;
        lastReviewCount = recheckCount;
        continue;
      }

      // 동결 확정 — 원인 판별: 마지막 진행 이후 429가 관측됐으면 "리뷰 끝"이 아니라 "차단"이다
      const stalledByRateLimit = rateLimit.last429At >= lastProgressAt;

      if (stalledByRateLimit && backoffIdx < backoffScheduleMs.length) {
        // Retry-After가 스케줄보다 길면 서버 지시를 따른다
        const waitMs = Math.max(backoffScheduleMs[backoffIdx], (rateLimit.retryAfterSec || 0) * 1000);
        rateLimit.retryAfterSec = 0;
        backoffIdx++;
        const waitSec = Math.round(waitMs / 1000);
        console.log(`[NaverPagination]   🚦 동결 원인 = 속도제한(429 누적 ${rateLimit.hits}회) — ${waitSec}초 대기 후 이어받기 (${backoffIdx}/${backoffScheduleMs.length}차)`);
        if (sendLog) sendLog(`[대기] 네이버 속도제한(429) 감지 — ${waitSec}초 대기 후 이어받습니다 (${backoffIdx}/${backoffScheduleMs.length}차, 현재 ${currentCount}개)`, 'warning');
        totalBackoffMs += waitMs;
        await new Promise(resolve => setTimeout(resolve, waitMs));

        // 로더 재점화 (429를 맞은 네이버 프론트는 재요청을 멈추는 것으로 관측됨 — 라이브 실측)
        await retriggerLoader();

        stableScrollCount = 0;
        stableCountCount = 0;
        continue;
      }

      if (stalledByRateLimit) {
        // 대기 스케줄 전부 소진 — 부분수집으로 정직하게 종료 (조용한 "완료" 위장 금지)
        console.log(`[NaverPagination]   🛑 속도제한이 풀리지 않아 중단합니다 (429 누적 ${rateLimit.hits}회, 대기 ${Math.round(totalBackoffMs / 1000)}초 소진) — 부분수집 ${currentCount}개`);
        if (sendLog) sendLog(`[경고] 네이버 속도제한이 풀리지 않아 수집을 중단합니다 — ${currentCount}개까지 수집됨 (부분수집)`, 'warning');
        if (flags) flags.endedByRateLimit = true;
        setTermination('rate_limit_giveup');
        break;
      }

      // 429가 아닌 동결 — "약 7초 무변동 = 리뷰 끝"으로 단정하지 않는다.
      // 네이버 lazy-load가 일시 정지/실패했을 수 있으므로 재점화 + 긴 대기로 최대 2회 더 확인한다.
      //
      // ★UI 등급 주의: '진짜 끝'과 '동결'은 코드상 구별 불가라, «전량 수집에 성공한 마지막 청크»도
      //   반드시 이 경로를 탄다. 즉 1차 재시도는 정상 완주에서도 항상 발생한다.
      //   → 1차는 «info»(마무리 확인 중), 2차부터 «warning»(정말 안 불러와짐)으로 등급을 나눈다.
      //     (성공 화면에 주황 경고 2건이 뜨던 문제)
      if (stallRetryIdx < STALL_RETRY_WAITS_MS.length) {
        const waitMs = STALL_RETRY_WAITS_MS[stallRetryIdx];
        stallRetryIdx++;
        const waitSec = Math.round(waitMs / 1000);
        console.log(`[NaverPagination]   ⏸️ 동결 감지(429 아님) — ${waitSec}초 대기 후 재점화 재시도 (${stallRetryIdx}/${STALL_RETRY_WAITS_MS.length}, 현재 ${currentCount}개)`);
        if (sendLog) {
          if (stallRetryIdx === 1) {
            sendLog(`[진행] 마지막 리뷰까지 확인 중... (${waitSec}초, 현재 ${currentCount}개)`, 'info');
          } else {
            sendLog(`[대기] 리뷰가 더 안 불러와집니다 — ${waitSec}초 기다렸다 재시도 ${stallRetryIdx}/${STALL_RETRY_WAITS_MS.length} (현재 ${currentCount}개)`, 'warning');
          }
        }
        totalBackoffMs += waitMs; // 재시도 대기는 시간예산에 미산입 (429 대기와 동일 원칙)
        await new Promise(resolve => setTimeout(resolve, waitMs));
        await retriggerLoader();
        stableScrollCount = 0;
        stableCountCount = 0;
        continue;
      }

      console.log(`[NaverPagination]   🛑 더 이상 리뷰가 로드되지 않습니다 (시도 ${attempt + 1}회, 재점화 ${stallRetryIdx}회 후에도 변동 없음)`);
      if (flags) flags.endedByStall = true;
      setTermination('stable_threshold');
      break;
    }
  }
  } finally {
    page.off('response', onResponse);
    if (flags) flags.rateLimitHits = (flags.rateLimitHits || 0) + rateLimit.hits;
  }

  // for 소진(MAX_ATTEMPTS) 경로는 어떤 사유도 남기지 않는 유일한 구멍이었다 — 여기서 마지막으로 기록
  if (!terminationReason) setTermination('attempts_exhausted');

  console.log(`[NaverPagination] ✅ 무한 스크롤 완료. 최종 리뷰 개수: ${currentCount} (종료 사유: ${terminationReason})`);
  return currentCount;
}

/**
 * 다음 페이지 존재 여부 확인 (호환용 — 모달은 무한 스크롤이라 항상 false 반환)
 * naverService.js의 기존 호출부를 안전하게 처리하기 위함.
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<boolean>} 항상 false
 */
export async function hasNextPage(page) {
  return false;
}

/**
 * 다음 페이지로 이동 (호환용 — 모달은 무한 스크롤이라 항상 false 반환)
 * naverService.js의 기존 호출부를 안전하게 처리하기 위함.
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetPage - 이동할 페이지 번호
 * @returns {Promise<boolean>} 항상 false
 */
export async function navigateToNextPage(page, targetPage) {
  console.log(`[NaverPagination] 모달 무한 스크롤 모드: navigateToNextPage 호출 무시 (page ${targetPage})`);
  return false;
}
