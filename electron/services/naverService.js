/**
 * 네이버 플랫폼 전용 서비스
 */
// productPageUtil의 verify는 페이지 리뉴얼로 옛 셀렉터가 무효화되어 사용 중단.
// 페이지 상태 검증은 naverTabActions.waitForCaptchaIfNeeded + 모달 진입 폴링이 대체.
import { uploadDiagnostic, findUserByIp } from './licenseService.js';
import { navigateToNaver, createNaverSearchUrl, isNaverProductPage, waitForNaverProductPage, closeReviewModal, closeQnAModal } from './naver/naverNavigation.js';
import { clickReviewOrQnATab } from './naver/naverTabActions.js';
import { extractAllReviews, finalizeReviews, createPhotoStats, topPhotoFailReasons } from './naver/naverReviewExtractor.js';
import { attachReviewApiTemplate, collectReviewsViaApi } from './naver/naverReviewApi.js';
import { extractAllQnAs } from './naver/naverQnAExtractor.js';
import { navigateToNextPage, hasNextPage, loadMoreReviews, getReviewCount, attachReviewTotalWatcher } from './naver/naverPagination.js';
import { loadMoreQnAs, attachQnATotalWatcher } from './naver/naverQnAPagination.js';
import { saveReviews, saveReviewsToExcelChunk, createReviewKey } from '../../src/utils/naver/storage/index.js';
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
 * ★Q&A 수집량 «총계 대조» 판정 (v1.7.2) — 순수 함수라 브라우저 없이 node로 검증 가능.
 *
 * 왜 필요한가: 리뷰는 v1.7.0에서 총계(totalElements) 대조로 «조용히 덜 받고 완료» 를 막았는데
 * Q&A는 그대로였다. Q&A도 /v1/qna/pages 응답에 totalElements가 있다(2026-08-18 실측: 485건).
 * ⇒ 리뷰와 «같은 구조»를 이식한다. 새로 발명하지 않는다.
 *
 * 두 개의 손실 지점을 «구분»해서 본다:
 *   ① 로딩 손실 = 무한 스크롤이 총계만큼 못 불러온 것   (loadedCount vs 총계)
 *   ② 추출 손실 = 불러온 li를 추출에서 놓친 것          (savedCount vs loadedCount)
 *   ★②는 «비밀글 제외»가 켜져 있으면 정상적인 감소다(사용자가 고른 필터) → 그때는 부분수집으로 보지 않는다.
 *
 * @param {object} p
 * @param {number} p.loadedCount - 무한 스크롤이 모달에 올린 li 개수
 * @param {number} p.savedCount - 실제로 추출/저장된 Q&A 개수
 * @param {number|null} p.expectedTotal - 네트워크에서 잡은 총 Q&A 수 (null = 미확인)
 * @param {number} p.targetCount - 이번 실행 목표 개수 (Infinity 가능)
 * @param {boolean} p.excludeSecret - 비밀글 제외 옵션
 * @param {string|null} p.terminationReason - 스크롤 종료 사유
 * @param {boolean} p.endedByRateLimit
 * @param {boolean} p.endedByNoContainer
 * @param {boolean} p.crawlError - 로딩/추출이 «예외»로 끊겼는지 (수집분은 살리되 완료로 위장하지 않는다)
 * @returns {{expectedForRun:number|null, shortfall:boolean, extractShortfall:boolean, zeroYield:boolean,
 *            unverified:boolean, partial:boolean, collectFailed:boolean, yieldSummary:string}}
 */
export function judgeQnAYield(p = {}) {
  const {
    loadedCount = 0, savedCount = 0, expectedTotal = null, targetCount = Infinity,
    excludeSecret = false, terminationReason = null,
    endedByRateLimit = false, endedByNoContainer = false, crawlError = false,
  } = p;

  // ★expectedTotal이 0일 수 있다 (Q&A가 없는 상품) → truthy 검사 금지, null 검사로 판별한다.
  const expectedForRun = expectedTotal == null
    ? null
    : (targetCount === Infinity ? expectedTotal : Math.min(expectedTotal, targetCount));

  // ① 로딩 손실 — 리뷰와 동일한 98% 허용치
  const shortfall = expectedForRun != null && expectedForRun > 0 && loadedCount < Math.floor(expectedForRun * 0.98);
  // ② 추출 손실 — 비밀글 제외가 켜져 있으면 «정상 감소»라 판정에서 뺀다
  const extractShortfall = !excludeSecret && loadedCount > 0 && savedCount < Math.floor(loadedCount * 0.98);
  // 0건 — 단, 총계가 «0»이면 0건이 정답이다 (Q&A가 없는 상품). 총계를 모르면 0건은 실패로 본다.
  const zeroYield = savedCount === 0 && (expectedForRun == null || expectedForRun > 0);
  // 총계를 모르는데 상한/동결로 끝났으면 전량인지 «확인할 방법이 없다»
  const unverified = expectedForRun == null && UNVERIFIABLE_TERMINATIONS.includes(terminationReason);

  const partial = !!(endedByRateLimit || endedByNoContainer || shortfall || extractShortfall || zeroYield || unverified || crawlError);

  const yieldSummary = expectedForRun != null
    ? `${savedCount.toLocaleString()}/${expectedForRun.toLocaleString()}건`
    : `${savedCount.toLocaleString()}건 (총계 미확인)`;

  return { expectedForRun, shortfall, extractShortfall, zeroYield, unverified, partial, collectFailed: zeroYield, yieldSummary };
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

// 엑셀 청크 저장 단위 (수집 도중 앱이 죽어도 여기까지는 파일로 남는다)
const CHUNK_SIZE_REVIEWS = 1000;

/**
 * ★리뷰 수집 ①경로 — «리뷰 API 직접 페이징» (2026-08-15 전량 완주 실증)
 *
 * 모달 무한 스크롤은 li가 쌓일수록 27배까지 느려져 대형 상품에서 «구조적으로» 완주가 불가능했다.
 * 같은 상품을 query-pages API로 페이징하면 11,752/11,752건을 1,773초에 완주한다.
 * 수집(원시) → 1,000개 단위로 사진 다운로드 + 엑셀 청크 저장까지 여기서 마친다.
 *
 * @returns {Promise<{allReviews:Array, excelChunkCount:number, crawlError:Error|null, api:object|null}>}
 */
// ★중복 제거는 «수집 시점»에 한 번 한다 (2026-08-18 지혜맥 e2e에서 발견).
//   전에는 저장부(excelStorage/jsonStorage)가 «조용히» 중복을 지웠다.
//   → 화면엔 수집분 565, 파일엔 저장분 562. 사용자에게 말한 숫자와 준 파일이 달랐다.
//   ⇒ 여기서 걸러 두면 allReviews.length == 실제 저장 건수가 되고,
//     청크 간 중복(엑셀은 청크별로만 걸러서 새던 것)도 같이 막힌다.
function dropDuplicateReviews(list, seenKeys) {
  const kept = [];
  let dropped = 0;
  for (const review of list) {
    const key = createReviewKey(review);
    if (seenKeys.has(key)) { dropped++; continue; }
    seenKeys.add(key);
    kept.push(review);
  }
  return { kept, dropped };
}

async function collectReviewsByApi(targetPage, opts) {
  const { template, targetCount, photoFolderPath, savePath, downloadImages, smallImage, imageMode, sendLog, flags, photoStats } = opts;
  const allReviews = [];
  let excelChunkCount = 0;
  let crawlError = null;
  let api = null;
  const seenKeys = new Set();
  let duplicateCount = 0;

  try {
    api = await collectReviewsViaApi(targetPage, { targetCount, template, sendLog, flags });

    let chunkNum = 1;
    for (let off = 0; off < api.rawReviews.length; off += CHUNK_SIZE_REVIEWS) {
      const slice = api.rawReviews.slice(off, off + CHUNK_SIZE_REVIEWS);
      // ★DOM 경로와 «같은» 조립 함수 — 최종 객체 형태(엑셀 컬럼)가 두 경로에서 동일하다.
      //   indexOffset을 줘서 Page_Review 번호와 이미지 파일명이 청크 간에 겹치지 않게 한다.
      const finalizedRaw = await finalizeReviews(slice, photoFolderPath, 1, { downloadImages, smallImage, imageMode, sendLog, indexOffset: off, photoStats });
      // ★저장 «전»에 중복을 걸러 화면 숫자와 파일 건수를 일치시킨다.
      const { kept: finalized, dropped } = dropDuplicateReviews(finalizedRaw, seenKeys);
      duplicateCount += dropped;
      if (finalized.length === 0) { chunkNum++; continue; }

      try {
        sendLog(`[진행] 청크 ${chunkNum} 저장 중 (${finalized.length}개)...`, 'info', true);
        const chunkPath = await saveReviewsToExcelChunk(finalized, 'naver_reviews', savePath, chunkNum);
        if (chunkPath) {
          console.log(`[NaverService] ✅ 청크 ${chunkNum} 저장 완료: ${chunkPath}`);
          sendLog(`[완료] 청크 ${chunkNum} 저장 완료 (${finalized.length}개, 누적 ${allReviews.length + finalized.length}개)`, 'success');
          excelChunkCount++;
        }
      } catch (error) {
        console.error(`[NaverService] ❌ 청크 ${chunkNum} 저장 실패: ${error.message}`);
        sendLog(`[오류] 청크 ${chunkNum} 저장 실패: ${error.message}`, 'error');
      }

      allReviews.push(...finalized);
      chunkNum++;
    }
  } catch (error) {
    crawlError = error;
    console.error(`[NaverService] ❌ API 수집 중 예외 — 수집분을 저장하고 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
    sendLog(`[경고] ⚠️ 수집 도중 오류로 중단했습니다 — 지금까지 모은 ${allReviews.length}개를 저장합니다.`, 'warning');
    if (flags && !flags.terminationReason) flags.terminationReason = 'api_exception';
  }

  return { allReviews, excelChunkCount, crawlError, api, duplicateCount };
}

/**
 * 리뷰 수집 ②경로(폴백) — 기존 «모달 무한 스크롤 + 청크 추출».
 * API 요청 템플릿을 «못 잡았을 때»만 쓴다. 로직은 종전과 동일하며, URL/검색어 분기에 복제돼 있던 것을 한 곳으로 모았다.
 *
 * @returns {Promise<{allReviews:Array, excelChunkCount:number, crawlError:Error|null}>}
 */
async function collectReviewsByScroll(targetPage, opts) {
  const { targetCount, photoFolderPath, savePath, downloadImages, smallImage, imageMode, sendLog, flags, diagnostic, scrollWaitMs, photoStats } = opts;
  const originalTargetCount = targetCount; // Infinity 가능
  const allReviews = [];
  let excelChunkCount = 0;
  let crawlError = null;
  let prevCount = 0;
  let chunkNum = 1;
  const seenKeys = new Set();
  let duplicateCount = 0;

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
      const reachedCount = await loadMoreReviews(targetPage, target, { diagnostic, chunkNum, flags, sendLog, tuning: { scrollWaitMs } });
      sendLog(`[진행] 청크 ${chunkNum} — ${reachedCount}개 로드됨, 추출 중...`, 'info', true);

      // 상한에 걸려 «끊긴» 종료인가 (= 리뷰가 끝난 게 아니다)
      const resumable = isResumableTermination(flags.terminationReason);

      // ★사진 집계는 «회차마다 새로» 센다 — 이 경로는 청크마다 모달 «전체»를 다시 추출하므로
      //   누적하면 같은 사진을 청크 수만큼 중복으로 센다. 마지막 회차가 곧 전체 집계다.
      const roundPhotoStats = createPhotoStats();
      const all = await extractAllReviews(targetPage, photoFolderPath, 1, { downloadImages, smallImage, imageMode, sendLog, photoStats: roundPhotoStats });
      if (photoStats) Object.assign(photoStats, roundPhotoStats);
      let newSlice = all.slice(prevCount);   // ★아래에서 중복 제거로 재할당된다
      if (newSlice.length === 0) {
        // 진행 0 — 상한으로 끊긴 경우에 한해 «한 번» 더 이어붙인다. 두 번 연속 0이면 중단.
        zeroProgressStreak++;
        if (resumable && zeroProgressStreak < 2 && resumeCount < MAX_CHUNK_RESUMES) {
          resumeCount++;
          console.log(`[NaverService] 🔁 청크 ${chunkNum} 진행 0 + 상한 종료(${flags.terminationReason}) — 이어서 재시도 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
          sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
          continue;
        }
        break;
      }
      zeroProgressStreak = 0;

      // ★저장 «전»에 중복을 걸러 화면 숫자와 파일 건수를 일치시킨다 (API 경로와 동일).
      //   ⚠️prevCount는 «DOM에서 몇 개까지 읽었나»라 여기서 건드리지 않는다 — 다음 slice 기준점이다.
      const dedup = dropDuplicateReviews(newSlice, seenKeys);
      newSlice = dedup.kept;
      duplicateCount += dedup.dropped;

      try {
        console.log(`[NaverService] 📦 청크 저장 (청크 ${chunkNum}, ${newSlice.length}개 리뷰)`);
        sendLog(`[진행] 청크 ${chunkNum} 저장 중 (${newSlice.length}개)...`, 'info', true);
        const chunkPath = newSlice.length ? await saveReviewsToExcelChunk(newSlice, 'naver_reviews', savePath, chunkNum) : null;
        if (chunkPath) {
          console.log(`[NaverService] ✅ 청크 ${chunkNum} 저장 완료: ${chunkPath}`);
          sendLog(`[완료] 청크 ${chunkNum} 저장 완료 (${newSlice.length}개, 누적 ${allReviews.length + newSlice.length}개)`, 'success');
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
          console.log(`[NaverService] 🔁 청크 ${chunkNum - 1}이 상한(${flags.terminationReason})으로 끊김 (${reachedCount}/${target}) — 이어서 계속 (${resumeCount}/${MAX_CHUNK_RESUMES})`);
          sendLog(`[진행] 수집이 시간 상한으로 끊겨 이어서 계속합니다 (재개 ${resumeCount}/${MAX_CHUNK_RESUMES}, 누적 ${allReviews.length}개)`, 'info');
          continue;
        }
        // 목표 미달 + 이어받기 불가/소진. 사유는 flags.terminationReason에 기록돼 있고,
        // 부분수집 여부는 호출부의 expectedTotal 대조 + 검증불가 판정이 최종 결정한다(조용한 '완료' 위장 방지).
        console.log(`[NaverService] ⏹️ 청크 ${chunkNum - 1} 목표 미달로 루프 종료 (${reachedCount}/${target}, 사유: ${flags.terminationReason}, 재개 ${resumeCount}/${MAX_CHUNK_RESUMES})`);
        break;
      }
    }
  } catch (error) {
    // 원문 에러는 로그(개발자용)로만 남기고, 사용자에게는 이해되는 문구로 알린다.
    crawlError = error;
    console.error(`[NaverService] ❌ 수집 중 예외 — 수집분을 저장하고 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
    sendLog(`[경고] ⚠️ 수집 도중 네이버 페이지 연결이 끊겨 중단했습니다 — 지금까지 모은 ${allReviews.length}개를 저장합니다.`, 'warning');
    if (!flags.terminationReason) flags.terminationReason = 'exception';
  }

  return { allReviews, excelChunkCount, crawlError, duplicateCount };
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
 * @param {string} imageMode - UI가 고른 이미지 모드 (small|original|urls|off). ★안내 문구 분기 전용 —
 *                             실제 다운로드 여부는 downloadImages가 결정한다(urls와 off는 둘 다 false).
 */
export async function handleNaver(browser, page, input, isUrl, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', excludeSecret = false, webContents = null, downloadImages = true, smallImage = false, enableDiagnostic = false, slowMode = true, imageMode = '') {

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
      // ★리뷰 API 요청 템플릿 감시자 — 모달을 여는 순간 query-pages가 발사되므로 «탭 클릭 전»에 붙인다.
      //   (정렬은 모달을 연 «뒤»에 적용되므로 감시자는 마지막 요청을 유지한다 → 사용자가 고른 정렬이 반영된다)
      const apiWatcher = collectionType === 0 ? attachReviewApiTemplate(newPage) : null;
      // ★Q&A 총건수 «네트워크» 감시자 — /v1/qna/pages도 모달을 여는 순간 발사되므로 «탭 클릭 전»에 붙인다.
      //   (리뷰의 attachReviewTotalWatcher와 같은 구조)
      const qnaTotalWatcher = collectionType === 1 ? attachQnATotalWatcher(newPage, { flags: scrollFlags }) : null;

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
      // API 경로가 «계약(totalElements) 대조»로 스스로 내린 미완주 판정
      let apiIncomplete = false;
      // 사용자 문구에 쓰는 «실제/기대치» 요약 (예: "11,752/11,752건")
      let yieldSummary = '';
      // ★사진 저장 집계 — 리뷰 수집의 partial과 «별개»로 표기한다 (리뷰는 다 받고 사진만 실패할 수 있다)
      const photoStats = createPhotoStats();
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
        // ★로딩+추출을 통째로 try로 감싼다 (리뷰 경로와 동일한 구조).
        //   2026-08-18 실측: Q&A 스크롤 도중 'detached Frame' 예외가 나면 handleNaver 밖까지 그대로 튀어
        //   총계 대조·저장·완료 문구가 «전부 증발»했다. 예외는 잡아서 «부분수집»으로 정직하게 마감한다.
        let finalCount = 0;
        let qnaTotal = null;
        let qnaError = null;
        try {
          finalCount = await loadMoreQnAs(newPage, targetCount, { flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
          console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount} (종료 사유: ${scrollFlags.terminationReason})`);
        } catch (error) {
          qnaError = error;
          console.error(`[NaverService] ❌ Q&A 로딩 중 예외 — 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
          sendLog(`[경고] ⚠️ 수집 도중 네이버 페이지 연결이 끊겨 Q&A 로딩을 중단했습니다.`, 'warning');
          if (!scrollFlags.terminationReason) scrollFlags.terminationReason = 'exception';
        }

        // ★총 Q&A 수 확보 (v1.7.2) — 출처는 /v1/qna/pages 응답의 totalElements «하나뿐»이다.
        //   못 잡으면 «추정하지 않고» null로 두고 아래에서 «수집량 검증 불가»로 표기한다.
        qnaTotal = qnaTotalWatcher
          ? (qnaTotalWatcher.get() ?? scrollFlags.expectedQnATotalFromNetwork ?? null)
          : null;
        if (qnaTotalWatcher) qnaTotalWatcher.detach();
        if (qnaTotal != null) {
          expectedTotal = qnaTotal;
          expectedTotalSource = 'network:qna/pages.totalElements';
          console.log(`[NaverService] 📊 총 Q&A 수: ${qnaTotal} (출처: ${expectedTotalSource})`);
          sendLog(`[정보] 이 상품의 총 Q&A 수: ${qnaTotal.toLocaleString()}건`, 'info');
        } else {
          console.log('[NaverService] ⚠️ 총 Q&A 수 미확인 — 수집량 «검증 불가» 상태로 진행합니다.');
        }

        let pageQnAs = [];
        if (!qnaError) {
          sendLog(`[진행] 모달 내 ${finalCount}개 Q&A 로드 완료. 추출 시작...`, 'info', true);
          try {
            // 모달 내 모든 Q&A 추출
            pageQnAs = await extractAllQnAs(newPage, excludeSecret, { sendLog });
          } catch (error) {
            qnaError = error;
            console.error(`[NaverService] ❌ Q&A 추출 중 예외 — 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
            sendLog(`[경고] ⚠️ Q&A 추출 도중 오류로 중단했습니다 — 지금까지 모은 분량만 저장합니다.`, 'warning');
          }
        }
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

        // ★수집량 «총계 대조» (v1.7.2) — 리뷰와 같은 구조. 조용히 덜 받고 「완료」가 나가지 않게 한다.
        const qnaJudge = judgeQnAYield({
          loadedCount: finalCount,
          savedCount: allQnAs.length,
          expectedTotal: qnaTotal,
          targetCount,
          excludeSecret,
          terminationReason: scrollFlags.terminationReason,
          endedByRateLimit: !!scrollFlags.endedByRateLimit,
          endedByNoContainer: !!scrollFlags.endedByNoContainer,
          crawlError: !!qnaError,
        });
        partial = qnaJudge.partial;
        unverified = qnaJudge.unverified;
        collectFailed = qnaJudge.collectFailed;
        yieldSummary = qnaJudge.yieldSummary;
        // 예외로 끊긴 사실을 «분기 공용» 변수에 실어 진단 로그/반환값에도 남긴다
        if (qnaError) crawlError = qnaError;

        console.log(`[NaverService] Q&A 판정 — 부분수집=${partial}, 검증불가=${unverified}, 0건=${qnaJudge.zeroYield}, 로드=${finalCount}, 저장=${allQnAs.length}, 총계=${qnaTotal ?? '미확인'}, 종료사유=${scrollFlags.terminationReason}`);

        if (qnaJudge.zeroYield) {
          sendLog(`[오류] Q&A를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 부분수집: Q&A ${yieldSummary}`, 'warning');
        } else {
          sendLog(`[완료] Q&A ${yieldSummary}`, 'success');
        }

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버 속도제한(429)으로 Q&A ${yieldSummary}에서 중단했습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (qnaJudge.shortfall) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 Q&A는 ${qnaTotal.toLocaleString()}건인데 ${finalCount.toLocaleString()}건만 불러왔습니다.`, 'warning');
          sendLog(`[안내] 잠시 후 다시 실행해 주세요. ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)`, 'info');
        } else if (qnaJudge.extractShortfall) {
          // 스크롤로는 불러왔는데 추출에서 빠진 경우 — 로딩 손실과 «구분»해서 알린다.
          sendLog(`[경고] ⚠️ 부분수집입니다 — 화면에 ${finalCount.toLocaleString()}건을 불러왔는데 ${allQnAs.length.toLocaleString()}건만 저장되었습니다.`, 'warning');
          sendLog(`[안내] 네이버 화면 구조 변경일 수 있습니다. 다시 실행해도 같으면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (qnaError) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 수집 도중 오류로 중단해 Q&A ${yieldSummary}까지만 저장되었습니다.`, 'warning');
          sendLog(`[안내] 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (unverified) {
          sendLog(`[경고] ⚠️ 수집량 «검증 불가» — 이 상품의 총 Q&A 수를 확인하지 못했습니다. ${allQnAs.length}건을 수집했지만 «전량인지 확인할 수 없습니다».`, 'warning');
          sendLog(`[안내] 상품 페이지에 표시된 Q&A 수와 직접 비교해 주세요.`, 'info');
        }

        if (excludeSecret && qnaTotal != null) {
          // 비밀글 제외는 «사용자가 고른» 감소다 — 부분수집이 아니라 정보로 알린다(수치는 항상 밝힌다).
          sendLog(`[정보] '비밀글 제외'가 켜져 있어 총 ${qnaTotal.toLocaleString()}건 중 ${allQnAs.length.toLocaleString()}건이 저장되었습니다.`, 'info');
        }

        if (partial && scrollFlags.terminationReason) {
          sendLog(`[정보] 중단 지점 코드: ${scrollFlags.terminationReason} — 문의 시 이 코드를 함께 알려주세요.`, 'info');
        }

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

        // ★수집 경로 선택 (2026-08-15 전환)
        //   ① 리뷰 API 직접 페이징 — 템플릿을 포착했으면 이 경로. 대형 상품 «전량 완주»가 실증된 방식.
        //   ② 모달 무한 스크롤 — 템플릿을 «못 잡았을 때만» 쓰는 폴백(옛 경로, 대형 상품은 완주 불가).
        const originalTargetCount = targetCount; // Infinity 가능
        const apiTemplate = apiWatcher ? apiWatcher.get() : null;
        const collectOpts = {
          targetCount: originalTargetCount, photoFolderPath, savePath,
          downloadImages, smallImage, imageMode, sendLog, flags: scrollFlags, photoStats,
        };
        let excelChunkCount = 0;
        let duplicateCount = 0;   // ★저장 전 걸러낸 중복 건수(사용자에게 밝힌다)

        if (apiTemplate) {
          // 템플릿을 확보했으면 감시자를 «즉시» 뗀다 — 안 그러면 우리가 보내는 수집 요청까지 되잡아
          //   페이지 수만큼 로그를 도배한다(실측: 588페이지 = 588줄).
          apiWatcher.detach();
          sendLog(`[시작] 리뷰 수집 시작 — 네이버 리뷰 API 직접 조회 (목표 ${targetText})`, 'info');
          const run = await collectReviewsByApi(newPage, { ...collectOpts, template: apiTemplate });
          allReviews = run.allReviews;
          excelChunkCount = run.excelChunkCount;
          crawlError = run.crawlError;
          duplicateCount = run.duplicateCount || 0;
          // ★분모는 API 응답의 totalElements가 «가장 정확»하다 — 화면 파싱보다 우선한다.
          if (run.api && run.api.totalElements) {
            expectedTotal = run.api.totalElements;
            expectedTotalSource = 'network:query-pages.totalElements(api)';
          }
          // 계약 대조로 «완주»가 확인되지 않으면 여기서부터 부분수집이다 (98% 허용치보다 엄격).
          apiIncomplete = !run.api || !run.api.complete;
        } else {
          sendLog(`[안내] 리뷰 API 요청을 포착하지 못해 «모달 스크롤» 방식으로 수집합니다 (리뷰가 많은 상품은 부분수집이 될 수 있습니다).`, 'warning');
          sendLog(`[시작] 리뷰 추출 시작 (목표 ${targetText}, 청크 ${CHUNK_SIZE_REVIEWS}개 단위)`, 'info');
          const run = await collectReviewsByScroll(newPage, { ...collectOpts, diagnostic, scrollWaitMs });
          allReviews = run.allReviews;
          excelChunkCount = run.excelChunkCount;
          crawlError = run.crawlError;
          duplicateCount = run.duplicateCount || 0;
        }

        // 총계 «늦은» 캡처 회수 — 모달 진입 시점에 못 잡았어도 수집 중 응답에서 잡혔을 수 있다.
        if (expectedTotal == null && scrollFlags.expectedTotalFromNetwork) {
          expectedTotal = scrollFlags.expectedTotalFromNetwork;
          expectedTotalSource = 'network:query-pages.totalElements(late)';
          console.log(`[NaverService] 📊 총 리뷰 수(수집 중 캡처): ${expectedTotal}`);
          sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
        }
        if (totalWatcher) totalWatcher.detach();
        if (apiWatcher) apiWatcher.detach();

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
        // ★중복 제외분은 «못 받은 것»이 아니라 «지운 것»이라 분모에서 뺀다.
        //   안 빼면 중복이 2%를 넘는 상품에서 정상 완주가 «부분수집»으로 오판된다.
        const reachableTotal = expectedForRun != null ? expectedForRun - duplicateCount : null;
        const shortfall = !!reachableTotal && allReviews.length < Math.floor(reachableTotal * 0.98);
        // ★0건 가드 — expectedTotal 파싱 성공 여부와 «무관하게» 0건은 성공이 아니다.
        //   (li 셀렉터와 본문 텍스트가 «동시에» 깨지면 '총 0개 추출' + 초록 완료가 나가던 구멍)
        const zeroYield = allReviews.length === 0;
        // ★검증 불가 판정 — «무증상 종료»의 본체.
        //   총계를 모르는데 상한(max_duration/attempts_exhausted)이나 동결(stable_threshold)로 끝났으면
        //   전량을 받았는지 «확인할 방법이 없다» → 성공(초록)으로 흘리지 않는다.
        //   (target_reached는 사용자가 지정한 개수를 채운 것이므로 제외)
        unverified = !expectedForRun && UNVERIFIABLE_TERMINATIONS.includes(scrollFlags.terminationReason);
        collectFailed = zeroYield;
        // ★API 경로는 «계약(totalElements) 대조»로 스스로 완주 여부를 안다 — 98% 허용치보다 이쪽이 엄격하다.
        partial = scrollFlags.endedByRateLimit || shortfall || zeroYield || unverified || apiIncomplete || !!crawlError;
        // ★사용자에게 나가는 수치는 «실제/기대치»를 항상 함께 (총계를 모르면 모른다고 쓴다)
        // ★중복이 있었으면 «반드시 밝힌다» — 밝히지 않으면 분자(실제 저장)와 분모(총계)가
        //   어긋난 채로 보여서 사용자가 "왜 3건이 비었나"를 스스로 알아내야 한다.
        const dupText = duplicateCount > 0 ? ` (중복 ${duplicateCount.toLocaleString()}건 제외)` : '';
        yieldSummary = expectedForRun
          ? `${allReviews.length.toLocaleString()}/${expectedForRun.toLocaleString()}건${dupText}`
          : `${allReviews.length.toLocaleString()}건 (총계 미확인)${dupText}`;

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다. (부분수집=${partial}, 검증불가=${unverified}, 0건=${zeroYield}, 총계=${expectedTotal ?? '미확인'}/${expectedTotalSource}, 종료사유=${scrollFlags.terminationReason})`);
        if (zeroYield) {
          sendLog(`[오류] 리뷰를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행하고, 계속 실패하면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 부분수집: ${yieldSummary}`, 'warning');
        } else {
          sendLog(`[완료] ${yieldSummary}`, 'success');
        }

        if (scrollFlags.endedByRateLimit && scrollFlags.usedApi) {
          // API 경로의 429는 «속도» 문제가 아니다 — 약 100페이지마다 예산이 소진되고 90초쯤이면 회복된다.
          // 대기 사다리(30·60·120초)를 다 쓰고도 회복되지 않은 상태라 «다시 실행»이 유일한 정답이다.
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버 속도제한(429)이 대기 후에도 풀리지 않아 ${yieldSummary}에서 중단했습니다.`, 'warning');
          sendLog(`[안내] 잠시(5~10분) 뒤에 다시 실행해 주세요. 수집 속도를 낮춰도 이 제한은 풀리지 않습니다.`, 'info');
        } else if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${yieldSummary}까지만 수집되었습니다.`, 'warning');
          // ★'안정 수집'은 «DOM 스크롤 대기시간»만 바꾼다(scrollWaitMs 3000/1500) — API 경로엔 효과가 없다.
          //   전에는 경로를 안 가리고 「체크하면 전량 수집됩니다」라고 «단언»했다. 틀린 안내였다(2026-08-18).
          if (scrollFlags.usedApi) {
            sendLog(`[안내] 잠시(5~10분) 뒤에 다시 실행해 주세요. ('안정 수집'은 이 경로에 효과가 없습니다)`, 'info');
          } else {
            sendLog(`[안내] '안정 수집'을 체크한 뒤 다시 실행하면 성공률이 올라갑니다.`, 'info');
          }
        } else if (shortfall || apiIncomplete) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 리뷰는 ${expectedTotal ? expectedTotal.toLocaleString() : '?'}건인데 ${allReviews.length.toLocaleString()}건만 수집되었습니다.`, 'warning');
          // ★네이버는 리뷰 API를 «1,000페이지(=20,000건)»에서 끊는다 (2026-08-18 실측 확정:
          //   19,999 = 1,000페이지 × 20 − 1, Page_Review 최댓값 정확히 20,000).
          //   다시 실행해도 같은 자리에서 끝나므로, 재시도를 권하면 «사용자 시간을 태운다».
          if (scrollFlags.usedApi && expectedTotal > 20000 && allReviews.length >= 19000) {
            sendLog(`[안내] 네이버가 한 번에 내려주는 리뷰는 «최대 2만 건»입니다 — 이 상품은 그 상한에 걸렸습니다. 다시 실행해도 같은 수량에서 끝납니다.`, 'info');
          }
          sendLog(`[안내] 잠시 후 다시 실행해 주세요.${scrollFlags.usedApi ? '' : " ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)"}`, 'info');
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

        // ★사진 저장 결과는 «리뷰 부분수집»과 별개로 따로 알린다.
        //   ⛔사진이 실패해도 리뷰 저장/성공 판정을 뒤집지 않는다 (데이터는 살리고 표기만 정직하게).
        if (photoStats.total > 0) {
          if (photoStats.fail > 0) {
            sendLog(`[경고] ⚠️ 사진은 «부분 저장»입니다 — ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장 저장, ${photoStats.fail.toLocaleString()}장 실패. (리뷰 본문·엑셀은 정상입니다)`, 'warning');
            const top = topPhotoFailReasons(photoStats, 3);
            if (top.length) sendLog(`[정보] 사진 실패 사유 상위: ${top.map((t) => `${t.reason} ${t.count}건`).join(' / ')}`, 'info');
            sendLog(`[안내] 사진만 다시 받으려면 같은 조건으로 한 번 더 실행해 주세요 (이미 받은 사진은 건너뜁니다).`, 'info');
          } else {
            sendLog(`[확인] 사진 ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장 전부 저장했습니다.`, 'success');
          }
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
        // ★기대치/실제를 함께 — "11,752/11,752건" 형태 (총계를 못 읽었으면 그 사실을 적는다)
        //   사진은 «리뷰와 구분해서» 덧붙인다 — 리뷰는 완주하고 사진만 일부 실패하는 경우가 있다.
        const photoText = photoStats.total > 0
          ? `, 사진 ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장${photoStats.fail > 0 ? ` (⚠️ ${photoStats.fail.toLocaleString()}장 실패)` : ''}`
          : '';
        finalCountMessage = `리뷰 ${yieldSummary || `총 ${allReviews.length}개`}${photoText}`;
      } else if (collectionType === 1) {
        // ★리뷰와 동일하게 «실제/총계»를 함께 적는다 (총계를 못 읽었으면 그 사실을 적는다)
        finalCountMessage = `Q&A ${yieldSummary || `총 ${allQnAs.length}개`}`;
      }
      if (collectFailed) {
        // 0건은 '완료'가 아니다 — 초록 완료 문구를 내지 않는다.
        sendLog(`[실패] ${collectionType === 1 ? 'Q&A' : '리뷰'}를 1건도 수집하지 못해 실패로 종료합니다. (${finalCountMessage})`, 'error');
      } else if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else if (unverified) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 수집량 «검증 불가», 위 경고를 확인해 주세요)`, 'warning');
      } else if (partial) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 부분수집, 위 경고를 확인해 주세요)`, 'warning');
      } else if (photoStats.fail > 0) {
        // ★리뷰는 완주했지만 사진이 «일부» 실패한 경우 — 초록 '완료'로 흘리지 않되, 리뷰 부분수집과 «구분»한다.
        sendLog(`[완료] 리뷰는 «전량» 수집했지만 사진은 «부분 저장»입니다. (${finalCountMessage} — 위 경고를 확인해 주세요)`, 'warning');
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
          usedApi: !!scrollFlags.usedApi,
          photoTotal: photoStats.total,
          photoOk: photoStats.ok,
          photoFail: photoStats.fail,
          photoFailReasons: topPhotoFailReasons(photoStats, 5),
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
          ? `${collectionType === 1 ? 'Q&A' : '리뷰'}를 1건도 수집하지 못했습니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`
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
        // ★사진은 리뷰 성공/실패와 «별개» 지표다 (사진 실패가 success를 뒤집지 않는다)
        photoStats: { total: photoStats.total, ok: photoStats.ok, fail: photoStats.fail },
        photoPartial: photoStats.fail > 0,
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
      // ★리뷰 API 요청 템플릿 감시자 — URL 분기와 동일하게 «탭 클릭 전»에 붙인다.
      const apiWatcher = collectionType === 0 ? attachReviewApiTemplate(productPage) : null;
      // ★Q&A 총건수 «네트워크» 감시자 — /v1/qna/pages도 모달을 여는 순간 발사되므로 «탭 클릭 전»에 붙인다.
      //   (리뷰의 attachReviewTotalWatcher와 같은 구조)
      const qnaTotalWatcher = collectionType === 1 ? attachQnATotalWatcher(productPage, { flags: scrollFlags }) : null;

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
      // API 경로가 «계약(totalElements) 대조»로 스스로 내린 미완주 판정
      let apiIncomplete = false;
      // 사용자 문구에 쓰는 «실제/기대치» 요약 (예: "11,752/11,752건")
      let yieldSummary = '';
      // ★사진 저장 집계 — 리뷰 수집의 partial과 «별개»로 표기한다 (리뷰는 다 받고 사진만 실패할 수 있다)
      const photoStats = createPhotoStats();
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
        // ★로딩+추출을 통째로 try로 감싼다 (리뷰 경로와 동일한 구조).
        //   2026-08-18 실측: Q&A 스크롤 도중 'detached Frame' 예외가 나면 handleNaver 밖까지 그대로 튀어
        //   총계 대조·저장·완료 문구가 «전부 증발»했다. 예외는 잡아서 «부분수집»으로 정직하게 마감한다.
        let finalCount = 0;
        let qnaTotal = null;
        let qnaError = null;
        try {
          finalCount = await loadMoreQnAs(productPage, targetCount, { flags: scrollFlags, sendLog, tuning: { scrollWaitMs } });
          console.log(`[NaverService] 📊 모달 내 최종 Q&A 개수: ${finalCount} (종료 사유: ${scrollFlags.terminationReason})`);
        } catch (error) {
          qnaError = error;
          console.error(`[NaverService] ❌ Q&A 로딩 중 예외 — 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
          sendLog(`[경고] ⚠️ 수집 도중 네이버 페이지 연결이 끊겨 Q&A 로딩을 중단했습니다.`, 'warning');
          if (!scrollFlags.terminationReason) scrollFlags.terminationReason = 'exception';
        }

        // ★총 Q&A 수 확보 (v1.7.2) — 출처는 /v1/qna/pages 응답의 totalElements «하나뿐»이다.
        //   못 잡으면 «추정하지 않고» null로 두고 아래에서 «수집량 검증 불가»로 표기한다.
        qnaTotal = qnaTotalWatcher
          ? (qnaTotalWatcher.get() ?? scrollFlags.expectedQnATotalFromNetwork ?? null)
          : null;
        if (qnaTotalWatcher) qnaTotalWatcher.detach();
        if (qnaTotal != null) {
          expectedTotal = qnaTotal;
          expectedTotalSource = 'network:qna/pages.totalElements';
          console.log(`[NaverService] 📊 총 Q&A 수: ${qnaTotal} (출처: ${expectedTotalSource})`);
          sendLog(`[정보] 이 상품의 총 Q&A 수: ${qnaTotal.toLocaleString()}건`, 'info');
        } else {
          console.log('[NaverService] ⚠️ 총 Q&A 수 미확인 — 수집량 «검증 불가» 상태로 진행합니다.');
        }

        let pageQnAs = [];
        if (!qnaError) {
          sendLog(`[진행] 모달 내 ${finalCount}개 Q&A 로드 완료. 추출 시작...`, 'info', true);
          try {
            // 모달 내 모든 Q&A 추출
            pageQnAs = await extractAllQnAs(productPage, excludeSecret, { sendLog });
          } catch (error) {
            qnaError = error;
            console.error(`[NaverService] ❌ Q&A 추출 중 예외 — 부분수집으로 마감합니다: ${error && error.stack ? error.stack : error}`);
            sendLog(`[경고] ⚠️ Q&A 추출 도중 오류로 중단했습니다 — 지금까지 모은 분량만 저장합니다.`, 'warning');
          }
        }
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

        // ★수집량 «총계 대조» (v1.7.2) — 리뷰와 같은 구조. 조용히 덜 받고 「완료」가 나가지 않게 한다.
        const qnaJudge = judgeQnAYield({
          loadedCount: finalCount,
          savedCount: allQnAs.length,
          expectedTotal: qnaTotal,
          targetCount,
          excludeSecret,
          terminationReason: scrollFlags.terminationReason,
          endedByRateLimit: !!scrollFlags.endedByRateLimit,
          endedByNoContainer: !!scrollFlags.endedByNoContainer,
          crawlError: !!qnaError,
        });
        partial = qnaJudge.partial;
        unverified = qnaJudge.unverified;
        collectFailed = qnaJudge.collectFailed;
        yieldSummary = qnaJudge.yieldSummary;
        // 예외로 끊긴 사실을 «분기 공용» 변수에 실어 진단 로그/반환값에도 남긴다
        if (qnaError) crawlError = qnaError;

        console.log(`[NaverService] Q&A 판정 — 부분수집=${partial}, 검증불가=${unverified}, 0건=${qnaJudge.zeroYield}, 로드=${finalCount}, 저장=${allQnAs.length}, 총계=${qnaTotal ?? '미확인'}, 종료사유=${scrollFlags.terminationReason}`);

        if (qnaJudge.zeroYield) {
          sendLog(`[오류] Q&A를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 부분수집: Q&A ${yieldSummary}`, 'warning');
        } else {
          sendLog(`[완료] Q&A ${yieldSummary}`, 'success');
        }

        if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버 속도제한(429)으로 Q&A ${yieldSummary}에서 중단했습니다.`, 'warning');
          sendLog(`[안내] '안정 수집' 체크박스를 체크한 뒤 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (qnaJudge.shortfall) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 Q&A는 ${qnaTotal.toLocaleString()}건인데 ${finalCount.toLocaleString()}건만 불러왔습니다.`, 'warning');
          sendLog(`[안내] 잠시 후 다시 실행해 주세요. ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)`, 'info');
        } else if (qnaJudge.extractShortfall) {
          // 스크롤로는 불러왔는데 추출에서 빠진 경우 — 로딩 손실과 «구분»해서 알린다.
          sendLog(`[경고] ⚠️ 부분수집입니다 — 화면에 ${finalCount.toLocaleString()}건을 불러왔는데 ${allQnAs.length.toLocaleString()}건만 저장되었습니다.`, 'warning');
          sendLog(`[안내] 네이버 화면 구조 변경일 수 있습니다. 다시 실행해도 같으면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (qnaError) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 수집 도중 오류로 중단해 Q&A ${yieldSummary}까지만 저장되었습니다.`, 'warning');
          sendLog(`[안내] 잠시 후 다시 실행해 주세요.`, 'info');
        } else if (unverified) {
          sendLog(`[경고] ⚠️ 수집량 «검증 불가» — 이 상품의 총 Q&A 수를 확인하지 못했습니다. ${allQnAs.length}건을 수집했지만 «전량인지 확인할 수 없습니다».`, 'warning');
          sendLog(`[안내] 상품 페이지에 표시된 Q&A 수와 직접 비교해 주세요.`, 'info');
        }

        if (excludeSecret && qnaTotal != null) {
          // 비밀글 제외는 «사용자가 고른» 감소다 — 부분수집이 아니라 정보로 알린다(수치는 항상 밝힌다).
          sendLog(`[정보] '비밀글 제외'가 켜져 있어 총 ${qnaTotal.toLocaleString()}건 중 ${allQnAs.length.toLocaleString()}건이 저장되었습니다.`, 'info');
        }

        if (partial && scrollFlags.terminationReason) {
          sendLog(`[정보] 중단 지점 코드: ${scrollFlags.terminationReason} — 문의 시 이 코드를 함께 알려주세요.`, 'info');
        }

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

        // ★수집 경로 선택 (2026-08-15 전환)
        //   ① 리뷰 API 직접 페이징 — 템플릿을 포착했으면 이 경로. 대형 상품 «전량 완주»가 실증된 방식.
        //   ② 모달 무한 스크롤 — 템플릿을 «못 잡았을 때만» 쓰는 폴백(옛 경로, 대형 상품은 완주 불가).
        const originalTargetCount = targetCount; // Infinity 가능
        const apiTemplate = apiWatcher ? apiWatcher.get() : null;
        const collectOpts = {
          targetCount: originalTargetCount, photoFolderPath, savePath,
          downloadImages, smallImage, imageMode, sendLog, flags: scrollFlags, photoStats,
        };
        let excelChunkCount = 0;
        let duplicateCount = 0;   // ★저장 전 걸러낸 중복 건수(사용자에게 밝힌다)

        if (apiTemplate) {
          // 템플릿을 확보했으면 감시자를 «즉시» 뗀다 — 안 그러면 우리가 보내는 수집 요청까지 되잡아
          //   페이지 수만큼 로그를 도배한다(실측: 588페이지 = 588줄).
          apiWatcher.detach();
          sendLog(`[시작] 리뷰 수집 시작 — 네이버 리뷰 API 직접 조회 (목표 ${targetText})`, 'info');
          const run = await collectReviewsByApi(productPage, { ...collectOpts, template: apiTemplate });
          allReviews = run.allReviews;
          excelChunkCount = run.excelChunkCount;
          crawlError = run.crawlError;
          duplicateCount = run.duplicateCount || 0;
          // ★분모는 API 응답의 totalElements가 «가장 정확»하다 — 화면 파싱보다 우선한다.
          if (run.api && run.api.totalElements) {
            expectedTotal = run.api.totalElements;
            expectedTotalSource = 'network:query-pages.totalElements(api)';
          }
          // 계약 대조로 «완주»가 확인되지 않으면 여기서부터 부분수집이다 (98% 허용치보다 엄격).
          apiIncomplete = !run.api || !run.api.complete;
        } else {
          sendLog(`[안내] 리뷰 API 요청을 포착하지 못해 «모달 스크롤» 방식으로 수집합니다 (리뷰가 많은 상품은 부분수집이 될 수 있습니다).`, 'warning');
          sendLog(`[시작] 리뷰 추출 시작 (목표 ${targetText}, 청크 ${CHUNK_SIZE_REVIEWS}개 단위)`, 'info');
          const run = await collectReviewsByScroll(productPage, { ...collectOpts, diagnostic, scrollWaitMs });
          allReviews = run.allReviews;
          excelChunkCount = run.excelChunkCount;
          crawlError = run.crawlError;
          duplicateCount = run.duplicateCount || 0;
        }

        // 총계 «늦은» 캡처 회수 — 모달 진입 시점에 못 잡았어도 수집 중 응답에서 잡혔을 수 있다.
        if (expectedTotal == null && scrollFlags.expectedTotalFromNetwork) {
          expectedTotal = scrollFlags.expectedTotalFromNetwork;
          expectedTotalSource = 'network:query-pages.totalElements(late)';
          console.log(`[NaverService] 📊 총 리뷰 수(수집 중 캡처): ${expectedTotal}`);
          sendLog(`[정보] 이 상품의 총 리뷰 수: ${expectedTotal.toLocaleString()}건`, 'info');
        }
        if (totalWatcher) totalWatcher.detach();
        if (apiWatcher) apiWatcher.detach();

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
        // ★중복 제외분은 «못 받은 것»이 아니라 «지운 것»이라 분모에서 뺀다.
        //   안 빼면 중복이 2%를 넘는 상품에서 정상 완주가 «부분수집»으로 오판된다.
        const reachableTotal = expectedForRun != null ? expectedForRun - duplicateCount : null;
        const shortfall = !!reachableTotal && allReviews.length < Math.floor(reachableTotal * 0.98);
        // ★0건 가드 — expectedTotal 파싱 성공 여부와 «무관하게» 0건은 성공이 아니다.
        //   (li 셀렉터와 본문 텍스트가 «동시에» 깨지면 '총 0개 추출' + 초록 완료가 나가던 구멍)
        const zeroYield = allReviews.length === 0;
        // ★검증 불가 판정 — «무증상 종료»의 본체.
        //   총계를 모르는데 상한(max_duration/attempts_exhausted)이나 동결(stable_threshold)로 끝났으면
        //   전량을 받았는지 «확인할 방법이 없다» → 성공(초록)으로 흘리지 않는다.
        //   (target_reached는 사용자가 지정한 개수를 채운 것이므로 제외)
        unverified = !expectedForRun && UNVERIFIABLE_TERMINATIONS.includes(scrollFlags.terminationReason);
        collectFailed = zeroYield;
        // ★API 경로는 «계약(totalElements) 대조»로 스스로 완주 여부를 안다 — 98% 허용치보다 이쪽이 엄격하다.
        partial = scrollFlags.endedByRateLimit || shortfall || zeroYield || unverified || apiIncomplete || !!crawlError;
        // ★사용자에게 나가는 수치는 «실제/기대치»를 항상 함께 (총계를 모르면 모른다고 쓴다)
        // ★중복이 있었으면 «반드시 밝힌다» — 밝히지 않으면 분자(실제 저장)와 분모(총계)가
        //   어긋난 채로 보여서 사용자가 "왜 3건이 비었나"를 스스로 알아내야 한다.
        const dupText = duplicateCount > 0 ? ` (중복 ${duplicateCount.toLocaleString()}건 제외)` : '';
        yieldSummary = expectedForRun
          ? `${allReviews.length.toLocaleString()}/${expectedForRun.toLocaleString()}건${dupText}`
          : `${allReviews.length.toLocaleString()}건 (총계 미확인)${dupText}`;

        console.log(`[NaverService] ✅ 총 ${allReviews.length}개의 리뷰를 추출했습니다. (부분수집=${partial}, 검증불가=${unverified}, 0건=${zeroYield}, 총계=${expectedTotal ?? '미확인'}/${expectedTotalSource}, 종료사유=${scrollFlags.terminationReason})`);
        if (zeroYield) {
          sendLog(`[오류] 리뷰를 1건도 수집하지 못했습니다 — 수집 «실패»입니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`, 'error');
          sendLog(`[안내] 네이버 화면 구조 변경이나 일시적 차단일 수 있습니다. 잠시 후 다시 실행하고, 계속 실패하면 앱 업데이트를 확인해 주세요.`, 'info');
        } else if (partial) {
          sendLog(`[완료] 부분수집: ${yieldSummary}`, 'warning');
        } else {
          sendLog(`[완료] ${yieldSummary}`, 'success');
        }

        if (scrollFlags.endedByRateLimit && scrollFlags.usedApi) {
          // API 경로의 429는 «속도» 문제가 아니다 — 약 100페이지마다 예산이 소진되고 90초쯤이면 회복된다.
          // 대기 사다리(30·60·120초)를 다 쓰고도 회복되지 않은 상태라 «다시 실행»이 유일한 정답이다.
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버 속도제한(429)이 대기 후에도 풀리지 않아 ${yieldSummary}에서 중단했습니다.`, 'warning');
          sendLog(`[안내] 잠시(5~10분) 뒤에 다시 실행해 주세요. 수집 속도를 낮춰도 이 제한은 풀리지 않습니다.`, 'info');
        } else if (scrollFlags.endedByRateLimit) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 네이버가 수집 속도 제한(429)을 걸어 ${yieldSummary}까지만 수집되었습니다.`, 'warning');
          // ★'안정 수집'은 «DOM 스크롤 대기시간»만 바꾼다(scrollWaitMs 3000/1500) — API 경로엔 효과가 없다.
          //   전에는 경로를 안 가리고 「체크하면 전량 수집됩니다」라고 «단언»했다. 틀린 안내였다(2026-08-18).
          if (scrollFlags.usedApi) {
            sendLog(`[안내] 잠시(5~10분) 뒤에 다시 실행해 주세요. ('안정 수집'은 이 경로에 효과가 없습니다)`, 'info');
          } else {
            sendLog(`[안내] '안정 수집'을 체크한 뒤 다시 실행하면 성공률이 올라갑니다.`, 'info');
          }
        } else if (shortfall || apiIncomplete) {
          sendLog(`[경고] ⚠️ 부분수집입니다 — 이 상품의 리뷰는 ${expectedTotal ? expectedTotal.toLocaleString() : '?'}건인데 ${allReviews.length.toLocaleString()}건만 수집되었습니다.`, 'warning');
          // ★네이버는 리뷰 API를 «1,000페이지(=20,000건)»에서 끊는다 (2026-08-18 실측 확정:
          //   19,999 = 1,000페이지 × 20 − 1, Page_Review 최댓값 정확히 20,000).
          //   다시 실행해도 같은 자리에서 끝나므로, 재시도를 권하면 «사용자 시간을 태운다».
          if (scrollFlags.usedApi && expectedTotal > 20000 && allReviews.length >= 19000) {
            sendLog(`[안내] 네이버가 한 번에 내려주는 리뷰는 «최대 2만 건»입니다 — 이 상품은 그 상한에 걸렸습니다. 다시 실행해도 같은 수량에서 끝납니다.`, 'info');
          }
          sendLog(`[안내] 잠시 후 다시 실행해 주세요.${scrollFlags.usedApi ? '' : " ('안정 수집' 체크박스를 체크하면 성공률이 올라갑니다)"}`, 'info');
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

        // ★사진 저장 결과는 «리뷰 부분수집»과 별개로 따로 알린다.
        //   ⛔사진이 실패해도 리뷰 저장/성공 판정을 뒤집지 않는다 (데이터는 살리고 표기만 정직하게).
        if (photoStats.total > 0) {
          if (photoStats.fail > 0) {
            sendLog(`[경고] ⚠️ 사진은 «부분 저장»입니다 — ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장 저장, ${photoStats.fail.toLocaleString()}장 실패. (리뷰 본문·엑셀은 정상입니다)`, 'warning');
            const top = topPhotoFailReasons(photoStats, 3);
            if (top.length) sendLog(`[정보] 사진 실패 사유 상위: ${top.map((t) => `${t.reason} ${t.count}건`).join(' / ')}`, 'info');
            sendLog(`[안내] 사진만 다시 받으려면 같은 조건으로 한 번 더 실행해 주세요 (이미 받은 사진은 건너뜁니다).`, 'info');
          } else {
            sendLog(`[확인] 사진 ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장 전부 저장했습니다.`, 'success');
          }
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
        // ★기대치/실제를 함께 — "11,752/11,752건" 형태 (총계를 못 읽었으면 그 사실을 적는다)
        //   사진은 «리뷰와 구분해서» 덧붙인다 — 리뷰는 완주하고 사진만 일부 실패하는 경우가 있다.
        const photoText = photoStats.total > 0
          ? `, 사진 ${photoStats.ok.toLocaleString()}/${photoStats.total.toLocaleString()}장${photoStats.fail > 0 ? ` (⚠️ ${photoStats.fail.toLocaleString()}장 실패)` : ''}`
          : '';
        finalCountMessage = `리뷰 ${yieldSummary || `총 ${allReviews.length}개`}${photoText}`;
      } else if (collectionType === 1) {
        // ★리뷰와 동일하게 «실제/총계»를 함께 적는다 (총계를 못 읽었으면 그 사실을 적는다)
        finalCountMessage = `Q&A ${yieldSummary || `총 ${allQnAs.length}개`}`;
      }
      if (collectFailed) {
        // 0건은 '완료'가 아니다 — 초록 완료 문구를 내지 않는다.
        sendLog(`[실패] ${collectionType === 1 ? 'Q&A' : '리뷰'}를 1건도 수집하지 못해 실패로 종료합니다. (${finalCountMessage})`, 'error');
      } else if (scrollFlags.endedByRateLimit) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 네이버 속도제한으로 인한 부분수집)`, 'warning');
      } else if (unverified) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 수집량 «검증 불가», 위 경고를 확인해 주세요)`, 'warning');
      } else if (partial) {
        sendLog(`[완료] 크롤링이 종료되었습니다. (${finalCountMessage} — ⚠️ 부분수집, 위 경고를 확인해 주세요)`, 'warning');
      } else if (photoStats.fail > 0) {
        // ★리뷰는 완주했지만 사진이 «일부» 실패한 경우 — 초록 '완료'로 흘리지 않되, 리뷰 부분수집과 «구분»한다.
        sendLog(`[완료] 리뷰는 «전량» 수집했지만 사진은 «부분 저장»입니다. (${finalCountMessage} — 위 경고를 확인해 주세요)`, 'warning');
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
          usedApi: !!scrollFlags.usedApi,
          photoTotal: photoStats.total,
          photoOk: photoStats.ok,
          photoFail: photoStats.fail,
          photoFailReasons: topPhotoFailReasons(photoStats, 5),
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
          ? `${collectionType === 1 ? 'Q&A' : '리뷰'}를 1건도 수집하지 못했습니다. (종료 사유: ${scrollFlags.terminationReason || '미확인'})`
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
        // ★사진은 리뷰 성공/실패와 «별개» 지표다 (사진 실패가 success를 뒤집지 않는다)
        photoStats: { total: photoStats.total, ok: photoStats.ok, fail: photoStats.fail },
        photoPartial: photoStats.fail > 0,
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

