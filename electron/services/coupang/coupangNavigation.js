/**
 * 쿠팡 네비게이션
 * 실제 DOM 분석 기반 (2025)
 *
 * 탭 구조:
 *   <div class="twc-sticky ...">
 *     <a>상품상세</a>
 *     <a>상품평 (N)</a>   ← 클릭 대상
 *     <a>상품문의</a>
 *   </div>
 *
 * productId: URL pathname /vp/products/{productId}
 */

export function createCoupangSearchUrl(query) {
  return `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(query)}`;
}

export function isCoupangProductPage(url) {
  return url.includes('coupang.com/vp/products/');
}

/**
 * URL에서 productId 추출
 */
export async function extractProductId(page) {
  return await page.evaluate(() => {
    const match = window.location.pathname.match(/\/products\/(\d+)/);
    return match ? match[1] : null;
  });
}

/**
 * 상품 페이지 로딩 확인
 */
export async function verifyCoupangProductPageLoaded(page) {
  try {
    await page.waitForSelector(
      '.prod-buy-header__title, .prod-title, h1[class*="title"], .pdp-product-title, #prod-buy-header',
      { timeout: 15000 }
    );
    const title = await page.evaluate(() => {
      const el = document.querySelector(
        '.prod-buy-header__title, .prod-title, h1[class*="title"], .pdp-product-title'
      );
      return el?.textContent?.trim() ?? null;
    });
    return { success: true, title };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * 검색 결과에서 상품 페이지로 이동될 때까지 대기
 */
export async function waitForCoupangProductPage(browser, page, sendLog) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('상품 페이지 대기 시간 초과 (120초)'));
    }, 120000);

    function cleanup() {
      clearTimeout(timeout);
      browser.off('targetcreated', onTargetCreated);
      page.off('framenavigated', onNavigated);
    }

    async function checkPage(targetPage) {
      const url = targetPage.url();
      if (isCoupangProductPage(url)) {
        cleanup();
        sendLog?.('[완료] 쿠팡 상품 페이지 도착', 'success');
        resolve({ url, page: targetPage });
      }
    }

    async function onTargetCreated(target) {
      if (target.type() === 'page') {
        const newPage = await target.page();
        newPage.once('load', () => checkPage(newPage));
      }
    }

    async function onNavigated(frame) {
      if (frame === page.mainFrame()) await checkPage(page);
    }

    browser.on('targetcreated', onTargetCreated);
    page.on('framenavigated', onNavigated);
    sendLog?.('[안내] 검색 결과에서 원하는 상품을 클릭해주세요.', 'info');
  });
}

/**
 * 상품평 탭 클릭 및 리뷰 섹션 스크롤
 * (정렬은 API 파라미터로 처리하므로 DOM 클릭 불필요)
 */
export async function clickCoupangReviewTab(page, sendLog) {
  sendLog?.('[진행] 상품평 탭으로 이동 중...', 'info');

  try {
    // #prod-review-nav-link 또는 "상품평" 텍스트 링크 클릭
    const clicked = await page.evaluate(() => {
      // 방법 1: sticky nav 안의 "상품평" 포함 a 태그
      const links = Array.from(document.querySelectorAll('a'));
      const reviewLink = links.find(a => a.textContent.trim().startsWith('상품평'));
      if (reviewLink) { reviewLink.click(); return '상품평 링크 클릭'; }

      // 방법 2: #prod-review-nav-link
      const navLink = document.querySelector('#prod-review-nav-link');
      if (navLink) { navLink.click(); return 'prod-review-nav-link 클릭'; }

      // 방법 3: #sdpReview 스크롤
      const sdp = document.querySelector('#sdpReview');
      if (sdp) { sdp.scrollIntoView({ behavior: 'smooth' }); return 'sdpReview 스크롤'; }

      return null;
    });

    if (clicked) {
      console.log('[CoupangNavigation]', clicked);
      sendLog?.('[완료] 상품평 탭 이동 완료', 'success');
    } else {
      sendLog?.('[경고] 상품평 탭을 찾을 수 없습니다.', 'warning');
    }

    await new Promise(r => setTimeout(r, 1500));

  } catch (e) {
    console.error('[CoupangNavigation] 탭 클릭 실패:', e.message);
    sendLog?.(`[경고] 탭 이동 실패: ${e.message}`, 'warning');
  }
}

/**
 * 상품문의 탭 클릭 (미래 QnA 수집용 - 현재 미구현)
 */
export async function clickCoupangQnaTab(page, sendLog) {
  sendLog?.('[진행] 상품문의 탭으로 이동 중...', 'info');
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const qnaLink = links.find(a => a.textContent.trim() === '상품문의');
    if (qnaLink) qnaLink.click();
    else {
      const qnaEl = document.querySelector('#btf-qna');
      if (qnaEl) qnaEl.scrollIntoView({ behavior: 'smooth' });
    }
  });
  await new Promise(r => setTimeout(r, 1500));
}
