import { createHash, randomUUID } from "node:crypto";
import { daysInMonth } from "../life/calendar.js";
import type { CalendarDate } from "../life/types.js";
import type { PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import { loadEconomyCatalog } from "./catalog.js";
import type {
  EconomyAccountKind,
  EconomyAccountRecord,
  EconomyAccountSnapshot,
  EconomyBankProduct,
  EconomyCatalog,
  EconomyEventRecord,
  EconomyLoanProduct,
  EconomyLoanRecord,
  EconomyLoanSnapshot,
  EconomyMarketGood,
  EconomyProfileSnapshot,
  EconomyTransactionRecord,
} from "./types.js";

const ECONOMY_KEY_SEPARATOR = "::economy::";

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function accountKey(characterId: string, kind: EconomyAccountKind, suffix: string): string {
  return createHash("sha256").update(`${characterId}${ECONOMY_KEY_SEPARATOR}${kind}${ECONOMY_KEY_SEPARATOR}${suffix}`).digest("hex").slice(0, 32);
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((player) => player.character.character_id === characterId);
}

function accountsForCharacter(state: PersistentWorldState, characterId: string): EconomyAccountRecord[] {
  return Object.values(state.economyAccounts).filter((account) => account.character_id === characterId);
}

function loansForCharacter(state: PersistentWorldState, characterId: string): EconomyLoanRecord[] {
  return Object.values(state.economyLoans).filter((loan) => loan.character_id === characterId);
}

function appendEconomyEvent(
  state: PersistentWorldState,
  characterId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  details: Record<string, string | number | boolean | null>,
  extra?: { account_id?: string; loan_id?: string; transaction_id?: string },
): EconomyEventRecord {
  const event: EconomyEventRecord = {
    event_id: `economy-event-${randomUUID()}`,
    character_id: characterId,
    type,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    summary,
    details,
    created_at: new Date(now).toISOString(),
    ...(extra ?? {}),
  };
  state.economyEvents[event.event_id] = event;
  return event;
}

function adjustCreditScore(
  state: PersistentWorldState,
  characterId: string,
  delta: number,
  reason: string,
  date: CalendarDate,
  now: number,
): number {
  const catalog = loadEconomyCatalog();
  const key = characterId;
  const existing = state.economyCreditScores[key];
  const currentScore = existing?.score ?? catalog.rules.starting_credit_score;
  const newScore = Math.min(catalog.rules.maximum_credit_score, Math.max(catalog.rules.minimum_credit_score, currentScore + delta));
  const entry = {
    score: newScore,
    reason,
    world_date: cloneDate(date),
    recorded_at: new Date(now).toISOString(),
  };
  const history = [...(existing?.history ?? []), entry].slice(-50);
  state.economyCreditScores[key] = {
    character_id: characterId,
    score: newScore,
    history,
    updated_at: new Date(now).toISOString(),
    updated_world_date: cloneDate(date),
  };
  return newScore;
}

function creditScoreFor(state: PersistentWorldState, characterId: string): number {
  const catalog = loadEconomyCatalog();
  return state.economyCreditScores[characterId]?.score ?? catalog.rules.starting_credit_score;
}

export function initializeEconomyWorldState(state: PersistentWorldState, now: number): void {
  if (!state.economyAccounts) state.economyAccounts = {};
  if (!state.economyTransactions) state.economyTransactions = {};
  if (!state.economyLoans) state.economyLoans = {};
  if (!state.economyCreditScores) state.economyCreditScores = {};
  if (!state.economyEvents) state.economyEvents = {};
  const catalog = loadEconomyCatalog();
  for (const player of Object.values(state.players)) {
    const characterId = player.character.character_id;
    if (!state.economyCreditScores[characterId]) {
      state.economyCreditScores[characterId] = {
        character_id: characterId,
        score: catalog.rules.starting_credit_score,
        history: [],
        updated_at: new Date(now).toISOString(),
        updated_world_date: cloneDate(state.worldClock.world_date),
      };
    }
    const cashAccounts = accountsForCharacter(state, characterId).filter((account) => account.kind === "cash");
    if (cashAccounts.length === 0 && player.character.life_status !== "deceased") {
      const key = accountKey(characterId, "cash", "default");
      const cashBalance = Math.floor(player.character.money);
      state.economyAccounts[key] = {
        account_id: key,
        character_id: characterId,
        kind: "cash",
        bank_product_id: null,
        balance_ngn: cashBalance,
        status: "active",
        created_at: new Date(now).toISOString(),
        created_world_date: cloneDate(state.worldClock.world_date),
        updated_at: new Date(now).toISOString(),
        opened_world_date: cloneDate(state.worldClock.world_date),
        last_interest_date: null,
        total_deposited_ngn: cashBalance,
        total_withdrawn_ngn: 0,
        total_fees_paid_ngn: 0,
        total_interest_earned_ngn: 0,
        daily_withdrawal_total_ngn: 0,
        daily_withdrawal_date: null,
      };
      if (cashBalance > 0) {
        const transactionId = `economy-tx-${randomUUID()}`;
        state.economyTransactions[transactionId] = {
          transaction_id: transactionId,
          account_id: key,
          character_id: characterId,
          kind: "initial_credit",
          amount_ngn: cashBalance,
          balance_before_ngn: 0,
          balance_after_ngn: cashBalance,
          fee_ngn: 0,
          description: "Initial cash balance migrated from character record.",
          world_date: cloneDate(state.worldClock.world_date),
          minute_of_day: state.worldClock.minute_of_day,
          posted_at: new Date(now).toISOString(),
          reference_id: null,
          counterparty_account_id: null,
          idempotency_key: createHash("sha256").update(`initial:${key}:${state.worldClock.world_date.year}:${state.worldClock.world_date.month}:${state.worldClock.world_date.day}`).digest("hex"),
        };
      }
      // Keep character.money in sync with the cash account for backward compatibility.
    }
  }
}

export function economyAccountPort(
  state: PersistentWorldState,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): {
  balanceForCharacter(characterId: string): number | null;
  creditSalary(characterId: string, amountNgn: number, paymentId: string, postedAt: string): void;
} {
  return {
    balanceForCharacter(characterId: string): number | null {
      const player = characterForId(state, characterId);
      if (!player) return null;
      const accounts = accountsForCharacter(state, characterId);
      const cashAccount = accounts.find((account) => account.kind === "cash");
      return cashAccount?.balance_ngn ?? player.character.money ?? 0;
    },
    creditSalary(characterId: string, amountNgn: number, paymentId: string, postedAt: string): void {
      const player = characterForId(state, characterId);
      if (!player) throw new Error("economy_character_not_found");
      const accounts = accountsForCharacter(state, characterId);
      let cashAccount = accounts.find((account) => account.kind === "cash");
      if (!cashAccount) {
        const key = accountKey(characterId, "cash", "default");
        cashAccount = {
          account_id: key,
          character_id: characterId,
          kind: "cash",
          bank_product_id: null,
          balance_ngn: 0,
          status: "active",
          created_at: postedAt,
          created_world_date: cloneDate(state.worldClock.world_date),
          updated_at: postedAt,
          opened_world_date: cloneDate(state.worldClock.world_date),
          last_interest_date: null,
          total_deposited_ngn: 0,
          total_withdrawn_ngn: 0,
          total_fees_paid_ngn: 0,
          total_interest_earned_ngn: 0,
          daily_withdrawal_total_ngn: 0,
          daily_withdrawal_date: null,
        };
        state.economyAccounts[key] = cashAccount;
      }
      const idempotencyKey = createHash("sha256").update(`salary:${paymentId}`).digest("hex");
      const existing = Object.values(state.economyTransactions).find((tx) =>
        tx.idempotency_key === idempotencyKey && tx.account_id === cashAccount!.account_id);
      if (existing) return;
      if (amountNgn < catalog.rules.minimum_transaction_amount_ngn || amountNgn > catalog.rules.maximum_transaction_amount_ngn) {
        throw new Error("economy_salary_amount_invalid");
      }
      if (cashAccount.balance_ngn + amountNgn > catalog.rules.maximum_account_balance_ngn) {
        throw new Error("economy_salary_balance_limit");
      }
      const balanceBefore = cashAccount.balance_ngn;
      cashAccount.balance_ngn += amountNgn;
      cashAccount.total_deposited_ngn += amountNgn;
      cashAccount.updated_at = postedAt;
      const transactionId = `economy-tx-${randomUUID()}`;
      state.economyTransactions[transactionId] = {
        transaction_id: transactionId,
        account_id: cashAccount.account_id,
        character_id: characterId,
        kind: "salary_credit",
        amount_ngn: amountNgn,
        balance_before_ngn: balanceBefore,
        balance_after_ngn: cashAccount.balance_ngn,
        fee_ngn: 0,
        description: `Salary credit from employment payment ${paymentId}.`,
        world_date: cloneDate(state.worldClock.world_date),
        minute_of_day: state.worldClock.minute_of_day,
        posted_at: postedAt,
        reference_id: paymentId,
        counterparty_account_id: null,
        idempotency_key: idempotencyKey,
      };
    },
  };
}

function calculateIncomeTax(monthlyIncomeNgn: number, catalog: EconomyCatalog): number {
  if (monthlyIncomeNgn <= 0) return 0;
  const sortedBands = [...catalog.tax_bands].sort((a, b) => a.minimum_monthly_income_ngn - b.minimum_monthly_income_ngn);
  let tax = 0;
  let remaining = monthlyIncomeNgn;
  for (const band of sortedBands) {
    if (remaining <= 0) break;
    const bandWidth = band.maximum_monthly_income_ngn - band.minimum_monthly_income_ngn + 1;
    const taxableInBand = Math.min(remaining, bandWidth);
    tax += Math.floor(taxableInBand * band.rate_percent / 100);
    remaining -= taxableInBand;
  }
  return tax;
}

function findBankProduct(catalog: EconomyCatalog, productId: string): EconomyBankProduct | undefined {
  return catalog.bank_products.find((product) => product.id === productId);
}

function findLoanProduct(catalog: EconomyCatalog, productId: string): EconomyLoanProduct | undefined {
  return catalog.loan_products.find((product) => product.id === productId);
}

export function openEconomyAccount(
  state: PersistentWorldState,
  characterId: string,
  bankProductId: string,
  initialDepositNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyAccountRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  const product = findBankProduct(catalog, bankProductId);
  if (!product) throw new Error("economy_bank_product_not_found");
  const existingAccounts = accountsForCharacter(state, characterId);
  if (existingAccounts.filter((account) => account.kind !== "cash").length >= catalog.rules.maximum_accounts_per_character) {
    throw new Error("economy_account_limit_reached");
  }
  if (initialDepositNgn < 0 || initialDepositNgn > catalog.rules.maximum_transaction_amount_ngn) {
    throw new Error("economy_deposit_amount_invalid");
  }
  if (initialDepositNgn < product.minimum_balance_ngn) {
    throw new Error("economy_minimum_balance_not_met");
  }
  const cashAccounts = existingAccounts.filter((account) => account.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  if (cashAccount.balance_ngn < initialDepositNgn) throw new Error("economy_insufficient_funds");
  const kind = product.kind === "savings" ? "savings" : product.kind === "current" ? "current" : "fixed_deposit";
  const key = accountKey(characterId, kind, randomUUID().slice(0, 8));
  const timestamp = new Date(now).toISOString();
  const cashBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn -= initialDepositNgn;
  cashAccount.total_withdrawn_ngn += initialDepositNgn;
  cashAccount.updated_at = timestamp;
  const withdrawalTxId = `economy-tx-${randomUUID()}`;
  state.economyTransactions[withdrawalTxId] = {
    transaction_id: withdrawalTxId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "bank_deposit",
    amount_ngn: initialDepositNgn,
    balance_before_ngn: cashBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: 0,
    description: `Deposit to new ${product.label}.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: key,
    counterparty_account_id: key,
    idempotency_key: createHash("sha256").update(`open:${key}:${timestamp}`).digest("hex"),
  };
  const account: EconomyAccountRecord = {
    account_id: key,
    character_id: characterId,
    kind,
    bank_product_id: product.id,
    balance_ngn: initialDepositNgn,
    status: "active",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    opened_world_date: cloneDate(date),
    last_interest_date: cloneDate(date),
    total_deposited_ngn: initialDepositNgn,
    total_withdrawn_ngn: 0,
    total_fees_paid_ngn: 0,
    total_interest_earned_ngn: 0,
    daily_withdrawal_total_ngn: 0,
    daily_withdrawal_date: null,
  };
  state.economyAccounts[key] = account;
  appendEconomyEvent(state, characterId, "account_opened", `Opened a ${product.label}.`, date, minuteOfDay, now, {
    account_id: key,
    bank_product_id: product.id,
    initial_deposit_ngn: initialDepositNgn,
  }, { account_id: key });
  return account;
}

export function depositToAccount(
  state: PersistentWorldState,
  characterId: string,
  accountId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyTransactionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  const account = state.economyAccounts[accountId];
  if (!account || account.character_id !== characterId) throw new Error("economy_account_not_found");
  if (account.status !== "active") throw new Error("economy_account_not_active");
  if (amountNgn < catalog.rules.minimum_transaction_amount_ngn || amountNgn > catalog.rules.maximum_transaction_amount_ngn) {
    throw new Error("economy_deposit_amount_invalid");
  }
  if (account.balance_ngn + amountNgn > catalog.rules.maximum_account_balance_ngn) {
    throw new Error("economy_balance_limit_exceeded");
  }
  const cashAccounts = accountsForCharacter(state, characterId).filter((acc) => acc.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  if (cashAccount.balance_ngn < amountNgn) throw new Error("economy_insufficient_funds");
  const timestamp = new Date(now).toISOString();
  const cashBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn -= amountNgn;
  cashAccount.total_withdrawn_ngn += amountNgn;
  cashAccount.updated_at = timestamp;
  const withdrawalTxId = `economy-tx-${randomUUID()}`;
  state.economyTransactions[withdrawalTxId] = {
    transaction_id: withdrawalTxId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "bank_deposit",
    amount_ngn: amountNgn,
    balance_before_ngn: cashBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: 0,
    description: `Cash deposit to ${account.kind} account.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: accountId,
    counterparty_account_id: accountId,
    idempotency_key: createHash("sha256").update(`deposit:${accountId}:${timestamp}`).digest("hex"),
  };
  const balanceBefore = account.balance_ngn;
  account.balance_ngn += amountNgn;
  account.total_deposited_ngn += amountNgn;
  account.updated_at = timestamp;
  const depositTxId = `economy-tx-${randomUUID()}`;
  const tx: EconomyTransactionRecord = {
    transaction_id: depositTxId,
    account_id: accountId,
    character_id: characterId,
    kind: "bank_deposit",
    amount_ngn: amountNgn,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: account.balance_ngn,
    fee_ngn: 0,
    description: "Cash deposit.",
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: null,
    counterparty_account_id: cashAccount.account_id,
    idempotency_key: createHash("sha256").update(`deposit-credit:${accountId}:${timestamp}`).digest("hex"),
  };
  state.economyTransactions[depositTxId] = tx;
  return tx;
}

export function withdrawFromAccount(
  state: PersistentWorldState,
  characterId: string,
  accountId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyTransactionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  const account = state.economyAccounts[accountId];
  if (!account || account.character_id !== characterId) throw new Error("economy_account_not_found");
  if (account.status !== "active") throw new Error("economy_account_not_active");
  if (amountNgn < catalog.rules.minimum_transaction_amount_ngn || amountNgn > catalog.rules.maximum_transaction_amount_ngn) {
    throw new Error("economy_withdrawal_amount_invalid");
  }
  const product = account.bank_product_id ? findBankProduct(catalog, account.bank_product_id) : undefined;
  const fee = product?.withdrawal_fee_ngn ?? 0;
  const totalDebit = amountNgn + fee;
  if (account.balance_ngn < totalDebit) throw new Error("economy_insufficient_funds");
  if (account.daily_withdrawal_date && (
    account.daily_withdrawal_date.year !== date.year || account.daily_withdrawal_date.month !== date.month ||
    account.daily_withdrawal_date.day !== date.day)) {
    account.daily_withdrawal_total_ngn = 0;
  }
  const dailyLimit = product?.max_withdrawal_daily_ngn ?? catalog.rules.maximum_transaction_amount_ngn;
  if (account.daily_withdrawal_total_ngn + amountNgn > dailyLimit) throw new Error("economy_daily_withdrawal_limit");
  const cashAccounts = accountsForCharacter(state, characterId).filter((acc) => acc.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  if (cashAccount.balance_ngn + amountNgn > catalog.rules.maximum_account_balance_ngn) {
    throw new Error("economy_balance_limit_exceeded");
  }
  const timestamp = new Date(now).toISOString();
  const balanceBefore = account.balance_ngn;
  account.balance_ngn -= totalDebit;
  account.total_withdrawn_ngn += amountNgn;
  account.total_fees_paid_ngn += fee;
  account.daily_withdrawal_total_ngn += amountNgn;
  account.daily_withdrawal_date = cloneDate(date);
  account.updated_at = timestamp;
  const txId = `economy-tx-${randomUUID()}`;
  const tx: EconomyTransactionRecord = {
    transaction_id: txId,
    account_id: accountId,
    character_id: characterId,
    kind: "bank_withdrawal",
    amount_ngn: amountNgn,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: account.balance_ngn,
    fee_ngn: fee,
    description: `Cash withdrawal${fee > 0 ? ` (fee ₦${fee})` : ""}.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: null,
    counterparty_account_id: cashAccount.account_id,
    idempotency_key: createHash("sha256").update(`withdraw:${accountId}:${timestamp}`).digest("hex"),
  };
  state.economyTransactions[txId] = tx;
  const cashBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn += amountNgn;
  cashAccount.total_deposited_ngn += amountNgn;
  cashAccount.updated_at = timestamp;
  const cashTxId = `economy-tx-${randomUUID()}`;
  state.economyTransactions[cashTxId] = {
    transaction_id: cashTxId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "bank_withdrawal",
    amount_ngn: amountNgn,
    balance_before_ngn: cashBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: 0,
    description: `Withdrawal from ${account.kind} account.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: accountId,
    counterparty_account_id: accountId,
    idempotency_key: createHash("sha256").update(`withdraw-credit:${cashAccount.account_id}:${timestamp}`).digest("hex"),
  };
  if (fee > 0) {
    const feeTxId = `economy-tx-${randomUUID()}`;
    state.economyTransactions[feeTxId] = {
      transaction_id: feeTxId,
      account_id: accountId,
      character_id: characterId,
      kind: "bank_fee",
      amount_ngn: fee,
      balance_before_ngn: account.balance_ngn,
      balance_after_ngn: account.balance_ngn,
      fee_ngn: fee,
      description: "Withdrawal fee.",
      world_date: cloneDate(date),
      minute_of_day: minuteOfDay,
      posted_at: timestamp,
      reference_id: txId,
      counterparty_account_id: null,
      idempotency_key: createHash("sha256").update(`withdraw-fee:${accountId}:${timestamp}`).digest("hex"),
    };
  }
  return tx;
}

export function transferBetweenAccounts(
  state: PersistentWorldState,
  characterId: string,
  fromAccountId: string,
  toAccountId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyTransactionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  if (fromAccountId === toAccountId) throw new Error("economy_same_account_transfer");
  const fromAccount = state.economyAccounts[fromAccountId];
  const toAccount = state.economyAccounts[toAccountId];
  if (!fromAccount || fromAccount.character_id !== characterId) throw new Error("economy_account_not_found");
  if (!toAccount || toAccount.character_id !== characterId) throw new Error("economy_account_not_found");
  if (fromAccount.status !== "active" || toAccount.status !== "active") throw new Error("economy_account_not_active");
  if (amountNgn < catalog.rules.minimum_transaction_amount_ngn || amountNgn > catalog.rules.maximum_transfer_amount_ngn) {
    throw new Error("economy_transfer_amount_invalid");
  }
  const product = fromAccount.bank_product_id ? findBankProduct(catalog, fromAccount.bank_product_id) : undefined;
  const fee = product?.transfer_fee_ngn ?? 0;
  const totalDebit = amountNgn + fee;
  if (fromAccount.balance_ngn < totalDebit) throw new Error("economy_insufficient_funds");
  if (toAccount.balance_ngn + amountNgn > catalog.rules.maximum_account_balance_ngn) {
    throw new Error("economy_balance_limit_exceeded");
  }
  const timestamp = new Date(now).toISOString();
  const fromBalanceBefore = fromAccount.balance_ngn;
  fromAccount.balance_ngn -= totalDebit;
  fromAccount.total_withdrawn_ngn += amountNgn;
  fromAccount.total_fees_paid_ngn += fee;
  fromAccount.updated_at = timestamp;
  const fromTxId = `economy-tx-${randomUUID()}`;
  const fromTx: EconomyTransactionRecord = {
    transaction_id: fromTxId,
    account_id: fromAccountId,
    character_id: characterId,
    kind: "bank_transfer",
    amount_ngn: amountNgn,
    balance_before_ngn: fromBalanceBefore,
    balance_after_ngn: fromAccount.balance_ngn,
    fee_ngn: fee,
    description: `Transfer to ${toAccount.kind} account.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: toAccountId,
    counterparty_account_id: toAccountId,
    idempotency_key: createHash("sha256").update(`transfer:${fromAccountId}:${toAccountId}:${timestamp}`).digest("hex"),
  };
  state.economyTransactions[fromTxId] = fromTx;
  const toBalanceBefore = toAccount.balance_ngn;
  toAccount.balance_ngn += amountNgn;
  toAccount.total_deposited_ngn += amountNgn;
  toAccount.updated_at = timestamp;
  const toTxId = `economy-tx-${randomUUID()}`;
  state.economyTransactions[toTxId] = {
    transaction_id: toTxId,
    account_id: toAccountId,
    character_id: characterId,
    kind: "bank_transfer",
    amount_ngn: amountNgn,
    balance_before_ngn: toBalanceBefore,
    balance_after_ngn: toAccount.balance_ngn,
    fee_ngn: 0,
    description: `Transfer from ${fromAccount.kind} account.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: fromAccountId,
    counterparty_account_id: fromAccountId,
    idempotency_key: createHash("sha256").update(`transfer-credit:${toAccountId}:${timestamp}`).digest("hex"),
  };
  if (fee > 0) {
    const feeTxId = `economy-tx-${randomUUID()}`;
    state.economyTransactions[feeTxId] = {
      transaction_id: feeTxId,
      account_id: fromAccountId,
      character_id: characterId,
      kind: "bank_fee",
      amount_ngn: fee,
      balance_before_ngn: fromAccount.balance_ngn,
      balance_after_ngn: fromAccount.balance_ngn,
      fee_ngn: fee,
      description: "Transfer fee.",
      world_date: cloneDate(date),
      minute_of_day: minuteOfDay,
      posted_at: timestamp,
      reference_id: fromTxId,
      counterparty_account_id: null,
      idempotency_key: createHash("sha256").update(`transfer-fee:${fromAccountId}:${timestamp}`).digest("hex"),
    };
  }
  return fromTx;
}

export function purchaseMarketGood(
  state: PersistentWorldState,
  characterId: string,
  goodId: string,
  quantity: number,
  locationId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): { transaction: EconomyTransactionRecord; good: EconomyMarketGood; total_cost_ngn: number } {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("economy_purchase_quantity_invalid");
  const good = catalog.market_goods.find((entry) => entry.id === goodId);
  if (!good) throw new Error("economy_good_not_found");
  if (!good.location_ids.includes(locationId)) throw new Error("economy_good_not_available_here");
  const totalCost = good.base_price_ngn * quantity;
  if (totalCost > catalog.rules.maximum_transaction_amount_ngn) throw new Error("economy_purchase_amount_invalid");
  const cashAccounts = accountsForCharacter(state, characterId).filter((account) => account.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  if (cashAccount.balance_ngn < totalCost) throw new Error("economy_insufficient_funds");
  const timestamp = new Date(now).toISOString();
  const balanceBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn -= totalCost;
  cashAccount.total_withdrawn_ngn += totalCost;
  cashAccount.updated_at = timestamp;
  const txId = `economy-tx-${randomUUID()}`;
  const tx: EconomyTransactionRecord = {
    transaction_id: txId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "market_purchase",
    amount_ngn: totalCost,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: 0,
    description: `Purchased ${quantity} × ${good.label} at ${locationId}.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: goodId,
    counterparty_account_id: null,
    idempotency_key: createHash("sha256").update(`purchase:${goodId}:${quantity}:${timestamp}`).digest("hex"),
  };
  state.economyTransactions[txId] = tx;
  player.character.money = cashAccount.balance_ngn;
  appendEconomyEvent(state, characterId, "market_purchase", `Bought ${quantity} × ${good.label} for ₦${totalCost}.`, date, minuteOfDay, now, {
    good_id: goodId, quantity, total_cost_ngn: totalCost, location_id: locationId,
  }, { transaction_id: txId });
  return { transaction: tx, good, total_cost_ngn: totalCost };
}

export function requestLoan(
  state: PersistentWorldState,
  characterId: string,
  loanProductId: string,
  amountNgn: number,
  termMonths: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyLoanRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  const product = findLoanProduct(catalog, loanProductId);
  if (!product) throw new Error("economy_loan_product_not_found");
  if (!Number.isSafeInteger(amountNgn) || amountNgn < catalog.rules.minimum_transaction_amount_ngn || amountNgn > product.maximum_amount_ngn) {
    throw new Error("economy_loan_amount_invalid");
  }
  if (!Number.isSafeInteger(termMonths) || termMonths < 1 || termMonths > product.maximum_term_months) {
    throw new Error("economy_loan_term_invalid");
  }
  const score = creditScoreFor(state, characterId);
  if (score < product.minimum_credit_score) throw new Error("economy_credit_score_too_low");
  if (product.requires_employment) {
    const hasActiveEmployment = Object.values(state.employments).some((employment) =>
      employment.character_id === characterId && ["active", "on_leave"].includes(employment.status));
    if (!hasActiveEmployment) throw new Error("economy_loan_requires_employment");
  }
  const existingActiveLoans = loansForCharacter(state, characterId).filter((loan) => loan.status === "active");
  if (existingActiveLoans.length >= 3) throw new Error("economy_too_many_active_loans");
  const originationFee = Math.floor(amountNgn * product.origination_fee_percent / 100);
  const monthlyRate = product.interest_rate_monthly_percent / 100;
  const monthlyPayment = monthlyRate === 0
    ? Math.ceil(amountNgn / termMonths)
    : Math.ceil(amountNgn * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1));
  const cashAccounts = accountsForCharacter(state, characterId).filter((account) => account.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  const netDisbursement = amountNgn - originationFee;
  if (cashAccount.balance_ngn + netDisbursement > catalog.rules.maximum_account_balance_ngn) {
    throw new Error("economy_balance_limit_exceeded");
  }
  const endDate = { year: date.year, month: date.month + termMonths, day: date.day };
  while (endDate.month > 12) { endDate.month -= 12; endDate.year += 1; }
  endDate.day = Math.min(endDate.day, daysInMonth(endDate.year, endDate.month));
  const nextPaymentDate = { year: date.year, month: date.month + 1, day: date.day };
  if (nextPaymentDate.month > 12) { nextPaymentDate.month -= 12; nextPaymentDate.year += 1; }
  nextPaymentDate.day = Math.min(nextPaymentDate.day, daysInMonth(nextPaymentDate.year, nextPaymentDate.month));
  const timestamp = new Date(now).toISOString();
  const loanId = `economy-loan-${randomUUID()}`;
  const loan: EconomyLoanRecord = {
    loan_id: loanId,
    character_id: characterId,
    loan_product_id: loanProductId,
    principal_ngn: amountNgn,
    remaining_principal_ngn: amountNgn,
    interest_rate_monthly_percent: product.interest_rate_monthly_percent,
    term_months: termMonths,
    monthly_payment_ngn: monthlyPayment,
    origination_fee_ngn: originationFee,
    status: "active",
    start_date: cloneDate(date),
    end_date: endDate,
    next_payment_date: nextPaymentDate,
    payments_made: 0,
    payments_missed: 0,
    total_paid_ngn: 0,
    created_at: timestamp,
    updated_at: timestamp,
    disbursement_account_id: cashAccount.account_id,
  };
  state.economyLoans[loanId] = loan;
  const balanceBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn += netDisbursement;
  cashAccount.total_deposited_ngn += netDisbursement;
  cashAccount.updated_at = timestamp;
  const disbursementTxId = `economy-tx-${randomUUID()}`;
  state.economyTransactions[disbursementTxId] = {
    transaction_id: disbursementTxId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "loan_disbursement",
    amount_ngn: netDisbursement,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: originationFee,
    description: `Loan disbursement (principal ₦${amountNgn}, origination fee ₦${originationFee}).`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: loanId,
    counterparty_account_id: null,
    idempotency_key: createHash("sha256").update(`loan-disburse:${loanId}`).digest("hex"),
  };
  if (originationFee > 0) {
    const feeTxId = `economy-tx-${randomUUID()}`;
    state.economyTransactions[feeTxId] = {
      transaction_id: feeTxId,
      account_id: cashAccount.account_id,
      character_id: characterId,
      kind: "loan_origination_fee",
      amount_ngn: originationFee,
      balance_before_ngn: cashAccount.balance_ngn,
      balance_after_ngn: cashAccount.balance_ngn,
      fee_ngn: originationFee,
      description: "Loan origination fee.",
      world_date: cloneDate(date),
      minute_of_day: minuteOfDay,
      posted_at: timestamp,
      reference_id: loanId,
      counterparty_account_id: null,
      idempotency_key: createHash("sha256").update(`loan-fee:${loanId}`).digest("hex"),
    };
  }
  adjustCreditScore(state, characterId, 5, `Loan ${loanId} approved.`, date, now);
  appendEconomyEvent(state, characterId, "loan_approved", `Approved ${product.label} of ₦${amountNgn} for ${termMonths} months.`, date, minuteOfDay, now, {
    loan_id: loanId, product_id: loanProductId, principal_ngn: amountNgn, term_months: termMonths,
    monthly_payment_ngn: monthlyPayment, origination_fee_ngn: originationFee,
  }, { loan_id: loanId, account_id: cashAccount.account_id });
  return loan;
}

export function repayLoan(
  state: PersistentWorldState,
  characterId: string,
  loanId: string,
  amountNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyTransactionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("economy_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("economy_character_deceased");
  const loan = state.economyLoans[loanId];
  if (!loan || loan.character_id !== characterId) throw new Error("economy_loan_not_found");
  if (loan.status !== "active") throw new Error("economy_loan_not_active");
  if (amountNgn < catalog.rules.minimum_transaction_amount_ngn) throw new Error("economy_repayment_amount_invalid");
  const cashAccounts = accountsForCharacter(state, characterId).filter((account) => account.kind === "cash");
  const cashAccount = cashAccounts[0];
  if (!cashAccount) throw new Error("economy_no_cash_account");
  if (cashAccount.balance_ngn < amountNgn) throw new Error("economy_insufficient_funds");
  const timestamp = new Date(now).toISOString();
  const balanceBefore = cashAccount.balance_ngn;
  cashAccount.balance_ngn -= amountNgn;
  cashAccount.total_withdrawn_ngn += amountNgn;
  cashAccount.updated_at = timestamp;
  const txId = `economy-tx-${randomUUID()}`;
  const tx: EconomyTransactionRecord = {
    transaction_id: txId,
    account_id: cashAccount.account_id,
    character_id: characterId,
    kind: "loan_repayment",
    amount_ngn: amountNgn,
    balance_before_ngn: balanceBefore,
    balance_after_ngn: cashAccount.balance_ngn,
    fee_ngn: 0,
    description: `Loan repayment for ${loanId}.`,
    world_date: cloneDate(date),
    minute_of_day: minuteOfDay,
    posted_at: timestamp,
    reference_id: loanId,
    counterparty_account_id: null,
    idempotency_key: createHash("sha256").update(`loan-repay:${loanId}:${timestamp}`).digest("hex"),
  };
  state.economyTransactions[txId] = tx;
  loan.remaining_principal_ngn = Math.max(0, loan.remaining_principal_ngn - amountNgn);
  loan.payments_made += 1;
  loan.total_paid_ngn += amountNgn;
  loan.updated_at = timestamp;
  const nextPayment = { year: loan.next_payment_date.year, month: loan.next_payment_date.month + 1, day: loan.next_payment_date.day };
  if (nextPayment.month > 12) { nextPayment.month -= 12; nextPayment.year += 1; }
  nextPayment.day = Math.min(nextPayment.day, daysInMonth(nextPayment.year, nextPayment.month));
  loan.next_payment_date = nextPayment;
  if (loan.remaining_principal_ngn <= 0) {
    loan.status = "paid_off";
    adjustCreditScore(state, characterId, 15, `Loan ${loanId} fully repaid.`, date, now);
    appendEconomyEvent(state, characterId, "loan_paid_off", `Loan ${loanId} has been fully repaid.`, date, minuteOfDay, now, {
      loan_id: loanId, total_paid_ngn: loan.total_paid_ngn,
    }, { loan_id: loanId, account_id: cashAccount.account_id, transaction_id: txId });
  } else {
    adjustCreditScore(state, characterId, 3, `Loan repayment for ${loanId}.`, date, now);
  }
  return tx;
}

export function processEconomyWorldDate(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): number {
  let interestCount = 0;
  for (const account of Object.values(state.economyAccounts)) {
    if (account.status !== "active") continue;
    if (!account.bank_product_id) continue;
    const product = findBankProduct(catalog, account.bank_product_id);
    if (!product || product.interest_rate_monthly_percent <= 0) continue;
    const isSameDay = account.last_interest_date !== null &&
      account.last_interest_date.year === date.year &&
      account.last_interest_date.month === date.month &&
      account.last_interest_date.day === date.day;
    if (isSameDay) continue;
    const shouldAccrue = account.last_interest_date === null ||
      (date.month !== account.last_interest_date.month || date.year !== account.last_interest_date.year);
    if (!shouldAccrue) continue;
    if (account.balance_ngn < product.minimum_balance_ngn) continue;
    const monthlyInterest = Math.floor(account.balance_ngn * product.interest_rate_monthly_percent / 100);
    if (monthlyInterest <= 0) continue;
    if (account.balance_ngn + monthlyInterest > catalog.rules.maximum_account_balance_ngn) continue;
    const balanceBefore = account.balance_ngn;
    account.balance_ngn += monthlyInterest;
    account.total_interest_earned_ngn += monthlyInterest;
    account.last_interest_date = cloneDate(date);
    account.updated_at = new Date(now).toISOString();
    const txId = `economy-tx-${randomUUID()}`;
    state.economyTransactions[txId] = {
      transaction_id: txId,
      account_id: account.account_id,
      character_id: account.character_id,
      kind: "bank_interest",
      amount_ngn: monthlyInterest,
      balance_before_ngn: balanceBefore,
      balance_after_ngn: account.balance_ngn,
      fee_ngn: 0,
      description: `Monthly interest at ${product.interest_rate_monthly_percent}%.`,
      world_date: cloneDate(date),
      minute_of_day: 0,
      posted_at: new Date(now).toISOString(),
      reference_id: account.bank_product_id,
      counterparty_account_id: null,
      idempotency_key: createHash("sha256").update(`interest:${account.account_id}:${date.year}:${date.month}`).digest("hex"),
    };
    interestCount += 1;
  }
  for (const account of Object.values(state.economyAccounts)) {
    if (account.status !== "active" || !account.bank_product_id) continue;
    const product = findBankProduct(catalog, account.bank_product_id);
    if (!product || product.monthly_fee_ngn <= 0) continue;
    if (account.balance_ngn < product.monthly_fee_ngn) continue;
    const balanceBefore = account.balance_ngn;
    account.balance_ngn -= product.monthly_fee_ngn;
    account.total_fees_paid_ngn += product.monthly_fee_ngn;
    account.updated_at = new Date(now).toISOString();
    const txId = `economy-tx-${randomUUID()}`;
    state.economyTransactions[txId] = {
      transaction_id: txId,
      account_id: account.account_id,
      character_id: account.character_id,
      kind: "bank_fee",
      amount_ngn: product.monthly_fee_ngn,
      balance_before_ngn: balanceBefore,
      balance_after_ngn: account.balance_ngn,
      fee_ngn: product.monthly_fee_ngn,
      description: `Monthly account fee for ${product.label}.`,
      world_date: cloneDate(date),
      minute_of_day: 0,
      posted_at: new Date(now).toISOString(),
      reference_id: account.bank_product_id,
      counterparty_account_id: null,
      idempotency_key: createHash("sha256").update(`monthly-fee:${account.account_id}:${date.year}:${date.month}`).digest("hex"),
    };
  }
  for (const loan of Object.values(state.economyLoans)) {
    if (loan.status !== "active") continue;
    if (loan.next_payment_date.year < date.year ||
      (loan.next_payment_date.year === date.year && loan.next_payment_date.month < date.month) ||
      (loan.next_payment_date.year === date.year && loan.next_payment_date.month === date.month && loan.next_payment_date.day < date.day)) {
      loan.payments_missed += 1;
      const product = findLoanProduct(catalog, loan.loan_product_id);
      if (product && product.late_payment_fee_ngn > 0) {
        loan.remaining_principal_ngn += product.late_payment_fee_ngn;
      }
      loan.updated_at = new Date(now).toISOString();
      adjustCreditScore(state, loan.character_id, -20, `Missed loan payment for ${loan.loan_id}.`, date, now);
      if (loan.payments_missed >= 6) {
        loan.status = "defaulted";
        adjustCreditScore(state, loan.character_id, -100, `Loan ${loan.loan_id} defaulted.`, date, now);
        appendEconomyEvent(state, loan.character_id, "loan_defaulted", `Loan ${loan.loan_id} has defaulted after ${loan.payments_missed} missed payments.`, date, 0, now, {
          loan_id: loan.loan_id, payments_missed: loan.payments_missed,
        }, { loan_id: loan.loan_id });
      }
    }
  }
  return interestCount;
}

export function buildEconomyProfile(
  state: PersistentWorldState,
  characterId: string,
  catalog: EconomyCatalog = loadEconomyCatalog(),
): EconomyProfileSnapshot {
  const accounts = accountsForCharacter(state, characterId);
  const cashAccount = accounts.find((account) => account.kind === "cash");
  const bankAccounts = accounts.filter((account) => account.kind !== "cash");
  const totalBankBalance = bankAccounts.reduce((total, account) => total + account.balance_ngn, 0);
  const cashBalance = cashAccount?.balance_ngn ?? 0;
  const accountSnapshots: EconomyAccountSnapshot[] = accounts.map((account) => {
    const product = account.bank_product_id ? findBankProduct(catalog, account.bank_product_id) : undefined;
    return {
      account_id: account.account_id,
      kind: account.kind,
      bank_product_id: account.bank_product_id,
      bank_product_label: product?.label ?? null,
      balance_ngn: account.balance_ngn,
      status: account.status,
      created_world_date: account.created_world_date,
      total_deposited_ngn: account.total_deposited_ngn,
      total_withdrawn_ngn: account.total_withdrawn_ngn,
      total_fees_paid_ngn: account.total_fees_paid_ngn,
      total_interest_earned_ngn: account.total_interest_earned_ngn,
      interest_rate_monthly_percent: product?.interest_rate_monthly_percent ?? 0,
    };
  });
  const loans = loansForCharacter(state, characterId);
  const loanSnapshots: EconomyLoanSnapshot[] = loans.map((loan) => {
    const product = findLoanProduct(catalog, loan.loan_product_id);
    return {
      loan_id: loan.loan_id,
      loan_product_id: loan.loan_product_id,
      loan_product_label: product?.label ?? loan.loan_product_id,
      principal_ngn: loan.principal_ngn,
      remaining_principal_ngn: loan.remaining_principal_ngn,
      interest_rate_monthly_percent: loan.interest_rate_monthly_percent,
      term_months: loan.term_months,
      monthly_payment_ngn: loan.monthly_payment_ngn,
      status: loan.status,
      start_date: loan.start_date,
      end_date: loan.end_date,
      next_payment_date: loan.next_payment_date,
      payments_made: loan.payments_made,
      payments_missed: loan.payments_missed,
      total_paid_ngn: loan.total_paid_ngn,
    };
  });
  const allTransactions = Object.values(state.economyTransactions)
    .filter((tx) => tx.character_id === characterId)
    .sort((left, right) => right.posted_at.localeCompare(left.posted_at))
    .slice(0, catalog.rules.maximum_transaction_history_per_account);
  const events = Object.values(state.economyEvents)
    .filter((event) => event.character_id === characterId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 100);
  return {
    schema_version: 1,
    character_id: characterId,
    currency: catalog.rules.currency,
    currency_label: catalog.rules.currency_label,
    currency_symbol: catalog.rules.currency_symbol,
    cash_balance_ngn: cashBalance,
    total_bank_balance_ngn: totalBankBalance,
    total_wealth_ngn: cashBalance + totalBankBalance,
    credit_score: creditScoreFor(state, characterId),
    accounts: accountSnapshots,
    loans: loanSnapshots,
    recent_transactions: allTransactions,
    events,
  };
}

export function listMarketGoodsForLocation(
  catalog: EconomyCatalog,
  locationId: string,
): EconomyMarketGood[] {
  return catalog.market_goods.filter((good) => good.location_ids.includes(locationId));
}

export function estimateIncomeTax(monthlyIncomeNgn: number, catalog: EconomyCatalog = loadEconomyCatalog()): number {
  return calculateIncomeTax(monthlyIncomeNgn, catalog);
}

export function syncCharacterCashFromEconomy(state: PersistentWorldState, characterId: string): void {
  const player = characterForId(state, characterId);
  if (!player) return;
  const cashAccount = accountsForCharacter(state, characterId).find((account) => account.kind === "cash");
  if (cashAccount) {
    player.character.money = cashAccount.balance_ngn;
  }
}

export function economyErrorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    economy_character_not_found: "Your character record is not available in this world.",
    economy_character_deceased: "Deceased characters cannot use economy services.",
    economy_bank_product_not_found: "That bank product is not available.",
    economy_account_limit_reached: "You have reached the maximum number of bank accounts.",
    economy_account_not_found: "That account does not belong to this character.",
    economy_account_not_active: "That account is not currently active.",
    economy_no_cash_account: "No cash account is available for this character.",
    economy_deposit_amount_invalid: "The deposit amount is outside the allowed range.",
    economy_withdrawal_amount_invalid: "The withdrawal amount is outside the allowed range.",
    economy_transfer_amount_invalid: "The transfer amount is outside the allowed range.",
    economy_same_account_transfer: "You cannot transfer between the same account.",
    economy_insufficient_funds: "You do not have enough funds for this transaction.",
    economy_balance_limit_exceeded: "This transaction would exceed the account balance limit.",
    economy_daily_withdrawal_limit: "You have reached the daily withdrawal limit for this account.",
    economy_minimum_balance_not_met: "The deposit does not meet the account minimum balance.",
    economy_good_not_found: "That market good is not available in the catalogue.",
    economy_good_not_available_here: "That good is not sold at this location.",
    economy_purchase_quantity_invalid: "The purchase quantity is invalid.",
    economy_purchase_amount_invalid: "The total purchase amount exceeds the allowed limit.",
    economy_loan_product_not_found: "That loan product is not available.",
    economy_loan_amount_invalid: "The loan amount is outside the allowed range.",
    economy_loan_term_invalid: "The loan term is outside the allowed range.",
    economy_credit_score_too_low: "Your credit score is too low for this loan.",
    economy_loan_requires_employment: "This loan requires an active employment record.",
    economy_too_many_active_loans: "You have too many active loans.",
    economy_loan_not_found: "That loan does not belong to this character.",
    economy_loan_not_active: "That loan is no longer active.",
    economy_repayment_amount_invalid: "The repayment amount is too small.",
    economy_salary_amount_invalid: "The salary amount is outside the allowed range.",
    economy_salary_balance_limit: "The account cannot accept this salary payment.",
  };
  return messages[code] ?? "The economy request could not be completed.";
}
