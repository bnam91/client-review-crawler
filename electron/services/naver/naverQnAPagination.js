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
 *   3) MAX_ATTEMPTS(200)회 시도 또는 MAX_DURATION_MS(600s) 초과
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetCount - 목표 Q&A 개수 (기본 Infinity)
 * @returns {Promise<number>} 최종 Q&A 개수
 */
export async function loadMoreQnAs(page, targetCount = Infinity) {
  console.log(`[NaverQnAPagination] ♾️ Q&A 무한 스크롤 시작 (목표: ${targetCount === Infinity ? '전체' : targetCount}개)`);

  const MAX_ATTEMPTS = 200;
  const MAX_DURATION_MS = 600000;
  const SCROLL_WAIT_MS = 1500;
  const STABLE_RECHECK_WAIT_MS = 2500;
  const STABLE_THRESHOLD = 3;

  const startTime = Date.now();
  let lastScrollHeight = -1;
  let lastQnACount = -1;
  let stableScrollCount = 0;
  let stableCountCount = 0;

  let currentCount = await getQnACount(page);
  console.log(`[NaverQnAPagination]   📊 시작 Q&A 개수: ${currentCount}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (Date.now() - startTime > MAX_DURATION_MS) {
      console.log(`[NaverQnAPagination]   ⏱️ 최대 대기 시간(${MAX_DURATION_MS}ms) 초과로 종료`);
      break;
    }

    if (currentCount >= targetCount) {
      console.log(`[NaverQnAPagination]   🎯 목표 Q&A 개수(${targetCount}) 도달`);
      break;
    }

    // 스크롤 + scrollHeight 반환
    const scrollHeight = await scrollQnAModalToBottom(page);

    if (scrollHeight === -1) {
      console.log(`[NaverQnAPagination]   ⚠️ scroll container/모달을 찾을 수 없습니다.`);
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
        currentCount = recheckCount;
        lastQnACount = recheckCount;
        continue;
      }

      console.log(`[NaverQnAPagination]   🛑 더 이상 Q&A가 로드되지 않습니다 (시도 ${attempt + 1}회, 추가 대기로도 변동 없음)`);
      break;
    }
  }

  console.log(`[NaverQnAPagination] ✅ Q&A 무한 스크롤 완료. 최종 Q&A 개수: ${currentCount}`);
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
