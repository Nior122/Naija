class_name WorldEntity
extends Node2D

var entity_id: String = ""
var display_name: String = ""
var entity_type: String = "object"
var action_id: String = ""
var prompt: String = ""
var data: Dictionary = {}
var dialogue_key: String = ""
var interaction_radius: float = 82.0
var focused: bool = false
var roam_bounds: Rect2 = Rect2()
var walk_speed: float = 24.0
var _walk_target: Vector2 = Vector2.ZERO
var _wander_timer: float = 0.0
var _rng := RandomNumberGenerator.new()


func configure(definition: Dictionary) -> void:
	entity_id = str(definition.get("id", "world-entity"))
	display_name = str(definition.get("name", "Neighbourhood object"))
	entity_type = str(definition.get("type", "object"))
	action_id = str(definition.get("action_id", ""))
	prompt = str(definition.get("prompt", "Interact"))
	data = definition.get("data", {}).duplicate(true)
	dialogue_key = str(definition.get("dialogue_key", ""))
	interaction_radius = float(definition.get("interaction_radius", 82.0))
	roam_bounds = definition.get("roam_bounds", Rect2())
	walk_speed = float(definition.get("walk_speed", 24.0))
	_rng.randomize()
	_walk_target = position
	_wander_timer = _rng.randf_range(0.7, 2.0)
	set_process(entity_type == "npc" and roam_bounds.size.length() > 0.0)
	queue_redraw()


func _process(delta: float) -> void:
	if _wander_timer > 0.0:
		_wander_timer -= delta
		return
	if position.distance_to(_walk_target) < 4.0:
		if _rng.randf() < 0.35:
			_walk_target = position
		else:
			_walk_target = Vector2(
				_rng.randf_range(roam_bounds.position.x, roam_bounds.end.x),
				_rng.randf_range(roam_bounds.position.y, roam_bounds.end.y)
			)
		_wander_timer = _rng.randf_range(1.2, 3.5)
		return
	position = position.move_toward(_walk_target, walk_speed * delta)
	position.x = clampf(position.x, roam_bounds.position.x, roam_bounds.end.x)
	position.y = clampf(position.y, roam_bounds.position.y, roam_bounds.end.y)


func set_focused(value: bool) -> void:
	if focused == value:
		return
	focused = value
	queue_redraw()


func _draw() -> void:
	if entity_type == "npc":
		_draw_person()
	else:
		_draw_interaction_marker()


func _draw_person() -> void:
	var skin := Color("#9b654d")
	var clothes := Color("#436a54")
	if dialogue_key == "teacher":
		clothes = Color("#345f48")
	elif dialogue_key == "student":
		clothes = Color("#d9e4dc")
	elif dialogue_key == "shopkeeper":
		clothes = Color("#c68c37")
	elif dialogue_key == "nurse":
		clothes = Color("#e7eee8")
	draw_circle(Vector2(0.0, 13.0), 12.0, Color(0.05, 0.08, 0.06, 0.22))
	draw_rect(Rect2(Vector2(-9.0, -1.0), Vector2(18.0, 23.0)), clothes)
	draw_circle(Vector2(0.0, -8.0), 8.0, skin)
	draw_arc(Vector2(0.0, -8.0), 8.5, PI, TAU, 16, Color("#30251f"), 4.0)
	if focused:
		draw_arc(Vector2.ZERO, 25.0, 0.0, TAU, 28, Color("#f2c14e"), 2.5)
	_draw_label(display_name, Vector2(-74.0, -28.0), 148.0, 12, Color("#14231a"))


func _draw_interaction_marker() -> void:
	var marker_color := Color("#f2c14e") if focused else Color("#f8f2d8")
	draw_circle(Vector2.ZERO, 14.0, Color(0.08, 0.13, 0.09, 0.28))
	draw_circle(Vector2.ZERO, 10.0, marker_color)
	draw_circle(Vector2.ZERO, 5.0, Color("#305c43"))
	if focused:
		draw_arc(Vector2.ZERO, 19.0, 0.0, TAU, 28, Color("#e3a932"), 2.0)
	_draw_label(display_name, Vector2(-92.0, -26.0), 184.0, 12, Color("#18241b"))


func _draw_label(
	text_value: String, label_position: Vector2, width: float, font_size: int, color: Color
) -> void:
	var label_position_adjusted := label_position + Vector2(1.0, 1.0)
	draw_string(
		ThemeDB.fallback_font,
		label_position_adjusted,
		text_value,
		HORIZONTAL_ALIGNMENT_CENTER,
		width,
		font_size,
		Color(1.0, 1.0, 1.0, 0.9)
	)
	draw_string(
		ThemeDB.fallback_font,
		label_position,
		text_value,
		HORIZONTAL_ALIGNMENT_CENTER,
		width,
		font_size,
		color
	)
