extends SceneTree
# Stage 44: a business change refused by the server's command limit, through the business panel.
# HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# The server allows 20 commands per connection in 10 seconds, and answers a refused command with a
# generic error that carries the request ID (code rate_limited). This test fills that window with
# "Refresh list" presses on the Discover tab (reads, which are not pending changes), then starts a
# business from the create form. Expected: the panel shows the server's own message, the Start
# business button is enabled again, nothing is shown as waiting, and no business is created.
# Before Stage 44 the refused request was never answered in the panel: it showed "waiting" until its
# 20-second timeout, and then said the change may or may not have been saved.
#
# Requirements, both set by the runner, never defaulted to the developer's own save or server:
#   NAIJA_WS_URL                    an isolated world server (the runner uses a reset copy)
#   NAIJA_MULTIPLAYER_SESSION_PATH  a config file holding a funded owner's session token
#
# Run: godot --headless --path game --script res://tests/business_rate_limit_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const WATCHDOG_SECONDS := 120.0
const SESSION_WAIT_FRAMES := 1800
const REFRESH_PRESSES := 30
const REPLY_WAIT_MS := 5000
const MESSAGE_RATE_LIMITED := "Too many commands were sent in a short time."
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const URL_ENV := "NAIJA_WS_URL"

var _checks: int = 0
var _failures: Array[String] = []
var _main: Node = null


func _initialize() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _observe(label: String) -> void:
	print("OBSERVED: %s" % label)


func _on_watchdog() -> void:
	print("FAIL: watchdog after %.0f seconds" % WATCHDOG_SECONDS)
	quit(1)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _find_button(node: Node, text: String) -> Button:
	if node.is_queued_for_deletion():
		return null
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _find_line_edit(node: Node, placeholder: String) -> LineEdit:
	if node.is_queued_for_deletion():
		return null
	if node is LineEdit and (node as LineEdit).placeholder_text == placeholder:
		return node
	for child in node.get_children():
		var found := _find_line_edit(child, placeholder)
		if found != null:
			return found
	return null


func _find_option(node: Node, contains: String) -> OptionButton:
	if node.is_queued_for_deletion():
		return null
	if node is OptionButton:
		var option := node as OptionButton
		for index in range(option.item_count):
			if option.get_item_text(index).contains(contains):
				return option
	for child in node.get_children():
		var found := _find_option(child, contains)
		if found != null:
			return found
	return null


func _choose(option: OptionButton, contains: String) -> bool:
	for index in range(option.item_count):
		if option.get_item_text(index).contains(contains):
			option.select(index)
			option.item_selected.emit(index)
			return true
	return false


func _label_contains(node: Node, text: String) -> bool:
	if node.is_queued_for_deletion():
		return false
	if node is Label and (node as Label).is_visible_in_tree() and (node as Label).text.contains(text):
		return true
	for child in node.get_children():
		if _label_contains(child, text):
			return true
	return false


func _activate(button: Button) -> void:
	# Real GUI activation: focus the button, then send ui_accept press and release.
	button.grab_focus()
	var down := InputEventAction.new()
	down.action = "ui_accept"
	down.pressed = true
	root.push_input(down)
	var up := InputEventAction.new()
	up.action = "ui_accept"
	up.pressed = false
	root.push_input(up)


## Waits for a label up to a real-time limit, so that a late answer is not counted as a prompt one.
func _wait_label_ms(text: String, limit_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + limit_ms
	while Time.get_ticks_msec() < deadline:
		if _label_contains(_main, text):
			return true
		await process_frame
	return _label_contains(_main, text)


## Waits, in real time, until the tracker has no pending request. Returns false on timeout.
func _wait_resolved_ms(tracker, limit_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + limit_ms
	while Time.get_ticks_msec() < deadline:
		if not tracker.has_pending():
			return true
		await process_frame
	return not tracker.has_pending()


func _run() -> void:
	var url := OS.get_environment(URL_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	_check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_check(not session_path.is_empty() and FileAccess.file_exists(session_path),
		"NAIJA_MULTIPLAYER_SESSION_PATH names an existing funded-owner session file")
	if _failures.size() > 0:
		_finish()
		return
	_observe("server URL: %s" % url)

	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto: Node = _main.mode_2d_instance
	_check(proto != null, "Main scene exposes the 2D session")
	if proto == null:
		_finish()
		return

	var continue_button := _find_button(_main, "Continue online life")
	_check(continue_button != null, "start screen offers 'Continue online life'")
	if continue_button != null:
		_activate(continue_button)
	var waited := 0
	while not proto.playing and waited < SESSION_WAIT_FRAMES:
		await process_frame
		waited += 1
	_check(proto.playing, "online session becomes ready from the server")
	if not proto.playing:
		_finish()
		return

	var businesses := _find_button(_main, "Businesses")
	if businesses != null:
		_activate(businesses)
	await _frames(5)
	_check(_label_contains(proto.ui, "Your cash"), "Businesses panel is open")

	# ---- 1. Fill the command window with reads (Discover tab, Refresh list) ----
	var discover := _find_button(_main, "Discover")
	_check(discover != null, "the Discover tab is offered")
	if discover != null:
		_activate(discover)
	await _frames(3)
	var presses := 0
	for index in range(REFRESH_PRESSES):
		var refresh := _find_button(_main, "Refresh list")
		if refresh == null:
			break
		_activate(refresh)
		presses += 1
		await process_frame
	_check(presses == REFRESH_PRESSES, "Refresh list was pressed %d times" % REFRESH_PRESSES)
	await _frames(5)

	# ---- 2. Start a business from the create form, while the window is full ----
	var owned := _find_button(_main, "My businesses")
	_check(owned != null, "the My businesses tab is offered")
	if owned != null:
		_activate(owned)
	await _frames(3)
	var suffix := str(Time.get_ticks_usec() % 100000)
	var business_name := "Stage44 Limit %s" % suffix
	var name_edit := _find_line_edit(proto.ui, "Business name")
	var description_edit := _find_line_edit(proto.ui, "Describe the business")
	var capital_edit := _find_line_edit(proto.ui, "Starting capital (₦, optional)")
	_check(name_edit != null and description_edit != null and capital_edit != null,
		"create form has its fields")
	if name_edit != null:
		name_edit.text = business_name
	if description_edit != null:
		description_edit.text = "A shop refused by the command limit."
	if capital_edit != null:
		capital_edit.text = "0"
	var template_option := _find_option(proto.ui, "Provision Store")
	_check(template_option != null and _choose(template_option, "Provision Store"),
		"create form offers the Provision Store template")
	var create := _find_button(_main, "Start business")
	_check(create != null and not create.disabled, "'Start business' is enabled before the request")
	if create != null:
		_activate(create)
	await _frames(3)
	var confirm := _find_button(_main, "Confirm")
	_check(confirm != null and not confirm.disabled, "creating asks for confirmation")
	if confirm != null:
		_activate(confirm)

	# ---- 3. The server's refusal is shown, and nothing is left waiting ----
	var tracker = proto.ui._business_tracker
	var panel: Node = proto.ui._business_panel
	var resolved := await _wait_resolved_ms(tracker, REPLY_WAIT_MS)
	var limit_seconds := REPLY_WAIT_MS / 1000
	_check(resolved, "the refused create is no longer pending within %d seconds" % limit_seconds)
	_check(_label_contains(panel, MESSAGE_RATE_LIMITED),
		"the business panel shows the server's rate_limited message")
	_check(not _label_contains(panel, "A change is waiting"),
		"no change is shown as waiting after the refusal")
	_check(not _label_contains(panel, "may or may not have been saved"),
		"the refusal is not reported as possibly saved")
	var create_again := _find_button(_main, "Start business")
	_check(create_again != null and not create_again.disabled,
		"'Start business' is enabled again after the refusal")
	_check(not _label_contains(panel, business_name), "the refused business is not listed")
	_check(_label_contains(panel, "400,000"), "the owner's server cash is unchanged (N400,000)")
	_observe("refused create of '%s' after %d refresh presses" % [business_name, presses])
	_finish()


func _finish() -> void:
	if _failures.is_empty():
		print("PASS: %d business command-limit UI checks (headless, simulated input)" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d checks failed" % [_failures.size(), _checks])
		for label in _failures:
			print("  - %s" % label)
		quit(1)
