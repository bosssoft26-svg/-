let video = document.getElementById("video");
let expEl = document.getElementById("exp");
let focusEl = document.getElementById("focus");
let respEl = document.getElementById("resp");
let pulseEl = document.getElementById("pulse");
let stressEl = document.getElementById("stress");
let ageEl = document.getElementById("age");
let genderEl = document.getElementById("gender");

let pulseData = [];
let pulseChart;

async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri("models/");
  await faceapi.nets.faceExpressionNet.loadFromUri("models/");
  await faceapi.nets.ageGenderNet.loadFromUri("models/");
  await faceapi.nets.faceLandmark68Net.loadFromUri("models/");
}

document.getElementById("startCam").onclick = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ video: {} });
  video.srcObject = stream;
};

document.getElementById("startAnalysis").onclick = async () => {
  await loadModels();
  analyze();
  setupChart();
};

document.getElementById("stopAnalysis").onclick = () => {
  clearInterval(window.analysisLoop);
};

function analyze() {
  window.analysisLoop = setInterval(async () => {
    let detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceExpressions().withAgeAndGender();

    if (detections) {
      expEl.textContent = detections.expressions.asSortedArray()[0].expression;
      focusEl.textContent = detections.expressions.happy > 0.5 ? "High" : "Low";
      ageEl.textContent = detections.age.toFixed(0);
      genderEl.textContent = detections.gender;

      // fake respiration & pulse just for demo
      let pulse = 60 + Math.floor(Math.random() * 40);
      let resp = 12 + Math.floor(Math.random() * 6);

      respEl.textContent = resp;
      pulseEl.textContent = pulse;
      stressEl.textContent = pulse > 90 ? "High" : "Normal";

      // update chart
      pulseData.push(pulse);
      if (pulseData.length > 20) pulseData.shift();
      pulseChart.update();
    }
  }, 1000);
}

function setupChart() {
  let ctx = document.getElementById("pulseChart").getContext("2d");
  pulseChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array(20).fill(""),
      datasets: [{
        label: "Pulse (bpm)",
        data: pulseData,
        borderColor: "red",
        fill: false
      }]
    }
  });
}

document.getElementById("exportReport").onclick = () => {
  let report = `*** Brain Analyzer Report ***
Date: ${new Date().toLocaleString()}
Expression: ${expEl.textContent}
Focus: ${focusEl.textContent}
Respiration: ${respEl.textContent} /min
Pulse: ${pulseEl.textContent} bpm
Stress: ${stressEl.textContent}
Age: ${ageEl.textContent}
Gender: ${genderEl.textContent}`;

  let blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  let link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "report.txt";
  link.click();
};
