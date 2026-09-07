const API_BASE = ""; // mismo servidor (FastAPI sirve todo)
const subtitle = document.getElementById("subtitle");

// ---------- Avatar Live2D ----------
let live2dModel = null;

async function setupLive2D() {
  const canvas = document.getElementById("canvas");
  const app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    backgroundAlpha: 0,
    resizeTo: canvas.parentElement,
  });

  try {
    // Coloca tu modelo en frontend/assets/model/nombre_de_modelo/tu_modelo.model3.json
    live2dModel = await PIXI.live2d.Live2DModel.from(
      // Modelo de ejemplo:
      "assets/model/Haru/Haru.model3.json"
    );
    app.stage.addChild(live2dModel);

    const scale = Math.min(
      app.renderer.width / live2dModel.width,
      app.renderer.height / live2dModel.height
    ) * 0.9;
    live2dModel.scale.set(scale);
    live2dModel.x = (app.renderer.width - live2dModel.width) / 2;
    live2dModel.y = (app.renderer.height - live2dModel.height) / 2;
  } catch (e) {
    console.warn("No pude cargar el modelo Live2D todavía:", e);
    subtitle.textContent = "(Coloca tu modelo Live2D en assets/model/ — ver README)";
  }
}
setupLive2D();

function setMouthOpen(value) {
  // El nombre del parámetro puede variar según el modelo (ParamMouthOpenY es el estándar de Cubism)
  if (!live2dModel) return;
  try {
    live2dModel.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", value);
  } catch (e) {
    /* el modelo puede usar otro id de parámetro; ignorar */
  }
}

// ---------- Reproducir respuesta + lip-sync por volumen ----------
function playReplyAudio(base64Audio, mime = "audio/mp3") {
  return new Promise((resolve) => {
    if (!base64Audio) return resolve();
    const audio = new Audio(`data:${mime};base64,` + base64Audio);

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setMouthOpen(Math.min(1, avg / 60));
      if (!audio.paused && !audio.ended) requestAnimationFrame(tick);
      else setMouthOpen(0);
    }

    audio.onended = () => {
      setMouthOpen(0);
      ctx.close();
      resolve();
    };

    audio.play();
    tick();
  });
}

// ---------- Enviar texto/audio al backend ----------
async function sendText(text) {
  subtitle.textContent = "...";
  const res = await fetch(`${API_BASE}/api/chat_text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  subtitle.textContent = data.reply_text;
  await playReplyAudio(data.audio_base64, data.mime);
}

async function sendAudioBlob(blob) {
  console.log(`[mic] Audio grabado: ${blob.size} bytes`);
  subtitle.textContent = "...";
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  const res = await fetch(`${API_BASE}/api/chat_audio`, { method: "POST", body: form });
  const data = await res.json();
  if (data.user_text) subtitle.textContent = data.reply_text;
  await playReplyAudio(data.audio_base64, data.mime);
}

// ---------- Controles: texto ----------
document.getElementById("text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("text-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendText(text);
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/reset`, { method: "POST" });
  subtitle.textContent = "(memoria reiniciada)";
});
const micBtn = document.getElementById("mic-btn");
let mediaRecorder, chunks = [];

// Micrófono para grabar (sostenido)
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  chunks = [];
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    sendAudioBlob(blob);
    stream.getTracks().forEach((t) => t.stop());
  };
  mediaRecorder.start();
  micBtn.classList.add("recording");
  micBtn.textContent = "Grabando... suelta para enviar";
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  micBtn.classList.remove("recording");
  micBtn.textContent = "Mantén presionado para hablar";
}

micBtn.addEventListener("mousedown", startRecording);
micBtn.addEventListener("mouseup", stopRecording);
micBtn.addEventListener("mouseleave", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
});
// Soporte táctil (celular/tablet)
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); });

// ---------- 6. Palabra clave (nombre del asistente) — funciona en cualquier navegador ----------
// En vez del API nativo: grabamos en segmentos cortos y los transcribimos.

// WAKE WORDS debe coincidir con el nombre del asistente en personality.py (o sus variantes)
const WAKE_WORDS = ["aria"]; // agrega variantes si quieres, ej: "ey (nombre del asistente)", "maría" (por si Whisper confunde)
const wakeBtn = document.getElementById("wake-btn");
let wakeListening = false;
let wakeStream = null;
let wakeAudioContext = null;

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function containsWakeWord(text) {
  const clean = stripAccents(text.toLowerCase());
  return WAKE_WORDS.some((w) => clean.includes(w));
}

// Extrae lo que se dijo DESPUÉS de la palabra clave, si vino en la misma frase
// ej: "oye (nombre del asistente) abre discord" -> "abre discord"
function extractCommandAfterWakeWord(text) {
  const clean = stripAccents(text.toLowerCase());
  const idx = clean.indexOf("aria");
  if (idx === -1) return "";
  return text.slice(idx + 4).replace(/^[,.\s]+/, "").trim();
}

async function recordChunk(stream, ms) {
  return new Promise((resolve) => {
    const rec = new MediaRecorder(stream);
    let chunk;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunk = e.data;
      if (rec.state !== "inactive") rec.stop();
    };
    rec.onstop = () => resolve(chunk || new Blob([], { type: "audio/webm" }));
    rec.start(ms);
  });
}

async function transcribeOnly(blob) {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  const res = await fetch(`${API_BASE}/api/wake_transcribe`, { method: "POST", body: form });
  const data = await res.json();
  return data.text || "";
}

async function wakeWordLoop() {
  while (wakeListening) {
    const blob = await recordChunk(wakeStream, 3000);
    if (!wakeListening) break; // se pudo haber apagado mientras grababa

    let text = "";
    try {
      text = await transcribeOnly(blob);
    } catch (e) {
      console.warn("[wake] error transcribiendo:", e);
      continue;
    }

    if (text && containsWakeWord(text)) {
      const command = extractCommandAfterWakeWord(text);
      if (command.length > 2) {
        // Ya dijo todo en una sola frase: "oye (nombre del asistente), abre discord"
        await sendText(command);
      } else {
        // Solo dijo la palabra clave: espera el comando por separado
        subtitle.textContent = "¿Sí?";
        const commandBlob = await recordChunk(wakeStream, 4000);
        await sendAudioBlob(commandBlob);
      }
      // Da tiempo a que termine de hablar antes de seguir escuchando
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

wakeBtn.addEventListener("click", async () => {
  if (!wakeListening) {
    wakeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    wakeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    await wakeAudioContext.resume();
    const source = wakeAudioContext.createMediaStreamSource(wakeStream);
    const analyser = wakeAudioContext.createAnalyser();
    source.connect(analyser);
    wakeListening = true;
    wakeBtn.textContent = "Escuchando... (clic para apagar)";
    wakeBtn.classList.add("recording");
    wakeWordLoop();
  } else {
    wakeListening = false;
    wakeStream.getTracks().forEach((t) => t.stop());
    if (wakeAudioContext) {
      await wakeAudioContext.close();
      wakeAudioContext = null;
    }
    wakeBtn.textContent = "Activar palabra clave";
    wakeBtn.classList.remove("recording");
  }
});
