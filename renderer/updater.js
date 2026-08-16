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

      // ★2026-08-16: 맥에서 autoDownload를 켰다 ⇒ 아래 두 상태가 «실제로 도달한다».
      //   ⛔배선을 비워두면 앱이 «조용히» 받아서 «조용히» 바뀐다 — 오늘 리뷰크롤러에서 고친
      //   「무음」 결함을 자동업데이트 쪽에 새로 만드는 셈이라, 반드시 사용자에게 보인다.
      case 'download-progress': {
        const pct = Math.round(data?.percent ?? 0);
        // ★같은 줄을 «갱신»한다. addLogToLogBox는 항상 새 줄을 만들어서
        //   진행률을 그대로 넘기면 로그가 수십 줄로 도배된다.
        updateProgressLine(`[업데이트] 새 버전을 내려받는 중… ${pct}%`);
        break;
      }

      case 'update-downloaded': {
        const ver = data?.version || '?';
        addLogToLogBox(
          `[업데이트] v${ver} 내려받기 완료 — 앱을 종료하면 자동으로 설치됩니다.`,
          'success'
        );
        break;
      }
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
// ★다운로드 진행률 전용 — «한 줄»을 계속 갱신한다(새 줄을 쌓지 않는다).
let __updateProgressLine = null;
function updateProgressLine(message) {
  const logBox = document.getElementById('log-box');
  if (!logBox) return;
  if (!__updateProgressLine || !__updateProgressLine.isConnected) {
    __updateProgressLine = document.createElement('div');
    __updateProgressLine.className = 'log-line info';
    logBox.appendChild(__updateProgressLine);
  }
  __updateProgressLine.textContent = message;
  logBox.scrollTop = logBox.scrollHeight;
}

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

