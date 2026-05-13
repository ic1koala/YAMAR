/**
 * sensors.js - GPS・コンパスセンサー管理モジュール
 * 位置情報とデバイスの向き（方位角）を取得・管理する
 */

// センサーの現在値
const state = {
  lat: 0,
  lng: 0,
  altitude: 0,
  accuracy: 0,
  heading: 0,        // コンパス方位角（0-360、北=0）
  tilt: 0,           // デバイスの前後傾き
  gpsReady: false,
  compassReady: false,
  watchId: null
};

// ローパスフィルター用の前回値
let prevHeading = null;
const SMOOTHING = 0.3; // フィルター強度（0に近いほど滑らか）

// コールバック関数
let onUpdate = null;

// デモモードフラグ（シミュレート中はセンサーイベントを無視）
let demoMode = false;

/**
 * ローパスフィルター（指数移動平均）
 * コンパスのノイズを滑らかにする
 */
function smoothAngle(newVal, oldVal, factor) {
  if (oldVal === null) return newVal;
  
  // 角度の差を-180〜180の範囲に正規化
  let diff = newVal - oldVal;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  
  let result = oldVal + diff * factor;
  if (result < 0) result += 360;
  if (result >= 360) result -= 360;
  return result;
}

/**
 * GPS（位置情報）の監視を開始する
 * @returns {Promise<boolean>} 権限が取得できたかどうか
 */
export function startGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[Sensor] Geolocation APIが利用できません');
      resolve(false);
      return;
    }

    const options = {
      enableHighAccuracy: true,  // GPS衛星からの高精度位置を要求
      maximumAge: 5000,          // 5秒以内のキャッシュを許容
      timeout: 15000             // 15秒でタイムアウト
    };

    // 最初の一回で権限チェック
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateGPS(pos);
        // 継続的な監視を開始
        state.watchId = navigator.geolocation.watchPosition(
          updateGPS,
          (err) => console.warn('[Sensor] GPS監視エラー:', err.message),
          options
        );
        resolve(true);
      },
      (err) => {
        console.warn('[Sensor] GPS権限エラー:', err.message);
        resolve(false);
      },
      options
    );
  });
}

/**
 * GPS位置情報を更新する（内部コールバック）
 */
function updateGPS(position) {
  // デモモード時はGPS更新を無視
  if (demoMode) return;
  
  state.lat = position.coords.latitude;
  state.lng = position.coords.longitude;
  state.altitude = position.coords.altitude || 0;
  state.accuracy = position.coords.accuracy;
  state.gpsReady = true;
  
  if (onUpdate) onUpdate(state);
}

/**
 * コンパス（方位センサー）の監視を開始する
 * iOSでは明示的なユーザー許可が必要
 * @returns {Promise<boolean>} 権限が取得できたかどうか
 */
export async function startCompass() {
  // iOS 13以降: ユーザー操作の中で requestPermission() を呼ぶ必要がある
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        console.warn('[Sensor] コンパス権限が拒否されました');
        return false;
      }
    } catch (err) {
      console.warn('[Sensor] コンパス権限エラー:', err);
      return false;
    }
  }

  window.addEventListener('deviceorientation', handleOrientation, true);
  
  // デバイスの向き変更を検知してコンパスが機能しているか確認
  return new Promise((resolve) => {
    let checked = false;
    
    function checkCompass(e) {
      if (!checked && (e.alpha !== null || e.webkitCompassHeading !== undefined)) {
        checked = true;
        state.compassReady = true;
        console.log('[Sensor] コンパス利用可能');
        resolve(true);
      }
    }
    
    window.addEventListener('deviceorientation', checkCompass, true);
    
    // 2秒以内にイベントが来なければデスクトップ環境とみなす
    setTimeout(() => {
      window.removeEventListener('deviceorientation', checkCompass, true);
      if (!checked) {
        console.warn('[Sensor] コンパスが利用できません（デスクトップ環境の可能性）');
        state.compassReady = false;
        resolve(false);
      }
    }, 2000);
  });
}

/**
 * DeviceOrientationイベントハンドラ
 */
function handleOrientation(event) {
  // デモモード時はセンサーイベントを無視
  if (demoMode) return;

  let heading;

  // iOS: webkitCompassHeading が使える場合はそちらを優先（磁北基準、高精度）
  if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    // Android / その他: alpha値から方位を計算
    // alphaは端末の向き（0-360）、北を向いている時の値はブラウザにより異なる
    heading = (360 - event.alpha) % 360;
    
    // absolute プロパティが true の場合、alpha は真北基準
    if (!event.absolute) {
      // 相対値の場合、真北への補正が困難なため近似値として使用
    }
  } else {
    return; // データなし
  }

  // ローパスフィルターで滑らかにする
  state.heading = smoothAngle(heading, prevHeading, SMOOTHING);
  prevHeading = state.heading;
  
  // デバイスの前後傾き（ARの仰角計算に使用）
  if (event.beta !== null) {
    state.tilt = event.beta; // -180〜180度、0=水平、90=垂直
  }

  state.compassReady = true;
}

/**
 * センサー値の更新コールバックを設定する
 * @param {Function} callback - state を引数に取るコールバック
 */
export function onSensorUpdate(callback) {
  onUpdate = callback;
}

/**
 * 現在のセンサー状態を取得する
 * @returns {Object} センサーの現在値
 */
export function getState() {
  return { ...state };
}

/**
 * センサーの監視を停止する
 */
export function stopSensors() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  window.removeEventListener('deviceorientation', handleOrientation, true);
  state.gpsReady = false;
  state.compassReady = false;
  console.log('[Sensor] センサー停止');
}

/**
 * デバッグ用: センサー値をシミュレートする
 * デスクトップ開発時に使用
 */
export function simulateSensors(lat, lng, altitude, heading, tilt) {
  demoMode = true; // デモモード有効化（センサーイベントを無視）
  state.lat = lat;
  state.lng = lng;
  state.altitude = altitude || 0;
  state.heading = heading || 0;
  state.tilt = tilt !== undefined ? tilt : 90; // 90=水平方向を見ている
  state.gpsReady = true;
  state.compassReady = true;
  state.accuracy = 10;
  if (onUpdate) onUpdate(state);
}
