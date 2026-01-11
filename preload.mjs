import { contextBridge, ipcRenderer } from 'electron';
import { config } from './config.js';

console.log('[Preload] Preload script loaded');

// 렌더러 프로세스에 안전하게 API 노출
try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // 예제: 메인 프로세스와 통신하는 함수
    sendMessage: (message) => ipcRenderer.invoke('send-message', message),
    
    // 예제: 메인 프로세스로부터 메시지 수신
    onMessage: (callback) => {
      ipcRenderer.on('message-from-main', (event, data) => callback(data));
    },
    
    // 폴더 선택 다이얼로그
    selectFolder: async () => {
      console.log('[Preload] selectFolder called');
      try {
        const result = await ipcRenderer.invoke('select-folder');
        console.log('[Preload] selectFolder result:', result);
        return result;
      } catch (error) {
        console.error('[Preload] selectFolder error:', error);
        throw error;
      }
    },
    
    // 브라우저에서 URL 열기 (플랫폼/수집타입/정렬/페이지 정보 포함)
    openUrlInBrowser: async (url, platform = 0, collectionType = 0, sort = 0, pages = 0, customPages = null, savePath = '', openFolder = false) => {
      console.log('[Preload] openUrlInBrowser called with URL:', url, 'Platform:', platform, 'CollectionType:', collectionType, 'Sort:', sort, 'Pages:', pages, 'CustomPages:', customPages, 'SavePath:', savePath, 'OpenFolder:', openFolder);
      try {
        const result = await ipcRenderer.invoke('open-url-in-browser', url, platform, collectionType, sort, pages, customPages, savePath, openFolder);
        console.log('[Preload] openUrlInBrowser result:', result);
        return result;
      } catch (error) {
        console.error('[Preload] openUrlInBrowser error:', error);
        throw error;
      }
    },
    
    // 폴더 열기
    openFolder: async (folderPath) => {
      console.log('[Preload] openFolder called with path:', folderPath);
      try {
        const result = await ipcRenderer.invoke('open-folder', folderPath);
        console.log('[Preload] openFolder result:', result);
        return result;
      } catch (error) {
        console.error('[Preload] openFolder error:', error);
        throw error;
      }
    },
    
    // 업데이트 관련 API
    // 업데이트 상태 수신
    onUpdateStatus: (callback) => {
      ipcRenderer.on('update-status', (event, data) => callback(data));
    },
    
    // 업데이트 체크 요청
    checkForUpdates: () => {
      ipcRenderer.send('check-for-updates');
    },
    
    // 업데이트 설치
    installUpdate: () => {
      ipcRenderer.send('install-update');
    },
    
    // config 가져오기
    getConfig: () => {
      return config;
    },
  });
  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error exposing API:', error);
}
