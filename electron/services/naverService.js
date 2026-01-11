/**
 * 네이버 플랫폼 전용 서비스
 */
import { verifyNaverProductPageLoaded, waitForProductPageToLoad } from '../../src/utils/naver/productPageUtil.js';

/**
 * 네이버 메인 페이지로 이동하고 검색 입력 필드가 나타날 때까지 대기
 */
export async function navigateToNaver(page) {
  console.log('[NaverService] 네이버 메인 페이지로 이동 중...');
  
  // 1. 네이버 메인 페이지로 이동 (네트워크 안정화까지 대기)
  await page.goto('https://www.naver.com', { 
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  
  console.log('[NaverService] 네이버 메인 페이지 로드 완료');
  
  // 2. 검색 입력 필드가 나타날 때까지 대기 (최대 10초)
  await page.waitForSelector('input#query, input[name="query"], input[type="search"]', { 
    timeout: 10000 
  });
  
  console.log('[NaverService] 검색 입력 필드 확인 완료');
}

/**
 * 네이버 검색 페이지 URL 생성
 */
export function createNaverSearchUrl(query) {
  const encodedQuery = encodeURIComponent(query);
  return `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodedQuery}&ackey=ayy89dsf`;
}

/**
 * 네이버 상품 페이지 URL인지 확인
 * @param {string} url - 확인할 URL
 * @returns {boolean} 상품 페이지 여부
 */
function isNaverProductPage(url) {
  return (
    (url.includes('smartstore.naver.com') || url.includes('brand.naver.com')) &&
    url.includes('/products/')
  );
}

/**
 * 사용자가 네이버 상품 페이지로 이동할 때까지 대기
 * smartstore.naver.com 또는 brand.naver.com/products/ URL을 감지하면 즉시 진행
 */
export async function waitForNaverProductPage(browser, page) {
  console.log('[NaverService] 상품 페이지 이동 대기 중... (최대 120초)');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('상품 페이지 이동 대기 시간(120초)이 초과되었습니다.'));
    }, 120000); // 120초 타임아웃
    
    const cleanup = () => {
      clearTimeout(timeout);
      try {
        // Puppeteer의 Browser 객체는 EventEmitter를 상속받지만, 
        // removeListener 대신 off를 사용하거나 안전하게 처리
        if (browser && typeof browser.off === 'function') {
          browser.off('targetcreated', onTargetCreated);
        } else if (browser && typeof browser.removeListener === 'function') {
          browser.removeListener('targetcreated', onTargetCreated);
        }
      } catch (e) {
        console.warn('[NaverService] browser 리스너 제거 중 오류:', e.message);
      }
      
      try {
        if (page && typeof page.off === 'function') {
          page.off('framenavigated', onFrameNavigated);
        } else if (page && typeof page.removeListener === 'function') {
          page.removeListener('framenavigated', onFrameNavigated);
        }
      } catch (e) {
        console.warn('[NaverService] page 리스너 제거 중 오류:', e.message);
      }
    };
    
    // 현재 페이지의 URL 변경 감지
    const onFrameNavigated = (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        console.log('[NaverService] 페이지 URL 변경:', url);
        
        if (isNaverProductPage(url)) {
          console.log('[NaverService] 상품 페이지 감지:', url);
          cleanup();
          resolve({ url, page: page });
        }
      }
    };
    
    // 새 탭이 열릴 때 감지 및 전환
    const onTargetCreated = async (target) => {
      if (target.type() === 'page') {
        const newPage = await target.page();
        if (newPage) {
          console.log('[NaverService] 새 탭 감지, URL 확인 중...');
          
          // 새 페이지의 네비게이션 이벤트 리스너 추가 (먼저 등록)
          const onNewPageNavigated = async (frame) => {
            if (frame === newPage.mainFrame()) {
              const frameUrl = frame.url();
              console.log('[NaverService] 새 탭 URL 변경:', frameUrl);
              
              if (isNaverProductPage(frameUrl)) {
                console.log('[NaverService] 새 탭에서 상품 페이지 감지:', frameUrl);
                cleanup();
                await newPage.bringToFront();
                resolve({ url: frameUrl, page: newPage });
              }
            }
          };
          newPage.on('framenavigated', onNewPageNavigated);
          
          // 새 페이지의 초기 URL 확인 (약간의 지연 후)
          try {
            // 페이지가 로드될 때까지 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const url = newPage.url();
            console.log('[NaverService] 새 탭 URL:', url);
            
            if (isNaverProductPage(url)) {
              console.log('[NaverService] 새 탭에서 상품 페이지 감지 (초기 확인):', url);
              cleanup();
              
              // 새 페이지로 전환
              await newPage.bringToFront();
              // newPage를 반환하여 이후 탭 클릭에 사용할 수 있도록 함
              resolve({ url, page: newPage });
            }
          } catch (e) {
            console.warn('[NaverService] 새 탭 URL 확인 중 오류:', e.message);
            // 오류가 발생해도 framenavigated 리스너는 계속 작동
          }
        }
      }
    };
    
    // 이벤트 리스너 등록
    browser.on('targetcreated', onTargetCreated);
    page.on('framenavigated', onFrameNavigated);
    
    // 현재 페이지 URL도 확인 (이미 상품 페이지일 수 있음)
    const currentUrl = page.url();
    if (isNaverProductPage(currentUrl)) {
      console.log('[NaverService] 이미 상품 페이지에 있습니다:', currentUrl);
      cleanup();
      resolve({ url: currentUrl, page: page });
    }
  });
}


/**
 * 리뷰 또는 Q&A 탭 클릭
 * @param {object} page - Puppeteer page 객체
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 */
async function clickReviewOrQnATab(page, collectionType) {
  const tabName = collectionType === 0 ? 'REVIEW' : 'QNA';
  const tabLabel = collectionType === 0 ? '리뷰' : 'Q&A';
  const selector = `a[data-name="${tabName}"]`;
  
  console.log(`[NaverService] 🔍 ${tabLabel} 탭을 찾는 중...`);
  
  try {
    // 페이지가 완전히 로드될 때까지 대기
    await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 1. 페이지 하단으로 스크롤 (파이썬 코드와 동일한 방식)
    console.log('[NaverService] 📜 페이지 하단으로 스크롤 중...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    // 스크롤 후 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. 리뷰 탭 선택자 대기
    await page.waitForSelector(selector, { 
      timeout: 10000,
      visible: true 
    });
    
    console.log(`[NaverService] ✅ ${tabLabel} 탭을 찾았습니다.`);
    
    // 3. JavaScript로 탭 클릭 (파이썬 코드와 동일한 방식)
    const clickSuccess = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.click();
        return true;
      }
      return false;
    }, selector);
    
    if (clickSuccess) {
      console.log(`[NaverService] ✅ ${tabLabel} 탭을 클릭했습니다.`);
    } else {
      throw new Error('탭 요소를 찾을 수 없습니다.');
    }
    
    // 클릭 후 대기
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. 리뷰 탭 활성화 확인 (aria-current="true" 속성 확인)
    console.log('[NaverService] 🔍 리뷰 탭 활성화 상태를 확인합니다...');
    const isActive = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        return element.getAttribute('aria-current') === 'true';
      }
      return false;
    }, selector);
    
    if (isActive) {
      console.log('[NaverService] ✅ 리뷰 탭이 성공적으로 활성화되었습니다.');
    } else {
      console.log('[NaverService] ⚠️ 리뷰 탭 활성화 상태를 확인할 수 없습니다.');
    }
    
  } catch (e) {
    console.log(`[NaverService] ❌ ${tabLabel} 탭 클릭 실패: ${e.message}`);
    console.log('[NaverService] 🔄 JavaScript로 직접 클릭을 시도합니다...');
    
    try {
      // 대안: JavaScript로 직접 클릭 시도 (파이썬 코드와 동일)
      const clickSuccess = await page.evaluate((sel) => {
        // 페이지 하단으로 스크롤
        window.scrollTo(0, document.body.scrollHeight);
        
        const element = document.querySelector(sel);
        if (element) {
          element.click();
          return true;
        }
        return false;
      }, selector);
      
      if (clickSuccess) {
        console.log(`[NaverService] ✅ JavaScript로 ${tabLabel} 탭을 클릭했습니다.`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 활성화 확인
        const isActive = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (element) {
            return element.getAttribute('aria-current') === 'true';
          }
          return false;
        }, selector);
        
        if (isActive) {
          console.log('[NaverService] ✅ 리뷰 탭이 성공적으로 활성화되었습니다.');
        } else {
          console.log('[NaverService] ⚠️ 리뷰 탭 활성화 상태를 확인할 수 없습니다.');
        }
      } else {
        throw new Error('탭 요소를 찾을 수 없습니다.');
      }
    } catch (e2) {
      console.log(`[NaverService] ❌ JavaScript 클릭도 실패: ${e2.message}`);
    }
  }
}

/**
 * 네이버 플랫폼 처리 메인 함수
 * @param {object} browser - Puppeteer browser 객체
 * @param {object} page - Puppeteer page 객체
 * @param {string} input - URL 또는 검색어
 * @param {boolean} isUrl - URL 여부
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 */
export async function handleNaver(browser, page, input, isUrl, collectionType = 0) {
  // 1. 먼저 네이버 메인 페이지로 이동
  await navigateToNaver(page);
  
  // 2. 입력값이 URL인지 검색어인지 판단
  let targetUrl;
  if (isUrl) {
    // URL인 경우 새 탭 열고 해당 URL로 이동
    targetUrl = input;
    console.log('[NaverService] URL로 인식, 새 탭에서 해당 URL로 이동:', targetUrl);
    
    // 새 탭 열기
    const newPage = await browser.newPage();
    await newPage.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[NaverService] 새 탭에서 URL로 이동 완료:', targetUrl);
    
    // 상품 페이지인지 확인하고 리뷰/Q&A 탭으로 이동
    const currentUrl = newPage.url();
    if (isNaverProductPage(currentUrl)) {
      console.log('[NaverService] 상품 페이지 확인, 정상 로딩 확인 중...');
      
      // 상품 페이지 정상 로딩 확인
      const verificationResult = await verifyNaverProductPageLoaded(newPage);
      
      if (!verificationResult.success) {
        console.log(`[NaverService] ⚠️ 상품 페이지 로딩 실패: ${verificationResult.reason || '알 수 없는 오류'}`);
        console.log('[NaverService] 에러 메시지가 사라지고 정상 로딩 요소가 나타날 때까지 대기 중...');
        
        // URL 기본 경로 추출 (파라미터 제거)
        const baseUrl = currentUrl.split('?')[0];
        
        // 에러 메시지가 사라지고 정상 로딩 요소가 나타날 때까지 대기
        const waitResult = await waitForProductPageToLoad(newPage, baseUrl, 60);
        
        if (!waitResult.success) {
          console.log(`[NaverService] ⚠️ 상품 페이지 로딩 대기 실패: ${waitResult.reason || '알 수 없는 오류'}`);
        } else {
          console.log('[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료');
        }
      } else {
        console.log('[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료');
      }
      
      await clickReviewOrQnATab(newPage, collectionType);
      
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
      };
    }
    
    return {
      success: true,
      message: '브라우저에서 페이지를 열었습니다.',
      isUrl: true,
      platform: '네이버',
      finalUrl: targetUrl,
    };
  } else {
    // 검색어인 경우 검색 페이지 URL 생성
    targetUrl = createNaverSearchUrl(input);
    console.log('[NaverService] 검색어로 인식, 새 탭에서 검색 페이지로 이동:', targetUrl);
    
    // 3. 새 탭 열고 검색 페이지로 이동
    const newPage = await browser.newPage();
    await newPage.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[NaverService] 네이버 검색 페이지로 이동 완료:', targetUrl);
    
    // 4. 상품 페이지로 이동할 때까지 대기
    try {
      const result = await waitForNaverProductPage(browser, newPage);
      const productUrl = result.url || result; // 호환성을 위해 둘 다 처리
      const productPage = result.page || newPage; // 실제 상품 페이지 객체
      
      console.log('[NaverService] 상품 페이지 도착:', productUrl);
      
      // 5. 상품 페이지 정상 로딩 확인
      const verificationResult = await verifyNaverProductPageLoaded(productPage);
      
      if (!verificationResult.success) {
        console.log(`[NaverService] ⚠️ 상품 페이지 로딩 실패: ${verificationResult.reason || '알 수 없는 오류'}`);
        console.log('[NaverService] 에러 메시지가 사라지고 정상 로딩 요소가 나타날 때까지 대기 중...');
        
        // URL 기본 경로 추출 (파라미터 제거)
        const baseUrl = productUrl.split('?')[0];
        
        // 에러 메시지가 사라지고 정상 로딩 요소가 나타날 때까지 대기
        const waitResult = await waitForProductPageToLoad(productPage, baseUrl, 60);
        
        if (!waitResult.success) {
          console.log(`[NaverService] ⚠️ 상품 페이지 로딩 대기 실패: ${waitResult.reason || '알 수 없는 오류'}`);
        } else {
          console.log('[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료');
        }
      } else {
        console.log('[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료');
      }
      
      // 6. 리뷰 또는 Q&A 탭으로 이동
      await clickReviewOrQnATab(productPage, collectionType);
      
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: false,
        platform: '네이버',
        searchQuery: input,
        searchUrl: targetUrl,
        productUrl: productUrl,
        collectionType: collectionType,
      };
    } catch (error) {
      console.error('[NaverService] 상품 페이지 대기 중 오류:', error);
      return {
        success: false,
        error: error.message || '상품 페이지로 이동하지 못했습니다.',
        platform: '네이버',
        searchUrl: targetUrl,
      };
    }
  }
}

