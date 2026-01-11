import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDevMode } from './electron/dev.js';
import { openUrlInBrowser } from './electron/services/browserService.js';
import updater from 'electron-updater';
import log from 'electron-log';

const { autoUpdater } = updater;
import { readFileSync } from 'fs';
import https from 'https';

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
    
    // 개발 모드에서도 업데이트 체크 가능하도록 설정
    if (isDev || process.argv.includes('--dev') || !app.isPackaged) {
      // 개발 모드에서 강제로 체크 가능하도록 설정
      autoUpdater.forceDevUpdateConfig = true;
      // 업데이트 체크를 강제로 활성화
      autoUpdater.allowPrerelease = false;
      // 개발 모드에서도 체크 가능하도록 업데이트 설정 경로 명시
      try {
        autoUpdater.updateConfigPath = join(__dirname, 'dev-app-update.yml');
      } catch (e) {
        // 설정 실패해도 계속 진행
      }
    }
  }
} else {
  console.log('⚠️  GitHub 릴리즈 설정이 없습니다. package.json의 build.publish를 확인하세요.\n');
}

// 개발 환경에서는 자동 다운로드 비활성화
// macOS에서는 자동 다운로드만 비활성화 (체크는 가능)
if (isDev || process.argv.includes('--dev')) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // 개발 모드에서도 업데이트 체크 가능하도록 설정
  autoUpdater.forceDevUpdateConfig = true;
} else if (process.platform === 'darwin') {
  // macOS에서는 자동 다운로드 비활성화 (수동 다운로드는 가능)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 480,
    // maxWidth: 450,
    title: 'review-crawler',
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
  // 개발 모드에서도 강제로 체크 가능하도록 설정됨
  console.log('⏳ 3초 후 자동 업데이트 체크를 시작합니다...\n');
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

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

  // 브라우저에서 URL 열기 핸들러 (플랫폼 정보 및 수집 타입 포함)
  ipcMain.handle('open-url-in-browser', async (event, url, platform = 0, collectionType = 0) => {
    console.log('[Main] open-url-in-browser IPC handler called with URL:', url, 'Platform:', platform, 'CollectionType:', collectionType);
    try {
      const result = await openUrlInBrowser(url, platform, collectionType);
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
  // 수동 업데이트 체크 (모든 플랫폼에서 가능)
  ipcMain.on('check-for-updates', () => {
    console.log('🔍 수동 업데이트 체크 요청\n');
    checkForUpdates();
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

// 개발 모드에서 GitHub API로 직접 버전 확인 (fallback)
async function checkVersionViaAPI(owner, repo) {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    https.get(url, {
      headers: {
        'User-Agent': 'review-crawler',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          resolve({
            tag_name: release.tag_name,
            html_url: release.html_url,
            assets: release.assets || []
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 업데이트 체크 함수
async function checkForUpdates() {
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
  
  // 개발 모드이고 패키징되지 않은 경우, GitHub API로 직접 확인
  if ((isDev || !app.isPackaged) && process.env.USE_API_CHECK !== 'false') {
    try {
      console.log('   (개발 모드: GitHub API로 직접 확인)\n');
      const releaseInfo = await checkVersionViaAPI(owner, repo);
      const currentVersion = `v${packageJson.version}`;
      const latestTag = releaseInfo.tag_name;
      
      if (latestTag && latestTag !== currentVersion) {
        console.log('\n✨ ========================================');
        console.log('   새로운 업데이트 발견!');
        console.log('========================================');
        console.log(`   현재 버전: ${currentVersion}`);
        console.log(`   최신 버전: ${latestTag}`);
        console.log(`   릴리즈 페이지: ${releaseInfo.html_url}`);
        console.log('========================================');
        console.log('   ⚠️  개발 모드에서는 자동 업데이트가 불가능합니다.');
        console.log('   릴리즈 페이지에서 수동으로 다운로드하세요.\n');
        
        if (mainWindow) {
          mainWindow.webContents.send('update-status', {
            status: 'update-available',
            data: { 
              version: latestTag,
              releaseUrl: releaseInfo.html_url,
              isDevMode: true
            }
          });
        }
      } else {
        console.log('\n✅ ========================================');
        console.log('   최신 버전입니다!');
        console.log('========================================');
        console.log(`   현재 버전: ${currentVersion}`);
        console.log(`   최신 버전: ${latestTag || currentVersion}`);
        console.log('========================================\n');
        
        if (mainWindow) {
          mainWindow.webContents.send('update-status', {
            status: 'update-not-available',
            data: { version: latestTag || currentVersion }
          });
        }
      }
    } catch (error) {
      console.log(`\n⚠️  GitHub API 확인 실패: ${error.message}`);
      console.log('   electron-updater로 재시도합니다...\n');
      // API 실패 시 electron-updater로 재시도
      autoUpdater.checkForUpdates();
    }
  } else {
    // 프로덕션 모드 또는 패키징된 앱에서는 electron-updater 사용
    autoUpdater.checkForUpdates();
  }
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
