/* =========================================================================
   views/rolls.js — نما صفحهٔ «رول‌ها» (§31-§38، §90)
   -------------------------------------------------------------------------
   دو تب داخلی:
     ۱) رول‌های خام — گروه‌بندی ۶فاکتوری (عرض + متراژ استاندارد + شماره ستاپ
        + خط تولید + شماره سالن + عدد سال — نسخهٔ ۲٫۹/۳٫۰) + جدول + وضعیت تطبیق
        + مرتب‌سازی چندمرحله‌ایِ کشیدنی و ماندگار (§36-§38)
        ستون‌های هویت (خط تولید/سالن/سال) در جدول — نسخهٔ ۳٫۰ تغییر ۶
     ۲) رول‌های برش‌خورده — placeholder آمادهٔ معماری (§31، §98)
   همهٔ داده‌ها از موتور محاسبهٔ مرکزی می‌آیند (§79).
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const DB = RM.db;
  const db = RM.db.db;

  const RollsView = {
    sortPipeline: null,     // [{field, direction}] — ماندگار (§38)
    filters: {},            // { fieldKey: {value, invert} } — فیلتر زیر سرستون‌ها (نسخهٔ ۲٫۳)
    sortPanelVisible: true, // نمایش/مخفی پنل مرتب‌سازی (ماندگار — نسخهٔ ۲٫۳)
    visibleRows: null,      // تعداد ردیف قابل نمایش (ماندگار — نسخهٔ ۲٫۴)
    columnOrder: null,      // ترتیب ستون‌ها (ماندگار — نسخهٔ ۲٫۶، مثل گزارش ستاپ‌ها)
    columnWidths: null,     // { colKey: px } — عرض ستون‌ها (ماندگار — نسخهٔ ۲٫۶)
    colsPanelVisible: true, // نمایش/مخفی پنل ترتیب ستون‌ها (ماندگار — نسخهٔ ۲٫۶)
    _lastDetailGroup: null, // آخرین گروهِ باز‌شده در جزئیات (برای رندر مجدد ستون‌ها)
  };

  /* ================================================================
     ۱) راه‌اندازی
     ================================================================ */

  RollsView.init = async function () {
    // بارگذاری مرتب‌سازی ذخیره‌شده یا پیش‌فرض (§38)
    RollsView.sortPipeline = await DB.getSetting('rawRollsSort', RM.config.DEFAULT_SORT);

    // وضعیت نمایش/مخفی پنل مرتب‌سازی — ماندگار (نسخهٔ ۲٫۳ — مثل برش‌خورده‌ها)
    RollsView.sortPanelVisible = await DB.getSetting('rawSortPanelVisible', true);

    // تعداد ردیف قابل نمایش — ماندگار (نسخهٔ ۲٫۴: باکس تعداد ردیف)
    RollsView.visibleRows = await DB.getSetting('rawVisibleRows', RM.config.RAW_VISIBLE_ROWS);

    /* --- پنل ترتیب ستون‌ها + عرض ستون‌ها (نسخهٔ ۲٫۶ — دقیقاً مانند گزارش ستاپ‌ها) --- */
    RollsView.colsPanelVisible = await DB.getSetting('rawColsPanelVisible', true);
    RollsView.columnOrder = await DB.getSetting(
      'rawColumnOrder', RM.config.RAW_DEFAULT_COLUMN_ORDER);

    /* --- مهاجرت نرم ترتیب ستون‌ها (نسخهٔ ۳٫۰ — تغییر ۶): کلیدهای جدید هویت
           (line/hall/year) که در ترتیب ذخیره‌شدهٔ نسخ‌های قبلی نیستند، بعد از
           ستونِ قبل از خود در ترتیب پیش‌فرض (شماره ستاپ) درج می‌شوند. --- */
    if (Array.isArray(RollsView.columnOrder)) {
      const defaults = RM.config.RAW_DEFAULT_COLUMN_ORDER;
      const missing = defaults.filter((k) => !RollsView.columnOrder.includes(k));
      for (const key of missing) {
        const prevIndex = defaults.indexOf(key) - 1;
        const anchor = prevIndex >= 0 ? defaults[prevIndex] : null;
        const at = anchor !== null ? RollsView.columnOrder.indexOf(anchor) : -1;
        if (at !== -1) RollsView.columnOrder.splice(at + 1, 0, key);
        else RollsView.columnOrder.push(key);
      }
      if (missing.length) {
        await DB.setSetting('rawColumnOrder', RollsView.columnOrder);
      }
    }

    RollsView.columnWidths = Object.assign(
      {}, RM.config.RAW_DEFAULT_COLUMN_WIDTHS,
      await DB.getSetting('rawColumnWidths', {}) || {}
    );

    /* ۳٫۹ — تغییر ۵: دکمه‌های «ترتیب ستون‌ها»/«مرتب‌سازی» به نوار بالای جدول
       منتقل شدند — اتصال از طریق opts.tools/onToolToggle در filterTable. */

    const colsResetBtn = document.getElementById('raw-cols-reset-btn');
    if (colsResetBtn) {
      colsResetBtn.addEventListener('click', async () => {
        RollsView.columnOrder = [...RM.config.RAW_DEFAULT_COLUMN_ORDER];
        RollsView.columnWidths = { ...RM.config.RAW_DEFAULT_COLUMN_WIDTHS };
        await DB.setSetting('rawColumnOrder', RollsView.columnOrder);
        await DB.setSetting('rawColumnWidths', RollsView.columnWidths);
        RollsView.renderColumnOrderPanel();
        RollsView.renderTable();
        UI.toast('ترتیب و عرض ستون‌ها به حالت پیش‌فرض بازگشت.', 'info');
      });
    }

    RollsView.applyColsPanelVisibility();

    RollsView.applySortPanelVisibility();

    // تب‌های داخلی (محدود به صفحهٔ رول‌ها — زبانه‌های صفحات دیگر مستقل‌اند)
    // نسخهٔ ۳٫۱ — تغییر ۲: موقعیت اسکرول هر زیرنما مستقل ذخیره/بازگردانی می‌شود
    document.querySelectorAll('#view-rolls .subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        // ذخیرهٔ اسکرول زیرنمای ترک‌شده (کلید نما:زیرنما)
        UI.saveCurrentScroll();

        document.querySelectorAll('#view-rolls .subtab-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        const target = btn.dataset.subview;
        document.querySelectorAll('#view-rolls .subview').forEach((el) => {
          el.classList.toggle('active', el.id === `subview-${target}`);
          el.hidden = el.id !== `subview-${target}`;
        });

        // بازگردانی اسکرول ذخیره‌شدهٔ زیرنمای مقصد
        UI.restoreScrollPosition(UI.pageKeyOf(document.getElementById('view-rolls')));
      });
    });

    // سازندهٔ مرتب‌سازی: افزودن فیلد
    const addSelect = document.getElementById('sort-add-select');
    document.getElementById('sort-add-btn').addEventListener('click', () => {
      const field = addSelect.value;
      if (!field) return;
      // جلوگیری از تکرار فیلد در خط لوله
      if (RollsView.sortPipeline.some((s) => s.field === field)) {
        UI.toast('این فیلد قبلاً به مرتب‌سازی اضافه شده است.', 'info');
        return;
      }
      RollsView.sortPipeline.push({ field, direction: 'asc' });
      RollsView.saveSort();
      RollsView.renderSortBuilder();
      RollsView.renderTable();
    });

    // بازنشانی مرتب‌سازی
    document.getElementById('sort-reset-btn').addEventListener('click', async () => {
      RollsView.sortPipeline = JSON.parse(JSON.stringify(RM.config.DEFAULT_SORT));
      await DB.setSetting('rawRollsSort', RollsView.sortPipeline);
      RollsView.renderSortBuilder();
      RollsView.renderTable();
      UI.toast('مرتب‌سازی به حالت پیش‌فرض بازگشت.', 'info');
    });

    RollsView.renderSortBuilder();
    RollsView.renderColumnOrderPanel();      // نسخهٔ ۲٫۶ — پنل ترتیب ستون‌ها
  };

  /* ================================================================
     ۲) سازندهٔ مرتب‌سازی کشیدنی (§36-§38)
     ================================================================ */

  /** ذخیرهٔ ماندگار خط لولهٔ مرتب‌سازی (§38) */
  RollsView.saveSort = function () {
    DB.setSetting('rawRollsSort', RollsView.sortPipeline);
  };

  /** رندر چیپ‌های «پنل مرتب‌سازی» — مولفهٔ مشترک UI (کشیدن + جهت + حذف) */
  RollsView.renderSortBuilder = function () {
    UI.sortPanel(document.getElementById('sort-pipeline'), RollsView.sortPipeline, RM.config.SORTABLE_FIELDS, {
      onDir: (i) => {
        RollsView.sortPipeline[i].direction =
          RollsView.sortPipeline[i].direction === 'asc' ? 'desc' : 'asc';
        RollsView.saveSort();
        RollsView.renderSortBuilder();
        RollsView.renderTable();
      },
      onRemove: (i) => {
        RollsView.sortPipeline.splice(i, 1);
        RollsView.saveSort();
        RollsView.renderSortBuilder();
        RollsView.renderTable();
      },
      onReorder: (from, to) => {
        const [moved] = RollsView.sortPipeline.splice(from, 1);
        RollsView.sortPipeline.splice(to, 0, moved);
        RollsView.saveSort();
        RollsView.renderSortBuilder();
        RollsView.renderTable();
      },
    });
  };

  /* ================================================================
     ۲-ب) نمایش/مخفی پنل مرتب‌سازی (ماندگار — نسخهٔ ۲٫۳)
     ================================================================ */

  RollsView.applySortPanelVisibility = function () {
    const builder = document.getElementById('roll-sort-builder');
    const toggleBtn = document.getElementById('roll-sort-toggle');

    // ۳٫۹ — تغییر ۵: دکمه داخل نوار بالای جدول است؛ builder مستقل از دکمه به‌روز
    // می‌شود تا در نبود جدول (حالت خالی) وضعیت ذخیره‌شدهٔ پنل هم اعمال بماند.
    if (builder) builder.hidden = !RollsView.sortPanelVisible;
    if (!toggleBtn) return;

    toggleBtn.setAttribute('aria-expanded', String(RollsView.sortPanelVisible));
    toggleBtn.classList.toggle('panel-on', RollsView.sortPanelVisible);
    toggleBtn.title = RollsView.sortPanelVisible
      ? 'بستن پنل مرتب‌سازی (برای صرفه‌جویی در فضا)'
      : 'نمایش پنل مرتب‌سازی';
  };

  /* ================================================================
     ۲-ج) پنل ترتیب ستون‌ها + عرض ستون‌ها (نسخهٔ ۲٫۶ — مانند گزارش ستاپ‌ها)
     ================================================================ */

  /** اعمال وضعیت نمایش/مخفی پنل ترتیب ستون‌ها */
  RollsView.applyColsPanelVisibility = function () {
    const builder = document.getElementById('raw-cols-builder');
    const toggleBtn = document.getElementById('raw-cols-toggle');

    // ۳٫۹ — تغییر ۵: دکمه داخل نوار بالای جدول است؛ builder مستقل از دکمه به‌روز
    // می‌شود تا در نبود جدول (حالت خالی) وضعیت ذخیره‌شدهٔ پنل هم اعمال بماند.
    if (builder) builder.hidden = !RollsView.colsPanelVisible;
    if (!toggleBtn) return;

    toggleBtn.setAttribute('aria-expanded', String(RollsView.colsPanelVisible));
    toggleBtn.classList.toggle('panel-on', RollsView.colsPanelVisible);
    toggleBtn.title = RollsView.colsPanelVisible
      ? 'بستن پنل ترتیب ستون‌ها (برای صرفه‌جویی در فضا)'
      : 'نمایش پنل ترتیب ستون‌ها';
  };

  /** رندر پنل «ترتیب ستون‌ها» — چیپ‌های کشیدنی + باکس عرض هر ستون */
  RollsView.renderColumnOrderPanel = function () {
    const all = RollsView.columnRegistry();
    const widths = RollsView.columnWidths || {};
    const items = (RollsView.columnOrder || RM.config.RAW_DEFAULT_COLUMN_ORDER)
      .map((key) => all[key])
      .filter(Boolean)
      .map((c) => ({ key: c.key, label: c.label, width: widths[c.key] ?? 0 }));

    UI.orderPanel(document.getElementById('raw-cols-pipeline'), items, {
      onMove: async (from, to) => {
        const order = RollsView.columnOrder || [...RM.config.RAW_DEFAULT_COLUMN_ORDER];
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        RollsView.columnOrder = order;
        await DB.setSetting('rawColumnOrder', order);
        RollsView.renderColumnOrderPanel();
        RollsView.renderTable();
      },
      onWidth: async (key, w) => {
        RollsView.columnWidths = RollsView.columnWidths || {};
        RollsView.columnWidths[key] = w;
        await DB.setSetting('rawColumnWidths', RollsView.columnWidths);
        RollsView.renderTable();
      },
      emptyText: 'بدون ستون',
    });
  };

  /* ================================================================
     ۳) اعمال مرتب‌سازی چندمرحله‌ای روی گروه‌ها (§36 + فیلد وضعیت)
     ================================================================ */

  /** مقدار وضعیت گروه برای مرتب‌سازی: ۱=دارای ستاپ ۲=بدون ستاپ ۳=غیرقابل تطبیق */
  RollsView.groupStatusRank = function (g) {
    if (!g.hasRule) return 3;
    return g.matched ? 1 : 2;
  };

  RollsView.sortGroups = function (groups) {
    const sorted = [...groups];
    // اعمال از آخرین اولویت به اولین (اولین، غالب‌ترین است)
    for (let i = RollsView.sortPipeline.length - 1; i >= 0; i--) {
      const { field, direction } = RollsView.sortPipeline[i];
      sorted.sort((a, b) => {
        if (field === 'status') {
          const r = RollsView.groupStatusRank(a) - RollsView.groupStatusRank(b);
          return direction === 'desc' ? -r : r;
        }
        /* نسخهٔ ۳٫۰ — خط تولید: مقایسهٔ لغوی (BOPP/CPP)؛ تهی‌ها آخر */
        if (field === 'line') {
          const ka = a.line ? String(a.line) : '';
          const kb = b.line ? String(b.line) : '';
          let r;
          if (ka === '' && kb === '') r = 0;
          else if (ka === '') r = 1;
          else if (kb === '') r = -1;
          else r = ka.localeCompare(kb, 'en');
          return direction === 'desc' ? -r : r;
        }
        return U.compareNumeric(a[field], b[field], direction);
      });
    }
    return sorted;
  };

  /* ================================================================
     ۴) رندر جدول گروه‌های رول خام (§33-§35) — نسخهٔ ۲٫۳
        همان طراحی جدول «رول‌های برش‌خورده»: کامپوننت مشترک UI.filterTable
        (ارتفاع ۵۰ رکورد + فیلتر «شامل بودن» زیر سرستون‌ها + دکمهٔ «≠» +
        حفظ فوکوس + سرستون چسبان). ستون‌های «عرض» و «شماره ستاپ» بولد و بزرگ.
        نسخهٔ ۲٫۶: ترتیب/عرض ستون‌ها از «پنل ترتیب ستون‌ها» (مانند گزارش ستاپ‌ها)
        + باکس جمع زیر ستون «تعداد» (با احترام به فیلتر).
     ================================================================ */

  /** رجیستری ستون‌های جدول خام — ترتیب نمایش از RollsView.columnOrder */
  RollsView.columnRegistry = function () {
    const widths = RollsView.columnWidths || {};

    /* برچسب متنی وضعیت برای فیلتر/جست‌وجو */
    const statusText = (r) => (r.matched
      ? 'دارای ستاپ'
      : (r.hasRule ? 'بدون ستاپ' : 'غیرقابل تطبیق'));

    const registry = {
      width: {
        key: 'width', label: 'عرض (mm)', className: 'em-cell',
        headerTitle: 'عرض رول اولیه (mm)',
        render: (r) => U.faWidth(r.width),
        tokens: (r) => [U.faWidth(r.width), String(r.width ?? '')],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت (μ)',
        render: (r) => U.faNum(r.thickness),
        tokens: (r) => [U.faNum(r.thickness), String(r.thickness ?? '')],
      },
      standardLength: {
        key: 'standardLength', label: 'متراژ استاندارد',
        render: (r) => r.hasRule
          ? U.faNum(r.standardLength)
          : '<span class="muted" title="قانون متراژی برای این رول یافت نشد">بدون قانون</span>',
        tokens: (r) => r.hasRule
          ? [U.faNum(r.standardLength), String(r.standardLength ?? '')]
          : ['بدون قانون'],
      },
      setupNumber: {
        key: 'setupNumber', label: 'شماره ستاپ', className: 'em-cell',
        render: (r) => U.faNum(r.setupNumber),
        tokens: (r) => [U.faNum(r.setupNumber), String(r.setupNumber ?? '')],
      },
      line: {
        /* نسخهٔ ۳٫۰ — تغییر ۶: خط تولید هویت گروه (F=BOPP · K=CPP) */
        key: 'line', label: 'خط تولید', className: 'line-cell',
        headerTitle: 'خط تولید هویت گروه — از شمارهٔ رول (F=BOPP، K=CPP)',
        render: (r) => r.line
          ? `<span class="line-badge line-${U.escapeHtml(String(r.line).toLowerCase())}" title="خط تولید هویت گروه (کلید گروه‌بندی)">${U.escapeHtml(String(r.line))}</span>`
          : '<span class="muted" title="هویت رول‌های این گروه از شمارهٔ رول قابل استخراج نیست">—</span>',
        tokens: (r) => r.line ? [String(r.line)] : [],
      },
      hall: {
        /* نسخهٔ ۳٫۰ — تغییر ۶: شماره سالن هویت گروه (رقم اول شمارهٔ رول) */
        key: 'hall', label: 'سالن',
        headerTitle: 'شماره سالن هویت گروه — رقم اول شمارهٔ رول',
        render: (r) => r.hall !== null && r.hall !== undefined
          ? U.faNum(r.hall)
          : '<span class="muted">—</span>',
        tokens: (r) => r.hall !== null && r.hall !== undefined ? [U.faNum(r.hall), String(r.hall)] : [],
      },
      year: {
        /* نسخهٔ ۳٫۰ — تغییر ۶+۷: سال هویت گروه (رقم دوم شمارهٔ رول = رقم آخر سال)
           نمایش سال چهاررقمی «بدون» جداکنندهٔ هزارگان (۱۴۰۵ نه ۱٬۴۰۵). */
        key: 'year', label: 'سال',
        headerTitle: 'سال هویت گروه — رقم دوم شمارهٔ رول = رقم آخر سال (۱۴۰X)',
        render: (r) => r.yearDigit !== null && r.yearDigit !== undefined
          ? U.faYear(1400 + r.yearDigit)
          : '<span class="muted">—</span>',
        tokens: (r) => r.yearDigit !== null && r.yearDigit !== undefined
          ? [U.faYear(1400 + r.yearDigit), String(1400 + r.yearDigit), String(r.yearDigit)]
          : [],
      },
      count: {
        key: 'count', label: 'تعداد', className: 'count-cell',
        render: (r) => U.faNum(r.count),
        tokens: (r) => [U.faNum(r.count), String(r.count ?? '')],
      },
      status: {
        key: 'status', label: 'وضعیت',
        render: (r) => (r.matched
          ? '<span class="status-pill pill-ok" title="برای این ترکیب ستاپ تعریف شده است">✓ دارای ستاپ</span>'
          : (r.hasRule
            ? '<span class="status-pill pill-warn" title="برای این ترکیب ستاپی تعریف نشده">⚠ بدون ستاپ</span>'
            : '<span class="status-pill pill-muted" title="متراژ استاندارد ندارد؛ قابل تطبیق نیست">غیرقابل تطبیق</span>')),
        tokens: (r) => [statusText(r)],
      },
      details: {
        key: 'details', label: 'جزئیات', filterable: false,
        render: (r) => `<button type="button" class="btn btn-ghost btn-sm" data-group-key="${U.escapeHtml(r.key)}"
            title="مشاهدهٔ رول‌های این گروه">${UI.icons.audit}</button>`,
      },
    };

    /* عرض هر ستون از پنل ترتیب ستون‌ها (نسخهٔ ۲٫۶) — 0/خالی = خودکار */
    for (const col of Object.values(registry)) {
      const w = Number(widths[col.key]);
      col.width = Number.isFinite(w) && w > 0 ? w : undefined;
    }
    return registry;
  };

  RollsView.renderTable = async function () {
    const state = await RM.calcEngine.getState();

    // آمار بالای جدول
    const s = state.summary;
    document.getElementById('rolls-stats').innerHTML = `
      <span class="chip">رول‌های خام: ${U.faNum(s.rawRollsCount)}</span>
      <span class="chip">گروه‌ها: ${U.faNum(s.totalGroups)}</span>
      <span class="chip chip-ok">دارای ستاپ: ${U.faNum(s.matchedGroups)}</span>
      <span class="chip chip-warn">بدون ستاپ: ${U.faNum(s.totalGroups - s.matchedGroups)}</span>
    `;

    // گروه‌های بدون قانون متراژ در انتهای جدول (مقادیر تهی آخر می‌افتند)
    const groups = RollsView.sortGroups(state.rawRollGroups);

    const wrap = document.getElementById('raw-rolls-table');
    const all = RollsView.columnRegistry();
    const columns = (RollsView.columnOrder || RM.config.RAW_DEFAULT_COLUMN_ORDER)
      .map((key) => all[key])
      .filter(Boolean);

    UI.filterTable(wrap, columns, groups, {
      state: RollsView,                      // filters + visibleRows (ماندگار)
      visibleRows: RM.config.RAW_VISIBLE_ROWS,
      rowHeight: 42,
      /* ۳٫۹ — تغییر ۵: دکمه‌های ابزار در نوار بالای جدول (کنار «پاک‌کردن همهٔ
         فیلترها») — وضعیت فشرده از state نما و کلیک از طریق onToolToggle */
      tools: [
        { id: 'raw-cols-toggle', label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: RollsView.colsPanelVisible },
        { id: 'roll-sort-toggle', label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: RollsView.sortPanelVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'raw-cols-toggle') {
          RollsView.colsPanelVisible = !RollsView.colsPanelVisible;
          DB.setSetting('rawColsPanelVisible', RollsView.colsPanelVisible);
          RollsView.applyColsPanelVisibility();
        } else if (toolId === 'roll-sort-toggle') {
          RollsView.sortPanelVisible = !RollsView.sortPanelVisible;
          DB.setSetting('rawSortPanelVisible', RollsView.sortPanelVisible);
          RollsView.applySortPanelVisibility();
        }
      },
      // نسخهٔ ۲٫۴: باکس تعداد ردیف + ماندگاری مقدار
      onRowsChange: (n) => RM.db.setSetting('rawVisibleRows', n),
      tableClass: 'cut-table raw-table',
      emptyText: 'هنوز رول خامی شناسایی نشده — فایل «رول‌های موجود» را در تب «ورود داده‌ها» بارگذاری کنید.',
      filteredEmptyText: 'هیچ گروهی با فیلترهای فعلی مطابقت ندارد — فیلترها را پاک کنید.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن (اعداد و متن‌ها) · دکمهٔ «≠» = شامل نشود · فوکوس حفظ می‌شود · باکس جمع زیر ستون «تعداد» با دیتای فیلترشده به‌روز می‌شود',
      // باکس جمع زیر ستون «تعداد» (نسخهٔ ۲٫۶) — با احترام به فیلترهای فعال
      sums: {
        count: { type: 'number' },
      },
      // اتصال دکمه‌های «جزئیات» پس از هر رندر بدنه
      onRendered: () => {
        wrap.querySelectorAll('[data-group-key]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const group = groups.find((g) => g.key === btn.dataset.groupKey);
            if (group) {
              RollsView._lastDetailGroup = group;
              await RollsView.showGroupDetails(group);
            }
          });
        });
      },
    });
  };

  /* ================================================================
     ۵) جزئیات گروه (Audit §45 + ستون‌های قابل Mapping — §7 اصلاحات)
     ================================================================ */

  /**
   * نمایش رول‌های داخل همین گروه انتخاب‌شده — نه یک لیست عمومی.
   * ستون‌ها (نام/ترتیب/انتخاب) از Mapping کاربر + تنظیم rollDetailColumns.
   * نسخهٔ ۳٫۴: پنل شخصی‌سازی ستون‌ها از ابزار مشترک UI.mountDetailColsPicker
   * (همان که در همهٔ مودال‌های Drill-down فعال است) استفاده می‌کند.
   */
  RollsView.showGroupDetails = async function (group) {
    // رکوردهای همین گروه از طریق شناسه‌ها (همه — صفحه‌بندی در جدول)
    // تغییر ۳: ویرایش‌های کاربر روی رکوردها اعمال می‌شود (جایگزینی اطلاعات فایل)
    const ids = group.rollIds;
    const records = ids.length ? await db.rolls.bulkGet(ids) : [];
    const valid = await RM.edits.applyToRecords('rolls', records.filter(Boolean));

    const extra = group.count - valid.length;

    /* ۳٫۹ — تغییر ۶: مودال عریض — جدول دارای پنل «ستون‌های جزئیات» فضای
       نمایش ستون‌های بیشتری دارد. */
    UI.infoModal(
      `گروه ${U.faWidth(group.width)}-${group.hasRule ? U.faNum(group.standardLength) : '—'}-${U.faNum(group.setupNumber)}`,
      `
      <div class="audit-stats">
        <div>تعداد رول: <b>${U.faNum(group.count)}</b></div>
        <div>عرض: <b>${U.faWidth(group.width)}</b></div>
        <div>ضخامت: <b>${U.faNum(group.thickness)}</b></div>
        <div>متراژ استاندارد: <b>${group.hasRule ? U.faNum(group.standardLength) : '—'}</b></div>
      </div>
      <div id="group-cols-picker"></div>
      <div id="group-details-table-wrap"></div>
      ${extra > 0 ? `<p class="muted">و ${U.faNum(extra)} رول دیگر (رکورد حذف‌شده)…</p>` : ''}
      `,
      { wide: true }
    );

    // صفحه‌بندی کارا: تغییر صفحه فقط جدول را دوباره رندر می‌کند (بدون بستن مودال)
    const renderPage = async (page) => {
      const columns = await UI.rollDetailColumns('rolls');
      UI.renderTable(document.getElementById('group-details-table-wrap'), columns, valid, {
        page,
        pageSize: RM.config.PAGE_SIZE,
        emptyText: 'رکوردی برای این گروه یافت نشد.',
        onPageChange: (nextPage) => renderPage(nextPage),
      });
    };

    // پنل شخصی‌سازی ستون‌های جزئیات — ابزار مشترک (نسخهٔ ۳٫۴):
    // پس از هر تغییر، چیپ‌ها و جدول درجا بازسازی می‌شوند (مودال باز می‌ماند)
    const mountPicker = async () => {
      await UI.mountDetailColsPicker(
        document.getElementById('group-cols-picker'),
        'rolls',
        async () => {
          await mountPicker();
          await renderPage(1);
        }
      );
    };

    await mountPicker();
    await renderPage(1);
  };

  /** رندر نما (هنگام تعویض تب — داده از Cache موتور محاسبه) */
  RollsView.render = function () {
    RollsView.renderColumnOrderPanel();       // نسخهٔ ۲٫۶ — هم‌گام با تنظیمات
    RollsView.renderTable();
  };

  RM.views = RM.views || {};
  RM.views.rolls = RollsView;
})();
