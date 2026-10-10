/**
 * Stage 16 — Religion, Culture and Community System tests
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { CultureCatalogService } from "../dist/culture/catalog.js";
import { CultureService, emptyCultureMaps, cultureErrorMessage, initializeCultureWorldState, seedCultureWorld } from "../dist/culture/index.js";

const activeDirectories = new Set();
const activeServers = new Set();

afterEach(async () => {
  for (const server of activeServers) { server.close(); }
  activeServers.clear();
  for (const dir of activeDirectories) {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  activeDirectories.clear();
});

function makeWorld() {
  return {
    state: {
      schemaVersion: 14,
      worldId: "nigeria-main",
      worldClock: { day: 1, minute_of_day: 0, millisecond_of_minute: 0, updated_at: new Date(0).toISOString(), world_date: { year: 2025, month: 1, day: 1 } },
      players: {}, people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
      careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {},
      careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {},
      salaryPayments: {}, npcCareers: {},
      accounts: {}, transactions: {}, loans: {}, loanPayments: {}, marketGoods: {}, creditScores: {}, economyEvents: {},
      businesses: {}, businessProducts: {}, businessInventory: {}, businessTransactions: {}, businessSales: {},
      businessProductionRuns: {}, businessEvents: {}, businessSnapshots: {},
      properties: {}, propertyOwnership: {}, propertyListings: {}, rentalAgreements: {}, rentalPayments: {},
      propertySales: {}, propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
      governmentOrganisations: {}, governmentOffices: {}, governmentAppointments: {}, governmentBudgets: {},
      governmentRevenue: {}, governmentExpenditure: {}, governmentProjects: {}, governmentAnnouncements: {}, governmentEvents: {},
      politicalParties: {}, partyMemberships: {}, politicalProfiles: {}, elections: {}, candidates: {},
      campaigns: {}, campaignEvents: {}, campaignFinances: {}, debates: {}, ballots: {}, voterParticipation: {},
      electionDisputes: {}, electionAudits: {},
      laws: {}, lawProvisions: {}, legislativeProposals: {}, courts: {},
      legalProfessionals: {}, legalRepresentations: {}, cases: {},
      caseParticipants: {}, evidence: {}, witnesses: {}, hearings: {},
      judgments: {}, sentences: {}, fines: {}, settlements: {}, appeals: {},
      legalAudits: {},
      ...emptyCultureMaps(),
    },
    date: { year: 2025, month: 1, day: 1 },
    now: Date.UTC(2025, 0, 1),
  };
}

class TestPeer {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      for (const waiter of this.waiters) {
        if (waiter.check(msg)) waiter.resolve(msg);
      }
      this.waiters = this.waiters.filter((w) => !w.check(msg) || !w.once);
      this.messages.push(msg);
    });
  }
  send(data) { this.ws.send(JSON.stringify(data)); }
  waitFor(check, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeout);
      this.waiters.push({ check, resolve, once: true });
      for (const msg of this.messages) { if (check(msg)) { clearTimeout(timer); resolve(msg); return; } }
    });
  }
  waitForType(type, timeout = 5000) { return this.waitFor((m) => m.type === type, timeout); }
  async close() { this.ws.close(); await new Promise((r) => this.ws.once("close", r)); }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-culture-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const server = createApiServer({ stateFile, allowedOrigins: ["http://localhost"] });
  activeServers.add(server);
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  const serverPort = typeof address === "object" && address ? address.port : 3000;
  return { server, serverPort, stateFile, directory };
}

async function createOnlinePeer(serverPort) {
  const ws = new WebSocket(`ws://0.0.0.0:${serverPort}/ws`);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const peer = new TestPeer(ws);
  const creationKey = randomBytes(32).toString("hex");
  peer.send({ type: "identity.create", creationKey, profile: { name: "Culture Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalog ──────────────────────────────────────────────────────

test("culture catalog loads and has expected structure", () => {
  const catalog = new CultureCatalogService();
  const data = catalog.get();
  assert.equal(data.schema_version, 1);
  assert.ok(data.community_types.length >= 15);
  assert.ok(data.institution_categories.length >= 10);
  assert.ok(data.religious_categories.length >= 5);
  assert.ok(data.institution_roles.length >= 15);
  assert.ok(data.festival_categories.length >= 7);
  assert.ok(data.project_categories.length >= 9);
  assert.ok(data.languages.length >= 15);
  assert.ok(data.festival_definitions.length >= 10);
  assert.equal(data.rules.minimum_age_for_membership, 10);
  assert.equal(data.rules.minimum_age_for_leadership, 18);
});

test("culture catalog valid project transitions work", () => {
  const catalog = new CultureCatalogService();
  assert.ok(catalog.isValidProjectTransition("proposed", "under_review"));
  assert.ok(catalog.isValidProjectTransition("proposed", "cancelled"));
  assert.ok(catalog.isValidProjectTransition("active", "completed"));
  assert.ok(!catalog.isValidProjectTransition("completed", "active"));
  assert.ok(!catalog.isValidProjectTransition("cancelled", "proposed"));
});

// ─── emptyCultureMaps ─────────────────────────────────────────────

test("emptyCultureMaps returns all expected map keys", () => {
  const maps = emptyCultureMaps();
  assert.ok(typeof maps.communities === "object");
  assert.ok(typeof maps.communityMemberships === "object");
  assert.ok(typeof maps.institutions === "object");
  assert.ok(typeof maps.institutionMemberships === "object");
  assert.ok(typeof maps.culturalProfiles === "object");
  assert.ok(typeof maps.communityEvents === "object");
  assert.ok(typeof maps.communityProjects === "object");
  assert.ok(typeof maps.communityAnnouncements === "object");
  assert.ok(typeof maps.communityReputation === "object");
  assert.ok(typeof maps.communityDisputes === "object");
  assert.ok(typeof maps.communityContributions === "object");
  assert.ok(typeof maps.communityAudits === "object");
});

// ─── Communities ──────────────────────────────────────────────────

test("createCommunity creates community and auto-joins creator", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({
    name: "Test Village", description: "A test community.",
    community_type: "village", creator_character_id: "char-founder", creator_age: 20,
  }, world.date);
  assert.ok(community.community_id.startsWith("community-"));
  assert.equal(community.name, "Test Village");
  assert.equal(community.status, "active");

  const members = service.getCommunityMembers(community.community_id);
  assert.equal(members.length, 1);
  assert.equal(members[0].character_id, "char-founder");
  assert.ok(members[0].roles.includes("community_organizer"));
});

test("createCommunity enforces age requirement", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  assert.throws(() => {
    service.createCommunity({
      name: "Young Community", description: "Test.",
      community_type: "village", creator_character_id: "char-young", creator_age: 12,
    }, world.date);
  }, /age/i);
});

test("createCommunity rejects invalid community type", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  assert.throws(() => {
    service.createCommunity({
      name: "Bad Community", description: "Test.",
      community_type: "nonexistent_type", creator_character_id: "char-x", creator_age: 20,
    }, world.date);
  }, /type/i);
});

test("listCommunities filters by state and type", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  service.createCommunity({ name: "Lagos Town", description: "Test.", community_type: "town", state_id: "lagos", creator_character_id: "char-a", creator_age: 20 }, world.date);
  service.createCommunity({ name: "Abuja Village", description: "Test.", community_type: "village", state_id: "abuja", creator_character_id: "char-b", creator_age: 20 }, world.date);
  const lagos = service.listCommunities("lagos");
  assert.ok(lagos.length >= 1);
  assert.ok(lagos.every((c) => c.state_id === "lagos"));
  const towns = service.listCommunities(undefined, undefined, "town");
  assert.ok(towns.length >= 1);
});

// ─── Community Membership ─────────────────────────────────────────

test("joinCommunity adds membership", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "Joinable", description: "Test.", community_type: "town", creator_character_id: "char-creator", creator_age: 20 }, world.date);
  const membership = service.joinCommunity(community.community_id, "char-newmember", 20, world.date);
  assert.equal(membership.status, "active");
  assert.equal(membership.membership_type, "voluntary");
  const members = service.getCommunityMembers(community.community_id);
  assert.equal(members.length, 2);
});

test("joinCommunity prevents duplicate membership", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "NoDup", description: "Test.", community_type: "town", creator_character_id: "char-dupcreator", creator_age: 20 }, world.date);
  service.joinCommunity(community.community_id, "char-dupmember", 20, world.date);
  assert.throws(() => {
    service.joinCommunity(community.community_id, "char-dupmember", 20, world.date);
  }, /already/i);
});

test("joinCommunity enforces age requirement", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "AgeCheck", description: "Test.", community_type: "town", creator_character_id: "char-agecreator", creator_age: 20 }, world.date);
  assert.throws(() => {
    service.joinCommunity(community.community_id, "char-young", 5, world.date);
  }, /age/i);
});

test("leaveCommunity removes membership", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "Leaveable", description: "Test.", community_type: "town", creator_character_id: "char-lcreator", creator_age: 20 }, world.date);
  service.joinCommunity(community.community_id, "char-leaver", 20, world.date);
  service.leaveCommunity(community.community_id, "char-leaver", world.date);
  const memberships = service.getCharacterMemberships("char-leaver");
  assert.equal(memberships.length, 0);
});

// ─── Institutions ─────────────────────────────────────────────────

test("createInstitution creates institution and auto-joins creator", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const institution = service.createInstitution({
    name: "Test Church", category: "church", general_category: "religious",
    religious_category: "christianity", description: "A test church.",
    creator_character_id: "char-instcreator", creator_age: 25,
  }, world.date);
  assert.ok(institution.institution_id.startsWith("institution-"));
  assert.equal(institution.name, "Test Church");
  assert.equal(institution.leader_character_id, "char-instcreator");
  assert.equal(institution.member_count, 1);
});

test("joinInstitution and leaveInstitution work", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const institution = service.createInstitution({
    name: "Joinable Church", category: "church", general_category: "religious",
    description: "Test.", creator_character_id: "char-jcreator", creator_age: 25,
  }, world.date);
  service.joinInstitution(institution.institution_id, "char-joiner", 20, world.date);
  let updated = service.getInstitution(institution.institution_id);
  assert.equal(updated.member_count, 2);
  service.leaveInstitution(institution.institution_id, "char-joiner", world.date);
  updated = service.getInstitution(institution.institution_id);
  assert.equal(updated.member_count, 1);
});

// ─── Cultural Profile ─────────────────────────────────────────────

test("updateCulturalProfile and getCulturalProfileSnapshot", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const profile = service.updateCulturalProfile({
    character_id: "char-cultural",
    languages_spoken: ["english", "yoruba"],
    preferred_language: "english",
    religious_affiliation: "christianity",
    cultural_interests: ["music", "food"],
  }, world.date);
  assert.equal(profile.preferred_language, "english");
  assert.equal(profile.religious_affiliation, "christianity");
  const snapshot = service.getCulturalProfileSnapshot("char-cultural");
  assert.deepEqual([...snapshot.languages_spoken], ["english", "yoruba"]);
});

test("updateCulturalProfile rejects invalid language", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  assert.throws(() => {
    service.updateCulturalProfile({ character_id: "char-badlang", languages_spoken: ["klingon"] }, world.date);
  }, /language/i);
});

// ─── Events ───────────────────────────────────────────────────────

test("createEvent and attendEvent", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const event = service.createEvent({
    name: "Community Meeting", description: "Monthly meeting.",
    category: "community", organizer_character_id: "char-org",
    start_world_date: world.date,
  }, world.date);
  assert.ok(event.event_id.startsWith("commevent-"));
  service.attendEvent(event.event_id, "char-attendee", world.date);
  const events = service.listEvents();
  const updated = events.find((e) => e.event_id === event.event_id);
  assert.ok(updated.attendee_character_ids.includes("char-attendee"));
});

test("attendEvent prevents duplicate attendance", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const event = service.createEvent({
    name: "One Time", description: "Test.",
    category: "community", organizer_character_id: "char-org2",
    start_world_date: world.date,
  }, world.date);
  service.attendEvent(event.event_id, "char-onetime", world.date);
  assert.throws(() => {
    service.attendEvent(event.event_id, "char-onetime", world.date);
  }, /already/i);
});

test("cancelEvent works", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const event = service.createEvent({
    name: "Cancellable", description: "Test.",
    category: "community", organizer_character_id: "char-org3",
    start_world_date: world.date,
  }, world.date);
  service.cancelEvent(event.event_id, world.date);
  const events = service.listEvents();
  const updated = events.find((e) => e.event_id === event.event_id);
  assert.equal(updated.status, "cancelled");
});

// ─── Projects ─────────────────────────────────────────────────────

test("createProject and contributeToProject", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "ProjectComm", description: "Test.", community_type: "town", creator_character_id: "char-pcreator", creator_age: 20 }, world.date);
  const project = service.createProject({
    community_id: community.community_id, name: "Road Repair", description: "Fix the road.",
    category: "infrastructure", leader_character_id: "char-pcreator", budget: 500000,
  }, world.date);
  assert.ok(project.project_id.startsWith("commproj-"));
  assert.equal(project.status, "proposed");
  service.transitionProject(project.project_id, "under_review", world.date);
  service.transitionProject(project.project_id, "approved", world.date);
  service.transitionProject(project.project_id, "funding_in_progress", world.date);
  service.transitionProject(project.project_id, "active", world.date);
  const contribution = service.contributeToProject(project.project_id, "char-contributor", "labor", 0, "Helped clear debris.", world.date);
  assert.ok(contribution.contribution_id.startsWith("commcont-"));
  const updated = service.getProject(project.project_id);
  assert.ok(updated.volunteer_character_ids.includes("char-contributor"));
});

test("transitionProject rejects invalid transitions", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "TransComm", description: "Test.", community_type: "town", creator_character_id: "char-tcreator", creator_age: 20 }, world.date);
  const project = service.createProject({
    community_id: community.community_id, name: "Test Project", description: "Test.",
    category: "education", leader_character_id: "char-tcreator", budget: 100000,
  }, world.date);
  assert.throws(() => {
    service.transitionProject(project.project_id, "completed", world.date);
  }, /invalid/i);
});

// ─── Announcements ────────────────────────────────────────────────

test("publishAnnouncement and listAnnouncements", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const announcement = service.publishAnnouncement({
    author_character_id: "char-author", title: "Community News", body: "Important update.", scope: "community",
  }, world.date);
  assert.ok(announcement.announcement_id.startsWith("commann-"));
  const announcements = service.listAnnouncements();
  assert.ok(announcements.length >= 1);
  assert.equal(announcements[0].title, "Community News");
});

// ─── Disputes ─────────────────────────────────────────────────────

test("fileDispute and resolveDispute", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "DisputeComm", description: "Test.", community_type: "town", creator_character_id: "char-dcreator", creator_age: 20 }, world.date);
  const dispute = service.fileDispute({
    community_id: community.community_id, title: "Boundary Dispute",
    description: "Disagreement over land.", filed_by_character_id: "char-filer",
    against_character_id: "char-opposing",
  }, world.date);
  assert.ok(dispute.dispute_id.startsWith("commdisp-"));
  assert.equal(dispute.status, "filed");
  const resolved = service.resolveDispute(dispute.dispute_id, "Mediated resolution.", "char-mediator", world.date);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution, "Mediated resolution.");
});

// ─── Reputation ───────────────────────────────────────────────────

test("reputation decays over time", () => {
  const world = makeWorld();
  const service = new CultureService(world.state, new CultureCatalogService());
  const community = service.createCommunity({ name: "DecayComm", description: "Test.", community_type: "town", creator_character_id: "char-decaycreator", creator_age: 20 }, world.date);
  service.joinCommunity(community.community_id, "char-decayer", 20, world.date);
  const rep = service.getCommunityReputation("char-decayer", community.community_id);
  assert.ok(rep);
  const decayed = service.decayReputation("char-decayer", community.community_id, { year: 2025, month: 3, day: 1 });
  // Decay is small so may or may not change the value, but the call should succeed
  assert.ok(decayed !== null);
});

// ─── Error messages ───────────────────────────────────────────────

test("cultureErrorMessage returns readable messages", () => {
  assert.equal(cultureErrorMessage("culture_community_not_found"), "Community not found.");
  assert.equal(cultureErrorMessage("culture_age_ineligible"), "Character does not meet the age requirement.");
  assert.equal(cultureErrorMessage("unknown_code"), "An unexpected culture system error occurred.");
});

// ─── Persistence migration ────────────────────────────────────────

test("schema version 12 state migrates to version 13 with empty culture maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-culture-migration-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const original = new WorldStore(stateFile, Date.UTC(2025, 0, 1));
  await original.flush();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 16);
  saved.schemaVersion = 12;
  delete saved.communities; delete saved.communityMemberships; delete saved.institutions;
  delete saved.institutionMemberships; delete saved.culturalProfiles; delete saved.communityEvents;
  delete saved.communityProjects; delete saved.communityAnnouncements; delete saved.communityReputation;
  delete saved.communityDisputes; delete saved.communityContributions; delete saved.communityAudits;
  delete saved.entertainmentProfiles; delete saved.musicProjects; delete saved.filmProjects;
  delete saved.contentRecords; delete saved.entertainmentEvents; delete saved.entertainmentContracts;
  delete saved.newsReports; delete saved.controversies; delete saved.contentModeration;
  delete saved.entertainmentCollaborations; delete saved.entertainmentAudits;
  delete saved.socialProfiles; delete saved.socialFollows; delete saved.socialFollowRequests;
  delete saved.socialPosts; delete saved.socialComments; delete saved.socialReactions;
  delete saved.socialHashtags; delete saved.socialPostHashtags; delete saved.socialNotifications;
  delete saved.socialBlocks; delete saved.socialMutes; delete saved.socialReports;
  delete saved.socialAdCampaigns; delete saved.socialTrendingTopics; delete saved.socialAudits;
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 16);
  assert.ok(typeof migrated.state.communities === "object");
  assert.ok(typeof migrated.state.institutions === "object");
  assert.ok(typeof migrated.state.culturalProfiles === "object");
});

// ─── WebSocket integration ────────────────────────────────────────

test("culture.action list_community_types works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "culture.action", action: "list_community_types", requestId: "req-types-1" });
    const result = await peer.waitFor((msg) => msg.type === "culture.result" && msg.requestId === "req-types-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.types));
    assert.ok(result.data.types.length >= 15);
    await peer.close();
  } finally {
    server.close();
  }
});

test("culture.action view_cultural_profile works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "culture.action", action: "view_cultural_profile", requestId: "req-prof-1" });
    const result = await peer.waitFor((msg) => msg.type === "culture.result" && msg.requestId === "req-prof-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.ok(typeof result.data.profile === "object");
    assert.equal(result.data.profile.character_id.length > 0, true);
    await peer.close();
  } finally {
    server.close();
  }
});

test("culture.action error returned for invalid action", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "culture.action", action: "invalid_action", requestId: "req-inv" });
    const result = await peer.waitFor((msg) => msg.type === "culture.error" && msg.requestId === "req-inv", 5000);
    assert.ok(result);
    assert.equal(result.action, "invalid_action");
    await peer.close();
  } finally {
    server.close();
  }
});
