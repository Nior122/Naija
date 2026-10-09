import { createHash, randomUUID } from "node:crypto";
import { loadEconomyCatalog } from "../economy/catalog.js";
import { economyErrorMessage } from "../economy/service.js";
import type { CalendarDate } from "../life/types.js";
import type { PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import { loadBusinessCatalog } from "./catalog.js";
import type {
  BusinessBranchRecord,
  BusinessCatalog,
  BusinessDiscoveryEntry,
  BusinessEventRecord,
  BusinessInventoryMovementRecord,
  BusinessInventoryRecord,
  BusinessOwnershipRecord,
  BusinessOwnershipRole,
  BusinessPremisesType,
  BusinessProductionRunRecord,
  BusinessProductRecord,
  BusinessProfileSnapshot,
  BusinessRecord,
  BusinessSaleRecord,
  BusinessTransactionKind,
  BusinessTransactionRecord,
} from "./types.js";

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((player) => player.character.character_id === characterId);
}

function businessesForCharacter(state: PersistentWorldState, characterId: string): BusinessRecord[] {
  const ownershipIds = new Set(
    Object.values(state.businessOwnership)
      .filter((o) => o.character_id === characterId && o.active && (o.role === "owner" || o.role === "co_owner"))
      .map((o) => o.business_id),
  );
  return Object.values(state.businesses).filter((biz) => ownershipIds.has(biz.business_id));
}

function ownershipForCharacterAndBusiness(state: PersistentWorldState, businessId: string, characterId: string): BusinessOwnershipRecord | undefined {
  return Object.values(state.businessOwnership).find((o) => o.business_id === businessId && o.character_id === characterId && o.active);
}

function countEmployeesForBusiness(state: PersistentWorldState, businessId: string): number {
  return Object.values(state.businessOwnership).filter((o) => o.business_id === businessId && o.active && o.role === "employee").length;
}

function appendBusinessEvent(
  state: PersistentWorldState,
  businessId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  details: Record<string, string | number | boolean | null>,
): BusinessEventRecord {
  const event: BusinessEventRecord = {
    event_id: `biz-event-${randomUUID()}`,
    business_id: businessId,
    type,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    summary,
    details,
    created_at: new Date(now).toISOString(),
  };
  state.businessEvents[event.event_id] = event;
  return event;
}

function postBusinessTransaction(
  state: PersistentWorldState,
  businessId: string,
  kind: BusinessTransactionKind,
  amountNgn: number,
  description: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  idempotencyKey: string,
  referenceId: string | null = null,
  counterpartyCharacterId: string | null = null,
): BusinessTransactionRecord {
  const business = state.businesses[businessId]!;
  const balanceBefore = business.balance_ngn;
  const balanceAfter = kind === "capital_contribution" || kind === "sale_product" || kind === "sale_service" || kind === "refund"
    ? balanceBefore + amountNgn
    : balanceBefore - amountNgn;
  const tx: BusinessTransactionRecord = {
    transaction_id: `biz-tx-${randomUUID()}`,
    business_id: businessId,
    kind,
    amount_ngn: amountNgn,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: balanceAfter,
    description,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: new Date(now).toISOString(),
    reference_id: referenceId,
    counterparty_character_id: counterpartyCharacterId,
    idempotency_key: idempotencyKey,
  };
  state.businessTransactions[tx.transaction_id] = tx;
  business.balance_ngn = balanceAfter;
  if (kind === "sale_product" || kind === "sale_service") business.total_revenue_ngn += amountNgn;
  if (kind === "expense_operating" || kind === "expense_rent" || kind === "expense_salary" || kind === "production_cost") business.total_expenses_ngn += amountNgn;
  if (kind === "capital_contribution") business.total_capital_ngn += amountNgn;
  if (kind === "owner_withdrawal") business.total_withdrawals_ngn += amountNgn;
  business.updated_at = new Date(now).toISOString();
  return tx;
}

function validateBusinessName(name: string, catalog: BusinessCatalog): string {
  const trimmed = name.normalize("NFC").trim().replace(/\s+/g, " ");
  if (trimmed.length < catalog.rules.minimum_business_name_length || trimmed.length > catalog.rules.maximum_business_name_length) {
    throw new Error("business_name_invalid");
  }
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) throw new Error("business_name_invalid");
  return trimmed;
}

function validateBusinessDescription(description: string, catalog: BusinessCatalog): string {
  const trimmed = description.normalize("NFC").trim();
  if (trimmed.length < 1 || trimmed.length > catalog.rules.maximum_business_description_length) {
    throw new Error("business_description_invalid");
  }
  return trimmed;
}

export function initializeBusinessWorldState(state: PersistentWorldState): void {
  if (!state.businesses) state.businesses = {};
  if (!state.businessOwnership) state.businessOwnership = {};
  if (!state.businessBranches) state.businessBranches = {};
  if (!state.businessProducts) state.businessProducts = {};
  if (!state.businessInventory) state.businessInventory = {};
  if (!state.businessInventoryMovements) state.businessInventoryMovements = {};
  if (!state.businessTransactions) state.businessTransactions = {};
  if (!state.businessExpenses) state.businessExpenses = {};
  if (!state.businessSales) state.businessSales = {};
  if (!state.businessProductionRuns) state.businessProductionRuns = {};
  if (!state.businessEvents) state.businessEvents = {};
}

export function createBusiness(
  state: PersistentWorldState,
  characterId: string,
  templateId: string,
  name: string,
  description: string,
  locationId: string,
  initialCapitalNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("business_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("business_character_deceased");

  const template = catalog.templates.find((t) => t.id === templateId);
  if (!template || !template.active) throw new Error("business_template_not_found");

  const age = player.character.age;
  if (age < template.minimum_owner_age) throw new Error("business_owner_age_ineligible");
  if (age < catalog.rules.minimum_owner_age_years) throw new Error("business_owner_age_ineligible");

  if (!template.allowed_locations.includes(locationId)) throw new Error("business_location_invalid");

  const existingCount = businessesForCharacter(state, characterId).length;
  if (existingCount >= catalog.rules.maximum_businesses_per_character) throw new Error("business_limit_reached");

  const validatedName = validateBusinessName(name, catalog);
  const validatedDescription = validateBusinessDescription(description, catalog);

  const setupCost = template.setup_cost_ngn;
  const cashAccounts = Object.values(state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("business_no_cash_account");
  const totalAvailable = cashAccount.balance_ngn;
  if (totalAvailable < setupCost + initialCapitalNgn) throw new Error("business_insufficient_funds");

  const timestamp = new Date(now).toISOString();
  const businessId = `biz-${randomUUID()}`;

  if (setupCost > 0) {
    const deductAmount = setupCost;
    if (cashAccount.balance_ngn >= deductAmount) {
      cashAccount.balance_ngn -= deductAmount;
      cashAccount.total_withdrawn_ngn += deductAmount;
    } else {
      const fromCash = cashAccount.balance_ngn;
      const fromMoney = deductAmount - fromCash;
      cashAccount.balance_ngn = 0;
      cashAccount.total_withdrawn_ngn += fromCash;
      player.character.money -= fromMoney;
    }
    cashAccount.updated_at = timestamp;
  }

  const business: BusinessRecord = {
    business_id: businessId,
    name: validatedName,
    description: validatedDescription,
    template_id: templateId,
    category_id: template.category_id,
    model: template.model,
    status: "active",
    primary_location_id: locationId,
    premises_type: template.default_premises,
    reputation_score: catalog.rules.starting_reputation_score,
    total_revenue_ngn: 0,
    total_expenses_ngn: 0,
    total_capital_ngn: 0,
    total_withdrawals_ngn: 0,
    balance_ngn: 0,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    last_operating_date: null,
    owner_character_id: characterId,
    closed_at: null,
    closed_world_date: null,
    closure_reason: null,
  };
  state.businesses[businessId] = business;

  const ownership: BusinessOwnershipRecord = {
    ownership_id: `biz-own-${randomUUID()}`,
    business_id: businessId,
    character_id: characterId,
    role: "owner",
    share_percent: 100,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    is_founder: true,
    active: true,
  };
  state.businessOwnership[ownership.ownership_id] = ownership;

  if (initialCapitalNgn > 0) {
    cashAccount.balance_ngn -= initialCapitalNgn;
    cashAccount.total_withdrawn_ngn += initialCapitalNgn;
    cashAccount.updated_at = timestamp;
    const idemKey = createHash("sha256").update(`biz-capital:${businessId}:${timestamp}`).digest("hex");
    postBusinessTransaction(state, businessId, "capital_contribution", initialCapitalNgn,
      "Initial capital contribution from owner.", date, minuteOfDay, now, idemKey, null, characterId);
  }

  // Setup cost is already deducted from the owner's personal cash account above.
  // We record it as a business event but do not debit the business balance.

  if (setupCost > 0) {
    appendBusinessEvent(state, businessId, "setup_cost_paid",
      `Registration and setup cost of ₦${setupCost.toLocaleString("en-NG")} paid by the owner.`, date, minuteOfDay, now,
      { setup_cost_ngn: setupCost });
  }

  appendBusinessEvent(state, businessId, "business_created",
    `Business '${validatedName}' was registered.`, date, minuteOfDay, now,
    { template_id: templateId, location_id: locationId, setup_cost_ngn: setupCost, initial_capital_ngn: initialCapitalNgn });

  return business;
}

function authorizeBusinessAction(state: PersistentWorldState, businessId: string, characterId: string, requiredRoles: BusinessOwnershipRole[]): BusinessOwnershipRecord {
  const ownership = ownershipForCharacterAndBusiness(state, businessId, characterId);
  if (!ownership) throw new Error("business_unauthorized");
  if (!requiredRoles.includes(ownership.role)) throw new Error("business_unauthorized");
  return ownership;
}

function assertBusinessActive(business: BusinessRecord): void {
  if (business.status !== "active") throw new Error("business_not_active");
}

export function addBusinessProduct(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  productDefinitionId: string,
  customPriceNgn: number | null,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessProductRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner", "manager", "inventory_manager"]);

  const product = catalog.business_products.find((p) => p.id === productDefinitionId);
  if (!product) throw new Error("business_product_not_found");

  const existingCount = Object.values(state.businessProducts).filter((p) => p.business_id === businessId).length;
  if (existingCount >= catalog.rules.maximum_products_per_business) throw new Error("business_product_limit_reached");

  const priceNgn = customPriceNgn !== null ? customPriceNgn : product.base_price_ngn;
  const minPrice = Math.max(1, Math.floor(product.base_cost_ngn * catalog.rules.minimum_price_markup_percent / 100));
  const maxPrice = Math.floor(product.base_cost_ngn * catalog.rules.maximum_price_markup_percent / 100);
  if (product.base_cost_ngn > 0 && (priceNgn < minPrice || priceNgn > maxPrice)) throw new Error("business_price_invalid");
  if (!Number.isSafeInteger(priceNgn) || priceNgn < 0) throw new Error("business_price_invalid");

  const timestamp = new Date(now).toISOString();
  const record: BusinessProductRecord = {
    product_record_id: `biz-prod-${randomUUID()}`,
    business_id: businessId,
    product_definition_id: productDefinitionId,
    display_name: product.label,
    price_ngn: priceNgn,
    available: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.businessProducts[record.product_record_id] = record;
  business.updated_at = timestamp;
  return record;
}

export function restockInventory(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  productDefinitionId: string,
  quantity: number,
  unitCostNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { inventory: BusinessInventoryRecord; movement: BusinessInventoryMovementRecord; cost_transaction: BusinessTransactionRecord | null } {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner", "manager", "inventory_manager"]);

  const product = catalog.business_products.find((p) => p.id === productDefinitionId);
  if (!product) throw new Error("business_product_not_found");

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > catalog.rules.maximum_stock_per_product) throw new Error("business_stock_quantity_invalid");
  if (!Number.isSafeInteger(unitCostNgn) || unitCostNgn < 0) throw new Error("business_stock_cost_invalid");

  const existing = Object.values(state.businessInventory).find((inv) => inv.business_id === businessId && inv.product_definition_id === productDefinitionId && inv.location_id === business.primary_location_id);
  const timestamp = new Date(now).toISOString();
  let inventory: BusinessInventoryRecord;

  if (existing) {
    const newQuantity = existing.quantity + quantity;
    if (newQuantity > catalog.rules.maximum_stock_per_product) throw new Error("business_stock_limit_exceeded");
    existing.unit_cost_ngn = quantity > 0 ? Math.floor((existing.unit_cost_ngn * existing.quantity + unitCostNgn * quantity) / newQuantity) : existing.unit_cost_ngn;
    existing.quantity = newQuantity;
    existing.updated_at = timestamp;
    inventory = existing;
  } else {
    inventory = {
      inventory_id: `biz-inv-${randomUUID()}`,
      business_id: businessId,
      product_definition_id: productDefinitionId,
      location_id: business.primary_location_id,
      quantity,
      unit_cost_ngn: unitCostNgn,
      reorder_threshold: catalog.rules.minimum_stock_reorder_threshold,
      updated_at: timestamp,
    };
    state.businessInventory[inventory.inventory_id] = inventory;
  }

  const movement: BusinessInventoryMovementRecord = {
    movement_id: `biz-mov-${randomUUID()}`,
    business_id: businessId,
    inventory_id: inventory.inventory_id,
    product_definition_id: productDefinitionId,
    kind: "restock",
    quantity,
    location_id: business.primary_location_id,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: null,
    description: `Restocked ${quantity} × ${product.label}.`,
  };
  state.businessInventoryMovements[movement.movement_id] = movement;

  let costTransaction: BusinessTransactionRecord | null = null;
  const totalCost = unitCostNgn * quantity;
  if (totalCost > 0) {
    if (business.balance_ngn < totalCost) throw new Error("business_insufficient_funds");
    const idemKey = createHash("sha256").update(`biz-restock:${inventory.inventory_id}:${timestamp}`).digest("hex");
    costTransaction = postBusinessTransaction(state, businessId, "purchase_stock", totalCost,
      `Purchased ${quantity} × ${product.label} at ₦${unitCostNgn} each.`, date, minuteOfDay, now, idemKey);
  }

  business.updated_at = timestamp;
  return { inventory, movement, cost_transaction: costTransaction };
}

export function sellProduct(
  state: PersistentWorldState,
  businessId: string,
  productRecordId: string,
  buyerCharacterId: string | null,
  quantity: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { sale: BusinessSaleRecord; revenue_transaction: BusinessTransactionRecord } {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);

  const productRecord = state.businessProducts[productRecordId];
  if (!productRecord || productRecord.business_id !== businessId) throw new Error("business_product_not_found");
  if (!productRecord.available) throw new Error("business_product_unavailable");

  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("business_sale_quantity_invalid");

  const inventory = Object.values(state.businessInventory).find((inv) =>
    inv.business_id === businessId && inv.product_definition_id === productRecord.product_definition_id && inv.location_id === business.primary_location_id);
  if (!inventory || inventory.quantity < quantity) throw new Error("business_insufficient_stock");

  const totalRevenue = productRecord.price_ngn * quantity;
  const timestamp = new Date(now).toISOString();

  inventory.quantity -= quantity;
  inventory.updated_at = timestamp;

  const movement: BusinessInventoryMovementRecord = {
    movement_id: `biz-mov-${randomUUID()}`,
    business_id: businessId,
    inventory_id: inventory.inventory_id,
    product_definition_id: productRecord.product_definition_id,
    kind: "sale",
    quantity,
    location_id: business.primary_location_id,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: productRecordId,
    description: `Sold ${quantity} units.`,
  };
  state.businessInventoryMovements[movement.movement_id] = movement;

  const idemKey = createHash("sha256").update(`biz-sale:${productRecordId}:${quantity}:${timestamp}`).digest("hex");
  const revenueTx = postBusinessTransaction(state, businessId, "sale_product", totalRevenue,
    `Sale of ${quantity} × ${productRecord.display_name} at ₦${productRecord.price_ngn} each.`,
    date, minuteOfDay, now, idemKey, productRecordId, buyerCharacterId);

  const sale: BusinessSaleRecord = {
    sale_id: `biz-sale-${randomUUID()}`,
    business_id: businessId,
    product_record_id: productRecordId,
    product_definition_id: productRecord.product_definition_id,
    buyer_character_id: buyerCharacterId,
    quantity,
    unit_price_ngn: productRecord.price_ngn,
    total_ngn: totalRevenue,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    is_service: false,
  };
  state.businessSales[sale.sale_id] = sale;

  business.reputation_score = Math.min(catalog.rules.maximum_reputation_score, business.reputation_score + 1);
  business.updated_at = timestamp;
  business.last_operating_date = cloneDate(date);

  return { sale, revenue_transaction: revenueTx };
}

export function sellService(
  state: PersistentWorldState,
  businessId: string,
  productRecordId: string,
  buyerCharacterId: string | null,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { sale: BusinessSaleRecord; revenue_transaction: BusinessTransactionRecord } {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);

  const productRecord = state.businessProducts[productRecordId];
  if (!productRecord || productRecord.business_id !== businessId) throw new Error("business_product_not_found");
  if (!productRecord.available) throw new Error("business_product_unavailable");

  const timestamp = new Date(now).toISOString();
  const idemKey = createHash("sha256").update(`biz-service-sale:${productRecordId}:${timestamp}`).digest("hex");
  const revenueTx = postBusinessTransaction(state, businessId, "sale_service", productRecord.price_ngn,
    `Service: ${productRecord.display_name} at ₦${productRecord.price_ngn}.`,
    date, minuteOfDay, now, idemKey, productRecordId, buyerCharacterId);

  const sale: BusinessSaleRecord = {
    sale_id: `biz-sale-${randomUUID()}`,
    business_id: businessId,
    product_record_id: productRecordId,
    product_definition_id: productRecord.product_definition_id,
    buyer_character_id: buyerCharacterId,
    quantity: 1,
    unit_price_ngn: productRecord.price_ngn,
    total_ngn: productRecord.price_ngn,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    is_service: true,
  };
  state.businessSales[sale.sale_id] = sale;

  business.reputation_score = Math.min(catalog.rules.maximum_reputation_score, business.reputation_score + 1);
  business.updated_at = timestamp;
  business.last_operating_date = cloneDate(date);

  return { sale, revenue_transaction: revenueTx };
}

export function contributeCapital(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessTransactionRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner"]);
  if (business.status === "closed") throw new Error("business_not_active");

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1 || amountNgn > catalog.rules.maximum_capital_contribution_ngn) {
    throw new Error("business_contribution_amount_invalid");
  }

  const cashAccount = Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId);
  if (!cashAccount) throw new Error("business_no_cash_account");
  const available = cashAccount.balance_ngn;
  if (available < amountNgn) throw new Error("business_insufficient_funds");

  const timestamp = new Date(now).toISOString();
  cashAccount.balance_ngn -= amountNgn;
  cashAccount.total_withdrawn_ngn += amountNgn;
  cashAccount.updated_at = timestamp;

  const idemKey = createHash("sha256").update(`biz-capital-contrib:${businessId}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, "capital_contribution", amountNgn,
    "Capital contribution from owner.", date, minuteOfDay, now, idemKey, null, characterId);

  appendBusinessEvent(state, businessId, "capital_contribution",
    `Owner contributed ₦${amountNgn.toLocaleString("en-NG")}.`, date, minuteOfDay, now,
    { amount_ngn: amountNgn, contributor_id: characterId });

  return tx;
}

export function withdrawFromBusiness(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessTransactionRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner"]);
  if (business.status === "closed") throw new Error("business_not_active");

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1 || amountNgn > catalog.rules.maximum_owner_withdrawal_ngn) {
    throw new Error("business_withdrawal_amount_invalid");
  }
  if (business.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");

  const cashAccount = Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId);
  if (!cashAccount) throw new Error("business_no_cash_account");

  const economyCatalog = loadEconomyCatalog();
  if (cashAccount.balance_ngn + amountNgn > economyCatalog.rules.maximum_account_balance_ngn) {
    throw new Error("business_withdrawal_balance_limit");
  }

  const timestamp = new Date(now).toISOString();
  const idemKey = createHash("sha256").update(`biz-withdrawal:${businessId}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, "owner_withdrawal", amountNgn,
    "Authorized owner withdrawal.", date, minuteOfDay, now, idemKey, null, characterId);

  cashAccount.balance_ngn += amountNgn;
  cashAccount.total_deposited_ngn += amountNgn;
  cashAccount.updated_at = timestamp;

  appendBusinessEvent(state, businessId, "owner_withdrawal",
    `Owner withdrew ₦${amountNgn.toLocaleString("en-NG")}.`, date, minuteOfDay, now,
    { amount_ngn: amountNgn, owner_id: characterId });

  return tx;
}

export function recordBusinessExpense(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  kind: string,
  amountNgn: number,
  description: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): BusinessTransactionRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner", "manager", "accountant"]);

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1) throw new Error("business_expense_amount_invalid");
  if (business.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");
  if (description.trim().length === 0 || description.length > 300) throw new Error("business_expense_description_invalid");

  const txKind: BusinessTransactionKind = kind === "rent" ? "expense_rent" : kind === "salary" ? "expense_salary" : "expense_operating";
  const timestamp = new Date(now).toISOString();
  const idemKey = createHash("sha256").update(`biz-expense:${businessId}:${kind}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, txKind, amountNgn,
    description.trim(), date, minuteOfDay, now, idemKey);

  appendBusinessEvent(state, businessId, "expense_recorded",
    `Recorded ${kind} expense of ₦${amountNgn.toLocaleString("en-NG")}.`, date, minuteOfDay, now,
    { kind, amount_ngn: amountNgn });

  return tx;
}

export function runProduction(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  recipeId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessProductionRunRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner", "manager"]);

  const template = catalog.templates.find((t) => t.id === business.template_id);
  if (!template || !template.requires_production) throw new Error("business_production_not_supported");
  if (!template.production_recipes.includes(recipeId)) throw new Error("business_recipe_not_available");

  const recipe = catalog.production_recipes.find((r) => r.id === recipeId);
  if (!recipe || !recipe.active) throw new Error("business_recipe_not_found");

  for (const input of recipe.inputs) {
    const inventory = Object.values(state.businessInventory).find((inv) =>
      inv.business_id === businessId && inv.product_definition_id === input.product_id && inv.location_id === business.primary_location_id);
    if (!inventory || inventory.quantity < input.quantity) throw new Error("business_insufficient_input_stock");
  }

  if (recipe.operating_cost_ngn > 0 && business.balance_ngn < recipe.operating_cost_ngn) {
    throw new Error("business_insufficient_funds");
  }

  const timestamp = new Date(now).toISOString();
  const inputMovementIds: string[] = [];

  for (const input of recipe.inputs) {
    const inventory = Object.values(state.businessInventory).find((inv) =>
      inv.business_id === businessId && inv.product_definition_id === input.product_id && inv.location_id === business.primary_location_id)!;
    inventory.quantity -= input.quantity;
    inventory.updated_at = timestamp;
    const movement: BusinessInventoryMovementRecord = {
      movement_id: `biz-mov-${randomUUID()}`,
      business_id: businessId,
      inventory_id: inventory.inventory_id,
      product_definition_id: input.product_id,
      kind: "production_input",
      quantity: input.quantity,
      location_id: business.primary_location_id,
      world_date: cloneDate(date),
      minute_of_day: minuteOfDay,
      posted_at: timestamp,
      reference_id: recipeId,
      description: `Consumed in production: ${recipe.label}.`,
    };
    state.businessInventoryMovements[movement.movement_id] = movement;
    inputMovementIds.push(movement.movement_id);
  }

  const outputInventory = Object.values(state.businessInventory).find((inv) =>
    inv.business_id === businessId && inv.product_definition_id === recipe.output_product_id && inv.location_id === business.primary_location_id);
  let outputMovementId: string | null = null;

  if (outputInventory) {
    const newQty = outputInventory.quantity + recipe.output_quantity;
    if (newQty <= catalog.rules.maximum_stock_per_product) {
      outputInventory.quantity = newQty;
      outputInventory.updated_at = timestamp;
      const movement: BusinessInventoryMovementRecord = {
        movement_id: `biz-mov-${randomUUID()}`,
        business_id: businessId,
        inventory_id: outputInventory.inventory_id,
        product_definition_id: recipe.output_product_id,
        kind: "production_output",
        quantity: recipe.output_quantity,
        location_id: business.primary_location_id,
        world_date: cloneDate(date),
        minute_of_day: minuteOfDay,
        posted_at: timestamp,
        reference_id: recipeId,
        description: `Produced: ${recipe.label}.`,
      };
      state.businessInventoryMovements[movement.movement_id] = movement;
      outputMovementId = movement.movement_id;
    }
  } else {
    const inv: BusinessInventoryRecord = {
      inventory_id: `biz-inv-${randomUUID()}`,
      business_id: businessId,
      product_definition_id: recipe.output_product_id,
      location_id: business.primary_location_id,
      quantity: recipe.output_quantity,
      unit_cost_ngn: 0,
      reorder_threshold: catalog.rules.minimum_stock_reorder_threshold,
      updated_at: timestamp,
    };
    state.businessInventory[inv.inventory_id] = inv;
    const movement: BusinessInventoryMovementRecord = {
      movement_id: `biz-mov-${randomUUID()}`,
      business_id: businessId,
      inventory_id: inv.inventory_id,
      product_definition_id: recipe.output_product_id,
      kind: "production_output",
      quantity: recipe.output_quantity,
      location_id: business.primary_location_id,
      world_date: cloneDate(date),
      minute_of_day: minuteOfDay,
      posted_at: timestamp,
      reference_id: recipeId,
      description: `Produced: ${recipe.label}.`,
    };
    state.businessInventoryMovements[movement.movement_id] = movement;
    outputMovementId = movement.movement_id;
  }

  if (recipe.operating_cost_ngn > 0) {
    const idemKey = createHash("sha256").update(`biz-production:${businessId}:${recipeId}:${timestamp}`).digest("hex");
    postBusinessTransaction(state, businessId, "production_cost", recipe.operating_cost_ngn,
      `Production cost: ${recipe.label}.`, date, minuteOfDay, now, idemKey);
  }

  const run: BusinessProductionRunRecord = {
    run_id: `biz-run-${randomUUID()}`,
    business_id: businessId,
    recipe_id: recipeId,
    output_product_id: recipe.output_product_id,
    output_quantity: recipe.output_quantity,
    operating_cost_ngn: recipe.operating_cost_ngn,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    completed: true,
    input_movements: inputMovementIds,
    output_movement_id: outputMovementId,
  };
  state.businessProductionRuns[run.run_id] = run;

  appendBusinessEvent(state, businessId, "production_completed",
    `Production completed: ${recipe.label} (×${recipe.output_quantity}).`, date, minuteOfDay, now,
    { recipe_id: recipeId, output_quantity: recipe.output_quantity, operating_cost_ngn: recipe.operating_cost_ngn });

  business.updated_at = timestamp;
  business.last_operating_date = cloneDate(date);
  return run;
}

export function closeBusiness(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  reason: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): BusinessRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner"]);
  if (business.status === "closed") throw new Error("business_already_closed");

  const timestamp = new Date(now).toISOString();
  business.status = "closed";
  business.closed_at = timestamp;
  business.closed_world_date = cloneDate(date);
  business.closure_reason = reason.trim().length > 0 ? reason.trim() : "Owner closed the business.";
  business.updated_at = timestamp;

  for (const product of Object.values(state.businessProducts)) {
    if (product.business_id === businessId) {
      product.available = false;
      product.updated_at = timestamp;
    }
  }

  appendBusinessEvent(state, businessId, "business_closed",
    `Business '${business.name}' was closed.`, date, minuteOfDay, now,
    { reason: business.closure_reason });

  return business;
}

export function addBranch(
  state: PersistentWorldState,
  businessId: string,
  characterId: string,
  name: string,
  locationId: string,
  premisesType: BusinessPremisesType,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessBranchRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  authorizeBusinessAction(state, businessId, characterId, ["owner", "co_owner"]);
  if (business.status !== "active") throw new Error("business_not_active");

  const existingBranches = Object.values(state.businessBranches).filter((b) => b.business_id === businessId && b.status === "active");
  if (existingBranches.length >= catalog.rules.maximum_branches_per_business) {
    throw new Error("business_branch_limit_reached");
  }

  const template = catalog.templates.find((t) => t.id === business.template_id);
  if (!template) throw new Error("business_template_not_found");

  const branchName = name.normalize("NFC").trim();
  if (branchName.length < 1 || branchName.length > 120) throw new Error("business_branch_name_invalid");

  const branch: BusinessBranchRecord = {
    branch_id: `biz-branch-${randomUUID()}`,
    business_id: businessId,
    name: branchName,
    location_id: locationId,
    premises_type: premisesType,
    status: "active",
    created_at: new Date(now).toISOString(),
    created_world_date: cloneDate(date),
    updated_at: new Date(now).toISOString(),
  };
  state.businessBranches[branch.branch_id] = branch;
  business.updated_at = new Date(now).toISOString();

  appendBusinessEvent(state, businessId, "branch_opened",
    `Branch '${branch.name}' opened at ${locationId}.`, date, minuteOfDay, now,
    { branch_id: branch.branch_id, location_id: locationId, premises_type: premisesType });

  return branch;
}

export function transferOwnership(
  state: PersistentWorldState,
  businessId: string,
  fromCharacterId: string,
  toCharacterId: string,
  newRole: BusinessOwnershipRole,
  sharePercent: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): { ownership: BusinessOwnershipRecord; previous: BusinessOwnershipRecord } {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  if (business.status === "closed") throw new Error("business_closed");
  authorizeBusinessAction(state, businessId, fromCharacterId, ["owner"]);

  const fromOwnership = ownershipForCharacterAndBusiness(state, businessId, fromCharacterId);
  if (!fromOwnership) throw new Error("business_not_owner");
  if (fromOwnership.role !== "owner") throw new Error("business_transfer_requires_owner");

  if (fromCharacterId === toCharacterId) throw new Error("business_transfer_same_character");
  if (sharePercent < 0 || sharePercent > 100) throw new Error("business_share_invalid");
  if (!["owner", "co_owner", "manager", "accountant", "inventory_manager", "employee"].includes(newRole)) {
    throw new Error("business_role_invalid");
  }

  const toPlayer = characterForId(state, toCharacterId);
  if (!toPlayer) throw new Error("business_transfer_character_not_found");

  const timestamp = new Date(now).toISOString();

  // Deactivate the original owner's ownership
  fromOwnership.active = false;
  fromOwnership.updated_at = timestamp;

  // Create new ownership for the recipient
  const newOwnership: BusinessOwnershipRecord = {
    ownership_id: `biz-own-${randomUUID()}`,
    business_id: businessId,
    character_id: toCharacterId,
    role: newRole,
    share_percent: sharePercent,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    is_founder: false,
    active: true,
  };
  state.businessOwnership[newOwnership.ownership_id] = newOwnership;
  business.updated_at = timestamp;

  appendBusinessEvent(state, businessId, "ownership_transferred",
    `Ownership transferred from ${fromCharacterId} to ${toCharacterId} (${newRole}, ${sharePercent}%).`,
    date, minuteOfDay, now,
    { from_character_id: fromCharacterId, to_character_id: toCharacterId, new_role: newRole, share_percent: sharePercent });

  return { ownership: newOwnership, previous: fromOwnership };
}

export function hireEmployee(
  state: PersistentWorldState,
  businessId: string,
  employerCharacterId: string,
  employeeCharacterId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessOwnershipRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  if (business.status !== "active") throw new Error("business_not_active");
  authorizeBusinessAction(state, businessId, employerCharacterId, ["owner", "co_owner", "manager"]);

  const template = catalog.templates.find((t) => t.id === business.template_id);
  if (!template) throw new Error("business_template_not_found");

  const currentEmployees = countEmployeesForBusiness(state, businessId);
  if (currentEmployees >= template.maximum_employees) {
    throw new Error("business_employee_limit_reached");
  }

  const employeePlayer = characterForId(state, employeeCharacterId);
  if (!employeePlayer) throw new Error("business_employee_not_found");
  if (employeePlayer.character.character_id === employerCharacterId) {
    throw new Error("business_employee_is_owner");
  }

  // Check if already employed at this business
  const existingEmployment = Object.values(state.businessOwnership).find(
    (o) => o.business_id === businessId && o.character_id === employeeCharacterId && o.active,
  );
  if (existingEmployment) throw new Error("business_employee_already_employed");

  const timestamp = new Date(now).toISOString();
  const employment: BusinessOwnershipRecord = {
    ownership_id: `biz-own-${randomUUID()}`,
    business_id: businessId,
    character_id: employeeCharacterId,
    role: "employee",
    share_percent: 0,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    is_founder: false,
    active: true,
  };
  state.businessOwnership[employment.ownership_id] = employment;
  business.updated_at = timestamp;

  appendBusinessEvent(state, businessId, "employee_hired",
    `Employee ${employeeCharacterId} hired.`, date, minuteOfDay, now,
    { employee_character_id: employeeCharacterId, employer_character_id: employerCharacterId });

  return employment;
}

export function fireEmployee(
  state: PersistentWorldState,
  businessId: string,
  managerCharacterId: string,
  employeeCharacterId: string,
  reason: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): BusinessOwnershipRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  authorizeBusinessAction(state, businessId, managerCharacterId, ["owner", "co_owner", "manager"]);

  const employment = Object.values(state.businessOwnership).find(
    (o) => o.business_id === businessId && o.character_id === employeeCharacterId && o.active && o.role === "employee",
  );
  if (!employment) throw new Error("business_employee_not_found");

  const timestamp = new Date(now).toISOString();
  employment.active = false;
  employment.updated_at = timestamp;
  business.updated_at = timestamp;

  appendBusinessEvent(state, businessId, "employee_fired",
    `Employee ${employeeCharacterId} was let go. ${reason.trim()}`.trim(), date, minuteOfDay, now,
    { employee_character_id: employeeCharacterId, manager_character_id: managerCharacterId, reason: reason.trim() });

  return employment;
}

export function seedNpcBusinesses(
  state: PersistentWorldState,
  npcCharacterIds: string[],
  date: CalendarDate,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessRecord[] {
  const seeded: BusinessRecord[] = [];
  const activeTemplates = catalog.templates.filter((t) => t.active);
  if (activeTemplates.length === 0 || npcCharacterIds.length === 0) return seeded;

  for (const npcId of npcCharacterIds) {
    // Each NPC gets at most one business
    const existingNpcBusiness = Object.values(state.businesses).find(
      (b) => Object.values(state.businessOwnership).some(
        (o) => o.business_id === b.business_id && o.character_id === npcId && o.active && o.role === "owner",
      ),
    );
    if (existingNpcBusiness) continue;

    const template = activeTemplates[Math.floor(Math.random() * activeTemplates.length)];
    if (!template) continue;
    const businessId = `biz-${randomUUID()}`;
    const timestamp = new Date(now).toISOString();
    const business: BusinessRecord = {
      business_id: businessId,
      name: `${template.label} (${npcId.slice(0, 8)})`,
      description: template.description,
      template_id: template.id,
      category_id: template.category_id,
      model: template.model,
      status: "active",
      primary_location_id: "npc-world-location",
      premises_type: template.default_premises,
      reputation_score: catalog.rules.starting_reputation_score,
      total_revenue_ngn: 0,
      total_expenses_ngn: 0,
      total_capital_ngn: template.setup_cost_ngn * 3,
      total_withdrawals_ngn: 0,
      balance_ngn: template.setup_cost_ngn * 3,
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
      last_operating_date: cloneDate(date),
      owner_character_id: npcId,
      closed_at: null,
      closed_world_date: null,
      closure_reason: null,
    };
    state.businesses[businessId] = business;

    const ownership: BusinessOwnershipRecord = {
      ownership_id: `biz-own-${randomUUID()}`,
      business_id: businessId,
      character_id: npcId,
      role: "owner",
      share_percent: 100,
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
      is_founder: true,
      active: true,
    };
    state.businessOwnership[ownership.ownership_id] = ownership;

    // Seed with initial products from the business product catalogue
    const allProducts = [...catalog.business_products];
    // Prefer products matching the template model (services for service businesses, goods for retail/production)
    let seedProducts: typeof allProducts;
    if (template.model === "service") {
      seedProducts = allProducts.filter((p) => p.category === "service");
      if (seedProducts.length === 0) seedProducts = allProducts.slice(0, 3);
    } else if (template.model === "food_service") {
      seedProducts = allProducts.filter((p) => p.category === "food");
      if (seedProducts.length === 0) seedProducts = allProducts.slice(0, 3);
    } else {
      seedProducts = allProducts.filter((p) => p.category !== "service").length > 0
        ? allProducts.filter((p) => p.category !== "service")
        : allProducts;
    }
    const seededProducts = seedProducts.slice(0, 5);
    for (const productDef of seededProducts) {
      const productId = `biz-prod-${randomUUID()}`;
      const product: BusinessProductRecord = {
        product_record_id: productId,
        business_id: businessId,
        product_definition_id: productDef.id,
        display_name: productDef.label,
        price_ngn: productDef.base_price_ngn,
        available: template.model === "service",
        created_at: timestamp,
        updated_at: timestamp,
      };
      state.businessProducts[productId] = product;
    }

    appendBusinessEvent(state, businessId, "business_created",
      `NPC business '${business.name}' was created.`, date, 0, now,
      { template_id: template.id, owner_character_id: npcId, is_npc: true });

    seeded.push(business);
  }
  return seeded;
}

export function processBusinessWorldDate(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): number {
  let operatingCount = 0;
  for (const business of Object.values(state.businesses)) {
    if (business.status !== "active") continue;
    const isSameDay = business.last_operating_date !== null &&
      business.last_operating_date.year === date.year &&
      business.last_operating_date.month === date.month &&
      business.last_operating_date.day === date.day;
    if (isSameDay) continue;
    const template = catalog.templates.find((t) => t.id === business.template_id);
    if (!template) continue;
    const dailyCost = Math.floor((template.monthly_operating_cost_ngn + template.rent_cost_ngn) / 30);
    if (dailyCost <= 0) continue;
    if (business.balance_ngn < dailyCost) {
      business.status = "insolvent";
      business.updated_at = new Date(now).toISOString();
      appendBusinessEvent(state, business.business_id, "business_insolvent",
        `Business '${business.name}' has become insolvent due to insufficient funds for operating costs.`, date, 0, now,
        { daily_cost_ngn: dailyCost, balance_ngn: business.balance_ngn });
      continue;
    }
    business.balance_ngn -= dailyCost;
    business.total_expenses_ngn += dailyCost;
    business.updated_at = new Date(now).toISOString();
    const idemKey = createHash("sha256").update(`biz-daily-cost:${business.business_id}:${date.year}:${date.month}:${date.day}`).digest("hex");
    const existing = Object.values(state.businessTransactions).find((tx) => tx.idempotency_key === idemKey);
    if (!existing) {
      postBusinessTransaction(state, business.business_id, "expense_operating", dailyCost,
        "Daily operating and premises cost.", date, 0, now, idemKey);
    }
    operatingCount += 1;
  }
  return operatingCount;
}

export function buildBusinessProfile(
  state: PersistentWorldState,
  businessId: string,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessProfileSnapshot {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  const template = catalog.templates.find((t) => t.id === business.template_id);
  const category = catalog.categories.find((c) => c.id === business.category_id);
  const owners = Object.values(state.businessOwnership).filter((o) => o.business_id === businessId && o.active);
  const branches = Object.values(state.businessBranches).filter((b) => b.business_id === businessId);
  const products = Object.values(state.businessProducts).filter((p) => p.business_id === businessId);
  const inventory = Object.values(state.businessInventory).filter((inv) => inv.business_id === businessId);
  const transactions = Object.values(state.businessTransactions).filter((tx) => tx.business_id === businessId)
    .sort((left, right) => right.posted_at.localeCompare(left.posted_at)).slice(0, 100);
  const sales = Object.values(state.businessSales).filter((s) => s.business_id === businessId)
    .sort((left, right) => right.posted_at.localeCompare(left.posted_at)).slice(0, 100);
  const events = Object.values(state.businessEvents).filter((e) => e.business_id === businessId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 50);
  const pendingExpenses = Object.values(state.businessExpenses).filter((e) => e.business_id === businessId && !e.paid);

  return {
    schema_version: 1,
    business_id: businessId,
    name: business.name,
    description: business.description,
    template_id: business.template_id,
    template_label: template?.label ?? business.template_id,
    category_id: business.category_id,
    category_label: category?.label ?? business.category_id,
    model: business.model,
    status: business.status,
    primary_location_id: business.primary_location_id,
    premises_type: business.premises_type,
    reputation_score: business.reputation_score,
    balance_ngn: business.balance_ngn,
    total_revenue_ngn: business.total_revenue_ngn,
    total_expenses_ngn: business.total_expenses_ngn,
    total_capital_ngn: business.total_capital_ngn,
    total_withdrawals_ngn: business.total_withdrawals_ngn,
    owners,
    branches,
    products,
    inventory,
    recent_transactions: transactions,
    recent_sales: sales,
    recent_events: events,
    pending_expenses: pendingExpenses,
  };
}

export function discoverBusinesses(
  state: PersistentWorldState,
  locationId: string | null,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessDiscoveryEntry[] {
  return Object.values(state.businesses)
    .filter((biz) => biz.status === "active" && (locationId === null || biz.primary_location_id === locationId))
    .map((biz) => {
      const template = catalog.templates.find((t) => t.id === biz.template_id);
      const category = catalog.categories.find((c) => c.id === biz.category_id);
      const productCount = Object.values(state.businessProducts).filter((p) => p.business_id === biz.business_id && p.available).length;
      const employeeCount = countEmployeesForBusiness(state, biz.business_id);
      return {
        business_id: biz.business_id,
        name: biz.name,
        description: biz.description,
        template_id: biz.template_id,
        template_label: template?.label ?? biz.template_id,
        category_id: biz.category_id,
        category_label: category?.label ?? biz.category_id,
        model: biz.model,
        status: biz.status,
        location_id: biz.primary_location_id,
        reputation_score: biz.reputation_score,
        product_count: productCount,
        employee_count: employeeCount,
      };
    })
    .sort((left, right) => right.reputation_score - left.reputation_score);
}

export function businessErrorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    business_character_not_found: "Your character record is not available in this world.",
    business_character_deceased: "Deceased characters cannot operate businesses.",
    business_template_not_found: "That business template is not available.",
    business_owner_age_ineligible: "Your character does not meet the minimum age requirement for this business.",
    business_location_invalid: "The selected location is not eligible for this business type.",
    business_limit_reached: "You have reached the maximum number of businesses.",
    business_name_invalid: "The business name is invalid or outside the allowed length.",
    business_description_invalid: "The business description is invalid or outside the allowed length.",
    business_insufficient_funds: "The business or your personal account does not have enough funds.",
    business_no_cash_account: "No cash account is available for this character.",
    business_not_found: "That business does not exist.",
    business_not_active: "That business is not currently active.",
    business_already_closed: "That business has already been closed.",
    business_unauthorized: "You are not authorized to perform this action on the business.",
    business_product_not_found: "That product is not available in the catalogue.",
    business_product_unavailable: "That product is not currently available for sale.",
    business_product_limit_reached: "The business has reached its product limit.",
    business_price_invalid: "The price is outside the permitted range.",
    business_stock_quantity_invalid: "The stock quantity is invalid.",
    business_stock_cost_invalid: "The unit cost is invalid.",
    business_stock_limit_exceeded: "Adding this stock would exceed the maximum stock limit.",
    business_sale_quantity_invalid: "The sale quantity is invalid.",
    business_insufficient_stock: "There is not enough stock to complete this sale.",
    business_contribution_amount_invalid: "The capital contribution amount is outside the allowed range.",
    business_withdrawal_amount_invalid: "The withdrawal amount is outside the allowed range.",
    business_withdrawal_balance_limit: "The destination cash account cannot accept this withdrawal.",
    business_expense_amount_invalid: "The expense amount is invalid.",
    business_expense_description_invalid: "The expense description is invalid.",
    business_production_not_supported: "This business type does not support production.",
    business_recipe_not_available: "This recipe is not available for this business type.",
    business_recipe_not_found: "That production recipe is not available.",
    business_insufficient_input_stock: "There is not enough input stock for this production run.",
  };
  return messages[code] ?? economyErrorMessage(code) ?? "The business request could not be completed.";
}
