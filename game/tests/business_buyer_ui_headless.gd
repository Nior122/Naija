extends SceneTree
# Stage 44, phase 2 of 5: a buyer (not a member of the business) buys from business A through the
# Godot panel. HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# Checks: a goods purchase and a service purchase are paid from the buyer's own cash, and the
# server's replies say so. A purchase of more stock than the business holds is refused with no
# change. The buyer's cash falls by exactly the two prices, read from the panel.
# The server's ledger and stock are checked afterwards from the world file.
#
# Requirements, set by the runner (never defaulted to a developer's own save or server):
#   NAIJA_WS_URL                    an isolated world server
#   NAIJA_MULTIPLAYER_SESSION_PATH  the buyer's session config (kept outside the repository)
#   NAIJA_UI_STATE_PATH             the state written by phase 1
#
# Run: godot --headless --path game --script res://tests/business_buyer_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const DRIVER := preload("res://tests/business_ui_driver.gd")
const FLOW := preload("res://tests/business_ui_flow.gd")
const WATCHDOG_SECONDS := 300.0
const URL_ENV := "NAIJA_WS_URL"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const STATE_ENV := "NAIJA_UI_STATE_PATH"

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
	var url := OS.get_environment(URL_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	var state_path := OS.get_environment(STATE_ENV).strip_edges()
	_d.check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_d.check(FileAccess.file_exists(session_path), "the buyer session file exists")
	var state = _read_state(state_path)
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
	_d.check(await _d.wait_for_session(proto), "the buyer's online session is ready")
	if not proto.playing:
		_finish()
		return

	var businesses = _d.find_button(main, "Businesses")
	if businesses != null:
		_d.activate(businesses)
	_d.check(await _d.wait_label("Your cash"), "Businesses panel shows the buyer's cash line")
	var cash_before: int = _d.naira_after(main, "Your cash: ")
	_d.check(cash_before > 0, "the buyer's cash is shown (N%d)" % cash_before)

	var name_a: String = state["business_a"]
	var service_name: String = state["service_name"]
	var service_price: int = int(state["service_price"])
	_d.check(await _f.discover(name_a), "the buyer finds business A in Discover")
	_d.check(await _f.open_discovered(name_a), "the buyer opens business A")
	_d.check(_d.card_button(main, name_a, "Buy") != null, "the goods 'Buy' control is offered")

	# ---- 1. Buy one goods unit from the buyer's own cash ----
	var buy = await _d.wait_card_button(name_a, "Buy")
	var goods_price: int = 0
	if buy != null:
		var qty = _d.field_beside(buy, "Qty")
		_d.check(qty != null, "the goods row has a quantity field")
		if qty != null:
			qty.text = "1"
		_d.activate(buy)
	_d.check(await _d.wait_label("Buy 1 ×"), "the panel asks the buyer to confirm the goods purchase")
	var goods_text: String = _d.find_label_text(main, "Buy 1 ×")
	goods_price = _amount_in(goods_text)
	_d.check(goods_price > 0, "the confirmation names the goods price (N%d)" % goods_price)
	_d.check(await _f.confirm_pending(), "the goods purchase is confirmed")
	_d.check(await _d.wait_label("Purchase of 1 for"), "the server reports the goods purchase")
	var cash_after_goods: int = await _wait_cash(cash_before - goods_price)
	_d.check(cash_after_goods == cash_before - goods_price,
		"the buyer's cash fell by the goods price (N%d → N%d)" % [cash_before, cash_after_goods])

	# ---- 2. Buy the service, which needs no stock ----
	var buy_service = await _d.wait_card_button(name_a, "Buy service")
	_d.check(buy_service != null, "the service 'Buy service' control is offered")
	if buy_service != null:
		_d.activate(buy_service)
	_d.check(await _d.wait_label("Buy %s" % service_name),
		"the panel asks the buyer to confirm the service purchase")
	_d.check(await _f.confirm_pending(), "the service purchase is confirmed")
	_d.check(await _d.wait_label("Service bought for"), "the server reports the service purchase")
	var cash_after_service: int = await _wait_cash(cash_after_goods - service_price)
	_d.check(cash_after_service == cash_after_goods - service_price,
		"the buyer's cash fell by the service price (N%d → N%d)" % [
			cash_after_goods, cash_after_service])

	# ---- 3. More stock than the business holds is refused, and nothing changes ----
	var buy_more = await _d.wait_card_button(name_a, "Buy")
	if buy_more != null:
		var qty_more = _d.field_beside(buy_more, "Qty")
		if qty_more != null:
			qty_more.text = "10"
		_d.activate(buy_more)
	_d.check(await _f.confirm_pending(), "the oversized purchase is sent for confirmation")
	_d.check(await _d.wait_label("There is not enough stock to complete this sale."),
		"the server refuses 10 units: not enough stock")
	var cash_after_refusal: int = _d.naira_after(main, "Your cash: ")
	_d.check(cash_after_refusal == cash_after_service,
		"the refused purchase leaves the buyer's cash unchanged (N%d)" % cash_after_refusal)
	_d.check(not _d.label_contains(main, "may or may not have been saved"),
		"the refusal is not reported as possibly saved")

	print("OBSERVED: buyer paid N%d for goods and N%d for '%s'; cash N%d → N%d" % [
		goods_price, service_price, service_name, cash_before, cash_after_refusal])
	_finish()


## Waits until the cash line shows the expected amount. The panel refreshes its cash line after the
## reply, a little later than the reply's own message, so one read can be stale.
func _wait_cash(expected: int) -> int:
	var value: int = -1
	for i in range(1500):
		value = _d.naira_after(main_node(), "Your cash: ")
		if value == expected:
			return value
		await process_frame
	return value


func main_node() -> Node:
	return _d.main


## The naira amount in a confirmation such as "Buy 1 × Beans (2 kg) for ₦4,000 from your own cash?".
func _amount_in(text: String) -> int:
	var at := text.find("₦")
	if at < 0:
		return 0
	var digits := ""
	for index in range(at + 1, text.length()):
		var character := text.substr(index, 1)
		if character == ",":
			continue
		if character >= "0" and character <= "9":
			digits += character
		elif digits != "":
			break
	return int(digits) if digits != "" else 0


func _read_state(path: String) -> Variant:
	if path.is_empty() or not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _finish() -> void:
	print("")
	var failed: int = _d.failures.size()
	if failed == 0:
		print("PASS: %d business buyer-phase UI checks (headless, simulated input)" % _d.checks)
		quit(0)
	else:
		print("FAIL: %d of %d business buyer-phase UI checks failed" % [failed, _d.checks])
		quit(1)
