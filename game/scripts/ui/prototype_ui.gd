class_name PrototypeUI
extends CanvasLayer

signal create_requested(profile: Dictionary)
signal online_requested(profile: Dictionary)
signal chat_requested(message: String)
signal continue_requested
signal interact_requested
signal panel_requested(panel_id: String)
signal save_requested
signal load_requested
signal answer_requested(answer_index: int, quiz_id: String)
signal purchase_requested(item_id: String)
signal consume_requested(item_id: String)
signal attend_requested
signal modal_changed(is_open: bool)

const SCHOOL_SERVICE = preload("res://scripts/domain/school_service.gd")
const SKIN_TONES: Array[Dictionary] = [
	{"label": "Warm brown", "hex": "#9b654d"},
	{"label": "Deep brown", "hex": "#70452f"},
	{"label": "Golden brown", "hex": "#b77d58"},
	{"label": "Light brown", "hex": "#d0a17d"},
]
const HAIR_STYLES: Array[String] = ["Short curls", "Braids", "Low cut"]
const SHIRT_COLORS: Array[Dictionary] = [
	{"label": "Green school shirt", "hex": "#27734a"},
	{"label": "White school shirt", "hex": "#e5e8d7"},
	{"label": "Blue casual shirt", "hex": "#3f7092"},
]

var _root: Control
var _modal_layer: Control
var _modal_open: bool = false
var _hud: Dictionary = {}
var _name_input: LineEdit
var _age_option: OptionButton
var _type_option: OptionButton
var _skin_option: OptionButton
var _hair_option: OptionButton
var _shirt_option: OptionButton
var _online_status_label: Label
var _chat_history: Array[String] = []
var _chat_input: LineEdit
var _showing_chat: bool = false
var _quiz_id: String = ""


func _ready() -> void:
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_root)


func show_character_creation(has_save: bool, has_online_session: bool = false) -> void:
	_clear_screen()
	_add_background(Color("#15251e"))
	var card := _create_center_card(Vector2(720.0, 650.0))
	_add_label(card, "NAIJA: ONE WORLD", 15, Color("#70c28a"), HORIZONTAL_ALIGNMENT_CENTER)
	_add_label(
		card,
		"You are beginning your life in Nigeria.",
		28,
		Color("#fff4d4"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	var creation_blurb := (
		"Create a secondary-school student and start at home in "
		+ "Idera Quarter, a fictional Nigerian neighbourhood."
	)
	_add_label(card, creation_blurb, 15, Color("#d1dccf"), HORIZONTAL_ALIGNMENT_CENTER)
	_name_input = LineEdit.new()
	_name_input.text = "Ayo"
	_name_input.placeholder_text = "Character name"
	_name_input.max_length = 32
	_add_form_row(card, "Name", _name_input)
	_age_option = _option(["15 years old", "16 years old"], 0)
	_add_form_row(card, "Starting age", _age_option)
	_type_option = _option(["Girl", "Boy", "Androgynous"], 2)
	_add_form_row(card, "Character type", _type_option)
	_skin_option = _option(_labels(SKIN_TONES), 0)
	_add_form_row(card, "Skin tone", _skin_option)
	_hair_option = _option(HAIR_STYLES, 0)
	_add_form_row(card, "Hairstyle", _hair_option)
	_shirt_option = _option(_labels(SHIRT_COLORS), 0)
	_add_form_row(card, "Clothing", _shirt_option)
	_add_label(
		card,
		(
			"All art is drawn for this prototype. Offline play needs no account; "
			+ "online play uses a prototype server."
		),
		13,
		Color("#aab9ab"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 14)
	card.add_child(actions)
	var start_button := _button("Begin your life", Vector2(200.0, 48.0))
	start_button.pressed.connect(_on_create_pressed)
	actions.add_child(start_button)
	if has_save:
		var continue_button := _button("Continue saved life", Vector2(210.0, 48.0))
		continue_button.pressed.connect(_on_continue_pressed)
		actions.add_child(continue_button)
	var online_actions := HBoxContainer.new()
	online_actions.alignment = BoxContainer.ALIGNMENT_CENTER
	online_actions.add_theme_constant_override("separation", 10)
	card.add_child(online_actions)
	var online_button_label := (
		"Continue online life" if has_online_session else "Create online life"
	)
	var online_button := _button(online_button_label, Vector2(260.0, 44.0))
	online_button.pressed.connect(_on_online_pressed)
	online_actions.add_child(online_button)
	_online_status_label = _add_label(
		card,
		"Online play is optional. Connect to your local Stage 2 server.",
		12,
		Color("#aab9ab"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	_hud.clear()


func show_game(character: CharacterState, clock: WorldClock, location_name: String) -> void:
	_clear_screen()
	_add_background(Color(0.0, 0.0, 0.0, 0.0))
	var panel := PanelContainer.new()
	panel.position = Vector2(16.0, 16.0)
	panel.custom_minimum_size = Vector2(308.0, 650.0)
	panel.size = panel.custom_minimum_size
	panel.add_theme_stylebox_override("panel", _panel_style(Color(0.93, 0.92, 0.84, 0.96)))
	_root.add_child(panel)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	panel.add_child(content)
	_add_label(content, "IDERA QUARTER", 13, Color("#377448"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["name"] = _add_label(content, "", 20, Color("#17231a"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["money"] = _add_label(content, "", 17, Color("#3a7046"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["time"] = _add_label(content, "", 15, Color("#425346"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["location"] = _add_label(content, "", 13, Color("#596558"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["location"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hud["connection"] = _add_label(
		content, "Offline · local prototype", 12, Color("#69766b"), HORIZONTAL_ALIGNMENT_LEFT
	)
	_add_need_bar(content, "Health", "health")
	_add_need_bar(content, "Energy", "energy")
	_add_need_bar(content, "Hunger", "hunger")
	var divider := HSeparator.new()
	content.add_child(divider)
	_hud["prompt"] = _add_label(
		content,
		"Walk near a person or object to interact.",
		13,
		Color("#304334"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	_hud["prompt"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var interact_button := _button("Interact  ·  E", Vector2(250.0, 42.0))
	interact_button.pressed.connect(func(): interact_requested.emit())
	content.add_child(interact_button)
	var menu_grid := GridContainer.new()
	menu_grid.columns = 2
	menu_grid.add_theme_constant_override("h_separation", 8)
	menu_grid.add_theme_constant_override("v_separation", 8)
	content.add_child(menu_grid)
	_add_menu_button(menu_grid, "Character", "profile")
	_add_menu_button(menu_grid, "Inventory", "inventory")
	_add_menu_button(menu_grid, "School", "school")
	_add_menu_button(menu_grid, "Nearby chat", "chat")
	_add_menu_button(menu_grid, "Save / Load", "save")
	_add_menu_button(menu_grid, "Settings", "settings")
	_hud["message"] = _add_label(content, "", 12, Color("#386546"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["message"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_add_label(
		content,
		"Move: WASD / arrows   Run: Shift\nInteract: E   Save often before you quit",
		11,
		Color("#6c786d"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	refresh_hud(character, clock, location_name, "")


func refresh_hud(
	character: CharacterState, clock: WorldClock, location_name: String, prompt: String
) -> void:
	if _hud.is_empty():
		return
	_hud["name"].text = "%s  ·  Age %d" % [character.name, character.age]
	_hud["money"].text = "Balance: ₦%s" % _format_number(character.money)
	_hud["time"].text = "Day %d  ·  %s  ·  %s" % [clock.day, clock.time_label(), clock.daypart()]
	_hud["location"].text = location_name
	_hud["health"].value = character.health
	_hud["energy"].value = character.energy
	_hud["hunger"].value = character.hunger
	_hud["prompt"].text = (
		prompt if not prompt.is_empty() else "Walk near a person or object to interact."
	)


func show_profile(character: CharacterState) -> void:
	var card := _open_modal("Your character", "A young life in a fictional Nigerian community")
	_add_modal_text(card, "Name: %s" % character.name)
	_add_modal_text(
		card,
		"Age: %d · Character type: %s" % [character.age, character.character_type.capitalize()]
	)
	_add_modal_text(card, "Education: %s" % character.education_level)
	_add_modal_text(card, "Home: %s" % character.home_id)
	_add_modal_text(
		card, "Household: %s" % str(character.household.get("home_type", "Family home"))
	)
	var guardians: Array = character.household.get("guardians", [])
	for guardian in guardians:
		if guardian is Dictionary:
			_add_modal_text(
				card,
				(
					"%s: %s"
					% [
						str(guardian.get("role", "Guardian")).capitalize(),
						str(guardian.get("name", "Family member"))
					]
				)
			)
	_add_modal_text(
		card, "Reputation: %d · Student at Idera Community Secondary School" % character.reputation
	)
	_add_modal_close(card)


func show_inventory(character: CharacterState, message: String = "") -> void:
	var card := _open_modal("School bag and belongings", message)
	if character.inventory.is_empty():
		_add_modal_text(card, "Your bag is empty.")
	for item in character.inventory:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		card.add_child(row)
		var description := _make_label(
			"%s  ×%d" % [str(item.get("name", "Item")), int(item.get("quantity", 0))],
			15,
			Color("#233229"),
			HORIZONTAL_ALIGNMENT_LEFT
		)
		description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(description)
		if int(item.get("hunger_restore", 0)) > 0:
			var eat_button := _button("Eat", Vector2(82.0, 34.0))
			eat_button.pressed.connect(_on_consume_pressed.bind(str(item.get("id", ""))))
			row.add_child(eat_button)
	_add_modal_close(card)


func show_timetable(character: CharacterState, clock: WorldClock, current_location: String) -> void:
	var card := _open_modal("School day", "Idera Community Secondary School · Prototype timetable")
	_add_modal_text(card, "Current time: Day %d · %s" % [clock.day, clock.time_label()])
	for lesson in SCHOOL_SERVICE.timetable():
		var subject := str(lesson["subject"])
		var status := ""
		if subject == "Break":
			status = "  ·  break"
		else:
			status = (
				"  ·  attended" if _attended(character, clock.day, subject) else "  ·  upcoming"
			)
		_add_modal_text(card, "%s  —  %s%s" % [str(lesson["time"]), subject, status])
	_add_modal_text(card, "Your current academic averages:")
	for subject in character.academic_scores.keys():
		_add_modal_text(
			card, "%s: %d / 100" % [str(subject), int(character.academic_scores[subject])]
		)
	if current_location == "classroom":
		var attend_button := _button("Attend next class activity", Vector2(280.0, 42.0))
		attend_button.pressed.connect(func(): attend_requested.emit())
		card.add_child(attend_button)
	else:
		_add_modal_text(
			card,
			"Walk to the school in the town, enter the yard, then enter the classroom to attend."
		)
	_add_modal_close(card)


func show_save_menu(has_save: bool) -> void:
	var card := _open_modal(
		"Local save", "Progress is stored on this device in Godot's user data folder."
	)
	var save_button := _button("Save progress now", Vector2(250.0, 42.0))
	save_button.pressed.connect(func(): save_requested.emit())
	card.add_child(save_button)
	if has_save:
		var load_button := _button("Load saved progress", Vector2(250.0, 42.0))
		load_button.pressed.connect(func(): load_requested.emit())
		card.add_child(load_button)
	_add_modal_text(
		card,
		"The clock pauses when the game is closed. This is a local prototype save, not an online account."
	)
	_add_modal_close(card)


func show_save_result(message: String, success: bool) -> void:
	var card := _open_modal("Progress saved" if success else "Save not completed", message)
	_add_modal_close(card)


func show_shop(balance: int, message: String = "") -> void:
	var card := _open_modal(
		"Neighbourhood shop",
		(
			message
			if not message.is_empty()
			else "A small selection for your school day · Balance ₦%s" % _format_number(balance)
		)
	)
	_add_shop_row(card, "meat_pie", "Meat pie", 350, "+24 hunger")
	_add_shop_row(card, "bottled_water", "Bottled water", 100, "+8 hunger")
	_add_modal_close(card)


func show_chat() -> void:
	var card := _open_modal(
		"Nearby player chat", "Messages are relayed by the server to nearby players."
	)
	_showing_chat = true
	if _chat_history.is_empty():
		_add_modal_text(card, "No recent messages. Walk near another player to chat with them.")
	else:
		for line in _chat_history:
			_add_modal_text(card, line)
	var input_row := HBoxContainer.new()
	input_row.add_theme_constant_override("separation", 8)
	card.add_child(input_row)
	_chat_input = LineEdit.new()
	_chat_input.placeholder_text = "Write a short message…"
	_chat_input.max_length = 200
	_chat_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_input.text_submitted.connect(_submit_chat_message)
	input_row.add_child(_chat_input)
	var send_button := _button("Send", Vector2(90.0, 36.0))
	send_button.pressed.connect(_submit_chat_message.bind(""))
	input_row.add_child(send_button)
	_add_modal_close(card)


func add_chat_message(sender: String, message: String) -> void:
	_chat_history.append("%s: %s" % [sender, message])
	if _chat_history.size() > 30:
		_chat_history.pop_front()


func _submit_chat_message(submitted_text: String = "") -> void:
	if not is_instance_valid(_chat_input):
		return
	var message_text := submitted_text if not submitted_text.is_empty() else _chat_input.text
	message_text = message_text.strip_edges()
	if message_text.is_empty():
		return
	chat_requested.emit(message_text)
	_chat_input.clear()


func show_dialogue(speaker: String, lines: Array[String]) -> void:
	var card := _open_modal(speaker, "Conversation")
	for line in lines:
		_add_modal_text(card, "“%s”" % line)
	_add_modal_close(card, "Close")


func show_quiz(subject: String, question: Dictionary, quiz_id: String = "") -> void:
	_quiz_id = quiz_id
	var card := _open_modal(
		"Class activity · %s" % subject,
		"Choose one answer. Your result will update your subject record."
	)
	_add_modal_text(
		card, str(question.get("question", "The teacher has not added a question yet."))
	)
	var options: Array = question.get("options", [])
	for index in range(options.size()):
		var answer_button := _button(str(options[index]), Vector2(400.0, 40.0))
		answer_button.pressed.connect(_on_answer_pressed.bind(index))
		card.add_child(answer_button)
	_add_modal_close(card, "Leave activity")


func show_quiz_result(subject: String, correct: bool, score: int) -> void:
	var result_text := (
		"Correct — nice work." if correct else "Not quite. Learning is part of the day."
	)
	var card := _open_modal("Class recorded · %s" % subject, result_text)
	_add_modal_text(card, "New academic average: %d / 100" % score)
	_add_modal_text(card, "Attendance and your result are saved with your character.")
	_add_modal_close(card, "Continue")


func show_notice(title: String, message: String) -> void:
	var card := _open_modal(title, message)
	_add_modal_close(card)


func show_shop_result(balance: int, message: String) -> void:
	show_shop(balance, "%s  ·  Balance ₦%s" % [message, _format_number(balance)])


func notify(message: String) -> void:
	if not _hud.is_empty() and is_instance_valid(_hud.get("message")):
		_hud["message"].text = message
	elif is_instance_valid(_online_status_label):
		_online_status_label.text = message


func set_online_status(status: String) -> void:
	if is_instance_valid(_online_status_label):
		_online_status_label.text = status
	if _hud.has("connection") and is_instance_valid(_hud["connection"]):
		_hud["connection"].text = status


func set_interaction_prompt(prompt: String) -> void:
	if _hud.has("prompt") and is_instance_valid(_hud["prompt"]):
		_hud["prompt"].text = prompt


func is_modal_open() -> bool:
	return _modal_open


func _on_create_pressed() -> void:
	var profile := _profile_from_form()
	if not profile.is_empty():
		create_requested.emit(profile)


func _on_online_pressed() -> void:
	var profile := _profile_from_form()
	if not profile.is_empty():
		online_requested.emit(profile)


func _profile_from_form() -> Dictionary:
	var character_name := _name_input.text.strip_edges()
	if character_name.is_empty():
		_name_input.grab_focus()
		return {}
	var skin_index := clampi(_skin_option.get_selected_id(), 0, SKIN_TONES.size() - 1)
	var shirt_index := clampi(_shirt_option.get_selected_id(), 0, SHIRT_COLORS.size() - 1)
	var hair_index := clampi(_hair_option.get_selected_id(), 0, HAIR_STYLES.size() - 1)
	var character_types: Array[String] = ["girl", "boy", "androgynous"]
	var character_type: String = character_types[clampi(_type_option.get_selected_id(), 0, 2)]
	return {
		"name": character_name,
		"age": 16 if _age_option.get_selected_id() == 1 else 15,
		"character_type": character_type,
		"appearance":
		{
			"skin_tone": SKIN_TONES[skin_index]["hex"],
			"skin_tone_name": SKIN_TONES[skin_index]["label"],
			"hairstyle": HAIR_STYLES[hair_index],
			"hair_color": "#2c211d",
			"clothing": SHIRT_COLORS[shirt_index]["label"],
			"clothing_color": SHIRT_COLORS[shirt_index]["hex"],
		}
	}


func _on_continue_pressed() -> void:
	continue_requested.emit()


func _on_answer_pressed(answer_index: int) -> void:
	answer_requested.emit(answer_index, _quiz_id)
	_quiz_id = ""


func _on_consume_pressed(item_id: String) -> void:
	consume_requested.emit(item_id)


func _add_menu_button(parent: GridContainer, label: String, panel_id: String) -> void:
	var button := _button(label, Vector2(124.0, 38.0))
	button.pressed.connect(_on_panel_pressed.bind(panel_id))
	parent.add_child(button)


func _on_panel_pressed(panel_id: String) -> void:
	panel_requested.emit(panel_id)


func _add_need_bar(parent: VBoxContainer, label: String, key: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var title := _make_label(label, 13, Color("#344337"), HORIZONTAL_ALIGNMENT_LEFT)
	title.custom_minimum_size = Vector2(62.0, 20.0)
	row.add_child(title)
	var bar := ProgressBar.new()
	bar.min_value = 0.0
	bar.max_value = 100.0
	bar.custom_minimum_size = Vector2(190.0, 18.0)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.show_percentage = false
	row.add_child(bar)
	_hud[key] = bar


func _add_form_row(parent: VBoxContainer, label: String, control: Control) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var title := _make_label(label, 14, Color("#24352a"), HORIZONTAL_ALIGNMENT_LEFT)
	title.custom_minimum_size = Vector2(150.0, 36.0)
	row.add_child(title)
	control.custom_minimum_size = Vector2(430.0, 38.0)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(control)
	parent.add_child(row)


func _option(labels: Array, selected_index: int) -> OptionButton:
	var result := OptionButton.new()
	for index in range(labels.size()):
		result.add_item(str(labels[index]), index)
	result.select(selected_index)
	return result


func _labels(entries: Array[Dictionary]) -> Array[String]:
	var result: Array[String] = []
	for entry in entries:
		result.append(str(entry["label"]))
	return result


func _button(label: String, minimum_size: Vector2 = Vector2(160.0, 38.0)) -> Button:
	var result := Button.new()
	result.text = label
	result.custom_minimum_size = minimum_size
	result.focus_mode = Control.FOCUS_ALL
	return result


func _add_background(color: Color) -> void:
	var background := ColorRect.new()
	background.color = color
	background.mouse_filter = (
		Control.MOUSE_FILTER_IGNORE if color.a == 0.0 else Control.MOUSE_FILTER_STOP
	)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(background)


func _create_center_card(minimum_size: Vector2) -> VBoxContainer:
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = minimum_size
	panel.add_theme_stylebox_override("panel", _panel_style(Color("#f0f0e4")))
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	return box


func _open_modal(title: String, subtitle: String) -> VBoxContainer:
	_close_modal()
	_modal_layer = Control.new()
	_modal_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(_modal_layer)
	var shade := ColorRect.new()
	shade.color = Color(0.02, 0.04, 0.03, 0.68)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal_layer.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal_layer.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(590.0, 430.0)
	panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	panel.add_theme_stylebox_override("panel", _panel_style(Color("#f2f0e4")))
	center.add_child(panel)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(540.0, 390.0)
	panel.add_child(scroll)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(content)
	_add_label(content, title, 21, Color("#1d3928"), HORIZONTAL_ALIGNMENT_LEFT)
	if not subtitle.is_empty():
		_add_label(content, subtitle, 13, Color("#617264"), HORIZONTAL_ALIGNMENT_LEFT)
	_modal_open = true
	modal_changed.emit(true)
	return content


func _add_modal_text(parent: VBoxContainer, text_value: String) -> Label:
	var label := _make_label(text_value, 14, Color("#27352b"), HORIZONTAL_ALIGNMENT_LEFT)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label


func _add_modal_close(parent: VBoxContainer, label: String = "Close") -> void:
	var button := _button(label, Vector2(170.0, 40.0))
	button.pressed.connect(_close_modal)
	parent.add_child(button)


func _add_shop_row(
	parent: VBoxContainer, item_id: String, label: String, price: int, effect: String
) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	parent.add_child(row)
	var description := _make_label(
		"%s  ·  ₦%d  ·  %s" % [label, price, effect],
		14,
		Color("#26372b"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(description)
	var buy_button := _button("Buy", Vector2(82.0, 34.0))
	buy_button.pressed.connect(_on_purchase_pressed.bind(item_id))
	row.add_child(buy_button)


func _on_purchase_pressed(item_id: String) -> void:
	purchase_requested.emit(item_id)


func _close_modal() -> void:
	if not _modal_open:
		return
	if is_instance_valid(_modal_layer):
		_modal_layer.queue_free()
	_modal_layer = null
	_modal_open = false
	_showing_chat = false
	modal_changed.emit(false)


func _clear_screen() -> void:
	if _modal_open:
		_close_modal()
	for child in _root.get_children():
		child.queue_free()
	_hud.clear()
	_online_status_label = null
	_chat_input = null
	_showing_chat = false
	_quiz_id = ""


func _add_label(parent: Node, text_value: String, size: int, color: Color, alignment: int) -> Label:
	var label := _make_label(text_value, size, color, alignment)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label


func _make_label(text_value: String, size: int, color: Color, alignment: int) -> Label:
	var label := Label.new()
	label.text = text_value
	label.horizontal_alignment = alignment
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label


func _panel_style(background: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = Color("#83937c")
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.corner_radius_top_left = 12
	style.corner_radius_top_right = 12
	style.corner_radius_bottom_left = 12
	style.corner_radius_bottom_right = 12
	style.content_margin_left = 22.0
	style.content_margin_top = 18.0
	style.content_margin_right = 22.0
	style.content_margin_bottom = 18.0
	return style


func _attended(character: CharacterState, day: int, subject: String) -> bool:
	for record in character.attendance:
		if int(record.get("day", 0)) == day and str(record.get("subject", "")) == subject:
			return true
	return false


func _format_number(value: int) -> String:
	var raw := str(maxi(0, value))
	var parts: Array[String] = []
	while raw.length() > 3:
		parts.push_front(raw.substr(raw.length() - 3, 3))
		raw = raw.substr(0, raw.length() - 3)
	parts.push_front(raw)
	var formatted := parts[0]
	for index in range(1, parts.size()):
		formatted += "," + parts[index]
	return formatted
