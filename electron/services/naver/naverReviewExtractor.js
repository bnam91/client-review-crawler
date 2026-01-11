/**
 * 네이버 리뷰 추출 관련 함수들
 */

/**
 * 안전하게 텍스트 추출 (여러 셀렉터 시도)
 * @param {object} element - Puppeteer ElementHandle
 * @param {Array<string>} selectors - 시도할 셀렉터 배열
 * @param {string} defaultValue - 기본값
 * @returns {Promise<string>} 추출된 텍스트
 */
async function safeExtractText(element, selectors, defaultValue = '') {
  for (const selector of selectors) {
    try {
      const text = await element.evaluate((el, sel) => {
        const elem = el.querySelector(sel);
        return elem ? (elem.textContent || '').trim() : null;
      }, selector);
      
      if (text && text.length > 0) {
        return text;
      }
    } catch (e) {
      continue;
    }
  }
  return defaultValue;
}

/**
 * 리뷰 요소들이 실제 리뷰인지 검증
 * @param {Array} elements - 리뷰 요소 배열
 * @param {string} selectorName - 셀렉터 이름 (로깅용)
 * @returns {Promise<number>} 유효한 리뷰 개수
 */
async function validateReviews(elements, selectorName) {
  let validReviews = 0;
  const scoreSelectors = [
    'em.n6zq2yy0KA',
    'div.AlfkEF45qI em.n6zq2yy0KA',
    'div.AlfkEF45qI em',
    'em[class*="score"]',
    'em[class*="star"]',
    'em[class*="rating"]',
    'em',
    'span[class*="score"]',
    'span[class*="star"]'
  ];
  
  // 처음 3개 요소만 검증
  for (let i = 0; i < Math.min(3, elements.length); i++) {
    try {
      const elem = elements[i];
      let scoreFound = false;
      
      for (const scoreSelector of scoreSelectors) {
        try {
          const scoreText = await elem.evaluate((el, sel) => {
            const scoreElem = el.querySelector(sel);
            if (scoreElem && scoreElem.textContent) {
              const text = scoreElem.textContent.trim();
              // 숫자만 있는지 확인 (1-5 범위의 점수)
              if (/^[1-5]$/.test(text)) {
                return text;
              }
            }
            return null;
          }, scoreSelector);
          
          if (scoreText) {
            validReviews++;
            scoreFound = true;
            console.log(`[NaverReviewExtractor]   요소 ${i+1}: 점수 '${scoreText}' 발견`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!scoreFound) {
        try {
          const html = await elem.evaluate((el) => el.outerHTML.substring(0, 200));
          console.log(`[NaverReviewExtractor]   요소 ${i+1}: 점수 요소 없음 (HTML: ${html}...)`);
        } catch (e) {
          console.log(`[NaverReviewExtractor]   요소 ${i+1}: 점수 요소 없음`);
        }
      }
    } catch (e) {
      console.log(`[NaverReviewExtractor]   요소 ${i+1}: 점수 확인 실패 - ${e.message}`);
      continue;
    }
  }
  
  return validReviews;
}

/**
 * 리뷰 목록의 셀렉터를 동적으로 찾기
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<string|null>} 찾은 셀렉터 또는 null
 */
export async function findReviewSelector(page) {
  console.log('[NaverReviewExtractor] 리뷰 셀렉터 찾기 시작...');
  
  // 리뷰 섹션이 로드될 때까지 대기
  try {
    await page.waitForSelector('#REVIEW', { timeout: 10000 });
    console.log('[NaverReviewExtractor] 리뷰 섹션을 찾았습니다.');
  } catch (e) {
    console.log('[NaverReviewExtractor] 리뷰 섹션을 찾을 수 없습니다.');
  }
  
  // HTML 구조를 더 정확히 분석하여 셀렉터 우선순위 조정
  const possibleSelectors = [
    'ul.RR2FSL9wTc li.PxsZltB5tV',
    'li.PxsZltB5tV',
    '#REVIEW ul.RR2FSL9wTc li',
    'ul.HTT4L8U0CU li',
    '#REVIEW ul.HTT4L8U0CU li',
    '#REVIEW ul li',
    '#REVIEW li',
    'li[class*="PxsZltB5tV"]',
    'ul[class*="RR2FSL9wTc"] li',
    'li[class*="PxsZltB5tV"][class*="_nlog_click"]',
    '.review_list li',
    '[data-testid="review-item"]',
    '.review-item',
    'ul li[class*="review"]',
    'li[class*="review"]',
    'div[class*="review"] li'
  ];
  
  for (const selector of possibleSelectors) {
    try {
      const elements = await page.$$(selector);
      console.log(`[NaverReviewExtractor] 셀렉터 '${selector}' 테스트: ${elements.length}개 요소 발견`);
      
      if (elements && elements.length > 0) {
        const validReviews = await validateReviews(elements, selector);
        if (validReviews > 0) {
          console.log(`[NaverReviewExtractor] ✅ 리뷰 셀렉터 발견: ${selector} (${elements.length}개 리뷰, ${validReviews}개 유효)`);
          return selector;
        } else {
          console.log(`[NaverReviewExtractor] ❌ 셀렉터 '${selector}': 유효한 리뷰 없음`);
        }
      }
    } catch (e) {
      console.log(`[NaverReviewExtractor] ❌ 셀렉터 '${selector}' 테스트 실패: ${e.message}`);
      continue;
    }
  }
  
  // 마지막 시도: 리뷰가 로드될 때까지 대기하고 다시 시도
  console.log('[NaverReviewExtractor] 🔄 리뷰 로딩을 위해 추가 대기 후 재시도...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  for (const selector of possibleSelectors.slice(0, 5)) {
    try {
      const elements = await page.$$(selector);
      console.log(`[NaverReviewExtractor] 재시도 - 셀렉터 '${selector}' 테스트: ${elements.length}개 요소 발견`);
      
      if (elements && elements.length > 0) {
        const validReviews = await validateReviews(elements, selector);
        if (validReviews > 0) {
          console.log(`[NaverReviewExtractor] ✅ 재시도 성공 - 리뷰 셀렉터 발견: ${selector} (${elements.length}개 리뷰, ${validReviews}개 유효)`);
          return selector;
        }
      }
    } catch (e) {
      console.log(`[NaverReviewExtractor] ❌ 재시도 - 셀렉터 '${selector}' 테스트 실패: ${e.message}`);
      continue;
    }
  }
  
  console.log('[NaverReviewExtractor] 리뷰 셀렉터를 찾을 수 없습니다.');
  return null;
}

/**
 * 리뷰 내용 추출
 * @param {object} reviewElement - 리뷰 요소
 * @returns {Promise<string>} 리뷰 내용
 */
async function extractReviewContent(reviewElement) {
  const contentSelectors = [
    'div.KqJ8Qqw082 span.MX91DFZo2F',
    'div.AlfkEF45qI div.KqJ8Qqw082 span.MX91DFZo2F',
    'span.MX91DFZo2F',
    'div[class*="content"] span',
    '.review-content',
    'p[class*="content"]',
    'div[class*="text"]',
    'div.KqJ8Qqw082'
  ];
  
  // 파이썬 코드와 동일하게 여러 span을 찾아서 가장 긴 것을 선택
  for (const selector of contentSelectors) {
    try {
      const contents = await reviewElement.evaluate((el, sel) => {
        const elems = Array.from(el.querySelectorAll(sel));
        return elems
          .map(elem => elem.textContent ? elem.textContent.trim() : '')
          .filter(text => text.length > 0);
      }, selector);
      
      if (contents && contents.length > 0) {
        // 가장 긴 내용 선택 (10자 이상)
        const longestContent = contents.reduce((a, b) => a.length > b.length ? a : b, '');
        if (longestContent.length > 10) {
          return longestContent;
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  return '내용 없음';
}

/**
 * 리뷰 유형 확인
 * @param {object} reviewElement - 리뷰 요소
 * @returns {Promise<string>} 리뷰 유형
 */
async function determineReviewType(reviewElement) {
  const typeSelectors = [
    'span.W1IZsaUmnu',
    'div.KqJ8Qqw082 span.W1IZsaUmnu',
    'div.AlfkEF45qI div.KqJ8Qqw082 span.W1IZsaUmnu',
    'div.KqJ8Qqw082 span',
    'div.AlfkEF45qI div.KqJ8Qqw082 span',
    'span[class*="tag"]',
    '.review-tag',
    'div[class*="type"]'
  ];
  
  let reviewType = '일반리뷰';
  
  for (const selector of typeSelectors) {
    try {
      const types = await reviewElement.evaluate((el, sel) => {
        const elems = Array.from(el.querySelectorAll(sel));
        return elems
          .map(elem => elem.textContent ? elem.textContent.trim() : '')
          .filter(text => text.length > 0);
      }, selector);
      
      if (types && types.length > 0) {
        const isOneMonthReview = types.some(t => t.includes('한달사용'));
        const isReorder = types.some(t => t.includes('재구매'));
        
        if (isOneMonthReview && isReorder) {
          reviewType = '한달+재구매';
        } else if (isOneMonthReview) {
          reviewType = '한달사용기';
        } else if (isReorder) {
          reviewType = '재구매';
        }
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  return reviewType;
}

/**
 * 리뷰 이미지 추출 및 다운로드
 * @param {object} reviewElement - 리뷰 요소
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호
 * @param {number} reviewIndex - 리뷰 인덱스
 * @returns {Promise<Array<string>>} 저장된 이미지 파일 경로 배열
 */
async function extractReviewPhotos(reviewElement, photoFolderPath, currentPage, reviewIndex) {
  console.log(`[NaverReviewExtractor]      📸 리뷰 이미지 추출 시작...`);
  
  const photoSelectors = [
    'img.UpImHAUeYJ[alt="review_image"]',
    'div.AlfkEF45qI img.UpImHAUeYJ[alt="review_image"]',
    'div.s30AvhHfb0 img.UpImHAUeYJ[alt="review_image"]',
    'img[alt="review_image"]',
    'img[class*="review"]',
    '.review-photo img'
  ];
  
  let photoElements = [];
  
  // 이미지 요소 찾기
  console.log(`[NaverReviewExtractor]      🔍 이미지 요소를 찾는 중...`);
  for (const selector of photoSelectors) {
    try {
      const elements = await reviewElement.$$(selector);
      if (elements && elements.length > 0) {
        photoElements = elements;
        console.log(`[NaverReviewExtractor]      ✅ 이미지 요소 ${elements.length}개 발견: ${selector}`);
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (photoElements.length === 0) {
    console.log(`[NaverReviewExtractor]      ⚠️ 이미지 요소를 찾을 수 없습니다.`);
    return [];
  }
  
  // 이미지 URL 추출 및 다운로드
  const savedPhotos = [];
  const { downloadAndSaveReviewImage } = await import('../../../src/utils/naver/imageDownloader.js');
  
  for (let i = 0; i < photoElements.length; i++) {
    try {
      console.log(`[NaverReviewExtractor]        🖼️ 이미지 ${i + 1}/${photoElements.length} 처리 중...`);
      
      // data-src 속성을 우선적으로 사용 (원본 이미지)
      console.log(`[NaverReviewExtractor]          🔗 이미지 URL 추출 중...`);
      const photoUrl = await photoElements[i].evaluate((img) => {
        return img.getAttribute('data-src') || img.src || '';
      });
      
      if (!photoUrl) {
        console.log(`[NaverReviewExtractor]          ⚠️ 이미지 URL을 찾을 수 없습니다.`);
        continue;
      }
      
      console.log(`[NaverReviewExtractor]          📝 원본 URL: ${photoUrl}`);
      
      // 이미지 다운로드 및 저장
      const savedPath = await downloadAndSaveReviewImage(
        photoUrl,
        photoFolderPath,
        currentPage,
        reviewIndex,
        i
      );
      
      if (savedPath) {
        savedPhotos.push(savedPath);
        console.log(`[NaverReviewExtractor]          ✅ 이미지 ${i + 1} 처리 완료`);
      } else {
        console.log(`[NaverReviewExtractor]          ❌ 이미지 ${i + 1} 다운로드 실패`);
      }
    } catch (error) {
      console.error(`[NaverReviewExtractor]          ❌ 이미지 ${i + 1} 다운로드 실패: ${error.message}`);
      continue;
    }
  }
  
  console.log(`[NaverReviewExtractor]      📊 총 ${savedPhotos.length}개 이미지 추출 완료`);
  return savedPhotos;
}

/**
 * 단일 리뷰 데이터 추출
 * @param {object} reviewElement - 리뷰 요소
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호
 * @param {number} reviewIndex - 리뷰 인덱스
 * @returns {Promise<object>} 리뷰 데이터 객체
 */
export async function extractSingleReview(reviewElement, photoFolderPath, currentPage, reviewIndex) {
  console.log(`[NaverReviewExtractor] ⭐ 리뷰 ${reviewIndex + 1} 추출 시작...`);
  
  // 리뷰 점수 추출
  console.log(`[NaverReviewExtractor]   ⭐ 리뷰 점수 추출 중...`);
  const reviewScore = await safeExtractText(reviewElement, [
    'em.n6zq2yy0KA',
    'div.AlfkEF45qI em.n6zq2yy0KA',
    'div.AlfkEF45qI em',
    'em[class*="score"]',
    'em[class*="star"]',
    'em[class*="rating"]',
    'em',
    '.score',
    'span[class*="score"]',
    'span[class*="star"]'
  ], '점수 없음');
  console.log(`[NaverReviewExtractor]   ✅ 리뷰 점수: ${reviewScore}`);
  
  // 리뷰어 이름 추출
  console.log(`[NaverReviewExtractor]   👤 리뷰어 이름 추출 중...`);
  const reviewerName = await safeExtractText(reviewElement, [
    'strong.MX91DFZo2F',
    'div.AlfkEF45qI strong.MX91DFZo2F',
    'div.Db9Dtnf7gY strong.MX91DFZo2F',
    'strong[class*="name"]',
    '.reviewer-name',
    'span[class*="name"]'
  ], '이름 없음');
  console.log(`[NaverReviewExtractor]   ✅ 리뷰어: ${reviewerName}`);
  
  // 리뷰 날짜 추출
  console.log(`[NaverReviewExtractor]   📅 리뷰 날짜 추출 중...`);
  const reviewDate = await safeExtractText(reviewElement, [
    'span.MX91DFZo2F',
    'div.Db9Dtnf7gY span.MX91DFZo2F',
    'div.AlfkEF45qI div.Db9Dtnf7gY span.MX91DFZo2F',
    'span[class*="date"]',
    '.review-date',
    'div[class*="date"]'
  ], '날짜 없음');
  console.log(`[NaverReviewExtractor]   ✅ 리뷰 날짜: ${reviewDate}`);
  
  // 상품 옵션 정보 추출
  console.log(`[NaverReviewExtractor]   🛍️ 상품 옵션 정보 추출 중...`);
  const productName = await safeExtractText(reviewElement, [
    'div.b_caIle8kC',
    'div.AlfkEF45qI div.b_caIle8kC',
    'div[class*="product"]',
    '.product-name',
    'span[class*="product"]'
  ], '정보 없음');
  console.log(`[NaverReviewExtractor]   ✅ 상품 옵션: ${productName}`);
  
  // 리뷰 내용 추출
  console.log(`[NaverReviewExtractor]   📝 리뷰 내용 추출 중...`);
  const content = await extractReviewContent(reviewElement);
  console.log(`[NaverReviewExtractor]   ✅ 리뷰 내용 길이: ${content.length}자`);
  
  // 리뷰 유형 확인
  console.log(`[NaverReviewExtractor]   🏷️ 리뷰 유형 확인 중...`);
  const reviewType = await determineReviewType(reviewElement);
  console.log(`[NaverReviewExtractor]   ✅ 리뷰 유형: ${reviewType}`);
  
  // 리뷰 이미지 추출
  console.log(`[NaverReviewExtractor]   📸 리뷰 이미지 추출 중...`);
  const photos = await extractReviewPhotos(reviewElement, photoFolderPath, currentPage, reviewIndex);
  console.log(`[NaverReviewExtractor]   ✅ 추출된 이미지 수: ${photos.length}개`);
  if (photos.length > 0) {
    console.log(`[NaverReviewExtractor]   📷 이미지 URL들:`, photos);
  }
  
  return {
    'Review Score': reviewScore,
    'Reviewer Name': reviewerName,
    'Review Date': reviewDate,
    'Product(Option) Name': productName,
    'Review Type': reviewType,
    'Content': content,
    'Photos': photos
  };
}

/**
 * 모든 리뷰 추출
 * @param {object} page - Puppeteer page 객체
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호
 * @returns {Promise<Array<object>>} 리뷰 데이터 배열
 */
export async function extractAllReviews(page, photoFolderPath, currentPage = 1) {
  console.log('[NaverReviewExtractor] 모든 리뷰 추출 시작...');
  
  // 리뷰 셀렉터 찾기
  const selector = await findReviewSelector(page);
  
  if (!selector) {
    console.log('[NaverReviewExtractor] ❌ 리뷰 셀렉터를 찾을 수 없습니다.');
    return [];
  }
  
  // 리뷰 요소들 가져오기
  const reviewElements = await page.$$(selector);
  console.log(`[NaverReviewExtractor] ${reviewElements.length}개의 리뷰 요소를 찾았습니다.`);
  
  const reviews = [];
  
  // 각 리뷰 추출
  for (let i = 0; i < reviewElements.length; i++) {
    try {
      const reviewData = await extractSingleReview(reviewElements[i], photoFolderPath, currentPage, i);
      reviews.push(reviewData);
    } catch (e) {
      console.error(`[NaverReviewExtractor] 리뷰 ${i + 1} 추출 실패: ${e.message}`);
      continue;
    }
  }
  
  console.log(`[NaverReviewExtractor] ✅ 총 ${reviews.length}개의 리뷰를 추출했습니다.`);
  return reviews;
}

