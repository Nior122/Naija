import { createHash, randomUUID } from "node:crypto";
import { loadGovernmentCatalog } from "./catalog.js";
import type {

  AppointmentRecord,
  AppointmentSnapshot,
  BudgetRecord,

  FederalGovernmentSnapshot,
  GovernmentAnnouncementRecord,
  GovernmentAnnouncementSnapshot,
  GovernmentCatalog,
  GovernmentEventRecord,
  GovernmentExpenditureRecord,
  GovernmentLevel,
  GovernmentOrganisationRecord,
  GovernmentOrganisationSnapshot,
  GovernmentProjectRecord,
  GovernmentProjectSnapshot,
  GovernmentRevenueRecord,
  LocalGovernmentSnapshot,
  ProjectStatus,
  StateGovernmentSnapshot,
} from "./types.js";
import type { PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import type { CalendarDate } from "../life/types.js";

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((p) => p.character.character_id === characterId);
}

function appendGovernmentEvent(
  state: PersistentWorldState,
  organisationId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  now: number,
  details: Record<string, string | number | boolean | null>,
): GovernmentEventRecord {
  const event: GovernmentEventRecord = {
    event_id: `gov-event-${randomUUID()}`,
    organisation_id: organisationId,
    type,
    world_date: cloneDate(date),
    summary,
    details,
    created_at: new Date(now).toISOString(),
  };
  state.governmentEvents[event.event_id] = event;
  return event;
}

function activeAppointmentForOffice(state: PersistentWorldState, officeId: string): AppointmentRecord | undefined {
  return Object.values(state.governmentAppointments).find(
    (a) => a.office_id === officeId && a.status === "active",
  );
}

function activeAppointmentsForCharacter(state: PersistentWorldState, characterId: string): AppointmentRecord[] {
  return Object.values(state.governmentAppointments).filter(
    (a) => a.character_id === characterId && a.status === "active",
  );
}

function organisationForJurisdiction(state: PersistentWorldState, level: GovernmentLevel, jurisdictionId: string | null): GovernmentOrganisationRecord | undefined {
  return Object.values(state.governmentOrganisations).find(
    (o) => o.level === level && o.jurisdiction_id === jurisdictionId && o.status === "active",
  );
}


function budgetSpent(state: PersistentWorldState, budgetId: string): number {
  return Object.values(state.governmentExpenditure)
    .filter((e) => e.budget_id === budgetId)
    .reduce((sum, e) => sum + e.amount_ngn, 0);
}

export function initializeGovernmentWorldState(state: PersistentWorldState): void {
  if (!state.governmentOrganisations) state.governmentOrganisations = {};
  if (!state.governmentOffices) state.governmentOffices = {};
  if (!state.governmentAppointments) state.governmentAppointments = {};
  if (!state.governmentBudgets) state.governmentBudgets = {};
  if (!state.governmentRevenue) state.governmentRevenue = {};
  if (!state.governmentExpenditure) state.governmentExpenditure = {};
  if (!state.governmentProjects) state.governmentProjects = {};
  if (!state.governmentAnnouncements) state.governmentAnnouncements = {};
  if (!state.governmentEvents) state.governmentEvents = {};
}

export function seedGovernmentWorld(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): void {
  if (Object.keys(state.governmentOrganisations).length > 0) return;
  const timestamp = new Date(now).toISOString();

  // Create federal government
  const federalId = "gov:federal";
  state.governmentOrganisations[federalId] = {
    organisation_id: federalId,
    level: "federal",
    name: "Federal Government of Nigeria",
    description: "The national government of the Federal Republic of Nigeria.",
    jurisdiction_id: null,
    parent_organisation_id: null,
    ministry_id: null,
    status: "active",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };

  // Create federal ministries
  for (const ministry of catalog.federal_ministries) {
    const ministryId = `gov:${ministry.id}`;
    state.governmentOrganisations[ministryId] = {
      organisation_id: ministryId,
      level: "federal",
      name: ministry.label,
      description: ministry.description,
      jurisdiction_id: null,
      parent_organisation_id: federalId,
      ministry_id: ministry.id,
      status: "active",
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
  }

  // Create federal offices
  for (const officeDef of catalog.seed_offices) {
    const officeId = `office:${officeDef.id}`;
    state.governmentOffices[officeId] = {
      office_id: officeId,
      definition_id: officeDef.id,
      organisation_id: federalId,
      label: officeDef.label,
      unique: officeDef.unique,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  // Create federal budget
  const budgetId = `bud:federal:${date.year}`;
  state.governmentBudgets[budgetId] = {
    budget_id: budgetId,
    organisation_id: federalId,
    fiscal_year: date.year,
    fiscal_period_label: `${date.year}`,
    category_id: "bud:administration",
    approved_amount_ngn: catalog.rules.federal_default_annual_budget_ngn,
    allocated_amount_ngn: catalog.rules.federal_default_annual_budget_ngn,
    spent_amount_ngn: 0,
    status: "active",
    approved_at: timestamp,
    approved_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };

  appendGovernmentEvent(state, federalId, "government_created",
    "Federal Government of Nigeria established.", date, now,
    { ministry_count: catalog.federal_ministries.length });
}

// ─── Appointment management ───────────────────────────────────────

export function appointOfficial(
  state: PersistentWorldState,
  officeId: string,
  characterId: string,
  appointedBy: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): AppointmentRecord {
  const office = state.governmentOffices[officeId];
  if (!office) throw new Error("government_office_not_found");

  const player = characterForId(state, characterId);
  if (!player) throw new Error("government_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("government_character_deceased");
  if (player.character.age < catalog.rules.minimum_office_holder_age) throw new Error("government_age_ineligible");

  // Check if office already has an active occupant (for unique offices)
  if (office.unique) {
    const existing = activeAppointmentForOffice(state, officeId);
    if (existing) throw new Error("government_office_already_occupied");
  }

  // Check character's appointment limit
  const currentAppointments = activeAppointmentsForCharacter(state, characterId);
  if (currentAppointments.length >= catalog.rules.maximum_active_appointments_per_character) {
    throw new Error("government_appointment_limit_reached");
  }

  const timestamp = new Date(now).toISOString();
  const appointment: AppointmentRecord = {
    appointment_id: `appt-${randomUUID()}`,
    office_id: officeId,
    character_id: characterId,
    status: "active",
    start_date: timestamp,
    start_world_date: cloneDate(date),
    end_date: null,
    end_world_date: null,
    end_reason: null,
    appointed_by: appointedBy,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.governmentAppointments[appointment.appointment_id] = appointment;

  const org = state.governmentOrganisations[office.organisation_id];
  if (org) {
    org.updated_at = timestamp;
    appendGovernmentEvent(state, org.organisation_id, "appointment_made",
      `${player.character.name} appointed to ${office.label}.`, date, now,
      { office_id: officeId, character_id: characterId, appointment_id: appointment.appointment_id });
  }

  return appointment;
}

export function removeOfficial(
  state: PersistentWorldState,
  appointmentId: string,
  reason: string,
  date: CalendarDate,
  now: number,
): AppointmentRecord {
  const appointment = state.governmentAppointments[appointmentId];
  if (!appointment) throw new Error("government_appointment_not_found");
  if (appointment.status !== "active") throw new Error("government_appointment_not_active");

  const timestamp = new Date(now).toISOString();
  appointment.status = "ended";
  appointment.end_date = timestamp;
  appointment.end_world_date = cloneDate(date);
  appointment.end_reason = reason.trim() || "Removed from office.";
  appointment.updated_at = timestamp;

  const office = state.governmentOffices[appointment.office_id];
  if (office) {
    const org = state.governmentOrganisations[office.organisation_id];
    if (org) {
      org.updated_at = timestamp;
      appendGovernmentEvent(state, org.organisation_id, "appointment_ended",
        `Appointment ended. ${appointment.end_reason}`, date, now,
        { office_id: office.office_id, character_id: appointment.character_id, appointment_id: appointmentId });
    }
  }

  return appointment;
}

// ─── Budget management ────────────────────────────────────────────

export function createBudget(
  state: PersistentWorldState,
  organisationId: string,
  fiscalYear: number,
  categoryId: string,
  amountNgn: number,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): BudgetRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  if (amountNgn < catalog.rules.minimum_budget_amount_ngn || amountNgn > catalog.rules.maximum_budget_amount_ngn) {
    throw new Error("government_budget_amount_invalid");
  }

  const budgetCat = catalog.budget_categories.find((c) => c.id === categoryId);
  if (!budgetCat) throw new Error("government_budget_category_invalid");

  const timestamp = new Date(now).toISOString();
  const budgetId = `bud-${randomUUID()}`;
  const budget: BudgetRecord = {
    budget_id: budgetId,
    organisation_id: organisationId,
    fiscal_year: fiscalYear,
    fiscal_period_label: `${fiscalYear}`,
    category_id: categoryId,
    approved_amount_ngn: amountNgn,
    allocated_amount_ngn: amountNgn,
    spent_amount_ngn: 0,
    status: "approved",
    approved_at: timestamp,
    approved_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentBudgets[budgetId] = budget;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "budget_created",
    `Budget of ₦${amountNgn.toLocaleString("en-NG")} approved for ${budgetCat.label} (${fiscalYear}).`, date, now,
    { budget_id: budgetId, amount_ngn: amountNgn, category_id: categoryId, fiscal_year: fiscalYear });

  return budget;
}

export function getBudgetAvailable(state: PersistentWorldState, budgetId: string): number {
  const budget = state.governmentBudgets[budgetId];
  if (!budget) return 0;
  const spent = budgetSpent(state, budgetId);
  return budget.allocated_amount_ngn - spent;
}

// ─── Revenue and Expenditure ──────────────────────────────────────

export function recordGovernmentRevenue(
  state: PersistentWorldState,
  organisationId: string,
  categoryId: string,
  amountNgn: number,
  description: string,
  sourceReference: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentRevenueRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");
  if (amountNgn < catalog.rules.minimum_revenue_amount_ngn || amountNgn > catalog.rules.maximum_revenue_amount_ngn) {
    throw new Error("government_revenue_amount_invalid");
  }
  const revCat = catalog.revenue_categories.find((c) => c.id === categoryId);
  if (!revCat) throw new Error("government_revenue_category_invalid");

  const idemKey = createHash("sha256").update(`gov-rev:${organisationId}:${categoryId}:${amountNgn}:${now}`).digest("hex");
  const existing = Object.values(state.governmentRevenue).find((r) => r.idempotency_key === idemKey);
  if (existing) return existing;

  const timestamp = new Date(now).toISOString();
  const revenue: GovernmentRevenueRecord = {
    revenue_id: `gov-rev-${randomUUID()}`,
    organisation_id: organisationId,
    category_id: categoryId,
    amount_ngn: amountNgn,
    description: description.trim() || revCat.label,
    source_reference: sourceReference,
    received_at: timestamp,
    received_world_date: cloneDate(date),
    idempotency_key: idemKey,
  };
  state.governmentRevenue[revenue.revenue_id] = revenue;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "revenue_recorded",
    `Revenue of ₦${amountNgn.toLocaleString("en-NG")} recorded (${revCat.label}).`, date, now,
    { revenue_id: revenue.revenue_id, amount_ngn: amountNgn, category_id: categoryId });

  return revenue;
}

export function recordGovernmentExpenditure(
  state: PersistentWorldState,
  organisationId: string,
  budgetId: string | null,
  categoryId: string,
  amountNgn: number,
  description: string,
  projectId: string | null,
  recipientReference: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentExpenditureRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");
  if (amountNgn < catalog.rules.minimum_expenditure_amount_ngn || amountNgn > catalog.rules.maximum_expenditure_amount_ngn) {
    throw new Error("government_expenditure_amount_invalid");
  }
  const expCat = catalog.expenditure_categories.find((c) => c.id === categoryId);
  if (!expCat) throw new Error("government_expenditure_category_invalid");

  // Validate budget availability
  if (budgetId) {
    const budget = state.governmentBudgets[budgetId];
    if (!budget) throw new Error("government_budget_not_found");
    if (budget.organisation_id !== organisationId && budget.organisation_id !== org.parent_organisation_id) {
      throw new Error("government_budget_wrong_organisation");
    }
    const available = getBudgetAvailable(state, budgetId);
    if (available < amountNgn) throw new Error("government_insufficient_budget");
  }

  const idemKey = createHash("sha256").update(`gov-exp:${organisationId}:${categoryId}:${amountNgn}:${now}`).digest("hex");
  const existing = Object.values(state.governmentExpenditure).find((e) => e.idempotency_key === idemKey);
  if (existing) return existing;

  const timestamp = new Date(now).toISOString();
  const expenditure: GovernmentExpenditureRecord = {
    expenditure_id: `gov-exp-${randomUUID()}`,
    organisation_id: organisationId,
    budget_id: budgetId,
    project_id: projectId,
    category_id: categoryId,
    amount_ngn: amountNgn,
    description: description.trim() || expCat.label,
    recipient_reference: recipientReference,
    spent_at: timestamp,
    spent_world_date: cloneDate(date),
    idempotency_key: idemKey,
  };
  state.governmentExpenditure[expenditure.expenditure_id] = expenditure;

  // Update budget spent amount
  if (budgetId) {
    const budget = state.governmentBudgets[budgetId];
    if (budget) {
      budget.spent_amount_ngn = budgetSpent(state, budgetId);
      budget.updated_at = timestamp;
    }
  }

  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "expenditure_recorded",
    `Expenditure of ₦${amountNgn.toLocaleString("en-NG")} recorded (${expCat.label}).`, date, now,
    { expenditure_id: expenditure.expenditure_id, amount_ngn: amountNgn, category_id: categoryId, budget_id: budgetId });

  return expenditure;
}

// ─── Projects ─────────────────────────────────────────────────────

export function createProject(
  state: PersistentWorldState,
  organisationId: string,
  budgetId: string | null,
  categoryId: string,
  name: string,
  description: string,
  locationId: string,
  estimatedCostNgn: number,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentProjectRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  const projCat = catalog.project_categories.find((c) => c.id === categoryId);
  if (!projCat) throw new Error("government_project_category_invalid");

  const projName = name.normalize("NFC").trim();
  if (projName.length < 1 || projName.length > catalog.rules.project_max_name_length) throw new Error("government_project_name_invalid");
  const projDesc = description.normalize("NFC").trim();
  if (projDesc.length > catalog.rules.project_max_description_length) throw new Error("government_project_description_invalid");

  if (estimatedCostNgn < catalog.rules.minimum_project_cost_ngn || estimatedCostNgn > catalog.rules.maximum_project_cost_ngn) {
    throw new Error("government_project_cost_invalid");
  }

  const timestamp = new Date(now).toISOString();
  const project: GovernmentProjectRecord = {
    project_id: `gov-proj-${randomUUID()}`,
    organisation_id: organisationId,
    budget_id: budgetId,
    category_id: categoryId,
    name: projName,
    description: projDesc,
    location_id: locationId,
    estimated_cost_ngn: estimatedCostNgn,
    approved_funding_ngn: 0,
    actual_spent_ngn: 0,
    status: "proposed",
    progress_percent: 0,
    start_date: null,
    start_world_date: null,
    planned_completion: null,
    actual_completion: null,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentProjects[project.project_id] = project;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "project_created",
    `Project '${projName}' proposed.`, date, now,
    { project_id: project.project_id, category_id: categoryId, estimated_cost_ngn: estimatedCostNgn });

  return project;
}

export function updateProjectStatus(
  state: PersistentWorldState,
  projectId: string,
  newStatus: ProjectStatus,
  progressPercent: number | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentProjectRecord {
  const project = state.governmentProjects[projectId];
  if (!project) throw new Error("government_project_not_found");
  if (!catalog.rules.project_statuses.includes(newStatus)) throw new Error("government_project_status_invalid");

  const validTransitions: Record<string, ProjectStatus[]> = {
    proposed: ["under_review", "cancelled"],
    under_review: ["approved", "cancelled"],
    approved: ["funded", "cancelled"],
    funded: ["in_progress", "cancelled"],
    in_progress: ["completed", "suspended", "cancelled"],
    suspended: ["in_progress", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!validTransitions[project.status]?.includes(newStatus)) {
    throw new Error("government_project_status_transition_invalid");
  }

  const timestamp = new Date(now).toISOString();
  project.status = newStatus;
  if (progressPercent !== null) {
    project.progress_percent = Math.max(0, Math.min(100, progressPercent));
  }
  if (newStatus === "in_progress" && !project.start_date) {
    project.start_date = timestamp;
    project.start_world_date = cloneDate(date);
  }
  if (newStatus === "completed") {
    project.actual_completion = timestamp;
    project.progress_percent = 100;
  }
  project.updated_at = timestamp;

  const org = state.governmentOrganisations[project.organisation_id];
  if (org) org.updated_at = timestamp;

  appendGovernmentEvent(state, project.organisation_id, "project_status_changed",
    `Project '${project.name}' status changed to ${newStatus}.`, date, now,
    { project_id: projectId, previous_status: project.status, new_status: newStatus });

  return project;
}

export function fundProject(
  state: PersistentWorldState,
  projectId: string,
  fundingAmountNgn: number,
  date: CalendarDate,
  now: number,
): GovernmentProjectRecord {
  const project = state.governmentProjects[projectId];
  if (!project) throw new Error("government_project_not_found");
  if (project.status !== "approved" && project.status !== "funded" && project.status !== "in_progress") {
    throw new Error("government_project_not_fundable");
  }
  if (fundingAmountNgn < 1) throw new Error("government_funding_amount_invalid");

  const timestamp = new Date(now).toISOString();
  project.approved_funding_ngn += fundingAmountNgn;
  if (project.status === "approved") project.status = "funded";
  project.updated_at = timestamp;

  appendGovernmentEvent(state, project.organisation_id, "project_funded",
    `Project '${project.name}' received ₦${fundingAmountNgn.toLocaleString("en-NG")} in funding.`, date, now,
    { project_id: projectId, funding_amount_ngn: fundingAmountNgn, total_funding_ngn: project.approved_funding_ngn });

  return project;
}

// ─── Announcements ────────────────────────────────────────────────

export function publishAnnouncement(
  state: PersistentWorldState,
  organisationId: string,
  title: string,
  body: string,
  scopeLevel: GovernmentLevel,
  scopeJurisdictionId: string | null,
  projectId: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentAnnouncementRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  const annTitle = title.normalize("NFC").trim();
  if (annTitle.length < 1 || annTitle.length > catalog.rules.announcement_max_title_length) {
    throw new Error("government_announcement_title_invalid");
  }
  const annBody = body.normalize("NFC").trim();
  if (annBody.length < 1 || annBody.length > catalog.rules.announcement_max_body_length) {
    throw new Error("government_announcement_body_invalid");
  }

  const timestamp = new Date(now).toISOString();
  const announcement: GovernmentAnnouncementRecord = {
    announcement_id: `gov-ann-${randomUUID()}`,
    organisation_id: organisationId,
    project_id: projectId,
    title: annTitle,
    body: annBody,
    scope_level: scopeLevel,
    scope_jurisdiction_id: scopeJurisdictionId,
    status: "published",
    published_at: timestamp,
    published_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentAnnouncements[announcement.announcement_id] = announcement;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "announcement_published",
    `Announcement: '${annTitle}'.`, date, now,
    { announcement_id: announcement.announcement_id, scope_level: scopeLevel });

  return announcement;
}

// ─── Query functions ──────────────────────────────────────────────

function buildOrganisationSnapshot(state: PersistentWorldState, orgId: string): GovernmentOrganisationSnapshot | null {
  const org = state.governmentOrganisations[orgId];
  if (!org) return null;
  const offices = Object.values(state.governmentOffices).filter((o) => o.organisation_id === orgId);
  const appointments: AppointmentSnapshot[] = Object.values(state.governmentAppointments)
    .filter((a) => offices.some((o) => o.office_id === a.office_id) && a.status === "active")
    .map((a) => {
      const office = state.governmentOffices[a.office_id];
      return {
        appointment_id: a.appointment_id,
        office_id: a.office_id,
        office_label: office?.label ?? a.office_id,
        character_id: a.character_id,
        status: a.status,
        start_date: a.start_date,
        end_date: a.end_date,
      };
    });
  const budgets = Object.values(state.governmentBudgets).filter((b) => b.organisation_id === orgId);
  const latestBudget = budgets.sort((a, b) => b.fiscal_year - a.fiscal_year)[0] ?? null;
  const projectCount = Object.values(state.governmentProjects).filter((p) => p.organisation_id === orgId).length;
  const announcementCount = Object.values(state.governmentAnnouncements).filter((a) => a.organisation_id === orgId).length;

  return {
    organisation_id: org.organisation_id,
    level: org.level,
    name: org.name,
    description: org.description,
    jurisdiction_id: org.jurisdiction_id,
    parent_organisation_id: org.parent_organisation_id,
    ministry_id: org.ministry_id,
    status: org.status,
    active_offices: offices,
    active_appointments: appointments,
    latest_budget: latestBudget,
    project_count: projectCount,
    announcement_count: announcementCount,
  };
}

export function getFederalGovernment(state: PersistentWorldState): FederalGovernmentSnapshot | null {
  const federal = Object.values(state.governmentOrganisations).find(
    (o) => o.level === "federal" && o.parent_organisation_id === null && o.status === "active",
  );
  if (!federal) return null;

  const federalSnapshot = buildOrganisationSnapshot(state, federal.organisation_id);
  if (!federalSnapshot) return null;

  const ministries = Object.values(state.governmentOrganisations)
    .filter((o) => o.parent_organisation_id === federal.organisation_id && o.ministry_id !== null)
    .map((m) => buildOrganisationSnapshot(state, m.organisation_id))
    .filter((s): s is GovernmentOrganisationSnapshot => s !== null);

  const presidentOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:president",
  );
  const vpOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:vice-president",
  );

  const presidentAppt = presidentOffice ? activeAppointmentForOffice(state, presidentOffice.office_id) : undefined;
  const vpAppt = vpOffice ? activeAppointmentForOffice(state, vpOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === federal.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 10)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === federal.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 10)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    federal_organisation: federalSnapshot,
    ministries,
    president: toApptSnapshot(presidentAppt),
    vice_president: toApptSnapshot(vpAppt),
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function getStateGovernment(state: PersistentWorldState, stateId: string): StateGovernmentSnapshot | null {
  const stateOrg = organisationForJurisdiction(state, "state", stateId);
  if (!stateOrg) return null;

  const stateSnapshot = buildOrganisationSnapshot(state, stateOrg.organisation_id);
  if (!stateSnapshot) return null;

  const departments = Object.values(state.governmentOrganisations)
    .filter((o) => o.parent_organisation_id === stateOrg.organisation_id)
    .map((d) => buildOrganisationSnapshot(state, d.organisation_id))
    .filter((s): s is GovernmentOrganisationSnapshot => s !== null);

  const governorOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:governor" && o.organisation_id === stateOrg.organisation_id,
  );
  const deputyOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:deputy-governor" && o.organisation_id === stateOrg.organisation_id,
  );

  const governorAppt = governorOffice ? activeAppointmentForOffice(state, governorOffice.office_id) : undefined;
  const deputyAppt = deputyOffice ? activeAppointmentForOffice(state, deputyOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === stateOrg.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 10)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === stateOrg.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 10)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    state_organisation: stateSnapshot,
    governor: toApptSnapshot(governorAppt),
    deputy_governor: toApptSnapshot(deputyAppt),
    departments,
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function getLocalGovernment(state: PersistentWorldState, lgaId: string): LocalGovernmentSnapshot | null {
  const localOrg = organisationForJurisdiction(state, "local", lgaId);
  if (!localOrg) return null;

  const localSnapshot = buildOrganisationSnapshot(state, localOrg.organisation_id);
  if (!localSnapshot) return null;

  const chairmanOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:lg-chairman" && o.organisation_id === localOrg.organisation_id,
  );
  const chairmanAppt = chairmanOffice ? activeAppointmentForOffice(state, chairmanOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === localOrg.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 5)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === localOrg.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 5)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    local_organisation: localSnapshot,
    chairman: toApptSnapshot(chairmanAppt),
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function searchProjects(
  state: PersistentWorldState,
  filters: { organisation_id?: string | null; location_id?: string | null; category_id?: string | null; status?: ProjectStatus | null },
): GovernmentProjectSnapshot[] {
  return Object.values(state.governmentProjects)
    .filter((p) => {
      if (filters.organisation_id && p.organisation_id !== filters.organisation_id) return false;
      if (filters.location_id && p.location_id !== filters.location_id) return false;
      if (filters.category_id && p.category_id !== filters.category_id) return false;
      if (filters.status && p.status !== filters.status) return false;
      return true;
    })
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));
}

export function getPublishedAnnouncements(
  state: PersistentWorldState,
  level: GovernmentLevel | null,
  jurisdictionId: string | null,
): GovernmentAnnouncementSnapshot[] {
  return Object.values(state.governmentAnnouncements)
    .filter((a) => {
      if (a.status !== "published") return false;
      if (level && a.scope_level !== level) return false;
      if (jurisdictionId && a.scope_jurisdiction_id && a.scope_jurisdiction_id !== jurisdictionId) return false;
      return true;
    })
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 30)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));
}

export function getCharacterAppointments(state: PersistentWorldState, characterId: string): AppointmentSnapshot[] {
  return Object.values(state.governmentAppointments)
    .filter((a) => a.character_id === characterId)
    .map((a) => {
      const office = state.governmentOffices[a.office_id];
      return {
        appointment_id: a.appointment_id,
        office_id: a.office_id,
        office_label: office?.label ?? a.office_id,
        character_id: a.character_id,
        status: a.status,
        start_date: a.start_date,
        end_date: a.end_date,
      };
    });
}

export function processGovernmentWorldDate(state: PersistentWorldState): number {
  // Future: auto-expire terms, process recurring budgets, etc.
  void state;
  return 0;
}

export function governmentErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    government_office_not_found: "Government office not found.",
    government_character_not_found: "Character not found.",
    government_character_deceased: "Deceased characters cannot hold government office.",
    government_age_ineligible: "Character does not meet the minimum age requirement for this office.",
    government_office_already_occupied: "This office already has an active occupant.",
    government_appointment_limit_reached: "Character already holds the maximum number of government appointments.",
    government_appointment_not_found: "Appointment not found.",
    government_appointment_not_active: "This appointment is not active.",
    government_organisation_not_found: "Government organisation not found.",
    government_budget_amount_invalid: "Budget amount is outside the allowed range.",
    government_budget_category_invalid: "Invalid budget category.",
    government_budget_not_found: "Budget not found.",
    government_budget_wrong_organisation: "This budget does not belong to the specified organisation.",
    government_insufficient_budget: "Insufficient budget remaining for this expenditure.",
    government_revenue_amount_invalid: "Revenue amount is outside the allowed range.",
    government_revenue_category_invalid: "Invalid revenue category.",
    government_expenditure_amount_invalid: "Expenditure amount is outside the allowed range.",
    government_expenditure_category_invalid: "Invalid expenditure category.",
    government_project_category_invalid: "Invalid project category.",
    government_project_name_invalid: "Project name must be 1–200 characters.",
    government_project_description_invalid: "Project description is too long.",
    government_project_cost_invalid: "Project cost is outside the allowed range.",
    government_project_not_found: "Project not found.",
    government_project_status_invalid: "Invalid project status.",
    government_project_status_transition_invalid: "This status transition is not allowed.",
    government_project_not_fundable: "Project is not in a fundable status.",
    government_funding_amount_invalid: "Funding amount must be at least 1 Naira.",
    government_announcement_title_invalid: "Announcement title must be 1–200 characters.",
    government_announcement_body_invalid: "Announcement body must be 1–5000 characters.",
    government_action_invalid: "Invalid government action.",
    government_action_unknown: "Unknown government action.",
  };
  return messages[code] ?? "An unknown government error occurred.";
}
