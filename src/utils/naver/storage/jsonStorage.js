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
    
    // 각 리뷰에 Page_Review 필드 추가 (엑셀과 동일하게)
    const reviewsWithPageReview = uniqueReviews.map(review => {
      // Page_Review 컬럼 값 생성 (이미지 파일명에서 페이지 정보 추출)
      let pageReview = '';
      if (Array.isArray(review.Photos) && review.Photos.length > 0) {
        const firstPhoto = review.Photos[0];
        // 파일명 형식: review_page{페이지번호}_{리뷰순서}_photo_{사진순서}.jpg
        const match = firstPhoto.match(/review_page(\d+)_(\d+)_photo_/);
        if (match) {
          pageReview = `${match[1]}_${match[2]}`;
        }
      } else if (typeof review.Photos === 'string' && review.Photos.trim() !== '') {
        const paths = review.Photos.split(',').map(p => p.trim()).filter(p => p);
        if (paths.length > 0) {
          const match = paths[0].match(/review_page(\d+)_(\d+)_photo_/);
          if (match) {
            pageReview = `${match[1]}_${match[2]}`;
          }
        }
      }
      
      // Page_Review 필드를 맨 앞에 추가
      return {
        'Page_Review': pageReview,
        ...review
      };
    });
    
    // 파일명에 타임스탬프 추가
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filepath = join(storageDir, `${filename}_${timestamp}.json`);
    
    // JSON으로 저장
    const jsonData = JSON.stringify(reviewsWithPageReview, null, 2);
    await writeFile(filepath, jsonData, 'utf-8');
    
    console.log(`[JsonStorage] ✅ JSON 저장 완료: ${filepath}`);
    console.log(`[JsonStorage] 저장된 리뷰 수: ${uniqueReviews.length}개`);
    
    return filepath;
  } catch (error) {
    console.error(`[JsonStorage] ❌ JSON 저장 실패: ${error.message}`);
    throw error;
  }
}

