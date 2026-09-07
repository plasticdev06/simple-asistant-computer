"""
Herramientas que el asistente puede ejecutar en tu PC.
Por seguridad, SOLO puede abrir apps de esta lista blanca. Agrega herramientas propias.
Nunca agregues comandos que borren archivos o cierren procesos sin revisar bien qué hacen.
"""
import platform
import subprocess

# Nombre que dirá el usuario -> comando real por sistema operativo o ruta del programa
APP_WHITELIST = {
    # Para otros sistemas operativos "Linux" o "Darwin" (Mac) y sus respectivas rutas o comandos de terminal.
    "calculadora": {
        "Windows": "calc"
    },
}

# Definición en formato "tool" para el LLM (function calling)
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "open_app",
            "description": "Abre una aplicación en la computadora del usuario. Solo funciona con apps conocidas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "description": f"Una de: {', '.join(APP_WHITELIST.keys())}", # Lista de apps conocidas
                    }
                },
                "required": ["app_name"],
            },
        },
    }
]

def open_app(app_name: str) -> str:
    app_name = app_name.strip().lower()
    if app_name not in APP_WHITELIST:
        return f"No conozco la app '{app_name}'. Agrégala a APP_WHITELIST en tools.py."

    system = platform.system()
    command = APP_WHITELIST[app_name].get(system)
    if not command:
        return f"No sé cómo abrir '{app_name}' en {system}."

    commands = command if isinstance(command, list) else [command]
    opened = []
    for cmd in commands:
        try:
            subprocess.Popen(cmd, shell=True)
            opened.append(cmd)
        except Exception as e:
            return f"Abrí {len(opened)} de {len(commands)} cosas, pero falló una: {e}"

    return f"Abrí {app_name}." if len(commands) == 1 else f"Abrí todo para {app_name} ({len(commands)} apps)."

def run_tool_call(name: str, arguments: dict) -> str:
    if name == "open_app":
        return open_app(arguments.get("app_name", ""))
    return f"Herramienta desconocida: {name}"