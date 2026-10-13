extends RefCounted
# Stage 44: navigation and confirmation steps shared by the business UI phase tests (headless,
# simulated input). It builds on business_ui_driver.gd, which does the lookups and activations.
#
# Every step waits for the panel to show the result it is waiting for. Nothing is assumed from an
# earlier screen, because the panel re-renders after each reply.

var d: RefCounted = null


func _init(driver: RefCounted) -> void:
	d = driver


## Confirms the pending change if the panel asks for confirmation. Returns true if it did.
func confirm_pending() -> bool:
	var confirm = await d.wait_enabled_button("Confirm")
	if confirm == null:
		return false
	d.activate(confirm)
	return true


## Shows the Discover tab and refreshes its list. Returns true when the business is listed.
func discover(name: String) -> bool:
	var tab = await d.wait_enabled_button("Discover")
	if tab != null:
		d.activate(tab)
	var refresh = await d.wait_enabled_button("Refresh list")
	if refresh != null:
		d.activate(refresh)
	return await d.wait_card_button(name, "View") != null


## Opens a business from the owned list ("My businesses" is the default tab).
func open_owned(name: String) -> bool:
	var open = await d.wait_card_button(name, "Open")
	if open == null:
		return false
	d.activate(open)
	return await _wait_detail(name)


## Opens a business from the Discover list (call discover first).
func open_discovered(name: String) -> bool:
	var view = await d.wait_card_button(name, "View")
	if view == null:
		return false
	d.activate(view)
	return await _wait_detail(name)


## Leaves the detail view of the open business and waits for the list it returns to.
func close_detail(name: String) -> bool:
	var close = await d.wait_enabled_button("Close details")
	if close == null:
		return false
	d.activate(close)
	if await d.wait_card_button(name, "Open") != null:
		return true
	return await d.wait_card_button(name, "View") != null


func _wait_detail(name: String) -> bool:
	for i in range(1500):
		if d.card_button(d.main, name, "Close details") != null:
			return true
		await d.main.get_tree().process_frame
	return false
