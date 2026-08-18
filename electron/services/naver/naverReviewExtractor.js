/**
 * 네이버 리뷰 추출 — page.evaluate 일회 직렬화 방식
 *
 * 구버전은 page.$$로 ElementHandle 1200개를 캐싱한 채 for loop으로 추출했는데,
 * 도중에 모달 frame이 detach되면 모든 핸들이 무효화되어 대량 실패가 발생했다.
 * 본 구현은 page.evaluate 한 번 호출로 모든 메타데이터를 직렬화 가능한
 * 객체 배열로 추출하고, 이미지는 URL 기반으로 별도 다운로드한다.
 * 따라서 detach 위험 0.
 */
import { REVIEW } from './naverSelectors.js';
import { downloadAndSaveReviewImage } from '../../../src/utils/naver/imageDownloader.js';

/**
 * 네이버 phinf URL을 480px 작은 사이즈로 변환
 * - pstatic.net 도메인이 아니면 변환하지 않음
 * - 기존 ?type=... 쿼리는 모두 제거 후 ?type=w480 부착
 * @param {string} url
 * @returns {string}
 */
function toSmallImageUrl(url) {
  if (!url) return url;
  if (!url.includes('pstatic.net')) return url; // 다른 도메인은 변환 안 함
  const [base] = url.split('?');
  return `${base}?type=w480`;
}

/**
 * 사진 다운로드 집계 누적기 — 수집 «실행 전체»의 성공/실패를 한 곳에 모은다.
 * 리뷰 수집의 partial 판정과는 «별개»다 (리뷰는 다 받고 사진만 실패하는 경우가 실제로 있다).
 * @returns {{total:number, ok:number, fail:number, reasons:object}}
 */
export function createPhotoStats() {
  return { total: 0, ok: 0, fail: 0, reasons: {} };
}

/** 실패 1건을 사유별로 적립 (사유 문자열은 길이 제한 — 로그/IPC 방어) */
export function countPhotoFailure(stats, reason) {
  stats.fail++;
  const key = String(reason || '사유 미상').slice(0, 80);
  stats.reasons[key] = (stats.reasons[key] || 0) + 1;
}

/** 실패 사유 상위 n건 */
export function topPhotoFailReasons(stats, n = 3) {
  return Object.entries(stats.reasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count }));
}

/**
 * 동시성 제한 worker pool — items 배열의 각 원소를 mapper로 처리, 결과는 같은 인덱스로 보존
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} mapper - async (item, index) => result
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array(workerCount).fill(0).map(worker));
  return results;
}

/**
 * 모든 리뷰 추출 — 모달 내 li[id^="REVIEW_ITEM_"] 전체를 처리
 * @param {object} page - Puppeteer page 객체
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호 (무한 스크롤이라 보통 1)
 * @param {object} options - 추가 옵션
 * @param {boolean} options.downloadImages - 이미지 다운로드 여부 (기본 true)
 * @param {boolean} options.smallImage - 이미지 작게 받기 여부 (기본 false, true면 480px 다운로드)
 * @param {Function} options.sendLog - sendLog(message, className, updateLast) 콜백
 * @returns {Promise<Array<object>>} 리뷰 데이터 배열
 */
export async function extractAllReviews(page, photoFolderPath, currentPage = 1, options = {}) {
  // 사진 다운로드/조립 옵션은 그대로 finalizeReviews로 넘긴다 (아래 ② 참고)
  console.log('[NaverReviewExtractor] 모든 리뷰 추출 시작 (page.evaluate 일회 직렬화)...');

  // ① page.evaluate 한 번 호출로 전체 리뷰 메타데이터 직렬화
  // ElementHandle을 사용하지 않으므로 frame detach에 영향받지 않음
  const rawReviews = await page.evaluate((REVIEW) => {
    // 별점 추출 헬퍼 (extractScore 인라인)
    const extractScore = (scoreEl) => {
      if (!scoreEl) return '';
      const first = scoreEl.firstChild;
      if (first && first.nodeType === 3 && first.nodeValue) {
        const m = first.nodeValue.match(/[1-5]/);
        if (m) return m[0];
      }
      const m = (scoreEl.textContent || '').match(/[1-5]/);
      return m ? m[0] : '';
    };

    const items = Array.from(document.querySelectorAll(REVIEW.modalDialogSelector));

    return items.map((el) => {
      // 별점
      const scoreEl = el.querySelector(REVIEW.scoreContainer);
      const reviewScore = extractScore(scoreEl) || '점수 없음';

      // 작성자/날짜 (span.sDXjr3m0LZ × 2)
      let reviewerName = '이름 없음';
      let reviewDate = '날짜 없음';
      const authorContainer = el.querySelector(REVIEW.authorDateContainer);
      if (authorContainer) {
        const spans = Array.from(authorContainer.querySelectorAll(REVIEW.authorDateSpan));
        const nameRaw = spans[0] ? (spans[0].textContent || '').trim() : '';
        const dateRaw = spans[1] ? (spans[1].textContent || '').trim() : '';
        if (nameRaw) reviewerName = nameRaw;
        if (dateRaw) reviewDate = dateRaw;
      }

      // 본문 (p.Uv4T3VkhKU에서 끝의 "더보기" 제거)
      let content = '내용 없음';
      const p = el.querySelector(REVIEW.contentParagraph);
      if (p) {
        let raw = (p.textContent || '').trim();
        raw = raw.replace(/더보기$/, '').trim();
        if (raw) content = raw;
      }

      // 리뷰 유형 (em.FJNePG7vwX 텍스트 모음에서 한달사용/재구매 검출)
      const badges = Array.from(el.querySelectorAll(REVIEW.reviewTypeBadge))
        .map((b) => (b.textContent || '').trim())
        .filter((t) => t.length > 0);
      const isOneMonthReview = badges.some((t) => t.includes('한달사용'));
      const isReorder = badges.some((t) => t.includes('재구매'));
      let reviewType = '일반리뷰';
      if (isOneMonthReview && isReorder) reviewType = '한달+재구매';
      else if (isOneMonthReview) reviewType = '한달사용기';
      else if (isReorder) reviewType = '재구매';

      // 사진 URL — li.uVSJ8fwmPd img.G6QVe8dT5G의 data-src 우선, 없으면 src
      const imgSelector = `${REVIEW.photoListItem} ${REVIEW.photoImg}`;
      let imgs = Array.from(el.querySelectorAll(imgSelector));
      if (imgs.length === 0) {
        // photoListItem 없이 img만 있는 케이스 폴백
        imgs = Array.from(el.querySelectorAll(REVIEW.photoImg));
      }
      const photoUrls = imgs
        .map((img) => img.getAttribute('data-src') || img.getAttribute('src') || '')
        .filter((u) => u && u.length > 0);

      return {
        reviewScore,
        reviewerName,
        reviewDate,
        content,
        reviewType,
        photoUrls,
      };
    });
  }, REVIEW);

  console.log(`[NaverReviewExtractor] ${rawReviews.length}개의 리뷰 메타데이터를 직렬화 추출했습니다.`);

  return finalizeReviews(rawReviews, photoFolderPath, currentPage, options);
}

/**
 * 원시 리뷰(메타) 배열 → 사진 다운로드 + 최종 저장 객체 조립.
 *
 * ★DOM 추출 경로(extractAllReviews)와 API 페이징 경로(naverReviewApi)가 «공유»한다.
 *   두 경로가 같은 함수를 쓰므로 엑셀/JSON에 들어가는 최종 형태는 항상 동일하다.
 *
 * 원시 형태: { reviewScore, reviewerName, reviewDate, content, reviewType, photoUrls[] }
 *
 * @param {Array<object>} rawReviews - 원시 리뷰 배열
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 이미지 파일명에 쓰는 페이지 번호 (무한 스크롤/API 모두 보통 1)
 * @param {object} options
 * @param {boolean} options.downloadImages - 이미지 다운로드 여부 (기본 true)
 * @param {boolean} options.smallImage - 480px 작게 받기 (기본 false)
 * @param {string} options.imageMode - UI 이미지 모드 원본값 (small|original|urls|off). ★안내 문구 분기 전용.
 * @param {Function} options.sendLog - sendLog(message, className, updateLast)
 * @param {number} options.indexOffset - 리뷰 «전역» 시작 인덱스. 나눠서 조립할 때 Page_Review 번호와
 *                                       이미지 파일명이 겹치지 않도록 한다 (기본 0 = 기존 동작 그대로).
 * @param {object} options.photoStats - createPhotoStats()로 만든 누적기. 넘기면 사진 성공/실패가 여기에 쌓여
 *                                      호출자(naverService)가 완료 문구에 쓸 수 있다.
 * @returns {Promise<Array<object>>} 최종 리뷰 객체 배열 (★사진 실패는 이 배열을 실패로 만들지 않는다)
 */
export async function finalizeReviews(rawReviews, photoFolderPath, currentPage = 1, options = {}) {
  const { downloadImages = true, smallImage = false, imageMode = '', sendLog = null, indexOffset = 0 } = options;
  // ★사진 집계 — 호출자가 넘긴 누적기가 있으면 «실행 전체»로 합산된다(청크로 나눠 불려도 총계가 맞는다).
  const stats = options.photoStats || createPhotoStats();

  if (!rawReviews || rawReviews.length === 0) {
    console.log('[NaverReviewExtractor] ❌ 추출된 리뷰가 없습니다.');
    return [];
  }

  // 메타 추출 후 진행률 안내 (총 사진 수 계산)
  const totalPhotoCount = rawReviews.reduce((sum, r) => sum + (r.photoUrls?.length || 0), 0);

  if (downloadImages) {
    sendLog?.(`[진행] 메타데이터 추출 완료, 이미지 다운로드 시작 (${totalPhotoCount}장)`, 'info');
    if (smallImage) {
      sendLog?.(`[안내] 이미지 작게 받기 모드 (480px, 빠른 다운로드)`, 'info');
    }
  } else if (imageMode === 'urls') {
    // ★'주소만' 모드 — 파일은 받지 않지만 엑셀 «사진주소» 칸에 원본 URL이 들어간다.
    //   (off와 다운로드 동작은 «같다». 다른 것은 사용자에게 알리는 문구뿐이다.)
    sendLog?.(`[안내] 이미지 «주소만» 모드 — 사진 파일은 받지 않고, 엑셀 «사진주소» 칸에 원본 링크 ${totalPhotoCount}개를 기록합니다`, 'info');
  } else {
    sendLog?.(`[안내] 이미지 다운로드 OFF — 메타만 저장 (엑셀 «사진수/사진주소» 칸은 그대로 채워집니다)`, 'info');
  }

  // ② 사진 다운로드 작업을 (reviewIdx, photoIdx, url) 평탄화 후 동시성 8 풀 처리
  // — 사진 있는 리뷰만 큐에 들어가므로 효율적
  const photoResults = rawReviews.map((r) => new Array(r.photoUrls.length).fill(null));

  if (downloadImages && totalPhotoCount > 0) {
    const tasks = [];
    for (let ri = 0; ri < rawReviews.length; ri++) {
      const urls = rawReviews[ri].photoUrls;
      for (let pi = 0; pi < urls.length; pi++) {
        tasks.push({ reviewIdx: ri, photoIdx: pi, url: urls[pi] });
      }
    }

    const total = tasks.length;
    stats.total += total;
    // ★성공/실패를 «따로» 센다.
    //   종전에는 finally에서 completed 하나만 올려 500장이 실패해도 "9975/9975"로 끝까지 찬 것처럼 보였다
    //   (= 리뷰 60건만 받고 「완료」를 띄운 것과 같은 구조의 무음 실패).
    await mapWithConcurrency(tasks, 8, async (task) => {
      let failReason = null;
      try {
        const targetUrl = smallImage ? toSmallImageUrl(task.url) : task.url;
        const savedPath = await downloadAndSaveReviewImage(
          targetUrl,
          photoFolderPath,
          currentPage,
          indexOffset + task.reviewIdx,
          task.photoIdx,
          { keepQuery: !!smallImage, onFail: (reason) => { failReason = reason; } }
        );
        if (savedPath) {
          photoResults[task.reviewIdx][task.photoIdx] = savedPath;
          stats.ok++;
        } else {
          countPhotoFailure(stats, failReason || '다운로드 실패 (사유 미상)');
        }
      } catch (e) {
        console.error(`[NaverReviewExtractor] 리뷰 ${task.reviewIdx + 1} 이미지 ${task.photoIdx + 1} 다운로드 실패: ${e.message}`);
        countPhotoFailure(stats, String((e && e.message) || e));
      } finally {
        const done = stats.ok + stats.fail;
        if (done % 100 === 0 || done === stats.total) {
          sendLog?.(`[진행] 이미지 ${stats.ok.toLocaleString()}/${stats.total.toLocaleString()}장 저장${stats.fail ? ` (실패 ${stats.fail.toLocaleString()})` : ''}`, 'info', true);
        }
      }
    });

    // ★사진 실패는 «리뷰 수집»의 부분수집과 구분해서 알린다 — 리뷰는 다 받았는데 사진만 실패한 경우가 있다.
    //   ⛔사진 실패로 리뷰 저장을 실패로 뒤집지 않는다. 데이터는 살리고 «표기»만 정직하게.
    if (stats.fail > 0) {
      sendLog?.(`[경고] ⚠️ 사진 «부분 저장» — ${stats.ok.toLocaleString()}/${stats.total.toLocaleString()}장 저장, ${stats.fail.toLocaleString()}장 실패 (리뷰 본문/엑셀은 정상 저장됩니다)`, 'warning');
      const top = topPhotoFailReasons(stats, 3);
      if (top.length) sendLog?.(`[안내] 사진 실패 사유: ${top.map((t) => `${t.reason} ${t.count}건`).join(' / ')}`, 'info');
    } else {
      sendLog?.(`[완료] 이미지 ${stats.ok.toLocaleString()}/${stats.total.toLocaleString()}장 저장`, 'success', true);
    }
  }

  // ③ 리뷰 객체 조립
  const reviews = [];
  for (let i = 0; i < rawReviews.length; i++) {
    const raw = rawReviews[i];

    // 진행률 로그 (매 50개)
    if (i === 0 || (i + 1) % 50 === 0 || i === rawReviews.length - 1) {
      console.log(`[NaverReviewExtractor] 📊 진행: ${i + 1}/${rawReviews.length}`);
    }

    // 날짜 후처리 (YY.MM.DD. 패턴 보정) — 화면 텍스트에 섞인 잡음을 잘라내는 보정이다.
    // ★API 경로가 주는 ISO 날짜(2026-08-15)는 «건드리지 않는다» — 정규식의 '.'가 '-'에도 매치되어
    //   '26-08-15'로 잘려나가기 때문(라이브 아님, 로컬 검증).
    let reviewDate = raw.reviewDate;
    if (reviewDate && reviewDate !== '날짜 없음' && !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
      const m = reviewDate.match(/\d{2}\.\d{2}\.\d{2}\.?/);
      if (m) reviewDate = m[0];
    }

    // 사진 결과 — 다운로드 OFF면 빈 배열, ON이면 성공한 path만 모음
    let photos = [];
    if (downloadImages) {
      photos = (photoResults[i] || []).filter((p) => p);
    }

    // TODO: 옵션 있는 상품에서 셀렉터 확정 필요 (lalacamp 보풀제거기는 옵션 없는 상품이라 미확인)
    const productName = '정보 없음';

    reviews.push({
      'Page_Review': `${currentPage}_${indexOffset + i + 1}`,
      'Review Score': raw.reviewScore,
      'Reviewer Name': raw.reviewerName,
      'Review Date': reviewDate,
      'Product(Option) Name': productName,
      'Review Type': raw.reviewType,
      'Content': raw.content,
      'Photos': photos,
      // ★원본 사진 URL — 다운로드 여부와 «무관하게» 항상 담는다.
      //   엑셀의 «사진수/사진주소» 칸은 이 필드에서 나온다(이미지 OFF·주소만 모드에서도 채워진다).
      'PhotoUrls': Array.isArray(raw.photoUrls) ? raw.photoUrls : [],
    });
  }

  console.log(`[NaverReviewExtractor] ✅ 총 ${reviews.length}개의 리뷰를 추출했습니다.`);
  return reviews;
}
