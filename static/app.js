const $ = (id) => document.getElementById(id);
const video = $("camera"), canvas = $("snapshot"), camMsg = $("cam-msg");
const countdown = $("countdown"), spinner = $("spinner"), spinLabel = $("spin-label");
const btnCapture = $("btn-capture"), btnRetake = $("btn-retake"), btnAnalyze = $("btn-analyze");
const errorBox = $("error-box"), results = $("results"), resultsEmpty = $("results-empty");
const concernList = $("concern-list"), resultPhoto = $("result-photo"), maskStrip = $("mask-strip");

const CONCERN_LABELS = {
  hd_wrinkle: "Wrinkles", hd_pore: "Pores", hd_texture: "Texture", hd_acne: "Acne",
  hd_redness: "Redness", hd_moisture: "Hydration", hd_dark_circle: "Dark circles",
  hd_radiance: "Radiance", wrinkle: "Wrinkles", pore: "Pores", texture: "Texture",
  acne: "Acne", redness: "Redness", moisture: "Hydration", dark_circle: "Dark circles",
  radiance: "Radiance", age_spot: "Age spots", oiliness: "Oiliness",
};

let stream = null;
let snapBlob = null;
let currentMaskUrl = null;

fetch("/api/status").then(r => r.json()).then(s => {
  const badge = $("api-badge");
  if (s.api_configured) { badge.textContent = "engine connected"; badge.classList.add("badge-ok"); }
  else { badge.textContent = "API key not set yet"; badge.classList.add("badge-no"); }
  btnCapture.disabled = false;
}).catch(() => { $("api-badge").textContent = "offline"; });

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
    });
    video.srcObject = stream;
    video.hidden = false; canvas.hidden = true;
    camMsg.hidden = true;
    btnCapture.disabled = false;
  } catch (err) {
    camMsg.hidden = false;
    camMsg.textContent = "Camera unavailable: " + (err.message || "permission denied") +
      ". You can also upload a selfie file below instead.";
    addFileFallback();
  }
}

function addFileFallback() {
  if (document.getElementById("file-input")) return;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.id = "file-input";
  input.className = "btn"; input.style.marginTop = "10px";
  input.addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    snapBlob = f;
    const url = URL.createObjectURL(f);
    video.hidden = true; canvas.hidden = false; canvas.srcObject = null;
    canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = url;
    camMsg.hidden = true; btnCapture.hidden = true; btnAnalyze.hidden = false; btnAnalyze.disabled = false;
    btnRetake.hidden = false;
  });
  document.querySelector(".controls").appendChild(input);
}

btnCapture.addEventListener("click", () => {
  btnCapture.disabled = true;
  let n = 3;
  countdown.hidden = false; countdown.textContent = n;
  const t = setInterval(() => {
    n -= 1;
    if (n > 0) { countdown.textContent = n; return; }
    clearInterval(t); countdown.hidden = true;
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      snapBlob = blob;
      video.hidden = true; canvas.hidden = false;
      btnCapture.hidden = true; btnRetake.hidden = false;
      btnAnalyze.hidden = false; btnAnalyze.disabled = false;
    }, "image/png", 0.95);
  }, 900);
});

btnRetake.addEventListener("click", () => {
  snapBlob = null;
  video.hidden = false; canvas.hidden = true;
  btnCapture.hidden = false; btnCapture.disabled = false;
  btnRetake.hidden = true; btnAnalyze.hidden = true;
  results.hidden = true; resultsEmpty.hidden = false;
  clearMask();
});

btnAnalyze.addEventListener("click", async () => {
  if (!snapBlob) return;
  btnAnalyze.disabled = true; btnRetake.disabled = true;
  errorBox.hidden = true;
  spinner.hidden = false; spinLabel.textContent = "Uploading selfie…";
  try {
    const form = new FormData();
    form.append("image", snapBlob, "selfie.png");
    const res = await fetch("/api/analyze", { method: "POST", body: form });
    spinLabel.textContent = "Analyzing skin…";
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Analysis failed (" + res.status + ")");
    render(body);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    spinner.hidden = true;
    btnAnalyze.disabled = false; btnRetake.disabled = false;
  }
});

function collectResults(data) {
  const out = [];
  const outputs = (data.results && data.results.output) || data.output || [];
  for (const item of outputs) {
    if (typeof item.ui_score !== "number") continue;
    out.push({ type: item.type, label: CONCERN_LABELS[item.type] || item.type,
               score: item.ui_score, raw: item.raw_score, mask: (item.mask_urls || [])[0] || null });
  }
  return out;
}

function render(data) {
  const items = collectResults(data);
  if (!items.length) {
    errorBox.textContent = "The engine returned no scores for this photo. Try a brighter, front-facing selfie.";
    errorBox.hidden = false;
    return;
  }
  resultsEmpty.hidden = true; results.hidden = false;
  resultPhoto.src = canvas.toDataURL("image/png");
  concernList.innerHTML = "";
  items.forEach((it) => {
    const card = document.createElement("div");
    card.className = "concern";
    card.innerHTML = `<div class="concern-top"><span class="concern-name">${it.label}</span>
      <span class="concern-score">${it.score}</span></div>
      <div class="concern-bar"><div class="concern-fill" style="width:${Math.max(2, Math.min(100, it.score))}%"></div></div>`;
    if (it.mask) {
      card.addEventListener("click", () => {
        currentMaskUrl = currentMaskUrl === it.mask ? null : it.mask;
        document.querySelectorAll(".concern").forEach(c => c.classList.remove("active"));
        if (currentMaskUrl) card.classList.add("active");
        resultPhoto.src = currentMaskUrl || canvas.toDataURL("image/png");
      });
    }
    concernList.appendChild(card);
  });
  maskStrip.innerHTML = "";
  items.filter(i => i.mask).forEach((it) => {
    const chip = document.createElement("span");
    chip.className = "mask-chip"; chip.textContent = it.label + " mask";
    chip.addEventListener("click", () => {
      currentMaskUrl = currentMaskUrl === it.mask ? null : it.mask;
      resultPhoto.src = currentMaskUrl || canvas.toDataURL("image/png");
    });
    maskStrip.appendChild(chip);
  });
}

function clearMask() { currentMaskUrl = null; }

window.addEventListener("beforeunload", () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
startCamera();
