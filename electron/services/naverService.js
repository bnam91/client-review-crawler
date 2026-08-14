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
import { navigateToNextPage, hasNextPage, loadMoreReviews, getReviewCount, attachReviewTotalWatcher } from './naver/naverPagination.js';
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

// 화면 텍스트에서 총 리뷰 수를 뽑을 때 훑는 최대 길이 (헤더는 항상 앞쪽이라 상한을 둬도 안전, IPC 전송량 방어)
const EXPECTED_TOTAL_TEXT_LIMIT = 100000;

/**
 * 화면 텍스트에서 «총 리뷰 수»를 파싱한다. (순수 함수 — 브라우저 없이 node로 검증 가능)
 *
 * ★★이 함수는 «2순위» 폴백이다. 1순위는 네트워크 응답(query-pages의 totalElements)이다.
 *   이유(2026-08-14 실측): 프랭클린 상품에서 라이브 innerText가 "4.9111,737건 리뷰"로 렌더됐다 —
 *   평점 4.91과 총계 11,737이 «붙어» 있고 숫자가 '리뷰' 앞에 온다. 이 형태는 어떤 정규식으로도
 *   안전하게 자를 수 없다(경계 없는 /(\d{1,3}(?:,\d{3})+)\s*건/ 은 "911,737"을 잡는다).
 *   → 이 케이스는 «추정하지 않고» null(미확인)로 떨어뜨린다. 틀린 총계는 없는 총계보다 나쁘다.
 *
 * 인정하는 형태 (문서 순서상 «첫 번째» 매치를 택한다 — 헤더가 본문보다 앞이므로 본문 오염 방지):
 *   ① '리뷰 11,737' / '리뷰(4,630)'  — 라벨이 먼저 오는 형태 (2026-08-15 라이브 실측 형태)
 *      ★왼쪽 경계 필수: 구버전 정규식은 '재구매리뷰 802'·'한달사용리뷰 1,204' 같은 «부분» 리뷰 수를
 *        총합으로 오인했다 → 행 시작(^, m) 또는 «한글·영문·숫자가 아닌» 문자 뒤의 '리뷰'만 인정.
 *   ② '11,737건 리뷰'                — 숫자가 먼저 오는 형태
 *      ★왼쪽 경계([^0-9.,]) 필수 → 접합("4.9111,737건 리뷰")은 매치되지 않고 null이 된다.
 *      ★'건'을 «필수»로, 사이에 줄바꿈을 «불허» → '9,385\n리뷰 11,737'에서 9,385를 줍는 사고 방지.
 *
 * 1자리 수는 평점(4.8 등) 오탐 위험이 커서 제외한다.
 *
 * @param {string} text
 * @returns {number|null} 파싱 실패 시 null = "미확인" (절대 추정하지 않는다)
 */
export function parseExpectedTotalReviews(text) {
  if (!text || typeof text !== 'string') return null;
  const toCount = (raw) => {
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // ① 라벨 → 숫자
  const after = /(?:^|[^가-힣A-Za-z0-9])리뷰\s*[(（]?\s*(\d{1,3}(?:,\d{3})+|\d{2,})/m.exec(text);
  if (after) return toCount(after[1]);
  // ② 숫자 → '건 리뷰' (같은 줄, 왼쪽에 숫자·소수점·쉼표가 붙어 있으면 «거부»)
  const before = /(?:^|[^0-9.,])(\d{1,3}(?:,\d{3})+|\d{2,})[ \t]*건[ \t]*리뷰/m.exec(text);
  if (before) return toCount(before[1]);
  return null;
}

/**
 * 사이트가 표시하는 «총 리뷰 수»를 읽는다.
 *
 * ★출처 우선순위 (2026-08-15 개편):
 *   1순위 = «네트워크» — /v1/contents/reviews/query-pages 응답의 totalElements
 *           (라이브 실측: 프랭클린 상품 11,737 / 스토케 4,630. 화면 렌더 형태에 영향받지 않음)
 *   2순위 = 화면 텍스트 파싱 (parseExpectedTotalReviews) — 접합 렌더에서는 스스로 null을 낸다
 *
 * - 부분수집을 '완료'로 위장하지 않기 위한 대조 기준.
 * - 실패 시 null = "미확인". 절대 추정하지 않고, 절대 throw하지 않는다(파싱 때문에 수집이 죽으면 안 됨).
 * @param {object} targetPage
 * @param {number|null} networkTotal - 네트워크 감시자가 캡처한 총건수 (없으면 null)
 * @returns {Promise<{total:number|null, source:string}>}
 */
async function readExpectedTotalReviews(targetPage, networkTotal = null) {
  if (typeof networkTotal === 'number' && networkTotal > 0) {
    return { total: networkTotal, source: 'network:query-pages.totalElements' };
  }
  try {
    const texts = await targetPage.evaluate((limit) => {
      // innerText를 쓴다 — 레이아웃 기준 줄바꿈이 있어야 '재구매리뷰 802' / '리뷰 11,737'이 서로 다른 줄로 분리된다.
      const grab = (root) => (root ? String(root.innerText || root.textContent || '').slice(0, limit) : '');
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find(d => d.querySelector('li[id^="REVIEW_ITEM_"]'));
      return { dialogText: grab(dialog), bodyText: grab(document.body) };
    }, EXPECTED_TOTAL_TEXT_LIMIT);
    const parsed = parseExpectedTotalReviews(texts.dialogText) || parseExpectedTotalReviews(texts.bodyText);
    return parsed ? { total: parsed, source: 'innerText' } : { total: null, source: 'none' };
  } catch (e) {
    console.log(`[NaverService] 총 리뷰 수 파싱 실패 (무시, 미확인 처리): ${e.message}`);
    return { total: null, source: 'none' };
  }
}

/**
 * 청크 루프에서 «이어받기»가 가능한 종료 사유인지.
 * max_duration / attempts_exhausted = 상한에 걸려 «끊긴» 것 → 리뷰가 끝난 게 아니다.
 */
export function isResumableTermination(reason) {
  return reason === 'max_duration' || reason === 'attempts_exhausted';
}

/**
 * 총계를 모르는 채 «상한/동결»로 끝났는지 = 완주 여부를 «검증할 수 없는» 종료인지.
 * 이 경우 성공 UX로 흘리면 안 된다 (무증상 종료의 본체).
 */
export const UNVERIFIABLE_TERMINATIONS = ['max_duration', 'attempts_exhausted', 'stable_threshold'];

// 청크 이어받기 상한 — 무한루프 방지 (1회당 최대 10분이므로 넉넉하되 유한)
const MAX_CHUNK_RESUMES = 20;

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
      // 속도제한(429)·종료사유·총건수 공유 상태 — loadMoreReviews가 기록, 완료 문구/진단에서 사용
      const scrollFlags = { rateLimitHits: 0, endedByRateLimit: false, resumedAfterRateLimit: 0, terminationReason: null, expectedTotalFromNetwork: null };
      // ★총 리뷰 수 «네트워크» 감시자 — 모달을 여는 순간 query-pages가 발사되므로 «탭 클릭 전»에 붙인다.
      const totalWatcher = collectionType === 0 ? attachReviewTotalWatcher(newPage, { flags: scrollFlags }) : null;

      await clickReviewOrQnATab(newPage, collectionType, sort, sendLog);

      // 기대 총 리뷰 수 확보 — 1순위 네트워크(totalElements), 2순위 화면 텍스트 (둘 다 실패면 null = 미확인)
      let expectedTotal = null;
      let expectedTotalSource = 'none';
      if (collectionType === 0) {
        const read = await readExpectedTotalReviews(newPage, totalWatcher ? totalWatcher.get() : null);
        expectedTotal = read.total;
        expectedTotalSource = read.source;
      }
      if (expectedTotal) {
        console.log(`[NaverService] 📊 총 리뷰 수: ${expectedTotal} (출처: ${expectedTotalSource})`);
        sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
      } else if (collectionType === 0) {
        console.log(`[NaverService] ⚠️ 총 리뷰 수 미확인 — 수집량 «검증 불가» 상태로 진행합니다.`);
      }

      // 리뷰/Q&A 공용 변수 (최종 요약에서 사용하므로 블록 밖에서 선언)
      let allReviews = [];
      let allQnAs = [];
      let finalSavePath = null; // 저장 경로 초기화
      // 부분수집 여부 — 완료 문구/반환값에서 공유
      let partial = false;
      // 완주 여부를 «검증할 수 없는» 종료였는지 (총계 미확인 + 상한/동결 종료)
      let unverified = false;
      // 수집 루프가 예외로 중단됐는지 (수집분은 살리되 '완료'로 위장하지 않기 위함)
      let crawlError = null;
      // 리뷰를 1건도 못 얻었는지 — 성공 처리 금지 대상
      let collectFailed = false;

      // Q&A 수집일 때 Q&A 추출 (모달 무한 스크롤 단일 흐름)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] Q&A 추출 시작... (목표 ${targetText})`);
        sendLog(`[시작] Q&A 추출 시작 (목표 ${targetText})`, 'info');

        // 무한 스크롤로 모달 내 Q&A 로드
        sendLog(`[진행] 모달 무한 스크롤로 Q&A 로딩 중...`, 'info', true);
        const finalCount = await loadMoreQnAs(newPage, targetCount, { flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
        console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount} (종료 사유: ${scrollFlags.terminationReason})`);
        // Q&A 부분수집 표기 — 총 Q&A 수 대조는 «미구현»이라 종료 사유만으로 판정한다(끝까지 봤다는 보장은 없음).
        partial = !!(scrollFlags.endedByRateLimit || scrollFlags.endedByNoContainer
          || scrollFlags.terminationReason === 'max_duration' || scrollFlags.terminationReason === 'attempts_exhausted');
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

        // ★수집 루프는 통째로 try로 감싼다.
        //   loadMoreReviews / extractAllReviews가 예외를 던지면(실측 이력: detached Frame)
        //   그때까지 모은 리뷰·부분수집 판정·저장이 «전부 증발»했다.
        //   → 여기서 잡아 아래 저장/마감 로직으로 흘려보내고, 부분수집으로 정직하게 종료한다.
        // ★청크 «이어받기» 상태 — 10분 상한(max_duration)/시도 소진으로 끊긴 청크를 «리뷰 없음»과 구분한다.
        let resumeCount = 0;
        let zeroProgressStreak = 0;

        try {
          while (true) {
            const target = originalTargetCount === Infinity
              ? prevCount + CHUNK_SIZE_REVIEWS
              : Math.min(prevCount + CHUNK_SIZE_REVIEWS, originalTargetCount);

            sendLog(`[진행] 청크 ${chunkNum} — 무한 스크롤 (목표 ${target}개)...`, 'info', true);
            const reachedCount = await loadMoreReviews(newPage, target, { diagnostic, chunkNum, flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
            sendLog(`[진행] 청크 ${chunkNum} — ${reachedCount}개 로드됨, 추출 중...`, 'info', true);

            // 상한에 걸려 «끊긴» 종료인가 (= 리뷰가 끝난 게 아니다)
            const resumable = isResumableTermination(scrollFlags.terminationReason);

            const all = await extractAllReviews(newPage, photoFolderPath, 1, { downloadImages, smallImage, sendLog });
            const newSlice = all.slice(prevCount);
            if (newSlice.length === 0) {
              // 진행 0 — 상한으로 끊긴 경우에 한해 «한 번» 더 이어붙인다. 두 번 연속 0이면 중단.
              zeroProgressStreak++;
              if (resumable && zeroProgressStreak < 2 && resumeCount < MAX_CHUNK_RESUMES) {
                resumeCount++;
                console.log(`[NaverService] 🔁 청크 ${chunkNum} 진행 0 + 상한 종료(${scrollFlags.terminationReason}) — 이어서 재시도 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
                sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
                continue;
              }
              break;
            }
            zeroProgressStreak = 0;

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

            if (originalTargetCount !== Infinity && allReviews.length >= originalTargetCount) break;

            if (reachedCount < target) {
              // ★여기가 «무증상 종료»의 직접 원인이던 자리 —
              //   예전에는 '리뷰가 진짜 끝났다'와 '10분 상한으로 끊겼다'를 구분하지 않고 통째로 루프를 끝냈다.
              //   상한으로 끊긴 것이면 «이어서» 다시 호출한다 (진행이 있으면 계속, 상한은 MAX_CHUNK_RESUMES).
              if (resumable && resumeCount < MAX_CHUNK_RESUMES) {
                resumeCount++;
                console.log(`[NaverService] 🔁 청크 ${chunkNum - 1}이 상한(${scrollFlags.terminationReason})으로 끊김 (${reachedCount}/${target}) — 이어서 계속 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
                sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
                continue;
              }
              // 목표 미달 + 이어받기 불가/소진. 사유는 scrollFlags.terminationReason에 기록돼 있고,
              // 부분수집 여부는 아래 expectedTotal 대조 + 검증불가 판정이 최종 결정한다(조용한 '완료' 위장 방지).
              console.log(`[NaverService] ⏹️ 청크 ${chunkNum - 1} 목표 미달로 루프 종료 (${reachedCount}/${target}, 사유: ${scrollFlags.terminationReason}, 재개 ${resumeCount}/${MAX_CHUNK_RESUMES})`);
              break;
            }
          }
        } catch (error) {
          // 원문 에러는 로그(개발자용)로만 남기고, 사용자에게는 이해되는 문구로 알린다.
          crawlError = error;
          console.error(`[NaverService] ❌ 수집 중 예외 — 수집분을 저장하고 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
          sendLog(`[경고] ⚠️ 수집 도중 네이버 페이지 연결이 끊겨 중단했습니다 — 지금까지 모은 ${allReviews.length}개를 저장합니다.`, 'warning');
          if (!scrollFlags.terminationReason) scrollFlags.terminationReason = 'exception';
        }

        // 총계 «늦은» 캡처 회수 — 모달 진입 시점에 못 잡았어도 수집 중 응답에서 잡혔을 수 있다.
        if (expectedTotal == null && scrollFlags.expectedTotalFromNetwork) {
          expectedTotal = scrollFlags.expectedTotalFromNetwork;
          expectedTotalSource = 'network:query-pages.totalElements(late)';
          console.log(`[NaverService] 📊 총 리뷰 수(수집 중 캡처): ${expectedTotal}`);
          sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
        }
        if (totalWatcher) totalWatcher.detach();

        // 모달 닫기 (루프 종료 후 1회)
        try {
          await closeReviewModal(newPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ 모달 닫기 실패: ${e.message}`);
        }

        // 부분수집 판정 — 사이트가 표시하는 총 리뷰 수와 대조한다.
        //  · ★expectedTotal이 null(=총계 미확인)이면 더 이상 «성공 UX 그대로»가 아니다.
        //    2026-08-14 실측에서 바로 그 조합(총계 미확인 + max_duration + 1,420/11,737)이
        //    partial=false로 빠져나가 «무증상 종료»를 만들었다 → 아래 unverified 판정이 막는다.
        //  · 개수 지정 수집(100/300/1000개)은 목표치가 상한이므로 min(expectedTotal, 목표)로 비교
        const expectedForRun = expectedTotal
          ? (originalTargetCount === Infinity ? expectedTotal : Math.min(expectedTotal, originalTargetCount))
          : null;
        const shortfall = !!expectedForRun && allReviews.length < Math.floor(expectedForRun * 0.98);
        // ★0건 가드 — expectedTotal 파싱 성공 여부와 «무관하게» 0건은 성공이 아니다.
        //   (li 셀렉터와 본문 텍스트가 «동시에» 깨지면 '총 0개 추출' + 초록 완료가 나가던 구멍)
        const zeroYield = allReviews.length === 0;
        // ★검증 불가 판정 — «무증상 종료»의 본체.
        //   총계를 모르는데 상한(max_duration/attempts_exhausted)이나 동결(stable_threshold)로 끝났으면
        //   전량을 받았는지 «확인할 방법이 없다» → 성공(초록)으로 흘리지 않는다.
        //   (target_reached는 사용자가 지정한 개수를 채운 것이므로 제외)
        unverified = !expectedForRun && UNVERIFIABLE_TERMINATIONS.includes(scrollFlags.terminationReason);
        collectFailed = zeroYield;
        partial = scrollFlags.endedByRateLimit || shortfall || zeroYield || unverified || !!crawlError;

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다. (부분수집=${partial}, 검증불가=${unverified}, 0건=${zeroYield}, 총계=${expectedTotal ?? '미확인'}/${expectedTotalSource}, 종료사유=${scrollFlags.terminationReason})`);
        if (zeroYield) {
          sendLog(`[오류] 리뷰를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행하고, 계속 실패하면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다. (⚠️ 부분수집)`, 'warning');
        } else {
          sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');
        }

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${allReviews.length}개까지만 수집되었습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 다시 실행하면 속도제한 없이 전량 수집됩니다.`, 'info');
        } else if (shortfall) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 리뷰는 ${expectedTotal.toLocaleString()}건인데 ${allReviews.length}개만 수집되었습니다.`, 'warning');
          sendLog(`[안내] 다시 실행해 주세요. ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)`, 'info');
        } else if (unverified) {
          // ★총계를 못 읽었으면 «성공 UX로 흘리지 않고» 검증 불가를 명시한다.
          sendLog(`[경고] ⚠️ 수집량 «검증 불가» — 이 상품의 총 리뷰 수를 확인하지 못했습니다. ${allReviews.length}개를 수집했지만 «전량인지 확인할 수 없습니다».`, 'warning');
          sendLog(`[안내] 상품 페이지에 표시된 리뷰 수와 직접 비교해 주세요. 차이가 크면 '안정 수집'을 체크하고 다시 실행해 주세요.`, 'info');
        } else if (scrollFlags.resumedAfterRateLimit > 0) {
          sendLog(`[정보] 수집 중 네이버 속도제한(429)을 ${scrollFlags.resumedAfterRateLimit}회 만났고, 대기 후 끝까지 이어받았습니다.`, 'info');
        }

        if (partial && scrollFlags.terminationReason) {
          sendLog(`[정보] 중단 지점 코드: ${scrollFlags.terminationReason}${scrollFlags.usedContainerFallback ? ' / container-fallback' : ''} — 문의 시 이 코드를 함께 알려주세요.`, 'info');
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
      if (collectFailed) {
        // 0건은 '완료'가 아니다 — 초록 완료 문구를 내지 않는다.
        sendLog(`[실패] 리뷰를 1건도 수집하지 못해 실패로 종료합니다. (${finalCountMessage})`, 'error');
      } else if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else if (unverified) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 수집량 «검증 불가», 위 경고를 확인해 주세요)`, 'warning');
      } else if (partial) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 부분수집, 위 경고를 확인해 주세요)`, 'warning');
      } else {
        sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
      }
      await uploadDiagnosticIfEnabled(
        { input, isUrl, collectionType, sort, pages, customPages },
        {
          success: !collectFailed,
          totalReviews: allReviews.length,
          totalQnAs: allQnAs.length,
          partial,
          unverified,
          expectedTotal,
          expectedTotalSource,
          terminationReason: scrollFlags.terminationReason || null,
          crawlError: crawlError ? String(crawlError.message || crawlError) : null,
          usedContainerFallback: !!scrollFlags.usedContainerFallback,
          endedByStall: !!scrollFlags.endedByStall,
          rateLimitHits: scrollFlags.rateLimitHits,
          rateLimitResumes: scrollFlags.resumedAfterRateLimit,
        }
      );
      return {
        success: !collectFailed,
        failedAt: collectFailed ? 'collect' : undefined,
        error: collectFailed
          ? `리뷰를 1건도 수집하지 못했습니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`
          : undefined,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: true,
        platform: '네이버',
        finalUrl: targetUrl,
        collectionType: collectionType,
        reviews: allReviews,
        savePath: finalSavePath,
        partial,
        unverified,
        expectedTotal,
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
      // 속도제한(429)·종료사유·총건수 공유 상태 — loadMoreReviews가 기록, 완료 문구/진단에서 사용
      const scrollFlags = { rateLimitHits: 0, endedByRateLimit: false, resumedAfterRateLimit: 0, terminationReason: null, expectedTotalFromNetwork: null };
      // ★총 리뷰 수 «네트워크» 감시자 — 모달을 여는 순간 query-pages가 발사되므로 «탭 클릭 전»에 붙인다.
      const totalWatcher = collectionType === 0 ? attachReviewTotalWatcher(productPage, { flags: scrollFlags }) : null;

      await clickReviewOrQnATab(productPage, collectionType, sort, sendLog);

      // 기대 총 리뷰 수 확보 — 1순위 네트워크(totalElements), 2순위 화면 텍스트 (둘 다 실패면 null = 미확인)
      let expectedTotal = null;
      let expectedTotalSource = 'none';
      if (collectionType === 0) {
        const read = await readExpectedTotalReviews(productPage, totalWatcher ? totalWatcher.get() : null);
        expectedTotal = read.total;
        expectedTotalSource = read.source;
      }
      if (expectedTotal) {
        console.log(`[NaverService] 📊 총 리뷰 수: ${expectedTotal} (출처: ${expectedTotalSource})`);
        sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
      } else if (collectionType === 0) {
        console.log(`[NaverService] ⚠️ 총 리뷰 수 미확인 — 수집량 «검증 불가» 상태로 진행합니다.`);
      }

      // 리뷰 수집일 때 리뷰 추출 (여러 페이지)
      let allReviews = [];
      let allQnAs = []; // Q&A 수집용 (스코프 문제 해결)
      let finalSavePath = null; // 저장 경로 초기화
      // 부분수집 여부 — 완료 문구/반환값에서 공유
      let partial = false;
      // 완주 여부를 «검증할 수 없는» 종료였는지 (총계 미확인 + 상한/동결 종료)
      let unverified = false;
      // 수집 루프가 예외로 중단됐는지 (수집분은 살리되 '완료'로 위장하지 않기 위함)
      let crawlError = null;
      // 리뷰를 1건도 못 얻었는지 — 성공 처리 금지 대상
      let collectFailed = false;
      
      // Q&A 수집일 때 Q&A 추출 (모달 무한 스크롤 단일 흐름)
      if (collectionType === 1) {
        const maxPages = getMaxPages(pages, customPages);
        const targetCount = maxPages === Infinity ? Infinity : maxPages * 20;
        const targetText = targetCount === Infinity ? '무제한' : `약 ${targetCount}개`;
        console.log(`[NaverService] Q&A 추출 시작... (목표 ${targetText})`);
        sendLog(`[시작] Q&A 추출 시작 (목표 ${targetText})`, 'info');

        // 무한 스크롤로 모달 내 Q&A 로드
        sendLog(`[진행] 모달 무한 스크롤로 Q&A 로딩 중...`, 'info', true);
        const finalCount = await loadMoreQnAs(productPage, targetCount, { flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
        console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount} (종료 사유: ${scrollFlags.terminationReason})`);
        // Q&A 부분수집 표기 — 총 Q&A 수 대조는 «미구현»이라 종료 사유만으로 판정한다(끝까지 봤다는 보장은 없음).
        partial = !!(scrollFlags.endedByRateLimit || scrollFlags.endedByNoContainer
          || scrollFlags.terminationReason === 'max_duration' || scrollFlags.terminationReason === 'attempts_exhausted');
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

        // ★수집 루프는 통째로 try로 감싼다 (URL 분기와 동일 원칙).
        //   예외가 나도 그때까지 모은 리뷰·부분수집 판정·저장이 증발하지 않게 아래 마감 로직으로 흘려보낸다.
        // ★청크 «이어받기» 상태 — 10분 상한(max_duration)/시도 소진으로 끊긴 청크를 «리뷰 없음»과 구분한다.
        let resumeCount = 0;
        let zeroProgressStreak = 0;

        try {
          while (true) {
            const target = originalTargetCount === Infinity
              ? prevCount + CHUNK_SIZE_REVIEWS
              : Math.min(prevCount + CHUNK_SIZE_REVIEWS, originalTargetCount);

            sendLog(`[진행] 청크 ${chunkNum} — 무한 스크롤 (목표 ${target}개)...`, 'info', true);
            const reachedCount = await loadMoreReviews(productPage, target, { diagnostic, chunkNum, flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
            sendLog(`[진행] 청크 ${chunkNum} — ${reachedCount}개 로드됨, 추출 중...`, 'info', true);

            // 상한에 걸려 «끊긴» 종료인가 (= 리뷰가 끝난 게 아니다)
            const resumable = isResumableTermination(scrollFlags.terminationReason);

            const all = await extractAllReviews(productPage, photoFolderPath, 1, { downloadImages, smallImage, sendLog });
            const newSlice = all.slice(prevCount);
            if (newSlice.length === 0) {
              // 진행 0 — 상한으로 끊긴 경우에 한해 «한 번» 더 이어붙인다. 두 번 연속 0이면 중단.
              zeroProgressStreak++;
              if (resumable && zeroProgressStreak < 2 && resumeCount < MAX_CHUNK_RESUMES) {
                resumeCount++;
                console.log(`[NaverService] 🔁 청크 ${chunkNum} 진행 0 + 상한 종료(${scrollFlags.terminationReason}) — 이어서 재시도 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
                sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
                continue;
              }
              break;
            }
            zeroProgressStreak = 0;

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

            if (originalTargetCount !== Infinity && allReviews.length >= originalTargetCount) break;

            if (reachedCount < target) {
              // ★여기가 «무증상 종료»의 직접 원인이던 자리 —
              //   예전에는 '리뷰가 진짜 끝났다'와 '10분 상한으로 끊겼다'를 구분하지 않고 통째로 루프를 끝냈다.
              //   상한으로 끊긴 것이면 «이어서» 다시 호출한다 (진행이 있으면 계속, 상한은 MAX_CHUNK_RESUMES).
              if (resumable && resumeCount < MAX_CHUNK_RESUMES) {
                resumeCount++;
                console.log(`[NaverService] 🔁 청크 ${chunkNum - 1}이 상한(${scrollFlags.terminationReason})으로 끊김 (${reachedCount}/${target}) — 이어서 계속 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
                sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
                continue;
              }
              // 목표 미달 + 이어받기 불가/소진. 사유는 scrollFlags.terminationReason에 기록돼 있고,
              // 부분수집 여부는 아래 expectedTotal 대조 + 검증불가 판정이 최종 결정한다(조용한 '완료' 위장 방지).
              console.log(`[NaverService] ⏹️ 청크 ${chunkNum - 1} 목표 미달로 루프 종료 (${reachedCount}/${target}, 사유: ${scrollFlags.terminationReason}, 재개 ${resumeCount}/${MAX_CHUNK_RESUMES})`);
              break;
            }
          }
        } catch (error) {
          // 원문 에러는 로그(개발자용)로만 남기고, 사용자에게는 이해되는 문구로 알린다.
          crawlError = error;
          console.error(`[NaverService] ❌ 수집 중 예외 — 수집분을 저장하고 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
          sendLog(`[경고] ⚠️ 수집 도중 네이버 페이지 연결이 끊겨 중단했습니다 — 지금까지 모은 ${allReviews.length}개를 저장합니다.`, 'warning');
          if (!scrollFlags.terminationReason) scrollFlags.terminationReason = 'exception';
        }

        // 총계 «늦은» 캡처 회수 — 모달 진입 시점에 못 잡았어도 수집 중 응답에서 잡혔을 수 있다.
        if (expectedTotal == null && scrollFlags.expectedTotalFromNetwork) {
          expectedTotal = scrollFlags.expectedTotalFromNetwork;
          expectedTotalSource = 'network:query-pages.totalElements(late)';
          console.log(`[NaverService] 📊 총 리뷰 수(수집 중 캡처): ${expectedTotal}`);
          sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
        }
        if (totalWatcher) totalWatcher.detach();

        // 모달 닫기 (루프 종료 후 1회)
        try {
          await closeReviewModal(productPage);
        } catch (e) {
          console.log(`[NaverService] ⚠️ 모달 닫기 실패: ${e.message}`);
        }

        // 부분수집 판정 — 사이트가 표시하는 총 리뷰 수와 대조한다.
        //  · ★expectedTotal이 null(=총계 미확인)이면 더 이상 «성공 UX 그대로»가 아니다.
        //    2026-08-14 실측에서 바로 그 조합(총계 미확인 + max_duration + 1,420/11,737)이
        //    partial=false로 빠져나가 «무증상 종료»를 만들었다 → 아래 unverified 판정이 막는다.
        //  · 개수 지정 수집(100/300/1000개)은 목표치가 상한이므로 min(expectedTotal, 목표)로 비교
        const expectedForRun = expectedTotal
          ? (originalTargetCount === Infinity ? expectedTotal : Math.min(expectedTotal, originalTargetCount))
          : null;
        const shortfall = !!expectedForRun && allReviews.length < Math.floor(expectedForRun * 0.98);
        // ★0건 가드 — expectedTotal 파싱 성공 여부와 «무관하게» 0건은 성공이 아니다.
        //   (li 셀렉터와 본문 텍스트가 «동시에» 깨지면 '총 0개 추출' + 초록 완료가 나가던 구멍)
        const zeroYield = allReviews.length === 0;
        // ★검증 불가 판정 — «무증상 종료»의 본체.
        //   총계를 모르는데 상한(max_duration/attempts_exhausted)이나 동결(stable_threshold)로 끝났으면
        //   전량을 받았는지 «확인할 방법이 없다» → 성공(초록)으로 흘리지 않는다.
        //   (target_reached는 사용자가 지정한 개수를 채운 것이므로 제외)
        unverified = !expectedForRun && UNVERIFIABLE_TERMINATIONS.includes(scrollFlags.terminationReason);
        collectFailed = zeroYield;
        partial = scrollFlags.endedByRateLimit || shortfall || zeroYield || unverified || !!crawlError;

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다. (부분수집=${partial}, 검증불가=${unverified}, 0건=${zeroYield}, 총계=${expectedTotal ?? '미확인'}/${expectedTotalSource}, 종료사유=${scrollFlags.terminationReason})`);
        if (zeroYield) {
          sendLog(`[오류] 리뷰를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행하고, 계속 실패하면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다. (⚠️ 부분수집)`, 'warning');
        } else {
          sendLog(`[완료] 총 ${allReviews.length}개의 리뷰를 추출했습니다.`, 'success');
        }

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${allReviews.length}개까지만 수집되었습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 다시 실행하면 속도제한 없이 전량 수집됩니다.`, 'info');
        } else if (shortfall) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 리뷰는 ${expectedTotal.toLocaleString()}건인데 ${allReviews.length}개만 수집되었습니다.`, 'warning');
          sendLog(`[안내] 다시 실행해 주세요. ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)`, 'info');
        } else if (unverified) {
          // ★총계를 못 읽었으면 «성공 UX로 흘리지 않고» 검증 불가를 명시한다.
          sendLog(`[경고] ⚠️ 수집량 «검증 불가» — 이 상품의 총 리뷰 수를 확인하지 못했습니다. ${allReviews.length}개를 수집했지만 «전량인지 확인할 수 없습니다».`, 'warning');
          sendLog(`[안내] 상품 페이지에 표시된 리뷰 수와 직접 비교해 주세요. 차이가 크면 '안정 수집'을 체크하고 다시 실행해 주세요.`, 'info');
        } else if (scrollFlags.resumedAfterRateLimit > 0) {
          sendLog(`[정보] 수집 중 네이버 속도제한(429)을 ${scrollFlags.resumedAfterRateLimit}회 만났고, 대기 후 끝까지 이어받았습니다.`, 'info');
        }

        if (partial && scrollFlags.terminationReason) {
          sendLog(`[정보] 중단 지점 코드: ${scrollFlags.terminationReason}${scrollFlags.usedContainerFallback ? ' / container-fallback' : ''} — 문의 시 이 코드를 함께 알려주세요.`, 'info');
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
      if (collectFailed) {
        // 0건은 '완료'가 아니다 — 초록 완료 문구를 내지 않는다.
        sendLog(`[실패] 리뷰를 1건도 수집하지 못해 실패로 종료합니다. (${finalCountMessage})`, 'error');
      } else if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else if (unverified) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 수집량 «검증 불가», 위 경고를 확인해 주세요)`, 'warning');
      } else if (partial) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 부분수집, 위 경고를 확인해 주세요)`, 'warning');
      } else {
        sendLog(`[완료] 크롤링이 완료되었습니다. (${finalCountMessage})`, 'success');
      }
      await uploadDiagnosticIfEnabled(
        { input, isUrl, collectionType, sort, pages, customPages },
        {
          success: !collectFailed,
          totalReviews: allReviews.length,
          totalQnAs: allQnAs.length,
          partial,
          unverified,
          expectedTotal,
          expectedTotalSource,
          terminationReason: scrollFlags.terminationReason || null,
          crawlError: crawlError ? String(crawlError.message || crawlError) : null,
          usedContainerFallback: !!scrollFlags.usedContainerFallback,
          endedByStall: !!scrollFlags.endedByStall,
          rateLimitHits: scrollFlags.rateLimitHits,
          rateLimitResumes: scrollFlags.resumedAfterRateLimit,
        }
      );
      return {
        success: !collectFailed,
        failedAt: collectFailed ? 'collect' : undefined,
        error: collectFailed
          ? `리뷰를 1건도 수집하지 못했습니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`
          : undefined,
        message: '상품 페이지로 이동하고 리뷰/Q&A 탭을 클릭했습니다.',
        isUrl: false,
        platform: '네이버',
        searchQuery: input,
        searchUrl: targetUrl,
        productUrl: productUrl,
        collectionType: collectionType,
        reviews: allReviews,
        savePath: finalSavePath,
        partial,
        unverified,
        expectedTotal,
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

