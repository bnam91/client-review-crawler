import puppeteer from 'puppeteer-core';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';

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
 * CDP를 사용하여 크롬 브라우저를 열고 URL로 이동
 */
export async function openUrlInBrowser(url) {
  let browser = null;
  
  try {
    // 크롬 경로 찾기
    const chromePath = await findChromePath();
    
    if (!chromePath) {
      throw new Error('크롬 브라우저를 찾을 수 없습니다. Chrome 또는 Chromium이 설치되어 있는지 확인해주세요.');
    }
    
    console.log('[BrowserService] Chrome path:', chromePath);
    console.log('[BrowserService] Opening URL:', url);
    
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
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    // URL로 이동
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    console.log('[BrowserService] Successfully opened URL:', url);
    
    return {
      success: true,
      message: '브라우저에서 URL을 열었습니다.',
    };
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

