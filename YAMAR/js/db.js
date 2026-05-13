/**
 * db.js - IndexedDB管理モジュール
 * 撮影した写真やアプリ設定をローカルに永続保存する
 */

const DB_NAME = 'yamar-db';
const DB_VERSION = 1;

let db = null;

/**
 * IndexedDBを初期化する
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // 写真データ用のストア
      if (!database.objectStoreNames.contains('photos')) {
        const photoStore = database.createObjectStore('photos', {
          keyPath: 'id',
          autoIncrement: true
        });
        // 日時で検索できるようにインデックスを作成
        photoStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // アプリ設定用のストア
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('[DB] IndexedDB 初期化完了');
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('[DB] IndexedDB エラー:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * 撮影した写真を保存する
 * @param {Object} photoData - 写真データ
 * @param {Blob} photoData.imageBlob - 合成画像のBlob
 * @param {Blob} photoData.thumbnail - サムネイルBlob
 * @param {number} photoData.lat - 撮影時の緯度
 * @param {number} photoData.lng - 撮影時の経度
 * @param {number} photoData.altitude - 撮影時の標高
 * @param {number} photoData.heading - 撮影時の方角
 * @param {Array} photoData.mountains - 画面内の山名リスト
 * @returns {Promise<number>} 保存したレコードのID
 */
export function savePhoto(photoData) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');

    const record = {
      imageBlob: photoData.imageBlob,
      thumbnail: photoData.thumbnail,
      timestamp: Date.now(),
      lat: photoData.lat || 0,
      lng: photoData.lng || 0,
      altitude: photoData.altitude || 0,
      heading: photoData.heading || 0,
      mountains: photoData.mountains || []
    };

    const request = store.add(record);
    request.onsuccess = () => {
      console.log('[DB] 写真保存完了 ID:', request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 全写真を取得する（新しい順）
 * @returns {Promise<Array>}
 */
export function getAllPhotos() {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.getAll();

    request.onsuccess = () => {
      // 新しい順にソート
      const photos = request.result.sort((a, b) => b.timestamp - a.timestamp);
      resolve(photos);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 特定の写真を取得する
 * @param {number} id - 写真ID
 * @returns {Promise<Object>}
 */
export function getPhoto(id) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 写真を削除する
 * @param {number} id - 写真ID
 * @returns {Promise<void>}
 */
export function deletePhoto(id) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log('[DB] 写真削除完了 ID:', id);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 設定を保存する
 * @param {string} key - 設定キー
 * @param {*} value - 設定値
 * @returns {Promise<void>}
 */
export function saveSetting(key, value) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 設定を取得する
 * @param {string} key - 設定キー
 * @param {*} defaultValue - デフォルト値
 * @returns {Promise<*>}
 */
export function getSetting(key, defaultValue = null) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : defaultValue);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 写真の総数を取得する
 * @returns {Promise<number>}
 */
export function getPhotoCount() {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('DB未初期化')); return; }

    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
