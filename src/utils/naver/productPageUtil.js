/**
 * 네이버 상품 페이지 검증 유틸리티
 */

/**
 * URL에서 기본 경로 추출 (파라미터 제거)
 * 예: https://smartstore.naver.com/ordi/products/293392287?query=test
 * -> https://smartstore.naver.com/ordi/products/293392287
 * @param {string} url - 전체 URL
 * @returns {string} 기본 경로
 */
function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    // URL 파싱 실패 시 원본 반환
    return url.split('?')[0];
  }
}

/**
 * 상품 페이지가 정상적으로 로드될 때까지 대기
 * 에러 메시지가 있으면 사라질 때까지 대기하고, 정상 요소가 나타날 때까지 감지
 * @param {object} page - Puppeteer page 객체
 * @param {string} expectedBaseUrl - 예상되는 기본 URL (파라미터 제외)
 * @param {number} maxWaitSeconds - 최대 대기 시간 (초)
 * @returns {Promise<{success: boolean, reason?: string}>} 검증 결과
 */
export async function waitForProductPageToLoad(page, expectedBaseUrl, maxWaitSeconds = 60) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  
  try {
    // 현재 URL의 기본 경로 확인
    const currentBaseUrl = getBaseUrl(page.url());
    if (currentBaseUrl !== expectedBaseUrl) {
      return {
        success: false,
        reason: `URL이 일치하지 않습니다. 예상: ${expectedBaseUrl}, 실제: ${currentBaseUrl}`
      };
    }
    
    console.log('[NaverProductPageUtil] 상품 페이지 로딩 대기 시작...');
    
    // 1. 에러 메시지가 있는지 확인
    const hasError = await page.evaluate(() => {
      const errorElement = document.querySelector('.Rzm9BSYr_X');
      if (errorElement) {
        const errorText = errorElement.textContent || '';
        return errorText.includes('상품이 존재하지 않습니다') || 
               errorText.includes('상품이 삭제되었거나');
      }
      return false;
    });
    
    if (hasError) {
      console.log('[NaverProductPageUtil] ⚠️ 에러 메시지 감지, 사라질 때까지 대기 중...');
      
      // 에러 메시지가 사라질 때까지 대기
      let errorDisappeared = false;
      while (Date.now() - startTime < maxWaitMs) {
        const stillHasError = await page.evaluate(() => {
          const errorElement = document.querySelector('.Rzm9BSYr_X');
          if (errorElement) {
            const errorText = errorElement.textContent || '';
            return errorText.includes('상품이 존재하지 않습니다') || 
                   errorText.includes('상품이 삭제되었거나');
          }
          return false;
        });
        
        if (!stillHasError) {
          errorDisappeared = true;
          console.log('[NaverProductPageUtil] ✅ 에러 메시지가 사라졌습니다. 정상 로딩 요소 대기 중...');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!errorDisappeared) {
        return {
          success: false,
          reason: '에러 메시지가 사라지지 않았습니다 (최대 대기 시간 초과)'
        };
      }
    }
    
    // 2. 정상 로딩 요소가 나타날 때까지 대기
    console.log('[NaverProductPageUtil] 정상 로딩 요소 감지 대기 중...');
    
    while (Date.now() - startTime < maxWaitMs) {
      // URL이 변경되었는지 확인
      const currentUrl = page.url();
      const currentBaseUrl = getBaseUrl(currentUrl);
      if (currentBaseUrl !== expectedBaseUrl) {
        return {
          success: false,
          reason: `URL이 변경되었습니다. 예상: ${expectedBaseUrl}, 실제: ${currentBaseUrl}`
        };
      }
      
      // 정상 로딩 요소 확인
      const hasValidElements = await page.evaluate(() => {
        // 상품 정보 컨테이너 확인 (.P2lBbUWPNi)
        const productContainer = document.querySelector('.P2lBbUWPNi');
        if (!productContainer) {
          return false;
        }
        
        // 제목 확인 (h3.DCVBehA8ZB)
        const titleElement = productContainer.querySelector('h3.DCVBehA8ZB');
        if (!titleElement) {
          return false;
        }
        
        const titleText = titleElement.textContent || '';
        if (!titleText || titleText.trim().length === 0) {
          return false;
        }
        
        // 가격 확인 (숫자와 "원"이 포함된 가격 표시)
        const priceElement = productContainer.querySelector('.Xu9MEKUuIo');
        if (!priceElement) {
          return false;
        }
        
        const priceText = priceElement.textContent || '';
        // 가격이 숫자와 "원"을 포함하는지 확인
        const hasPrice = /\d+/.test(priceText) && priceText.includes('원');
        
        return hasPrice;
      });
      
      if (hasValidElements) {
        console.log('[NaverProductPageUtil] ✅ 정상 로딩 요소가 나타났습니다.');
        return {
          success: true
        };
      }
      
      // 500ms마다 확인
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return {
      success: false,
      reason: '정상 로딩 요소가 나타나지 않았습니다 (최대 대기 시간 초과)'
    };
    
  } catch (error) {
    console.error('[NaverProductPageUtil] 상품 페이지 로딩 대기 중 오류:', error);
    return {
      success: false,
      reason: `대기 중 오류 발생: ${error.message}`
    };
  }
}

/**
 * 상품 페이지가 정상적으로 로드되었는지 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<{success: boolean, reason?: string}>} 검증 결과
 */
export async function verifyNaverProductPageLoaded(page) {
  try {
    // 페이지 로딩 대기
    await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 1. 에러 메시지 확인 ("상품이 존재하지 않습니다")
    const hasError = await page.evaluate(() => {
      const errorElement = document.querySelector('.Rzm9BSYr_X');
      if (errorElement) {
        const errorText = errorElement.textContent || '';
        return errorText.includes('상품이 존재하지 않습니다') || 
               errorText.includes('상품이 삭제되었거나');
      }
      return false;
    });
    
    if (hasError) {
      return {
        success: false,
        reason: '상품이 존재하지 않습니다'
      };
    }
    
    // 2. 정상 로딩 요소 확인
    const hasValidElements = await page.evaluate(() => {
      // 상품 정보 컨테이너 확인 (.P2lBbUWPNi)
      const productContainer = document.querySelector('.P2lBbUWPNi');
      if (!productContainer) {
        return { valid: false, reason: '상품 정보 컨테이너를 찾을 수 없습니다' };
      }
      
      // 제목 확인 (h3.DCVBehA8ZB)
      const titleElement = productContainer.querySelector('h3.DCVBehA8ZB');
      if (!titleElement) {
        return { valid: false, reason: '상품 제목을 찾을 수 없습니다' };
      }
      
      const titleText = titleElement.textContent || '';
      if (!titleText || titleText.trim().length === 0) {
        return { valid: false, reason: '상품 제목이 비어있습니다' };
      }
      
      // 가격 확인 (숫자와 "원"이 포함된 가격 표시)
      const priceElement = productContainer.querySelector('.Xu9MEKUuIo');
      if (!priceElement) {
        return { valid: false, reason: '상품 가격을 찾을 수 없습니다' };
      }
      
      const priceText = priceElement.textContent || '';
      // 가격이 숫자와 "원"을 포함하는지 확인
      const hasPrice = /\d+/.test(priceText) && priceText.includes('원');
      
      if (!hasPrice) {
        return { valid: false, reason: '상품 가격이 올바르게 표시되지 않았습니다' };
      }
      
      return { valid: true };
    });
    
    if (!hasValidElements.valid) {
      return {
        success: false,
        reason: hasValidElements.reason || '상품 정보를 확인할 수 없습니다'
      };
    }
    
    return {
      success: true
    };
    
  } catch (error) {
    console.error('[NaverProductPageUtil] 상품 페이지 검증 중 오류:', error);
    return {
      success: false,
      reason: `검증 중 오류 발생: ${error.message}`
    };
  }
}

