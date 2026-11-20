
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: {
              navy: '#0b1329',
              dark: '#0f172a',
              card: '#1e293b',
              accent: '#2563eb',
              accentHover: '#1d4ed8'
            }
          }
        }
      }
    }
  

    // --- APP STATE ---
    const state = {
      employees: [],
      shifts: [],
      dates: [],
      lastDateOfWeek: '',
      rawPPA: '',
      rawEMP: '',
      rawWW: '',
      wwEmployeeEids: null,
      empReportRecords: [],
      empHoursFromEMP: {},
      empShiftsFromEMP: {}, // eid -> date -> [shifts]
      empInfoFromEMP: {},
      empActualHours: {},
      empWorkingDates: {},
      empDayWorkingShifts: {}, // eid -> date -> [shifts]
      sessionAssignments: [],
      activeLinkingShiftId: null,
      filterMatchingOnly: false,
      activeTab: 'shift', // Default to Shift-First Mode for rapid shift filling
      gridFilter: 'all',
      gridSearch: '',
      // Mode 2: Shift-First state
      shiftFirstSelectedDay: 'all', // 'all' or specific date e.g. '11/14/2026'
      shiftFirstJobFilter: 'all', // 'all' | '233265' | '235144' | '266778' | '267588'
      shiftFirstSearch: '',
      shiftFirstStatusFilter: 'open', // 'open' | 'assigned' | 'all'
      shiftFirstTierFilter: 'all', // 'all' | 'tier1' | 'under45'
      shiftFirstSort: 'time', // 'winteam' | 'post' | 'time' | 'hours' | 'candidates'
      shiftFirstExpandedShifts: {}, // shiftId -> boolean
      shiftFirstShowConflicted: {}, // shiftId -> boolean
      shiftFirstShowHiredFallback: {}, // shiftId -> boolean
      avoidHiredAV: false,
      queueSelectedShiftId: null,
      simProposal: null,
      otApprovals: {},
      companyOT: { sixthDay: false, seventhDay: false, dailyCap: 8, weeklyCap: 40.0, notes: '', updatedAt: '' },
      autoFillAllowApprovedOT: true,
      autoFillPrioritizeNonOT: true,
      autoFillAllowOver45OT: true,
      winteamFilter: 'all', // 'all' | 'ot' | 'regular'
      winteamJobFilter: 'all', // 'all' | '233265' | '235144' | '266778' | '267588'
      winteamFilteredAssignments: null,
      winteamSearch: '',
      filesStatus: {
        ppa: { loaded: false, filename: '', count: 0, openCount: 0 },
        emp: { loaded: false, filename: '', count: 0, specialistCount: 0 },
        ww: { loaded: false, filename: '', count: 0 }
      }
    };

    // --- COMPANY-WIDE OVERTIME POLICY STORAGE & MANAGEMENT ---
    // Overtime approvals are at the company level: a single approval covers every SP in the company.
    const COMPANY_OT_STORAGE_KEY = 'ppa_shift_filler_company_ot_v1';

    function loadCompanyOTFromStorage() {
      try {
        const raw = localStorage.getItem(COMPANY_OT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            state.companyOT = {
              sixthDay: Boolean(parsed.sixthDay),
              seventhDay: Boolean(parsed.seventhDay),
              dailyCap: (parsed.dailyCap === 16 || parsed.dailyCap === 12) ? parsed.dailyCap : 8,
              weeklyCap: cleanFloat(parsed.weeklyCap) || 40.0,
              notes: parsed.notes || '',
              updatedAt: parsed.updatedAt || ''
            };
          }
        }
      } catch (e) {
        console.warn('Could not load company OT policy from storage:', e);
      }
      if (!state.companyOT) {
        state.companyOT = {
          sixthDay: false,
          seventhDay: false,
          dailyCap: 8,
          weeklyCap: 40.0,
          notes: '',
          updatedAt: ''
        };
      }
    }

    function saveCompanyOTToStorage() {
      try {
        localStorage.setItem(COMPANY_OT_STORAGE_KEY, JSON.stringify(state.companyOT || {}));
      } catch (e) {
        console.warn('Could not save company OT policy to storage:', e);
      }
      updateKPISummaries();
    }

    function getCompanyOTApprovals() {
      if (!state.companyOT) {
        loadCompanyOTFromStorage();
      }
      const c = state.companyOT || {};
      const hasAny = Boolean(c.sixthDay || c.seventhDay || (c.dailyCap && c.dailyCap > 8) || (c.weeklyCap && c.weeklyCap > 40.0));
      return {
        sixthDay: Boolean(c.sixthDay),
        seventhDay: Boolean(c.seventhDay),
        dailyCap: (c.dailyCap === 16 || c.dailyCap === 12) ? c.dailyCap : 8,
        weeklyCap: cleanFloat(c.weeklyCap) || 40.0,
        notes: c.notes || '',
        updatedAt: c.updatedAt || '',
        hasAny
      };
    }

    function getEmployeeOTApprovals(eid) {
      // Overtime approvals are company-wide: a single approval covers every SP in the company
      return getCompanyOTApprovals();
    }

    function setCompanyOTPolicy(newPolicy, showToastMsg = true) {
      if (!state.companyOT) state.companyOT = {};
      state.companyOT = {
        sixthDay: Boolean(newPolicy.sixthDay),
        seventhDay: Boolean(newPolicy.seventhDay),
        dailyCap: (newPolicy.dailyCap === 16 || newPolicy.dailyCap === 12) ? newPolicy.dailyCap : 8,
        weeklyCap: cleanFloat(newPolicy.weeklyCap) || 40.0,
        notes: (newPolicy.notes || '').trim(),
        updatedAt: new Date().toLocaleTimeString()
      };
      saveCompanyOTToStorage();

      state.employees.forEach(emp => {
        emp.otApprovals = getCompanyOTApprovals();
      });

      calculateAllHours();
      updateKPISummaries();
      if (state.activeTab === 'people') renderWorkingWeeksGrid();
      else renderShiftFirstDaysContent();
      renderWinTeamTable();
      renderCompanyOTModal();

      if (showToastMsg) {
        const tags = [];
        if (state.companyOT.sixthDay) tags.push('6th Day');
        if (state.companyOT.seventhDay) tags.push('7th Day');
        if (state.companyOT.dailyCap > 8) tags.push(`${state.companyOT.dailyCap}h Cap`);
        if (state.companyOT.weeklyCap > 40.0) tags.push(`${state.companyOT.weeklyCap}h Wk`);
        if (tags.length > 0) {
          showToast(`Company Overtime Policy Updated: ${tags.join(', ')} Authorized across all Specialists.`);
        } else {
          showToast('Company Overtime Policy reset to Standard (5-Day / 8h / 40h Max).');
        }
      }
    }

    function quickGrantOTApproval(eid, approvalType, shiftId = null) {
      const cur = getCompanyOTApprovals();
      let label = '';
      if (approvalType === 'sixthDay') {
        cur.sixthDay = true;
        label = '6th Day Overtime';
      } else if (approvalType === 'seventhDay') {
        cur.sixthDay = true;
        cur.seventhDay = true;
        label = '7th Day Overtime';
      } else if (approvalType === 'dailyCap12') {
        cur.dailyCap = Math.max(cur.dailyCap || 8, 12);
        label = '12-Hour Daily Cap';
      } else if (approvalType === 'dailyCap16') {
        cur.dailyCap = 16;
        label = '16-Hour Daily Cap';
      }
      setCompanyOTPolicy(cur, false);
      showToast(`Authorized ${label} company-wide (covers every SP in the company).`);
    }

    function openOTApprovalsModal() {
      const modal = document.getElementById('modalOTApprovals');
      if (!modal) return;
      modal.classList.remove('hidden');
      renderCompanyOTModal();
    }

    function closeOTApprovalsModal() {
      const modal = document.getElementById('modalOTApprovals');
      if (modal) modal.classList.add('hidden');
    }

    function renderCompanyOTModal() {
      const ot = getCompanyOTApprovals();
      const chk6 = document.getElementById('companyFormSixthDay');
      const chk7 = document.getElementById('companyFormSeventhDay');
      const radCaps = document.getElementsByName('radCompanyFormDailyCap');
      const numWk = document.getElementById('companyFormWeeklyCap');
      const txtNotes = document.getElementById('companyFormNotes');

      if (chk6) chk6.checked = ot.sixthDay;
      if (chk7) chk7.checked = ot.seventhDay;
      if (radCaps) {
        for (const r of radCaps) {
          r.checked = (parseInt(r.value, 10) === ot.dailyCap);
        }
      }
      if (numWk) numWk.value = ot.weeklyCap || 40.0;
      if (txtNotes) txtNotes.value = ot.notes || '';

      // Update KPI strip in modal
      const kpiStatus = document.getElementById('companyKpiStatus');
      const kpi6th = document.getElementById('companyKpi6thDay');
      const kpi7th = document.getElementById('companyKpi7thDay');
      const kpiCap = document.getElementById('companyKpiDailyCap');
      const kpiShifts = document.getElementById('companyKpiActiveShifts');
      const headerBadge = document.getElementById('otHeaderBadgeCount');
      const policySummary = document.getElementById('companyOTPolicySummary');

      if (kpiStatus) {
        kpiStatus.textContent = ot.hasAny ? 'ACTIVE (OT ENABLED)' : 'STANDARD (NO OT)';
        kpiStatus.className = `text-xs font-extrabold mt-1 ${ot.hasAny ? 'text-amber-800' : 'text-slate-700'}`;
      }
      if (kpi6th) {
        kpi6th.textContent = ot.sixthDay ? 'AUTHORIZED (ALL SPs)' : 'RESTRICTED (5-DAY)';
        kpi6th.className = `text-xs font-extrabold mt-1 ${ot.sixthDay ? 'text-blue-700 font-black' : 'text-slate-500'}`;
      }
      if (kpi7th) {
        kpi7th.textContent = ot.seventhDay ? 'AUTHORIZED (ALL SPs)' : 'RESTRICTED';
        kpi7th.className = `text-xs font-extrabold mt-1 ${ot.seventhDay ? 'text-purple-700 font-black' : 'text-slate-500'}`;
      }
      if (kpiCap) {
        kpiCap.textContent = ot.dailyCap > 8 ? `${ot.dailyCap}h CAP` : '8h STANDARD';
        kpiCap.className = `text-xs font-extrabold mt-1 ${ot.dailyCap > 8 ? 'text-indigo-700 font-black' : 'text-slate-500'}`;
      }
      if (headerBadge) {
        const tags = [];
        if (ot.sixthDay) tags.push('6D');
        if (ot.seventhDay) tags.push('7D');
        if (ot.dailyCap > 8) tags.push(`${ot.dailyCap}h`);
        headerBadge.textContent = tags.length > 0 ? tags.join(' • ') : 'Standard';
      }
      if (policySummary) {
        const parts = [];
        parts.push(ot.sixthDay ? '6th Day Allowed' : '5-Day Max');
        parts.push(ot.seventhDay ? '7th Day Allowed' : '');
        parts.push(ot.dailyCap > 8 ? `${ot.dailyCap}h Daily Cap` : '8h Daily Cap');
        parts.push(`${ot.weeklyCap}h Wk Max`);
        policySummary.textContent = parts.filter(Boolean).join(' • ');
      }

      // Render active assignments in current schedule that incur OT
      const tbody = document.getElementById('companyOTActiveShiftsBody');
      if (tbody) {
        const otAssignments = state.sessionAssignments.filter(sa => {
          const audit = getWinTeamOTAudit(sa);
          return audit.hasExpectedOT;
        });

        if (kpiShifts) {
          kpiShifts.textContent = `${otAssignments.length} ${otAssignments.length === 1 ? 'Shift' : 'Shifts'}`;
        }

        if (otAssignments.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" class="p-6 text-center text-slate-400 text-xs bg-slate-50/50">
                No shifts in the current schedule session are incurring overtime. Regular officers (<40h, <5 days, &le;8h daily) are scheduled for all shifts.
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = otAssignments.map(sa => {
            const audit = getWinTeamOTAudit(sa);
            return `
              <tr class="hover:bg-slate-50 transition-colors">
                <td class="py-2.5 px-3">
                  <div class="font-bold text-slate-900">${escapeHtml(sa.name)}</div>
                  <div class="font-mono text-[10.5px] text-slate-500">#${sa.eid}</div>
                </td>
                <td class="py-2.5 px-2 font-semibold text-slate-800 whitespace-nowrap">${sa.workDateNorm}</td>
                <td class="py-2.5 px-2 whitespace-nowrap font-bold text-slate-800 font-mono">${sa.inTime} - ${sa.outTime}</td>
                <td class="py-2.5 px-2 font-mono font-bold text-slate-900">${sa.countedHours.toFixed(2)}h</td>
                <td class="py-2.5 px-2">
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    ⚡ ${(audit.causes || []).map(c => c.label).join(' • ')}
                  </span>
                </td>
                <td class="py-2.5 px-2 font-mono text-[10.5px] text-slate-600 whitespace-nowrap">
                  Day: <strong>${audit.totalDayHours.toFixed(1)}h</strong> &bull; Wk: <strong>${audit.totalWeekHours.toFixed(1)}h</strong>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    }

    function saveCompanyOTFromModal() {
      const sixthDay = document.getElementById('companyFormSixthDay') ? document.getElementById('companyFormSixthDay').checked : false;
      const seventhDay = document.getElementById('companyFormSeventhDay') ? document.getElementById('companyFormSeventhDay').checked : false;
      let dailyCap = 8;
      const rads = document.getElementsByName('radCompanyFormDailyCap');
      if (rads) {
        for (const r of rads) {
          if (r.checked) dailyCap = parseInt(r.value, 10);
        }
      }
      const weeklyCap = parseFloat(document.getElementById('companyFormWeeklyCap').value) || 40.0;
      const notes = (document.getElementById('companyFormNotes').value || '').trim();

      setCompanyOTPolicy({ sixthDay, seventhDay, dailyCap, weeklyCap, notes });
    }

    function resetCompanyOTPolicy() {
      if (confirm('Reset company-wide overtime policy to Standard (5-Day Max, 8-Hour Daily Cap, 40-Hour Weekly Max)?')) {
        setCompanyOTPolicy({ sixthDay: false, seventhDay: false, dailyCap: 8, weeklyCap: 40.0, notes: '' });
      }
    }

    function saveOfficerDetailOTApprovals() {
      const sixthDay = document.getElementById('chkOfficer6thDay') ? document.getElementById('chkOfficer6thDay').checked : false;
      const seventhDay = document.getElementById('chkOfficer7thDay') ? document.getElementById('chkOfficer7thDay').checked : false;
      let dailyCap = 8;
      const radCaps = document.getElementsByName('radOfficerDailyCap');
      if (radCaps) {
        for (const r of radCaps) {
          if (r.checked) dailyCap = parseInt(r.value, 10);
        }
      }
      const weeklyCap = parseFloat(document.getElementById('numOfficerWeeklyCap').value) || 40.0;
      const notes = (document.getElementById('txtOfficerOTNote').value || '').trim();

      setCompanyOTPolicy({ sixthDay, seventhDay, dailyCap, weeklyCap, notes });
      const modal = document.getElementById('modalOfficerDetail');
      const eid = modal ? modal.getAttribute('data-active-eid') : null;
      if (eid) openOfficerDetailModal(eid);
    }

    function clearOfficerDetailOTApprovals() {
      setCompanyOTPolicy({ sixthDay: false, seventhDay: false, dailyCap: 8, weeklyCap: 40.0, notes: '' });
      const modal = document.getElementById('modalOfficerDetail');
      const eid = modal ? modal.getAttribute('data-active-eid') : null;
      if (eid) openOfficerDetailModal(eid);
    }

    // --- FOUR JOB CODES SPECIFICATION ---
    const JOB_CODES = {
      '233265': {
        code: '233265',
        title: 'Apple - SCV SOR',
        shortTitle: 'SCV SOR (Core Posts)',
        isBre: false,
        theme: 'blue',
        badgeCls: 'bg-blue-100 text-blue-800 border-blue-200'
      },
      '235144': {
        code: '235144',
        title: 'Apple - SCV SOR Break Relief',
        shortTitle: 'SCV SOR BRE (Break Relief)',
        isBre: true,
        theme: 'indigo',
        badgeCls: 'bg-indigo-100 text-indigo-800 border-indigo-200'
      },
      '266778': {
        code: '266778',
        title: 'Apple - SCV SOR (Sunnyvale)',
        shortTitle: 'Sunnyvale (Core Posts)',
        isBre: false,
        theme: 'emerald',
        badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-200'
      },
      '267588': {
        code: '267588',
        title: 'Apple - SCV SOR Break Relief (Sunnyvale)',
        shortTitle: 'Sunnyvale BRE (Break Relief)',
        isBre: true,
        theme: 'amber',
        badgeCls: 'bg-amber-100 text-amber-800 border-amber-200'
      }
    };

    // --- TIME BLOCK DEFINITIONS ---
    const BLOCK_DEFS = {
      'day 1': [{ start: 4.0, end: 8.0 }],
      'day 2': [{ start: 8.0, end: 12.0 }],
      'swing 1': [{ start: 12.0, end: 16.0 }],
      'swing 2': [{ start: 16.0, end: 20.0 }],
      'grave 1': [{ start: 20.0, end: 24.0 }],
      'grave 2': [{ start: 0.0, end: 4.0 }],
      'open': [{ start: 0.0, end: 24.0 }]
    };

    function parseTimeWindow(wStr) {
      if (!wStr) return null;
      const clean = String(wStr).trim();
      const m = clean.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
      if (!m) return null;
      const sh = parseInt(m[1], 10) + parseInt(m[2], 10) / 60.0;
      let eh = parseInt(m[3], 10) + parseInt(m[4], 10) / 60.0;
      if (eh === 0 && sh > 0) eh = 24.0;
      return { start: sh, end: eh };
    }

    function parseHiredWindows(hiredStr) {
      if (!hiredStr) return [];
      const clean = String(hiredStr).toLowerCase().trim();
      if (!clean || ['n/a', 'dedication', 'not available', 'tor', 'opt out', 'shift replacement'].includes(clean)) {
        return [];
      }
      const windows = [];
      const parts = clean.split(/[/,]+/);
      for (let p of parts) {
        p = p.trim();
        let matched = false;
        for (const [bName, bWins] of Object.entries(BLOCK_DEFS)) {
          if (p.startsWith(bName) || p === bName.replace(/\s+/g, '')) {
            windows.push(...bWins);
            matched = true;
            break;
          }
        }
        if (!matched) {
          const w = parseTimeWindow(p);
          if (w) windows.push(w);
        }
      }
      return windows;
    }

    function timeStringToHours(tStr) {
      if (!tStr) return 0.0;
      const clean = String(tStr).trim();
      if (clean.includes(':')) {
        const parts = clean.split(':');
        return (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0) / 60.0;
      }
      if (/^\d{3,4}$/.test(clean)) {
        const padded = clean.padStart(4, '0');
        return parseInt(padded.slice(0, 2), 10) + parseInt(padded.slice(2), 10) / 60.0;
      }
      const num = parseFloat(clean);
      return isNaN(num) ? 0.0 : num;
    }

    function normDate(dStr) {
      if (!dStr) return '';
      const clean = String(dStr).trim();
      const parts = clean.split(/[-/]/);
      if (parts.length === 3) {
        return parseInt(parts[0], 10) + '/' + parseInt(parts[1], 10) + '/' + parts[2];
      }
      return clean;
    }

    function getDateSortValue(dStr) {
      if (!dStr) return Number.MAX_SAFE_INTEGER;
      const clean = String(dStr).trim();
      if (!clean) return Number.MAX_SAFE_INTEGER;
      // If present in state.dates, rely on state.dates index first (as state.dates is already sorted chronologically)
      if (state.dates && state.dates.length > 0) {
        const idx = state.dates.indexOf(clean);
        if (idx !== -1) return idx * 86400000;
      }
      const parts = clean.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          // Month/Day/Year (e.g. 11/14/2026)
          const m = parseInt(parts[0], 10) - 1;
          const d = parseInt(parts[1], 10);
          const y = parseInt(parts[2], 10);
          const dt = new Date(y, m, d, 12, 0, 0);
          return isNaN(dt.getTime()) ? Number.MAX_SAFE_INTEGER : dt.getTime();
        } else if (parts[0].length === 4) {
          // Year/Month/Day (e.g. 2026-11-14)
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = parseInt(parts[2], 10);
          const dt = new Date(y, m, d, 12, 0, 0);
          return isNaN(dt.getTime()) ? Number.MAX_SAFE_INTEGER : dt.getTime();
        }
      }
      const parsed = Date.parse(clean);
      return isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
    }

    function cleanFloat(val) {
      if (val === null || val === undefined || val === '') return 0.0;
      const str = String(val).trim().replace(/\.+/g, '.');
      const num = parseFloat(str);
      return isNaN(num) ? 0.0 : num;
    }

    // --- POST DESCRIPTION FILTER FOR PPA SHIFT FILLER ---
    // Only two categories of post descriptions are fillable:
    // 1. "Break Relief Extra" (case-insensitive)
    // 2. Any post description with 6 digits that is not immediately followed by -S
    //    (e.g., fill 628462, 274927-Sb01, 726492-Ap01, but ignore 264284-S)
    function isFillablePostDescription(postDesc) {
      if (!postDesc) return false;
      const trimmed = String(postDesc).trim();
      if (trimmed.toLowerCase() === 'break relief extra') {
        return true;
      }
      const sorMatch = trimmed.match(/^(\d{6})(?:\s*-\s*([A-Za-z0-9]+))?$/);
      if (!sorMatch) {
        return false;
      }
      const suffix = sorMatch[2];
      if (suffix && suffix.toUpperCase() === 'S') {
        return false;
      }
      return true;
    }

    // --- BRE (BREAK RELIEF) SHIFT & WORKING WEEKS SENIORITY LOGIC ---
    // BRE shifts are anything under Job Code (JC) 235144 or 267588:
    // - 235144: Apple - SCV SOR Break Relief
    // - 267588: Apple - SCV SOR Break Relief (Sunnyvale)
    function isBreShift(shift) {
      if (!shift) return false;
      const jn = String(shift.jobNumber || '').trim();
      if (jn === '235144' || jn === '267588') return true;
      if (jn.includes('235144') || jn.includes('267588')) return true;
      return false;
    }

    // The bottom 75 people in Working Weeks (least senior by row position)
    // are not eligible to work BRE shifts under JC 235144 or 267588.
    function isEmployeeBottom75(emp) {
      if (!emp || emp.isFromWinTeamOnly) return false;
      if (emp.isBottom75 !== undefined) return emp.isBottom75;
      const totalWW = state.wwEmployeeCount || state.employees.filter(e => !e.isFromWinTeamOnly).length;
      if (totalWW <= 0) return false;
      return emp.wwIndex > Math.max(0, totalWW - 75);
    }

    // --- ABSOLUTE INTERVAL & SHIFT OVERLAP / REST LOGIC ---
    function getShiftInterval(shift) {
      const start = (shift.inTimeHours !== undefined) ? shift.inTimeHours : timeStringToHours(shift.inTime);
      let end = (shift.outTimeHours !== undefined) ? shift.outTimeHours : timeStringToHours(shift.outTime);
      if (shift.nextDay === '1' || end <= start) {
        end += 24.0;
      }
      return { start, end };
    }

    function getShiftAbsoluteInterval(shift) {
      const dtNorm = shift.workDateNorm || normDate(shift.workDate);
      let dayIdx = null;
      if (state.dates && state.dates.length > 0) {
        const idx = state.dates.indexOf(dtNorm);
        if (idx !== -1) {
          dayIdx = idx;
        } else if (dtNorm) {
          const baseDate = new Date(state.dates[0] + 'T00:00:00');
          const curDate = new Date(dtNorm + 'T00:00:00');
          if (!isNaN(baseDate.getTime()) && !isNaN(curDate.getTime())) {
            dayIdx = Math.round((curDate - baseDate) / 86400000);
          }
        }
      }

      const startH = (shift.inTimeHours !== undefined) ? shift.inTimeHours : timeStringToHours(shift.inTime);
      let endH = (shift.outTimeHours !== undefined) ? shift.outTimeHours : timeStringToHours(shift.outTime);
      const isNextDay = shift.nextDay === '1' || endH <= startH;

      if (dayIdx !== null && !isNaN(dayIdx)) {
        const absStart = dayIdx * 24.0 + startH;
        const absEnd = isNextDay ? (dayIdx + 1) * 24.0 + endH : dayIdx * 24.0 + endH;
        return { start: absStart, end: absEnd, duration: absEnd - absStart };
      }
      return { start: startH, end: isNextDay ? endH + 24.0 : endH, duration: isNextDay ? (endH + 24.0 - startH) : (endH - startH) };
    }

    function shiftsOverlap(s1, s2) {
      const i1 = getShiftAbsoluteInterval(s1);
      const i2 = getShiftAbsoluteInterval(s2);
      return (i1.start < i2.end) && (i2.start < i1.end);
    }

    function getShiftsRestGap(s1, s2) {
      const i1 = getShiftAbsoluteInterval(s1);
      const i2 = getShiftAbsoluteInterval(s2);
      if (i1.end <= i2.start) {
        return i2.start - i1.end; // rest from s1 to s2
      } else if (i2.end <= i1.start) {
        return i1.start - i2.end; // rest from s2 to s1
      }
      return 0.0; // overlapping
    }

    // --- EMPLOYEE STATUS & GUARDRAIL HELPERS ---
    function hasEmployeeAnyNotes(emp) {
      if (!emp) return false;
      const wwNote = (emp.notes || '').toString().trim();
      const ppaNote = (emp.ppaNotes || '').toString().trim();
      const cellNote = (emp.cellNotes || '').toString().trim();
      return (wwNote.length > 0 || ppaNote.length > 0 || cellNote.length > 0);
    }

    function isDateInTorRange(targetDateStr, torStartStr, torEndStr, defaultYear) {
      if (!targetDateStr || !torStartStr) return false;
      try {
        const tParts = normDate(targetDateStr).split('/');
        if (tParts.length < 2) return false;
        const tM = parseInt(tParts[0], 10);
        const tD = parseInt(tParts[1], 10);
        const tY = tParts[2] ? parseInt(tParts[2], 10) : parseInt(defaultYear, 10);
        const targetTime = new Date(tY, tM - 1, tD).getTime();

        const sParts = torStartStr.split('/');
        const sM = parseInt(sParts[0], 10);
        const sD = parseInt(sParts[1], 10);
        const sY = sParts[2] ? parseInt(sParts[2], 10) : parseInt(defaultYear, 10);
        const startTime = new Date(sY, sM - 1, sD).getTime();

        if (!torEndStr) {
          return targetTime === startTime;
        }

        const eParts = torEndStr.split('/');
        const eM = parseInt(eParts[0], 10);
        const eD = parseInt(eParts[1], 10);
        const eY = eParts[2] ? parseInt(eParts[2], 10) : parseInt(defaultYear, 10);
        const endTime = new Date(eY, eM - 1, eD).getTime();

        return targetTime >= startTime && targetTime <= endTime;
      } catch (e) {
        return false;
      }
    }

    // Disqualifying notes detector:
    // Only disqualify officers with full-week blockers: Locked out, Inactive, Dedicated, LOA, Blanket TOR, MVR, Transferred, Resigned, Bereavement, Hybrid
    function getDisqualifyingNotesReason(notesStr) {
      if (!notesStr) return null;
      const s = notesStr.toString();
      if (!s.trim()) return null;

      // 1. Locked out / Lockedout / Lockout / Lock-out
      if (/lock(ed)?[-_\s]?out/i.test(s)) return 'Locked Out';
      // 2. Inactive / incative / in-active / in active
      if (/in[-_\s]?active|incative/i.test(s)) return 'Inactive Employee';
      // 3. Dedicated / dedication / dedications / ded (e.g. BRE Dedicated, Dedicated M-F, Ded.)
      if (/dedicat(ed|ion|ions)?|\bded\b/i.test(s)) return 'Dedicated Specialist';
      // 4. LOA / Leave of Absence / L.O.A.
      if (/\bloa\b|leave\s+of\s+absence|l\.o\.a\./i.test(s)) return 'Leave of Absence (LOA)';
      // 5. TOR / Time Off Request / T.O.R. (only if NOT date-specific; date-specific is checked in getEmployeeStatus per date)
      if (/\b(?:tor|time[-_\s]?off[-_\s]?request|t\.o\.r\.)\b/i.test(s)) {
        const hasSpecificDate = /(?:tor|time[-_\s]?off[-_\s]?request|t\.o\.r\.)\s*[:\s-]?\s*\d{1,2}[./]\d{1,2}/i.test(s);
        if (!hasSpecificDate) {
          return 'Time Off Request (TOR)';
        }
      }
      // 6. MVR / Driver Incompliant / MVR Incompliant / Motor Vehicle
      if (/\bmvr\b|driver\s+incompliant|motor\s+vehicle/i.test(s)) return 'MVR / Driver Incompliant';
      // 7. Transferred / transfer / transfers / transferring / transfered / trasnferred / trasnfer
      if (/transfer|transferred|transfered|trasnferred|trasnfer|transferring/i.test(s)) return 'Transferred';
      // 8. Resigned / resignation / resigning
      if (/resign(ed|ation|ing)?/i.test(s)) return 'Resigned';
      // 9. Bereavement Leave
      if (/bereavement/i.test(s)) return 'Bereavement Leave';
      // 10. Hybrid
      if (/\bhybrid\b/i.test(s)) return 'Hybrid';

      return null;
    }

    function getEmployeeStatus(emp, dateStr = null) {
      if (!emp) return { isBlocked: false, reason: '' };
      const fullNotes = [emp.notes, emp.ppaNotes, emp.cellNotes].filter(Boolean).join(' \n ');

      // Check if employee has any full-week disqualifying keywords in notes
      const disqReason = getDisqualifyingNotesReason(fullNotes);
      if (disqReason) {
        return { isBlocked: true, reason: `Disqualified: ${disqReason} (in Notes)` };
      }

      // Date-specific restrictions (e.g. CPR or TOR on date)
      if (dateStr && state.dates && state.dates.length > 0) {
        const targetDate = normDate(dateStr);
        const year = state.dates[0].split('/')[2] || '2026';

        // Check for date-specific TOR
        const torRegex = /(?:tor|time[-_\s]?off[-_\s]?request|t\.o\.r\.)\s*[:\s-]?\s*(\d{1,2}[./]\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}[./]\d{1,2}))?/gi;
        let torM;
        while ((torM = torRegex.exec(fullNotes)) !== null) {
          const startStr = torM[1].replace('.', '/');
          const endStr = torM[2] ? torM[2].replace('.', '/') : null;
          if (isDateInTorRange(targetDate, startStr, endStr, year)) {
            return { isBlocked: true, reason: `TOR on ${torM[1]}${torM[2] ? ' - ' + torM[2] : ''}` };
          }
        }

        // Check for date-specific CPR
        const cprRegex = /cpr\s*[:\s-]?\s*(\d{1,2}[./]\d{1,2})/gi;
        let cprM;
        while ((cprM = cprRegex.exec(fullNotes)) !== null) {
          const cprDateStr = cprM[1].replace('.', '/');
          if (isDateInTorRange(targetDate, cprDateStr, null, year)) {
            return { isBlocked: true, reason: `CPR Training on ${cprM[1]}` };
          }
        }
      }

      return { isBlocked: false, reason: '' };
    }

    function getEmployeeEffectiveLimit(emp) {
      if (!emp) return 45.0;
      const lim = cleanFloat(emp.limit);
      const isPartTime = (lim > 0 && lim < 40.0);
      const ot = getEmployeeOTApprovals(emp.eid);

      // Part-time specialists keep their contracted PT limit unless an explicit higher weeklyCap was authorized
      if (isPartTime) {
        if (ot && ot.weeklyCap && ot.weeklyCap > lim && ot.weeklyCap > 40.0) {
          return ot.weeklyCap;
        }
        return lim;
      }

      // Full-time specialists:
      // If there is an overtime approval (6th day, 7th day, 12h/16h cap, or weekly cap > 40.0):
      // The smart filler is allowed to give SPs hours beyond hour 45 in the week (up to 60.0h or custom weeklyCap).
      if (ot && ot.hasAny) {
        if (ot.weeklyCap && ot.weeklyCap > 45.0) {
          return ot.weeklyCap;
        }
        return 60.0; // Standard operational overtime ceiling
      }

      // Standard policy without overtime approvals: strict target <= 45.0h
      return (lim > 0) ? Math.min(lim, 45.0) : 45.0;
    }

    function getEmployeeAllScheduledShifts(eid, simShiftsMap = null) {
      const list = [];
      const source = (simShiftsMap && simShiftsMap[eid])
        ? simShiftsMap[eid]
        : (state.empDayWorkingShifts && state.empDayWorkingShifts[eid] ? state.empDayWorkingShifts[eid] : null);
      if (!source) return list;

      Object.keys(source).forEach(dt => {
        const dayShifts = source[dt];
        if (dayShifts && dayShifts.length > 0) {
          list.push(...dayShifts);
        }
      });
      return list;
    }

    // --- RFC-4180 CSV PARSER ---
    function parseCSV(text) {
      const rows = [];
      let currentRow = [];
      let currentVal = '';
      let insideQuotes = false;
      const len = text.length;

      for (let i = 0; i < len; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
          if (insideQuotes && nextChar === '"') {
            currentVal += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          currentRow.push(currentVal);
          currentVal = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
          if (char === '\r' && nextChar === '\n') i++;
          currentRow.push(currentVal);
          rows.push(currentRow);
          currentRow = [];
          currentVal = '';
        } else {
          currentVal += char;
        }
      }
      if (currentVal || currentRow.length > 0) {
        currentRow.push(currentVal);
        rows.push(currentRow);
      }
      return rows;
    }

    // --- INITIALIZATION & FILE DETECTION ---

    function detectCSVType(csvText) {
      if (!csvText) return 'unknown';
      const sample = csvText.slice(0, 4000);
      const lines = sample.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return 'unknown';

      const h = lines[0];
      // PPA has JobPostDetailID or ScheduleDetailsID or shifthours or RecordTypeID with PostDescription
      if (h.includes('JobPostDetailID') || h.includes('ScheduleDetailsID') || h.includes('shifthours') || (h.includes('RecordTypeID') && h.includes('PostDescription') && !h.includes('RolloverDescription'))) {
        return 'ppa';
      }
      // EMP has EmployeeNumber and WorkDate and PostDescription, and RolloverDescription or CellNotes without JobPostDetailID
      if (h.includes('EmployeeNumber') && h.includes('WorkDate') && (h.includes('RolloverDescription') || h.includes('PostDescription')) && !h.includes('JobPostDetailID')) {
        return 'emp';
      }
      // WW has Acting Supervisor, Logistics Hybrid, Day 1, Preferred 1st Choice, Hired AV, or EID in first few lines
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const l = lines[i];
        if (l.includes('Acting Supervisor') || l.includes('Logistics Hybrid') || l.includes('Day 1') || 
            l.includes('Preferred 1st Choice') || l.includes('Hired AV') || l.includes('EID') || l.includes('Scheduled in WT')) {
          return 'ww';
        }
      }
      return 'unknown';
    }

    function handleFiles(fileList) {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      let loadedCount = 0;
      const results = [];

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
          const content = e.target.result;
          let kind = detectCSVType(content);
          if (kind === 'unknown') {
            const lower = file.name.toLowerCase();
            if (lower.includes('ppa')) kind = 'ppa';
            else if (lower.includes('emp')) kind = 'emp';
            else if (lower.includes('working') || lower.includes('availability') || lower.includes('ww')) kind = 'ww';
          }

          if (kind === 'ppa') {
            loadPPA(content, file.name);
            results.push(`PPA (${file.name})`);
          } else if (kind === 'emp') {
            loadEMP(content, file.name);
            results.push(`EMP (${file.name})`);
          } else if (kind === 'ww') {
            loadWorkingWeeks(content, file.name);
            results.push(`Working Weeks (${file.name})`);
          } else {
            // Heuristic check: lines count
            loadWorkingWeeks(content, file.name);
            results.push(`Working Weeks (${file.name})`);
          }

          loadedCount++;
          if (loadedCount === files.length) {
            renderDayHeaders();
            calculateAllHours();
            populateLinkingShiftDropdown();
            updateKPISummaries();
            updateFileStatusBadges();
            renderWorkingWeeksGrid();
            renderShiftFirstView();
            renderWinTeamTable();
            showToast(`Loaded: ${results.join(', ')}`);
          }
        };
        reader.readAsText(file);
      });
    }

    function handleMultiFileInput(evt) {
      if (evt.target.files && evt.target.files.length > 0) {
        handleFiles(evt.target.files);
      }
    }

    function handleSingleFileUpload(evt, type) {
      const file = evt.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result;
        if (type === 'ppa') loadPPA(content, file.name);
        else if (type === 'emp') loadEMP(content, file.name);
        else if (type === 'ww') loadWorkingWeeks(content, file.name);

        renderDayHeaders();
        calculateAllHours();
        populateLinkingShiftDropdown();
        updateKPISummaries();
        updateFileStatusBadges();
        renderWorkingWeeksGrid();
        renderShiftFirstView();
        renderWinTeamTable();
        showToast(`Loaded ${file.name} successfully.`);
      };
      reader.readAsText(file);
    }

    function handleFileUpload(evt, type) {
      handleSingleFileUpload(evt, type);
    }

    function updateFileStatusBadges() {
      // 1. PPA status
      const bPPA = document.getElementById('badgeStatusPPA');
      const stPPA = document.getElementById('uploadStatusPPA');
      const ppaLoaded = state.shifts && state.shifts.length > 0;
      const openCount = ppaLoaded ? state.shifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc)).length : 0;
      
      if (bPPA) {
        if (ppaLoaded) {
          bPPA.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 hover:bg-emerald-500/30 transition-colors';
          bPPA.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> PPA: ${state.shifts.length} shifts (${openCount} open)`;
        } else {
          bPPA.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 hover:bg-amber-500/30 transition-colors';
          bPPA.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> PPA: Missing`;
        }
      }
      if (stPPA) {
        stPPA.textContent = ppaLoaded ? `Loaded (${state.shifts.length} shifts, ${openCount} open across 4 jobs)` : 'Not loaded yet';
        stPPA.className = ppaLoaded ? 'text-[11px] text-emerald-700 font-semibold mt-2' : 'text-[11px] text-amber-700 font-semibold mt-2';
      }

      // 2. EMP status
      const bEMP = document.getElementById('badgeStatusEMP');
      const stEMP = document.getElementById('uploadStatusEMP');
      const empLoaded = state.empReportRecords && state.empReportRecords.length > 0;
      const empSpecialists = empLoaded ? Object.keys(state.empHoursFromEMP).length : 0;

      if (bEMP) {
        if (empLoaded) {
          bEMP.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 hover:bg-emerald-500/30 transition-colors';
          bEMP.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> EMP: ${state.empReportRecords.length} records (${empSpecialists} specs)`;
        } else {
          bEMP.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 hover:bg-rose-500/30 transition-colors';
          bEMP.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> EMP: Missing (Outside Conflicts Blind!)`;
        }
      }
      if (stEMP) {
        stEMP.textContent = empLoaded ? `Loaded (${state.empReportRecords.length} shifts, ${empSpecialists} scheduled specialists across all company jobs)` : 'Not loaded yet — Required to detect outside shift conflicts';
        stEMP.className = empLoaded ? 'text-[11px] text-emerald-700 font-semibold mt-2' : 'text-[11px] text-rose-700 font-semibold mt-2';
      }

      // EMP warning banner in main UI
      const empWarn = document.getElementById('empWarningBanner');
      if (empWarn) {
        if (empLoaded || (!ppaLoaded && !wwLoaded)) {
          empWarn.classList.add('hidden');
        } else {
          empWarn.classList.remove('hidden');
        }
      }

      // 3. WW status
      const bWW = document.getElementById('badgeStatusWW');
      const stWW = document.getElementById('uploadStatusWW');
      const wwLoaded = state.employees && state.employees.length > 0 && !state.employees.every(e => e.isFromWinTeamOnly);

      if (bWW) {
        if (wwLoaded) {
          bWW.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 hover:bg-emerald-500/30 transition-colors';
          bWW.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> WW: ${state.employees.length} specialists`;
        } else {
          bWW.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 hover:bg-amber-500/30 transition-colors';
          bWW.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> WW: Missing`;
        }
      }
      if (stWW) {
        stWW.textContent = wwLoaded ? `Loaded (${state.employees.length} specialists & preferences)` : 'Not loaded yet';
        stWW.className = wwLoaded ? 'text-[11px] text-emerald-700 font-semibold mt-2' : 'text-[11px] text-amber-700 font-semibold mt-2';
      }

      const summaryText = document.getElementById('modalFilesSummaryText');
      if (summaryText) {
        const loadedCount = (ppaLoaded ? 1 : 0) + (empLoaded ? 1 : 0) + (wwLoaded ? 1 : 0);
        summaryText.textContent = `${loadedCount} of 3 files loaded`;
      }
    }

    // --- QUICK LOAD WORKSPACE CSV FILES (CORS-SAFE) ---
    async function quickLoadWorkspaceFiles() {
      if (window.location.protocol === 'file:') {
        showToast('Direct file:// fetch is blocked by browser security. Please choose or drag-drop your CSV files below.');
        openUploadModal();
        return;
      }

      try {
        showToast('Auto-loading workspace CSV files (PPA, EMP, Working Weeks)...');
        let ppaLoaded = false;
        let empLoaded = false;
        let wwLoaded = false;

        // Try fetching Working Weeks CSV first (establishes the master specialist roster)
        const wwFileNames = [
          'Permanent Preferred Availability( Working Weeks) - WE 11_19.csv',
          'Permanent%20Preferred%20Availability(%20Working%20Weeks)%20-%20WE%2011_19.csv',
          'Permanent Preferred Availability( Working Weeks) - WE 11_05.csv',
          'WorkingWeeks.csv'
        ];

        for (const fname of wwFileNames) {
          try {
            const resWW = await fetch(fname);
            if (resWW.ok) {
              const textWW = await resWW.text();
              loadWorkingWeeks(textWW, fname);
              wwLoaded = true;
              break;
            }
          } catch (e) {
            // continue
          }
        }

        // Try fetching PPA.csv
        try {
          const resPPA = await fetch('PPA.csv');
          if (resPPA.ok) {
            const textPPA = await resPPA.text();
            loadPPA(textPPA, 'PPA.csv');
            ppaLoaded = true;
          }
        } catch (e) {
          console.warn('Could not auto-fetch PPA.csv:', e);
        }

        // Try fetching EMP.csv (filtered against WW roster)
        try {
          const resEMP = await fetch('EMP.csv');
          if (resEMP.ok) {
            const textEMP = await resEMP.text();
            loadEMP(textEMP, 'EMP.csv');
            empLoaded = true;
          }
        } catch (e) {
          console.warn('Could not auto-fetch EMP.csv:', e);
        }

        renderDayHeaders();
        calculateAllHours();
        populateLinkingShiftDropdown();
        updateKPISummaries();
        updateFileStatusBadges();
        renderWorkingWeeksGrid();
        renderShiftFirstView();
        renderWinTeamTable();

        if (ppaLoaded || empLoaded || wwLoaded) {
          closeUploadModal();
          showToast(`Loaded: ${ppaLoaded ? 'PPA ' : ''}${empLoaded ? 'EMP ' : ''}${wwLoaded ? 'WW' : ''}`);
        } else {
          openUploadModal();
        }
      } catch (err) {
        console.error(err);
        openUploadModal();
      }
    }

    function initData() {
      state.employees = [];
      state.wwEmployeeEids = null;
      state.shifts = [];
      state.dates = [];
      state.lastDateOfWeek = '';
      state.rawPPA = '';
      state.rawEMP = '';
      state.rawWW = '';
      state.empReportRecords = [];
      state.empHoursFromEMP = {};
      state.empShiftsFromEMP = {};
      state.empInfoFromEMP = {};
      state.sessionAssignments = [];

      updateKPISummaries();
      renderDayHeaders();
      renderWorkingWeeksGrid();
      renderShiftFirstView();

      // If running on a web server, attempt quick-load. If file://, open modal to let user drop files
      if (window.location.protocol === 'file:') {
        setTimeout(() => {
          openUploadModal();
        }, 150);
      } else {
        quickLoadWorkspaceFiles();
      }
    }

    function renderDayHeaders() {
      const row = document.getElementById('gridHeaderRow');
      if (!row) return;

      if (!state.dates || state.dates.length === 0) {
        row.innerHTML = `
          <th class="py-2.5 px-2 border-r border-slate-800 text-center w-10 font-mono text-[10.5px]">Row #</th>
          <th class="py-2.5 px-2.5 border-r border-slate-800 w-24 font-mono text-[10.5px]">Employee ID</th>
          <th class="py-2.5 px-3 border-r border-slate-800 min-w-[220px]">Officer Full Name</th>
          <th class="py-2.5 px-2 border-r border-slate-800 text-center w-16" title="Employment Type: Full-Time (FT) or Part-Time (PT)">Employment</th>
          <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-36 bg-blue-950 text-blue-200"
            title="Authoritative Total Weekly Hours from WinTeam Report shifts + current session assignments. System of Record (Law). Target <45.0 Hours/Week.">
            <div>WinTeam Scheduled Hours</div>
            <div class="text-[9px] text-blue-300 font-normal">[Law &bull; System of Record]</div>
          </th>
          <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-28 text-slate-400"
            title="Total Hours recorded on the Working Weeks availability reference sheet">
            <div>WW Sheet Hours</div>
            <div class="text-[9px] text-slate-400 font-normal">[Reference Sheet]</div>
          </th>
          <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-24"
            title="Difference: Authoritative WinTeam Scheduled Hours minus Working Weeks Reference Hours">
            <div>Hours Variance</div>
            <div class="text-[9px] text-slate-400 font-normal">[WT Law &minus; WW Ref]</div>
          </th>
          <th class="py-2.5 px-2 border-r border-slate-800 text-center w-24">Actions</th>
          <th class="py-2.5 px-3 border-r border-slate-800 min-w-[200px]">Notes &amp; Guardrails</th>
        `;
        return;
      }

      let html = `
        <th class="py-2.5 px-2 border-r border-slate-800 text-center w-10 font-mono text-[10.5px]">Row #</th>
        <th class="py-2.5 px-2.5 border-r border-slate-800 w-24 font-mono text-[10.5px]">Employee ID</th>
        <th class="py-2.5 px-3 border-r border-slate-800 min-w-[220px]">Officer Full Name</th>
        <th class="py-2.5 px-2 border-r border-slate-800 text-center w-16" title="Employment Type: Full-Time (FT) or Part-Time (PT)">Employment</th>
        <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-36 bg-blue-950 text-blue-200"
          title="Authoritative Total Weekly Hours from WinTeam Report shifts + current session assignments. System of Record (Law). Target <45.0 Hours/Week.">
          <div>WinTeam Scheduled Hours</div>
          <div class="text-[9px] text-blue-300 font-normal">[Law &bull; System of Record]</div>
        </th>
        <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-28 text-slate-400"
          title="Total Hours recorded on the Working Weeks availability reference sheet">
          <div>WW Sheet Hours</div>
          <div class="text-[9px] text-slate-400 font-normal">[Reference Sheet]</div>
        </th>
        <th class="py-2.5 px-2.5 border-r border-slate-800 text-center w-24"
          title="Difference: Authoritative WinTeam Scheduled Hours minus Working Weeks Reference Hours">
          <div>Hours Variance</div>
          <div class="text-[9px] text-slate-400 font-normal">[WT Law &minus; WW Ref]</div>
        </th>
        <th class="py-2.5 px-2 border-r border-slate-800 text-center w-24">Actions</th>
        <th class="py-2.5 px-3 border-r border-slate-800 min-w-[200px]">Notes &amp; Guardrails</th>
      `;

      state.dates.forEach(dt => {
        const dObj = new Date(dt + 'T12:00:00');
        const dayName = isNaN(dObj) ? dt : dObj.toLocaleDateString('en-US', { weekday: 'short' });
        html += `
          <th class="py-2.5 px-2.5 border-r border-slate-800 text-center min-w-[170px]">
            <div class="text-white font-bold text-xs">${dayName}</div>
            <div class="text-[10px] text-slate-400 font-mono font-normal">${dt}</div>
          </th>
        `;
      });

      row.innerHTML = html;
    }

    function loadWorkingWeeks(csvText, fileName = 'WorkingWeeks.csv') {
      const lines = parseCSV(csvText);
      if (!lines || lines.length < 3) return;

      const dateCols = [9, 13, 17, 21, 25, 29, 33];
      const parsedDates = [];

      dateCols.forEach(col => {
        if (lines[1] && col < lines[1].length) {
          const txt = lines[1][col];
          const m = txt.match(/(\d+\/\d+\/\d+)/);
          if (m) {
            parsedDates.push(normDate(m[1]));
          }
        }
      });

      if (parsedDates.length > 0) {
        state.dates = parsedDates;
        state.lastDateOfWeek = parsedDates[parsedDates.length - 1];
        if (!state.shiftFirstSelectedDay || state.shiftFirstSelectedDay === 'all') {
          state.shiftFirstSelectedDay = parsedDates[0];
        }
        const badgeWE = document.getElementById('badgeWeekEnding');
        if (badgeWE) {
          badgeWE.textContent = 'Week Ending: ' + state.lastDateOfWeek;
          badgeWE.className = 'px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono';
        }
      }

      state.rawWW = csvText;
      const existingMap = {};
      state.employees.forEach(e => { existingMap[e.eid] = e; });

      const wwEmployees = [];
      for (let i = 3; i < lines.length; i++) {
        const r = lines[i];
        if (!r || !r[0] || !r[0].trim()) continue;

        const eid = r[0].trim();
        const name = r[1] ? r[1].trim() : '';
        const email = r[2] ? r[2].trim() : '';
        const phone = r[3] ? r[3].trim() : '';
        const notes = r[4] ? r[4].trim() : '';
        const ptft = r[5] ? r[5].trim() : '';
        const limit = cleanFloat(r[6]) || 45.0; // Target <45h
        const sheetHours = cleanFloat(r[7]);

        const daily = {};
        state.dates.forEach((dt, idx) => {
          const c = 8 + idx * 4;
          const p1 = (c < r.length) ? r[c].trim() : '';
          const p2 = (c + 1 < r.length) ? r[c + 1].trim() : '';
          const hired = (c + 2 < r.length) ? r[c + 2].trim() : '';
          const wt = (c + 3 < r.length) ? r[c + 3].trim() : '';
          daily[dt] = { p1, p2, hired, wwReferenceWT: wt };
        });

        // Parse tags from notes
        const noteLower = notes.toLowerCase();
        const tags = [];
        if (noteLower.includes('resigned')) tags.push({ text: 'Resigned', cls: 'bg-rose-100 text-rose-800 border-rose-300' });
        if (noteLower.includes('locked out')) tags.push({ text: 'Locked Out', cls: 'bg-slate-200 text-slate-800 border-slate-300' });
        if (noteLower.includes('hybrid')) tags.push({ text: 'Hybrid', cls: 'bg-teal-100 text-teal-800 border-teal-200' });
        if (noteLower.includes('dedicated') || noteLower.includes('dedication')) tags.push({ text: 'Dedicated', cls: 'bg-blue-100 text-blue-800 border-blue-200' });
        if (noteLower.includes('acting supervisor')) tags.push({ text: 'Acting Supervisor', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' });
        if (noteLower.includes('satellite')) tags.push({ text: 'Satellite Post', cls: 'bg-cyan-100 text-cyan-800 border-cyan-200' });
        if (noteLower.includes('loa') || noteLower.includes('leave of absence')) tags.push({ text: 'Leave of Absence (LOA)', cls: 'bg-amber-100 text-amber-800 border-amber-200' });
        if (noteLower.includes('tor')) tags.push({ text: 'Time Off Request (TOR)', cls: 'bg-rose-100 text-rose-800 border-rose-200' });
        if (noteLower.includes('mvr')) tags.push({ text: 'MVR', cls: 'bg-rose-100 text-rose-800 border-rose-300' });
        if (noteLower.includes('inactive') || noteLower.includes('incative')) tags.push({ text: 'Inactive', cls: 'bg-slate-200 text-slate-800 border-slate-300' });
        if (noteLower.includes('transfer')) tags.push({ text: 'Transferred', cls: 'bg-amber-100 text-amber-800 border-amber-300' });
        if (noteLower.includes('cpr')) tags.push({ text: 'CPR Certified', cls: 'bg-rose-100 text-rose-800 border-rose-200' });

        const empObj = {
          wwIndex: i - 2,
          eid,
          name: name || (existingMap[eid] ? existingMap[eid].name : `Specialist #${eid}`),
          email,
          phone: phone || (existingMap[eid] ? existingMap[eid].phone : ''),
          notes,
          tags,
          ptft: ptft || (existingMap[eid] ? existingMap[eid].ptft : 'FT'),
          limit,
          sheetHours,
          daily,
          actualHours: existingMap[eid] ? existingMap[eid].actualHours : 0.0,
          isFromWinTeamOnly: false
        };

        wwEmployees.push(empObj);
        existingMap[eid] = empObj;
      }

      // Identify bottom 75 specialists in Working Weeks seniority order
      const totalWW = wwEmployees.length;
      state.wwEmployeeCount = totalWW;
      const bottom75CutoffIndex = Math.max(0, totalWW - 75);
      wwEmployees.forEach((emp, idx) => {
        if (idx >= bottom75CutoffIndex) {
          emp.isBottom75 = true;
          emp.tags.push({
            text: 'Bottom 75 (No BRE)',
            cls: 'bg-rose-100 text-rose-800 border-rose-300 font-bold'
          });
        } else {
          emp.isBottom75 = false;
        }
      });

      state.employees = wwEmployees;
      state.wwEmployeeEids = new Set(wwEmployees.map(e => e.eid));
      state.filesStatus.ww = {
        loaded: true,
        filename: fileName,
        count: wwEmployees.length
      };

      // If EMP was loaded before WW, re-filter EMP now that WW roster is known
      if (state.rawEMP) {
        loadEMP(state.rawEMP, state.filesStatus.emp ? state.filesStatus.emp.filename : 'EMP.csv');
      }
    }

    function loadPPA(csvText, fileName = 'PPA.csv') {
      const lines = parseCSV(csvText);
      if (!lines || lines.length < 2) return;

      const header = lines[0].map(h => h.trim());
      const colIdx = {};
      header.forEach((h, idx) => { colIdx[h] = idx; });

      state.rawPPA = csvText;
      state.shifts = [];
      const discoveredDates = new Set();
      const wtEmployeesMap = {};

      for (let i = 1; i < lines.length; i++) {
        const r = lines[i];
        if (!r || r.length <= 1) continue;

        const getVal = (colName) => {
          const idx = colIdx[colName];
          return (idx !== undefined && idx < r.length) ? r[idx].trim() : '';
        };

        const eid = getVal('EmployeeNumber');
        const workDate = getVal('WorkDate');
        const workDateNorm = normDate(workDate);
        if (workDateNorm) discoveredDates.add(workDateNorm);

        const inTime = getVal('InTime');
        const outTime = getVal('OutTime');
        const hoursRaw = cleanFloat(getVal('Hours') || getVal('shifthours'));
        const nextDay = getVal('NextDay');
        const shiftId = getVal('ShiftID');
        const jobNumber = getVal('JobNumber');
        const jobDesc = getVal('JobDescription');
        const postDesc = getVal('PostDescription');
        const empName = getVal('EmpName');
        const lastName = getVal('LastName');
        const firstName = getVal('FirstName');
        const phone1 = getVal('Phone1');
        const shiftNotes = getVal('Notes');
        const cellNotes = getVal('CellNotes');
        const scheduleDetailsId = getVal('ScheduleDetailsID');
        const jobPostDetailId = getVal('JobPostDetailID');

        if (eid) {
          if (!wtEmployeesMap[eid]) {
            const fullName = empName || (firstName || lastName ? `${firstName} ${lastName}`.trim() : `Specialist #${eid}`);
            wtEmployeesMap[eid] = {
              eid,
              name: fullName,
              phone: phone1,
              notes: shiftNotes || cellNotes || ''
            };
          }
        }

        let countedHours = hoursRaw;
        let isRolloverCutoff = false;
        const isRolloverTime = timeStringToHours(outTime) < timeStringToHours(inTime);

        if (state.lastDateOfWeek && workDateNorm === state.lastDateOfWeek && (nextDay === '1' || isRolloverTime)) {
          const pastMidnightHours = timeStringToHours(outTime);
          if (pastMidnightHours > 0) {
            countedHours = Math.max(0, hoursRaw - pastMidnightHours);
            isRolloverCutoff = true;
          }
        }

        const shiftObj = {
          id: 'shift_' + i,
          originalRowIndex: i,
          eid,
          empName,
          workDate,
          workDateNorm,
          inTime,
          outTime,
          inTimeHours: timeStringToHours(inTime),
          outTimeHours: timeStringToHours(outTime),
          hoursRaw,
          countedHours,
          isRolloverCutoff,
          nextDay,
          shiftId,
          jobNumber,
          jobDesc,
          postDesc,
          scheduleDetailsId,
          jobPostDetailId,
          shiftNotes,
          cellNotes,
          phone1,
          isOpen: !eid,
          assignedEmployee: null,
          assignedTier: null
        };

        state.shifts.push(shiftObj);
      }

      state.wtEmployeesMap = wtEmployeesMap;

      if ((!state.dates || state.dates.length === 0) && discoveredDates.size > 0) {
        state.dates = sortDatesList(Array.from(discoveredDates));
        state.lastDateOfWeek = state.dates[state.dates.length - 1];
        if (!state.shiftFirstSelectedDay || state.shiftFirstSelectedDay === 'all') {
          state.shiftFirstSelectedDay = state.dates[0];
        }
      }

      state.filesStatus.ppa = {
        loaded: true,
        filename: fileName,
        count: state.shifts.length,
        openCount: state.shifts.filter(s => s.isOpen && isFillablePostDescription(s.postDesc)).length
      };
    }

    function loadEMP(csvText, fileName = 'EMP.csv') {
      const lines = parseCSV(csvText);
      if (!lines || lines.length < 2) return;

      const header = lines[0].map(h => h.trim());
      const colIdx = {};
      header.forEach((h, idx) => { colIdx[h] = idx; });

      const records = [];
      const empHours = {};
      const empShifts = {};
      const empInfo = {};
      const discoveredDates = new Set();

      const wwEids = (state.wwEmployeeEids && state.wwEmployeeEids.size > 0)
        ? state.wwEmployeeEids
        : (state.employees && state.employees.length > 0 ? new Set(state.employees.map(e => e.eid)) : null);

      for (let i = 1; i < lines.length; i++) {
        const r = lines[i];
        if (!r || r.length <= 1) continue;

        const getVal = (col) => {
          const idx = colIdx[col];
          return (idx !== undefined && idx < r.length) ? r[idx].trim() : '';
        };

        const eid = getVal('EmployeeNumber');
        if (!eid) continue;

        // EMP contains every single guard on every contract in the company.
        // If an employee does not appear in the WW file, simply ignore them.
        if (wwEids && !wwEids.has(eid)) {
          continue;
        }

        const workDate = getVal('WorkDate');
        const workDateNorm = normDate(workDate);
        if (workDateNorm) discoveredDates.add(workDateNorm);

        const inTime = getVal('InTime');
        const outTime = getVal('OutTime');
        const hoursRaw = cleanFloat(getVal('Hours'));
        const nextDay = getVal('NextDay');
        const shiftId = getVal('ShiftID');
        const jobNumber = getVal('JobNumber');
        const jobDesc = getVal('JobDescription');
        const postDesc = getVal('PostDescription');
        const empName = getVal('EmpName');
        const phone1 = getVal('Phone1');
        const cellNotes = getVal('CellNotes');

        if (!empHours[eid]) empHours[eid] = 0.0;
        empHours[eid] += hoursRaw;

        if (!empShifts[eid]) empShifts[eid] = {};
        if (!empShifts[eid][workDateNorm]) empShifts[eid][workDateNorm] = [];

        const shiftItem = {
          id: `emp_${i}`,
          source: 'EMP',
          eid,
          empName,
          workDate,
          workDateNorm,
          inTime,
          outTime,
          inTimeHours: timeStringToHours(inTime),
          outTimeHours: timeStringToHours(outTime),
          hoursRaw,
          countedHours: hoursRaw,
          nextDay,
          shiftId,
          jobNumber,
          jobDesc,
          postDesc,
          phone1,
          cellNotes,
          isOutsideShift: (jobNumber && !['233265', '235144', '266778', '267588'].includes(String(jobNumber).trim()))
        };

        empShifts[eid][workDateNorm].push(shiftItem);
        records.push(shiftItem);

        if (!empInfo[eid]) {
          empInfo[eid] = {
            eid,
            name: empName,
            phone: phone1,
            notes: cellNotes
          };
        }
      }

      state.rawEMP = csvText;
      state.empReportRecords = records;
      state.empHoursFromEMP = empHours;
      state.empShiftsFromEMP = empShifts;
      state.empInfoFromEMP = empInfo;

      if ((!state.dates || state.dates.length === 0) && discoveredDates.size > 0) {
        state.dates = sortDatesList(Array.from(discoveredDates));
        state.lastDateOfWeek = state.dates[state.dates.length - 1];
        if (!state.shiftFirstSelectedDay || state.shiftFirstSelectedDay === 'all') {
          state.shiftFirstSelectedDay = state.dates[0];
        }
      }

      state.filesStatus.emp = {
        loaded: true,
        filename: fileName,
        count: records.length,
        specialistCount: Object.keys(empHours).length
      };
    }

    function sortDatesList(datesArr) {
      return datesArr.sort((a, b) => new Date(a) - new Date(b));
    }

    // --- RECALCULATE GUARANTEED ACTUAL HOURS & WORKING SHIFTS (WINTEAM AS LAW) ---
    function calculateAllHours() {
      state.empActualHours = {};
      state.empWorkingDates = {};
      state.empDayWorkingShifts = {};

      // Maintain strictly the Working Weeks roster; do not incorporate or mention employees not in WW
      if (state.wwEmployeeEids && state.wwEmployeeEids.size > 0) {
        state.employees = state.employees.filter(e => state.wwEmployeeEids.has(e.eid));
      }

      // Initialize structures for every employee
      state.employees.forEach(emp => {
        state.empActualHours[emp.eid] = 0.0;
        state.empWorkingDates[emp.eid] = new Set();
        state.empDayWorkingShifts[emp.eid] = {};
        if (state.dates && state.dates.length > 0) {
          state.dates.forEach(dt => {
            state.empDayWorkingShifts[emp.eid][dt] = [];
          });
        }
      });

      // Deduplication helper to prevent double-counting shifts present in both EMP and PPA
      const registeredIntervals = {}; // eid -> Array<{ start, end, workDateNorm, jobNumber }>

      const addShiftToEmployee = (s) => {
        if (!s || !s.eid || state.empActualHours[s.eid] === undefined) return;
        
        if (!registeredIntervals[s.eid]) registeredIntervals[s.eid] = [];
        const interval = getShiftAbsoluteInterval(s);
        
        const isDuplicate = registeredIntervals[s.eid].some(existing => {
          return existing.workDateNorm === s.workDateNorm &&
                 Math.abs(existing.start - interval.start) < 0.25 &&
                 Math.abs(existing.end - interval.end) < 0.25;
        });

        if (isDuplicate) return;

        registeredIntervals[s.eid].push({
          start: interval.start,
          end: interval.end,
          workDateNorm: s.workDateNorm,
          jobNumber: s.jobNumber
        });

        state.empActualHours[s.eid] += s.countedHours;
        state.empWorkingDates[s.eid].add(s.workDateNorm);

        if (!state.empDayWorkingShifts[s.eid][s.workDateNorm]) {
          state.empDayWorkingShifts[s.eid][s.workDateNorm] = [];
        }
        state.empDayWorkingShifts[s.eid][s.workDateNorm].push(s);
      };

      // 2. Base Scheduled Shifts & Hours
      // Priority 1: EMP.csv is the master employee schedule across all jobs (Apple + outside contracts)
      if (state.rawEMP && state.empReportRecords && state.empReportRecords.length > 0) {
        state.empReportRecords.forEach(s => addShiftToEmployee(s));
      }

      // Priority 2: PPA.csv confirmed shifts (adds any confirmed shifts in PPA that are not in EMP)
      if (state.shifts && state.shifts.length > 0) {
        state.shifts.forEach(s => {
          if (s.eid) {
            addShiftToEmployee(s);
          }
        });
      }

      // 3. Current Working Session Assignments
      state.sessionAssignments.forEach(sa => {
        addShiftToEmployee(sa);
      });

      // Update emp.actualHours and attach any notes from PPA/EMP
      state.employees.forEach(emp => {
        emp.actualHours = state.empActualHours[emp.eid] || 0.0;
        emp.otApprovals = getEmployeeOTApprovals(emp.eid);
        if (!emp.ppaNotes && state.wtEmployeesMap && state.wtEmployeesMap[emp.eid]) {
          emp.ppaNotes = state.wtEmployeesMap[emp.eid].notes || '';
        }
        if (!emp.cellNotes && state.empInfoFromEMP && state.empInfoFromEMP[emp.eid]) {
          emp.cellNotes = state.empInfoFromEMP[emp.eid].notes || '';
        }
      });
    }

    // --- SHIFT CANDIDATE MATCHING LOGIC (With Strict Status, 8h Rest, & Limit Safeguards) ---
    function getCandidateMatchesForShift(shift) {
      if (!shift) return { tier1: [], tier2: [], tier3: [], conflicted: [], allMatchesMap: {} };

      const dt = shift.workDateNorm;
      const inT = shift.inTimeHours;
      const shHours = shift.countedHours;
      const shiftPost = (shift.postDesc || shift.jobPostDetailId || '').trim();

      const tier1 = [];
      const tier2 = [];
      const tier3 = [];
      const tierNotes = []; // Lowest tier for officers with ANY notes
      const conflicted = [];
      const allMatchesMap = {}; // eid -> candidate match info

      state.employees.forEach(emp => {
        const eid = emp.eid;
        // Safety: ignore employees not in WW (never evaluate or count them in unavailable/conflicted)
        if (state.wwEmployeeEids && !state.wwEmployeeEids.has(eid)) return;
        if (emp.isFromWinTeamOnly) return;

        const currentH = emp.actualHours;
        const dInfo = emp.daily[dt] || {};
        const existingShiftsOnDate = state.empDayWorkingShifts[eid] ? (state.empDayWorkingShifts[eid][dt] || []) : [];
        const effLimit = getEmployeeEffectiveLimit(emp);

        // 1. Check Status Block (LOA, Locked Out, Inactive, Bereavement, Transfer, Date notes)
        const status = getEmployeeStatus(emp, dt);
        if (status.isBlocked) {
          conflicted.push({
            emp,
            reason: status.reason,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: (currentH + shHours) > effLimit
          });
          return;
        }

        // 1b. Check Bottom 75 Working Weeks Seniority Restriction for BRE Shifts (JC 235144 or 267588)
        if (isBreShift(shift) && isEmployeeBottom75(emp)) {
          conflicted.push({
            emp,
            reason: `Seniority restriction: Bottom 75 in Working Weeks are not eligible for BRE shifts (JC ${shift.jobNumber || '235144 / 267588'})`,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: (currentH + shHours) > effLimit
          });
          return;
        }

        // 2. Check Daily Hard Locks: Dedicated / TOR / Not Available / Opt Out across P1, P2, Hired
        const p1Val = (dInfo.p1 || '').trim();
        const p2Val = (dInfo.p2 || '').trim();
        const hiredVal = (dInfo.hired || '').trim();
        const blockPhrases = ['Dedication', 'TOR', 'Not Available', 'Opt Out'];

        if (blockPhrases.includes(p1Val) || blockPhrases.includes(p2Val) || blockPhrases.includes(hiredVal)) {
          let reason = 'Unavailable';
          if (p1Val === 'Dedication' || p2Val === 'Dedication' || hiredVal === 'Dedication') reason = 'Dedicated Specialist';
          else if (p1Val === 'TOR' || p2Val === 'TOR' || hiredVal === 'TOR') reason = 'Time Off Request (TOR)';
          else if (p1Val === 'Not Available' || p2Val === 'Not Available' || hiredVal === 'Not Available') reason = 'Not Available';
          else if (p1Val === 'Opt Out' || p2Val === 'Opt Out') reason = 'Opted out';

          conflicted.push({
            emp,
            reason,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: (currentH + shHours) > effLimit
          });
          return;
        }

        // 3. Check All Scheduled Shifts Across Entire Week for Physical Overlap & 8h Minimum Rest
        const allEmpShifts = getEmployeeAllScheduledShifts(eid);
        for (const es of allEmpShifts) {
          if (shiftsOverlap(es, shift)) {
            const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
            conflicted.push({
              emp,
              reason: `Physical time overlap with scheduled shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag}`,
              currentH,
              projectedH: currentH + shHours,
              willOvertime: (currentH + shHours) > effLimit
            });
            return;
          }
          const restGap = getShiftsRestGap(es, shift);
          if (restGap < 8.0) {
            const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
            conflicted.push({
              emp,
              reason: `Rest violation: Only ${restGap.toFixed(1)}h turnaround from shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag} — min 8h required`,
              currentH,
              projectedH: currentH + shHours,
              willOvertime: (currentH + shHours) > effLimit
            });
            return;
          }
        }

        // 4. Check Days Worked (5-day standard work week; 6th/7th day requires explicit OT approval)
        const empDates = state.empWorkingDates[eid] || new Set();
        const isAlreadyWorkingOnDate = empDates.has(dt);
        const projectedDaysWorked = isAlreadyWorkingOnDate ? empDates.size : empDates.size + 1;
        const approvals = getEmployeeOTApprovals(eid);

        if (projectedDaysWorked === 6 && !approvals.sixthDay) {
          conflicted.push({
            emp,
            reason: `6th Day OT approval required: Already scheduled ${empDates.size} days in week (needs 6th Day Approval)`,
            canQuickApprove: 'sixthDay',
            currentH,
            projectedH: currentH + shHours,
            willOvertime: true
          });
          return;
        }

        if (projectedDaysWorked >= 7 && !approvals.seventhDay) {
          conflicted.push({
            emp,
            reason: `7th Day OT approval required: Already scheduled ${empDates.size} days in week (needs 7th Day Approval)`,
            canQuickApprove: 'seventhDay',
            currentH,
            projectedH: currentH + shHours,
            willOvertime: true
          });
          return;
        }

        // 5. Daily Multi-Shift & Calendar Day Hour Cap Enforcement (12h/16h caps)
        const dayExistingHours = existingShiftsOnDate.reduce((acc, es) => acc + es.countedHours, 0.0);
        const dayProjectedHours = dayExistingHours + shHours;
        const isThroughAndThrough = (existingShiftsOnDate.length === 0);
        let maxDailyCap = 8.0;
        if (approvals.dailyCap === 16) maxDailyCap = 16.0;
        else if (approvals.dailyCap === 12) maxDailyCap = 12.0;
        else maxDailyCap = isThroughAndThrough ? shHours : 8.0;

        if (dayProjectedHours > maxDailyCap + 0.01) {
          const neededCap = dayProjectedHours <= 12.01 ? 'dailyCap12' : (dayProjectedHours <= 16.01 ? 'dailyCap16' : null);
          conflicted.push({
            emp,
            reason: `Daily hour cap exceeded: Shifts would total ${dayProjectedHours.toFixed(1)}h on ${dt} (Max ${maxDailyCap}h cap${approvals.dailyCap > 8 ? ' approved' : ''})`,
            canQuickApprove: neededCap,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: true
          });
          return;
        }

        // Same-Day Multi-Shift & Non-Billable Overtime Rule:
        // Different posts allowed only up to approved daily cap (or 8h standard)
        if (existingShiftsOnDate.length > 0) {
          const isSamePostAll = existingShiftsOnDate.every(es => (es.postDesc || es.jobPostDetailId || '').trim() === shiftPost);
          if (!isSamePostAll && approvals.dailyCap < 12 && dayProjectedHours > 8.01) {
            conflicted.push({
              emp,
              reason: `Non-billable OT: Different posts would total ${dayProjectedHours.toFixed(1)}h on ${dt} (Requires 12h/16h Cap Approval for multi-post >8h)`,
              canQuickApprove: 'dailyCap12',
              currentH,
              projectedH: currentH + shHours,
              willOvertime: true
            });
            return;
          }
        }

        const isRolloverSamePost = existingShiftsOnDate.length > 0 && existingShiftsOnDate.every(es => (es.postDesc || es.jobPostDetailId || '').trim() === shiftPost);
        const rolloverNote = isRolloverSamePost ? ' (Same-Post Rollover)' : (existingShiftsOnDate.length > 0 ? ' (Split Shift)' : '');

        const hasNotes = hasEmployeeAnyNotes(emp);
        const officerNotesText = (emp.notes || emp.ppaNotes || emp.cellNotes || '').trim();

        // Categorize Overtime status:
        // Contracted Billable OT: Through-and-through SOR shifts of any length (e.g. 8.25h, 10h, 12h) are contracted client coverage
        // and ALWAYS OK without requiring management OT approvals or daily cap waivers!
        const is6thDay = (projectedDaysWorked === 6);
        const is7thDay = (projectedDaysWorked >= 7);
        const isBillableShiftOT = isThroughAndThrough && (shHours > 8.01);
        const isDailyNonBillableOT = !isThroughAndThrough && (dayProjectedHours > 8.01);
        const isWeeklyOT = (currentH + shHours > 40.01);
        const isOver45h = (currentH + shHours > 45.01);
        // Overtime that triggers OT prioritization or requires approval:
        const isOvertimeAssignment = is6thDay || is7thDay || isDailyNonBillableOT || isWeeklyOT || isOver45h;

        const otReasons = [];
        if (is6thDay) otReasons.push('6th Day');
        if (is7thDay) otReasons.push('7th Day');
        if (isDailyNonBillableOT) otReasons.push(`${dayProjectedHours.toFixed(1)}h Daily Non-Billable OT (${maxDailyCap}h Cap)`);
        else if (isBillableShiftOT) otReasons.push(`Billable OT (${shHours.toFixed(1)}h Through-and-Through)`);
        if (isOver45h) otReasons.push(`>45h Weekly (${(currentH + shHours).toFixed(1)}h)`);
        else if (isWeeklyOT) otReasons.push(`>${40}h Weekly (${(currentH + shHours).toFixed(1)}h)`);

        // 6a. Check Preferences: Tier 1 (1st Choice)
        const p1W = parseTimeWindow(p1Val);
        if (p1W && p1W.start <= inT && inT < p1W.end) {
          const item = {
            emp,
            tier: 'Tier 1 (1st Choice)',
            tierLabel: '1st Choice' + rolloverNote,
            tierNum: 1,
            matchLabel: '1st Choice: ' + p1Val + rolloverNote,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: isOvertimeAssignment,
            isOvertime: isOvertimeAssignment,
            isBillableOT: isBillableShiftOT,
            isThroughAndThrough,
            isOver45: isOver45h,
            otReasons: otReasons,
            otApprovals: approvals,
            projectedDayHours: dayProjectedHours,
            dailyCap: maxDailyCap,
            projectedDaysWorked: projectedDaysWorked,
            effectiveLimit: effLimit,
            isRollover: isRolloverSamePost,
            priorityRank: (currentH < 20.0 ? 1 : 2),
            hasNotes: hasNotes,
            notesText: officerNotesText
          };
          tier1.push(item);
          if (hasNotes) tierNotes.push(item);
          allMatchesMap[eid] = item;
          return;
        }

        // 6b. Check Preferences: Tier 2 (2nd Choice)
        const p2W = parseTimeWindow(p2Val);
        if (p2W && p2W.start <= inT && inT < p2W.end) {
          const item = {
            emp,
            tier: 'Tier 2 (2nd Choice)',
            tierLabel: '2nd Choice' + rolloverNote,
            tierNum: 2,
            matchLabel: '2nd Choice: ' + p2Val + rolloverNote,
            currentH,
            projectedH: currentH + shHours,
            willOvertime: isOvertimeAssignment,
            isOvertime: isOvertimeAssignment,
            isBillableOT: isBillableShiftOT,
            isThroughAndThrough,
            isOver45: isOver45h,
            otReasons: otReasons,
            otApprovals: approvals,
            projectedDayHours: dayProjectedHours,
            dailyCap: maxDailyCap,
            projectedDaysWorked: projectedDaysWorked,
            effectiveLimit: effLimit,
            isRollover: isRolloverSamePost,
            priorityRank: (currentH < 20.0 ? 3 : 4),
            hasNotes: hasNotes,
            notesText: officerNotesText
          };
          tier2.push(item);
          if (hasNotes) tierNotes.push(item);
          allMatchesMap[eid] = item;
          return;
        }

        // 6c. Check Preferences: Tier 3 (Hired AV)
        const hWs = parseHiredWindows(hiredVal);
        for (const hw of hWs) {
          if (hw.start <= inT && inT < hw.end) {
            const item = {
              emp,
              tier: 'Tier 3 (Hired AV)',
              tierLabel: 'Hired AV' + rolloverNote,
              tierNum: 3,
              matchLabel: 'Hired AV: ' + hiredVal + rolloverNote,
              currentH,
              projectedH: currentH + shHours,
              willOvertime: isOvertimeAssignment,
              isOvertime: isOvertimeAssignment,
              isBillableOT: isBillableShiftOT,
              isThroughAndThrough,
              isOver45: isOver45h,
              otReasons: otReasons,
              otApprovals: approvals,
              projectedDayHours: dayProjectedHours,
              dailyCap: maxDailyCap,
              projectedDaysWorked: projectedDaysWorked,
              effectiveLimit: effLimit,
              isRollover: isRolloverSamePost,
              priorityRank: (currentH < 20.0 ? 5 : 6),
              hasNotes: hasNotes,
              notesText: officerNotesText
            };
            tier3.push(item);
            if (hasNotes) tierNotes.push(item);
            allMatchesMap[eid] = item;
            break;
          }
        }
      });

      // Strict Sorting: Non-Overtime Specialists ALWAYS come FIRST before Overtime candidates
      const sortCandidates = (a, b) => {
        const otA = a.isOvertime ? 1 : 0;
        const otB = b.isOvertime ? 1 : 0;
        if (otA !== otB) return otA - otB;
        if (Math.abs(a.currentH - b.currentH) > 0.01) return a.currentH - b.currentH;
        return a.emp.name.localeCompare(b.emp.name);
      };
      tier1.sort(sortCandidates);
      tier2.sort(sortCandidates);
      tier3.sort(sortCandidates);

      const p1 = tier1.filter(c => c.currentH < 20.0);
      const p2 = tier1.filter(c => c.currentH >= 20.0);
      const p3 = tier2.filter(c => c.currentH < 20.0);
      const p4 = tier2.filter(c => c.currentH >= 20.0);
      const p5 = tier3.filter(c => c.currentH < 20.0);
      const p6 = tier3.filter(c => c.currentH >= 20.0);

      return { tier1, tier2, tier3, tierNotes, p1, p2, p3, p4, p5, p6, conflicted, allMatchesMap };
    }

    // --- POPULATE STICKY SHIFT LINKER DROPDOWN ---
    function populateLinkingShiftDropdown() {
      const select = document.getElementById('selectLinkingShift');
      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc));

      let html = `<option value="">-- Pick an Open Shift to highlight best matching specialists on the grid (${openShifts.length} open) --</option>`;

      state.dates.forEach(dt => {
        const dateShifts = openShifts.filter(s => s.workDateNorm === dt);
        if (dateShifts.length > 0) {
          html += `<optgroup label="${dt} (${dateShifts.length} open shifts)">`;
          dateShifts.forEach(s => {
            html += `<option value="${s.id}">${s.workDateNorm} | ${s.inTime} - ${s.outTime} (${s.countedHours.toFixed(1)}h) &bull; ${s.jobDesc} &bull; Post: ${s.postDesc || s.jobPostDetailId || 'Standard'}</option>`;
          });
          html += `</optgroup>`;
        }
      });

      select.innerHTML = html;
    }

    function handleLinkingShiftChange(shiftId) {
      state.activeLinkingShiftId = shiftId || null;
      const clearBtn = document.getElementById('btnClearLinkingShift');
      const statusBox = document.getElementById('linkingShiftStatusContainer');
      const summaryText = document.getElementById('linkingCandidateSummary');

      if (!shiftId) {
        clearBtn.classList.add('hidden');
        statusBox.classList.add('hidden');
        state.filterMatchingOnly = false;
        document.getElementById('chkFilterMatchingOnly').checked = false;
      } else {
        clearBtn.classList.remove('hidden');
        statusBox.classList.remove('hidden');
        const shift = state.shifts.find(s => s.id === shiftId);
        if (shift) {
          const { tier1, tier2, tier3 } = getCandidateMatchesForShift(shift);
          summaryText.innerHTML = `Found <strong class="text-white">${tier1.length + tier2.length + tier3.length}</strong> eligible candidates: <span class="text-blue-300 font-bold">${tier1.length} 1st Choice</span> &bull; <span class="text-amber-300 font-bold">${tier2.length} 2nd Choice</span> &bull; <span class="text-indigo-300 font-bold">${tier3.length} Hired AV</span> (Lowest hours first)`;
        }
      }

      renderWorkingWeeksGrid();
    }

    function clearLinkingShift() {
      document.getElementById('selectLinkingShift').value = '';
      handleLinkingShiftChange('');
    }

    function toggleFilterMatchingOnly(checked) {
      state.filterMatchingOnly = checked;
      renderWorkingWeeksGrid();
    }

    // --- UI RENDERING: WORKING WEEKS MASTER GRID ---
    function renderWorkingWeeksGrid() {
      const tbody = document.getElementById('workingWeeksGridBody');
      if (!tbody) return;

      const search = (document.getElementById('inputGridSearch').value || '').trim().toLowerCase();
      const filter = document.getElementById('selectGridFilter').value;

      const linkingShift = state.activeLinkingShiftId ? state.shifts.find(s => s.id === state.activeLinkingShiftId) : null;
      let linkingMatches = null;
      if (linkingShift) {
        linkingMatches = getCandidateMatchesForShift(linkingShift);
      }

      let list = state.employees.filter(emp => {
        if (state.filterMatchingOnly && linkingMatches) {
          if (!linkingMatches.allMatchesMap[emp.eid]) return false;
        }

        const diff = Math.abs(emp.actualHours - emp.sheetHours);
        if (filter === 'discrepancy' && diff < 0.01) return false;
        if (filter === 'under45' && emp.actualHours >= 45.0) return false;
        if (filter === 'overtime' && emp.actualHours <= 45.0) return false;
        if (filter === 'ot_approved' && !getEmployeeOTApprovals(emp.eid).hasAny) return false;
        if (filter === 'bottom75' && !isEmployeeBottom75(emp)) return false;
        if (filter === 'dedicated' && !emp.notes.toLowerCase().includes('dedicated') && !Object.values(emp.daily).some(d => d.p1 === 'Dedication')) return false;
        if (filter === 'supervisor' && !emp.notes.toLowerCase().includes('acting supervisor')) return false;

        if (filter === 'ghost') {
          // Reference Sheet marked '1', but WinTeam has no shift (Dictated by WinTeam as Off)
          const hasGhost = state.dates.some(dt => {
            const wwMark = emp.daily[dt] ? (emp.daily[dt].wwReferenceWT || emp.daily[dt].wt) : '';
            const shifts = state.empDayWorkingShifts[emp.eid] ? state.empDayWorkingShifts[emp.eid][dt] : [];
            return wwMark === '1' && (!shifts || shifts.length === 0);
          });
          if (!hasGhost) return false;
        }

        if (filter === 'missing_wt') {
          // Authoritative shift exists in WinTeam report, but Working Weeks sheet was blank
          const hasMissing = state.dates.some(dt => {
            const wwMark = emp.daily[dt] ? (emp.daily[dt].wwReferenceWT || emp.daily[dt].wt) : '';
            const shifts = state.empDayWorkingShifts[emp.eid] ? state.empDayWorkingShifts[emp.eid][dt] : [];
            return wwMark !== '1' && shifts && shifts.length > 0;
          });
          if (!hasMissing) return false;
        }

        if (search) {
          const target = (emp.name + ' ' + emp.eid + ' ' + emp.notes + ' ' + emp.ptft).toLowerCase();
          if (!target.includes(search)) return false;
        }

        return true;
      });

      // Maintain strictly the Working Weeks sheet order (wwIndex)
      list.sort((a, b) => a.wwIndex - b.wwIndex);

      if (state.employees.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="${state.dates.length > 0 ? 8 + state.dates.length : 9}" class="py-16 text-center text-slate-500 bg-slate-50/50">
              <div class="max-w-md mx-auto flex flex-col items-center">
                <svg class="w-10 h-10 text-slate-400 mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div class="font-bold text-slate-800 text-sm mb-1">No Schedule Files Loaded</div>
                <p class="text-xs text-slate-500 mb-3">Load your WinTeam Schedule Report (Law) and Working Weeks Availability CSV (Reference) to view the master schedule.</p>
                <div class="flex items-center gap-2">
                  <button onclick="quickLoadWorkspaceFiles()" class="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <span>Quick-Load Active CSVs</span>
                  </button>
                  <button onclick="openUploadModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5">
                    <span>Choose Files...</span>
                  </button>
                </div>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      document.getElementById('gridFooterSummary').innerHTML = `Showing <strong>${list.length}</strong> of <strong>${state.employees.length}</strong> specialists &bull; <strong class="text-emerald-700">WinTeam Law:</strong> System of Record &bull; <strong class="text-blue-700">WW:</strong> Reference Sheet &bull; Target: &lt;45.0 Hours/Week &bull; <strong>${state.shifts.filter(s => s.isOpen && !s.assignedEmployee).length}</strong> open WinTeam shifts remaining`;

      let html = '';
      list.forEach(emp => {
        const delta = emp.actualHours - emp.sheetHours;
        let deltaHtml = '';
        if (delta > 0.01) {
          deltaHtml = `<span class="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 text-[11px]">+${delta.toFixed(2)}h</span>`;
        } else if (delta < -0.01) {
          deltaHtml = `<span class="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 text-[11px]">${delta.toFixed(2)}h</span>`;
        } else {
          deltaHtml = `<span class="text-slate-400 font-mono text-[11px]">0.00h</span>`;
        }

        const isOvertime = emp.actualHours > 45.0; // Weekly cap <45h
        const actualHoursClass = isOvertime ? 'text-rose-600 font-black bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200' : 'text-slate-900 font-black';
        const remainingUnder45 = 45.0 - emp.actualHours;
        const remainingText = remainingUnder45 >= 0
          ? `<div class="text-[9.5px] font-mono text-emerald-700 font-bold mt-0.5">${remainingUnder45.toFixed(1)}h left</div>`
          : `<div class="text-[9.5px] font-mono text-rose-600 font-black mt-0.5">OT: +${Math.abs(remainingUnder45).toFixed(1)}h</div>`;

        const linkMatch = linkingMatches ? linkingMatches.allMatchesMap[emp.eid] : null;
        let rowClass = 'hover:bg-slate-50 transition-colors';
        if (linkMatch) {
          rowClass = linkMatch.tierNum === 1 ? 'row-highlight-best border-l-4 border-l-blue-600' : 'row-highlight-good border-l-4 border-l-amber-500';
        }

        const tagsHtml = (emp.tags || []).map(t => `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${t.cls} shrink-0">${t.text}</span>`).join(' ');

        const otAppr = getEmployeeOTApprovals(emp.eid);
        let otApprBadge = '';
        if (otAppr && otAppr.hasAny) {
          const otTags = [];
          if (otAppr.sixthDay) otTags.push('6D');
          if (otAppr.seventhDay) otTags.push('7D');
          if (otAppr.dailyCap > 8) otTags.push(`${otAppr.dailyCap}h`);
          otApprBadge = `<button onclick="openOfficerDetailModal('${emp.eid}')" class="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs hover:bg-amber-200" title="Active Overtime Approvals: ${otTags.join(', ')}">⚡ ${otTags.join(' ')}</button>`;
        }

        html += `
          <tr class="${rowClass}">
            <td class="py-2.5 px-2 border-r border-slate-200 text-center text-slate-400 text-[11px] font-mono">${emp.wwIndex}</td>
            <td class="py-2.5 px-2.5 border-r border-slate-200 font-bold text-slate-800 font-mono text-[11px]">
              <span class="text-slate-500">#</span>${emp.eid}
            </td>
            <td class="py-2.5 px-3 border-r border-slate-200 font-sans">
              <div class="flex items-center gap-1.5 flex-wrap">
                <a href="javascript:void(0)" onclick="openOfficerDetailModal('${emp.eid}')" class="font-bold text-slate-900 hover:text-blue-600 hover:underline text-xs" title="Click to view officer profile, preferences & schedule breakdown">${escapeHtml(emp.name)}</a>
                <button onclick="openOfficerDetailModal('${emp.eid}')" class="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors inline-flex items-center" title="Open Officer Profile">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                </button>
                ${tagsHtml}
                ${otApprBadge}
                ${isOvertime ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-100 text-rose-700 font-mono border border-rose-200" title="Exceeds 45.0 hours weekly limit">Overtime (>45.0h)</span>' : ''}
              </div>
            </td>
            <td class="py-2.5 px-2 border-r border-slate-200 text-center text-slate-600 text-[11px] font-semibold">
              ${emp.ptft ? (emp.ptft === 'FT' ? 'Full-Time' : emp.ptft === 'PT' ? 'Part-Time' : emp.ptft) : 'Full-Time'}
            </td>
            <td class="py-2.5 px-2.5 border-r border-slate-200 text-center bg-blue-50/40">
              <div class="${actualHoursClass} text-xs font-mono font-black">${emp.actualHours.toFixed(2)} hrs</div>
              ${remainingText}
            </td>
            <td class="py-2.5 px-2 border-r border-slate-200 text-center text-slate-600 font-bold font-mono text-[11px]">
              ${emp.sheetHours.toFixed(2)} hrs
            </td>
            <td class="py-2.5 px-2 border-r border-slate-200 text-center font-mono">
              ${deltaHtml}
            </td>
        `;

        // Daily Cells
        state.dates.forEach(dt => {
          const dInfo = (emp.daily && emp.daily[dt]) ? emp.daily[dt] : { p1: '', p2: '', hired: '', wwReferenceWT: '' };
          const wwSheetRefWT = dInfo.wwReferenceWT || dInfo.wt || '';
          const workingShifts = (state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][dt]) || [];
          const isScheduledInWinTeam = workingShifts.length > 0;
          const isLinkingDay = linkingShift && linkingShift.workDateNorm === dt;

          let cellClass = 'py-2 px-2.5 border-r border-slate-200 align-top text-xs';
          let cellContent = '';

          // CASE 1: SPECIALIST IS SCHEDULED IN WINTEAM (AUTHORITATIVE LAW)
          if (isScheduledInWinTeam) {
            cellClass += ' bg-emerald-50/30';
            const shiftCards = workingShifts.map(s => {
              const isAssignedThisSession = s.assignedEmployee !== undefined;
              const shiftTime = `${s.inTime} - ${s.outTime}`;
              const jobStr = escapeHtml(s.postDesc || s.jobDesc || 'Shift');
              const wwAligned = wwSheetRefWT === '1';

              return `
                <div class="badge-working p-2 rounded-lg flex flex-col gap-1 shadow-2xs mb-1 last:mb-0">
                  <div class="flex items-center justify-between font-extrabold text-[10.5px] text-emerald-950">
                    <span class="flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      <span>${shiftTime}</span>
                    </span>
                    <span class="font-mono text-emerald-800 font-black">${s.countedHours.toFixed(1)} hrs</span>
                  </div>
                  <div class="text-[10px] text-emerald-900 font-semibold font-sans truncate" title="${jobStr}">${jobStr}</div>
                  <div class="flex items-center justify-between text-[9px] text-emerald-700 font-mono mt-0.5">
                    <span>Shift #${s.shiftId || '1A'} &bull; Job #${s.jobNumber || '233265'}</span>
                  </div>
                  <div class="text-[8.5px] text-emerald-800/80 font-sans mt-0.5">
                    [Source: WinTeam Report (Law)]
                  </div>
                  ${!wwAligned ? `
                    <div class="text-[8.5px] text-amber-800 font-bold bg-amber-50 border border-amber-200 rounded px-1 py-0.5 mt-0.5">
                      Working Weeks Sheet: Unmarked
                    </div>
                  ` : `
                    <div class="text-[8.5px] text-slate-500 font-medium">
                      Working Weeks Sheet: Marked 1 (Aligned)
                    </div>
                  `}
                  ${isAssignedThisSession ? `
                    <button onclick="unassignShift('${s.shiftId || s.id}')" class="mt-1 text-[9.5px] text-rose-700 font-bold hover:underline text-left">
                      &times; Undo Session Assignment
                    </button>
                  ` : ''}
                </div>
              `;
            }).join('');

            // Linker button for rollover or second shift if eligible
            if (isLinkingDay && linkMatch) {
              const badgeTierCls = linkMatch.tierNum === 1 ? 'bg-blue-600 text-white' : linkMatch.tierNum === 2 ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white';
              cellContent = `
                <div class="flex flex-col gap-1">
                  ${shiftCards}
                  <button onclick="assignCandidate('${linkingShift.id}', '${emp.eid}', '${linkMatch.tier}')" class="w-full px-2 py-1 rounded-lg ${badgeTierCls} hover:opacity-90 font-bold text-[10px] shadow-sm transition-all flex items-center justify-center gap-1">
                    <span>+ Add ${linkMatch.isRollover ? 'Rollover' : '2nd Shift'}</span>
                    <span class="font-mono text-[9px]">(${linkMatch.projectedH.toFixed(1)}h)</span>
                  </button>
                </div>
              `;
            } else {
              const multiMatches = countOpenMatchesForSpecialist(emp, dt);
              cellContent = `
                <div class="flex flex-col gap-1">
                  ${shiftCards}
                  ${multiMatches.total > 0 ? `
                    <button onclick="openCellShiftChooser('${emp.eid}', '${dt}')" class="px-1.5 py-0.5 rounded bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 font-bold text-[9px] transition-all flex items-center justify-between" title="Can work rollover on same post or <=8h total across different posts">
                      <span>+ Rollover / 2nd Shift</span>
                      <span class="px-1 rounded-full bg-purple-200 text-purple-900 font-mono text-[8.5px]">${multiMatches.total}</span>
                    </button>
                  ` : ''}
                </div>
              `;
            }
          }

          // CASE 2: SPECIALIST IS OFF IN WINTEAM (AUTHORITATIVE LAW)
          else {
            // Check if Working Weeks reference sheet had marked '1'
            let sheetVarianceBadge = '';
            if (wwSheetRefWT === '1') {
              sheetVarianceBadge = `
                <div class="p-1 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[9px] font-bold leading-tight mb-1" title="Working Weeks reference sheet marked WT=1, but WinTeam report has no shift. Dictated by WinTeam Law as Off.">
                  ⚠️ WW Sheet marked '1' (Dictated by WinTeam: Off)
                </div>
              `;
            }

            if (['Dedication', 'TOR', 'Not Available', 'Opt Out'].includes(dInfo.p1)) {
              let lockText = dInfo.p1;
              let lockClass = 'text-slate-500 bg-slate-100 border-slate-200';
              if (dInfo.p1 === 'Dedication') {
                lockText = 'BRE Dedicated Specialist';
                lockClass = 'bg-blue-50 text-blue-800 border-blue-200 font-bold';
              } else if (dInfo.p1 === 'TOR') {
                lockText = 'Time Off Request (TOR)';
                lockClass = 'bg-rose-50 text-rose-800 border-rose-200 font-bold';
              } else if (dInfo.p1 === 'Not Available') {
                lockText = 'Not Available';
                lockClass = 'bg-slate-100 text-slate-700 border-slate-300 font-bold';
              }

              cellContent = `
                <div class="flex flex-col gap-1">
                  ${sheetVarianceBadge}
                  <span class="px-2 py-1 rounded text-[10px] ${lockClass} block text-center border">
                    ${lockText}
                  </span>
                  <div class="text-[8.5px] text-slate-400 font-sans text-center">[Source: Working Weeks Sheet]</div>
                </div>
              `;
            } else {
              const p1Text = dInfo.p1 ? `<div class="truncate text-blue-900 font-medium" title="1st Choice Preference: ${escapeHtml(dInfo.p1)}"><span class="font-bold text-blue-700">1st:</span> ${escapeHtml(dInfo.p1)}</div>` : '';
              const p2Text = dInfo.p2 ? `<div class="truncate text-amber-900 font-medium" title="2nd Choice Preference: ${escapeHtml(dInfo.p2)}"><span class="font-bold text-amber-700">2nd:</span> ${escapeHtml(dInfo.p2)}</div>` : '';
              const hiredText = dInfo.hired ? `<div class="truncate text-slate-600 font-medium" title="Hired Availability Window: ${escapeHtml(dInfo.hired)}"><span class="font-bold text-slate-500">Hired:</span> ${escapeHtml(dInfo.hired)}</div>` : '';

              if (isLinkingDay && linkMatch) {
                const badgeTierCls = linkMatch.tierNum === 1 ? 'bg-blue-600 text-white' : linkMatch.tierNum === 2 ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white';
                cellContent = `
                  <div class="flex flex-col gap-1">
                    ${sheetVarianceBadge}
                    <button onclick="assignCandidate('${linkingShift.id}', '${emp.eid}', '${linkMatch.tier}')" class="w-full px-2 py-1.5 rounded-lg ${badgeTierCls} hover:opacity-90 font-bold text-[10.5px] shadow-sm transition-all flex items-center justify-center gap-1">
                      <span>Assign Shift</span>
                      <span class="font-mono text-[9.5px]">(${linkMatch.projectedH.toFixed(1)}h)</span>
                    </button>
                    <div class="text-[9px] text-slate-600 text-center font-sans font-medium">${linkMatch.matchLabel}</div>
                    <div class="text-[8.5px] text-slate-400 text-center font-sans">[Source: Working Weeks Sheet]</div>
                  </div>
                `;
              } else {
                const openMatches = countOpenMatchesForSpecialist(emp, dt);
                const hasMatches = openMatches.total > 0;

                cellContent = `
                  <div class="flex flex-col gap-1">
                    ${sheetVarianceBadge}
                    <div class="text-[9.5px] leading-tight flex flex-col font-sans text-slate-700">
                      ${p1Text}
                      ${p2Text}
                      ${hiredText}
                    </div>
                    <div class="text-[8.5px] text-slate-400 font-sans">[Source: Working Weeks Sheet]</div>
                    ${hasMatches ? `
                      <button onclick="openCellShiftChooser('${emp.eid}', '${dt}')" class="mt-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold text-[9.5px] transition-all flex items-center justify-between group">
                        <span>+ Fill Open Shift</span>
                        <span class="px-1.5 py-0.2 rounded-full bg-blue-200 text-blue-900 font-mono text-[9px] font-bold">${openMatches.total}</span>
                      </button>
                    ` : `
                      <span class="text-[9px] text-slate-400 font-sans italic mt-0.5">Off in WinTeam &bull; No Match</span>
                    `}
                  </div>
                `;
              }
            }
          }

          html += `<td class="${cellClass}">${cellContent}</td>`;
        });

        html += `
            <td class="py-2 px-3 text-slate-600 font-sans text-[11px] max-w-xs whitespace-normal break-words leading-relaxed" title="${escapeHtml(emp.notes)}">
              ${escapeHtml(emp.notes || '-')}
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
    }

    function countOpenMatchesForSpecialist(emp, dt) {
      if (!emp) return { tier1: 0, tier2: 0, tier3: 0, total: 0 };
      const status = getEmployeeStatus(emp, dt);
      if (status.isBlocked) {
        return { tier1: 0, tier2: 0, tier3: 0, total: 0 };
      }
      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee && s.workDateNorm === dt && isFillablePostDescription(s.postDesc));
      const dInfo = emp.daily[dt] || {};
      const existingShifts = (state.empDayWorkingShifts && state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][dt]) || [];

      if (['Dedication', 'TOR', 'Not Available', 'Opt Out'].includes(dInfo.p1)) {
        return { tier1: 0, tier2: 0, tier3: 0, total: 0 };
      }

      let t1 = 0, t2 = 0, t3 = 0;
      const p1W = parseTimeWindow(dInfo.p1);
      const p2W = parseTimeWindow(dInfo.p2);
      const hWs = parseHiredWindows(dInfo.hired);
      const dayExistingHours = existingShifts.reduce((acc, es) => acc + es.countedHours, 0.0);

      openShifts.forEach(s => {
        // Bottom 75 Working Weeks seniority restriction for BRE shifts (JC 235144 / 267588)
        if (isEmployeeBottom75(emp) && isBreShift(s)) return;

        // Overlap check
        if (existingShifts.length > 0) {
          if (existingShifts.some(es => shiftsOverlap(es, s))) return;
          const shiftPost = (s.postDesc || s.jobPostDetailId || '').trim();
          const isSamePostAll = existingShifts.every(es => (es.postDesc || es.jobPostDetailId || '').trim() === shiftPost);
          if (!isSamePostAll && (dayExistingHours + s.countedHours) > 8.01) return; // Non-billable OT rule
        }

        // Weekly hours check (allows >45h if company overtime is approved)
        const effLimit = getEmployeeEffectiveLimit(emp);
        if (emp.actualHours + s.countedHours > effLimit + 0.01) return;

        const inT = s.inTimeHours;
        if (p1W && p1W.start <= inT && inT < p1W.end) t1++;
        else if (p2W && p2W.start <= inT && inT < p2W.end) t2++;
        else {
          for (const hw of hWs) {
            if (hw.start <= inT && inT < hw.end) {
              t3++;
              break;
            }
          }
        }
      });

      const total = state.avoidHiredAV ? (t1 + t2) : (t1 + t2 + t3);
      return { tier1: t1, tier2: t2, tier3: t3, total };
    }

    // --- CELL SHIFT CHOOSER MODAL (From Specialist to Open Shifts) ---
    function openCellShiftChooser(eid, dt) {
      const emp = state.employees.find(e => e.eid === eid);
      if (!emp) return;

      const title = document.getElementById('cellChooserTitle');
      const subtitle = document.getElementById('cellChooserSubtitle');
      const listContainer = document.getElementById('cellChooserShiftsList');
      const modal = document.getElementById('modalCellShiftChooser');

      const isUnder20 = emp.actualHours < 20.0;
      const priorityTag = isUnder20 ? 'Priority: &lt;20h' : 'Priority: &ge;20h';
      title.innerHTML = `Available Open Shifts for <span class="text-blue-400">${escapeHtml(emp.name)}</span>`;
      subtitle.innerHTML = `Date: <strong class="text-white">${dt}</strong> &bull; Current Hours: <strong class="text-emerald-400 font-mono">${emp.actualHours.toFixed(2)}h</strong> (${priorityTag}) &bull; Target: &lt;45h`;

      const status = getEmployeeStatus(emp, dt);
      if (status.isBlocked) {
        listContainer.innerHTML = `
          <div class="p-6 bg-rose-50 border border-rose-200 rounded-xl text-center">
            <div class="text-rose-800 font-bold text-sm mb-1">Specialist Disqualified</div>
            <p class="text-rose-600 text-xs">${escapeHtml(emp.name)} is disqualified from shift assignment: <strong class="underline font-bold">${status.reason}</strong> (found in Working Weeks notes).</p>
          </div>
        `;
        modal.classList.remove('hidden');
        return;
      }

      const empDates = state.empWorkingDates[emp.eid] || new Set();
      const isWorkingOnDate = empDates.has(dt);
      const projDays = isWorkingOnDate ? empDates.size : empDates.size + 1;
      const approvals = getEmployeeOTApprovals(emp.eid);

      if (projDays === 6 && !approvals.sixthDay) {
        listContainer.innerHTML = `
          <div class="p-6 bg-amber-50 border border-amber-300 rounded-xl text-center">
            <div class="text-amber-900 font-bold text-sm mb-1">6th Day Overtime Approval Required</div>
            <p class="text-amber-800 text-xs mb-3">${escapeHtml(emp.name)} is already scheduled for <strong>${empDates.size} days</strong> this week. Assigning a shift on ${dt} would be their 6th working day.</p>
            <button onclick="quickGrantOTApproval('${emp.eid}', 'sixthDay'); openCellShiftChooser('${emp.eid}', '${dt}');"
              class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg shadow-sm">
              + Authorize 6th Day Overtime (Company-Wide)
            </button>
            <div class="text-[11px] text-amber-700 mt-2">Overtime approvals are company-wide and cover every Specialist in the company.</div>
          </div>
        `;
        modal.classList.remove('hidden');
        return;
      }

      if (projDays >= 7 && !approvals.seventhDay) {
        listContainer.innerHTML = `
          <div class="p-6 bg-amber-50 border border-amber-300 rounded-xl text-center">
            <div class="text-amber-900 font-bold text-sm mb-1">7th Day Overtime Approval Required</div>
            <p class="text-amber-800 text-xs mb-3">${escapeHtml(emp.name)} is already scheduled for <strong>${empDates.size} days</strong> this week. Assigning a shift on ${dt} would be their 7th working day.</p>
            <button onclick="quickGrantOTApproval('${emp.eid}', 'seventhDay'); openCellShiftChooser('${emp.eid}', '${dt}');"
              class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg shadow-sm">
              + Authorize 7th Day Overtime (Company-Wide)
            </button>
            <div class="text-[11px] text-amber-700 mt-2">Overtime approvals are company-wide and cover every Specialist in the company.</div>
          </div>
        `;
        modal.classList.remove('hidden');
        return;
      }

      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee && s.workDateNorm === dt && isFillablePostDescription(s.postDesc));
      const dInfo = emp.daily[dt] || {};
      const existingShifts = (state.empDayWorkingShifts && state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][dt]) || [];
      const dayExistingHours = existingShifts.reduce((acc, es) => acc + es.countedHours, 0.0);

      const p1W = parseTimeWindow(dInfo.p1);
      const p2W = parseTimeWindow(dInfo.p2);
      const hWs = parseHiredWindows(dInfo.hired);

      const t1Shifts = [];
      const t2Shifts = [];
      const t3Shifts = [];
      const blockedNonBillable = [];
      const blockedBre = [];

      openShifts.forEach(s => {
        // Bottom 75 Working Weeks seniority restriction for BRE shifts (JC 235144 / 267588)
        if (isEmployeeBottom75(emp) && isBreShift(s)) {
          blockedBre.push({
            shift: s,
            reason: `Seniority restriction: Bottom 75 in Working Weeks are not eligible for BRE shifts (JC ${s.jobNumber || '235144 / 267588'})`
          });
          return;
        }

        // Cross-Day Timeline Overlap & Minimum 8.0h Rest Turnaround Check against ALL scheduled shifts
        // (including shifts in EMP on other jobs and adjacent days)
        const allScheduledShifts = getEmployeeAllScheduledShifts(emp.eid);
        let hasConflict = false;
        let conflictReason = '';
        for (const es of allScheduledShifts) {
          if (shiftsOverlap(es, s)) {
            hasConflict = true;
            const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
            conflictReason = `Physical overlap with scheduled shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag}`;
            break;
          }
          const restGap = getShiftsRestGap(es, s);
          if (restGap < 8.0) {
            hasConflict = true;
            const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
            conflictReason = `Rest violation: Only ${restGap.toFixed(1)}h turnaround from shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag} — min 8h required`;
            break;
          }
        }
        if (hasConflict) {
          blockedNonBillable.push({ shift: s, reason: conflictReason });
          return;
        }

        // Calendar Day Hour Cap Enforcement (12h/16h caps)
        const dayProjectedH = dayExistingHours + s.countedHours;
        let maxDailyCap = 8.0;
        if (approvals.dailyCap === 16) maxDailyCap = 16.0;
        else if (approvals.dailyCap === 12) maxDailyCap = 12.0;
        else maxDailyCap = (existingShifts.length === 0 && s.countedHours > 8.0) ? s.countedHours : 8.0;

        if (dayProjectedH > maxDailyCap + 0.01) {
          blockedNonBillable.push({
            shift: s,
            reason: `Exceeds daily cap: Shifts would total ${dayProjectedH.toFixed(1)}h on ${dt} (Max ${maxDailyCap}h cap${approvals.dailyCap > 8 ? ' approved' : ''})`
          });
          return;
        }

        // Post description & non-billable OT rule:
        // Different posts allowed up to approved daily cap (or 8h standard)
        const shiftPost = (s.postDesc || s.jobPostDetailId || '').trim();
        const isSamePostAll = existingShifts.length > 0 && existingShifts.every(es => (es.postDesc || es.jobPostDetailId || '').trim() === shiftPost);

        if (existingShifts.length > 0 && !isSamePostAll && approvals.dailyCap < 12 && dayProjectedH > 8.01) {
          blockedNonBillable.push({ shift: s, reason: `Exceeds 8h daily limit across different posts (${dayProjectedH.toFixed(1)}h). Requires 12h/16h Cap Approval.` });
          return;
        }

        const rolloverTag = isSamePostAll ? ' [Same-Post Rollover]' : (existingShifts.length > 0 ? ' [Split Shift &le;8h]' : '');
        const inT = s.inTimeHours;

        if (p1W && p1W.start <= inT && inT < p1W.end) {
          t1Shifts.push({ shift: s, label: '1st Choice: ' + dInfo.p1 + rolloverTag, isRollover: isSamePostAll });
        } else if (p2W && p2W.start <= inT && inT < p2W.end) {
          t2Shifts.push({ shift: s, label: '2nd Choice: ' + dInfo.p2 + rolloverTag, isRollover: isSamePostAll });
        } else {
          for (const hw of hWs) {
            if (hw.start <= inT && inT < hw.end) {
              t3Shifts.push({ shift: s, label: 'Hired AV: ' + dInfo.hired + rolloverTag, isRollover: isSamePostAll });
              break;
            }
          }
        }
      });

      let html = `
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-blue-900 text-[11px]">
          <strong>Scheduling Rules Active:</strong> Through-and-through SOR shifts of any length (e.g. 8.25h, 10h) are contracted billable OT and always allowed without OT approvals. Specialists can take a second shift on the same day if on the same post (Rollover), or across different posts if daily total &le; 8h. Weekly target: &lt;45 hours. Only Break Relief Extra and 6-digit posts (not ending in -S) are fillable. Bottom 75 specialists in Working Weeks are ineligible for BRE shifts (JC 235144 / 267588).
        </div>
      `;

      if (t1Shifts.length === 0 && t2Shifts.length === 0 && t3Shifts.length === 0) {
        html += `<div class="p-8 text-center text-slate-400">No open shifts on ${dt} match this specialist's availability window within the scheduling rules.</div>`;
      } else {
        if (t1Shifts.length > 0) html += renderChooserTierGroup(`Tier 1: Preferred 1st Choice (${isUnder20 ? 'Priority 1: &lt;20h' : 'Priority 2: &ge;20h'})`, t1Shifts, isUnder20 ? 'badge-p1-under20' : 'badge-p1-over20', emp);
        if (t2Shifts.length > 0) html += renderChooserTierGroup(`Tier 2: Preferred 2nd Choice (${isUnder20 ? 'Priority 3: &lt;20h' : 'Priority 4: &ge;20h'})`, t2Shifts, isUnder20 ? 'badge-p2-under20' : 'badge-p2-over20', emp);
        if (t3Shifts.length > 0) html += renderChooserTierGroup('Tier 3: Hired Availability (Avoided / Emergency Fallback Only)', t3Shifts, 'badge-hired', emp);
      }

      if (blockedNonBillable.length > 0) {
        const canApproveCap12 = (approvals.dailyCap < 12);
        html += `
          <div class="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 text-[11px] p-3">
            <div class="flex items-center justify-between mb-1">
              <span class="font-bold text-slate-700">Blocked by Daily Cap / Non-Billable OT Rule (${blockedNonBillable.length} shifts on ${dt}):</span>
              ${canApproveCap12 ? `
                <button onclick="quickGrantOTApproval('${emp.eid}', 'dailyCap12'); openCellShiftChooser('${emp.eid}', '${dt}');"
                  class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] rounded shadow-2xs">
                  + Authorize 12h Cap (Company-Wide)
                </button>
              ` : ''}
            </div>
            <p class="text-slate-500 mb-2">These shifts cannot be assigned because working on a different post or multi-shift exceeds the daily limit (${approvals.dailyCap}h cap).</p>
            <div class="divide-y divide-slate-200 max-h-36 overflow-y-auto">
              ${blockedNonBillable.map(({ shift: s, reason }) => `
                <div class="py-1 flex items-center justify-between font-mono">
                  <span>${s.inTime}-${s.outTime} (${s.countedHours.toFixed(1)}h) &bull; ${escapeHtml(s.postDesc || s.jobDesc)}</span>
                  <span class="text-rose-600 font-sans">${reason}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (blockedBre.length > 0) {
        html += `
          <div class="border border-rose-200 rounded-xl overflow-hidden bg-rose-50/70 text-[11px] p-3 mt-2">
            <span class="font-bold text-rose-800 block mb-1">Blocked by BRE Seniority Rule (${blockedBre.length} shifts on ${dt}):</span>
            <p class="text-rose-600 mb-2">This specialist is in the bottom 75 of Working Weeks and is not eligible to work BRE shifts (Anything under JC 235144 or 267588).</p>
            <div class="divide-y divide-rose-200 max-h-36 overflow-y-auto">
              ${blockedBre.map(({ shift: s, reason }) => `
                <div class="py-1 flex items-center justify-between font-mono">
                  <span>${s.inTime}-${s.outTime} (${s.countedHours.toFixed(1)}h) &bull; ${escapeHtml(s.postDesc || s.jobDesc)} &bull; Job #${s.jobNumber}</span>
                  <span class="text-rose-700 font-sans font-semibold">${reason}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      listContainer.innerHTML = html;
      document.getElementById('modalCellShiftChooser').classList.remove('hidden');
    }

    function renderChooserTierGroup(tierTitle, shiftItems, badgeCls, emp) {
      let html = `
        <div class="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
          <div class="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-800 flex items-center justify-between">
            <span>${tierTitle}</span>
            <span class="px-2 py-0.2 rounded-full bg-slate-200 text-slate-700 font-mono text-[10px]">${shiftItems.length} open</span>
          </div>
          <div class="divide-y divide-slate-100 max-h-56 overflow-y-auto">
      `;

      shiftItems.forEach(({ shift: s, label, isRollover }) => {
        const projectedH = emp.actualHours + s.countedHours;
        const isOT = projectedH > 45.0; // Weekly target <45h
        const existingOnDate = (state.empDayWorkingShifts && state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][s.workDateNorm]) || [];
        const isThroughAndThrough = (existingOnDate.length === 0);
        const isBillableOT = isThroughAndThrough && (s.countedHours > 8.01);

        html += `
          <div class="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-xs">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900 font-mono text-sm">${s.inTime} - ${s.outTime}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-800">${s.countedHours.toFixed(1)} hrs</span>
                <span class="px-1.5 py-0.2 rounded ${badgeCls} text-[10px] font-semibold">${label}</span>
                ${isRollover ? '<span class="px-1.5 py-0.2 rounded badge-rollover-allowed text-[10px] font-bold">Rollover</span>' : ''}
                ${isBillableOT ? '<span class="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[9.5px]">✓ Billable OT</span>' : ''}
                ${isOT ? `<span class="px-1.5 py-0.2 rounded ${approvals && approvals.hasAny ? 'bg-purple-100 text-purple-900 border border-purple-300' : 'bg-rose-100 text-rose-700'} font-bold text-[9.5px]">${approvals && approvals.hasAny ? '⚡ Approved OT' : 'Will Overtime'}: ${projectedH.toFixed(1)}h (&gt;45h)</span>` : ''}
              </div>
              <div class="text-[11px] text-slate-500 mt-0.5">
                ${escapeHtml(s.jobDesc)} &bull; Job #${s.jobNumber} &bull; Post: ${escapeHtml(s.postDesc || s.jobPostDetailId || 'Standard')}
              </div>
            </div>
            <button onclick="assignCandidate('${s.id}', '${emp.eid}', '${label}'); closeCellShiftChooser();" class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-all shrink-0">
              Assign to ${escapeHtml(emp.name.split(' ')[0])}
            </button>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
      return html;
    }

    function closeCellShiftChooser() {
      document.getElementById('modalCellShiftChooser').classList.add('hidden');
    }

    // --- ASSIGNMENT & UNASSIGN ACTIONS ---
    function assignCandidate(shiftId, eid, tierLabel) {
      const shift = state.shifts.find(s => s.id === shiftId);
      const employee = state.employees.find(e => e.eid === eid);
      if (!shift || !employee) return;

      const status = getEmployeeStatus(employee, shift.workDateNorm);
      if (status.isBlocked) {
        alert(`Cannot assign shift: ${employee.name} is disqualified (${status.reason}).`);
        return;
      }

      if (isBreShift(shift) && isEmployeeBottom75(employee)) {
        alert(`Cannot assign shift: ${employee.name} is in the bottom 75 of Working Weeks and is not eligible to work BRE shifts (Anything under JC 235144 or 267588).`);
        return;
      }

      // Safety conflict guard: Check physical overlap and rest turnaround against all scheduled shifts (EMP & PPA)
      const allScheduledShifts = getEmployeeAllScheduledShifts(employee.eid);
      for (const es of allScheduledShifts) {
        if (es.id === shift.id) continue;
        if (shiftsOverlap(es, shift)) {
          const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
          alert(`Cannot assign shift: ${employee.name} is already scheduled on a conflicting shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag}.`);
          return;
        }
      }
      for (const es of allScheduledShifts) {
        if (es.id === shift.id) continue;
        const restGap = getShiftsRestGap(es, shift);
        if (restGap < 8.0) {
          const outsideTag = es.isOutsideShift ? ` [Outside Job #${es.jobNumber}: ${es.jobDesc || es.postDesc || 'Contract'}]` : (es.jobNumber ? ` [Job #${es.jobNumber}]` : '');
          const proceed = confirm(`Warning: ${employee.name} has only ${restGap.toFixed(1)}h turnaround rest from their scheduled shift on ${es.workDateNorm} (${es.inTime}-${es.outTime})${outsideTag} [Minimum 8.0h rest required]. Do you want to proceed with this assignment?`);
          if (!proceed) return;
        }
      }

      if (shift.assignedEmployee) {
        unassignShift(shiftId, false);
      }

      shift.assignedEmployee = employee;
      shift.assignedTier = tierLabel;
      shift.isOpen = false;

      const existingDayHours = (state.empDayWorkingShifts[employee.eid] && state.empDayWorkingShifts[employee.eid][shift.workDateNorm])
        ? state.empDayWorkingShifts[employee.eid][shift.workDateNorm].reduce((acc, s) => acc + s.countedHours, 0)
        : 0;
      const isThroughAndThrough = (existingDayHours === 0);
      const isShiftOT = (shift.countedHours > 8.01);
      const isBillableOT = isThroughAndThrough && isShiftOT;
      const is6thDay = (state.empWorkingDates[employee.eid] && !state.empWorkingDates[employee.eid].has(shift.workDateNorm) && state.empWorkingDates[employee.eid].size === 5);
      const is7thDay = (state.empWorkingDates[employee.eid] && !state.empWorkingDates[employee.eid].has(shift.workDateNorm) && state.empWorkingDates[employee.eid].size >= 6);
      const isDailyNonBillableOT = (!isThroughAndThrough && (existingDayHours + shift.countedHours > 8.01));
      const isWeeklyOT = (employee.actualHours + shift.countedHours > 40.01);
      const isOT = is6thDay || is7thDay || isDailyNonBillableOT || isWeeklyOT || (!isBillableOT && isShiftOT);
      const otReasons = [];
      if (isBillableOT) otReasons.push(`Billable OT (${shift.countedHours.toFixed(1)}h Through-and-Through)`);
      if (is6thDay) otReasons.push('6th Day');
      if (is7thDay) otReasons.push('7th Day');
      if (isDailyNonBillableOT) otReasons.push(`${(existingDayHours + shift.countedHours).toFixed(1)}h Daily Non-Billable OT`);
      if (isWeeklyOT) otReasons.push(`>${40}h Weekly`);

      const sessionEntry = {
        shiftId: shift.id,
        eid: employee.eid,
        name: employee.name,
        wwNotes: employee.notes || '', 
        workDateNorm: shift.workDateNorm,
        inTime: shift.inTime,
        outTime: shift.outTime,
        inTimeHours: (shift.inTimeHours !== undefined) ? shift.inTimeHours : timeStringToHours(shift.inTime),
        outTimeHours: (shift.outTimeHours !== undefined) ? shift.outTimeHours : timeStringToHours(shift.outTime),
        countedHours: shift.countedHours,
        jobDesc: shift.jobDesc,
        jobNumber: shift.jobNumber,
        postDesc: shift.postDesc,
        shiftIdVal: shift.shiftId,
        scheduleDetailsId: shift.scheduleDetailsId,
        tier: tierLabel,
        isOvertime: isOT,
        isBillableOT: isBillableOT,
        isThroughAndThrough: isThroughAndThrough,
        otReasons: otReasons,
        timestamp: new Date().toLocaleTimeString(),
        doneInWinTeam: false
      };
      state.sessionAssignments.push(sessionEntry);

      calculateAllHours();
      populateLinkingShiftDropdown();
      updateKPISummaries();
      renderWorkingWeeksGrid();
      renderShiftFirstView();
      renderWinTeamTable();

      // Automatically copy EID to clipboard for quick paste into WinTeam!
      const audit = getWinTeamOTAudit(sessionEntry);
      const otToast = audit.hasExpectedOT
        ? ` (⚡ Expected OT: +${audit.expectedOTHours.toFixed(1)}h — ${audit.causes.map(c => c.label).join(', ')})`
        : '';
      copyToClipboard(employee.eid, `Assigned ${employee.name}${otToast} — EID ${employee.eid} copied! Ready to paste into WinTeam.`);
    }

    function unassignShift(shiftId, showNotification = true) {
      const shift = state.shifts.find(s => s.id === shiftId || s.shiftId === shiftId);
      if (!shift) return;

      const empName = shift.assignedEmployee ? shift.assignedEmployee.name : '';

      shift.assignedEmployee = null;
      shift.assignedTier = null;
      shift.isOpen = true;

      state.sessionAssignments = state.sessionAssignments.filter(sa => sa.shiftId !== shift.id);

      calculateAllHours();
      populateLinkingShiftDropdown();
      updateKPISummaries();
      renderWorkingWeeksGrid();
      renderShiftFirstView();
      renderWinTeamTable();

      if (showNotification) {
        showToast(`Unassigned ${empName || 'officer'} from ${shift.workDateNorm} shift.`);
      }
    }

    // --- DAY INFO HELPER ---
    function getDayMeta(dtStr) {
      if (!dtStr) return { shortDay: 'DAY', shortLabel: 'Day', fullLabel: 'Day' };
      const d = new Date(dtStr + 'T12:00:00');
      if (isNaN(d)) {
        return { shortDay: dtStr, shortLabel: dtStr, fullLabel: dtStr };
      }
      const shortDay = d.toLocaleDateString('en-US', { weekday: 'short' });
      const fullDay = d.toLocaleDateString('en-US', { weekday: 'long' });
      const monthDay = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      return {
        shortDay,
        shortLabel: `${shortDay} ${monthDay}`,
        fullLabel: `${fullDay}, ${dtStr}`
      };
    }

    // --- MODE 2: SHIFT-FIRST VIEW (WinTeam Sorting & 4 Job Codes Separation) ---
    function renderShiftFirstView() {
      renderShiftFirstJobRibbon();
      renderShiftFirstDayRibbon();
      renderShiftFirstDaysContent();
    }

    function renderShiftFirstJobRibbon() {
      const ribbon = document.getElementById('shiftFirstJobRibbon');
      if (!ribbon) return;

      const getJobOpenCount = (jobCode) => {
        return state.shifts.filter(s => {
          const isJob = jobCode === 'all' || String(s.jobNumber).trim() === jobCode;
          const isDay = state.shiftFirstSelectedDay === 'all' || s.workDateNorm === state.shiftFirstSelectedDay;
          return isJob && isDay && s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc);
        }).length;
      };

      const totalOpen = getJobOpenCount('all');
      const isAllSelected = state.shiftFirstJobFilter === 'all';
      const allBtnCls = isAllSelected
        ? 'bg-indigo-600 text-white shadow-sm font-bold'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-medium';

      let html = `
        <button onclick="setShiftFirstJob('all')" class="px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 transition-all ${allBtnCls}">
          <span>All 4 Job Codes</span>
          <span class="px-1.5 py-0.2 rounded-full font-mono text-[10px] ${isAllSelected ? 'bg-indigo-800 text-white' : 'bg-slate-200 text-slate-800'} font-bold">${totalOpen}</span>
        </button>
      `;

      const jobKeys = ['233265', '235144', '266778', '267588'];
      jobKeys.forEach(jk => {
        const jDef = JOB_CODES[jk] || { code: jk, shortTitle: jk, isBre: false };
        const count = getJobOpenCount(jk);
        const isSelected = state.shiftFirstJobFilter === jk;
        const btnCls = isSelected
          ? 'bg-indigo-600 text-white shadow-sm font-bold ring-2 ring-indigo-400/40'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-medium';

        html += `
          <button onclick="setShiftFirstJob('${jk}')" class="px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 transition-all ${btnCls}">
            <span class="font-mono text-[11px] font-bold">${jk}</span>
            <span>${jDef.shortTitle}</span>
            <span class="px-1.5 py-0.2 rounded-full font-mono text-[10px] ${isSelected ? 'bg-indigo-800 text-white' : 'bg-slate-200 text-slate-800'} font-bold">${count}</span>
          </button>
        `;
      });

      ribbon.innerHTML = html;
    }

    function setShiftFirstJob(jobCode) {
      state.shiftFirstJobFilter = jobCode;
      renderShiftFirstView();
    }

    function renderShiftFirstDayRibbon() {
      const ribbon = document.getElementById('shiftFirstDayRibbon');
      if (!ribbon) return;

      if (!state.dates || state.dates.length === 0) {
        ribbon.innerHTML = `<span class="text-xs text-slate-400 italic">Load CSVs to populate schedule days</span>`;
        return;
      }

      const getDayOpenCount = (dayStr) => {
        return state.shifts.filter(s => {
          const isDay = dayStr === 'all' || s.workDateNorm === dayStr;
          const isJob = state.shiftFirstJobFilter === 'all' || String(s.jobNumber).trim() === state.shiftFirstJobFilter;
          return isDay && isJob && s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc);
        }).length;
      };

      const curIdx = state.dates.indexOf(state.shiftFirstSelectedDay);
      const isFirst = curIdx <= 0;
      const isLast = curIdx >= state.dates.length - 1;

      let html = `
        <button onclick="goToPrevDay()" ${isFirst ? 'disabled' : ''} class="px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${isFirst ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300'}">
          &larr; Prev Day
        </button>
      `;

      state.dates.forEach(dt => {
        const meta = getDayMeta(dt);
        const dayOpen = getDayOpenCount(dt);
        const isSelected = state.shiftFirstSelectedDay === dt;
        const btnCls = isSelected
          ? 'bg-blue-600 text-white shadow-sm font-bold ring-2 ring-blue-400/40'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-medium';

        html += `
          <button onclick="setShiftFirstDay('${dt}')" class="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all ${btnCls}">
            <span class="font-bold">${meta.shortDay}</span>
            <span class="text-[11px] opacity-90">${meta.monthDay}</span>
            <span class="px-1.5 py-0.2 rounded-full font-mono text-[10px] ${isSelected ? 'bg-blue-800 text-white' : (dayOpen > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700')} font-bold">${dayOpen}</span>
          </button>
        `;
      });

      html += `
        <button onclick="goToNextDay()" ${isLast ? 'disabled' : ''} class="px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${isLast ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300'}">
          Next Day &rarr;
        </button>
      `;

      const totalOpen = getDayOpenCount('all');
      const isAllSelected = state.shiftFirstSelectedDay === 'all';
      const allBtnCls = isAllSelected
        ? 'bg-blue-600 text-white shadow-sm font-bold ring-2 ring-blue-400/40'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-medium';

      html += `
        <button onclick="setShiftFirstDay('all')" class="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all ${allBtnCls}">
          <span>All Days</span>
          <span class="px-1.5 py-0.2 rounded-full font-mono text-[10px] ${isAllSelected ? 'bg-blue-800 text-white' : 'bg-slate-200 text-slate-700'} font-bold">${totalOpen}</span>
        </button>
      `;

      ribbon.innerHTML = html;
    }

    function setShiftFirstDay(dayStr) {
      state.shiftFirstSelectedDay = dayStr;
      renderShiftFirstDayRibbon();
      renderShiftFirstDaysContent();
    }

    function goToPrevDay() {
      if (!state.dates || state.dates.length === 0) return;
      const curIdx = state.dates.indexOf(state.shiftFirstSelectedDay);
      if (curIdx > 0) {
        setShiftFirstDay(state.dates[curIdx - 1]);
      } else if (state.shiftFirstSelectedDay === 'all') {
        setShiftFirstDay(state.dates[0]);
      }
    }

    function goToNextDay() {
      if (!state.dates || state.dates.length === 0) return;
      const curIdx = state.dates.indexOf(state.shiftFirstSelectedDay);
      if (curIdx >= 0 && curIdx < state.dates.length - 1) {
        setShiftFirstDay(state.dates[curIdx + 1]);
      } else if (state.shiftFirstSelectedDay === 'all') {
        setShiftFirstDay(state.dates[0]);
      }
    }

    function handleShiftFirstSearch(query) {
      state.shiftFirstSearch = (query || '').toLowerCase().trim();
      renderShiftFirstDaysContent();
    }

    function handleShiftFirstStatusChange(status) {
      state.shiftFirstStatusFilter = status;
      renderShiftFirstDaysContent();
    }

    function handleShiftFirstTierChange(tier) {
      state.shiftFirstTierFilter = tier;
      renderShiftFirstDaysContent();
    }

    function toggleAvoidHiredAV(checked) {
      state.avoidHiredAV = checked;
      const chkBar = document.getElementById('chkAvoidHiredAV');
      if (chkBar) chkBar.checked = checked;
      const chkModal = document.getElementById('chkAutoFillAvoidHired');
      if (chkModal) chkModal.checked = checked;

      const simStatus = document.getElementById('simAvoidHiredStatus');
      if (simStatus) {
        simStatus.textContent = checked ? 'Hired AV Blocked' : 'Fallback Allowed';
        simStatus.className = checked
          ? 'text-[10px] font-mono font-bold px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0 self-start sm:self-auto'
          : 'text-[10px] font-mono font-bold px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 self-start sm:self-auto';
      }

      renderShiftFirstDaysContent();
      if (document.getElementById('modalAutoFill') && !document.getElementById('modalAutoFill').classList.contains('hidden')) {
        runAutoFillSimulation();
      }
    }

    function handleAutoFillAvoidHiredToggle(checked) {
      toggleAvoidHiredAV(checked);
    }

    function toggleShiftHiredFallback(shiftId) {
      if (!state.shiftFirstShowHiredFallback) state.shiftFirstShowHiredFallback = {};
      state.shiftFirstShowHiredFallback[shiftId] = !state.shiftFirstShowHiredFallback[shiftId];
      renderShiftFirstDaysContent();
    }

    function handleShiftFirstSortChange(sortVal) {
      state.shiftFirstSort = sortVal;
      renderShiftFirstDaysContent();
    }

    function resetShiftFirstFilters() {
      state.shiftFirstSelectedDay = (state.dates && state.dates.length > 0) ? state.dates[0] : 'all';
      state.shiftFirstJobFilter = 'all';
      state.shiftFirstSearch = '';
      state.shiftFirstStatusFilter = 'open';
      state.shiftFirstTierFilter = 'all';
      state.shiftFirstSort = 'time';

      const sInp = document.getElementById('inputShiftFirstSearch');
      if (sInp) sInp.value = '';
      const sStat = document.getElementById('selectShiftFirstStatus');
      if (sStat) sStat.value = 'open';
      const sTier = document.getElementById('selectShiftFirstTier');
      if (sTier) sTier.value = 'all';
      const sSort = document.getElementById('selectShiftFirstSort');
      if (sSort) sSort.value = 'time';

      renderShiftFirstView();
    }

    function toggleExpandShiftCandidates(shiftId) {
      if (!state.shiftFirstExpandedShifts) state.shiftFirstExpandedShifts = {};
      state.shiftFirstExpandedShifts[shiftId] = !state.shiftFirstExpandedShifts[shiftId];
      renderShiftFirstDaysContent();
    }

    function toggleShiftConflicted(shiftId) {
      if (!state.shiftFirstShowConflicted) state.shiftFirstShowConflicted = {};
      state.shiftFirstShowConflicted[shiftId] = !state.shiftFirstShowConflicted[shiftId];
      renderShiftFirstDaysContent();
    }

    // --- SORT SHIFTS (WINTEAM ORDER & ACCURACY) ---
    function sortShifts(shiftsList, sortMode) {
      const sorted = [...shiftsList];
      if (sortMode === 'time' || !sortMode) {
        // Earliest Start Time first (0400, 0600, etc.)
        sorted.sort((a, b) => {
          if (Math.abs(a.inTimeHours - b.inTimeHours) > 0.001) {
            return a.inTimeHours - b.inTimeHours;
          }
          if (Math.abs(a.outTimeHours - b.outTimeHours) > 0.001) {
            return a.outTimeHours - b.outTimeHours;
          }
          const postA = (a.postDesc || '').toString();
          const postB = (b.postDesc || '').toString();
          const cmp = postA.localeCompare(postB, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return (a.shiftId || '').toString().localeCompare((b.shiftId || '').toString());
        });
      } else if (sortMode === 'winteam') {
        // WinTeam Standard: Date -> InTime (Start Time) -> PostDescription (Alphanumeric) -> ShiftID
        sorted.sort((a, b) => {
          const dateDiff = getDateSortValue(a.workDateNorm) - getDateSortValue(b.workDateNorm);
          if (dateDiff !== 0) return dateDiff;
          if (Math.abs(a.inTimeHours - b.inTimeHours) > 0.001) {
            return a.inTimeHours - b.inTimeHours;
          }
          const postA = (a.postDesc || '').toString();
          const postB = (b.postDesc || '').toString();
          const cmp = postA.localeCompare(postB, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return (a.shiftId || '').toString().localeCompare((b.shiftId || '').toString());
        });
      } else if (sortMode === 'post') {
        // WinTeam Post Order: PostDescription -> Start Time
        sorted.sort((a, b) => {
          const postA = (a.postDesc || '').toString();
          const postB = (b.postDesc || '').toString();
          const cmp = postA.localeCompare(postB, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return a.inTimeHours - b.inTimeHours;
        });
      } else if (sortMode === 'hours') {
        sorted.sort((a, b) => b.countedHours - a.countedHours || a.inTimeHours - b.inTimeHours);
      } else if (sortMode === 'candidates') {
        sorted.sort((a, b) => {
          const candA = getCandidateMatchesForShift(a);
          const candB = getCandidateMatchesForShift(b);
          const countA = Object.keys(candA.allMatchesMap || {}).length;
          const countB = Object.keys(candB.allMatchesMap || {}).length;
          return countA - countB || a.inTimeHours - b.inTimeHours;
        });
      }
      return sorted;
    }

    function renderShiftFirstDaysContent() {
      const container = document.getElementById('shiftFirstDaysContainer');
      if (!container) return;

      if (!state.shifts || state.shifts.length === 0) {
        container.innerHTML = `
          <div class="p-12 text-center text-slate-500 text-xs bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col items-center">
            <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div class="font-bold text-slate-900 text-base mb-1">No Shifts Data Loaded</div>
            <p class="text-xs text-slate-500 max-w-md mb-4">
              Drop or upload <strong>PPA.csv</strong>, <strong>EMP.csv</strong>, and <strong>Working Weeks CSV</strong> to start filling shifts into WinTeam immediately.
            </p>
            <button onclick="openUploadModal()" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
              <span>Load CSV Files</span>
            </button>
          </div>
        `;
        return;
      }

      const targetDates = state.shiftFirstSelectedDay === 'all'
        ? state.dates
        : [state.shiftFirstSelectedDay];

      const jobKeys = ['233265', '235144', '266778', '267588'];
      let totalVisibleShifts = 0;
      let html = '';

      targetDates.forEach(dt => {
        const meta = getDayMeta(dt);
        let dayShifts = state.shifts.filter(s => s.workDateNorm === dt);

        // Filter by Status
        if (state.shiftFirstStatusFilter === 'open') {
          dayShifts = dayShifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc));
        } else if (state.shiftFirstStatusFilter === 'assigned') {
          dayShifts = dayShifts.filter(s => !s.isOpen || s.assignedEmployee);
        }

        // Filter by Search
        if (state.shiftFirstSearch) {
          const q = state.shiftFirstSearch;
          dayShifts = dayShifts.filter(s => {
            const str = (s.postDesc + ' ' + s.jobDesc + ' ' + s.jobNumber + ' ' + s.inTime + ' ' + s.outTime + ' ' + (s.assignedEmployee ? s.assignedEmployee.name : '')).toLowerCase();
            return str.includes(q);
          });
        }

        // Filter by Job Code if selected
        if (state.shiftFirstJobFilter !== 'all') {
          dayShifts = dayShifts.filter(s => String(s.jobNumber).trim() === state.shiftFirstJobFilter);
        }

        totalVisibleShifts += dayShifts.length;
        const openInDay = dayShifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc)).length;
        const totalHoursInDay = dayShifts.reduce((acc, s) => acc + s.countedHours, 0.0);

        const curDateIdx = state.dates.indexOf(dt);
        const hasNextDay = curDateIdx >= 0 && curDateIdx < state.dates.length - 1;
        const hasPrevDay = curDateIdx > 0;
        const activeJobDef = state.shiftFirstJobFilter !== 'all' ? JOB_CODES[state.shiftFirstJobFilter] : null;
        const jobTitleLabel = activeJobDef
          ? `<span class="font-mono text-amber-300 font-bold">${activeJobDef.code}</span> &bull; ${escapeHtml(activeJobDef.shortTitle)}`
          : 'All 4 Job Codes';

        // Day Section Container
        html += `
          <div class="flex flex-col gap-3.5">
            <!-- Day Banner -->
            <div class="flex items-center justify-between bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xs">
              <div class="flex items-center gap-3">
                <span class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-extrabold text-xs uppercase tracking-wider">
                  ${meta.shortDay}
                </span>
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-bold text-sm text-white">${meta.fullLabel}</h3>
                    <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-blue-300 border border-slate-700">
                      ${jobTitleLabel}
                    </span>
                  </div>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    <strong class="text-amber-400">${openInDay} open shifts</strong> to fill &bull; ${totalHoursInDay.toFixed(1)} total hours
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                ${hasPrevDay ? `
                  <button onclick="goToPrevDay()" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors">
                    &larr; Prev Day
                  </button>
                ` : ''}
                ${hasNextDay ? `
                  <button onclick="goToNextDay()" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors">
                    Next Day &rarr;
                  </button>
                ` : ''}
                <span class="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                  ${dayShifts.length} shifts
                </span>
              </div>
            </div>
        `;

        if (dayShifts.length === 0) {
          html += `
            <div class="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
              No shifts match the current filters on this day (${meta.shortDay} - ${jobTitleLabel}).
              ${hasNextDay ? `
                <div class="mt-3">
                  <button onclick="goToNextDay()" class="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 shadow-xs transition-all">
                    Move to Next Day &rarr;
                  </button>
                </div>
              ` : ''}
            </div>
          `;
        } else {
          // If viewing All 4 Jobs, display separated sections for each Job Code!
          if (state.shiftFirstJobFilter === 'all') {
            jobKeys.forEach(jk => {
              const jDef = JOB_CODES[jk] || { code: jk, title: jk, shortTitle: jk, isBre: false, theme: 'slate' };
              const jobShifts = sortShifts(dayShifts.filter(s => String(s.jobNumber).trim() === jk), state.shiftFirstSort);
              if (jobShifts.length === 0) return;

              const jobOpen = jobShifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc)).length;
              const jobHours = jobShifts.reduce((acc, s) => acc + s.countedHours, 0.0);

              let themeBorder = 'border-blue-200 bg-blue-50/20';
              let headerBg = 'bg-blue-900 text-white';
              if (jDef.theme === 'indigo') {
                themeBorder = 'border-indigo-200 bg-indigo-50/20';
                headerBg = 'bg-indigo-900 text-white';
              } else if (jDef.theme === 'emerald') {
                themeBorder = 'border-emerald-200 bg-emerald-50/20';
                headerBg = 'bg-emerald-950 text-white';
              } else if (jDef.theme === 'amber') {
                themeBorder = 'border-amber-200 bg-amber-50/20';
                headerBg = 'bg-amber-950 text-white';
              }

              html += `
                <div class="rounded-xl border ${themeBorder} overflow-hidden shadow-2xs">
                  <!-- Job Code Subheader -->
                  <div class="${headerBg} px-3.5 py-2 flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-black tracking-wide px-2 py-0.5 rounded bg-black/30">${jk}</span>
                      <span class="font-bold text-xs">${escapeHtml(jDef.title)}</span>
                      <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${jDef.isBre ? 'bg-amber-400 text-slate-950' : 'bg-blue-400 text-slate-950'}">
                        ${jDef.isBre ? 'Break Relief Extra (BRE)' : 'Core Posts'}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 text-[11px]">
                      <span class="font-mono text-amber-300 font-bold">${jobOpen} open</span>
                      <span class="text-slate-400">&bull;</span>
                      <span class="font-mono text-slate-300">${jobHours.toFixed(1)} hrs</span>
                      <button onclick="setShiftFirstJob('${jk}')" class="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-white/20 hover:bg-white/30 text-white transition-colors">
                        Focus Job &rarr;
                      </button>
                    </div>
                  </div>
                  <!-- Shifts List -->
                  <div class="p-3 grid grid-cols-1 gap-3 bg-white">
              `;
              jobShifts.forEach(shift => {
                html += renderShiftCard(shift);
              });
              html += `</div></div>`;
            });
          } else {
            // A specific Job Code is isolated
            const sortedShifts = sortShifts(dayShifts, state.shiftFirstSort);
            html += `<div class="grid grid-cols-1 gap-3">`;
            sortedShifts.forEach(shift => {
              html += renderShiftCard(shift);
            });
            html += `</div>`;
          }
        }

        html += `</div>`; // Close day section
      });

      if (totalVisibleShifts === 0) {
        html = `
          <div class="p-12 text-center text-slate-500 text-xs bg-white rounded-xl border border-slate-200">
            No shifts match the current search, day, or job code filter.
            <div class="mt-2">
              <button onclick="resetShiftFirstFilters()" class="text-blue-600 font-bold underline">Reset Filters</button>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;
    }

    function copyEID(eid, evt) {
      if (evt) evt.stopPropagation();
      copyToClipboard(eid, `Copied EID ${eid} to clipboard!`);
    }

    function copyWinTeamShiftLine(shiftId, evt) {
      if (evt) evt.stopPropagation();
      const shift = state.shifts.find(s => s.id === shiftId);
      if (!shift) return;
      const emp = shift.assignedEmployee;
      const text = `${shift.jobNumber}\t${shift.workDateNorm}\t${shift.postDesc}\t${shift.inTime}-${shift.outTime}\t${emp ? emp.eid : ''}\t${emp ? emp.name : 'Open'}\t${emp ? (emp.notes || 'None').replace(/\r?\n/g, ' ') : ''}`;
      copyToClipboard(text, `Copied WinTeam shift line to clipboard!`);
    }

    function renderShiftCard(shift) {
      const isAssigned = !shift.isOpen || shift.assignedEmployee !== null;
      const assignedEmp = shift.assignedEmployee;
      const matches = getCandidateMatchesForShift(shift) || {};
      const tier1 = matches.tier1 || [];
      const tier2 = matches.tier2 || [];
      const tier3 = matches.tier3 || [];
      const tierNotes = matches.tierNotes || [];
      const conflicted = matches.conflicted || [];
      const p1 = matches.p1 || tier1.filter(c => c.currentH < 20.0);
      const p2 = matches.p2 || tier1.filter(c => c.currentH >= 20.0);
      const p3 = matches.p3 || tier2.filter(c => c.currentH < 20.0);
      const p4 = matches.p4 || tier2.filter(c => c.currentH >= 20.0);
      const p5 = matches.p5 || tier3.filter(c => c.currentH < 20.0);
      const p6 = matches.p6 || tier3.filter(c => c.currentH >= 20.0);

      // Filter candidates based on tier filter and avoidHiredAV setting
      let candidates = [];
      const avoidHired = state.avoidHiredAV;

      if (state.shiftFirstTierFilter === 'tier1') {
        candidates = [...tier1];
      } else if (state.shiftFirstTierFilter === 'tier2') {
        candidates = [...tier2];
      } else if (state.shiftFirstTierFilter === 'under20') {
        candidates = avoidHired
          ? [...p1, ...p3]
          : [...p1, ...p3, ...p5];
      } else if (state.shiftFirstTierFilter === 'under45') {
        const pool = avoidHired ? [...tier1, ...tier2] : [...tier1, ...tier2, ...tier3];
        candidates = pool.filter(c => !c.willOvertime);
      } else if (state.shiftFirstTierFilter === 'avoidHired') {
        candidates = [...tier1, ...tier2];
      } else if (state.shiftFirstTierFilter === 'notes') {
        candidates = [...tierNotes];
      } else if (state.shiftFirstTierFilter === 'clean') {
        const pool = avoidHired ? [...tier1, ...tier2] : [...tier1, ...tier2, ...tier3];
        candidates = pool.filter(c => !c.hasNotes);
      } else {
        candidates = avoidHired ? [...tier1, ...tier2] : [...tier1, ...tier2, ...tier3];
      }

      // Sort candidates by priority hierarchy
      candidates.sort((a, b) => {
        const otA = a.willOvertime ? 1 : 0;
        const otB = b.willOvertime ? 1 : 0;
        if (otA !== otB) return otA - otB;
        if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
        if (Math.abs(a.currentH - b.currentH) > 0.01) return a.currentH - b.currentH;
        return a.emp.name.localeCompare(b.emp.name);
      });

      // Safe lookup for expanded/conflicted/hired fallback states
      const isExpanded = !!(state.shiftFirstExpandedShifts && state.shiftFirstExpandedShifts[shift.id]);
      const showConflicted = !!(state.shiftFirstShowConflicted && state.shiftFirstShowConflicted[shift.id]);
      const showHiredFallback = !!(state.shiftFirstShowHiredFallback && state.shiftFirstShowHiredFallback[shift.id]);
      const displayCandidates = isExpanded ? candidates : candidates.slice(0, 3);
      const remainingCandidatesCount = candidates.length - 3;

      const borderClass = isAssigned
        ? 'border-emerald-300 bg-white ring-1 ring-emerald-500/30'
        : 'border-slate-200 bg-white hover:border-slate-300';

      const jDef = JOB_CODES[shift.jobNumber] || { code: shift.jobNumber, title: shift.jobDesc, isBre: isBreShift(shift) };

      let statusBadgeHtml = '';
      if (isAssigned) {
        statusBadgeHtml = `
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
              <span>Assigned: <strong>${escapeHtml(assignedEmp.name)}</strong> (${shift.assignedTier || 'Assigned'})</span>
            </span>
            <button onclick="copyEID('${assignedEmp.eid}', event)" class="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-mono font-bold flex items-center gap-1">
              📋 Copy EID: ${assignedEmp.eid}
            </button>
            <button onclick="unassignShift('${shift.id}')" class="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold transition-colors">
              Undo
            </button>
          </div>
        `;
      } else {
        statusBadgeHtml = `
          <span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>Open WinTeam Shift &bull; Needs Officer</span>
          </span>
        `;
      }

      let bodyHtml = '';

      if (isAssigned) {
        bodyHtml = `
          <div class="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                ✓
              </div>
              <div>
                <div class="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span>${escapeHtml(assignedEmp.name)}</span>
                  <span class="text-slate-600 font-mono text-xs">#${assignedEmp.eid}</span>
                  <button onclick="copyEID('${assignedEmp.eid}', event)" class="text-[10px] text-blue-600 hover:underline font-bold font-sans">Copy EID</button>
                </div>
                <div class="text-[11px] text-emerald-800 mt-0.5">
                  WinTeam Hours: <strong class="font-mono">${assignedEmp.actualHours.toFixed(2)} hrs</strong> &bull; Target &lt;45.0h &bull; Phone: ${escapeHtml(assignedEmp.phone || 'N/A')}
                </div>
                <!-- ALWAYS VISIBLE WW NOTES ON ASSIGNED SHIFT -->
                <div class="mt-1.5 text-[11px] ${assignedEmp.notes ? 'bg-amber-100 text-amber-950 font-bold border border-amber-300 shadow-2xs' : 'bg-emerald-100/60 text-emerald-800 border border-emerald-200'} px-2.5 py-1 rounded-md flex items-start gap-1.5">
                  <span class="text-amber-800 font-black shrink-0">📝 WW Notes:</span>
                  <span>${escapeHtml(assignedEmp.notes || 'None')}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="copyWinTeamShiftLine('${shift.id}', event)" class="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-xs flex items-center gap-1">
                📋 Copy WT Line
              </button>
              <button onclick="openOfficerDetailModal('${assignedEmp.eid}')" class="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-xs flex items-center gap-1">
                Profile
              </button>
              <button onclick="unassignShift('${shift.id}')" class="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-sm">
                Change
              </button>
            </div>
          </div>
        `;
      } else {
        if (candidates.length === 0) {
          bodyHtml = `
            <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center text-xs text-slate-500">
              No available officers match this shift's window without conflict or exceeding 45.0 hours.
              ${conflicted.length > 0 ? `
                <button onclick="toggleShiftConflicted('${shift.id}')" class="text-blue-600 font-bold underline ml-1">
                  ${showConflicted ? 'Hide conflicted officers' : `View ${conflicted.length} unavailable/conflicted officers`}
                </button>
              ` : ''}
            </div>
          `;
        } else {
          bodyHtml = `
            <div>
              <div class="flex items-center justify-between mb-2 flex-wrap gap-1">
                <div class="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 flex-wrap">
                  <span>Available Specialists Ranked by Priority & Headroom</span>
                  <span class="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-mono text-[10px] font-extrabold">${candidates.length}</span>
                  <span class="text-[10.5px] text-slate-500 font-normal">
                    (${p1.length} 1st &lt;20h &bull; ${p2.length} 1st &ge;20h &bull; ${p3.length} 2nd &lt;20h &bull; ${p4.length} 2nd &ge;20h${tier3.length > 0 ? (avoidHired ? ` &bull; <span class="text-slate-400 font-normal">${tier3.length} Hired AV avoided</span>` : ` &bull; ${tier3.length} Hired AV`) : ''})
                  </span>
                </div>
                ${conflicted.length > 0 ? `
                  <button onclick="toggleShiftConflicted('${shift.id}')" class="text-[11px] text-slate-500 hover:text-slate-800 underline font-medium">
                    ${showConflicted ? 'Hide conflicted officers' : `${conflicted.length} unavailable officers`}
                  </button>
                ` : ''}
              </div>

              <!-- Top Candidate Cards -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          `;

          displayCandidates.forEach(cand => {
            const emp = cand.emp;
            const willOvertime = cand.willOvertime;
            const currentH = (cand.currentH !== undefined) ? cand.currentH : (emp.actualHours || 0.0);
            const projectedH = (cand.projectedH !== undefined) ? cand.projectedH : (currentH + shift.countedHours);
            const effLimit = (cand.effectiveLimit !== undefined) ? cand.effectiveLimit : ((cand.effLimit !== undefined) ? cand.effLimit : getEmployeeEffectiveLimit(emp));
            const tierLabel = cand.tierLabel || cand.tier || 'Matched';

            let tierCls = 'bg-blue-50 text-blue-800 border-blue-200';
            if (cand.priorityRank === 1) tierCls = 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold';
            else if (cand.priorityRank === 2) tierCls = 'bg-blue-50 text-blue-800 border-blue-300 font-bold';
            else if (cand.priorityRank === 3) tierCls = 'bg-amber-50 text-amber-800 border-amber-300 font-bold';
            else if (cand.priorityRank === 4) tierCls = 'bg-orange-50 text-orange-800 border-orange-300 font-semibold';
            else if (cand.priorityRank === 99) tierCls = 'bg-slate-100 text-slate-700 border-slate-300 font-bold';
            else tierCls = 'bg-slate-100 text-slate-700 border-slate-300 italic';

            let hourBadgeCls = 'bg-slate-100 text-slate-700';
            if (projectedH <= 40.0) hourBadgeCls = 'bg-emerald-100 text-emerald-800 font-bold';
            else if (projectedH <= 45.0) hourBadgeCls = 'bg-amber-100 text-amber-800 font-bold';
            else if (projectedH <= effLimit) hourBadgeCls = 'bg-purple-100 text-purple-900 border border-purple-300 font-black';
            else hourBadgeCls = 'bg-rose-100 text-rose-800 font-bold';

            const otBadge = cand.isOvertime
              ? (projectedH > 45.0
                  ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-purple-100 text-purple-950 border border-purple-400">⚡ OT (>45h): ${(cand.otReasons || []).join(', ')}</span>`
                  : `<span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300">⚡ OT: ${(cand.otReasons || []).join(', ')}</span>`)
              : (cand.isBillableOT
                  ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300" title="Through-and-through SOR shift >8h is contracted billable OT (always OK)">Billable OT (${shift.countedHours.toFixed(1)}h)</span>`
                  : '<span class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">No OT</span>');

            bodyHtml += `
              <div class="p-2.5 rounded-lg border ${cand.isOvertime ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200 bg-slate-50/70'} hover:bg-white hover:border-blue-400 hover:shadow-xs transition-all flex flex-col justify-between text-xs gap-2">
                <div>
                  <div class="flex items-center justify-between gap-1 mb-1 flex-wrap">
                    <span class="px-1.5 py-0.5 rounded text-[9.5px] border ${tierCls}">
                      ${tierLabel}
                    </span>
                    ${otBadge}
                    <button onclick="copyEID('${emp.eid}', event)" class="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-mono text-[10px] font-bold flex items-center gap-1" title="Click to copy EID for WinTeam">
                      📋 ${emp.eid}
                    </button>
                  </div>
                  <div class="font-bold text-slate-900 truncate flex items-center justify-between" title="${escapeHtml(emp.name)}">
                    <span>${escapeHtml(emp.name)}</span>
                    <button onclick="openOfficerDetailModal('${emp.eid}')" class="text-slate-400 hover:text-blue-600 text-[10px] font-mono">Profile &rarr;</button>
                  </div>
                  <!-- ALWAYS VISIBLE WW NOTES -->
                  <div class="mt-1 text-[11px] ${emp.notes ? 'bg-amber-100 text-amber-950 font-semibold border border-amber-300 shadow-2xs' : 'bg-slate-50 text-slate-500 font-normal border border-slate-200'} px-2 py-1 rounded flex items-start gap-1 leading-snug break-words" title="${escapeHtml(emp.notes || 'No notes in Working Weeks')}">
                    <span class="font-extrabold ${emp.notes ? 'text-amber-800' : 'text-slate-400'} shrink-0">📝 WW:</span>
                    <span class="break-words font-sans">${escapeHtml(emp.notes || 'None')}</span>
                  </div>
                  <div class="text-[11px] text-slate-500 font-mono mt-1">
                    ${currentH.toFixed(1)}h &rarr; <strong class="${hourBadgeCls} px-1 rounded">${projectedH.toFixed(1)}h</strong> <span class="text-[10px] text-slate-400">/ ${effLimit.toFixed(1)}h</span>
                    ${cand.dailyCap ? `<span class="text-[9.5px] text-slate-400 ml-1">(Day: ${cand.projectedDayHours.toFixed(1)}/${cand.dailyCap}h)</span>` : ''}
                  </div>
                  ${cand.restBufferLabel ? `
                    <div class="text-[10px] text-emerald-700 mt-1 flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      ${cand.restBufferLabel}
                    </div>
                  ` : ''}
                </div>
                <div class="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                  <button onclick="assignCandidate('${shift.id}', '${emp.eid}', '${tierLabel}')"
                    class="w-full py-1.5 rounded-md ${cand.isOvertime ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'} font-bold text-xs shadow-2xs transition-all flex items-center justify-center gap-1">
                    <span>${cand.isOvertime ? 'Assign (Approved OT)' : 'Assign Shift'}</span>
                    <span class="text-[10px] opacity-80">&bull; Copies EID</span>
                  </button>
                </div>
              </div>
            `;
          });

          bodyHtml += `</div>`; // Close grid

          if (candidates.length > 3) {
            bodyHtml += `
              <div class="mt-2 text-center">
                <button onclick="toggleExpandShiftCandidates('${shift.id}')" class="text-xs text-blue-600 hover:text-blue-800 font-semibold underline">
                  ${isExpanded ? 'Collapse Candidate List' : `View all ${candidates.length} matching specialists (+${remainingCandidatesCount} more)`}
                </button>
              </div>
            `;
          }

          bodyHtml += `</div>`; // Close outer container from line 4070
        }
      }

      let conflictedHtml = '';
      if (showConflicted && conflicted.length > 0) {
        conflictedHtml = `
          <div class="mt-3 p-3 bg-rose-50/60 border border-rose-200 rounded-lg text-xs">
            <div class="font-bold text-rose-900 mb-1.5 flex items-center justify-between">
              <span>Disqualified / Conflicted Specialists (${conflicted.length})</span>
              <button onclick="toggleShiftConflicted('${shift.id}')" class="text-[11px] text-rose-700 underline font-medium">Close</button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
        `;
        conflicted.forEach(c => {
          let approveBtn = '';
          if (c.canQuickApprove === 'sixthDay') {
            approveBtn = `<button onclick="quickGrantOTApproval('${c.emp.eid}', 'sixthDay', '${shift.id}')" class="mt-1 px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold border border-amber-300 flex items-center gap-1" title="Authorize 6th Day Overtime Company-Wide">+ Authorize 6th Day OT (Company-Wide)</button>`;
          } else if (c.canQuickApprove === 'seventhDay') {
            approveBtn = `<button onclick="quickGrantOTApproval('${c.emp.eid}', 'seventhDay', '${shift.id}')" class="mt-1 px-1.5 py-0.5 rounded bg-purple-100 hover:bg-purple-200 text-purple-900 text-[10px] font-bold border border-purple-300 flex items-center gap-1" title="Authorize 7th Day Overtime Company-Wide">+ Authorize 7th Day OT (Company-Wide)</button>`;
          } else if (c.canQuickApprove === 'dailyCap12') {
            approveBtn = `<button onclick="quickGrantOTApproval('${c.emp.eid}', 'dailyCap12', '${shift.id}')" class="mt-1 px-1.5 py-0.5 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-900 text-[10px] font-bold border border-indigo-300 flex items-center gap-1" title="Authorize 12h Daily Cap Company-Wide">+ Authorize 12h Cap (Company-Wide)</button>`;
          } else if (c.canQuickApprove === 'dailyCap16') {
            approveBtn = `<button onclick="quickGrantOTApproval('${c.emp.eid}', 'dailyCap16', '${shift.id}')" class="mt-1 px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-900 text-[10px] font-bold border border-rose-300 flex items-center gap-1" title="Authorize 16h Daily Cap Company-Wide">+ Authorize 16h Cap (Company-Wide)</button>`;
          }

          conflictedHtml += `
            <div class="p-1.5 bg-white rounded border border-rose-200 text-[11px]">
              <div class="font-bold text-slate-800 truncate">${escapeHtml(c.emp.name)} <span class="font-mono text-slate-400 text-[10px]">#${c.emp.eid}</span></div>
              <div class="text-rose-700 text-[10px] font-semibold mt-0.5">${escapeHtml(c.reason)}</div>
              ${approveBtn}
              ${c.emp.notes ? `
                <div class="mt-1 text-[10.5px] bg-amber-50 text-amber-950 border border-amber-200 rounded px-1.5 py-0.5 break-words">
                  <span class="font-bold text-amber-800">📝 Notes:</span> ${escapeHtml(c.emp.notes)}
                </div>
              ` : ''}
            </div>
          `;
        });
        conflictedHtml += `</div></div>`;
      }

      return `
        <div class="rounded-xl border ${borderClass} shadow-2xs p-4 flex flex-col gap-3 transition-all" id="card_${shift.id}">
          <!-- Top Row: Shift Identification & Times -->
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div class="flex items-center gap-2.5 flex-wrap">
              <span class="font-mono text-xs font-black px-2 py-0.5 rounded bg-slate-900 text-white">
                ${shift.jobNumber}
              </span>
              <span class="font-extrabold text-sm text-slate-950 font-mono">
                Post: ${escapeHtml(shift.postDesc || 'General Post')}
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${jDef.isBre ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-100 text-blue-800 border border-blue-200'}">
                ${jDef.isBre ? 'BRE (Break Relief)' : 'Core Post'}
              </span>
              <span class="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                ${shift.inTime} - ${shift.outTime} (${shift.countedHours.toFixed(2)}h)
              </span>
              <span class="text-[10px] font-mono text-slate-400">
                Shift: ${shift.shiftId || '1A'} &bull; DetailID: ${shift.scheduleDetailsId || shift.jobPostDetailId || 'N/A'}
              </span>
            </div>
            <div>
              ${statusBadgeHtml}
            </div>
          </div>

          <!-- Body: Candidates or Assigned Details -->
          <div>
            ${bodyHtml}
            ${conflictedHtml}
          </div>
        </div>
      `;
    }

    function openOfficerDetailModal(eid) {
      const emp = state.employees.find(e => e.eid === eid);
      if (!emp) return;

      const modal = document.getElementById('modalOfficerDetail');
      document.getElementById('officerDetailName').textContent = emp.name;
      const ptftElem = document.getElementById('officerDetailPTFTBadge');
      if (ptftElem) {
        ptftElem.textContent = emp.ptft === 'FT' ? 'Full-Time (FT)' : emp.ptft === 'PT' ? 'Part-Time (PT)' : (emp.ptft || 'Full-Time');
      }
      document.getElementById('officerDetailSubtitle').textContent = `Employee ID #${emp.eid} • Working Weeks Sheet Row #${emp.wwIndex}`;
      document.getElementById('officerDetailActualHours').textContent = `${emp.actualHours.toFixed(2)} hrs`;
      document.getElementById('officerDetailSheetHours').textContent = `${emp.sheetHours.toFixed(2)} hrs`;

      const delta = emp.actualHours - emp.sheetHours;
      const deltaElem = document.getElementById('officerDetailDelta');
      deltaElem.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} hrs`;
      deltaElem.className = `text-xl font-mono font-extrabold ${delta > 0.01 ? 'text-emerald-600' : delta < -0.01 ? 'text-rose-600' : 'text-slate-600'}`;

      const remaining = 45.0 - emp.actualHours;
      const remElem = document.getElementById('officerDetailRemaining');
      remElem.textContent = remaining >= 0 ? `${remaining.toFixed(1)}h left` : `OT: +${Math.abs(remaining).toFixed(1)}h`;
      remElem.className = `text-xl font-mono font-extrabold ${remaining >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;

      // Populate Overtime & Daily Cap Approvals
      const ot = getEmployeeOTApprovals(eid);
      const chk6 = document.getElementById('chkOfficer6thDay');
      const chk7 = document.getElementById('chkOfficer7thDay');
      const radCaps = document.getElementsByName('radOfficerDailyCap');
      const numWk = document.getElementById('numOfficerWeeklyCap');
      const txtNote = document.getElementById('txtOfficerOTNote');
      const badgeStatus = document.getElementById('officerDetailOTStatusBadge');
      const daysNotice = document.getElementById('officerDetailDaysScheduledNotice');

      if (chk6) chk6.checked = ot.sixthDay;
      if (chk7) chk7.checked = ot.seventhDay;
      if (radCaps) {
        for (const r of radCaps) {
          r.checked = (parseInt(r.value, 10) === ot.dailyCap);
        }
      }
      if (numWk) numWk.value = ot.weeklyCap || 45.0;
      if (txtNote) txtNote.value = ot.notes || '';

      const empDays = (state.empWorkingDates && state.empWorkingDates[eid]) ? state.empWorkingDates[eid].size : 0;
      if (daysNotice) {
        daysNotice.textContent = `Currently scheduled for ${empDays} calendar ${empDays === 1 ? 'day' : 'days'} this week (standard max 5 days)`;
      }

      if (badgeStatus) {
        if (ot.hasAny) {
          const tags = [];
          if (ot.sixthDay) tags.push('6th Day');
          if (ot.seventhDay) tags.push('7th Day');
          if (ot.dailyCap > 8) tags.push(`${ot.dailyCap}h Cap`);
          if (ot.weeklyCap > 40.0) tags.push(`${ot.weeklyCap}h Wk`);
          badgeStatus.textContent = `Company Policy: ${tags.join(', ')} Authorized`;
          badgeStatus.className = 'px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300';
        } else {
          badgeStatus.textContent = 'Company Policy: Standard (No OT Authorized)';
          badgeStatus.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-white text-slate-600 border border-slate-200';
        }
      }
      modal.setAttribute('data-active-eid', eid);

      // Populate Meta Strip: Phone, Email, Target Limit, Tags, and Working Weeks Notes
      const metaStrip = document.getElementById('officerDetailMetaStrip');
      if (metaStrip) {
        const tagsHtml = (emp.tags && emp.tags.length > 0)
          ? `<div class="flex items-center gap-1.5 flex-wrap">${emp.tags.map(t => `<span class="px-2 py-0.5 rounded text-[10px] font-bold border ${t.cls}">${t.text}</span>`).join('')}</div>`
          : '';

        const notesHtml = (emp.notes && emp.notes.trim())
          ? `
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5 text-amber-900 mt-1">
              <svg class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              <div>
                <div class="text-[10px] uppercase font-bold text-amber-800 tracking-wider">Working Weeks Officer Notes:</div>
                <div class="text-xs font-semibold text-amber-950 mt-0.5 whitespace-pre-line">${escapeHtml(emp.notes)}</div>
                <div class="text-[9.5px] text-amber-700/80 mt-1">[Source: Working Weeks Reference Sheet]</div>
              </div>
            </div>
          `
          : `<div class="text-[11px] text-slate-400 italic">No operational notes recorded on the Working Weeks sheet for this officer.</div>`;

        metaStrip.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <div class="flex items-center gap-3 flex-wrap">
              <span class="flex items-center gap-1 text-slate-600">
                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                <span class="text-slate-500 font-medium">Phone:</span>
                <strong class="font-mono text-slate-800">${escapeHtml(emp.phone || 'N/A')}</strong>
              </span>
              <span class="text-slate-300">&bull;</span>
              <span class="flex items-center gap-1 text-slate-600">
                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                <span class="text-slate-500 font-medium">Email:</span>
                <span class="text-slate-700">${escapeHtml(emp.email || 'N/A')}</span>
              </span>
              <span class="text-slate-300">&bull;</span>
              <span class="text-slate-500 font-medium">
                Target Cap: <strong class="font-mono text-slate-800">${emp.limit ? emp.limit.toFixed(1) + ' hrs' : '45.0 hrs'}</strong>
              </span>
            </div>
            ${tagsHtml}
          </div>
          ${isEmployeeBottom75(emp) ? `
            <div class="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2.5 text-rose-900 mt-2">
              <svg class="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <div>
                <div class="text-[10px] uppercase font-bold text-rose-800 tracking-wider">Working Weeks Seniority Notice:</div>
                <div class="text-xs font-semibold text-rose-950 mt-0.5">Bottom 75 in Working Weeks (Row #${emp.wwIndex}) &mdash; Ineligible to work BRE shifts (Anything under JC 235144 or 267588).</div>
              </div>
            </div>
          ` : ''}
          ${notesHtml}
        `;
      }

      // Populate Daily Availability (1st Choice, 2nd Choice, Hired Availability) & Day Shifts for all 7 Days
      const dailyContainer = document.getElementById('officerDetailDailyList');
      if (dailyContainer) {
        let dailyHtml = '';
        state.dates.forEach(dt => {
          const meta = getDayMeta(dt);
          const dInfo = (emp.daily && emp.daily[dt]) ? emp.daily[dt] : { p1: '', p2: '', hired: '', wwReferenceWT: '' };
          const wwMark = dInfo.wwReferenceWT || dInfo.wt || '';
          const dayShifts = (state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][dt]) || [];
          const totalDayHours = dayShifts.reduce((acc, s) => acc + (s.countedHours || 0), 0);
          const isScheduledInWinTeam = dayShifts.length > 0;

          const hasP1 = Boolean(dInfo.p1 && dInfo.p1.trim());
          const hasP2 = Boolean(dInfo.p2 && dInfo.p2.trim());
          const hasHired = Boolean(dInfo.hired && dInfo.hired.trim());

          let alignmentStatusHtml = '';
          if (isScheduledInWinTeam && wwMark === '1') {
            alignmentStatusHtml = '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded">Aligned (Scheduled in WinTeam &bull; WW marked 1)</span>';
          } else if (isScheduledInWinTeam && wwMark !== '1') {
            alignmentStatusHtml = '<span class="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">Variance (Scheduled in WinTeam Law &bull; WW Sheet Blank)</span>';
          } else if (!isScheduledInWinTeam && wwMark === '1') {
            alignmentStatusHtml = '<span class="text-[10px] font-bold text-rose-800 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded">Variance (WW Sheet marked 1 &bull; Dictated by WinTeam as Off)</span>';
          } else {
            alignmentStatusHtml = '<span class="text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">Aligned (Off in WinTeam &bull; WW unmarked)</span>';
          }

          dailyHtml += `
            <div class="p-3 bg-white border border-slate-200 rounded-xl flex flex-col gap-2.5 shadow-2xs">
              <div class="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-slate-900 text-xs">${meta.fullLabel}</span>
                  ${isScheduledInWinTeam
              ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">Scheduled in WinTeam (Law)</span>'
              : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Off in WinTeam (Law)</span>'}
                  ${alignmentStatusHtml}
                </div>
                <div class="text-xs font-mono font-bold">
                  ${dayShifts.length > 0 ? `<span class="text-emerald-700">${totalDayHours.toFixed(2)} hrs scheduled [WinTeam Law]</span>` : '<span class="text-slate-400">0.0 hrs scheduled</span>'}
                </div>
              </div>

              <!-- Two Column Breakdown: WinTeam Law vs Working Weeks Reference -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                
                <!-- Left: Authoritative WinTeam Schedule Status (Law) -->
                <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                  <div class="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                    <span>1. WinTeam Schedule Status</span>
                    <span class="text-[9px] text-emerald-700 font-extrabold">[Authoritative Law]</span>
                  </div>
                  ${dayShifts.length > 0 ? `
                    <div class="flex flex-col gap-1.5 mt-1">
                      ${dayShifts.map(s => `
                        <div class="p-2 rounded bg-white border border-emerald-200 shadow-2xs">
                          <div class="font-bold text-slate-900 flex items-center justify-between">
                            <span>${s.inTime} - ${s.outTime}</span>
                            <span class="font-mono text-emerald-700 font-black">${s.countedHours.toFixed(1)} hrs</span>
                          </div>
                          <div class="text-[10.5px] text-slate-700 font-medium truncate mt-0.5" title="${escapeHtml(s.postDesc || s.jobDesc)}">
                            Post: ${escapeHtml(s.postDesc || s.jobDesc || 'Standard')}
                          </div>
                          <div class="text-[9.5px] text-slate-500 font-mono mt-0.5">
                            Shift ID: ${s.shiftId || '1A'} &bull; Job #${s.jobNumber || '233265'} ${s.scheduleDetailsId ? '&bull; Schedule Details ID: ' + s.scheduleDetailsId : ''}
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <div class="text-slate-400 text-xs italic py-2">
                      No shift scheduled in WinTeam report on this date. Officer is Off.
                    </div>
                  `}
                </div>

                <!-- Right: Working Weeks Availability Preferences (Reference) -->
                <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                  <div class="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                    <span>2. Working Weeks Preferences</span>
                    <span class="text-[9px] text-blue-700 font-bold">[Reference Sheet]</span>
                  </div>

                  <div class="flex flex-col gap-1 text-[11px] mt-1">
                    <div class="p-1.5 rounded ${hasP1 ? 'bg-blue-50/80 border border-blue-200' : 'bg-white border border-slate-100'}">
                      <span class="font-bold ${hasP1 ? 'text-blue-800' : 'text-slate-500'}">1st Choice Preference:</span>
                      <span class="font-mono ml-1 ${hasP1 ? 'text-blue-900 font-semibold' : 'text-slate-400 italic'}">${hasP1 ? escapeHtml(dInfo.p1) : 'Not Specified'}</span>
                    </div>

                    <div class="p-1.5 rounded ${hasP2 ? 'bg-amber-50/80 border border-amber-200' : 'bg-white border border-slate-100'}">
                      <span class="font-bold ${hasP2 ? 'text-amber-800' : 'text-slate-500'}">2nd Choice Preference:</span>
                      <span class="font-mono ml-1 ${hasP2 ? 'text-amber-900 font-semibold' : 'text-slate-400 italic'}">${hasP2 ? escapeHtml(dInfo.p2) : 'Not Specified'}</span>
                    </div>

                    <div class="p-1.5 rounded ${hasHired ? 'bg-indigo-50/80 border border-indigo-200' : 'bg-white border border-slate-100'}">
                      <span class="font-bold ${hasHired ? 'text-indigo-800' : 'text-slate-500'}">Hired Availability Window:</span>
                      <span class="font-mono ml-1 ${hasHired ? 'text-indigo-900 font-semibold' : 'text-slate-400 italic'}">${hasHired ? escapeHtml(dInfo.hired) : 'Not Specified'}</span>
                    </div>

                    <div class="text-[10px] text-slate-500 mt-1">
                      Working Weeks Sheet Note on WT: <strong>${wwMark === '1' ? 'Marked "1"' : 'Blank'}</strong>
                      ${!isScheduledInWinTeam && wwMark === '1' ? ' &bull; <span class="text-rose-600 font-semibold">Overridden: WinTeam has no shift (Off)</span>' : ''}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          `;
        });
        dailyContainer.innerHTML = dailyHtml;
      }

      // Populate Weekly Scheduled Shifts Summary List
      const shiftContainer = document.getElementById('officerDetailShiftsList');
      if (shiftContainer) {
        const allEmpShifts = getEmployeeAllScheduledShifts(eid);
        if (allEmpShifts.length === 0) {
          shiftContainer.innerHTML = '<div class="text-slate-400 italic p-3 text-center bg-slate-50 rounded-lg border border-slate-200">No shifts scheduled in WinTeam report for this week.</div>';
        } else {
          shiftContainer.innerHTML = allEmpShifts.map(s => `
            <div class="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between text-xs shadow-2xs">
              <div class="flex items-center gap-3">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <div>
                  <div class="font-bold text-slate-900">${s.workDateNorm} &bull; ${s.inTime} - ${s.outTime} (${s.countedHours.toFixed(1)} hrs)</div>
                  <div class="text-slate-500 text-[11px] font-sans mt-0.5">Post: ${escapeHtml(s.postDesc || s.jobDesc || 'Standard')} &bull; Job #${s.jobNumber || '233265'} &bull; Shift #${s.shiftId || '1A'}</div>
                </div>
              </div>
              <div class="text-right">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">WinTeam Law</span>
              </div>
            </div>
          `).join('');
        }
      }

      modal.classList.remove('hidden');
    }

    function closeOfficerDetailModal() {
      document.getElementById('modalOfficerDetail').classList.add('hidden');
    }

    // --- SMART AUTO-FILL ENGINE (Strict 45h & Non-Billable OT Rules) ---
    function openAutoFillModal() {
      const chkP = document.getElementById('chkAutoFillPrioritizeNonOT');
      if (chkP) chkP.checked = (state.autoFillPrioritizeNonOT !== false);
      const chkOT = document.getElementById('chkAutoFillAllowApprovedOT');
      if (chkOT) chkOT.checked = (state.autoFillAllowApprovedOT !== false);
      const chkOver45 = document.getElementById('chkAutoFillAllowOver45OT');
      if (chkOver45) chkOver45.checked = (state.autoFillAllowOver45OT !== false);
      document.getElementById('modalAutoFill').classList.remove('hidden');
      runAutoFillSimulation();
    }

    function closeAutoFillModal() {
      document.getElementById('modalAutoFill').classList.add('hidden');
    }

    function runAutoFillSimulation() {
      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc));

      const simWorkingShifts = {};
      const simHours = {};
      state.employees.forEach(emp => {
        simWorkingShifts[emp.eid] = {};
        state.dates.forEach(dt => {
          simWorkingShifts[emp.eid][dt] = (state.empDayWorkingShifts && state.empDayWorkingShifts[emp.eid] && state.empDayWorkingShifts[emp.eid][dt])
            ? [...state.empDayWorkingShifts[emp.eid][dt]]
            : [];
        });
        simHours[emp.eid] = emp.actualHours || 0.0;
      });

      const proposed = [];

      openShifts.forEach(shift => {
        const dt = shift.workDateNorm;
        const inT = shift.inTimeHours;
        const shHours = shift.countedHours;
        const shiftPost = (shift.postDesc || shift.jobPostDetailId || '').trim();

        // Buckets for Regular (Non-OT) Candidates (<=40h weekly, <=5 days, <=8h daily)
        const p1 = [], p2 = [], p3 = [], p4 = [], p5 = [], p6 = [];

        // Buckets for Approved Overtime (OT) Candidates with projected weekly hours <= 45.0h
        const otP1 = [], otP2 = [], otP3 = [], otP4 = [], otP5 = [], otP6 = [];

        // Buckets for Approved Overtime Candidates with projected weekly hours BEYOND 45.0h (>45.0h)
        // Rule: "If there is an overtime approval, the smart filler is allowed to give SPs hours beyond hour 45 in the week, just so long as it is not possible to give it to an SP with less"
        const otOver45_P1 = [], otOver45_P2 = [], otOver45_P3 = [];

        state.employees.forEach(emp => {
          const eid = emp.eid;
          if (state.wwEmployeeEids && !state.wwEmployeeEids.has(eid)) return;
          if (emp.isFromWinTeamOnly) return;
          const effLimit = getEmployeeEffectiveLimit(emp);

          // 1. Status Block: Disqualify Inactive, LOA, Locked Out, Bereavement, or Date-Specific Conflict
          const status = getEmployeeStatus(emp, dt);
          if (status.isBlocked) return;

          // 1b. Bottom 75 Working Weeks Seniority Restriction for BRE Shifts (JC 235144 or 267588)
          if (isBreShift(shift) && isEmployeeBottom75(emp)) return;

          // 2. Cell Hard Locks: Dedication, TOR, Not Available, Opt Out
          const dInfo = emp.daily[dt] || {};
          const p1Val = (dInfo.p1 || '').trim();
          const p2Val = (dInfo.p2 || '').trim();
          const hiredVal = (dInfo.hired || '').trim();
          const blockPhrases = ['Dedication', 'TOR', 'Not Available', 'Opt Out'];
          if (blockPhrases.includes(p1Val) || blockPhrases.includes(p2Val) || blockPhrases.includes(hiredVal)) {
            return;
          }

          // 3. Weekly Hours Limit Enforcement (PT Limits & <= 45h standard or custom approved weekly cap)
          if (simHours[eid] + shHours > effLimit + 0.01) return;

          // 4. Cross-Day Timeline Overlap & Minimum 8.0h Rest Turnaround Check (Always strictly enforced!)
          const allSimShifts = [];
          Object.keys(simWorkingShifts[eid] || {}).forEach(d => {
            if (simWorkingShifts[eid][d]) allSimShifts.push(...simWorkingShifts[eid][d]);
          });

          let hasOverlap = false;
          let hasRestViolation = false;
          let minRestGap = 999;

          for (const es of allSimShifts) {
            if (shiftsOverlap(es, shift)) {
              hasOverlap = true;
              break;
            }
            const gap = getShiftsRestGap(es, shift);
            if (gap < minRestGap) minRestGap = gap;
            if (gap < 8.0) {
              hasRestViolation = true;
              break;
            }
          }
          if (hasOverlap || hasRestViolation) return;

          // 5. Days-Per-Week & 6th/7th Day OT Approvals Check
          const curWorkingDates = new Set(Object.keys(simWorkingShifts[eid]).filter(d => simWorkingShifts[eid][d] && simWorkingShifts[eid][d].length > 0));
          const isAlreadyWorkingOnDate = curWorkingDates.has(dt);
          const projectedDaysWorked = isAlreadyWorkingOnDate ? curWorkingDates.size : curWorkingDates.size + 1;
          const approvals = getEmployeeOTApprovals(eid);

          if (projectedDaysWorked === 6 && !approvals.sixthDay) return;
          if (projectedDaysWorked >= 7 && !approvals.seventhDay) return;

          // 6. Daily Hours Cap & 12h/16h Approvals Check
          const existingSameDay = simWorkingShifts[eid][dt] || [];
          const dayExistingHours = existingSameDay.reduce((acc, es) => acc + es.countedHours, 0.0);
          const dayProjectedHours = dayExistingHours + shHours;
          const isThroughAndThrough = (existingSameDay.length === 0);
          let maxDailyCap = 8.0;
          if (approvals.dailyCap === 16) maxDailyCap = 16.0;
          else if (approvals.dailyCap === 12) maxDailyCap = 12.0;
          else maxDailyCap = isThroughAndThrough ? shHours : 8.0;

          if (dayProjectedHours > maxDailyCap + 0.01) return;

          // Different posts rule on same day: allowed up to approved daily cap (or 8h standard)
          if (existingSameDay.length > 0) {
            const isSamePostAll = existingSameDay.every(es => (es.postDesc || es.jobPostDetailId || '').trim() === shiftPost);
            if (!isSamePostAll && approvals.dailyCap < 12 && dayProjectedHours > 8.01) {
              return; // Non-billable OT rule unless 12h/16h cap approved
            }
          }

          // 7. Determine Overtime Status for this Assignment
          // Contracted Billable OT: Through-and-through SOR shifts of any length (e.g. 8.25h, 10h, 12h) are contracted client coverage
          // and ALWAYS OK without requiring management OT approvals or daily cap waivers!
          const curH = simHours[eid];
          const projH = curH + shHours;
          const is6thDay = (projectedDaysWorked === 6);
          const is7thDay = (projectedDaysWorked >= 7);
          const isBillableShiftOT = isThroughAndThrough && (shHours > 8.01);
          const isDailyNonBillableOT = !isThroughAndThrough && (dayProjectedHours > 8.01);
          const isWeeklyOT = (projH > 40.01);
          const isOver45h = (projH > 45.01);
          const isOvertimeAssignment = is6thDay || is7thDay || isDailyNonBillableOT || isWeeklyOT || isOver45h;

          const otReasons = [];
          if (is6thDay) otReasons.push('6th Day');
          if (is7thDay) otReasons.push('7th Day');
          if (isDailyNonBillableOT) otReasons.push(`${dayProjectedHours.toFixed(1)}h Daily Non-Billable OT`);
          else if (isBillableShiftOT) otReasons.push(`Billable OT (${shHours.toFixed(1)}h Through-and-Through)`);
          if (isOver45h) otReasons.push(`>45h Weekly (${projH.toFixed(1)}h)`);
          else if (isWeeklyOT) otReasons.push(`>${40}h Weekly (${projH.toFixed(1)}h)`);

          const restBufferLabel = minRestGap < 900 ? `+${minRestGap.toFixed(1)}h rest` : 'First shift of week';

          const candInfo = {
            emp,
            currentHours: curH,
            effLimit,
            restBufferLabel,
            isOvertime: isOvertimeAssignment,
            isBillableOT: isBillableShiftOT,
            isThroughAndThrough,
            is6thDay,
            is7thDay,
            isDailyNonBillableOT,
            isOver45: isOver45h,
            otReasons,
            projectedDayHours: dayProjectedHours,
            dailyCap: maxDailyCap,
            projectedDaysWorked
          };

          // 8. Place into Priority Buckets
          const p1W = parseTimeWindow(p1Val);
          if (p1W && p1W.start <= inT && inT < p1W.end) {
            if (!isOvertimeAssignment) {
              if (curH < 20.0) {
                p1.push({ ...candInfo, tier: 'Priority 1: 1st Choice (<20h)', priorityRank: 1 });
              } else {
                p2.push({ ...candInfo, tier: 'Priority 2: 1st Choice (≥20h)', priorityRank: 2 });
              }
            } else if (!isOver45h) {
              if (curH < 40.0) {
                otP1.push({ ...candInfo, tier: 'Priority 7: Approved OT • 1st Choice (<40h, ≤45h)', priorityRank: 7 });
              } else {
                otP2.push({ ...candInfo, tier: 'Priority 8: Approved OT • 1st Choice (≥40h, ≤45h)', priorityRank: 8 });
              }
            } else {
              otOver45_P1.push({ ...candInfo, tier: 'Priority 13: Approved OT • 1st Choice (>45h Week)', priorityRank: 13 });
            }
            return;
          }

          const p2W = parseTimeWindow(p2Val);
          if (p2W && p2W.start <= inT && inT < p2W.end) {
            if (!isOvertimeAssignment) {
              if (curH < 20.0) {
                p3.push({ ...candInfo, tier: 'Priority 3: 2nd Choice (<20h)', priorityRank: 3 });
              } else {
                p4.push({ ...candInfo, tier: 'Priority 4: 2nd Choice (≥20h)', priorityRank: 4 });
              }
            } else if (!isOver45h) {
              if (curH < 40.0) {
                otP3.push({ ...candInfo, tier: 'Priority 9: Approved OT • 2nd Choice (<40h, ≤45h)', priorityRank: 9 });
              } else {
                otP4.push({ ...candInfo, tier: 'Priority 10: Approved OT • 2nd Choice (≥40h, ≤45h)', priorityRank: 10 });
              }
            } else {
              otOver45_P2.push({ ...candInfo, tier: 'Priority 14: Approved OT • 2nd Choice (>45h Week)', priorityRank: 14 });
            }
            return;
          }

          const hWs = parseHiredWindows(hiredVal);
          for (const hw of hWs) {
            if (hw.start <= inT && inT < hw.end) {
              if (!isOvertimeAssignment) {
                if (curH < 20.0) {
                  p5.push({ ...candInfo, tier: 'Priority 5: Hired AV (<20h)', priorityRank: 5 });
                } else {
                  p6.push({ ...candInfo, tier: 'Priority 6: Hired AV (≥20h)', priorityRank: 6 });
                }
              } else if (!isOver45h) {
                if (curH < 40.0) {
                  otP5.push({ ...candInfo, tier: 'Priority 11: Approved OT • Hired AV (<40h, ≤45h)', priorityRank: 11 });
                } else {
                  otP6.push({ ...candInfo, tier: 'Priority 12: Approved OT • Hired AV (≥40h, ≤45h)', priorityRank: 12 });
                }
              } else {
                otOver45_P3.push({ ...candInfo, tier: 'Priority 15: Approved OT • Hired AV (>45h Week)', priorityRank: 15 });
              }
              break;
            }
          }
        });

        // Within each bucket, sort by lowest actual hours first to ensure equity, then by name
        const sortSim = (a, b) => (a.currentHours - b.currentHours) || a.emp.name.localeCompare(b.emp.name);
        p1.sort(sortSim);
        p2.sort(sortSim);
        p3.sort(sortSim);
        p4.sort(sortSim);
        p5.sort(sortSim);
        p6.sort(sortSim);

        otP1.sort(sortSim);
        otP2.sort(sortSim);
        otP3.sort(sortSim);
        otP4.sort(sortSim);
        otP5.sort(sortSim);
        otP6.sort(sortSim);

        otOver45_P1.sort(sortSim);
        otOver45_P2.sort(sortSim);
        otOver45_P3.sort(sortSim);

        // SELECTION LOGIC:
        // Rule: "if there is an SP who doesn't have overtime, give them the shift first before you give someone OT."
        // Rule: "Overtime exclusion rules do not apply to through-and-through SORs. Like... if there is an SOR that is 8.25 hrs long but no OT approvals are in place, you can still auto-fill a guard into it as long as the rest of the rules are still followed: rest period between shifts, not over 45 hrs. in the week, available, etc."
        // Rule: "If there is an overtime approval, the smart filler is allowed to give SPs hours beyond hour 45 in the week, just so long as it is not possible to give it to an SP with less"
        let best = null;
        if (p1.length > 0) { best = p1[0]; }
        else if (p2.length > 0) { best = p2[0]; }
        else if (p3.length > 0) { best = p3[0]; }
        else if (p4.length > 0) { best = p4[0]; }
        else if (!state.avoidHiredAV && p5.length > 0) { best = p5[0]; }
        else if (!state.avoidHiredAV && p6.length > 0) { best = p6[0]; }
        // If no non-OT candidate can take the shift, evaluate Approved Overtime candidates!
        else if (state.autoFillAllowApprovedOT !== false) {
          // Level 2: Approved OT candidates within standard <=45h target
          if (otP1.length > 0) { best = otP1[0]; }
          else if (otP2.length > 0) { best = otP2[0]; }
          else if (otP3.length > 0) { best = otP3[0]; }
          else if (otP4.length > 0) { best = otP4[0]; }
          else if (!state.avoidHiredAV && otP5.length > 0) { best = otP5[0]; }
          else if (!state.avoidHiredAV && otP6.length > 0) { best = otP6[0]; }
          // Level 3: Approved OT candidates BEYOND hour 45 in the week!
          // "just so long as it is not possible to give it to an SP with less"
          else if (state.autoFillAllowOver45OT !== false) {
            if (otOver45_P1.length > 0) { best = otOver45_P1[0]; }
            else if (otOver45_P2.length > 0) { best = otOver45_P2[0]; }
            else if (!state.avoidHiredAV && otOver45_P3.length > 0) { best = otOver45_P3[0]; }
          }
        } else {
          // Even when manual OT approvals are not in place, through-and-through SOR billable OT shifts
          // up to 45.0h weekly without 6th/7th day or non-billable OT are always OK to fill!
          const billableEligible = (list) => list.find(c => c.isThroughAndThrough && !c.is6thDay && !c.is7thDay && !c.isDailyNonBillableOT);
          best = billableEligible(otP1) || billableEligible(otP2) || billableEligible(otP3) || billableEligible(otP4) ||
                 (!state.avoidHiredAV ? (billableEligible(otP5) || billableEligible(otP6)) : null);
        }

        if (best) {
          simHours[best.emp.eid] += shHours;
          simWorkingShifts[best.emp.eid][dt].push(shift);
          proposed.push({
            shift,
            employee: best.emp,
            tier: best.tier,
            priorityRank: best.priorityRank,
            oldHours: best.currentHours,
            newHours: simHours[best.emp.eid],
            effLimit: best.effLimit,
            restBufferLabel: best.restBufferLabel,
            isOvertime: Boolean(best.isOvertime),
            isBillableOT: Boolean(best.isBillableOT),
            isOver45: Boolean(best.isOver45),
            otReasons: best.otReasons || [],
            projectedDayHours: best.projectedDayHours,
            dailyCap: best.dailyCap,
            projectedDaysWorked: best.projectedDaysWorked
          });
        }
      });

      state.simProposal = proposed;
      renderSimProposalList();
    }

    function renderSimProposalList() {
      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee && isFillablePostDescription(s.postDesc));
      const proposed = state.simProposal || [];
      const regularCount = proposed.filter(p => !p.isOvertime).length;
      const billableCount = proposed.filter(p => p.isBillableOT && !p.isOvertime).length;
      const otCount = proposed.filter(p => p.isOvertime).length;
      const otOver45Count = proposed.filter(p => p.newHours > 45.0).length;
      const otUnder45Count = otCount - otOver45Count;
      const p1Count = proposed.filter(p => p.priorityRank === 1 || p.priorityRank === 7 || p.priorityRank === 13).length;
      const p2Count = proposed.filter(p => p.priorityRank === 2 || p.priorityRank === 8).length;
      const p3Count = proposed.filter(p => p.priorityRank === 3 || p.priorityRank === 9 || p.priorityRank === 14).length;
      const p4Count = proposed.filter(p => p.priorityRank === 4 || p.priorityRank === 10).length;
      const hiredCount = proposed.filter(p => p.priorityRank === 5 || p.priorityRank === 6 || p.priorityRank === 11 || p.priorityRank === 12 || p.priorityRank === 15).length;

      document.getElementById('simFillableCount').textContent = proposed.length + ' / ' + openShifts.length;
      if (document.getElementById('simRegularCount')) {
        document.getElementById('simRegularCount').innerHTML = billableCount > 0
          ? `${regularCount} <span class="text-[9.5px] font-medium text-emerald-800 block">${billableCount} Billable OT</span>`
          : regularCount;
      }
      if (document.getElementById('simApprovedOTCount')) {
        document.getElementById('simApprovedOTCount').innerHTML = otCount > 0
          ? `${otCount} <span class="text-[9.5px] font-medium text-amber-800 block">${otUnder45Count} &le;45h &bull; ${otOver45Count} &gt;45h</span>`
          : '0';
      }
      if (document.getElementById('simTier1Count')) document.getElementById('simTier1Count').textContent = p1Count;
      if (document.getElementById('simTier2Count')) document.getElementById('simTier2Count').textContent = p3Count + p4Count;
      if (document.getElementById('simTier3Count')) {
        document.getElementById('simTier3Count').textContent = state.avoidHiredAV ? '0 (Avoided)' : hiredCount;
      }

      const unassignedCount = openShifts.length - proposed.length;
      document.getElementById('simUnassignedNotice').textContent = unassignedCount > 0
        ? `${unassignedCount} shifts remain unassigned (${state.avoidHiredAV ? 'avoiding Hired AV' : 'all priorities checked'})`
        : 'All open shifts fillable!';

      const listContainer = document.getElementById('simAssignmentsList');
      if (!listContainer) return;

      if (proposed.length === 0) {
        listContainer.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">No shifts can be automatically filled within weekly limits, rest turnaround (&ge;8.0h), and overtime approvals.</div>`;
        return;
      }

      let html = '';
      proposed.forEach((p, idx) => {
        let tierCls = 'bg-blue-100 text-blue-800 border-blue-200';
        if (p.priorityRank === 1) tierCls = 'bg-blue-100 text-blue-800 border-blue-300 font-bold';
        else if (p.priorityRank === 2) tierCls = 'bg-sky-100 text-sky-800 border-sky-300 font-semibold';
        else if (p.priorityRank === 3) tierCls = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
        else if (p.priorityRank === 4) tierCls = 'bg-orange-100 text-orange-800 border-orange-300 font-semibold';
        else if (p.newHours > 45.0) tierCls = 'bg-purple-100 text-purple-900 border-purple-400 font-bold';
        else if (p.isOvertime) tierCls = 'bg-amber-100 text-amber-900 border-amber-400 font-bold';
        else tierCls = 'bg-slate-100 text-slate-700 border-slate-300 italic';

        const otBadge = p.isOvertime
          ? (p.newHours > 45.0
              ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-950 border border-purple-400 flex items-center gap-1 shadow-2xs">⚡ Approved OT (>45h): ${p.otReasons.join(' &bull; ')}</span>`
              : `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-400 flex items-center gap-1 shadow-2xs">⚡ Approved OT: ${p.otReasons.join(' &bull; ')}</span>`)
          : (p.isBillableOT
              ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1 shadow-2xs" title="Through-and-through SOR shift >8h is contracted billable OT to Apple (always OK)">✓ Billable OT (${p.shift.countedHours.toFixed(1)}h)</span>`
              : '<span class="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">No Overtime</span>');

        html += `
          <div class="p-3 flex items-center justify-between text-xs hover:bg-slate-50 gap-3 transition-colors ${p.newHours > 45.0 ? 'bg-purple-50/25' : (p.isOvertime ? 'bg-amber-50/20' : '')}">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900">${escapeHtml(p.employee.name)}</span>
                <span class="font-mono text-slate-500 text-[11px]">#${p.employee.eid}</span>
                <span class="px-2 py-0.5 rounded text-[10px] border ${tierCls}">${p.tier}</span>
                ${otBadge}
                <!-- WW NOTES IN PROPOSAL -->
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.employee.notes ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-500'}">
                  📝 WW: ${escapeHtml(p.employee.notes || 'None')}
                </span>
                <span class="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <span class="w-1 h-1 rounded-full bg-emerald-500"></span>
                  ${p.restBufferLabel || '✓ Rest Validated'}
                </span>
              </div>
              <div class="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-2 flex-wrap">
                <span>${p.shift.workDateNorm} &bull; ${p.shift.inTime}-${p.shift.outTime} (${p.shift.countedHours.toFixed(1)}h) &bull; ${escapeHtml(p.shift.postDesc || p.shift.jobDesc)}</span>
                ${p.dailyCap ? `<span class="text-slate-600 font-sans font-semibold">&bull; Day total: ${p.projectedDayHours.toFixed(1)}h / max ${p.dailyCap}h</span>` : ''}
                ${p.projectedDaysWorked ? `<span class="text-slate-600 font-sans font-semibold">&bull; Working day #${p.projectedDaysWorked}</span>` : ''}
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-right font-mono text-[11px]">
                <div class="text-slate-500">${p.oldHours.toFixed(1)}h &rarr; <strong class="${p.newHours > 45.0 ? 'text-purple-700 font-black' : (p.isOvertime ? 'text-amber-700' : 'text-emerald-700')}">${p.newHours.toFixed(1)}h</strong></div>
                <div class="text-[10px] text-slate-400">Limit: ${p.effLimit.toFixed(1)}h</div>
              </div>
              <button onclick="excludeSimProposalItem(${idx})" title="Exclude this shift from batch" class="p-1 text-slate-400 hover:text-rose-600 rounded">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        `;
      });
      listContainer.innerHTML = html;
    }

    function excludeSimProposalItem(idx) {
      if (!state.simProposal || !state.simProposal[idx]) return;
      const item = state.simProposal.splice(idx, 1)[0];
      showToast(`Excluded ${item.employee.name} (${item.shift.workDateNorm}) from batch.`);
      renderSimProposalList();
    }

    function commitAutoFill() {
      if (!state.simProposal || state.simProposal.length === 0) return;

      const count = state.simProposal.length;
      state.simProposal.forEach(p => {
        assignCandidate(p.shift.id, p.employee.eid, p.tier);
      });

      closeAutoFillModal();
      showToast(`Successfully assigned ${count} shifts across the schedule!`);
    }

    // --- WINTEAM MANUAL ENTRY QUEUE ---
    function openWinTeamDrawer() {
      sortWinTeamQueue();
      document.getElementById('drawerWinTeam').classList.remove('hidden');
      renderWinTeamTable();
    }

    function closeWinTeamDrawer() {
      document.getElementById('drawerWinTeam').classList.add('hidden');
    }

    function sortWinTeamQueue() {
      if (!state.sessionAssignments || state.sessionAssignments.length <= 1) return;
      state.sessionAssignments.sort((a, b) => {
        // 1. Group by day/date, soonest calendar day first
        const dateValA = getDateSortValue(a.workDateNorm);
        const dateValB = getDateSortValue(b.workDateNorm);
        if (dateValA !== dateValB) {
          return dateValA - dateValB;
        }

        // 2. Sort by shift start time (earliest first)
        const timeA = (a.inTimeHours !== undefined) ? a.inTimeHours : timeStringToHours(a.inTime);
        const timeB = (b.inTimeHours !== undefined) ? b.inTimeHours : timeStringToHours(b.inTime);
        if (Math.abs(timeA - timeB) > 0.001) {
          return timeA - timeB;
        }

        // 3. Shift end time (earliest first)
        const outA = (a.outTimeHours !== undefined) ? a.outTimeHours : timeStringToHours(a.outTime);
        const outB = (b.outTimeHours !== undefined) ? b.outTimeHours : timeStringToHours(b.outTime);
        if (Math.abs(outA - outB) > 0.001) {
          return outA - outB;
        }

        // 4. Post description alphanumeric
        const postA = (a.postDesc || a.jobDesc || '').toString();
        const postB = (b.postDesc || b.jobDesc || '').toString();
        const cmpPost = postA.localeCompare(postB, undefined, { numeric: true, sensitivity: 'base' });
        if (cmpPost !== 0) return cmpPost;

        // 5. Shift ID or Schedule ID
        return (a.shiftIdVal || a.shiftId || '').toString().localeCompare((b.shiftIdVal || b.shiftId || '').toString());
      });
    }

    // --- WINTEAM OVERTIME & SCHEDULE WARNING AUDIT ENGINE ---
    function getWinTeamOTAudit(sa) {
      if (!sa) return { hasExpectedOT: false, expectedOTHours: 0, causes: [], shiftHours: 0, totalDayHours: 0, totalWeekHours: 0, dayIndex: 1, totalDaysWorked: 1, numShiftsOnDate: 0, is6thDay: false, is7thDay: false, isAuthorized: true, authTags: [], neededApprovalType: null, approvalDetail: 'Regular' };

      const eid = sa.eid;
      const otApprovals = getEmployeeOTApprovals(eid);
      const shiftHours = sa.countedHours || 0.0;
      const workDate = sa.workDateNorm;

      // 1. Gather all shifts scheduled for this employee on this specific date
      const dayShifts = (state.empDayWorkingShifts[eid] && state.empDayWorkingShifts[eid][workDate])
        ? state.empDayWorkingShifts[eid][workDate]
        : [];
      const totalDayHours = dayShifts.reduce((acc, s) => acc + (s.countedHours || 0), 0.0);
      const numShiftsOnDate = dayShifts.length;

      // 2. Gather weekly hours and working dates
      const totalWeekHours = state.empActualHours[eid] || 0.0;
      const workingDates = state.empWorkingDates[eid] ? Array.from(state.empWorkingDates[eid]) : [];
      const sortedDates = workingDates.sort((a, b) => getDateSortValue(a) - getDateSortValue(b));
      const dateIdx = sortedDates.indexOf(workDate);
      const dayIndex = dateIdx !== -1 ? dateIdx + 1 : sortedDates.length;
      const totalDaysWorked = sortedDates.length;

      const causes = [];
      const is6thDay = (dayIndex === 6 || (totalDaysWorked === 6 && sortedDates[5] === workDate));
      const is7thDay = (dayIndex >= 7 || (totalDaysWorked >= 7 && sortedDates[6] === workDate));

      // Cause A: Shift Duration > 8.0h
      const isThroughAndThrough = (numShiftsOnDate === 1);
      if (shiftHours > 8.01) {
        const extraH = shiftHours - 8.0;
        causes.push({
          id: 'shift_gt_8',
          label: isThroughAndThrough ? 'Billable OT (Through-and-Through SOR)' : 'Shift Length > 8.0h',
          shortLabel: isThroughAndThrough ? `Billable OT (${shiftHours.toFixed(1)}h)` : `${shiftHours.toFixed(1)}h Shift`,
          detail: isThroughAndThrough
            ? `Through-and-through SOR shift is ${shiftHours.toFixed(1)} hrs (+${extraH.toFixed(1)}h contracted billable OT to Apple — always OK)`
            : `This shift is ${shiftHours.toFixed(1)} hrs (+${extraH.toFixed(1)}h Daily OT on this single shift alone)`,
          otHours: extraH,
          severity: isThroughAndThrough ? 'emerald' : 'amber'
        });
      }

      // Cause B: Daily total > 8.0h (across multiple shifts on this date)
      if (totalDayHours > 8.01 && numShiftsOnDate > 1) {
        const dailyExtra = totalDayHours - 8.0;
        causes.push({
          id: 'daily_total_gt_8',
          label: 'Daily Total > 8.0h (Multi-Shift)',
          shortLabel: `${totalDayHours.toFixed(1)}h Daily`,
          detail: `${totalDayHours.toFixed(1)} hrs total across ${numShiftsOnDate} shifts on ${workDate} (+${dailyExtra.toFixed(1)}h Daily OT)`,
          otHours: dailyExtra,
          severity: 'amber'
        });
      }

      // Cause C: Daily Double Time (> 12.0h)
      if (totalDayHours > 12.01) {
        const dtExtra = totalDayHours - 12.0;
        causes.push({
          id: 'double_time',
          label: 'Daily Double Time (>12.0h)',
          shortLabel: 'Double Time (>12h)',
          detail: `${totalDayHours.toFixed(1)} hrs in 1 calendar day (+${dtExtra.toFixed(1)}h Double Time at 2.0x in CA)`,
          otHours: dtExtra,
          severity: 'rose'
        });
      }

      // Cause D: 6th Working Day
      if (is6thDay) {
        causes.push({
          id: 'sixth_day',
          label: '6th Working Day',
          shortLabel: '6th Day OT',
          detail: `Working 6th calendar day this week (all ${shiftHours.toFixed(1)}h subject to 1.5x OT in CA)`,
          otHours: Math.min(8.0, shiftHours),
          severity: 'purple'
        });
      }

      // Cause E: 7th Working Day
      if (is7thDay) {
        causes.push({
          id: 'seventh_day',
          label: '7th Working Day',
          shortLabel: '7th Day OT/DT',
          detail: `Working 7th calendar day this week (1.5x OT up to 8h, 2.0x Double Time thereafter in CA)`,
          otHours: shiftHours,
          severity: 'rose'
        });
      }

      // Cause F: Weekly Scheduled Hours > 40.0h
      if (totalWeekHours > 40.01) {
        const weekExtra = totalWeekHours - 40.0;
        causes.push({
          id: 'weekly_gt_40',
          label: 'Weekly Total > 40.0h',
          shortLabel: `>${40}h Weekly (${totalWeekHours.toFixed(1)}h)`,
          detail: `Weekly total is ${totalWeekHours.toFixed(1)} hrs (+${weekExtra.toFixed(1)}h over 40.0h weekly limit)`,
          otHours: weekExtra,
          severity: 'amber'
        });
      }

      const hasExpectedOT = causes.length > 0;

      let expectedOTHours = 0;
      if (is7thDay) {
        expectedOTHours = shiftHours;
      } else if (is6thDay) {
        expectedOTHours = shiftHours;
      } else if (shiftHours > 8.01) {
        expectedOTHours = Math.max(shiftHours - 8.0, totalDayHours > 8.01 ? totalDayHours - 8.0 : 0);
      } else if (totalDayHours > 8.01) {
        expectedOTHours = totalDayHours - 8.0;
      } else if (totalWeekHours > 40.01) {
        expectedOTHours = Math.min(shiftHours, totalWeekHours - 40.0);
      }

      // Check operator authorization status
      let isAuthorized = true;
      const authTags = [];
      let neededApprovalType = null;

      if (is6thDay) {
        if (otApprovals.sixthDay) {
          authTags.push('6th Day Approved');
        } else {
          isAuthorized = false;
          if (!neededApprovalType) neededApprovalType = 'sixthDay';
        }
      }

      if (is7thDay) {
        if (otApprovals.seventhDay) {
          authTags.push('7th Day Approved');
        } else {
          isAuthorized = false;
          if (!neededApprovalType) neededApprovalType = 'seventhDay';
        }
      }

      if (totalDayHours > 12.01) {
        if (otApprovals.dailyCap >= 16) {
          authTags.push('16h Daily Cap Approved');
        } else if (isThroughAndThrough) {
          authTags.push('Billable OT (Through-and-Through SOR)');
        } else {
          isAuthorized = false;
          if (!neededApprovalType) neededApprovalType = 'dailyCap16';
        }
      } else if (totalDayHours > 8.01) {
        if (otApprovals.dailyCap >= 12) {
          authTags.push('12h Daily Cap Approved');
        } else if (isThroughAndThrough) {
          authTags.push('Billable OT (Through-and-Through SOR)');
        } else {
          isAuthorized = false;
          if (!neededApprovalType) neededApprovalType = 'dailyCap12';
        }
      }

      if (totalWeekHours > 40.01) {
        if (otApprovals.weeklyCap && otApprovals.weeklyCap >= totalWeekHours) {
          authTags.push(`Cap to ${otApprovals.weeklyCap}h`);
        } else if (otApprovals.sixthDay || otApprovals.seventhDay || otApprovals.dailyCap >= 12) {
          authTags.push('OT Approved');
        }
      }

      return {
        hasExpectedOT,
        expectedOTHours,
        causes,
        shiftHours,
        totalDayHours,
        totalWeekHours,
        dayIndex: dayIndex > 0 ? dayIndex : totalDaysWorked,
        totalDaysWorked,
        numShiftsOnDate,
        is6thDay,
        is7thDay,
        isAuthorized,
        authTags,
        neededApprovalType,
        approvalDetail: authTags.length > 0 ? authTags.join(' • ') : (isAuthorized ? 'Authorized' : 'Unapproved')
      };
    }

    function setWinTeamFilter(filter) {
      state.winteamFilter = filter || 'all';
      renderWinTeamTable();
    }

    function setWinTeamSearch(query) {
      state.winteamSearch = (query || '').toLowerCase().trim();
      renderWinTeamTable();
    }

    function renderWinTeamTable() {
      const tbody = document.getElementById('winteamTableBody');
      const countBadge = document.getElementById('winteamAssignedBadge');
      const headerCountBadge = document.getElementById('badgeWinTeamCount');

      sortWinTeamQueue();

      if (countBadge) countBadge.textContent = state.sessionAssignments.length;
      if (headerCountBadge) headerCountBadge.textContent = state.sessionAssignments.length;

      // Compute audits & job code counts for all assignments to update count badges
      const totalCount = state.sessionAssignments.length;
      let otCount = 0;
      let regCount = 0;
      let countJob233265 = 0;
      let countJob235144 = 0;
      let countJob266778 = 0;
      let countJob267588 = 0;

      const auditedList = state.sessionAssignments.map((sa, idx) => {
        const audit = getWinTeamOTAudit(sa);
        if (audit.hasExpectedOT) otCount++;
        else regCount++;

        const jn = String(sa.jobNumber || '').trim();
        if (jn === '233265' || jn.includes('233265')) countJob233265++;
        else if (jn === '235144' || jn.includes('235144')) countJob235144++;
        else if (jn === '266778' || jn.includes('266778')) countJob266778++;
        else if (jn === '267588' || jn.includes('267588')) countJob267588++;

        return { sa, audit, originalIdx: idx };
      });

      // Update toolbar count badges
      const badgeAll = document.getElementById('wtCountAll');
      const badgeOT = document.getElementById('wtCountOT');
      const badgeReg = document.getElementById('wtCountReg');
      if (badgeAll) badgeAll.textContent = totalCount;
      if (badgeOT) badgeOT.textContent = otCount;
      if (badgeReg) badgeReg.textContent = regCount;

      // Update 4 Job Code count badges
      const elJobAll = document.getElementById('wtJobCountAll');
      const elJob233265 = document.getElementById('wtJobCount233265');
      const elJob235144 = document.getElementById('wtJobCount235144');
      const elJob266778 = document.getElementById('wtJobCount266778');
      const elJob267588 = document.getElementById('wtJobCount267588');
      if (elJobAll) elJobAll.textContent = totalCount;
      if (elJob233265) elJob233265.textContent = countJob233265;
      if (elJob235144) elJob235144.textContent = countJob235144;
      if (elJob266778) elJob266778.textContent = countJob266778;
      if (elJob267588) elJob267588.textContent = countJob267588;

      // Update active filter button styling
      const btnAll = document.getElementById('btnWTFilterAll');
      const btnOT = document.getElementById('btnWTFilterOT');
      const btnReg = document.getElementById('btnWTFilterReg');
      if (btnAll && btnOT && btnReg) {
        btnAll.className = (state.winteamFilter === 'all')
          ? 'px-2.5 py-1 rounded-md font-bold text-xs bg-white text-slate-900 shadow-2xs'
          : 'px-2.5 py-1 rounded-md font-bold text-xs text-slate-700 hover:bg-white/80 transition-colors';
        btnOT.className = (state.winteamFilter === 'ot')
          ? 'px-2.5 py-1 rounded-md font-bold text-xs bg-amber-200 text-amber-950 shadow-2xs'
          : 'px-2.5 py-1 rounded-md font-bold text-xs text-amber-900 hover:bg-white/80 transition-colors';
        btnReg.className = (state.winteamFilter === 'regular')
          ? 'px-2.5 py-1 rounded-md font-bold text-xs bg-emerald-100 text-emerald-900 shadow-2xs'
          : 'px-2.5 py-1 rounded-md font-bold text-xs text-emerald-800 hover:bg-white/80 transition-colors';
      }

      // Update active Job Code button styling
      const btnJobAll = document.getElementById('btnWTJobAll');
      const btnJob233265 = document.getElementById('btnWTJob233265');
      const btnJob235144 = document.getElementById('btnWTJob235144');
      const btnJob266778 = document.getElementById('btnWTJob266778');
      const btnJob267588 = document.getElementById('btnWTJob267588');
      const activeJob = state.winteamJobFilter || 'all';

      if (btnJobAll) btnJobAll.className = (activeJob === 'all')
        ? 'px-2 py-1 rounded-md font-bold text-[11px] bg-white text-slate-900 shadow-2xs'
        : 'px-2 py-1 rounded-md font-bold text-[11px] text-slate-700 hover:bg-white/80 transition-colors';
      if (btnJob233265) btnJob233265.className = (activeJob === '233265')
        ? 'px-2 py-1 rounded-md font-bold text-[11px] bg-blue-600 text-white shadow-2xs flex items-center gap-1'
        : 'px-2 py-1 rounded-md font-bold text-[11px] text-blue-900 hover:bg-white/80 transition-colors flex items-center gap-1';
      if (btnJob235144) btnJob235144.className = (activeJob === '235144')
        ? 'px-2 py-1 rounded-md font-bold text-[11px] bg-indigo-600 text-white shadow-2xs flex items-center gap-1'
        : 'px-2 py-1 rounded-md font-bold text-[11px] text-indigo-900 hover:bg-white/80 transition-colors flex items-center gap-1';
      if (btnJob266778) btnJob266778.className = (activeJob === '266778')
        ? 'px-2 py-1 rounded-md font-bold text-[11px] bg-emerald-600 text-white shadow-2xs flex items-center gap-1'
        : 'px-2 py-1 rounded-md font-bold text-[11px] text-emerald-900 hover:bg-white/80 transition-colors flex items-center gap-1';
      if (btnJob267588) btnJob267588.className = (activeJob === '267588')
        ? 'px-2 py-1 rounded-md font-bold text-[11px] bg-amber-600 text-white shadow-2xs flex items-center gap-1'
        : 'px-2 py-1 rounded-md font-bold text-[11px] text-amber-900 hover:bg-white/80 transition-colors flex items-center gap-1';

      if (state.sessionAssignments.length === 0) {
        state.winteamFilteredAssignments = [];
        tbody.innerHTML = `
          <tr>
            <td colspan="12" class="p-8 text-center text-slate-400 font-sans">
              No shifts assigned in this session yet. As you assign shifts on the Working Weeks grid or Shift-First view, they appear here for entry into WinTeam.
            </td>
          </tr>
        `;
        return;
      }

      // Apply filter and search
      const filtered = auditedList.filter(item => {
        if (state.winteamFilter === 'ot' && !item.audit.hasExpectedOT) return false;
        if (state.winteamFilter === 'regular' && item.audit.hasExpectedOT) return false;

        if (state.winteamJobFilter && state.winteamJobFilter !== 'all') {
          const jn = String(item.sa.jobNumber || '').trim();
          if (jn !== state.winteamJobFilter && !jn.includes(state.winteamJobFilter)) return false;
        }

        if (state.winteamSearch) {
          const q = state.winteamSearch;
          const matchEid = (item.sa.eid || '').toLowerCase().includes(q);
          const matchName = (item.sa.name || '').toLowerCase().includes(q);
          const matchPost = (item.sa.postDesc || item.sa.jobDesc || '').toLowerCase().includes(q);
          const matchJob = (item.sa.jobNumber || '').toString().toLowerCase().includes(q);
          const matchDate = (item.sa.workDateNorm || '').toLowerCase().includes(q);
          if (!matchEid && !matchName && !matchPost && !matchJob && !matchDate) return false;
        }
        return true;
      });

      state.winteamFilteredAssignments = filtered.map(f => f.sa);

      if (filtered.length === 0) {
        let filterDesc = 'Search query';
        if (state.winteamJobFilter && state.winteamJobFilter !== 'all') {
          const jMeta = getWinTeamJobMeta(state.winteamJobFilter);
          filterDesc = `${jMeta.shortCode} (#${state.winteamJobFilter})`;
        } else if (state.winteamFilter === 'ot') {
          filterDesc = 'Expected OT';
        } else if (state.winteamFilter === 'regular') {
          filterDesc = 'Regular Only';
        }
        tbody.innerHTML = `
          <tr>
            <td colspan="12" class="p-8 text-center text-slate-400 font-sans">
              No assignments match the selected filter (${filterDesc}).
            </td>
          </tr>
        `;
        return;
      }

      let html = '';
      let currentDay = null;

      filtered.forEach(({ sa, audit }) => {
        const dayKey = sa.workDateNorm || 'Unscheduled';
        if (dayKey !== currentDay) {
          currentDay = dayKey;
          const dayMeta = getDayMeta(dayKey);
          const dayShifts = state.sessionAssignments.filter(s => (s.workDateNorm || 'Unscheduled') === dayKey);
          const dayTotalShifts = dayShifts.length;
          const dayTotalHours = dayShifts.reduce((acc, s) => acc + (s.countedHours || 0), 0);

          html += `
            <tr class="bg-slate-100/95 text-slate-800 font-bold border-t-2 border-b border-slate-200">
              <td colspan="12" class="py-2 px-3">
                <div class="flex items-center justify-between text-xs font-sans">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-100 text-blue-700 font-bold">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                      </svg>
                    </span>
                    <span class="font-extrabold text-slate-900 text-xs tracking-tight">${escapeHtml(dayMeta.fullLabel || dayKey)}</span>
                    <span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[10.5px] font-bold">
                      ${dayTotalShifts} ${dayTotalShifts === 1 ? 'shift' : 'shifts'}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                    <span class="text-blue-700 font-mono font-bold">${dayTotalHours.toFixed(2)} hrs</span>
                    <span class="text-slate-400">&bull;</span>
                    <button onclick="copyWinTeamPassdownForDay('${escapeHtml(dayKey)}')" class="px-2 py-0.5 rounded bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-[10.5px] flex items-center gap-1 shadow-2xs transition-colors" title="Copy all shifts for ${escapeHtml(dayKey)} in passdown format">
                      <svg class="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                      <span>Copy Day Passdown</span>
                    </button>
                    <span class="text-slate-400">&bull;</span>
                    <span class="text-slate-500 font-medium">Sorted by Start Time (Soonest first)</span>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }

        const meta = getWinTeamJobMeta(sa.jobNumber);
        const postDescStr = String(sa.postDesc || sa.jobDesc || '').trim();
        let postNum = '';
        let postSuffix = '';
        const mSor = postDescStr.match(/^(\d{6})(?:\s*-\s*([A-Za-z0-9]+))?$/);
        if (mSor) {
          postNum = mSor[1];
          postSuffix = mSor[2] ? `-${mSor[2]}` : '';
        } else {
          const mDigits = postDescStr.match(/\b\d{6}\b/);
          if (mDigits) postNum = mDigits[0];
        }

        const rowBg = sa.doneInWinTeam ? 'bg-emerald-50/40 line-through text-slate-400' : `${meta.hoverBg}`;

        html += `
          <tr class="${rowBg} ${meta.rowBorderCls} transition-colors border-b border-slate-100">
            <td class="p-2 text-center">
              <input type="checkbox" onchange="toggleWinTeamDone('${sa.shiftId}')" ${sa.doneInWinTeam ? 'checked' : ''} class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
            </td>
            <td class="p-2 font-bold text-slate-800">
              <div class="flex items-center gap-1">
                <span>${sa.eid}</span>
                <button onclick="copyToClipboard('${sa.eid}', 'EID copied!')" title="Copy EID" class="p-1 text-slate-400 hover:text-blue-600 rounded">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                </button>
              </div>
            </td>
            <td class="p-2 font-semibold text-slate-900 font-sans">
              <div class="flex items-center justify-between gap-1">
                <span>${escapeHtml(sa.name)}</span>
                <button onclick="copySinglePassdown('${sa.shiftId}')" class="p-1 text-slate-300 hover:text-blue-600 rounded transition-colors" title="Copy shift for passdown: ${escapeHtml(formatPassdownLine(sa))}">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                </button>
              </div>
            </td>
            <td class="p-2 text-[11px] font-sans font-medium text-amber-950 bg-amber-50/70 border-l border-r border-amber-200 max-w-[150px] truncate" title="${escapeHtml(sa.wwNotes || 'None')}">${escapeHtml(sa.wwNotes || 'None')}</td>
            <td class="p-2 whitespace-nowrap"><span class="font-semibold text-slate-700">${sa.workDateNorm}</span></td>
            <td class="p-2 whitespace-nowrap font-bold text-slate-800"><span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200/60">${sa.inTime} - ${sa.outTime}</span></td>
            <td class="p-2 font-bold text-slate-800">${sa.countedHours.toFixed(2)}</td>
            
            <!-- JOB & POST COLUMN WITH 4-JOB COLOR CODING -->
            <td class="p-2 font-sans">
              <div class="flex flex-col gap-1 min-w-[160px]">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10.5px] font-black ${meta.badgeCls} shadow-2xs">
                    <span class="w-2 h-2 rounded-full ${meta.dotCls}"></span>
                    <span>${meta.shortCode}</span>
                    <span class="font-mono text-[10px] opacity-80">#${sa.jobNumber}</span>
                  </span>
                </div>
                <div class="text-[11px] font-medium text-slate-700 truncate max-w-xs flex items-center gap-1" title="${escapeHtml(sa.postDesc || sa.jobDesc)}">
                  <span class="text-slate-400 font-mono text-[10px]">&bull;</span>
                  ${postNum ? `
                    <span class="font-bold text-slate-900 font-mono">Post #${postNum}</span>
                    ${postSuffix ? `<span class="text-[10px] font-mono text-slate-500">${escapeHtml(postSuffix)}</span>` : ''}
                  ` : `
                    <span class="font-semibold text-slate-800">${escapeHtml(sa.postDesc || sa.jobDesc)}</span>
                  `}
                </div>
              </div>
            </td>
            <td class="p-2 font-mono text-[11px] text-slate-500">${sa.scheduleDetailsId || '-'}</td>
            
            <!-- EXPECTED OVERTIME & WT AUDIT COLUMN -->
            <td class="p-2.5 ${audit.hasExpectedOT ? 'bg-amber-50/60 border-l border-r border-amber-200/90' : ''}">
              ${audit.hasExpectedOT ? `
                <div class="flex flex-col gap-1 text-xs font-sans min-w-[240px]">
                  <div class="flex items-center justify-between gap-1">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-black bg-amber-200 text-amber-950 border border-amber-400/80 shadow-2xs">
                      <svg class="w-3.5 h-3.5 text-amber-900" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
                      </svg>
                      <span>EXPECTED OT (+${audit.expectedOTHours.toFixed(1)}h)</span>
                    </span>
                    ${audit.isAuthorized ? `
                      <span class="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-0.5" title="${escapeHtml(audit.approvalDetail)}">
                        <svg class="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                        <span>Authorized</span>
                      </span>
                    ` : `
                      <button onclick="quickGrantOTApproval('${sa.eid}', '${audit.neededApprovalType || 'sixthDay'}', '${sa.shiftId}'); renderWinTeamTable();"
                        class="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 transition-colors flex items-center gap-0.5"
                        title="Click to grant company-wide overtime authorization">
                        <span>⚠️ Unapproved (+Approve Company-Wide)</span>
                      </button>
                    `}
                  </div>

                  <div class="space-y-0.5 text-[11px] font-medium text-slate-800">
                    ${audit.causes.map(c => `
                      <div class="flex items-start gap-1 leading-tight">
                        <span class="text-amber-600 font-bold shrink-0">&bull;</span>
                        <span class="${c.severity === 'rose' ? 'text-rose-900 font-semibold' : 'text-slate-800'}">
                          <strong class="font-bold text-slate-900">${escapeHtml(c.label)}:</strong> ${escapeHtml(c.detail)}
                        </span>
                      </div>
                    `).join('')}
                  </div>

                  <div class="pt-0.5 border-t border-amber-200/60 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                    <span title="Total scheduled hours on ${sa.workDateNorm}">Day: <strong class="${audit.totalDayHours > 8.01 ? 'text-amber-900 font-bold' : 'text-slate-700'}">${audit.totalDayHours.toFixed(1)}h</strong></span>
                    <span>&bull;</span>
                    <span title="Total scheduled hours across work week">Wk: <strong class="${audit.totalWeekHours > 40.01 ? 'text-amber-900 font-bold' : 'text-slate-700'}">${audit.totalWeekHours.toFixed(1)}h</strong></span>
                    <span>&bull;</span>
                    <span title="Calendar days worked in week">Day <strong>${audit.dayIndex}</strong>/7</span>
                  </div>
                </div>
              ` : `
                <div class="flex flex-col gap-0.5 text-xs font-sans min-w-[190px]">
                  <div class="flex items-center gap-1">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <svg class="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                      <span>Regular Time (No OT)</span>
                    </span>
                  </div>
                  <div class="text-[10px] font-mono text-slate-500">
                    Day: <strong class="text-slate-700">${audit.totalDayHours.toFixed(1)}h</strong> &bull; Wk: <strong class="text-slate-700">${audit.totalWeekHours.toFixed(1)}h</strong> &bull; Day <strong>${audit.dayIndex}</strong>/7
                  </div>
                  <div class="text-[9.5px] text-slate-400 italic">
                    No WinTeam OT warning expected.
                  </div>
                </div>
              `}
            </td>

            <td class="p-2">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">${sa.tier}</span>
            </td>
            <td class="p-2 text-center">
              <button onclick="unassignShift('${sa.shiftId}')" class="text-rose-600 hover:text-rose-800 font-bold text-xs p-1" title="Unassign">
                &times;
              </button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }

    function toggleWinTeamDone(shiftIdOrIdx) {
      let target = null;
      if (typeof shiftIdOrIdx === 'number') {
        target = state.sessionAssignments[shiftIdOrIdx];
      } else {
        target = state.sessionAssignments.find(sa => sa.shiftId === shiftIdOrIdx);
      }
      if (target) {
        target.doneInWinTeam = !target.doneInWinTeam;
        renderWinTeamTable();
      }
    }

    function copyWinTeamEIDs() {
      if (state.sessionAssignments.length === 0) {
        showToast('No assignments to copy.');
        return;
      }
      const uniqueEids = [...new Set(state.sessionAssignments.map(sa => sa.eid))];
      const text = uniqueEids.join('\n');
      copyToClipboard(text, `${uniqueEids.length} unique EIDs copied to clipboard!`);
    }

    function copyWinTeamTSV() {
      if (state.sessionAssignments.length === 0) {
        showToast('No assignments to copy.');
        return;
      }
      const headers = ['EID', 'Specialist Name', 'WW Notes', 'Work Date', 'In Time', 'Out Time', 'Hours', 'Expected OT', 'OT Causes', 'Job Number', 'Schedule Details ID', 'Post Description', 'Match Tier'];
      const rows = state.sessionAssignments.map(sa => {
        const audit = getWinTeamOTAudit(sa);
        const otSummary = audit.hasExpectedOT ? `YES (+${audit.expectedOTHours.toFixed(1)}h)` : 'NO (Regular)';
        const otCausesStr = audit.causes.map(c => `${c.label}: ${c.detail}`).join('; ') || 'None';
        return [
          sa.eid,
          sa.name,
          (sa.wwNotes || 'None').replace(/\r?\n/g, ' '),
          sa.workDateNorm,
          sa.inTime,
          sa.outTime,
          sa.countedHours.toFixed(2),
          otSummary,
          otCausesStr,
          sa.jobNumber,
          sa.scheduleDetailsId || '',
          sa.postDesc || sa.jobDesc,
          sa.tier
        ];
      });
      const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
      copyToClipboard(tsv, 'WinTeam queue copied as TSV (Tab-Separated) with Overtime Audit!');
    }

    // --- WINTEAM QUEUE 4 JOB CODES METADATA & STYLING ---
    const WT_JOB_META = {
      '233265': {
        code: '233265',
        tag: 'CUP SOR',
        shortCode: 'CUP SOR',
        label: 'Cupertino SOR (Core)',
        theme: 'blue',
        dotCls: 'bg-blue-600',
        badgeCls: 'bg-blue-100 text-blue-900 border border-blue-300',
        rowBorderCls: 'border-l-4 border-l-blue-500',
        hoverBg: 'hover:bg-blue-50/40'
      },
      '235144': {
        code: '235144',
        tag: 'CUP BRE',
        shortCode: 'CUP BRE',
        label: 'Cupertino Break Relief',
        theme: 'indigo',
        dotCls: 'bg-indigo-600',
        badgeCls: 'bg-indigo-100 text-indigo-900 border border-indigo-300',
        rowBorderCls: 'border-l-4 border-l-indigo-500',
        hoverBg: 'hover:bg-indigo-50/40'
      },
      '266778': {
        code: '266778',
        tag: 'SV SOR',
        shortCode: 'SV SOR',
        label: 'Sunnyvale SOR (Core)',
        theme: 'emerald',
        dotCls: 'bg-emerald-600',
        badgeCls: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
        rowBorderCls: 'border-l-4 border-l-emerald-500',
        hoverBg: 'hover:bg-emerald-50/40'
      },
      '267588': {
        code: '267588',
        tag: 'SV BRE',
        shortCode: 'SV BRE',
        label: 'Sunnyvale Break Relief',
        theme: 'amber',
        dotCls: 'bg-amber-600',
        badgeCls: 'bg-amber-100 text-amber-900 border border-amber-300',
        rowBorderCls: 'border-l-4 border-l-amber-500',
        hoverBg: 'hover:bg-amber-50/40'
      }
    };

    function getWinTeamJobMeta(jobNumber) {
      const jn = String(jobNumber || '').trim();
      if (WT_JOB_META[jn]) return WT_JOB_META[jn];
      for (const k of Object.keys(WT_JOB_META)) {
        if (jn.includes(k)) return WT_JOB_META[k];
      }
      return {
        code: jn || 'Other',
        tag: jn || 'OTHER',
        shortCode: jn || 'OTHER',
        label: jn || 'Other',
        theme: 'slate',
        dotCls: 'bg-slate-500',
        badgeCls: 'bg-slate-100 text-slate-800 border border-slate-300',
        rowBorderCls: 'border-l-4 border-l-slate-400',
        hoverBg: 'hover:bg-slate-50'
      };
    }

    function setWinTeamJobFilter(jobCode) {
      state.winteamJobFilter = jobCode || 'all';
      renderWinTeamTable();
    }

    // --- PASSDOWN FORMATTING HELPERS ---
    function formatPassdownDate(dStr) {
      if (!dStr) return '';
      const clean = String(dStr).trim();
      const parts = clean.split(/[-/]/);
      if (parts.length >= 3) {
        if (parts[2].length === 4) {
          const m = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          if (!isNaN(m) && !isNaN(d)) return `${m}/${d}`;
        } else if (parts[0].length === 4) {
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          if (!isNaN(m) && !isNaN(d)) return `${m}/${d}`;
        }
      }
      if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(d)) return `${m}/${d}`;
      }
      const dt = new Date(clean + 'T12:00:00');
      if (!isNaN(dt.getTime())) {
        return `${dt.getMonth() + 1}/${dt.getDate()}`;
      }
      return clean;
    }

    function formatMilitaryTime(tStr) {
      if (!tStr) return '';
      const clean = String(tStr).trim();
      if (clean.includes(':')) {
        const parts = clean.split(':');
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(h) && !isNaN(m)) {
          return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
        }
      }
      const digits = clean.replace(/\D/g, '');
      if (digits.length >= 3 && digits.length <= 4) {
        return digits.padStart(4, '0');
      }
      const num = parseFloat(clean);
      if (!isNaN(num)) {
        const h = Math.floor(num);
        const m = Math.round((num - h) * 60);
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
      }
      return clean;
    }

    function getPassdownJobTag(sa) {
      if (!sa) return '';
      const jn = String(sa.jobNumber || '').trim();
      const postDesc = String(sa.postDesc || sa.jobDesc || '').trim();
      let postNum = '';
      const m = postDesc.match(/^(\d{6})/);
      if (m) {
        postNum = m[1];
      } else {
        const m2 = postDesc.match(/\b\d{6}\b/);
        postNum = m2 ? m2[0] : '';
      }

      if (jn === '233265' || jn.includes('233265')) {
        return postNum ? `CUP SOR ${postNum}` : 'CUP SOR';
      }
      if (jn === '235144' || jn.includes('235144')) {
        return 'CUP BRE';
      }
      if (jn === '266778' || jn.includes('266778')) {
        return postNum ? `SV SOR ${postNum}` : 'SV SOR';
      }
      if (jn === '267588' || jn.includes('267588')) {
        return 'SV BRE';
      }
      return postNum ? `${jn} ${postNum}` : (postDesc || jn);
    }

    function formatPassdownLine(sa) {
      const name = sa.name || 'Unknown Specialist';
      const eid = sa.eid || '';
      const dateStr = formatPassdownDate(sa.workDateNorm);
      const inTimeStr = formatMilitaryTime(sa.inTime);
      const outTimeStr = formatMilitaryTime(sa.outTime);
      const timeStr = `${inTimeStr}-${outTimeStr}`;
      const tag = getPassdownJobTag(sa);
      return `${name} (${eid}) - ${dateStr} ${timeStr} (${tag})`;
    }

    function copyWinTeamPassdown() {
      if (!state.sessionAssignments || state.sessionAssignments.length === 0) {
        showToast('No assignments in queue to copy.');
        return;
      }
      sortWinTeamQueue();
      const list = (state.winteamFilteredAssignments && state.winteamFilteredAssignments.length > 0)
        ? state.winteamFilteredAssignments
        : state.sessionAssignments;

      if (!list || list.length === 0) {
        showToast('No assignments match current filter to copy.');
        return;
      }
      const lines = list.map(sa => formatPassdownLine(sa));
      const text = lines.join('\n');
      const msg = (list.length === state.sessionAssignments.length)
        ? `${lines.length} shift(s) copied for passdown!`
        : `${lines.length} shift(s) copied for passdown (${state.sessionAssignments.length} total in queue)!`;
      copyToClipboard(text, msg);
    }

    function copyWinTeamPassdownForDay(dayKey) {
      const dayShifts = state.sessionAssignments.filter(s => (s.workDateNorm || 'Unscheduled') === dayKey);
      if (!dayShifts || dayShifts.length === 0) {
        showToast(`No assignments for ${dayKey} to copy.`);
        return;
      }
      const lines = dayShifts.map(sa => formatPassdownLine(sa));
      const text = lines.join('\n');
      copyToClipboard(text, `${lines.length} shift(s) on ${dayKey} copied for passdown!`);
    }

    function copySinglePassdown(shiftId) {
      const sa = state.sessionAssignments.find(s => s.shiftId === shiftId);
      if (!sa) {
        showToast('Shift not found in session queue.');
        return;
      }
      const line = formatPassdownLine(sa);
      copyToClipboard(line, `Copied passdown: ${line}`);
    }

    function exportWinTeamReport() {
      if (state.sessionAssignments.length === 0) {
        showToast('No assignments in session to export.');
        return;
      }
      const headers = ['EID', 'Specialist Name', 'WW Notes', 'WorkDate', 'InTime', 'OutTime', 'CountedHours', 'ExpectedOT', 'OTCauses', 'JobNumber', 'ScheduleDetailsID', 'JobDescription', 'PostDescription', 'MatchTier', 'Timestamp'];
      const csvRows = [headers.join(',')];
      state.sessionAssignments.forEach(sa => {
        const audit = getWinTeamOTAudit(sa);
        const otSummary = audit.hasExpectedOT ? `YES (+${audit.expectedOTHours.toFixed(1)}h)` : 'NO';
        const otCausesStr = audit.causes.map(c => `${c.label}: ${c.detail}`).join('; ') || 'None';
        csvRows.push([
          sa.eid,
          `"${sa.name.replace(/"/g, '""')}"`,
          `"${(sa.wwNotes || 'None').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`,
          sa.workDateNorm,
          sa.inTime,
          sa.outTime,
          sa.countedHours.toFixed(2),
          `"${otSummary}"`,
          `"${otCausesStr.replace(/"/g, '""')}"`,
          sa.jobNumber,
          `"${sa.scheduleDetailsId || ''}"`,
          `"${(sa.jobDesc || '').replace(/"/g, '""')}"`,
          `"${(sa.postDesc || '').replace(/"/g, '""')}"`,
          `"${sa.tier}"`,
          sa.timestamp
        ].join(','));
      });
      const weSuffix = state.lastDateOfWeek ? `_WE_${state.lastDateOfWeek.replace(/\//g, '_')}` : '';
      downloadFile(csvRows.join('\n'), `WinTeam_Assignments${weSuffix}.csv`, 'text/csv');
    }

    function exportUpdatedPPA() {
      if (!state.rawPPA) {
        showToast('Please upload a PPA.csv file before exporting.');
        return;
      }
      const lines = parseCSV(state.rawPPA);
      if (!lines || lines.length < 2) return;

      const header = lines[0];
      const eidCol = header.indexOf('EmployeeNumber');
      const empNameCol = header.indexOf('EmpName');
      const lastNameCol = header.indexOf('LastName');
      const firstNameCol = header.indexOf('FirstName');

      state.sessionAssignments.forEach(sa => {
        const shift = state.shifts.find(s => s.id === sa.shiftId);
        if (shift && shift.originalRowIndex < lines.length) {
          const row = lines[shift.originalRowIndex];
          if (eidCol !== -1) row[eidCol] = sa.eid;
          if (empNameCol !== -1) row[empNameCol] = sa.name;
          const nameParts = sa.name.split(' ');
          if (firstNameCol !== -1) row[firstNameCol] = nameParts[0] || '';
          if (lastNameCol !== -1) row[lastNameCol] = nameParts.slice(1).join(' ') || '';
        }
      });

      const csvContent = lines.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const weSuffix = state.lastDateOfWeek ? `_WE_${state.lastDateOfWeek.replace(/\//g, '_')}` : '';
      downloadFile(csvContent, `PPA_Updated${weSuffix}.csv`, 'text/csv');
      showToast('Exported updated PPA.csv with new assignments!');
    }

    // --- KPI & AUDIT COUNTS UPDATE ---
    function updateKPISummaries() {
      const openShifts = state.shifts.filter(s => s.isOpen && !s.assignedEmployee);
      const openHours = openShifts.reduce((acc, s) => acc + s.countedHours, 0.0);
      const filledShifts = state.sessionAssignments;
      const filledHours = filledShifts.reduce((acc, sa) => acc + sa.countedHours, 0.0);

      document.getElementById('kpiOpenShifts').textContent = openShifts.length;
      document.getElementById('kpiOpenHours').textContent = `(${openHours.toFixed(1)} Hours)`;
      document.getElementById('kpiFilledCount').textContent = filledShifts.length;
      document.getElementById('kpiFilledHours').textContent = `(${filledHours.toFixed(1)} Hours)`;

      // Count specialists over 45 hours based on authoritative WinTeam law
      const otSpecialists = state.employees.filter(e => e.actualHours > 45.0);
      document.getElementById('kpiOvertimeCount').textContent = otSpecialists.length;

      // Update Overtime Approvals Count Badges (Company-Wide)
      const companyOT = getCompanyOTApprovals();
      const badgeOTCount = document.getElementById('badgeOTApprovalsCount');
      if (badgeOTCount) {
        const tags = [];
        if (companyOT.sixthDay) tags.push('6D');
        if (companyOT.seventhDay) tags.push('7D');
        if (companyOT.dailyCap > 8) tags.push(`${companyOT.dailyCap}h`);
        badgeOTCount.textContent = tags.length > 0 ? tags.join(' • ') : 'Standard';
      }
      const simAuditOTCount = document.getElementById('simAuditOTCount');
      if (simAuditOTCount) {
        const tags = [];
        if (companyOT.sixthDay) tags.push('6th Day');
        if (companyOT.seventhDay) tags.push('7th Day');
        if (companyOT.dailyCap > 8) tags.push(`${companyOT.dailyCap}h Cap`);
        simAuditOTCount.textContent = tags.length > 0 ? `Company OT: ${tags.join(', ')}` : 'Standard 5-Day / 8h Cap (No OT)';
      }

      // Discrepancy counts
      let discCount = 0, ghostCount = 0, missingCount = 0;
      state.employees.forEach(emp => {
        if (Math.abs(emp.actualHours - emp.sheetHours) >= 0.01) discCount++;
        state.dates.forEach(dt => {
          const wwMark = emp.daily[dt] ? (emp.daily[dt].wwReferenceWT || emp.daily[dt].wt) : '';
          const shifts = state.empDayWorkingShifts[emp.eid] ? state.empDayWorkingShifts[emp.eid][dt] : [];
          // WW sheet marked '1', but WinTeam has no shift (Dictated by WinTeam as Off)
          if (wwMark === '1' && (!shifts || shifts.length === 0)) ghostCount++;
          // WinTeam has shift, but WW sheet was blank
          if (wwMark !== '1' && shifts && shifts.length > 0) missingCount++;
        });
      });

      document.getElementById('kpiDiscrepanciesCount').textContent = discCount;
      document.getElementById('kpiGhostWTCount').textContent = ghostCount;
      document.getElementById('kpiMissingWTCount').textContent = missingCount;

      const optAll = document.getElementById('optFilterAll');
      if (optAll) {
        optAll.textContent = `All Specialists (${state.employees.length})`;
      }

      const badgeGT = document.getElementById('badgeGroundTruth');
      if (badgeGT) {
        if (state.shifts.length > 0 || state.employees.length > 0) {
          badgeGT.classList.remove('hidden');
        } else {
          badgeGT.classList.add('hidden');
        }
      }
    }

    function filterRosterBy(mode) {
      document.getElementById('selectGridFilter').value = mode;
      renderWorkingWeeksGrid();
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }

    function resetGridFilters() {
      document.getElementById('inputGridSearch').value = '';
      document.getElementById('selectGridFilter').value = 'all';
      renderWorkingWeeksGrid();
    }

    // --- MODE SWITCHING ---
    function switchMainTab(tab) {
      if (tab === 'grid') tab = 'people';
      if (tab === 'queue') tab = 'shift';
      state.activeTab = tab;

      const viewPeople = document.getElementById('viewWorkingWeeksGrid');
      const viewShift = document.getElementById('viewShiftFirst');
      const btnPeople = document.getElementById('modeBtnPeople');
      const btnShift = document.getElementById('modeBtnShift');
      const linkerBar = document.querySelector('section.sticky.top-\\[57px\\]');

      if (tab === 'people') {
        if (viewPeople) viewPeople.classList.remove('hidden');
        if (viewShift) viewShift.classList.add('hidden');
        if (linkerBar) linkerBar.classList.remove('hidden');

        if (btnPeople) {
          btnPeople.className = 'px-3.5 py-1.5 rounded-md bg-blue-600 text-white shadow-sm flex items-center gap-2 transition-all';
        }
        if (btnShift) {
          btnShift.className = 'px-3.5 py-1.5 rounded-md text-slate-300 hover:text-white flex items-center gap-2 transition-all';
        }
        renderWorkingWeeksGrid();
      } else {
        if (viewPeople) viewPeople.classList.add('hidden');
        if (viewShift) viewShift.classList.remove('hidden');
        if (linkerBar) linkerBar.classList.add('hidden');

        if (btnPeople) {
          btnPeople.className = 'px-3.5 py-1.5 rounded-md text-slate-300 hover:text-white flex items-center gap-2 transition-all';
        }
        if (btnShift) {
          btnShift.className = 'px-3.5 py-1.5 rounded-md bg-blue-600 text-white shadow-sm flex items-center gap-2 transition-all';
        }
        renderShiftFirstView();
      }
    }

    // --- UPLOAD MODAL & FILE HANDLING ---
    function openUploadModal() {
      document.getElementById('modalUpload').classList.remove('hidden');
    }

    function closeUploadModal() {
      document.getElementById('modalUpload').classList.add('hidden');
    }

    function handleFileUpload(event, type) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        const content = e.target.result;
        if (type === 'ppa') {
          state.rawPPA = content;
          loadPPA(content);
          const st = document.getElementById('uploadStatusPPA');
          if (st) {
            st.textContent = `Loaded ${file.name} (${state.shifts.length} shifts)`;
            st.className = 'text-[11px] text-emerald-600 font-semibold mt-2';
          }
        } else {
          state.rawWW = content;
          loadWorkingWeeks(content);
          const st = document.getElementById('uploadStatusWW');
          if (st) {
            st.textContent = `Loaded ${file.name} (${state.employees.length} specialists)`;
            st.className = 'text-[11px] text-emerald-600 font-semibold mt-2';
          }
        }
        renderDayHeaders();
        calculateAllHours();
        populateLinkingShiftDropdown();
        updateKPISummaries();
        renderWorkingWeeksGrid();
        renderShiftFirstView();
        showToast(`Loaded ${file.name} successfully.`);
      };
      reader.readAsText(file);
    }

    // --- UTILITIES ---
    function toggleExportMenu() {
      document.getElementById('exportDropdownMenu').classList.toggle('hidden');
    }

    document.addEventListener('click', function (e) {
      const btn = document.getElementById('btnExportMenu');
      const menu = document.getElementById('exportDropdownMenu');
      if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function copyToClipboard(text, message = 'Copied to clipboard!') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(message));
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(message);
      }
    }

    function downloadFile(content, fileName, mimeType) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function showToast(message) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg border border-slate-800 flex items-center gap-2 pointer-events-auto transition-all animate-in fade-in slide-in-from-bottom-2 duration-150';
      toast.innerHTML = `
        <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        <span>${escapeHtml(message)}</span>
      `;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 200);
      }, 3000);
    }

    
    // --- GLOBAL DRAG AND DROP FILE LISTENER ---
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      loadOTApprovalsFromStorage();
      initData();
    });
  