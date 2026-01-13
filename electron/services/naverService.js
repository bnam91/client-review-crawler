/**
 * 네이버 플랫폼 전용 서비스
 */
import { verifyNaverProductPageLoaded, waitForProductPageToLoad } from '../../src/utils/naver/productPageUtil.js';
import { navigateToNaver, createNaverSearchUrl, isNaverProductPage, waitForNaverProductPage } from './naver/naverNavigation.js';
import { clickReviewOrQnATab } from './naver/naverTabActions.js';
import { extractAllReviews } from './naver/naverReviewExtractor.js';
import { extractAllQnAs } from './naver/naverQnAExtractor.js';
import { navigateToNextPage, hasNextPage } from './naver/naverPagination.js';
import { navigateToNextQnAPage, hasNextQnAPage } from './naver/naverQnAPagination.js';
import { saveReviews, saveReviewsToExcelChunk } from '../../src/utils/naver/storage/index.js';
import { getStorageDirectory, resetSessionFolderName } from '../../src/utils/naver/storage/common.js';
import { formatQnAData } from '../../src/utils/naver/storage/qnaFormatter.js';

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
 * @param {boolean} excludeSecret - 비밀글 제외 여부 (Q&A 수집일 때만 사용)
 * @param {object} webContents - Electron webContents 객체 (로그 전송용)
 */
export async function handleNaver(browser, page, input, isUrl, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', excludeSecret = false, webContents = null) {
  
  // 세션 폴더명 초기화 (새 크롤링 시작)
  resetSessionFolderName();
  
  // 로그 전송 헬퍼 함수
  const sendLog = (message, className = '', updateLast = false) => {
    if (webContents) {
      webContents.send('crawler-log', { message, className, updateLast });
    }
    if (!updateLast) {
      // 업데이트가 아닌 경우에만 콘솔에 출력 (도배 방지)
      console.log(message);
    }
  };
  console.log(`[NaverService] 저장 경로: ${savePath || '(지정되지 않음)'}`);
  
  // 생성될 폴더명 로그
  const storageDir = getStorageDirectory(savePath);
  const folderName = storageDir.split(/[/\\]/).pop();
  sendLog(`[경로] 저장 폴더: ${folderName}`, 'info');
  
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
        // (캡챠 감지 시 로그만 표시하고 계속 대기)
        const waitResult = await waitForProductPageToLoad(newPage, baseUrl, 60, sendLog);
        
        if (!waitResult.success) {
          const errorMsg = `[NaverService] ⚠️ 상품 페이지 로딩 대기 실패: ${waitResult.reason || '알 수 없는 오류'}`;
          console.log(errorMsg);
          sendLog(errorMsg, 'warning');
        } else {
          const successMsg = '[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료';
          console.log(successMsg);
          sendLog(successMsg, 'success');
        }
      } else {
        // 성공 시 상품 제목과 가격 정보 출력
        const logMessage1 = '[NaverProductPageUtil] ✅ 정상 로딩 요소가 나타났습니다.';
        const logMessage2 = `[NaverProductPageUtil]   - 상품 제목: ${verificationResult.title || '(확인 불가)'}`;
        const logMessage3 = `[NaverProductPageUtil]   - 상품 가격: ${verificationResult.price || '(확인 불가)'}`;
        
        console.log(logMessage1);
        console.log(logMessage2);
        console.log(logMessage3);
        
        if (sendLog) {
          sendLog(logMessage1, 'success');
          sendLog(logMessage2);
          sendLog(logMessage3);
        }
        
        const successMsg = '[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료';
        console.log(successMsg);
        sendLog(successMsg, 'success');
      }
      
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      sendLog(`[진행] 리뷰/Q&A 탭으로 이동 중...`, 'info');
      await clickReviewOrQnATab(newPage, collectionType, sort);
      
      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let chunkReviews = []; // Excel 청크 저장용
      let chunkCount = 1; // 청크 번호 (1부터 시작)
      const CHUNK_SIZE = 50; // 50페이지마다 청크 저장
      let finalSavePath = null; // 저장 경로 초기화
      
      // Q&A 수집일 때 Q&A 추출 (여러 페이지)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const maxPagesText = maxPages === Infinity ? '무제한' : `${maxPages}페이지`;
        console.log(`[NaverService] Q&A 추출 시작... (최대 ${maxPagesText})`);
        sendLog(`[시작] Q&A 추출 시작 (최대 ${maxPagesText})`, 'info');
        
        let allQnAs = [];
        let currentPage = 1;
        
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 Q&A 페이지 ${currentPage} 크롤링 중...`);
          sendLog(`[진행] Q&A 페이지 ${currentPage}/${maxPages === Infinity ? '?' : maxPages} 크롤링 중...`, 'info', true);
          const pageQnAs = await extractAllQnAs(newPage, excludeSecret);
          allQnAs = allQnAs.concat(pageQnAs);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageQnAs.length}개 Q&A 추출 (누적: ${allQnAs.length}개)`);
          sendLog(`[완료] 페이지 ${currentPage}: ${pageQnAs.length}개 Q&A 추출 (누적: ${allQnAs.length}개)`, 'success');
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextQnAPage(newPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              sendLog(`[종료] 다음 페이지가 없어 크롤링을 종료합니다.`, 'warning');
              break;
            }
            
            sendLog(`[진행] 페이지 ${currentPage + 1}로 이동 중...`, 'info', true);
            const nextPageSuccess = await navigateToNextQnAPage(newPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              sendLog(`[오류] 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`, 'error');
              break;
            }
          }
          
          currentPage++;
        }
        
        console.log(`[NaverService] ✅ 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`);
        sendLog(`[완료] 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`, 'success');
        
        // Q&A 데이터 저장
        if (allQnAs.length > 0) {
          try {
            // Q&A 데이터를 새로운 형식으로 변환
            console.log(`[NaverService] 🔄 Q&A 데이터 형식 변환 중...`);
            sendLog(`[진행] Q&A 데이터 형식 변환 중...`, 'info', true);
            const formattedQnAs = formatQnAData(allQnAs);
            console.log(`[NaverService] 📁 Q&A 데이터 저장 시작... (${formattedQnAs.length}개)`);
            sendLog(`[진행] Q&A 데이터 저장 중... (${formattedQnAs.length}개)`, 'info', true);
            const savedPaths = await saveReviews(formattedQnAs, 'naver_qna', savePath);
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 Q&A 데이터 저장 완료: ${savedPaths.join(', ')}`);
              sendLog(`[완료] Q&A 데이터 저장 완료`, 'success');
              finalSavePath = getStorageDirectory(savePath);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              finalSavePath = getStorageDirectory(savePath);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ Q&A 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] Q&A 데이터 저장 실패: ${error.message}`, 'error');
            finalSavePath = getStorageDirectory(savePath);
          }
        } else {
          console.log(`[NaverService] ⚠️ 저장할 Q&A 데이터가 없습니다.`);
          sendLog(`[경고] 저장할 Q&A 데이터가 없습니다.`, 'warning');
          finalSavePath = getStorageDirectory(savePath);
        }
      }
      
      if (collectionType === 0) {
        const maxPages = getMaxPages(pages, customPages);
        const maxPagesText = maxPages === Infinity ? '무제한' : `${maxPages}페이지`;
        console.log(`[NaverService] 리뷰 추출 시작... (최대 ${maxPagesText})`);
        sendLog(`[시작] 리뷰 추출 시작 (최대 ${maxPagesText})`, 'info');
        
        // 이미지 저장 경로 설정 (엑셀 파일과 동일한 폴더)
        const photoFolderPath = getStorageDirectory(savePath);
        
        let excelChunkCount = 0; // Excel 청크 개수 추적
        let currentPage = 1;
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 페이지 ${currentPage} 크롤링 중...`);
          sendLog(`[진행] 리뷰 페이지 ${currentPage}/${maxPages === Infinity ? '?' : maxPages} 크롤링 중...`, 'info', true);
          const pageReviews = await extractAllReviews(newPage, photoFolderPath, currentPage);
          allReviews = allReviews.concat(pageReviews);
          chunkReviews = chunkReviews.concat(pageReviews);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`);
          sendLog(`[완료] 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`, 'success');
          
          // 50페이지마다 Excel 청크 저장
          if (currentPage % CHUNK_SIZE === 0 && chunkReviews.length > 0) {
            try {
              console.log(`[NaverService] 📦 ${CHUNK_SIZE}페이지 단위 청크 저장 (청크 ${chunkCount})`);
              sendLog(`[진행] ${CHUNK_SIZE}페이지 단위 청크 저장 중 (청크 ${chunkCount})...`, 'info', true);
              const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
              if (chunkPath) {
                console.log(`[NaverService] ✅ 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
                sendLog(`[완료] 청크 ${chunkCount} 저장 완료`, 'success');
                excelChunkCount++;
              }
              chunkReviews = []; // 청크 리뷰 초기화
              chunkCount++;
            } catch (error) {
              console.error(`[NaverService] ❌ 청크 저장 실패: ${error.message}`);
              sendLog(`[오류] 청크 저장 실패: ${error.message}`, 'error');
            }
          }
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextPage(newPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              sendLog(`[종료] 다음 페이지가 없어 크롤링을 종료합니다.`, 'warning');
              break;
            }
            
            sendLog(`[진행] 페이지 ${currentPage + 1}로 이동 중...`, 'info', true);
            const nextPageSuccess = await navigateToNextPage(newPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              sendLog(`[오류] 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`, 'error');
              break;
            }
          }
          
          currentPage++;
        }
        
        // 마지막 남은 청크 저장 (50페이지 단위가 아닌 경우)
        if (chunkReviews.length > 0) {
          try {
            console.log(`[NaverService] 📦 마지막 청크 저장 (청크 ${chunkCount}, ${chunkReviews.length}개 리뷰)`);
            sendLog(`[진행] 마지막 청크 저장 중 (청크 ${chunkCount})...`, 'info', true);
            const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 마지막 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
              sendLog(`[완료] 마지막 청크 ${chunkCount} 저장 완료`, 'success');
              excelChunkCount++;
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 마지막 청크 저장 실패: ${error.message}`);
            sendLog(`[오류] 마지막 청크 저장 실패: ${error.message}`, 'error');
          }
        }
        
        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');
        
        // 리뷰 데이터 저장 (JSON은 전체 저장, Excel은 이미 청크로 저장됨)
        let finalSavePath = null;
        let jsonFileCount = 0; // JSON 파일 개수 추적
        
        if (allReviews.length > 0) {
          try {
            // Excel을 제외하고 저장 (Excel은 이미 청크로 저장됨)
            sendLog(`[진행] 최종 리뷰 데이터 저장 중...`, 'info', true);
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            
            // JSON 파일 개수 세기
            jsonFileCount = savedPaths.filter(path => path.endsWith('.json')).length;
            
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 리뷰 데이터 저장 완료: ${savedPaths.join(', ')}`);
              sendLog(`[완료] 최종 리뷰 데이터 저장 완료`, 'success');
              
              // 저장된 파일 개수 더블체크
              sendLog(`[확인] 저장 완료: JSON ${jsonFileCount}개, Excel ${excelChunkCount}개`, 'success');
              
              // 저장 경로 가져오기 (폴더 열기용)
              finalSavePath = getStorageDirectory(savePath);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              
              // Excel만 저장된 경우
              if (excelChunkCount > 0) {
                sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
              }
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] 리뷰 데이터 저장 실패: ${error.message}`, 'error');
          }
        } else {
          // 리뷰가 없어도 Excel 청크가 있을 수 있음
          if (excelChunkCount > 0) {
            sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
          }
        }
      }
      
      // 최종 완료 메시지 (총 추출 개수 포함)
      let finalCountMessage = '';
      if (collectionType === 0) {
        finalCountMessage = `총 ${allReviews.length}개 리뷰`;
      } else if (collectionType === 1) {
        finalCountMessage = `총 ${allQnAs.length}개 Q&A`;
      }
      sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
        reviews: allReviews,
        savePath: finalSavePath,
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
      const result = await waitForNaverProductPage(browser, newPage, sendLog);
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
        // (캡챠 감지 시 로그만 표시하고 계속 대기)
        const waitResult = await waitForProductPageToLoad(productPage, baseUrl, 60, sendLog);
        
        if (!waitResult.success) {
          const errorMsg = `[NaverService] ⚠️ 상품 페이지 로딩 대기 실패: ${waitResult.reason || '알 수 없는 오류'}`;
          console.log(errorMsg);
          sendLog(errorMsg, 'warning');
        } else {
          const successMsg = '[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료';
          console.log(successMsg);
          sendLog(successMsg, 'success');
        }
      } else {
        // 성공 시 상품 제목과 가격 정보 출력
        const logMessage1 = '[NaverProductPageUtil] ✅ 정상 로딩 요소가 나타났습니다.';
        const logMessage2 = `[NaverProductPageUtil]   - 상품 제목: ${verificationResult.title || '(확인 불가)'}`;
        const logMessage3 = `[NaverProductPageUtil]   - 상품 가격: ${verificationResult.price || '(확인 불가)'}`;
        
        console.log(logMessage1);
        console.log(logMessage2);
        console.log(logMessage3);
        
        if (sendLog) {
          sendLog(logMessage1, 'success');
          sendLog(logMessage2);
          sendLog(logMessage3);
        }
        
        const successMsg = '[NaverService] ✅ 상품 페이지 정상 로딩 확인 완료';
        console.log(successMsg);
        sendLog(successMsg, 'success');
      }
      
      // 6. 리뷰 또는 Q&A 탭으로 이동
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      sendLog(`[진행] 리뷰/Q&A 탭으로 이동 중...`, 'info');
      await clickReviewOrQnATab(productPage, collectionType, sort);
      
      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let allQnAs = []; // Q&A 수집용 (스코프 문제 해결)
      let chunkReviews = []; // Excel 청크 저장용
      let chunkCount = 1; // 청크 번호 (1부터 시작)
      const CHUNK_SIZE = 50; // 50페이지마다 청크 저장
      let finalSavePath = null; // 저장 경로 초기화
      
      // Q&A 수집일 때 Q&A 추출 (여러 페이지)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const maxPagesText = maxPages === Infinity ? '무제한' : `${maxPages}페이지`;
        console.log(`[NaverService] Q&A 추출 시작... (최대 ${maxPagesText})`);
        sendLog(`[시작] Q&A 추출 시작 (최대 ${maxPagesText})`, 'info');
        let currentPage = 1;
        
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 Q&A 페이지 ${currentPage} 크롤링 중...`);
          sendLog(`[진행] Q&A 페이지 ${currentPage}/${maxPages === Infinity ? '?' : maxPages} 크롤링 중...`, 'info', true);
          const pageQnAs = await extractAllQnAs(productPage, excludeSecret);
          allQnAs = allQnAs.concat(pageQnAs);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageQnAs.length}개 Q&A 추출 (누적: ${allQnAs.length}개)`);
          sendLog(`[완료] 페이지 ${currentPage}: ${pageQnAs.length}개 Q&A 추출 (누적: ${allQnAs.length}개)`, 'success');
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextQnAPage(productPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              sendLog(`[종료] 다음 페이지가 없어 크롤링을 종료합니다.`, 'warning');
              break;
            }
            
            sendLog(`[진행] 페이지 ${currentPage + 1}로 이동 중...`, 'info', true);
            const nextPageSuccess = await navigateToNextQnAPage(productPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              sendLog(`[오류] 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`, 'error');
              break;
            }
          }
          
          currentPage++;
        }
        
        console.log(`[NaverService] ✅ 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`);
        sendLog(`[완료] 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`, 'success');
        
        // Q&A 데이터 저장
        if (allQnAs.length > 0) {
          try {
            // Q&A 데이터를 새로운 형식으로 변환
            console.log(`[NaverService] 🔄 Q&A 데이터 형식 변환 중...`);
            sendLog(`[진행] Q&A 데이터 형식 변환 중...`, 'info', true);
            const formattedQnAs = formatQnAData(allQnAs);
            console.log(`[NaverService] 📁 Q&A 데이터 저장 시작... (${formattedQnAs.length}개)`);
            sendLog(`[진행] Q&A 데이터 저장 중... (${formattedQnAs.length}개)`, 'info', true);
            const savedPaths = await saveReviews(formattedQnAs, 'naver_qna', savePath);
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 Q&A 데이터 저장 완료: ${savedPaths.join(', ')}`);
              sendLog(`[완료] Q&A 데이터 저장 완료`, 'success');
              finalSavePath = getStorageDirectory(savePath);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              finalSavePath = getStorageDirectory(savePath);
            }
          } catch (error) {
            console.error(`[NaverService] ❌ Q&A 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] Q&A 데이터 저장 실패: ${error.message}`, 'error');
            finalSavePath = getStorageDirectory(savePath);
          }
        } else {
          console.log(`[NaverService] ⚠️ 저장할 Q&A 데이터가 없습니다.`);
          sendLog(`[경고] 저장할 Q&A 데이터가 없습니다.`, 'warning');
          finalSavePath = getStorageDirectory(savePath);
        }
      }
      
      if (collectionType === 0) {
        const maxPages = getMaxPages(pages, customPages);
        const maxPagesText = maxPages === Infinity ? '무제한' : `${maxPages}페이지`;
        console.log(`[NaverService] 리뷰 추출 시작... (최대 ${maxPagesText})`);
        sendLog(`[시작] 리뷰 추출 시작 (최대 ${maxPagesText})`, 'info');
        
        // 이미지 저장 경로 설정 (엑셀 파일과 동일한 폴더)
        const photoFolderPath = getStorageDirectory(savePath);
        
        let excelChunkCount = 0; // Excel 청크 개수 추적
        let currentPage = 1;
        while (currentPage <= maxPages) {
          console.log(`[NaverService] 📄 페이지 ${currentPage} 크롤링 중...`);
          sendLog(`[진행] 리뷰 페이지 ${currentPage}/${maxPages === Infinity ? '?' : maxPages} 크롤링 중...`, 'info', true);
          const pageReviews = await extractAllReviews(productPage, photoFolderPath, currentPage);
          allReviews = allReviews.concat(pageReviews);
          chunkReviews = chunkReviews.concat(pageReviews);
          console.log(`[NaverService] ✅ 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`);
          sendLog(`[완료] 페이지 ${currentPage}: ${pageReviews.length}개 리뷰 추출 (누적: ${allReviews.length}개)`, 'success');
          
          // 50페이지마다 Excel 청크 저장
          if (currentPage % CHUNK_SIZE === 0 && chunkReviews.length > 0) {
            try {
              console.log(`[NaverService] 📦 ${CHUNK_SIZE}페이지 단위 청크 저장 (청크 ${chunkCount})`);
              sendLog(`[진행] ${CHUNK_SIZE}페이지 단위 청크 저장 중 (청크 ${chunkCount})...`, 'info', true);
              const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
              if (chunkPath) {
                console.log(`[NaverService] ✅ 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
                sendLog(`[완료] 청크 ${chunkCount} 저장 완료`, 'success');
                excelChunkCount++;
              }
              chunkReviews = []; // 청크 리뷰 초기화
              chunkCount++;
            } catch (error) {
              console.error(`[NaverService] ❌ 청크 저장 실패: ${error.message}`);
              sendLog(`[오류] 청크 저장 실패: ${error.message}`, 'error');
            }
          }
          
          // 마지막 페이지가 아니고 다음 페이지가 있으면 이동
          if (currentPage < maxPages) {
            const hasNext = await hasNextPage(productPage);
            if (!hasNext) {
              console.log(`[NaverService] ⚠️ 다음 페이지가 없어 크롤링을 종료합니다.`);
              sendLog(`[종료] 다음 페이지가 없어 크롤링을 종료합니다.`, 'warning');
              break;
            }
            
            sendLog(`[진행] 페이지 ${currentPage + 1}로 이동 중...`, 'info', true);
            const nextPageSuccess = await navigateToNextPage(productPage, currentPage + 1);
            if (!nextPageSuccess) {
              console.log(`[NaverService] ⚠️ 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`);
              sendLog(`[오류] 페이지 ${currentPage + 1}로 이동 실패. 크롤링을 종료합니다.`, 'error');
              break;
            }
          }
          
          currentPage++;
        }
        
        // 마지막 남은 청크 저장 (50페이지 단위가 아닌 경우)
        if (chunkReviews.length > 0) {
          try {
            console.log(`[NaverService] 📦 마지막 청크 저장 (청크 ${chunkCount}, ${chunkReviews.length}개 리뷰)`);
            sendLog(`[진행] 마지막 청크 저장 중 (청크 ${chunkCount})...`, 'info', true);
            const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'naver_reviews', savePath, chunkCount);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 마지막 청크 ${chunkCount} 저장 완료: ${chunkPath}`);
              sendLog(`[완료] 마지막 청크 ${chunkCount} 저장 완료`, 'success');
              excelChunkCount++;
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 마지막 청크 저장 실패: ${error.message}`);
            sendLog(`[오류] 마지막 청크 저장 실패: ${error.message}`, 'error');
          }
        }
        
        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');
        
        // 리뷰 데이터 저장 (JSON은 전체 저장, Excel은 이미 청크로 저장됨)
        let finalSavePath = null;
        let jsonFileCount = 0; // JSON 파일 개수 추적
        
        if (allReviews.length > 0) {
          try {
            // Excel을 제외하고 저장 (Excel은 이미 청크로 저장됨)
            sendLog(`[진행] 최종 리뷰 데이터 저장 중...`, 'info', true);
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            
            // JSON 파일 개수 세기
            jsonFileCount = savedPaths.filter(path => path.endsWith('.json')).length;
            
            if (savedPaths.length > 0) {
              console.log(`[NaverService] 📁 리뷰 데이터 저장 완료: ${savedPaths.join(', ')}`);
              sendLog(`[완료] 최종 리뷰 데이터 저장 완료`, 'success');
              
              // 저장된 파일 개수 더블체크
              sendLog(`[확인] 저장 완료: JSON ${jsonFileCount}개, Excel ${excelChunkCount}개`, 'success');
              
              // 저장 경로 가져오기 (폴더 열기용)
              finalSavePath = getStorageDirectory(savePath);
            } else {
              console.log(`[NaverService] ⚠️ 저장할 형식이 설정되지 않았습니다. config.js를 확인하세요.`);
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              
              // Excel만 저장된 경우
              if (excelChunkCount > 0) {
                sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
              }
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] 리뷰 데이터 저장 실패: ${error.message}`, 'error');
          }
        } else {
          // 리뷰가 없어도 Excel 청크가 있을 수 있음
          if (excelChunkCount > 0) {
            sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
          }
        }
      }
      
      // 최종 완료 메시지 (총 추출 개수 포함)
      let finalCountMessage = '';
      if (collectionType === 0) {
        finalCountMessage = `총 ${allReviews.length}개 리뷰`;
      } else if (collectionType === 1) {
        finalCountMessage = `총 ${allQnAs.length}개 Q&A`;
      }
      sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
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
        savePath: finalSavePath,
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

