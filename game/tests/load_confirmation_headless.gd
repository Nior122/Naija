extends SceneTree
# Stage 29 control and Load-safety test. HEADLESS, SIMULATED INPUT. This is not a rendered test.
#
# What it covers, through the real scene where possible:
# - The world-switch key. It reads the binding from project settings and from the runtime InputMap, checks that
#   toggle_3d_mode is bound to physical F3, and checks that no action (before and after the scene starts) uses F3
#   other than toggle_3d_mode, or uses F11.
# - Physical F3 and F11 key events go to the unhandled-input path. F3 switches to 3D. F11 does not switch.
# - While the Load confirmation is open, F3 (both the physical key and the bound InputMap event) does not switch
#   worlds, creates no 3D world, and leaves the dialog open and usable. After Cancel, F3 works again.
# - Continue on the start screen restores the saved life with no confirmation dialog.
# - In-game Load asks for confirmation first. Cancel leaves the same character and clock objects, the unsaved
#   money, the unsaved geography, and the unsaved life event unchanged. Confirm replaces the session with the
#   saved copy, and creates one new character and one new clock.
# - Missing, unreadable, or empty save data is rejected before the active session is released. The session stays
#   usable afterwards.
# - Repeated Load and Cancel cycles add no nodes, signal connections, or input bindings.
#
# Buttons are activated by focusing the real Button and sending ui_accept, as ui_flow_headless does. Mouse input
# is not used. Nothing is rendered, so no dialog layout, colour, or visual state is checked here.
#
# Save file: user://naija-stage1-save.json. The shared recovery protocol in tests/support/save_slot_guard.gd takes
# a lock, copies the original byte for byte to its backup, and verifies the copy before the original is removed.
# The test's own writes are recorded as they happen. At the end the original is written back, read back, and
# compared byte for byte. Protocol files are removed only after that check. The protocol refuses to start while an
# unresolved earlier run's files are present, and it recovers an interrupted run only when every byte it depends
# on is proven. The game clock is frozen during the test so that autosaves cannot overwrite the values under
# test. A watchdog restores the save file if the run stalls. See docs section 25.
#
# Run: godot --headless --path game --script res://tests/load_confirmation_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const SaveSlotGuardScript = preload("res://tests/support/save_slot_guard.gd")

const SAVE_PATH := "user://naija-stage1-save.json"
const WATCHDOG_SECONDS := 240.0
const CREATION_TEXT := "You are beginning your life"
const SAVED_MONEY := 1234
const UNSAVED_MONEY := 999
const SAVED_REGION := "ng:state:bo"
const UNSAVED_REGION := "ng:state:on"
const SAVED_EVENT_ID := "load_confirm_saved_event"
const UNSAVED_EVENT_ID := "load_confirm_unsaved_event"
const CONFIRM_TEXT := "Load and discard progress"
const CANCEL_TEXT := "Cancel"
const DIALOG_TITLE := "Replace current session?"
const NOTICE_TITLE := "Saved life unavailable"
const CYCLES := 5

var _checks: int = 0
var _failures: Array[String] = []
var _guard := SaveSlotGuardScript.new()
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
# The save-slot protocol lives in tests/support/save_slot_guard.gd. See the header.


func _write_raw_save(text: String) -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(text)
		file.close()
	_guard.observe()


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


func _press_physical(keycode: int) -> void:
	# A physical key event built here, not copied from the InputMap, so the binding is tested against the real key.
	var down := InputEventKey.new()
	down.physical_keycode = keycode as Key
	down.pressed = true
	root.push_unhandled_input(down)
	var up := InputEventKey.new()
	up.physical_keycode = keycode as Key
	up.pressed = false
	root.push_unhandled_input(up)


func _count_nodes(node: Node) -> int:
	var count := 1
	for child in node.get_children():
		count += _count_nodes(child)
	return count


func _has_life_event(character: Object, event_id: String) -> bool:
	for entry in character.life_history:
		if entry.get("id", "") == event_id:
			return true
	return false


func _read_save() -> Dictionary:
	var result: Dictionary = SaveServiceScript.load_state()
	return result


func _freeze_clock(proto: Node) -> void:
	# Test-only: a very long real time per game minute stops the clock, so no 15-minute autosave can fire.
	proto._seconds_per_game_minute = 1.0e9


func _apply_unsaved_state(proto: Node) -> void:
	proto.character.money = UNSAVED_MONEY
	proto.character.set_geographic_location({"state_id": UNSAVED_REGION})
	if not _has_life_event(proto.character, UNSAVED_EVENT_ID):
		proto.character.life_history.append({
			"id": UNSAVED_EVENT_ID,
			"type": "load_confirm_probe",
			"summary": "Unsaved probe event",
			"date": proto.clock.calendar_date(),
		})


func _session_is_unsaved_and_intact(proto: Node, character_ref: Object, clock_ref: Object) -> bool:
	return (
		proto.playing
		and proto.character == character_ref
		and proto.clock == clock_ref
		and proto.character.money == UNSAVED_MONEY
		and str(proto.character.geographic_location.get("state_id", "")) == UNSAVED_REGION
		and _has_life_event(proto.character, UNSAVED_EVENT_ID)
	)


func _open_load_confirmation(main: Node) -> void:
	var menu := _find_button(main, "Save / Load")
	if menu != null:
		_activate(menu)
	await _frames(3)
	var load_button := _find_button(main, "Load saved progress")
	if load_button != null:
		_activate(load_button)
	await _frames(3)


func _close_open_modal(ui: Node) -> void:
	# Closes any open modal through its real button. Loops because a modal can open another.
	for attempt in 4:
		if not ui.is_modal_open():
			return
		var close := _find_button(_main, "Close")
		if close == null:
			close = _find_button(_main, CANCEL_TEXT)
		if close == null:
			return
		_activate(close)
		await _frames(2)


func _scan_function_keys(label: String) -> void:
	var f3_users: Array[String] = []
	var f11_users: Array[String] = []
	for action in InputMap.get_actions():
		for event in InputMap.action_get_events(action):
			if event is InputEventKey:
				var key := event as InputEventKey
				if key.physical_keycode == KEY_F3 or key.keycode == KEY_F3:
					f3_users.append(str(action))
				if key.physical_keycode == KEY_F11 or key.keycode == KEY_F11:
					f11_users.append(str(action))
	_check(f3_users == ["toggle_3d_mode"], "%s: only toggle_3d_mode uses F3 (users: %s)" % [label, str(f3_users)])
	_check(f11_users.is_empty(), "%s: no action uses F11 (users: %s)" % [label, str(f11_users)])


# ---------- test ----------

func _run() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	if not _guard.begin("load_confirmation_headless", SAVE_PATH):
		print("FAIL: %s" % _guard.message)
		quit(1)
		return
	if _guard.recovered_previous_run:
		print("NOTE: %s" % _guard.message)
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.open("user://").remove(SAVE_PATH.trim_prefix("user://"))
	_guard.observe()

	# ---- A. The configured key, read from project settings and from the InputMap before the scene starts ----
	var setting: Variant = ProjectSettings.get_setting("input/toggle_3d_mode", {})
	var setting_events: Array = []
	if setting is Dictionary:
		setting_events = (setting as Dictionary).get("events", [])
	var setting_key: InputEventKey = null
	if setting_events.size() == 1 and setting_events[0] is InputEventKey:
		setting_key = setting_events[0] as InputEventKey
	_check(setting_key != null, "project.godot defines exactly one key event for toggle_3d_mode")
	_check(setting_key != null and setting_key.physical_keycode == KEY_F3, "project.godot binds toggle_3d_mode to physical F3")
	var bound_events: Array = InputMap.action_get_events("toggle_3d_mode")
	var bound_key: InputEventKey = null
	if bound_events.size() == 1 and bound_events[0] is InputEventKey:
		bound_key = bound_events[0] as InputEventKey
	_check(bound_key != null and bound_key.physical_keycode == KEY_F3, "The runtime InputMap binds toggle_3d_mode to physical F3")
	_observe("toggle_3d_mode runtime binding: physical keycode %d (%s)" % [bound_key.physical_keycode if bound_key != null else -1, OS.get_keycode_string(bound_key.physical_keycode) if bound_key != null else "none"])
	_scan_function_keys("InputMap before the scene starts")

	# ---- B. Start a new life, save known values, then add unsaved values ----
	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto = _main.mode_2d_instance
	var begin := _find_button(_main, "Begin your life")
	if begin != null:
		_activate(begin)
	await _frames(4)
	_check(proto.playing and proto.character != null and proto.clock != null, "Begin your life starts play (test setup)")
	_freeze_clock(proto)
	await _close_open_modal(proto.ui)
	_scan_function_keys("InputMap after the scene starts (includes runtime bindings)")

	# Saved values, written through the real HUD: Save / Load -> Save progress now.
	proto.character.money = SAVED_MONEY
	proto.character.set_geographic_location({"state_id": SAVED_REGION})
	proto.character.life_history.append({
		"id": SAVED_EVENT_ID,
		"type": "load_confirm_saved_probe",
		"summary": "Saved probe event",
		"date": proto.clock.calendar_date(),
	})
	var save_menu := _find_button(_main, "Save / Load")
	if save_menu != null:
		_activate(save_menu)
	await _frames(3)
	var save_now := _find_button(_main, "Save progress now")
	if save_now != null:
		_activate(save_now)
	await _frames(3)
	var saved := _read_save()
	_check(bool(saved.get("ok", false)), "The HUD save writes a loadable save file (test setup)")
	_check(int(saved.get("character", {}).get("money", -1)) == SAVED_MONEY, "The saved file holds the known money (test setup)")
	await _close_open_modal(proto.ui)

	# Unsaved values that a Load must not silently apply or silently discard.
	_apply_unsaved_state(proto)
	var character_ref = proto.character
	var clock_ref = proto.clock
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Unsaved money, geography, and life event are set in the live session (test setup)")

	# ---- C. Physical keys: F11 does nothing, F3 switches to 3D and back ----
	_press_physical(KEY_F11)
	await _frames(3)
	_check(_main.current_mode == "2d", "Physical F11 does not switch modes")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "3d", "Physical F3 switches to 3D")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "2d" and _main.mode_2d_instance == proto, "Physical F3 returns to the same 2D session")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Mode switching leaves the unsaved session unchanged")

	# ---- D. Cancel leaves everything unchanged ----
	await _open_load_confirmation(_main)
	var confirm_button := _find_button(_main, CONFIRM_TEXT)
	var cancel_button := _find_button(_main, CANCEL_TEXT)
	_check(proto.ui.is_modal_open() and confirm_button != null and cancel_button != null, "In-game Load requests confirmation (confirm and cancel buttons)")
	_check(_label_contains(proto.ui, DIALOG_TITLE), "The confirmation names the current session as being replaced")
	_check(_label_contains(proto.ui, "Unsaved progress is discarded"), "The confirmation says unsaved progress is discarded")
	_check(not proto.player.movement_enabled, "The open confirmation pauses player movement")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Before confirmation, the live session is unchanged")
	if cancel_button != null:
		_activate(cancel_button)
	await _frames(3)
	_check(not proto.ui.is_modal_open(), "Cancel closes the confirmation")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Cancel keeps the same character and clock objects and the unsaved money, geography, and life event")
	_check(proto.player.movement_enabled, "Cancel restores player movement")
	_check(_find_button(_main, "Save / Load") != null, "The HUD is usable again after Cancel")

	# ---- E. Repeated Load and Cancel cycles add nothing ----
	var load_connections: int = proto.ui.get_signal_connection_list("load_requested").size()
	var save_connections: int = proto.ui.get_signal_connection_list("save_requested").size()
	var modal_connections: int = proto.ui.get_signal_connection_list("modal_changed").size()
	var toggle_bindings: int = InputMap.action_get_events("toggle_3d_mode").size()
	var nodes_before := _count_nodes(_main)
	var mode_2d_children_before: int = _main.get_node("Mode2D").get_child_count()
	for cycle in CYCLES:
		await _open_load_confirmation(_main)
		var cycle_cancel := _find_button(_main, CANCEL_TEXT)
		if cycle_cancel != null:
			_activate(cycle_cancel)
		await _frames(2)
	_check(proto.ui.get_signal_connection_list("load_requested").size() == load_connections, "Repeated Load and Cancel add no load_requested connections")
	_check(proto.ui.get_signal_connection_list("save_requested").size() == save_connections, "Repeated Load and Cancel add no save_requested connections")
	_check(proto.ui.get_signal_connection_list("modal_changed").size() == modal_connections, "Repeated Load and Cancel add no modal_changed connections")
	_check(InputMap.action_get_events("toggle_3d_mode").size() == toggle_bindings, "Repeated Load and Cancel add no input bindings")
	_check(_main.get_node("Mode2D").get_child_count() == mode_2d_children_before, "Repeated Load and Cancel add no 2D children")
	_check(_count_nodes(_main) == nodes_before, "Repeated Load and Cancel add no nodes (%d before, %d after)" % [nodes_before, _count_nodes(_main)])
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Repeated Load and Cancel leave the unsaved session unchanged")

	# ---- E2. World switching while the Load confirmation is open ----
	# A blocking modal owns input. F3 (the toggle_3d_mode action) must not switch worlds while it is open.
	# The dialog must stay open and usable, and the live session must not change.
	await _open_load_confirmation(_main)
	_check(proto.ui.is_modal_open(), "The Load confirmation is open before the F3 switch test")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "2d", "F3 while the Load confirmation is open does not switch to 3D")
	_check(_main.mode_3d_instance == null and _main.get_node("Mode3D").get_child_count() == 0, "F3 while the confirmation is open creates no 3D world")
	_check(not proto.is_suspended() and proto.playing, "F3 while the confirmation is open does not suspend the 2D session")
	_check(proto.ui.is_modal_open() and _find_button(_main, CONFIRM_TEXT) != null and _find_button(_main, CANCEL_TEXT) != null, "The confirmation stays open, with its buttons, after blocked F3")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Blocked F3 leaves the unsaved session unchanged")
	# The bound event itself (read from the InputMap), as a second route to the same action.
	var bound_toggle: InputEventKey = InputMap.action_get_events("toggle_3d_mode")[0] as InputEventKey
	var bound_down: InputEventKey = bound_toggle.duplicate() as InputEventKey
	bound_down.pressed = true
	root.push_unhandled_input(bound_down)
	await _frames(3)
	_check(_main.current_mode == "2d" and proto.ui.is_modal_open(), "The bound toggle_3d_mode event is also blocked while the confirmation is open")
	var cancel_blocked := _find_button(_main, CANCEL_TEXT)
	if cancel_blocked != null:
		_activate(cancel_blocked)
	await _frames(3)
	_check(not proto.ui.is_modal_open() and proto.player.movement_enabled, "Cancel after blocked F3 closes the dialog and restores movement")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Cancel after blocked F3 keeps the same session objects")
	# Ordinary switching works again after the modal closes.
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "3d" and proto.is_suspended(), "After the modal closes, F3 switches to 3D again")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "2d" and _main.mode_2d_instance == proto and not proto.is_suspended(), "After the modal closes, F3 returns to the same 2D session")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "The round trip after the modal leaves the unsaved session unchanged")
	# Repeated: open, blocked F3, cancel, then one real switch and back. Counts must not grow.
	var switch_connections: int = proto.ui.get_signal_connection_list("load_requested").size()
	var switch_bindings: int = InputMap.action_get_events("toggle_3d_mode").size()
	var switch_nodes := _count_nodes(_main)
	var blocked_every_time := true
	for cycle in CYCLES:
		await _open_load_confirmation(_main)
		_press_physical(KEY_F3)
		await _frames(2)
		if _main.current_mode != "2d" or _main.mode_3d_instance != null:
			blocked_every_time = false
		var cycle_cancel := _find_button(_main, CANCEL_TEXT)
		if cycle_cancel != null:
			_activate(cycle_cancel)
		await _frames(2)
		_press_physical(KEY_F3)
		await _frames(3)
		_press_physical(KEY_F3)
		await _frames(3)
		if _main.current_mode != "2d" or _main.mode_2d_instance != proto:
			blocked_every_time = false
	_check(blocked_every_time, "Every repeated open-F3-cancel cycle blocks the switch and then switches normally")
	_check(proto.ui.get_signal_connection_list("load_requested").size() == switch_connections, "Repeated F3-under-modal cycles add no load_requested connections")
	_check(InputMap.action_get_events("toggle_3d_mode").size() == switch_bindings, "Repeated F3-under-modal cycles add no input bindings")
	_check(_count_nodes(_main) == switch_nodes, "Repeated F3-under-modal cycles add no nodes (%d before, %d after)" % [switch_nodes, _count_nodes(_main)])
	_check(_main.get_node("Mode2D").get_child_count() == mode_2d_children_before and _main.get_node("Mode3D").get_child_count() == 0, "Repeated F3-under-modal cycles leave one 2D session and no 3D world")
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Repeated F3-under-modal cycles leave the unsaved session unchanged")

	# ---- F. Confirm replaces the session with the saved copy ----
	await _open_load_confirmation(_main)
	# A blocked F3 first: the switch is refused, and Confirm must still use the validated load path afterwards.
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "2d" and proto.ui.is_modal_open(), "Before Confirm, a blocked F3 leaves the dialog open in 2D")
	var confirm_now := _find_button(_main, CONFIRM_TEXT)
	if confirm_now != null:
		_activate(confirm_now)
	await _frames(4)
	_check(proto.playing, "Confirm leaves play running")
	_check(proto.character != character_ref and proto.clock != clock_ref, "Confirm creates a new character and clock from the save")
	_check(proto.character.money == SAVED_MONEY, "Confirm restores the saved money, not the unsaved value")
	_check(str(proto.character.geographic_location.get("state_id", "")) == SAVED_REGION, "Confirm restores the saved geography")
	_check(_has_life_event(proto.character, SAVED_EVENT_ID), "Confirm restores the saved life history")
	_check(not _has_life_event(proto.character, UNSAVED_EVENT_ID), "Confirm discards the unsaved life event")
	_check(not _label_contains(proto.ui, CREATION_TEXT), "Confirm does not open character creation")
	_check(not proto.ui.is_modal_open(), "Confirm closes the confirmation")
	_check(_main.get_node("Mode2D").get_child_count() == mode_2d_children_before, "Confirm leaves one 2D session (no duplicate session children)")
	_check(proto.ui.get_signal_connection_list("load_requested").size() == load_connections, "Confirm adds no load_requested connection")
	_check(_count_nodes(_main) == nodes_before, "Confirm leaves the node count unchanged (%d before, %d after)" % [nodes_before, _count_nodes(_main)])
	_observe("after Confirm: money=%d region=%s events=%d" % [proto.character.money, str(proto.character.geographic_location.get("state_id", "")), proto.character.life_history.size()])
	await _close_open_modal(proto.ui)

	# ---- G. Failed loads leave the active session intact and usable ----
	_freeze_clock(proto)
	_apply_unsaved_state(proto)
	character_ref = proto.character
	clock_ref = proto.clock
	var failure_cases := [
		{"label": "invalid JSON", "text": "{not json", "expect": "not valid JSON"},
		{"label": "unsupported version", "text": JSON.stringify({"version": 99, "character": {"name": "Ayo"}, "clock": {"day": 1, "minute_of_day": 420}}), "expect": "not supported"},
		{"label": "missing character", "text": JSON.stringify({"version": 2, "clock": {"day": 1, "minute_of_day": 420}}), "expect": "missing character or clock data"},
		{"label": "empty character object", "text": JSON.stringify({"version": 2, "character": {}, "clock": {"day": 1, "minute_of_day": 420}}), "expect": "character name"},
		{"label": "character without a name", "text": JSON.stringify({"version": 2, "character": {"money": 5}, "clock": {"day": 1, "minute_of_day": 420}}), "expect": "character name"},
		{"label": "clock without day", "text": JSON.stringify({"version": 2, "character": {"name": "Ayo", "money": 5}, "clock": {"minute_of_day": 420}}), "expect": "clock fields"},
	]
	for case in failure_cases:
		_write_raw_save(str(case["text"]))
		await _open_load_confirmation(_main)
		var failed_confirm := _find_button(_main, CONFIRM_TEXT)
		if failed_confirm != null:
			_activate(failed_confirm)
		await _frames(3)
		var label := str(case["label"])
		_check(_label_contains(proto.ui, NOTICE_TITLE), "Failed load (%s) shows the 'Saved life unavailable' notice" % label)
		_check(_label_contains(proto.ui, str(case["expect"])), "Failed load (%s) is rejected by the expected check ('%s')" % [label, str(case["expect"])])
		_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Failed load (%s) keeps the same session objects and unsaved values" % label)
		_check(_main.get_node("Mode2D").get_child_count() == mode_2d_children_before, "Failed load (%s) adds no session children" % label)
		await _close_open_modal(proto.ui)
		_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "Closing the notice after a failed load (%s) changes nothing" % label)

	# Session still usable after the failures: the HUD opens, the key toggles, and a save writes a good file.
	_check(_find_button(_main, "Save / Load") != null, "After failed loads the HUD is still reachable")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "3d", "After failed loads the F3 key still switches to 3D")
	_press_physical(KEY_F3)
	await _frames(3)
	_check(_main.current_mode == "2d" and _main.mode_2d_instance == proto, "After failed loads the F3 key still returns to the same 2D session")
	var menu_after := _find_button(_main, "Save / Load")
	if menu_after != null:
		_activate(menu_after)
	await _frames(3)
	var save_after := _find_button(_main, "Save progress now")
	if save_after != null:
		_activate(save_after)
	await _frames(3)
	_check(bool(_read_save().get("ok", false)), "After failed loads a manual save still writes a loadable file")
	await _close_open_modal(proto.ui)

	# A missing save file: the Load option is not offered, so nothing can attempt a load.
	DirAccess.open("user://").remove(SAVE_PATH.trim_prefix("user://"))
	var menu_missing := _find_button(_main, "Save / Load")
	if menu_missing != null:
		_activate(menu_missing)
	await _frames(3)
	_check(_find_button(_main, "Load saved progress") == null, "With no save file, the save menu does not offer Load")
	await _close_open_modal(proto.ui)
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "A missing save file leaves the live session unchanged")

	# ---- H. Save-service validation, direct (no UI) ----
	# A missing character key must be rejected by the check itself. The check's fallback is null, not {}, because
	# an {} fallback passes an "is Dictionary" test and then fails on the direct lookup.
	var direct_cases := [
		{"label": "a missing character key", "text": JSON.stringify({"version": 2, "clock": {"day": 1, "minute_of_day": 420}})},
		{"label": "a missing clock key", "text": JSON.stringify({"version": 2, "character": {"name": "Ayo"}})},
		{"label": "a character that is not an object", "text": JSON.stringify({"version": 2, "character": 5, "clock": {"day": 1, "minute_of_day": 420}})},
	]
	for case in direct_cases:
		_write_raw_save(str(case["text"]))
		var direct: Dictionary = SaveServiceScript.load_state()
		_check(not bool(direct.get("ok", false)) and not direct.has("character"), "SaveService rejects %s without returning a character payload" % str(case["label"]))
	_check(_session_is_unsaved_and_intact(proto, character_ref, clock_ref), "The direct save-service checks leave the live session unchanged")

	# ---- restore the save file and report ----
	var save_restored := _guard.finish()
	_check(save_restored, "The save file is restored byte for byte and the test's backup is removed only after that check")
	_check_restore()
	var total := _checks
	if _failures.is_empty():
		print("PASS: %d load confirmation and control checks (headless, simulated input)" % total)
		quit(0)
	else:
		print("FAIL: %d of %d load confirmation and control checks (headless, simulated input)" % [_failures.size(), total])
		quit(1)


func _check_restore() -> void:
	var exists := FileAccess.file_exists(SAVE_PATH)
	if _guard.original_existed():
		_check(exists, "The original save file is restored")
	else:
		_check(not exists, "No save file is left behind when none existed before")
	_check(not _guard.protocol_files_present(), "The protocol files (lock, manifest, backup) are removed")
