extends RefCounted
# Stage 44 shared driver for the business UI tests (headless, simulated input).
#
# It finds controls by their text and scopes each lookup to the card or row that owns it. The panel
# repeats labels: two forms have "Amount (₦)", and every owned business has an "Open" button.
# Buttons are activated the way the other headless tests do it: focus, then ui_accept press and
# release. Text fields are set through LineEdit.text and dropdowns through OptionButton.select.
# The popup is not driven.
#
# This is not a rendered test. The results it reads back are the labels the panel shows, which are
# set by the server's reply. Ledger and stock are checked afterwards from the server's world file.

const REPLY_WAIT_FRAMES := 1500
const SESSION_WAIT_FRAMES := 1800
## Real seconds between two activations. Stays under the server's 20-commands-per-10-seconds limit.
const PACE_SECONDS := 1.5

var checks: int = 0
var failures: Array[String] = []
var main: Node = null

var _tree: SceneTree = null


func _init(tree: SceneTree) -> void:
	_tree = tree


func check(condition: bool, label: String) -> void:
	checks += 1
	if not condition:
		failures.append(label)
		print("CHECK FAILED: %s" % label)


## Waits until the 2D session reports it is playing (the server accepted the saved session).
func wait_for_session(proto: Node) -> bool:
	var waited := 0
	while not proto.playing and waited < SESSION_WAIT_FRAMES:
		await _tree.process_frame
		waited += 1
	return proto.playing


func find_button(node: Node, text: String) -> Button:
	if node.is_queued_for_deletion():
		return null
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := find_button(child, text)
		if found != null:
			return found
	return null


## A button with this text under the card whose title label reads exactly title.
## The card is the nearest node with a direct child Label of that text, so a card's own
## buttons are found and the buttons of other cards are not.
func card_button(root: Node, title: String, text: String) -> Button:
	var card := _find_card(root, title)
	if card == null:
		return null
	return find_button(card, text)


func _find_card(node: Node, title: String) -> Node:
	if node.is_queued_for_deletion():
		return null
	for child in node.get_children():
		if child is Label and (child as Label).text.strip_edges() == title \
				and (child as Label).is_visible_in_tree():
			return node
	for child in node.get_children():
		var found := _find_card(child, title)
		if found != null:
			return found
	return null


## The LineEdit with this placeholder that sits in the same row (parent) as the button.
func field_beside(button: Button, placeholder: String) -> LineEdit:
	if button == null or button.get_parent() == null:
		return null
	for sibling in button.get_parent().get_children():
		if sibling is LineEdit and (sibling as LineEdit).placeholder_text == placeholder:
			return sibling
	return null


## The dropdowns in the same row as the button, in order.
func options_beside(button: Button) -> Array[OptionButton]:
	var found: Array[OptionButton] = []
	if button == null or button.get_parent() == null:
		return found
	for sibling in button.get_parent().get_children():
		if sibling is OptionButton:
			found.append(sibling)
	return found


func find_line_edit(node: Node, placeholder: String) -> LineEdit:
	if node.is_queued_for_deletion():
		return null
	if node is LineEdit and (node as LineEdit).placeholder_text == placeholder:
		return node
	for child in node.get_children():
		var found := find_line_edit(child, placeholder)
		if found != null:
			return found
	return null


## The first dropdown under node that offers an item containing the text.
func find_option(node: Node, contains: String) -> OptionButton:
	if node.is_queued_for_deletion():
		return null
	if node is OptionButton:
		var option := node as OptionButton
		for index in range(option.item_count):
			if option.get_item_text(index).contains(contains):
				return option
	for child in node.get_children():
		var found := find_option(child, contains)
		if found != null:
			return found
	return null


## Chooses the first item containing the text, and sends the signal the control sends on a choice.
func choose(option: OptionButton, contains: String) -> bool:
	if option == null:
		return false
	for index in range(option.item_count):
		if option.get_item_text(index).contains(contains):
			option.select(index)
			option.item_selected.emit(index)
			return true
	return false


func label_contains(node: Node, text: String) -> bool:
	return find_label_text(node, text) != ""


## The text of the first visible Label under node that contains the given text, or "".
func find_label_text(node: Node, text: String) -> String:
	if node.is_queued_for_deletion():
		return ""
	if node is Label and (node as Label).is_visible_in_tree() \
			and (node as Label).text.contains(text):
		return (node as Label).text
	for child in node.get_children():
		var found := find_label_text(child, text)
		if found != "":
			return found
	return ""


## Prints every visible label under node that contains the text, for diagnosis when a check fails.
func print_labels(node: Node, contains: String) -> void:
	if node.is_queued_for_deletion():
		return
	if node is Label and (node as Label).is_visible_in_tree() \
			and (node as Label).text.contains(contains):
		print("LABEL: %s" % (node as Label).text)
	for child in node.get_children():
		print_labels(child, contains)


## The whole naira amount that follows a label prefix, such as "Your cash: " or "Balance ".
## Returns -1 when the prefix is not shown. Thousands separators and the naira sign are removed.
func naira_after(node: Node, prefix: String) -> int:
	var text := find_label_text(node, prefix)
	if text == "":
		return -1
	var start := text.find(prefix) + prefix.length()
	var digits := ""
	for index in range(start, text.length()):
		var character := text.substr(index, 1)
		if character == "₦" or character == ",":
			continue
		if character >= "0" and character <= "9":
			digits += character
			continue
		if digits != "":
			break
	return int(digits) if digits != "" else -1


## Real GUI activation: focus the button, then send ui_accept press and release.
func activate(button: Button) -> void:
	button.grab_focus()
	var down := InputEventAction.new()
	down.action = "ui_accept"
	down.pressed = true
	_tree.root.push_input(down)
	var up := InputEventAction.new()
	up.action = "ui_accept"
	up.pressed = false
	_tree.root.push_input(up)


## A real-time pause before a control is looked up, so a connection stays under the server's
## command limit (20 commands per 10 seconds). The panel is rebuilt after each change, so the pause
## must come before the lookup. A button found before a pause can be freed before it is pressed.
func pace() -> void:
	await _tree.create_timer(PACE_SECONDS).timeout


## Waits until a button with this text, under the given card, exists and is enabled.
func wait_card_button(title: String, text: String) -> Button:
	await pace()
	for i in range(REPLY_WAIT_FRAMES):
		var button := card_button(main, title, text)
		if button != null and not button.disabled:
			return button
		await _tree.process_frame
	return null


## Waits until a visible button with this text exists and is enabled.
func wait_enabled_button(text: String) -> Button:
	await pace()
	return await wait_enabled_button_now(text)


## As wait_enabled_button, without the pause. Use it right after the fields are filled, because the
## panel re-renders during a pause and clears what was typed.
func wait_enabled_button_now(text: String) -> Button:
	for i in range(REPLY_WAIT_FRAMES):
		var button := find_button(main, text)
		if button != null and not button.disabled:
			return button
		await _tree.process_frame
	return null


## Waits until the text appears in a visible label.
func wait_label(text: String) -> bool:
	for i in range(REPLY_WAIT_FRAMES):
		if label_contains(main, text):
			return true
		await _tree.process_frame
	return false
