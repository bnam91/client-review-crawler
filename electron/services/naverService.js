/**
 * 네이버 플랫폼 전용 서비스
 */
import { verifyNaverProductPageLoaded, waitForProductPageToLoad } from '../../src/utils/naver/productPageUtil.js';
import { navigateToNaver, createNaverSearchUrl, isNaverProductPage, waitForNaverProductPage } from './naver/naverNavigation.js';
import { clickReviewOrQnATab } from './naver/naverTabActions.js';
import { extractAllReviews } from './naver/naverReviewExtractor.js';
import { navigateToNextPage, hasNextPage } from './naver/naverPagination.js';

/**
 * 네이버 플랫폼 처리 메인 함수
 * @param {object} browser - Puppeteer browser 객체
 * @param {object} page - Puppeteer page 객체
 * @param {string} input - URL 또는 검색어
 * @param {boolean} isUrl - URL 여부
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sort - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 */
export async function handleNaver(browser, page, input, isUrl, collectionType = 0, sort = 0) {
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
      
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      await clickReviewOrQnATab(newPage, collectionType, sort);
      
      // 리뷰 수집일 때 리뷰 추출
      let reviews = [];
      if (collectionType === 0) {
        console.log('[NaverService] 리뷰 추출 시작...');
        reviews = await extractAllReviews(newPage, '', 1);
        console.log(`[NaverService] ✅ ${reviews.length}개의 리뷰를 추출했습니다.`);
        if (reviews.length > 0) {
          console.log('[NaverService] 추출된 리뷰 데이터:', JSON.stringify(reviews, null, 2));
        }
      }
      
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
        reviews: reviews,
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
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      await clickReviewOrQnATab(productPage, collectionType, sort);
      
      // 리뷰 수집일 때 리뷰 추출
      let reviews = [];
      if (collectionType === 0) {
        console.log('[NaverService] 리뷰 추출 시작...');
        reviews = await extractAllReviews(productPage, '', 1);
        console.log(`[NaverService] ✅ ${reviews.length}개의 리뷰를 추출했습니다.`);
        if (reviews.length > 0) {
          console.log('[NaverService] 추출된 리뷰 데이터:', JSON.stringify(reviews, null, 2));
        }
      }
      
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: false,
        platform: '네이버',
        searchQuery: input,
        searchUrl: targetUrl,
        productUrl: productUrl,
        collectionType: collectionType,
        reviews: reviews,
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

