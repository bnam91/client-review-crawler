/**
 * 네이버 네비게이션 관련 함수들
 */
import { REVIEW } from './naverSelectors.js';

/**
 * 페이지를 천천히 스크롤하여 리뷰 영역이 보이도록 함
 * @param {object} page - Puppeteer page 객체
 */
async function scrollUntilOpenButtonVisible(page) {
  console.log('[NaverNavigation] 📜 "리뷰 전체보기" 버튼이 보일 때까지 스크롤 중...');
  await page.evaluate(async (openText) => {
    const isVisible = () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some(b => (b.textContent || '').trim() === openText);
    };

    let lastScrollY = -1;
    let stableCount = 0;
    for (let i = 0; i < 30; i++) {
      if (isVisible()) return true;
      window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
      await new Promise(r => setTimeout(r, 400));
      if (window.scrollY === lastScrollY) {
        stableCount++;
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
        lastScrollY = window.scrollY;
      }
    }
    return isVisible();
  }, REVIEW.openModalButtonText);
}

/**
 * "리뷰 전체보기" 버튼을 찾아 클릭하고 리뷰 모달 dialog가 등장할 때까지 대기
 * @param {object} page - Puppeteer page 객체
 * @param {number} timeoutMs - 모달 대기 타임아웃 (기본 10초)
 * @returns {Promise<boolean>} 모달 표출 성공 여부
 */
export async function openReviewModal(page, timeoutMs = 10000) {
  console.log('[NaverNavigation] 🔎 "리뷰 전체보기" 버튼을 찾는 중...');

  // 1. 페이지 스크롤로 버튼 노출
  await scrollUntilOpenButtonVisible(page);

  // 2. 버튼 클릭 (텍스트 매칭)
  const clicked = await page.evaluate((openText) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => (b.textContent || '').trim() === openText);
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, REVIEW.openModalButtonText);

  if (!clicked) {
    console.log('[NaverNavigation] ❌ "리뷰 전체보기" 버튼을 찾지 못했습니다.');
    return false;
  }

  console.log('[NaverNavigation] ✅ "리뷰 전체보기" 버튼 클릭 완료. 모달 대기 중...');

  // 3. role="dialog" 중 li[id^="REVIEW_ITEM_"] 가진 dialog가 등장할 때까지 폴링
  const start = Date.now();
  const pollInterval = 300;
  while (Date.now() - start < timeoutMs) {
    const exists = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      return dialogs.some(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
    });
    if (exists) {
      console.log('[NaverNavigation] ✅ 리뷰 모달이 표시되었습니다.');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.log('[NaverNavigation] ❌ 리뷰 모달이 시간 내에 나타나지 않았습니다.');
  return false;
}

/**
 * 리뷰 모달을 닫고 사라질 때까지 대기
 * @param {object} page - Puppeteer page 객체
 * @param {number} timeoutMs - 대기 타임아웃 (기본 5초)
 */
export async function closeReviewModal(page, timeoutMs = 5000) {
  console.log('[NaverNavigation] 🚪 리뷰 모달 닫기 시도...');

  await page.evaluate((closeSel) => {
    const btn = document.querySelector(closeSel);
    if (btn) btn.click();
  }, REVIEW.closeButtonSelector);

  const start = Date.now();
  const pollInterval = 200;
  while (Date.now() - start < timeoutMs) {
    const stillOpen = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      return dialogs.some(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
    });
    if (!stillOpen) {
      console.log('[NaverNavigation] ✅ 리뷰 모달이 닫혔습니다.');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.log('[NaverNavigation] ⚠️ 리뷰 모달 닫힘을 확인하지 못했습니다.');
  return false;
}

/**
 * 네이버 메인 페이지로 이동하고 검색 입력 필드가 나타날 때까지 대기
 */
export async function navigateToNaver(page) {
  console.log('[NaverNavigation] 네이버 메인 페이지로 이동 중...');
  
  // 1. 네이버 메인 페이지로 이동 (네트워크 안정화까지 대기)
  await page.goto('https://www.naver.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
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

