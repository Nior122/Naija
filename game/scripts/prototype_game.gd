extends Node2D

const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
const SchoolServiceScript = preload("res://scripts/domain/school_service.gd")
const DialogueLibraryScript = preload("res://scripts/domain/dialogue_library.gd")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const WorldMapScript = preload("res://scripts/world/world_map.gd")
const PlayerActorScript = preload("res://scripts/player/player_actor.gd")
const PrototypeUIScript = preload("res://scripts/ui/prototype_ui.gd")

const SECONDS_PER_GAME_MINUTE: float = 0.65
const CLINIC_VISIT_COST: int = 300
const BUS_FARE: int = 150

var character: CharacterState
var clock: WorldClock
var world: StarterWorld
var player: PlayerActor
var ui: PrototypeUI
var playing: bool = false
var _time_accumulator: float = 0.0
var _active_subject: String = ""
var _active_question: Dictionary = {}


func _ready() -> void:
	_setup_input_actions()
	world = WorldMapScript.new()
	world.name = "StarterWorld"
	add_child(world)
	player = PlayerActorScript.new()
	player.name = "Player"
	player.movement_enabled = false
	player.travelled.connect(_on_player_travelled)
	add_child(player)
	ui = PrototypeUIScript.new()
	ui.name = "PrototypeUI"
	ui.create_requested.connect(_start_new_game)
	ui.continue_requested.connect(_continue_game)
	ui.modal_changed.connect(_on_modal_changed)
	ui.interact_requested.connect(_interact_nearest)
	ui.panel_requested.connect(_open_panel)
	ui.save_requested.connect(_on_manual_save_requested)
	ui.load_requested.connect(_continue_game)
	ui.answer_requested.connect(_on_quiz_answer)
	ui.purchase_requested.connect(_purchase_item)
	ui.consume_requested.connect(_consume_item)
	ui.attend_requested.connect(_attend_next_class)
	add_child(ui)
	ui.show_character_creation(SaveServiceScript.has_save())


func _process(delta: float) -> void:
	if not playing:
		return
	if not ui.is_modal_open():
		_time_accumulator += delta
		while _time_accumulator >= SECONDS_PER_GAME_MINUTE:
			_time_accumulator -= SECONDS_PER_GAME_MINUTE
			clock.advance_minutes(1)
			character.advance_time(1)
			world.update_daypart(clock.daypart())
			if clock.minute_of_day % 15 == 0:
				_save_game(false)
	var nearest := world.nearest_interactable(player.position)
	world.set_focused_entity(nearest)
	_refresh_hud(nearest)


func _unhandled_input(event: InputEvent) -> void:
	if not playing or ui.is_modal_open():
		return
	if event.is_action_pressed("interact"):
		_interact_nearest()
		get_viewport().set_input_as_handled()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST and playing:
		_save_game(false)


func _start_new_game(profile: Dictionary) -> void:
	character = CharacterStateScript.new()
	var household: Dictionary = HouseholdFactoryScript.create_household()
	character.create_new(
		str(profile.get("name", "Ayo")),
		int(profile.get("age", 15)),
		str(profile.get("character_type", "androgynous")),
		profile.get("appearance", {}),
		household
	)
	clock = WorldClockScript.new()
	character.set_location("home", Vector2(720.0, 540.0))
	_begin_play_session()
	var welcome_message := (
		"You are 15–16, a secondary-school student, and home with your family. "
		+ "Step outside, explore Idera Quarter, and make your own start."
	)
	ui.show_notice("A new day begins", welcome_message)
	_save_game(false)


func _continue_game() -> void:
	var result: Dictionary = SaveServiceScript.load_state()
	if not bool(result.get("ok", false)):
		ui.show_notice(
			"Saved life unavailable",
			str(result.get("error", "The saved game could not be loaded."))
		)
		return
	character = CharacterStateScript.new()
	character.load_dictionary(result["character"])
	clock = WorldClockScript.new()
	clock.load_dictionary(result["clock"])
	if not WorldMapScript.is_valid_location(character.current_location):
		character.set_location("home", Vector2(720.0, 540.0))
	_begin_play_session()
	ui.notify("Welcome back, %s. Your local progress was loaded." % character.name)


func _begin_play_session() -> void:
	playing = true
	_time_accumulator = 0.0
	world.enter_location(character.current_location, character.household)
	world.update_daypart(clock.daypart())
	player.position = character.position.clamp(
		Vector2(28.0, 28.0), PlayerActorScript.MAP_SIZE - Vector2(28.0, 28.0)
	)
	player.set_appearance(character.appearance)
	player.movement_enabled = true
	player.snap_camera()
	ui.show_game(character, clock, WorldMapScript.location_name(character.current_location))


func _setup_input_actions() -> void:
	_bind_action("move_up", [KEY_W, KEY_UP])
	_bind_action("move_down", [KEY_S, KEY_DOWN])
	_bind_action("move_left", [KEY_A, KEY_LEFT])
	_bind_action("move_right", [KEY_D, KEY_RIGHT])
	_bind_action("run", [KEY_SHIFT])
	_bind_action("interact", [KEY_E])


func _bind_action(action_name: String, key_codes: Array) -> void:
	if not InputMap.has_action(action_name):
		InputMap.add_action(action_name)
	if not InputMap.action_get_events(action_name).is_empty():
		return
	for key_code in key_codes:
		var event := InputEventKey.new()
		event.keycode = int(key_code)
		InputMap.action_add_event(action_name, event)


func _on_modal_changed(is_open: bool) -> void:
	if is_instance_valid(player):
		player.movement_enabled = playing and not is_open


func _on_player_travelled(distance: float, running: bool) -> void:
	if not playing or character == null:
		return
	character.spend_energy(distance * (0.0030 if running else 0.0017))
	character.position = player.position


func _refresh_hud(nearest: WorldEntity = null) -> void:
	if not playing or not is_instance_valid(ui):
		return
	var prompt := ""
	if is_instance_valid(nearest):
		prompt = "%s  ·  E" % nearest.prompt
	ui.refresh_hud(
		character, clock, WorldMapScript.location_name(character.current_location), prompt
	)


func _interact_nearest() -> void:
	if not playing or ui.is_modal_open():
		return
	var entity := world.nearest_interactable(player.position)
	if not is_instance_valid(entity):
		ui.notify("Move closer to a person, door, or object.")
		return
	_interact_with(entity)


func _interact_with(entity: WorldEntity) -> void:
	match entity.action_id:
		"travel":
			var destination := str(entity.data.get("location", "town"))
			var spawn_value: Variant = entity.data.get("spawn", Vector2(720.0, 540.0))
			var spawn_position: Vector2 = (
				spawn_value if spawn_value is Vector2 else Vector2(720.0, 540.0)
			)
			_change_location(destination, spawn_position)
		"talk":
			var role := str(entity.data.get("dialogue_key", entity.dialogue_key))
			ui.show_dialogue(
				entity.display_name, DialogueLibraryScript.lines_for(role, character.name)
			)
		"sleep":
			_sleep()
		"inventory":
			ui.show_inventory(character)
		"shop":
			ui.show_shop(character.money)
		"timetable":
			ui.show_timetable(character, clock, character.current_location)
		"attend_class":
			_attend_next_class()
		"bus_to_school":
			_take_bus_to_school()
		"clinic_care":
			_visit_clinic()
		"community_info":
			ui.show_dialogue(
				"Community notice", DialogueLibraryScript.lines_for("community", character.name)
			)
		_:
			ui.show_notice("Nothing to do yet", "This prototype object has no action assigned.")


func _change_location(destination: String, spawn_position: Vector2) -> void:
	if not WorldMapScript.is_valid_location(destination):
		ui.show_notice("Unknown location", "That prototype location is not available yet.")
		return
	character.set_location(destination, spawn_position)
	world.enter_location(destination, character.household)
	player.position = spawn_position.clamp(
		Vector2(28.0, 28.0), PlayerActorScript.MAP_SIZE - Vector2(28.0, 28.0)
	)
	player.velocity = Vector2.ZERO
	player.snap_camera()
	_save_game(false)
	_refresh_hud()
	ui.notify("Arrived at %s." % WorldMapScript.location_name(destination))


func _sleep() -> void:
	if character.current_location != "home":
		ui.show_notice("Rest at home", "You can sleep in your own bedroom at home.")
		return
	var sleep_minutes := clock.minutes_until_morning()
	clock.advance_minutes(sleep_minutes)
	character.advance_time(sleep_minutes)
	character.sleep_until_morning()
	character.position = Vector2(720.0, 540.0)
	player.position = character.position
	player.snap_camera()
	_save_game(false)
	_refresh_hud()
	ui.show_notice(
		"Good morning", "You rested at home. It is %s on Day %d." % [clock.time_label(), clock.day]
	)


func _take_bus_to_school() -> void:
	if not character.try_spend(BUS_FARE):
		ui.show_notice(
			"Not enough money", "The bus fare is ₦%d. You can walk to school for free." % BUS_FARE
		)
		return
	_change_location("schoolyard", Vector2(240.0, 650.0))
	ui.notify("You paid ₦%d and arrived at school." % BUS_FARE)


func _visit_clinic() -> void:
	if character.health >= 99.0:
		ui.show_notice(
			"Community clinic",
			"You are feeling well. The nurse recommends rest, water, and a good meal."
		)
		return
	if not character.try_spend(CLINIC_VISIT_COST):
		ui.show_notice(
			"Community clinic",
			(
				"Basic care costs ₦%d. The nurse suggests speaking with a trusted adult."
				% CLINIC_VISIT_COST
			)
		)
		return
	character.health = minf(100.0, character.health + 35.0)
	character.touch()
	_save_game(false)
	_refresh_hud()
	ui.show_notice(
		"Care received", "The nurse helped you feel better. You paid ₦%d." % CLINIC_VISIT_COST
	)


func _attend_next_class() -> void:
	if character.current_location != "classroom":
		ui.show_notice(
			"Head to class",
			"Walk or take the bus to the school, enter the yard, then enter your classroom."
		)
		return
	var lesson := SchoolServiceScript.next_lesson(character, clock.day, clock.minute_of_day)
	if lesson.is_empty():
		var completion_message := (
			"You have attended every available class today. "
			+ "Check your academic record or explore Idera Quarter."
		)
		ui.show_notice("School day complete", completion_message)
		return
	var start_minute := int(lesson["minute"])
	if clock.minute_of_day < start_minute:
		var wait_minutes := start_minute - clock.minute_of_day
		clock.advance_minutes(wait_minutes)
		character.advance_time(wait_minutes)
		_refresh_hud()
	_active_subject = str(lesson["subject"])
	_active_question = SchoolServiceScript.question_for(_active_subject)
	ui.show_quiz(_active_subject, _active_question)


func _on_quiz_answer(answer_index: int) -> void:
	if _active_subject.is_empty() or _active_question.is_empty():
		return
	var correct := answer_index == int(_active_question.get("correct_index", -1))
	var subject := _active_subject
	var score := SchoolServiceScript.record_result(
		character, clock.day, subject, correct, clock.time_label()
	)
	clock.advance_minutes(20)
	character.advance_time(20)
	_active_subject = ""
	_active_question.clear()
	_save_game(false)
	_refresh_hud()
	ui.show_quiz_result(subject, correct, score)


func _purchase_item(item_id: String) -> void:
	var price := 0
	var item_name := ""
	var restore := 0
	match item_id:
		"meat_pie":
			price = 350
			item_name = "Meat pie"
			restore = 24
		"bottled_water":
			price = 100
			item_name = "Bottled water"
			restore = 8
		_:
			ui.show_shop_result(character.money, "That item is not available.")
			return
	if not character.try_spend(price):
		ui.show_shop_result(character.money, "You need ₦%d, but do not have enough yet." % price)
		return
	character.add_item(item_id, item_name, 1, "food", restore)
	_save_game(false)
	_refresh_hud()
	ui.show_shop_result(character.money, "Added %s to your bag." % item_name)


func _consume_item(item_id: String) -> void:
	if not character.consume_item(item_id):
		ui.show_inventory(character, "That item cannot be eaten or is no longer in your bag.")
		return
	_save_game(false)
	_refresh_hud()
	ui.show_inventory(
		character, "You had a snack. Hunger is now %d%%." % int(round(character.hunger))
	)


func _open_panel(panel_id: String) -> void:
	match panel_id:
		"profile":
			ui.show_profile(character)
		"inventory":
			ui.show_inventory(character)
		"school":
			ui.show_timetable(character, clock, character.current_location)
		"save":
			ui.show_save_menu(SaveServiceScript.has_save())
		"settings":
			var settings_message := (
				"Move with WASD or the arrow keys, hold Shift to run, and press E or Interact. "
				+ "The clock pauses while a menu is open. Graphics/audio settings are not included."
			)
			ui.show_notice("Prototype settings", settings_message)
		_:
			ui.show_notice("Prototype menu", "This menu is reserved for a later development stage.")


func _on_manual_save_requested() -> void:
	_save_game(true)


func _save_game(show_result: bool = true) -> void:
	if not playing or character == null or clock == null:
		return
	character.position = player.position
	character.current_location = world.location_id
	character.touch()
	var result: Dictionary = SaveServiceScript.save_state(character, clock)
	var save_ok := bool(result.get("ok", false))
	if show_result:
		var save_message := (
			"Your character, needs, school progress, inventory, money, location, "
			+ "and world time were saved locally."
		)
		if not save_ok:
			save_message = (
				"The save could not be completed: %s" % str(result.get("error", "unknown error"))
			)
		ui.show_save_result(save_message, save_ok)
	elif not save_ok:
		ui.notify("Autosave failed: %s" % str(result.get("error", "unknown error")))
