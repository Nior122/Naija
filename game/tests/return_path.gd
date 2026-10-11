extends SceneTree

# Stage 29 return-path test: 2D to 3D and back, on the real main scene.
# Run from the repository root with Godot 4.7.2:
#   godot --headless --path game --script res://tests/return_path.gd
# It runs the real SceneSwitcher (scenes/main.tscn), the 2D prototype, and the 3D world, and it
# drives the real toggle_3d_mode action. Each check reads the live objects and nodes.
#
# The new-game and continue paths use the local save slot (user://naija-stage1-save.json). The test
# backs up that file first and restores it at the end. It refuses to run if a backup from an
# earlier run is still present, so it never overwrites the only copy of a save.
#
# Two calls reach private UI methods on purpose: _close_modal() closes the welcome notice, and the
# new-game and continue steps call the real _start_new_game() and _continue_game(), as the UI does.

const MAIN_SCENE := preload("res://scenes/main.tscn")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")

const SAVE_PATH := "user://naija-stage1-save.json"
const SAVE_FILE := "naija-stage1-save.json"
const BACKUP_PATH := "user://naija-stage1-save.return-test-backup.json"
const BACKUP_FILE := "naija-stage1-save.return-test-backup.json"

const LOCATED_REGION := "ng:state:bo"
## The documented default for a 3D world with no located region (controller export).
const DEFAULT_REGION := "ng:state:on"
const CREATION_TEXT := "You are beginning your life"
const PROBE_NAME := "Return Probe"
const UNSAVED_MONEY := 4321
const PROBE_EVENT_ID := "return-probe-unsaved"
const WATCHDOG_SECONDS := 180.0

var _failures: Array[String] = []
var _checks: int = 0
var _save_existed: bool = false
var _main: Node = null


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _is_suspended(proto: Node) -> bool:
	# A missing method is treated as "not suspended", so the check fails instead of aborting the run.
	return proto.has_method("is_suspended") and proto.is_suspended()


func _press_toggle() -> void:
	# The project action toggle_3d_mode (its key is set in project.godot). The switcher handles it in _unhandled_input.
	var event := InputEventAction.new()
	event.action = "toggle_3d_mode"
	event.pressed = true
	root.push_unhandled_input(event)


func _hold_move_right(proto: Node, frames: int) -> float:
	var start: Vector2 = proto.player.position
	Input.action_press("move_right")
	await _frames(frames)
	Input.action_release("move_right")
	return proto.player.position.distance_to(start)


func _absolute_minutes(clock: Object) -> int:
	return int(clock.day) * WorldClockScript.MINUTES_PER_DAY + int(clock.minute_of_day)


func _has_life_event(character: Object, event_id: String) -> bool:
	for entry in character.life_history:
		if entry.get("id", "") == event_id:
			return true
	return false


func _label_contains(node: Node, text: String) -> bool:
	if node.is_queued_for_deletion():
		return false
	if node is Label and (node as Label).text.contains(text):
		return true
	for child in node.get_children():
		if _label_contains(child, text):
			return true
	return false


func _backup_save() -> bool:
	_save_existed = FileAccess.file_exists(SAVE_PATH)
	if not _save_existed:
		return true
	var bytes := FileAccess.get_file_as_bytes(SAVE_PATH)
	var file := FileAccess.open(BACKUP_PATH, FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(bytes)
	file.close()
	return true


func _restore_save() -> void:
	var dir := DirAccess.open("user://")
	if dir == null:
		push_error("Could not open user:// to restore the save file. Backup remains at %s" % BACKUP_PATH)
		return
	if _save_existed:
		var bytes := FileAccess.get_file_as_bytes(BACKUP_PATH)
		var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
		if file != null:
			file.store_buffer(bytes)
			file.close()
		dir.remove(BACKUP_FILE)
	elif FileAccess.file_exists(SAVE_PATH):
		dir.remove(SAVE_FILE)


func _on_watchdog() -> void:
	# Restore the save file before quitting, so an interrupted run cannot leave test data behind.
	_restore_save()
	print("FAIL: watchdog expired after %d s; the test did not finish. The save file was restored." % int(WATCHDOG_SECONDS))
	quit(1)


func _run() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	if FileAccess.file_exists(BACKUP_PATH):
		print("FAIL: a backup from an earlier run exists at %s. Resolve it before rerunning." % BACKUP_PATH)
		quit(1)
		return
	if not _backup_save():
		print("FAIL: could not back up the local save file. Nothing was changed.")
		quit(1)
		return

	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(2)

	# ---- Startup: one 2D session, character creation shown once (first start only) ----
	var proto: Node = _main.mode_2d_instance
	_check(_main.current_mode == "2d" and proto != null, "Startup creates one 2D session in 2D mode")
	_check(_label_contains(proto.ui, CREATION_TEXT), "First start shows character creation")

	# ---- New game through the real path (Test 10, new game) ----
	proto._start_new_game({"name": PROBE_NAME, "age": 15, "character_type": "androgynous", "appearance": {}})
	proto.ui._close_modal()
	_check(proto.playing and proto.character != null and proto.clock != null,
		"New game starts a character and a clock")
	_check(proto.character.name == PROBE_NAME, "New game keeps the entered name")
	_check(not _label_contains(proto.ui, CREATION_TEXT), "New game leaves character creation")

	# ---- Unsaved in-memory progress, never saved before the transition ----
	proto.character.money = UNSAVED_MONEY
	proto.character.set_geographic_location({"state_id": LOCATED_REGION})
	proto.character.life_history.append({
		"id": PROBE_EVENT_ID,
		"type": "return_probe",
		"summary": "Unsaved probe event",
		"date": proto.clock.calendar_date(),
	})
	var proto_ref: Node = proto
	var character_ref: Object = proto.character
	var clock_ref: Object = proto.clock

	# Control: the 2D player moves while the session is active.
	var moved_active := await _hold_move_right(proto_ref, 30)
	_check(moved_active > 1.0, "Control: the 2D player moves while the session is active (moved %.2f)" % moved_active)

	# ---- 2D to 3D (Tests 1, 2, 3, 6) ----
	var pre_clock: Dictionary = proto_ref.clock.to_dictionary()
	_press_toggle()
	_check(_main.current_mode == "3d", "toggle_3d_mode switches to 3D")
	_check(_main.mode_2d_instance == proto_ref and is_instance_valid(proto_ref),
		"The 2D session is retained, not freed")
	_check(_is_suspended(proto_ref) and proto_ref.process_mode == Node.PROCESS_MODE_DISABLED
		and not proto_ref.visible and not proto_ref.ui.visible,
		"The 2D session is suspended and hidden while 3D is active")
	_check(not proto_ref.can_process(),
		"The suspended 2D session cannot process (no _process, no input)")
	_check(_main.get_node("Mode2D").get_child_count() == 1, "Exactly one 2D session under Mode2D")
	_check(_main.get_node("Mode3D").get_child_count() == 1 and is_instance_valid(_main.mode_3d_instance),
		"Exactly one 3D world is active")
	_check(_main.mode_3d_instance.region_id == LOCATED_REGION,
		"The located region reaches the 3D world through the handoff")
	var active_3d: Node = _main.mode_3d_instance

	await _frames(60)
	_check(proto_ref.clock.to_dictionary() == pre_clock,
		"The 2D clock does not advance while the 3D world is active")

	# Suspension: the suspended 2D player does not move while movement input is held (Test 6).
	# Closing the window while suspended still saves the retained session (close notification).
	proto_ref.character.money = 777
	root.propagate_notification(Node.NOTIFICATION_WM_CLOSE_REQUEST)
	var saved_on_close: Dictionary = SaveServiceScript.load_state()
	_check(bool(saved_on_close.get("ok", false))
		and int(saved_on_close.get("character", {}).get("money", -1)) == 777,
		"Closing the window while suspended saves the retained session's unsaved progress")
	proto_ref.character.money = UNSAVED_MONEY

	var moved_suspended := await _hold_move_right(proto_ref, 30)
	_check(moved_suspended == 0.0,
		"The suspended 2D player does not move under held input (moved %.4f)" % moved_suspended)

	# ---- 3D to 2D (Tests 1, 3, 4, 5, 7) ----
	var pos_before_return: Vector2 = proto_ref.player.position
	_press_toggle()
	_check(_main.current_mode == "2d", "toggle_3d_mode returns to 2D")
	_check(_main.mode_2d_instance == proto_ref, "Return resumes the same 2D session, not a new instance")
	_check(not _is_suspended(proto_ref) and proto_ref.process_mode == Node.PROCESS_MODE_INHERIT
		and proto_ref.visible and proto_ref.ui.visible,
		"The 2D session resumes visible and processing")
	_check(_main.get_node("Mode2D").get_child_count() == 1, "Still exactly one 2D session after return")
	_check(proto_ref.clock == clock_ref and proto_ref.clock.to_dictionary() == pre_clock,
		"The clock is the same object and exactly as it was when the player left")
	_check(proto_ref.character == character_ref, "The character is the same live object, not reconstructed")
	_check(proto_ref.character.money == UNSAVED_MONEY, "Unsaved money survives the transition")
	_check(proto_ref.character.geographic_location.get("state_id", "") == LOCATED_REGION,
		"Geographic state survives the transition")
	_check(_has_life_event(proto_ref.character, PROBE_EVENT_ID),
		"The unsaved life-history event survives the transition")
	_check(proto_ref.player.position == pos_before_return, "The player position is unchanged on return")
	_check(not proto_ref.ui.is_modal_open(), "Returning does not open a modal")
	_check(not _label_contains(proto_ref.ui, CREATION_TEXT),
		"Returning does not reopen character creation over the existing character")
	_check(_label_contains(proto_ref.ui, PROBE_NAME), "The existing character's HUD is shown on return")

	var before_resume_minutes := _absolute_minutes(proto_ref.clock)
	await _frames(1)
	var resume_step := _absolute_minutes(proto_ref.clock) - before_resume_minutes
	_check(resume_step >= 0 and resume_step <= 1,
		"Resuming does not catch up the clock (first frame advanced %d game minute(s))" % resume_step)
	_check(not is_instance_valid(active_3d), "The 3D world is released on return")
	_check(_main.get_node("Mode3D").get_child_count() == 0, "No 3D world remains under Mode3D")

	var clock_before_movement: Dictionary = proto_ref.clock.to_dictionary()
	var moved_resumed := await _hold_move_right(proto_ref, 60)
	_check(moved_resumed > 1.0, "Movement works again after resume (moved %.2f)" % moved_resumed)
	_check(proto_ref.clock.to_dictionary() != clock_before_movement,
		"The resumed 2D clock advances again while active")

	# ---- Repeated transitions (Test 8) ----
	var ui_connections: int = proto_ref.ui.get_signal_connection_list("create_requested").size()
	var client_connections: int = proto_ref.multiplayer_client.get_signal_connection_list("session_ready").size()
	var interact_bindings: int = InputMap.action_get_events("interact").size()
	var cycles_ok := true
	for cycle in range(3):
		_press_toggle()
		await _frames(3)
		var in_3d: bool = _main.current_mode == "3d" and _main.mode_2d_instance == proto_ref \
			and _is_suspended(proto_ref) and _main.get_node("Mode3D").get_child_count() == 1 \
			and _main.get_node("Mode2D").get_child_count() == 1 \
			and _main.mode_3d_instance.region_id == LOCATED_REGION
		_press_toggle()
		await _frames(3)
		var in_2d: bool = _main.current_mode == "2d" and _main.mode_2d_instance == proto_ref \
			and not _is_suspended(proto_ref) and _main.get_node("Mode3D").get_child_count() == 0 \
			and _main.get_node("Mode2D").get_child_count() == 1 \
			and proto_ref.character == character_ref and proto_ref.clock == clock_ref \
			and proto_ref.character.money == UNSAVED_MONEY
		if not (in_3d and in_2d):
			cycles_ok = false
			print("  cycle %d: in_3d=%s in_2d=%s" % [cycle, in_3d, in_2d])
	_check(cycles_ok, "Three more 2D-3D-2D cycles keep one 2D session, one 3D world, and the same character and clock")
	_check(proto_ref.ui.get_signal_connection_list("create_requested").size() == ui_connections,
		"Repeated transitions do not add UI signal connections")
	_check(proto_ref.multiplayer_client.get_signal_connection_list("session_ready").size() == client_connections,
		"Repeated transitions do not add multiplayer signal connections")
	_check(InputMap.action_get_events("interact").size() == interact_bindings,
		"Repeated transitions do not add input bindings")

	# ---- Regional fallback (Phase D): no located region keeps the documented default ----
	var saved_geo: Dictionary = proto_ref.character.geographic_location.duplicate(true)
	proto_ref.character.geographic_location = {}
	_press_toggle()
	_check(_main.mode_3d_instance.region_id == DEFAULT_REGION,
		"With no located region, the documented default region is kept")
	_press_toggle()
	_check(proto_ref.character.geographic_location.is_empty(),
		"With no located region, the 2D state stays empty and is not given a location")
	proto_ref.character.set_geographic_location(saved_geo)
	_check(proto_ref.character.geographic_location.get("state_id", "") == LOCATED_REGION,
		"The located region is restored after the fallback check")

	# ---- Initialization flows still work (Test 10, continue and load) ----
	proto_ref._save_game(false)
	var continued_before: Object = proto_ref.character
	proto_ref._continue_game()
	_check(proto_ref.playing, "Continue starts play")
	_check(proto_ref.character != continued_before and proto_ref.character.name == PROBE_NAME,
		"Continue loads the saved character as a new object")
	_check(proto_ref.character.money == UNSAVED_MONEY, "Continue restores the saved money")
	_check(not _label_contains(proto_ref.ui, CREATION_TEXT), "Continue does not open character creation")
	_press_toggle()
	await _frames(3)
	_press_toggle()
	await _frames(3)
	_check(_main.current_mode == "2d" and not _is_suspended(proto_ref)
		and proto_ref.character.money == UNSAVED_MONEY,
		"A continued session survives a 3D round trip")

	_restore_save()
	if _failures.is_empty():
		print("PASS: %d return-path checks" % _checks)
		quit(0)
	else:
		for failure in _failures:
			push_error(failure)
		print("FAIL: %d of %d return-path checks" % [_failures.size(), _checks])
		quit(1)
