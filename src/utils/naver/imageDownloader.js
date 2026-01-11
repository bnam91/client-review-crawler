/**
 * 리뷰 이미지 다운로드 유틸리티
 */
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * 이미지 URL에서 원본 URL 추출 (네이버 이미지 쿼리 파라미터 제거)
 * @param {string} photoUrl - 이미지 URL
 * @returns {string} 처리된 원본 URL
 */
function getOriginalImageUrl(photoUrl) {
  if (!photoUrl) {
    return null;
  }
  
  // 네이버 이미지 URL에서 파라미터 제거하여 원본 가져오기
  if (photoUrl.includes('pstatic.net')) {
    return photoUrl.split('?')[0];
  }
  
  return photoUrl;
}

/**
 * HTTP/HTTPS로 이미지 다운로드
 * @param {string} imageUrl - 이미지 URL
 * @param {number} timeout - 타임아웃 (밀리초, 기본값 10000)
 * @returns {Promise<Buffer>} 이미지 데이터
 */
function downloadImage(imageUrl, timeout = 10000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(imageUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      
      const request = protocol.get(url.href, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        
        response.on('error', (error) => {
          reject(error);
        });
      });
      
      request.on('error', (error) => {
        reject(error);
      });
      
      request.setTimeout(timeout, () => {
        request.destroy();
        reject(new Error('이미지 다운로드 타임아웃'));
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 리뷰 이미지를 다운로드하고 저장
 * @param {string} imageUrl - 이미지 URL
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호
 * @param {number} reviewIndex - 리뷰 인덱스 (0부터 시작)
 * @param {number} photoIndex - 사진 인덱스 (0부터 시작)
 * @returns {Promise<string|null>} 저장된 이미지 파일 경로 또는 null
 */
export async function downloadAndSaveReviewImage(imageUrl, photoFolderPath, currentPage, reviewIndex, photoIndex) {
  try {
    console.log(`[ImageDownloader] 이미지 다운로드 시작: ${imageUrl}`);
    
    // 원본 URL 추출
    const originalUrl = getOriginalImageUrl(imageUrl);
    if (!originalUrl) {
      console.log(`[ImageDownloader] ⚠️ 유효하지 않은 이미지 URL`);
      return null;
    }
    
    console.log(`[ImageDownloader] 원본 URL: ${originalUrl}`);
    
    // 이미지 다운로드
    const imageData = await downloadImage(originalUrl, 10000);
    
    // 저장 폴더가 없으면 생성
    try {
      await mkdir(photoFolderPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    
    // 파일명 생성: review_page{페이지번호}_{리뷰순서}_photo_{사진순서}.jpg
    const filename = `review_page${currentPage}_${reviewIndex + 1}_photo_${photoIndex + 1}.jpg`;
    const filepath = join(photoFolderPath, filename);
    
    // 파일 저장
    await writeFile(filepath, imageData);
    
    console.log(`[ImageDownloader] ✅ 이미지 저장 완료: ${filepath}`);
    
    return filepath;
  } catch (error) {
    console.error(`[ImageDownloader] ❌ 이미지 다운로드 실패: ${error.message}`);
    return null;
  }
}

/**
 * 여러 이미지를 다운로드하고 저장
 * @param {Array<string>} imageUrls - 이미지 URL 배열
 * @param {string} photoFolderPath - 이미지 저장 폴더 경로
 * @param {number} currentPage - 현재 페이지 번호
 * @param {number} reviewIndex - 리뷰 인덱스 (0부터 시작)
 * @returns {Promise<Array<string>>} 저장된 이미지 파일 경로 배열
 */
export async function downloadAndSaveReviewImages(imageUrls, photoFolderPath, currentPage, reviewIndex) {
  const savedPaths = [];
  
  if (!imageUrls || imageUrls.length === 0) {
    return savedPaths;
  }
  
  console.log(`[ImageDownloader] 📸 리뷰 이미지 ${imageUrls.length}개 다운로드 시작...`);
  
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      console.log(`[ImageDownloader] 🖼️ 이미지 ${i + 1}/${imageUrls.length} 처리 중...`);
      const savedPath = await downloadAndSaveReviewImage(
        imageUrls[i],
        photoFolderPath,
        currentPage,
        reviewIndex,
        i
      );
      
      if (savedPath) {
        savedPaths.push(savedPath);
        console.log(`[ImageDownloader] ✅ 이미지 ${i + 1} 처리 완료`);
      } else {
        console.log(`[ImageDownloader] ⚠️ 이미지 ${i + 1} 다운로드 실패`);
      }
    } catch (error) {
      console.error(`[ImageDownloader] ❌ 이미지 ${i + 1} 다운로드 중 오류: ${error.message}`);
      continue;
    }
  }
  
  console.log(`[ImageDownloader] 📊 총 ${savedPaths.length}개 이미지 다운로드 완료`);
  return savedPaths;
}

