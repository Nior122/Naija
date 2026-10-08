class_name GeographicRegionPreview
extends Node2D

const REGION_DATA_PATH: String = "res://data/geography/processed/akure-south-core.json"
const EXPECTED_REGION_ID: String = "ng:region:ondo:akure-south-core"
const MAP_SIZE: Vector2 = Vector2(1600.0, 900.0)
const GeographyModelScript = preload("res://scripts/domain/geography_model.gd")

var region_data: Dictionary = {}
var features: Array = []
var load_error: String = ""


func load_region() -> bool:
	if not FileAccess.file_exists(REGION_DATA_PATH):
		load_error = "The processed Akure South sample is missing. Run npm run geography:import."
		return false
	var file := FileAccess.open(REGION_DATA_PATH, FileAccess.READ)
	if file == null:
		load_error = "Could not read the processed Akure South sample."
		return false
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		load_error = "The processed geographic sample is not valid JSON."
		return false
	if (
		int(parsed.get("schema_version", 0)) != 1
		or str(parsed.get("world_id", "")) != GeographyModelScript.NIGERIA_WORLD_ID
		or str(parsed.get("id", "")) != EXPECTED_REGION_ID
		or not parsed.get("features", []) is Array
		or not parsed.get("viewport", {}) is Dictionary
	):
		load_error = "The processed geographic sample failed its runtime checks."
		return false
	region_data = parsed
	features = parsed["features"]
	load_error = ""
	queue_redraw()
	return true


func get_region_id() -> String:
	return str(region_data.get("id", ""))


func get_interactable_features() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for feature_value in features:
		if not feature_value is Dictionary:
			continue
		var feature: Dictionary = feature_value
		var kind := str(feature.get("kind", ""))
		var raw_name: Variant = feature.get("name", null)
		var name := str(raw_name).strip_edges() if raw_name is String else ""
		if kind in ["school", "health_facility"] or (kind == "building" and not name.is_empty()):
			result.append(feature.duplicate(true))
	return result


func feature_viewport_position(feature: Dictionary) -> Vector2:
	var geometry: Variant = feature.get("geometry", {})
	if not geometry is Dictionary:
		return Vector2.ZERO
	var positions: Array[Vector2] = []
	_collect_positions(geometry.get("coordinates", []), positions)
	if positions.is_empty():
		return Vector2.ZERO
	var total := Vector2.ZERO
	for point in positions:
		total += point
	var average := total / float(positions.size())
	return _coordinate_to_viewport(average)


func geographic_location_for_viewport(position: Vector2) -> Dictionary:
	if region_data.is_empty():
		return {}
	var viewport: Dictionary = region_data.get("viewport", {})
	var bounds: Dictionary = viewport.get("bounds_wgs84", {})
	var size := Vector2(
		float(viewport.get("width", MAP_SIZE.x)), float(viewport.get("height", MAP_SIZE.y))
	)
	var coordinate: Dictionary = GeographyModelScript.viewport_to_geographic(position, bounds, size)
	if coordinate.is_empty():
		return {}
	var frame: Dictionary = region_data.get("frame", {})
	var origin_data: Dictionary = frame.get("origin", {})
	var origin := Vector2(
		float(origin_data.get("longitude", 5.2)), float(origin_data.get("latitude", 7.25))
	)
	var latitude := float(coordinate["latitude"])
	var longitude := float(coordinate["longitude"])
	var local_position: Vector2 = GeographyModelScript.geographic_to_game_position(
		latitude, longitude, origin, float(frame.get("game_units_per_meter", 1.0))
	)
	var ward_id: Variant = null
	var wards: Array = region_data.get("wards", [])
	var nearest_distance := INF
	for ward_value in wards:
		if not ward_value is Dictionary:
			continue
		var ward: Dictionary = ward_value
		var ward_coordinate: Dictionary = ward.get("coordinate", {})
		var distance := GeographyModelScript.geographic_distance_meters(
			latitude,
			longitude,
			float(ward_coordinate.get("latitude", 0.0)),
			float(ward_coordinate.get("longitude", 0.0))
		)
		if distance < nearest_distance:
			nearest_distance = distance
			ward_id = ward.get("id", null)
	if nearest_distance > 1.0:
		ward_id = null
	return {
		"world_id": GeographyModelScript.NIGERIA_WORLD_ID,
		"region_id": get_region_id(),
		"country_id": "NG",
		"state_id": str(region_data.get("state_id", "")),
		"lga_id": str(region_data.get("lga_id", "")),
		"settlement_id": str(region_data.get("settlement_id", "")),
		"ward_id": ward_id,
		"latitude": latitude,
		"longitude": longitude,
		"local_position_m": {"x": local_position.x, "y": local_position.y},
		"chunk_id": GeographyModelScript.chunk_for_coordinate(latitude, longitude),
	}


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#d9e2d2"), true)
	for feature_value in features:
		if not feature_value is Dictionary:
			continue
		var feature: Dictionary = feature_value
		var geometry: Variant = feature.get("geometry", {})
		if not geometry is Dictionary:
			continue
		var kind := str(feature.get("kind", ""))
		match kind:
			"road":
				_draw_lines(geometry, Color("#f4edda"), 4.0)
			"waterway":
				_draw_lines(geometry, Color("#71aec1"), 3.0)
			"building":
				_draw_polygons(geometry, Color("#c98b61"))
				var building_name: Variant = feature.get("name", null)
				if building_name is String and not building_name.is_empty():
					_draw_named_marker(feature)
			"landuse":
				_draw_polygons(geometry, Color("#83a779"))
			"health_facility":
				_draw_marker(feature, Color("#cf6b5e"), "H")
			"school":
				_draw_marker(feature, Color("#4a7db4"), "S")
	draw_rect(Rect2(Vector2(0.0, 0.0), Vector2(MAP_SIZE.x, 7.0)), Color("#466a50"), true)
	_draw_label(
		"AKURE SOUTH · BOUNDED GEOGRAPHIC SAMPLE", Vector2(30.0, 34.0), 20, Color("#20342a")
	)
	_draw_label(
		"© OpenStreetMap contributors · ODbL 1.0 · viewport sample, not an administrative boundary",
		Vector2(30.0, 58.0),
		13,
		Color("#344a3b")
	)


func _draw_lines(geometry: Dictionary, color: Color, width: float) -> void:
	var geometry_type := str(geometry.get("type", ""))
	var coordinates: Variant = geometry.get("coordinates", [])
	if geometry_type == "LineString":
		_draw_line_group(coordinates, color, width)
	elif geometry_type == "MultiLineString" and coordinates is Array:
		for line in coordinates:
			_draw_line_group(line, color, width)


func _draw_line_group(values: Variant, color: Color, width: float) -> void:
	if not values is Array:
		return
	var points := PackedVector2Array()
	for value in values:
		var coordinate := _coordinate_from_pair(value)
		if coordinate != Vector2.INF:
			points.append(_coordinate_to_viewport(coordinate))
	if points.size() >= 2:
		draw_polyline(points, color, width, true)


func _draw_polygons(geometry: Dictionary, color: Color) -> void:
	var geometry_type := str(geometry.get("type", ""))
	var coordinates: Variant = geometry.get("coordinates", [])
	if geometry_type == "Polygon":
		_draw_polygon_outer_ring(coordinates, color)
	elif geometry_type == "MultiPolygon" and coordinates is Array:
		for polygon in coordinates:
			_draw_polygon_outer_ring(polygon, color)


func _draw_polygon_outer_ring(polygon_value: Variant, color: Color) -> void:
	if not polygon_value is Array or polygon_value.is_empty() or not polygon_value[0] is Array:
		return
	var points := PackedVector2Array()
	for value in polygon_value[0]:
		var coordinate := _coordinate_from_pair(value)
		if coordinate != Vector2.INF:
			points.append(_coordinate_to_viewport(coordinate))
	if points.size() >= 3:
		draw_colored_polygon(points, color)


func _draw_marker(feature: Dictionary, color: Color, symbol: String) -> void:
	var position := feature_viewport_position(feature)
	draw_circle(position, 9.0, Color("#fff8e6"))
	draw_circle(position, 7.0, color)
	_draw_label(symbol, position + Vector2(0.0, 4.0), 10, Color.WHITE)
	var raw_name: Variant = feature.get("name", null)
	if raw_name is String and not raw_name.is_empty():
		_draw_label(raw_name, position + Vector2(30.0, 4.0), 12, Color("#26392f"))


func _draw_named_marker(feature: Dictionary) -> void:
	var position := feature_viewport_position(feature)
	draw_circle(position, 3.5, Color("#63453c"))
	_draw_label(str(feature.get("name", "")), position + Vector2(36.0, 4.0), 11, Color("#3a3a32"))


func _draw_label(text_value: String, at: Vector2, font_size: int, color: Color) -> void:
	draw_string(
		ThemeDB.fallback_font, at, text_value, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, color
	)


func _coordinate_to_viewport(coordinate: Vector2) -> Vector2:
	var viewport: Dictionary = region_data.get("viewport", {})
	var bounds: Dictionary = viewport.get("bounds_wgs84", {})
	var size := Vector2(
		float(viewport.get("width", MAP_SIZE.x)), float(viewport.get("height", MAP_SIZE.y))
	)
	return GeographyModelScript.geographic_to_viewport(coordinate.y, coordinate.x, bounds, size)


func _coordinate_from_pair(value: Variant) -> Vector2:
	if not value is Array or value.size() < 2:
		return Vector2.INF
	if not value[0] is float and not value[0] is int:
		return Vector2.INF
	if not value[1] is float and not value[1] is int:
		return Vector2.INF
	return Vector2(float(value[0]), float(value[1]))


func _collect_positions(value: Variant, result: Array[Vector2]) -> void:
	var coordinate := _coordinate_from_pair(value)
	if coordinate != Vector2.INF:
		result.append(coordinate)
		return
	if value is Array:
		for child in value:
			_collect_positions(child, result)
