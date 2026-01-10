import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDevMode } from './electron/dev.js';
import { openUrlInBrowser } from './electron/services/browserService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let devTools = null;
const isDev = process.env.NODE_ENV === 'development';

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
