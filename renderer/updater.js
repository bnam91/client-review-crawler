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
    
    switch (status) {
      case 'checking-for-update':
        notification.style.display = 'block';
        title.textContent = '업데이트 확인 중...';
        message.textContent = '새로운 버전을 확인하고 있습니다.';
        break;
        
      case 'update-available':
        title.textContent = '새로운 업데이트 발견!';
        message.textContent = `버전 ${data.version}이 사용 가능합니다.`;
        break;
        
      case 'update-not-available':
        title.textContent = '최신 버전입니다';
        message.textContent = '현재 최신 버전을 사용하고 있습니다.';
        setTimeout(() => {
          notification.style.display = 'none';
        }, 3000);
        break;
        
      case 'download-progress':
        title.textContent = '업데이트 다운로드 중...';
        progress.style.display = 'block';
        const percent = Math.round(data.percent);
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').textContent = percent + '%';
        break;
        
      case 'update-downloaded':
        title.textContent = '업데이트 준비 완료!';
        message.textContent = '업데이트가 다운로드되었습니다. 지금 설치하시겠습니까?';
        progress.style.display = 'none';
        actions.style.display = 'block';
        break;
        
      case 'error':
        title.textContent = '업데이트 오류';
        message.textContent = '업데이트 중 문제가 발생했습니다.';
        setTimeout(() => {
          notification.style.display = 'none';
        }, 5000);
        break;
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

// 전역 함수로 등록
window.installUpdate = installUpdate;
window.hideUpdateNotification = hideUpdateNotification;

