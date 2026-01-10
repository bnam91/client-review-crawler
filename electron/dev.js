import { app, globalShortcut, BrowserWindow } from 'electron';
import { watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

/**
 * 개발 모드 유틸리티
 */
export class DevTools {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.fileWatcher = null;
    this.mainWatcher = null;
    this.reloadTimeout = null;
    this.f12Shortcut = null;
    this.devToolsWindow = null;
  }

  /**
   * 별도 창으로 개발자 도구 열기
   */
  openDevToolsInSeparateWindow() {
    // 이미 열려있으면 닫기
    if (this.devToolsWindow && !this.devToolsWindow.isDestroyed()) {
      this.devToolsWindow.close();
      this.devToolsWindow = null;
      return;
    }

    // 별도 창 생성
    this.devToolsWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: '개발자 도구',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 개발자 도구를 별도 창에 연결
    this.mainWindow.webContents.setDevToolsWebContents(this.devToolsWindow.webContents);
    this.mainWindow.webContents.openDevTools();

    // 창이 닫힐 때 정리
    this.devToolsWindow.on('closed', () => {
      this.devToolsWindow = null;
      // 개발자 도구 닫기
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.closeDevTools();
      }
    });
  }

  /**
   * 개발자 도구 초기 설정
   */
  setupDevTools() {
    // 초기 개발자 도구는 열지 않음 (F12로 열도록)

    // F12로 개발자 도구 토글 (globalShortcut 사용)
    const registerF12 = () => {
      // F12 단축키 등록
      this.f12Shortcut = globalShortcut.register('F12', () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.openDevToolsInSeparateWindow();
        }
      });

      if (!this.f12Shortcut) {
        console.log('[WARN] F12 단축키 등록 실패');
      } else {
        console.log('[INFO] F12 단축키 등록 완료 (별도 창으로 열림)');
      }
    };

    // app이 준비되었는지 확인
    if (app.isReady()) {
      registerF12();
    } else {
      app.whenReady().then(() => {
        registerF12();
      });
    }
  }

  /**
   * 파일 변경 감지 및 자동 리로드 설정
   */
  setupFileWatcher() {
    const rendererDir = join(PROJECT_ROOT, 'renderer');

    // renderer 폴더 감시
    this.fileWatcher = watch(rendererDir, { recursive: true }, (eventType, filename) => {
      // 파일이 변경되었을 때만 리로드
      if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css'))) {
        // 디바운싱: 연속된 변경을 하나로 처리
        clearTimeout(this.reloadTimeout);
        this.reloadTimeout = setTimeout(() => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            console.log(`[HMR] 파일 변경 감지: ${filename}, 리로드 중...`);
            this.mainWindow.webContents.reload();
          }
        }, 300); // 300ms 지연으로 연속 변경 처리
      }
    });

    // main.js와 preload.js 변경도 감지
    this.mainWatcher = watch(PROJECT_ROOT, (eventType, filename) => {
      if (filename === 'main.js' || filename === 'preload.js') {
        clearTimeout(this.reloadTimeout);
        this.reloadTimeout = setTimeout(() => {
          console.log(`[HMR] 메인 파일 변경 감지: ${filename}`);
          // 메인 프로세스 파일 변경 시 앱 재시작 필요
          app.relaunch();
          app.exit(0);
        }, 300);
      }
    });
  }

  /**
   * 파일 감시 중지
   */
  cleanup() {
    // F12 단축키 해제
    if (this.f12Shortcut) {
      globalShortcut.unregister('F12');
      this.f12Shortcut = null;
    }

    // 개발자 도구 창 닫기
    if (this.devToolsWindow && !this.devToolsWindow.isDestroyed()) {
      this.devToolsWindow.close();
      this.devToolsWindow = null;
    }

    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.mainWatcher) {
      this.mainWatcher.close();
      this.mainWatcher = null;
    }
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }
  }
}

/**
 * 개발 모드 초기화 함수
 * @param {BrowserWindow} mainWindow - 메인 윈도우 인스턴스
 * @returns {DevTools} DevTools 인스턴스
 */
export function initDevMode(mainWindow) {
  console.log('🚨 개발자 모드로 실행합니다.\n');
  const devTools = new DevTools(mainWindow);
  devTools.setupDevTools();
  devTools.setupFileWatcher();
  return devTools;
}
