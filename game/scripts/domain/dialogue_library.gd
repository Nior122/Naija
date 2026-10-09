class_name DialogueLibrary
extends RefCounted

const LINES: Dictionary = {
	"parent":
	[
		"Good morning, {player}. Make sure you have your school bag.",
		"Your family is proud of you. Do your best and be kind to people.",
	],
	"guardian":
	[
		"The day is yours to shape, {player}. Remember to eat and get some rest.",
		"Your exercise book is in your bag. You are ready for school.",
	],
	"teacher":
	[
		"Welcome to class, {player}. Take your seat and let's begin.",
		"A good question is the beginning of learning. Give the activity a try.",
	],
	"student":
	[
		"Hi, {player}. I hope we get a good break today!",
		"Have you checked the timetable? Mathematics is first this morning.",
	],
	"shopkeeper":
	[
		"Welcome! We have water and a fresh snack if you need one.",
		"Thanks for supporting the neighbourhood shop. Have a good day!",
	],
	"nurse":
	[
		"Welcome to the community clinic. Tell us if you are feeling unwell.",
		"Rest, water, and a balanced meal help you stay well.",
	],
	"officer":
	[
		"Good day. The neighbourhood station is here to help keep people safe.",
		"If there is an emergency, seek help from a trusted adult or local service.",
	],
	"community":
	[
		"Welcome to the community hall. Neighbours meet here for local events.",
		"Idera is a fictional neighbourhood, and every family has its own story.",
	],
	"pedestrian":
	[
		"Good morning! It is a lovely day in Idera Quarter.",
		"The school is along the main road. Take care when you cross.",
	],
}


static func lines_for(role: String, player_name: String) -> Array[String]:
	var templates: Variant = LINES.get(role, LINES["pedestrian"])
	var result: Array[String] = []
	if templates is Array:
		for line in templates:
			result.append(str(line).replace("{player}", player_name))
	return result
