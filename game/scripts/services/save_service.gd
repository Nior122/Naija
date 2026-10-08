class_name SaveService
extends RefCounted

const SAVE_VERSION: int = 2
const DEFAULT_SAVE_PATH: String = "user://naija-stage1-save.json"


static func has_save(path: String = DEFAULT_SAVE_PATH) -> bool:
	return FileAccess.file_exists(path)


static func save_state(
	character: CharacterState, clock: WorldClock, path: String = DEFAULT_SAVE_PATH
) -> Dictionary:
	var payload := {
		"version": SAVE_VERSION,
		"character": character.to_dictionary(),
		"clock": clock.to_dictionary(),
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "Could not open the save file for writing."}
	file.store_string(JSON.stringify(payload, "\t"))
	file.flush()
	var write_error := file.get_error()
	file.close()
	if write_error != OK:
		return {"ok": false, "error": "The save file could not be written completely."}
	return {"ok": true, "error": ""}


static func load_state(path: String = DEFAULT_SAVE_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "No saved life was found."}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"ok": false, "error": "The save file could not be opened."}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not parsed is Dictionary:
		return {"ok": false, "error": "The save file is not valid JSON."}
	var save_version := int(parsed.get("version", 0))
	if save_version < 1 or save_version > SAVE_VERSION:
		return {"ok": false, "error": "This save version is not supported by the prototype."}
	if not parsed.get("character", {}) is Dictionary or not parsed.get("clock", {}) is Dictionary:
		return {"ok": false, "error": "The save file is missing character or clock data."}
	return {
		"ok": true,
		"error": "",
		"character": parsed["character"],
		"clock": parsed["clock"],
	}
