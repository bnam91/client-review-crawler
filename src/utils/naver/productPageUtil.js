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
 * @param {function} sendLog - 로그 전송 함수 (선택)
 * @returns {Promise<{success: boolean, reason?: string}>} 검증 결과
 */
export async function waitForProductPageToLoad(page, expectedBaseUrl, maxWaitSeconds = 60, sendLog = null) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  let captchaDetected = false; // 캡챠 감지 여부 추적
  
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
    let hasError = false;
    try {
      hasError = await page.evaluate(() => {
        const errorElement = document.querySelector('.Rzm9BSYr_X');
        if (errorElement) {
          const errorText = errorElement.textContent || '';
          return errorText.includes('상품이 존재하지 않습니다') || 
                 errorText.includes('상품이 삭제되었거나');
        }
        return false;
      });
    } catch (evaluateError) {
      // Execution context destroyed 에러는 페이지 네비게이션으로 인한 것이므로 무시
      if (evaluateError.message && evaluateError.message.includes('Execution context was destroyed')) {
        console.log('[NaverProductPageUtil] 페이지 네비게이션 중...');
        hasError = false;
      } else {
        throw evaluateError;
      }
    }
    
    if (hasError) {
      console.log('[NaverProductPageUtil] ⚠️ 에러 메시지 감지, 사라질 때까지 대기 중...');
      
      // 에러 메시지가 사라질 때까지 대기
      let errorDisappeared = false;
      while (Date.now() - startTime < maxWaitMs) {
        let stillHasError = false;
        try {
          stillHasError = await page.evaluate(() => {
            const errorElement = document.querySelector('.Rzm9BSYr_X');
            if (errorElement) {
              const errorText = errorElement.textContent || '';
              return errorText.includes('상품이 존재하지 않습니다') || 
                     errorText.includes('상품이 삭제되었거나');
            }
            return false;
          });
        } catch (evaluateError) {
          // Execution context destroyed 에러는 페이지 네비게이션으로 인한 것이므로 무시하고 계속 진행
          if (evaluateError.message && evaluateError.message.includes('Execution context was destroyed')) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
          throw evaluateError;
        }
        
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
      
      // 캡챠 페이지 감지 (로그만 표시하고 계속 진행)
      let hasCaptcha = false;
      try {
        hasCaptcha = await page.evaluate(() => {
          // 캡챠 관련 요소 확인
          const captchaMain = document.querySelector('[data-component="cpt_main"]');
          const captchaWrap = document.querySelector('.captcha_wrap');
          const rcptForm = document.getElementById('rcpt_form');
          const vcptForm = document.getElementById('vcpt_form');
          
          return !!(captchaMain || captchaWrap || rcptForm || vcptForm);
        });
      } catch (evaluateError) {
        // Execution context destroyed 에러는 페이지 네비게이션으로 인한 것이므로 무시하고 계속 진행
        if (evaluateError.message && evaluateError.message.includes('Execution context was destroyed')) {
          // 페이지가 이동 중이므로 잠시 대기 후 다시 시도
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        // 다른 에러는 다시 throw
        throw evaluateError;
      }
      
      if (hasCaptcha) {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        const remainingSeconds = Math.max(0, maxWaitSeconds - elapsedSeconds);
        
        if (!captchaDetected) {
          // 처음 감지된 경우에만 로그 추가
          const captchaMessage = '[⚠️ 캡챠 감지] 캡챠 페이지가 감지되었습니다. 브라우저에서 확인해주세요.';
          console.log(captchaMessage);
          if (sendLog) {
            sendLog(captchaMessage, 'warning');
          }
          captchaDetected = true;
        } else {
          // 이미 감지된 경우 카운트다운으로 업데이트
          const captchaMessage = `[⚠️ 캡챠 감지] 캡챠 페이지가 감지되었습니다. 브라우저에서 확인해주세요. (대기 중... ${remainingSeconds}초)`;
          if (sendLog) {
            sendLog(captchaMessage, 'warning', true); // true는 업데이트 플래그
          }
        }
        // 에러를 반환하지 않고 계속 대기 (캡챠 해결을 기다림)
      } else if (captchaDetected) {
        // 캡챠가 사라진 경우
        captchaDetected = false;
        if (sendLog) {
          sendLog('[✅ 캡챠 해결] 캡챠 페이지가 해결되었습니다. 계속 진행합니다.', 'success', true);
        }
      }
      
      // 정상 로딩 요소 확인
      let validElementsInfo;
      try {
        validElementsInfo = await page.evaluate(() => {
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
          return { valid: false, reason: '상품 가격이 올바르게 표시되지 않았습니다', title: titleText, price: priceText };
        }
        
        return { valid: true, title: titleText, price: priceText };
        });
      } catch (evaluateError) {
        // Execution context destroyed 에러는 페이지 네비게이션으로 인한 것이므로 무시하고 계속 진행
        if (evaluateError.message && evaluateError.message.includes('Execution context was destroyed')) {
          // 페이지가 이동 중이므로 잠시 대기 후 다시 시도
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        // 다른 에러는 다시 throw
        throw evaluateError;
      }
      
      if (validElementsInfo.valid) {
        const logMessage1 = '[NaverProductPageUtil] ✅ 정상 로딩 요소가 나타났습니다.';
        const logMessage2 = `[NaverProductPageUtil]   - 상품 제목: ${validElementsInfo.title}`;
        const logMessage3 = `[NaverProductPageUtil]   - 상품 가격: ${validElementsInfo.price}`;
        
        console.log(logMessage1);
        console.log(logMessage2);
        console.log(logMessage3);
        
        if (sendLog) {
          sendLog(logMessage1, 'success');
          sendLog(logMessage2);
          sendLog(logMessage3);
        }
        
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
    // Execution context destroyed 에러는 페이지 네비게이션으로 인한 것이므로 정상적인 상황으로 처리
    if (error.message && error.message.includes('Execution context was destroyed')) {
      console.log('[NaverProductPageUtil] 페이지 네비게이션으로 인한 context 파괴 (정상적인 상황)');
      // 페이지가 이동한 것으로 간주하고, URL 확인 후 계속 진행
      try {
        const currentUrl = page.url();
        const currentBaseUrl = getBaseUrl(currentUrl);
        if (currentBaseUrl === expectedBaseUrl) {
          // 같은 페이지로 이동한 경우 성공으로 간주
          return { success: true };
        }
      } catch (urlError) {
        // URL 확인 실패 시에도 계속 진행
      }
      // 네비게이션 중이므로 잠시 대기 후 재시도 가능하도록 false 반환 (하지만 에러 메시지는 표시하지 않음)
      return {
        success: false,
        reason: '페이지 네비게이션 중입니다. 잠시 후 다시 시도해주세요.'
      };
    }
    
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
    
    // 0. 캡챠 페이지 확인 (로그만 표시하고 계속 진행)
    const hasCaptcha = await page.evaluate(() => {
      const captchaMain = document.querySelector('[data-component="cpt_main"]');
      const captchaWrap = document.querySelector('.captcha_wrap');
      const rcptForm = document.getElementById('rcpt_form');
      const vcptForm = document.getElementById('vcpt_form');
      
      return !!(captchaMain || captchaWrap || rcptForm || vcptForm);
    });
    
    // 캡챠가 감지되어도 에러를 반환하지 않고 계속 진행 (로그는 naverService에서 표시)
    
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
      
      return { valid: true, title: titleText.trim(), price: priceText.trim() };
    });
    
    if (!hasValidElements.valid) {
      return {
        success: false,
        reason: hasValidElements.reason || '상품 정보를 확인할 수 없습니다'
      };
    }
    
    return {
      success: true,
      title: hasValidElements.title,
      price: hasValidElements.price
    };
    
  } catch (error) {
    console.error('[NaverProductPageUtil] 상품 페이지 검증 중 오류:', error);
    return {
      success: false,
      reason: `검증 중 오류 발생: ${error.message}`
    };
  }
}

