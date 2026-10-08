extends Node2D

var player_id: String = ""
var character_name: String = "Another student"
var appearance: Dictionary = {}
var geographic_location: Dictionary = {}
var region_id: String = ""
var chunk_id: String = ""
var facing: Vector2 = Vector2.DOWN
var target_position: Vector2 = Vector2.ZERO
var interpolation_speed: float = 13.0


func set_presence(presence: Dictionary) -> void:
	player_id = str(presence.get("playerId", player_id))
	character_name = str(presence.get("characterName", character_name))
	var raw_appearance: Variant = presence.get("appearance", {})
	if raw_appearance is Dictionary:
		appearance = raw_appearance.duplicate(true)
	var raw_geographic_location: Variant = presence.get("geographicLocation", {})
	geographic_location = (
		raw_geographic_location.duplicate(true) if raw_geographic_location is Dictionary else {}
	)
	region_id = str(presence.get("regionId", ""))
	chunk_id = str(presence.get("chunkId", ""))
	var raw_position: Variant = presence.get("position", {})
	if raw_position is Dictionary:
		target_position = Vector2(
			float(raw_position.get("x", target_position.x)),
			float(raw_position.get("y", target_position.y))
		)
	var raw_direction: Variant = presence.get("direction", {})
	if raw_direction is Dictionary:
		facing = (
			Vector2(float(raw_direction.get("x", 0.0)), float(raw_direction.get("y", 1.0)))
			. normalized()
		)
	if facing.length_squared() < 0.01:
		facing = Vector2.DOWN
	queue_redraw()


func _process(delta: float) -> void:
	var blend := 1.0 - exp(-interpolation_speed * delta)
	var next_position := position.lerp(target_position, blend)
	if not next_position.is_equal_approx(position):
		position = next_position


func _draw() -> void:
	var skin_tone := Color.from_string(
		str(appearance.get("skin_tone", "#9b654d")), Color("#9b654d")
	)
	var shirt_color := Color.from_string(
		str(appearance.get("clothing_color", "#27734a")), Color("#27734a")
	)
	var hair_color := Color.from_string(
		str(appearance.get("hair_color", "#2c211d")), Color("#2c211d")
	)
	draw_circle(Vector2(0.0, 15.0), 14.0, Color(0.04, 0.07, 0.05, 0.25))
	draw_rect(Rect2(Vector2(-10.0, -2.0), Vector2(20.0, 25.0)), shirt_color)
	draw_rect(Rect2(Vector2(-13.0, 4.0), Vector2(5.0, 16.0)), skin_tone)
	draw_rect(Rect2(Vector2(8.0, 4.0), Vector2(5.0, 16.0)), skin_tone)
	draw_circle(Vector2(0.0, -9.0), 9.0, skin_tone)
	var hairstyle := str(appearance.get("hairstyle", "Short curls"))
	if hairstyle == "Braids":
		draw_circle(Vector2(-7.0, -10.0), 4.0, hair_color)
		draw_circle(Vector2(7.0, -10.0), 4.0, hair_color)
		draw_rect(Rect2(Vector2(-10.0, -14.0), Vector2(20.0, 4.0)), hair_color)
	elif hairstyle == "Low cut":
		draw_arc(Vector2(0.0, -10.0), 8.5, PI, TAU, 18, hair_color, 3.0)
	else:
		draw_circle(Vector2(0.0, -16.0), 6.0, hair_color)
		draw_arc(Vector2(0.0, -10.0), 8.5, PI, TAU, 18, hair_color, 3.0)
	draw_rect(Rect2(Vector2(8.0, -1.0), Vector2(6.0, 13.0)), Color("#c79448"))
	draw_arc(Vector2.ZERO, 20.0, 0.0, TAU, 28, Color("#8ed5a2"), 2.0)
	draw_line(Vector2(0.0, -8.0), Vector2(0.0, -8.0) + facing * 8.0, Color("#fff5cf"), 2.0)
	draw_string(
		ThemeDB.fallback_font,
		Vector2(1.0, -27.0),
		character_name,
		HORIZONTAL_ALIGNMENT_CENTER,
		140.0,
		12,
		Color(1.0, 1.0, 1.0, 0.95)
	)
	draw_string(
		ThemeDB.fallback_font,
		Vector2(0.0, -28.0),
		character_name,
		HORIZONTAL_ALIGNMENT_CENTER,
		140.0,
		12,
		Color("#14231a")
	)
