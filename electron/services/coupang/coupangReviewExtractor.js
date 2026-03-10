/**
 * 쿠팡 리뷰 추출 관련 함수들
 * 실제 DOM 분석 기반 (2024-2025 기준)
 *
 * 구조:
 *   #sdpReview
 *     .sdp-review
 *       article (리뷰 아이템, 10개/페이지)
 *         span[data-member-id]          → 리뷰어 이름
 *         i.twc-bg-full-star (n개)      → 별점
 *         div.twc-text-[14px]/[15px].twc-text-bluegray-700  → 날짜
 *         div.판매자: ...               → 판매자
 *         div[class*="line-clamp"]      → 구매 옵션/상품명
 *         div[class*="twc-break-all"]   → 리뷰 본문 래퍼
 *           span.twc-bg-white           → 실제 본문 텍스트
 *         div[class*="twc-gap-[4px]"]   → 리뷰 사진 컨테이너
 *           img                         → 리뷰 사진 (아바타 아님)
 */

/**
 * 리뷰 섹션 대기 및 article 셀렉터 반환
 */
export async function findReviewSelector(page) {
  console.log('[CoupangReviewExtractor] 리뷰 섹션 대기 중...');

  try {
    await page.waitForSelector('#sdpReview article', { timeout: 15000 });
    const count = await page.evaluate(() =>
      document.querySelectorAll('#sdpReview article').length
    );
    if (count > 0) {
      console.log(`[CoupangReviewExtractor] ✅ #sdpReview article 발견 (${count}개)`);
      return '#sdpReview article';
    }
  } catch (e) {
    console.log('[CoupangReviewExtractor] #sdpReview article 없음, 스크롤 후 재시도...');
  }

  // 스크롤해서 리뷰 영역 노출 후 재시도
  await page.evaluate(() => {
    const el = document.querySelector('#sdpReview');
    if (el) el.scrollIntoView({ behavior: 'instant' });
  });
  await new Promise(r => setTimeout(r, 3000));

  try {
    await page.waitForSelector('#sdpReview article', { timeout: 10000 });
    const count = await page.evaluate(() =>
      document.querySelectorAll('#sdpReview article').length
    );
    if (count > 0) {
      console.log(`[CoupangReviewExtractor] ✅ 재시도 성공 (${count}개)`);
      return '#sdpReview article';
    }
  } catch (e) {
    console.log('[CoupangReviewExtractor] ❌ 리뷰 셀렉터 찾기 실패:', e.message);
  }

  return null;
}

/**
 * 단일 리뷰 데이터 추출
 */
export async function extractSingleReview(reviewElement, photoFolderPath, currentPage, reviewIndex) {
  try {
    const data = await reviewElement.evaluate((article) => {
      // ── 별점 ──────────────────────────────────────
      const fullStars = article.querySelectorAll('i[class*="twc-bg-full-star"]').length;
      const halfStars = article.querySelectorAll('i[class*="twc-bg-half-star"]').length;
      const rating = String(fullStars + halfStars * 0.5);

      // ── 리뷰어 이름 ───────────────────────────────
      const nameEl = article.querySelector('span[data-member-id]');
      const name = nameEl ? nameEl.textContent.trim() : '이름 없음';

      // ── 날짜 ──────────────────────────────────────
      // twc-text-bluegray-700 div들 중 날짜 패턴 매칭
      let date = '날짜 없음';
      const bluegrayDivs = article.querySelectorAll('div[class*="twc-text-bluegray-700"]');
      for (const el of bluegrayDivs) {
        const text = el.textContent.trim();
        if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) {
          date = text;
          break;
        }
      }

      // ── 구매 옵션/상품명 ──────────────────────────
      // line-clamp가 포함된 div (옵션명 텍스트)
      let option = '정보 없음';
      const lineclampEl = article.querySelector('div[class*="line-clamp"]');
      if (lineclampEl) {
        option = lineclampEl.textContent.trim();
      }

      // ── 리뷰 본문 ─────────────────────────────────
      // twc-break-all div 안의 span.twc-bg-white
      let content = '내용 없음';
      const breakAllDiv = article.querySelector('div[class*="twc-break-all"]');
      if (breakAllDiv) {
        const bgWhiteSpan = breakAllDiv.querySelector('span[class*="twc-bg-white"]');
        if (bgWhiteSpan) {
          content = bgWhiteSpan.textContent.trim();
        } else {
          content = breakAllDiv.textContent.trim();
        }
      }

      // ── 리뷰 사진 URL ─────────────────────────────
      // twc-gap-[4px] 컨테이너 안의 img (아바타 제외)
      const photoContainer = article.querySelector('div[class*="twc-gap-[4px]"]');
      const photoUrls = photoContainer
        ? Array.from(photoContainer.querySelectorAll('img'))
            .map(img => img.src || '')
            .filter(Boolean)
        : [];

      return { rating, name, date, option, content, photoUrls };
    });

    console.log(`[CoupangReviewExtractor] 리뷰 ${reviewIndex + 1}: 별점=${data.rating}, 이름=${data.name}, 날짜=${data.date}, 사진=${data.photoUrls.length}개`);

    // 사진 다운로드
    const photos = photoFolderPath
      ? await downloadReviewPhotos(data.photoUrls, photoFolderPath, currentPage, reviewIndex)
      : data.photoUrls;

    return {
      'Review Score': data.rating,
      'Reviewer Name': data.name,
      'Review Date': data.date,
      'Product(Option) Name': data.option,
      'Review Type': '일반리뷰',
      'Content': data.content,
      'Photos': photos,
    };
  } catch (e) {
    console.error(`[CoupangReviewExtractor] 리뷰 ${reviewIndex + 1} 추출 실패:`, e.message);
    return {
      'Review Score': '점수 없음',
      'Reviewer Name': '이름 없음',
      'Review Date': '날짜 없음',
      'Product(Option) Name': '정보 없음',
      'Review Type': '일반리뷰',
      'Content': '내용 없음',
      'Photos': [],
    };
  }
}

/**
 * 리뷰 사진 다운로드
 */
async function downloadReviewPhotos(photoUrls, photoFolderPath, currentPage, reviewIndex) {
  if (!photoUrls || photoUrls.length === 0) return [];
  const savedPhotos = [];
  try {
    const { downloadAndSaveReviewImage } = await import('../../../src/utils/naver/imageDownloader.js');
    for (let i = 0; i < photoUrls.length; i++) {
      try {
        const saved = await downloadAndSaveReviewImage(
          photoUrls[i], photoFolderPath, currentPage, reviewIndex, i
        );
        if (saved) savedPhotos.push(saved);
      } catch (err) {
        console.error(`[CoupangReviewExtractor] 이미지 ${i + 1} 다운로드 실패:`, err.message);
      }
    }
  } catch (e) {
    console.error('[CoupangReviewExtractor] imageDownloader import 실패:', e.message);
  }
  return savedPhotos;
}

/**
 * 현재 페이지의 모든 리뷰 추출
 */
export async function extractAllReviews(page, photoFolderPath, currentPage = 1) {
  console.log(`[CoupangReviewExtractor] 페이지 ${currentPage} 리뷰 추출 시작...`);

  const selector = await findReviewSelector(page);
  if (!selector) {
    console.log('[CoupangReviewExtractor] ❌ 리뷰 셀렉터 없음');
    return [];
  }

  const reviewElements = await page.$$(selector);
  console.log(`[CoupangReviewExtractor] ${reviewElements.length}개 리뷰 발견`);

  const reviews = [];
  for (let i = 0; i < reviewElements.length; i++) {
    const reviewData = await extractSingleReview(reviewElements[i], photoFolderPath, currentPage, i);
    reviews.push(reviewData);
  }

  console.log(`[CoupangReviewExtractor] ✅ ${reviews.length}개 추출 완료`);
  return reviews;
}
