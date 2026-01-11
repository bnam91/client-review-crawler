/**
 * 저장 관련 공통 유틸리티
 */
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from '../../../../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 리뷰 데이터의 중복 키 생성
 * @param {object} review - 리뷰 데이터 객체
 * @returns {string} 중복 체크용 키
 */
function createReviewKey(review) {
  const reviewerName = review['Reviewer Name'] || '';
  const reviewDate = review['Review Date'] || '';
  const reviewScore = review['Review Score'] || '';
  const content = review['Content'] || '';
  
  return `${reviewerName}|${reviewDate}|${reviewScore}|${content}`;
}

/**
 * 리뷰 데이터 중복 제거
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @returns {Array<object>} 중복 제거된 리뷰 데이터 배열
 */
export function removeDuplicateReviews(reviews) {
  const seen = new Set();
  const uniqueReviews = [];
  
  for (const review of reviews) {
    const key = createReviewKey(review);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueReviews.push(review);
    }
  }
  
  console.log(`[ReviewStorage] 중복 제거: ${reviews.length}개 → ${uniqueReviews.length}개`);
  return uniqueReviews;
}

/**
 * config.js 파일에서 설정 가져오기
 * @returns {object} config 객체
 */
export function loadConfig() {
  try {
    return config;
  } catch (error) {
    console.error(`[ReviewStorage] ❌ config.js 읽기 실패: ${error.message}`);
    // 기본값 반환
    return {
      storage: {
        json: { enabled: 1, path: '' },
        excel: { enabled: 0, path: '' },
        mongodb: { enabled: 0, uri: '' }
      }
    };
  }
}

/**
 * 저장 경로 결정 (config의 path가 있으면 사용, 없으면 results 폴더)
 * @param {string} customPath - 사용자가 선택한 경로 또는 config에서 지정한 경로
 * @returns {string} 저장할 디렉토리 경로
 */
export function getStorageDirectory(customPath) {
  const projectRoot = join(__dirname, '../../../../..');
  
  if (customPath && customPath.trim() !== '') {
    // 사용자가 선택한 경로가 있으면, 그 경로에 results 폴더를 만들어서 저장
    const userPath = customPath.trim();
    return join(userPath, 'results');
  }
  
  // 경로가 없으면 기본 results 폴더 사용
  return join(projectRoot, 'results');
}

