"use client";

/**
 * Orca Personal Finance - Main Application Shell (Orca Financial Brand)
 * Strictly conforms to Master Prompt (B1–B9)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  FinanceProfile,
  MonthlySnapshot,
  AssumptionSet,
  Insight,
} from './types/finance.ts';
import {
  loadProfileFromStorage,
  saveProfileToStorage,
  loadSnapshotsFromStorage,
  saveSnapshotsToStorage,
  loadAssumptionsFromStorage,
  saveAssumptionsToStorage,
  generateDemoSnapshots,
  INITIAL_EMPTY_PROFILE,
  wipeAllUserData,
  createSnapshotFromEntries,
} from './storage/financeStore.ts';
import { generateQuantitativeAdvice } from './engines/adviceEngine.ts';
import { Header } from './components/Header.tsx';
import { Footer } from './components/Footer.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { CheckinWizard } from './components/CheckinWizard.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { PlanningView } from './components/PlanningView.tsx';
import { AdviceView } from './components/AdviceView.tsx';
import { ReportView } from './components/ReportView.tsx';
import { AssumptionsAndMarketView } from './components/AssumptionsAndMarketView.tsx';
import { PrivacyAndDataView } from './components/PrivacyAndDataView.tsx';
import { EngineVerificationModal } from './components/EngineVerificationModal.tsx';

import { QuickCashflowCalculator } from './components/QuickCashflowCalculator.tsx';
import { AskOrcaAiView } from './components/AskOrcaAiView.tsx';
import { ExpenseItem } from './types/finance.ts';

export default function App() {
  const [profile, setProfile] = useState<FinanceProfile>(() => loadProfileFromStorage());
  const [snapshots, setSnapshots] = useState<MonthlySnapshot[]>(() => loadSnapshotsFromStorage());
  const [assumptions, setAssumptions] = useState<AssumptionSet>(() => loadAssumptionsFromStorage());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);

  useEffect(() => {
    const validTabs = new Set(['dashboard', 'ask_orca', 'cashflow_calc', 'checkin', 'analytics', 'planning', 'advice', 'report', 'market', 'privacy']);
    const syncTabFromHash = () => {
      const tab = window.location.hash.slice(1);
      if (validTabs.has(tab)) setActiveTab(tab);
    };
    const syncTabFromNavigation = (event: Event) => {
      const tab = (event as CustomEvent<string>).detail;
      if (validTabs.has(tab)) {
        setActiveTab(tab);
        window.history.replaceState(null, '', `#${tab}`);
      }
    };
    syncTabFromHash();
    window.addEventListener('hashchange', syncTabFromHash);
    window.addEventListener('orca:personal-finance-tab', syncTabFromNavigation);
    return () => {
      window.removeEventListener('hashchange', syncTabFromHash);
      window.removeEventListener('orca:personal-finance-tab', syncTabFromNavigation);
    };
  }, []);

  const handleSelectTab = (tab: string) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${tab}`);
      window.dispatchEvent(new CustomEvent('orca:personal-finance-tab', { detail: tab }));
    }
  };

  // Lưu trạng thái đã làm / bỏ qua của insights
  const [insightStatusOverrides, setInsightStatusOverrides] = useState<Record<string, 'new' | 'completed' | 'dismissed'>>({});

  // Lấy danh sách các kỳ hiện có
  const availablePeriods = useMemo(() => {
    const periods = Array.from(new Set(snapshots.map((s) => s.period)));
    return periods.sort().reverse();
  }, [snapshots]);

  const [currentPeriod, setCurrentPeriod] = useState<string>(() => {
    return availablePeriods[0] || '2026-10';
  });

  // Tìm snapshot của kỳ đang chọn
  const currentSnapshot = useMemo(() => {
    const found = snapshots.find((s) => s.period === currentPeriod);
    if (found) return found;
    return snapshots[0] || generateDemoSnapshots()[2];
  }, [snapshots, currentPeriod]);

  // Sinh danh sách lời khuyên 6 phần cho kỳ đang chọn
  const currentInsights = useMemo(() => {
    if (!currentSnapshot) return [];
    const baseAdvice = generateQuantitativeAdvice({
      period: currentSnapshot.period,
      profile,
      metrics: currentSnapshot.metrics,
      debts: currentSnapshot.debts,
      expenses: currentSnapshot.expenses,
      goals: currentSnapshot.goals,
    });

    return baseAdvice.map((ins) => ({
      ...ins,
      status: insightStatusOverrides[ins.id] || ins.status,
    }));
  }, [currentSnapshot, profile, insightStatusOverrides]);

  // Kiểm tra cờ Demo
  const isDemo = currentSnapshot?.isDemo === true;

  // Cập nhật Profile
  const handleUpdateProfile = (newProfile: FinanceProfile) => {
    setProfile(newProfile);
    saveProfileToStorage(newProfile);
  };

  // Cập nhật Giả định
  const handleSaveAssumptions = (newAssumptions: AssumptionSet) => {
    setAssumptions(newAssumptions);
    saveAssumptionsToStorage(newAssumptions);
  };

  // Lưu snapshot từ Monthly Check-in
  const handleSaveSnapshot = (newSnapshot: MonthlySnapshot) => {
    const existingIndex = snapshots.findIndex((s) => s.period === newSnapshot.period);
    let updatedSnapshots: MonthlySnapshot[];

    if (existingIndex >= 0) {
      updatedSnapshots = [...snapshots];
      updatedSnapshots[existingIndex] = newSnapshot;
    } else {
      updatedSnapshots = [newSnapshot, ...snapshots];
    }

    setSnapshots(updatedSnapshots);
    saveSnapshotsToStorage(updatedSnapshots);
    setCurrentPeriod(newSnapshot.period);
  };

  // Áp dụng tính toán dòng tiền nhanh vào snapshot hiện tại
  const handleApplyCashflowToSnapshot = (params: {
    grossSalary: number;
    bonus: number;
    otherIncome: number;
    insuranceSalaryBase: number;
    dependentsCount: number;
    expenses: ExpenseItem[];
  }) => {
    if (!currentSnapshot) return;
    const updatedProfile: FinanceProfile = {
      ...profile,
      dependentsCount: params.dependentsCount,
      updatedAt: new Date().toLocaleDateString('vi-VN'),
    };
    handleUpdateProfile(updatedProfile);

    const recomputed = createSnapshotFromEntries({
      period: currentSnapshot.period,
      profile: updatedProfile,
      grossSalary: params.grossSalary,
      bonus: params.bonus,
      otherIncome: params.otherIncome,
      insuranceSalaryBase: params.insuranceSalaryBase,
      expenses: params.expenses,
      assets: currentSnapshot.assets,
      debts: currentSnapshot.debts,
      goals: currentSnapshot.goals,
      isDemo: currentSnapshot.isDemo,
    });

    handleSaveSnapshot(recomputed);
  };

  // Nạp lại DEMO
  const handleLoadDemo = () => {
    const demos = generateDemoSnapshots();
    setSnapshots(demos);
    saveSnapshotsToStorage(demos);
    setCurrentPeriod('2026-10');
    setActiveTab('dashboard');
  };

  // Bắt đầu Dữ liệu trống
  const handleStartBlank = () => {
    const blankSnapshot = createSnapshotFromEntries({
      period: '2026-10',
      profile: INITIAL_EMPTY_PROFILE,
      grossSalary: 20000000,
      bonus: 0,
      otherIncome: 0,
      insuranceSalaryBase: 20000000,
      expenses: [
        { id: 'exp-housing', category: 'housing', name: 'Tiền thuê nhà', amount: 5000000, isFixed: true },
        { id: 'exp-food', category: 'food', name: 'Ăn uống', amount: 4000000, isFixed: false },
      ],
      assets: [
        { id: 'ast-cash', category: 'cash', name: 'Tiền mặt & ví', balance: 10000000, updatedAt: '05/10/2026' },
      ],
      debts: [],
      goals: [
        { id: 'g-fund', name: 'Quỹ khẩn cấp 3 tháng', targetAmount: 30000000, accumulatedAmount: 10000000, deadline: '2027-04', priority: 'high', status: 'on_track' },
      ],
      isDemo: false,
    });

    setProfile(INITIAL_EMPTY_PROFILE);
    saveProfileToStorage(INITIAL_EMPTY_PROFILE);
    setSnapshots([blankSnapshot]);
    saveSnapshotsToStorage([blankSnapshot]);
    setCurrentPeriod('2026-10');
    setActiveTab('checkin');
  };

  // Xóa toàn bộ dữ liệu
  const handleWipeData = () => {
    wipeAllUserData();
    handleStartBlank();
  };

  // Đổi trạng thái lời khuyên
  const handleToggleInsightStatus = (
    id: string,
    newStatus: 'new' | 'completed' | 'dismissed'
  ) => {
    setInsightStatusOverrides((prev) => ({
      ...prev,
      [id]: newStatus,
    }));
  };

  return (
    <div className="min-h-screen bg-[#060b15] text-slate-100 flex flex-col font-sans">
      {/* Institutional Top Header */}
      <Header
        currentPeriod={currentPeriod}
        availablePeriods={availablePeriods}
        onSelectPeriod={(p) => setCurrentPeriod(p)}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isDemo={isDemo}
        onLoadDemo={handleLoadDemo}
        onStartBlank={handleStartBlank}
        onOpenTestModal={() => setIsTestModalOpen(true)}
        onStartCheckin={() => setActiveTab('checkin')}
      />

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-16">
        {activeTab === 'dashboard' && (
          <DashboardView
            currentSnapshot={currentSnapshot}
            allSnapshots={snapshots}
            insights={currentInsights}
            onNavigateToCheckin={() => setActiveTab('checkin')}
            onNavigateToAdvice={() => setActiveTab('advice')}
            onNavigateToPlanning={() => setActiveTab('planning')}
            onNavigateToAskOrca={() => setActiveTab('ask_orca')}
            onToggleInsightStatus={handleToggleInsightStatus}
            onApplyCashflowToSnapshot={handleApplyCashflowToSnapshot}
          />
        )}

        {activeTab === 'ask_orca' && (
          <AskOrcaAiView
            currentSnapshot={currentSnapshot}
            profile={profile}
            onNavigateToCalculator={() => setActiveTab('cashflow_calc')}
            onNavigateToCheckin={() => setActiveTab('checkin')}
          />
        )}

        {activeTab === 'cashflow_calc' && (
          <div className="space-y-4">
            <QuickCashflowCalculator
              currentSnapshot={currentSnapshot}
              onApplyCashflowToSnapshot={handleApplyCashflowToSnapshot}
            />
          </div>
        )}

        {activeTab === 'checkin' && (
          <CheckinWizard
            currentPeriod={currentPeriod}
            profile={profile}
            latestSnapshot={currentSnapshot}
            onSaveSnapshot={handleSaveSnapshot}
            onCancel={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView currentSnapshot={currentSnapshot} />
        )}

        {activeTab === 'planning' && (
          <PlanningView
            currentSnapshot={currentSnapshot}
            assumptions={assumptions}
          />
        )}

        {activeTab === 'advice' && (
          <AdviceView
            insights={currentInsights}
            onToggleStatus={handleToggleInsightStatus}
          />
        )}

        {activeTab === 'report' && (
          <ReportView
            currentSnapshot={currentSnapshot}
            profile={profile}
          />
        )}

        {activeTab === 'market' && (
          <AssumptionsAndMarketView
            assumptions={assumptions}
            onSaveAssumptions={handleSaveAssumptions}
          />
        )}

        {activeTab === 'privacy' && (
          <PrivacyAndDataView
            profile={profile}
            snapshots={snapshots}
            onUpdateProfile={handleUpdateProfile}
            onWipeData={handleWipeData}
          />
        )}
      </main>

      {/* Engine Verification Modal (B8 Acceptance Check Suite) */}
      <EngineVerificationModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />

      {/* Institutional Fixed Footer */}
      <Footer />
    </div>
  );
}
