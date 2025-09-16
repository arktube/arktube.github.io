/* sw.js — ArkTube PWA Service Worker */
const SW_VERSION = 'arktube-sw-v1.0.0';
const PRECACHE = `${SW_VERSION}-precache`;
const RUNTIME = `${SW_VERSION}-runtime`;

const OFFLINE_URL = '/offline.html';

/** 필수 앱 셸 자산 (경로는 / 가 루트, 필요시 변경) */
const PRECACHE_URLS = [
  '/',                     // 리다이렉트/루트
  '/index.html',
  OFFLINE_URL,
  '/manifest.json',

  // 핵심 스타일/스크립트 (있으면 자동 캐시, 없으면 무시됨)
  '/css/style.css',
  '/js/index.js',

  // 로고/아이콘 세트
  '/image/arktube_icon_32.png',
  '/image/arktube_icon_192.png',
  '/image/arktube_192.png',
  '/image/arktube_512.png',
  '/image/arktube_side.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PRECACHE).then(cache => cache.addAll(PRECACHE_URLS).catch(() => null))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 오래된 캐시 정리
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => ![PRECACHE, RUNTIME].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/** 유틸: 오프라인 HTML Fallback (offline.html 캐시에 없으면 임시 생성) */
function offlineFallbackResponse(requestUrl) {
  const html = `<!doctype html>
<html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>오프라인 - ArkTube</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; background:#000; color:#fff; display:grid; min-height:100vh; place-items:center;}
  .card{max-width:640px; padding:24px; border:1px solid #222; border-radius:16px; background:#111;}
  h1{margin:0 0 8px;font-size:22px}
  p{opacity:.85; line-height:1.6}
  .hint{margin-top:12px; font-size:14px; opacity:.7}
</style>
<div class="card">
  <h1>오프라인 상태입니다</h1>
  <p>네트워크 연결이 없어 <strong>${requestUrl}</strong> 을(를) 불러올 수 없습니다.</p>
  <p class="hint">연결이 복구되면 자동으로 최신 콘텐츠를 가져옵니다.</p>
</div></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** 캐싱 규칙
 * - Navigation(HTML): network-first → 실패 시 offline.html → 임시 HTML
 * - 정적 자산(CSS/JS/IMG/Font): stale-while-revalidate
 * - 영상(video/audio): 스트리밍 안전 위해 네트워크 패스스루(무캐시)
 * - firebase/firestore/gstatic/googleapis: 네트워크 패스스루(무캐시)
 */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 크로스오리진의 Firebase/Firestore/Google 계열은 캐시 우회
  const thirdPartyBypass = (
    /firebase(?:io)?\.com$/.test(url.hostname) ||
    /googleapis\.com$/.test(url.hostname) ||
    /gstatic\.com$/.test(url.hostname)
  );

  // Range 요청(비디오 시킹 등)은 그대로 네트워크
  const isRange = req.headers.has('range');

  // 동영상/오디오/스트리밍/바이너리 등은 캐시하지 않음
  const isMedia = ['video', 'audio'].includes(req.destination) ||
                  /\.(mp4|webm|ogg|mp3|wav|m4a)(\?.*)?$/i.test(url.pathname);

  if (req.method !== 'GET' || thirdPartyBypass || isRange || isMedia) {
    event.respondWith(fetch(req).catch(() => {
      // 네비게이션일 때만 오프라인 HTML 제공
      if (req.mode === 'navigate') return caches.match(OFFLINE_URL).then(r => r || offlineFallbackResponse(url.href));
      return new Response('', { status: 503, statusText: 'Offline' });
    }));
    return;
  }

  // HTML 네비게이션: 네트워크 우선
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        // 성공 시 복제 저장
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        // 오프라인: offline.html → 임시 HTML
        const cached = await caches.match(req) || await caches.match(OFFLINE_URL);
        return cached || offlineFallbackResponse(url.href);
      }
    })());
    return;
  }

  // 정적 파일: Stale-While-Revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then(networkRes => {
      // 성공 응답만 캐시
      if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
        cache.put(req, networkRes.clone());
      }
      return networkRes;
    }).catch(() => null);

    // 캐시가 있으면 즉시, 없으면 네트워크 결과
    return cached || (await fetchPromise) || new Response('', { status: 503, statusText: 'Offline' });
  })());
});

/** 선택: 메시지 핸들러 (버전 업데이트 시 페이지에서 스킵/클레임 호출 가능) */
self.addEventListener('message', event => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
});
