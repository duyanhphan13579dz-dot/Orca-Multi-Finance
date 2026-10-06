/**
 * Personal finance localStorage (client-only). Ported from Orca Wallet.
 */

import type { FinanceProfile, MonthlySnapshot, AssumptionSet, FinancialGoal } from "./types";
import { DEFAULT_ASSUMPTIONS } from "./engines/projectionEngine";

function bumpSync() {
  try {
    void import("./sync").then((m) => m.schedulePfServerSync());
  } catch {
    /* ignore */
  }
}

const STORAGE_KEY_PROFILE = "orca_fin_profile_v1";
const STORAGE_KEY_SNAPSHOTS = "orca_fin_snapshots_v1";
const STORAGE_KEY_ASSUMPTIONS = "orca_fin_assumptions_v1";
const STORAGE_KEY_GOALS = "orca_fin_goals_v1";

export const INITIAL_EMPTY_PROFILE: FinanceProfile = {
  birthYear: 1996,
  maritalStatus: "single",
  dependentsCount: 0,
  employmentType: "salaried",
  riskTolerance: "moderate",
  consentStorage: true,
  consentAI: false,
  consentOpenBanking: false,
  updatedAt: new Date().toISOString(),
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadProfileFromStorage(): FinanceProfile {
  if (!canUseStorage()) return { ...INITIAL_EMPTY_PROFILE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (!raw) return { ...INITIAL_EMPTY_PROFILE };
    return { ...INITIAL_EMPTY_PROFILE, ...(JSON.parse(raw) as FinanceProfile) };
  } catch {
    return { ...INITIAL_EMPTY_PROFILE };
  }
}

export function saveProfileToStorage(profile: FinanceProfile): void {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
  bumpSync();
}

export function loadSnapshotsFromStorage(): MonthlySnapshot[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MonthlySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnapshotsToStorage(snapshots: MonthlySnapshot[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(snapshots));
  bumpSync();
}

export function loadAssumptionsFromStorage(): AssumptionSet {
  if (!canUseStorage()) return { ...DEFAULT_ASSUMPTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ASSUMPTIONS);
    if (!raw) return { ...DEFAULT_ASSUMPTIONS };
    return { ...DEFAULT_ASSUMPTIONS, ...(JSON.parse(raw) as AssumptionSet) };
  } catch {
    return { ...DEFAULT_ASSUMPTIONS };
  }
}

export function saveAssumptionsToStorage(assumptions: AssumptionSet): void {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY_ASSUMPTIONS, JSON.stringify(assumptions));
  bumpSync();
}

export function loadGoalsFromStorage(): FinancialGoal[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GOALS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FinancialGoal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveGoalsToStorage(goals: FinancialGoal[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY_GOALS, JSON.stringify(goals));
  bumpSync();
}

export function wipeAllUserData(): void {
  if (!canUseStorage()) return;
  localStorage.removeItem(STORAGE_KEY_PROFILE);
  localStorage.removeItem(STORAGE_KEY_SNAPSHOTS);
  localStorage.removeItem(STORAGE_KEY_ASSUMPTIONS);
  localStorage.removeItem(STORAGE_KEY_GOALS);
  localStorage.removeItem("orca_fin_updated_at_v1");
}

export function exportDataAsJson(
  profile: FinanceProfile,
  snapshots: MonthlySnapshot[],
): string {
  return JSON.stringify({ profile, snapshots, exportedAt: new Date().toISOString() }, null, 2);
}
