// /js/urlfind.js  (ES Module)
const API_KEY = 'AIzaSyCrYgDIosyzvXfWfaGWzF3-Mnri6Sy6vQQ'; // ← 제공해주신 키

// 유틸
const byId = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getPlaylistId(url) {
  const m = String(url || '').match(/[?&]list=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchAllPlaylistItemIds(playlistId) {
  let ids = [];
  let nextPageToken = null;

  do {
    const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    u.searchParams.set('part', 'contentDetails');
    u.searchParams.set('maxResults', '50');
    u.searchParams.set('playlistId', playlistId);
    u.searchParams.set('key', API_KEY);
    if (nextPageToken) u.searchParams.set('pageToken', nextPageToken);

    const res = await fetch(u.toString());
    const data = await res.json();
    if (!res.ok || data?.error) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const pageIds = (data.items || [])
      .map(it => it?.contentDetails?.videoId)
      .filter(Boolean);

    ids = ids.concat(pageIds);
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);

  return ids;
}

function buildUrls(ids, shortForm) {
  return ids.map(id => shortForm ? `https://youtu.be/${id}` : `https://www.youtube.com/watch?v=${id}`);
}

function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// ---- 모달 모드 (upload.html 내부) ----
function initModalMode() {
  const dlg = byId('dlg-urlfind');
  const menuBtn = byId('menu-playlist-url');
  if (!dlg || !menuBtn) return false;

  const el = {
    url: byId('uf_playlistUrl'),
    short: byId('uf_useShortUrl'),
    extract: byId('uf_extractBtn'),
    copy: byId('uf_copyBtn'),
    dl: byId('uf_downloadBtn'),
    loading: byId('uf_loading'),
    result: byId('uf_result'),
  };

  menuBtn.addEventListener('click', () => {
    dlg.showModal();
    el.url?.focus();
  });

  el.extract?.addEventListener('click', async () => {
    const purl = el.url?.value?.trim();
    if (!purl) return alert('재생목록 URL을 입력해주세요.');
    const pid = getPlaylistId(purl);
    if (!pid) return alert('유효한 재생목록 URL이 아닙니다.');

    el.result.value = '';
    el.loading.classList.remove('hidden');
    el.extract.disabled = true;

    try {
      const ids = await fetchAllPlaylistItemIds(pid);
      const urls = buildUrls(ids, !!el.short?.checked);
      el.result.value = urls.join('\n');
    } catch (e) {
      console.error(e);
      alert(`오류가 발생했습니다: ${e.message}`);
    } finally {
      el.loading.classList.add('hidden');
      el.extract.disabled = false;
    }
  });

  el.copy?.addEventListener('click', async () => {
    if (!el.result.value) return;
    await navigator.clipboard.writeText(el.result.value);
    el.copy.textContent = '복사됨!';
    await sleep(800);
    el.copy.textContent = '클립보드 복사';
  });

  el.dl?.addEventListener('click', () => {
    if (!el.result.value) return;
    downloadTxt('playlist_urls.txt', el.result.value);
  });

  return true;
}

// ---- 독립 페이지 모드 (urlfind.html 등) ----
function initStandalonePage() {
  const urlInput  = byId('playlistUrl') || byId('uf_playlistUrl');
  const extractBtn= byId('extractBtn')  || byId('uf_extractBtn');
  const result    = byId('result')      || byId('uf_result');
  const loading   = byId('loading')     || byId('uf_loading');
  const shortChk  = byId('useShortUrl') || byId('uf_useShortUrl');

  if (!urlInput || !extractBtn || !result) return false;

  extractBtn.addEventListener('click', async () => {
    const purl = urlInput.value.trim();
    if (!purl) return alert('재생목록 URL을 입력해주세요.');
    const pid = getPlaylistId(purl);
    if (!pid) return alert('유효한 재생목록 URL이 아닙니다.');

    result.value = '';
    loading?.classList.remove('hidden');
    extractBtn.disabled = true;

    try {
      const ids = await fetchAllPlaylistItemIds(pid);
      const urls = buildUrls(ids, !!shortChk?.checked);
      result.value = urls.join('\n');
    } catch (e) {
      console.error(e);
      alert(`오류가 발생했습니다: ${e.message}`);
    } finally {
      loading?.classList.add('hidden');
      extractBtn.disabled = false;
    }
  });

  return true;
}

// 엔트리: 모달 있으면 모달 모드, 아니면 독립페이지 모드
(() => {
  if (initModalMode()) return;
  initStandalonePage();
})();
