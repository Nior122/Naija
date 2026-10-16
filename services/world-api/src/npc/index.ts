export { NPCService, emptyNPCMaps, initializeNPCWorldState } from "./service.js";
export { NPCCatalogService, loadNPCCatalog } from "./catalog.js";
export type * from "./types.js";
export type { NPCCatalog } from "./catalog.js";
export {
  applyNPCSocialAction,
  derivedActivity,
  MAX_VISIBLE_NPCS,
  NPCSocialError,
  npcBondView,
  npcSocialMessage,
  seedNeighbourResidents,
  syncNPCActivities,
  validateNPCSocialRecords,
  visibleNPCProfiles,
  type NPCSocialOutcome,
} from "./social.js";
export { loadNPCSocialCatalog, NPC_SOCIAL_ACTIONS, NPC_SOCIAL_ACTIVITIES, type NPCSocialCatalog } from "./social-catalog.js";
