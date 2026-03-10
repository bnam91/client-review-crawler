/**
 * 쿠팡 리뷰 페이지네이션
 * 실제 DOM 분석 기반 (2024-2025 기준)
 *
 * 구조:
 *   - #sdpReview 내 button 요소들 (텍스트: "1"~"10", ">>" 등)
 *   - AJAX 방식 (URL 변경 없음)
 *   - 한 번에 10개 페이지 버튼 노출, 다음 그룹은 ">>" 버튼
 */

/**
 * 현재 페이지 이후 페이지가 있는지 확인
 * @param {object} page - Puppeteer page
 * @param {number} currentPage - 현재 페이지 번호
 * @returns {Promise<boolean>}
 */
export async function hasNextPage(page, currentPage) {
  try {
    return await page.evaluate((current) => {
      const sdpReview = document.querySelector('#sdpReview');
      if (!sdpReview) return false;

      const buttons = Array.from(sdpReview.querySelectorAll('button'));

      // 현재 페이지보다 큰 숫자 버튼이 있으면 다음 페이지 있음
      const hasLargerPage = buttons.some(btn => {
        const num = parseInt(btn.textContent.trim(), 10);
        return !isNaN(num) && num > current;
      });
      if (hasLargerPage) return true;

      // ">>" (다음 그룹) 버튼 존재 확인
      const hasNextGroup = buttons.some(btn => {
        const text = btn.textContent.trim();
        return text === '>>' || text === '>' || text.includes('다음') ||
               btn.getAttribute('aria-label')?.includes('다음');
      });
      return hasNextGroup;
    }, currentPage);
  } catch (e) {
    console.error('[CoupangPagination] hasNextPage 오류:', e.message);
    return false;
  }
}

/**
 * 다음 페이지 버튼 클릭 후 리뷰 로딩 대기
 * @param {object} page - Puppeteer page
 * @param {number} targetPage - 이동할 페이지 번호
 * @returns {Promise<boolean>} 성공 여부
 */
export async function navigateToNextPage(page, targetPage) {
  try {
    // 클릭 전 첫 번째 리뷰어 이름 저장 (변경 감지용)
    const beforeName = await page.evaluate(() => {
      return document.querySelector('#sdpReview article span[data-member-id]')?.textContent?.trim() || '';
    });

    const clicked = await page.evaluate((target) => {
      const sdpReview = document.querySelector('#sdpReview');
      if (!sdpReview) return { success: false, reason: 'no sdpReview' };

      const buttons = Array.from(sdpReview.querySelectorAll('button'));

      // 숫자 버튼에서 targetPage 찾기
      const pageBtn = buttons.find(btn => parseInt(btn.textContent.trim(), 10) === target);
      if (pageBtn) {
        pageBtn.click();
        return { success: true, method: `page-button-${target}` };
      }

      // ">>" 버튼 (다음 그룹으로 이동)
      const nextGroupBtn = buttons.find(btn => {
        const text = btn.textContent.trim();
        return text === '>>' || text === '>' || btn.getAttribute('aria-label')?.includes('다음');
      });
      if (nextGroupBtn) {
        nextGroupBtn.click();
        return { success: true, method: 'next-group' };
      }

      return { success: false, reason: `button ${target} not found` };
    }, targetPage);

    if (!clicked.success) {
      console.log(`[CoupangPagination] ⚠️ 페이지 ${targetPage} 버튼 없음: ${clicked.reason}`);
      return false;
    }

    // 리뷰 내용이 바뀔 때까지 대기 (최대 8초)
    let changed = false;
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      const afterName = await page.evaluate(() => {
        return document.querySelector('#sdpReview article span[data-member-id]')?.textContent?.trim() || '';
      });
      if (afterName && afterName !== beforeName) {
        changed = true;
        break;
      }
    }

    if (changed) {
      console.log(`[CoupangPagination] ✅ 페이지 ${targetPage} 이동 완료 (방법: ${clicked.method})`);
    } else {
      // 내용 변경이 감지 안 돼도 클릭 성공이면 계속 진행
      console.log(`[CoupangPagination] ⚠️ 페이지 ${targetPage} 내용 변경 미감지, 계속 진행`);
    }

    return true;
  } catch (e) {
    console.error('[CoupangPagination] navigateToNextPage 오류:', e.message);
    return false;
  }
}
