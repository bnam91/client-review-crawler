/**
 * 네이버 플랫폼 전용 서비스
 */
// productPageUtil의 verify는 페이지 리뉴얼로 옛 셀렉터가 무효화되어 사용 중단.
// 페이지 상태 검증은 naverTabActions.waitForCaptchaIfNeeded + 모달 진입 폴링이 대체.
import { uploadDiagnostic, findUserByIp } from './licenseService.js';
import { navigateToNaver, createNaverSearchUrl, isNaverProductPage, waitForNaverProductPage, closeReviewModal, closeQnAModal } from './naver/naverNavigation.js';
import { clickReviewOrQnATab } from './naver/naverTabActions.js';
import { extractAllReviews } from './naver/naverReviewExtractor.js';
import { extractAllQnAs } from './naver/naverQnAExtractor.js';
import { navigateToNextPage, hasNextPage, loadMoreReviews, getReviewCount } from './naver/naverPagination.js';
import { loadMoreQnAs } from './naver/naverQnAPagination.js';
import { saveReviews, saveReviewsToExcelChunk } from '../../src/utils/naver/storage/index.js';
import { getStorageDirectory, resetSessionFolderName, setSessionFolderPrefix } from '../../src/utils/naver/storage/common.js';
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
export async function handleNaver(browser, page, input, isUrl, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', excludeSecret = false, webContents = null, downloadImages = true, smallImage = false, enableDiagnostic = false, slowMode = true) {

  // 크롤링 속도 (2026-07-07 라이브 실측 근거) — 안정(3초)=네이버 속도제한 미발동·전량 수집 / 빠름(1.5초)=대형 상품 부분수집 위험
  const scrollWaitMs = slowMode ? 3000 : 1500;

  // 진단 객체 — 사용자가 옵트인 시 무한 스크롤 동작 정보 수집해서 크롤링 종료 후 MongoDB 업로드
  const diagnostic = enableDiagnostic ? {
    scrollContainer: null,
    scrollAttempts: [],
    terminationReason: null,
  } : null;

  // 진단 업로드 — 크롤링 끝(성공/실패 무관) 시 호출. 리뷰 본문/이미지/개인정보는 안 보냄.
  async function uploadDiagnosticIfEnabled(crawlInput, crawlResult) {
    if (!enableDiagnostic || !diagnostic) return;
    try {
      // userId 식별 (현재 등록된 IP 기반) — best-effort
      let licenseKey = '';
      let userId = '';
      let isRoot = false;
      try {
        const fetchModule = await import('node:https');
        const ip = await new Promise((resolve) => {
          fetchModule.default.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve(data.trim()));
            res.on('error', () => resolve(''));
          }).on('error', () => resolve(''));
        });
        if (ip) {
          const r = await findUserByIp(ip);
          if (r.found) { licenseKey = r.user.licenseKey; userId = r.user.userId; isRoot = !!r.user.isRoot; }
        }
      } catch {}

      const { app: electronApp } = await import('electron');
      const appVersion = electronApp.getVersion();

      await uploadDiagnostic({
        timestamp: new Date(),
        licenseKey, userId, isRoot,
        appVersion,
        platform: process.platform,
        arch: process.arch,
        crawlInput,
        crawlResult,
        diagnostics: diagnostic,
      });
      sendLog('[정보] 진단 로그가 전송되었습니다 — 분석에 활용됩니다', 'success');
    } catch (e) {
      console.log(`[NaverService] 진단 로그 전송 실패 (무시): ${e.message}`);
    }
  }

  // 세션 폴더명 초기화 (새 크롤링 시작) 및 접두사 설정
  resetSessionFolderName();
  const folderPrefix = collectionType === 0 ? 'review' : 'qna';
  setSessionFolderPrefix(folderPrefix);
  
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
    
    // 새 탭 열기 (네이버 페이지가 무거우므로 domcontentloaded + 60s)
    const newPage = await browser.newPage();
    try {
      await newPage.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (e) {
      console.log(`[NaverService] ⚠️ 페이지 이동 timeout (${e.message}) — 페이지가 부분 로드되었을 수 있음, 계속 진행`);
    }

    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[NaverService] 새 탭에서 URL로 이동 완료:', targetUrl);

    // 로그인 페이지로 리다이렉트된 경우 사용자 로그인 대기 (영구 userDataDir이라 첫 1회만 필요)
    let currentUrl = newPage.url();
    if (currentUrl.includes('nid.naver.com/nidlogin') || currentUrl.includes('nid.naver.com/login')) {
      console.log('[NaverService] 🔒 네이버 로그인 페이지 감지. 사용자 로그인 대기 중...');
      sendLog('[안내] puppeteer Chrome 창에서 네이버 로그인을 완료해 주세요. (최대 5분 대기, 한 번 로그인하면 이후 자동 유지)', 'warning');
      try {
        await newPage.waitForFunction(
          () => location.href.includes('/products/') && !location.href.includes('nid.naver.com'),
          { timeout: 300000, polling: 1000 }
        );
        currentUrl = newPage.url();
        console.log('[NaverService] ✅ 로그인 완료, 상품 페이지 도착:', currentUrl);
        sendLog('[안내] 로그인 완료. 크롤링을 계속합니다.', 'success');
      } catch (e) {
        sendLog('[오류] 로그인 대기 시간 초과 (5분). 다시 시도해 주세요.', 'error');
        throw e;
      }
    }

    // 상품 페이지인지 확인하고 리뷰/Q&A 탭으로 이동
    if (isNaverProductPage(currentUrl)) {
      // URL 모드 + /products/ 포함이면 verify 단계 자체를 스킵 (모달 진입에서 자체 검증되니 redundant)
      // 옛 페이지 구조 셀렉터로 verifyNaverProductPageLoaded가 항상 실패하여
      // waitForProductPageToLoad(60초)를 끝까지 기다리는 비효율 우회.
      if (currentUrl.includes('/products/')) {
        const skipMsg = '[NaverService] ✅ /products/ URL 확인 — verify 단계 스킵, 모달 진입에서 자체 검증';
        console.log(skipMsg);
        sendLog(skipMsg, 'info');
      }

      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      sendLog(`[진행] 리뷰/Q&A 탭으로 이동 중...`, 'info');
      await clickReviewOrQnATab(newPage, collectionType, sort, sendLog);
      
      // 리뷰/Q&A 공용 변수 (최종 요약에서 사용하므로 블록 밖에서 선언)
      let allReviews = [];
      let allQnAs = [];
      let finalSavePath = null; // 저장 경로 초기화
      // 속도제한(429) 상태 공유 — loadMoreReviews가 기록, 완료 메시지/진단에서 부분수집 여부 판단
      const scrollFlags = { rateLimitHits: 0, endedByRateLimit: false, resumedAfterRateLimit: 0 };

      // Q&A 수집일 때 Q&A 추출 (모달 무한 스크롤 단일 흐름)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] Q&A 추출 시작... (목표 ${targetText})`);
        sendLog(`[시작] Q&A 추출 시작 (목표 ${targetText})`, 'info');

        // 무한 스크롤로 모달 내 Q&A 로드
        sendLog(`[진행] 모달 무한 스크롤로 Q&A 로딩 중...`, 'info', true);
        const finalCount = await loadMoreQnAs(newPage, targetCount, { tuning: { scrollWaitMs } });
        console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount}`);
        sendLog(`[진행] 모달 내 ${finalCount}개 Q&A 로드 완료. 추출 시작...`, 'info', true);

        // 모달 내 모든 Q&A 추출
        const pageQnAs = await extractAllQnAs(newPage, excludeSecret, { sendLog });
        allQnAs = allQnAs.concat(pageQnAs);
        console.log(`[NaverService] ✅ ${pageQnAs.length}개 Q&A 추출`);
        sendLog(`[완료] ${pageQnAs.length}개 Q&A 추출`, 'success');

        // Q&A 추출 후 모달 닫기
        try {
          await closeQnAModal(newPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ Q&A 모달 닫기 실패: ${e.message}`);
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
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] 리뷰 추출 시작... (목표 ${targetText})`);

        // 이미지 저장 경로 설정 (엑셀 파일과 동일한 폴더)
        const photoFolderPath = getStorageDirectory(savePath);

        // 무한 스크롤로 청크 단위 점진 추출 + Excel 청크별 저장 (옛 50페이지 패턴 무한 스크롤판)
        const CHUNK_SIZE_REVIEWS = 1000;
        const originalTargetCount = targetCount; // Infinity 가능
        let prevCount = 0;
        let chunkNum = 1;
        let excelChunkCount = 0;

        sendLog(`[시작] 리뷰 추출 시작 (목표 ${targetText}, 청크 ${CHUNK_SIZE_REVIEWS}개 단위)`, 'info');

        while (true) {
          const target = originalTargetCount === Infinity
            ? prevCount + CHUNK_SIZE_REVIEWS
            : Math.min(prevCount + CHUNK_SIZE_REVIEWS, originalTargetCount);

          sendLog(`[진행] 청크 ${chunkNum} — 무한 스크롤 (목표 ${target}개)...`, 'info', true);
          const reachedCount = await loadMoreReviews(newPage, target, { diagnostic, chunkNum, flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
          sendLog(`[진행] 청크 ${chunkNum} — ${reachedCount}개 로드됨, 추출 중...`, 'info', true);

          const all = await extractAllReviews(newPage, photoFolderPath, 1, { downloadImages, smallImage, sendLog });
          const newSlice = all.slice(prevCount);
          if (newSlice.length === 0) break;

          try {
            console.log(`[NaverService] 📦 청크 저장 (청크 ${chunkNum}, ${newSlice.length}개 리뷰)`);
            sendLog(`[진행] 청크 ${chunkNum} 저장 중 (${newSlice.length}개)...`, 'info', true);
            const chunkPath = await saveReviewsToExcelChunk(newSlice, 'naver_reviews', savePath, chunkNum);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 청크 ${chunkNum} 저장 완료: ${chunkPath}`);
              sendLog(`[완료] 청크 ${chunkNum} 저장 완료 (${newSlice.length}개, 누적 ${prevCount + newSlice.length}개)`, 'success');
              excelChunkCount++;
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 청크 ${chunkNum} 저장 실패: ${error.message}`);
            sendLog(`[오류] 청크 ${chunkNum} 저장 실패: ${error.message}`, 'error');
          }

          allReviews.push(...newSlice);
          prevCount = all.length;
          chunkNum++;

          if (reachedCount < target) break;
          if (originalTargetCount !== Infinity && allReviews.length >= originalTargetCount) break;
        }

        // 모달 닫기 (루프 종료 후 1회)
        try {
          await closeReviewModal(newPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ 모달 닫기 실패: ${e.message}`);
        }

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${allReviews.length}개까지만 수집되었습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 다시 실행하면 속도제한 없이 전량 수집됩니다.`, 'info');
        } else if (scrollFlags.resumedAfterRateLimit > 0) {
          sendLog(`[정보] 수집 중 네이버 속도제한(429)을 ${scrollFlags.resumedAfterRateLimit}회 만났고, 대기 후 끝까지 이어받았습니다.`, 'info');
        }

        // JSON 전체 저장 (Excel은 이미 청크로 저장됨)
        let jsonFileCount = 0;
        if (allReviews.length > 0) {
          try {
            sendLog(`[진행] 최종 JSON 저장 중...`, 'info', true);
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            jsonFileCount = savedPaths.filter(path => path.endsWith('.json')).length;
            if (savedPaths.length > 0) {
              sendLog(`[완료] 최종 리뷰 데이터 저장 완료`, 'success');
              sendLog(`[확인] 저장 완료: JSON ${jsonFileCount}개, Excel ${excelChunkCount}개`, 'success');
              finalSavePath = getStorageDirectory(savePath);
            } else {
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              if (excelChunkCount > 0) {
                sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
              }
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] 리뷰 데이터 저장 실패: ${error.message}`, 'error');
          }
        } else {
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
      if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else {
        sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
      }
      await uploadDiagnosticIfEnabled(
        { input, isUrl, collectionType, sort, pages, customPages },
        {
          success: true,
          totalReviews: allReviews.length,
          totalQnAs: allQnAs.length,
          partial: scrollFlags.endedByRateLimit,
          rateLimitHits: scrollFlags.rateLimitHits,
          rateLimitResumes: scrollFlags.resumedAfterRateLimit,
        }
      );
      return {
        success: true,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
        reviews: allReviews,
        savePath: finalSavePath,
        partial: scrollFlags.endedByRateLimit,
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
    
    // 3. 새 탭 열고 검색 페이지로 이동 (네이버 무거운 페이지 대응)
    const newPage = await browser.newPage();
    try {
      await newPage.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (e) {
      console.log(`[NaverService] ⚠️ 검색 페이지 이동 timeout (${e.message}) — 부분 로드, 계속 진행`);
    }
    
    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[NaverService] 네이버 검색 페이지로 이동 완료:', targetUrl);
    
    // 4. 상품 페이지로 이동할 때까지 대기
    try {
      const result = await waitForNaverProductPage(browser, newPage, sendLog);
      const productUrl = result.url || result; // 호환성을 위해 둘 다 처리
      const productPage = result.page || newPage; // 실제 상품 페이지 객체
      
      console.log('[NaverService] 상품 페이지 도착:', productUrl);

      // 5. verify 단계 — URL 모드와 동일하게 /products/면 스킵.
      //   - verify의 옛 셀렉터(.P2lBbUWPNi 등)는 페이지 리뉴얼로 무효화됨 → 매번 60초 timeout 낭비
      //   - 페이지 상태 검증은 새 헬퍼들이 대체:
      //     · 캡챠/장애 페이지 → naverTabActions.waitForCaptchaIfNeeded (모달 진입 직전 호출)
      //     · 페이지 로딩 완료 → 모달 진입의 scrollUntilOpenButtonVisible 폴링이 자체 대기
      //   - URL 자체로 상품페이지인지는 isNaverProductPage가 이미 통과 처리함
      if (productUrl && productUrl.includes('/products/')) {
        const skipMsg = '[NaverService] ✅ /products/ URL 확인 — verify 단계 스킵, 모달 진입에서 자체 검증';
        console.log(skipMsg);
        sendLog(skipMsg, 'info');
      }

      // 6. 리뷰 또는 Q&A 탭으로 이동
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      console.log(`[NaverService] clickReviewOrQnATab 호출 - collectionType: ${collectionType}, sort: ${sort} (${sortNames[sort] || '알 수 없음'})`);
      sendLog(`[진행] 리뷰/Q&A 탭으로 이동 중...`, 'info');
      await clickReviewOrQnATab(productPage, collectionType, sort, sendLog);
      
      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let allQnAs = []; // Q&A 수집용 (스코프 문제 해결)
      let finalSavePath = null; // 저장 경로 초기화
      // 속도제한(429) 상태 공유 — loadMoreReviews가 기록, 완료 메시지/진단에서 부분수집 여부 판단
      const scrollFlags = { rateLimitHits: 0, endedByRateLimit: false, resumedAfterRateLimit: 0 };
      
      // Q&A 수집일 때 Q&A 추출 (모달 무한 스크롤 단일 흐름)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] Q&A 추출 시작... (목표 ${targetText})`);
        sendLog(`[시작] Q&A 추출 시작 (목표 ${targetText})`, 'info');

        // 무한 스크롤로 모달 내 Q&A 로드
        sendLog(`[진행] 모달 무한 스크롤로 Q&A 로딩 중...`, 'info', true);
        const finalCount = await loadMoreQnAs(productPage, targetCount, { tuning: { scrollWaitMs } });
        console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount}`);
        sendLog(`[진행] 모달 내 ${finalCount}개 Q&A 로드 완료. 추출 시작...`, 'info', true);

        // 모달 내 모든 Q&A 추출
        const pageQnAs = await extractAllQnAs(productPage, excludeSecret, { sendLog });
        allQnAs = allQnAs.concat(pageQnAs);
        console.log(`[NaverService] ✅ ${pageQnAs.length}개 Q&A 추출`);
        sendLog(`[완료] ${pageQnAs.length}개 Q&A 추출`, 'success');

        // Q&A 추출 후 모달 닫기
        try {
          await closeQnAModal(productPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ Q&A 모달 닫기 실패: ${e.message}`);
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
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] 리뷰 추출 시작... (목표 ${targetText})`);

        // 이미지 저장 경로 설정 (엑셀 파일과 동일한 폴더)
        const photoFolderPath = getStorageDirectory(savePath);

        // 무한 스크롤로 청크 단위 점진 추출 + Excel 청크별 저장 (옛 50페이지 패턴 무한 스크롤판)
        const CHUNK_SIZE_REVIEWS = 1000;
        const originalTargetCount = targetCount; // Infinity 가능
        let prevCount = 0;
        let chunkNum = 1;
        let excelChunkCount = 0;

        sendLog(`[시작] 리뷰 추출 시작 (목표 ${targetText}, 청크 ${CHUNK_SIZE_REVIEWS}개 단위)`, 'info');

        while (true) {
          const target = originalTargetCount === Infinity
            ? prevCount + CHUNK_SIZE_REVIEWS
            : Math.min(prevCount + CHUNK_SIZE_REVIEWS, originalTargetCount);

          sendLog(`[진행] 청크 ${chunkNum} — 무한 스크롤 (목표 ${target}개)...`, 'info', true);
          const reachedCount = await loadMoreReviews(productPage, target, { diagnostic, chunkNum, flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
          sendLog(`[진행] 청크 ${chunkNum} — ${reachedCount}개 로드됨, 추출 중...`, 'info', true);

          const all = await extractAllReviews(productPage, photoFolderPath, 1, { downloadImages, smallImage, sendLog });
          const newSlice = all.slice(prevCount);
          if (newSlice.length === 0) break;

          try {
            console.log(`[NaverService] 📦 청크 저장 (청크 ${chunkNum}, ${newSlice.length}개 리뷰)`);
            sendLog(`[진행] 청크 ${chunkNum} 저장 중 (${newSlice.length}개)...`, 'info', true);
            const chunkPath = await saveReviewsToExcelChunk(newSlice, 'naver_reviews', savePath, chunkNum);
            if (chunkPath) {
              console.log(`[NaverService] ✅ 청크 ${chunkNum} 저장 완료: ${chunkPath}`);
              sendLog(`[완료] 청크 ${chunkNum} 저장 완료 (${newSlice.length}개, 누적 ${prevCount + newSlice.length}개)`, 'success');
              excelChunkCount++;
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 청크 ${chunkNum} 저장 실패: ${error.message}`);
            sendLog(`[오류] 청크 ${chunkNum} 저장 실패: ${error.message}`, 'error');
          }

          allReviews.push(...newSlice);
          prevCount = all.length;
          chunkNum++;

          if (reachedCount < target) break;
          if (originalTargetCount !== Infinity && allReviews.length >= originalTargetCount) break;
        }

        // 모달 닫기 (루프 종료 후 1회)
        try {
          await closeReviewModal(productPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ 모달 닫기 실패: ${e.message}`);
        }

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다.`);
        sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${allReviews.length}개까지만 수집되었습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 다시 실행하면 속도제한 없이 전량 수집됩니다.`, 'info');
        } else if (scrollFlags.resumedAfterRateLimit > 0) {
          sendLog(`[정보] 수집 중 네이버 속도제한(429)을 ${scrollFlags.resumedAfterRateLimit}회 만났고, 대기 후 끝까지 이어받았습니다.`, 'info');
        }

        // JSON 전체 저장 (Excel은 이미 청크로 저장됨)
        let jsonFileCount = 0;
        if (allReviews.length > 0) {
          try {
            sendLog(`[진행] 최종 JSON 저장 중...`, 'info', true);
            const savedPaths = await saveReviews(allReviews, 'naver_reviews', savePath);
            jsonFileCount = savedPaths.filter(path => path.endsWith('.json')).length;
            if (savedPaths.length > 0) {
              sendLog(`[완료] 최종 리뷰 데이터 저장 완료`, 'success');
              sendLog(`[확인] 저장 완료: JSON ${jsonFileCount}개, Excel ${excelChunkCount}개`, 'success');
              finalSavePath = getStorageDirectory(savePath);
            } else {
              sendLog(`[경고] 저장할 형식이 설정되지 않았습니다.`, 'warning');
              if (excelChunkCount > 0) {
                sendLog(`[확인] 저장 완료: JSON 0개, Excel ${excelChunkCount}개`, 'success');
              }
            }
          } catch (error) {
            console.error(`[NaverService] ❌ 리뷰 데이터 저장 실패: ${error.message}`);
            sendLog(`[오류] 리뷰 데이터 저장 실패: ${error.message}`, 'error');
          }
        } else {
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
      if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else {
        sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
      }
      await uploadDiagnosticIfEnabled(
        { input, isUrl, collectionType, sort, pages, customPages },
        {
          success: true,
          totalReviews: allReviews.length,
          totalQnAs: allQnAs.length,
          partial: scrollFlags.endedByRateLimit,
          rateLimitHits: scrollFlags.rateLimitHits,
          rateLimitResumes: scrollFlags.resumedAfterRateLimit,
        }
      );
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
        partial: scrollFlags.endedByRateLimit,
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

