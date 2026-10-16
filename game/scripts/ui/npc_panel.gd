class_name NpcPanel
extends VBoxContainer

## People panel (Stage 42). It lists the NPCs the server says this character can see, shows one of
## them in detail, and sends social actions (greet, talk, become acquainted, argue, apologise) to
## the server as npc.action. The panel never sets a score: the server's reply (npc.result) carries
## the new state, and the panel shows only what the server returned. Read-only detail (npc.view)
## carries the bounded history. Offline there is no list, because the server is the only source of
## residents and their relationships.

signal npc_action_requested(action: String, npc_id: String, request_id: String)
signal npc_view_requested(npc_id: String)

const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const WARNING := Color("#8a3b2a")
const LIGHT_GREEN := Color("#e6eee2")

var _online := false
var _character_id := ""
var _tracker := ServerRequestTracker.new()
var _profiles: Array = []
var _selected_id := ""
var _history: Array = []
var _notice := ""
var _dialogue := ""
var _confirm: Dictionary = {}


## Sets the signed-in character and whether the shared world is connected. Offline, the panel
## explains that the list needs the connected world and shows no placeholder residents.
func configure(character_id: String, is_online: bool) -> void:
	_character_id = character_id
	_online = is_online
	_render()


## The UI layer owns the tracker, so a request keeps its state while the panel is closed.
func bind_tracker(tracker: ServerRequestTracker) -> void:
	_tracker = tracker
	_render()


## Stores the NPCs visible to this character (from a character snapshot, sent every minute). A
## selected NPC that is no longer visible is deselected, so the panel never shows a stale person.
func show_profiles(profiles: Array) -> void:
	_profiles = profiles.duplicate(true)
	var still_visible := not NPCSocialContract.profile_for(_profiles, _selected_id).is_empty()
	if not _selected_id.is_empty() and not still_visible:
		_selected_id = ""
		_history = []
		_dialogue = ""
		_notice = "They are no longer nearby."
	_render()


## Opens one NPC: the panel shows the stored summary at once and asks the server for the history.
func select(npc_id: String) -> void:
	_selected_id = npc_id
	_history = []
	_dialogue = ""
	_confirm = {}
	_notice = ""
	if _online:
		var message := NPCSocialContract.view_message(npc_id)
		if not message.is_empty():
			npc_view_requested.emit(npc_id)
	_render()


## Applies npc.result, npc.error or npc.view. The UI layer has already updated the tracker and
## passes answered = true when the reply answered the pending request.
func apply_server_response(message: Dictionary, answered: bool) -> void:
	var response_type := str(message.get("type", ""))
	if not NPCSocialContract.REPLY_TYPES.has(response_type):
		return
	var npc_id := str(message.get("npcId", ""))
	match response_type:
		"npc.view":
			if npc_id != _selected_id:
				return
			_store_profile(message.get("npc", {}))
			var history: Variant = message.get("history", [])
			_history = history.duplicate(true) if history is Array else []
		"npc.result":
			_store_profile(message.get("npc", {}))
			_notice = str(message.get("message", "Done."))
			_dialogue = str(message.get("dialogue", ""))
			var event: Variant = message.get("event", null)
			if answered and npc_id == _selected_id and not _selected_id.is_empty():
				npc_view_requested.emit(_selected_id)
			if event is Dictionary:
				_notice += " " + str(event.get("summary", ""))
		"npc.error":
			_notice = str(message.get("message", "The server refused this social request."))
			_dialogue = str(message.get("dialogue", ""))
			if str(message.get("action", "")) == "view" and npc_id == _selected_id:
				_history = []
	_render()


## Shows a notice from the UI layer, such as a lost connection, a timeout, or a request that could
## not be sent.
func show_notice_text(text_value: String) -> void:
	_notice = text_value
	_render()


func _store_profile(profile: Variant) -> void:
	if not profile is Dictionary:
		return
	var npc_id := str(profile.get("npc_id", ""))
	if npc_id.is_empty():
		return
	for index in _profiles.size():
		if _profiles[index] is Dictionary and str(_profiles[index].get("npc_id", "")) == npc_id:
			_profiles[index] = profile.duplicate(true)
			return


# --- Requests ---


## A changing request. Only one may be pending; the buttons that send one are disabled while it
## waits.
func _change(action: String, npc_id: String) -> void:
	if not _online:
		_notice = "Social actions need the connected shared world."
		_render()
		return
	var message := NPCSocialContract.action_message(action, npc_id)
	if message.is_empty():
		_notice = "That social action is not available. Nothing was changed."
		_render()
		return
	var request_id := _tracker.begin(action, {"npcId": npc_id})
	if request_id.is_empty():
		_notice = "Another social request is still waiting. Wait for the server to answer it first."
		_render()
		return
	_notice = "Sent. Waiting for the server to confirm…"
	_dialogue = ""
	_render()
	npc_action_requested.emit(action, npc_id, request_id)


func _retry_pending() -> void:
	var request_id := _tracker.retry()
	if request_id.is_empty():
		return
	_notice = "Retrying the same request. The server applies it at most once."
	_render()
	npc_action_requested.emit(
		_tracker.action(), str(_tracker.payload().get("npcId", "")), request_id
	)


func _discard_pending() -> void:
	_tracker.resolve()
	_notice = "Discarded. If the first attempt was saved, the relationship record shows it."
	_render()


# --- Rendering ---


func _render() -> void:
	for child in get_children():
		child.queue_free()
	if not _online:
		_add_text(
			(
				"People are shown in the connected shared world only. Residents and their relationships "
				+ "are kept by the server, so this screen shows no local placeholder."
			),
			13,
			TEXT_MUTED,
		)
		return
	if not _notice.is_empty():
		_add_text(_notice, 13, WARNING if _tracker.is_unconfirmed() else GREEN)
	if not _dialogue.is_empty():
		_add_text("“%s”" % _dialogue, 13, TEXT_DARK)
	_add_pending_box()
	if not _confirm.is_empty():
		_add_confirm_box()
	if _profiles.is_empty():
		_add_text(
			(
				"No one is nearby who can talk with you right now. People here at home or at the "
				+ "community hall appear when the server says they are."
			),
			12,
			TEXT_MUTED
		)
	else:
		for profile in _profiles:
			if profile is Dictionary:
				_add_profile_row(profile)
	if not _selected_id.is_empty():
		_add_detail()


func _add_pending_box() -> void:
	if not _tracker.has_pending():
		return
	if _tracker.is_waiting():
		_add_text(
			"A social request is waiting for the server. Other requests are paused until it is answered.",
			12,
			TEXT_MUTED,
		)
		return
	var row := HBoxContainer.new()
	add_child(row)
	var retry := _button("Retry the same request")
	retry.pressed.connect(_retry_pending)
	row.add_child(retry)
	var discard := _button("Discard")
	discard.pressed.connect(_discard_pending)
	row.add_child(discard)
	_add_text(
		(
			"Retrying sends the same request ID, so the server applies it at most once. Discarding does not "
			+ "undo a change that was already saved; the relationship record shows the current state."
		),
		11,
		TEXT_MUTED,
	)


func _add_confirm_box() -> void:
	var card := _card()
	_add_text(str(_confirm.get("label", "Confirm this action?")), 13, TEXT_DARK, card)
	var row := HBoxContainer.new()
	card.add_child(row)
	var yes := _button("Confirm")
	yes.disabled = _tracker.has_pending()
	yes.pressed.connect(_on_confirm_pressed)
	row.add_child(yes)
	var no := _button("Cancel")
	no.pressed.connect(_on_confirm_cancelled)
	row.add_child(no)


func _add_profile_row(profile: Dictionary) -> void:
	var card := _card()
	var npc_id := str(profile.get("npc_id", ""))
	var bond: Dictionary = profile.get("bond", {})
	_add_text(str(profile.get("name", "Neighbour")), 14, TEXT_DARK, card)
	_add_text(
		(
			"%s · %s · %s"
			% [
				str(profile.get("relation_label", "")),
				str(profile.get("activity_label", "")),
				str(profile.get("location_label", "")),
			]
		),
		11,
		TEXT_MUTED,
		card,
	)
	_add_text("Relationship: %s" % str(bond.get("tier_label", "")), 11, TEXT_DARK, card)
	var open := _button("Open" if npc_id != _selected_id else "Open (selected)")
	open.disabled = npc_id == _selected_id
	open.pressed.connect(select.bind(npc_id))
	card.add_child(open)


func _add_detail() -> void:
	var profile := NPCSocialContract.profile_for(_profiles, _selected_id)
	if profile.is_empty():
		return
	var bond: Dictionary = profile.get("bond", {})
	var card := _card()
	_add_text(str(profile.get("name", "Neighbour")), 15, TEXT_DARK, card)
	_add_text(
		(
			"Affinity %s · %s · %s"
			% [
				NPCSocialContract.signed(bond.get("affinity", 0)),
				str(bond.get("tier_label", "")),
				"Acquainted" if bool(bond.get("acquainted", false)) else "Not yet acquainted",
			]
		),
		12,
		TEXT_DARK,
		card,
	)
	_add_text(
		(
			"Greetings %d · Conversations %d%s"
			% [
				int(bond.get("greeting_count", 0)),
				int(bond.get("talk_count", 0)),
				" · They remember you" if bool(bond.get("recognised", false)) else "",
			]
		),
		11,
		TEXT_MUTED,
		card,
	)
	_add_text(
		(
			"Now: %s, %s"
			% [str(profile.get("activity_label", "")), str(profile.get("location_label", ""))]
		),
		11,
		TEXT_MUTED,
		card,
	)
	if bool(profile.get("asleep", false)):
		_add_text("They are asleep and cannot talk right now.", 11, WARNING, card)
	elif not bool(profile.get("here", false)):
		_add_text("They are not here right now.", 11, WARNING, card)
	var actions: Variant = profile.get("actions", [])
	if actions is Array:
		for row in actions:
			if row is Dictionary:
				_add_action_button(card, row)
	var close := _button("Close")
	close.pressed.connect(_on_close_pressed)
	card.add_child(close)
	_add_history(card)


func _add_action_button(card: VBoxContainer, row: Dictionary) -> void:
	var action := str(row.get("action", ""))
	if not NPCSocialContract.is_action(action):
		return
	var available := bool(row.get("available", false)) and _online and not _tracker.has_pending()
	var button := _button(str(row.get("label", action)))
	button.disabled = not available
	button.pressed.connect(_on_action_pressed.bind(action))
	card.add_child(button)
	if not bool(row.get("available", false)):
		var reason := str(row.get("reason_message", ""))
		if not reason.is_empty():
			_add_text(reason, 11, TEXT_MUTED, card)


func _add_history(card: VBoxContainer) -> void:
	_add_text("History", 12, TEXT_DARK, card)
	if _history.is_empty():
		_add_text("Nothing notable has happened between you yet.", 11, TEXT_MUTED, card)
		return
	for event in _history:
		if event is Dictionary:
			var minute := int(event.get("minute_of_day", 0))
			_add_text(
				(
					"Day %d, %02d:%02d · %s (affinity %s)"
					% [
						int(event.get("world_day", 0)),
						floori(float(minute) / 60.0),
						minute - floori(float(minute) / 60.0) * 60,
						str(event.get("summary", "")),
						NPCSocialContract.signed(event.get("affinity_after", 0)),
					]
				),
				11,
				TEXT_MUTED,
				card,
			)


func _on_action_pressed(action: String) -> void:
	var profile := NPCSocialContract.profile_for(_profiles, _selected_id)
	var row := NPCSocialContract.action_row(profile, action)
	var label := str(row.get("label", action))
	if NPCSocialContract.needs_confirmation(action):
		_confirm = {
			"action": action,
			"npcId": _selected_id,
			"label":
			(
				"%s with %s? This lowers how they feel about you, and the server records it."
				% [
					label,
					str(profile.get("name", "them")),
				]
			),
		}
		_render()
		return
	_change(action, _selected_id)


func _on_confirm_pressed() -> void:
	var pending := _confirm
	_confirm = {}
	_change(str(pending.get("action", "")), str(pending.get("npcId", "")))


func _on_confirm_cancelled() -> void:
	_confirm = {}
	_render()


func _on_close_pressed() -> void:
	_selected_id = ""
	_history = []
	_dialogue = ""
	_confirm = {}
	_render()


# --- Helpers ---


func _button(label: String) -> Button:
	var button := Button.new()
	button.text = label
	button.custom_minimum_size = Vector2(120.0, 34.0)
	return button


func _card() -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style := StyleBoxFlat.new()
	style.bg_color = LIGHT_GREEN
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.content_margin_left = 10.0
	style.content_margin_right = 10.0
	style.content_margin_top = 8.0
	style.content_margin_bottom = 8.0
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", style)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_child(box)
	add_child(panel)
	return box


func _add_text(text_value: String, size: int, color: Color, parent: Node = null) -> Label:
	var label := Label.new()
	label.text = text_value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var target: Node = self if parent == null else parent
	target.add_child(label)
	return label
