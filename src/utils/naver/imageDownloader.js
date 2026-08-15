/**
 * 리뷰 이미지 다운로드 유틸리티
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * 이미지 URL에서 원본 URL 추출 (네이버 이미지 쿼리 파라미터 제거)
 * @param {string} photoUrl - 이미지 URL
 * @param {boolean} keepQuery - true면 쿼리스트링을 보존 (작게 받기 모드에서 ?type=w480 유지용)
 * @returns {string} 처리된 원본 URL
 */
function getOriginalImageUrl(photoUrl, keepQuery = false) {
  if (!photoUrl) {
    return null;
  }

  // 네이버 이미지 URL에서 파라미터 제거하여 원본 가져오기
  if (photoUrl.includes('pstatic.net')) {
    return keepQuery ? photoUrl : photoUrl.split('?')[0];
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
 * @param {object} options - 추가 옵션
 * @param {boolean} options.keepQuery - true면 쿼리스트링 보존 (작게 받기 모드용, 기본 false)
 * @param {Function} options.onFail - ★실패 «사유»를 호출자에게 넘기는 콜백 (reason:string)
 *   이 함수는 실패해도 null만 돌려주고 사유는 console.error에만 남았다 — 패키징 앱은 devTools가 꺼져 있어
 *   그 로그를 볼 채널 자체가 없다(= 무음 실패). 사유를 밖으로 흘려보내 집계·표기할 수 있게 한다.
 * @returns {Promise<string|null>} 저장된 이미지 파일 경로 또는 null
 */
export async function downloadAndSaveReviewImage(imageUrl, photoFolderPath, currentPage, reviewIndex, photoIndex, options = {}) {
  const reportFail = (reason) => { try { options.onFail?.(reason); } catch {} };
  try {
    console.log(`[ImageDownloader] 이미지 다운로드 시작: ${imageUrl}`);

    // 원본 URL 추출 (작게 받기 모드면 쿼리스트링 유지)
    const originalUrl = getOriginalImageUrl(imageUrl, options.keepQuery === true);
    if (!originalUrl) {
      console.log(`[ImageDownloader] ⚠️ 유효하지 않은 이미지 URL`);
      reportFail('유효하지 않은 이미지 URL');
      return null;
    }
    
    console.log(`[ImageDownloader] 원본 URL: ${originalUrl}`);

    // 파일명 생성: review_page{페이지번호}_{리뷰순서}_photo_{사진순서}.jpg
    const filename = `review_page${currentPage}_${reviewIndex + 1}_photo_${photoIndex + 1}.jpg`;
    const filepath = join(photoFolderPath, filename);

    // 청크 단위 점진 저장 시 중복 다운로드 방지: 이미 존재하면 다운로드 자체를 스킵
    if (existsSync(filepath)) {
      console.log(`[ImageDownloader] ⏭️ 이미 존재하는 이미지, 스킵: ${filepath}`);
      return filepath;
    }

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

    // 파일 저장
    await writeFile(filepath, imageData);
    
    console.log(`[ImageDownloader] ✅ 이미지 저장 완료: ${filepath}`);
    
    return filepath;
  } catch (error) {
    console.error(`[ImageDownloader] ❌ 이미지 다운로드 실패: ${error.message}`);
    reportFail(String((error && error.message) || error));
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

