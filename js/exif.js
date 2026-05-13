/**
 * exif.js - 画像のメタデータ(Exif)から位置情報を抽出
 * 外部ライブラリを使わず、GPS緯度・経度・方位を取得する
 */

export async function extractExifData(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  // JPEGの開始マーカー (0xFFD8) を確認
  if (view.getUint16(0) !== 0xFFD8) return null;

  let offset = 2;
  let metadata = { lat: null, lng: null, heading: null };

  while (offset < view.byteLength) {
    // マーカーの取得
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);

    // APP1 (Exif) マーカーを探す (0xFFE1)
    if (marker === 0xE1) {
      const app1Offset = offset + 4;
      if (getString(view, app1Offset, 4) === 'Exif') {
        const result = parseExif(view, app1Offset + 6);
        if (result) metadata = { ...metadata, ...result };
      }
      break;
    }
    offset += 2 + view.getUint16(offset + 2);
  }

  return metadata;
}

function parseExif(view, base) {
  const littleEndian = view.getUint16(base) === 0x4949;
  const ifd0Offset = view.getUint32(base + 4, littleEndian);
  
  // GPS IFDを探すためにIFD0をパース
  const gpsOffset = findGpsInfoOffset(view, base, ifd0Offset, littleEndian);
  if (!gpsOffset) return null;

  return parseGpsTags(view, base, gpsOffset, littleEndian);
}

function findGpsInfoOffset(view, base, offset, le) {
  const entries = view.getUint16(base + offset, le);
  for (let i = 0; i < entries; i++) {
    const entryBase = base + offset + 2 + i * 12;
    const tag = view.getUint16(entryBase, le);
    if (tag === 0x8825) { // GPSInfo tag
      return view.getUint32(entryBase + 8, le);
    }
  }
  return null;
}

function parseGpsTags(view, base, offset, le) {
  const entries = view.getUint16(base + offset, le);
  let gps = { lat: null, lng: null, heading: null };
  let latRef = 'N', lngRef = 'E';

  for (let i = 0; i < entries; i++) {
    const entryBase = base + offset + 2 + i * 12;
    const tag = view.getUint16(entryBase, le);
    const valOffset = base + view.getUint32(entryBase + 8, le);

    switch (tag) {
      case 0x0001: latRef = getString(view, entryBase + 8, 1); break;
      case 0x0002: gps.lat = parseRationalTriple(view, valOffset, le); break;
      case 0x0003: lngRef = getString(view, entryBase + 8, 1); break;
      case 0x0004: gps.lng = parseRationalTriple(view, valOffset, le); break;
      case 0x0011: gps.heading = parseRational(view, valOffset, le); break; // GPSImgDirection
    }
  }

  if (gps.lat) {
    gps.lat = (gps.lat[0] + gps.lat[1]/60 + gps.lat[2]/3600) * (latRef === 'S' ? -1 : 1);
  }
  if (gps.lng) {
    gps.lng = (gps.lng[0] + gps.lng[1]/60 + gps.lng[2]/3600) * (lngRef === 'W' ? -1 : 1);
  }

  return gps;
}

// 補助関数
function getString(view, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str.trim();
}

function parseRational(view, offset, le) {
  const num = view.getUint32(offset, le);
  const den = view.getUint32(offset + 4, le);
  return num / den;
}

function parseRationalTriple(view, offset, le) {
  return [
    parseRational(view, offset, le),
    parseRational(view, offset + 8, le),
    parseRational(view, offset + 16, le)
  ];
}
