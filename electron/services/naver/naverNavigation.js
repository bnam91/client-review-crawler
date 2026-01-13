/**
 * 네이버 네비게이션 관련 함수들
 */

/**
 * 네이버 메인 페이지로 이동하고 검색 입력 필드가 나타날 때까지 대기
 */
export async function navigateToNaver(page) {
  console.log('[NaverNavigation] 네이버 메인 페이지로 이동 중...');
  
  // 1. 네이버 메인 페이지로 이동 (네트워크 안정화까지 대기)
  await page.goto('https://www.naver.com', { 
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  
  console.log('[NaverNavigation] 네이버 메인 페이지 로드 완료');
  
  // 2. 검색 입력 필드가 나타날 때까지 대기 (최대 10초)
  await page.waitForSelector('input#query, input[name="query"], input[type="search"]', { 
    timeout: 10000 
  });
  
  console.log('[NaverNavigation] 검색 입력 필드 확인 완료');
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
export function isNaverProductPage(url) {
  return (
    (url.includes('smartstore.naver.com') || url.includes('brand.naver.com')) &&
    url.includes('/products/')
  );
}

/**
 * 사용자가 네이버 상품 페이지로 이동할 때까지 대기
 * smartstore.naver.com 또는 brand.naver.com/products/ URL을 감지하면 즉시 진행
 * @param {object} browser - Puppeteer browser 객체
 * @param {object} page - Puppeteer page 객체
 * @param {function} sendLog - 로그 전송 함수 (선택)
 */
export async function waitForNaverProductPage(browser, page, sendLog = null) {
  const maxWaitSeconds = 120;
  const startTime = Date.now();
  let countdownInterval = null;
  
  const initialMessage = `[NaverNavigation] 상품 페이지 이동 대기 중... (최대 ${maxWaitSeconds}초)`;
  console.log(initialMessage);
  if (sendLog) {
    sendLog(initialMessage, 'info');
  }
  
  // 카운트다운 업데이트 함수
  const updateCountdown = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const remainingSeconds = Math.max(0, maxWaitSeconds - elapsedSeconds);
    const countdownMessage = `[NaverNavigation] 상품 페이지 이동 대기 중... (${remainingSeconds}초 남음)`;
    
    if (sendLog && remainingSeconds > 0) {
      sendLog(countdownMessage, 'info', true); // updateLast=true로 같은 라인 업데이트
    }
  };
  
  // 1초마다 카운트다운 업데이트
  if (sendLog) {
    countdownInterval = setInterval(updateCountdown, 1000);
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
      reject(new Error('상품 페이지 이동 대기 시간(120초)이 초과되었습니다.'));
    }, 120000); // 120초 타임아웃
    
    const cleanup = () => {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
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
        console.warn('[NaverNavigation] browser 리스너 제거 중 오류:', e.message);
      }
      
      try {
        if (page && typeof page.off === 'function') {
          page.off('framenavigated', onFrameNavigated);
        } else if (page && typeof page.removeListener === 'function') {
          page.removeListener('framenavigated', onFrameNavigated);
        }
      } catch (e) {
        console.warn('[NaverNavigation] page 리스너 제거 중 오류:', e.message);
      }
    };
    
    // 현재 페이지의 URL 변경 감지
    const onFrameNavigated = (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        console.log('[NaverNavigation] 페이지 URL 변경:', url);
        
        if (isNaverProductPage(url)) {
          console.log('[NaverNavigation] 상품 페이지 감지:', url);
          if (sendLog) {
            sendLog('[NaverNavigation] ✅ 상품 페이지 이동 완료', 'success', true);
          }
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
          console.log('[NaverNavigation] 새 탭 감지, URL 확인 중...');
          
          // 새 페이지의 네비게이션 이벤트 리스너 추가 (먼저 등록)
          const onNewPageNavigated = async (frame) => {
            if (frame === newPage.mainFrame()) {
              const frameUrl = frame.url();
              console.log('[NaverNavigation] 새 탭 URL 변경:', frameUrl);
              
              if (isNaverProductPage(frameUrl)) {
                console.log('[NaverNavigation] 새 탭에서 상품 페이지 감지:', frameUrl);
                if (sendLog) {
                  sendLog('[NaverNavigation] ✅ 상품 페이지 이동 완료', 'success', true);
                }
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
            console.log('[NaverNavigation] 새 탭 URL:', url);
            
            if (isNaverProductPage(url)) {
              console.log('[NaverNavigation] 새 탭에서 상품 페이지 감지 (초기 확인):', url);
              if (sendLog) {
                sendLog('[NaverNavigation] ✅ 상품 페이지 이동 완료', 'success', true);
              }
              cleanup();
              
              // 새 페이지로 전환
              await newPage.bringToFront();
              // newPage를 반환하여 이후 탭 클릭에 사용할 수 있도록 함
              resolve({ url, page: newPage });
            }
          } catch (e) {
            console.warn('[NaverNavigation] 새 탭 URL 확인 중 오류:', e.message);
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
      console.log('[NaverNavigation] 이미 상품 페이지에 있습니다:', currentUrl);
      if (sendLog) {
        sendLog('[NaverNavigation] ✅ 상품 페이지 이동 완료', 'success', true);
      }
      cleanup();
      resolve({ url: currentUrl, page: page });
    }
  });
}

