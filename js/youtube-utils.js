// js/youtube-utils.js  (ArkTube)
// - YouTube URL 판별/파싱 유틸
// - 결과: { ok:boolean, type:'shorts'|'video'|null, id:string|null, reason?:string }

function isYouTubeHost(host) {
  const h = (host || '').toLowerCase();
  return h === 'youtu.be' || h === 'www.youtube.com' || h === 'youtube.com';
}

export function parseYouTube(url) {
  try {
    const u = new URL(url);
    if (!isYouTubeHost(u.hostname)) {
      return { ok:false, type:null, id:null, reason:'not_youtube' };
    }

    // shorts
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.split('/')[2] || '';
      if (!id) return { ok:false, type:null, id:null, reason:'no_id' };
      return { ok:true, type:'shorts', id };
    }

    // www.youtube.com/watch?v=...
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v') || '';
      if (!id) return { ok:false, type:null, id:null, reason:'no_id' };
      return { ok:true, type:'video', id };
    }

    // youtu.be/<id>
    if (u.hostname.toLowerCase() === 'youtu.be') {
      const id = (u.pathname || '').replace(/^\/+/, '');
      if (!id) return { ok:false, type:null, id:null, reason:'no_id' };
      return { ok:true, type:'video', id };
    }

    // 임베드 등 기타 경로는 보수적으로 일반 영상으로 처리 (id 있으면)
    const embedIdMatch = u.pathname.match(/\/embed\/([^/?#]+)/);
    if (embedIdMatch && embedIdMatch[1]) {
      return { ok:true, type:'video', id: embedIdMatch[1] };
    }

    return { ok:false, type:null, id:null, reason:'unknown_pattern' };
  } catch {
    return { ok:false, type:null, id:null, reason:'bad_url' };
  }
}

// 간단 화이트리스트(https + youtube 도메인만)
export function isAllowedYouTube(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return isYouTubeHost(u.hostname);
  } catch {
    return false;
  }
}
