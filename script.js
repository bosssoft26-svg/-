window.onload = function() {
  webgazer.setGazeListener(function(data, elapsedTime) {
    if (!data) return;

    let status = document.getElementById("status");
    if (data.x < window.innerWidth/3) {
      status.innerText = "🧠 الحالة: شرود أو تفكير جانبي";
    } else if (data.x > 2*window.innerWidth/3) {
      status.innerText = "🧠 الحالة: تركيز باتجاه آخر";
    } else {
      status.innerText = "🧠 الحالة: تركيز عالي";
    }
  }).begin();
};
