/* =========================================================================
   views/dashboard.js — نما داشبورد (§57-§59، §52)
   -------------------------------------------------------------------------
   این نما هیچ محاسبه‌ای انجام نمی‌دهد؛ فقط از موتور محاسبهٔ مرکزی
   (RM.calcEngine) تغذیه می‌کند (Single Source of Truth — §105).
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const db = RM.db.db;

  const Dashboard = { _state: null };   // آخرین وضعیت محاسبه (برای Drill-down هشدارها)

  Dashboard._avgMachines = null;       // دستگاه‌های روشنِ میانگین ماتریس (نسخهٔ ۳٫۵ — تغییر ۴): null = هنوز بارگذاری نشده

  /* ================================================================
     موتور نمودارهای ECharts (نسخهٔ ۲٫۳ — کاملاً لوکال)
     ----------------------------------------------------------------
     - کتابخانه از lib/echarts.min.js لوکال بارگذاری می‌شود (بدون CDN)
     - رنگ‌ها از همان پالت CSS (زمردی/فیروزه‌ای/کهربایی/رز) — بدون آبی
     - تم روشن/تاریک پشتیبانی می‌شود (با تغییر تم، نمودارها تازه می‌شوند)
     - در نبود کتابخانه → Fallback به نمودار CSS قبلی (آفلاین مقاوم)
     ================================================================ */

  Dashboard._charts = {};          // id → نمونهٔ echarts
  Dashboard._pendingCharts = false; // دادهٔ تازه در تب مخفی — هنگام نمایش رندر شود

  /** آیا ECharts لوکال در دسترس است؟ */
  Dashboard.hasECharts = function () {
    return typeof window.echarts !== 'undefined';
  };

  /** پالت رنگ متن/محور بر اساس تم فعال */
  Dashboard.chartPalette = function () {
    const dark = document.documentElement.dataset.theme === 'dark';
    return {
      dark,
      fontFamily: "'Vazirmatn', 'Tahoma', sans-serif",
      text: dark ? '#d4d8dc' : '#21262b',
      muted: dark ? '#9aa0a7' : '#575e66',
      faint: dark ? '#6b7280' : '#878e95',
      splitLine: dark ? 'rgba(255,255,255,0.09)' : 'rgba(33,38,43,0.08)',
      axisLine: dark ? 'rgba(255,255,255,0.16)' : 'rgba(33,38,43,0.14)',
      tooltipBg: dark ? '#22262b' : '#fcfcfa',
      tooltipBorder: dark ? 'rgba(255,255,255,0.16)' : '#dcded2',
      // رنگ‌های کسب‌وکار — همان متغیرهای CSS
      raw: '#047857',      // زمردی
      metal: '#b45309',    // کهربایی
      setup: '#0f766e',    // فیروزه‌ای
      uncut: '#be123c',    // رز
      gray: dark ? '#7c848c' : '#a3a89e',
    };
  };

  /** ساخت/بازیابی نمونهٔ چارت با شناسهٔ المان */
  Dashboard.chartOf = function (elId) {
    const el = document.getElementById(elId);
    if (!el || !Dashboard.hasECharts()) return null;
    if (Dashboard._charts[elId]) return Dashboard._charts[elId];
    if (!el.clientWidth) return null;   // مخفی است — هنگام نمایش ساخته می‌شود
    const inst = window.echarts.init(el);
    Dashboard._charts[elId] = inst;
    return inst;
  };

  /** اعمال گزینه‌ها روی چارت (بدون Merge — رندر تازه) */
  Dashboard.applyChart = function (elId, option) {
    const inst = Dashboard.chartOf(elId);
    if (!inst) { Dashboard._pendingCharts = true; return false; }
    inst.setOption(option, { notMerge: true });
    return true;
  };

  /** حذف امن نمونهٔ چارت (حالت خالی — جلوگیری از نمونهٔ سرگردان) */
  Dashboard.disposeChart = function (elId) {
    if (Dashboard._charts[elId]) {
      try { Dashboard._charts[elId].dispose(); } catch (e) { /* noop */ }
      delete Dashboard._charts[elId];
    }
  };

  /** رندر مجدد همهٔ نمودارها (تعویض تم / بازگشت به تب) — نسخهٔ ۲٫۴:
      میله‌ای دستگاه‌ها + دو دونات زمان + نمودار ستونی ستاپ‌ها + نمودار افقی عرض‌ها (۳٫۱) */
  Dashboard.rerenderCharts = function () {
    if (!Dashboard._state) return;
    const s = Dashboard._state.summary;
    if (s.timeRulesCount) {
      Dashboard.renderMachineTimeChart(Dashboard._state);
      Dashboard.renderTimeDonuts(Dashboard._state);
      Dashboard.renderSetupInventoryColumnChart(Dashboard._state);
    }
    Dashboard.renderWidthInventoryChart(Dashboard._state);   // نسخهٔ ۳٫۱ — تغییر ۵
    Dashboard._pendingCharts = false;
  };

  /** هوک نمایش تب — نمودارهای معوق/تازه‌شده را رندر می‌کند */
  Dashboard.onShown = function () {
    // اگر المان مخفی بوده و چارت ساخته نشده → ساخت پس از نمایان شدن
    for (const id of Object.keys(Dashboard._charts)) {
      Dashboard._charts[id].resize();
    }
    Dashboard.rerenderCharts();
  };

  /* ---------- تغییر اندازهٔ پنجره → مقیاس‌دهی مجدد ---------- */
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      Object.values(Dashboard._charts).forEach((c) => { try { c.resize(); } catch (e) { /* noop */ } });
    }, 180);
  });

  /* ---------- تغییر تم → رنگ‌های نمودار تازه ---------- */
  if (typeof MutationObserver !== 'undefined') {
    const themeObserver = new MutationObserver(() => Dashboard.rerenderCharts());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** رندر کامل داشبورد از وضعیت محاسبه‌شده */
  Dashboard.render = async function (state) {
    Dashboard._state = state;   // برای Drill-down هشدارها و نمودارها
    const s = state.summary;

    /* مبنای ماندگار نمودار عرض‌ها + بستن دکمه‌ها (نسخهٔ ۳٫۱ — تغییر ۵) */
    await Dashboard.initWidthBasis();

    /* دستگاه‌های روشنِ ردیف میانگین ماتریس (نسخهٔ ۳٫۵ — تغییر ۴) */
    if (!Dashboard._avgMachines) {
      const saved = await RM.db.getSetting('matrixAvgMachines', null);
      Dashboard._avgMachines = Array.isArray(saved) && saved.length ? saved : null;   // null = همه روشن
    }

    /* ---------- کارت «رول‌های خام» (منطق جدید §58-§59 + نسخهٔ ۳٫۴ — تغییر ۳) ----------
       دو آمار کاربردی کلیک‌پذیر جایگزین اطلاعات قبلی کارت شد:
         ۱) تعداد رول‌های خام با گرید T → مودال لیست + پنل شخصی‌سازی ستون‌ها
         ۲) تعداد رول‌های تطبیق‌داده‌نشده با ستاپ‌ها → همان مودال */
    document.getElementById('kpi-raw').textContent = U.faNum(s.rawRollsCount);
    const rawActions = document.getElementById('kpi-raw-actions');
    if (rawActions) {
      rawActions.innerHTML = `
        <button type="button" class="kpi-act-row" data-raw-drill="gradeT"
                title="مشاهدهٔ رول‌های خام با گرید T به همراه مشخصات کامل">
          <span class="kpi-act-badge">T</span>
          <span class="kpi-act-label">رول های خام با گرید T</span>
          <b class="kpi-act-value">${U.faNum(s.rawGradeTCount)}</b>
          <span class="kpi-act-hint" aria-hidden="true">مشاهده ←</span>
        </button>
        <button type="button" class="kpi-act-row kpi-act-warn" data-raw-drill="unmatched"
                title="مشاهدهٔ رول‌هایی که با ستاپ‌ها تطبیق داده نشده‌اند">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <span class="kpi-act-label">رول هایی که ستاپ ندارند</span>
          <b class="kpi-act-value">${U.faNum(s.rawUnmatchedCount)}</b>
          <span class="kpi-act-hint" aria-hidden="true">مشاهده ←</span>
        </button>`;
      rawActions.querySelectorAll('[data-raw-drill]').forEach((btn) => {
        btn.addEventListener('click', () => Dashboard.openRawCardDrill(btn.dataset.rawDrill));
      });
    }

    /* ---------- کارت‌های مانده زمان متالایز (تغییرات جدید — جایگزین کارت‌های
       «رول‌های متالایز شده» و «کل رول‌های ستاپ‌ها») ---------- */
    if (!s.timeRulesCount) {
      // هیچ قانون زمانی تعریف نشده — کارت‌ها و چارت حالت خالی
      document.getElementById('kpi-remaining-setup').textContent = '—';
      document.getElementById('kpi-remaining-setup-meta').textContent =
        'قانون زمان متالایز تعریف نشده — از تنظیمات «قانون زمان متالایز» اضافه کنید.';
      document.getElementById('kpi-remaining-produced').textContent = '—';
      document.getElementById('kpi-remaining-produced-meta').textContent =
        'قانون زمان متالایز تعریف نشده — از تنظیمات «قانون زمان متالایز» اضافه کنید.';
      document.getElementById('machine-time-chips').innerHTML =
        '<span class="chip chip-warn">قانون زمان تعریف نشده</span>';
      Dashboard.disposeChart('machine-time-chart');
      document.getElementById('machine-time-footer').innerHTML = '';
      document.getElementById('machine-time-chart').innerHTML = `
        <div class="empty-state">
          ${UI.icons.alert}
          <p>برای نمایش گزارش مانده زمان متالایز، ابتدا در تب «تنظیمات» برای هر دستگاه قانون زمان تعریف کنید:<br>
          (شماره دستگاه، متراژ استاندارد، تعداد در شیفت → مدت زمان خودکار = ۷۲۰ ÷ تعداد)</p>
        </div>`;
      // دونات‌ها و نمودار ستونی نیز بدون قانون زمان محاسبه نمی‌شوند (نسخهٔ ۲٫۴)
      const emptyCharts = ['inventory-time-chart', 'setup-time-chart', 'setup-inventory-chart'];
      for (const id of emptyCharts) {
        Dashboard.disposeChart(id);
        const el = document.getElementById(id);
        if (el) el.innerHTML = `
          <div class="empty-state" style="min-height:220px">
            ${UI.icons.alert}
            <p>قانون زمان متالایز تعریف نشده — از تب «تنظیمات» قانون زمان اضافه کنید.</p>
          </div>`;
      }
    } else {
      document.getElementById('kpi-remaining-setup').textContent = U.hoursOf(s.totalRemainingSetupTime) !== null
        ? `${U.faNum(U.hoursOf(s.totalRemainingSetupTime))} ساعت`
        : '—';
      document.getElementById('kpi-remaining-setup-meta').innerHTML =
        `دقیق: ${U.faHMM(s.totalRemainingSetupTime)} · ` +
        `${U.faNum(s.timeRuleCoverage.covered)} رکورد دارای قانون` +
        (s.timeRuleCoverage.uncovered > 0
          ? ` · ⚠ ${U.faNum(s.timeRuleCoverage.uncovered)} رکورد بدون قانون`
          : '');

      document.getElementById('kpi-remaining-produced').textContent = U.hoursOf(s.totalRemainingProducedTime) !== null
        ? `${U.faNum(U.hoursOf(s.totalRemainingProducedTime))} ساعت`
        : '—';
      document.getElementById('kpi-remaining-produced-meta').innerHTML =
        `دقیق: ${U.faHMM(s.totalRemainingProducedTime)} · تفاوت با ستاپ: ${U.faHMM(
          s.totalRemainingSetupTime - s.totalRemainingProducedTime
        )} (زمان رول‌های متالایزشده)`;

      Dashboard.renderMachineTimeChart(state);

      /* ---------- دو دونات زمان (نسخهٔ ۲٫۴ — جایگزین دونات وضعیت خام) ---------- */
      Dashboard.renderTimeDonuts(state);

      /* ---------- نمودار ستونی مانده زمان موجودی همهٔ ستاپ‌ها (نسخهٔ ۲٫۴) ---------- */
      Dashboard.renderSetupInventoryColumnChart(state);
    }

    /* ---------- نمودار افقی عرض‌های رول (نسخهٔ ۳٫۱ — تغییر ۵) ----------
       مستقل از قوانین زمان — از ستون‌های خام موجود/تعداد گزارش ستاپ‌ها تغذیه می‌شود. */
    Dashboard.renderWidthInventoryChart(state);

    const uncutValue = document.getElementById('kpi-uncut');
    uncutValue.textContent = U.faNum(s.totalUncut);

    // فرمول شفاف برش‌نشده (§51 — مغایرت پنهان نمی‌شود)
    document.getElementById('kpi-uncut-meta').innerHTML =
      `Σ [ستاپ − (خام + متالایز)] = ${U.faNum(s.totalSetupRolls)} − ` +
      `(${U.faNum(s.rawMatchedCount)} + ${U.faNum(s.metallizedAllocated)})` +
      (s.totalConflict > 0
        ? `<br>⚠ مغایرت ظرفیت: ${U.faNum(s.totalConflict)} رول (در گزارش ستاپ‌ها)`
        : '');

    // حالت هشدار کارت برش‌نشده (مغایرت ظرفیت)
    const uncutCard = uncutValue.closest('.kpi-card');
    uncutCard.classList.toggle('negative', s.totalConflict > 0);

    /* ---------- کارت «رول‌های برش‌نشده» — ردیف کلیک‌پذیر (نسخهٔ ۳٫۵ — تغییر ۳) ----------
       مانند کارت «رول‌های خام»: با کلیک، رکوردهای «گزارش تولید ستاپ‌ها» که
       برش‌نشده دارند (uncut > 0) در مودال با پنل شخصی‌سازی ستون‌ها نمایش
       داده می‌شوند (فونت وزیر — انتخاب و ترتیب ماندگار). */
    const uncutActions = document.getElementById('kpi-uncut-actions');
    if (uncutActions) {
      const uncutSetupRows = (state.setupReport || []).filter((r) => r.uncut > 0);
      uncutActions.innerHTML = `
        <button type="button" class="kpi-act-row kpi-act-uncut" data-uncut-drill="1"
                title="مشاهدهٔ رکوردهای ستاپ‌های برش‌نشده به همراه مشخصات کامل">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
          <span class="kpi-act-label">عرض های برش نشده ستاپ</span>
          <b class="kpi-act-value">${U.faNum(uncutSetupRows.length)}</b>
          <span class="kpi-act-hint" aria-hidden="true">مشاهده ←</span>
        </button>`;
      const uncutBtn = uncutActions.querySelector('[data-uncut-drill]');
      if (uncutBtn) uncutBtn.addEventListener('click', () => Dashboard.openUncutDrill());
    }

    /* ---------- مرکز هشدار کیفیت داده (§52 — B) ---------- */
    Dashboard.renderAlerts(state.warnings);

    /* ---------- اطلاعات فایل‌ها (§12) ---------- */
    await Dashboard.renderImportBadges();
  };

  /* ---------- Drill-down دو آمار کارت «رول‌های خام» (نسخهٔ ۳٫۴ — تغییر ۳) ----------
     هر دو از مودال مشترک با پنل شخصی‌سازی ستون‌های جزئیات استفاده می‌کنند. */
  Dashboard.openRawCardDrill = async function (kind) {
    try {
      if (kind === 'gradeT') {
        // رول‌های خام (نوع فیلم دارای R + پالت خالی) با گرید T — با اعمال ویرایش‌های کاربر
        const all = await RM.edits.applyToRecords('rolls', await db.rolls.toArray());
        const records = all.filter((r) => RM.normalize.isRawRoll(r) && RM.normalize.gradeLetter(r) === 'T');
        await UI.recordsDrillModal('رول‌های خام با گرید T', records, {
          source: 'rolls',
          subtitle: 'رول‌های خام (نوع فیلم دارای R + پالت خالی) با گرید T:',
        });
      } else {
        // رول‌های خامی که به هیچ ستاپی تخصیص نخورده‌اند (شناسه‌ها از موتور محاسبه)
        const state = Dashboard._state;
        const ids = (state && state.meta && state.meta.rawUnmatchedRollIds) || [];
        const got = ids.length ? await db.rolls.bulkGet(ids) : [];
        const records = await RM.edits.applyToRecords('rolls', got.filter(Boolean));
        await UI.recordsDrillModal('رول‌های خام تطبیق‌داده‌نشده با ستاپ‌ها', records, {
          source: 'rolls',
          subtitle: 'رول‌هایی که با ستاپ‌ها تطبیق داده نشده‌اند (گروه بدون ستاپ/قانون متراژ یا ظرفیت پر):',
        });
      }
    } catch (err) {
      console.error('[RawCardDrill]', err);
      UI.toast('نمایش رکوردهای این بخش با خطا مواجه شد.', 'error');
    }
  };

  /* ---------- Drill-down رکوردهای ستاپ‌های برش‌نشده (نسخهٔ ۳٫۵ — تغییر ۳) ----------
     رکوردهای «گزارش تولید ستاپ‌ها» با برش‌نشدهٔ مثبت، در جدول صفحه‌بندی‌شده
     با پنل شخصی‌سازی ستون‌ها (همان الگوی مودال‌های رکورد — چیپ‌های انتخاب و
     ترتیب، ماندگار در appSettings: uncutDrillColumns). */
  Dashboard.SETUP_DRILL_FIELDS = [
    { key: 'setupNumber',  label: 'ستاپ' },
    { key: 'machineNumber', label: 'دستگاه' },
    { key: 'width',        label: 'عرض' },
    { key: 'rollCount',    label: 'تعداد در ستاپ' },
    { key: 'rawExisting',  label: 'خام موجود' },
    { key: 'metallized',   label: 'متالایز' },
    { key: 'uncut',        label: 'برش‌نشده' },
    { key: 'conflict',     label: 'مغایرت ظرفیت' },
    { key: 'productionLine', label: 'خط تولید' },
    { key: 'hallNumber',   label: 'سالن' },
    { key: 'setupDate',    label: 'تاریخ ستاپ' },
    { key: 'thickness',    label: 'ضخامت' },
    { key: 'standardLength', label: 'متراژ استاندارد' },
    { key: 'remainingSetupTime', label: 'مانده زمان ستاپ' },
    { key: 'remainingProducedTime', label: 'مانده زمان موجودی' },
    { key: 'timeStatus',   label: 'وضعیت' },
  ];

  Dashboard.UNCUT_DRILL_DEFAULT = ['setupNumber', 'machineNumber', 'width', 'rollCount', 'rawExisting', 'metallized', 'uncut'];

  /** رندر سلول هر فیلد ستاپ در جدول دریل */
  Dashboard.setupDrillCell = function (r, key) {
    const v = r[key];
    switch (key) {
      case 'width': return v === null || v === undefined ? '<span class="muted">—</span>' : U.faWidth(v);
      case 'setupDate': return U.escapeHtml(U.faDateTime(v));
      case 'productionLine':
        return v
          ? `<span class="line-badge line-${U.escapeHtml(String(v).toLowerCase())}" title="خط تولید">${U.escapeHtml(String(v))}</span>`
          : '<span class="muted">—</span>';
      case 'remainingSetupTime':
      case 'remainingProducedTime':
        return v === null || v === undefined ? '<span class="muted">بدون قانون</span>' : U.faHMM(v);
      case 'timeStatus':
        return v === 'done' ? '<span class="pill-ok status-pill">تمام شده</span>'
          : v === 'remaining' ? '<span class="pill-bad status-pill">باقی مانده</span>'
          : '<span class="muted">نامشخص</span>';
      case 'uncut':
        return v > 0 ? `<b class="uncut-cell">${U.faNum(v)}</b>` : '<span class="muted">۰</span>';
      case 'conflict':
        return v > 0 ? `<span class="pill-bad status-pill">⚠ ${U.faNum(v)}</span>` : '—';
      default:
        return (v === null || v === undefined || v === '') ? '<span class="muted">—</span>' : U.faNum(v);
    }
  };

  /** تغییر ترتیب/انتخاب ستون‌های دریل ستاپ (خالص — با حداقل یک ستون) */
  Dashboard.applySetupDrillColumnsChange = function (current, key, action) {
    let next = [...current];
    const i = next.indexOf(key);
    if (action === 'on' && i === -1) next.push(key);
    else if (action === 'off' && i !== -1) next.splice(i, 1);
    else if (action === 'up' && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    else if (action === 'down' && i !== -1 && i < next.length - 1) [next[i + 1], next[i]] = [next[i], next[i + 1]];
    if (!next.length) next = [...Dashboard.UNCUT_DRILL_DEFAULT];
    return next;
  };

  /** پنل شخصی‌سازی ستون‌های دریل ستاپ (چیپ‌ها — همان الگوی مشترک مودال‌ها) */
  Dashboard.mountSetupDrillPicker = async function (mountEl, onChange) {
    if (!mountEl) return;
    const selected = await RM.db.getSetting('uncutDrillColumns', Dashboard.UNCUT_DRILL_DEFAULT)
      || [...Dashboard.UNCUT_DRILL_DEFAULT];

    // حفظ وضعیت باز/بستهٔ آکاردئون در رندرهای مجدد
    const prevDetails = mountEl.querySelector('details.detail-cols-picker');
    const prevOpen = !!(prevDetails && prevDetails.open);

    const labelOf = (k) => U.escapeHtml(
      (Dashboard.SETUP_DRILL_FIELDS.find((f) => f.key === k) || {}).label || k
    );
    const chip = (k, on) => on
      ? `<span class="detail-chip on">
           <button type="button" data-scol-up="${k}" title="انتقال به قبل" aria-label="انتقال به قبل">↑</button>
           <button type="button" data-scol-down="${k}" title="انتقال به بعد" aria-label="انتقال به بعد">↓</button>
           <b>${labelOf(k)}</b>
           <button type="button" data-scol-off="${k}" title="حذف ستون" aria-label="حذف ستون">×</button>
         </span>`
      : `<span class="detail-chip">
           <button type="button" data-scol-on="${k}" title="افزودن ستون" aria-label="افزودن ستون">+ ${labelOf(k)}</button>
         </span>`;

    const selectedSet = new Set(selected);
    mountEl.innerHTML =
      `<details class="detail-cols-picker"${prevOpen ? ' open' : ''}>
         <summary>ستون‌های جزئیات (انتخاب و ترتیب — ذخیره می‌شود)</summary>
         <div class="detail-chips">
           ${selected.map((k) => chip(k, true)).join('')}
           ${Dashboard.SETUP_DRILL_FIELDS.filter((f) => !selectedSet.has(f.key)).map((f) => chip(f.key, false)).join('')}
         </div>
       </details>`;

    const apply = async (key, action) => {
      const next = Dashboard.applySetupDrillColumnsChange(selected, key, action);
      await RM.db.setSetting('uncutDrillColumns', next);
      if (onChange) await onChange();
    };
    mountEl.querySelectorAll('[data-scol-on]').forEach((b) =>
      b.addEventListener('click', () => apply(b.dataset.scolOn, 'on')));
    mountEl.querySelectorAll('[data-scol-off]').forEach((b) =>
      b.addEventListener('click', () => apply(b.dataset.scolOff, 'off')));
    mountEl.querySelectorAll('[data-scol-up]').forEach((b) =>
      b.addEventListener('click', () => apply(b.dataset.scolUp, 'up')));
    mountEl.querySelectorAll('[data-scol-down]').forEach((b) =>
      b.addEventListener('click', () => apply(b.dataset.scolDown, 'down')));
  };

  /** مودال رکوردهای ستاپ‌های برش‌نشده (با پنل شخصی‌سازی ستون‌ها) */
  Dashboard.openUncutDrill = async function () {
    try {
      const state = Dashboard._state;
      const rows = (state && state.setupReport ? state.setupReport : [])
        .filter((r) => r.uncut > 0)
        .sort((a, b) => (a.setupNumber || 0) - (b.setupNumber || 0) || (a.width || 0) - (b.width || 0));
      const totalUncut = rows.reduce((s, r) => s + r.uncut, 0);

      /* ۳٫۲۹: مودال عریض — مانند مودال‌های دارای پنل «ستون‌های جزئیات»
         (همند «رول‌های خام با گرید T») تا ستون‌های جدول به‌خوبی جا شوند. */
      UI.infoModal('ستاپ‌های برش‌نشده', `
        <div class="drill-subtitle">
          رکوردهای «گزارش تولید ستاپ‌ها» با رول برش‌نشده — فرمول: تعداد − (خام موجود + متالایز):
          <b>${U.faNum(rows.length)}</b> رکورد · جمع برش‌نشده: <b>${U.faNum(totalUncut)}</b> رول
        </div>
        <div id="uncut-cols-picker"></div>
        <div id="uncut-table-wrap"></div>
      `, { wide: true });

      const renderTable = async () => {
        const selected = await RM.db.getSetting('uncutDrillColumns', Dashboard.UNCUT_DRILL_DEFAULT)
          || [...Dashboard.UNCUT_DRILL_DEFAULT];
        const columns = selected
          .filter((k) => Dashboard.SETUP_DRILL_FIELDS.some((f) => f.key === k))
          .map((k) => ({
            key: k,
            label: U.escapeHtml((Dashboard.SETUP_DRILL_FIELDS.find((f) => f.key === k) || {}).label || k),
            className: k === 'uncut' ? 'em-cell' : '',
            render: (r) => Dashboard.setupDrillCell(r, k),
          }));
        const renderPage = (page) => {
          UI.renderTable(document.getElementById('uncut-table-wrap'), columns, rows, {
            page,
            pageSize: RM.config.PAGE_SIZE,
            emptyText: 'رکوردی برای نمایش یافت نشد.',
            onPageChange: (nextPage) => renderPage(nextPage),
          });
        };
        renderPage(1);
      };

      const mountPicker = async () => {
        await Dashboard.mountSetupDrillPicker(
          document.getElementById('uncut-cols-picker'),
          async () => {
            await mountPicker();
            await renderTable();
          }
        );
      };
      await mountPicker();
      await renderTable();
    } catch (err) {
      console.error('[UncutDrill]', err);
      UI.toast('نمایش رکوردهای این بخش با خطا مواجه شد.', 'error');
    }
  };

  /* ---------- چارت مانده زمان متالایز به تفکیک دستگاه (نسخهٔ ۲٫۳ — ECharts) ---------- */

  /**
   * نمودار میله‌ای افقی گروهی ECharts — هر دستگاه (۱/۲/۳) دو میله:
   *   «مانده زمان ستاپ» (فیروزه‌ای) و «مانده زمان موجودی» (کهربایی).
   * نسخهٔ ۲٫۵ — راست‌به‌چپ: نام دستگاه‌ها در سمت راست (yAxis position:right)
   * و میله‌ها از راست (کنار نام‌ها) به چپ رشد می‌کنند (xAxis inverse).
   * Tooltip فارسی با مدت دقیق + برچسب ساعت روی محور. Fallback: میله‌های CSS.
   * زیر نمودار: آمار دوخطی (کمترین دستگاه + میانگین) — نسخهٔ ۲٫۴.
   */
  Dashboard.renderMachineTimeChart = function (state) {
    const s = state.summary;
    const machines = RM.config.VALID_MACHINES;

    // بیشینه برای مقیاس
    let maxVal = 0;
    for (const m of machines) {
      const t = s.machineTime[m];
      if (t) maxVal = Math.max(maxVal, t.setup, t.produced);
    }

    const chipsEl = document.getElementById('machine-time-chips');
    chipsEl.innerHTML = `
      <span class="chip">قوانین زمان: ${U.faNum(s.timeRulesCount)}</span>
      <span class="chip chip-strong">جمع مانده زمان ستاپ: ${U.faHMM(s.totalRemainingSetupTime)}</span>
      <span class="chip chip-ok">جمع مانده زمان موجودی: ${U.faHMM(s.totalRemainingProducedTime)}</span>
      ${s.timeRuleCoverage.uncovered > 0
        ? `<span class="chip chip-warn">${U.faNum(s.timeRuleCoverage.uncovered)} رکورد بدون قانون</span>`
        : ''}
    `;

    /* ---------- جدول ماتریسی مانده زمان زیر نمودار (نسخهٔ ۳٫۴ — تغییر ۲) ----------
       دو ستون × دو ردیف — دقیقاً چیدمان خواسته‌شدهٔ کاربر:
         ستون‌ها: «رول‌های موجود» (مانده زمان موجودی — کهربایی، هماهنگ با چارت)
                  «رول‌های ستاپ»  (مانده زمان ستاپ — فیروزه‌ای، هماهنگ با چارت)
         ردیف‌ها: «کمترین مانده زمان» (کمترینِ هر ستون از میان دستگاه‌ها — ۳٫۲۵)
                  «میانگین دستگاه‌ها» (جمع ÷ تعداد دستگاه‌های روشن)
       هر سلول: مقدار [H]:mm درشت + «معادل روزانه: X روز» — طراحی کارت‌ماتریسی
       کاربرپسند با هدرهای رنگی و اعداد فارسی خوانا در یک نگاه.
       نسخهٔ ۳٫۵ — تغییر ۴: در ردیف «میانگین دستگاه‌ها» آیکون‌های ریز کلیک‌پذیر
       دستگاه‌ها درج شد — میانگین هر دو ستون فقط از دستگاه‌های روشن محاسبه
       می‌شود. انتخاب ماندگار است (appSettings: matrixAvgMachines).
       نسخهٔ ۳٫۲۴ — بند ۳ + اصلاح ۳٫۲۵: زیرنویس «دستگاه شماره n» حذف شد چون
       صاحبِ دو کمترین می‌تواند متفاوت باشد. نسخهٔ ۳٫۲۴ به‌اشتباه مبنای
       کمترین‌گیری را به «رکوردهای جدول ستاپ‌ها» برده بود؛ ۳٫۲۵ به‌فرمای کاربر
       به مبنای اصلیِ ۳٫۲۲ بازگشت: هر ستون به‌صورت مستقل از سطح دستگاه —
       ستون «رول‌های موجود» = مجموع مانده زمان موجودیِ دستگاهی که کمترین
       مجموع را دارد و ستون «رول‌های ستاپ» = مانده زمان ستاپِ دستگاهی که
       کمترین ستاپ را دارد (تولتیپ هر سلول شمارهٔ دستگاهِ صاحبِ همان کمترین
       را نشان می‌دهد؛ مثل ۳٫۲۲ بدون فیلتر مثبت‌بودن — دستگاهِ با مجموع ۰
       همان کمترین است). ردیف «میانگین دستگاه‌ها» میانگینِ سطح دستگاه از
       دستگاه‌های روشن است (جمع ÷ تعداد). */
    const producedOf = (m) => (s.machineTime[m] ? s.machineTime[m].produced : 0);
    const setupOf = (m) => (s.machineTime[m] ? s.machineTime[m].setup : 0);

    const mtCell = (minutes, cls, title) => `
      <div class="mtx-cell ${cls}"${title ? ` title="${title}"` : ''}>
        <span class="mtx-value">${U.faHMM(minutes)}</span>
        <span class="mtx-days">معادل روزانه: ${U.faDaysOf(minutes)}</span>
      </div>`;

    /* ماتریس: کمترینِ مستقلِ هر ستون از میان دستگاه‌ها + میانگینِ دستگاه‌های روشن (۳٫۲۵) */
    const renderMatrix = () => {
      /* ردیف «میانگین دستگاه‌ها» — منطق ۳٫۵ تا ۳٫۲۲ (بازگشت در ۳٫۲۴):
         میانگینِ سطح دستگاه از دستگاه‌های روشن (جمع ÷ تعداد). */
      const avgOn = Dashboard._avgMachines && Dashboard._avgMachines.length
        ? Dashboard._avgMachines.filter((m) => machines.includes(m))
        : [...machines];   // پیش‌فرض: همهٔ دستگاه‌ها روشن
      const machineCount = avgOn.length;
      const sumProduced = avgOn.reduce((acc, m) => acc + producedOf(m), 0);
      const sumSetup = avgOn.reduce((acc, m) => acc + setupOf(m), 0);
      const avgProduced = machineCount ? sumProduced / machineCount : 0;
      const avgSetup = machineCount ? sumSetup / machineCount : 0;

      /* ۳٫۲۵ — ردیف «کمترین مانده زمان»: بازگشت به مبنای سطح دستگاهِ ۳٫۲۲
         (درخواست صریح کاربر — ۳٫۲۴ به‌اشتباه از رکوردهای جدول ستاپ‌ها
         کمترین می‌گرفت). هر ستون مستقل است: ستون «رول‌های موجود» =
         مجموع مانده زمان موجودیِ دستگاهی که کمترین مجموع را دارد
         (machineTime[m].produced) و ستون «رول‌های ستاپ» = مانده زمان ستاپِ
         دستگاهی که کمترین ستاپ را دارد (machineTime[m].setup). مثل ۳٫۲۲
         فیلتری روی مثبت‌بودن نیست (دستگاهِ با مجموع ۰ همان کمترین است)؛
         صاحبِ دو کمترین می‌تواند متفاوت باشد — شمارهٔ دستگاهِ صاحبِ هر
         کمترین در تولتیپ همان سلول درج می‌شود. */
      let minInvTime = 0, minInvMachine = null;
      let minSetupTime = 0, minSetupMachine = null;
      for (const m of machines) {
        const p = producedOf(m);
        const st = setupOf(m);
        if (minInvMachine === null || p < minInvTime) { minInvTime = p; minInvMachine = m; }
        if (minSetupMachine === null || st < minSetupTime) { minSetupTime = st; minSetupMachine = m; }
      }
      const minInvTitle = minInvMachine !== null
        ? `کمترینِ مجموع «مانده زمان موجودی» دستگاه‌ها — دستگاه ${U.faNum(minInvMachine)}`
        : 'دستگاهی برای محاسبه وجود ندارد';
      const minSetupTitle = minSetupMachine !== null
        ? `کمترینِ «مانده زمان ستاپ» دستگاه‌ها — دستگاه ${U.faNum(minSetupMachine)}`
        : 'دستگاهی برای محاسبه وجود ندارد';

      document.getElementById('machine-time-footer').innerHTML = `
        <div class="mt-matrix" role="table" aria-label="مانده زمان متالایز — کمترین و میانگین به تفکیک رول‌های موجود و رول‌های ستاپ">
          <div class="mtx-row mtx-head" role="row">
            <span class="mtx-corner" role="columnheader"></span>
            <span class="mtx-colhead mtx-col-inv" role="columnheader">
              <span class="mtx-dot mtx-dot-inv" aria-hidden="true"></span> رول‌های موجود
            </span>
            <span class="mtx-colhead mtx-col-setup" role="columnheader">
              <span class="mtx-dot mtx-dot-setup" aria-hidden="true"></span> رول‌های ستاپ
            </span>
          </div>
          <div class="mtx-row" role="row">
            <span class="mtx-rowhead" role="rowheader" title="ستون «رول‌های موجود» = مجموع مانده زمان موجودیِ دستگاهِ دارای کمترین مجموع؛ ستون «رول‌های ستاپ» = مانده زمان ستاپِ دستگاهِ دارای کمترین — دستگاهِ صاحبِ هر کمترین در تولتیپ همان سلول (۳٫۲۵)">
              کمترین مانده زمان
              <!-- ۳٫۲۴/۳٫۲۵ — زیرنویس «دستگاه شماره n» حذف می‌ماند: کمترینِ
                   دو ستون (سطح دستگاه) می‌تواند متعلق به دستگاه‌های متفاوت
                   باشد؛ مبنای محاسبه از ۳٫۲۵ دوباره سطح دستگاه است (۳٫۲۲) -->
              <span class="mtx-sub">کمترینِ هر ستون از میان دستگاه‌ها</span>
            </span>
            ${mtCell(minInvTime, 'mtx-inv', minInvTitle)}
            ${mtCell(minSetupTime, 'mtx-setup', minSetupTitle)}
          </div>
          <div class="mtx-row" role="row">
            <span class="mtx-rowhead" role="rowheader" title="میانگین مانده زمان موجودی و ستاپِ دستگاه‌های روشن (جمع ÷ تعداد دستگاه‌ها)">
              میانگین دستگاه‌ها
              <span class="mtx-sub">${machineCount ? `${U.faNum(machineCount)} دستگاه` : 'دستگاهی انتخاب نشده'}</span>
              <span class="mtx-mach-btns" role="group" aria-label="انتخاب دستگاه‌های شرکت‌کننده در میانگین">
                ${machines.map((m) => `
                  <button type="button" class="mtx-mach${avgOn.includes(m) ? ' on' : ''}" data-mtx-mach="${m}"
                          aria-pressed="${avgOn.includes(m) ? 'true' : 'false'}"
                          title="${avgOn.includes(m)
                            ? `دستگاه ${U.faNum(m)} در میانگین است — برای حذف از میانگین کلیک کنید`
                            : `دستگاه ${U.faNum(m)} در میانگین نیست — برای افزودن به میانگین کلیک کنید`}">
                    <span class="mtx-mach-num">${U.faNum(m)}</span>
                  </button>`).join('')}
              </span>
            </span>
            ${machineCount
              ? mtCell(avgProduced, 'mtx-inv') + mtCell(avgSetup, 'mtx-setup')
              : `<div class="mtx-cell mtx-inv"><span class="mtx-value muted">—</span><span class="mtx-days">دستگاهی روشن نیست</span></div>
                 <div class="mtx-cell mtx-setup"><span class="mtx-value muted">—</span><span class="mtx-days">دستگاهی روشن نیست</span></div>`}
          </div>
        </div>`;

      // کلیدهای ریز دستگاه — روشن/خاموش + ذخیرهٔ ماندگار + محاسبهٔ مجدد
      document.querySelectorAll('[data-mtx-mach]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const m = Number(btn.dataset.mtxMach);
          const current = Dashboard._avgMachines && Dashboard._avgMachines.length
            ? [...Dashboard._avgMachines]
            : [...machines];
          const i = current.indexOf(m);
          if (i !== -1) current.splice(i, 1);
          else current.push(m);
          Dashboard._avgMachines = current;
          await RM.db.setSetting('matrixAvgMachines', current);
          renderMatrix();
          UI.toast(
            current.includes(m)
              ? `دستگاه ${U.faNum(m)} به میانگین اضافه شد.`
              : `دستگاه ${U.faNum(m)} از میانگین حذف شد.`,
            'info', 1800
          );
        });
      });
    };
    renderMatrix();

    if (!Dashboard.hasECharts()) {
      Dashboard.renderMachineTimeChartFallback(state);   // کتابخانه در دسترس نیست
      return;
    }

    const P = Dashboard.chartPalette();
    const cats = machines.map((m) => `دستگاه ${U.faNumPlain(m)}`).reverse();   // دستگاه ۱ بالا
    const setupData = machines.map((m) => {
      const t = s.machineTime[m];
      return t && t.setup ? t.setup : 0;
    }).reverse();
    const producedData = machines.map((m) => {
      const t = s.machineTime[m];
      return t && t.produced ? t.produced : 0;
    }).reverse();
    const recordsByMachine = machines.map((m) => {
      const t = s.machineTime[m];
      return t ? t.records : 0;
    }).reverse();

    const option = {
      animationDuration: 550,
      animationEasing: 'cubicOut',
      textStyle: { fontFamily: P.fontFamily },
      // نسخهٔ ۲٫۵: راست‌به‌چپ — میله‌ها از راست (کنار نام دستگاه‌ها) به چپ رشد می‌کنند
      grid: { left: 56, right: 8, top: 42, bottom: 8, containLabel: true },
      legend: {
        top: 4,
        right: 8,
        itemWidth: 14,
        itemHeight: 9,
        itemGap: 18,
        textStyle: { color: P.muted, fontFamily: P.fontFamily, fontSize: 11 },
        data: ['مانده زمان ستاپ', 'مانده زمان موجودی'],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: P.splitLine } },
        backgroundColor: P.tooltipBg,
        borderColor: P.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: P.text, fontFamily: P.fontFamily, fontSize: 12 },
        formatter: (params) => {
          const idx = params[0] ? params[0].dataIndex : 0;
          const m = RM.config.VALID_MACHINES[machines.length - 1 - idx] || '—';
          const lines = [`<b>دستگاه ${U.faNumPlain(m)}</b> · ${U.faNum(recordsByMachine[idx] || 0)} رکورد`];
          for (const p of params) {
            lines.push(`${p.marker} ${p.seriesName}: <b>${U.faDuration(p.value)}</b>${p.value ? ` (~${U.faNum(Math.round(p.value / 60))} ساعت)` : ''}`);
          }
          return lines.join('<br>');
        },
      },
      xAxis: {
        type: 'value',
        inverse: true,                       // نسخهٔ ۲٫۵: صفر در راست → رشد به چپ
        max: (v) => Math.max(v.max * 1.08, 60),
        axisLabel: {
          color: P.muted,
          fontFamily: P.fontFamily,
          fontSize: 10.5,
          formatter: (v) => `${U.faNumPlain(Math.round(v / 60))} ساعت`,
        },
        splitLine: { lineStyle: { color: P.splitLine, width: 1 } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        position: 'right',                  // نسخهٔ ۲٫۵: نام دستگاه‌ها در سمت راست
        data: cats,
        axisLabel: { color: P.text, fontFamily: P.fontFamily, fontSize: 12, fontWeight: 600 },
        axisLine: { lineStyle: { color: P.axisLine } },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'مانده زمان ستاپ',
          type: 'bar',
          data: setupData,
          barMaxWidth: 18,
          barGap: '28%',
          itemStyle: { color: P.setup, borderRadius: [4, 0, 0, 4] },
          emphasis: { itemStyle: { color: P.setup, opacity: 0.82 } },
          label: {
            show: true,
            position: 'left',              // نسخهٔ ۲٫۵: نوک میله (سمت چپ — رشد راست‌به‌چپ)
            // نسخهٔ ۲٫۶: بولد‌تر + تم‌آگاه (تاریک → روشن، روشن → سیاه)
            color: P.dark ? '#e8ebef' : '#15181c',
            fontFamily: P.fontFamily,
            fontSize: 10.5,
            fontWeight: 700,
            formatter: (p) => (p.value ? `${U.faNumPlain(Math.round(p.value / 60))} ساعت` : ''),
          },
        },
        {
          name: 'مانده زمان موجودی',
          type: 'bar',
          data: producedData,
          barMaxWidth: 18,
          itemStyle: { color: P.metal, borderRadius: [4, 0, 0, 4] },
          emphasis: { itemStyle: { color: P.metal, opacity: 0.82 } },
          label: {
            show: true,
            position: 'left',              // نسخهٔ ۲٫۵: نوک میله (سمت چپ — رشد راست‌به‌چپ)
            // نسخهٔ ۲٫۶: بولد‌تر + تم‌آگاه (تاریک → روشن، روشن → سیاه)
            color: P.dark ? '#e8ebef' : '#15181c',
            fontFamily: P.fontFamily,
            fontSize: 10.5,
            fontWeight: 700,
            formatter: (p) => (p.value ? `${U.faNumPlain(Math.round(p.value / 60))} ساعت` : ''),
          },
        },
      ],
    };

    Dashboard.applyChart('machine-time-chart', option);
  };

  /* ---------- دو دونات زمان متالایز (نسخهٔ ۲٫۴ — جایگزین دونات وضعیت خام) ----------
     زیر نمودار میله‌ای، دو دونات قرار می‌گیرد:
       ۱) دونات «مانده زمان موجودی» — سهم هر سه دستگاه + متن مرکزی دوخطی:
          بالا «کمترین: [H]:mm» و پایین «میانگین: [H]:mm»
       ۲) دونات «مانده زمان ستاپ» — همان ساختار با زمان‌های ستاپ
     میانگین = جمع دستگاه‌ها ÷ تعداد دستگاه‌ها.
     نسخهٔ ۲٫۵: مرکز دونات = مرکز بوم (center ۵۰٪/۵۰٪) و متن مرکزی با
     top:'middle' دقیقاً وسط‌چین می‌شود — مابین دو خط «کمترین/میانگین».
     نسخهٔ ۲٫۶: رنگ دستگاه‌ها پررنگ‌تر (۱=#82C836 · ۲=#F09252 · ۳=#00C1EE) و
     متن مرکزی بولد با فونت تطبیقی — همیشه داخل حفرهٔ مرکز (بیرون نمی‌زند).
     تغییر ۴: لیبل‌های «کمترین/میانگین» مرکز دونات بزرگ‌تر و بولد (هم‌اندازهٔ
     فونت ستون‌های تأکیدی جدول‌ها — 16px/700) + دیتالیبل هر دستگاه کمی
     بزرگ‌تر، بولد و مطلق (روشن → سیاه مطلق #000000 · تاریک → سفید مطلق
     #ffffff برای خوانایی). */

  /** ساخت و اعمال یک دونات زمان (سهم دستگاه‌ها + مرکز دوخطی کمترین/میانگین) */
  Dashboard.timeDonutOption = function (P, values, metricLabel, boxSize) {
    const machines = RM.config.VALID_MACHINES;
    const total = values.reduce((a, b) => a + b, 0);
    const minVal = Math.min(...values);
    const avgVal = total / machines.length;

    /* فونت تطبیقی متن مرکزی (تغییر ۴): بر اساس ابعاد واقعی بوم، اندازه‌ای
       هم‌اندازهٔ فونت ستون‌های تأکیدی جدول‌ها (em-cell: 16px/700) انتخاب
       می‌شود؛ اگر متن در حفرهٔ مرکز (حاشیهٔ امن ۱۲px) جا نشود کم می‌شود
       اما هرگز از 11px کوچک‌تر نمی‌شود. */
    const minDim = boxSize && (boxSize.w || boxSize.h)
      ? Math.max(180, Math.min(boxSize.w || 320, boxSize.h || 320))
      : 320;
    const innerR = (minDim / 2) * 0.54;                    // شعاع داخلی دونات (px)
    let fs = Math.max(12, Math.min(16, innerR * 0.2));
    const maxChars = Math.max(
      `کمترین: ${U.faHMM(minVal)}`.length,
      `میانگین: ${U.faHMM(avgVal)}`.length
    );
    const maxW = innerR * 2 - 12;                          // عرض مجاز داخل حفره
    while (fs > 11 && maxChars * 0.62 * fs > maxW) fs -= 0.5;

    return {
      animationDuration: 550,
      textStyle: { fontFamily: P.fontFamily },
      tooltip: {
        trigger: 'item',
        backgroundColor: P.tooltipBg,
        borderColor: P.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: P.text, fontFamily: P.fontFamily, fontSize: 12 },
        formatter: (p) => `<b>${p.name}</b> — ${metricLabel}<br>${U.faHMM(p.value)}${
          p.value ? ` (~${U.faNumPlain(Math.round(p.value / 60))} ساعت · ${U.faDaysOf(p.value)})` : ''}`,
      },
      legend: {
        bottom: 2,
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 14,
        textStyle: { color: P.muted, fontFamily: P.fontFamily, fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['54%', '74%'],
          center: ['50%', '50%'],   // نسخهٔ ۲٫۵: مرکز دونات = مرکز بوم → متن مرکزی دقیقاً وسط
          avoidLabelOverlap: true,
          itemStyle: { borderColor: P.dark ? '#16181b' : '#fcfcfa', borderWidth: 2 },
          label: {
            /* تغییر ۴: دیتالیبل هر دستگاه — کمی بزرگ‌تر، بولد، مطلق:
               تم روشن → سیاه مطلق #000000 · تم تاریک → سفید مطلق #ffffff (خوانایی) */
            show: true,
            color: P.dark ? '#ffffff' : '#000000',
            fontFamily: P.fontFamily,
            fontSize: 12,
            fontWeight: 700,
            formatter: (p) => (p.value ? U.faHMM(p.value) : ''),   // نسخهٔ ۲٫۵: برچسب مقدار صفر مخفی
          },
          emphasis: {
            scale: true,
            scaleSize: 5,
            label: { show: true, fontWeight: 700, color: P.dark ? '#ffffff' : '#000000' },
          },
          data: machines.map((m, i) => ({
            name: `دستگاه ${U.faNumPlain(m)}`,
            value: values[i],
            itemStyle: { color: RM.config.MACHINE_COLORS[m] || P.setup },
          })),
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',              // نسخهٔ ۲٫۵: دقیقاً مرکز بوم = مرکز دونات
          style: {
            /* تغییر ۴: دو خط بزرگ و بولد — هم‌اندازهٔ فونت ستون «عرض (mm)»
               جدول رول‌های خام (em-cell: 16px/700)؛ fontSize تطبیقی همیشه
               داخل حفرهٔ مرکز می‌ماند. */
            text: `{lbl|کمترین: }{v|${U.faHMM(minVal)}}\n{lbl|میانگین: }{v|${U.faHMM(avgVal)}}`,
            rich: {
              lbl: {
                fontSize: fs,
                fontWeight: 700,
                color: P.text,
                fontFamily: P.fontFamily,
              },
              v: {
                fontSize: Math.min(18, fs + 2),
                fontWeight: 800,
                color: P.text,
                fontFamily: P.fontFamily,
              },
            },
            fontSize: fs,
            fontFamily: P.fontFamily,
            textAlign: 'center',
            textVerticalAlign: 'middle',
            fill: P.text,
            lineHeight: Math.round(fs * 1.8),
          },
        },
      ],
    };
  };

  /** رندر دو دونات «مانده زمان موجودی» و «مانده زمان ستاپ» */
  Dashboard.renderTimeDonuts = function (state) {
    const s = state.summary;
    const machines = RM.config.VALID_MACHINES;
    const producedValues = machines.map((m) => (s.machineTime[m] ? s.machineTime[m].produced : 0));
    const setupValues = machines.map((m) => (s.machineTime[m] ? s.machineTime[m].setup : 0));

    const hasAny = producedValues.some((v) => v > 0) || setupValues.some((v) => v > 0);
    if (!hasAny) {
      const emptyHtml = `
        <div class="empty-state" style="min-height:220px">
          ${UI.icons.alert}
          <p>هنوز رکوردی با قانون زمان متالایز تطبیق نشده — دونات‌ها پس از تطبیق رکوردها رندر می‌شوند.</p>
        </div>`;
      for (const id of ['inventory-time-chart', 'setup-time-chart']) {
        Dashboard.disposeChart(id);
        const el = document.getElementById(id);
        if (el) el.innerHTML = emptyHtml;
      }
      return;
    }

    if (!Dashboard.hasECharts()) {
      // Fallback: چیپ‌های متنی هر دستگاه
      const rowsHtml = (vals) => machines.map((m, i) =>
        `<div class="mt-row"><div class="mt-label"><b style="color:${RM.config.MACHINE_COLORS[m]}">دستگاه ${U.faNum(m)}</b></div><b>${U.faHMM(vals[i])}</b></div>`
      ).join('');
      const inv = document.getElementById('inventory-time-chart');
      const stp = document.getElementById('setup-time-chart');
      if (inv) inv.innerHTML = `<div class="mt-rows" style="padding:12px">${rowsHtml(producedValues)}</div>`;
      if (stp) stp.innerHTML = `<div class="mt-rows" style="padding:12px">${rowsHtml(setupValues)}</div>`;
      return;
    }

    const P = Dashboard.chartPalette();
    /* ابعاد واقعی بوم‌ها → فونت تطبیقی متن مرکزی (نسخهٔ ۲٫۶) */
    const boxOf = (id) => {
      const el = document.getElementById(id);
      return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 0, h: 0 };
    };
    Dashboard.applyChart('inventory-time-chart',
      Dashboard.timeDonutOption(P, producedValues, 'مانده زمان موجودی', boxOf('inventory-time-chart')));
    Dashboard.applyChart('setup-time-chart',
      Dashboard.timeDonutOption(P, setupValues, 'مانده زمان ستاپ', boxOf('setup-time-chart')));
  };

  /* ---------- نمودار ستونی مانده زمان موجودی همهٔ ستاپ‌ها (نسخهٔ ۲٫۴ / ۲٫۵) ----------
     نسخهٔ ۲٫۵: به‌ازای هر ستاپ (شماره ستاپ) فقط یک میله — مجموع مانده زمان
     موجودی همهٔ رکوردهای همان شماره ستاپ (Σ [خام موجود × مدت] — نسخهٔ ۲٫۷).
     رکوردهای بدون قانون زمان در مجموع لحاظ نمی‌شوند (Tooltip اعلام می‌کند).
     تغییر ۵: دیتالیبل هر ستون کمی بزرگ‌تر، بولد و مطلق (روشن → سیاه مطلق
     #000000 · تاریک → سفید مطلق #ffffff برای خوانایی).
     ۳٫۱۷ بند ۸ — دو ستون به‌ازای هر ستاپ: ستون کهربایی =
     مانده زمان موجودی (همان ستون فعلی) و ستون فیروزه‌ای = مانده زمان ستاپ
     (Σ [تعداد − متالایز] × مدت — نسخهٔ ۲٫۷)؛ راهنمای سری‌ها بالای نمودار است.
     ۳٫۱۸ بند ۵ — بین دو ستونِ هر ستاپ فاصلهٔ کمی (barGap ~۲۸٪) افتاد تا
     دیتالیبل‌های عریض هر ستون داخل ستونِ مجاور خودشان سرریز نکنند و
     خوانا بمانند (فونت/عرض لیبل‌ها دست‌نخورده ماند). */

  Dashboard.renderSetupInventoryColumnChart = function (state) {
    const report = state.setupReport;
    const el = document.getElementById('setup-inventory-chart');
    if (!el) return;

    if (!report.length) {
      Dashboard.disposeChart('setup-inventory-chart');
      el.innerHTML = `
        <div class="empty-state" style="min-height:220px">
          ${UI.icons.alert}
          <p>هنوز ستاپی ثبت نشده — هر ستاپ (شماره ستاپ) دو ستون چسبیده از مجموع مانده زمان موجودی و مانده زمان ستاپ رکوردهایش خواهد داشت.</p>
        </div>`;
      return;
    }

    // مرتب‌سازی رکوردها: شماره ستاپ → دستگاه → عرض
    const sorted = [...report].sort((a, b) =>
      (a.setupNumber - b.setupNumber) ||
      (a.machineNumber - b.machineNumber) ||
      (a.width - b.width));

    // گروه‌بندی بر اساس شماره ستاپ — یک جفت ستون برای هر ستاپ (نسخهٔ ۲٫۵ + ۳٫۱۷ بند ۸)
    const groups = [];
    const bySetup = new Map();
    for (const r of sorted) {
      let g = bySetup.get(r.setupNumber);
      if (!g) {
        g = { setupNumber: r.setupNumber, records: [], total: 0, setupTotal: 0, noRuleCount: 0 };
        bySetup.set(r.setupNumber, g);
        groups.push(g);
      }
      g.records.push(r);
      if (r.remainingProducedTime === null || r.remainingSetupTime === null) {
        g.noRuleCount++;                       // رکورد بدون قانون زمان
      } else {
        g.total += r.remainingProducedTime;    // Σ [خام موجود × مدت] (نسخهٔ ۲٫۷)
        g.setupTotal += r.remainingSetupTime;  // Σ [(تعداد − متالایز) × مدت] (۳٫۱۷ بند ۸)
      }
    }

    const values = groups.map((g) => g.total);
    const setupValues = groups.map((g) => g.setupTotal);

    if (!Dashboard.hasECharts()) {
      // Fallback: فهرست متنی — یک ردیف برای هر ستاپ (مجموع)
      el.innerHTML = `
        <div class="mt-rows" style="padding:12px; max-height:320px; overflow:auto">
          ${groups.map((g) => `<div class="mt-row"><div class="mt-label"><b>ستاپ ${U.faNum(g.setupNumber)}</b> · ${U.faNum(g.records.length)} رکورد</div><b>${U.faHMM(g.total)} / ${U.faHMM(g.setupTotal)}</b></div>`).join('')}
        </div>`;
      return;
    }

    const P = Dashboard.chartPalette();
    const showLabels = groups.length <= 14;
    const labelColor = P.dark ? '#ffffff' : '#000000';

    /* دیتالیبل هر ستون — کمی بزرگ‌تر، بولد، مطلق (تغییر ۵؛ برای دو سری کوچک‌تر) */
    const barLabel = {
      show: showLabels,
      position: 'top',
      color: labelColor,
      fontFamily: P.fontFamily,
      fontSize: 10.5,
      fontWeight: 700,
      formatter: (p) => (p.value ? U.faHMM(p.value) : ''),
    };

    const option = {
      animationDuration: 550,
      textStyle: { fontFamily: P.fontFamily },
      grid: { left: 10, right: 16, top: 40, bottom: 8, containLabel: true },
      /* ۳٫۱۷ بند ۸ — راهنمای دو سری بالای نمودار */
      legend: {
        show: true,
        top: 2,
        right: 8,
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: P.muted, fontFamily: P.fontFamily, fontSize: 10.5 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: P.splitLine } },
        backgroundColor: P.tooltipBg,
        borderColor: P.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: P.text, fontFamily: P.fontFamily, fontSize: 12 },
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          if (!p) return '';
          const g = groups[p.dataIndex];
          return `<b>ستاپ ${U.faNum(g.setupNumber)}</b><br>` +
            `مانده زمان موجودی: <b>${U.faHMM(g.total)}</b><br>` +
            `مانده زمان ستاپ: <b>${U.faHMM(g.setupTotal)}</b>` +
            (g.noRuleCount ? `<br><span style="color:${P.muted}">${U.faNum(g.noRuleCount)} رکورد بدون قانون زمان لحاظ نشد</span>` : '');
        },
      },
      xAxis: {
        type: 'category',
        data: groups.map((g) => U.faNumPlain(g.setupNumber)),
        axisLabel: {
          color: P.muted,
          fontFamily: P.fontFamily,
          /* ۳٫۲۱ بند ۳ — شماره ستاپ‌های محور افقی درشت و بولدتر */
          fontSize: 15,
          fontWeight: 800,
          hideOverlap: true,
          interval: 'auto',
        },
        axisLine: { lineStyle: { color: P.axisLine } },
        axisTick: { show: false },
        name: 'شماره ستاپ',
        nameLocation: 'middle',
        /* ۳٫۲۱ بند ۳ — فاصلهٔ نام محور کمی بیشتر برای لیبل‌های درشت‌تر */
        nameGap: 36,
        nameTextStyle: { color: P.faint, fontFamily: P.fontFamily, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        max: (v) => Math.max(v.max * 1.12, 60),
        axisLabel: {
          color: P.muted,
          fontFamily: P.fontFamily,
          fontSize: 10.5,
          formatter: (v) => `${U.faNumPlain(Math.round(v / 60))} ساعت`,
        },
        splitLine: { lineStyle: { color: P.splitLine, width: 1 } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          /* ستون اول جفت — مانده زمان موجودی (کهربایی — همان ستون فعلی) */
          name: 'مانده زمان موجودی',
          type: 'bar',
          data: values,
          barMaxWidth: 26,
          barGap: '28%',          /* ۳٫۱۸ بند ۵ — فاصلهٔ کمی بین دو ستون هر ستاپ */
          itemStyle: { color: P.metal, borderRadius: [5, 5, 0, 0] },
          emphasis: { itemStyle: { color: P.metal, opacity: 0.82 } },
          label: barLabel,
        },
        {
          /* ستون دوم جفت — مانده زمان ستاپ (فیروزه‌ای) */
          name: 'مانده زمان ستاپ',
          type: 'bar',
          data: setupValues,
          barMaxWidth: 26,
          barGap: '28%',
          itemStyle: { color: P.setup, borderRadius: [5, 5, 0, 0] },
          emphasis: { itemStyle: { color: P.setup, opacity: 0.82 } },
          label: barLabel,
        },
      ],
    };

    Dashboard.applyChart('setup-inventory-chart', option);
  };

  /* ---------- نمودار افقی عرض‌های رول (نسخهٔ ۳٫۱ — تغییر ۵) ----------
     هر میله یک «عرض» از رکوردهای جدول «گزارش تولید ستاپ‌ها» است:
       · مبنای پیش‌فرض = ستون «خام موجود» → فقط عرض‌هایی نمایش داده می‌شوند
         که رول خام موجود (مقدار مثبت) دارند؛ طول میله = مجموع خام موجود همان عرض
       · مبنای جایگزین (انتخاب کاربر کنار نمودار، ۳٫۲۱) = «تعداد» → مجموع
         ستون‌های «برش‌نشده» + «خام موجود» (فقط مقادیر بزرگ‌تر از صفر)
       · مرتب‌سازی: از عرض بزرگ به کوچک (بالا → پایین)
       · روی هر میله مقدار همان عرض/گروه «در همان مبنای انتخابی» درج می‌شود
         (۳٫۲۲ بند ۱-الف — دیگر ستون «تعداد در ستاپ» نیست)؛ محور راست = اندازهٔ عرض.
     انتخاب مبنا ماندگار است (appSettings: dashboardWidthChartBasis). */

  Dashboard._widthBasis = null;         // 'rawExisting' (پیش‌فرض) | 'rollCount'
  Dashboard._widthBasisBound = false;   // دکمه‌های مبنا یک‌بار بسته می‌شوند
  Dashboard._widthMachine = 'all';      // فیلتر دستگاه (نسخهٔ ۳٫۵ — تغییر ۲): 'all' | 1|2|3
  Dashboard._widthMachineBound = false;
  /* ۳٫۱۷ بند ۷ — تفکیک‌های میله‌های نمودار عرض‌ها: هر کدام جدا روشن/خاموش
     می‌شود (سگمنت‌های رنگیِ پشته‌ای). پیش‌فرض همه خاموش (مثل ۳٫۱۶). */
  Dashboard._widthBreakdown = null;     // { stdLength, line, thickness }
  Dashboard._widthBreakdownBound = false;

  /** بارگذاری مبنای ماندگار + بستن دکمه‌های سگمنتی (یک‌بار) */
  Dashboard.initWidthBasis = async function () {
    if (Dashboard._widthBasis === null) {
      Dashboard._widthBasis = await RM.db.getSetting('dashboardWidthChartBasis', 'rawExisting');
    }
    if (Dashboard._widthMachine === 'all' || Dashboard._widthMachine === null) {
      const savedMachine = await RM.db.getSetting('dashboardWidthChartMachine', 'all');
      Dashboard._widthMachine = (savedMachine === 1 || savedMachine === 2 || savedMachine === 3)
        ? savedMachine
        : 'all';
    }
    /* ۳٫۱۷ بند ۷ — تفکیک‌های ماندگار (متراژ استاندارد / خط تولید / ضخامت) */
    if (Dashboard._widthBreakdown === null) {
      const savedBd = await RM.db.getSetting('dashboardWidthBreakdown', null);
      Dashboard._widthBreakdown = (savedBd && typeof savedBd === 'object')
        ? {
          stdLength: !!savedBd.stdLength,
          line: !!savedBd.line,
          thickness: !!savedBd.thickness,
        }
        : { stdLength: false, line: false, thickness: false };
    }
    if (!Dashboard._widthBasisBound) {
      Dashboard._widthBasisBound = true;
      const seg = document.getElementById('width-basis-seg');
      if (seg) {
        seg.querySelectorAll('.seg-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const next = btn.dataset.basis === 'rollCount' ? 'rollCount' : 'rawExisting';
            if (next === Dashboard._widthBasis) return;
            Dashboard._widthBasis = next;
            await RM.db.setSetting('dashboardWidthChartBasis', next);
            Dashboard.applyWidthBasisUi();
            if (Dashboard._state) Dashboard.renderWidthInventoryChart(Dashboard._state);
          });
        });
      }
    }
    /* فیلتر دستگاه (نسخهٔ ۳٫۵ — تغییر ۲): انتخابگر کنار سگمنت مبنا —
       با انتخاب دستگاه، فقط رکوردهای گزارش ستاپ‌های همان دستگاه در
       گروه‌بندی عرض‌ها می‌آیند (رول‌های خام اختصاص‌یافته به آن دستگاه). */
    if (!Dashboard._widthMachineBound) {
      Dashboard._widthMachineBound = true;
      const sel = document.getElementById('width-machine-select');
      if (sel) {
        sel.value = String(Dashboard._widthMachine);
        sel.addEventListener('change', async () => {
          const v = sel.value === '1' || sel.value === '2' || sel.value === '3'
            ? Number(sel.value) : 'all';
          Dashboard._widthMachine = v;
          await RM.db.setSetting('dashboardWidthChartMachine', v);
          Dashboard.applyWidthBasisUi();
          if (Dashboard._state) Dashboard.renderWidthInventoryChart(Dashboard._state);
        });
      }
    }
    /* ۳٫۱۷ بند ۷ — منوی تفکیک‌ها: دکمه + سه چک‌باکس + بستن با کلیک بیرون */
    if (!Dashboard._widthBreakdownBound) {
      Dashboard._widthBreakdownBound = true;
      const bdWrap = document.getElementById('width-breakdown-wrap');
      const bdBtn = document.getElementById('width-breakdown-toggle');
      const bdMenu = document.getElementById('width-breakdown-menu');
      if (bdWrap && bdBtn && bdMenu) {
        const boxes = {
          stdLength: document.getElementById('width-bd-stdlength'),
          line: document.getElementById('width-bd-line'),
          thickness: document.getElementById('width-bd-thickness'),
        };
        const closeMenu = () => {
          bdMenu.hidden = true;
          bdBtn.setAttribute('aria-expanded', 'false');
        };
        bdBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          bdMenu.hidden = !bdMenu.hidden;
          bdBtn.setAttribute('aria-expanded', String(!bdMenu.hidden));
        });
        bdMenu.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', () => { if (!bdMenu.hidden) closeMenu(); });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !bdMenu.hidden) closeMenu();
        });
        for (const [key, box] of Object.entries(boxes)) {
          if (!box) continue;
          box.checked = !!Dashboard._widthBreakdown[key];
          box.addEventListener('change', async () => {
            Dashboard._widthBreakdown[key] = box.checked;
            await RM.db.setSetting('dashboardWidthBreakdown', { ...Dashboard._widthBreakdown });
            Dashboard.applyWidthBasisUi();
            if (Dashboard._state) Dashboard.renderWidthInventoryChart(Dashboard._state);
          });
        }
      }
    }
    Dashboard.applyWidthBasisUi();
  };

  /** همگام‌سازی ظاهر سگمنتی/عنوان با مبنای فعال + فیلتر دستگاه + تفکیک‌ها */
  Dashboard.applyWidthBasisUi = function () {
    const basis = Dashboard._widthBasis === 'rollCount' ? 'rollCount' : 'rawExisting';
    const seg = document.getElementById('width-basis-seg');
    if (seg) {
      seg.querySelectorAll('.seg-btn').forEach((btn) => {
        const active = btn.dataset.basis === basis;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }
    const machineActive = Dashboard._widthMachine !== 'all';
    const sel = document.getElementById('width-machine-select');
    if (sel && sel.value !== String(Dashboard._widthMachine)) sel.value = String(Dashboard._widthMachine);
    /* ۳٫۱۷ بند ۷ — دکمهٔ «تفکیک‌ها» با فعال‌بودن هر تفکیکی، حالت فعال می‌گیرد */
    const bd = Dashboard._widthBreakdown || { stdLength: false, line: false, thickness: false };
    const bdCount = (bd.stdLength ? 1 : 0) + (bd.line ? 1 : 0) + (bd.thickness ? 1 : 0);
    const bdBtn = document.getElementById('width-breakdown-toggle');
    if (bdBtn) {
      bdBtn.classList.toggle('active', bdCount > 0);
      bdBtn.setAttribute('aria-pressed', String(bdCount > 0));
      bdBtn.textContent = bdCount > 0 ? `تفکیک‌ها (${U.faNum(bdCount)}) ▾` : 'تفکیک‌ها ▾';
    }
    const labelEl = document.getElementById('width-basis-label');
    if (labelEl) {
      labelEl.textContent = machineActive
        ? `${basis === 'rollCount' ? 'تعداد' : 'خام موجود'} — دستگاه ${U.faNum(Dashboard._widthMachine)}`
        : (basis === 'rollCount' ? 'تعداد' : 'خام موجود');
    }
  };

  /** رندر نمودار افقی عرض‌ها از گزارش تولید ستاپ‌ها
   *  (نسخهٔ ۳٫۵ — تغییر ۲: فیلتر دستگاه — فقط رکوردهای ستاپ‌های دستگاهِ انتخاب‌شده)
   *  ۳٫۲۰ بند ۱ — بازطراحی کامل مطابق تصویر مرجع کاربر (Bar-Chart.png):
   *  عرض‌ها نزولی (بزرگ‌ترین بالا)؛ با فعال‌بودن تفکیک‌ها (متراژ استاندارد /
   *  خط تولید / ضخامت) هر گروهِ تفکیکِ یک عرض یک میلهٔ تمام‌قد مستقل است؛
   *  میله‌های هم‌عرض نزدیک هم و عرض‌های مختلف با ردیف جداکنندهٔ خالی دور از
   *  هم؛ رنگ همهٔ میله‌های یک عرض واحد و بین عرض‌ها یکی‌درمیان سبز/نارنجی؛
   *  دیتالیبل «N رول | تفکیک‌های تیک‌خورده» (متراژ با رقم لاتین)؛ محور x
   *  حذف بصری و مرزبندی گروه‌ها فقط با فاصله‌گذاری و رنگ.
   *  ۳٫۲۲ بند ۱-الف — N دیتالیبل از «مقدار همان عرض/گروه در مبنای انتخابی»
   *  ساخته می‌شود (نه ستون «تعداد در ستاپ»): «خام موجود» → مجموع ستون خام
   *  موجود؛ «تعداد» → مجموع «برش‌نشده» + «خام موجود» (فقط مقادیر >0) —
   *  هم‌ارزش طول میله و جمع ردیف‌های تولتیپ. */
  Dashboard.renderWidthInventoryChart = function (state) {
    let report = state.setupReport;
    const el = document.getElementById('width-inventory-chart');
    if (!el) return;

    const basis = Dashboard._widthBasis === 'rollCount' ? 'rollCount' : 'rawExisting';
    const isRaw = basis === 'rawExisting';
    const basisLabel = isRaw ? 'خام موجود' : 'تعداد';
    const machineFilter = Dashboard._widthMachine;
    const machineActive = machineFilter !== 'all' && (machineFilter === 1 || machineFilter === 2 || machineFilter === 3);
    if (machineActive && Array.isArray(report)) {
      report = report.filter((r) => Number(r.machineNumber) === Number(machineFilter));
    }

    // ۳٫۹ — تغییر ۳: توضیح پنل به پاپ‌آپ دکمهٔ راهنما منتقل شد (هر دو مبنا + فیلتر دستگاه)
    // و بلوک به‌روزرسانی پویای آن حذف شد.

    if (!report.length) {
      Dashboard.disposeChart('width-inventory-chart');
      el.style.height = '';   // بازگشت به ارتفاع پیش‌فرض (نسخهٔ ۳٫۴)
      el.innerHTML = `
        <div class="empty-state" style="min-height:180px">
          ${UI.icons.alert}
          <p>${machineActive
            ? `هنوز ستاپی برای دستگاه ${U.faNum(machineFilter)} ثبت نشده — عرض‌های رول این دستگاه پس از ثبت ستاپ‌ها نمایش داده می‌شوند.`
            : 'هنوز ستاپی ثبت نشده — عرض‌های رول پس از ثبت ستاپ‌ها در این نمودار نمایش داده می‌شوند.'}</p>
        </div>`;
      return;
    }

    // گروه‌بندی رکوردها بر اساس عرض — مجموع ستون مبنا + نگه‌داشتن رکوردها برای
    // تفکیک دستگاه‌ها (تولتیپ) و سگمنت‌های تفکیک (۳٫۱۷ بند ۷)
    /* ۳٫۲۱ بند ۱-هـ — مقدار هر رکورد در مبنای فعال:
       · «خام موجود» (دست‌نخورده): مقدار ستون خام موجود؛
       · «تعداد» (تغییر ۳٫۲۱): مجموع مقدارهای ستون‌های «برش‌نشده» + «خام موجود»
         همان رکورد — فقط مقادیر بزرگ‌تر از صفر لحاظ می‌شوند. */
    const basisValueOf = (r) => {
      if (isRaw) return Number(r.rawExisting) || 0;
      const u = Number(r.uncut) || 0;
      const rw = Number(r.rawExisting) || 0;
      return (u > 0 ? u : 0) + (rw > 0 ? rw : 0);
    };

    const byWidth = new Map();   // width → { width, total, records, recs }
    for (const r of report) {
      const w = Number(r.width);
      if (!Number.isFinite(w) || w <= 0) continue;
      if (!byWidth.has(w)) byWidth.set(w, { width: w, total: 0, records: 0, recs: [] });
      const g = byWidth.get(w);
      g.total += basisValueOf(r);
      g.records++;
      g.recs.push(r);
    }

    // فقط عرض‌های دارای مقدار مثبت در مبنای فعال + مرتب‌سازی عرض نزولی (بزرگ → کوچک)
    const groups = [...byWidth.values()]
      .filter((g) => g.total > 0)
      .sort((a, b) => b.width - a.width);

    if (!groups.length) {
      Dashboard.disposeChart('width-inventory-chart');
      el.style.height = '';   // بازگشت به ارتفاع پیش‌فرض (نسخهٔ ۳٫۴)
      el.innerHTML = `
        <div class="empty-state" style="min-height:180px">
          ${UI.icons.alert}
          <p>${isRaw
            ? 'هیچ عرضی با رول خام موجود (مقدار مثبت ستون «خام موجود») وجود ندارد.'
            : 'هیچ عرضی با مقدار مثبت (مجموع «برش‌نشده» + «خام موجود») وجود ندارد.'}</p>
        </div>`;
      return;
    }

    if (!Dashboard.hasECharts()) {
      // Fallback: فهرست متنی — عرض + تعداد
      el.innerHTML = `
        <div class="mt-rows" style="padding:12px; max-height:320px; overflow:auto">
          ${groups.map((g) => `<div class="mt-row">
              <div class="mt-label"><b>عرض ${U.faWidth(g.width)}</b> · ${U.faNum(g.records)} رکورد</div>
              <b>${U.faNum(g.total)} رول</b>
            </div>`).join('')}
        </div>`;
      return;
    }

    const P = Dashboard.chartPalette();

    /* ترتیب نمایش: بزرگ‌ترین عرض بالا — ECharts اندیس ۰ را پایین می‌چیند →
       آرایهٔ نمایشی معکوس (صعودی) ساخته می‌شود تا بزرگ‌ترین عرض در بالاترین میله بنشیند. */
    const view = [...groups].reverse();

    /* --- ۳٫۲۰ بند ۱ — بازطراحی کامل مطابق تصویر مرجع کاربر (Bar-Chart.png):
           میله‌های تمام‌قد هم‌ضخامت به‌ازای هر گروه تفکیک (حذف طرح
           «زیرمیلهٔ نازک» و «میلهٔ اصلی»)، میله‌های هر عرض در نزدیک هم و
           عرض‌های مختلف با فاصلهٔ زیاد (ردیف خالی جداکننده بین گروه‌ها)،
           رنگ واحد برای همهٔ میله‌های یک عرض و یکی‌درمیانِ سبز/نارنجی بین
           عرض‌ها، دیتالیبل «N رول | مقدار تفکیک‌های تیک‌خورده» (بدون قانون
           مشروط خواهرها — در تصویر مرجع روی میلهٔ ۴۰٬۰۰۰ هم BOPP درج شده)،
           حذف نوار پس‌زمینه/خط جداکننده (فاصله‌گذاری خودش تفکیک بصری
           می‌سازد) و حذف محور x (مطابق تصویر — فقط محور راست با خط عمودی). */
    const bd = Dashboard._widthBreakdown || { stdLength: false, line: false, thickness: false };
    const bdActive = !!(bd.stdLength || bd.line || bd.thickness);

    /* ابعاد تفکیک فعال به‌ترتیب ثابت + مقدار نمایشی هر بُعد برای رکورد */
    const BD_DIMS = [];
    if (bd.stdLength) BD_DIMS.push('stdLength');
    if (bd.line) BD_DIMS.push('line');
    if (bd.thickness) BD_DIMS.push('thickness');
    const dimValueOf = (r, dim) => {
      if (dim === 'stdLength') {
        /* ۳٫۲۰ بند ۱ — مطابق تصویر مرجع: مقدار متراژ با رقم لاتین و بدون
           جداکنندهٔ هزارگان درج می‌شود («20000») تا از شمارش رول فارسی
           («۳ رول») بصری‌تفکیک بماند */
        const sl = Number(r.standardLength);
        return Number.isFinite(sl) && sl > 0 ? String(sl) : '—';
      }
      if (dim === 'line') {
        return r.productionLine === 'BOPP' || r.productionLine === 'CPP' ? r.productionLine : 'خط —';
      }
      const t = Number(r.thickness);
      return Number.isFinite(t) ? `ضخامت ${t}` : 'ضخامت —';
    };

    /* دو رنگ یک‌درمیانِ عرض‌ها (۳٫۲۱ بند ۱-ب) — همان دو رنگ نمودار
       «مانده زمان متالایز به تفکیک دستگاه»: فیروزه‌ای (#0f766e = سری
       «مانده زمان ستاپ») و کهربایی (#b45309 = سری «مانده زمان موجودی»)
       از پالت مشترک chartPalette؛ هر دو در تم روشن/تاریک خوانا هستند */
    const WIDTH_COLORS = [P.setup, P.metal];

    /* ردیف‌های چارت (آرایه از پایین به بالا — view صعودی است): هر میلهٔ
       واقعی یا «ردیف جداکنندهٔ خالی» بین دو عرض؛ گام ردیف ثابت است پس
       فاصلهٔ درون‌گروهی = گام − ضخامت میله و فاصلهٔ بین‌گروهی ≈ ۴ برابر
       آن (یک ردیف خالی اضافه) — مطابق تصویر مرجع */
    const rows = [];
    for (let gi = 0; gi < view.length; gi++) {
      const g = view[gi];
      if (gi > 0) rows.push({ kind: 'sep' });   // فاصلهٔ زیاد بین عرض‌ها
      let bars;
      if (!bdActive) {
        bars = [{ values: [], value: g.total, recs: g.recs }];
      } else {
        const byKey = new Map();
        for (const r of g.recs) {
          const key = BD_DIMS.map((d) => dimValueOf(r, d)).join('|||');
          if (!byKey.has(key)) {
            byKey.set(key, { values: BD_DIMS.map((d) => dimValueOf(r, d)), value: 0, recs: [] });
          }
          const b = byKey.get(key);
          b.value += basisValueOf(r);           // طول میله و N دیتالیبل — هر دو از مبنای انتخابی کاربر (۳٫۲۲ بند ۱-الف)
          b.recs.push(r);
        }
        bars = [...byKey.values()];
        /* ۳٫۲۰ بند ۱ — گروه‌های با مقدار صفر در مبنای فعال (مثل گروهی که
           رول خام موجود ندارد) ردیفِ خالی/میلهٔ نامرئی می‌سازند و فقط فاصلهٔ
           گیج‌کننده در گروه می‌گذارند — فیلتر می‌شوند (عرض خودش تنها وقتی
           می‌آید که مجموع مبنایش مثبت است پس گروه مثبت همیشه هست) */
        bars = bars.filter((b) => b.value > 0);
      }
      /* داخل هر عرض: صعودی در آرایه (پایین → بالا) تا بزرگ‌ترین میله بالای
         گروه بنشیند — هم‌راسته با ترتیب نزولی خودِ عرض‌ها */
      bars.sort((a, b2) => (a.value - b2.value) || a.values.join('|').localeCompare(b2.values.join('|'), 'fa'));
      /* رنگ این عرض: بالاترین عرض سبک است و یکی‌درمیان ادامه می‌یابد
         (view صعودی است → فاصله از بالای فهرست = view.length − ۱ − gi)؛
         همهٔ میله‌های یک عرض هم‌رنگ‌اند چون متعلق به همان عرض‌اند */
      const colorIdx = (view.length - 1 - gi) % 2;
      const labelRow = Math.floor((bars.length - 1) / 2);   // برچسب عرض روی میانهٔ گروه
      /* ۳٫۲۱ بند ۱-و — گروه با تعداد میلهٔ زوج: مرز دو میلهٔ میانی (میانهٔ واقعی)
         روی «مرز دو ردیف» می‌افتد نه مرکز یک ردیف؛ برچسب چنین گروهی با
         خط‌فاصله‌ساز ریچ‌متن نیم‌گام بالا می‌رود تا دقیقاً وسط بنشیند */
      const evenGroup = bars.length % 2 === 0;
      bars.forEach((bar, bi) => {
        /* دیتالیبل میله (۳٫۲۰ بند ۱): «N رول» + مقدار همهٔ تفکیک‌های فعال
           با جداکنندهٔ «|» — پارامتر تیک‌نخورده اصلاً در لیبل نمی‌آید و
           قانون مشروط خواهرها حذف شد (مطابق تصویر مرجع که BOPP روی میلهٔ
           ۴۰٬۰۰۰ هم درج شده). ۳٫۲۲ بند ۱-الف — N = مقدار همان گروه در
           مبنای انتخابی کاربر (خام موجود / مجموع برش‌نشده + خام موجود)،
           هم‌ارزش طول میله و جمع ردیف‌های تولتیپ — دیگر ستون «تعداد در
           ستاپ» نمایش داده نمی‌شود؛ جهت متن با کنترل‌های bidi (RLE…PDF)
           روی RTL قفل می‌ماند و نسخهٔ بدون کنترل (labelPlain) برای تولتیپ
           نگه داشته می‌شود */
        const parts = [`${U.faNum(bar.value)} رول`];
        for (let d = 0; d < BD_DIMS.length; d++) parts.push(bar.values[d]);
        const labelPlain = parts.join(' | ');
        rows.push({
          kind: 'bar',
          width: g.width,
          widthLabel: U.faWidth(g.width),
          showWidthLabel: bi === labelRow,
          evenGroup,
          value: bar.value,
          label: '\u202B' + labelPlain + '\u202C',
          labelPlain,
          colorIdx,
          recs: bar.recs,
        });
      });
    }
    const totalBars = rows.filter((r) => r.kind === 'bar').length;
    const totalRows = rows.length;

    /* --- ۳٫۱۷ بند ۷ (به‌روز در ۳٫۱۸): تولتیپ — تفکیک تعداد رول‌های هر
           دستگاه + برش‌نشده‌ها، برای رکوردهای «همان میله» --- */
    const machineRowsOf = (recs) => {
      const byMachine = new Map();
      for (const r of recs) {
        const m = Number(r.machineNumber);
        const k = Number.isFinite(m) && m > 0 ? m : 0;
        if (!byMachine.has(k)) byMachine.set(k, { rolls: 0, uncut: 0 });
        const a = byMachine.get(k);
        a.rolls += basisValueOf(r);   // ۳٫۲۱: مقدار در مبنای فعال (تابع مشترک)
        a.uncut += Number(r.uncut) || 0;
      }
      /* ۳٫۲۲ بند ۱-ب — دستگاهی که تعداد رولش در مبنای انتخابی کاربر (خام
         موجود / تعداد) بزرگ‌تر از صفر نیست و برش‌نشده‌اش هم بزرگ‌تر از صفر
         نیست، در تولتیپ نمایش داده نمی‌شود (رکورد بی‌مقدارِ همان میله)؛
         دستگاهِ بدون رولِ مبنای فعال اما دارای برش‌نشده می‌ماند */
      return [...byMachine.entries()].sort((a, b) => a[0] - b[0])
        .filter(([, a]) => a.rolls > 0 || a.uncut > 0)
        .map(([m, a]) => `دستگاه ${m > 0 ? U.faNum(m) : 'نامشخص'}: <b>${U.faNum(a.rolls)} رول</b>` +
          (a.uncut > 0 ? ` · ${U.faNum(a.uncut)} برش‌نشده` : ''));
    };

    /* --- ارتفاع پویا (۳٫۲۱ بند ۱-الف/ج — الگوبرداری از چارت «مانده زمان
           متالایز به تفکیک دستگاه»): میلهٔ ۱۸px (هم‌اندازهٔ barMaxWidth:18
           چارت مرجع) و گام ردیف = میله + ۲۸٪ آن (استاندارد barGap:'28%'
           چارت مرجع) = ۲۳px → فاصلهٔ درون‌گروهی ≈ ۵px (فشرده و نزدیک) و
           فاصلهٔ بین‌عرضی با ردیف جداکننده ≈ ۲۸px (واضح و دور)؛ چارت‌های
           خیلی بلند فشرده‌تر (میلهٔ ۱۵ و گام ۱۹) تا ارتفاع بی‌جا نگیرد.
           +26 = حاشیهٔ عمودی گرید (بالا ۱۸ + پایین ۸) تا گام پیکسلی
           واقعی دقیقاً محاسبه‌پذیر باشد --- */
    const tall = totalRows > 44;
    const BAR_W = tall ? 15 : 18;
    const ROW_PITCH = tall ? 19 : 23;
    const boxH = Math.max(300, Math.round(totalRows * ROW_PITCH + 26));
    const pxPitch = (boxH - 26) / totalRows;   // گام پیکسلی واقعی ردیف‌ها (برای برچسب گروه‌های زوج)
    el.style.height = `${boxH}px`;

    /* ۳٫۲۱ بند ۱-ز — فونت عدد عرض: چند درجه درشت‌تر و بولدتر از دیتالیبل‌ها */
    const widthLblSize = tall ? 13.5 : 16;

    /* فونت تطبیقی لیبل — متناسب با تراکم ردیف‌ها */
    const labelSize = totalRows <= 20 ? 11 : totalRows <= 34 ? 10.5 : totalRows <= 55 ? 10 : 9.5;

    /* --- جا شدن دیتالیبل‌ها در کادر چارت (۳٫۱۸ بند ۴ — حفظ در ۳٫۲۰): سقف
           محور به اندازهٔ عرضِ بلندترین لیبل باز می‌شود تا هیچ لیبلی از کادر
           بیرون نزند و در عوض میله‌ها به همان اندازه کوچک‌تر رسم شوند --- */
    const longestLabel = rows.reduce((mx, r) => (r.kind === 'bar'
      ? Math.max(mx, (r.labelPlain || '').length) : mx), 0);
    const plotW = Math.max(160, (el.clientWidth || 600) - 120);
    const labelPx = longestLabel * labelSize * 0.62;
    const axisMaxDenom = Math.min(0.88, Math.max(0.38, 1 - labelPx / plotW));

    /* --- سری میله (۳٫۲۰ بند ۱ — تک‌سری): همهٔ میله‌ها هم‌ضخامت‌اند (حذف
           دو سری هم‌مرکز ۳٫۱۹)؛ رنگ هر میله per-datum از رنگِ «عرضِ والد»
           می‌آید (یک رنگ واحد برای همهٔ میله‌های یک عرض)؛ ردیف‌های
           جداکننده null می‌مانند. دیتالیبل «N رول | تفکیک‌های تیک‌خورده»
           سمت چپِ نوک میله است (مطابق تصویر مرجع).
           ۳٫۲۱ بند ۱-د — جنس و طراحی میله دقیقاً مانند چارت «مانده زمان
           متالایز به تفکیک دستگاه»: انحنای 4px فقط سمت نوک (چپ)، بدون
           بردر و emphasis با opacity 0.82. */
    const series = [{
      name: basisLabel,
      type: 'bar',
      data: rows.map((r) => (r.kind === 'bar' ? {
        value: r.value,
        itemStyle: {
          color: WIDTH_COLORS[r.colorIdx],
          borderRadius: [4, 0, 0, 4],   // انحنای سمت نوک میله — مانند چارت مانده زمان
        },
      } : null)),
      barWidth: BAR_W,
      emphasis: { itemStyle: { opacity: 0.82 } },
      label: {
        show: true,                        // دیتالیبل همیشه روشن (نسخهٔ ۳٫۴ — تغییر ۷)
        position: 'left',          // نوک میله (سمت چپ — رشد راست‌به‌چپ)
        color: P.dark ? '#e8ebef' : '#15181c',
        fontFamily: P.fontFamily,
        fontSize: labelSize,
        fontWeight: 700,
        formatter: (p) => {
          const r = rows[p.dataIndex];
          if (!r || r.kind !== 'bar' || !p.value) return '';
          return r.label;
        },
      },
    }];

    const option = {
      animationDuration: 550,
      textStyle: { fontFamily: P.fontFamily },
      // راست‌به‌چپ (مثل نمودار دستگاه‌ها): عرض‌ها در سمت راست، میله‌ها از راست به چپ
      grid: { left: 16, right: 8, top: 18, bottom: 8, containLabel: true },
      /* ۳٫۱۸ بند ۴ — لجند لازم نیست: رنگ میله‌ها ثابت است و مقدار تفکیکِ
         هر میله در دیتالیبل خودش درج می‌شود */
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: P.splitLine } },
        backgroundColor: P.tooltipBg,
        borderColor: P.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: P.text, fontFamily: P.fontFamily, fontSize: 12 },
        /* ۳٫۱۷ بند ۷ (۳٫۲۰: ردیف‌محور) — سرصفحهٔ «عرض — لیبل گروه» +
           تفکیک دستگاه‌ها و برش‌نشده برای رکوردهای همان میله؛ ردیف‌های
           جداکننده (بدون میله) تولتیپ خالی می‌دهند */
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          const p = arr.find((x) => x && x.value !== null && x.value !== undefined) || arr[0];
          if (!p) return '';
          const r = rows[p.dataIndex];
          if (!r || r.kind !== 'bar') return '';
          const head = `<div dir="rtl" style="font-weight:800;margin-bottom:4px">عرض ${r.widthLabel}${bdActive && r.labelPlain ? ` — ${r.labelPlain}` : ''}</div>`;
          const rowsM = machineRowsOf(r.recs);
          return head + (rowsM.length ? `<div dir="rtl">${rowsM.join('<br>')}</div>` : 'رکوردی نیست.');
        },
      },
      xAxis: {
        type: 'value',
        inverse: true,                     // صفر در راست → رشد میله به چپ
        /* ۳٫۱۸ بند ۴ (حفظ در ۳٫۲۰): سقف محور با احتساب عرض بلندترین
           دیتالیبل باز می‌شود (axisMaxDenom) تا لیبل‌ها در کادر جا شوند */
        max: (v) => Math.max(v.max / axisMaxDenom, 4),
        /* ۳٫۲۰ بند ۱ — محور x حذف بصری شد (مطابق تصویر مرجع: بدون خط/اسکیل/
           نام/خطوط راهنما — مقدارها در دیتالیبل «N رول» و تولتیپ هستند و
           مبنای فعال از سگمنت بالای چارت مشخص می‌شود) */
        axisLabel: { show: false },
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        position: 'right',                  // اندازهٔ عرض‌ها در سمت راست
        /* ۳٫۲۰ بند ۱ — برچسب عرض روی میانهٔ ردیف‌های همان عرض درج می‌شود
           (بقیه و ردیف‌های جداکننده خالی)؛ تفکیک بصری عرض‌ها با فاصله‌گذاری
           و رنگ یک‌درمیان است، نه نوار پس‌زمینه/خط جداکننده.
           ۳٫۲۱ بند ۱-و — گروه‌های با تعداد میلهٔ زوج: میانهٔ واقعی روی مرزِ
           دو میلهٔ میانی است؛ برچسب با «خط-فاصله‌ساز» نامرئی زیر متن
           (ارتفاع = گام پیکسلی واقعی ردیف) دقیقاً نیم‌گام بالا می‌رود و
           روی همان مرز می‌نشیند — متن همچنان مرکزِ کل بلوک است پس جابه‌جایی
           = نصف ارتفاع فاصله‌ساز = pxPitch / 2 (ریاضی دقیق). */
        data: rows.map((r) => {
          if (r.kind !== 'bar' || !r.showWidthLabel) return '';
          return r.evenGroup ? `{t|${r.widthLabel}}\n{sp|\u00A0}` : `{t|${r.widthLabel}}`;
        }),
        axisLabel: {
          color: P.text,
          fontFamily: P.fontFamily,
          /* ۳٫۲۱ بند ۱-ز — عدد عرض درشت و بولد؛ ۳٫۲۳ بند ۲ — بولدیِ میانه:
             وزن از ۸۰۰ به ۵۰۰ کاهش یافت. وزیر فقط ۳ وزن دارد (400/500/700)
             پس ۸۰۰ عملاً Bold رندر می‌شد (+ استروک ۰٫۵px) و اعداد «N رول»
             روی میله‌ها را می‌بلعید؛ اکنون ۵۰۰ = Medium + همان استروک ≈ بولدِ
             ملایم‌تر — همچنان بولد، ولی اعداد خود نمود برجسته می‌شوند. */
          fontSize: widthLblSize,
          fontWeight: 500,
          interval: 0,
          textBorderColor: P.text,
          textBorderWidth: 0.5,
          rich: {
            t: {
              fontSize: widthLblSize,
              fontWeight: 500,
              color: P.text,
              fontFamily: P.fontFamily,
              textBorderColor: P.text,
              textBorderWidth: 0.5,
            },
            /* خط-فاصله‌ساز نامرئی — فقط ارتفاعش مهم است (گام ردیف) */
            sp: { lineHeight: pxPitch, fontSize: 0.1, color: 'rgba(0,0,0,0)' },
          },
        },
        axisLine: { lineStyle: { color: P.axisLine } },
        axisTick: { show: false },
        name: 'عرض (mm)',
        nameLocation: 'middle',
        nameGap: 56,
        nameTextStyle: { color: P.faint, fontFamily: P.fontFamily, fontSize: 10.5 },
      },
      series,
    };

    Dashboard.applyChart('width-inventory-chart', option);

    // همگام‌سازی ابعاد نمونهٔ موجود با ارتفاع پویای جدید (نسخهٔ ۳٫۴ — تغییر ۷)
    const widthInst = Dashboard._charts['width-inventory-chart'];
    if (widthInst) {
      try { widthInst.resize(); } catch (e) { /* noop */ }
    }
  };

  /* ---------- Fallback قدیمی: میله‌های CSS (نبود ECharts) ---------- */

  Dashboard.renderMachineTimeChartFallback = function (state) {
    const s = state.summary;
    const machines = RM.config.VALID_MACHINES;

    let maxVal = 0;
    for (const m of machines) {
      const t = s.machineTime[m];
      if (t) maxVal = Math.max(maxVal, t.setup, t.produced);
    }
    if (maxVal === 0) maxVal = 1;

    const rows = machines.map((m) => {
      const t = s.machineTime[m] || { setup: 0, produced: 0, records: 0 };
      const setupPct = Math.max(2, Math.round((t.setup / maxVal) * 100));
      const producedPct = Math.max(2, Math.round((t.produced / maxVal) * 100));
      const hasData = t.records > 0;

      return `
        <div class="mt-row" data-machine="${m}">
          <div class="mt-label">
            <b>دستگاه ${U.faNum(m)}</b>
            <span class="muted mt-records">${hasData ? `${U.faNum(t.records)} رکورد` : 'بدون رکورد مطابق'}</span>
          </div>
          <div class="mt-bars">
            <div class="mt-bar-line">
              <span class="mt-legend-setup" title="مانده زمان ستاپ = (تعداد − متالایز) × مدت زمان">ستاپ</span>
              <div class="mt-track">
                <div class="mt-bar mt-bar-setup" style="width:${hasData ? setupPct : 0}%"></div>
              </div>
              <span class="mt-val">${U.faDuration(t.setup)}</span>
            </div>
            <div class="mt-bar-line">
              <span class="mt-legend-produced" title="مانده زمان موجودی = خام موجود × مدت زمان">موجودی</span>
              <div class="mt-track">
                <div class="mt-bar mt-bar-produced" style="width:${hasData ? producedPct : 0}%"></div>
              </div>
              <span class="mt-val">${U.faDuration(t.produced)}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    document.getElementById('machine-time-chart').innerHTML = `
      <div class="mt-legend-bar">
        <span class="mt-legend-item"><span class="mt-dot mt-dot-setup"></span> مانده زمان ستاپ ((تعداد − متالایز) × مدت زمان)</span>
        <span class="mt-legend-item"><span class="mt-dot mt-dot-produced"></span> مانده زمان موجودی (خام موجود × مدت زمان)</span>
      </div>
      <div class="mt-rows">${rows}</div>`;
  };

  /* ---------- مرکز هشدار + Drill-down رکوردهای عامل (§8 اصلاحات) ---------- */

  const SEVERITY_META = {
    error: { label: 'خطا', cls: 'alert-error' },
    warning: { label: 'هشدار', cls: 'alert-warning' },
  };

  Dashboard.renderAlerts = function (warnings) {
    const wrap = document.getElementById('alerts-list');
    const panel = document.getElementById('alerts-panel');

    if (!warnings.length) {
      panel.hidden = true;
      wrap.innerHTML = '';
      return;
    }

    panel.hidden = false;
    document.getElementById('alerts-count').textContent = U.faNum(warnings.length);

    wrap.innerHTML = warnings.map((w) => {
      const meta = SEVERITY_META[w.severity] || SEVERITY_META.warning;
      const hasDrill = !!w.drill;
      return `
        <div class="alert-item ${meta.cls}" role="alert" data-alert="${U.escapeHtml(w.type)}">
          <span class="alert-badge">${meta.label}</span>
          <div class="alert-body">
            <b>${U.escapeHtml(w.title)}</b>
            <p>${U.escapeHtml(w.detail)}</p>
          </div>
          ${hasDrill
            ? `<button type="button" class="btn btn-ghost btn-sm" data-alert-drill="${U.escapeHtml(w.type)}" title="نمایش رکوردهای عامل این هشدار">مشاهدهٔ رکوردها</button>`
            : (w.action
              ? `<button type="button" class="btn btn-ghost btn-sm" data-alert-action="${w.action}">مشاهده</button>`
              : '')}
        </div>`;
    }).join('');

    // دکمهٔ «مشاهدهٔ رکوردها» → Drill-down دقیق رکوردهای عامل همان هشدار
    wrap.querySelectorAll('[data-alert-drill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = warnings.find((x) => x.type === btn.dataset.alertDrill);
        if (w) Dashboard.openDrill(w);
      });
    });

    // هشدارهای بدون Drill → رفتن به بخش مرتبط (رفتار قبلی حفظ شد)
    wrap.querySelectorAll('[data-alert-action]').forEach((btn) => {
      btn.addEventListener('click', () => UI.switchTab(btn.dataset.alertAction));
    });
  };

  /**
   * بازکردن Drill-down یک هشدار — دقیقاً رکوردهای عامل همان Rule.
   * موجودیت‌های Roll از مودال مشترک با ستون‌های Mapping استفاده می‌کنند؛
   * هشدارهای مربوط به ستاپ/قانون جدول اختصاصی خودشان را می‌گیرند.
   */
  Dashboard.openDrill = async function (warning) {
    const d = warning.drill;
    if (!d) return;

    try {
      /* --- هشدارهای مربوط به ستاپ‌ها --- */
      if (d.source === 'setups') {
        const state = Dashboard._state;
        /* ۳٫۳۱ — رکوردهای «منقضی شده» زمان‌هایشان عمداً null است و نباید در
           Drill «بدون قانون زمان» بیایند (مثل خود هشدار در calc.js). */
        const rows = (d.filter === 'capacity-conflict')
          ? state.setupReport.filter((r) => r.conflict > 0)
          : (d.filter === 'no-time-rule')
            ? state.setupReport.filter((r) => r.remainingSetupTime === null && r.expired !== true)
            : state.setupReport.filter((r) => r.thickness === null || r.standardLength === null);

        const timeCols = (d.filter === 'no-time-rule')
          ? '<th>مانده زمان</th>'
          : '<th>خام</th><th>متالایز</th><th>مغایرت</th>';

        UI.infoModal(warning.title, `
          <div class="drill-subtitle"><b>${U.faNum(rows.length)}</b> رکورد ستاپ</div>
          <div class="table-wrap table-scroll" style="max-height:420px">
            <table class="data-table">
              <thead><tr><th>ستاپ</th><th>دستگاه</th><th>عرض</th><th>ضخامت</th><th>متراژ استاندارد</th><th>تعداد</th>${timeCols}</tr></thead>
              <tbody>${rows.map((r) => `
                <tr>
                  <td>${U.faNum(r.setupNumber)}</td>
                  <td>${U.faNum(r.machineNumber)}</td>
                  <td>${U.faWidth(r.width)}</td>
                  <td>${r.thickness === null ? '<span class="muted">ناقص</span>' : U.faNum(r.thickness)}</td>
                  <td>${r.standardLength === null ? '<span class="muted">ناقص</span>' : U.faNum(r.standardLength)}</td>
                  <td class="count-cell">${U.faNum(r.rollCount)}</td>
                  ${d.filter === 'no-time-rule'
                    ? `<td><span class="muted">بدون قانون زمان</span></td>`
                    : `<td>${U.faNum(r.rawExisting)}</td>
                       <td>${U.faNum(r.metallized)}</td>
                       <td>${r.conflict > 0 ? `<span class="pill-bad status-pill">⚠ ${U.faNum(r.conflict)}</span>` : '—'}</td>`}
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `);
        return;
      }

      /* --- هشدار هم‌پوشانی قوانین --- */
      if (d.source === 'rules') {
        UI.infoModal(warning.title, `
          <div class="drill-subtitle"><b>${U.faNum(d.pairs.length)}</b> جفت قانون هم‌پوشان</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>ضخامت</th><th>بازهٔ قانون ۱</th><th>بازهٔ قانون ۲</th></tr></thead>
              <tbody>${d.pairs.map(([a, b]) => `
                <tr>
                  <td class="thickness-cell">${U.faNum(a.thickness)}</td>
                  <td>${U.faNum(a.minLength)} تا ${U.faNum(a.maxLength)} → ${U.faNum(a.standardLength)}</td>
                  <td>${U.faNum(b.minLength)} تا ${U.faNum(b.maxLength)} → ${U.faNum(b.standardLength)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `);
        return;
      }

      /* --- هشدارهای رکوردی (rolls / archived) → مودال مشترک --- */
      const sourceKey = d.source;
      const table = RM.config.IMPORT_TARGETS[sourceKey].table;
      let records = [];

      if (d.issue) {
        // نقص دادهٔ مستقیم: بدون عرض / بدون متراژ / بدون ضخامت / شماره رول / نوع فیلم
        // رزولور مشترک نقص‌ها («length» → actualLength در مدل داخلی)
        const all = await db[table].toArray();
        records = RM.normalize.recordsWithIssue(all, d.issue);
      } else if (d.filter === 'all') {
        // Mapping ناقص — همهٔ رکوردهای همان Dataset (فیلدهای مفقود «—» نمایش داده می‌شوند)
        records = await db[table].toArray();
      } else if (d.filter === 'no-rule') {
        // رول‌های خام بدون قانون متراژ — از گروه‌های بدون قانون (کلید‌محور)
        const state = Dashboard._state;
        const groups = state.rawRollGroups.filter((g) => !g.hasRule);
        const ids = groups.flatMap((g) => g.rollIds);
        records = (await db.rolls.bulkGet(ids)).filter(Boolean);
      } else if (d.filter === 'group') {
        // گروه‌های خاص (بدون ستاپ / مازاد خام)
        const state = Dashboard._state;
        const keySet = new Set(d.groupKeys || []);
        const groups = state.rawRollGroups.filter((g) => keySet.has(g.key));
        const ids = groups.flatMap((g) => g.rollIds);
        records = (await db.rolls.bulkGet(ids)).filter(Boolean);
      } else if (d.filter === 'metallized-uncut-overdue') {
        // رول‌های متالایزشدهٔ برش‌نشده از مهلت گذشته (نسخهٔ ۳٫۵ — تغییر ۹):
        // شناسه‌ها از موتور محاسبه — M دارد ولی بازوی برش (R/L) ندارد و از
        // «تاریخ تولید» بیش از مهلت مجاز (تنظیمات) گذشته‌اند.
        const ids = Array.isArray(d.ids) ? d.ids : [];
        const got = ids.length ? await db.rolls.bulkGet(ids) : [];
        records = await RM.edits.applyToRecords('rolls', got.filter(Boolean));
      } else if (d.filter === 'metallized-unallocated') {
        // مازاد متالایز — یونیک‌های دارای کلیدِ تخصیص‌نیافته
        // نسخهٔ ۲٫۹: کلید شامل هویت رول (خط تولید + سالن + رقم سال از شمارهٔ رول)
        // نسخهٔ ۳٫۱ — تغییر ۳: کلید متالایز شامل «متراژ استاندارد» هم هست و از
        // نقشهٔ آمادهٔ موتور محاسبه (keyByRollNumber) خوانده می‌شود — بازسازی
        // دستی کلید اینجا حذف شد تا همیشه هم‌قالب با موتور بماند.
        const state = Dashboard._state;
        const keySet = new Set(d.groupKeys || []);
        const keyMap = state.metallizedKeyByRollNumber || {};
        records = state.metallizedUniqueRecords.filter((r) =>
          keySet.has(keyMap[String(r.rollNumber ?? '')]));
      } else if (d.filter === 'metallized-no-setup') {
        /* --- ۳٫۳۱ — هشدار «رول متالایز شده بدون ستاپ» (تغییر ۱ کاربر) ---
           رول‌های متالایزِ «سابقه رول‌ها (آرشیو)» که کلید ۴فاکتوری‌شان
           (شماره ستاپ + نوع خط + شماره سالن + شماره سال) با رکوردی از جدول
           ستاپ مطابق است ولی یا اصلاً متراژ استاندارد ندارند (حالت A) یا
           متراژ استانداردشان با ستاپ‌های همان کلید مغایر است (حالت B).
           جدول اختصاصی با ستون «علت» — داده‌ها از محاسبهٔ موتور (d.rows). */
        const rows = Array.isArray(d.rows) ? d.rows : [];
        const reasonHtml = (x) => x.reason === 'no-std'
          ? '<span class="pill-bad status-pill" title="متراژ واقعی/ضخامت این رول با هیچ قانونی از «تعریف قانون متراژ استاندارد جدید» تطبیق نشد">نداشتن متراژ استاندارد</span>'
          : '<span class="pill-warn status-pill" title="رول متراژ استاندارد دارد ولی با متراژ استاندارد هیچ‌کدام از رکوردهای ستاپِ همان کلید برابر نیست">عدم مطابقت متراژ استاندارد</span>';
        const noStdCount = rows.filter((x) => x.reason === 'no-std').length;
        const mismatchCount = rows.length - noStdCount;

        UI.infoModal(warning.title, `
          <div class="drill-subtitle">
            <b>${U.faNum(rows.length)}</b> رول متالایزِ آرشیو —
            ${noStdCount ? `<b>${U.faNum(noStdCount)}</b> بدون متراژ استاندارد` : ''}${noStdCount && mismatchCount ? ' · ' : ''}${mismatchCount ? `<b>${U.faNum(mismatchCount)}</b> با متراژ استاندارد مغایر` : ''}
          </div>
          <p style="font-size:.76rem;color:var(--text-muted);margin:0 0 10px">
            کلید «شماره ستاپ + نوع خط + شماره سالن + شماره سال» این رول‌ها با رکوردهای جدول ستاپ مطابق است ولی رول در ستاپ‌های همان کلید جایی ندارد؛
            ستون «متراژ استاندارد ستاپ‌های همان کلید» مقادیر ستاپ‌های منطبق را نشان می‌دهد.
          </p>
          <div class="table-wrap table-scroll" style="max-height:420px">
            <table class="data-table">
              <thead><tr>
                <th>شماره رول</th><th>ستاپ</th><th>خط</th><th>سالن</th><th>سال</th>
                <th>ضخامت</th><th>متراژ واقعی</th><th>متراژ استاندارد رول</th>
                <th>متراژ استاندارد ستاپ‌های همان کلید</th><th>علت</th>
              </tr></thead>
              <tbody>${rows.map((x) => `
                <tr>
                  <td class="ltr-cell" style="direction:ltr;text-align:right;font-family:var(--font-mono,inherit)">${U.escapeHtml(String(x.rollNumber ?? '—'))}</td>
                  <td>${x.setupNumber === null || x.setupNumber === undefined ? '—' : U.faNum(x.setupNumber)}</td>
                  <td>${x.line ? U.escapeHtml(String(x.line)) : '—'}</td>
                  <td>${x.hall === null || x.hall === undefined ? '—' : U.faNum(x.hall)}</td>
                  <td>${x.yearDigit === null || x.yearDigit === undefined ? '—' : U.faNumPlain(x.yearDigit)}</td>
                  <td>${x.thickness === null || x.thickness === undefined ? '—' : U.faNum(x.thickness)}</td>
                  <td>${x.actualLength === null || x.actualLength === undefined ? '—' : U.faNum(x.actualLength)}</td>
                  <td>${x.std === null || x.std === undefined
                    ? '<span class="muted" title="با هیچ قانونی از «تعریف قانون متراژ استاندارد جدید» تطبیق نشد">ندارد</span>'
                    : U.faNum(x.std)}</td>
                  <td>${(Array.isArray(x.setupStds) ? x.setupStds : []).map((s) => U.faNum(s)).join('، ') || '—'}</td>
                  <td>${reasonHtml(x)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `, { wide: true });
        return;   // مودال اختصاصی نمایش داده شد — از مودال مشترک رد نشو
      } else if (d.filter === 'metallized-width-mismatch') {
        // رول‌های متالایز با عرض تعریف‌نشده در ستاپ — نمایش گروه‌بندی‌شده (۳٫۸):
        // رکوردها با کلید «عرض + متراژ استاندارد + شماره ستاپ + خط تولید + شماره
        // سالن + عدد سال» گروه می‌شوند (متراژ استاندارد از قوانین حل می‌شود) و
        // رول‌های هر گروه در جدولی جدا با ستون‌های شخصی‌سازی‌شدهٔ مشترک نمایش
        // داده می‌شوند — اولین گروه باز و بقیه بسته هستند.
        const ids = Array.isArray(d.ids) ? d.ids : [];
        const got = ids.length ? await db.archivedRolls.bulkGet(ids) : [];
        const records = await RM.edits.applyToRecords('archived', got.filter(Boolean));

        const rules = await db.standardLengthRules.toArray();
        await RM.keys.ensure();   // ۳٫۲۶ — ترکیب کلید متالایز (مصرف همگام مطمئن)
        const groupMap = new Map();   // key → گروه
        for (const rec of records) {
          const idn = RM.normalize.parseRollIdentity(rec.rollNumber);
          const std = RM.rulesEngine.resolveStandardLength(rules, rec.thickness, rec.actualLength);
          /* ۳٫۲۶ — همان کلید metMatch موتور محاسبه (RM.keys — همیشه هم‌قالب
             با تخصیص متالایز؛ ترکیب از «تنظیمات ← کلیدهای تطبیق»).
             ۳٫۲۷ — عرض کلید و نمایش گروه هر دو از ستون نمایندهٔ تنظیم‌شدهٔ
             منبع عرض آرشیو (widthPolicy کلید متالایز — پیش‌فرض ستون «عرض»). */
          const recWidth = RM.keys.widthValue('metMatch', 'archived', rec);
          const key = RM.keys.build('metMatch', {
            width: recWidth,
            standardLength: std,
            setupNumber: rec.setupNumber,
            thickness: rec.thickness,
            line: idn.line,
            hall: idn.hall,
            yearDigit: idn.yearDigit,
          });
          let g = groupMap.get(key);
          if (!g) {
            g = {
              key, width: recWidth, standardLength: std, setupNumber: rec.setupNumber,   // ۳٫۲۷ — عرض مناسب منبع آرشیو
              line: idn.line, hall: idn.hall, yearDigit: idn.yearDigit, records: [],
            };
            groupMap.set(key, g);
          }
          g.records.push(rec);
        }
        const groups = [...groupMap.values()].sort((a, b) =>
          ((a.setupNumber ?? 0) - (b.setupNumber ?? 0)) ||
          ((a.width ?? 0) - (b.width ?? 0)) ||
          ((a.standardLength ?? 0) - (b.standardLength ?? 0)) ||
          String(a.line).localeCompare(String(b.line))
        );

        /* ۳٫۹ — تغییر ۶: مودال عریض — جدول‌های دارای پنل «ستون‌های جزئیات»
           فضای نمایش ستون‌های بیشتری دارند. */
        UI.infoModal(warning.title, `
          <div class="drill-subtitle">
            <b>${U.faNum(records.length)}</b> رکورد در <b>${U.faNum(groups.length)}</b> گروه — کلید گروه: عرض + متراژ استاندارد + شماره ستاپ + خط تولید + شماره سالن + عدد سال
          </div>
          <div id="drill-cols-picker"></div>
          <div id="wm-groups"></div>
        `, { wide: true });

        const groupsWrap = document.getElementById('wm-groups');
        const renderGroups = async () => {
          const columns = await UI.rollDetailColumns('archived');
          groupsWrap.innerHTML = groups.map((g, i) => `
            <details class="wm-group-box"${i === 0 ? ' open' : ''}>
              <summary>
                <span>عرض ${U.faWidth(g.width)} · متراژ استاندارد ${g.standardLength === null ? '—' : U.faNum(g.standardLength)} · ستاپ ${g.setupNumber === null ? '—' : U.faNum(g.setupNumber)} · خط ${U.escapeHtml(g.line || '—')} · سالن ${g.hall === null ? '—' : U.faNum(g.hall)} · سال ${g.yearDigit === null ? '—' : U.faNumPlain(g.yearDigit)}</span>
                <span class="wm-count-chip">${U.faNum(g.records.length)} رول</span>
              </summary>
              <div class="wm-group-body">
                <div id="wm-group-tbl-${i}"></div>
              </div>
            </details>
          `).join('');

          groups.forEach((g, i) => {
            const wrap = document.getElementById(`wm-group-tbl-${i}`);
            const renderPage = (page) => {
              UI.renderTable(wrap, columns, g.records, {
                page,
                pageSize: RM.config.PAGE_SIZE,
                emptyText: 'رکوردی برای نمایش یافت نشد.',
                onPageChange: (nextPage) => renderPage(nextPage),
              });
            };
            renderPage(1);
          });
        };

        const mountPicker = async () => {
          await UI.mountDetailColsPicker(
            document.getElementById('drill-cols-picker'),
            'archived',
            async () => {
              await mountPicker();
              await renderGroups();
            }
          );
        };

        await mountPicker();
        await renderGroups();
        return;   // مودال گروه‌بندی‌شده نمایش داده شد — از مودال مشترک رد نشو
      }

      await UI.recordsDrillModal(warning.title, records, { source: sourceKey });
    } catch (err) {
      console.error('[Drill-down]', err);
      UI.toast('نمایش رکوردهای این هشدار با خطا مواجه شد.', 'error');
    }
  };

  /* ---------- اطلاعات آخرین Import (§12 — عنوان کاربرپسنده + نام فایل برای Audit) ---------- */

  Dashboard.renderImportBadges = async function () {
    for (const targetKey of ['rolls', 'archived']) {
      const el = document.getElementById(`kpi-file-${targetKey}`);
      if (!el) continue;

      const entries = await db.importMetadata
        .where('target').equals(targetKey)
        .reverse()
        .sortBy('importedAt');
      const info = entries[0];

      el.innerHTML = info
        ? `${U.escapeHtml(RM.config.DATASET_LABELS[targetKey])} — <code>${U.escapeHtml(U.truncate(info.fileName, 28))}</code> · ${U.faNum(info.totalRecords)} رکورد · ${U.faDate(info.importedAt)}`
        : '<span class="muted">فایلی بارگذاری نشده</span>';
    }
  };

  RM.views = RM.views || {};
  RM.views.dashboard = Dashboard;
})();
