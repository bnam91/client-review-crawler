import puppeteer from 'puppeteer-core';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';
import { shell } from 'electron';
import { handleNaver } from './naverService.js';
import { handleCoupang } from './coupangService.js';

const execAsync = promisify(exec);

/**
 * 크롬/크롬 브라우저의 실행 경로를 찾는 함수
 */
async function findChromePath() {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    
    for (const path of paths) {
      try {
        await access(path);
        return path;
      } catch {
        continue;
      }
    }
    
    // which 명령어로 찾기
    try {
      const { stdout } = await execAsync('which google-chrome || which chromium || which chromium-browser');
      return stdout.trim() || null;
    } catch {
      return null;
    }
  } else if (platform === 'win32') {
    // Windows
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    
    for (const path of paths) {
      try {
        await access(path);
        return path;
      } catch {
        continue;
      }
    }
    return null;
  } else {
    // Linux
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    
    for (const path of paths) {
      try {
        await access(path);
        return path;
      } catch {
        continue;
      }
    }
    
    // which 명령어로 찾기
    try {
      const { stdout } = await execAsync('which google-chrome-stable || which google-chrome || which chromium || which chromium-browser');
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * 입력값이 URL인지 검색어인지 판단
 */
function isUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * CDP를 사용하여 크롬 브라우저를 열고 URL로 이동
 * @param {string} input - URL 또는 검색어
 * @param {number} platform - 0: 네이버, 1: 쿠팡
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sort - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 * @param {number} pages - 0: 5페이지, 1: 15페이지, 2: 50페이지, 3: 최대, 4: 직접입력
 * @param {number|null} customPages - 직접 입력한 페이지 수 (pages가 4일 때만 사용)
 * @param {string} savePath - 저장 경로 (선택)
 * @param {boolean} openFolder - 크롤링 완료 후 폴더 열기 여부
 */
export async function openUrlInBrowser(input, platform = 0, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', openFolder = false) {
  let browser = null;
  
  try {
    // 크롬 경로 찾기
    const chromePath = await findChromePath();
    
    if (!chromePath) {
      throw new Error('크롬 브라우저를 찾을 수 없습니다. Chrome 또는 Chromium이 설치되어 있는지 확인해주세요.');
    }
    
    console.log('[BrowserService] Chrome path:', chromePath);
    console.log('[BrowserService] Input:', input);
    console.log('[BrowserService] Platform:', platform === 0 ? '네이버' : '쿠팡');
    console.log('[BrowserService] CollectionType:', collectionType === 0 ? '리뷰 수집' : 'Q&A 수집');
    console.log('[BrowserService] Sort:', sort === 0 ? '랭킹순' : sort === 1 ? '최신순' : '평점낮은순');
    console.log('[BrowserService] SavePath:', savePath || '(지정되지 않음)');
    
    // pages 값을 실제 페이지 수로 변환하여 출력
    const pageMap = {
      0: '5페이지',
      1: '15페이지',
      2: '50페이지',
      3: '최대',
      4: '직접입력'
    };
    let maxPages;
    if (pages === 4 && customPages !== null) {
      maxPages = customPages;
      console.log(`[BrowserService] Pages: ${pageMap[pages] || pages} (값: ${pages}, 직접 입력: ${customPages}페이지)`);
    } else {
      maxPages = pages === 3 ? Infinity : (pages === 0 ? 5 : pages === 1 ? 15 : pages === 2 ? 50 : 5);
      console.log(`[BrowserService] Pages: ${pageMap[pages] || pages} (값: ${pages}, 실제: ${maxPages === Infinity ? '무제한' : maxPages}페이지)`);
    }
    
    // puppeteer-core로 브라우저 실행
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false, // 브라우저 창을 표시
      defaultViewport: null,
      args: [
        '--start-maximized', // 최대화된 상태로 시작
        '--disable-blink-features=AutomationControlled', // 자동화 감지 방지
      ],
    });
    
    const browserPages = await browser.pages();
    const page = browserPages[0] || await browser.newPage();
    
    // CDP 클라이언트 생성
    const client = await page.target().createCDPSession();
    
    // CDP를 사용한 자동화 탐지 방지 스크립트 추가
    const antiDetectionScript = `
      // navigator.webdriver 속성 제거
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // window.chrome 객체 추가 (일반 브라우저처럼 보이게)
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
      
      // navigator.plugins 설정
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [];
          for (let i = 0; i < 5; i++) {
            plugins.push({
              0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
              description: 'Portable Document Format',
              filename: 'internal-pdf-viewer',
              length: 1,
              name: 'Chrome PDF Plugin'
            });
          }
          return plugins;
        },
      });
      
      // navigator.languages 설정
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en'],
      });
      
      // navigator.platform 설정
      Object.defineProperty(navigator, 'platform', {
        get: () => 'MacIntel',
      });
      
      // Permission API 오버라이드
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // WebGL Vendor/Renderer 정보 오버라이드
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return getParameter.call(this, parameter);
      };
      
      // Canvas fingerprinting 방지
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      const getImageData = CanvasRenderingContext2D.prototype.getImageData;
      
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        const canvas = this;
        return toBlob.call(canvas, callback, type, quality);
      };
      
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        return toDataURL.call(this, type, quality);
      };
    `;
    
    // CDP를 사용하여 새 문서에 스크립트 추가 (모든 새 페이지에 자동 적용)
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: antiDetectionScript
    });
    
    // CDP를 사용하여 User-Agent 및 언어 설정 오버라이드
    await client.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    
    console.log('[BrowserService] CDP를 사용한 자동화 탐지 방지 설정 완료');
    
    // 입력값이 URL인지 검색어인지 판단
    const inputIsUrl = isUrl(input);
    
    // 플랫폼에 따라 해당 서비스로 위임
    let result;
    if (platform === 1) {
      // 쿠팡 플랫폼 처리
      result = await handleCoupang(browser, page, input, inputIsUrl);
    } else {
      // 네이버 플랫폼 처리 (기본값)
      result = await handleNaver(browser, page, input, inputIsUrl, collectionType, sort, pages, customPages, savePath);
    }
    
    // 크롤링 완료 후 폴더 열기
    if (openFolder && result && result.success && result.savePath) {
      try {
        await shell.openPath(result.savePath);
        console.log('[BrowserService] 폴더 열기 완료:', result.savePath);
      } catch (error) {
        console.error('[BrowserService] 폴더 열기 실패:', error);
      }
    }
    
    return result;
  } catch (error) {
    console.error('[BrowserService] Error:', error);
    return {
      success: false,
      error: error.message || '알 수 없는 오류가 발생했습니다.',
    };
  } finally {
    // 브라우저는 사용자가 직접 닫을 수 있도록 열어둡니다
    // 필요시 주석 해제하여 자동으로 닫을 수 있습니다
    // if (browser) {
    //   await browser.close();
    // }
  }
}

