/**
 * camera.js - カメラ制御＆Canvas AR描画モジュール
 * 背面カメラの映像取得と、ARラベルの描画・撮影合成を行う
 */

let videoElement = null;
let canvasElement = null;
let ctx = null;
let stream = null;
let animFrameId = null;
let renderCallback = null;

/**
 * カメラを初期化する
 * @param {HTMLVideoElement} video - カメラ映像を表示するvideo要素
 * @param {HTMLCanvasElement} canvas - ARラベルを描画するcanvas要素
 * @returns {Promise<boolean>} カメラの起動に成功したかどうか
 */
export async function initCamera(video, canvas) {
  videoElement = video;
  canvasElement = canvas;
  ctx = canvas.getContext('2d');

  try {
    // 背面カメラを指定して起動
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // 背面カメラ
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    videoElement.srcObject = stream;
    await videoElement.play();

    // videoのサイズに合わせてcanvasをリサイズ
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    console.log('[Camera] カメラ起動完了');
    return true;

  } catch (err) {
    console.error('[Camera] カメラ起動失敗:', err);
    return false;
  }
}

/**
 * Canvasサイズをビューポートに合わせる
 */
function resizeCanvas() {
  if (!canvasElement) return;
  canvasElement.width = window.innerWidth;
  canvasElement.height = window.innerHeight;
}

/**
 * ARラベルの描画ループを開始する
 * @param {Function} callback - 毎フレーム呼ばれるコールバック(ctx, w, h)
 */
export function startRenderLoop(callback) {
  renderCallback = callback;
  render();
}

/**
 * 描画ループ
 */
function render() {
  if (!ctx || !canvasElement) return;

  // Canvasをクリア
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // 外部のコールバックでARラベルを描画
  if (renderCallback) {
    renderCallback(ctx, canvasElement.width, canvasElement.height);
  }

  animFrameId = requestAnimationFrame(render);
}

/**
 * 山のARラベルを描画する
 * @param {CanvasRenderingContext2D} c - Canvas context
 * @param {Array} mountains - 表示する山の配列
 */
export function drawMountainLabels(c, mountains) {
  for (const mt of mountains) {
    const x = mt.x;
    const y = mt.y;
    const s = mt.scale;

    // ▼ マーカー（山の位置を示す三角形）
    c.beginPath();
    c.moveTo(x, y + 8 * s);
    c.lineTo(x - 6 * s, y + 18 * s);
    c.lineTo(x + 6 * s, y + 18 * s);
    c.closePath();
    c.fillStyle = mt.cat === '百名山' ? '#f59e0b' : '#60a5fa';
    c.fill();

    // 垂直の細い線（マーカーからラベルへの接続線）
    c.beginPath();
    c.moveTo(x, y + 8 * s);
    c.lineTo(x, y - 8 * s);
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 1;
    c.stroke();

    // ラベル背景
    const name = mt.name;
    const info = `${mt.elev}m  ${mt.distance.toFixed(1)}km`;
    const fontSize = Math.round(14 * s);
    const smallSize = Math.round(11 * s);
    
    c.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    const nameWidth = c.measureText(name).width;
    c.font = `${smallSize}px system-ui, -apple-system, sans-serif`;
    const infoWidth = c.measureText(info).width;
    const boxWidth = Math.max(nameWidth, infoWidth) + 16 * s;
    const boxHeight = (fontSize + smallSize + 12) * s;
    const boxX = x - boxWidth / 2;
    const boxY = y - boxHeight - 12 * s;

    // 背景の角丸矩形
    const r = 6 * s;
    c.beginPath();
    c.moveTo(boxX + r, boxY);
    c.lineTo(boxX + boxWidth - r, boxY);
    c.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r);
    c.lineTo(boxX + boxWidth, boxY + boxHeight - r);
    c.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight);
    c.lineTo(boxX + r, boxY + boxHeight);
    c.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r);
    c.lineTo(boxX, boxY + r);
    c.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    c.closePath();
    c.fillStyle = 'rgba(0, 0, 0, 0.7)';
    c.fill();

    // 百名山にはゴールドの枠線
    if (mt.cat === '百名山') {
      c.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      c.lineWidth = 1.5 * s;
      c.stroke();
    }

    // 山名テキスト
    c.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(name, x, boxY + 5 * s);

    // 標高・距離テキスト
    c.font = `${smallSize}px system-ui, -apple-system, sans-serif`;
    c.fillStyle = mt.cat === '百名山' ? '#fbbf24' : '#93c5fd';
    c.fillText(info, x, boxY + fontSize + 8 * s);
  }
}

/**
 * コンパスUIを描画する
 * @param {CanvasRenderingContext2D} c - Canvas context
 * @param {number} heading - 現在の方位角
 * @param {number} w - Canvas幅
 */
export function drawCompass(c, heading, w) {
  const y = 50;
  const barWidth = w * 0.8;
  const barX = (w - barWidth) / 2;

  // コンパスバー背景
  c.fillStyle = 'rgba(0, 0, 0, 0.5)';
  c.beginPath();
  c.roundRect(barX, y - 15, barWidth, 30, 15);
  c.fill();

  // 方角の目盛り
  const directions = [
    { deg: 0, label: 'N', color: '#ef4444' },
    { deg: 45, label: 'NE' },
    { deg: 90, label: 'E' },
    { deg: 135, label: 'SE' },
    { deg: 180, label: 'S' },
    { deg: 225, label: 'SW' },
    { deg: 270, label: 'W' },
    { deg: 315, label: 'NW' }
  ];

  c.save();
  c.beginPath();
  c.roundRect(barX, y - 15, barWidth, 30, 15);
  c.clip();

  for (const dir of directions) {
    let diff = dir.deg - heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const px = w / 2 + (diff / 180) * barWidth;
    if (px < barX - 20 || px > barX + barWidth + 20) continue;

    c.font = dir.label === 'N' ? 'bold 14px system-ui' : '11px system-ui';
    c.fillStyle = dir.color || 'rgba(255,255,255,0.8)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(dir.label, px, y);
  }

  c.restore();

  // 中央の矢印マーカー
  c.beginPath();
  c.moveTo(w / 2, y - 18);
  c.lineTo(w / 2 - 5, y - 24);
  c.lineTo(w / 2 + 5, y - 24);
  c.closePath();
  c.fillStyle = '#f59e0b';
  c.fill();

  // 方位角の数値表示
  c.font = 'bold 12px system-ui';
  c.fillStyle = '#f59e0b';
  c.textAlign = 'center';
  c.fillText(`${Math.round(heading)}°`, w / 2, y + 28);
}

/**
 * 撮影する（video + ARラベルを合成した画像を生成）
 * @param {Function} labelDrawFn - ラベル描画関数
 * @returns {Promise<{full: Blob, thumb: Blob}>} 合成画像とサムネイル
 */
export async function capture(labelDrawFn) {
  if (!videoElement || !ctx) return null;

  // 撮影用の一時Canvas
  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCanvas.width = canvasElement.width;
  tmpCanvas.height = canvasElement.height;

  // カメラ映像を描画
  tmpCtx.drawImage(videoElement, 0, 0, tmpCanvas.width, tmpCanvas.height);

  // ARラベルを上に重ねて描画
  if (labelDrawFn) {
    labelDrawFn(tmpCtx, tmpCanvas.width, tmpCanvas.height);
  }

  // タイムスタンプを追加
  const now = new Date();
  const stamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  tmpCtx.font = 'bold 14px system-ui';
  tmpCtx.fillStyle = 'rgba(255,255,255,0.8)';
  tmpCtx.textAlign = 'right';
  tmpCtx.fillText(stamp, tmpCanvas.width - 16, tmpCanvas.height - 16);
  tmpCtx.fillStyle = 'rgba(0,0,0,0.3)';
  tmpCtx.fillText(stamp, tmpCanvas.width - 15, tmpCanvas.height - 15);

  // YAMAR ウォーターマーク
  tmpCtx.font = 'bold 11px system-ui';
  tmpCtx.fillStyle = 'rgba(255,255,255,0.5)';
  tmpCtx.textAlign = 'left';
  tmpCtx.fillText('📸 YAMAR', 16, tmpCanvas.height - 16);

  // フルサイズ画像をBlobに変換
  const fullBlob = await new Promise(resolve =>
    tmpCanvas.toBlob(resolve, 'image/jpeg', 0.85)
  );

  // サムネイル生成（200px幅）
  const thumbCanvas = document.createElement('canvas');
  const thumbCtx = thumbCanvas.getContext('2d');
  const ratio = 200 / tmpCanvas.width;
  thumbCanvas.width = 200;
  thumbCanvas.height = tmpCanvas.height * ratio;
  thumbCtx.drawImage(tmpCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const thumbBlob = await new Promise(resolve =>
    thumbCanvas.toBlob(resolve, 'image/jpeg', 0.6)
  );

  return { full: fullBlob, thumb: thumbBlob };
}

/**
 * 指定された画像とラベルを合成して画像を生成する
 */
export async function compositeImageWithLabels(imageFile, mountains, heading) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      // 背景画像を描画
      ctx.drawImage(img, 0, 0);

      // 方位とラベルを描画（AR画面と同様のロジック）
      // 画面比率に合わせて調整
      drawCompass(ctx, heading, canvas.width);
      drawMountainLabels(ctx, mountains);

      // ウォーターマーク
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Identified by YAMAR', canvas.width - 20, canvas.height - 20);

      canvas.toBlob((fullBlob) => {
        // サムネイルも生成
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 300;
        thumbCanvas.height = 300 * (canvas.height / canvas.width);
        const tCtx = thumbCanvas.getContext('2d');
        tCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        
        thumbCanvas.toBlob((thumbBlob) => {
          resolve({ full: fullBlob, thumb: thumbBlob });
        }, 'image/jpeg', 0.8);
      }, 'image/jpeg', 0.9);
    };
    img.src = URL.createObjectURL(imageFile);
  });
}

/**
 * カメラを停止する
 */
export function stopCamera() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  window.removeEventListener('resize', resizeCanvas);
  console.log('[Camera] カメラ停止');
}

/**
 * Canvasのサイズを取得する
 */
export function getCanvasSize() {
  if (!canvasElement) return { w: 0, h: 0 };
  return { w: canvasElement.width, h: canvasElement.height };
}
