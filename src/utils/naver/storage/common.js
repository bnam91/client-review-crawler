/**
 * 저장 관련 공통 유틸리티
 */
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const defaultConfig = {
  storage: {
    json: { enabled: 1, path: '' },
    excel: { enabled: 1, path: '' },
    mongodb: { enabled: 0, uri: '' }
  }
};

/**
 * 리뷰 데이터의 중복 키 생성
 * @param {object} review - 리뷰 데이터 객체
 * @returns {string} 중복 체크용 키
 */
function createReviewKey(review) {
  // 리뷰 데이터 구조인지 확인
  if (review['Reviewer Name'] !== undefined || review['Review Date'] !== undefined) {
    const reviewerName = review['Reviewer Name'] || '';
    const reviewDate = review['Review Date'] || '';
    const reviewScore = review['Review Score'] || '';
    const content = review['Content'] || '';
    
    return `${reviewerName}|${reviewDate}|${reviewScore}|${content}`;
  }
  
  // 새로운 형식의 QnA 데이터 구조인지 확인 (threadId, status, messages)
  if (review['threadId'] !== undefined || review['messages'] !== undefined) {
    const threadId = review['threadId'] || '';
    const status = review['status'] || '';
    // messages 배열의 내용으로 키 생성
    const messagesKey = Array.isArray(review['messages']) 
      ? review['messages'].map(msg => `${msg.type}|${msg.author}|${msg.date}|${msg.content}`).join('||')
      : '';
    
    return `${threadId}|${status}|${messagesKey}`;
  }
  
  // 기존 형식의 QnA 데이터 구조인지 확인
  if (review['answerStatus'] !== undefined || review['title'] !== undefined) {
    const title = review['title'] || '';
    const author = review['author'] || '';
    const date = review['date'] || '';
    const question = review['question'] || '';
    const answer = review['answer'] || '';
    const answerAuthor = review['answerAuthor'] || '';
    const answerDate = review['answerDate'] || '';
    
    return `${title}|${author}|${date}|${question}|${answer}|${answerAuthor}|${answerDate}`;
  }
  
  // 알 수 없는 구조인 경우 모든 필드를 문자열로 변환하여 키 생성
  const keys = Object.keys(review).sort();
  const values = keys.map(key => String(review[key] || ''));
  return values.join('|');
}

/**
 * 리뷰 데이터 중복 제거
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @returns {Array<object>} 중복 제거된 리뷰 데이터 배열
 */
export function removeDuplicateReviews(reviews) {
  if (!reviews || reviews.length === 0) {
    return reviews;
  }
  
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
export async function loadConfig() {
  try {
    const configPath = join(__dirname, '../../../../config.js');
    // 우선 ESM import 시도
    try {
      const imported = await import(pathToFileURL(configPath).href);
      const cfg = imported?.config || imported?.default;
      if (cfg) return cfg;
    } catch (e) {
      // fallback to require (CJS)
      try {
        const loaded = require(configPath);
        if (loaded?.config || loaded) return loaded.config || loaded;
      } catch (e2) {
        console.error(`[ReviewStorage] ❌ config.js require 실패: ${e2.message}`);
      }
    }
    // 모두 실패 시 기본값
    return defaultConfig;
  } catch (error) {
    console.error(`[ReviewStorage] ❌ config.js 읽기 실패: ${error.message}`);
    return defaultConfig;
  }
}

// 세션별 폴더명 캐시 (같은 크롤링 세션에서는 같은 폴더명 사용)
let sessionFolderName = null;

/**
 * 세션별 폴더명 생성 (크롤링 시작 시 한 번만 생성)
 * @returns {string} results_{날짜및시간} 형식의 폴더명
 */
function generateSessionFolderName() {
  if (sessionFolderName) {
    return sessionFolderName;
  }
  
  // 날짜/시간 형식 생성 (YYYYMMDD_HHMMSS)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const dateTimeStr = `${year}${month}${date}_${hours}${minutes}${seconds}`;
  sessionFolderName = `results_${dateTimeStr}`;
  
  return sessionFolderName;
}

/**
 * 세션 폴더명 초기화 (새 크롤링 시작 시 호출)
 */
export function resetSessionFolderName() {
  sessionFolderName = null;
}

/**
 * 저장 경로 결정 (config의 path가 있으면 사용, 없으면 results 폴더)
 * @param {string} customPath - 사용자가 선택한 경로 또는 config에서 지정한 경로
 * @returns {string} 저장할 디렉토리 경로
 */
export function getStorageDirectory(customPath) {
  const projectRoot = join(__dirname, '../../../../..');
  
  // 세션별 폴더명 생성 (같은 세션에서는 같은 폴더명 사용)
  const folderName = generateSessionFolderName();
  
  if (customPath && customPath.trim() !== '') {
    // 사용자가 선택한 경로가 있으면, 그 경로에 results_{날짜및시간} 폴더를 만들어서 저장
    const userPath = customPath.trim();
    return join(userPath, folderName);
  }
  
  // 경로가 없으면 기본 results_{날짜및시간} 폴더 사용
  return join(projectRoot, folderName);
}

