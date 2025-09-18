// js/youtube-utils.js (ArkTube)
// - YouTube URL 판별/파싱 유틸
// - 결과: { ok:boolean, type:'shorts'|'video'|null, id:string|null, reason?:string }

function _isYouTubeHost(host) {
  const h = (host || '').toLowerCase();
  return h === 'youtu.be' || h === 'www.youtube.com' || h === 'youtube.com';
}

// https 전용 + youtube 도메인만 허용
export function isAllowedYouTube(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return _isYouTubeHost(u.hostname);
  } catch {
    return false;
  }
}

export function parseYouTube(url) {
  try {
    const u = new URL(url);
    if (!_isYouTubeHost(u.hostname)) {
      return { ok:false, type:null, id:null, reason:'not_youtube' };
    }

    // shorts
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.split('/')[2] || '';
      if (!id) return { ok:false, type:null, id:null, reason:'no_id' };
      return { ok:true, type:'shorts', id };
    }

    // watch?v=
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

    // /embed/<id> 도 일반 영상으로 취급
    const m = u.pathname.match(/\/embed\/([^/?#]+)/);
    if (m && m[1]) {
      return { ok:true, type:'video', id: m[1] };
    }

    return { ok:false, type:null, id:null, reason:'unknown_pattern' };
  } catch {
    return { ok:false, type:null, id:null, reason:'bad_url' };
  }
}
