class_name WorldClock
extends RefCounted

const MINUTES_PER_DAY: int = 1440
const MORNING_START: int = 7 * 60
const LifeSimulationServiceScript = preload("res://scripts/domain/life_simulation_service.gd")

var day: int = 1
var minute_of_day: int = 7 * 60 + 50
var millisecond_of_minute: int = 0


func _init() -> void:
	var calendar: Dictionary = LifeSimulationServiceScript.catalog().get("calendar", {})
	day = maxi(1, int(calendar.get("starting_world_day", 1)))
	minute_of_day = posmod(
		int(calendar.get("starting_minute_of_day", MORNING_START)), MINUTES_PER_DAY
	)


func advance_milliseconds(milliseconds: int) -> void:
	if milliseconds <= 0:
		return
	var accumulated := minute_of_day * 60_000 + millisecond_of_minute + milliseconds
	var milliseconds_per_day := MINUTES_PER_DAY * 60_000
	var days_elapsed := int(floor(float(accumulated) / float(milliseconds_per_day)))
	day += days_elapsed
	var remainder := posmod(accumulated, milliseconds_per_day)
	minute_of_day = int(floor(float(remainder) / 60_000.0))
	millisecond_of_minute = posmod(remainder, 60_000)


func advance_seconds(seconds: int) -> void:
	if seconds > 0:
		advance_milliseconds(seconds * 1000)


func advance_minutes(minutes: int) -> void:
	if minutes > 0:
		advance_milliseconds(minutes * 60_000)


func second_of_minute() -> int:
	return int(floor(float(millisecond_of_minute) / 1000.0))


func calendar_date() -> Dictionary:
	return LifeSimulationServiceScript.date_for_world_day(day)


func week_number() -> int:
	return LifeSimulationServiceScript.world_week(day)


func weekday_name() -> String:
	return LifeSimulationServiceScript.weekday_name(calendar_date())


func time_label() -> String:
	var hours := int(minute_of_day / 60)
	var minutes := minute_of_day % 60
	return "%02d:%02d" % [hours, minutes]


func time_label_with_seconds() -> String:
	return "%s:%02d" % [time_label(), second_of_minute()]


func daypart() -> String:
	if minute_of_day < 5 * 60 or minute_of_day >= 21 * 60:
		return "Night"
	if minute_of_day < 12 * 60:
		return "Morning"
	if minute_of_day < 17 * 60:
		return "Afternoon"
	return "Evening"


func is_night() -> bool:
	return daypart() == "Night"


func minutes_until_morning() -> int:
	var target := MORNING_START
	if minute_of_day < target:
		return target - minute_of_day
	return MINUTES_PER_DAY - minute_of_day + target


func minutes_until(target_minute: int) -> int:
	var target := posmod(target_minute, MINUTES_PER_DAY)
	if target <= minute_of_day:
		return MINUTES_PER_DAY - minute_of_day + target
	return target - minute_of_day


func to_dictionary() -> Dictionary:
	var date := calendar_date()
	return {
		"day": day,
		"minute_of_day": minute_of_day,
		"millisecond_of_minute": millisecond_of_minute,
		"second_of_minute": second_of_minute(),
		"world_date": date,
		"year": int(date.get("year", 2025)),
		"month": int(date.get("month", 1)),
		"date": int(date.get("day", 1)),
		"weekday": weekday_name(),
		"week": week_number(),
		"time_label": time_label_with_seconds(),
	}


func load_dictionary(data: Dictionary) -> void:
	day = maxi(1, int(data.get("day", 1)))
	minute_of_day = posmod(int(data.get("minute_of_day", MORNING_START)), MINUTES_PER_DAY)
	if data.has("millisecond_of_minute"):
		millisecond_of_minute = posmod(int(data.get("millisecond_of_minute", 0)), 60_000)
	else:
		millisecond_of_minute = posmod(int(data.get("second_of_minute", 0)), 60) * 1000
