class_name NPCSocialContract
extends RefCounted

## Client side of the NPC social interface (Stage 42). The server in services/world-api is the
## authority: it decides who is visible, where they are, what they are doing, and every change to
## a relationship. This file names only the protocol: the message types, the actions a player may
## send, and the payload keys. It holds no NPCs, no labels, and no scores. Labels, dialogue and
## refusal sentences come from the server's replies. services/world-api/test/client-npc-
## stage42.test.mjs checks these tables against the server source, so a drift fails the test.

## Changing request (npc.action). Each needs a request ID and is applied at most once.
const CHANGING_MESSAGE := "npc.action"
## Read-only request (npc.view). Not tracked as pending.
const VIEW_MESSAGE := "npc.view"

## Actions the server accepts (server: NPC_SOCIAL_ACTIONS in npc/social.ts). The labels are shown
## from the profile the server sends, so they are not repeated here.
const ACTIONS: Array[String] = ["greet", "talk", "acquaint", "argue", "apologise"]

## Actions that damage a relationship. The panel asks for confirmation before sending them.
const CONFIRM_ACTIONS: Array[String] = ["argue"]

## Keys of the payload for each message. The server reads npcId and action from the top level of
## the message, not from a nested payload (server: npcAction and npcView in world-engine.ts).
const ACTION_KEYS: Array[String] = ["action", "npcId"]
const VIEW_KEYS: Array[String] = ["npcId"]

## Replies the panel handles.
const REPLY_TYPES: Array[String] = ["npc.result", "npc.error", "npc.view"]


static func is_action(action: String) -> bool:
	return ACTIONS.has(action)


static func needs_confirmation(action: String) -> bool:
	return CONFIRM_ACTIONS.has(action)


## The message for a changing request. Returns {} when the action is not one the server accepts.
static func action_message(action: String, npc_id: String) -> Dictionary:
	if not is_action(action) or npc_id.is_empty():
		return {}
	return {"action": action, "npcId": npc_id}


## The message for a read-only view of one NPC. Returns {} when the NPC ID is empty.
static func view_message(npc_id: String) -> Dictionary:
	if npc_id.is_empty():
		return {}
	return {"npcId": npc_id}


## The profile for one NPC from a list of profiles, or {} when it is not in the list.
static func profile_for(profiles: Array, npc_id: String) -> Dictionary:
	for profile in profiles:
		if profile is Dictionary and str(profile.get("npc_id", "")) == npc_id:
			return profile
	return {}


## The server's row for one action in a profile, or {} when the profile has no such row.
static func action_row(profile: Dictionary, action: String) -> Dictionary:
	var rows: Variant = profile.get("actions", [])
	if not rows is Array:
		return {}
	for row in rows:
		if row is Dictionary and str(row.get("action", "")) == action:
			return row
	return {}


## An affinity value with an explicit sign, such as "+4" or "-15" or "0".
static func signed(value: Variant) -> String:
	var amount := int(value)
	if amount > 0:
		return "+%d" % amount
	return str(amount)
