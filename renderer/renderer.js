// Renderer 프로세스 스크립트

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    platform: 0, // 0: 네이버, 1: 쿠팡
    collectionType: 0, // 0: 리뷰 수집, 1: Q&A 수집, 2: 리뷰 + Q&A 수집
    sort: 0,     // 0: 랭킹순, 1: 최신순, 2: 평점낮은순
    pages: 0     // 0:5, 1:15, 2:50, 3:max, 4:직접입력
  };

  // 수집 타입 드롭다운
  const collectionTypeSelect = document.getElementById('collection-type-select');
  const sortSelect = document.getElementById('sort-select');
  const excludeSecretGroup = document.getElementById('exclude-secret-group');
  const excludeSecretCheckbox = document.getElementById('exclude-secret');
  
  if (collectionTypeSelect) {
    collectionTypeSelect.addEventListener('change', (e) => {
      const newCollectionType = parseInt(e.target.value);
      state.collectionType = newCollectionType;
      const collectionTypeNames = ['리뷰 수집', 'Q&A 수집'];
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 항목 및 순서 변경: ${collectionTypeNames[newCollectionType]} (값: ${newCollectionType})`);
      
      // Q&A 수집 시 정렬 드롭다운 숨기고 비밀 글 제외 체크박스 표시
      if (state.collectionType === 1) {
        // Q&A 수집
        if (sortSelect) {
          sortSelect.style.display = 'none';
        }
        if (excludeSecretGroup) {
          excludeSecretGroup.style.display = 'flex';
        }
      } else {
        // 리뷰 수집
        if (sortSelect) {
          sortSelect.style.display = 'block';
        }
        if (excludeSecretGroup) {
          excludeSecretGroup.style.display = 'none';
        }
      }
      
      updateLog();
      updateExpected();
    });
  }
  
  // 비밀글 제외 체크박스
  const excludeSecretLabel = document.getElementById('exclude-secret-label');
  if (excludeSecretCheckbox) {
    excludeSecretCheckbox.addEventListener('click', () => {
      excludeSecretCheckbox.classList.toggle('checked');
    });
  }
  
  // 라벨 클릭 시 체크박스 토글
  if (excludeSecretLabel) {
    excludeSecretLabel.addEventListener('click', () => {
      if (excludeSecretCheckbox) {
        excludeSecretCheckbox.classList.toggle('checked');
      }
    });
  }

  // 플랫폼 토글 버튼
  const platformToggleBtn = document.getElementById('platform-toggle-btn');
  const platformNameElement = document.getElementById('platform-name');
  
  if (platformToggleBtn && platformNameElement) {
    // 초기 플랫폼 설정 (네이버)
    const platformNames = ['네이버', '쿠팡'];
    platformNameElement.textContent = platformNames[state.platform];
    
    platformToggleBtn.addEventListener('click', () => {
      // 네이버(0) ↔ 쿠팡(1) 전환
      state.platform = state.platform === 0 ? 1 : 0;
      platformNameElement.textContent = platformNames[state.platform];
      
      // 쿠팡일 때 버튼 스타일 변경
      if (state.platform === 1) {
        platformToggleBtn.classList.add('coupang');
      } else {
        platformToggleBtn.classList.remove('coupang');
      }
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 플랫폼 변경: ${platformNames[state.platform]} (값: ${state.platform})`);
      
      // 로그 및 상태 업데이트
      updateLog();
      updateExpected();
    });
  }

  // URL 입력 감지 및 플랫폼 자동 인식
  const productUrlInput = document.getElementById('product-url');
  const statusElement = document.getElementById('status');
  
  function detectPlatformFromUrl(url) {
    if (!url) return null;
    
    const urlLower = url.toLowerCase();
    
    // 네이버 쇼핑 URL 패턴
    if (urlLower.includes('shopping.naver.com') || 
        urlLower.includes('smartstore.naver.com') ||
        urlLower.includes('naver.com') && (urlLower.includes('/products/') || urlLower.includes('/items/'))) {
      return 0; // 네이버
    }
    
    // 쿠팡 URL 패턴
    if (urlLower.includes('coupang.com') || 
        urlLower.includes('coupang.co.kr')) {
      return 1; // 쿠팡
    }
    
    return null;
  }
  
  if (productUrlInput && statusElement) {
    productUrlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      
      if (url) {
        // 플랫폼 자동 감지
        const detectedPlatform = detectPlatformFromUrl(url);
        
        if (detectedPlatform !== null) {
          // 플랫폼 자동 감지
          state.platform = detectedPlatform;
          const platformNames = ['네이버', '쿠팡'];
          
          // 플랫폼 버튼 텍스트 및 스타일 업데이트
          if (platformNameElement && platformToggleBtn) {
            platformNameElement.textContent = platformNames[detectedPlatform];
            if (detectedPlatform === 1) {
              platformToggleBtn.classList.add('coupang');
            } else {
              platformToggleBtn.classList.remove('coupang');
            }
          }
          
          if (detectedPlatform === 0) {
            // 네이버
            statusElement.textContent = '네이버 상품 감지됨';
            addLog('[자동] 네이버 상품 URL이 감지되었습니다.');
            showStatusMessage('네이버 상품 URL이 감지되었습니다.', 'success');
          } else if (detectedPlatform === 1) {
            // 쿠팡
            statusElement.textContent = '쿠팡 상품 감지됨';
            addLog('[자동] 쿠팡 상품 URL이 감지되었습니다.');
            showStatusMessage('쿠팡 상품 URL이 감지되었습니다.', 'success');
          }
          
          updateLog();
          updateExpected();
        } else {
          statusElement.textContent = 'URL 입력됨 (플랫폼 미인식)';
          showStatusMessage('URL 입력됨 (플랫폼 미인식)', 'warning');
        }
      } else {
        statusElement.textContent = '대기';
        hideStatusMessage();
      }
    });
  }

  // 페이지 태그 토글 기능
  const pageTags = document.querySelectorAll('[data-pages]');
  const customPagesInput = document.getElementById('custom-pages');
  const customPagesRow = document.getElementById('custom-pages-row');

  pageTags.forEach(btn => {
    btn.addEventListener('click', () => {
      pageTags.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      state.pages = parseInt(btn.dataset.pages);
      const pageNames = ['5페이지', '15페이지', '50페이지', '최대', '직접입력'];
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 페이지 변경: ${pageNames[state.pages]} (값: ${state.pages})`);
      
      if (state.pages === 4) {
        // 직접 입력 선택 시 필드 표시
        if (customPagesRow) {
          customPagesRow.style.display = 'flex';
        }
        if (customPagesInput) {
          customPagesInput.disabled = false;
          customPagesInput.classList.remove('disabled');
        }
      } else {
        // 직접 입력이 아닐 때 필드 숨김
        if (customPagesRow) {
          customPagesRow.style.display = 'none';
        }
        if (customPagesInput) {
          customPagesInput.disabled = true;
          customPagesInput.classList.add('disabled');
        }
      }
      updateLog();
      updateExpected();
    });
  });

  // 정렬 드롭다운 (이미 위에서 선언됨)
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const newSort = parseInt(e.target.value);
      state.sort = newSort;
      const sortNames = ['랭킹순', '최신순', '평점낮은순'];
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 정렬 변경: ${sortNames[newSort]} (값: ${newSort})`);
      
      updateLog();
      updateExpected();
    });
  }

  // 체크박스 토글
  const openFolderCheckbox = document.getElementById('open-folder');
  if (openFolderCheckbox) {
    openFolderCheckbox.addEventListener('click', () => {
      openFolderCheckbox.classList.toggle('checked');
    });
  }

  // 업데이트 체크 버튼
  const updateCheckBtn = document.getElementById('update-check-btn');
  if (updateCheckBtn && window.electronAPI && window.electronAPI.checkForUpdates) {
    updateCheckBtn.addEventListener('click', () => {
      console.log('[Renderer] 업데이트 체크 버튼 클릭');
      window.electronAPI.checkForUpdates();
    });
  }

  // 저장 경로 선택 버튼
  const selectPathBtn = document.getElementById('select-path');
  const savePathInput = document.getElementById('save-path');
  
  // 디버깅: electronAPI 확인
  console.log('[Renderer] window.electronAPI:', window.electronAPI);
  console.log('[Renderer] window.electronAPI?.selectFolder:', window.electronAPI?.selectFolder);
  
  if (selectPathBtn && savePathInput) {
    selectPathBtn.addEventListener('click', async () => {
      console.log('[Renderer] Select path button clicked');
      try {
        console.log('[Renderer] Checking electronAPI...');
        console.log('[Renderer] window.electronAPI:', window.electronAPI);
        console.log('[Renderer] typeof window.electronAPI:', typeof window.electronAPI);
        
        if (!window.electronAPI) {
          console.error('[Renderer] window.electronAPI is not defined');
          showModal('Electron API를 사용할 수 없습니다. (window.electronAPI가 정의되지 않음)');
          return;
        }
        
        if (!window.electronAPI.selectFolder) {
          console.error('[Renderer] window.electronAPI.selectFolder is not defined');
          console.log('[Renderer] Available methods:', Object.keys(window.electronAPI));
          showModal('selectFolder 메서드를 사용할 수 없습니다.');
          return;
        }
        
        console.log('[Renderer] Calling selectFolder...');
        const selectedPath = await window.electronAPI.selectFolder();
        console.log('[Renderer] Selected path:', selectedPath);
        
        if (selectedPath) {
          savePathInput.value = selectedPath;
          addLog(`[경로] 저장 경로 선택: ${selectedPath}`);
        } else {
          console.log('[Renderer] No path selected (user cancelled)');
        }
      } catch (error) {
        console.error('[Renderer] 경로 선택 오류:', error);
        console.error('[Renderer] Error stack:', error.stack);
        showModal(`경로 선택 중 오류가 발생했습니다: ${error.message}`);
      }
    });
  } else {
    console.error('[Renderer] selectPathBtn or savePathInput not found');
  }

  // 수집 시작 버튼
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const url = document.getElementById('product-url').value.trim();
      if (!url) {
        showModal('상품 URL 혹은 검색어를 입력하세요.');
        return;
      }
      
      addLog('[시작] 리뷰 수집을 시작합니다...', 'waiting');
      showStatusMessage('리뷰 수집을 시작합니다...', 'info');
      startBtn.disabled = true;
      startBtn.textContent = '수집 중...';
      
      // 브라우저에서 URL 열기 (플랫폼 정보 포함)
      if (window.electronAPI && window.electronAPI.openUrlInBrowser) {
        try {
          const platformNames = ['네이버', '쿠팡'];
          const collectionTypeNames = ['리뷰 수집', 'Q&A 수집'];
          const sortNames = ['랭킹순', '최신순', '평점낮은순'];
          const pageNames = ['5페이지', '15페이지', '50페이지', '최대', '직접입력'];
          
          // 현재 state 값 전체 출력
          console.log('[Renderer] 🚀 브라우저 열기 버튼 클릭 - 현재 설정:');
          console.log(`  - 플랫폼: ${platformNames[state.platform]} (값: ${state.platform})`);
          console.log(`  - 항목 및 순서: ${collectionTypeNames[state.collectionType]} (값: ${state.collectionType})`);
          console.log(`  - 정렬: ${sortNames[state.sort]} (값: ${state.sort})`);
          console.log(`  - 페이지: ${pageNames[state.pages]} (값: ${state.pages})`);
          
          // 직접 입력인 경우 입력값 가져오기
          let customPages = null;
          if (state.pages === 4 && customPagesInput) {
            const customValue = parseInt(customPagesInput.value);
            if (!isNaN(customValue) && customValue > 0) {
              customPages = customValue;
              console.log(`  - 직접 입력 페이지 수: ${customPages}`);
            } else {
              showModal('직접 입력 페이지 수를 올바르게 입력해주세요.');
              return;
            }
          }
          
          console.log(`  - URL: ${url}`);
          
          // 저장 경로 가져오기 (필수)
          const savePathElement = document.getElementById('save-path');
          const savePath = savePathElement ? savePathElement.value.trim() : '';
          console.log(`[Renderer] 저장 경로 입력 필드 값: "${savePath}"`);
          
          // 경로 필수 체크
          if (!savePath || savePath === '') {
            showModal('저장 경로를 반드시 선택해주세요.');
            startBtn.disabled = false;
            startBtn.textContent = '수집 시작하기';
            return;
          }
          
          console.log(`  - 저장 경로: ${savePath}`);
          addLog(`[경로] 저장 경로: ${savePath}`);
          
          addLog(`[브라우저] ${url}를 브라우저에서 엽니다...`);
          showStatusMessage('브라우저를 열고 있습니다...', 'info');
          const result = await window.electronAPI.openUrlInBrowser(url, state.platform, state.collectionType, state.sort, state.pages, customPages, savePath);
          if (result.success) {
            addLog(`[브라우저] 브라우저에서 URL을 열었습니다.`);
            showStatusMessage('브라우저에서 URL을 열었습니다.', 'success');
          } else {
            addLog(`[오류] 브라우저 열기 실패: ${result.error || '알 수 없는 오류'}`);
            showStatusMessage(`브라우저 열기 실패: ${result.error || '알 수 없는 오류'}`, 'error');
            showModal(`브라우저 열기 실패: ${result.error || '알 수 없는 오류'}`);
          }
        } catch (error) {
          console.error('[Renderer] 브라우저 열기 오류:', error);
          addLog(`[오류] 브라우저 열기 중 오류가 발생했습니다.`);
          showStatusMessage(`브라우저 열기 중 오류가 발생했습니다: ${error.message}`, 'error');
          showModal(`브라우저 열기 중 오류가 발생했습니다: ${error.message}`);
        }
      } else {
        addLog('[오류] 브라우저 API를 사용할 수 없습니다.');
        showStatusMessage('브라우저 API를 사용할 수 없습니다.', 'error');
        showModal('브라우저 API를 사용할 수 없습니다.');
      }
      
      // 시뮬레이션 (실제로는 크롤링 로직 실행)
      setTimeout(() => {
        addLog('[완료] 리뷰 수집이 완료되었습니다.');
        showStatusMessage('리뷰 수집이 완료되었습니다.', 'success');
        startBtn.disabled = false;
        startBtn.textContent = '수집 시작하기';
      }, 2000);
    });
  }

  function updateLog() {
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    
    const platformNames = ['네이버', '쿠팡'];
    const collectionTypeNames = ['리뷰 수집', 'Q&A 수집', '리뷰 + Q&A 수집'];
    const sortNames = ['랭킹순', '최신순', '평점낮은순'];
    const pageNames = ['5', '15', '50', 'max', '직접 입력'];
    
    const lines = [
      '<div class="log-line waiting">[대기] 상품 URL 입력을 기다리는 중…</div>',
      `<div class="log-line">[정보] 플랫폼: ${platformNames[state.platform]}</div>`,
      `<div class="log-line">[정보] 수집 타입: ${collectionTypeNames[state.collectionType]}</div>`,
      `<div class="log-line">[정보] 정렬: ${sortNames[state.sort]}</div>`,
      `<div class="log-line">[정보] 페이지: ${pageNames[state.pages]}</div>`
    ];
    
    logBox.innerHTML = lines.join('');
  }

  function updateExpected() {
    const expectedInfo = document.getElementById('expected-info');
    if (!expectedInfo) return;
    
    const platformNames = ['네이버', '쿠팡'];
    const collectionTypeNames = ['리뷰 수집', 'Q&A 수집', '리뷰 + Q&A 수집'];
    const sortNames = ['랭킹순', '최신순', '평점낮은순'];
    const pageNames = ['5', '15', '50', 'max', '직접 입력'];
    
    expectedInfo.textContent = 
      `페이지 ${pageNames[state.pages]} · 정렬 ${sortNames[state.sort]} · 플랫폼 ${platformNames[state.platform]} · ${collectionTypeNames[state.collectionType]}`;
  }

  function addLog(message, className = '') {
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    
    const line = document.createElement('div');
    line.className = `log-line ${className}`;
    line.textContent = message;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // 상태 메시지 표시 함수
  function showStatusMessage(message, type = 'info') {
    const statusBox = document.getElementById('status-message-box');
    const statusContent = document.getElementById('status-message-content');
    
    if (!statusBox || !statusContent) return;
    
    // 기존 타입 클래스 제거
    statusBox.classList.remove('info', 'success', 'warning', 'error');
    // 새 타입 클래스 추가
    statusBox.classList.add(type);
    
    statusContent.textContent = message;
    statusBox.style.display = 'block';
    
    // 상태 메시지는 사라지지 않음
  }

  // 상태 메시지 숨기기 함수
  function hideStatusMessage() {
    const statusBox = document.getElementById('status-message-box');
    if (statusBox) {
      statusBox.style.display = 'none';
    }
  }

  // 커스텀 모달 함수
  function showModal(message) {
    const modal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalOk = document.getElementById('modal-ok');
    
    if (!modal || !modalMessage || !modalOk) return;
    
    modalMessage.textContent = message;
    modal.style.display = 'flex';
    
    modalOk.onclick = () => {
      modal.style.display = 'none';
    };
    
    // 배경 클릭 시 닫기
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // IP 주소 가져오기
  async function fetchUserIP() {
    const userIpElement = document.getElementById('user-ip');
    if (!userIpElement) return;
    
    try {
      // 여러 API를 시도 (하나가 실패하면 다음으로)
      const apis = [
        { url: 'https://api.ipify.org?format=json', type: 'json' },
        { url: 'https://api.ip.sb/ip', type: 'text' },
        { url: 'https://ifconfig.me/ip', type: 'text' },
      ];
      
      let ip = null;
      
      for (const api of apis) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(api.url, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (api.type === 'json') {
            const data = await response.json();
            ip = data.ip;
          } else {
            ip = await response.text();
            ip = ip.trim();
          }
          
          if (ip) break;
        } catch (error) {
          console.log(`[Renderer] IP API 실패 (${api.url}):`, error.message);
          continue;
        }
      }
      
      if (ip) {
        userIpElement.textContent = `ip: ${ip}`;
      } else {
        userIpElement.textContent = 'ip: 확인 불가';
      }
    } catch (error) {
      console.error('[Renderer] IP 가져오기 오류:', error);
      userIpElement.textContent = 'ip: 확인 불가';
    }
  }

  // 초기화: sort 드롭다운의 현재 값을 state에 반영
  if (sortSelect) {
    state.sort = parseInt(sortSelect.value) || 0;
    const sortNames = ['랭킹순', '최신순', '평점낮은순'];
    console.log('[Renderer] 초기 sort 값:', state.sort, `(${sortNames[state.sort]})`);
  }
  
  // 초기화: Q&A 수집이 선택되어 있으면 정렬 드롭다운 숨기고 체크박스 표시
  if (state.collectionType === 1) {
    if (sortSelect) {
      sortSelect.style.display = 'none';
    }
    if (excludeSecretGroup) {
      excludeSecretGroup.style.display = 'flex';
    }
  }
  
  // 초기화
  updateExpected();
  updateLog();
  fetchUserIP(); // IP 주소 로드
});
