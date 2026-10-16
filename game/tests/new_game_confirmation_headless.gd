extends SceneTree
# New-life overwrite confirmation test. HEADLESS, SIMULATED INPUT. This is not a rendered test.
#
# What it covers, through the real scene and real button activation:
# - No local save: Begin your life starts play at once, with no dialog, and writes the new save.
# - A local save exists: Begin your life opens "Replace your saved life?" and does not start play. The save
#   file's bytes are unchanged while the dialog is open.
# - Cancel closes the dialog, returns to the same creation card with the typed name kept, starts no play,
#   and leaves the save file's bytes unchanged.
# - Begin, then Replace saved life: starts play and replaces the save with the typed character.
# - Bypass: calling the new-life path directly without the replacement mark (what a request that skipped the
#   dialog would do) refuses, shows "Saved life kept", starts no play, and leaves the save file unchanged.
#   The same call with the replacement mark does replace the save, which shows the mark is the only gate.
#
# Buttons are activated by focusing the real Button and sending ui_accept, as the other headless tests do.
# Nothing is rendered, so no dialog layout or colour is checked here.
#
# Save file: user://naija-stage1-save.json, the real game save path. The shared recovery protocol in
# tests/support/save_slot_guard.gd takes a lock, copies the original byte for byte to its backup, and verifies
# the copy before the original is removed. At the end the original is written back, read back, and compared
# byte for byte. The game clock is frozen after play starts so autosaves cannot change the values under test.
# A watchdog restores the save file if the run stalls.
#
# Run: godot --headless --path game --script res://tests/new_game_confirmation_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const SaveSlotGuardScript = preload("res://tests/support/save_slot_guard.gd")

const SAVE_PATH := "user://naija-stage1-save.json"
const WATCHDOG_SECONDS := 240.0
const CREATION_TITLE := "You are beginning your life"
const BEGIN_TEXT := "Begin your life"
const CONTINUE_TEXT := "Continue saved life"
const REPLACE_TEXT := "Replace saved life"
const CANCEL_TEXT := "Cancel"
const DIALOG_TITLE := "Replace your saved life?"
const NOTICE_TITLE := "Saved life kept"
# The existing welcome notice that a new life shows once play starts (prototype_game.gd _start_new_game).
const WELCOME_TITLE := "A new day begins"
const TYPED_NAME := "Tunde"
const EXISTING_NAME := "Kemi"
const EXISTING_SAVE := "{\"version\": 2, \"character\": {\"name\": \"Kemi\", \"money\": 4321}, \"clock\": {\"day\": 1, \"minute_of_day\": 420}}"

var _checks: int = 0
var _failures: Array[String] = []
var _guard := SaveSlotGuardScript.new()


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _on_watchdog() -> void:
	_guard.finish()
	print("FAIL: watchdog expired after %d s; the test did not finish. The save-slot protocol attempted restoration; check the messages above." % int(WATCHDOG_SECONDS))
	quit(1)


# ---------- helpers ----------

func _frames(count: int) -> void:
	for i in count:
		await process_frame
		_guard.observe()


func _find_button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _label_contains(node: Node, text: String) -> bool:
	if node.is_queued_for_deletion():
		return false
	if node is Label and (node as Label).text.contains(text):
		return true
	for child in node.get_children():
		if _label_contains(child, text):
			return true
	return false


func _activate(button: Button) -> void:
	# Real GUI activation: focus the button, then send ui_accept press and release through the viewport.
	button.grab_focus()
	var down := InputEventAction.new()
	down.action = "ui_accept"
	down.pressed = true
	root.push_input(down)
	var up := InputEventAction.new()
	up.action = "ui_accept"
	up.pressed = false
	root.push_input(up)


func _press(text: String, main: Node) -> bool:
	var button := _find_button(main, text)
	if button == null:
		return false
	_activate(button)
	return true


func _boot() -> Node:
	var main: Node = MAIN_SCENE.instantiate()
	root.add_child(main)
	await _frames(3)
	return main


func _teardown(main: Node) -> void:
	root.remove_child(main)
	main.queue_free()
	await _frames(2)


func _write_save(text: String) -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(text)
		file.close()
	_guard.observe()


func _remove_save() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.open("user://").remove(SAVE_PATH.trim_prefix("user://"))
	_guard.observe()


func _save_bytes() -> PackedByteArray:
	return FileAccess.get_file_as_bytes(SAVE_PATH)


func _saved_name() -> String:
	var result: Dictionary = SaveServiceScript.load_state()
	if not bool(result.get("ok", false)):
		return ""
	var character: Variant = result.get("character", null)
	if not (character is Dictionary):
		return ""
	return str((character as Dictionary).get("name", ""))


func _name_input_text(proto: Node) -> String:
	return proto.ui._name_input.text


func _set_name_input(proto: Node, value: String) -> void:
	proto.ui._name_input.text = value


# ---------- test ----------

func _run() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	if not _guard.begin("new_game_confirmation_headless", SAVE_PATH):
		print("FAIL: %s" % _guard.message)
		quit(1)
		return
	if _guard.recovered_previous_run:
		print("NOTE: %s" % _guard.message)
	_remove_save()

	# ---- A. No local save: Begin starts play at once, as before ----
	var main_a := await _boot()
	var proto_a = main_a.mode_2d_instance
	_check(not _label_contains(proto_a.ui, DIALOG_TITLE), "No save: the creation screen is shown without a dialog")
	_check(_find_button(main_a, CONTINUE_TEXT) == null, "No save: there is no Continue saved life button (test setup)")
	_set_name_input(proto_a, TYPED_NAME)
	_check(_press(BEGIN_TEXT, main_a), "No save: the Begin your life button is present")
	await _frames(4)
	_check(proto_a.playing, "No save: Begin your life starts play immediately")
	_check(not _label_contains(proto_a.ui, DIALOG_TITLE), "No save: the replace dialog never appears")
	_check(_label_contains(proto_a.ui, WELCOME_TITLE), "No save: the only notice is the existing welcome notice")
	_check(FileAccess.file_exists(SAVE_PATH), "No save: a new life writes the save file")
	_check(_saved_name() == TYPED_NAME, "No save: the written save holds the typed character")
	_freeze_clock(proto_a)
	await _teardown(main_a)

	# ---- B. A local save exists: Begin asks first, Cancel keeps it, Replace replaces it ----
	_write_save(EXISTING_SAVE)
	var before := _save_bytes()
	_check(before.size() > 0, "Save setup: the existing save file is in place (test setup)")

	var main_b := await _boot()
	var proto_b = main_b.mode_2d_instance
	_check(_find_button(main_b, CONTINUE_TEXT) != null, "Save exists: the Continue saved life button is shown")
	_set_name_input(proto_b, TYPED_NAME)
	_check(_press(BEGIN_TEXT, main_b), "Save exists: the Begin your life button is present")
	await _frames(3)
	_check(proto_b.ui.is_modal_open(), "Save exists: Begin your life opens a confirmation")
	_check(_label_contains(proto_b.ui, DIALOG_TITLE), "Save exists: the confirmation has the replace title")
	_check(_find_button(main_b, REPLACE_TEXT) != null, "Save exists: the confirmation offers Replace saved life")
	_check(not proto_b.playing, "Save exists: no play starts before the player confirms")
	_check(_save_bytes() == before, "Save exists: the save file is unchanged while the confirmation is open")

	# B1. Cancel returns to the same creation card, keeps the typed name, and changes nothing.
	_check(_press(CANCEL_TEXT, main_b), "Confirmation: the Cancel button is present")
	await _frames(3)
	_check(not proto_b.ui.is_modal_open(), "Cancel closes the confirmation")
	_check(not _label_contains(proto_b.ui, DIALOG_TITLE), "Cancel removes the replace dialog from the screen")
	_check(_label_contains(proto_b.ui, CREATION_TITLE), "Cancel returns to the character creation screen")
	_check(_name_input_text(proto_b) == TYPED_NAME, "Cancel keeps the typed name on the creation form")
	_check(_find_button(main_b, CONTINUE_TEXT) != null, "Cancel keeps the Continue saved life button")
	_check(not proto_b.playing, "Cancel starts no play")
	_check(_save_bytes() == before, "Cancel leaves the save file byte for byte unchanged")

	# B2. Begin again, then Replace: the typed character replaces the save and play starts.
	_check(_press(BEGIN_TEXT, main_b), "After Cancel: the Begin your life button still works")
	await _frames(3)
	_check(proto_b.ui.is_modal_open() and _label_contains(proto_b.ui, DIALOG_TITLE), "After Cancel: Begin opens the confirmation again")
	_check(_press(REPLACE_TEXT, main_b), "Confirmation: the Replace saved life button is present")
	await _frames(4)
	_check(proto_b.playing, "Replace saved life starts play")
	_check(not _label_contains(proto_b.ui, DIALOG_TITLE), "Replace saved life closes the replace dialog")
	_check(_label_contains(proto_b.ui, WELCOME_TITLE), "Replace saved life then shows the existing welcome notice")
	_check(_save_bytes() != before, "Replace saved life writes the new save")
	_check(_saved_name() == TYPED_NAME, "Replace saved life stores the typed character in the save")
	_freeze_clock(proto_b)
	await _teardown(main_b)

	# ---- C. Bypass: the new-life path without the replacement mark refuses and changes nothing ----
	_write_save(EXISTING_SAVE)
	var before_c := _save_bytes()
	var main_c := await _boot()
	var proto_c = main_c.mode_2d_instance
	proto_c._start_new_game({"name": "Bypass"})
	await _frames(3)
	_check(not proto_c.playing, "Bypass without the mark does not start play")
	_check(proto_c.ui.is_modal_open() and _label_contains(proto_c.ui, NOTICE_TITLE), "Bypass without the mark shows the 'Saved life kept' notice")
	_check(_save_bytes() == before_c, "Bypass without the mark leaves the save file byte for byte unchanged")
	_check(_saved_name() == EXISTING_NAME, "Bypass without the mark keeps the saved character name")

	# The mark is the only gate: the same call with the mark does replace the save (this is the confirmed path).
	_check(_press("Close", main_c), "The 'Saved life kept' notice has a Close button")
	await _frames(2)
	_check(not proto_c.ui.is_modal_open(), "Close dismisses the notice before the mark is tested")
	proto_c._start_new_game({"name": "Bypass", "replace_existing_save": true})
	await _frames(4)
	_check(proto_c.playing, "With the replacement mark, the new-life path starts play")
	_check(_save_bytes() != before_c, "With the replacement mark, the save is replaced")
	_freeze_clock(proto_c)
	await _teardown(main_c)

	# ---- restore the save file and report ----
	var save_restored := _guard.finish()
	_check(save_restored, "The save file is restored byte for byte and the test's backup is removed only after that check")
	_check_restore()
	var total := _checks
	if _failures.is_empty():
		print("PASS: %d new-life confirmation checks (headless, simulated input)" % total)
		quit(0)
	else:
		print("FAIL: %d of %d new-life confirmation checks (headless, simulated input)" % [_failures.size(), total])
		quit(1)


func _freeze_clock(proto: Node) -> void:
	# Test-only: a very long real time per game minute stops the clock, so no 15-minute autosave can fire.
	proto._seconds_per_game_minute = 1.0e9


func _check_restore() -> void:
	var exists := FileAccess.file_exists(SAVE_PATH)
	if _guard.original_existed():
		_check(exists, "The original save file is restored")
	else:
		_check(not exists, "No save file is left behind when none existed before")
	_check(not _guard.protocol_files_present(), "The protocol files (lock, manifest, backup) are removed")
