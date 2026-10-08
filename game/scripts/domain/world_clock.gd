class_name WorldClock
extends RefCounted

const MINUTES_PER_DAY: int = 1440
const MORNING_START: int = 7 * 60

var day: int = 1
var minute_of_day: int = 7 * 60 + 50


func advance_minutes(minutes: int) -> void:
	if minutes <= 0:
		return
	var total := minute_of_day + minutes
	day += int(floor(float(total) / float(MINUTES_PER_DAY)))
	minute_of_day = posmod(total, MINUTES_PER_DAY)


func time_label() -> String:
	var hours := int(minute_of_day / 60)
	var minutes := minute_of_day % 60
	return "%02d:%02d" % [hours, minutes]


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
	return {"day": day, "minute_of_day": minute_of_day}


func load_dictionary(data: Dictionary) -> void:
	day = maxi(1, int(data.get("day", 1)))
	minute_of_day = posmod(int(data.get("minute_of_day", MORNING_START)), MINUTES_PER_DAY)
