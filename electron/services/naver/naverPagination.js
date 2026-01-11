/**
 * 네이버 페이지네이션 관련 함수들
 */

/**
 * 현재 페이지 번호 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<number|null>} 현재 페이지 번호 또는 null
 */
async function getCurrentPageNumber(page) {
  const currentPageSelectors = [
    'a.hyY6CXtbcn[aria-current="true"]',
    'a[aria-current="true"]',
    '.pagination .active',
    '[aria-current="true"]'
  ];
  
  console.log('[NaverPagination] 📍 현재 페이지를 확인합니다...');
  
  for (const selector of currentPageSelectors) {
    try {
      const pageNumber = await page.evaluate((sel) => {
        const elem = document.querySelector(sel);
        if (elem && elem.textContent) {
          const text = elem.textContent.trim();
          const num = parseInt(text);
          return isNaN(num) ? null : num;
        }
        return null;
      }, selector);
      
      if (pageNumber !== null) {
        console.log(`[NaverPagination]   ✅ 현재 페이지: ${pageNumber}`);
        return pageNumber;
      }
    } catch (e) {
      continue;
    }
  }
  
  console.log('[NaverPagination]   ⚠️ 현재 페이지를 찾을 수 없습니다.');
  return null;
}

/**
 * 다음 페이지로 이동
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetPage - 이동할 페이지 번호
 * @returns {Promise<boolean>} 이동 성공 여부
 */
export async function navigateToNextPage(page, targetPage) {
  console.log(`[NaverPagination] 🔍 페이지 ${targetPage}로 이동을 시도합니다...`);
  
  const paginationSelectors = [
    'a.hyY6CXtbcn[aria-current="true"]',
    'a.hyY6CXtbcn',
    'a.JY2WGJ4hXh.I3i1NSoFdB',
    'a[aria-label="다음 페이지"]',
    'a[title="다음"]'
  ];
  
  // 현재 페이지 확인
  const currentPage = await getCurrentPageNumber(page);
  
  // 다음 페이지로 이동 시도
  console.log(`[NaverPagination]   🔄 다음 페이지로 이동을 시도합니다...`);
  let nextPageClicked = false;
  
  // 1. 다음 페이지 번호 버튼 클릭 시도
  console.log(`[NaverPagination]     📄 페이지 번호 버튼을 찾는 중...`);
  try {
    const clicked = await page.evaluate((targetPageNum) => {
      const nextPageElements = Array.from(document.querySelectorAll('a.hyY6CXtbcn[aria-current="false"]'));
      for (const elem of nextPageElements) {
        if (elem.textContent) {
          const text = elem.textContent.trim();
          if (/^\d+$/.test(text) && parseInt(text) === targetPageNum) {
            elem.click();
            return true;
          }
        }
      }
      return false;
    }, targetPage);
    
    if (clicked) {
      nextPageClicked = true;
      console.log(`[NaverPagination]     ✅ 페이지 ${targetPage}로 이동했습니다.`);
    } else {
      console.log(`[NaverPagination]     ❌ 페이지 ${targetPage} 번호 버튼을 찾을 수 없습니다.`);
    }
  } catch (e) {
    console.log(`[NaverPagination]     ❌ 페이지 번호 클릭 실패: ${e.message}`);
  }
  
  // 2. 다음 버튼 클릭 시도
  if (!nextPageClicked) {
    console.log(`[NaverPagination]     🔄 다음 버튼을 찾는 중...`);
    const nextButtonSelectors = [
      'a.JY2WGJ4hXh.I3i1NSoFdB',
      'a[aria-label="다음 페이지"]',
      'a[title="다음"]',
      'a[class*="next"]',
      '.pagination .next'
    ];
    
    for (const selector of nextButtonSelectors) {
      try {
        const clicked = await page.evaluate((sel) => {
          const nextButton = document.querySelector(sel);
          if (nextButton) {
            nextButton.click();
            return true;
          }
          return false;
        }, selector);
        
        if (clicked) {
          nextPageClicked = true;
          console.log(`[NaverPagination]     ✅ 다음 버튼을 클릭했습니다.`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  if (!nextPageClicked) {
    console.log(`[NaverPagination]     ❌ 다음 페이지로 이동할 수 없습니다.`);
    return false;
  }
  
  // 페이지 로딩을 위해 랜덤 대기 (2~4초)
  const waitTime = Math.random() * 2 + 2; // 2~4초
  console.log(`[NaverPagination]     ⏳ 페이지 로딩을 위해 ${waitTime.toFixed(1)}초 대기...`);
  await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
  
  return true;
}

/**
 * 페이지네이션이 가능한지 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<boolean>} 페이지네이션 가능 여부
 */
export async function hasNextPage(page) {
  try {
    const hasNext = await page.evaluate(() => {
      // 다음 페이지 번호 버튼 확인
      const nextPageElements = Array.from(document.querySelectorAll('a.hyY6CXtbcn[aria-current="false"]'));
      if (nextPageElements.length > 0) {
        return true;
      }
      
      // 다음 버튼 확인
      const nextButtonSelectors = [
        'a.JY2WGJ4hXh.I3i1NSoFdB',
        'a[aria-label="다음 페이지"]',
        'a[title="다음"]'
      ];
      
      for (const selector of nextButtonSelectors) {
        const nextButton = document.querySelector(selector);
        if (nextButton && !nextButton.disabled && nextButton.style.display !== 'none') {
          return true;
        }
      }
      
      return false;
    });
    
    return hasNext;
  } catch (e) {
    console.log(`[NaverPagination] 다음 페이지 확인 실패: ${e.message}`);
    return false;
  }
}

