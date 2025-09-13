/* script.js - Brain Analyzer (complete) */
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const pulseCanvas = document.getElementById('pulseCanvas');
const pulseCtx = pulseCanvas.getContext('2d');

const expressionEl = document.getElementById('expression');
const focusEl = document.getElementById('focus');
const blinksEl = document.getElementById('blinks');
const pulseEl = document.getElementById('pulse');
const stressEl = document.getElementById('stress');
const ageEl = document.getElementById('age');
const genderEl = document.getElementById('gender');

const startCamBtn = document.getElementById('startCam');
const startAnalysisBtn = document.getElementById('startAnalysis');
const stopAnalysisBtn = document.getElementById('stopAnalysis');
const stopCamBtn = document.getElementById('stopCam');
const exportBtn = document.getElementById('exportReport');

const ctx = overlay.getContext('2d');

let stream = null;
let analyzing = false;
let modelLoaded = false;
let rafId = null;

/* blink */
let lastEAR = 0;
let blinkTimes = [];

/* pulse */
let greenBuffer = []; // {t, v}

/* chart & history */
let pulseChart = null;
let history = [];

/* load models (including age/gender if available) */
async function loadModels(){
  try{
    await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('./models');
    await faceapi.nets.faceExpressionNet.loadFromUri('./models');
    // optional: load age & gender if present (won't throw if missing)
    try{
      await faceapi.nets.ageGenderNet.loadFromUri('./models');
      console.log('age/gender model loaded');
    }catch(e){
      console.log('age/gender model not found (optional). To enable age/gender download age_gender model into /models');
    }
    modelLoaded = true;
    console.log('Models loaded');
  } catch(e){
    console.error('Error loading models:', e);
    alert('خطأ بتحميل الموديلات. تأكد أن مجلد /models موجود ومحتوي الموديلات.');
  }
}
loadModels();

/* camera start/stop */
startCamBtn.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user' }, audio:false });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  } catch(e){
    console.error('Camera error', e);
    alert('خطأ: لا يمكن تشغيل الكاميرا. تأكد من إعطاء الإذن.');
  }
});

stopCamBtn.addEventListener('click', () => {
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream = null;
  }
  video.pause();
  video.srcObject = null;
  ctx.clearRect(0,0,overlay.width,overlay.height);
});

/* utils */
function now(){ return Date.now(); }
function euclid(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function eyeAspectRatio(eye){
  const A = euclid(eye[1], eye[5]);
  const B = euclid(eye[2], eye[4]);
  const C = euclid(eye[0], eye[3]);
  return (A + B) / (2.0 * C);
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

/* smoothing & pulse estimation */
function smooth(values, window=3){
  const out = [];
  for(let i=0;i<values.length;i++){
    let s=0,c=0;
    for(let j=Math.max(0,i-window); j<=Math.min(values.length-1,i+window); j++){ s+=values[j]; c++; }
    out.push(s/c);
  }
  return out;
}
function estimatePulseFromBuffer(buf){
  if(buf.length < 30) return null;
  const vals = buf.map(o=>o.v);
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const detr = vals.map(v=>v-mean);
  const smoothVals = smooth(detr,2);
  let peaks = [];
  for(let i=1;i<smoothVals.length-1;i++){
    if(smoothVals[i] > smoothVals[i-1] && smoothVals[i] > smoothVals[i+1] && smoothVals[i] > 0.6) peaks.push(buf[i].t);
  }
  if(peaks.length < 2){
    for(let i=1;i<smoothVals.length-1;i++){
      if(smoothVals[i] > smoothVals[i-1] && smoothVals[i] > smoothVals[i+1] && smoothVals[i] > 0.25) peaks.push(buf[i].t);
    }
  }
  if(peaks.length < 2) return null;
  let intervals = [];
  for(let i=1;i<peaks.length;i++) intervals.push((peaks[i] - peaks[i-1]) / 1000);
  const avg = intervals.reduce((a,b)=>a+b,0) / intervals.length;
  if(avg <= 0) return null;
  const bpm = 60 / avg;
  if(bpm < 35 || bpm > 200) return null;
  return Math.round(bpm);
}

/* chart */
function setupChart(){
  const ctxChart = document.getElementById('pulseChart').getContext('2d');
  pulseChart = new Chart(ctxChart, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label: 'نبض (bpm)', data: [], borderColor:'#ef4444', tension:0.3, fill:false }]
    },
    options: { responsive:true, scales:{ y:{ min:30, max:160 } } }
  });
}

/* main loop */
async function detectFrame(){
  if(!analyzing || !modelLoaded) return;
  try{
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize:160, scoreThreshold:0.5 });
    const result = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceExpressions().withAgeAndGender().catch(()=>null);

    ctx.clearRect(0,0,overlay.width,overlay.height);
    if(result){
      const resized = faceapi.resizeResults(result, { width: overlay.width, height: overlay.height });
      faceapi.draw.drawDetections(overlay, resized);
      faceapi.draw.drawFaceLandmarks(overlay, resized);

      // expressions
      const expr = result.expressions;
      const top = Object.keys(expr).reduce((a,b)=> expr[a] > expr[b] ? a : b);
      expressionEl.textContent = `${top} (${Math.round(expr[top]*100)}%)`;

      // focus: center closeness
      const box = result.detection.box;
      const fx = box.x + box.width/2;
      const fy = box.y + box.height/2;
      const dx = Math.abs(fx - overlay.width/2) / (overlay.width/2);
      const dy = Math.abs(fy - overlay.height/2) / (overlay.height/2);
      let focusScore = Math.round((1 - Math.max(dx,dy)) * 100);
      focusScore = clamp(focusScore, 0, 100);
      focusEl.textContent = focusScore + '%';

      // EAR blink detection
      const lm = result.landmarks;
      const leftEye = lm.getLeftEye();
      const rightEye = lm.getRightEye();
      const earL = eyeAspectRatio(leftEye);
      const earR = eyeAspectRatio(rightEye);
      const ear = (earL + earR) / 2;
      if(ear < 0.18 && lastEAR >= 0.18) {
        blinkTimes.push(now());
        blinkTimes = blinkTimes.filter(t => now() - t <= 60000);
      }
      lastEAR = ear;
      blinksEl.textContent = (blinkTimes.length) + ' /min';

      // PPG: ROI on forehead
      const roiX = Math.max(0, Math.floor(box.x + box.width*0.25));
      const roiY = Math.max(0, Math.floor(box.y + box.height*0.05));
      const roiW = Math.max(6, Math.floor(box.width*0.5));
      const roiH = Math.max(6, Math.floor(box.height*0.12));
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(roiX, roiY, roiW, roiH);

      pulseCtx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, 64, 64);
      const im = pulseCtx.getImageData(0,0,64,64);
      let sumG = 0;
      for(let i=0;i<im.data.length;i+=4) sumG += im.data[i+1];
      const avgG = sumG / (im.data.length/4);
      greenBuffer.push({t: now(), v: avgG});
      greenBuffer = greenBuffer.filter(o => now() - o.t <= 12000);

      const pulse = estimatePulseFromBuffer(greenBuffer);
      if(pulse) pulseEl.textContent = pulse + ' bpm';
      else pulseEl.textContent = '--';

      // stress heuristic
      let stress = 0;
      stress += (expr.angry || 0) * 60;
      stress += (expr.fearful || 0) * 40;
      if(pulse && pulse > 95) stress += 15;
      if(focusScore < 40) stress += 15;
      stress = Math.round(clamp(stress, 0, 100));
      stressEl.textContent = stress + ' /100';

      // age & gender if present
      if(result.age && result.gender){
        ageEl.textContent = Math.round(result.age) + ' سنة';
        genderEl.textContent = result.gender;
      } else {
        ageEl.textContent = '--';
        genderEl.textContent = '--';
      }

      // history & chart
      history.push({t: now(), focus: focusScore, pulse: pulse || null});
      if(history.length > 60) history.shift();
      if(!pulseChart) setupChart();
      pulseChart.data.labels = history.map(h => new Date(h.t).toLocaleTimeString());
      pulseChart.data.datasets[0].data = history.map(h => h.pulse || null);
      pulseChart.update('none');

    } else {
      expressionEl.textContent = '--';
      focusEl.textContent = '--';
      blinksEl.textContent = '--';
      pulseEl.textContent = '--';
      stressEl.textContent = '--';
      ageEl.textContent = '--';
      genderEl.textContent = '--';
    }
  } catch(err){
    console.error('detection error', err);
  }
  if(analyzing) rafId = requestAnimationFrame(detectFrame);
}

/* controls */
startAnalysisBtn.addEventListener('click', async () => {
  if(!modelLoaded) await loadModels();
  if(!stream || !video.srcObject){
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user' }, audio:false });
      video.srcObject = stream;
      await video.play();
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    } catch(e){ alert('خطأ بتشغيل الكاميرا: '+e); return; }
  }
  if(!pulseChart) setupChart();
  analyzing = true;
  detectFrame();
});

stopAnalysisBtn.addEventListener('click', () => {
  analyzing = false;
  if(rafId) cancelAnimationFrame(rafId);
  expressionEl.textContent = '--';
});

stopCamBtn.addEventListener('click', () => {
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  video.pause(); video.srcObject = null;
});

/* export report (UTF-8) */
exportBtn.addEventListener('click', () => {
  const report = `
*** تقرير Brain Analyzer ***
الوقت: ${new Date().toLocaleString()}
التعابير: ${expressionEl.textContent}
التركيز: ${focusEl.textContent}
معدل الرمش: ${blinksEl.textContent}
النبض التقريبي: ${pulseEl.textContent}
مؤشر التوتر: ${stressEl.textContent}
العمر: ${ageEl.textContent}
الجنس: ${genderEl.textContent}
  `;
  const blob = new Blob([report], {type: 'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `BrainAnalyzer_Report_${Date.now()}.txt`;
  a.click();
});
