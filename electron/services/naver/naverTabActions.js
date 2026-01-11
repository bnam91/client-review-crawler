/**
 * 네이버 탭 클릭 및 정렬 옵션 관련 함수들
 */

/**
 * 정렬 옵션 적용
 * @param {object} page - Puppeteer page 객체
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 */
export async function setSortOption(page, sortOption) {
  console.log('[NaverTabActions] 🔧 정렬 옵션을 설정합니다...');
  
  try {
    // 정렬 옵션 로딩을 위해 3초 대기
    console.log('[NaverTabActions] ⏳ 정렬 옵션 로딩을 위해 3초 대기...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    if (sortOption === 1) {
      // 최신순 정렬
      console.log('[NaverTabActions] 최신순 정렬 적용 중...');
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('a'));
        const button = buttons.find(btn => btn.textContent && btn.textContent.includes('최신순'));
        if (button) {
          button.click();
          return true;
        }
        return false;
      });
      
      if (clicked) {
        console.log('[NaverTabActions] ✅ 최신순 정렬이 적용되었습니다.');
      } else {
        console.log('[NaverTabActions] ⚠️ 최신순 정렬 버튼을 찾을 수 없습니다.');
      }
    } else if (sortOption === 2) {
      // 평점 낮은순 정렬
      console.log('[NaverTabActions] 평점 낮은순 정렬 적용 중...');
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('a'));
        const button = buttons.find(btn => btn.textContent && btn.textContent.includes('평점 낮은순'));
        if (button) {
          button.click();
          return true;
        }
        return false;
      });
      
      if (clicked) {
        console.log('[NaverTabActions] ✅ 평점 낮은순 정렬이 적용되었습니다.');
      } else {
        console.log('[NaverTabActions] ⚠️ 평점 낮은순 정렬 버튼을 찾을 수 없습니다.');
      }
    } else {
      // 랭킹순은 기본값이라 별도 처리 없음
      console.log('[NaverTabActions] 랭킹순 정렬 (기본값)');
    }
    
    // 정렬 적용 후 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (e) {
    console.log(`[NaverTabActions] ❌ 정렬 옵션 처리 중 오류: ${e.message}`);
  }
}

/**
 * 리뷰 또는 Q&A 탭 클릭
 * @param {object} page - Puppeteer page 객체
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 */
export async function clickReviewOrQnATab(page, collectionType, sortOption = 0) {
  const tabName = collectionType === 0 ? 'REVIEW' : 'QNA';
  const tabLabel = collectionType === 0 ? '리뷰' : 'Q&A';
  const selector = `a[data-name="${tabName}"]`;
  
  console.log(`[NaverTabActions] 🔍 ${tabLabel} 탭을 찾는 중...`);
  
  try {
    // 페이지가 완전히 로드될 때까지 대기
    await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 1. 페이지 하단으로 스크롤 (파이썬 코드와 동일한 방식)
    console.log('[NaverTabActions] 📜 페이지 하단으로 스크롤 중...');
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
    
    console.log(`[NaverTabActions] ✅ ${tabLabel} 탭을 찾았습니다.`);
    
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
      console.log(`[NaverTabActions] ✅ ${tabLabel} 탭을 클릭했습니다.`);
    } else {
      throw new Error('탭 요소를 찾을 수 없습니다.');
    }
    
    // 클릭 후 대기
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. 리뷰 탭 활성화 확인 (aria-current="true" 속성 확인)
    console.log('[NaverTabActions] 🔍 리뷰 탭 활성화 상태를 확인합니다...');
    const isActive = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        return element.getAttribute('aria-current') === 'true';
      }
      return false;
    }, selector);
    
    if (isActive) {
      console.log('[NaverTabActions] ✅ 리뷰 탭이 성공적으로 활성화되었습니다.');
      
      // 리뷰 수집일 때만 정렬 옵션 적용
      if (collectionType === 0) {
        await setSortOption(page, sortOption);
      }
    } else {
      console.log('[NaverTabActions] ⚠️ 리뷰 탭 활성화 상태를 확인할 수 없습니다.');
    }
    
  } catch (e) {
    console.log(`[NaverTabActions] ❌ ${tabLabel} 탭 클릭 실패: ${e.message}`);
    console.log('[NaverTabActions] 🔄 JavaScript로 직접 클릭을 시도합니다...');
    
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
        console.log(`[NaverTabActions] ✅ JavaScript로 ${tabLabel} 탭을 클릭했습니다.`);
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
          console.log('[NaverTabActions] ✅ 리뷰 탭이 성공적으로 활성화되었습니다.');
          
          // 리뷰 수집일 때만 정렬 옵션 적용
          if (collectionType === 0) {
            await setSortOption(page, sortOption);
          }
        } else {
          console.log('[NaverTabActions] ⚠️ 리뷰 탭 활성화 상태를 확인할 수 없습니다.');
        }
      } else {
        throw new Error('탭 요소를 찾을 수 없습니다.');
      }
    } catch (e2) {
      console.log(`[NaverTabActions] ❌ JavaScript 클릭도 실패: ${e2.message}`);
    }
  }
}

