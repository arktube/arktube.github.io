// /js/resume.js  — ArkTube v0.1 호환 겸용 버전
// - 당신 버전의 구조/이름 유지 + watch.js 호환 API (updateFromInfo / chooseNextInSeries / set|getSeriesHint) 추가
// - 전역 postMessage 리스너는 attachYTTracker()가 처음 호출될 때 1회만 바인딩

const NS = 'arktube:prog:v1:';
const SPFX_SERIES = 'arktube:series:v1:'; // 시리즈 힌트 저장 (마지막 본 영상 등)

/* ========= 공용 유틸 ========= */
const nowSec = () => Math.floor(Date.now()/1000);
const clamp  = (n,min,max)=> Math.max(min, Math.min(max, n));

/** 저장: posSec, durSec(초), completed, url 포함 (기존 merge 방식 유지) */
export function saveProgress(videoId, data) {
  if (!videoId) return;
  const now = nowSec();
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

/** 진행도 삭제(보조) */
export function clearProgress(videoId){
  try { localStorage.removeItem(NS + videoId); } catch {}
}

/** 시작 위치: completed면 0, 아니면 posSec(5초 미만이면 0) */
export function pickStartPos(videoId) {
  const p = getProgress(videoId);
  if (!p) return 0;
  if (p.completed) return 0;
  return (p.posSec && p.posSec >= 5) ? p.posSec : 0;
}

/** 완주 기준 */
export function isCompleted(pos, dur) {
  if (!dur || dur <= 0) return false;
  const gate = Math.max(dur * 0.9, dur - 30);
  return pos >= gate;
}

/** 큐(등록순 asc 또는 최신순 desc)에서 이어보기 시작 인덱스 선택 */
export function chooseResumeIndex(queue) {
  // 1순위: 미완 진행중(pos>=5) 최신(updatedAt)
  let candidate = -1, latestTs = -1;
  for (let i=0;i<queue.length;i++){
    const v = queue[i]; const p = getProgress(v.videoId);
    if (p && !p.completed && (p.posSec||0) >= 5) {
      if ((p.updatedAt||0) > latestTs) { latestTs = p.updatedAt; candidate = i; }
    }
  }
  if (candidate >= 0) return candidate;

  // 2순위: 마지막 완료 다음
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

/* ========= (추가) 시리즈 힌트 API — watch.js 호환 ========= */
export function setSeriesHint(seriesKey, { lastVideoId=null, lastIndex=null }={}){
  if(!seriesKey) return;
  const v = { lastVideoId: lastVideoId || null, lastIndex: (Number(lastIndex)||0), updatedAt: nowSec() };
  try{ localStorage.setItem(SPFX_SERIES + seriesKey, JSON.stringify(v)); }catch{}
}
export function getSeriesHint(seriesKey){
  try{
    const raw = localStorage.getItem(SPFX_SERIES + seriesKey);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}

/** (추가) 시리즈 이어보기 선택 — watch.js가 기대하는 시그니처 */
export function chooseNextInSeries(seriesKey, docsAsc){
  // docsAsc: [{ id, url }, ... ]  // 등록순 asc
  if(!Array.isArray(docsAsc) || docsAsc.length===0){
    return { targetId:null, startPosSec:0, targetIndex:0 };
  }

  // 1) 진행 중(미완 + pos>=5)
  for(let i=0;i<docsAsc.length;i++){
    const d = docsAsc[i];
    const p = getProgress(d.id);
    if(p && !p.completed && (p.posSec||0) >= 5){
      return { targetId:d.id, startPosSec:p.posSec||0, targetIndex:i };
    }
  }

  // 2) 시리즈 힌트 있으면 그 다음 인덱스
  const hint = seriesKey ? getSeriesHint(seriesKey) : null;
  if(hint?.lastVideoId){
    const at = docsAsc.findIndex(x=> x.id===hint.lastVideoId);
    if(at>=0){
      const next = Math.min(docsAsc.length-1, at+1);
      return { targetId: docsAsc[next].id, startPosSec:0, targetIndex: next };
    }
  }

  // 2') 힌트가 없으면 마지막 completed의 다음
  let lastDone = -1;
  for(let i=0;i<docsAsc.length;i++){
    const p = getProgress(docsAsc[i].id);
    if(p?.completed) lastDone = i;
  }
  if(lastDone>=0 && lastDone < docsAsc.length-1){
    return { targetId: docsAsc[lastDone+1].id, startPosSec:0, targetIndex:lastDone+1 };
  }

  // 3) 첫 영상
  return { targetId: docsAsc[0].id, startPosSec:0, targetIndex:0 };
}

/* ========= (추가) watch.js 호환: updateFromInfo(videoId, url, info) =========
   - watch.js가 postMessage를 직접 수신할 때 이 함수로 저장 위임 */
const _lastWrite = new Map(); // videoId -> epoch sec
export function updateFromInfo(videoId, url, info){
  if(!videoId || !info) return;
  const pos = Math.floor(Number(info.currentTime)||0);
  const dur = Math.floor(Number(info.duration)||0);
  const t   = nowSec();
  const prevT = _lastWrite.get(videoId) || 0;

  const ended = (info.playerState === 0); // ENDED
  const throttled = (t - prevT >= 10) || ended;

  if(!throttled) return;

  const done = ended || isCompleted(pos, dur);
  const posToSave = done ? 0 : pos;
  saveProgress(videoId, { posSec: posToSave, durSec: dur, completed: !!done, url: url || null });
  _lastWrite.set(videoId, t);
}

/* ========= YouTube postMessage 기반(당신 버전 유지) ========= */

const PLAYER_STATE = { ENDED:0, PLAYING:1, PAUSED:2, BUFFERING:3, CUED:5 };
const trackers = new Map(); // iframe.contentWindow -> tracker
let pmBound = false;        // 전역 message 리스너 중복 바인딩 방지

function _bindGlobalPM(){
  if(pmBound) return; pmBound = true;
  window.addEventListener('message', (e)=>{
    let data = e.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = null; }
    }
    if (!data) return;

    const cw = e.source;
    const t = trackers.get(cw);
    if (!t) return;

    if (data.info) {
      if (typeof data.info.currentTime === 'number') t.lastPos = data.info.currentTime;
      if (typeof data.info.duration === 'number')     t.duration = data.info.duration;

      const now = nowSec();
      if (now - (t.lastFlush||0) >= t.throttleSec) {
        saveProgress(t.videoId, {
          posSec: Math.floor(t.lastPos||0),
          durSec: Math.floor(t.duration||0),
          completed: false,
          url: t.url||null
        });
        t.lastFlush = now;
      }
    }

    if (data.event === 'onStateChange') {
      const s = data.info;
      if (s === PLAYER_STATE.PLAYING) {
        t.playing = true;
      } else if (s === PLAYER_STATE.PAUSED) {
        saveProgress(t.videoId, {
          posSec: Math.floor(t.lastPos||0),
          durSec: Math.floor(t.duration||0),
          completed: false,
          url: t.url||null
        });
      } else if (s === PLAYER_STATE.ENDED) {
        saveProgress(t.videoId, {
          posSec: 0,
          durSec: Math.floor(t.duration||0),
          completed: true,
          url: t.url||null
        });
      }
    }
  }, false);
}

/** postMessage 명령 송신 */
function _sendCmd(iframe, func, args=[]) {
  if (!iframe?.contentWindow) return;
  const msg = JSON.stringify({ event: 'command', func, args });
  iframe.contentWindow.postMessage(msg, '*');
}
function _addEvt(iframe, evt) {
  if (!iframe?.contentWindow) return;
  const msg = JSON.stringify({ event: 'command', func: 'addEventListener', args: [evt] });
  iframe.contentWindow.postMessage(msg, '*');
}

/** (유지) iframe에 진행도 트래커 부착 — 당신 버전 API */
export function attachYTTracker(iframe, { videoId, url, throttleSec=10 }){
  if (!iframe || !videoId) return;
  _bindGlobalPM();

  const state = {
    videoId, url: url || null,
    lastPos: 0, duration: 0,
    lastFlush: 0,
    playing: false,
    throttleSec: Math.max(3, Math.floor(throttleSec)||10),
  };
  trackers.set(iframe.contentWindow, state);

  function handshake() {
    try {
      const msg = JSON.stringify({ event: 'listening' });
      iframe.contentWindow.postMessage(msg, '*');
      _addEvt(iframe, 'onStateChange');
      _addEvt(iframe, 'onPlaybackRateChange');
      _addEvt(iframe, 'onPlaybackQualityChange');
      // infoDelivery는 자동 푸시됨
    } catch {}
  }
  if (iframe.contentWindow) {
    setTimeout(handshake, 300);
  } else {
    iframe.addEventListener('load', ()=> setTimeout(handshake, 300), { once:true });
  }
}

/* (유지) 보조 제어 함수들 */
export function play(iframe){ _sendCmd(iframe, 'playVideo'); }
export function pause(iframe){ _sendCmd(iframe, 'pauseVideo'); }
export function seekTo(iframe, seconds){ _sendCmd(iframe, 'seekTo', [seconds, true]); }
export function mute(iframe){ _sendCmd(iframe, 'mute'); }
export function unMute(iframe){ _sendCmd(iframe, 'unMute'); }
