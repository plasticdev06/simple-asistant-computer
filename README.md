# simple-asistant-computer (SAC)

Esto es una versión ligera y 100% editable de un asistente con IA: le hablas, te responde
en voz (con subtítulos), tiene personalidad propia, y puede abrir apps por voz.
Corre en una sola laptop, sin GPU, usando la API de Groq.

## Qué necesitas antes de empezar

1. **Python 3.10, 3.11 o 3.12** instalado ([python.org](https://www.python.org/downloads/))
2. **Una API key gratuita de Groq**: entra a https://console.groq.com/keys , crea una cuenta
   y genera una key. Es gratis dentro de límites generosos.
3. **El "Cubism Core"** (motor que hace correr modelos Live2D en el navegador, gratis):
   - Ve a https://www.live2d.com/en/sdk/download/web/
   - Descarga el "Cubism SDK for Web"
   - Dentro del zip, busca el archivo `live2dcubismcore.min.js`
   - Cópialo a: `frontend/libs/live2dcubismcore.min.js`
   - Nota: El proyecto suele incluir este componente.
4. **Un modelo Live2D gratis para probar**:
   - El mismo SDK que descargaste en el paso 3 trae modelos de muestra (carpeta `Samples/Resources`,
     por ejemplo "Hiyori" o "Mao").
   - Copia toda la carpeta del modelo (el `.model3.json` y sus archivos `.moc3`, `.png`, `.physics3.json`, etc.)
     dentro de: `frontend/assets/model/`
   - Renombra el archivo principal a `Haru.model3.json`, o edita esa ruta en `frontend/app.js` (línea con `Live2DModel.from(...)`).
   - Puedes reemplazarlo por el modelo de tu preferencia o descargar otro con licencia de uso personal en sitios como Booth.pm).
   - Nota: El proyecto ya incluye modelos de ejemplo.

## Instalación

Abre una terminal en la carpeta del proyecto y corre:

```bash
cd backend
python -m venv venv

# Activar el entorno virtual:
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Copia el archivo de configuración y pega tu API key
cp .env.example .env
# (en Windows usa: copy .env.example .env)
```

Abre `backend/.env` con un editor de texto y pega tu `GROQ_API_KEY`.

## Ejecutar

```bash
cd backend
python server.py
```

Abre tu navegador en: **http://localhost:8000**

- Mantén presionado el botón del micrófono, habla, y suelta.
- También puedes escribir en el cuadro de texto.
- El botón "Reiniciar" borra la memoria de la conversación.
- Puedes ejecutar el modo Manos libres.

## Personalizarlo

- **Personalidad / nombre / forma de hablar**: edita `backend/personality.py`.
- **Voz**: cambia `TTS_VOICE` en `.env`. Para ver voces disponibles en español:
  ```bash
  edge-tts --list-voices | grep es-
  ```
- **Apps que puede abrir por voz**: edita `backend/tools.py` (lista `APP_WHITELIST`).
  Por seguridad, solo puede abrir lo que tú agregues ahí — nunca agregues comandos
  que borren archivos o maten procesos sin entender bien qué hacen.
- **Avatar**: reemplaza los archivos en `frontend/assets/model/` por cualquier modelo Cubism 4 (.model3.json).

## Notas de seguridad

- Este proyecto corre solo en tu laptop (`localhost`) — nadie más puede acceder a él por defecto.
- Si compartes este proyecto, no exhibas tu archivo `.env` (contiene tu API key).
- La función de abrir apps usa una lista blanca a propósito: revisa `tools.py` antes de agregar comandos nuevos.

Este proyecto fue desarrollado en conjunto con IA.