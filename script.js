let video = document.getElementById("video");
let overlay = document.getElementById("overlay");
let expressionEl = document.getElementById("expression");
let focusEl = document.getElementById("focus");
let bpmEl = document.getElementById("bpm");

let ctx = overlay.getContext("2d");
let analyzing = false;
let pulseData = [];
let chart;

// تحميل الموديلات
async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri("models/");
  await faceapi.nets.faceLandmark68Net.loadFromUri("models/");
  await faceapi.nets.faceExpressionNet.loadFromUri("models/");
}

// تشغيل الكاميرا
document.getElementById("startCam").addEventListener("click", async () => {
  navigator.mediaDevices.getUserMedia({ video: {} })
    .then(stream => {
      video.srcObject = stream;
    });
});

// بدء التحليل
document.getElementById("startBtn").addEventListener("click", async () => {
  if (!analyzing) {
    analyzing = true;
    runAnalysis();
  }
});

// إيقاف التحليل
document.getElementById("stopBtn").addEventListener("click", () => {
  analyzing = false;
});

// تصدير التقرير (بسيط كنص، ممكن نعمل PDF لاحقاً)
document.getElementById("exportBtn").addEventListener("click", () => {
  let report = `
  *** تقرير Brain Analyzer ***
  التعابير: ${expressionEl.innerText}
  التركيز: ${focusEl.innerText}
  معدل ضربات القلب: ${bpmEl.innerText} / دقيقة
  `;
  let blob = new Blob([report], { type: "text/plain" });
  let link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "report.txt";
  link.click();
});

// تحليل بالفيديو
async function runAnalysis() {
  overlay.width = video.width = 300;
  overlay.height = video.height = 220;

  while (analyzing) {
    const detections = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions();

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (detections) {
      // رسم
      faceapi.draw.drawDetections(overlay, detections);
      faceapi.draw.drawFaceLandmarks(overlay, detections);

      // استخراج تعابير
      let exp = detections.expressions;
      let maxExp = Object.keys(exp).reduce((a, b) => exp[a] > exp[b] ? a : b);
      expressionEl.innerText = maxExp;

      // تركيز (افتراضي على وضعية الوجه)
      focusEl.innerText = "جيد";

      // معدل ضربات القلب (تقديري وهمي)
      let bpm = 70 + Math.floor(Math.random() * 15);
      bpmEl.innerText = bpm;
      pulseData.push(bpm);
      if (pulseData.length > 20) pulseData.shift();

      updateChart();
    } else {
      expressionEl.innerText = "--";
      focusEl.innerText = "--";
      bpmEl.innerText = "--";
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// رسم مخطط نبض
function updateChart() {
  if (!chart) {
    chart = new Chart(document.getElementById("pulseChart"), {
      type: 'line',
      data: {
        labels: Array(pulseData.length).fill(""),
        datasets: [{
          label: "معدل ضربات القلب",
          data: pulseData,
          borderColor: "red",
          fill: false
        }]
      },
      options: { responsive: true }
    });
  } else {
    chart.data.labels = Array(pulseData.length).fill("");
    chart.data.datasets[0].data = pulseData;
    chart.update();
  }
}

// تحميل الموديلات عند التشغيل
loadModels();
