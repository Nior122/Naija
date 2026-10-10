/**
 * Stage 17 — Entertainment and Media System tests
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
import { EntertainmentCatalogService } from "../dist/entertainment/catalog.js";
import { EntertainmentService, emptyEntertainmentMaps, entertainmentErrorMessage, initializeEntertainmentWorldState, seedEntertainmentWorld } from "../dist/entertainment/index.js";

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
      ...emptyEntertainmentMaps(),
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
  const directory = await mkdtemp(join(tmpdir(), "naija-entertainment-"));
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
  peer.send({ type: "identity.create", creationKey, profile: { name: "Entertainment Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalog ──────────────────────────────────────────────────────

test("entertainment catalog loads and has expected structure", () => {
  const catalog = new EntertainmentCatalogService();
  const data = catalog.get();
  assert.equal(data.schema_version, 1);
  assert.ok(data.profession_categories.length >= 6);
  assert.ok(data.professions.length >= 29);
  assert.ok(data.skills.length >= 20);
  assert.ok(data.content_types.length >= 16);
  assert.ok(data.genres.length >= 20);
  assert.ok(data.release_types.length >= 3);
  assert.ok(data.event_types.length >= 10);
  assert.ok(data.contract_types.length >= 8);
  assert.ok(data.career_stages.length >= 6);
  assert.ok(data.news_topics.length >= 10);
});

test("entertainment catalog valid transitions work", () => {
  const catalog = new EntertainmentCatalogService();
  assert.ok(catalog.isValidProjectTransition("idea", "development"));
  assert.ok(catalog.isValidProjectTransition("development", "pre_production"));
  assert.ok(catalog.isValidProjectTransition("released", "cancelled") === false);
  assert.ok(catalog.isValidContentTransition("draft", "processing"));
  assert.ok(catalog.isValidContentTransition("published", "archived"));
});

test("getCareerStage returns correct stage for fame score", () => {
  const catalog = new EntertainmentCatalogService();
  assert.equal(catalog.getCareerStage(0), "beginner");
  assert.equal(catalog.getCareerStage(15), "emerging");
  assert.equal(catalog.getCareerStage(35), "established");
  assert.equal(catalog.getCareerStage(55), "recognized");
  assert.equal(catalog.getCareerStage(75), "star");
  assert.equal(catalog.getCareerStage(95), "icon");
});

// ─── emptyEntertainmentMaps ───────────────────────────────────────

test("emptyEntertainmentMaps returns all expected map keys", () => {
  const maps = emptyEntertainmentMaps();
  assert.ok(typeof maps.entertainmentProfiles === "object");
  assert.ok(typeof maps.musicProjects === "object");
  assert.ok(typeof maps.filmProjects === "object");
  assert.ok(typeof maps.contentRecords === "object");
  assert.ok(typeof maps.entertainmentEvents === "object");
  assert.ok(typeof maps.entertainmentContracts === "object");
  assert.ok(typeof maps.newsReports === "object");
  assert.ok(typeof maps.controversies === "object");
  assert.ok(typeof maps.contentModeration === "object");
  assert.ok(typeof maps.entertainmentCollaborations === "object");
  assert.ok(typeof maps.entertainmentAudits === "object");
});

// ─── Entertainment Profiles ───────────────────────────────────────

test("createProfile creates profile with stage name", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({
    character_id: "char-artist", stage_name: "Lil Naija",
    biography: "Rising star.", professions: ["singer", "songwriter"],
    character_age: 18,
  }, world.date);
  assert.ok(profile.profile_id.startsWith("entprofile-"));
  assert.equal(profile.stage_name, "Lil Naija");
  assert.equal(profile.career_stage, "beginner");
  assert.equal(profile.fame_score, 0);
});

test("createProfile enforces age requirement", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  assert.throws(() => {
    service.createProfile({ character_id: "char-young", stage_name: "Baby Star", character_age: 10 }, world.date);
  }, /age/i);
});

test("createProfile enforces unique stage name", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  service.createProfile({ character_id: "char-first", stage_name: "UniqueName", character_age: 18 }, world.date);
  assert.throws(() => {
    service.createProfile({ character_id: "char-second", stage_name: "UniqueName", character_age: 18 }, world.date);
  }, /taken/i);
});

test("createProfile validates professions", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  assert.throws(() => {
    service.createProfile({ character_id: "char-bad", stage_name: "Bad", professions: ["nonexistent"], character_age: 18 }, world.date);
  }, /profession/i);
});

// ─── Music Projects ───────────────────────────────────────────────

test("createMusicProject and transition to released", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-musician", stage_name: "DJ Afro", character_age: 18 }, world.date);
  const project = service.createMusicProject({
    artist_character_id: "char-musician", artist_profile_id: profile.profile_id,
    title: "Lagos Nights", genre: "afrobeats", release_type: "single",
  }, world.date);
  assert.equal(project.status, "idea");
  service.transitionMusicProject(project.project_id, "development", world.date);
  service.transitionMusicProject(project.project_id, "pre_production", world.date);
  service.transitionMusicProject(project.project_id, "production", world.date);
  service.transitionMusicProject(project.project_id, "post_production", world.date);
  service.transitionMusicProject(project.project_id, "ready_for_release", world.date);
  const released = service.transitionMusicProject(project.project_id, "released", world.date);
  assert.equal(released.status, "released");
  assert.ok(released.release_date);
  assert.ok(released.listens > 0);
  assert.ok(released.revenue > 0);
  // Fame should have increased
  const updatedProfile = service.getProfileById(profile.profile_id);
  assert.ok(updatedProfile.fame_score > 0);
});

test("transitionMusicProject rejects invalid transition", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-mp2", stage_name: "TestMC", character_age: 18 }, world.date);
  const project = service.createMusicProject({
    artist_character_id: "char-mp2", artist_profile_id: profile.profile_id,
    title: "Test Track", genre: "hip_hop", release_type: "single",
  }, world.date);
  assert.throws(() => {
    service.transitionMusicProject(project.project_id, "released", world.date);
  }, /invalid/i);
});

test("addCollaboratorToMusicProject works", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-collab", stage_name: "CollabKing", character_age: 18 }, world.date);
  const project = service.createMusicProject({
    artist_character_id: "char-collab", artist_profile_id: profile.profile_id,
    title: "Duet", genre: "afrobeats", release_type: "single",
  }, world.date);
  service.addCollaboratorToMusicProject(project.project_id, "char-featured");
  const updated = world.state.musicProjects[project.project_id];
  assert.ok(updated.collaborator_character_ids.includes("char-featured"));
});

// ─── Film Projects ────────────────────────────────────────────────

test("createFilmProject and join cast/crew", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const project = service.createFilmProject({
    producer_character_id: "char-producer",
    title: "Lagos Story", genre: "nollywood_drama", content_type: "short_film",
  }, world.date);
  assert.equal(project.status, "idea");
  service.joinFilmCast(project.project_id, "char-actor1");
  service.joinFilmCrew(project.project_id, "char-cameraman");
  const updated = world.state.filmProjects[project.project_id];
  assert.ok(updated.cast_character_ids.includes("char-actor1"));
  assert.ok(updated.crew_character_ids.includes("char-cameraman"));
});

test("joinFilmCast prevents duplicate", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const project = service.createFilmProject({
    producer_character_id: "char-prod2",
    title: "Test Film", genre: "nollywood_comedy", content_type: "short_film",
  }, world.date);
  service.joinFilmCast(project.project_id, "char-dupactor");
  assert.throws(() => {
    service.joinFilmCast(project.project_id, "char-dupactor");
  }, /already/i);
});

// ─── Content Records ──────────────────────────────────────────────

test("createContent and publishContent", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-creator", stage_name: "ContentKing", character_age: 18 }, world.date);
  const content = service.createContent({
    creator_character_id: "char-creator", creator_profile_id: profile.profile_id,
    title: "My First Video", content_type: "video",
  }, world.date);
  assert.equal(content.status, "draft");
  const published = service.publishContent(content.content_id, world.date);
  assert.equal(published.status, "published");
  assert.ok(published.views > 0);
});

test("createContent enforces daily limit", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-prolific", stage_name: "ProlificCreator", character_age: 18 }, world.date);
  for (let i = 0; i < 5; i++) {
    service.createContent({
      creator_character_id: "char-prolific", creator_profile_id: profile.profile_id,
      title: `Video ${i}`, content_type: "video",
    }, world.date);
  }
  assert.throws(() => {
    service.createContent({
      creator_character_id: "char-prolific", creator_profile_id: profile.profile_id,
      title: "Video 6", content_type: "video",
    }, world.date);
  }, /limit/i);
});

// ─── Events ───────────────────────────────────────────────────────

test("createEvent and purchaseTicket", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const event = service.createEvent({
    organizer_character_id: "char-organizer", name: "Afrobeat Night",
    event_type: "concert", start_world_date: world.date, capacity: 50, ticket_price: 5000,
  }, world.date);
  assert.equal(event.status, "scheduled");
  service.purchaseTicket(event.event_id, "char-fan1", world.date);
  service.purchaseTicket(event.event_id, "char-fan2", world.date);
  const updated = world.state.entertainmentEvents[event.event_id];
  assert.equal(updated.tickets_sold, 2);
  assert.equal(updated.revenue, 10000);
});

test("purchaseTicket prevents duplicate", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const event = service.createEvent({
    organizer_character_id: "char-org2", name: "Test Show",
    event_type: "comedy_show", start_world_date: world.date,
  }, world.date);
  service.purchaseTicket(event.event_id, "char-dupfan", world.date);
  assert.throws(() => {
    service.purchaseTicket(event.event_id, "char-dupfan", world.date);
  }, /already/i);
});

test("completeEvent boosts performer fame", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-performer", stage_name: "StarPerformer", character_age: 20 }, world.date);
  const event = service.createEvent({
    organizer_character_id: "char-performer", name: "Solo Show",
    event_type: "concert", start_world_date: world.date,
  }, world.date);
  service.addPerformer(event.event_id, "char-performer");
  service.completeEvent(event.event_id, world.date);
  const updatedProfile = service.getProfileById(profile.profile_id);
  assert.ok(updatedProfile.fame_score > 0);
});

// ─── Contracts ────────────────────────────────────────────────────

test("createContract and acceptContract", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const contract = service.createContract({
    title: "Recording Deal", contract_type: "recording",
    initiating_character_id: "char-label", accepting_character_id: "char-artist2",
    compensation: 500000,
  }, world.date);
  assert.equal(contract.status, "proposed");
  const accepted = service.acceptContract(contract.contract_id, "char-artist2", world.date);
  assert.equal(accepted.status, "accepted");
});

test("acceptContract rejects non-party", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const contract = service.createContract({
    title: "Deal", contract_type: "management",
    initiating_character_id: "char-mgr", accepting_character_id: "char-talent",
  }, world.date);
  assert.throws(() => {
    service.acceptContract(contract.contract_id, "char-random", world.date);
  }, /party/i);
});

// ─── News Reports ─────────────────────────────────────────────────

test("createNewsReport and publishNewsReport", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const report = service.createNewsReport({
    author_character_id: "char-journalist", headline: "Election Results Announced",
    topic: "elections",
  }, world.date);
  assert.equal(report.status, "draft");
  const published = service.publishNewsReport(report.report_id, "Approved by editor.", world.date);
  assert.equal(published.status, "published");
  assert.ok(published.views > 0);
});

test("correctNewsReport works", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const report = service.createNewsReport({
    author_character_id: "char-journo2", headline: "Breaking News", topic: "politics",
  }, world.date);
  service.publishNewsReport(report.report_id, null, world.date);
  const corrected = service.correctNewsReport(report.report_id, "Fixed factual error in paragraph 2.");
  assert.equal(corrected.status, "corrected");
  assert.equal(corrected.correction_notes, "Fixed factual error in paragraph 2.");
});

// ─── Moderation ───────────────────────────────────────────────────

test("reportContent and reviewModeration", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-modcreator", stage_name: "Moderated", character_age: 18 }, world.date);
  const content = service.createContent({
    creator_character_id: "char-modcreator", creator_profile_id: profile.profile_id,
    title: "Test Content", content_type: "video",
  }, world.date);
  const mod = service.reportContent(content.content_id, "char-reporter", "Inappropriate content", world.date);
  assert.equal(mod.status, "pending");
  const reviewed = service.reviewModeration(mod.moderation_id, "char-moderator", "actioned", "Content removed", "Verified inappropriate");
  assert.equal(reviewed.status, "actioned");
  const updatedContent = world.state.contentRecords[content.content_id];
  assert.equal(updatedContent.moderation_status, "removed");
});

// ─── Fame ─────────────────────────────────────────────────────────

test("fame decays over time", () => {
  const world = makeWorld();
  const service = new EntertainmentService(world.state, new EntertainmentCatalogService());
  const profile = service.createProfile({ character_id: "char-famous", stage_name: "BigStar", character_age: 25 }, world.date);
  profile.fame_score = 50;
  const decayed = service.decayFame(profile.profile_id, { year: 2025, month: 2, day: 1 });
  assert.ok(decayed);
  assert.ok(decayed.fame_score < 50);
});

// ─── Error messages ───────────────────────────────────────────────

test("entertainmentErrorMessage returns readable messages", () => {
  assert.equal(entertainmentErrorMessage("entertainment_profile_not_found"), "Entertainment profile not found.");
  assert.equal(entertainmentErrorMessage("entertainment_age_ineligible"), "Character does not meet the age requirement for entertainment activities.");
  assert.equal(entertainmentErrorMessage("unknown_code"), "An unexpected entertainment system error occurred.");
});

// ─── Persistence migration ────────────────────────────────────────

test("schema version 14 state migrates to version 15 with empty entertainment and social maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-entertainment-migration-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const original = new WorldStore(stateFile, Date.UTC(2025, 0, 1));
  await original.flush();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 15);
  saved.schemaVersion = 14;
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
  assert.equal(migrated.state.schemaVersion, 15);
  assert.ok(typeof migrated.state.entertainmentProfiles === "object");
  assert.ok(typeof migrated.state.musicProjects === "object");
  assert.ok(typeof migrated.state.newsReports === "object");
  assert.ok(typeof migrated.state.socialProfiles === "object");
});

// ─── WebSocket integration ────────────────────────────────────────

test("entertainment.action list_professions works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "entertainment.action", action: "list_professions", requestId: "req-profs-1" });
    const result = await peer.waitFor((msg) => msg.type === "entertainment.result" && msg.requestId === "req-profs-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.professions));
    assert.ok(result.data.professions.length >= 29);
    await peer.close();
  } finally {
    server.close();
  }
});

test("entertainment.action view_profile returns null for non-creator", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "entertainment.action", action: "view_profile", requestId: "req-prof-1" });
    const result = await peer.waitFor((msg) => msg.type === "entertainment.result" && msg.requestId === "req-prof-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.message, "No entertainment profile found.");
    await peer.close();
  } finally {
    server.close();
  }
});

test("entertainment.action error returned for invalid action", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "entertainment.action", action: "invalid_action", requestId: "req-inv" });
    const result = await peer.waitFor((msg) => msg.type === "entertainment.error" && msg.requestId === "req-inv", 5000);
    assert.ok(result);
    assert.equal(result.action, "invalid_action");
    await peer.close();
  } finally {
    server.close();
  }
});
