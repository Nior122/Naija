class_name GeographyModel
extends RefCounted

const EARTH_RADIUS_METERS: float = 6371008.8
const STORED_COORDINATE_DECIMAL_PLACES: int = 7
const LOCAL_POSITION_PRECISION_METERS: float = 0.001
const DEFAULT_CHUNK_SIZE_METERS: float = 500.0
const CHUNK_GRID_CENTRAL_LATITUDE_DEGREES: float = 9.0
const NIGERIA_WORLD_ID: String = "nigeria-main"


static func is_valid_coordinate(latitude: float, longitude: float) -> bool:
	return (
		is_finite(latitude)
		and is_finite(longitude)
		and latitude >= -90.0
		and latitude <= 90.0
		and longitude >= -180.0
		and longitude <= 180.0
	)


static func normalize_coordinate(latitude: float, longitude: float) -> Dictionary:
	if not is_valid_coordinate(latitude, longitude):
		return {}
	return {
		"latitude": _round_decimal(latitude, STORED_COORDINATE_DECIMAL_PLACES),
		"longitude": _round_decimal(longitude, STORED_COORDINATE_DECIMAL_PLACES),
	}


static func geographic_to_game_position(
	latitude: float,
	longitude: float,
	origin: Vector2 = Vector2(8.0, 9.0),
	game_units_per_meter: float = 1.0
) -> Vector2:
	if not is_valid_coordinate(latitude, longitude) or game_units_per_meter <= 0.0:
		return Vector2.ZERO
	var origin_latitude := deg_to_rad(origin.y)
	var longitude_delta := deg_to_rad(longitude - origin.x)
	var latitude_delta := deg_to_rad(latitude - origin.y)
	var x := EARTH_RADIUS_METERS * cos(origin_latitude) * longitude_delta * game_units_per_meter
	var y := -EARTH_RADIUS_METERS * latitude_delta * game_units_per_meter
	return Vector2(_round_decimal(x, 3), _round_decimal(y, 3))


static func game_position_to_geographic(
	position: Vector2, origin: Vector2 = Vector2(8.0, 9.0), game_units_per_meter: float = 1.0
) -> Dictionary:
	if game_units_per_meter <= 0.0:
		return {}
	var longitude_scale := cos(deg_to_rad(origin.y))
	if absf(longitude_scale) < 0.000000000001:
		return {}
	var latitude := origin.y - rad_to_deg(position.y / (EARTH_RADIUS_METERS * game_units_per_meter))
	var longitude := (
		origin.x
		+ rad_to_deg(position.x / (EARTH_RADIUS_METERS * longitude_scale * game_units_per_meter))
	)
	return normalize_coordinate(latitude, longitude)


static func geographic_distance_meters(
	left_latitude: float, left_longitude: float, right_latitude: float, right_longitude: float
) -> float:
	if (
		not is_valid_coordinate(left_latitude, left_longitude)
		or not is_valid_coordinate(right_latitude, right_longitude)
	):
		return INF
	var first_latitude := deg_to_rad(left_latitude)
	var second_latitude := deg_to_rad(right_latitude)
	var latitude_delta := deg_to_rad(right_latitude - left_latitude)
	var longitude_delta := deg_to_rad(right_longitude - left_longitude)
	var haversine := (
		pow(sin(latitude_delta / 2.0), 2.0)
		+ cos(first_latitude) * cos(second_latitude) * pow(sin(longitude_delta / 2.0), 2.0)
	)
	return 2.0 * EARTH_RADIUS_METERS * asin(sqrt(clampf(haversine, 0.0, 1.0)))


static func chunk_for_coordinate(
	latitude: float, longitude: float, chunk_size_meters: float = DEFAULT_CHUNK_SIZE_METERS
) -> String:
	if not is_valid_coordinate(latitude, longitude) or chunk_size_meters <= 0.0:
		return ""
	var global_x := (
		EARTH_RADIUS_METERS
		* cos(deg_to_rad(CHUNK_GRID_CENTRAL_LATITUDE_DEGREES))
		* deg_to_rad(longitude)
	)
	var global_y := EARTH_RADIUS_METERS * deg_to_rad(latitude)
	var column := floori(global_x / chunk_size_meters)
	var row := floori(global_y / chunk_size_meters)
	var size_label := _chunk_size_label(chunk_size_meters)
	return "ng:%sm:%d:%d" % [size_label, column, row]


static func chunk_coordinates(
	chunk_id: String, chunk_size_meters: float = DEFAULT_CHUNK_SIZE_METERS
) -> Vector2i:
	var prefix := "ng:%sm:" % _chunk_size_label(chunk_size_meters)
	if not chunk_id.begins_with(prefix):
		return Vector2i(-2147483648, -2147483648)
	var cells := chunk_id.substr(prefix.length()).split(":")
	if cells.size() != 2 or not cells[0].is_valid_int() or not cells[1].is_valid_int():
		return Vector2i(-2147483648, -2147483648)
	return Vector2i(int(cells[0]), int(cells[1]))


static func chunks_are_within_radius(
	first_chunk_id: String,
	second_chunk_id: String,
	radius_chunks: int,
	chunk_size_meters: float = DEFAULT_CHUNK_SIZE_METERS
) -> bool:
	if radius_chunks < 0:
		return false
	var first := chunk_coordinates(first_chunk_id, chunk_size_meters)
	var second := chunk_coordinates(second_chunk_id, chunk_size_meters)
	if first.x == -2147483648 or second.x == -2147483648:
		return false
	return abs(first.x - second.x) <= radius_chunks and abs(first.y - second.y) <= radius_chunks


static func geographic_to_viewport(
	latitude: float, longitude: float, bounds: Dictionary, viewport_size: Vector2
) -> Vector2:
	if (
		not is_valid_coordinate(latitude, longitude)
		or viewport_size.x <= 0.0
		or viewport_size.y <= 0.0
		or not _valid_bounds(bounds)
	):
		return Vector2.ZERO
	return Vector2(
		(
			((longitude - float(bounds["west"])) / (float(bounds["east"]) - float(bounds["west"])))
			* viewport_size.x
		),
		(
			(
				(float(bounds["north"]) - latitude)
				/ (float(bounds["north"]) - float(bounds["south"]))
			)
			* viewport_size.y
		)
	)


static func viewport_to_geographic(
	position: Vector2, bounds: Dictionary, viewport_size: Vector2
) -> Dictionary:
	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0 or not _valid_bounds(bounds):
		return {}
	var x := clampf(position.x, 0.0, viewport_size.x)
	var y := clampf(position.y, 0.0, viewport_size.y)
	var latitude := (
		float(bounds["north"])
		- y / viewport_size.y * (float(bounds["north"]) - float(bounds["south"]))
	)
	var longitude := (
		float(bounds["west"])
		+ x / viewport_size.x * (float(bounds["east"]) - float(bounds["west"]))
	)
	return normalize_coordinate(latitude, longitude)


static func _valid_bounds(bounds: Dictionary) -> bool:
	return (
		bounds.has("west")
		and bounds.has("south")
		and bounds.has("east")
		and bounds.has("north")
		and is_finite(float(bounds["west"]))
		and is_finite(float(bounds["south"]))
		and is_finite(float(bounds["east"]))
		and is_finite(float(bounds["north"]))
		and float(bounds["west"]) < float(bounds["east"])
		and float(bounds["south"]) < float(bounds["north"])
	)


static func _chunk_size_label(value: float) -> String:
	var rounded := _round_decimal(value, 3)
	return str(int(rounded)) if is_equal_approx(rounded, roundf(rounded)) else str(rounded)


static func _round_decimal(value: float, places: int) -> float:
	var scale := pow(10.0, float(places))
	return roundf(value * scale) / scale
