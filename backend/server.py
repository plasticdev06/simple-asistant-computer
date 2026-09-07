import os
import json
import base64
import tempfile
import asyncio

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from groq import Groq
import edge_tts
import pyttsx3

# Herramientas definidas en otros archivos
from personality import SYSTEM_PROMPT
from tools import TOOL_DEFINITIONS, run_tool_call

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY") # Api key
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b") # Modelo de lenguaje
GROQ_ASR_MODEL = os.getenv("GROQ_ASR_MODEL", "whisper-large-v3-turbo") # Modelo para transcripción de voz
TTS_VOICE = os.getenv("TTS_VOICE", "es-MX-DaliaNeural") # # Voz del modelo para respuestas

if not GROQ_API_KEY:
    raise RuntimeError(
        "Falta GROQ_API_KEY. Copia backend/.env.example a backend/.env y pega tu key de https://console.groq.com/keys"
    )

client = Groq(api_key=GROQ_API_KEY)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Historial de conversación en memoria
conversation_history = [{"role": "system", "content": SYSTEM_PROMPT}]

# Solo envia cadenas de texto.
class TextMessage(BaseModel):
    text: str

def think(user_text: str) -> str:
    """Manda el texto al LLM, ejecuta tools si las pide, y devuelve la respuesta final."""
    conversation_history.append({"role": "user", "content": user_text})

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=conversation_history,
        tools=TOOL_DEFINITIONS,
        tool_choice="auto",
        max_tokens=200,
    )
    msg = response.choices[0].message 
    
    # Filtro, si el LLM recibe una palabra clave ejecuta una herramienta
    if msg.tool_calls:
        conversation_history.append(msg)
        for call in msg.tool_calls:
            args = json.loads(call.function.arguments or "{}")
            result = run_tool_call(call.function.name, args)
            conversation_history.append(
                {"role": "tool", "tool_call_id": call.id, "content": result}
            )
        # Segunda pasada: que redacte la respuesta hablada final
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=conversation_history,
            max_tokens=200,
        )
        msg = response.choices[0].message

    reply_text = msg.content or "..."
    conversation_history.append({"role": "assistant", "content": reply_text})
    return reply_text

async def synthesize_speech(text: str) -> tuple[str, str]:
    """Genera audio y lo devuelve como (base64, mime_type).
    Intenta edge-tts (voz online, gratis, buena calidad). Si falla
    (Microsoft a veces bloquea esta librería no oficial), usa pyttsx3
    como respaldo 100% offline con las voces instaladas en Windows/Mac/Linux.
    """
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            path = tmp.name
        communicate = edge_tts.Communicate(text, TTS_VOICE)
        await communicate.save(path)
        with open(path, "rb") as f:
            audio_bytes = f.read()
        os.remove(path)
        if not audio_bytes:
            raise RuntimeError("edge-tts devolvió un archivo vacío")
        return base64.b64encode(audio_bytes).decode("utf-8"), "audio/mp3"
    except Exception as e:
        print(f"[TTS] edge-tts falló ({e}); usando voz offline de respaldo (pyttsx3).")
        return await asyncio.to_thread(_synthesize_offline, text)

def _synthesize_offline(text: str) -> tuple[str, str]:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    engine = pyttsx3.init()
    engine.save_to_file(text, path)
    engine.runAndWait()
    with open(path, "rb") as f:
        audio_bytes = f.read()
    os.remove(path)
    return base64.b64encode(audio_bytes).decode("utf-8"), "audio/wav"

@app.post("/api/chat_text")
async def chat_text(msg: TextMessage):
    reply_text = think(msg.text)
    audio_b64, mime = await synthesize_speech(reply_text)
    return {"user_text": msg.text, "reply_text": reply_text, "audio_base64": audio_b64, "mime": mime}

@app.post("/api/chat_audio")
async def chat_audio(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name

    with open(path, "rb") as f:
        transcript = client.audio.transcriptions.create(
            model=GROQ_ASR_MODEL, file=(path, f.read()), language="es"
        )
    os.remove(path)

    user_text = transcript.text.strip()
    print(f"[ASR] Te escuché decir: \"{user_text}\"")
    if not user_text:
        return {"user_text": "", "reply_text": "No te escuché bien.", "audio_base64": "", "mime": "audio/mp3"}

    reply_text = think(user_text)
    audio_b64, mime = await synthesize_speech(reply_text)
    return {"user_text": user_text, "reply_text": reply_text, "audio_base64": audio_b64, "mime": mime}

@app.post("/api/wake_transcribe")
async def wake_transcribe(file: UploadFile = File(...)):
    """Transcripción rápida y sin memoria, solo para detectar la palabra clave."""
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    with open(path, "rb") as f:
        transcript = client.audio.transcriptions.create(
            model=GROQ_ASR_MODEL, file=(path, f.read()), language="es"
        )
    os.remove(path)
    return {"text": transcript.text.strip()}

# Limpiar memoria del chat
@app.post("/api/reset")
async def reset():
    global conversation_history
    conversation_history = [{"role": "system", "content": SYSTEM_PROMPT}]
    return {"ok": True}

# Sirve el frontend (HTML/JS/CSS) directamente desde este mismo servidor
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)