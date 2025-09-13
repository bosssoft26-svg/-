// ---------------------- إعداد الـ DOM ----------------------
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');

const stateEl = document.getElementById('state');
const emotionEl = document.getElementById('emotion');
const focusEl = document.getElementById('focus');
const blinkRateEl = document.getElementById('blinkRate');
const hrEl = document.getElementById('hr');

let stream = null;
let running = false;

// سجل بيانات للحظيّات (للرسم)
const history = [];
const HISTORY_MAX = 60; // ثواني

// ---------------------- تحميل موديلات face-api ----------------------
async function loadFaceApiModels() {
  // نحمّل الموديلات من مجلد models في المستودع (يجب وضعها في /models)
  // إذا لم تضعها محليًا، يمكنك استخدام تحميل خارجي (لكن قد لا تكون متاحة)
  await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
  await faceapi.nets.faceExpressionNet.loadFromUri('/models');
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models');
}

// ---------------------- تشغيل الكاميرا ----------------------
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480 }, audio: true });
  video.srcObject = stream;
  await video.play();

  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

// ---------------------- Mediapipe FaceMesh للاقتصاد بالـ landmarks ----------------------
let faceMesh = null;
function initFaceMesh(onResults) {
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  faceMesh.onResults(onResults);
}

// ---------------------- متغيرات Blink & PPG ----------------------
let lastBlinkTimes = [];
let greenBuffer = []; // للـ PPG (قيمة + timestamp)

// ---------------------- عملية التحليل الرئيسية ----------------------
async function analysisLoop() {
  if (!running) return;

  // نرسم إطار الفيديو كصورة لتحليل PPG لاحقًا
  ctx.drawImage(video, 0, 0, overlay.width, overlay.height);

  // 1) كشف الوجوه وتعابير الوجه عبر face-api
  const options = new faceapi.TinyFaceDetectorOptions();
  const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks(true).withFaceExpressions();
  // 2) إرسال إطار إلى faceMesh لتحليل landmarks أوسع
  await faceMesh.send({image: video});

  // رسم نتائج face-api
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 1.5;
  ctx.clearRect(0,0,overlay.width, overlay.height);
  ctx.drawImage(video, 0, 0, overlay.width, overlay.height);

  let emotionText = 'غير مكتشف';
  if (detection) {
    // رسم صندوق تقريبي
    const box = detection.detection.box;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // انفعالات الوجه (face-api)
    const expr = detection.expressions;
    const top = Object.keys(expr).reduce((a,b)=> expr[a]>expr[b]?a:b);
    emotionText = `${top} (${Math.round(expr[top]*100)}%)`;
    emotionEl.innerText = emotionText;

    // منطقة وسط الوجه لاستخراج PPG (تقريبي)
    const sx = Math.max(0, Math.floor(box.x + box.width*0.25));
    const sy = Math.max(0, Math.floor(box.y + box.height*0.35));
    const sw = Math.max(10, Math.floor(box.width*0.5));
    const sh = Math.max(10, Math.floor(box.height*0.25));
    try {
      const img = ctx.getImageData(sx, sy, sw, sh);
      let sumG = 0;
      for (let i=0;i<img.data.length;i+=4) sumG += img.data[i+1];
      const avgG = sumG / (img.data.length/4);
      greenBuffer.push({t: performance.now(), v: avgG});
      if (greenBuffer.length > 300) greenBuffer.shift();
    } catch(e){ /* cross-origin etc */ }
  } else {
    emotionEl.innerText = 'غير مكتشف';
  }

  // 3) Blink detection بسيط من landmarks (ما تدخّل كثير في الأداء)
  // نراقب مسافة بين نقاط الجفون (Landmarks من faceMesh)
  // blink detection يعتمد على انخفاض نسبة المسافة بين الجفون
  // blinkTimes يتم تسجيلها عند اكتشاف غمضة
  // سيتم تحديدها داخل callback faceMesh.onResults (انظر أدناه)

  // 4) حساب نبض تقريبي من greenBuffer
  const hr = estimateHR(greenBuffer);
  if (hr) hrEl.innerText = Math.round(hr) + ' bpm';
  else hrEl.innerText = '—';

  // 5) حساب تركيز تقريبي:
  // heuristic: إذا كان الوجه في مركز الصورة وعيون مفتوحة => تركيز أعلى
  let focusScore = 50;
  if (detection) {
    const box = detection.detection.box;
    // قرب المركز
    const cx = box.x + box.width/2;
    const cy = box.y + box.height/2;
    const dx = Math.abs(cx - overlay.width/2) / (overlay.width/2);
    const dy = Math.abs(cy - overlay.height/2) / (overlay.height/2);
    const distFactor = Math.max(dx, dy); // 0 = مركز، 1 = بعيد
    focusScore = Math.round((1 - distFactor) * 100);
  }
  focusEl.innerText = focusScore + '%';

  // 6) Blink rate حساب معدل الرمش في الدقيقة
  // نحسب عدد الرمش خلال آخر 60 ثانية
  const now = performance.now();
  lastBlinkTimes = lastBlinkTimes.filter(t => now - t <= 60000);
  const blinkRate = Math.round((lastBlinkTimes.length) * (60/60)); // per min
  blinkRateEl.innerText = blinkRate + ' /min';

  // 7) تحديد الحالة العامة (تجميعي)
  let stateParts = [];
  if (emotionText.toLowerCase().includes('happy') || emotionText.includes('happy') ) stateParts.push('مسرور');
  if (emotionText.toLowerCase().includes('sad') || emotionText.includes('sad')) stateParts.push('حزين');
  if (focusScore > 70) stateParts.push('مركز');
  if (focusScore < 40) stateParts.push('مشوش/شارد');
  if (hr && hr > 95) stateParts.push('متحمس/متوتر');
  if (stateParts.length===0) stateParts.push('محايد/غير واضح');
  stateEl.innerText = stateParts.join(' • ');

  // 8) سجل بيانات للـ chart
  history.push({t:Date.now(), focus:focusScore, hr: hr||0});
  if (history.length > HISTORY_MAX) history.shift();
  updateChart();

  // استمر
  if (running) requestAnimationFrame(analysisLoop);
}

// ---------------------- faceMesh onResults (للـ landmarks وblink) ----------------------
initFaceMesh((results) => {
  // رسم نقاط landmarks خفيفة
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length===0) return;
  const lm = results.multiFaceLandmarks[0];
  // الرسم: نقاط صغيرة حول العينين والفم
  ctx.fillStyle = 'rgba(255,0,0,0.7)';
  // عين يمنى وعين يسار: نستخدم مؤشرات لمواقع الجفن العلوي والسفلي
  // مراجع: FaceMesh indices - نأخذ نقاط لقرب العين
  const leftUpper = lm[159]; // تقريب
  const leftLower = lm[145];
  const rightUpper = lm[386];
  const rightLower = lm[374];

  // حساب نسبة فتح العين لكل جانب
  const leftDist = Math.hypot(leftUpper.x - leftLower.x, leftUpper.y - leftLower.y);
  const rightDist = Math.hypot(rightUpper.x - rightLower.x, rightUpper.y - rightLower.y);
  // نضبط للنسبة على حسب حجم الوجه (نأخذ مسافة بين عيون كمقياس)
  const eyeSep = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y) || 0.0001;
  const leftRatio = leftDist / eyeSep;
  const rightRatio = rightDist / eyeSep;
  // إذا هالنسب صغرت فجأة تحت threshold => blink
  const BLINK_THRESH = 0.18; // تجربة - قد تحتاج ضبط
  const now = performance.now();
  if (leftRatio < BLINK_THRESH && rightRatio < BLINK_THRESH) {
    // سجل وقت blink إذا آخر blink مر وقت كافٍ (debounce)
    const last = lastBlinkTimes.length ? lastBlinkTimes[lastBlinkTimes.length-1] : 0;
    if (now - last > 250) { // 250ms debounce
      lastBlinkTimes.push(now);
    }
  }
});

// ---------------------- تقدير HR (PPG) مبسط ----------------------
function estimateHR(buf) {
  try {
    if (buf.length < 80) return null; // نحتاج بيانات كافية (لا تقل)
    // نحسب detrended signal
    const vals = buf.map(o=>o.v);
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const detr = vals.map(v=>v-mean);
    // نبحث peaks بسيطة
    let peaks = [];
    for (let i=1;i<detr.length-1;i++){
      if (detr[i]>detr[i-1] && detr[i]>detr[i+1] && detr[i]>0.5) peaks.push(buf[i].t);
    }
    if (peaks.length < 2) return null;
    // حساب فترات بين قمم
    let intervals = [];
    for (let i=1;i<peaks.length;i++) intervals.push((peaks[i]-peaks[i-1])/1000.0);
    const avgInterval = intervals.reduce((a,b)=>a+b,0)/intervals.length;
    const bpm = 60.0 / avgInterval;
    if (bpm < 35 || bpm > 200) return null;
    return bpm;
  } catch(e){ return null; }
}

// ---------------------- Chart.js للعرض التاريخي ----------------------
const ctxChart = document.getElementById('chart').getContext('2d');
const chart = new Chart(ctxChart, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'تركيز %', data: [], borderColor: '#0b63ff', tension:0.3, fill:false },
      { label: 'نبض bpm', data: [], borderColor: '#ff4d4f', tension:0.3, fill:false }
    ]
  },
  options: {
    responsive:true,
    scales: { x:{ display:false } }
  }
});
function updateChart(){
  chart.data.labels = history.map(h => new Date(h.t).toLocaleTimeString());
  chart.data.datasets[0].data = history.map(h => h.focus);
  chart.data.datasets[1].data = history.map(h => h.hr);
  chart.update('none');
}

// ---------------------- أزرار التحكم ----------------------
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  // تحميل موديلات face-api
  await loadFaceApiModels();
  await startCamera();
  // ابدأ التحليل
  running = true;
  requestAnimationFrame(analysisLoop);
});

stopBtn.addEventListener('click', () => {
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (stream) stream.getTracks().forEach(t => t.stop());
});

// تصدير تقرير بسيط كـ نص
exportBtn.addEventListener('click', () => {
  const report = {
    at: new Date().toISOString(),
    state: stateEl.innerText,
    emotion: emotionEl.innerText,
    focus: focusEl.innerText,
    blinkRate: blinkRateEl.innerText,
    hr: hrEl.innerText
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brain_report_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});
