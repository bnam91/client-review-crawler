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
        if (data?.autoDownload) {
          // ★앱이 «지금부터» 받는다 — 링크를 주면 같은 파일을 두 번 받게 된다.
          //   진행률은 곧 download-progress가 같은 줄을 갱신하며 채운다.
          addLogToLogBox(`[업데이트] 새 버전 v${ver}을 내려받는 중입니다…`, 'info');
        } else {
          // 자동 다운로드가 꺼진 플랫폼 — 종전대로 링크를 준다.
          addUpdateAvailableLogLine(ver, url);
        }
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
        // ★맥과 윈도우가 «여기서 갈린다».
        //   맥은 서명·공증이 있어 종료 시 조용히 설치된다 → 알리기만 하면 된다.
        //   윈도우는 사용자가 «직접 눌러야» 설치가 시작되고, 그때 SmartScreen이 뜬다.
        //   ⇒ 버튼을 안 주면 다 받아놓고 «아무 일도 안 일어나는» 앱이 된다.
        if (data?.autoInstall) {
          addLogToLogBox(
            `[업데이트] v${ver} 내려받기 완료 — 앱을 종료하면 자동으로 설치됩니다.`,
            'success'
          );
        } else {
          addInstallReadyLogLine(ver);
        }
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

// 내려받기 완료(윈도우) — 「설치 실행」 버튼 + SmartScreen 안내를 한 줄로 띄운다.
// ⚠️윈도우 설치본에는 코드서명이 없어서 실행 시 「Windows의 PC 보호」 파란 창이 뜬다.
//   그 창을 처음 본 사용자는 «악성코드로 오해하고 취소»한다 → 넘기는 법을 «미리» 알려준다.
function addInstallReadyLogLine(version) {
  const logBox = document.getElementById('log-box');
  if (!logBox) return;

  const line = document.createElement('div');
  line.className = 'log-line update-available';

  const text = document.createElement('span');
  text.textContent = `🆕 새 버전 v${version} 내려받기 완료 — `;
  line.appendChild(text);

  const btn = document.createElement('span');
  btn.textContent = '[지금 설치]';
  btn.style.color = '#7aaaff';
  btn.style.textDecoration = 'underline';
  btn.style.cursor = 'pointer';
  btn.title = '앱이 종료되고 설치 프로그램이 실행됩니다';
  btn.addEventListener('click', () => {
    // ★한 번 더 못 누르게 막는다 — 연타하면 설치 프로그램이 여러 개 뜬다.
    if (btn.dataset.clicked === '1') return;
    btn.dataset.clicked = '1';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'default';
    addLogToLogBox('[업데이트] 설치를 시작합니다 — 앱이 잠시 후 종료됩니다.', 'info');
    installUpdate();
  });
  line.appendChild(btn);

  logBox.appendChild(line);

  // SmartScreen 안내는 «별도 줄»로 — 버튼 줄이 길어지면 안 읽힌다.
  addLogToLogBox(
    '[안내] 설치 중 「Windows의 PC 보호」 창이 뜨면 «추가 정보 → 실행»을 눌러 주세요. (정상입니다)',
    'info'
  );

  logBox.scrollTop = logBox.scrollHeight;
}

// 전역 함수로 등록
window.installUpdate = installUpdate;
window.hideUpdateNotification = hideUpdateNotification;
window.openReleasePage = openReleasePage;

