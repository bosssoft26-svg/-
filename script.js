cat > script.js <<'EOF'
/* script.js - Brain Analyzer (face-api + pulse approx + blink + chart) */
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const pulseCanvas = document.getElementById('pulseCanvas');
const pulseCtx = pulseCanvas.getContext('2d');

/* UI elements */
const statusEl = document.getElementById('status');
const exprEl = document.getElementById('expressions');
const focusEl = document.getElementById('focus');
const blinksEl = document.getElementById('blinks');
const pulseEl = document.getElementById('pulse');
const stressEl = document.getElementById('stress');

const startCamBtn = document.getElementById('startCam');
const startAnalysisBtn = document.getElementById('startAnalysis');
const stopAnalysisBtn = document.getElementById('stopAnalysis');
const calibrateBtn = document.getElementById('calibrateBtn');
const exportBtn = document.getElementById('exportBtn');

let stream = null;
let analyzing = false;
let modelLoaded = false;

/* history for chart */
let history = []; // {t, focus, pulse}
const HISTORY_MAX = 60;

/* blink detection */
let lastEAR = 0;
let blinkTimes = [];

/* pulse signal */
let greenBuffer = []; // {t, v}
let baselineGreen = null;

/* chart */
let chart = null;

/* utilities */
function now(){ return Date.now(); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

/* ------------------ load face-api models ------------------ */
async function loadModels(){
  statusEl.textContent = 'جارٍ تحميل النماذج...';
  try{
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    await faceapi.nets.faceExpressionNet.loadFromUri('/models');
    modelLoaded = true;
    statusEl.textContent = '✔️ النماذج جاهزة';
  }catch(e){
    console.error('loadModels error', e);
    statusEl.textContent = 'خطأ بتحميل الموديلات (تحقق من مجلد /models)';
  }
}

/* ------------------ camera ------------------ */
async function startCamera(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    statusEl.textContent = '✔️ الكاميرا مفعلة';
  }catch(e){
    console.error('startCamera error', e);
    alert('خطأ: لا يمكن تشغيل الكاميرا. تأكد من إعطاء الإذن.');
    statusEl.textContent = '❌ لم يتم تفعيل الكاميرا';
  }
}

/* ------------------ EAR (eye aspect ratio) blink detection ------------------ */
function euclid(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y;
  return Math.hypot(dx,dy);
}
function eyeAspectRatio(eye){
  // eye: array of points (6)
  const A = euclid(eye[1], eye[5]);
  const B = euclid(eye[2], eye[4]);
  const C = euclid(eye[0], eye[3]);
  return (A + B) / (2.0 * C);
}

/* ------------------ detect frame ------------------ */
async function detectFrame(){
  if(!analyzing || !modelLoaded) return;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });
  const result = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceExpressions();

  ctx.clearRect(0,0,overlay.width, overlay.height);
  if(result){
    const resized = faceapi.resizeResults(result, { width: overlay.width, height: overlay.height });
    faceapi.draw.drawDetections(overlay, resized);
    faceapi.draw.drawFaceLandmarks(overlay, resized);

    // expressions
    const expr = result.expressions;
    const top = Object.keys(expr).reduce((a,b)=> expr[a] > expr[b] ? a : b);
    exprEl.textContent = `${top} (${Math.round(expr[top]*100)}%)`;

    // focus heuristic: face center vs frame center
    const box = result.detection.box;
    const faceCx = box.x + box.width/2;
    const faceCy = box.y + box.height/2;
    const dx = Math.abs(faceCx - overlay.width/2) / (overlay.width/2); // 0..1
    const dy = Math.abs(faceCy - overlay.height/2) / (overlay.height/2);
    const dist = Math.max(dx, dy);
    let focusScore = Math.round((1 - dist) * 100);
    focusScore = clamp(focusScore, 0, 100);
    focusEl.textContent = focusScore + '%';

    // blink via EAR
    const lm = result.landmarks;
    const leftEye = lm.getLeftEye();
    const rightEye = lm.getRightEye();
    const earL = eyeAspectRatio(leftEye);
    const earR = eyeAspectRatio(rightEye);
    const ear = (earL + earR) / 2;
    // EAR threshold tuned for face-api scale (~0.18)
    if(ear < 0.18 && lastEAR >= 0.18){
      // blink detected (edge)
      blinkTimes.push(now());
      // keep last minute
      blinkTimes = blinkTimes.filter(t => now() - t <= 60000);
    }
    lastEAR = ear;
    blinksEl.textContent = blinkTimes.length + ' /min';

    // pulse: take small ROI above nose/root (forehead)
    // roi coordinates relative to video pixels
    const roiX = Math.max(0, Math.floor(box.x + box.width*0.25));
    const roiY = Math.max(0, Math.floor(box.y + box.height*0.05));
    const roiW = Math.max(10, Math.floor(box.width*0.5));
    const roiH = Math.max(10, Math.floor(box.height*0.12));
    // draw small rectangle (optional visual)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(roiX, roiY, roiW, roiH);

    // copy ROI to pulseCanvas (scaled to 64x64)
    pulseCtx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, 64, 64);
    const im = pulseCtx.getImageData(0,0,64,64);
    let sumG = 0;
    for(let i=0;i<im.data.length;i+=4) sumG += im.data[i+1];
    const avgG = sumG / (im.data.length/4);
    greenBuffer.push({t: now(), v: avgG});
    // keep last 12 seconds
    greenBuffer = greenBuffer.filter(d => now() - d.t <= 12000);

    // estimate pulse using peak counting on smoothed signal
    const pulse = estimatePulseFromBuffer(greenBuffer);
    if(pulse) pulseEl.textContent = Math.round(pulse) + ' bpm';
    else pulseEl.textContent = '—';

    // stress heuristic (combine expressions + pulse + low focus)
    let stressScore = 0;
    stressScore += (expr.angry || 0) * 60;
    stressScore += (expr.fearful || 0) * 40;
    if(pulse && pulse > 90) stressScore += 15;
    if(focusScore < 45) stressScore += 15;
    stressScore = Math.round(clamp(stressScore, 0, 100));
    stressEl.textContent = stressScore + ' /100';

    // push history
    history.push({t: now(), focus: focusScore, pulse: pulse || 0});
    if(history.length > HISTORY_MAX) history.shift();
    updateChart();
    statusEl.textContent = '✔️ تحليل جاري';
  } else {
    statusEl.textContent = '❌ لم يتم العثور على وجه';
  }

  // loop
  if(analyzing) requestAnimationFrame(detectFrame);
}

/* ------------------ pulse estimation ------------------ */
/* simple smoothing + peak detection */
function smooth(values, window=5){
  const out = [];
  for(let i=0;i<values.length;i++){
    let s = 0, c=0;
    for(let j=Math.max(0,i-window); j<=Math.min(values.length-1,i+window); j++){ s += values[j]; c++; }
    out.push(s/c);
  }
  return out;
}
function estimatePulseFromBuffer(buf){
  if(buf.length < 40) return null; // need ~sec*fps samples
  const vals = buf.map(o=>o.v);
  // detrend (remove mean)
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const detr = vals.map(v=>v-mean);
  const smoothVals = smooth(detr, 3);
  // simple peak detection
  let peaks = [];
  for(let i=1;i<smoothVals.length-1;i++){
    if(smoothVals[i] > smoothVals[i-1] && smoothVals[i] > smoothVals[i+1] && smoothVals[i] > 0.6) {
      peaks.push(buf[i].t);
    }
  }
  // if not enough peaks, try lower threshold
  if(peaks.length < 2){
    for(let i=1;i<smoothVals.length-1;i++){
      if(smoothVals[i] > smoothVals[i-1] && smoothVals[i] > smoothVals[i+1] && smoothVals[i] > 0.2) {
        peaks.push(buf[i].t);
      }
    }
  }
  if(peaks.length < 2) return null;
  // compute average interval in seconds
  let intervals = [];
  for(let i=1;i<peaks.length;i++) intervals.push( (peaks[i] - peaks[i-1]) / 1000 );
  const avgInterval = intervals.reduce((a,b)=>a+b,0) / intervals.length;
  if(avgInterval <= 0) return null;
  const bpm = 60.0 / avgInterval;
  if(bpm < 35 || bpm > 200) return null;
  return bpm;
}

/* ------------------ chart ------------------ */
function setupChart(){
  const ctxChart = document.getElementById('historyChart').getContext('2d');
  chart = new Chart(ctxChart, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'تركيز %', data: [], borderColor: '#0ea5ff', tension:0.3, fill:false },
        { label: 'نبض bpm', data: [], borderColor: '#ff6b6b', tension:0.3, fill:false }
      ]
    },
    options: {
      responsive:true,
      scales: { x:{ display:false }, y:{ min:0, max:120 } }
    }
  });
}
function updateChart(){
  chart.data.labels = history.map(h=> new Date(h.t).toLocaleTimeString());
  chart.data.datasets[0].data = history.map(h=>h.focus);
  chart.data.datasets[1].data = history.map(h=>h.pulse);
  chart.update('none');
}

/* ------------------ calibration ------------------ */
function calibrate(){
  if(greenBuffer.length === 0){ alert('لا توجد بيانات للمعايرة بعد'); return; }
  baselineGreen = greenBuffer.reduce((a,b)=>a+b.v,0)/greenBuffer.length;
  alert('اكتملت المعايرة. القاعدة مسجلة.');
}

/* ------------------ export report ------------------ */
function exportReport(){
  const report = {
    at: new Date().toISOString(),
    status: statusEl.textContent,
    expressions: exprEl.textContent,
    focus: focusEl.textContent,
    blinks: blinksEl.textContent,
    pulse: pulseEl.textContent,
    stress: stressEl.textContent,
    history: history
  };
  const blob = new Blob([JSON.stringify(report,null,2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `yahya_report_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ------------------ button events ------------------ */
startCamBtn.addEventListener('click', async () => {
  await startCamera();
});
startAnalysisBtn.addEventListener('click', async () => {
  if(!modelLoaded) await loadModels();
  if(!stream) await startCamera();
  if(!chart) setupChart();
  analyzing = true;
  detectFrame();
});
stopAnalysisBtn.addEventListener('click', () => { analyzing = false; statusEl.textContent='⏸️ التوقّف'; });
calibrateBtn.addEventListener('click', calibrate);
exportBtn.addEventListener('click', exportReport);

/* load models at start (non-blocking) */
loadModels();
EOF
