/**
 * 쿠팡 플랫폼 전용 서비스
 *
 * ▶ 방식: API 직접 호출 - DOM 스크래핑 없음
 * ▶ 리뷰 API: /next-api/review  정렬: ORDER_SCORE_ASC(베스트순) / DATE_DESC(최신순)
 * ▶ Q&A API: /vp/products/{productId}/questions  페이지: 1-indexed
 * ▶ 스키마: 네이버와 동일
 */
import { isCoupangProductPage, verifyCoupangProductPageLoaded, waitForCoupangProductPage, createCoupangSearchUrl, extractProductId, clickCoupangReviewTab, clickCoupangQnaTab } from './coupang/coupangNavigation.js';
import { saveReviews, saveReviewsToExcelChunk } from '../../src/utils/naver/storage/index.js';
import { getStorageDirectory, resetSessionFolderName, setSessionFolderPrefix } from '../../src/utils/naver/storage/common.js';
import { formatQnAData } from '../../src/utils/naver/storage/qnaFormatter.js';

/** pages 값 → 실제 최대 페이지 수 */
function getMaxPages(pages, customPages = null) {
  if (pages === 4 && customPages !== null && customPages > 0) return customPages;
  return { 0: 5, 1: 15, 2: 50, 3: Infinity, 4: 5 }[pages] ?? 5;
}

/** sort 값 → API sortBy 파라미터 */
function getSortBy(sort) {
  return sort === 1 ? 'DATE_DESC' : 'ORDER_SCORE_ASC'; // 0: 베스트순, 1: 최신순
}

/** timestamp → YYYY.MM.DD */
function formatDate(ts) {
  if (!ts) return '날짜 없음';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/**
 * API에서 받은 리뷰 객체 → 스토리지 스키마 변환
 * (네이버와 동일한 컬럼명 유지)
 */
function convertToStorageFormat(apiReview, photoUrls) {
  return {
    'Review Score': String(apiReview.rating ?? ''),
    'Reviewer Name': apiReview.displayName || apiReview.member?.name || '이름 없음',
    'Review Date': formatDate(apiReview.createdAt ?? apiReview.reviewAt),
    'Product(Option) Name': apiReview.itemName || '정보 없음',
    'Review Type': '일반리뷰',
    'Content': apiReview.content || '내용 없음',
    'Photos': photoUrls,
  };
}

/**
 * 쿠팡 리뷰 API 호출 (page.evaluate 내 fetch 사용)
 * @returns {{ reviews, totalPage, isNext, totalCount }}
 */
async function fetchReviewPage(page, productId, pageNum, sortBy, withSummary = false) {
  const params = new URLSearchParams({
    productId,
    page: pageNum,
    size: 10,
    sortBy,
    ratingSummary: withSummary ? 'true' : 'false',
    ratings: '',
    market: '',
  });

  return await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'x-requested-with': 'XMLHttpRequest',
        },
        credentials: 'include',
      });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      const paging = data.rData?.paging ?? {};
      const summary = data.rData?.ratingSummaryTotal;
      return {
        reviews: paging.contents ?? [],
        totalPage: paging.totalPage ?? 0,
        isNext: paging.isNext ?? false,
        totalCount: summary?.ratingCount ?? paging.totalCount ?? 0,
        rCode: data.rCode,
      };
    } catch (e) {
      return { error: e.message };
    }
  }, `https://www.coupang.com/next-api/review?${params.toString()}`);
}

/**
 * Q&A DOM에서 현재 페이지 항목 추출
 * @returns {{ questions, error? }}
 */
async function fetchQnAFromDOM(page) {
  return await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '상품문의');
    const section = h2?.parentElement?.parentElement?.parentElement;
    if (!section) return { error: 'Q&A 섹션을 찾을 수 없습니다.' };

    const listDiv = section.querySelector('.list');
    if (!listDiv) return { questions: [] };

    const questions = [];
    for (const block of listDiv.children) {
      const qBadge = block.querySelector('[class*="twc-bg-[#777]"]');
      if (!qBadge) continue;

      const qContent = block.querySelector('[translate="no"]');
      const qMetaRow = block.querySelector('.twc-flex.twc-justify-between');
      const qDivs = qMetaRow?.querySelectorAll('div') || [];

      const ansBadge = block.querySelector('[class*="twc-bg-[#346aff]"]');
      let answer = '', answerDate = '', answerAuthor = '';
      if (ansBadge) {
        const ansBlock = ansBadge.closest('.qna');
        const ansContent = ansBlock?.querySelector('[translate="no"]');
        const ansMetaRow = ansBlock?.querySelector('.twc-flex.twc-justify-between');
        const ansDivs = ansMetaRow?.querySelectorAll('div') || [];
        answerAuthor = ansDivs[0]?.textContent?.trim() || '';
        answerDate = ansDivs[1]?.textContent?.trim() || '';
        answer = ansContent?.textContent?.trim() || '';
      }

      questions.push({
        question: qContent?.textContent?.trim() || '',
        author: (qDivs[0]?.textContent?.trim() || '').split(/\s{2,}/)[0],
        questionDate: qDivs[1]?.textContent?.trim() || '',
        answer,
        answerAuthor,
        answerDate,
      });
    }
    return { questions };
  });
}

/**
 * Q&A 페이지네이션 상태 반환
 * - pageNums: 현재 그룹에서 보이는 페이지 번호 목록 (예: ["1","2",...,"10"])
 * - hasNextGroup: 다음 그룹 버튼 활성화 여부 (11~20, 21~30 등)
 *
 * 구조: js_reviewArticlePageBtn = 개별 페이지 번호
 *       js_reviewArticlePageNextBtn = 다음 페이지 그룹 (10개 단위)
 */
async function getQnAPaginationState(page) {
  return await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '상품문의');
    const section = h2?.parentElement?.parentElement?.parentElement;
    if (!section) return { pageNums: [], hasNextGroup: false };

    const pageNums = [...section.querySelectorAll('.js_reviewArticlePageBtn')]
      .map(b => b.textContent.trim())
      .filter(t => /^\d+$/.test(t));

    const nextGroupBtn = section.querySelector('.js_reviewArticlePageNextBtn');
    const hasNextGroup = !!(nextGroupBtn && !nextGroupBtn.disabled);

    return { pageNums, hasNextGroup };
  });
}

/**
 * Q&A 특정 페이지 번호 버튼 클릭
 */
async function clickQnAPageNum(page, pageNum) {
  await page.evaluate((num) => {
    const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '상품문의');
    const section = h2?.parentElement?.parentElement?.parentElement;
    const btn = [...(section?.querySelectorAll('.js_reviewArticlePageBtn') || [])]
      .find(b => b.textContent.trim() === String(num));
    btn?.click();
  }, pageNum);
  await new Promise(r => setTimeout(r, 1200));
}

/**
 * Q&A 다음 페이지 그룹 버튼 클릭 (10페이지 단위 이동)
 */
async function clickQnANextGroup(page) {
  await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '상품문의');
    const section = h2?.parentElement?.parentElement?.parentElement;
    section?.querySelector('.js_reviewArticlePageNextBtn')?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
}

/**
 * Q&A 섹션에서 "전체보기" 버튼 클릭 후 전체 목록 노출
 */
async function clickQnAViewAll(page) {
  await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '상품문의');
    const section = h2?.parentElement?.parentElement?.parentElement;
    const btn = [...(section?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === '전체보기');
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 2000));
}

/**
 * Q&A 날짜 정규화 → "YYYY.MM.DD"
 * 입력 형식: "2025/12/29 21:57:12" | "20251229215712" | timestamp(ms)
 */
function formatQnADate(d) {
  if (!d) return '';
  if (typeof d === 'number') {
    const dt = new Date(d);
    return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
  }
  const s = String(d);
  // "2025/12/29 21:57:12" 또는 "2025-12-29"
  const m = s.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  // "20251229215712" (14자리 숫자)
  if (/^\d{14}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  return s;
}

/**
 * DOM에서 추출한 Q&A 아이템 → formatQnAData() 입력 스키마 변환
 * 구조: { question, author, questionDate, answer, answerAuthor, answerDate }
 */
function convertQnAItem(item, pageNum, idx) {
  return {
    answerStatus: item.answer ? '답변완료' : '미답변',
    title: item.question,
    author: item.author || '비공개',
    date: formatQnADate(item.questionDate),
    question: item.question,
    answer: item.answer,
    answerAuthor: item.answerAuthor || '판매자',
    answerDate: formatQnADate(item.answerDate),
    isSecret: false,
    Page_Review: `${pageNum}_${idx + 1}`,
  };
}

/**
 * 리뷰 이미지 다운로드
 */
async function downloadPhotos(attachments, photoFolderPath, currentPage, reviewIndex) {
  if (!attachments?.length || !photoFolderPath) return [];
  const savedPhotos = [];
  try {
    const { downloadAndSaveReviewImage } = await import('../../src/utils/naver/imageDownloader.js');
    for (let i = 0; i < attachments.length; i++) {
      const url = attachments[i].imgSrcThumbnail || attachments[i].imgSrcOrigin || '';
      if (!url) continue;
      try {
        const saved = await downloadAndSaveReviewImage(url, photoFolderPath, currentPage, reviewIndex, i);
        if (saved) savedPhotos.push(saved);
      } catch (err) {
        console.error(`[CoupangService] 이미지 ${i + 1} 다운로드 실패:`, err.message);
      }
    }
  } catch (e) {
    console.error('[CoupangService] imageDownloader import 실패:', e.message);
  }
  return savedPhotos;
}

/**
 * 쿠팡 플랫폼 처리 메인 함수
 */
export async function handleCoupang(browser, page, input, isUrl, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', excludeSecret = false, webContents = null) {

  resetSessionFolderName();
  setSessionFolderPrefix(collectionType === 1 ? 'qna' : 'review');

  const sendLog = (message, className = '', updateLast = false) => {
    if (webContents) webContents.send('crawler-log', { message, className, updateLast });
    if (!updateLast) console.log(message);
  };

  const folderName = getStorageDirectory(savePath).split(/[/\\]/).pop();
  sendLog(`[경로] 저장 폴더: ${folderName}`, 'info');

  let productPage = null;
  let productId = null;

  try {
    // ── 1. 페이지 이동 ────────────────────────────────────────────────
    if (isUrl) {
      sendLog('[진행] 쿠팡 상품 페이지로 이동 중...', 'info');
      productPage = await browser.newPage();
      await productPage.goto(input, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await productPage.bringToFront();
    } else {
      const searchUrl = createCoupangSearchUrl(input);
      sendLog(`[진행] 쿠팡 검색 페이지로 이동 중... (${input})`, 'info');
      productPage = await browser.newPage();
      await productPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await productPage.bringToFront();
      sendLog('[안내] 검색 결과에서 원하는 상품을 클릭해주세요.', 'info');
      try {
        const result = await waitForCoupangProductPage(browser, productPage, sendLog);
        productPage = result.page;
      } catch (e) {
        return { success: false, error: e.message, platform: '쿠팡' };
      }
    }

    // ── 2. 상품 페이지 확인 ──────────────────────────────────────────
    const currentUrl = productPage.url();
    if (!isCoupangProductPage(currentUrl)) {
      sendLog('[경고] 쿠팡 상품 상세 페이지 URL이 아닙니다.', 'warning');
    }

    const verify = await verifyCoupangProductPageLoaded(productPage);
    if (verify.success) {
      sendLog(`[완료] 상품 페이지 확인: ${verify.title || '(제목 확인 불가)'}`, 'success');
    } else {
      sendLog('[경고] 상품 페이지 로딩 확인 실패. 계속 진행합니다.', 'warning');
    }

    // ── 3. productId 추출 ────────────────────────────────────────────
    productId = await extractProductId(productPage);
    if (!productId) {
      return { success: false, error: 'productId를 추출할 수 없습니다. URL을 확인해주세요.', platform: '쿠팡' };
    }
    sendLog(`[정보] 상품 ID: ${productId}`, 'info');

    const maxPages = getMaxPages(pages, customPages);
    const maxPagesText = maxPages === Infinity ? '무제한' : `${maxPages}페이지`;
    let finalSavePath = getStorageDirectory(savePath);

    // ── 4A. Q&A 수집 ─────────────────────────────────────────────────
    if (collectionType === 1) {
      await clickCoupangQnaTab(productPage, sendLog);
      sendLog(`[시작] 상품문의 DOM 수집 시작 (최대 ${maxPagesText})`, 'info');

      // "전체보기" 클릭으로 전체 목록 노출 (1페이지 내용 자동 로드됨)
      await clickQnAViewAll(productPage);

      let allQnAs = [];
      let absolutePage = 1;    // 전체 절대 페이지 번호
      let visitedPages = new Set();

      outer: while (absolutePage <= maxPages) {
        // 현재 그룹의 페이지 번호 목록 확인
        const { pageNums, hasNextGroup } = await getQnAPaginationState(productPage);

        for (const pageNum of pageNums) {
          if (absolutePage > maxPages) break outer;
          if (visitedPages.has(pageNum)) continue;

          // 첫 페이지(1)는 전체보기 후 이미 로드됨, 나머지는 클릭
          if (pageNum !== '1' || visitedPages.size === 0) {
            if (pageNum !== pageNums[0] || visitedPages.size > 0) {
              await clickQnAPageNum(productPage, pageNum);
            }
          }

          sendLog(`[진행] Q&A 페이지 ${absolutePage} 수집 중...`, 'info', true);
          const domResult = await fetchQnAFromDOM(productPage);

          if (domResult.error) {
            sendLog(`[오류] Q&A DOM 수집 실패: ${domResult.error}`, 'error');
            break outer;
          }

          const pageQnAs = (domResult.questions ?? []).map((item, i) =>
            convertQnAItem(item, absolutePage, i)
          );
          allQnAs = allQnAs.concat(pageQnAs);
          sendLog(`[완료] 페이지 ${absolutePage}: ${pageQnAs.length}개 수집 (누적: ${allQnAs.length}개)`, 'success');

          visitedPages.add(pageNum);
          absolutePage++;

          if (pageQnAs.length === 0) break outer;
        }

        if (!hasNextGroup) break;
        await clickQnANextGroup(productPage);
      }

      sendLog(`[완료] 총 ${allQnAs.length}개 상품문의 수집 완료`, 'success');

      if (allQnAs.length > 0) {
        try {
          sendLog('[진행] Q&A 데이터 저장 중...', 'info', true);
          const formatted = formatQnAData(allQnAs);
          const savedPaths = await saveReviews(formatted, 'coupang_qna', savePath);
          const jsonCount = savedPaths.filter(p => p.endsWith('.json')).length;
          sendLog(`[확인] 저장 완료: JSON ${jsonCount}개`, 'success');
        } catch (e) {
          sendLog(`[오류] Q&A 저장 실패: ${e.message}`, 'error');
        }
      }

      sendLog(`[완료] 크롤링 완료 (총 ${allQnAs.length}개 상품문의)`, 'success');
      return { success: true, message: '쿠팡 상품문의 수집 완료', platform: '쿠팡', isUrl, qnas: allQnAs, savePath: finalSavePath };
    }

    // ── 4B. 리뷰 수집 ────────────────────────────────────────────────
    await clickCoupangReviewTab(productPage, sendLog);

    const sortBy = getSortBy(sort);
    const sortName = sort === 1 ? '최신순' : '베스트순';
    sendLog(`[시작] 리뷰 API 수집 시작 (최대 ${maxPagesText}, ${sortName})`, 'info');

    const photoFolderPath = getStorageDirectory(savePath);
    let allReviews = [];
    let chunkReviews = [];
    let chunkCount = 1;
    const CHUNK_SIZE = 50;
    let excelChunkCount = 0;
    let currentPage = 1;
    let totalPage = null;
    let emptyPageCount = 0;

    while (currentPage <= maxPages) {
      sendLog(`[진행] 리뷰 페이지 ${currentPage}/${maxPages === Infinity ? (totalPage ?? '?') : maxPages} 수집 중...`, 'info', true);

      const apiResult = await fetchReviewPage(productPage, productId, currentPage, sortBy, currentPage === 1);

      if (apiResult.error) {
        sendLog(`[오류] API 호출 실패 (페이지 ${currentPage}): ${apiResult.error}`, 'error');
        break;
      }

      if (currentPage === 1) {
        totalPage = apiResult.totalPage;
        sendLog(`[정보] 전체 ${apiResult.totalCount}개 리뷰, ${totalPage}페이지`, 'info');
      }

      const pageReviews = [];
      for (let i = 0; i < apiResult.reviews.length; i++) {
        const apiReview = apiResult.reviews[i];
        const photoUrls = await downloadPhotos(apiReview.attachments, photoFolderPath, currentPage, i);
        pageReviews.push(convertToStorageFormat(apiReview, photoUrls));
      }

      allReviews = allReviews.concat(pageReviews);
      chunkReviews = chunkReviews.concat(pageReviews);
      sendLog(`[완료] 페이지 ${currentPage}: ${pageReviews.length}개 수집 (누적: ${allReviews.length}개)`, 'success');

      // 빈 페이지 감지 - 데이터 끝 또는 rate limit 대비
      if (pageReviews.length === 0) {
        emptyPageCount++;
        if (emptyPageCount >= 3) {
          sendLog(`[완료] 3페이지 연속 빈 응답 - 수집 종료`, 'info');
          break;
        }
        await new Promise(r => setTimeout(r, 2000 * emptyPageCount));
      } else {
        emptyPageCount = 0;
      }

      if (currentPage % CHUNK_SIZE === 0 && chunkReviews.length > 0) {
        try {
          sendLog(`[진행] 청크 ${chunkCount} 저장 중...`, 'info', true);
          const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'coupang_reviews', savePath, chunkCount);
          if (chunkPath) { sendLog(`[완료] 청크 ${chunkCount} 저장`, 'success'); excelChunkCount++; }
          chunkReviews = [];
          chunkCount++;
        } catch (e) {
          sendLog(`[오류] 청크 저장 실패: ${e.message}`, 'error');
        }
      }

      if (currentPage >= (totalPage ?? 1)) break;
      if (totalPage === null && !apiResult.isNext) break;
      currentPage++;

      // 페이지가 많을수록 딜레이 증가 (100페이지 이상: 1~2초, 50페이지 이하: 500ms~1초)
      const baseDelay = currentPage > 100 ? 1000 : 500;
      await new Promise(r => setTimeout(r, baseDelay + Math.floor(Math.random() * 1000)));
    }

    if (chunkReviews.length > 0) {
      try {
        sendLog(`[진행] 마지막 청크 ${chunkCount} 저장 중...`, 'info', true);
        const chunkPath = await saveReviewsToExcelChunk(chunkReviews, 'coupang_reviews', savePath, chunkCount);
        if (chunkPath) { sendLog(`[완료] 마지막 청크 ${chunkCount} 저장`, 'success'); excelChunkCount++; }
      } catch (e) {
        sendLog(`[오류] 마지막 청크 저장 실패: ${e.message}`, 'error');
      }
    }

    sendLog(`[완료] 총 ${allReviews.length}개 리뷰 수집 완료`, 'success');

    if (allReviews.length > 0) {
      try {
        sendLog('[진행] 최종 JSON 저장 중...', 'info', true);
        const savedPaths = await saveReviews(allReviews, 'coupang_reviews', savePath);
        const jsonCount = savedPaths.filter(p => p.endsWith('.json')).length;
        sendLog(`[확인] 저장 완료: JSON ${jsonCount}개, Excel ${excelChunkCount}개`, 'success');
      } catch (e) {
        sendLog(`[오류] JSON 저장 실패: ${e.message}`, 'error');
      }
    } else if (excelChunkCount > 0) {
      sendLog(`[확인] 저장 완료: Excel ${excelChunkCount}개`, 'success');
    }

    sendLog(`[완료] 크롤링 완료 (총 ${allReviews.length}개 리뷰)`, 'success');

    return {
      success: true,
      message: '쿠팡 리뷰 수집 완료',
      platform: '쿠팡',
      isUrl,
      reviews: allReviews,
      savePath: finalSavePath,
    };

  } catch (error) {
    console.error('[CoupangService] 오류:', error);
    sendLog(`[오류] ${error.message}`, 'error');
    return { success: false, error: error.message, platform: '쿠팡' };
  }
}
