/**
 * JSON 저장 관련 유틸리티
 */
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { removeDuplicateReviews, getStorageDirectory } from './common.js';

/**
 * 리뷰 데이터를 JSON 파일로 저장
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @param {string} filename - 저장할 파일명 (확장자 제외)
 * @param {string} customPath - 저장 경로 (선택)
 * @returns {Promise<string>} 저장된 파일 경로
 */
export async function saveReviewsToJson(reviews, filename = 'reviews', customPath = '') {
  try {
    const storageDir = getStorageDirectory(customPath);
    
    console.log(`[JsonStorage] 저장 디렉토리: ${storageDir}`);
    
    // 저장 폴더가 없으면 생성
    try {
      await mkdir(storageDir, { recursive: true });
      console.log(`[JsonStorage] 저장 폴더 생성/확인: ${storageDir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    
    // 중복 제거
    const uniqueReviews = removeDuplicateReviews(reviews);
    
    // 파일명에 타임스탬프 추가
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filepath = join(storageDir, `${filename}_${timestamp}.json`);
    
    // JSON으로 저장
    const jsonData = JSON.stringify(uniqueReviews, null, 2);
    await writeFile(filepath, jsonData, 'utf-8');
    
    console.log(`[JsonStorage] ✅ JSON 저장 완료: ${filepath}`);
    console.log(`[JsonStorage] 저장된 리뷰 수: ${uniqueReviews.length}개`);
    
    return filepath;
  } catch (error) {
    console.error(`[JsonStorage] ❌ JSON 저장 실패: ${error.message}`);
    throw error;
  }
}

