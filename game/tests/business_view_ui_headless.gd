extends SceneTree
# Stage 44, phases 3 and 5: what a person sees of a business they do not own, or do not yet own.
# HEADLESS, SIMULATED INPUT. It is not a rendered test. The mode is set by the runner:
#
#   NAIJA_UI_VIEW_KIND = staff       the hired candidate (an employee of business A) must see A with
#                                    the role Employee, and none of the owner's controls.
#   NAIJA_UI_VIEW_KIND = stranger    a stranger (not a member of A) must see A in Discover with the
#                                    buyer's controls only, and none of the owner's controls. A
#                                    purchase larger than the stranger's cash is refused by the
#                                    server, and the cash does not change.
#   NAIJA_UI_VIEW_KIND = new_owner   the stranger, after phase 4 transferred business C to them,
#                                    must see C in "My businesses" with the role Owner and the
#                                    owner's controls.
#
# The panel only offers what the server allows for the role, so a missing control is a check of the
# panel's role gating. The server's own refusal is checked for the stranger's purchase.
#
# Requirements, set by the runner (never defaulted to a developer's own save or server):
#   NAIJA_WS_URL                    an isolated world server
#   NAIJA_MULTIPLAYER_SESSION_PATH  the session config of the role under test (outside the repo)
#   NAIJA_UI_STATE_PATH             the state written by phase 1
#   NAIJA_UI_VIEW_KIND              staff, stranger, or new_owner
#
# Run: godot --headless --path game --script res://tests/business_view_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const DRIVER := preload("res://tests/business_ui_driver.gd")
const FLOW := preload("res://tests/business_ui_flow.gd")
const WATCHDOG_SECONDS := 300.0
const URL_ENV := "NAIJA_WS_URL"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const STATE_ENV := "NAIJA_UI_STATE_PATH"
const KIND_ENV := "NAIJA_UI_VIEW_KIND"
const OWNER_ONLY_CONTROLS := [
	"Restock", "Hire", "Dismiss", "Close business", "Transfer ownership", "Open branch",
	"List goods", "List service", "Pay salary", "Withdraw", "Transfer funds",
]

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
	var kind := OS.get_environment(KIND_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	_d.check(kind in ["staff", "stranger", "new_owner"],
		"NAIJA_UI_VIEW_KIND is staff, stranger, or new_owner")
	_d.check(FileAccess.file_exists(session_path), "the session file for this role exists")
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
	_d.check(await _d.wait_for_session(proto), "the session for this role is ready")
	if not proto.playing:
		_finish()
		return
	var businesses = _d.find_button(main, "Businesses")
	if businesses != null:
		_d.activate(businesses)
	_d.check(await _d.wait_label("Your cash"), "Businesses panel shows the cash line")

	match kind:
		"staff":
			await _check_staff(state)
		"stranger":
			await _check_stranger(state)
		"new_owner":
			await _check_new_owner(state)
	_finish()


func _check_staff(state: Dictionary) -> void:
	var name_a: String = state["business_a"]
	# An employee is not an owner, so "My businesses" lists only the businesses this character owns.
	# The employee finds the workplace through Discover. Whether an employee should also see it under
	# "My businesses" is a product question, so it is recorded here, not asserted.
	print("OBSERVED: business A appears under 'My businesses' for the employee: %s" % str(
		_d.card_button(main_node(), name_a, "Open") != null))
	_d.check(await _f.discover(name_a), "the candidate finds business A in Discover")
	_d.check(await _f.open_discovered(name_a), "the candidate opens business A")
	_d.check(_d.find_label_text(main_node(), "Your role: Employee") != "",
		"the candidate's role in A is shown as Employee")
	_check_no_owner_controls(name_a)
	# Every member sees the "Actions for your role" heading, even an employee with no controls
	# under it.
	# That is cosmetic and is recorded here, not asserted. The controls themselves are checked above.
	var heading_shown: bool = _d.find_label_text(main_node(), "Actions for your role") != ""
	print("OBSERVED: the employee sees the heading 'Actions for your role' with no controls: %s"
		% str(heading_shown))


func _check_stranger(state: Dictionary) -> void:
	var name_a: String = state["business_a"]
	var cash_before: int = _d.naira_after(main_node(), "Your cash: ")
	_d.check(cash_before >= 0, "the stranger's cash is shown (N%d)" % cash_before)
	_d.check(await _f.discover(name_a), "the stranger finds business A in Discover")
	_d.check(await _f.open_discovered(name_a), "the stranger opens business A")
	_d.check(_d.card_button(main_node(), name_a, "Buy") != null,
		"the stranger is offered the goods 'Buy' control")
	_check_no_owner_controls(name_a)
	_d.check(_d.find_label_text(main_node(), "Actions for your role") == "",
		"a stranger is offered no action section for A")

	# A purchase larger than the stranger's cash: 2 units at N4,000 is N8,000.
	var buy = await _d.wait_card_button(name_a, "Buy")
	if buy != null:
		var qty = _d.field_beside(buy, "Qty")
		if qty != null:
			qty.text = "2"
		_d.activate(buy)
	_d.check(await _f.confirm_pending(), "the stranger's purchase is sent for confirmation")
	_d.check(await _d.wait_label("does not have enough funds"),
		"the server refuses the purchase: not enough funds")
	var cash_after: int = _d.naira_after(main_node(), "Your cash: ")
	_d.check(cash_after == cash_before,
		"the refused purchase leaves the stranger's cash unchanged (N%d)" % cash_after)


func _check_new_owner(state: Dictionary) -> void:
	var name_c: String = state["business_c"]
	_d.check(_d.card_button(main_node(), name_c, "Open") != null,
		"after the transfer, business C is in the new owner's 'My businesses'")
	_d.check(await _f.open_owned(name_c), "the new owner opens business C")
	_d.check(_d.find_label_text(main_node(), "Your role: Owner") != "",
		"the new owner's role in C is shown as Owner")
	_d.check(_d.find_label_text(main_node(), "Actions for your role") != "",
		"the new owner is offered the action section for C")
	_d.check(_d.card_button(main_node(), name_c, "Close business") != null,
		"the new owner is offered 'Close business' for C")
	_d.check(_d.card_button(main_node(), name_c, "Hire") != null,
		"the new owner is offered 'Hire' for C")


func _check_no_owner_controls(name: String) -> void:
	for text in OWNER_ONLY_CONTROLS:
		_d.check(_d.card_button(main_node(), name, text) == null,
			"no owner control '%s' is shown to this role" % text)


func main_node() -> Node:
	return _d.main


func _read_state(path: String) -> Variant:
	if path.is_empty() or not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _finish() -> void:
	print("")
	var failed: int = _d.failures.size()
	var kind := OS.get_environment(KIND_ENV).strip_edges()
	if failed == 0:
		print("PASS: %d business view checks, %s (headless, simulated input)" % [_d.checks, kind])
		quit(0)
	else:
		print("FAIL: %d of %d business view checks failed, %s" % [failed, _d.checks, kind])
		quit(1)
