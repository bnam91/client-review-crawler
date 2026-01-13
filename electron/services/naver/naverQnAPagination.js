/**
 * 네이버 Q&A 페이지네이션 관련 함수들
 * Q&A 페이지네이션은 리뷰 페이지네이션과 다름:
 * - 처음에는 1-10 페이지가 보이고 "다음" 버튼이 있음
 * - 10페이지 도달 후 "다음" 버튼을 누르면 11-20 페이지가 나타남
 * - "이전" 버튼과 함께 11이 선택되어 있음
 * - 20 크롤링 완료 후 "다음" 버튼을 누르면 21이 선택됨
 */

/**
 * 현재 페이지 번호 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<number|null>} 현재 페이지 번호 또는 null
 */
async function getCurrentQnAPageNumber(page) {
  console.log('[NaverQnAPagination] 📍 현재 Q&A 페이지를 확인합니다...');
  
  try {
    const pageNumber = await page.evaluate(() => {
      // 현재 페이지는 aria-current="true"인 요소
      const currentPageElement = document.querySelector('a.F0MhmLrV2F[aria-current="true"]');
      if (currentPageElement && currentPageElement.textContent) {
        const text = currentPageElement.textContent.trim();
        const num = parseInt(text);
        return isNaN(num) ? null : num;
      }
      return null;
    });
    
    if (pageNumber !== null) {
      console.log(`[NaverQnAPagination]   ✅ 현재 페이지: ${pageNumber}`);
      return pageNumber;
    }
    
    console.log('[NaverQnAPagination]   ⚠️ 현재 페이지를 찾을 수 없습니다.');
    return null;
  } catch (e) {
    console.log(`[NaverQnAPagination]   ❌ 현재 페이지 확인 실패: ${e.message}`);
    return null;
  }
}

/**
 * 다음 페이지로 이동 (Q&A 전용)
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetPage - 이동할 페이지 번호
 * @returns {Promise<boolean>} 이동 성공 여부
 */
export async function navigateToNextQnAPage(page, targetPage) {
  console.log(`[NaverQnAPagination] 🔍 Q&A 페이지 ${targetPage}로 이동을 시도합니다...`);
  
  // 현재 페이지 확인
  const currentPage = await getCurrentQnAPageNumber(page);
  
  if (currentPage === null) {
    console.log(`[NaverQnAPagination]   ⚠️ 현재 페이지를 확인할 수 없어 페이지 이동을 시도합니다.`);
  } else {
    console.log(`[NaverQnAPagination]   현재 페이지: ${currentPage}, 목표 페이지: ${targetPage}`);
  }
  
  let pageClicked = false;

  // 페이지네이션 영역이 보이도록 스크롤 다운
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 스크롤 이동 실패: ${e.message}`);
  }
  
  // 페이지네이션 컨테이너가 렌더될 시간을 잠시 대기
  try {
    await page.waitForSelector('div[role="menubar"][data-shp-inventory="qna"]', { timeout: 3000 });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 페이지네이션 컨테이너 대기 실패: ${e.message}`);
  }

  // 1. 먼저 페이지 번호 버튼 클릭 시도 (현재 페이지네이션에 있는 경우)
  console.log(`[NaverQnAPagination]     📄 페이지 번호 버튼을 찾는 중...`);
  try {
    const clicked = await page.evaluate((targetPageNum) => {
      // 페이지네이션 컨테이너 내의 모든 페이지 번호 버튼 찾기
      const paginationContainer = document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS, div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS');
      if (!paginationContainer) return false;
      
      const pageButtons = paginationContainer.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]');
      for (const button of pageButtons) {
        if (button.textContent) {
          const text = button.textContent.trim();
          if (/^\d+$/.test(text) && parseInt(text) === targetPageNum) {
            button.click();
            return true;
          }
        }
      }
      return false;
    }, targetPage);
    
    if (clicked) {
      pageClicked = true;
      console.log(`[NaverQnAPagination]     ✅ 페이지 ${targetPage} 번호 버튼을 클릭했습니다.`);
    } else {
      console.log(`[NaverQnAPagination]     ⚠️ 페이지 ${targetPage} 번호 버튼을 찾을 수 없습니다.`);
    }
  } catch (e) {
    console.log(`[NaverQnAPagination]     ❌ 페이지 번호 클릭 실패: ${e.message}`);
  }
  
  // 2. 페이지 번호 버튼이 없으면 "다음" 버튼 클릭 시도
  if (!pageClicked) {
    console.log(`[NaverQnAPagination]     🔄 다음 버튼을 찾는 중...`);
    try {
      const clicked = await page.evaluate(() => {
        // 페이지네이션 컨테이너 내의 "다음" 버튼 찾기 (컨테이너가 여러 클래스일 수 있어 OR 선택)
        const paginationContainer = document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS, div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS, div[role=\"menubar\"][data-shp-inventory=\"qna\"]');

        const tryClickNext = (root) => {
          if (!root) return false;
          const nextButtons = root.querySelectorAll('a.g58k3AtMIx.jFLfdWHAWX');
          for (const button of nextButtons) {
            const ariaHidden = button.getAttribute('aria-hidden');
            const ariaDisabled = button.getAttribute('aria-disabled');
            const buttonText = button.textContent || '';
            if (buttonText.includes('다음') && ariaDisabled !== 'true' && ariaHidden !== 'true') {
              button.click();
              return true;
            }
          }
          return false;
        };

        // 1) 컨테이너 내에서 시도
        if (tryClickNext(paginationContainer)) return true;

        // 2) 컨테이너를 못 찾았을 때 전역에서 "다음" 텍스트를 가진 버튼 시도
        const allAnchors = document.querySelectorAll('a');
        for (const a of allAnchors) {
          const text = (a.textContent || '').trim();
          if (text.includes('다음')) {
            const ariaHidden = a.getAttribute('aria-hidden');
            const ariaDisabled = a.getAttribute('aria-disabled');
            if (ariaDisabled !== 'true' && ariaHidden !== 'true') {
              a.click();
              return true;
            }
          }
        }
        return false;
      });
      
      if (clicked) {
        pageClicked = true;
        console.log(`[NaverQnAPagination]     ✅ 다음 버튼을 클릭했습니다.`);
      } else {
        console.log(`[NaverQnAPagination]     ⚠️ 다음 버튼을 찾을 수 없습니다.`);
      }
    } catch (e) {
      console.log(`[NaverQnAPagination]     ❌ 다음 버튼 클릭 실패: ${e.message}`);
    }
  }
  
  if (!pageClicked) {
    console.log(`[NaverQnAPagination]     ❌ 페이지 ${targetPage}로 이동할 수 없습니다.`);
    return false;
  }
  
  // 페이지 로딩을 위해 대기 (2~4초)
  const waitTime = Math.random() * 2 + 2; // 2~4초
  console.log(`[NaverQnAPagination]     ⏳ 페이지 로딩을 위해 ${waitTime.toFixed(1)}초 대기...`);
  await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
  // 클릭 후 페이지네이션 영역이 다시 렌더되도록 스크롤 유지
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 클릭 후 스크롤 이동 실패: ${e.message}`);
  }
  
  // 이동 후 현재 페이지 확인
  const newCurrentPage = await getCurrentQnAPageNumber(page);
  if (newCurrentPage !== null && newCurrentPage === targetPage) {
    console.log(`[NaverQnAPagination]     ✅ 페이지 ${targetPage}로 이동 확인 완료.`);
    return true;
  } else if (newCurrentPage !== null && newCurrentPage !== currentPage) {
    console.log(`[NaverQnAPagination]     ⚠️ 페이지 이동 후 현재 페이지: ${newCurrentPage} (목표: ${targetPage})`);
    // 다른 페이지로 이동했으면 성공으로 간주
    return true;
  } else {
    console.log(`[NaverQnAPagination]     ❌ 페이지 이동 실패(현재=${newCurrentPage}, 목표=${targetPage})`);
    return false;
  }
}

/**
 * Q&A 페이지네이션이 가능한지 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<boolean>} 페이지네이션 가능 여부
 */
export async function hasNextQnAPage(page) {
  try {
    const hasNext = await page.evaluate(() => {
      const paginationContainer = document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS, div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS, div[role="menubar"][data-shp-inventory="qna"]');

      // 현재 페이지 번호/다음 버튼 탐색을 위한 헬퍼
      const getCurrentPage = (root) => {
        const currentEl = root?.querySelector?.('a.F0MhmLrV2F[aria-current="true"]');
        if (currentEl?.textContent) {
          const num = parseInt(currentEl.textContent.trim());
          if (!isNaN(num)) return num;
        }
        return 1;
      };

      // 1) 페이지네이션 컨테이너 기반 체크
      if (paginationContainer) {
        const pageButtons = paginationContainer.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]');
        const pageNumbers = [];
        pageButtons.forEach(btn => {
          const text = btn.textContent?.trim();
          if (text && /^\d+$/.test(text)) pageNumbers.push(parseInt(text));
        });
        const maxPage = pageNumbers.length > 0 ? Math.max(...pageNumbers) : null;
        const currentPage = getCurrentPage(paginationContainer);

        // "다음" 버튼 존재 여부
        const nextButtons = paginationContainer.querySelectorAll('a.g58k3AtMIx.jFLfdWHAWX');
        for (const button of nextButtons) {
          const buttonText = (button.textContent || '').trim();
          const ariaHidden = button.getAttribute('aria-hidden');
          const ariaDisabled = button.getAttribute('aria-disabled');
          if (buttonText.includes('다음') && ariaHidden !== 'true' && ariaDisabled !== 'true') {
            return true;
          }
        }

        // 현재 페이지보다 큰 번호가 존재하면 다음 페이지 가능
        if (maxPage !== null && maxPage > currentPage) {
          return true;
        }
      }

      // 2) 컨테이너가 없거나 실패한 경우, 전역 fallback: 텍스트에 "다음"이 포함된 링크 탐색
      const allAnchors = document.querySelectorAll('a');
      for (const a of allAnchors) {
        const text = (a.textContent || '').trim();
        if (text.includes('다음')) {
          const ariaHidden = a.getAttribute('aria-hidden');
          const ariaDisabled = a.getAttribute('aria-disabled');
          if (ariaDisabled !== 'true' && ariaHidden !== 'true') {
            return true;
          }
        }
      }

      return false;
    });
    
    return hasNext;
  } catch (e) {
    console.log(`[NaverQnAPagination] 다음 페이지 확인 실패: ${e.message}`);
    return false;
  }
}

