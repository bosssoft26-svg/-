// script.js

const video = document.getElementById('video');
const startBtn = document.getElementById('start-btn');
const reportBox = document.getElementById('report-content');

async function loadModels() {
  reportBox.innerText = "Loading AI models...";
  await faceapi.nets.tinyFaceDetector.loadFromUri('models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('models');
  await faceapi.nets.faceExpressionNet.loadFromUri('models');
  await faceapi.nets.ageGenderNet.loadFromUri('models');
  reportBox.innerText = "Models loaded. Ready!";
}

async function startVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
    video.srcObject = stream;
  } catch (err) {
    console.error("Camera error:", err);
    reportBox.innerText = "Camera not accessible!";
  }
}

function generateReport(data) {
  return `
  *** Brain Analyzer Report ***
  Date: ${new Date().toLocaleString()}
  Expression: ${data.expression || "--"}
  Focus: ${data.focus || "--"}
  Breathing: ${data.breathing || "--"} /min
  Pulse: ${data.pulse || "--"} bpm
  Stress: ${data.stress || "--"}
  Age: ${data.age || "--"}
  Gender: ${data.gender || "--"}
  `;
}

function estimatePulse() {
  // تجريبي – بس بيعطي قيم تقريبية
  return 60 + Math.floor(Math.random() * 30);
}

function estimateBreathing() {
  return 10 + Math.floor(Math.random() * 6);
}

function estimateFocus(expressions) {
  if (expressions.neutral > 0.6) return "High";
  if (expressions.surprised > 0.4) return "Low";
  return "Medium";
}

function estimateStress(expressions) {
  if (expressions.angry > 0.5 || expressions.fearful > 0.5) return "High";
  if (expressions.happy > 0.6) return "Low";
  return "Medium";
}

async function analyzeFrame() {
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions()
    .withAgeAndGender();

  if (detection) {
    const expr = Object.entries(detection.expressions)
      .sort((a, b) => b[1] - a[1])[0][0]; // أقوى تعبير

    const data = {
      expression: expr,
      focus: estimateFocus(detection.expressions),
      breathing: estimateBreathing(),
      pulse: estimatePulse(),
      stress: estimateStress(detection.expressions),
      age: Math.round(detection.age),
      gender: detection.gender
    };

    reportBox.innerText = generateReport(data);
  } else {
    reportBox.innerText = "No face detected...";
  }
}

startBtn.addEventListener('click', async () => {
  await loadModels();
  await startVideo();
  setInterval(analyzeFrame, 2000); // كل ثانيتين تحليل جديد
});
