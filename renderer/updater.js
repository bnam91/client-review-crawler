// 업데이트 상태 수신
if (window.electronAPI && window.electronAPI.onUpdateStatus) {
  window.electronAPI.onUpdateStatus(({ status, data }) => {
    const notification = document.getElementById('update-notification');
    const title = document.getElementById('update-title');
    const message = document.getElementById('update-message');
    const progress = document.getElementById('update-progress');
    const actions = document.getElementById('update-actions');
    
    if (!notification || !title || !message || !progress || !actions) {
      return;
    }
    
    // D 옵션: 자동 다운/설치 안 함. logBox에 메시지만 표시 + 새 버전이면 다운로드 링크.
    // 큰 알림 모달(notification)은 더 이상 사용 안 함 — 항상 숨김.
    notification.style.display = 'none';

    switch (status) {
      case 'checking-for-update':
        // 조용히 — logBox에 따로 표시 안 함 (소음 방지)
        break;

      case 'update-available': {
        const ver = data?.version || '?';
        const url = data?.downloadFolderUrl || data?.releaseUrl || '';
        // logBox에 한 줄로 표시 + 클릭 가능한 링크
        addUpdateAvailableLogLine(ver, url);
        break;
      }

      case 'update-not-available':
        // 옛 코드의 메시지 그대로 — 다른 [정보] 라인과 톤 통일
        addLogToLogBox('[정보] 현재 최신 버전을 사용하고 있습니다.', 'success');
        break;

      case 'error':
        // 업데이트 체크 실패 — 사용자에게 노출 안 함 (네트워크 일시 단절 등 흔한 케이스)
        break;

      // download-progress / update-downloaded — autoDownload 비활성화로 도달 안 함
    }
  });
}

// 업데이트 설치
function installUpdate() {
  if (window.electronAPI && window.electronAPI.installUpdate) {
    window.electronAPI.installUpdate();
  }
}

// 알림 숨기기
function hideUpdateNotification() {
  const notification = document.getElementById('update-notification');
  if (notification) {
    notification.style.display = 'none';
  }
}

// 릴리즈 페이지 열기
function openReleasePage(url) {
  if (window.electronAPI && window.electronAPI.openUrlInBrowser) {
    window.electronAPI.openUrlInBrowser(url);
  } else {
    window.open(url, '_blank');
  }
}

// 로그 박스에 메시지 추가하는 헬퍼 함수
function addLogToLogBox(message, className = '') {
  const logBox = document.getElementById('log-box');
  if (!logBox) return;

  const line = document.createElement('div');
  line.className = `log-line ${className}`;
  line.textContent = message;
  logBox.appendChild(line);

  // 로그 박스 스크롤을 맨 아래로
  logBox.scrollTop = logBox.scrollHeight;
}

// 새 버전 알림 — 클릭하면 OS별 다운로드 폴더 외부 브라우저로 열림
function addUpdateAvailableLogLine(version, url) {
  const logBox = document.getElementById('log-box');
  if (!logBox) return;

  const line = document.createElement('div');
  line.className = 'log-line update-available';
  line.style.cursor = url ? 'pointer' : 'default';
  line.title = url ? '클릭하면 다운로드 폴더가 열립니다' : '';

  const text = document.createElement('span');
  text.textContent = `🆕 새 버전 v${version} 출시! `;
  line.appendChild(text);

  if (url) {
    const link = document.createElement('span');
    link.textContent = '[다운로드 받기]';
    link.style.color = '#7aaaff';
    link.style.textDecoration = 'underline';
    line.appendChild(link);
    line.addEventListener('click', () => {
      if (window.electronAPI?.openExternalUrl) {
        window.electronAPI.openExternalUrl(url);
      }
    });
  }

  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

// 전역 함수로 등록
window.installUpdate = installUpdate;
window.hideUpdateNotification = hideUpdateNotification;
window.openReleasePage = openReleasePage;

