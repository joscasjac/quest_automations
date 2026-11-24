"""Writes quest_automations/locale/es.po from ES below. Run after adding UI strings:
python3 scripts/write_po.py  (prints strings in the code that have no Spanish yet), then
bench compile-po-to-mo --app quest_automations --locale es.
Covers the strings that go through __() in the frontend and _() in Python. The Build with AI page
and builder.py still carry their own word lists (WORDS / TEXT). Spanish uses "usted"."""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ES = {
	# the AI sidebar
	"AI assistant": "Asistente de IA",
	"Working on": "Trabajando en",
	"this workflow": "esta automatización",
	"New conversation": "Nueva conversación",
	"Close (Esc)": "Cerrar (Esc)",
	"Close": "Cerrar",
	"Conversation with the AI assistant": "Conversación con el asistente de IA",
	"The assistant uses your AI models. No model is available to you yet.": "El asistente usa sus modelos de IA. Todavía no tiene ningún modelo disponible.",
	"The assistant needs FAC Model Bridge. Ask your administrator to install it.": "El asistente necesita FAC Model Bridge. Pida a su administrador que lo instale.",
	"Open AI Command Center": "Abrir Centro de IA",
	"Describe it and I will build it": "Descríbala y yo la armo",
	"Ask for any change to this workflow": "Pida cualquier cambio a esta automatización",
	"Triggers, steps, wording, waits, conditions. You see the list of changes first, and one click on Undo takes the whole thing back. Nothing is saved until you press Save.": "Disparadores, pasos, textos, esperas, condiciones. Primero ve la lista de cambios, y con un clic en Deshacer todo vuelve a como estaba. No se guarda nada hasta que pulse Guardar.",
	"Stopped, nothing changed": "Detenido, no cambió nada",
	"A newer request replaced this question": "Una solicitud más reciente reemplazó esta pregunta",
	"Apply ({0})": "Aplicar ({0})",
	"Discard": "Descartar",
	"The workflow changed since this was proposed. Ask again.": "La automatización cambió desde esta propuesta. Pida de nuevo.",
	"Applied ({0})": "Aplicado ({0})",
	"Undo": "Deshacer",
	"Press Save to keep it.": "Pulse Guardar para conservarlo.",
	"Discarded, nothing changed": "Descartado, no cambió nada",
	"Undone, the workflow is back as it was": "Deshecho, la automatización volvió a como estaba",
	"A newer request replaced this proposal, nothing changed": "Una solicitud más reciente reemplazó esta propuesta, no cambió nada",
	"From an earlier visit, nothing changed": "De una visita anterior, no cambió nada",
	"Cancel": "Cancelar",
	"Message to the AI assistant": "Mensaje para el asistente de IA",
	"Send (Enter)": "Enviar (Enter)",
	"Type your answer…": "Escriba su respuesta…",
	"What should change here?": "¿Qué debe cambiar aquí?",
	"Describe the automation you want…": "Describa la automatización que quiere…",
	"Ask for any change to this workflow…": "Pida cualquier cambio a esta automatización…",
	"Something went wrong. Try again.": "Algo salió mal. Intente de nuevo.",
	"The AI took too long. Try again.": "La IA tardó demasiado. Intente de nuevo.",
	"Reading the workflow…": "Leyendo la automatización…",
	# suggested prompts
	"When a new lead comes in, create a call task for its owner": "Cuando entre un prospecto nuevo, crea una tarea de llamada para su responsable",
	"Every Monday, remind me of deals with no activity": "Cada lunes, recuérdame los negocios sin actividad",
	"When a booking is completed, have the AI summarize the notes": "Cuando se complete una reserva, que la IA resuma las notas",
	"Explain what this workflow does": "Explica qué hace esta automatización",
	"Add a reminder one day later": "Agrega un recordatorio un día después",
	"Notify me when it finishes": "Avísame cuando termine",
	"Make the messages friendlier": "Haz los mensajes más amables",
	# model picker
	"Model": "Modelo",
	"Model: {0}": "Modelo: {0}",
	"Use the default model": "Usar el modelo predeterminado",
	"Thinking": "Razonamiento",
	"Could not switch models. Try again.": "No se pudo cambiar de modelo. Intente de nuevo.",
	"Default": "Predeterminado",
	"Minimal": "Mínimo",
	"Light": "Ligero",
	"Medium": "Medio",
	"High": "Alto",
	"Extra high": "Muy alto",
	"Max": "Máximo",
	"Shared with everyone": "Compartido con todos",
	"Your connections": "Sus conexiones",
	# server messages
	"Choose a model that is available to you.": "Elija un modelo que tenga disponible.",
	"This model does not offer that thinking level.": "Este modelo no ofrece ese nivel de razonamiento.",
	"Choose an AI model in the AI Command Center (/ai) first.": "Primero elija un modelo de IA en el Centro de IA (/ai).",
	"Your model provider says the usage limit is reached. Try again later or pick another model.": "Su proveedor de modelos dice que se alcanzó el límite de uso. Intente más tarde o elija otro modelo.",
	"Your model provider rejected the connection. Reconnect it in the AI Command Center (/ai).": "Su proveedor de modelos rechazó la conexión. Vuelva a conectarla en el Centro de IA (/ai).",
	"Your model provider did not answer. Wait a minute and try again.": "Su proveedor de modelos no respondió. Espere un minuto e intente de nuevo.",
	"The AI returned an unreadable answer. Try rephrasing.": "La IA devolvió una respuesta ilegible. Intente decirlo de otra forma.",
	"Added {0} steps": "Se agregaron {0} pasos",
	"Changed a step": "Se cambió un paso",
	"Changed {0}": "Se cambió {0}",
	"Removed {0}": "Se quitó {0}",
	"a step": "un paso",
	"Moved {0}": "Se movió {0}",
	"Some steps read fields that {0} does not have: {1}. Check those steps.": "Algunos pasos leen campos que {0} no tiene: {1}. Revise esos pasos.",
	"Changed when it starts": "Se cambió cuándo empieza",
	"Added another way to start it": "Se agregó otra forma de iniciarla",
	"Removed a trigger": "Se quitó un disparador",
	"Renamed it to {0}": "Se renombró a {0}",
	"Changed the description": "Se cambió la descripción",
	"Type a request first.": "Primero escriba una solicitud.",
	"That message is too long. Keep it under 4,000 characters.": "Ese mensaje es demasiado largo. Use menos de 4.000 caracteres.",
	"Writing…": "Escribiendo…",
	"Thinking…": "Pensando…",
	"Fixing the changes…": "Corrigiendo los cambios…",
	"Checking the changes…": "Revisando los cambios…",
	"Not done: {0}": "No se hizo: {0}",
	"Waiting for the AI…": "Esperando a la IA…",
	"This answer expired. Ask again.": "Esta respuesta venció. Pida de nuevo.",
	"This proposal expired. Ask again.": "Esta propuesta venció. Pida de nuevo.",
}

# strings the frontend translates by variable (__(s)) rather than by literal
DYNAMIC = re.compile(r"""const (?:STARTERS_EMPTY|STARTERS|EFFORTS)[^=]*=([^;]+);""")


def strings():
	out = []

	def add(s):
		if s not in out:
			out.append(s)

	for path in ("frontend/src/app/Copilot.tsx", "frontend/src/app/Workflows.tsx"):
		text = open(os.path.join(ROOT, path), encoding="utf-8").read()
		for m in re.finditer(r"""__\(\s*(['"])((?:\\.|(?!\1).)*)\1""", text):
			add(m.group(2))
		for block in DYNAMIC.finditer(text):
			for m in re.finditer(r"'([^']{2,})'", block.group(1)):
				if not re.fullmatch(r"[a-z]+", m.group(1)):
					add(m.group(1))
	text = open(os.path.join(ROOT, "quest_automations/copilot.py"), encoding="utf-8").read()
	for m in re.finditer(r"""_\(\s*'((?:\\.|[^'])*)'\s*\)""", text):
		add(m.group(1))
	return out


def esc(s):
	return s.replace("\\", "\\\\").replace('"', '\\"')


def main():
	missing = [s for s in strings() if s not in ES]
	lines = ['msgid ""', 'msgstr ""', '"Content-Type: text/plain; charset=UTF-8\\n"', '"Language: es\\n"', ""]
	for k, v in ES.items():
		lines += [f'msgid "{esc(k)}"', f'msgstr "{esc(v)}"', ""]
	os.makedirs(os.path.join(ROOT, "quest_automations/locale"), exist_ok=True)
	with open(os.path.join(ROOT, "quest_automations/locale/es.po"), "w", encoding="utf-8") as f:
		f.write("\n".join(lines))
	print(f"{len(ES)} strings written; missing: {missing}")


if __name__ == "__main__":
	main()
