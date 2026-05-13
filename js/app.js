/**
 * app.js - YAMARメインコントローラ
 * 画面遷移・モジュール統合・イベント管理
 */

import { initDB, savePhoto, getAllPhotos, deletePhoto, getSetting, saveSetting } from './db.js';
import { startGPS, startCompass, getState, onSensorUpdate, simulateSensors } from './sensors.js';
import { loadMountainData, calculateVisibleMountains, setDisplayRange, getMountainCount } from './ar-engine.js';
import { initCamera, startRenderLoop, drawMountainLabels, drawCompass, capture, stopCamera, compositeImageWithLabels } from './camera.js';
import { initMap, updatePins, zoomIn, zoomOut, resetMapZoom } from './map.js';
import { extractExifData } from './exif.js';

// --- 状態管理 ---
let currentScreen = 'splash';
let visibleMountains = [];
let debugMode = false;
let displayRange = 50;
let lastCaptureBlobs = null;
let isDesktop = false;

// --- DOM要素のキャッシュ ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ==============================
// 初期化
// ==============================
async function init() {
  console.log('[YAMAR] 初期化開始...');

  // IndexedDB初期化
  await initDB();
  updateSplashStatus('データベース準備完了');

  // 山データ読み込み
  await loadMountainData('./data/mountains.json');
  updateSplashStatus(`${getMountainCount()} 座の山データ読み込み完了`);

  // 保存された設定を復元
  displayRange = await getSetting('displayRange', 50);
  debugMode = await getSetting('debugMode', false);
  setDisplayRange(displayRange);

  // 設定画面の初期値を反映
  const rangeSelect = $('#range-select');
  if (rangeSelect) rangeSelect.value = displayRange;
  const debugToggle = $('#debug-toggle');
  if (debugToggle && debugMode) debugToggle.classList.add('on');

  updateSplashStatus('準備完了！');

  // スタートボタンを表示
  const startBtn = $('#start-btn');
  if (startBtn) {
    startBtn.classList.add('show');
    startBtn.addEventListener('click', handleStart);
  }

  // タブバーのイベント
  $$('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => switchScreen(tab.dataset.screen));
  });

  // Service Worker登録
  registerServiceWorker();
}

/**
 * スプラッシュ画面のステータス更新
 */
function updateSplashStatus(text) {
  const el = $('#splash-status');
  if (el) el.textContent = text;
}

/**
 * スタートボタン押下時の処理
 * カメラ・GPS・コンパスの権限を取得してAR画面に遷移
 */
async function handleStart() {
  const btn = $('#start-btn');
  btn.textContent = '起動中...';
  btn.disabled = true;

  // カメラ起動
  updateSplashStatus('カメラを起動中...');
  const video = $('#camera-feed');
  const canvas = $('#ar-canvas');
  const camOk = await initCamera(video, canvas);

  if (!camOk) {
    updateSplashStatus('⚠️ カメラが利用できません');
    // デスクトップモードへフォールバック
    isDesktop = true;
  }

  // GPS起動
  updateSplashStatus('GPS を取得中...');
  const gpsOk = await startGPS();
  if (!gpsOk) {
    updateSplashStatus('⚠️ GPSが利用できません（デモモード）');
    isDesktop = true;
  }

  // コンパス起動（iOSではこのボタンクリック内で呼ぶ必要がある）
  updateSplashStatus('コンパスを起動中...');
  const compassOk = await startCompass();
  if (!compassOk) {
    isDesktop = true;
  }

  // デスクトップ環境またはコンパスが無い場合のフォールバック
  if (isDesktop || !compassOk) {
    // デモ体験のため、富士山が見える場所（河口湖付近）をシミュレート
    // 実際のGPS位置ではなく、山が確実に見えるロケーションを使用
    simulateSensors(35.5106, 138.7650, 860, 190, 90);
    isDesktop = true;
    updateSplashStatus('デモモードで起動します（←→キーで方角変更）');
  }

  // AR描画ループ開始
  startRenderLoop((ctx, w, h) => {
    const sensor = getState();
    // 山の計算
    visibleMountains = calculateVisibleMountains(
      sensor.lat, sensor.lng, sensor.altitude,
      sensor.heading, sensor.tilt,
      w, h
    );
    // コンパス描画
    drawCompass(ctx, sensor.heading, w);
    // 山ラベル描画
    drawMountainLabels(ctx, visibleMountains);
    // デバッグ情報更新
    updateDebugInfo(sensor);
    // 山の検出数表示更新
    updateMountainCount();
  });

  // AR画面に切り替え
  setTimeout(() => switchScreen('ar'), 500);
}

// ==============================
// 画面切り替え
// ==============================
function switchScreen(name) {
  // 全画面を非アクティブに
  $$('.screen').forEach(s => s.classList.remove('active'));
  // 対象画面をアクティブに
  const target = $(`#${name}-screen`);
  if (target) target.classList.add('active');

  // タブのアクティブ状態を更新
  $$('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.screen === name);
  });

  // タブバーの表示制御
  const tabBar = $('#tab-bar');
  if (tabBar) {
    tabBar.style.display = (name === 'splash' || name === 'preview') ? 'none' : 'flex';
  }

  currentScreen = name;

  // 画面固有の初期化
  if (name === 'gallery') loadGallery();
  if (name === 'map') loadMap();
  if (name === 'settings') initSettings();
}

// ==============================
// AR画面の機能
// ==============================

/**
 * デバッグ情報を更新する
 */
function updateDebugInfo(sensor) {
  const el = $('.ar-debug');
  if (!el) return;
  el.classList.toggle('show', debugMode);
  if (!debugMode) return;

  el.innerHTML = [
    `📍 ${sensor.lat.toFixed(5)}, ${sensor.lng.toFixed(5)}`,
    `🏔️ 標高: ${Math.round(sensor.altitude)}m`,
    `🧭 方角: ${Math.round(sensor.heading)}°`,
    `📐 傾き: ${Math.round(sensor.tilt)}°`,
    `⛰️ 検出: ${visibleMountains.length}座`,
    `📡 精度: ${Math.round(sensor.accuracy)}m`
  ].join('<br>');
}

/**
 * 山の検出数表示を更新
 */
function updateMountainCount() {
  const el = $('.mountain-count');
  if (el) el.textContent = `⛰️ ${visibleMountains.length} 座を検出中`;
}

/**
 * 撮影処理
 */
async function handleCapture() {
  // フラッシュ効果
  const flash = $('.flash-overlay');
  if (flash) {
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 300);
  }

  // 画像合成
  const sensor = getState();
  const blobs = await capture((ctx, w, h) => {
    drawCompass(ctx, sensor.heading, w);
    drawMountainLabels(ctx, visibleMountains);
  });

  if (!blobs) {
    showToast('撮影に失敗しました');
    return;
  }

  lastCaptureBlobs = blobs;

  // プレビュー画面に表示
  const previewImg = $('#preview-img');
  if (previewImg) {
    previewImg.src = URL.createObjectURL(blobs.full);
  }

  switchScreen('preview');
}

/**
 * 撮影プレビュー：保存
 */
async function handleSaveCapture() {
  if (!lastCaptureBlobs) return;

  const sensor = lastCaptureMetadata || getState();
  await savePhoto({
    imageBlob: lastCaptureBlobs.full,
    thumbnail: lastCaptureBlobs.thumb,
    lat: sensor.lat,
    lng: sensor.lng,
    altitude: sensor.altitude,
    heading: sensor.heading,
    mountains: sensor.mountains || visibleMountains.map(m => m.name)
  });

  showToast('📸 写真を保存しました');
  lastCaptureBlobs = null;
  lastCaptureMetadata = null;
  switchScreen('ar');
}

/**
 * 撮影プレビュー：破棄
 */
function handleDiscardCapture() {
  lastCaptureBlobs = null;
  switchScreen('ar');
}

/**
 * 距離フィルター切り替え
 */
function cycleRange() {
  const ranges = [10, 30, 50, 100];
  const idx = ranges.indexOf(displayRange);
  displayRange = ranges[(idx + 1) % ranges.length];
  setDisplayRange(displayRange);
  saveSetting('displayRange', displayRange);

  const badge = $('.range-badge');
  if (badge) badge.textContent = `📏 ${displayRange}km`;

  const rangeSelect = $('#range-select');
  if (rangeSelect) rangeSelect.value = displayRange;

  showToast(`表示範囲: ${displayRange}km`);
}

/**
 * 画像から山を特定する
 */
async function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  showToast('🔍 画像を解析中...');

  try {
    const exif = await extractExifData(file);
    console.log('[App] Exif解析結果:', exif);

    if (!exif || !exif.lat || !exif.lng) {
      showToast('⚠️ 位置情報が見つかりません');
      return;
    }

    // 方位がない場合はデフォルト180（南）
    const heading = exif.heading !== null ? exif.heading : 180;

    // その場所の山を計算（tiltは水平90°と仮定）
    // 計算用の仮想サイズ（実際の画像サイズに合わせるため compositeImageWithLabels 内で再計算されるが
    // ここではリスト取得のために標準的な比率を使用）
    const mountains = calculateVisibleMountains(
      exif.lat, exif.lng, 0, // 標高は不明のため0
      heading, 90,
      1280, 720
    );

    if (mountains.length === 0) {
      showToast('⛰️ 指定範囲内に山が見つかりませんでした');
      return;
    }

    // 画像とラベルを合成
    const blobs = await compositeImageWithLabels(file, mountains, heading);
    lastCaptureBlobs = blobs;

    // プレビュー表示
    const previewImg = $('#preview-img');
    if (previewImg) {
      previewImg.src = URL.createObjectURL(blobs.full);
    }
    
    // 特定に使用した情報を一時保存（保存時に使用）
    // getState()の代わりにこのデータを使うよう handleSaveCapture を調整
    lastCaptureMetadata = {
      lat: exif.lat,
      lng: exif.lng,
      altitude: 0,
      heading: heading,
      mountains: mountains.map(m => m.name)
    };

    switchScreen('preview');
    showToast(`⛰️ ${mountains.length} 座の山を特定しました`);

  } catch (err) {
    console.error('[App] 画像解析エラー:', err);
    showToast('⚠️ 画像の読み込みに失敗しました');
  } finally {
    // 同じファイルを再度選べるようにリセット
    e.target.value = '';
  }
}

let lastCaptureMetadata = null;

// ==============================
// ギャラリー画面
// ==============================
async function loadGallery() {
  const grid = $('.gallery-grid');
  const empty = $('.gallery-empty');
  const countEl = $('.gallery-count');
  if (!grid) return;

  const photos = await getAllPhotos();

  if (countEl) countEl.textContent = `${photos.length} 枚の記録`;

  if (photos.length === 0) {
    grid.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }

  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';

  grid.innerHTML = '';
  for (const photo of photos) {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    const img = document.createElement('img');
    img.src = URL.createObjectURL(photo.thumbnail || photo.imageBlob);
    img.alt = '撮影写真';
    item.appendChild(img);

    const date = document.createElement('div');
    date.className = 'gallery-date';
    const d = new Date(photo.timestamp);
    date.textContent = `${d.getMonth()+1}/${d.getDate()}`;
    item.appendChild(date);

    item.addEventListener('click', () => showPhotoModal(photo));
    grid.appendChild(item);
  }
}

/**
 * 写真詳細モーダルを表示
 */
function showPhotoModal(photo) {
  const modal = $('.photo-modal');
  if (!modal) return;

  const img = $('#modal-img');
  if (img) img.src = URL.createObjectURL(photo.imageBlob);

  const d = new Date(photo.timestamp);
  const dateStr = `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  $('#modal-date').textContent = dateStr;
  $('#modal-location').textContent = photo.lat ? `${photo.lat.toFixed(4)}, ${photo.lng.toFixed(4)}` : '不明';
  $('#modal-altitude').textContent = photo.altitude ? `${Math.round(photo.altitude)}m` : '不明';
  $('#modal-heading').textContent = photo.heading ? `${Math.round(photo.heading)}°` : '不明';
  $('#modal-mountains').textContent = photo.mountains?.length ? photo.mountains.join(', ') : 'なし';

  // 削除ボタン
  const delBtn = $('#modal-delete-btn');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm('この写真を削除しますか？')) {
        await deletePhoto(photo.id);
        modal.classList.remove('show');
        loadGallery();
        showToast('写真を削除しました');
      }
    };
  }

  modal.classList.add('show');
}

// ==============================
// マップ画面
// ==============================
let mapInitialized = false;

async function loadMap() {
  const container = $('.map-container');
  if (!container) return;

  if (!mapInitialized) {
    initMap(container, (photo) => showPhotoModal(photo));
    mapInitialized = true;

    // ズームボタンのイベント
    $('#map-zoom-in')?.addEventListener('click', zoomIn);
    $('#map-zoom-out')?.addEventListener('click', zoomOut);
    $('#map-reset')?.addEventListener('click', resetMapZoom);
  }

  const photos = await getAllPhotos();
  updatePins(photos);
}

// ==============================
// 設定画面
// ==============================
function initSettings() {
  const rangeSelect = $('#range-select');
  if (rangeSelect) {
    rangeSelect.value = displayRange;
    rangeSelect.onchange = (e) => {
      displayRange = parseInt(e.target.value);
      setDisplayRange(displayRange);
      saveSetting('displayRange', displayRange);
      const badge = $('.range-badge');
      if (badge) badge.textContent = `📏 ${displayRange}km`;
    };
  }

  const debugToggle = $('#debug-toggle');
  if (debugToggle) {
    debugToggle.classList.toggle('on', debugMode);
    debugToggle.onclick = () => {
      debugMode = !debugMode;
      debugToggle.classList.toggle('on', debugMode);
      saveSetting('debugMode', debugMode);
    };
  }
}

// ==============================
// ユーティリティ
// ==============================

/**
 * トースト通知を表示
 */
function showToast(message) {
  let toast = $('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/**
 * Service Worker を登録
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[SW] 登録完了:', reg.scope);
    } catch (err) {
      console.warn('[SW] 登録失敗:', err);
    }
  }
}

// ==============================
// イベントバインド
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  init();

  // 撮影ボタン
  $('#capture-btn')?.addEventListener('click', handleCapture);

  // 画像から特定ボタン
  $('#upload-trigger-btn')?.addEventListener('click', () => {
    $('#photo-upload-input').click();
  });
  $('#photo-upload-input')?.addEventListener('change', handlePhotoUpload);

  // プレビュー画面のボタン
  $('#save-btn')?.addEventListener('click', handleSaveCapture);
  $('#discard-btn')?.addEventListener('click', handleDiscardCapture);

  // 距離フィルターバッジ
  $('.range-badge')?.addEventListener('click', cycleRange);

  // デバッグ表示トグル（AR画面の山カウントバッジをダブルタップ）
  $('.mountain-count')?.addEventListener('dblclick', () => {
    debugMode = !debugMode;
    saveSetting('debugMode', debugMode);
  });

  // モーダルの閉じるボタン
  $('#modal-close')?.addEventListener('click', () => {
    $('.photo-modal')?.classList.remove('show');
  });

  // デスクトップ用のデモ操作（キーボードで方向を変更）
  document.addEventListener('keydown', (e) => {
    if (!isDesktop) return;
    const s = getState();
    if (e.key === 'ArrowLeft') simulateSensors(s.lat, s.lng, s.altitude, (s.heading - 5 + 360) % 360, s.tilt);
    if (e.key === 'ArrowRight') simulateSensors(s.lat, s.lng, s.altitude, (s.heading + 5) % 360, s.tilt);
    if (e.key === 'ArrowUp') simulateSensors(s.lat, s.lng, s.altitude + 50, s.heading, s.tilt);
    if (e.key === 'ArrowDown') simulateSensors(s.lat, s.lng, Math.max(0, s.altitude - 50), s.heading, s.tilt);
  });
});
