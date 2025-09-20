// /js/resume.js
// ArkTube v0.1 — 공용 이어보기/진행도 모듈 (YouTube postMessage 기반)

const NS = 'arktube:prog:v1:';

/** 저장: posSec, durSec(초), completed, url 포함 */
export function saveProgress(videoId, data) {
  if (!videoId) return;
  const now = Math.floor(Date.now()/1000);
  const prev = getProgress(videoId) || {};
  const merged = {
    posSec: 0,
    durSec: 0,
    completed: false,
    url: null,
    ...prev,
    ...data,
    updatedAt: now,
  };
  try { localStorage.setItem(NS + videoId, JSON.stringify(merged)); } catch {}
}

/** 로드 */
export function getProgress(videoId) {
  if (!videoId) return null;
  try {
    const raw = localStorage.getItem(NS + videoId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** 시작 위치 선택: completed면 0, 아니면 저장된 posSec(5초 미만이면 0) */
export function pickStartPos(videoId) {
  const p = getProgress(videoId);
  if (!p) return 0;
  if (p.completed) return 0;
  return (p.posSec && p.posSec >= 5) ? p.posSec : 0;
}

/** 완주 여부 기준 */
export function isCompleted(pos, dur) {
  if (!dur || dur <= 0) return false;
  const gate = Math.max(dur * 0.9, dur - 30);
  return pos >= gate;
}

/** 큐(등록순 asc 또는 최신순 desc)와 진행도를 이용해 “이어보기 시작 인덱스”를 선택 */
export function chooseResumeIndex(queue) {
  // 1순위: 미완 진행중(pos>=5) 가장 최근(updatedAt) 항목
  let candidate = -1, latestTs = -1;
  for (let i=0;i<queue.length;i++){
    const v = queue[i]; const p = getProgress(v.videoId);
    if (p && !p.completed && (p.posSec||0) >= 5) {
      if ((p.updatedAt||0) > latestTs) { latestTs = p.updatedAt; candidate = i; }
    }
  }
  if (candidate >= 0) return candidate;

  // 2순위: 마지막 완료 다음 인덱스
  let lastDone = -1, doneTs = -1;
  for (let i=0;i<queue.length;i++){
    const v = queue[i]; const p = getProgress(v.videoId);
    if (p && p.completed) {
      if ((p.updatedAt||0) > doneTs) { doneTs = p.updatedAt; lastDone = i; }
    }
  }
  if (lastDone >= 0 && lastDone+1 < queue.length) return lastDone+1;

  // 3순위: 맨앞
  return 0;
}

/** ===== YouTube iframe postMessage 제어 =====
 *  - 외부 API 스크립트 없이 enablejsapi=1 + postMessage로 제어/정보 수집
 *  - 여러 플레이어를 동시에 추적 가능
 */
const PLAYER_STATE = { ENDED:0, PLAYING:1, PAUSED:2, BUFFERING:3, CUED:5 };
const trackers = new Map(); // iframe.contentWindow -> tracker

function sendCmd(iframe, func, args=[]) {
  if (!iframe?.contentWindow) return;
  const msg = JSON.stringify({ event: 'command', func, args });
  iframe.contentWindow.postMessage(msg, '*'); // 콘텐트가 yt 도메인이므로 '*' 사용
}

function addEvt(iframe, evt) {
  if (!iframe?.contentWindow) return;
  const msg = JSON.stringify({ event: 'command', func: 'addEventListener', args: [evt] });
  iframe.contentWindow.postMessage(msg, '*');
}

/** iframe에 진행도 트래커 부착 */
export function attachYTTracker(iframe, { videoId, url, throttleSec=10 }){
  if (!iframe || !videoId) return;

  const state = {
    videoId, url: url || null,
    lastPos: 0, duration: 0,
    lastFlush: 0,
    playing: false,
  };
  trackers.set(iframe.contentWindow, state);

  // YouTube와 수신 채널 초기화 (listening 핸드셰이크 + 이벤트 구독)
  function handshake() {
    try {
      const msg = JSON.stringify({ event: 'listening' });
      iframe.contentWindow.postMessage(msg, '*');
      addEvt(iframe, 'onStateChange');
      addEvt(iframe, 'onPlaybackRateChange');
      addEvt(iframe, 'onPlaybackQualityChange');
      // infoDelivery는 자동 푸시됨 (currentTime/duration 포함)
    } catch {}
  }

  // iframe 로드 뒤 약간 늦춰 핸드셰이크
  if (iframe.contentWindow) {
    setTimeout(handshake, 300);
  } else {
    iframe.addEventListener('load', ()=> setTimeout(handshake, 300), { once:true });
  }
}

/** 전역 postMessage 수신: infoDelivery / onStateChange 등을 수집 */
window.addEventListener('message', (e)=>{
  // YouTube에서 오는 message만 관심 (origin 체크는 다양한 서브도메인 가능성 있어 data 검사로 제한)
  let data = e.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  if (!data) return;

  const cw = e.source;
  const t = trackers.get(cw);
  if (!t) return;

  // infoDelivery로 currentTime/duration을 꾸준히 받음
  if (data.info) {
    if (typeof data.info.currentTime === 'number') t.lastPos = data.info.currentTime;
    if (typeof data.info.duration === 'number')     t.duration = data.info.duration;

    // 10초 스로틀 저장
    const now = Math.floor(Date.now()/1000);
    if (now - (t.lastFlush||0) >= 10) {
      saveProgress(t.videoId, { posSec: Math.floor(t.lastPos||0), durSec: Math.floor(t.duration||0), completed: false, url: t.url||null });
      t.lastFlush = now;
    }
  }

  // onStateChange
  if (data.event === 'onStateChange') {
    const s = data.info;
    if (s === PLAYER_STATE.PLAYING) {
      t.playing = true;
    } else if (s === PLAYER_STATE.PAUSED) {
      // 즉시 저장
      saveProgress(t.videoId, { posSec: Math.floor(t.lastPos||0), durSec: Math.floor(t.duration||0), completed: false, url: t.url||null });
    } else if (s === PLAYER_STATE.ENDED) {
      // 완주 처리: completed=true, pos=0 저장
      saveProgress(t.videoId, { posSec: 0, durSec: Math.floor(t.duration||0), completed: true, url: t.url||null });
    }
  }
});

/** 보조 컨트롤 */
export function play(iframe){ sendCmd(iframe, 'playVideo'); }
export function pause(iframe){ sendCmd(iframe, 'pauseVideo'); }
export function seekTo(iframe, seconds){ sendCmd(iframe, 'seekTo', [seconds, true]); }
export function mute(iframe){ sendCmd(iframe, 'mute'); }
export function unMute(iframe){ sendCmd(iframe, 'unMute'); }
