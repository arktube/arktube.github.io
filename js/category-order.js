// js/category-order.js v3.2
// 스펙: 왼쪽(현재 순서)에서 탭→오른쪽(새 순서)로 이동. 오른쪽 탭→왼쪽으로 복귀.
// 저장: 최종 = 오른쪽(새 순서) + 왼쪽(남은 순서 그대로) → index.html 이동
import { CATEGORY_GROUPS } from './categories.js?v=1.5.1';

const GROUP_ORDER_KEY = 'groupOrderV1';
const listLeft  = document.getElementById('listLeft');   // 현재 순서(남은 것들)
const listRight = document.getElementById('listRight');  // 새 순서(탭 순서대로 쌓임)

const keyToLabel   = new Map(CATEGORY_GROUPS.map(g => [g.key, g.label]));
const defaultOrder = CATEGORY_GROUPS.map(g => g.key);

let baseOrder = []; // 저장된 '기준 순서' (병합 후 결과)
let leftKeys  = []; // 아직 안 옮긴 것들(왼쪽)
let rightKeys = []; // 새 순서(오른쪽)

// --- 저장된 순서와 최신 카테고리를 병합 ---
// 1) 저장값에서 유효한 키만 남기고
// 2) 누락된 최신 키는 기본(defaultOrder) 순서를 최대한 보존하며 삽입
// 3) 새로 등장한 'series'는 'personal' 바로 앞에 기본 배치
function mergeSavedWithDefaults(savedArr, defaults) {
  const defaultSet = new Set(defaults);
  const savedClean = Array.isArray(savedArr) ? savedArr.filter(k => defaultSet.has(k)) : [];

  // 기본 순서를 최대한 보존하며 누락 키를 채워 넣기
  const result = savedClean.slice();
  for (const k of defaults) {
    if (!result.includes(k)) {
      // k 다음에 오는 기본 키들 중, result에 이미 있는 첫 키 앞에 삽입
      const start = defaults.indexOf(k) + 1;
      const nextExisting = defaults.slice(start).find(next => result.includes(next));
      if (nextExisting) {
        const pos = result.indexOf(nextExisting);
        result.splice(pos, 0, k);
      } else {
        result.push(k);
      }
    }
  }

  // 'series'가 이번에 새로 들어온 경우, 'personal' 바로 앞에 위치시키기
  // (사용자가 기존에 series를 저장해둔 경우는 그대로 존중)
  if (!savedClean.includes('series')) {
    const iSeries   = result.indexOf('series');
    const iPersonal = result.indexOf('personal');
    if (iSeries !== -1 && iPersonal !== -1 && iSeries > iPersonal) {
      result.splice(iSeries, 1);                 // series 제거
      const insertAt = result.indexOf('personal');
      result.splice(insertAt, 0, 'series');      // personal 앞에 삽입
    }
  }

  return result;
}

function loadSavedOrder(){
  try{
    const raw = localStorage.getItem(GROUP_ORDER_KEY);
    const arr = JSON.parse(raw || 'null');
    return mergeSavedWithDefaults(arr, defaultOrder);
  }catch{
    return defaultOrder.slice();
  }
}

function saveOrder(keys){
  localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(keys));
}

function render(){
  // 왼쪽
  listLeft.innerHTML = '';
  leftKeys.forEach(k=>{
    const el = document.createElement('div');
    el.className = 'item';
    el.textContent = keyToLabel.get(k) || k;
    el.dataset.key = k;
    el.addEventListener('click', ()=> moveLeftToRight(k), { passive:true });
    listLeft.appendChild(el);
  });

  // 오른쪽
  listRight.innerHTML = '';
  rightKeys.forEach(k=>{
    const el = document.createElement('div');
    el.className = 'item';
    el.textContent = keyToLabel.get(k) || k;
    el.dataset.key = k;
    el.addEventListener('click', ()=> moveRightToLeft(k), { passive:true });
    listRight.appendChild(el);
  });
}

function moveLeftToRight(key){
  const i = leftKeys.indexOf(key);
  if (i < 0) return;
  leftKeys.splice(i,1);
  if (!rightKeys.includes(key)) rightKeys.push(key); // 중복 방지
  render();
}

function moveRightToLeft(key){
  const i = rightKeys.indexOf(key);
  if (i < 0) return;
  rightKeys.splice(i,1);

  if (!leftKeys.includes(key)) {
    // baseOrder에서의 상대 위치를 유지하며 왼쪽으로 복귀
    const baseIdx = baseOrder.indexOf(key);
    let insertAt = leftKeys.length; // 기본은 맨 끝
    for (let j = 0; j < leftKeys.length; j++) {
      const curBase = baseOrder.indexOf(leftKeys[j]);
      if (curBase > baseIdx) { insertAt = j; break; }
    }
    leftKeys.splice(insertAt, 0, key);
  }
  render();
}

function resetFromSaved(){
  baseOrder = loadSavedOrder();   // 기준 순서(= 병합 결과)
  leftKeys  = baseOrder.slice();  // 모두 왼쪽으로
  rightKeys = [];                 // 오른쪽 비움
  render();
}

// 버튼
document.getElementById('btnReset')?.addEventListener('click', resetFromSaved);
document.getElementById('btnSave') ?.addEventListener('click', ()=>{
  // 최종 = 오른쪽(새 순서) + 왼쪽(남은 순서 그대로)
  const finalOrder = rightKeys.concat(leftKeys);
  if (!finalOrder.length) { alert('순서를 비울 수 없습니다.'); return; }
  saveOrder(finalOrder);
  location.href = 'index.html';
});

// 초기화
resetFromSaved();

// End of js/category-order.js v3.2
