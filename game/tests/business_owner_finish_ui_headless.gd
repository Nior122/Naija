extends SceneTree
# Stage 44, phase 4 of 5: the owner dismisses the worker, withdraws the balance, closes business A
# (which now has no balance, so the close must succeed), and transfers business C to the stranger.
# HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# The transfer is exercised as the server defines it today: the owner confirms, and the recipient
# is not asked. Whether a recipient must consent is an open policy decision (see
# docs/STAGE_43_BUSINESS_LIFECYCLE.md section 8.2), so this test does not make that decision.
#
# Requirements, set by the runner (never defaulted to a developer's own save or server):
#   NAIJA_WS_URL                    an isolated world server
#   NAIJA_MULTIPLAYER_SESSION_PATH  the owner's session config (kept outside the repository)
#   NAIJA_UI_STATE_PATH             the state written by phase 1
#   NAIJA_UI_STRANGER_ID            the character ID of the stranger who receives business C
#
# Run: godot --headless --path game --script res://tests/business_owner_finish_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const DRIVER := preload("res://tests/business_ui_driver.gd")
const FLOW := preload("res://tests/business_ui_flow.gd")
const WATCHDOG_SECONDS := 300.0
const URL_ENV := "NAIJA_WS_URL"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const STATE_ENV := "NAIJA_UI_STATE_PATH"
const STRANGER_ENV := "NAIJA_UI_STRANGER_ID"

var _d: RefCounted = null
var _f: RefCounted = null


func _initialize() -> void:
	_d = DRIVER.new(self)
	_f = FLOW.new(_d)
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	call_deferred("_run")


func _on_watchdog() -> void:
	print("FAIL: watchdog after %.0f seconds" % WATCHDOG_SECONDS)
	quit(1)


func _run() -> void:
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	var stranger_id := OS.get_environment(STRANGER_ENV).strip_edges()
	_d.check(FileAccess.file_exists(session_path), "the owner session file exists")
	_d.check(stranger_id.begins_with("character-"), "NAIJA_UI_STRANGER_ID is a character ID")
	var state = _read_state(OS.get_environment(STATE_ENV).strip_edges())
	_d.check(state is Dictionary and state.has("business_a"), "phase 1 wrote the business names")
	if _d.failures.size() > 0:
		_finish()
		return

	var main := MAIN_SCENE.instantiate()
	root.add_child(main)
	_d.main = main
	for i in range(3):
		await process_frame
	var proto: Node = main.mode_2d_instance
	if proto == null:
		_d.check(false, "Main scene exposes the 2D session")
		_finish()
		return
	var continue_button = _d.find_button(main, "Continue online life")
	_d.check(continue_button != null, "start screen offers 'Continue online life'")
	if continue_button != null:
		_d.activate(continue_button)
	_d.check(await _d.wait_for_session(proto), "the owner's online session is ready")
	if not proto.playing:
		_finish()
		return
	var businesses = _d.find_button(main, "Businesses")
	if businesses != null:
		_d.activate(businesses)
	_d.check(await _d.wait_label("Your cash"), "Businesses panel shows the owner's cash line")

	var name_a: String = state["business_a"]
	var name_c: String = state["business_c"]
	var candidate_id: String = state["candidate_id"]

	# ---- 1. Dismiss the worker. No money moves. ----
	_d.check(await _f.open_owned(name_a), "the owner opens business A")
	var dismiss = await _d.wait_card_button(name_a, "Dismiss")
	_d.check(dismiss != null, "'Dismiss' is offered for the employee")
	if dismiss != null:
		_d.activate(dismiss)
	_d.check(await _f.confirm_pending(), "the dismissal is confirmed")
	_d.check(await _d.wait_label("Employee %s released." % candidate_id),
		"the server releases the employee")

	# ---- 2. Withdraw the whole balance into the owner's cash ----
	var balance: int = _d.naira_after(main_node(), "Balance ")
	_d.check(balance > 0, "business A shows a balance to withdraw (N%d)" % balance)
	var withdraw = await _d.wait_card_button(name_a, "Withdraw")
	_d.check(withdraw != null, "'Withdraw' is offered to the owner")
	if withdraw != null:
		var amount := _line_edit_beside(withdraw)
		_d.check(amount != null, "the withdrawal row has an amount field")
		if amount != null:
			amount.text = str(balance)
		_d.activate(withdraw)
	_d.check(await _f.confirm_pending(), "the withdrawal is confirmed")
	_d.check(await _d.wait_label("Withdrew %s from the business." % _naira_text(balance)),
		"the server confirms the withdrawal of the whole balance")
	_d.check(_d.naira_after(main_node(), "Balance ") == 0, "business A's balance is now N0")

	# ---- 3. Close A, which holds no money: the server must accept ----
	var close_a = await _d.wait_card_button(name_a, "Close business")
	_d.check(close_a != null, "'Close business' is offered for A")
	if close_a != null:
		_d.activate(close_a)
	_d.check(await _f.confirm_pending(), "closing A is confirmed")
	_d.check(await _d.wait_label("Business '%s' has been closed." % name_a),
		"the server closes A, which now has no balance")

	# ---- 4. Transfer business C to the stranger ----
	var close_details = await _d.wait_enabled_button("Close details")
	if close_details != null:
		_d.activate(close_details)
	_d.check(await _f.open_owned(name_c), "the owner opens business C")
	var transfer = await _d.wait_card_button(name_c, "Transfer ownership")
	_d.check(transfer != null, "'Transfer ownership' is offered for C")
	if transfer != null:
		var recipient = _d.field_beside(transfer, "Recipient character ID")
		_d.check(recipient != null, "the transfer row has a recipient field")
		if recipient != null:
			recipient.text = stranger_id
		_d.activate(transfer)
	_d.check(await _f.confirm_pending(), "the ownership transfer is confirmed")
	_d.check(await _d.wait_label("Ownership transferred to %s" % stranger_id),
		"the server confirms the transfer of C to the stranger")

	_finish()


## The amount field in the same row as the button (the money forms keep them together).
func _line_edit_beside(button: Button) -> LineEdit:
	if button == null or button.get_parent() == null:
		return null
	for sibling in button.get_parent().get_children():
		if sibling is LineEdit:
			return sibling
	return null


## The naira text the panel uses, for example 48500 becomes "₦48,500".
func _naira_text(amount: int) -> String:
	var digits := str(amount)
	var grouped := ""
	for index in range(digits.length()):
		if index > 0 and (digits.length() - index) % 3 == 0:
			grouped += ","
		grouped += digits.substr(index, 1)
	return "₦%s" % grouped


func main_node() -> Node:
	return _d.main


func _read_state(path: String) -> Variant:
	if path.is_empty() or not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _finish() -> void:
	print("")
	var failed: int = _d.failures.size()
	if failed == 0:
		print("PASS: %d business owner-finish UI checks (headless, simulated input)" % _d.checks)
		quit(0)
	else:
		print("FAIL: %d of %d business owner-finish UI checks failed" % [failed, _d.checks])
		quit(1)
