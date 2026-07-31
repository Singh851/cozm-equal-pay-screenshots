#!/usr/bin/env node
/**
 * Technical test suite for Cozm Equal Pay calculation engine.
 * Tests all three country engines (CH/FR/ES) with hand-calculated golden cases.
 * Run: node test-calculations.js
 */

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
let passed = 0, failed = 0;

function check(name, actual, expected, tolerance = 0.01) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  ${PASS} ${name}: ${actual.toFixed(2)} (expected ${expected.toFixed(2)}, diff ${diff.toFixed(4)})`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${name}: ${actual.toFixed(2)} (expected ${expected.toFixed(2)}, diff ${diff.toFixed(4)})`);
    failed++;
  }
}

// ===== CALCULATION ENGINE (extracted from index.html) =====

function getExchangeRate(from, to) {
  if (from === to) return 1;
  const rates = {
    'GBP_EUR': 1.17, 'EUR_GBP': 1/1.17,
    'GBP_CHF': 1.11, 'CHF_GBP': 1/1.11,
    'EUR_CHF': 0.94, 'CHF_EUR': 1/0.94,
    'USD_EUR': 0.92, 'EUR_USD': 1/0.92,
    'USD_CHF': 0.87, 'CHF_USD': 1/0.87,
  };
  return rates[`${from}_${to}`] || 1;
}

function calculate(form, country, countryData) {
  const f = form;
  const cd = countryData;
  const agreement = cd.agreements.find(a => a.id === f.agreementId);
  const hostCurrency = cd.currency;

  let assignmentDays = f.assignmentDays;
  if (!assignmentDays) assignmentDays = 1;

  const hoursPerDay = f.scheduledHoursPerWeek / 5;
  const totalScheduledHours = assignmentDays * hoursPerDay;

  // HOME
  const annualWorkingHours = f.homeWeeklyHours * 52;
  const homeHourlyBase = (f.baseSalaryAnnual || 0) / annualWorkingHours;
  const home13thHourly = (f.bonuses13th || 0) / annualWorkingHours;
  const home14thHourly = (f.bonuses14th || 0) / annualWorkingHours;
  const homeHolidayPayHourly = (f.holidayPayRate || 0) / annualWorkingHours;
  const homeOtherHourly = (f.otherAllowances || 0) / annualWorkingHours;

  const assignmentAllowanceRem = (f.assignmentAllowance || 0) - (f.assignmentAllowanceExpensePortion || 0);
  const homeAssignAllowHourly = totalScheduledHours > 0 ? assignmentAllowanceRem / totalScheduledHours : 0;

  const totalHomeHourlyHomeCurrency = homeHourlyBase + home13thHourly + home14thHourly + homeHolidayPayHourly + homeOtherHourly + homeAssignAllowHourly;

  const fx = getExchangeRate(f.homeCurrency, hostCurrency);
  const totalHomeHourlyHostCurrency = totalHomeHourlyHomeCurrency * fx;

  // HOST
  const hostMinHourly = agreement ? agreement.minHourly : 0;
  const gradeMultiplier = { entry: 1.0, standard: 1.0, senior: 1.10, manager: 1.20 }[f.grade] || 1.0;
  const expMultiplier = 1 + Math.min(f.experience * 0.01, 0.15);
  const adjustedHostHourly = hostMinHourly * gradeMultiplier * expMultiplier;

  const hostBaseForPeriod = adjustedHostHourly * totalScheduledHours;
  const hostOvertimePay = (f.overtimeHours || 0) * adjustedHostHourly * (cd.overtimeRate - 1);
  const hostNightPay = (f.nightHours || 0) * adjustedHostHourly * (cd.nightRate - 1);
  const hostSundayPay = (f.sundayHours || 0) * adjustedHostHourly * (cd.sundayRate - 1);
  const hostHolidayPay = (f.publicHolidayHours || 0) * adjustedHostHourly * (cd.holidayRate - 1);

  let host13thPay = 0, host14thPay = 0;
  const weeklyHrs = f.scheduledHoursPerWeek || cd.maxWeeklyHours;
  if (country === 'ES' && cd.pagas) {
    const yearFraction = assignmentDays / cd.workingDays;
    host13thPay = (adjustedHostHourly * weeklyHrs * 52 / 12) * yearFraction;
    host14thPay = host13thPay;
  }
  if (country === 'FR' && (f.agreementId === 'fr-metallurgy' || f.agreementId === 'fr-syntec')) {
    const yearFraction = assignmentDays / cd.workingDays;
    host13thPay = (adjustedHostHourly * weeklyHrs * 52 / 12) * yearFraction;
  }
  if (country === 'CH' && (f.agreementId === 'ch-gav-bau' || f.agreementId === 'ch-gav-maler')) {
    const yearFraction = assignmentDays / cd.workingDays;
    host13thPay = (adjustedHostHourly * weeklyHrs * 52 / 12) * yearFraction;
  }

  const annualLeaveProRated = cd.minAnnualLeave * (assignmentDays / cd.workingDays);
  const hostHolidayPayEntitlement = annualLeaveProRated * hoursPerDay * adjustedHostHourly;

  const totalHostEntitlement = hostBaseForPeriod + hostOvertimePay + hostNightPay + hostSundayPay + hostHolidayPay + host13thPay + host14thPay + hostHolidayPayEntitlement;

  const totalHomeForPeriod = totalHomeHourlyHostCurrency * totalScheduledHours;
  const shortfall = totalHostEntitlement - totalHomeForPeriod;
  const uplift = Math.max(0, shortfall);

  return {
    totalHomeHourlyHomeCurrency,
    totalHomeHourlyHostCurrency,
    homeHourlyBase,
    adjustedHostHourly,
    hostBaseForPeriod,
    hostOvertimePay,
    hostNightPay,
    hostSundayPay,
    hostHolidayPay,
    host13thPay,
    host14thPay,
    hostHolidayPayEntitlement,
    totalHostEntitlement,
    totalHomeForPeriod,
    shortfall,
    uplift,
    totalScheduledHours,
    assignmentDays,
    fx,
  };
}

// ===== COUNTRY DATA (same as index.html) =====

const CH = {
  currency: 'CHF', workingDays: 260, maxWeeklyHours: 45, overtimeRate: 1.25,
  nightRate: 1.25, sundayRate: 1.50, holidayRate: 1.50,
  minAnnualLeave: 20, publicHolidays: 9,
  agreements: [
    { id: 'ch-gav-bau', name: 'GAV Bauhauptgewerbe', minHourly: 28.35 },
    { id: 'ch-gav-gastro', name: 'L-GAV Gastgewerbe', minHourly: 21.09 },
    { id: 'ch-cantonal-ge', name: 'Geneva Cantonal', minHourly: 24.32 },
    { id: 'ch-other', name: 'Other', minHourly: 0 },
  ]
};

const FR = {
  currency: 'EUR', workingDays: 228, maxWeeklyHours: 35, overtimeRate: 1.25,
  nightRate: 1.25, sundayRate: 2.00, holidayRate: 2.00,
  minAnnualLeave: 25, publicHolidays: 11,
  agreements: [
    { id: 'fr-btp', name: 'CCN Batiment', minHourly: 13.09 },
    { id: 'fr-syntec', name: 'CCN Syntec', minHourly: 14.20 },
    { id: 'fr-smic', name: 'SMIC', minHourly: 11.88 },
  ]
};

const ES = {
  currency: 'EUR', workingDays: 228, maxWeeklyHours: 40, overtimeRate: 1.25,
  nightRate: 1.25, sundayRate: 1.50, holidayRate: 1.50,
  pagas: 2,
  minAnnualLeave: 22, publicHolidays: 14,
  agreements: [
    { id: 'es-construccion', name: 'Convenio Construccion', minHourly: 10.25 },
    { id: 'es-metal-madrid', name: 'Convenio Metal Madrid', minHourly: 10.80 },
    { id: 'es-smi', name: 'SMI', minHourly: 8.87 },
  ]
};

// ============================================================
// TEST 1: Switzerland - Construction worker, GBP home, 20 days
// ============================================================
console.log('\n=== TEST 1: Switzerland - Construction (GAV Bau), GBP home, 20 days ===');
{
  const form = {
    baseSalaryAnnual: 35000, homeWeeklyHours: 40, homeCurrency: 'GBP',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'ch-gav-bau', grade: 'standard', experience: 0,
    scheduledHoursPerWeek: 42, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 20,
  };
  const r = calculate(form, 'CH', CH);

  // Hand calculation:
  // Home: 35000 / (40*52) = 16.8269 GBP/hr
  // FX GBP->CHF = 1.11 => 16.8269 * 1.11 = 18.6779 CHF/hr
  // Host: 28.35 CHF/hr (standard, 0 exp)
  // Total scheduled: 20 * 42/5 = 168 hrs
  // Host base: 28.35 * 168 = 4762.80
  // Holiday pro-rate: 20 * (20/260) = 1.5385 days * 8.4 hrs/day * 28.35 = 366.46
  // 13th month (GAV Bau): 28.35 * 42 * 52 / 12 * (20/260) = 28.35 * 182 * 0.07692 = 397.38
  // Total host: 4762.80 + 366.46 + 397.38 = 5526.64
  // Home total: 18.6779 * 168 = 3137.89
  // Shortfall: 5526.64 - 3137.89 = 2388.75
  // Uplift: 2388.75 CHF

  check('Home hourly (GBP)', r.homeHourlyBase, 35000 / (40*52));  // 16.8269
  check('FX GBP->CHF', r.fx, 1.11);
  check('Home hourly (CHF)', r.totalHomeHourlyHostCurrency, 16.8269 * 1.11, 0.02);
  check('Host hourly', r.adjustedHostHourly, 28.35);
  check('Total scheduled hrs', r.totalScheduledHours, 168);
  check('Host base for period', r.hostBaseForPeriod, 28.35 * 168, 0.01);
  check('Uplift > 0', r.uplift > 0 ? 1 : 0, 1);
  console.log(`  INFO: Uplift = CHF ${r.uplift.toFixed(2)}`);
}

// ============================================================
// TEST 2: France - Syntec IT worker, GBP home, 15 days
// ============================================================
console.log('\n=== TEST 2: France - Syntec (IT/Consulting), GBP home, 15 days ===');
{
  const form = {
    baseSalaryAnnual: 55000, homeWeeklyHours: 37.5, homeCurrency: 'GBP',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'fr-syntec', grade: 'senior', experience: 8,
    scheduledHoursPerWeek: 35, overtimeHours: 10, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 15,
  };
  const r = calculate(form, 'FR', FR);

  // Hand calculation:
  // Home: 55000 / (37.5*52) = 28.2051 GBP/hr
  // FX GBP->EUR = 1.17 => 28.2051 * 1.17 = 33.0000 EUR/hr
  // Host base: 14.20 * 1.10 (senior) * 1.08 (8yr exp) = 14.20 * 1.188 = 16.8696 EUR/hr
  // Total scheduled: 15 * 35/5 = 105 hrs
  // Host base for period: 16.8696 * 105 = 1771.31
  // OT supplement: 10 * 16.8696 * 0.25 = 42.17
  // Holiday pro-rate: 25 * (15/228) = 1.6447 days * 7 hrs * 16.8696 = 194.33
  // 13th (Syntec): 16.8696 * 35 * 52/12 * (15/228) = 16.8696 * 151.667 * 0.06579 = 168.37
  // Total host: 1771.31 + 42.17 + 194.33 + 168.37 = 2176.18
  // Home total: 33.00 * 105 = 3465.00
  // Shortfall: 2176.18 - 3465.00 = -1288.82 (home exceeds)
  // Uplift: 0

  check('Home hourly (GBP)', r.homeHourlyBase, 55000 / (37.5*52), 0.01);
  check('FX GBP->EUR', r.fx, 1.17);
  check('Host adjusted hourly', r.adjustedHostHourly, 14.20 * 1.10 * 1.08, 0.01);
  check('Total scheduled hrs', r.totalScheduledHours, 105);
  check('OT supplement', r.hostOvertimePay, 10 * r.adjustedHostHourly * 0.25, 0.01);
  check('Uplift is zero (home exceeds)', r.uplift, 0);
  console.log(`  INFO: Shortfall = EUR ${r.shortfall.toFixed(2)} (negative = home exceeds)`);
}

// ============================================================
// TEST 3: Spain - Construction, EUR home, 30 days with overtime
// ============================================================
console.log('\n=== TEST 3: Spain - Construction, EUR home, 30 days, overtime ===');
{
  const form = {
    baseSalaryAnnual: 24000, homeWeeklyHours: 40, homeCurrency: 'EUR',
    bonuses13th: 2000, bonuses14th: 2000, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 1500, assignmentAllowanceExpensePortion: 1000,
    agreementId: 'es-construccion', grade: 'standard', experience: 5,
    scheduledHoursPerWeek: 40, overtimeHours: 20, nightHours: 8, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 30,
  };
  const r = calculate(form, 'ES', ES);

  // Hand calculation:
  // Home base: 24000 / (40*52) = 11.5385 EUR/hr
  // Home 13th: 2000 / (40*52) = 0.9615 EUR/hr
  // Home 14th: 2000 / (40*52) = 0.9615 EUR/hr
  // Assign allow rem: (1500-1000) = 500 / (30*8) = 2.0833 EUR/hr
  // Total home hourly: 11.5385 + 0.9615 + 0.9615 + 2.0833 = 15.5448 EUR/hr
  // FX EUR->EUR = 1.0
  // Host: 10.25 * 1.0 (std) * 1.05 (5yr) = 10.7625 EUR/hr
  // Total scheduled: 30 * 8 = 240 hrs
  // Host base: 10.7625 * 240 = 2583.00
  // OT: 20 * 10.7625 * 0.25 = 53.81
  // Night: 8 * 10.7625 * 0.25 = 21.53
  // Pagas 13th: 10.7625 * 40 * 52/12 * (30/228) = 10.7625 * 173.33 * 0.1316 = 245.51
  // Pagas 14th: same = 245.51
  // Holiday: 22 * (30/228) = 2.8947 days * 8 hrs * 10.7625 = 249.24
  // Total host: 2583.00 + 53.81 + 21.53 + 245.51 + 245.51 + 249.24 = 3398.60
  // Home total: 15.5448 * 240 = 3730.75
  // Shortfall: 3398.60 - 3730.75 = -332.15 (home exceeds)
  // Uplift: 0

  check('Home hourly base', r.homeHourlyBase, 24000 / (40*52), 0.01);
  check('FX EUR->EUR', r.fx, 1.0);
  check('Host adjusted hourly', r.adjustedHostHourly, 10.25 * 1.0 * 1.05, 0.01);
  check('Total scheduled hrs', r.totalScheduledHours, 240);
  check('OT supplement', r.hostOvertimePay, 20 * r.adjustedHostHourly * 0.25, 0.01);
  check('Night supplement', r.hostNightPay, 8 * r.adjustedHostHourly * 0.25, 0.01);
  check('Pagas 13th > 0', r.host13thPay > 0 ? 1 : 0, 1);
  check('Pagas 14th > 0', r.host14thPay > 0 ? 1 : 0, 1);
  check('13th == 14th', Math.abs(r.host13thPay - r.host14thPay) < 0.01 ? 1 : 0, 1);
  check('Uplift is zero', r.uplift, 0);
  console.log(`  INFO: Shortfall = EUR ${r.shortfall.toFixed(2)}`);
}

// ============================================================
// TEST 4: Spain - Low-paid worker, EUR home, uplift expected
// ============================================================
console.log('\n=== TEST 4: Spain - SMI worker, EUR home, 10 days, uplift expected ===');
{
  const form = {
    baseSalaryAnnual: 14000, homeWeeklyHours: 40, homeCurrency: 'EUR',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'es-construccion', grade: 'entry', experience: 0,
    scheduledHoursPerWeek: 40, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 10,
  };
  const r = calculate(form, 'ES', ES);

  // Home: 14000 / (40*52) = 6.7308 EUR/hr
  // Host: 10.25 * 1.0 * 1.0 = 10.25 EUR/hr
  // Scheduled: 10 * 8 = 80 hrs
  // Host base: 10.25 * 80 = 820.00
  // Pagas 13th: 10.25 * 40 * 52/12 * (10/228) = 10.25 * 173.33 * 0.04386 = 77.93
  // Pagas 14th: same = 77.93
  // Holiday: 22 * (10/228) * 8 * 10.25 = 0.9649 * 8 * 10.25 = 79.12
  // Total host: 820 + 77.93 + 77.93 + 79.12 = 1054.98
  // Home: 6.7308 * 80 = 538.46
  // Shortfall: 1054.98 - 538.46 = 516.52
  // Uplift: 516.52

  check('Home hourly', r.homeHourlyBase, 14000 / (40*52), 0.01);
  check('Host hourly', r.adjustedHostHourly, 10.25);
  check('Uplift > 0', r.uplift > 0 ? 1 : 0, 1);
  check('Shortfall positive', r.shortfall > 400 ? 1 : 0, 1);
  console.log(`  INFO: Uplift = EUR ${r.uplift.toFixed(2)}, Shortfall = EUR ${r.shortfall.toFixed(2)}`);
}

// ============================================================
// TEST 5: Switzerland - Geneva cantonal min, high home salary
// ============================================================
console.log('\n=== TEST 5: Switzerland - Geneva cantonal, high EUR salary, no uplift ===');
{
  const form = {
    baseSalaryAnnual: 80000, homeWeeklyHours: 40, homeCurrency: 'EUR',
    bonuses13th: 6666, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'ch-cantonal-ge', grade: 'senior', experience: 10,
    scheduledHoursPerWeek: 42, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 5,
  };
  const r = calculate(form, 'CH', CH);

  // Home: 80000 / (40*52) = 38.4615 EUR/hr
  // 13th: 6666 / (40*52) = 3.2048 EUR/hr
  // Total: 41.6663 EUR/hr
  // FX EUR->CHF = 0.94 => 41.6663 * 0.94 = 39.1663 CHF/hr
  // Host: 24.32 * 1.10 * 1.10 = 29.4272 CHF/hr
  // Scheduled: 5 * 8.4 = 42 hrs
  // Host base: 29.4272 * 42 = 1235.94
  // Holiday: 20 * (5/260) * 8.4 * 29.4272 = 0.3846 * 8.4 * 29.4272 = 95.11
  // No 13th (Geneva cantonal, not GAV Bau)
  // Total host: 1235.94 + 95.11 = 1331.05
  // Home: 39.1663 * 42 = 1644.99
  // Shortfall: 1331.05 - 1644.99 = -313.94 (home exceeds)

  check('Home hourly (EUR)', r.totalHomeHourlyHomeCurrency, (80000 + 6666) / (40*52), 0.02);
  check('Host adjusted', r.adjustedHostHourly, 24.32 * 1.10 * 1.10, 0.01);
  check('No 13th (Geneva cantonal)', r.host13thPay, 0);
  check('Uplift zero', r.uplift, 0);
  console.log(`  INFO: Shortfall = CHF ${r.shortfall.toFixed(2)}`);
}

// ============================================================
// TEST 6: France - SMIC minimum, very low home salary
// ============================================================
console.log('\n=== TEST 6: France - SMIC, EUR home, 22 days, uplift expected ===');
{
  const form = {
    baseSalaryAnnual: 18000, homeWeeklyHours: 35, homeCurrency: 'EUR',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'fr-smic', grade: 'entry', experience: 0,
    scheduledHoursPerWeek: 35, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 22,
  };
  const r = calculate(form, 'FR', FR);

  // Home: 18000 / (35*52) = 9.8901 EUR/hr
  // Host: 11.88 EUR/hr (SMIC, entry, 0 exp)
  // Scheduled: 22 * 7 = 154 hrs
  // Host base: 11.88 * 154 = 1829.52
  // Holiday: 25 * (22/228) * 7 * 11.88 = 2.4123 * 7 * 11.88 = 200.67
  // No 13th (SMIC)
  // Total host: 1829.52 + 200.67 = 2030.19
  // Home: 9.8901 * 154 = 1523.08
  // Shortfall: 2030.19 - 1523.08 = 507.11

  check('Home hourly', r.homeHourlyBase, 18000 / (35*52), 0.01);
  check('Host hourly (SMIC)', r.adjustedHostHourly, 11.88);
  check('No 13th for SMIC', r.host13thPay, 0);
  check('Uplift > 0', r.uplift > 0 ? 1 : 0, 1);
  console.log(`  INFO: Uplift = EUR ${r.uplift.toFixed(2)}`);
}

// ============================================================
// TEST 7: Edge case - zero base salary should produce uplift
// ============================================================
console.log('\n=== TEST 7: Edge case - zero base salary ===');
{
  const form = {
    baseSalaryAnnual: 0, homeWeeklyHours: 40, homeCurrency: 'EUR',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'fr-smic', grade: 'entry', experience: 0,
    scheduledHoursPerWeek: 35, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 1,
  };
  const r = calculate(form, 'FR', FR);
  check('Home hourly is zero', r.homeHourlyBase, 0);
  check('Uplift equals host entitlement', r.uplift, r.totalHostEntitlement, 0.01);
  console.log(`  INFO: Uplift = EUR ${r.uplift.toFixed(2)}`);
}

// ============================================================
// TEST 8: Assignment allowance expense split
// ============================================================
console.log('\n=== TEST 8: Assignment allowance - expense portion excluded ===');
{
  const formWithExpense = {
    baseSalaryAnnual: 30000, homeWeeklyHours: 40, homeCurrency: 'EUR',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 2000, assignmentAllowanceExpensePortion: 1500,
    agreementId: 'fr-smic', grade: 'entry', experience: 0,
    scheduledHoursPerWeek: 35, overtimeHours: 0, nightHours: 0, sundayHours: 0,
    publicHolidayHours: 0, assignmentDays: 10,
  };
  const formWithoutExpense = {
    ...formWithExpense, assignmentAllowance: 500, assignmentAllowanceExpensePortion: 0,
  };
  const r1 = calculate(formWithExpense, 'FR', FR);
  const r2 = calculate(formWithoutExpense, 'FR', FR);

  // Both should produce same result: 500 EUR remuneration portion
  check('Allow rem = 500 (2000-1500)', r1.totalHomeHourlyHomeCurrency, r2.totalHomeHourlyHomeCurrency, 0.001);
  check('Same uplift', Math.abs(r1.uplift - r2.uplift) < 0.01 ? 1 : 0, 1);
  console.log(`  INFO: Both produce uplift = EUR ${r1.uplift.toFixed(2)}`);
}

// ============================================================
// TEST 9: Overtime supplement-only calculation
// ============================================================
console.log('\n=== TEST 9: Overtime supplement is only the extra portion ===');
{
  const form = {
    baseSalaryAnnual: 50000, homeWeeklyHours: 40, homeCurrency: 'CHF',
    bonuses13th: 0, bonuses14th: 0, holidayPayRate: 0,
    otherAllowances: 0, assignmentAllowance: 0, assignmentAllowanceExpensePortion: 0,
    agreementId: 'ch-gav-bau', grade: 'standard', experience: 0,
    scheduledHoursPerWeek: 42, overtimeHours: 10, nightHours: 5, sundayHours: 4,
    publicHolidayHours: 2, assignmentDays: 5,
  };
  const r = calculate(form, 'CH', CH);

  // OT should be 25% supplement only (not 125%)
  const expectedOT = 10 * 28.35 * 0.25;   // 70.875
  const expectedNight = 5 * 28.35 * 0.25;  // 35.4375
  const expectedSun = 4 * 28.35 * 0.50;    // 56.70
  const expectedHol = 2 * 28.35 * 0.50;    // 28.35

  check('OT = 25% supplement only', r.hostOvertimePay, expectedOT, 0.01);
  check('Night = 25% supplement', r.hostNightPay, expectedNight, 0.01);
  check('Sunday = 50% supplement', r.hostSundayPay, expectedSun, 0.01);
  check('Holiday = 50% supplement', r.hostHolidayPay, expectedHol, 0.01);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(`${'='.repeat(60)}`);
process.exit(failed > 0 ? 1 : 0);
