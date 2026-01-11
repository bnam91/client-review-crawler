import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDevMode } from './electron/dev.js';
import { openUrlInBrowser } from './electron/services/browserService.js';
import updater from 'electron-updater';
import log from 'electron-log';

const { autoUpdater } = updater;
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let devTools = null;
const isDev = process.env.NODE_ENV === 'development';

// 로그 설정
log.transports.file.level = 'info';
autoUpdater.logger = log;

// package.json에서 GitHub 정보 읽어오기
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

// 현재 앱 버전 정보 출력
console.log('\n========================================');
console.log('📦 앱 정보');
console.log('========================================');
console.log(`이름: ${packageJson.name}`);
console.log(`현재 버전: ${packageJson.version}`);
console.log(`플랫폼: ${process.platform}`);
console.log(`개발 모드: ${isDev ? '예' : '아니오'}`);
console.log('========================================\n');

if (packageJson.build && packageJson.build.publish) {
  const { owner, repo } = packageJson.build.publish;
  
  // GitHub 설정 검증
  if (owner === '입력해주세요' || repo === '입력해주세요' || !owner || !repo) {
    console.log('⚠️  GitHub 릴리즈 설정이 완료되지 않았습니다.');
    console.log('   package.json의 build.publish.owner와 build.publish.repo를 설정하세요.');
    console.log(`   현재 설정: Owner="${owner}", Repo="${repo}"\n`);
  } else {
    console.log(`🔗 GitHub 릴리즈 설정:`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Repo: ${repo}`);
    console.log(`   URL: https://github.com/${owner}/${repo}/releases\n`);
    
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: owner,
      repo: repo
    });
  }
} else {
  console.log('⚠️  GitHub 릴리즈 설정이 없습니다. package.json의 build.publish를 확인하세요.\n');
}

// 개발 환경 및 macOS에서는 업데이트 체크 비활성화
if (isDev || process.argv.includes('--dev') || process.platform === 'darwin') {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 480,
    // maxWidth: 450,
    title: 'Electron Review Crawler',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 개발 모드 초기화
  if (isDev) {
    devTools = initDevMode(mainWindow);
  }
  
  // 로컬 파일 로드
    mainWindow.loadFile(join(__dirname, 'renderer/index.html'));

  // 업데이트 체크 (앱 시작 후 3초 뒤)
  // 개발 모드에서는 강제로 체크 가능 (테스트용)
  const shouldCheckUpdates = !isDev && !process.argv.includes('--dev') && process.platform !== 'darwin';
  const forceCheckInDev = isDev && process.argv.includes('--force-update-check');
  
  if (shouldCheckUpdates || forceCheckInDev) {
    if (forceCheckInDev) {
      console.log('🧪 개발 모드: 강제 업데이트 체크 모드 (--force-update-check)\n');
    } else {
      console.log('⏳ 3초 후 자동 업데이트 체크를 시작합니다...\n');
    }
    setTimeout(() => {
      checkForUpdates();
    }, 3000);
  } else {
    if (isDev || process.argv.includes('--dev')) {
      console.log('ℹ️  개발 모드에서는 자동 업데이트 체크가 비활성화되어 있습니다.');
      console.log('   테스트하려면: npm start -- --force-update-check\n');
    } else if (process.platform === 'darwin') {
      console.log('ℹ️  macOS에서는 자동 업데이트가 지원되지 않습니다.');
      console.log('   테스트하려면: npm start -- --force-update-check\n');
    }
  }

  mainWindow.on('closed', () => {
    // 개발 모드 정리
    if (devTools) {
      devTools.cleanup();
      devTools = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // IPC 핸들러 등록
  ipcMain.handle('select-folder', async () => {
    console.log('[Main] select-folder IPC handler called');
    const window = BrowserWindow.getFocusedWindow() || mainWindow;
    console.log('[Main] Window:', window ? 'found' : 'not found');
    
    if (!window) {
      console.error('[Main] No window available');
      return null;
    }
    
    try {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        title: '저장 경로 선택'
      });
      
      console.log('[Main] Dialog result:', result);
      
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    } catch (error) {
      console.error('[Main] Dialog error:', error);
      throw error;
    }
  });

  // 브라우저에서 URL 열기 핸들러
  ipcMain.handle('open-url-in-browser', async (event, url) => {
    console.log('[Main] open-url-in-browser IPC handler called with URL:', url);
    try {
      const result = await openUrlInBrowser(url);
      console.log('[Main] Browser service result:', result);
      return result;
    } catch (error) {
      console.error('[Main] Browser service error:', error);
      return {
        success: false,
        error: error.message || '알 수 없는 오류가 발생했습니다.',
      };
    }
  });

  // 업데이트 관련 IPC 핸들러
  // 수동 업데이트 체크 (개발 모드에서는 강제로 가능)
  ipcMain.on('check-for-updates', () => {
    const canCheck = process.platform !== 'darwin' && !isDev;
    const forceCheck = isDev || process.argv.includes('--force-update-check');
    
    if (canCheck || forceCheck) {
      if (forceCheck) {
        console.log('🧪 수동 업데이트 체크 요청 (강제 모드)\n');
      }
      checkForUpdates();
    } else {
      console.log('⚠️  macOS에서는 자동 업데이트가 지원되지 않습니다.');
      console.log('   테스트하려면: npm start -- --force-update-check\n');
    }
  });

  // 업데이트 설치 및 재시작
  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
  });
  
  console.log('[Main] IPC handlers registered');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 업데이트 체크 함수
function checkForUpdates() {
  // GitHub 설정 확인
  if (!packageJson.build || !packageJson.build.publish) {
    console.log('❌ 업데이트 체크 실패: GitHub 릴리즈 설정이 없습니다.\n');
    return;
  }
  
  const { owner, repo } = packageJson.build.publish;
  if (owner === '입력해주세요' || repo === '입력해주세요' || !owner || !repo) {
    console.log('❌ 업데이트 체크 실패: GitHub 릴리즈 설정이 완료되지 않았습니다.');
    console.log('   package.json의 build.publish.owner와 build.publish.repo를 설정하세요.\n');
    return;
  }
  
  console.log('🔍 업데이트 확인 중...');
  console.log(`   현재 버전: ${packageJson.version}`);
  console.log(`   GitHub: ${owner}/${repo}`);
  autoUpdater.checkForUpdates();
}

// 업데이트 이벤트 핸들러
autoUpdater.on('checking-for-update', () => {
  console.log('   GitHub 릴리즈 정보 확인 중...');
  log.info('업데이트 확인 중...');
  sendStatusToWindow('checking-for-update');
});

autoUpdater.on('update-available', (info) => {
  console.log('\n✨ ========================================');
  console.log('   새로운 업데이트 발견!');
  console.log('========================================');
  console.log(`   현재 버전: ${packageJson.version}`);
  console.log(`   최신 버전: ${info.version}`);
  console.log(`   릴리즈 날짜: ${info.releaseDate || '정보 없음'}`);
  console.log('========================================\n');
  log.info('업데이트 발견:', info.version);
  sendStatusToWindow('update-available', info);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('\n✅ ========================================');
  console.log('   최신 버전입니다!');
  console.log('========================================');
  console.log(`   현재 버전: ${packageJson.version}`);
  console.log(`   최신 버전: ${info.version || packageJson.version}`);
  console.log('========================================\n');
  log.info('최신 버전입니다');
  sendStatusToWindow('update-not-available', info);
});

autoUpdater.on('error', (err) => {
  console.log('\n❌ ========================================');
  console.log('   업데이트 체크 오류 발생');
  console.log('========================================');
  console.log(`   오류 메시지: ${err.message || err.toString()}`);
  console.log('========================================\n');
  log.error('업데이트 중 오류 발생:', err);
  sendStatusToWindow('error', err.toString());
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  const transferredMB = (progressObj.transferred / 1024 / 1024).toFixed(2);
  const totalMB = (progressObj.total / 1024 / 1024).toFixed(2);
  const speedMB = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2);
  
  // 진행률이 10% 단위로 변경될 때만 출력 (너무 많이 출력되지 않도록)
  if (percent % 10 === 0 || percent === 100) {
    console.log(`📥 다운로드 진행: ${percent}% (${transferredMB}MB / ${totalMB}MB) - 속도: ${speedMB}MB/s`);
  }
  
  let log_message = "다운로드 속도: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - 다운로드 ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  log.info(log_message);
  sendStatusToWindow('download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('\n🎉 ========================================');
  console.log('   업데이트 다운로드 완료!');
  console.log('========================================');
  console.log(`   버전: ${info.version}`);
  console.log('   설치 준비가 완료되었습니다.');
  console.log('========================================\n');
  log.info('업데이트 다운로드 완료');
  sendStatusToWindow('update-downloaded', info);
});

// 렌더러에 업데이트 상태 전송
function sendStatusToWindow(status, data) {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status, data });
  }
}
