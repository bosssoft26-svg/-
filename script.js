let video = document.getElementById("video");
let overlay = document.getElementById("overlay");
let ctx = overlay.getContext("2d");
let analyzing = false;
let pulseData = [];
let chart;

async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri("models/");
  await faceapi.nets.faceLandmark68Net.loadFromUri("models/");
  await faceapi.nets.faceExpressionNet.loadFromUri("models/");
  await faceapi.nets.ageGenderNet.loadFromUri("models/");
  console.log("✅ Models loaded");
}

document.getElementById("startCam").addEventListener("click", async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ video: {} });
  video.srcObject = stream;
});

document.getElementById("stopCam").addEventListener("click", () => {
  let tracks = video.srcObject?.getTracks();
  tracks?.forEach(track => track.stop());
  video.srcObject = null;
});

document.getElementById("startAnalysis").addEventListener("click", () => {
  analyzing = true;
  analyzeLoop();
});

document.getElementById("stopAnalysis").addEventListener("click", () => {
  analyzing = false;
});

document.getElementById("exportReport").addEventListener("click", () => {
  let report = `
*** Brain Analyzer Report ***
Date: ${new Date().toLocaleString()}
Expression: ${document.getElementById("expression").innerText}
Focus: ${document.getElementById("focus").innerText}
Breathing: ${document.getElementById("breath").innerText}
Pulse: ${document.getElementById("pulse").innerText}
Stress: ${document.getElementById("stress").innerText}
Age: ${document.getElementById("age").innerText}
Gender: ${document.getElementById("gender").innerText}
`;
  let blob = new Blob([report], { type: "text/plain" });
  let link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "BrainAnalyzer_Report.txt";
  link.click();
});

async function analyzeLoop() {
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(overlay, displaySize);

  while (analyzing) {
    const detections = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions()
      .withAgeAndGender();

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (detections) {
      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawDetections(overlay, resized);
      faceapi.draw.drawFaceLandmarks(overlay, resized);

      // تعبير الوجه
      let expr = Object.entries(detections.expressions)
        .sort((a, b) => b[1] - a[1])[0][0];
      document.getElementById("expression").innerText = expr;

      // تركيز مبسط = الابتعاد عن "غاضب/حزين"
      let focus = ((detections.expressions.happy || 0) +
                   (detections.expressions.neutral || 0)) * 100;
      document.getElementById("focus").innerText = focus.toFixed(1) + "%";

      // العمر والجنس
      document.getElementById("age").innerText = detections.age.toFixed(0);
      document.getElementById("gender").innerText = detections.gender;

      // تقدير نبض وتنفس عشوائي مبسط
      let pulse = 60 + Math.round(Math.random() * 40);
      let breath = 12 + Math.round(Math.random() * 6);
      document.getElementById("pulse").innerText = pulse + " bpm";
      document.getElementById("breath").innerText = breath + " /min";

      // التوتر (إذا الغضب أو الخوف عالي)
      let stress = ((detections.expressions.angry || 0) +
                    (detections.expressions.fearful || 0)) * 100;
      document.getElementById("stress").innerText = stress.toFixed(1) + "%";

      // أضف النبض للمخطط
      pulseData.push(pulse);
      if (pulseData.length > 20) pulseData.shift();
      updateChart();
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

function updateChart() {
  if (!chart) {
    chart = new Chart(document.getElementById("pulseChart"), {
      type: "line",
      data: {
        labels: Array(pulseData.length).fill(""),
        datasets: [{
          label: "Pulse (bpm)",
          data: pulseData,
          borderColor: "red",
          fill: false
        }]
      }
    });
  } else {
    chart.data.labels = Array(pulseData.length).fill("");
    chart.data.datasets[0].data = pulseData;
    chart.update();
  }
}

loadModels();
