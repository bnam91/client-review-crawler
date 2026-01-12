/**
 * 리뷰 데이터 저장 메인 모듈
 * config에 따라 적절한 형식으로 저장
 */
import { loadConfig } from './common.js';
import { saveReviewsToJson } from './jsonStorage.js';
import { saveReviewsToExcel, saveQnAToExcel } from './excelStorage.js';
import { saveReviewsToMongoDB } from './mongodbStorage.js';

// 공통 함수들도 export
export { removeDuplicateReviews } from './common.js';

/**
 * Excel만 청크 단위로 저장 (50페이지마다)
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @param {string} filename - 저장할 파일명 (확장자 제외)
 * @param {string} userSavePath - 사용자가 선택한 저장 경로 (우선 사용)
 * @param {number} chunkNumber - 청크 번호 (1부터 시작)
 * @returns {Promise<string>} 저장된 파일 경로
 */
export async function saveReviewsToExcelChunk(reviews, filename = 'reviews', userSavePath = '', chunkNumber = 1) {
  try {
    const config = await loadConfig();
    const storageConfig = config.storage || {};
    
    if (!storageConfig.excel || storageConfig.excel.enabled !== 1) {
      return null;
    }
    
    // 저장 경로 결정: 사용자가 선택한 경로가 있으면 우선 사용, 없으면 config의 path 사용
    const finalSavePath = userSavePath && userSavePath.trim() !== '' ? userSavePath.trim() : '';
    const excelPathToUse = finalSavePath || storageConfig.excel.path || '';
    
    console.log(`[ReviewStorage] Excel 청크 저장 (청크 ${chunkNumber})`);
    const excelPath = await saveReviewsToExcel(reviews, filename, excelPathToUse, chunkNumber);
    
    return excelPath;
  } catch (error) {
    console.error(`[ReviewStorage] Excel 청크 저장 중 오류: ${error.message}`);
    throw error;
  }
}

/**
 * config에 따라 리뷰 데이터를 적절한 형식으로 저장
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @param {string} filename - 저장할 파일명 (확장자 제외)
 * @param {string} userSavePath - 사용자가 선택한 저장 경로 (우선 사용)
 * @returns {Promise<Array<string>>} 저장된 파일 경로 배열
 */
export async function saveReviews(reviews, filename = 'reviews', userSavePath = '') {
  const savedPaths = [];
  
  try {
    const config = await loadConfig();
    const storageConfig = config.storage || {};
    
    // 저장 경로 결정: 사용자가 선택한 경로가 있으면 우선 사용, 없으면 config의 path 사용
    const finalSavePath = userSavePath && userSavePath.trim() !== '' ? userSavePath.trim() : '';
    console.log(`[ReviewStorage] 사용자 선택 경로: ${finalSavePath || '(없음)'}`);
    
    // JSON 저장
    if (storageConfig.json && storageConfig.json.enabled === 1) {
      try {
        // 사용자가 선택한 경로가 있으면 사용, 없으면 config의 path 사용
        const jsonPathToUse = finalSavePath || storageConfig.json.path || '';
        console.log(`[ReviewStorage] JSON 저장 경로: ${jsonPathToUse || '(기본 results 폴더)'}`);
        const jsonPath = await saveReviewsToJson(reviews, filename, jsonPathToUse);
        if (jsonPath) {
          savedPaths.push(jsonPath);
        }
      } catch (error) {
        console.error(`[ReviewStorage] JSON 저장 중 오류: ${error.message}`);
      }
    }
    
    // Excel 저장 (QnA 데이터인 경우)
    // QnA 데이터는 threadId, messages 구조를 가지고 있음
    const isQnAData = reviews.length > 0 && reviews[0] && (reviews[0].threadId !== undefined || reviews[0].messages !== undefined);
    
    if (isQnAData && storageConfig.excel && storageConfig.excel.enabled === 1) {
      try {
        const excelPathToUse = finalSavePath || storageConfig.excel.path || '';
        console.log(`[ReviewStorage] QnA Excel 저장 경로: ${excelPathToUse || '(기본 results 폴더)'}`);
        const excelPath = await saveQnAToExcel(reviews, filename, excelPathToUse);
        if (excelPath) {
          savedPaths.push(excelPath);
        }
      } catch (error) {
        console.error(`[ReviewStorage] QnA Excel 저장 중 오류: ${error.message}`);
      }
    }
    
    // 리뷰 데이터의 Excel 저장은 청크로 저장되지 않은 경우에만, 일반적으로는 청크로 저장됨
    // Excel은 naverService.js에서 청크 단위로 직접 저장됨
    
    // MongoDB 저장
    if (storageConfig.mongodb && storageConfig.mongodb.enabled === 1) {
      try {
        const mongoUri = storageConfig.mongodb.uri || '';
        console.log(`[ReviewStorage] MongoDB 저장 URI: ${mongoUri || '(지정되지 않음)'}`);
        const mongoSuccess = await saveReviewsToMongoDB(reviews, filename, mongoUri);
        if (mongoSuccess) {
          savedPaths.push('mongodb://...');
        }
      } catch (error) {
        console.error(`[ReviewStorage] MongoDB 저장 중 오류: ${error.message}`);
      }
    }
    
    return savedPaths;
  } catch (error) {
    console.error(`[ReviewStorage] ❌ 저장 중 오류: ${error.message}`);
    throw error;
  }
}

