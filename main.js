import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDevMode } from './electron/dev.js';
import { findUserByIp, registerLicense, updateIpAlias, removeIp, updateUserName, createLicenseKey, listLicenseKeys, closeLicenseClient } from './electron/services/licenseService.js';
import { openUrlInBrowser } from './electron/services/browserService.js';
import updater from 'electron-updater';
import log from 'electron-log';

const { autoUpdater } = updater;
import { readFileSync, existsSync } from 'fs';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// sharp 라이브러리 경로 설정 (빌드된 앱에서 필요)
// 앱이 시작되기 전에 라이브러리 경로를 설정해야 함
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'development') {
  if (process.platform === 'darwin') {
    const libvipsPathArm64 = join(__dirname, 'node_modules', '@img', 'sharp-libvips-darwin-arm64', 'lib');
    const libvipsPathX64 = join(__dirname, 'node_modules', '@img', 'sharp-libvips-darwin-x64', 'lib');
    
    // DYLD_LIBRARY_PATH에 추가 (macOS)
    const currentLibPath = process.env.DYLD_LIBRARY_PATH || '';
    const newLibPath = [libvipsPathArm64, libvipsPathX64, currentLibPath].filter(Boolean).join(':');
    process.env.DYLD_LIBRARY_PATH = newLibPath;
    
    console.log('[Sharp] 라이브러리 경로 설정:', newLibPath);
  }
}

let mainWindow;
let devTools = null;
const isDev = process.env.NODE_ENV === 'development';

// 로그 설정
log.transports.file.level = 'info';
autoUpdater.logger = log;

// package.json에서 앱 이름/버전 읽어오기
// ⚠️ 주의: electron-builder는 패키징 시 package.json에서 "build" 키를 «제거»한다.
//         따라서 런타임에 packageJson.build.publish를 읽으면 패키징된 앱에서는 항상 undefined다.
//         (v1.6.9 패키징 바이너리 실측: "⚠️ GitHub 릴리즈 설정이 없습니다." → 업데이트 체크 자체가 막힘)
//         → GitHub owner/repo는 아래 소스 상수를 쓰고, 빌드설정은 런타임에 읽지 않는다.
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

// GitHub 릴리즈 정보 (소스 상수 — package.json.build.publish와 «수동 동기화» 필요)
const GITHUB_OWNER = 'bnam91';
const GITHUB_REPO = 'client-review-crawler';

// 현재 앱 버전 정보 출력
console.log('\n========================================');
console.log('📦 앱 정보');
console.log('========================================');
console.log(`이름: ${packageJson.name}`);
console.log(`현재 버전: ${packageJson.version}`);
console.log(`플랫폼: ${process.platform}`);
console.log(`개발 모드: ${isDev ? '예' : '아니오'}`);
console.log('========================================\n');

console.log(`🔗 GitHub 릴리즈 설정:`);
console.log(`   Owner: ${GITHUB_OWNER}`);
console.log(`   Repo: ${GITHUB_REPO}`);
console.log(`   URL: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);

if (app.isPackaged) {
  // 패키징된 앱: Contents/Resources/app-update.yml(electron-builder가 생성)을 우선 사용한다.
  // setFeedURL로 덮어쓰지 않는다 — updaterCacheDirName 등 yml의 다른 필드까지 잃게 된다.
  const packagedUpdateConfig = join(process.resourcesPath, 'app-update.yml');
  if (existsSync(packagedUpdateConfig)) {
    console.log(`   업데이트 설정 소스: app-update.yml (패키징 앱)\n`);
  } else {
    // 안전망: dir 타겟 등 app-update.yml이 없는 빌드에서도 업데이트 체크가 죽지 않도록 피드를 직접 지정
    console.log(`   ⚠️  app-update.yml 없음 → setFeedURL로 대체 (${packagedUpdateConfig})\n`);
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO
    });
  }
} else {
  // 개발 모드(패키징 안 됨): app-update.yml이 없으므로 피드를 코드에서 지정한다.
  console.log(`   업데이트 설정 소스: setFeedURL (개발 모드)\n`);
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO
  });
  // 개발 모드에서도 electron-updater 폴백이 동작하도록 설정
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.allowPrerelease = false;
  const devUpdateConfig = join(__dirname, 'dev-app-update.yml');
  if (existsSync(devUpdateConfig)) {
    autoUpdater.updateConfigPath = devUpdateConfig;
  }
}

// ★자동 다운로드/설치 — «맥만» 켠다 (2026-08-16 현빈 지시)
//
// 원래 끈 이유(2026-04-30, v1.6.7): macOS unsigned 빌드는 Squirrel.Mac이 코드서명을 검증하는
//   단계에서 자동업데이트가 실패했다. 그래서 D 옵션(자체 알림 + 외부 링크)으로 낮췄다.
// ⇒ ★그 전제가 사라졌다: 2026-07-08 Developer ID 서명 + 공증이 붙었고, v1.7.0도 서명·공증본이다.
//   맥은 이제 Squirrel.Mac 검증을 통과할 수 있으므로 자동 다운로드·설치를 켠다.
//
// ★2026-08-19: 윈도우도 «다운로드까지는» 자동으로 바꿨다 (현빈 승인).
//   전에는 윈도우가 「알림 + 드라이브 링크」뿐이라, 고객이 브라우저를 열고 폴더를 찾아
//   169MB를 직접 받아야 했다. 받는 일은 앱이 해도 «안전하다» — 설치와 달리 되돌릴 게 없다.
//
// ⛔단, 자동 «설치»(autoInstallOnAppQuit)는 윈도우에서 켜지 않는다.
//   코드서명 인증서가 없어 설치 실행 시 SmartScreen이 붙는다. 사용자가 «보고 누르는» 순간이
//   있어야 그 경고를 넘길 수 있고, 앱이 종료할 때 몰래 설치를 시도하면 조용히 실패한다.
//   ⇒ 다운로드는 자동, 설치는 «사용자 클릭». 맥은 서명·공증이 있으므로 종전대로 완전 자동.
const AUTO_DOWNLOAD_PLATFORMS = ['darwin', 'win32'];   // 내려받기 — 맥·윈도우 둘 다
const AUTO_INSTALL_PLATFORMS = ['darwin'];             // 조용한 설치 — ★맥만(서명·공증 있음)
const canAutoDownload = AUTO_DOWNLOAD_PLATFORMS.includes(process.platform);
const canAutoInstall = AUTO_INSTALL_PLATFORMS.includes(process.platform);
autoUpdater.autoDownload = canAutoDownload;
autoUpdater.autoInstallOnAppQuit = canAutoInstall;
console.log(`   자동 다운로드: ${canAutoDownload ? '켜짐' : '꺼짐'} / 자동 설치: ${canAutoInstall ? '켜짐(맥)' : '꺼짐(사용자 클릭)'} — platform=${process.platform}\n`);

if (isDev || process.argv.includes('--dev')) {
  // 개발 모드에서도 업데이트 체크 가능하도록 설정
  autoUpdater.forceDevUpdateConfig = true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 480,
    // maxWidth: 450,
    title: 'review-crawler',
    autoHideMenuBar: true, // Windows/Linux에서 메뉴바 자동 숨김
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 패키징된 앱(배포 빌드)에서는 devTools 자체를 비활성화 — F12·메뉴·NODE_ENV 우회 모두 차단
      devTools: !app.isPackaged,
    },
  });

  // Windows에서 메뉴바 완전히 숨기기
  if (process.platform === 'win32') {
    mainWindow.setMenuBarVisibility(false);
  }

  // 개발 모드 초기화 — 빌드 앱(packaged)에서는 NODE_ENV 우회 시도해도 절대 활성화 안 됨
  if (isDev && !app.isPackaged) {
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

  // 브라우저에서 URL 열기 핸들러 (플랫폼/수집타입/정렬/페이지 포함)
  ipcMain.handle('open-url-in-browser', async (event, url, platform = 0, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', openFolder = false, excludeSecret = false, downloadImages = true, smallImage = false, enableDiagnostic = false, slowMode = true, imageMode = '') => {
    console.log('[Main] open-url-in-browser IPC handler called with URL:', url, 'Platform:', platform, 'CollectionType:', collectionType, 'Sort:', sort, 'Pages:', pages, 'CustomPages:', customPages, 'SavePath:', savePath, 'OpenFolder:', openFolder, 'ExcludeSecret:', excludeSecret, 'DownloadImages:', downloadImages, 'SmallImage:', smallImage, 'EnableDiagnostic:', enableDiagnostic, 'SlowMode:', slowMode, 'ImageMode:', imageMode);
    try {
      const result = await openUrlInBrowser(url, platform, collectionType, sort, pages, customPages, savePath, openFolder, excludeSecret, event.sender, downloadImages, smallImage, enableDiagnostic, slowMode, imageMode);
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

  // 폴더 열기 핸들러
  ipcMain.handle('open-folder', async (event, folderPath) => {
    console.log('[Main] open-folder IPC handler called with path:', folderPath);
    try {
      if (!folderPath) {
        throw new Error('폴더 경로가 제공되지 않았습니다.');
      }
      await shell.openPath(folderPath);
      console.log('[Main] Folder opened successfully:', folderPath);
      return { success: true };
    } catch (error) {
      console.error('[Main] Open folder error:', error);
      return {
        success: false,
        error: error.message || '폴더를 열 수 없습니다.',
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

  // 외부 URL 열기 핸들러
  ipcMain.handle('open-external-url', async (event, url) => {
    console.log('[Main] open-external-url IPC handler called with URL:', url);
    try {
      await shell.openExternal(url);
      console.log('[Main] External URL opened successfully:', url);
      return { success: true };
    } catch (error) {
      console.error('[Main] Open external URL error:', error);
      return {
        success: false,
        error: error.message || 'URL을 열 수 없습니다.',
      };
    }
  });
  
  // 라이선스 - IP로 유저 조회
  ipcMain.handle('license-check-ip', async (event, ip) => {
    return await findUserByIp(ip);
  });

  // 라이선스 - 키 입력 후 등록
  ipcMain.handle('license-register', async (event, licenseKey, ip, userId) => {
    return await registerLicense(licenseKey, ip, userId);
  });

  // 라이선스 - 이름 저장
  ipcMain.handle('license-update-name', async (event, licenseKey, userName) => {
    return await updateUserName(licenseKey, userName);
  });

  // 라이선스 - IP 별칭 수정
  ipcMain.handle('license-update-alias', async (event, licenseKey, ip, alias) => {
    return await updateIpAlias(licenseKey, ip, alias);
  });

  // 라이선스 - IP 삭제
  ipcMain.handle('license-remove-ip', async (event, licenseKey, ip) => {
    return await removeIp(licenseKey, ip);
  });

  // 라이선스 - 키 발급 (root 전용)
  ipcMain.handle('license-create-key', async (event, plan, memo) => {
    return await createLicenseKey(plan, memo);
  });

  // 라이선스 - 키 목록 조회 (root 전용)
  ipcMain.handle('license-list-keys', async () => {
    return await listLicenseKeys();
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
  // ⚠️ 여기서 packageJson.build.publish를 «검사하지 않는다».
  //    electron-builder가 패키징 시 build 키를 제거하므로, 그 가드가 있으면
  //    패키징된 앱은 autoUpdater.checkForUpdates()에 도달조차 못 한다(v1.6.9 실측 결함).
  const owner = GITHUB_OWNER;
  const repo = GITHUB_REPO;

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
        
        sendStatusToWindow('update-available', {
          version: latestTag,
          releaseUrl: releaseInfo.html_url,
          isDevMode: true,
        });
      } else {
        console.log('\n✅ ========================================');
        console.log('   최신 버전입니다!');
        console.log('========================================');
        console.log(`   현재 버전: ${currentVersion}`);
        console.log(`   최신 버전: ${latestTag || currentVersion}`);
        console.log('========================================\n');
        
        sendStatusToWindow('update-not-available', { version: latestTag || currentVersion });
      }
    } catch (error) {
      console.log(`\n⚠️  GitHub API 확인 실패: ${error.message}`);
      console.log('   electron-updater로 재시도합니다...\n');
      // API 실패 시 electron-updater로 재시도
      // ('error' 이벤트에서 이미 처리하므로 UnhandledPromiseRejection만 막는다)
      autoUpdater.checkForUpdates().catch(() => {});
    }
  } else {
    // 프로덕션 모드 또는 패키징된 앱에서는 electron-updater 사용
    // ('error' 이벤트에서 이미 처리하므로 UnhandledPromiseRejection만 막는다)
    autoUpdater.checkForUpdates().catch(() => {});
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
  // ★autoDownload가 켜진 플랫폼에서는 «앱이 알아서 받는다» → 렌더러가 「다운로드 받기」 링크를
  //   또 띄우면 사용자가 «두 번» 받는다(수동으로 받은 파일 + 앱이 받은 파일).
  sendStatusToWindow('update-available', { ...info, autoDownload: canAutoDownload });
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
  // ★렌더러가 «자동 설치되는 플랫폼인지»를 알아야 문구를 고를 수 있다.
  //   맥: 「종료하면 자동 설치」 / 윈도우: 「설치 버튼을 누르세요 + SmartScreen 안내」
  sendStatusToWindow('update-downloaded', { ...info, autoInstall: canAutoInstall, platform: process.platform });
});

// OS별 구글드라이브 다운로드 폴더 URL — D 옵션의 외부 링크
function getDownloadFolderUrl() {
  const DRIVE_FOLDERS = {
    macArm64: 'https://drive.google.com/drive/folders/1gtU0UhSqju5oH0hjp_ib3fzDXff2v0bE',
    macIntel: 'https://drive.google.com/drive/folders/1rk9L9omVBfZXgvHqk2eOdaqU2CY7xZSJ',
    windows:  'https://drive.google.com/drive/folders/1w7lygD3cURcd0ecHYYp8wvKZHM5QlcUU',
  };
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? DRIVE_FOLDERS.macArm64 : DRIVE_FOLDERS.macIntel;
  }
  if (process.platform === 'win32') return DRIVE_FOLDERS.windows;
  return DRIVE_FOLDERS.macArm64; // fallback
}

// 렌더러에 업데이트 상태 전송 (OS별 다운로드 URL 자동 포함)
function sendStatusToWindow(status, data) {
  if (mainWindow) {
    const enrichedData = data && typeof data === 'object'
      ? { ...data, downloadFolderUrl: getDownloadFolderUrl() }
      : { downloadFolderUrl: getDownloadFolderUrl() };
    mainWindow.webContents.send('update-status', { status, data: enrichedData });
  }
}
