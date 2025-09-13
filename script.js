// تحميل النماذج عند بداية الصفحة
async function loadModels() {
    await faceapi.nets.tinyFaceDetector.loadFromUri('models/')
    await faceapi.nets.faceExpressionNet.loadFromUri('models/')
    console.log("✅ Models loaded");
}

// تشغيل الكاميرا
async function startCamera() {
    const video = document.getElementById('video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        video.srcObject = stream;
    } catch (err) {
        alert("⚠️ لم يتم السماح بالكاميرا: " + err);
    }
}

// بدء التحليل
async function startAnalysis() {
    const video = document.getElementById('video');
    const statusEl = document.getElementById('status');

    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(video, displaySize);

    setInterval(async () => {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();

        if (detections.length > 0) {
            const expr = detections[0].expressions;
            let topEmotion = Object.keys(expr).reduce((a, b) => expr[a] > expr[b] ? a : b);

            statusEl.innerHTML = `
                😊 سعيد: ${(expr.happy * 100).toFixed(1)}% <br>
                😢 حزين: ${(expr.sad * 100).toFixed(1)}% <br>
                😡 غاضب: ${(expr.angry * 100).toFixed(1)}% <br>
                😨 خائف: ${(expr.fearful * 100).toFixed(1)}% <br>
                😮 مندهش: ${(expr.surprised * 100).toFixed(1)}% <br>
                😐 محايد: ${(expr.neutral * 100).toFixed(1)}% <br><br>
                🔎 الحالة المسيطرة الآن: <b>${topEmotion}</b>
            `;

        } else {
            statusEl.innerHTML = "⏳ لم يتم العثور على وجه...";
        }
    }, 1000);
}

// إيقاف التحليل
function stopAnalysis() {
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = "⏹️ تم إيقاف التحليل";
}
