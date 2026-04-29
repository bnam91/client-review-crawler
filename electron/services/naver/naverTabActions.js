/**
 * 네이버 탭 클릭 및 정렬 옵션 관련 함수들
 *
 * 리뉴얼 후 리뷰는 모달 안에서 정렬 처리.
 * Q&A는 기존처럼 a[data-name="QNA"] 탭을 클릭한다.
 */
import { REVIEW } from './naverSelectors.js';
import { openReviewModal } from './naverNavigation.js';

/**
 * 모달 내부 정렬 옵션 적용
 * @param {object} page - Puppeteer page 객체
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순, 3: 평점높은순
 */
export async function setSortOption(page, sortOption) {
  // sortOption을 숫자로 변환 (문자열로 전달될 수 있음)
  const sortNum = typeof sortOption === 'string' ? parseInt(sortOption, 10) : sortOption;
  const sortNames = ['랭킹순', '최신순', '평점낮은순', '평점높은순'];
  console.log(`[NaverTabActions] 🔧 정렬 옵션 설정 중... (받은 값: ${sortOption}, 변환 후: ${sortNum}, ${sortNames[sortNum] || '알 수 없음'})`);

  try {
    // 정렬 옵션 로딩을 위해 잠시 대기 (모달 안 정렬 컨트롤이 마운트되도록)
    console.log('[NaverTabActions] ⏳ 정렬 컨트롤 로딩을 위해 1.5초 대기...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 0(랭킹순)은 기본값이므로 skip
    if (sortNum === 0) {
      console.log('[NaverTabActions] 랭킹순 정렬 (기본값) — 별도 처리 없음');
      return;
    }

    let targetText = '';
    if (sortNum === 1) targetText = REVIEW.sortOptionTextLatest;
    else if (sortNum === 2) targetText = REVIEW.sortOptionTextLow;
    else if (sortNum === 3) targetText = REVIEW.sortOptionTextHigh;
    else {
      console.log(`[NaverTabActions] ⚠️ 알 수 없는 정렬 옵션: ${sortNum}`);
      return;
    }

    console.log(`[NaverTabActions] '${targetText}' 정렬 적용 중...`);

    // 현재 정렬 라벨 텍스트 (변경 확인용)
    const beforeLabel = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || '').trim() : '';
    }, REVIEW.currentSortLabel);

    const clicked = await page.evaluate((btnSel, txt) => {
      const buttons = Array.from(document.querySelectorAll(btnSel));
      const btn = buttons.find(b => (b.textContent || '').trim() === txt);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, REVIEW.sortOptionButton, targetText);

    if (!clicked) {
      console.log(`[NaverTabActions] ⚠️ '${targetText}' 정렬 버튼을 찾을 수 없습니다.`);
      return;
    }

    console.log(`[NaverTabActions] ✅ '${targetText}' 클릭 완료. 라벨 변경 확인 중...`);

    // 정렬 적용 후 라벨 변경 확인 (최대 5초 폴링)
    const start = Date.now();
    let labelChanged = false;
    while (Date.now() - start < 5000) {
      const afterLabel = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent || '').trim() : '';
      }, REVIEW.currentSortLabel);

      if (afterLabel && afterLabel !== beforeLabel) {
        console.log(`[NaverTabActions] ✅ 정렬 라벨 변경 확인: '${beforeLabel}' → '${afterLabel}'`);
        labelChanged = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!labelChanged) {
      console.log(`[NaverTabActions] ⚠️ 정렬 라벨 변경을 확인하지 못했습니다.`);
    }

    // 정렬 적용 후 리스트 갱신 대기
    await new Promise(resolve => setTimeout(resolve, 1500));

  } catch (e) {
    console.log(`[NaverTabActions] ❌ 정렬 옵션 처리 중 오류: ${e.message}`);
  }
}

/**
 * 리뷰 또는 Q&A 진입
 * - 리뷰(0): "리뷰 전체보기" 버튼 클릭 → role="dialog" 모달 진입
 * - Q&A(1): a[data-name="QNA"] 탭 클릭 (기존 흐름 유지)
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 */
export async function clickReviewOrQnATab(page, collectionType, sortOption = 0) {
  // sortOption을 숫자로 변환 (문자열로 전달될 수 있음)
  const sortNum = typeof sortOption === 'string' ? parseInt(sortOption, 10) : (sortOption || 0);
  const sortNames = ['랭킹순', '최신순', '평점낮은순', '평점높은순'];

  if (collectionType === 0) {
    // 리뷰: 모달 진입
    console.log(`[NaverTabActions] 🔍 리뷰 모달 진입 중... (sortOption: ${sortOption}, 변환 후: ${sortNum}, ${sortNames[sortNum] || '알 수 없음'})`);

    try {
      // 페이지 안정화 대기
      await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 1500));

      const opened = await openReviewModal(page);
      if (!opened) {
        throw new Error('리뷰 모달을 열 수 없습니다.');
      }

      console.log('[NaverTabActions] ✅ 리뷰 모달 진입 완료');

      // 모달 내부 정렬 적용
      console.log(`[NaverTabActions] 정렬 옵션 적용 - sortOption: ${sortOption}, 변환 후: ${sortNum} (${sortNames[sortNum] || '알 수 없음'})`);
      await setSortOption(page, sortNum);

      // 정렬 적용 후 리뷰 로딩 대기
      console.log('[NaverTabActions] ⏳ 정렬 적용 후 리뷰 로딩 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.log(`[NaverTabActions] ❌ 리뷰 모달 진입 실패: ${e.message}`);
    }
    return;
  }

  // Q&A: 기존 탭 클릭 흐름
  const tabName = 'QNA';
  const tabLabel = 'Q&A';
  const selector = `a[data-name="${tabName}"]`;

  console.log(`[NaverTabActions] 🔍 ${tabLabel} 탭을 찾는 중...`);

  try {
    // 페이지가 완전히 로드될 때까지 대기
    await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 2000));

    // 1. 페이지 하단으로 스크롤
    console.log('[NaverTabActions] 📜 페이지 하단으로 스크롤 중...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // 스크롤 후 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Q&A 탭 선택자 대기
    await page.waitForSelector(selector, {
      timeout: 10000,
      visible: true
    });

    console.log(`[NaverTabActions] ✅ ${tabLabel} 탭을 찾았습니다.`);

    // 3. JavaScript로 탭 클릭
    const clickSuccess = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.click();
        return true;
      }
      return false;
    }, selector);

    if (clickSuccess) {
      console.log(`[NaverTabActions] ✅ ${tabLabel} 탭을 클릭했습니다.`);
    } else {
      throw new Error('탭 요소를 찾을 수 없습니다.');
    }

    // 클릭 후 대기
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. 탭 활성화 확인
    console.log(`[NaverTabActions] 🔍 ${tabLabel} 탭 활성화 상태를 확인합니다...`);
    const isActive = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        return element.getAttribute('aria-current') === 'true';
      }
      return false;
    }, selector);

    if (isActive) {
      console.log(`[NaverTabActions] ✅ ${tabLabel} 탭이 성공적으로 활성화되었습니다.`);
    } else {
      console.log(`[NaverTabActions] ⚠️ ${tabLabel} 탭 활성화 상태를 확인할 수 없습니다.`);
    }

  } catch (e) {
    console.log(`[NaverTabActions] ❌ ${tabLabel} 탭 클릭 실패: ${e.message}`);
    console.log('[NaverTabActions] 🔄 JavaScript로 직접 클릭을 시도합니다...');

    try {
      const clickSuccess = await page.evaluate((sel) => {
        window.scrollTo(0, document.body.scrollHeight);
        const element = document.querySelector(sel);
        if (element) {
          element.click();
          return true;
        }
        return false;
      }, selector);

      if (clickSuccess) {
        console.log(`[NaverTabActions] ✅ JavaScript로 ${tabLabel} 탭을 클릭했습니다.`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        throw new Error('탭 요소를 찾을 수 없습니다.');
      }
    } catch (e2) {
      console.log(`[NaverTabActions] ❌ JavaScript 클릭도 실패: ${e2.message}`);
    }
  }
}
