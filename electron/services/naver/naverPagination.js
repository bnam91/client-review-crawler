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
 *   3) max 200회 시도 또는 max 90초 (대량 리뷰 상품 대비)
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetCount - 목표 리뷰 개수 (기본 Infinity)
 * @returns {Promise<number>} 최종 리뷰 개수
 */
export async function loadMoreReviews(page, targetCount = Infinity) {
  console.log(`[NaverPagination] ♾️ 무한 스크롤 시작 (목표: ${targetCount === Infinity ? '전체' : targetCount}개)`);

  const MAX_ATTEMPTS = 200;            // 30→200 (대량 리뷰 대응)
  const MAX_DURATION_MS = 600000;      // 30s→600s (10분, 대량 리뷰 대응)
  const SCROLL_WAIT_MS = 1500;         // 800→1500 (느린 회선 안전)
  const STABLE_RECHECK_WAIT_MS = 2500; // 동결 의심 시 추가 한 번 대기 (lazy load 늦은 응답 대응)
  const STABLE_THRESHOLD = 3;          // 2→3회 연속 동결 필요

  const startTime = Date.now();
  let lastScrollHeight = -1;
  let lastReviewCount = -1;
  let stableScrollCount = 0;
  let stableCountCount = 0;

  let currentCount = await getReviewCount(page);
  console.log(`[NaverPagination]   📊 시작 리뷰 개수: ${currentCount}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 시간 초과 체크
    if (Date.now() - startTime > MAX_DURATION_MS) {
      console.log(`[NaverPagination]   ⏱️ 최대 대기 시간(${MAX_DURATION_MS}ms) 초과로 종료`);
      break;
    }

    // 목표 도달 체크
    if (currentCount >= targetCount) {
      console.log(`[NaverPagination]   🎯 목표 리뷰 개수(${targetCount}) 도달`);
      break;
    }

    // 스크롤 컨테이너 끝까지 스크롤 + 현재 scrollHeight 반환
    const scrollHeight = await page.evaluate((containerSel) => {
      const container = document.querySelector(containerSel);
      if (!container) return -1;
      container.scrollTop = container.scrollHeight;
      return container.scrollHeight;
    }, REVIEW.scrollContainerSelector);

    if (scrollHeight === -1) {
      console.log(`[NaverPagination]   ⚠️ scroll container를 찾을 수 없습니다.`);
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
    }

    currentCount = newCount;

    // 종료 의심 — 추가 대기로 lazy load 응답 한 번 더 확인
    if (stableScrollCount >= STABLE_THRESHOLD && stableCountCount >= STABLE_THRESHOLD) {
      console.log(`[NaverPagination]   🤔 ${STABLE_THRESHOLD}회 연속 동결 감지 — ${STABLE_RECHECK_WAIT_MS}ms 추가 대기 후 재확인`);
      await new Promise(resolve => setTimeout(resolve, STABLE_RECHECK_WAIT_MS));
      const recheckHeight = await page.evaluate((sel) => {
        const c = document.querySelector(sel);
        return c ? c.scrollHeight : -1;
      }, REVIEW.scrollContainerSelector);
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

      console.log(`[NaverPagination]   🛑 더 이상 리뷰가 로드되지 않습니다 (시도 ${attempt + 1}회, 추가 대기로도 변동 없음)`);
      break;
    }
  }

  console.log(`[NaverPagination] ✅ 무한 스크롤 완료. 최종 리뷰 개수: ${currentCount}`);
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
