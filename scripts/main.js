// main.js
// 前提：astronomy-engine が <script> で読み込まれている（グローバルに Astronomy）
// データ：data/hipparcos_sample.json, data/constellations.json を参照

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const nowBtn = document.getElementById('nowBtn');
const locBtn = document.getElementById('locBtn');
const genBtn = document.getElementById('generate');
const datetimeInput = document.getElementById('datetime');
const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const heightInput = document.getElementById('height');
const status = document.getElementById('status');
const locInfo = document.getElementById('locInfo');

let constellations = [];
let hipparcos = [];

// 初期日時を現在に
(function initDate(){
  const now = new Date();
  // local datetime-local expects local time ISO slice
  datetimeInput.value = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
})();

// データ読み込み
async function loadData() {
  try {
    const [cRes, hRes] = await Promise.all([
      fetch('data/constellations.json'),
      fetch('data/hipparcos_sample.json') // 本番では大ファイル名に合わせる
    ]);
    if(!cRes.ok) throw new Error('constellations.json の読み込みに失敗しました');
    if(!hRes.ok) throw new Error('hipparcos_sample.json の読み込みに失敗しました');

    constellations = await cRes.json();
    hipparcos = await hRes.json();
    status.textContent = 'データ読み込み完了';
  } catch (err) {
    console.error(err);
    status.textContent = 'データ読み込みエラー: ' + (err.message || err);
  }
}

// ユーティリティ：日時入力 → Date object（ローカル）
function getDateFromInput() {
  const val = datetimeInput.value;
  if(!val) return new Date();
  // datetime-local returns local naive time; new Date(val) treats as local
  return new Date(val);
}

// Geolocation
locBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    status.textContent = 'Geolocation 非対応';
    return;
  }
  status.textContent = '位置情報取得中…';
  navigator.geolocation.getCurrentPosition(pos => {
    latInput.value = pos.coords.latitude.toFixed(6);
    lonInput.value = pos.coords.longitude.toFixed(6);
    heightInput.value = (pos.coords.altitude != null) ? Math.round(pos.coords.altitude) : heightInput.value;
    status.textContent = '現在位置を設定しました';
    locInfo.textContent = `現在地: 緯度 ${latInput.value} / 経度 ${lonInput.value}`;
  }, err => {
    console.warn(err);
    status.textContent = '位置情報取得失敗: ' + err.message;
  }, {enableHighAccuracy:true, timeout:8000});
});

// 現在時刻
nowBtn.addEventListener('click', () => {
  const now = new Date();
  datetimeInput.value = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  status.textContent = '日時を現在時刻に設定';
});

// 再描画
genBtn.addEventListener('click', () => {
  drawSky();
});

// canvas サイズ管理（高DPI 対応）
function setCanvasSize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const displayW = canvas.clientWidth;
  const displayH = canvas.clientWidth; // 正円
  canvas.width = Math.floor(displayW * ratio);
  canvas.height = Math.floor(displayH * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', () => { setCanvasSize(); drawSky(); });

// メイン描画
async function drawSky() {
  setCanvasSize();
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // 読み込み確認
  if(!Astronomy) {
    status.textContent = 'astronomy-engine が読み込まれていません';
    return;
  }
  if(constellations.length === 0 || hipparcos.length === 0) {
    status.textContent = 'データ未読み込み（数秒待って再試行）';
    return;
  }

  const date = getDateFromInput();
  const lat = parseFloat(latInput.value) || 35.68;
  const lon = parseFloat(lonInput.value) || 139.76;
  const height = parseFloat(heightInput.value) || 30;

  locInfo.textContent = `観測地: 緯度 ${lat.toFixed(4)} 経度 ${lon.toFixed(4)} 高度 ${height}m — 時刻: ${date.toLocaleString()}`;

  status.textContent = '計算中…';

  // Astronomy-engine の Observer (lat, lon, height)
  const observer = new Astronomy.Observer(lat, lon, height);

  // Canvas 中心と半径（見える上半球を円で投影）
  const W = canvas.clientWidth;
  const cx = W/2;
  const cy = W/2;
  const R = W*0.45;

  // 背景（夜空グラデ）
  drawBackground(cx,cy,R);

  // 方位表示（N/E/S/W）
  drawDirections(cx,cy,R);

  // 地平線の丸（円弧）
  drawHorizonCircle(cx,cy,R);

  // 惑星・月・太陽（主要天体）
  const bodies = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune'];
  try {
    for(const bName of bodies) {
      // Body enum: Astronomy.Body.Sun etc or string accepted. Use Astronomy.Body by name mapping
      const body = Astronomy.Body[bName] || bName;
      // Equator returns equatorial coords (ra, dec) — use ofDate=true to get equator-of-date
      const equ = Astronomy.Equator(body, date, observer, true, true);
      const hor = Astronomy.Horizon(date, observer, equ.ra, equ.dec, 'normal');
      if (hor.altitude > 0) {
        const p = projectToCanvas(hor.azimuth, hor.altitude, cx, cy, R);
        // size by visual magnitude (astronomy-engine can give magnitude for planets via Illumination or function, but here we use default sizes)
        const mag = Math.max(-2, (equ.mag !== undefined) ? equ.mag : (bName==='Moon' ? -12 : 0));
        drawPoint(p.x, p.y, sizeFromMag(mag), (bName==='Sun' ? '#ffd27a' : bName==='Moon' ? '#eee' : '#f2c') );
        // label
        ctx.fillStyle = '#dfe';
        ctx.font = '12px sans-serif';
        ctx.fillText(bName, p.x + 6, p.y - 6);
      }
    }
  } catch (err) {
    console.warn('惑星計算エラー:', err);
  }

  // 恒星（Hipparcosサンプル）： J2000のRA/Dec -> 観測時刻の水平座標変換
  // 方法：J2000の球面座標をベクトル化 → Rotation_EQJ_HORで HOR へ変換 → HorizonFromVector で alt/az
  try {
    // Rotation matrix: J2000 -> HOR (horizontal) for given time & observer
    const timeAstr = Astronomy.Time(date);
    const rotEQJtoHOR = Astronomy.Rotation_EQJ_HOR(timeAstr, observer); // returns matrix
    for (let star of hipparcos) {
      // 度・時の確認（hipparcos_sample.json は ra_hours と dec_deg）
      const ra_deg = star.ra_hours * 15.0;
      const dec = star.dec_deg;
      // Vector (EQJ) from RA/Dec: VectorFromSphere expects sphere object: {lon, lat, distance}
      // lon = RA in degrees (0..360), lat=dec, distance arbitrary (1)
      const sph = { lon: ra_deg, lat: dec, radius: 1.0 };
      const vecEQJ = Astronomy.VectorFromSphere(sph, timeAstr); // vector in EQJ coordinates
      // rotate EQJ vector to HOR (horizontal) using rotation matrix
      const vecHOR = Astronomy.RotateVector(rotEQJtoHOR, vecEQJ); // vector in HOR orientation
      // convert horizontal vector to az/alt:
      const hor = Astronomy.HorizonFromVector(vecHOR, 'normal'); // {azimuth, altitude}
      if (hor.altitude > 0) {
        const p = projectToCanvas(hor.azimuth, hor.altitude, cx, cy, R);
        const m = star.mag !== undefined ? star.mag : 6.0;
        drawPoint(p.x, p.y, sizeFromMag(m), '#fff', 0.9);
        // 小ラベル（明るい星のみ）
        if (m <= 2.5) {
          ctx.fillStyle = 'rgba(255,240,200,0.9)';
          ctx.font = '12px sans-serif';
          ctx.fillText(star.name || ('HIP' + star.hip), p.x + 6, p.y - 6);
        }
      }
    }
  } catch (err) {
    console.error('恒星描画エラー:', err);
    status.textContent = '恒星描画でエラー（コンソール参照）';
  }

  // 星座線・星座名（constellation JSON の星は ra_hours, dec_deg）
  try {
    ctx.strokeStyle = 'rgba(80,160,255,0.9)';
    ctx.lineWidth = 1.2;
    for (let c of constellations) {
      // map id->coords for visible stars
      const coords = {};
      for (let s of c.stars) {
        const ra_deg = s.ra_hours * 15.0;
        const sph = { lon: ra_deg, lat: s.dec_deg, radius: 1.0 };
        const vecEQJ = Astronomy.VectorFromSphere(sph, Astronomy.Time(date));
        const rot = Astronomy.Rotation_EQJ_HOR(Astronomy.Time(date), observer);
        const vhor = Astronomy.RotateVector(rot, vecEQJ);
        const hor = Astronomy.HorizonFromVector(vhor, 'normal');
        if (hor.altitude > 0) {
          coords[s.id] = projectToCanvas(hor.azimuth, hor.altitude, cx, cy, R);
        }
      }
      // lines
      for (let line of (c.lines||[])) {
        const a = coords[line[0]];
        const b = coords[line[1]];
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      // constellation name (centroid)
      const pts = Object.values(coords);
      if (pts.length>0) {
        const mx = pts.reduce((s,p)=>s+p.x,0)/pts.length;
        const my = pts.reduce((s,p)=>s+p.y,0)/pts.length;
        ctx.fillStyle = 'rgba(255,230,130,0.9)';
        ctx.font = '14px sans-serif';
        ctx.fillText(c.name, mx - 12, my + 6);
      }
    }
  } catch (err) {
    console.error('星座線描画エラー:', err);
  }

  status.textContent = '描画完了';
}

// 補助：背景（グラデ＋経度に応じた星空回転は将来の拡張）
function drawBackground(cx,cy,R) {
  // 軽い夜空グラデ
  const grad = ctx.createRadialGradient(cx, cy - R*0.25, R*0.1, cx, cy, R);
  grad.addColorStop(0, '#001833');
  grad.addColorStop(0.6, '#000814');
  grad.addColorStop(1, '#000');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R+4, 0, Math.PI*2);
  ctx.fill();
  // 星の散布（背景小点） - 擬似
  for (let i=0;i<200;i++){
    const angle = Math.random()*Math.PI*2;
    const rad = Math.sqrt(Math.random()) * R;
    const x = cx + rad*Math.cos(angle);
    const y = cy + rad*Math.sin(angle);
    ctx.fillStyle = 'rgba(200,220,255,'+ (Math.random()*0.6+0.05) +')';
    ctx.fillRect(x, y, (Math.random()>0.98?2:1), (Math.random()>0.98?2:1));
  }
}

// 補助：方位表示
function drawDirections(cx,cy,R) {
  ctx.fillStyle = '#88f7c1';
  ctx.font = '16px sans-serif';
  const dirs = [{d:'N', ang:0},{d:'E',ang:90},{d:'S',ang:180},{d:'W',ang:270}];
  dirs.forEach(dir => {
    const rad = (dir.ang) * Math.PI/180;
    const x = cx + (R+18) * Math.sin(rad);
    const y = cy - (R+18) * Math.cos(rad);
    ctx.fillText(dir.d, x-8, y+6);
  });
}

// 補助：地平線円
function drawHorizonCircle(cx,cy,R){
  ctx.strokeStyle = 'rgba(120,220,170,0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI*2);
  ctx.stroke();
}

// 投影：方位（deg）, 高度（deg） -> canvas座標
function projectToCanvas(azimuthDeg, altitudeDeg, cx, cy, R) {
  // altitude 90 => center (zenith). altitude 0 => radius R (horizon).
  const alt = altitudeDeg;
  const r = (90 - alt) / 90 * R;
  const azRad = azimuthDeg * Math.PI / 180.0;
  const x = cx + r * Math.sin(azRad);
  const y = cy - r * Math.cos(azRad);
  return { x, y };
}

// 描画：点
function drawPoint(x,y,size,color,alpha=1.0){
  ctx.beginPath();
  ctx.fillStyle = color || '#fff';
  ctx.globalAlpha = alpha;
  ctx.arc(x, y, size, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

// 等級 -> 表示サイズ（単純マッピング）
function sizeFromMag(mag) {
  // mag: -2..+6 => size 6..0.8 (逆）
  const s = Math.max(0.6, 6 - (mag * 0.9));
  return Math.min(6, s);
}

// 初期ロード
(async function main(){
  await loadData();
  drawSky();
})();
