// ── Clair de Lune エフェクトエンジン
// ドビュッシー《月の光》の5原則のうち、以下を核に実装:
// 02 輪郭よりも階調 → エッジをぼかし、明暗のグラデーションだけで語る
// 04 消失が美しい → 画像の縁や一部が徐々に溶けて消える
// (光の滲み = GLOW は 03「主役を固定しない」の視覚的表現として、
//  ハイライト部分がぼんやり複数の光点として浮かぶようにする)

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const outputCanvas = document.getElementById('outputCanvas');
const canvasBadge = document.getElementById('canvasBadge');
const ctx = outputCanvas.getContext('2d');

const contourSlider = document.getElementById('contour');
const glowSlider = document.getElementById('glow');
const dissolveSlider = document.getElementById('dissolve');
const echoSlider = document.getElementById('echo');
const wobbleSlider = document.getElementById('wobble');
const monochromeCheckbox = document.getElementById('monochrome');
const contourVal = document.getElementById('contourVal');
const glowVal = document.getElementById('glowVal');
const dissolveVal = document.getElementById('dissolveVal');
const echoVal = document.getElementById('echoVal');
const wobbleVal = document.getElementById('wobbleVal');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const presetBtns = document.querySelectorAll('.profile-btn');
const themeBtns = document.querySelectorAll('.theme-btn');

let originalImage = null;
let originalImageData = null;

// ── ファイル読み込み
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      setupCanvas(img);
      applyClairDeLune();
      dropZone.style.display = 'none';
      canvasBadge.style.display = 'block';
      outputCanvas.style.display = 'block';
      downloadBtn.disabled = false;
      resetBtn.disabled = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas(img) {
  const MAX_W = 1200; // 階調処理は重めなので少し抑える
  let w = img.width, h = img.height;
  if (w > MAX_W) { h = h * (MAX_W / w); w = MAX_W; }
  outputCanvas.width = w;
  outputCanvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  originalImageData = ctx.getImageData(0, 0, w, h);
}

// スロットリング（重い処理の連続実行を防ぐ）
let driftRAF = null;
function requestApply() {
  if (driftRAF) cancelAnimationFrame(driftRAF);
  driftRAF = requestAnimationFrame(() => { applyClairDeLune(); driftRAF = null; });
}

// 簡易ボックスブラー（階調表現のベース）
// 決定論的な擬似ランダム（同じ入力なら常に同じ値）→ Rule06「ランダムではなく機械的リズム」
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function boxBlur(data, w, h, radius) {
  if (radius < 1) return data;
  const out = new Uint8ClampedArray(data.length);
  const r = Math.max(1, Math.round(radius));

  // 横方向
  const temp = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr=0, sg=0, sb=0, sa=0, count=0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= w) continue;
        const i = (y*w+sx)*4;
        sr += data[i]; sg += data[i+1]; sb += data[i+2]; sa += data[i+3];
        count++;
      }
      const oi = (y*w+x)*4;
      temp[oi] = sr/count; temp[oi+1] = sg/count; temp[oi+2] = sb/count; temp[oi+3] = sa/count;
    }
  }
  // 縦方向
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sr=0, sg=0, sb=0, sa=0, count=0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= h) continue;
        const i = (sy*w+x)*4;
        sr += temp[i]; sg += temp[i+1]; sb += temp[i+2]; sa += temp[i+3];
        count++;
      }
      const oi = (y*w+x)*4;
      out[oi] = sr/count; out[oi+1] = sg/count; out[oi+2] = sb/count; out[oi+3] = sa/count;
    }
  }
  return out;
}

function applyClairDeLune() {
  if (!originalImageData) return;

  const w = outputCanvas.width;
  const h = outputCanvas.height;

  const contour = parseInt(contourSlider.value) / 100; // 0=完全階調(ぼかし強) / 1=輪郭くっきり(元画像)
  const glow = parseInt(glowSlider.value) / 100;
  const dissolve = parseInt(dissolveSlider.value) / 100;
  const echo = parseInt(echoSlider.value) / 100;
  const wobble = parseInt(wobbleSlider.value) / 100;
  const mono = monochromeCheckbox.checked;

  const src = originalImageData.data;

  // Rule02: CONTOURが低いほど強くぼかす（輪郭より階調）
  const blurRadius = (1 - contour) * 14; // 0-14pxのボックスブラー
  const blurred = boxBlur(src, w, h, blurRadius);

  // ベースは「元画像とぼかし画像のブレンド」
  // contour=100%: ほぼ元画像 / contour=0%: 完全にぼかされた階調のみ
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i]   = src[i]   * contour + blurred[i]   * (1-contour);
    out[i+1] = src[i+1] * contour + blurred[i+1] * (1-contour);
    out[i+2] = src[i+2] * contour + blurred[i+2] * (1-contour);
    out[i+3] = 255;
  }

  // Rule03由来: GLOW → 明るい部分（ハイライト）だけを抽出してさらに強くぼかし、加算合成
  // 「主役を固定しない」＝複数のぼんやりした光点が浮かぶ
  if (glow > 0.01) {
    const highlightMap = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const lum = (out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114) / 255;
      // 明るい部分（0.6以上）だけを抽出、閾値以下は0に
      const highlight = Math.max(0, (lum - 0.55) / 0.45);
      highlightMap[i]   = out[i]   * highlight;
      highlightMap[i+1] = out[i+1] * highlight;
      highlightMap[i+2] = out[i+2] * highlight;
      highlightMap[i+3] = 255;
    }
    const glowBlurred = boxBlur(highlightMap, w, h, 6 + glow*18);
    const glowStrength = glow * 0.9;
    for (let i = 0; i < out.length; i += 4) {
      out[i]   = Math.min(255, out[i]   + glowBlurred[i]   * glowStrength);
      out[i+1] = Math.min(255, out[i+1] + glowBlurred[i+1] * glowStrength);
      out[i+2] = Math.min(255, out[i+2] + glowBlurred[i+2] * glowStrength);
    }
  }

  // Rule04: DISSOLVE → 画像の縁に向かって背景色へ溶けていく（消失が美しい）
  // Rule05: WOBBLE → 消失の境界に決定論的な微小の揺らぎを加える（秩序と揺らぎの共存）
  if (dissolve > 0.01) {
    // 背景色は画像の平均的な暗さに寄せる（不自然な白抜けを避ける）
    let avgR=0, avgG=0, avgB=0, sampleCount=0;
    for (let i = 0; i < out.length; i += 400) {
      avgR += out[i]; avgG += out[i+1]; avgB += out[i+2]; sampleCount++;
    }
    avgR /= sampleCount; avgG /= sampleCount; avgB /= sampleCount;

    const cx = w/2, cy = h/2;
    const maxDist = Math.sqrt(cx*cx + cy*cy);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        let dist = Math.sqrt(dx*dx + dy*dy) / maxDist; // 0(中心)-1(角)

        // WOBBLE: 角度に応じた決定論的なノイズで境界を揺らす（完全な円ではなく、有機的な輪郭に）
        if (wobble > 0.01) {
          const angle = Math.atan2(dy, dx);
          const noiseFreq = 6; // 揺らぎの細かさ
          const noise = pseudoRandom(Math.floor(angle * noiseFreq)) * 0.5
                      + pseudoRandom(Math.floor(angle * noiseFreq * 2.3) + 500) * 0.3
                      + pseudoRandom(Math.floor(angle * noiseFreq * 4.7) + 900) * 0.2;
          dist += (noise - 0.5) * wobble * 0.35;
        }

        // dissolveが強いほど、中心から早く溶け始める
        const fadeStart = 1 - dissolve * 0.85;
        if (dist > fadeStart) {
          const fadeAmount = Math.min(1, (dist - fadeStart) / (1 - fadeStart + 0.001));
          const i = (y*w+x)*4;
          out[i]   = out[i]   * (1-fadeAmount) + avgR * fadeAmount;
          out[i+1] = out[i+1] * (1-fadeAmount) + avgG * fadeAmount;
          out[i+2] = out[i+2] * (1-fadeAmount) + avgB * fadeAmount;
        }
      }
    }
  }

  // Rule01: ECHO → 「反復ではなく変奏」。ディレイ/エコーのように、少しずつずれ・縮小・減衰した
  // 自分自身の残像を重ねる。音楽のディレイエフェクトの視覚翻訳。
  if (echo > 0.01) {
    const echoLayers = 4;
    const base = new Uint8ClampedArray(out); // 現時点のベース画像を保持
    for (let layer = 1; layer <= echoLayers; layer++) {
      const layerT = layer / echoLayers;
      // 減衰：ディレイのフィードバックのように、後のレイヤーほど薄くなる
      const opacity = echo * Math.pow(0.55, layer - 1) * 0.6;
      if (opacity < 0.01) continue;

      // ずらし幅：echoが強いほど、各レイヤーが少しずつ大きくずれる（変奏＝毎回わずかに違う）
      const shiftAmount = echo * 26 * layerT;
      const shiftAngle = layer * 2.4 + pseudoRandom(layer * 17) * Math.PI * 0.6;
      const shiftX = Math.round(Math.cos(shiftAngle) * shiftAmount);
      const shiftY = Math.round(Math.sin(shiftAngle) * shiftAmount);

      // わずかな拡大（毎回のフレーズが少し形を変える感覚）
      const scale = 1 + layerT * echo * 0.06;
      const scaledW = Math.round(w * scale);
      const scaledH = Math.round(h * scale);
      const offX = Math.round((scaledW - w) / 2) + shiftX;
      const offY = Math.round((scaledH - h) / 2) + shiftY;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // 元画像上での対応座標（縮小写像）
          const srcX = Math.round((x + offX) / scale);
          const srcY = Math.round((y + offY) / scale);
          if (srcX < 0 || srcX >= w || srcY < 0 || srcY >= h) continue;

          const srcI = (srcY * w + srcX) * 4;
          const dstI = (y * w + x) * 4;
          out[dstI]   = out[dstI]   * (1-opacity) + base[srcI]   * opacity;
          out[dstI+1] = out[dstI+1] * (1-opacity) + base[srcI+1] * opacity;
          out[dstI+2] = out[dstI+2] * (1-opacity) + base[srcI+2] * opacity;
        }
      }
    }
  }

  if (mono) {
    for (let i = 0; i < out.length; i += 4) {
      const gray = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
      out[i] = out[i+1] = out[i+2] = gray;
    }
  }

  const resultData = new ImageData(out, w, h);
  ctx.putImageData(resultData, 0, 0);
}

// ── UIイベント
contourSlider.addEventListener('input', () => {
  contourVal.textContent = contourSlider.value + '%';
  clearPresetActive();
  requestApply();
});
glowSlider.addEventListener('input', () => {
  glowVal.textContent = glowSlider.value + '%';
  clearPresetActive();
  requestApply();
});
dissolveSlider.addEventListener('input', () => {
  dissolveVal.textContent = dissolveSlider.value + '%';
  clearPresetActive();
  requestApply();
});
echoSlider.addEventListener('input', () => {
  echoVal.textContent = echoSlider.value + '%';
  clearPresetActive();
  requestApply();
});
wobbleSlider.addEventListener('input', () => {
  wobbleVal.textContent = wobbleSlider.value + '%';
  clearPresetActive();
  requestApply();
});
monochromeCheckbox.addEventListener('change', applyClairDeLune);

// ── Moon Profile
const MOON_PROFILES = {
  whisper:      { contour: 65, glow: 15, dissolve: 10, echo: 5,  wobble: 8  }, // かすかな階調
  clairdelune:  { contour: 40, glow: 35, dissolve: 25, echo: 20, wobble: 18 }, // 標準的な月光
  fog:          { contour: 15, glow: 45, dissolve: 45, echo: 35, wobble: 30 }, // 深く霧に沈む
  reverie:      { contour: 5,  glow: 60, dissolve: 60, echo: 55, wobble: 40 }, // 夢のように溶ける
};

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const profile = MOON_PROFILES[btn.dataset.profile];
    if (!profile) return;
    contourSlider.value = profile.contour;
    contourVal.textContent = profile.contour + '%';
    glowSlider.value = profile.glow;
    glowVal.textContent = profile.glow + '%';
    dissolveSlider.value = profile.dissolve;
    dissolveVal.textContent = profile.dissolve + '%';
    echoSlider.value = profile.echo;
    echoVal.textContent = profile.echo + '%';
    wobbleSlider.value = profile.wobble;
    wobbleVal.textContent = profile.wobble + '%';
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    requestApply();
  });
});

function clearPresetActive() { presetBtns.forEach(b => b.classList.remove('active')); }

// ── テーマ切り替え（Lune / Clair）
const THEME_CLASS_MAP = { lune: null, clair: 'theme-clair' };

function applyTheme(themeKey) {
  if (!(themeKey in THEME_CLASS_MAP)) return;
  Object.values(THEME_CLASS_MAP).forEach(cls => { if (cls) document.body.classList.remove(cls); });
  const cls = THEME_CLASS_MAP[themeKey];
  if (cls) document.body.classList.add(cls);
  themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === themeKey));
  try { localStorage.setItem('clairlune-theme', themeKey); } catch(e) {}
}

themeBtns.forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

try {
  const savedTheme = localStorage.getItem('clairlune-theme');
  if (savedTheme && (savedTheme in THEME_CLASS_MAP)) {
    applyTheme(savedTheme);
  } else if (savedTheme) {
    localStorage.removeItem('clairlune-theme');
  }
} catch(e) {}

// ── 保存（iOS対応：オーバーレイ方式）
downloadBtn.addEventListener('click', () => {
  try {
    const dataUrl = outputCanvas.toDataURL('image/png');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) {
      showSaveOverlay(dataUrl);
    } else {
      const link = document.createElement('a');
      link.download = 'clair-de-lune.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('PNG保存に失敗しました:', err);
    alert('画像の保存に失敗しました。ブラウザを再読み込みしてもう一度お試しください。');
  }
});

function showSaveOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(10,10,10,0.96);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 20px; box-sizing: border-box;
  `;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'max-width: 100%; max-height: 75vh; border-radius: 2px;';

  const hint = document.createElement('p');
  hint.innerHTML = '画像を長押しして「写真に保存」を選んでください<br><span style="color:#888; font-size:11px;">Press and hold the image, then tap "Save to Photos"</span>';
  hint.style.cssText = 'color: #ccc; font-family: sans-serif; font-size: 13px; margin-top: 16px; text-align: center; line-height: 1.6;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる / Close';
  closeBtn.style.cssText = `
    margin-top: 20px; padding: 10px 24px;
    background: transparent; color: white;
    border: 1px solid #666; border-radius: 2px;
    font-family: sans-serif; font-size: 13px; cursor: pointer;
  `;
  closeBtn.addEventListener('click', () => overlay.remove());

  overlay.appendChild(img);
  overlay.appendChild(hint);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}

resetBtn.addEventListener('click', () => {
  originalImage = null;
  originalImageData = null;
  outputCanvas.style.display = 'none';
  canvasBadge.style.display = 'none';
  dropZone.style.display = 'flex';
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  fileInput.value = '';
});
