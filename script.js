async function start() {
  // تحميل نماذج face-api
  await faceapi.nets.tinyFaceDetector.loadFromUri("https://cdn.jsdelivr.net/npm/face-api.js/models");
  await faceapi.nets.faceExpressionNet.loadFromUri("https://cdn.jsdelivr.net/npm/face-api.js/models");

  const video = document.getElementById("webcam");

  // طلب إذن الكاميرا
  navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;
  });

  // تشغيل WebGazer لتتبع العين
  webgazer.setGazeListener((data) => {
    if (!data) return;
    let status = document.getElementById("status");
    if (data.x < window.innerWidth/3) {
      status.innerText = "🧠 الحالة: شرود";
    } else if (data.x > 2*window.innerWidth/3) {
      status.innerText = "🧠 الحالة: تفكير جانبي";
    } else {
      status.innerText = "🧠 الحالة: تركيز عالي";
    }
  }).begin();

  // تحليل تعابير الوجه كل 500ms
  setInterval(async () => {
    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
    if (detections && detections.expressions) {
      const expr = detections.expressions;
      let maxExpr = Object.keys(expr).reduce((a, b) => expr[a] > expr[b] ? a : b);
      document.getElementById("emotion").innerText = "😊 تعابير الوجه: " + maxExpr;
    }
  }, 500);
}

start();
