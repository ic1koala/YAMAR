/**
 * ar-engine.js - 山座同定ARエンジン
 * GPS座標とコンパス方位から、各山の画面上の位置を計算する
 */

// 地球の半径（メートル）
const EARTH_RADIUS = 6371000;

// 度 → ラジアン変換
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;

// 山データのキャッシュ
let mountainData = [];
let displayRange = 50; // 表示範囲（km）

/**
 * 山データを読み込む
 * @param {string} url - mountains.json のパス
 */
export async function loadMountainData(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    mountainData = data.mountains || [];
    console.log(`[AR] 山データ読み込み完了: ${mountainData.length}座`);
  } catch (err) {
    console.error('[AR] 山データ読み込み失敗:', err);
  }
}

/**
 * 表示距離を設定する（km）
 */
export function setDisplayRange(km) {
  displayRange = km;
}

/**
 * Haversine公式で2点間の距離を計算する（メートル）
 */
function calcDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 2点間の方位角（ベアリング）を計算する（度、北=0、時計回り）
 */
function calcBearing(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * 仰角を計算する（地球の曲率を考慮）
 * @returns {number} 仰角（度）正=上方向
 */
function calcElevationAngle(distance, observerAlt, mountainElev) {
  // 地球の曲率による見かけの高さの補正
  const curvatureDrop = (distance * distance) / (2 * EARTH_RADIUS);
  const heightDiff = mountainElev - observerAlt - curvatureDrop;
  return toDeg(Math.atan2(heightDiff, distance));
}

/**
 * 現在位置から見える山を計算する
 * @param {number} userLat - ユーザーの緯度
 * @param {number} userLng - ユーザーの経度
 * @param {number} userAlt - ユーザーの標高
 * @param {number} heading - デバイスの方位角（度、北=0）
 * @param {number} tilt - デバイスの前後傾き（度）
 * @param {number} canvasW - Canvas幅
 * @param {number} canvasH - Canvas高さ
 * @returns {Array} 画面に表示する山の情報配列
 */
export function calculateVisibleMountains(
  userLat, userLng, userAlt,
  heading, tilt,
  canvasW, canvasH
) {
  // カメラの水平画角（FOV）と垂直画角
  const hFov = 60; // 水平画角（度）— 一般的なスマホカメラ
  const vFov = hFov * (canvasH / canvasW);

  const results = [];

  for (const mt of mountainData) {
    // 1. 距離を計算
    const dist = calcDistance(userLat, userLng, mt.lat, mt.lng);
    const distKm = dist / 1000;

    // 表示範囲外はスキップ
    if (distKm > displayRange) continue;

    // 2. 方位角を計算
    const bearing = calcBearing(userLat, userLng, mt.lat, mt.lng);

    // 3. デバイスの向きとの角度差を計算
    let angleDiff = bearing - heading;
    // -180〜180の範囲に正規化
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    // 画面の水平範囲外はスキップ（余白を少し持たせる）
    if (Math.abs(angleDiff) > hFov / 2 + 5) continue;

    // 4. 仰角を計算
    const elevAngle = calcElevationAngle(dist, userAlt, mt.elev);

    // デバイスの傾きを考慮した仰角差
    // tilt=90のとき水平を見ている
    const viewAngle = tilt - 90; // デバイスの視線角度
    const vertDiff = elevAngle - viewAngle;

    // 画面の垂直範囲外はスキップ
    if (Math.abs(vertDiff) > vFov / 2 + 10) continue;

    // 5. 画面座標に変換
    const x = canvasW / 2 + (angleDiff / hFov) * canvasW;
    const y = canvasH / 2 - (vertDiff / vFov) * canvasH;

    // 6. ラベルサイズ（遠い山ほど小さく）
    const scale = Math.max(0.5, Math.min(1.2, 1 - (distKm / displayRange) * 0.5));

    results.push({
      id: mt.id,
      name: mt.name,
      elev: mt.elev,
      distance: distKm,
      bearing: bearing,
      x: x,
      y: y,
      scale: scale,
      cat: mt.cat
    });
  }

  // 距離順にソート（近い山を優先）
  results.sort((a, b) => a.distance - b.distance);

  // ラベルの重なりを解消
  resolveOverlaps(results, canvasW);

  return results;
}

/**
 * ラベルの重なりを検出し、Y軸方向にオフセットする
 */
function resolveOverlaps(mountains, canvasW) {
  const labelHeight = 50; // ラベルの高さ（px）
  const labelWidth = 120; // ラベルの幅（px）

  for (let i = 0; i < mountains.length; i++) {
    for (let j = 0; j < i; j++) {
      const dx = Math.abs(mountains[i].x - mountains[j].x);
      const dy = Math.abs(mountains[i].y - mountains[j].y);

      if (dx < labelWidth * 0.7 && dy < labelHeight) {
        // 重なっている場合、遠い山のラベルを上にずらす
        mountains[i].y -= (labelHeight - dy + 5);
      }
    }
  }
}

/**
 * 山データの総数を取得する
 */
export function getMountainCount() {
  return mountainData.length;
}

/**
 * 指定座標に最も近い山を取得する
 */
export function getNearestMountain(lat, lng) {
  let nearest = null;
  let minDist = Infinity;

  for (const mt of mountainData) {
    const d = calcDistance(lat, lng, mt.lat, mt.lng);
    if (d < minDist) {
      minDist = d;
      nearest = { ...mt, distance: d / 1000 };
    }
  }
  return nearest;
}

/**
 * 全山データを取得する（マップ表示用）
 */
export function getAllMountains() {
  return mountainData;
}
