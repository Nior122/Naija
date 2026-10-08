extends Node2D

const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const GeographyModelScript = preload("res://scripts/domain/geography_model.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
const SchoolServiceScript = preload("res://scripts/domain/school_service.gd")
const EducationServiceScript = preload("res://scripts/domain/education_service.gd")
const DialogueLibraryScript = preload("res://scripts/domain/dialogue_library.gd")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const WorldMapScript = preload("res://scripts/world/world_map.gd")
const PlayerActorScript = preload("res://scripts/player/player_actor.gd")
const PrototypeUIScript = preload("res://scripts/ui/prototype_ui.gd")
const MultiplayerClientScript = preload("res://scripts/services/multiplayer_client.gd")
const RemotePlayerScript = preload("res://scripts/player/remote_player.gd")

const SECONDS_PER_GAME_MINUTE: float = 0.65
const CLINIC_VISIT_COST: int = 300
const BUS_FARE: int = 150

var character: CharacterState
var clock: WorldClock
var world: StarterWorld
var player: PlayerActor
var ui: PrototypeUI
var playing: bool = false
var multiplayer_client: Node
var _online_mode: bool = false
var _online_input_accumulator: float = 0.0
var _remote_players: Dictionary = {}
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
	multiplayer_client = MultiplayerClientScript.new()
	multiplayer_client.name = "MultiplayerClient"
	multiplayer_client.session_ready.connect(_on_online_session_ready)
	multiplayer_client.message_received.connect(_on_online_message)
	multiplayer_client.status_changed.connect(_on_online_status_changed)
	multiplayer_client.error_received.connect(_on_online_error)
	add_child(multiplayer_client)
	ui = PrototypeUIScript.new()
	ui.name = "PrototypeUI"
	ui.create_requested.connect(_start_new_game)
	ui.online_requested.connect(_start_online_game)
	ui.chat_requested.connect(_send_chat_message)
	ui.continue_requested.connect(_continue_game)
	ui.modal_changed.connect(_on_modal_changed)
	ui.interact_requested.connect(_interact_nearest)
	ui.panel_requested.connect(_open_panel)
	ui.save_requested.connect(_on_manual_save_requested)
	ui.load_requested.connect(_continue_game)
	ui.education_action_requested.connect(_on_education_action_requested)
	ui.answer_requested.connect(_on_quiz_answer)
	ui.purchase_requested.connect(_purchase_item)
	ui.consume_requested.connect(_consume_item)
	ui.attend_requested.connect(_attend_next_class)
	add_child(ui)
	ui.show_character_creation(SaveServiceScript.has_save(), multiplayer_client.has_saved_session())


func _process(delta: float) -> void:
	if not playing:
		return
	if _online_mode:
		_online_input_accumulator += delta
		if _online_input_accumulator >= 0.05:
			_online_input_accumulator = 0.0
			var direction := Vector2.ZERO
			if not ui.is_modal_open():
				direction = Input.get_vector("move_left", "move_right", "move_up", "move_down")
			multiplayer_client.send_movement(
				direction, Input.is_action_pressed("run") and direction.length_squared() > 0.0
			)
		var online_nearest := world.nearest_interactable(player.position)
		world.set_focused_entity(online_nearest)
		var remote_nearest := _nearest_remote_player()
		if (
			is_instance_valid(remote_nearest)
			and player.position.distance_to(remote_nearest.position) < 82.0
		):
			_refresh_hud(null)
			ui.set_interaction_prompt("Wave to %s  ·  E" % remote_nearest.character_name)
		else:
			_refresh_hud(online_nearest)
		return
	if not ui.is_modal_open():
		_time_accumulator += delta
		while _time_accumulator >= SECONDS_PER_GAME_MINUTE:
			_time_accumulator -= SECONDS_PER_GAME_MINUTE
			clock.advance_minutes(1)
			character.advance_time(1)
			var missed_periods := EducationServiceScript.mark_missed_periods(
				character.education_record, clock.day, clock.minute_of_day
			)
			if missed_periods > 0:
				EducationServiceScript.sync_legacy_character(character)
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
	if what == NOTIFICATION_WM_CLOSE_REQUEST and playing and not _online_mode:
		_save_game(false)


func _start_new_game(profile: Dictionary) -> void:
	multiplayer_client.disconnect_from_world()
	_online_mode = false
	player.server_controlled = false
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


func _start_online_game(profile: Dictionary) -> void:
	_online_mode = true
	playing = false
	_online_input_accumulator = 0.0
	player.movement_enabled = false
	ui.set_online_status("Connecting to the shared prototype…")
	multiplayer_client.connect_to_world(profile)


func _on_online_session_ready(
	character_data: Dictionary, world_data: Dictionary, players_data: Array
) -> void:
	character = CharacterStateScript.new()
	character.load_dictionary(character_data)
	clock = WorldClockScript.new()
	var raw_clock: Variant = world_data.get("clock", {})
	if raw_clock is Dictionary:
		clock.load_dictionary(raw_clock)
	playing = true
	_time_accumulator = 0.0
	_online_input_accumulator = 0.0
	world.enter_location(character.current_location, character.household)
	_restore_geographic_preview_if_present()
	world.update_daypart(clock.daypart())
	player.server_controlled = true
	player.set_authoritative_position(character.position)
	player.position = player.server_target_position
	player.set_appearance(character.appearance)
	player.movement_enabled = false
	player.snap_camera()
	ui.show_game(character, clock, WorldMapScript.location_name(character.current_location))
	ui.set_online_status("Online · nigeria-main")
	_sync_remote_players(players_data)
	ui.notify("Connected to the one shared prototype world. Server state is authoritative.")


func _on_online_message(message: Dictionary) -> void:
	var message_type := str(message.get("type", ""))
	match message_type:
		"character.snapshot":
			var character_data: Variant = message.get("character", {})
			if character_data is Dictionary:
				_apply_online_character_snapshot(character_data)
		"world.snapshot":
			var clock_data: Variant = message.get("clock", {})
			if clock_data is Dictionary and clock != null:
				clock.load_dictionary(clock_data)
				world.update_daypart(clock.daypart())
			var players_data: Variant = message.get("players", [])
			if players_data is Array:
				_sync_remote_players(players_data)
			_refresh_hud()
		"presence.joined", "presence.moved":
			var presence: Variant = message.get("player", {})
			if presence is Dictionary:
				_upsert_remote_player(presence)
		"presence.left":
			var presence: Variant = message.get("player", {})
			if presence is Dictionary:
				_remove_remote_player(str(presence.get("playerId", "")))
		"chat.message":
			var sender := str(message.get("characterName", "Another student"))
			var chat_text := str(message.get("text", ""))
			ui.add_chat_message(sender, chat_text)
			ui.notify("%s: %s" % [sender, chat_text])
		"player.interaction":
			ui.notify(
				(
					"%s waved to %s."
					% [
						str(message.get("characterName", "A student")),
						str(message.get("targetCharacterName", "another student"))
					]
				)
			)
		"school.quiz":
			ui.show_quiz(
				str(message.get("subject", "Class activity")),
				message,
				str(message.get("quizId", "")),
				str(message.get("mode", "school"))
			)
		"school.result":
			ui.show_quiz_result(
				str(message.get("subject", "Class")),
				bool(message.get("correct", false)),
				int(message.get("score", 0)),
				str(message.get("mode", "school")),
				message.get("certificate_eligible", null)
			)
		"education.result", "education.error":
			ui.show_education_result(message)
		"school.complete":
			(
				ui
				. show_notice(
					"School day complete",
					"There is no class or registered exam session available at this time. Check your timetable."
				)
			)
		"command.duplicate":
			ui.notify("That action was already processed by the server.")


func _on_online_status_changed(status: String) -> void:
	ui.set_online_status(status.capitalize())
	if playing and status == "reconnecting":
		ui.notify("Connection lost. Reconnecting to the shared world…")


func _on_online_error(code: String, description: String) -> void:
	if code.begins_with("geography_") and world.geography_preview_enabled:
		world.set_geographic_preview(false)
	if playing:
		ui.notify("%s: %s" % [code.replace("_", " ").capitalize(), description])
	else:
		ui.set_online_status("%s: %s" % [code.replace("_", " ").capitalize(), description])


func _apply_online_character_snapshot(character_data: Dictionary) -> void:
	if character == null or not _online_mode:
		return
	var old_location := character.current_location
	character.load_dictionary(character_data)
	if not WorldMapScript.is_valid_location(character.current_location):
		character.set_location("home", Vector2(720.0, 540.0))
	if old_location != character.current_location:
		world.enter_location(character.current_location, character.household)
		_restore_geographic_preview_if_present()
		_remove_remote_players()
	player.set_authoritative_position(character.position)
	player.set_appearance(character.appearance)
	player.movement_enabled = false
	_refresh_hud()


func _sync_remote_players(players_data: Array) -> void:
	var present: Dictionary = {}
	for entry in players_data:
		if not entry is Dictionary:
			continue
		var player_id := str(entry.get("playerId", ""))
		if player_id.is_empty():
			continue
		if player_id == character.player_id:
			var own_position: Variant = entry.get("position", {})
			if own_position is Dictionary:
				var server_position := Vector2(
					float(own_position.get("x", player.position.x)),
					float(own_position.get("y", player.position.y))
				)
				character.position = server_position
				player.set_authoritative_position(server_position)
			continue
		if str(entry.get("worldLocation", "")) != character.current_location:
			continue
		if not _is_geographically_interested(entry):
			continue
		present[player_id] = true
		_upsert_remote_player(entry)
	for player_id in _remote_players.keys():
		if not present.has(player_id):
			_remove_remote_player(str(player_id))


func _upsert_remote_player(presence: Dictionary) -> void:
	var player_id := str(presence.get("playerId", ""))
	if (
		player_id.is_empty()
		or character == null
		or player_id == character.player_id
		or str(presence.get("worldLocation", "")) != character.current_location
		or not _is_geographically_interested(presence)
	):
		return
	var remote: Variant = _remote_players.get(player_id)
	if not is_instance_valid(remote):
		remote = RemotePlayerScript.new()
		remote.name = "Remote_%s" % player_id
		var raw_position: Variant = presence.get("position", {})
		if raw_position is Dictionary:
			remote.position = Vector2(
				float(raw_position.get("x", 720.0)), float(raw_position.get("y", 540.0))
			)
		remote.target_position = remote.position
		world.add_child(remote)
		_remote_players[player_id] = remote
	remote.set_presence(presence)


func _is_geographically_interested(presence: Dictionary) -> bool:
	if character == null:
		return false
	var own_location: Dictionary = character.geographic_location
	var raw_location: Variant = presence.get("geographicLocation", null)
	var other_location: Dictionary = raw_location if raw_location is Dictionary else {}
	if own_location.is_empty() and other_location.is_empty():
		return true
	if own_location.is_empty() or other_location.is_empty():
		return false
	if str(own_location.get("region_id", "")) != str(other_location.get("region_id", "")):
		return false
	var own_chunk := str(own_location.get("chunk_id", ""))
	var other_chunk := str(other_location.get("chunk_id", ""))
	if not GeographyModelScript.chunks_are_within_radius(own_chunk, other_chunk, 1):
		return false
	return (
		GeographyModelScript.geographic_distance_meters(
			float(own_location.get("latitude", 0.0)),
			float(own_location.get("longitude", 0.0)),
			float(other_location.get("latitude", 0.0)),
			float(other_location.get("longitude", 0.0))
		)
		<= 1500.0
	)


func _remove_remote_player(player_id: String) -> void:
	if not _remote_players.has(player_id):
		return
	var remote: Variant = _remote_players[player_id]
	if is_instance_valid(remote):
		remote.queue_free()
	_remote_players.erase(player_id)


func _remove_remote_players() -> void:
	for player_id in _remote_players.keys():
		_remove_remote_player(str(player_id))


func _nearest_remote_player() -> Variant:
	var nearest: Variant = null
	var best_distance := INF
	for remote in _remote_players.values():
		if not is_instance_valid(remote):
			continue
		var distance_to_player: float = player.position.distance_to(remote.position)
		if distance_to_player < best_distance:
			best_distance = distance_to_player
			nearest = remote
	return nearest


func _send_chat_message(message_text: String) -> void:
	if not _online_mode or not multiplayer_client.is_world_connected():
		ui.notify("Connect to the shared world before chatting.")
		return
	if message_text.strip_edges().is_empty():
		return
	multiplayer_client.send_command("chat.send", {"text": message_text})


func _continue_game() -> void:
	multiplayer_client.disconnect_from_world()
	_online_mode = false
	player.server_controlled = false
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
	_online_mode = false
	player.server_controlled = false
	_time_accumulator = 0.0
	world.enter_location(character.current_location, character.household)
	_restore_geographic_preview_if_present()
	world.update_daypart(clock.daypart())
	player.position = character.position.clamp(
		Vector2(28.0, 28.0), PlayerActorScript.MAP_SIZE - Vector2(28.0, 28.0)
	)
	player.set_appearance(character.appearance)
	player.movement_enabled = true
	player.snap_camera()
	ui.show_game(character, clock, WorldMapScript.location_name(character.current_location))


func _restore_geographic_preview_if_present() -> void:
	if (
		character.current_location == "town"
		and (
			str(character.geographic_location.get("region_id", ""))
			== "ng:region:ondo:akure-south-core"
		)
	):
		world.set_geographic_preview(true)


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
	if world.geography_preview_enabled:
		var geographic_location := world.geographic_location_for_position(player.position)
		if not geographic_location.is_empty():
			character.set_geographic_location(geographic_location)


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
	if _online_mode:
		var remote_nearest: Variant = _nearest_remote_player()
		if (
			is_instance_valid(remote_nearest)
			and player.position.distance_to(remote_nearest.position) <= 82.0
		):
			if not multiplayer_client.send_command(
				"player.interact", {"action": "wave", "targetPlayerId": remote_nearest.player_id}
			):
				ui.notify("The server connection is not ready for interaction.")
			return
	var entity := world.nearest_interactable(player.position)
	if not is_instance_valid(entity):
		ui.notify("Move closer to a person, door, or object.")
		return
	_interact_with(entity)


func _interact_with(entity: WorldEntity) -> void:
	match entity.action_id:
		"travel":
			if _online_mode:
				if not multiplayer_client.send_command(
					"world.travel", {"exitId": entity.entity_id}
				):
					ui.notify("Waiting for the multiplayer server connection.")
				return
			var destination := str(entity.data.get("location", "town"))
			if not _can_enter_education_location(destination):
				return
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
		"begin_course":
			_on_education_action_requested("begin_course", {})
		"education_panel":
			ui.show_education(character, clock, character.current_location, _online_mode)
		"education_activity":
			_on_education_action_requested("attend_activity", entity.data)
		"practice_training":
			_on_education_action_requested("practice_training", {})
		"bus_to_school":
			_take_bus_to_school()
		"clinic_care":
			_visit_clinic()
		"community_info":
			ui.show_dialogue(
				"Community notice", DialogueLibraryScript.lines_for("community", character.name)
			)
		"inspect_geographic_feature":
			var feature_name := str(entity.data.get("name", entity.display_name))
			var feature_kind := str(entity.data.get("kind", "geographic feature")).replace("_", " ")
			var feature_source := str(
				entity.data.get("attribution", "© OpenStreetMap contributors · ODbL 1.0")
			)
			var feature_details := (
				"%s · OpenStreetMap feature ID %s. %s"
				% [feature_kind.capitalize(), str(entity.data.get("osm_id", "")), feature_source]
			)
			ui.show_notice(feature_name, feature_details)
		_:
			ui.show_notice("Nothing to do yet", "This prototype object has no action assigned.")


func _change_location(destination: String, spawn_position: Vector2) -> void:
	if not WorldMapScript.is_valid_location(destination):
		ui.show_notice("Unknown location", "That prototype location is not available yet.")
		return
	if destination != "town":
		character.set_geographic_location({})
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
	if _online_mode:
		if not multiplayer_client.send_command("character.rest"):
			ui.notify("Waiting for the multiplayer server connection.")
		return
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
	if _online_mode:
		if not multiplayer_client.send_command("world.bus"):
			ui.notify("Waiting for the multiplayer server connection.")
		return
	if not character.try_spend(BUS_FARE):
		ui.show_notice(
			"Not enough money", "The bus fare is ₦%d. You can walk to school for free." % BUS_FARE
		)
		return
	_change_location("schoolyard", Vector2(240.0, 650.0))
	ui.notify("You paid ₦%d and arrived at school." % BUS_FARE)


func _visit_clinic() -> void:
	if _online_mode:
		if not multiplayer_client.send_command("clinic.care"):
			ui.notify("Waiting for the multiplayer server connection.")
		return
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
	if _online_mode:
		if not multiplayer_client.send_command("school.begin"):
			ui.notify("Waiting for the multiplayer server connection.")
		return
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
	EducationServiceScript.record_attendance(
		character.education_record, lesson, clock.day, clock.minute_of_day
	)
	EducationServiceScript.sync_legacy_character(character)
	_save_game(false)
	_active_subject = str(lesson.get("subject", "Class activity"))
	_active_question = SchoolServiceScript.question_for(
		str(lesson.get("subject_id", _active_subject))
	)
	_active_question["mode"] = "school"
	ui.show_quiz(_active_subject, _active_question, "offline-school-quiz", "school")


func _on_quiz_answer(answer_index: int, quiz_id: String = "") -> void:
	if _online_mode:
		if (
			quiz_id.is_empty()
			or not multiplayer_client.send_command(
				"school.answer", {"quizId": quiz_id, "answerIndex": answer_index}
			)
		):
			ui.notify("The education response could not be sent to the server.")
		return
	if _active_subject.is_empty() or _active_question.is_empty():
		return
	var mode := str(_active_question.get("mode", "school"))
	var subject := _active_subject
	var correct := answer_index == int(_active_question.get("correct_index", -1))
	var score := 0
	var result: Dictionary = {}
	if mode == "final_exam":
		result = EducationServiceScript.answer_final_exam(
			character,
			str(_active_question.get("registration_id", "")),
			str(_active_question.get("subject_id", "")),
			str(_active_question.get("question_id", "")),
			answer_index,
			clock.day
		)
		score = int(result.get("attempt", {}).get("score", 0))
		correct = score == 100
	elif mode == "tertiary":
		result = EducationServiceScript.record_tertiary_answer(
			character, str(_active_question.get("course_id", "")), answer_index, clock.day
		)
		score = 90 if correct else 40
	else:
		score = SchoolServiceScript.record_result(
			character, clock.day, subject, correct, clock.time_label()
		)
	if result.has("ok") and not bool(result.get("ok", false)):
		_active_question.clear()
		_active_subject = ""
		ui.show_notice(
			"Education activity not recorded", str(result.get("message", "Please try again."))
		)
		return
	clock.advance_minutes(20)
	character.advance_time(20)
	_active_subject = ""
	_active_question.clear()
	_save_game(false)
	_refresh_hud()
	ui.show_quiz_result(subject, correct, score, mode, result.get("certificate_eligible", null))


func _on_education_action_requested(action: String, payload: Dictionary = {}) -> void:
	if action in ["begin_final_exam", "begin_course"]:
		if _online_mode:
			var command_sent := false
			if action == "begin_final_exam":
				command_sent = multiplayer_client.send_command(
					"education.action", {"action": action, "payload": payload}
				)
			else:
				command_sent = multiplayer_client.send_command("school.begin")
			if not command_sent:
				ui.notify("The education session could not be started on the server.")
			return

		var quiz: Dictionary = {}
		if action == "begin_final_exam":
			var next_exam := EducationServiceScript.next_final_exam_question(character, clock.day)
			if next_exam.is_empty():
				ui.show_notice(
					"Examination not ready",
					"Check your SS 3 eligibility, registration and the next game-day exam opening."
				)
				return
			var question: Dictionary = next_exam.get("question", {})
			quiz = {
				"question": str(question.get("prompt", "")),
				"options": question.get("choices", []).duplicate(),
				"correct_index": int(question.get("correct_choice_index", -1)),
				"question_id": str(question.get("id", "")),
				"subject_id": str(next_exam.get("subject_id", "")),
				"registration_id": str(next_exam.get("registration_id", "")),
				"mode": "final_exam",
			}
			(
				EducationServiceScript
				. record_attendance(
					character.education_record,
					{
						"id":
						(
							"final-%s-%s"
							% [
								str(next_exam.get("registration_id", "")),
								str(next_exam.get("subject_id", ""))
							]
						),
						"start_minute": clock.minute_of_day,
						"class_id": "SS3",
						"subject_id": str(next_exam.get("subject_id", "")),
					},
					clock.day,
					clock.minute_of_day
				)
			)
			_active_subject = EducationServiceScript.subject_name(
				str(next_exam.get("subject_id", ""))
			)
		else:
			var course_data := EducationServiceScript.begin_tertiary_course(character)
			if course_data.is_empty():
				ui.show_notice(
					"No course ready", "There is no course assessment ready for this semester."
				)
				return
			var course: Dictionary = course_data.get("course", {})
			var course_question: Dictionary = course_data.get("question", {})
			quiz = {
				"question": str(course_question.get("prompt", "")),
				"options": course_question.get("choices", []).duplicate(),
				"correct_index": int(course_question.get("correct_choice_index", -1)),
				"question_id": str(course_question.get("id", "")),
				"subject_id": str(course_data.get("subject_id", "")),
				"course_id": str(course.get("id", "")),
				"mode": "tertiary",
			}
			var tertiary_enrollment: Dictionary = character.education_record.get(
				"tertiary_enrollment", {}
			)
			(
				EducationServiceScript
				. record_attendance(
					character.education_record,
					{
						"id":
						(
							"tertiary-%s-%d-%s"
							% [
								str(tertiary_enrollment.get("program_id", "program")),
								int(tertiary_enrollment.get("semester", 1)),
								str(course.get("id", "course"))
							]
						),
						"start_minute": clock.minute_of_day,
						"class_id": "TERTIARY",
						"subject_id": str(course_data.get("subject_id", "")),
					},
					clock.day,
					clock.minute_of_day
				)
			)
			_active_subject = str(course.get("name", "Tertiary course"))

		EducationServiceScript.sync_legacy_character(character)
		_save_game(false)
		_active_question = quiz
		ui.show_quiz(
			_active_subject,
			_active_question,
			"offline-education-quiz",
			str(quiz.get("mode", "school"))
		)
		return

	if _online_mode:
		if not multiplayer_client.send_command(
			"education.action", {"action": action, "payload": payload}
		):
			ui.notify("The education action could not be sent to the server.")
		return

	var time_cost := 0
	var education_catalog: Dictionary = EducationServiceScript.catalog()
	if action == "attend_activity":
		for activity in education_catalog.get("activities", []):
			if str(activity.get("id", "")) == str(payload.get("activity_id", "")):
				time_cost = int(activity.get("duration_minutes", 0))
				break
	elif action == "practice_training":
		time_cost = int(
			education_catalog.get("apprenticeship_defaults", {}).get("practice_time_minutes", 30)
		)
	var result := EducationServiceScript.apply_action(
		character, action, payload, clock.day, clock.minute_of_day, character.current_location
	)
	if not bool(result.get("ok", false)):
		ui.show_notice(
			"Education update not completed",
			str(result.get("message", "Please check the education record."))
		)
		return
	if time_cost > 0:
		clock.advance_minutes(time_cost)
		character.advance_time(time_cost)
		EducationServiceScript.mark_missed_periods(
			character.education_record, clock.day, clock.minute_of_day
		)
	world.update_daypart(clock.daypart())
	_save_game(false)
	_refresh_hud()
	ui.show_education_result(result)


func _can_enter_education_location(destination: String) -> bool:
	if _online_mode:
		return true
	if destination == "campus":
		var enrollment: Variant = character.education_record.get("tertiary_enrollment", null)
		if not enrollment is Dictionary or str(enrollment.get("status", "")) == "completed":
			ui.show_notice(
				"Campus entry", "Accept an admission offer before entering the tertiary campus."
			)
			return false
	if destination == "training_center":
		var vocational: Array = character.education_record.get("vocational_enrollments", [])
		var apprenticeships: Array = character.education_record.get("apprenticeships", [])
		var has_active_training := false
		for enrollment in vocational:
			if str(enrollment.get("status", "")) == "active":
				has_active_training = true
		for apprenticeship in apprenticeships:
			if str(apprenticeship.get("status", "")) == "active":
				has_active_training = true
		if not has_active_training:
			ui.show_notice(
				"Skills centre entry",
				"Enroll in a vocational course or apprenticeship before entering the workshop."
			)
			return false
	return true


func _purchase_item(item_id: String) -> void:
	if _online_mode:
		if not multiplayer_client.send_command("shop.purchase", {"itemId": item_id}):
			ui.notify("Waiting for the multiplayer server connection.")
		return
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
	if _online_mode:
		if not multiplayer_client.send_command("inventory.consume", {"itemId": item_id}):
			ui.notify("Waiting for the multiplayer server connection.")
		return
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
			ui.show_education(character, clock, character.current_location, _online_mode)
		"chat":
			if _online_mode:
				ui.show_chat()
			else:
				ui.show_notice(
					"Nearby chat", "Choose the optional online mode to chat with connected players."
				)
		"save":
			if _online_mode:
				(
					ui
					. show_notice(
						"Online character saved",
						"The server stores your character and world clock. The local Stage 1 save stays separate."
					)
				)
			else:
				ui.show_save_menu(SaveServiceScript.has_save())
		"settings":
			var settings_message := (
				"Move with WASD or the arrow keys, hold Shift to run, and press E or Interact. "
				+ "The clock pauses while a menu is open. Graphics/audio settings are not included."
			)
			ui.show_notice("Prototype settings", settings_message)
		"geography":
			_toggle_geographic_preview()
		_:
			ui.show_notice("Prototype menu", "This menu is reserved for a later development stage.")


func _toggle_geographic_preview() -> void:
	if world.location_id != "town":
		ui.show_notice(
			"Geographic sample",
			"Return to the outdoor neighbourhood before opening the Akure South map data."
		)
		return
	var enable_preview := not world.geography_preview_enabled
	if not world.set_geographic_preview(enable_preview):
		var detail := (
			"The processed sample could not be loaded. Run npm run geography:import "
			+ "and restart the game."
		)
		ui.show_notice("Geographic sample unavailable", detail)
		return
	if _online_mode:
		var command := "geography.enter" if enable_preview else "geography.leave"
		var payload := {"regionId": world.geographic_region_id()} if enable_preview else {}
		if not multiplayer_client.send_command(command, payload):
			world.set_geographic_preview(not enable_preview)
			ui.notify("The geography command could not be sent. Please try again.")
			return
	else:
		var geographic_location := (
			world.geographic_location_for_position(player.position) if enable_preview else {}
		)
		if enable_preview and geographic_location.is_empty():
			world.set_geographic_preview(false)
			ui.notify("The sample location could not be resolved.")
			return
		character.set_geographic_location(geographic_location)
		_save_game(false)
	if enable_preview:
		var preview_message := (
			"Akure South sample preview: OSM roads, buildings, schools and health points. "
			+ "This is a bounded viewport sample, not an LGA boundary. "
			+ "Turn Map data off to return to Idera."
		)
		ui.notify(preview_message)
	else:
		ui.notify("Returned to the fictional Idera Quarter map.")


func _on_manual_save_requested() -> void:
	_save_game(true)


func _save_game(show_result: bool = true) -> void:
	if _online_mode or not playing or character == null or clock == null:
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
