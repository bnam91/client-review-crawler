/**
 * 네이버 플랫폼 전용 서비스
 */
import { verifyNaverProductPageLoaded, waitForProductPageToLoad } from '../../src/utils/naver/productPageUtil.js';
import { navigateToNaver, createNaverSearchUrl, isNaverProductPage, waitForNaverProductPage } from './naver/naverNavigation.js';
import { clickReviewOrQnATab } from './naver/naverTabActions.js';
import { extractAllReviews } from './naver/naverReviewExtractor.js';
import { navigateToNextPage, hasNextPage } from './naver/naverPagination.js';
import { saveReviews, saveReviewsToExcelChunk } from '../../src/utils/naver/storage/index.js';

/**
 * pages 값을 실제 페이지 수로 변환
 * @param {number} pages - 0: 5페이지, 1: 15페이지, 2: 50페이지, 3: 최대, 4: 직접입력
 * @param {number|null} customPages - 직접 입력한 페이지 수 (pages가 4일 때만 사용)
 * @returns {number} 실제 크롤링할 페이지 수
 */
function getMaxPages(pages, customPages = null) {
  if (pages === 4 && customPages !== null && customPages > 0) {
    return customPages;
  }
  
  const pageMap = {
    0: 5,   // 5페이지
    1: 15,  // 15페이지
    2: 50,  // 50페이지
    3: Infinity, // 최대
    4: 5    // 직접입력 (기본값 5, customPages가 없을 때)
  };
  return pageMap[pages] || 5;
}

/**
 * 네이버 플랫폼 처리 메인 함수
 * @param {object} browser - Puppeteer browser 객체
 * @param {object} page - Puppeteer page 객체
 * @param {string} input - URL 또는 검색어
 * @param {boolean} isUrl - URL 여부
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sort - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 * @param {number} pages - 0: 5페이지, 1: 15페이지, 2: 50페이지, 3: 최대, 4: 직접입력
 * @param {number|null} customPages - 직접 입력한 페이지 수 (pages가 4일 때만 사용)
 * @param {string} savePath - 저장 경로 (선택)
 */
export async function handleNaver(browser, page, input, isUrl, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '') {
  console.log(`[NaverService] 저장 경로: ${savePath || '(지정되지 않음)'}`);
  
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
      
      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let chunkReviews = []; // Excel 청크 저장용
      let chunkCount = 1; // 청크 번호 (1부터 시작)
      const CHUNK_SIZE = 50; // 50페이지마다 청크 저장
      
      if (collectionType === 0) {
        const maxPages = getMaxPages(pages, customPages);
        console.log(`[NaverService] 리뷰 추출 시작... (최대 ${maxPages === Infinity ? '무제한' : maxPages}페이지)`);
        
        let currentPage = 1;
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 페이지 ${currentPage} 크롤링 중...`);
          const pageReviews = await extractAllReviews(newPage, '', currentPage);
          allReviews = allReviews.concat(pageReviews);
          chunkReviews = chunkReviews.concat(pageReviews);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`);
          
          // 50페이지마다 Excel 청크 저장
          if (currentPage % CHUNK_SIZE === 0 && chunkReviews.length > 0) {
            try {
              console.log(`[NaverService] 📦 ${CHUNK_SIZE}페이지 단위 청크 저장 (청크 ${chunkCount})`);
              const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
              if (chunkPath) {
                console.log(`[NaverService] ✅ 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
              }
              chunkReviews = []; // 청크 리뷰 초기화
              chunkCount++;
            } catch (error) {
              console.error(`[NaverService] ❌ 청크 저장 실패: ${error.message}`);
            }
          }
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextPage(newPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              break;
            }
            
            const nextPageSuccess = await navigateToNextPage(newPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              break;
            }
          }
          
          currentPage++;
        }
        
        // 마지막 남은 청크 저장 (50페이지 단위가 아닌 경우)
        if (chunkReviews.length > 0) {
          try {
            console.log(`[NaverService] 📦 마지막 청크 저장 (청크 ${chunkCount}, ${chunkReviews.length}개 리뷰)`);
            const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 마지막 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 마지막 청크 저장 실패: ${error.message}`);
          }
        }
        
        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        
        // 리뷰 데이터 저장 (JSON은 전체 저장, Excel은 이미 청크로 저장됨)
        if (allReviews.length > 0) {
          try {
            // Excel을 제외하고 저장 (Excel은 이미 청크로 저장됨)
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 리뷰 데이터 저장 완료: ${savedPaths.join(', ')}`);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
          }
        }
      }
      
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
        reviews: allReviews,
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
      
      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let chunkReviews = []; // Excel 청크 저장용
      let chunkCount = 1; // 청크 번호 (1부터 시작)
      const CHUNK_SIZE = 50; // 50페이지마다 청크 저장
      
      if (collectionType === 0) {
        const maxPages = getMaxPages(pages, customPages);
        console.log(`[NaverService] 리뷰 추출 시작... (최대 ${maxPages === Infinity ? '무제한' : maxPages}페이지)`);
        
        let currentPage = 1;
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 페이지 ${currentPage} 크롤링 중...`);
          const pageReviews = await extractAllReviews(productPage, '', currentPage);
          allReviews = allReviews.concat(pageReviews);
          chunkReviews = chunkReviews.concat(pageReviews);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`);
          
          // 50페이지마다 Excel 청크 저장
          if (currentPage % CHUNK_SIZE === 0 && chunkReviews.length > 0) {
            try {
              console.log(`[NaverService] 📦 ${CHUNK_SIZE}페이지 단위 청크 저장 (청크 ${chunkCount})`);
              const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
              if (chunkPath) {
                console.log(`[NaverService] ✅ 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
              }
              chunkReviews = []; // 청크 리뷰 초기화
              chunkCount++;
            } catch (error) {
              console.error(`[NaverService] ❌ 청크 저장 실패: ${error.message}`);
            }
          }
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextPage(productPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              break;
            }
            
            const nextPageSuccess = await navigateToNextPage(productPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              break;
            }
          }
          
          currentPage++;
        }
        
        // 마지막 남은 청크 저장 (50페이지 단위가 아닌 경우)
        if (chunkReviews.length > 0) {
          try {
            console.log(`[NaverService] 📦 마지막 청크 저장 (청크 ${chunkCount}, ${chunkReviews.length}개 리뷰)`);
            const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 마지막 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 마지막 청크 저장 실패: ${error.message}`);
          }
        }
        
        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        
        // 리뷰 데이터 저장 (JSON은 전체 저장, Excel은 이미 청크로 저장됨)
        if (allReviews.length > 0) {
          try {
            // Excel을 제외하고 저장 (Excel은 이미 청크로 저장됨)
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 리뷰 데이터 저장 완료: ${savedPaths.join(', ')}`);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
          }
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
        reviews: allReviews,
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

