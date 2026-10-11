extends SceneTree
# Stage 29 UI flow test. HEADLESS, SIMULATED INPUT. This is not a rendered test.
#
# What it drives, through the real scene and real controls:
# - Buttons are activated by focusing the real Button and sending ui_accept. The button's own GUI input
#   then emits "pressed". Mouse clicks are NOT used: in this headless build, pushed mouse events never reach
#   any Button, not even a plain one (verified in a probe outside the repository).
# - The toggle key is the InputEventKey that project.godot binds to toggle_3d_mode, read from the InputMap.
#   It is sent to the viewport's unhandled-input path.
# - Nothing here renders. The viewport image is null in this build, so visual results are not checked.
#
# Save file: user://naija-stage1-save.json. Before anything else, the test copies the original byte for byte to
# its own backup and verifies the copy. Only then does it remove the original and start with no save. At the end
# it writes the original back, reads it back, compares the bytes, and deletes its backup only after that
# comparison matches. It refuses to run while any backup or marker from an earlier run of a save-slot test is
# present (this test's, load_confirmation_headless's, or return_path's). A watchdog restores the save file if the
# run stalls. A hard engine crash cannot be caught: the backup or marker stays on disk and blocks the next run until
# it is resolved by hand. The test never deletes a file it did not create.
#
# Game clock: the 2D session's autosave runs on 15-game-minute boundaries. The test freezes the clock by setting the
# session's own timing field (_seconds_per_game_minute) to a very large value, immediately after each session is
# created and before any play starts. It asserts that game time does not move during the save-dependent steps, and
# it restores the original rate on each live session before the final checks. It does not add delays or timeouts.
#
# Run: godot --headless --path game --script res://tests/ui_flow_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")

const SAVE_PATH := "user://naija-stage1-save.json"
const BACKUP_PATH := "user://naija-stage1-save.ui-flow-backup.json"
# Backups and markers of the other save-slot tests. This test refuses to run while any of them is present, so two
# runs never share the save slot.
const OTHER_SAVE_SLOT_FILES: Array[String] = [
	"user://naija-stage1-save.return-test-backup.json",
	"user://naija-stage1-save.load-confirm-backup.json",
	"user://naija-stage1-save.load-confirm-no-save.marker",
]
# Written when no save existed, so an interrupted run still blocks the next run.
const NO_SAVE_MARKER := "user://naija-stage1-save.ui-flow-no-save.marker"
const WATCHDOG_SECONDS := 240.0
const CREATION_TEXT := "You are beginning your life"
const SAVED_MONEY := 1234
const UNSAVED_MONEY := 999

var _checks: int = 0
var _failures: Array[String] = []
var _save_existed: bool = false
var _main: Node = null


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _observe(label: String) -> void:
	print("OBSERVED: %s" % label)


# ---------- save file protection ----------

func _backup_save() -> bool:
	_save_existed = FileAccess.file_exists(SAVE_PATH)
	if not _save_existed:
		var marker := FileAccess.open(NO_SAVE_MARKER, FileAccess.WRITE)
		if marker == null:
			return false
		marker.store_string("No save file existed when this run started.")
		marker.close()
		return FileAccess.file_exists(NO_SAVE_MARKER)
	var original := FileAccess.get_file_as_bytes(SAVE_PATH)
	var file := FileAccess.open(BACKUP_PATH, FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(original)
	file.close()
	# Verify the copy before the original is removed. A bad copy is this test's own file, so it is removed.
	if FileAccess.get_file_as_bytes(BACKUP_PATH) != original:
		DirAccess.open("user://").remove(BACKUP_PATH.trim_prefix("user://"))
		return false
	return true


# Returns true only when the original is back on disk, byte for byte, and the test's own backup and marker are gone.
# If verification fails, the backup is kept, because it may be the only copy.
func _restore_save() -> bool:
	var dir := DirAccess.open("user://")
	if dir == null:
		push_error("Could not open user:// to restore the save file. Backup remains at %s" % BACKUP_PATH)
		return false
	if _save_existed:
		var backup_bytes := FileAccess.get_file_as_bytes(BACKUP_PATH)
		var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
		if file == null:
			push_error("Could not rewrite the save file. Backup remains at %s" % BACKUP_PATH)
			return false
		file.store_buffer(backup_bytes)
		file.close()
		if FileAccess.get_file_as_bytes(SAVE_PATH) != backup_bytes:
			push_error("The restored save does not match the backup. Backup remains at %s" % BACKUP_PATH)
			return false
		dir.remove(BACKUP_PATH.trim_prefix("user://"))
	elif FileAccess.file_exists(SAVE_PATH):
		# No save existed when the run started, so this file was written by this run.
		dir.remove(SAVE_PATH.trim_prefix("user://"))
	if FileAccess.file_exists(NO_SAVE_MARKER):
		dir.remove(NO_SAVE_MARKER.trim_prefix("user://"))
	return not FileAccess.file_exists(BACKUP_PATH) and not FileAccess.file_exists(NO_SAVE_MARKER)


# ---------- game clock control ----------

# Each entry: {"session": Node, "rate": float}. Restored before the final checks.
var _clock_restores: Array[Dictionary] = []


func _freeze_clock(session: Node) -> void:
	# Test-only: a very long real time per game minute stops the clock, so no 15-minute autosave can fire.
	_clock_restores.append({"session": session, "rate": float(session._seconds_per_game_minute)})
	session._seconds_per_game_minute = 1.0e9


func _restore_clock() -> bool:
	var all_restored := true
	for entry in _clock_restores:
		# The first session is freed during the Continue step. Check validity before any typed use.
		var session = entry["session"]
		if not is_instance_valid(session):
			continue
		session._seconds_per_game_minute = float(entry["rate"])
		if not is_equal_approx(float(session._seconds_per_game_minute), float(entry["rate"])):
			all_restored = false
	_clock_restores.clear()
	return all_restored


func _game_minutes(session: Node) -> int:
	return int(session.clock.day) * 1440 + int(session.clock.minute_of_day)


func _on_watchdog() -> void:
	_restore_save()
	print("FAIL: watchdog expired after %d s; the test did not finish. The save file was restored." % int(WATCHDOG_SECONDS))
	quit(1)


# ---------- helpers ----------

func _frames(count: int) -> void:
	for i in count:
		await process_frame


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


func _press_toggle_key() -> void:
	# Sends the key that the project binds to toggle_3d_mode, read from the InputMap at runtime.
	# project.godot binds toggle_3d_mode to F3 (physical keycode 4194334). This reads the binding, not a fixed key.
	var bound: InputEventKey = InputMap.action_get_events("toggle_3d_mode")[0] as InputEventKey
	var down: InputEventKey = bound.duplicate() as InputEventKey
	down.pressed = true
	root.push_unhandled_input(down)
	var up: InputEventKey = bound.duplicate() as InputEventKey
	up.pressed = false
	root.push_unhandled_input(up)


func _close_open_modal(ui: Node) -> void:
	# Closes any open modal by activating its real close button. Loops because a modal can open another.
	for attempt in 4:
		if not ui.is_modal_open():
			return
		var close := _find_button(_main, "Close")
		if close == null:
			close = _find_button(_main, "Continue")
		if close == null:
			return
		_activate(close)
		await _frames(2)


func _read_save() -> Dictionary:
	var result: Dictionary = SaveServiceScript.load_state()
	return result


# ---------- test ----------

func _run() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	var leftovers: Array[String] = []
	for path in [BACKUP_PATH, NO_SAVE_MARKER] + OTHER_SAVE_SLOT_FILES:
		if FileAccess.file_exists(path):
			leftovers.append(path)
	if not leftovers.is_empty():
		print("FAIL: a backup or marker from an earlier save-slot run exists: %s. Nothing was changed. Resolve it before rerunning." % str(leftovers))
		quit(1)
		return
	if not _backup_save():
		print("FAIL: could not back up the local save file. Nothing was changed.")
		quit(1)
		return
	var bound_event: InputEventKey = InputMap.action_get_events("toggle_3d_mode")[0] as InputEventKey
	_observe("toggle_3d_mode is bound to %s (physical keycode %d)" % [OS.get_keycode_string(bound_event.physical_keycode), bound_event.physical_keycode])
	# Start with no save so the first start shows only "Begin your life".
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.open("user://").remove(SAVE_PATH.trim_prefix("user://"))

	# ---- 1. Startup with no save ----
	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto = _main.mode_2d_instance
	# Freeze game time before any play starts, so no autosave can fire during the test (see the header).
	_freeze_clock(proto)
	_check(proto != null and _label_contains(proto.ui, CREATION_TEXT), "Startup shows character creation")
	_check(_find_button(_main, "Begin your life") != null, "Startup offers 'Begin your life' (real button)")
	_check(_find_button(_main, "Continue saved life") == null, "No 'Continue saved life' button without a save")

	# ---- 2. New game through the real Begin button ----
	var begin := _find_button(_main, "Begin your life")
	if begin != null:
		_activate(begin)
	await _frames(4)
	_check(proto.playing and proto.character != null and proto.clock != null, "Begin your life starts play with character and clock")
	_check(not _label_contains(proto.ui, CREATION_TEXT), "Begin your life leaves character creation")
	await _close_open_modal(proto.ui)
	_check(not proto.ui.is_modal_open(), "Welcome notice closed through its real button")
	_observe("after new game: name=%s money=%d location=%s" % [proto.character.name, proto.character.money, proto.character.current_location])

	# ---- 3. Save through the real HUD menu: Save / Load -> Save progress now ----
	proto.character.money = SAVED_MONEY
	var save_menu := _find_button(_main, "Save / Load")
	_check(save_menu != null, "HUD 'Save / Load' button is visible in 2D")
	if save_menu != null:
		_activate(save_menu)
	await _frames(3)
	var save_now := _find_button(_main, "Save progress now")
	_check(save_now != null and proto.ui.is_modal_open(), "Save / Load opens the save modal")
	if save_now != null:
		_activate(save_now)
	await _frames(3)
	var saved := _read_save()
	_check(bool(saved.get("ok", false)), "Save progress now writes a loadable save file")
	_check(int(saved.get("character", {}).get("money", -1)) == SAVED_MONEY, "The saved file holds the known test money (%d)" % SAVED_MONEY)
	await _close_open_modal(proto.ui)

	# ---- 4. Unsaved progress that must survive the 2D <-> 3D round trips ----
	proto.character.money = UNSAVED_MONEY
	var character_ref = proto.character
	var clock_ref = proto.clock
	var minutes_at_unsaved := _game_minutes(proto)
	var file_money_before_switch := int(_read_save().get("character", {}).get("money", -1))
	_check(file_money_before_switch == SAVED_MONEY, "Unsaved money (%d) is not in the save file" % UNSAVED_MONEY)
	var ui_create_connections: int = proto.ui.get_signal_connection_list("create_requested").size()
	var toggle_bindings: int = InputMap.action_get_events("toggle_3d_mode").size()

	# ---- 5. F3 (real key) to 3D ----
	_press_toggle_key()
	await _frames(3)
	_check(_main.current_mode == "3d", "The toggle_3d_mode key switches to 3D")
	_check(_main.mode_2d_instance == proto and is_instance_valid(proto), "The same 2D instance is retained in 3D")
	_check(proto.is_suspended() and not proto.can_process(), "The retained 2D session is suspended and not processing in 3D")
	_check(not proto.ui.visible, "The 2D HUD is hidden while 3D is active")
	var hud_button_in_3d := _find_button(_main, "Save / Load")
	_check(hud_button_in_3d == null, "The 2D HUD button is not interactive while 3D is active")
	_check(_main.get_node("Mode3D").get_child_count() == 1 and is_instance_valid(_main.mode_3d_instance), "One 3D world is active")
	_check(_main.get_node("Mode2D").get_child_count() == 1, "Still exactly one 2D session in 3D")
	_check(proto.character == character_ref and proto.clock == clock_ref, "Character and clock are the same live objects in 3D")
	_check(proto.character.money == UNSAVED_MONEY, "Unsaved money is unchanged in 3D")
	_check(not proto.ui.is_modal_open(), "No modal opens on entering 3D")
	if _main.mode_3d_instance != null:
		_observe("in 3D: 3D world=%s region_id=%s" % [_main.mode_3d_instance.name, str(_main.mode_3d_instance.get("region_id"))])

	# ---- 6. F3 (real key) back to 2D ----
	_press_toggle_key()
	await _frames(3)
	_check(_main.current_mode == "2d", "The toggle_3d_mode key returns to 2D")
	_check(_main.mode_2d_instance == proto, "Return resumes the same 2D instance")
	_check(not proto.is_suspended() and proto.can_process(), "The resumed 2D session processes again")
	_check(proto.ui.visible, "The 2D HUD is visible on return")
	_check(_find_button(_main, "Save / Load") != null, "The returned HUD button is visible and reachable")
	_check(not _label_contains(proto.ui, CREATION_TEXT), "Return does not open character creation")
	_check(not proto.ui.is_modal_open(), "Return does not open a modal")
	_check(proto.character == character_ref and proto.clock == clock_ref, "Original character and clock objects remain active")
	_check(proto.character.money == UNSAVED_MONEY, "Unsaved money survives the round trip")
	_check(_main.get_node("Mode3D").get_child_count() == 0, "The 3D world is released on return")
	var ui_create_after: int = proto.ui.get_signal_connection_list("create_requested").size()
	_check(ui_create_after == ui_create_connections, "No duplicate signal connections after one round trip")

	# Interactivity after return: the real HUD menu opens and closes.
	var menu_again := _find_button(_main, "Save / Load")
	if menu_again != null:
		_activate(menu_again)
	await _frames(3)
	_check(proto.ui.is_modal_open(), "The returned HUD is interactive (Save / Load opens its modal)")
	await _close_open_modal(proto.ui)
	_check(not proto.ui.is_modal_open(), "The returned HUD modal closes through its real button")

	# ---- 7. Repeated round trips ----
	var nodes_after_first := _count_nodes(_main)
	var cycles_ok := true
	for cycle in 3:
		_press_toggle_key()
		await _frames(3)
		if _main.current_mode != "3d" or not proto.is_suspended():
			cycles_ok = false
		_press_toggle_key()
		await _frames(3)
		if _main.current_mode != "2d" or _main.mode_2d_instance != proto or proto.is_suspended():
			cycles_ok = false
		if proto.character != character_ref or proto.clock != clock_ref:
			cycles_ok = false
	_check(cycles_ok, "Three more round trips keep one 2D session and the same character and clock")
	_check(proto.ui.get_signal_connection_list("create_requested").size() == ui_create_connections, "Repeated round trips add no signal connections")
	_check(InputMap.action_get_events("toggle_3d_mode").size() == toggle_bindings, "Repeated round trips add no input bindings")
	_check(_main.get_node("Mode2D").get_child_count() == 1 and _main.get_node("Mode3D").get_child_count() == 0, "Repeated round trips leave one 2D session and no 3D world")
	_check(_count_nodes(_main) == nodes_after_first, "Repeated round trips leave no accumulating nodes (%d before, %d after)" % [nodes_after_first, _count_nodes(_main)])
	_check(proto.character.money == UNSAVED_MONEY, "Unsaved money survives repeated round trips")

	# ---- 8. Load saved progress through the real save modal ----
	_check(_game_minutes(proto) == minutes_at_unsaved, "Game time did not move during the save-dependent steps (clock frozen, %d minutes at unsaved, %d now)" % [minutes_at_unsaved, _game_minutes(proto)])
	var menu_load := _find_button(_main, "Save / Load")
	if menu_load != null:
		_activate(menu_load)
	await _frames(3)
	var load_button := _find_button(_main, "Load saved progress")
	_check(load_button != null, "Save modal offers 'Load saved progress' when a save exists")
	if load_button != null:
		_activate(load_button)
	await _frames(3)
	# In-game Load asks first. Nothing may load until the confirm button is activated.
	var confirm_load := _find_button(_main, "Load and discard progress")
	var cancel_load := _find_button(_main, "Cancel")
	_check(confirm_load != null and cancel_load != null and proto.ui.is_modal_open(), "In-game Load opens a confirmation with confirm and cancel buttons")
	_check(proto.character == character_ref and proto.character.money == UNSAVED_MONEY, "Before confirmation, the live session and its unsaved money are unchanged")
	if confirm_load != null:
		_activate(confirm_load)
	await _frames(4)
	var loaded_character = proto.character
	_observe("after Load: money=%d (unsaved was %d, saved was %d); same object as before=%s" % [loaded_character.money, UNSAVED_MONEY, SAVED_MONEY, loaded_character == character_ref])
	_check(loaded_character.money == SAVED_MONEY, "Load restores the saved money, not the unsaved value")
	_check(loaded_character.name == _read_save().get("character", {}).get("name", "?"), "Load restores the saved character name")
	_check(proto.playing, "Load leaves play running")
	_check(not _label_contains(proto.ui, CREATION_TEXT), "Load does not open character creation")
	await _close_open_modal(proto.ui)

	# ---- 9. Continue through the real startup card ----
	# A fresh main scene is a relaunch of the 2D session from the start screen. Nothing is written on free.
	_main.queue_free()
	await _frames(3)
	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto2 = _main.mode_2d_instance
	_freeze_clock(proto2)
	var continue_button := _find_button(_main, "Continue saved life")
	_check(continue_button != null, "Startup offers 'Continue saved life' once a save exists")
	_check(_label_contains(proto2.ui, CREATION_TEXT), "Startup card is shown before Continue")
	if continue_button != null:
		_activate(continue_button)
	await _frames(4)
	_check(proto2.playing and proto2.character != null, "Continue starts play with a loaded character")
	_check(proto2.character != null and proto2.character.money == SAVED_MONEY, "Continue restores the saved money")
	_check(not _label_contains(proto2.ui, CREATION_TEXT), "Continue does not open character creation")
	_observe("after Continue: name=%s money=%s location=%s" % [proto2.character.name, str(proto2.character.money), proto2.character.current_location])
	await _close_open_modal(proto2.ui)

	# ---- restore the clock rate and the save file, then report ----
	_check(_restore_clock(), "The game clock rate is restored on each live session")
	var save_restored := _restore_save()
	_check(save_restored, "The save file is restored byte for byte and the test's backup is removed only after that check")
	_restore_check()
	var total := _checks
	if _failures.is_empty():
		print("PASS: %d UI flow checks (headless, simulated input)" % total)
		quit(0)
	else:
		print("FAIL: %d of %d UI flow checks (headless, simulated input)" % [_failures.size(), total])
		quit(1)


func _restore_check() -> void:
	var exists := FileAccess.file_exists(SAVE_PATH)
	if _save_existed:
		_check(exists, "The original save file is restored")
	else:
		_check(not exists, "No save file is left behind when none existed before")
	_check(not FileAccess.file_exists(BACKUP_PATH) and not FileAccess.file_exists(NO_SAVE_MARKER), "The temporary backup and marker are removed")


func _count_nodes(node: Node) -> int:
	var count := 1
	for child in node.get_children():
		count += _count_nodes(child)
	return count
