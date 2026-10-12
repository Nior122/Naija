import { createHash, randomUUID } from "node:crypto";
import { loadEconomyCatalog } from "../economy/catalog.js";
import { accountKey, economyErrorMessage, syncCharacterCashFromEconomy } from "../economy/service.js";
import type { EconomyAccountRecord, EconomyCatalog, EconomyTransactionKind, EconomyTransactionRecord } from "../economy/types.js";
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

/** Stage 40: the suffix that names a business's own account (see docs/STAGE_40_BUSINESS_ACCOUNTS.md, section 2.1). */
const BUSINESS_ACCOUNT_SUFFIX = "business";

/** Stage 40: the key of the economy account that holds a business's money. */
export function businessAccountKey(businessId: string): string {
  return accountKey(businessId, "current", BUSINESS_ACCOUNT_SUFFIX);
}

/** Stage 40: the business's account. Refuses when the account is missing, so no money moves without one. */
export function businessAccountFor(state: PersistentWorldState, businessId: string): EconomyAccountRecord {
  const account = state.economyAccounts[businessAccountKey(businessId)];
  if (!account || account.kind !== "current" || account.character_id !== businessId) throw new Error("business_account_missing");
  return account;
}

function cashAccountFor(state: PersistentWorldState, characterId: string): EconomyAccountRecord | undefined {
  return Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId);
}

/**
 * Stage 40: opens the business's account if it does not exist. The account is an economy account with no bank product,
 * so the economy's interest and fee processing skip it.
 */
export function openBusinessAccount(state: PersistentWorldState, businessId: string, date: CalendarDate, now: number): EconomyAccountRecord {
  const key = businessAccountKey(businessId);
  const existing = state.economyAccounts[key];
  if (existing) return existing;
  const timestamp = new Date(now).toISOString();
  const account: EconomyAccountRecord = {
    account_id: key,
    character_id: businessId,
    kind: "current",
    bank_product_id: null,
    balance_ngn: 0,
    status: "active",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    opened_world_date: cloneDate(date),
    last_interest_date: null,
    last_fee_date: null,
    total_deposited_ngn: 0,
    total_withdrawn_ngn: 0,
    total_fees_paid_ngn: 0,
    total_interest_earned_ngn: 0,
    daily_withdrawal_total_ngn: 0,
    daily_withdrawal_date: null,
  };
  state.economyAccounts[key] = account;
  return account;
}

/** Stage 40: one side of a money move: the account, and the economy transaction kind written on that side. */
export interface BusinessMoneyLeg {
  readonly account: EconomyAccountRecord;
  readonly kind: EconomyTransactionKind;
}

/**
 * Stage 40: one money movement. A debit leaves `debit.account`, and a credit arrives in `credit.account`. Either side may
 * be null: a sink (a cost with no receiver) has no credit, and an issuance or import has no debit. Both sides are one
 * movement, so both ledger rows are written together, or neither is.
 */
export interface BusinessMoneyMove {
  readonly debit: BusinessMoneyLeg | null;
  readonly credit: BusinessMoneyLeg | null;
  readonly amountNgn: number;
  readonly description: string;
  readonly referenceId: string | null;
  readonly date: CalendarDate;
  readonly minuteOfDay: number;
  readonly now: number;
  readonly economyCatalog: EconomyCatalog;
}

/** Stage 40: the economy ledger rows written for one movement. */
export interface PostedBusinessMoney {
  readonly debit: EconomyTransactionRecord | null;
  readonly credit: EconomyTransactionRecord | null;
}

/**
 * Stage 40: the single path by which business code moves money. It checks everything first (both accounts active, funds,
 * the balance limit), and only then changes any balance. It writes one economy ledger row for each side, sets each
 * account's totals, refreshes a business's `balance_ngn` from its account, and refreshes a player's `money` from their
 * cash account. A refused movement changes nothing.
 */
export function postBusinessMoney(state: PersistentWorldState, move: BusinessMoneyMove): PostedBusinessMoney {
  const { debit, credit, amountNgn } = move;
  if (!debit && !credit) throw new Error("business_money_move_invalid");
  if (debit && credit && debit.account.account_id === credit.account.account_id) throw new Error("business_money_move_invalid");
  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1) throw new Error("business_amount_invalid");
  for (const leg of [debit, credit]) {
    if (leg && leg.account.status !== "active") throw new Error("economy_account_not_active");
  }
  if (debit && debit.account.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");
  if (credit && credit.account.balance_ngn + amountNgn > move.economyCatalog.rules.maximum_account_balance_ngn) {
    throw new Error("business_balance_limit");
  }

  const timestamp = new Date(move.now).toISOString();
  let debitRow: EconomyTransactionRecord | null = null;
  let creditRow: EconomyTransactionRecord | null = null;
  if (debit) {
    const before = debit.account.balance_ngn;
    debit.account.balance_ngn -= amountNgn;
    debit.account.total_withdrawn_ngn += amountNgn;
    debit.account.updated_at = timestamp;
    debitRow = recordLedgerRow(state, debit.account, debit.kind, "debit", amountNgn, before, move, credit?.account.account_id ?? null, timestamp);
  }
  if (credit) {
    const before = credit.account.balance_ngn;
    credit.account.balance_ngn += amountNgn;
    credit.account.total_deposited_ngn += amountNgn;
    credit.account.updated_at = timestamp;
    creditRow = recordLedgerRow(state, credit.account, credit.kind, "credit", amountNgn, before, move, debit?.account.account_id ?? null, timestamp);
  }
  for (const leg of [debit, credit]) {
    if (leg) refreshBalanceProjections(state, leg.account);
  }
  return { debit: debitRow, credit: creditRow };
}

function recordLedgerRow(
  state: PersistentWorldState,
  account: EconomyAccountRecord,
  kind: EconomyTransactionKind,
  direction: "debit" | "credit",
  amountNgn: number,
  balanceBefore: number,
  move: BusinessMoneyMove,
  counterpartyAccountId: string | null,
  timestamp: string,
): EconomyTransactionRecord {
  const transactionId = `economy-tx-${randomUUID()}`;
  const row: EconomyTransactionRecord = {
    transaction_id: transactionId,
    account_id: account.account_id,
    character_id: account.character_id,
    kind,
    amount_ngn: amountNgn,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: account.balance_ngn,
    fee_ngn: 0,
    description: move.description,
    world_date: cloneDate(move.date),
    minute_of_day: move.minuteOfDay,
    posted_at: timestamp,
    reference_id: move.referenceId,
    counterparty_account_id: counterpartyAccountId,
    // Unique for each row. A repeated request is stopped by the request gate, not by this key (STAGE_40 section 2.7).
    idempotency_key: createHash("sha256").update(`business-money:${kind}:${direction}:${account.account_id}:${transactionId}`).digest("hex"),
  };
  state.economyTransactions[transactionId] = row;
  return row;
}

/** Stage 40: a business's `balance_ngn` is a copy of its account; a player's `money` is a copy of their cash account. */
function refreshBalanceProjections(state: PersistentWorldState, account: EconomyAccountRecord): void {
  const business = state.businesses[account.character_id];
  if (account.kind === "current" && business && account.account_id === businessAccountKey(business.business_id)) {
    business.balance_ngn = account.balance_ngn;
  }
  if (account.kind === "cash") syncCharacterCashFromEconomy(state, account.character_id);
}

/**
 * Stage 40: the business journal. Each entry is a view of the ledger row on the business account that it names, and its
 * before and after balances are copied from that row. Totals are updated here, from the kind, so they are set in one
 * place.
 */
function postBusinessTransaction(
  state: PersistentWorldState,
  businessId: string,
  kind: BusinessTransactionKind,
  description: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  idempotencyKey: string,
  referenceId: string | null,
  counterpartyCharacterId: string | null,
  ledgerRow: EconomyTransactionRecord,
): BusinessTransactionRecord {
  const business = state.businesses[businessId]!;
  const tx: BusinessTransactionRecord = {
    transaction_id: `biz-tx-${randomUUID()}`,
    business_id: businessId,
    kind,
    amount_ngn: ledgerRow.amount_ngn,
    balance_before_ngn: ledgerRow.balance_before_ngn,
    balance_after_ngn: ledgerRow.balance_after_ngn,
    description,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: new Date(now).toISOString(),
    reference_id: referenceId,
    counterparty_character_id: counterpartyCharacterId,
    idempotency_key: idempotencyKey,
    economy_transaction_id: ledgerRow.transaction_id,
  };
  state.businessTransactions[tx.transaction_id] = tx;
  const amountNgn = tx.amount_ngn;
  if (kind === "sale_product" || kind === "sale_service") business.total_revenue_ngn += amountNgn;
  if (kind === "expense_operating" || kind === "expense_rent" || kind === "expense_salary" || kind === "production_cost" || kind === "salary_paid") {
    business.total_expenses_ngn += amountNgn;
  }
  if (kind === "capital_contribution" || kind === "seed_capital") business.total_capital_ngn += amountNgn;
  if (kind === "owner_withdrawal") business.total_withdrawals_ngn += amountNgn;
  business.updated_at = tx.posted_at;
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
  const cashAccount = cashAccountFor(state, characterId);
  if (!cashAccount) throw new Error("business_no_cash_account");
  if (cashAccount.status !== "active") throw new Error("economy_account_not_active");
  if (cashAccount.balance_ngn < setupCost + initialCapitalNgn) throw new Error("business_insufficient_funds");

  const economyCatalog = loadEconomyCatalog();
  const timestamp = new Date(now).toISOString();
  const businessId = `biz-${randomUUID()}`;

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

  const businessAccount = openBusinessAccount(state, businessId, date, now);

  // The setup fee is a sink: the owner pays the registration cost, and no account receives it.
  if (setupCost > 0) {
    postBusinessMoney(state, {
      debit: { account: cashAccount, kind: "business_setup_fee" }, credit: null, amountNgn: setupCost,
      description: "Registration and setup cost.", referenceId: businessId, date, minuteOfDay, now, economyCatalog,
    });
    appendBusinessEvent(state, businessId, "setup_cost_paid",
      `Registration and setup cost of ₦${setupCost.toLocaleString("en-NG")} paid by the owner.`, date, minuteOfDay, now,
      { setup_cost_ngn: setupCost });
  }

  if (initialCapitalNgn > 0) {
    const posted = postBusinessMoney(state, {
      debit: { account: cashAccount, kind: "business_capital" }, credit: { account: businessAccount, kind: "business_capital" },
      amountNgn: initialCapitalNgn, description: "Initial capital contribution from owner.", referenceId: businessId,
      date, minuteOfDay, now, economyCatalog,
    });
    const idemKey = createHash("sha256").update(`biz-capital:${businessId}:${timestamp}`).digest("hex");
    postBusinessTransaction(state, businessId, "capital_contribution", "Initial capital contribution from owner.",
      date, minuteOfDay, now, idemKey, null, characterId, posted.credit!);
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
  if (existing && existing.quantity + quantity > catalog.rules.maximum_stock_per_product) throw new Error("business_stock_limit_exceeded");

  // Stage 40: every check comes before any change. A cost the business cannot pay refuses the restock, and inventory is
  // left as it was. Before this stage, stock was changed first.
  const totalCost = unitCostNgn * quantity;
  const businessAccount = businessAccountFor(state, businessId);
  if (totalCost > 0 && businessAccount.balance_ngn < totalCost) throw new Error("business_insufficient_funds");
  if (totalCost > 0 && businessAccount.status !== "active") throw new Error("economy_account_not_active");

  const timestamp = new Date(now).toISOString();
  let inventory: BusinessInventoryRecord;

  if (existing) {
    const newQuantity = existing.quantity + quantity;
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
  if (totalCost > 0) {
    // The supplier cost is a sink: no supplier account exists (STAGE_40 section 5).
    const posted = postBusinessMoney(state, {
      debit: { account: businessAccount, kind: "business_expense" }, credit: null, amountNgn: totalCost,
      description: `Purchased ${quantity} × ${product.label} at ₦${unitCostNgn} each.`, referenceId: inventory.inventory_id,
      date, minuteOfDay, now, economyCatalog: loadEconomyCatalog(),
    });
    const idemKey = createHash("sha256").update(`biz-restock:${inventory.inventory_id}:${timestamp}`).digest("hex");
    costTransaction = postBusinessTransaction(state, businessId, "purchase_stock",
      `Purchased ${quantity} × ${product.label} at ₦${unitCostNgn} each.`, date, minuteOfDay, now, idemKey,
      inventory.inventory_id, null, posted.debit!);
  }

  business.updated_at = timestamp;
  return { inventory, movement, cost_transaction: costTransaction };
}

/**
 * Stage 40: the only way a business earns revenue. A buyer pays from their own cash account, and the business account is
 * credited in the same movement. The buyer is the character the caller authenticated as. Nothing in the payload can
 * name someone else as the payer.
 */
function purchaseFromBusiness(
  state: PersistentWorldState,
  businessId: string,
  productRecordId: string,
  buyerCharacterId: string,
  quantity: number,
  isService: boolean,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog,
): { sale: BusinessSaleRecord; revenue_transaction: BusinessTransactionRecord } {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);

  const productRecord = state.businessProducts[productRecordId];
  if (!productRecord || productRecord.business_id !== businessId) throw new Error("business_product_not_found");
  if (!productRecord.available) throw new Error("business_product_unavailable");

  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("business_sale_quantity_invalid");
  if (isService && quantity !== 1) throw new Error("business_sale_quantity_invalid");

  const buyer = characterForId(state, buyerCharacterId);
  if (!buyer) throw new Error("business_character_not_found");
  if (buyer.character.life_status === "deceased") throw new Error("business_character_deceased");
  const ownsBusiness = Object.values(state.businessOwnership).some((o) =>
    o.business_id === businessId && o.active && o.character_id === buyerCharacterId && (o.role === "owner" || o.role === "co_owner"));
  if (ownsBusiness) throw new Error("business_self_purchase");

  const inventory = isService ? undefined : Object.values(state.businessInventory).find((inv) =>
    inv.business_id === businessId && inv.product_definition_id === productRecord.product_definition_id && inv.location_id === business.primary_location_id);
  if (!isService && (!inventory || inventory.quantity < quantity)) throw new Error("business_insufficient_stock");

  const totalRevenue = productRecord.price_ngn * quantity;
  const buyerCash = cashAccountFor(state, buyerCharacterId);
  if (!buyerCash) throw new Error("business_no_cash_account");
  if (buyerCash.balance_ngn < totalRevenue) throw new Error("business_insufficient_funds");
  const businessAccount = businessAccountFor(state, businessId);

  const timestamp = new Date(now).toISOString();
  const description = isService
    ? `Service: ${productRecord.display_name} at ₦${productRecord.price_ngn}.`
    : `Sale of ${quantity} × ${productRecord.display_name} at ₦${productRecord.price_ngn} each.`;

  // The money moves first, so that a refusal (funds, limits, a closed account) changes no stock.
  const posted = postBusinessMoney(state, {
    debit: { account: buyerCash, kind: "business_purchase" }, credit: { account: businessAccount, kind: "business_sale" },
    amountNgn: totalRevenue, description, referenceId: productRecordId, date, minuteOfDay, now, economyCatalog: loadEconomyCatalog(),
  });

  if (inventory) {
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
  }

  const idemKey = createHash("sha256").update(`biz-purchase:${productRecordId}:${buyerCharacterId}:${timestamp}`).digest("hex");
  const revenueTx = postBusinessTransaction(state, businessId, isService ? "sale_service" : "sale_product", description,
    date, minuteOfDay, now, idemKey, productRecordId, buyerCharacterId, posted.credit!);

  const sale: BusinessSaleRecord = {
    sale_id: `biz-sale-${randomUUID()}`,
    business_id: businessId,
    product_record_id: productRecordId,
    product_definition_id: productRecord.product_definition_id,
    buyer_character_id: buyerCharacterId,
    quantity: isService ? 1 : quantity,
    unit_price_ngn: productRecord.price_ngn,
    total_ngn: totalRevenue,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    is_service: isService,
  };
  state.businessSales[sale.sale_id] = sale;

  business.reputation_score = Math.min(catalog.rules.maximum_reputation_score, business.reputation_score + 1);
  business.updated_at = timestamp;
  business.last_operating_date = cloneDate(date);

  return { sale, revenue_transaction: revenueTx };
}

export function purchaseProduct(
  state: PersistentWorldState,
  businessId: string,
  productRecordId: string,
  buyerCharacterId: string,
  quantity: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { sale: BusinessSaleRecord; revenue_transaction: BusinessTransactionRecord } {
  return purchaseFromBusiness(state, businessId, productRecordId, buyerCharacterId, quantity, false, date, minuteOfDay, now, catalog);
}

export function purchaseService(
  state: PersistentWorldState,
  businessId: string,
  productRecordId: string,
  buyerCharacterId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { sale: BusinessSaleRecord; revenue_transaction: BusinessTransactionRecord } {
  return purchaseFromBusiness(state, businessId, productRecordId, buyerCharacterId, 1, true, date, minuteOfDay, now, catalog);
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

  const cashAccount = cashAccountFor(state, characterId);
  if (!cashAccount) throw new Error("business_no_cash_account");
  if (cashAccount.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");
  const businessAccount = businessAccountFor(state, businessId);

  const timestamp = new Date(now).toISOString();
  const posted = postBusinessMoney(state, {
    debit: { account: cashAccount, kind: "business_capital" }, credit: { account: businessAccount, kind: "business_capital" },
    amountNgn, description: "Capital contribution from owner.", referenceId: businessId, date, minuteOfDay, now,
    economyCatalog: loadEconomyCatalog(),
  });

  const idemKey = createHash("sha256").update(`biz-capital-contrib:${businessId}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, "capital_contribution", "Capital contribution from owner.",
    date, minuteOfDay, now, idemKey, null, characterId, posted.credit!);

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
  const businessAccount = businessAccountFor(state, businessId);
  if (businessAccount.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");

  const cashAccount = cashAccountFor(state, characterId);
  if (!cashAccount) throw new Error("business_no_cash_account");

  const economyCatalog = loadEconomyCatalog();
  if (cashAccount.balance_ngn + amountNgn > economyCatalog.rules.maximum_account_balance_ngn) {
    throw new Error("business_withdrawal_balance_limit");
  }

  // The caller receives the money in their own cash account. See STAGE_40 section 2.2.
  const timestamp = new Date(now).toISOString();
  const posted = postBusinessMoney(state, {
    debit: { account: businessAccount, kind: "business_withdrawal" }, credit: { account: cashAccount, kind: "business_withdrawal" },
    amountNgn, description: "Authorized owner withdrawal.", referenceId: businessId, date, minuteOfDay, now, economyCatalog,
  });

  const idemKey = createHash("sha256").update(`biz-withdrawal:${businessId}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, "owner_withdrawal", "Authorized owner withdrawal.",
    date, minuteOfDay, now, idemKey, null, characterId, posted.debit!);

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

  // Stage 40: a salary has a destination, so it is paid with pay_salary. An expense recorded here goes to nobody.
  if (kind === "salary") throw new Error("business_salary_use_payroll");
  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1) throw new Error("business_expense_amount_invalid");
  const businessAccount = businessAccountFor(state, businessId);
  if (businessAccount.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");
  if (description.trim().length === 0 || description.length > 300) throw new Error("business_expense_description_invalid");

  const txKind: BusinessTransactionKind = kind === "rent" ? "expense_rent" : "expense_operating";
  const timestamp = new Date(now).toISOString();
  const posted = postBusinessMoney(state, {
    debit: { account: businessAccount, kind: "business_expense" }, credit: null, amountNgn,
    description: description.trim(), referenceId: null, date, minuteOfDay, now, economyCatalog: loadEconomyCatalog(),
  });
  const idemKey = createHash("sha256").update(`biz-expense:${businessId}:${kind}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, txKind, description.trim(), date, minuteOfDay, now, idemKey, null, null, posted.debit!);

  appendBusinessEvent(state, businessId, "expense_recorded",
    `Recorded ${kind} expense of ₦${amountNgn.toLocaleString("en-NG")}.`, date, minuteOfDay, now,
    { kind, amount_ngn: amountNgn });

  return tx;
}

/**
 * Stage 40: pays a wage from the business account to an active employee's cash account. The caller must be an owner or
 * co-owner of the business. The employee is a named counterparty, and is checked: they must hold an active employee role
 * in this business, and they must not be deceased.
 */
export function paySalary(
  state: PersistentWorldState,
  businessId: string,
  callerCharacterId: string,
  employeeCharacterId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): BusinessTransactionRecord {
  const business = state.businesses[businessId];
  if (!business) throw new Error("business_not_found");
  assertBusinessActive(business);
  authorizeBusinessAction(state, businessId, callerCharacterId, ["owner", "co_owner"]);

  const employment = Object.values(state.businessOwnership).find((o) =>
    o.business_id === businessId && o.character_id === employeeCharacterId && o.active && o.role === "employee");
  const employee = characterForId(state, employeeCharacterId);
  if (!employment || !employee || employee.character.life_status === "deceased") throw new Error("business_salary_employee_invalid");

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1 || amountNgn > catalog.rules.maximum_owner_withdrawal_ngn) {
    throw new Error("business_salary_amount_invalid");
  }
  const employeeCash = cashAccountFor(state, employeeCharacterId);
  if (!employeeCash) throw new Error("business_no_cash_account");
  const businessAccount = businessAccountFor(state, businessId);
  if (businessAccount.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");

  const timestamp = new Date(now).toISOString();
  const posted = postBusinessMoney(state, {
    debit: { account: businessAccount, kind: "business_salary" }, credit: { account: employeeCash, kind: "business_salary" },
    amountNgn, description: "Salary payment.", referenceId: employment.ownership_id, date, minuteOfDay, now,
    economyCatalog: loadEconomyCatalog(),
  });
  const idemKey = createHash("sha256").update(`biz-salary:${businessId}:${employeeCharacterId}:${timestamp}`).digest("hex");
  const tx = postBusinessTransaction(state, businessId, "salary_paid", `Salary paid to employee ${employeeCharacterId}.`,
    date, minuteOfDay, now, idemKey, employment.ownership_id, employeeCharacterId, posted.debit!);

  appendBusinessEvent(state, businessId, "salary_paid",
    `Salary of ₦${amountNgn.toLocaleString("en-NG")} paid to an employee.`, date, minuteOfDay, now,
    { amount_ngn: amountNgn, employee_id: employeeCharacterId });

  return tx;
}

/**
 * Stage 40: moves money between two businesses. The caller must be an owner or co-owner of both. The two movements are
 * one ledger transfer, and both businesses get a journal entry.
 */
export function transferBetweenBusinesses(
  state: PersistentWorldState,
  fromBusinessId: string,
  callerCharacterId: string,
  toBusinessId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: BusinessCatalog = loadBusinessCatalog(),
): { outgoing: BusinessTransactionRecord; incoming: BusinessTransactionRecord } {
  if (fromBusinessId === toBusinessId) throw new Error("business_transfer_invalid");
  const fromBusiness = state.businesses[fromBusinessId];
  const toBusiness = state.businesses[toBusinessId];
  if (!fromBusiness || !toBusiness) throw new Error("business_not_found");
  assertBusinessActive(fromBusiness);
  assertBusinessActive(toBusiness);
  authorizeBusinessAction(state, fromBusinessId, callerCharacterId, ["owner", "co_owner"]);
  const destination = ownershipForCharacterAndBusiness(state, toBusinessId, callerCharacterId);
  if (!destination || (destination.role !== "owner" && destination.role !== "co_owner")) throw new Error("business_transfer_not_permitted");

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1 || amountNgn > catalog.rules.maximum_owner_withdrawal_ngn) {
    throw new Error("business_transfer_amount_invalid");
  }
  const fromAccount = businessAccountFor(state, fromBusinessId);
  const toAccount = businessAccountFor(state, toBusinessId);
  if (fromAccount.balance_ngn < amountNgn) throw new Error("business_insufficient_funds");

  const timestamp = new Date(now).toISOString();
  const description = `Transfer from ${fromBusiness.name} to ${toBusiness.name}.`;
  const posted = postBusinessMoney(state, {
    debit: { account: fromAccount, kind: "business_transfer" }, credit: { account: toAccount, kind: "business_transfer" },
    amountNgn, description, referenceId: toBusinessId, date, minuteOfDay, now, economyCatalog: loadEconomyCatalog(),
  });
  const outKey = createHash("sha256").update(`biz-transfer-out:${fromBusinessId}:${toBusinessId}:${timestamp}`).digest("hex");
  const inKey = createHash("sha256").update(`biz-transfer-in:${toBusinessId}:${fromBusinessId}:${timestamp}`).digest("hex");
  const outgoing = postBusinessTransaction(state, fromBusinessId, "transfer_out", description, date, minuteOfDay, now, outKey,
    toBusinessId, null, posted.debit!);
  const incoming = postBusinessTransaction(state, toBusinessId, "transfer_in", description, date, minuteOfDay, now, inKey,
    fromBusinessId, null, posted.credit!);
  return { outgoing, incoming };
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

  // Stage 40: the operating cost is paid before any stock changes, so a refused cost leaves stock as it was.
  let productionCostRow: EconomyTransactionRecord | null = null;
  if (recipe.operating_cost_ngn > 0) {
    const businessAccount = businessAccountFor(state, businessId);
    if (businessAccount.balance_ngn < recipe.operating_cost_ngn) throw new Error("business_insufficient_funds");
    productionCostRow = postBusinessMoney(state, {
      debit: { account: businessAccount, kind: "business_expense" }, credit: null, amountNgn: recipe.operating_cost_ngn,
      description: `Production cost: ${recipe.label}.`, referenceId: recipeId, date, minuteOfDay, now, economyCatalog: loadEconomyCatalog(),
    }).debit;
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

  if (productionCostRow) {
    const idemKey = createHash("sha256").update(`biz-production:${businessId}:${recipeId}:${timestamp}`).digest("hex");
    postBusinessTransaction(state, businessId, "production_cost", `Production cost: ${recipe.label}.`, date, minuteOfDay, now,
      idemKey, recipeId, null, productionCostRow);
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
  // Stage 40: money left in a closed business could never be withdrawn, so the owner withdraws it first.
  if ((state.economyAccounts[businessAccountKey(businessId)]?.balance_ngn ?? business.balance_ngn) > 0) throw new Error("business_balance_not_empty");

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
      total_capital_ngn: 0,
      total_withdrawals_ngn: 0,
      balance_ngn: 0,
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

    // Stage 40: the NPC business's starting capital is an explicit issuance row on its own account (section 2.6).
    const seedAmount = template.setup_cost_ngn * 3;
    openBusinessAccount(state, businessId, date, now);
    if (seedAmount > 0) {
      const seedAccount = businessAccountFor(state, businessId);
      const posted = postBusinessMoney(state, {
        debit: null, credit: { account: seedAccount, kind: "business_seed_capital" }, amountNgn: seedAmount,
        description: "Initial capital for an NPC business (issuance).", referenceId: businessId, date, minuteOfDay: 0, now,
        economyCatalog: loadEconomyCatalog(),
      });
      postBusinessTransaction(state, businessId, "seed_capital", "Initial capital for an NPC business (issuance).", date, 0, now,
        createHash("sha256").update(`biz-seed:${businessId}`).digest("hex"), businessId, null, posted.credit!);
    }

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
    const businessAccount = businessAccountFor(state, business.business_id);
    if (businessAccount.balance_ngn < dailyCost) {
      business.status = "insolvent";
      business.updated_at = new Date(now).toISOString();
      appendBusinessEvent(state, business.business_id, "business_insolvent",
        `Business '${business.name}' has become insolvent due to insufficient funds for operating costs.`, date, 0, now,
        { daily_cost_ngn: dailyCost, balance_ngn: businessAccount.balance_ngn });
      continue;
    }
    const idemKey = createHash("sha256").update(`biz-daily-cost:${business.business_id}:${date.year}:${date.month}:${date.day}`).digest("hex");
    const existing = Object.values(state.businessTransactions).find((tx) => tx.idempotency_key === idemKey);
    if (!existing) {
      // The daily cost is a sink (STAGE_40 section 2.4). It is charged once per world date, by the same-day guard above.
      const posted = postBusinessMoney(state, {
        debit: { account: businessAccount, kind: "business_expense" }, credit: null, amountNgn: dailyCost,
        description: "Daily operating and premises cost.", referenceId: null, date, minuteOfDay: 0, now,
        economyCatalog: loadEconomyCatalog(),
      });
      postBusinessTransaction(state, business.business_id, "expense_operating", "Daily operating and premises cost.",
        date, 0, now, idemKey, null, null, posted.debit!);
    }
    business.updated_at = new Date(now).toISOString();
    operatingCount += 1;
  }
  return operatingCount;
}

/**
 * Stage 40: gives every business that has no account one, and carries the balance it recorded before this stage into it.
 * The carried amount is an explicit ledger row (`business_legacy_import`) and a business event. It is not new money: the
 * amount was already on the business record. A business that already has an account is not changed, so the function
 * can run on every load. A balance above the account limit is refused, and nothing changes for that business.
 */
export function migrateLegacyBusinessAccounts(state: PersistentWorldState, date: CalendarDate, now: number): number {
  const economyCatalog = loadEconomyCatalog();
  let migrated = 0;
  for (const business of Object.values(state.businesses)) {
    if (state.economyAccounts[businessAccountKey(business.business_id)]) continue;
    if (business.balance_ngn > economyCatalog.rules.maximum_account_balance_ngn) throw new Error("business_legacy_balance_over_limit");
    const account = openBusinessAccount(state, business.business_id, date, now);
    const amount = business.balance_ngn;
    if (amount > 0) {
      const description = "Balance carried over from the business record (Stage 40 migration).";
      const posted = postBusinessMoney(state, {
        debit: null, credit: { account, kind: "business_legacy_import" }, amountNgn: amount, description,
        referenceId: business.business_id, date, minuteOfDay: 0, now, economyCatalog,
      });
      postBusinessTransaction(state, business.business_id, "legacy_import", description, date, 0, now,
        createHash("sha256").update(`biz-legacy-import:${business.business_id}`).digest("hex"), business.business_id, null, posted.credit!);
      appendBusinessEvent(state, business.business_id, "legacy_balance_imported",
        `Balance of ₦${amount.toLocaleString("en-NG")} carried into the business account.`, date, 0, now,
        { imported_ngn: amount, legacy_recorded_revenue_ngn: business.total_revenue_ngn });
    }
    migrated += 1;
  }
  return migrated;
}

/**
 * Stage 40: the reconciliation the loader checks. For each business account: the business's `balance_ngn` equals the
 * account balance, the account is the business's own current account, and the balance equals the sum of its ledger rows
 * (each row's balance change, after minus before). Returns one message per problem. A world with a problem is refused.
 */
export function businessAccountMismatches(state: PersistentWorldState): string[] {
  const problems: string[] = [];
  const movement = new Map<string, number>();
  for (const row of Object.values(state.economyTransactions)) {
    movement.set(row.account_id, (movement.get(row.account_id) ?? 0) + (row.balance_after_ngn - row.balance_before_ngn));
  }
  for (const business of Object.values(state.businesses)) {
    const account = state.economyAccounts[businessAccountKey(business.business_id)];
    if (!account) continue;
    if (account.kind !== "current" || account.character_id !== business.business_id) {
      problems.push(`${business.business_id}: its account is not the business's own current account`);
      continue;
    }
    if (business.balance_ngn !== account.balance_ngn) problems.push(`${business.business_id}: balance does not match its account`);
    if ((movement.get(account.account_id) ?? 0) !== account.balance_ngn) {
      problems.push(`${business.business_id}: account balance does not match its ledger rows`);
    }
  }
  return problems;
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
    business_sale_must_be_purchase: "A sale is recorded when a buyer pays. Ask a customer to buy from the business.",
    business_self_purchase: "An owner cannot buy from their own business.",
    business_salary_use_payroll: "A salary is paid to an employee with the payroll action, not recorded as an expense.",
    business_salary_employee_invalid: "That character is not an active employee of this business.",
    business_salary_amount_invalid: "Enter a salary amount within the allowed limit.",
    business_transfer_invalid: "Choose two different businesses to transfer between.",
    business_transfer_not_permitted: "You must own the destination business to transfer money to it.",
    business_transfer_amount_invalid: "Enter a transfer amount within the allowed limit.",
    business_balance_not_empty: "Withdraw the business balance before closing it.",
    business_account_missing: "This business has no account. It has not been migrated; contact the operators.",
    business_balance_limit: "The receiving account would go over its balance limit.",
    business_money_move_invalid: "That money movement is not allowed.",
    business_amount_invalid: "Enter a valid amount.",
    business_legacy_balance_over_limit: "This business's recorded balance is above the account limit and cannot be migrated.",
    economy_account_not_active: "One of the accounts involved is frozen or closed.",
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
    business_persistence_unavailable: "Saving is failing, so business changes are paused. Nothing was changed.",
    business_not_saved: "The business change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
    business_outcome_unknown: "The business change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
    business_expense_description_invalid: "The expense description is invalid.",
    business_production_not_supported: "This business type does not support production.",
    business_recipe_not_available: "This recipe is not available for this business type.",
    business_recipe_not_found: "That production recipe is not available.",
    business_insufficient_input_stock: "There is not enough input stock for this production run.",
  };
  return messages[code] ?? economyErrorMessage(code) ?? "The business request could not be completed.";
}
