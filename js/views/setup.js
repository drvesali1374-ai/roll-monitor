/* =========================================================================
   views/setup.js — نما ستاپ‌ها (§20-§30، §46-§51، §85-§87، §91)
   -------------------------------------------------------------------------
   فرم ثبت/ویرایش با:
     - ارث‌بری ضخامت (قفل خودکار §22)
     - دراپ‌داون متراژ استاندارد وابسته به ضخامت (§24)
     - اعتبارسنجی زندهٔ الگوی برش (§29)
   جدول گزارش هر ستاپ:
     خام موجود + متالایز + برش‌نشده + مغایرت ظرفیت (§46-§50، §86)
     + جزئیات Audit تخصیص (§45)
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const Setups = RM.setupEngine;
  const db = RM.db.db;

  const SetupView = {
    editingId: null,          // شناسهٔ رکورد در حال ویرایش (null = ثبت جدید)
    currentRules: [],
    thicknessLocked: false,   // ارث‌بری فعال؟ (§22)
    dateLocked: false,        // ارث‌بری تاریخ فعال؟ (نسخهٔ ۲٫۸ — مانند ضخامت)
    sortPipeline: null,       // [{field, direction}] — پنل مرتب‌سازی گزارش (ماندگار)
    sortPanelVisible: true,   // نمایش/مخفی پنل مرتب‌سازی (ماندگار — نسخهٔ ۲٫۳)
    colsPanelVisible: true,   // نمایش/مخفی پنل ترتیب ستون‌ها (ماندگار — نسخهٔ ۲٫۳)
    columnOrder: null,        // ترتیب ستون‌های گزارش (ماندگار — نسخهٔ ۲٫۳)
    columnWidths: null,       // { colKey: px } — عرض ستون‌ها (ماندگار — نسخهٔ ۲٫۴)
    hiddenCols: null,         // [colKey] — ستون‌های مخفی (ماندگار — نسخهٔ ۲٫۸)
    visibleRows: null,        // تعداد ردیف قابل نمایش (ماندگار — نسخهٔ ۲٫۴)
    filters: {},              // { fieldKey: {value, invert} } — فیلتر زیر سرستون‌ها
  };

  /* ---------------- عناصر فرم ---------------- */

  const F = () => ({
    setupNumber: document.getElementById('f-setup'),
    productionLine: document.getElementById('f-line'),
    hallNumber: document.getElementById('f-hall'),
    machineNumber: document.getElementById('f-machine'),
    width: document.getElementById('f-width'),
    thickness: document.getElementById('f-thickness'),
    standardLength: document.getElementById('f-standard'),
    rollCount: document.getElementById('f-count'),
    cuttingPattern: document.getElementById('f-pattern'),
    setupDate: document.getElementById('f-date'),
  });

  /** برچسب فارسی خط تولید برای نمایش */
  const LINE_LABEL = { BOPP: 'BOPP', CPP: 'CPP' };

  /* ================================================================
     ۱) راه‌انداری
     ================================================================ */

  SetupView.init = async function () {
    const form = document.getElementById('setup-form');

    /* --- تاریخِ تایپ‌شدهٔ کاربر (۳٫۰): پرچم داخلی — وقتی کاربر خودش تاریخی
       تایپ کرده، پیشنهادِ خودکارِ بعدی (با تغییر ستاپ/خط/سالن) مقدار او را
       بازنویسی نمی‌کند (فقط راهنما به‌روز می‌شود). --- */
    F().setupDate.addEventListener('input', () => { SetupView._dateDirty = true; });

    /* --- هویت ستاپ (نسخهٔ ۳٫۰ — تغییرات ۱/۴/۸): زنجیرهٔ بازبینی ترتیبی
       «خط تولید → سالن → تاریخ ستاپ → ضخامت» — تغییر هر فیلد هویت، کل
       زنجیرهٔ پس از خودش را با مقادیر تازه بازبینی می‌کند:
         · شماره ستاپ → خط (پیشنهاد) → سالن (پیشنهاد — تغییر ۱) → تاریخ
           (ارث‌بری/قفل با کلید هویت — تغییر ۸) → ضخامت (تغییر ۴)
         · خط تولید → سالن → تاریخ → ضخامت
         · سالن → تاریخ → ضخامت
         · تاریخ → ضخامت (روی blur نیز تطبیق/قفل تاریخ با کلید کامل) --- */
    F().setupNumber.addEventListener('change', () => SetupView.onSetupNumberChange());
    F().setupNumber.addEventListener('blur', () => SetupView.onSetupNumberChange());
    F().productionLine.addEventListener('change', () => SetupView.refreshHallField());
    F().hallNumber.addEventListener('change', () => SetupView.applyDateInheritance());
    F().setupDate.addEventListener('change', () => SetupView.applyThicknessInheritance());
    F().setupDate.addEventListener('blur', () => SetupView.applyThicknessInheritance());

    /* --- اعتبارسنجی زندهٔ تاریخ شمسی (نسخهٔ ۲٫۸) + قفل تاریخ با کلید کامل (۳٫۰) --- */
    F().setupDate.addEventListener('input', () => SetupView.updateDateFeedback());
    F().setupDate.addEventListener('blur', () => SetupView.updateDateFeedback());
    F().setupDate.addEventListener('blur', () => SetupView.snapDateToIdentity());

    /* --- بازپر شدن دراپ‌داون متراژ استاندارد بر اساس ضخامت (§24) ---
       اگر مقدار فعلی در قوانین ضخامت جدید هم معتبر باشد، حفظ می‌شود */
    F().thickness.addEventListener('input', () => {
      if (SetupView.thicknessLocked) return;
      SetupView.refreshStandardLengthOptions(F().standardLength.value);
    });

    /* --- اعتبارسنجی زندهٔ الگوی برش (§29) --- */
    F().cuttingPattern.addEventListener('input', () => SetupView.updatePatternFeedback());

    /* --- اعتبارسنجی زندهٔ عرض (الگو به عرض وابسته است) --- */
    F().width.addEventListener('input', () => SetupView.updatePatternFeedback());

    /* --- ثبت / ویرایش --- */
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      SetupView.submit();
    });

    /* --- پاک‌کردن فرم / انصراف از ویرایش --- */
    document.getElementById('btn-reset-form').addEventListener('click', () => SetupView.resetForm());
    document.getElementById('btn-cancel-edit').addEventListener('click', () => SetupView.resetForm());

    /* --- ثبت گروهی (Bulk Paste) --- */
    document.getElementById('btn-bulk-analyze').addEventListener('click', () => SetupView.analyzeBulk());
    document.getElementById('btn-bulk-commit').addEventListener('click', () => SetupView.commitBulk());
    document.getElementById('btn-bulk-clear').addEventListener('click', () => SetupView.resetBulk());
    // نسخهٔ ۲٫۸ — دکمهٔ سراسری ادغام ردیف‌های تکراری (عرض مادر + ستاپ + متراژ + دستگاه + الگو)
    document.getElementById('btn-bulk-merge-all').addEventListener('click', () => SetupView.mergeAllBulkDuplicates());

    /* --- پنل مرتب‌سازی گزارش ستاپ‌ها (ماندگار — مثل رول‌های خام §38) --- */
    SetupView.sortPipeline = await RM.db.getSetting('setupReportSort', RM.config.SETUP_DEFAULT_SORT);
    SetupView.initSortPanel();

    /* --- پنل‌های قابل مخفی/ظاهر + ترتیب ستون‌ها (نسخهٔ ۲٫۳) --- */
    SetupView.sortPanelVisible = await RM.db.getSetting('setupSortPanelVisible', true);
    SetupView.colsPanelVisible = await RM.db.getSetting('setupColsPanelVisible', true);
    SetupView.columnOrder = await RM.db.getSetting(
      'setupColumnOrder', RM.config.SETUP_DEFAULT_COLUMN_ORDER);

    /* --- مهاجرت نرم ترتیب ستون‌ها: کلیدهای جدید (مثل setCount — تغییر ۱)
           که در ترتیب ذخیره‌شدهٔ نسخ‌های قبلی نیستند، در جایگاه منطقی‌شان
           (بعد از ستونِ قبل از خود در ترتیب پیش‌فرض) درج می‌شوند تا ستون
           جدید همان‌جا دیده شود که کاربر انتظار دارد. --- */
    if (Array.isArray(SetupView.columnOrder)) {
      const defaults = RM.config.SETUP_DEFAULT_COLUMN_ORDER;
      const missing = defaults.filter((k) => !SetupView.columnOrder.includes(k));
      for (const key of missing) {
        const prevIndex = defaults.indexOf(key) - 1;
        const anchor = prevIndex >= 0 ? defaults[prevIndex] : null;
        const at = anchor !== null ? SetupView.columnOrder.indexOf(anchor) : -1;
        if (at !== -1) SetupView.columnOrder.splice(at + 1, 0, key);
        else SetupView.columnOrder.push(key);
      }
      if (missing.length) {
        await RM.db.setSetting('setupColumnOrder', SetupView.columnOrder);
      }
    }

    /* --- عرض ستون‌ها + تعداد ردیف قابل نمایش (ماندگار — نسخهٔ ۲٫۴) --- */
    SetupView.columnWidths = Object.assign(
      {}, RM.config.SETUP_DEFAULT_COLUMN_WIDTHS,
      await RM.db.getSetting('setupColumnWidths', {}) || {}
    );
    SetupView.visibleRows = await RM.db.getSetting(
      'setupVisibleRows', RM.config.SETUP_VISIBLE_ROWS);

    /* --- ستون‌های مخفی (ماندگار — نسخهٔ ۲٫۸): «تاریخ» به‌صورت پیش‌فرض مخفی است
           و از پنل ترتیب ستون‌ها (چشم) به جدول اضافه می‌شود. --- */
    SetupView.hiddenCols = await RM.db.getSetting(
      'setupReportHiddenCols', RM.config.SETUP_DEFAULT_HIDDEN_COLUMNS) || [];

    /* ۳٫۹ — تغییر ۵: دکمه‌های «ترتیب ستون‌ها»/«مرتب‌سازی» به نوار بالای جدول
       منتقل شدند — اتصال از طریق opts.tools/onToolToggle در filterTable. */

    document.getElementById('setup-cols-reset-btn').addEventListener('click', async () => {
      SetupView.columnOrder = [...RM.config.SETUP_DEFAULT_COLUMN_ORDER];
      SetupView.columnWidths = { ...RM.config.SETUP_DEFAULT_COLUMN_WIDTHS };
      SetupView.hiddenCols = [...RM.config.SETUP_DEFAULT_HIDDEN_COLUMNS];
      await RM.db.setSetting('setupColumnOrder', SetupView.columnOrder);
      await RM.db.setSetting('setupColumnWidths', SetupView.columnWidths);
      await RM.db.setSetting('setupReportHiddenCols', SetupView.hiddenCols);
      SetupView.renderColumnOrderPanel();
      SetupView.renderReportTable();
      UI.toast('ترتیب، عرض و نمایش ستون‌ها به حالت پیش‌فرض بازگشت.', 'info');
    });

    SetupView.applyPanelVisibility();
  };

  /* ================================================================
     ۲) منطق فرم
     ================================================================ */

  /** ارث‌بری ضخامت (§22 + نسخهٔ ۳٫۰ تغییر ۴): با کلید هویت ۴فاکتوری
      «شماره ستاپ + خط تولید + شماره سالن + عدد سال (از تاریخ ستاپ)»:
        · هویت کامل + رکورد هم‌هویت با ضخامت → قفل خودکار (کاربر نمی‌تواند تغییر دهد)
        · هویت کامل ولی بدون رکورد هم‌هویت → ورود دستی ضخامت جدید
        · هویت ناقص → آزاد (تا تکمیل هویت، تعیین خودکار ممکن نیست)
      ستاپ‌هایی با شمارهٔ مشابه اما خط/سالن/سال متفاوت، ضخامت مستقل دارند. */
  SetupView.applyThicknessInheritance = async function () {
    const { setupNumber, productionLine, hallNumber, thickness, standardLength, setupDate } = F();
    const value = U.parseInt(setupNumber.value);
    const hintEl = document.getElementById('hint-thickness');

    if (SetupView.editingId !== null) return;   // در ویرایش، ضخامت آزاد است (§23)

    if (value === null || value < 0) {
      SetupView.thicknessLocked = false;
      thickness.disabled = false;
      hintEl.hidden = true;
      return;
    }

    const line = String(productionLine.value || '').trim().toUpperCase() || null;
    const hall = U.parseInt(hallNumber.value);
    const dateParsed = U.parseJalaliDate(setupDate.value);
    const yearDigit = dateParsed ? RM.normalize.yearDigitOfDate(dateParsed.normalized) : null;

    // هویت ۴فاکتوری هنوز کامل نشده — ضخامت آزاد است
    if (!line || hall === null || yearDigit === null) {
      SetupView.thicknessLocked = false;
      thickness.disabled = false;
      hintEl.textContent = 'برای تعیین خودکار ضخامت، هویت ستاپ (شماره ستاپ + خط تولید + شماره سالن + تاریخ ستاپ) کامل شود.';
      hintEl.hidden = false;
      SetupView.refreshStandardLengthOptions(standardLength.value);
      return;
    }

    const inherited = await Setups.findInheritedThickness(value, line, hall, yearDigit);

    if (inherited !== null) {
      // ارث‌بری با کلید هویت: ضخامت ثبت‌شدهٔ رکورد هم‌هویت (§22 + تغییر ۴)
      SetupView.thicknessLocked = true;
      thickness.value = String(inherited);
      thickness.disabled = true;
      hintEl.textContent = `ضخامت ستاپ ${U.faNum(value)} (خط ${LINE_LABEL[line] || line} · سالن ${U.faNum(hall)} · سال ${U.faYear(1400 + yearDigit)}) قبلاً ${U.faNum(inherited)} تعیین شده و به‌صورت خودکار به ارث رسید — قابل تغییر نیست.`;
      hintEl.hidden = false;
    } else {
      SetupView.thicknessLocked = false;
      thickness.disabled = false;
      hintEl.textContent = `رکوردی با کلید «ستاپ ${U.faNum(value)} + خط ${LINE_LABEL[line] || line} + سالن ${U.faNum(hall)} + سال ${U.faYear(1400 + yearDigit)}» ثبت نشده — ضخامت جدید را دستی وارد کنید.`;
      hintEl.hidden = false;
    }

    SetupView.refreshStandardLengthOptions(standardLength.value);
  };

  /** ارث‌بری خط تولید (نسخهٔ ۲٫۹): پیش‌فرض فیلد خط تولید = آخرین خطِ
      ثبت‌شدهٔ همان شماره ستاپ (جدیدترین رکورد) — اما اجباری نیست و
      کاربر می‌تواند آن را تغییر دهد. در ویرایش، مقدار رکورد معیار است. */
  SetupView.applyLineInheritance = async function () {
    const { setupNumber, productionLine } = F();
    const value = U.parseInt(setupNumber.value);
    const hintEl = document.getElementById('hint-line');

    if (SetupView.editingId !== null) return;   // در ویرایش، مقدار رکورد بارگذاری شده

    if (value === null || value < 0) {
      if (hintEl) hintEl.hidden = true;
      SetupView.refreshHallField();
      return;
    }

    const lastLine = await Setups.findLastLine(value);
    if (lastLine) {
      productionLine.value = lastLine;
      if (hintEl) {
        hintEl.textContent = `خط تولید ستاپ ${U.faNum(value)} از آخرین رکورد ثبت‌شدهٔ همین ستاپ (${LINE_LABEL[lastLine]}) پیروی می‌کند — در صورت نیاز می‌توانید تغییرش دهید.`;
        hintEl.hidden = false;
      }
    } else {
      if (hintEl) hintEl.hidden = true;
    }

    SetupView.refreshHallField();
  };

  /**
   * بازبینی فیلد «شماره سالن» (نسخهٔ ۲٫۹ → تغییر ۱ نسخهٔ ۳٫۰):
   *  · کاربر ابتدا باید «شماره ستاپ» و «خط تولید» را انتخاب کند — تا آن
   *    لحظه فیلد سالن غیرفعال است.
   *  · اگر برای کلید دوفاکتوری (شماره ستاپ + خط تولید) قبلاً سالنی ثبت
   *    شده باشد → همان سالن به‌صورت خودکار «پیشنهاد» می‌شود (فیلد پر
   *    می‌شود) اما قفل نیست و کاربر می‌تواند آن را ویرایش کند.
   *  · اگر این کلید رکوردی ندارد → سالن توسط کاربر انتخاب می‌شود.
   *  · در ویرایش، فیلد آزاد است (بدون قفل ارث‌بری). */
  SetupView.refreshHallField = async function () {
    const { setupNumber, productionLine, hallNumber } = F();
    const hintEl = document.getElementById('hint-hall');
    if (!hallNumber) return;

    // ویرایش: فیلد آزاد (هویت در ویرایش قابل تغییر است)
    if (SetupView.editingId !== null) {
      hallNumber.disabled = false;
      if (hintEl) hintEl.hidden = true;
      return;
    }

    const setupNo = U.parseInt(setupNumber.value);
    const line = String(productionLine.value || '').trim();

    // تا انتخاب «شماره ستاپ + خط تولید» فیلد سالن باز نیست
    if (setupNo === null || setupNo < 0 || !line) {
      hallNumber.disabled = true;
      hallNumber.value = '';
      if (hintEl) {
        hintEl.textContent = 'ابتدا «شماره ستاپ» و «خط تولید» را انتخاب کنید، سپس شماره سالن.';
        hintEl.hidden = false;
      }
      await SetupView.applyDateInheritance();   // زنجیره: تاریخ → ضخامت هم بازبینی/آزاد می‌شوند
      return;
    }

    const inheritedHall = await Setups.findInheritedHall(setupNo, line);
    if (inheritedHall !== null) {
      // پیشنهاد (نسخهٔ ۳٫۰ — تغییر ۱): مقدار پر می‌شود ولی فیلد باز است
      hallNumber.value = String(inheritedHall);
      hallNumber.disabled = false;
      if (hintEl) {
        hintEl.textContent = `سالن ${U.faNum(inheritedHall)} برای کلید «ستاپ ${U.faNum(setupNo)} + خط ${LINE_LABEL[line] || line}» ثبت شده و به‌صورت خودکار پیشنهاد شد — در صورت نیاز می‌توانید آن را تغییر دهید (سالن متفاوت = هویت متفاوت).`;
        hintEl.hidden = false;
      }
    } else {
      hallNumber.disabled = false;
      hallNumber.value = '';   // مقدار پیشنهادیِ کلید قبلی پاک می‌شود — انتخاب تازه برای این کلید
      if (hintEl) {
        hintEl.textContent = `برای کلید «ستاپ ${U.faNum(setupNo)} + خط ${LINE_LABEL[line] || line}» هنوز سالنی ثبت نشده — شماره سالن را انتخاب کنید.`;
        hintEl.hidden = false;
      }
    }

    // زنجیرهٔ هویت (۳٫۰): پس از تازه‌شدن سالن، تاریخ و سپس ضخامت بازبینی می‌شوند
    await SetupView.applyDateInheritance();
  };

  /** تغییر شماره ستاپ → زنجیرهٔ کامل بازبینی هویت:
      خط تولید (پیشنهاد) → سالن (پیشنهاد) → تاریخ ستاپ → ضخامت (۳٫۰). */
  SetupView.onSetupNumberChange = async function () {
    // applyLineInheritance در پایان خودش refreshHallField را صدا می‌زند و
    // آن زنجیره تا تاریخ و ضخامت ادامه می‌یابد.
    await SetupView.applyLineInheritance();
  };

  /** ارث‌بری تاریخ ستاپ (نسخهٔ ۲٫۸ → تغییر ۸ نسخهٔ ۳٫۰ — کلید هویت):
      با کلید «شماره ستاپ + خط تولید + شماره سالن» جست‌وجو می‌شود (عدد سال
      از خود تاریخ برمی‌خیزد و در جست‌وجوی تاریخ معلوم نیست):
        · یک تاریخ یکتا → همان تاریخ «پیشنهاد» می‌شود (فیلد پر می‌شود ولی
          قفل نیست) — قفل نهایی روی blur: اگر کلید کامل (با رقم سال) با
          رکورد ثبت‌شده بخواند → همان تاریخ قفل می‌شود (تعیین خودکار)؛
          کاربر می‌تواند سال جدید وارد کند (هویت جدید — فیلد باز می‌ماند)
        · چند تاریخ (این ستاپ+خط+سالن در چند سال ثبت شده) → کاربر تاریخ
          موردنظر را وارد می‌کند؛ روی blur با کلید کامل تطبیق و قفل می‌شود
        · هیچ رکوردی → تاریخ جدید، دستی */
  SetupView.applyDateInheritance = async function () {
    const { setupNumber, productionLine, hallNumber, setupDate } = F();
    const value = U.parseInt(setupNumber.value);
    const hintEl = document.getElementById('hint-date');

    if (SetupView.editingId !== null) return;   // در ویرایش، تاریخ آزاد است (آبشار در ثبت گرفته می‌شود)

    if (value === null || value < 0) {
      SetupView.dateLocked = false;
      setupDate.disabled = false;
      hintEl.hidden = true;
      await SetupView.applyThicknessInheritance();   // زنجیره: ضخامت هم آزاد شود
      return;
    }

    const line = String(productionLine.value || '').trim().toUpperCase() || null;
    const hall = U.parseInt(hallNumber.value);

    // هویت سه‌فاکتوری نخست هنوز کامل نشده — تاریخ آزاد
    if (!line || hall === null) {
      SetupView.dateLocked = false;
      setupDate.disabled = false;
      hintEl.hidden = true;
      SetupView.updateDateFeedback();
      await SetupView.applyThicknessInheritance();   // زنجیره: ضخامت هم آزاد شود
      return;
    }

    const dates = await Setups.findInheritedDatesByIdentity(value, line, hall);

    if (dates.length === 1) {
      /* یک تاریخ یکتا برای این ستاپ+خط+سالن → «پیشنهاد» (مقدار پر می‌شود ولی
         قفل نمی‌شود) — چون عدد سال بخشی از کلید است و فقط با تاریخ معلوم
         می‌شود، قفل نهایی روی blur انجام می‌گیرد: با خروج از فیلد، اگر کلید
         کامل با رکورد ثبت‌شده بخواند → همان تاریخ قفل می‌شود (تعیین خودکار)؛
         اگر کاربر سال جدیدی وارد کند → فیلد باز می‌ماند (هویت جدید).
         تاریخِ تایپ‌شدهٔ کاربر (_dateDirty) هرگز بازنویسی نمی‌شود. */
      SetupView.dateLocked = false;
      setupDate.disabled = false;
      if (!SetupView._dateDirty || !setupDate.value.trim()) {
        setupDate.value = dates[0];
        SetupView._dateDirty = false;
      }
      hintEl.textContent = `تاریخ ${U.faJalali(dates[0])} برای کلید «ستاپ ${U.faNum(value)} + خط ${LINE_LABEL[line] || line} + سالن ${U.faNum(hall)}» ثبت شده و به‌صورت خودکار پیشنهاد شد — اگر همین ستاپ است، دست نزنید (با خروج از فیلد قفل می‌شود)؛ برای ثبتِ این ستاپ در سال جدید، تاریخ جدید وارد کنید.`;
      hintEl.hidden = false;
    } else if (dates.length > 1) {
      // چند سال مختلف → کاربر تعیین می‌کند؛ با تکمیل کلید (رقم سال) قفل می‌شود
      SetupView.dateLocked = false;
      setupDate.disabled = false;
      hintEl.textContent = `این ستاپ در ${U.faNum(dates.length)} سال مختلف ثبت شده (${dates.map((d) => U.faJalali(d)).join('، ')}) — تاریخ موردنظر را وارد کنید؛ با تطبیق کلید کامل، همان تاریخ ثبت‌شده قفل می‌شود.`;
      hintEl.hidden = false;
    } else {
      SetupView.dateLocked = false;
      setupDate.disabled = false;
      hintEl.textContent = `رکوردی با کلید «ستاپ ${U.faNum(value)} + خط ${LINE_LABEL[line] || line} + سالن ${U.faNum(hall)}» ثبت نشده — تاریخ ستاپ را وارد کنید.`;
      hintEl.hidden = false;
    }

    SetupView.updateDateFeedback();
    // زنجیرهٔ هویت (۳٫۰): پس از بازبینی تاریخ، ضخامت هم با کلید تازه بازبینی می‌شود
    await SetupView.applyThicknessInheritance();
  };

  /** قفل تاریخ با کلید کامل (نسخهٔ ۳٫۰ — تغییر ۸): روی blur فیلد تاریخ.
      اگر تاریخ واردشده معتبر باشد و کلید کامل هویت (ستاپ + خط + سالن +
      عدد سالِ تاریخ) با رکورد ثبت‌شده‌ای مطابقت داشته باشد:
        · تاریخ دقیقاً همان تاریخ ثبت‌شدهٔ آن کلید می‌شود (یک هویت = یک تاریخ)
          و فیلد قفل می‌شود؛ در غیر این صورت تاریخ آزاد می‌ماند (هویت جدید). */
  SetupView.snapDateToIdentity = async function () {
    const { setupNumber, productionLine, hallNumber, setupDate } = F();
    const hintEl = document.getElementById('hint-date');

    if (SetupView.editingId !== null) return;
    if (SetupView.dateLocked) return;   // تاریخ ارث‌رسیده — تغییر ممکن نیست

    const setupNo = U.parseInt(setupNumber.value);
    const line = String(productionLine.value || '').trim().toUpperCase() || null;
    const hall = U.parseInt(hallNumber.value);
    if (setupNo === null || setupNo < 0 || !line || hall === null) return;

    const parsed = U.parseJalaliDate(setupDate.value);
    if (!parsed) return;   // نامعتبر/خالی — بازخورد خطا کار updateDateFeedback است

    const yearDigit = RM.normalize.yearDigitOfDate(parsed.normalized);
    const registered = await Setups.findDateForKey(setupNo, line, hall, yearDigit);

    if (registered) {
      if (setupDate.value.trim() !== registered) {
        setupDate.value = registered;   // snap به تاریخ ثبت‌شدهٔ همان کلید هویت
        SetupView._dateDirty = false;
        UI.toast(`تاریخ ستاپ این کلید هویت قبلاً ${U.faJalali(registered)} ثبت شده — همان تاریخ اعمال و قفل شد.`, 'info', 5000);
      }
      SetupView.dateLocked = true;
      setupDate.disabled = true;
      if (hintEl) {
        hintEl.textContent = `تاریخ ستاپ کلید «ستاپ ${U.faNum(setupNo)} + خط ${LINE_LABEL[line] || line} + سالن ${U.faNum(hall)} + سال ${U.faYear(1400 + yearDigit)}» قبلاً ${U.faJalali(registered)} ثبت شده و به‌صورت خودکار به ارث رسید — همان تاریخ برای همهٔ رکوردهای این کلید اعمال می‌شود.`;
        hintEl.hidden = false;
      }
      SetupView.updateDateFeedback();
      // ضخامت هم با کلید تازه‌کامل‌شده بازبینی می‌شود (تغییر ۴)
      await SetupView.applyThicknessInheritance();
    }
  };

  /** بازخورد زندهٔ تاریخ شمسی (نسخهٔ ۲٫۸): فرمت + صحت تقویم */
  SetupView.updateDateFeedback = function () {
    const { setupDate } = F();
    const errEl = document.getElementById('err-date');
    const okEl = document.getElementById('date-feedback');
    if (!setupDate || !errEl) return;

    const raw = setupDate.value.trim();
    if (raw === '') {
      setupDate.classList.remove('invalid');
      errEl.textContent = '';
      errEl.hidden = true;
      if (okEl) { okEl.textContent = ''; okEl.hidden = true; }
      return;
    }

    const parsed = U.parseJalaliDate(raw);
    if (parsed) {
      setupDate.classList.remove('invalid');
      errEl.textContent = '';
      errEl.hidden = true;
      if (okEl) {
        okEl.textContent = `تاریخ معتبر: ${U.faJalali(parsed.normalized)}`;
        okEl.hidden = false;
      }
    } else {
      setupDate.classList.add('invalid');
      if (okEl) { okEl.textContent = ''; okEl.hidden = true; }
      errEl.textContent = 'فرمت تاریخ شمسی نامعتبر است — مثال درست: 1405/06/18 (ماه ۱ تا ۱۲، روزهای هر ماه و سال کبیسه بررسی می‌شود).';
      errEl.hidden = false;
    }
  };

  /** پرکردن دراپ‌داون متراژ استاندارد فقط با قوانینِ ضخامت فعلی (§24) */
  SetupView.refreshStandardLengthOptions = function (keepValue = null) {
    const { thickness, standardLength } = F();
    const thicknessValue = U.parseNumber(thickness.value);
    const errEl = document.getElementById('err-standard');

    const options = thicknessValue === null
      ? []
      : RM.rulesEngine.standardLengthsFor(SetupView.currentRules, thicknessValue);

    let html = '<option value="">— انتخاب کنید —</option>';
    for (const opt of options) {
      html += `<option value="${opt}">${U.faNum(opt)}</option>`;
    }
    standardLength.innerHTML = html;

    // نگهداری مقدار در صورت تعلق به همین ضخامت
    if (keepValue !== null && options.includes(U.parseNumber(keepValue))) {
      standardLength.value = keepValue;
    } else {
      standardLength.value = '';
    }

    // راهنمای کاربر وقتی قوانین این ضخامت تعریف نشده
    if (thicknessValue !== null && !options.length) {
      errEl.textContent = 'برای این ضخامت قانون متراژی تعریف نشده — از تب «تنظیمات» قانون اضافه کنید.';
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  };

  /** بازخورد زندهٔ الگوی برش (§29) */
  SetupView.updatePatternFeedback = function () {
    const { width, cuttingPattern } = F();
    const box = document.getElementById('pattern-feedback');

    const result = Setups.validatePattern(cuttingPattern.value, U.parseNumber(width.value));

    if (!cuttingPattern.value.trim()) {
      box.className = 'pattern-feedback';
      box.innerHTML = '<span class="muted">اختیاری — مثال: 1100-1170</span>';
      return;
    }

    if (!result.ok) {
      box.className = 'pattern-feedback invalid';
      box.innerHTML = `<span class="pf-status">✕</span> ${result.message}`;
      return;
    }

    const motherWidth = U.parseNumber(width.value);
    const remaining = motherWidth !== null ? motherWidth - result.sum : null;

    box.className = 'pattern-feedback valid';
    box.innerHTML =
      `<span class="pf-status">✓</span> مجموع: <b>${U.faWidth(result.sum)}</b>` +
      (remaining !== null && remaining >= 0
        ? ` · باقی‌مانده (پرت عرض): <b>${U.faWidth(remaining)}</b>`
        : '') +
      ` · بخش‌ها: ${U.faNum(result.parts.length)}`;
  };

  /* ================================================================
     ۳) ثبت / ویرایش رکورد
     ================================================================ */

  SetupView.submit = async function () {
    const form = document.getElementById('setup-form');
    const f = F();
    UI.clearFormErrors(form);

    const input = {
      setupNumber: f.setupNumber.value,
      productionLine: f.productionLine.value,   // نسخهٔ ۲٫۹ — خط تولید
      hallNumber: f.hallNumber.value,           // نسخهٔ ۲٫۹ — شماره سالن
      machineNumber: f.machineNumber.value,
      width: f.width.value,
      thickness: f.thickness.value,
      standardLength: f.standardLength.value,
      rollCount: f.rollCount.value,
      cuttingPattern: f.cuttingPattern.value,
      setupDate: f.setupDate.value,   // نسخهٔ ۲٫۸ — تاریخ ستاپ (شمسی)
    };

    /* --- ویرایش: بررسی آبشار ضخامت و تاریخ (§23 + نسخهٔ ۲٫۸) --- */
    if (SetupView.editingId !== null) {
      const newThickness = U.parseNumber(input.thickness);
      const newDate = U.parseJalaliDate(input.setupDate);
      const info = await Setups.cascadeInfo(
        SetupView.editingId,
        newThickness,
        newDate ? newDate.normalized : null
      );

      if (info.affected > 0 || info.affectedDate > 0) {
        const rows = [];
        if (info.affected > 0) {
          rows.push(`<div>تغییر ضخامت ستاپ <b>${U.faNum(info.setupNumber)}</b> باعث تغییر ضخامت <b>${U.faNum(info.affected)}</b> رکورد دیگر نیز خواهد شد.</div>`);
        }
        if (info.affectedDate > 0) {
          rows.push(`<div>تغییر تاریخ ستاپ به <b>${U.faJalali(newDate ? newDate.normalized : null)}</b> باعث به‌روزرسانی تاریخ <b>${U.faNum(info.affectedDate)}</b> رکورد دیگر نیز خواهد شد (یک تاریخ برای همهٔ رکوردهای همین شماره ستاپ).</div>`);
        }
        const ok = await UI.confirm({
          title: 'تأیید تغییر ضخامت/تاریخ ستاپ',
          html: `<div class="confirm-stats">${rows.join('')}</div>`,
          message: 'این عملیات تراکنشی است و در صورت خطا به حالت قبل برمی‌گردد. ادامه می‌دهید؟',
          confirmText: 'بله، روی همهٔ رکوردهای همین ستاپ اعمال کن',
        });
        if (!ok) {
          UI.toast('عملیات ویرایش لغو شد.', 'info');
          return;
        }
      }

      const result = await Setups.update(SetupView.editingId, input, {
        cascadedCount: info.affected,
        cascadedDateCount: info.affectedDate,
      });
      if (!result.ok) {
        SetupView.showValidationErrors(result);
        return;
      }
      UI.toast(
        (info.affected > 0 || info.affectedDate > 0
          ? `ویرایش انجام شد — ${info.affected > 0 ? `ضخامت ${U.faNum(info.affected)} رکورد دیگر ` : ''}${info.affected > 0 && info.affectedDate > 0 ? 'و ' : ''}${info.affectedDate > 0 ? `تاریخ ${U.faNum(info.affectedDate)} رکورد دیگر ` : ''}نیز به‌روزرسانی شد.`
          : 'رکورد با موفقیت ویرایش شد.'),
        'success'
      );
    } else {
      /* --- ثبت جدید --- */
      const result = await Setups.create(input);
      if (!result.ok) {
        SetupView.showValidationErrors(result);
        return;
      }
      UI.toast(`رکورد ستاپ جدید با تاریخ ${U.faJalali(U.parseJalaliDate(input.setupDate)?.normalized)} ذخیره شد.`, 'success');
    }

    SetupView.resetForm();
    await RM.refreshAll();
    await SetupView.render();
  };

  /** نمایش خطاهای Field-Level (§69): حاشیهٔ قرمز + پیام + فوکوس */
  SetupView.showValidationErrors = function (result) {
    const form = document.getElementById('setup-form');
    const f = F();
    const fieldMap = {
      setupNumber: [f.setupNumber, document.getElementById('err-setup')],
      productionLine: [f.productionLine, document.getElementById('err-line')],
      hallNumber: [f.hallNumber, document.getElementById('err-hall')],
      machineNumber: [f.machineNumber, document.getElementById('err-machine')],
      width: [f.width, document.getElementById('err-width')],
      thickness: [f.thickness, document.getElementById('err-thickness')],
      standardLength: [f.standardLength, document.getElementById('err-standard')],
      rollCount: [f.rollCount, document.getElementById('err-count')],
      cuttingPattern: [f.cuttingPattern, document.getElementById('err-pattern')],
      setupDate: [f.setupDate, document.getElementById('err-date')],
    };

    let firstInvalid = null;
    for (const [field, [input, errEl]] of Object.entries(fieldMap)) {
      const msg = result.errors && result.errors[field];
      UI.setFieldError(input, errEl, msg);
      if (msg && !firstInvalid) firstInvalid = input;
    }

    if (result.message) UI.toast(U.escapeHtml(result.message), 'error');
    if (firstInvalid) firstInvalid.focus();
  };

  /* ================================================================
     ۴) حالت ویرایش
     ================================================================ */

  SetupView.startEdit = async function (id) {
    const record = await db.setupRolls.get(id);
    if (!record) return;

    const f = F();
    SetupView.editingId = id;

    f.setupNumber.value = String(record.setupNumber);
    f.machineNumber.value = String(record.machineNumber);
    f.width.value = String(record.width);
    f.thickness.value = record.thickness !== null ? String(record.thickness) : '';
    f.rollCount.value = String(record.rollCount);
    f.cuttingPattern.value = record.cuttingPattern || '';

    // هویت (نسخهٔ ۲٫۹): خط تولید + شماره سالن از رکورد — در ویرایش آزاد
    f.productionLine.value = record.productionLine || '';
    f.hallNumber.value = record.hallNumber !== null && record.hallNumber !== undefined ? String(record.hallNumber) : '';
    f.hallNumber.disabled = false;
    const hintLine = document.getElementById('hint-line');
    if (hintLine) hintLine.hidden = true;
    const hintHall = document.getElementById('hint-hall');
    if (hintHall) {
      hintHall.textContent = 'در ویرایش، خط تولید و شماره سالن آزادند — هویت این رکورد در کلیدهای یکتا و تطبیق به‌روز می‌شود.';
      hintHall.hidden = false;
    }

    // در ویرایش ضخامت آزاد است (§23) — آبشار در ثبت گرفته می‌شود
    SetupView.thicknessLocked = false;
    f.thickness.disabled = false;
    document.getElementById('hint-thickness').hidden = true;

    // در ویرایش تاریخ آزاد است — آبشار تاریخ در ثبت گرفته می‌شود (نسخهٔ ۲٫۸)
    SetupView.dateLocked = false;
    SetupView._dateDirty = false;
    f.setupDate.value = record.setupDate || '';
    f.setupDate.disabled = false;
    document.getElementById('hint-date').hidden = true;
    SetupView.updateDateFeedback();

    SetupView.refreshStandardLengthOptions(
      record.standardLength !== null ? String(record.standardLength) : null
    );
    f.standardLength.value = record.standardLength !== null ? String(record.standardLength) : '';
    SetupView.updatePatternFeedback();

    // تغییر حالت فرم به ویرایش
    // ۳٫۹ — تغییر ۲: فقط متن داخل span به‌روز می‌شود تا دکمهٔ راهنما/آیکون حذف نشوند
    document.getElementById('setup-form-title-text').textContent = `ویرایش رکورد ستاپ #${U.faNum(id)}`;
    document.getElementById('btn-save-roll').innerHTML = `${UI.icons.check} ذخیرهٔ تغییرات`;
    document.getElementById('btn-cancel-edit').hidden = false;

    // اسکرول به فرم + فوکوس
    document.getElementById('view-setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.setupNumber.focus();
  };

  /** بازگشت فرم به حالت ثبت جدید */
  SetupView.resetForm = function () {
    const form = document.getElementById('setup-form');
    const f = F();

    form.reset();
    UI.clearFormErrors(form);
    SetupView.editingId = null;
    SetupView.thicknessLocked = false;
    f.thickness.disabled = false;
    document.getElementById('hint-thickness').hidden = true;

    // بازنشانی حالت تاریخ (نسخهٔ ۲٫۸ + ۳٫۰) — قفل/بازخورد/خطا/پرچم تایپ کاربر
    SetupView.dateLocked = false;
    SetupView._dateDirty = false;
    f.setupDate.disabled = false;
    document.getElementById('hint-date').hidden = true;
    const dateOk = document.getElementById('date-feedback');
    if (dateOk) { dateOk.textContent = ''; dateOk.hidden = true; }
    f.setupDate.classList.remove('invalid');

    document.getElementById('pattern-feedback').className = 'pattern-feedback';
    document.getElementById('pattern-feedback').innerHTML = '<span class="muted">اختیاری — مثال: 1100-1170</span>';

    // ۳٫۹ — تغییر ۲: فقط متن داخل span به‌روز می‌شود تا دکمهٔ راهنما/آیکون حذف نشوند
    document.getElementById('setup-form-title-text').textContent = 'ثبت رول جدید برای ستاپ';
    document.getElementById('btn-save-roll').innerHTML = `${UI.icons.plus} ذخیره رکورد`;
    document.getElementById('btn-cancel-edit').hidden = true;

    // بازنشانی هویت (نسخهٔ ۲٫۹): خط تولید + سالن آزاد و خالی
    f.productionLine.value = '';
    f.hallNumber.value = '';
    f.hallNumber.disabled = true;
    const hintLine = document.getElementById('hint-line');
    if (hintLine) hintLine.hidden = true;
    const hintHall = document.getElementById('hint-hall');
    if (hintHall) {
      hintHall.textContent = 'ابتدا «شماره ستاپ» و «خط تولید» را انتخاب کنید، سپس شماره سالن.';
      hintHall.hidden = false;
    }

    SetupView.refreshStandardLengthOptions();
  };

  /* ================================================================
     ۵-ب) ثبت گروهی از Clipboard — Bulk Paste (§4 اصلاحات)
     ----------------------------------------------------------------
     جریان: تحلیل → پیش‌نمایش «قابل ویرایش» → اعتبارسنجی زنده →
     ثبت همه در یک تراکنش واحد. پس از تحلیل:
       • شماره ستاپ و ضخامت سراسری برای کل رکوردها (نوار بالا)
       • دستگاه و متراژ استاندارد (از قوانینِ ضخامت سراسری) به‌صورت
         پیش‌فرض یا رکوردبه‌رکورد
       • همهٔ فیلدهای هر رکورد (عرض مادر، الگوی برش، تعداد رول) قابل ویرایش
       • خلاصهٔ زندهٔ رکوردها (عرض‌های مادر/رول‌های الگو/جمع ست‌ها/یونیک‌ها)
     ================================================================ */

  /** وضعیت Bulk: { common:{setupNumber,thickness}, drafts:[…], structureErrors:[…] } */
  SetupView._bulk = null;
  SetupView._bulkCheck = null;          // آخرین نتیجهٔ اعتبارسنجی
  SetupView._bulkValidateTimer = null;  // debounce اعتبارسنجی زنده

  /** مقادیر اولیهٔ تحلیل از فرم دستی (پایهٔ پیش‌فرض‌های پیش‌نمایش) */
  SetupView.bulkCommonInput = function () {
    const f = F();
    return {
      setupNumber: f.setupNumber.value,
      machineNumber: f.machineNumber.value,
      thickness: f.thickness.value,
      standardLength: f.standardLength.value,
      setupDate: f.setupDate.value,   // نسخهٔ ۲٫۸ — تاریخ ستاپ کل Batch
      productionLine: f.productionLine ? f.productionLine.value : '',   // نسخهٔ ۲٫۹ — خط تولید کل Batch
      hallNumber: f.hallNumber ? f.hallNumber.value : '',               // نسخهٔ ۲٫۹ — سالن کل Batch
    };
  };

  /** تحلیل + پیش‌نمایش — بدون ثبت (dry-run) */
  SetupView.analyzeBulk = async function () {
    const textarea = document.getElementById('bulk-text');
    const text = textarea.value;

    if (!text.trim()) {
      UI.toast('متن Paste شده خالی است — داده‌ها را در کادر بالا وارد کنید.', 'warning');
      return;
    }

    // قوانین تازه برای گزینه‌های متراژ استاندارد
    SetupView.currentRules = await db.standardLengthRules.toArray();

    const commonInit = SetupView.bulkCommonInput();
    const { drafts, structureErrors, allowedMap } = Setups.buildBulkDraft(commonInit, text);

    SetupView._bulk = {
      common: {
        setupNumber: commonInit.setupNumber,
        thickness: commonInit.thickness,
        setupDate: commonInit.setupDate || '',
        productionLine: commonInit.productionLine || '',   // نسخهٔ ۲٫۹ — خط تولید کل Batch
        hallNumber: commonInit.hallNumber || '',             // نسخهٔ ۲٫۹ — سالن کل Batch
      },
      drafts,
      structureErrors,
      /* --- مرجع «تعداد مجاز» عرض‌های مادر دیتای پیست‌شده (تغییر ۱):
             در لحظهٔ تحلیل یک‌بار محاسبه و ثابت می‌ماند تا با ویرایش‌های
             پیش‌نمایش (تعداد/متراژ/حذف/ادغام) مقایسه شود. --- */
      allowedMap: allowedMap || {},
    };

    SetupView.renderBulkPreview();
    SetupView.renderBulkSummary();
    SetupView.revalidateBulk();
  };

  /**
   * خلاصهٔ زندهٔ رکوردهای تشخیص‌داده‌شده — با هر تغییری در رکوردها
   * بلافاصله به‌روز می‌شود (روش محاسبه + تغییر ۱ — تعداد ست):
   *   جمع عرض رول مادر   = Σ ستون تعداد (مجموع تعداد رول‌های مادر)
   *   یونیک رول مادر     = تعداد عرض‌های یکتای مادر (مثل ۲۲۸۰/۲۳۸۰/۲۳۰۰ = ۳)
   *   جمع عرض الگوی برش = Σ (تعداد عرض‌های الگوی هر رکورد × تعداد ست × تعداد)
   *   یونیک عرض الگو     = تعداد عرض‌های یکتای برش (مثل ۷۸۰/۷۰۰/۸۰۰/۹۰۰/۷۴۰ = ۵)
   * تعداد ست هر رکورد = متراژ استاندارد ÷ کوچکترین متراژ استاندارد ضخامت
   * سراسری (رول ۱ ستی) — اگر متراژ انتخاب نشده باشد، ۱ ست فرض می‌شود.
   * مثال مرجع (۴ رکورد با تعداد ۲/۷/۵/۲ و الگوهای سه‌تکه ۱-ستی):
   *   ۱۶ / ۳ / ۴۸ / ۵
   */
  SetupView.bulkSummaryStats = function (drafts, rules = [], thickness = null) {
    let motherRollsTotal = 0;      // Σ تعداد — «جمع عرض رول مادر»
    let patternWidthsTotal = 0;    // Σ (تعداد عرض الگو × تعداد ست × تعداد) — «جمع عرض الگوی برش»
    const motherWidthSet = new Set();   // عرض‌های یکتای مادر
    const patternWidthSet = new Set();  // عرض‌های یکتای الگو

    for (const d of drafts) {
      const rollCount = d.rollCount === null ? 0 : (d.rollCount || 0);
      motherRollsTotal += rollCount;

      const w = U.parseNumber(d.motherToken);
      if (w !== null) motherWidthSet.add(w);

      const parsed = Setups.parsePattern(d.patternText);
      if (parsed.ok && parsed.parts.length) {
        /* --- تغییر ۱: تعداد فرزند = قطعه‌های الگو × تعداد ست × تعداد مادر --- */
        const std = U.parseNumber(d.standardLength);
        const sc = RM.rulesEngine.setCount(rules, thickness, std);
        const setCount = sc !== null && sc > 0 ? sc : 1;
        patternWidthsTotal += parsed.parts.length * setCount * rollCount;
        for (const part of parsed.parts) patternWidthSet.add(part);
      }
    }

    return {
      count: drafts.length,
      motherRollsTotal,                            // ۱۶
      uniqueMotherWidths: motherWidthSet.size,     // ۳
      patternWidthsTotal,                          // ۴۸ (با تعداد ست ضرب می‌شود)
      uniquePatternWidths: patternWidthSet.size,   // ۵
    };
  };

  /** رندر خلاصهٔ زنده در #bulk-summary (برچسب‌ها مطابق روش محاسبه + تعداد ست) */
  SetupView.renderBulkSummary = function () {
    const el = document.getElementById('bulk-summary');
    const b = SetupView._bulk;
    if (!el) return;
    if (!b || !b.drafts.length) { el.innerHTML = ''; return; }

    const s = SetupView.bulkSummaryStats(
      b.drafts, SetupView.currentRules, U.parseNumber(b.common.thickness));
    el.innerHTML = `
      <span class="chip">رکوردها: ${U.faNum(s.count)}</span>
      <span class="chip chip-strong">جمع عرض رول مادر: ${U.faNum(s.motherRollsTotal)}</span>
      <span class="chip chip-ok">یونیک رول مادر: ${U.faNum(s.uniqueMotherWidths)}</span>
      <span class="chip chip-strong">جمع عرض الگوی برش: ${U.faNum(s.patternWidthsTotal)}</span>
      <span class="chip chip-ok">یونیک عرض الگوی برش: ${U.faNum(s.uniquePatternWidths)}</span>`;
  };

  /** گزینه‌های متراژ استاندارد از قوانینِ ضخامت سراسری فعلی */
  SetupView.bulkStandardOptions = function () {
    const b = SetupView._bulk;
    const t = b ? U.parseNumber(b.common.thickness) : null;
    return t === null ? [] : RM.rulesEngine.standardLengthsFor(SetupView.currentRules, t);
  };

  /** HTML یک ردیف قابل ویرایش پیش‌نمایش Bulk */
  SetupView.bulkRowHtml = function (d, i, standardOptions) {
    const pairsTxt = (d.pairs && d.pairs.length > 1)
      ? ` (جفت ${d.pairs.map((p) => U.faNum(p)).join('،')})`
      : '';
    const occTxt = (d.occurrences || 1) > 1 ? ` ×${U.faNum(d.occurrences)}` : '';

    const machineSel = `<select data-bulk-field="machineNumber" data-bulk-row="${i}" aria-label="شماره دستگاه رکورد ${U.faNum(i + 1)}">
        <option value="">—</option>
        ${[1, 2, 3].map((m) => `<option value="${m}" ${String(m) === String(d.machineNumber) ? 'selected' : ''}>دستگاه ${U.faNum(m)}</option>`).join('')}
      </select>`;

    const stdSel = `<select data-bulk-field="standardLength" data-bulk-row="${i}" aria-label="متراژ استاندارد رکورد ${U.faNum(i + 1)}">
        <option value="">—</option>
        ${standardOptions.map((o) => `<option value="${o}" ${String(o) === String(d.standardLength) ? 'selected' : ''}>${U.faNum(o)}</option>`).join('')}
      </select>`;

    return `
      <tr data-bulk-tr="${i}">
        <td>${U.faNum(i + 1)}<span class="muted" style="font-size:.62rem">${pairsTxt}${occTxt}</span></td>
        <td><input type="text" inputmode="numeric" dir="ltr" class="bulk-input" value="${U.escapeHtml(d.motherToken ?? '')}"
               data-bulk-field="motherToken" data-bulk-row="${i}" aria-label="عرض مادر رکورد ${U.faNum(i + 1)}"></td>
        <td><input type="text" dir="ltr" class="bulk-input bulk-input-pattern" value="${U.escapeHtml(d.patternText ?? '')}"
               data-bulk-field="patternText" data-bulk-row="${i}" aria-label="الگوی برش رکورد ${U.faNum(i + 1)}"></td>
        <td><input type="text" inputmode="numeric" dir="ltr" class="bulk-input bulk-input-count" value="${d.rollCount === null ? '' : String(d.rollCount)}"
               data-bulk-field="rollCount" data-bulk-row="${i}" aria-label="تعداد رول رکورد ${U.faNum(i + 1)}"></td>
        <td>${machineSel}</td>
        <td>${stdSel}</td>
        <td data-bulk-cell="sum"><span class="muted">—</span></td>
        <td data-bulk-cell="trim"><span class="muted">—</span></td>
        <td class="bulk-status" data-bulk-cell="status"><span class="muted">…</span></td>
        <td class="bulk-del-cell">
          <div class="bulk-row-actions">
            <button type="button" class="btn btn-ghost btn-icon bulk-merge-btn" data-bulk-merge="${i}" hidden
                    title="ادغام این ردیف تکراری با ردیف معتبر همتا (جمع تعداد رول)" aria-label="ادغام رکورد ${U.faNum(i + 1)} با همتای معتبر">
              ${UI.icons.merge}
            </button>
            <button type="button" class="btn btn-ghost btn-icon bulk-del-btn" data-bulk-del="${i}"
                    title="حذف این ردیف از پیش‌نمایش" aria-label="حذف رکورد ${U.faNum(i + 1)} از پیش‌نمایش">
              ${UI.icons.trash}
            </button>
          </div>
        </td>
      </tr>`;
  };

  /** رندر کامل پیش‌نمایش — نوار فیلدهای سراسری + جدول قابل ویرایش */
  SetupView.renderBulkPreview = function () {
    const wrap = document.getElementById('bulk-preview');
    const commitBtn = document.getElementById('btn-bulk-commit');
    const b = SetupView._bulk;

    if (!b || !b.drafts.length) {
      const structureHtml = b && b.structureErrors.length
        ? `<div class="bulk-alert">${b.structureErrors.map((e) =>
            `<div class="bulk-common-error">✕ <b>ساختار:</b> ${U.escapeHtml(e.message)}</div>`).join('')}</div>`
        : '';
      wrap.innerHTML = structureHtml;
      commitBtn.disabled = true;
      const mergeAllBtnEmpty = document.getElementById('btn-bulk-merge-all');   // نسخهٔ ۲٫۸
      if (mergeAllBtnEmpty) mergeAllBtnEmpty.disabled = true;
      return;
    }

    const standardOptions = SetupView.bulkStandardOptions();
    const structureHtml = b.structureErrors.length
      ? `<div class="bulk-alert">${b.structureErrors.map((e) =>
          `<div class="bulk-common-error">✕ <b>ساختار:</b> ${U.escapeHtml(e.message)}</div>`).join('')}</div>`
      : '';

    wrap.innerHTML = `
      <div class="bulk-toolbar">
        <div class="field">
          <label for="bulk-g-setup">شماره ستاپ (کل رکوردها) <b class="req">*</b></label>
          <input type="text" id="bulk-g-setup" inputmode="numeric" autocomplete="off"
                 value="${U.escapeHtml(b.common.setupNumber ?? '')}" placeholder="مثلاً ۱۴۰">
          <p class="field-error" id="bulk-g-err-setup" hidden></p>
        </div>
        <div class="field">
          <label for="bulk-g-line">خط تولید (کل رکوردها) <b class="req">*</b></label>
          <select id="bulk-g-line">
            <option value="">— انتخاب کنید —</option>
            <option value="BOPP" ${String(b.common.productionLine || '').toUpperCase() === 'BOPP' ? 'selected' : ''}>BOPP</option>
            <option value="CPP" ${String(b.common.productionLine || '').toUpperCase() === 'CPP' ? 'selected' : ''}>CPP</option>
          </select>
          <p class="field-error" id="bulk-g-err-line" hidden></p>
        </div>
        <div class="field">
          <label for="bulk-g-hall">شماره سالن (کل رکوردها) <b class="req">*</b></label>
          <select id="bulk-g-hall">
            <option value="">— انتخاب کنید —</option>
            ${[1, 2, 3, 4].map((h) => `<option value="${h}" ${String(h) === String(b.common.hallNumber ?? '') ? 'selected' : ''}>سالن ${U.faNum(h)}</option>`).join('')}
          </select>
          <p class="field-error" id="bulk-g-err-hall" hidden></p>
        </div>
        <div class="field">
          <label for="bulk-g-thickness">ضخامت (کل رکوردها) <span class="unit">(میکرون)</span> <b class="req">*</b></label>
          <input type="text" id="bulk-g-thickness" inputmode="numeric" autocomplete="off"
                 value="${U.escapeHtml(b.common.thickness ?? '')}" placeholder="مثلاً ۲۰">
          <p class="field-error" id="bulk-g-err-thickness" hidden></p>
        </div>
        <div class="field">
          <label for="bulk-g-date">تاریخ ستاپ (کل رکوردها) <span class="unit">(شمسی)</span> <b class="req">*</b></label>
          <input type="text" id="bulk-g-date" inputmode="numeric" autocomplete="off" dir="ltr"
                 value="${U.escapeHtml(b.common.setupDate ?? '')}" placeholder="مثلاً 1405/06/18">
          <p class="field-hint" id="bulk-g-hint-date" hidden></p>
          <p class="field-error" id="bulk-g-err-date" hidden></p>
        </div>
        <div class="field">
          <label for="bulk-g-machine">دستگاه پیش‌فرض</label>
          <select id="bulk-g-machine">
            <option value="">— بدون تغییر —</option>
            <option value="1">دستگاه ۱</option>
            <option value="2">دستگاه ۲</option>
            <option value="3">دستگاه ۳</option>
          </select>
        </div>
        <div class="field">
          <label for="bulk-g-standard">متراژ استاندارد پیش‌فرض</label>
          <select id="bulk-g-standard">
            <option value="">— بدون تغییر —</option>
            ${standardOptions.map((o) => `<option value="${o}">${U.faNum(o)}</option>`).join('')}
          </select>
          <p class="field-hint">متراژهای ممکن از قوانینِ «تعریف قانون متراژ استاندارد» برای ضخامت سراسری خوانده می‌شود.</p>
        </div>
        <div class="field field-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="bulk-g-apply">اعمال پیش‌فرض‌ها روی همهٔ رکوردها</button>
        </div>
      </div>
      ${structureHtml}
      <div class="table-wrap">
        <table class="data-table bulk-table">
          <thead><tr>
            <th>#</th><th>عرض مادر</th><th>الگوی برش</th><th>تعداد رول</th><th>دستگاه</th>
            <th>متراژ استاندارد</th><th>مجموع الگو</th><th>پرت عرض</th><th>وضعیت</th><th>عملیات</th>
          </tr></thead>
          <tbody>${b.drafts.map((d, i) => SetupView.bulkRowHtml(d, i, standardOptions)).join('')}</tbody>
        </table>
      </div>
      <div id="bulk-allowed-panel" hidden></div>`;

    /* --- فیلدهای سراسری: به‌روزرسانی وضعیت + بازسازی گزینه‌های متراژ --- */
    const gSetup = document.getElementById('bulk-g-setup');
    const gThickness = document.getElementById('bulk-g-thickness');
    const gDate = document.getElementById('bulk-g-date');
    const gLine = document.getElementById('bulk-g-line');      // نسخهٔ ۲٫۹ — خط تولید کل Batch
    const gHall = document.getElementById('bulk-g-hall');      // نسخهٔ ۲٫۹ — سالن کل Batch

    /* --- فیلدهای سراسری: به‌روزرسانی وضعیت + بازسازی گزینه‌های متراژ ---
       نسخهٔ ۳٫۱ — تغییر ۱: تغییر هر فاکتور هویت (ستاپ/خط/سالن) فیلد «تاریخ
       ستاپ» را با کلید ۴فاکتوری «ستاپ + خط + سالن + عدد سال» بازبینی
       می‌کند (refreshBulkDateField)؛ تاریخِ به‌ارث‌رسیدهٔ هویتِ قبلی پاک
       می‌شود (تاریخ دستیِ کاربر حفظ می‌شود تا بازبینی جدید). */
    const onBulkIdentityChange = async () => {
      if (gDate.disabled) {
        // تاریخ قفلِ هویت قبلی بود → پاک و آزاد (تا بازبینی هویت جدید تعیین کند)
        gDate.value = '';
        gDate.disabled = false;
        b.common.setupDate = '';
      }
      await SetupView.refreshBulkDateField();
      SetupView.scheduleBulkRevalidate();
    };

    gSetup.addEventListener('input', () => {
      b.common.setupNumber = gSetup.value;
      onBulkIdentityChange();
    });
    gLine.addEventListener('change', () => {
      b.common.productionLine = gLine.value;
      onBulkIdentityChange();
    });
    gHall.addEventListener('change', () => {
      b.common.hallNumber = gHall.value;
      onBulkIdentityChange();
    });
    gThickness.addEventListener('input', () => {
      b.common.thickness = gThickness.value;
      SetupView.rebuildBulkStandardOptions();
      SetupView.scheduleBulkRevalidate();
    });
    /* --- تاریخ ستاپ Batch (نسخهٔ ۲٫۸ → ۳٫۱ — تغییر ۱): تعیین با کلید
       «ستاپ + خط + سالن + عدد سال» موجود در رکوردها —
         · یکتا → تعیین خودکار + قفل (کاربر اجازهٔ تغییر ندارد)
         · چندسال → ورود دستی؛ روی blur با تطبیق کلید کامل، تاریخ ثبت‌شده
           همان سال snap و قفل می‌شود
         · بدون رکورد → تاریخ جدید، دستی و آزاد. --- */
    gDate.addEventListener('input', () => {
      if (gDate.disabled) return;   // تاریخ ارث‌رسیده قابل ویرایش نیست
      b.common.setupDate = gDate.value;
      SetupView.scheduleBulkRevalidate();
    });
    gDate.addEventListener('blur', () => SetupView.snapBulkDateToIdentity());

    /* --- اعمال پیش‌فرض‌های دستگاه/متراژ روی همهٔ رکوردها --- */
    document.getElementById('bulk-g-apply').addEventListener('click', () => {
      const machine = document.getElementById('bulk-g-machine').value;
      const standard = document.getElementById('bulk-g-standard').value;
      if (machine === '' && standard === '') {
        UI.toast('ابتدا دستگاه یا متراژ استاندارد پیش‌فرض را انتخاب کنید.', 'info');
        return;
      }
      for (const d of b.drafts) {
        if (machine !== '') d.machineNumber = machine;
        if (standard !== '') d.standardLength = standard;
      }
      SetupView.renderBulkPreview();
      SetupView.renderBulkSummary();
      SetupView.revalidateBulk();
      UI.toast('پیش‌فرض‌ها روی همهٔ رکوردها اعمال شد.', 'success');
    });

    /* --- ورودی‌های هر ردیف: به‌روزرسانی زندهٔ وضعیت + خلاصه --- */
    wrap.querySelectorAll('[data-bulk-field]').forEach((el) => {
      el.addEventListener('input', () => SetupView.onBulkRowInput(el));
      el.addEventListener('change', () => SetupView.onBulkRowInput(el));
    });

    /* --- آیکون حذف هر ردیف (نسخهٔ ۲٫۶): رکورد دلخواه از پیش‌نمایش حذف می‌شود --- */
    wrap.querySelectorAll('[data-bulk-del]').forEach((btn) => {
      btn.addEventListener('click', () => SetupView.removeBulkDraft(Number(btn.dataset.bulkDel)));
    });

    /* --- آیکون ادغام ردیف تکراری با همتای معتبر (تغییر ۲) --- */
    wrap.querySelectorAll('[data-bulk-merge]').forEach((btn) => {
      btn.addEventListener('click', () => SetupView.mergeBulkDraft(Number(btn.dataset.bulkMerge)));
    });

    SetupView.updateBulkRowComputed();
    SetupView.refreshBulkDateField();   // نسخهٔ ۳٫۱ — تغییر ۱: وضعیت اولیهٔ تاریخ با کلید هویت
  };

  /** بازبینی فیلد «تاریخ ستاپ» Bulk با کلید هویت ۴فاکتوری (نسخهٔ ۳٫۱ — تغییر ۱):
      «شماره ستاپ + خط تولید + شماره سالن + عدد سال». عدد سال از خود تاریخ
      برمی‌خیزد و در جست‌وجوی تاریخِ معلوم نیست؛ بنابراین با ۳ فاکتور نخست
      جست‌وجو می‌شود:
        · یک تاریخ یکتا → کلید به‌صورت یکتا resolves می‌شود → همان تاریخ
          به‌صورت خودکار تعیین و «قفل» می‌شود (کاربر اجازهٔ تغییر ندارد)
        · چند تاریخ (این هویت در چند سال ثبت شده) → کاربر تاریخ را وارد
          می‌کند؛ با تطبیق کلید کامل روی blur، تاریخ ثبت‌شده قفل می‌شود
        · هیچ رکوردی با این هویت → تاریخ جدید، دستی و آزاد. */
  SetupView.refreshBulkDateField = async function () {
    const b = SetupView._bulk;
    const gDate = document.getElementById('bulk-g-date');
    const gHint = document.getElementById('bulk-g-hint-date');
    if (!b || !gDate) return;

    const setupNo = U.parseInt(b.common.setupNumber);
    const line = String(b.common.productionLine ?? '').trim().toUpperCase() || null;
    const hall = U.parseInt(b.common.hallNumber);

    // هویت سه‌فاکتوری نخست هنوز کامل نشده — تاریخ آزاد
    if (setupNo === null || setupNo < 0 || !line || hall === null) {
      gDate.disabled = false;
      if (gHint) {
        gHint.textContent = 'ابتدا شماره ستاپ، خط تولید و شماره سالن را مشخص کنید — اگر کلید «ستاپ + خط تولید + سالن + عدد سال» قبلاً ثبت شده باشد، تاریخ به‌صورت خودکار تعیین و قفل می‌شود؛ در غیر این صورت تاریخ را دستی وارد کنید.';
        gHint.hidden = false;
      }
      return;
    }

    const dates = await Setups.findInheritedDatesByIdentity(setupNo, line, hall);

    if (dates.length === 1) {
      // تاریخ یکتا → کلید ۴فاکتوری یکتا → تعیین خودکار + قفل
      b.common.setupDate = dates[0];
      gDate.value = dates[0];
      gDate.disabled = true;
      if (gHint) {
        gHint.textContent = `تاریخ ${U.faJalali(dates[0])} برای کلید «ستاپ ${U.faNum(setupNo)} + خط ${line} + سالن ${U.faNum(hall)} + سال ${U.faYear(1400 + RM.normalize.yearDigitOfDate(dates[0]))}» ثبت شده و به‌صورت خودکار تعیین شد — قابل تغییر نیست؛ همان تاریخ برای همهٔ رکوردهای این Batch اعمال می‌شود.`;
        gHint.hidden = false;
      }
    } else if (dates.length > 1) {
      gDate.disabled = false;
      if (gHint) {
        gHint.textContent = `این هویت (ستاپ ${U.faNum(setupNo)} + خط ${line} + سالن ${U.faNum(hall)}) در ${U.faNum(dates.length)} سال مختلف ثبت شده (${dates.map((d) => U.faJalali(d)).join('، ')}) — تاریخ موردنظر را وارد کنید؛ با تطبیق کلید کامل (رقم سال)، تاریخ ثبت‌شدهٔ همان سال قفل می‌شود.`;
        gHint.hidden = false;
      }
    } else {
      gDate.disabled = false;
      if (gHint) {
        gHint.textContent = `رکوردی با کلید «ستاپ ${U.faNum(setupNo)} + خط ${line} + سالن ${U.faNum(hall)}» ثبت نشده — تاریخ ستاپ را برای این Batch دستی وارد کنید (مثال: 1405/06/18).`;
        gHint.hidden = false;
      }
    }
  };

  /** قفل تاریخ Bulk با کلید کامل (نسخهٔ ۳٫۱ — تغییر ۱): روی blur فیلد تاریخ.
      اگر تاریخ واردشده معتبر باشد و کلید کامل هویت (ستاپ + خط + سالن + عدد
      سالِ تاریخ) با رکورد ثبت‌شده‌ای مطابقت داشته باشد:
        · تاریخ دقیقاً همان تاریخ ثبت‌شدهٔ آن کلید می‌شود (یک هویت = یک تاریخ)
          و فیلد قفل می‌شود؛ در غیر این صورت تاریخ آزاد می‌ماند (هویت جدید). */
  SetupView.snapBulkDateToIdentity = async function () {
    const b = SetupView._bulk;
    const gDate = document.getElementById('bulk-g-date');
    const gHint = document.getElementById('bulk-g-hint-date');
    if (!b || !gDate || gDate.disabled) return;

    const setupNo = U.parseInt(b.common.setupNumber);
    const line = String(b.common.productionLine ?? '').trim().toUpperCase() || null;
    const hall = U.parseInt(b.common.hallNumber);
    if (setupNo === null || setupNo < 0 || !line || hall === null) return;

    const parsed = U.parseJalaliDate(gDate.value);
    if (!parsed) return;   // نامعتبر/خالی — بازخورد خطا کار revalidate است

    const yearDigit = RM.normalize.yearDigitOfDate(parsed.normalized);
    const registered = await Setups.findDateForKey(setupNo, line, hall, yearDigit);
    if (!registered) return;   // سال جدید → هویت جدید — تاریخ آزاد می‌ماند

    if (gDate.value.trim() !== registered) {
      gDate.value = registered;   // snap به تاریخ ثبت‌شدهٔ همان کلید هویت
      UI.toast(`تاریخ ستاپ این کلید هویت قبلاً ${U.faJalali(registered)} ثبت شده — همان تاریخ اعمال و قفل شد.`, 'info', 5000);
    }
    b.common.setupDate = registered;
    gDate.disabled = true;
    if (gHint) {
      gHint.textContent = `تاریخ ${U.faJalali(registered)} برای کلید «ستاپ ${U.faNum(setupNo)} + خط ${line} + سالن ${U.faNum(hall)} + سال ${U.faYear(1400 + yearDigit)}» ثبت شده و به‌صورت خودکار تعیین شد — قابل تغییر نیست؛ همان تاریخ برای همهٔ رکوردهای این Batch اعمال می‌شود.`;
      gHint.hidden = false;
    }
    SetupView.scheduleBulkRevalidate();
  };

  /** حذف یک ردیف از پیش‌نمایش Bulk (نسخهٔ ۲٫۶) — ردیف‌ها بازشماره می‌شوند
      و خلاصه/اعتبارسنجی/دکمهٔ Commit بلافاصله به‌روز می‌شوند. */
  SetupView.removeBulkDraft = function (i) {
    const b = SetupView._bulk;
    if (!b || i < 0 || i >= b.drafts.length) return;
    const removed = b.drafts.splice(i, 1)[0];

    SetupView.renderBulkPreview();
    SetupView.renderBulkSummary();
    SetupView.revalidateBulk();

    UI.toast(
      b.drafts.length
        ? `ردیف ${U.faNum(i + 1)}${removed && removed.motherToken ? ` (عرض ${U.escapeHtml(String(removed.motherToken))})` : ''} از پیش‌نمایش حذف شد — ${U.faNum(b.drafts.length)} ردیف باقی است.`
        : 'آخرین ردیف حذف شد — پیش‌نمایش خالی است.',
      'info'
    );
  };

  /** کلید یکتای یک ردیف Bulk (برای یافتن همتای هم‌کلید در پیش‌نمایش) —
      هویت Batch (خط/سالن/تاریخ) هم بخشی از کلید است (نسخهٔ ۲٫۹). */
  SetupView.bulkRowKey = function (d, common) {
    return Setups.uniqueKey({
      width: U.parseNumber(d.motherToken),
      setupNumber: U.parseInt(common.setupNumber),
      standardLength: U.parseNumber(d.standardLength),
      machineNumber: U.parseInt(d.machineNumber),
      cuttingPattern: d.patternText,
      productionLine: common.productionLine,
      hallNumber: U.parseInt(common.hallNumber),
      setupDate: common.setupDate,
    });
  };

  /** ادغام ردیف تکراری با همتای معتبرش (تغییر ۲) — تعداد رول ردیف تکراری
      به تعداد رول همتای معتبر اضافه می‌شود، ردیف تکراری حذف می‌شود و
      خلاصه/اعتبارسنجی/دکمهٔ Commit بلافاصله به‌روز می‌شوند.
      مثال: تکراری با تعداد ۲ + معتبر با تعداد ۵ → همتا ۷ می‌شود. */
  SetupView.mergeBulkDraft = function (i) {
    const b = SetupView._bulk;
    if (!b || i < 0 || i >= b.drafts.length) return;

    const tr = document.querySelector(`[data-bulk-tr="${i}"]`);
    const btn = tr ? tr.querySelector('[data-bulk-merge]') : null;
    const target = btn ? Number(btn.dataset.mergeTarget) : NaN;
    if (!Number.isInteger(target) || target < 0 || target >= b.drafts.length || target === i) {
      UI.toast('همتای معتبری برای ادغام این ردیف یافت نشد.', 'warning');
      return;
    }

    const dup = b.drafts[i];
    const dest = b.drafts[target];
    const dupCount = dup.rollCount === null ? 0 : (dup.rollCount || 0);
    const destCount = dest.rollCount === null ? 0 : (dest.rollCount || 0);

    dest.rollCount = destCount + dupCount;

    const dupWidth = U.escapeHtml(String(dup.motherToken ?? '?'));
    b.drafts.splice(i, 1);

    SetupView.renderBulkPreview();
    SetupView.renderBulkSummary();
    SetupView.revalidateBulk();

    UI.toast(
      `ردیف تکراری (عرض ${dupWidth}، تعداد ${U.faNum(dupCount)}) در همتای معتبرش ادغام شد — تعداد رول همتا: ${U.faNum(destCount)} + ${U.faNum(dupCount)} = ${U.faNum(dest.rollCount)}.`,
      'success',
      6000
    );
  };

  /** تغییر یک فیلد رکورد — خلاصه/سلول‌های همان ردیف بلافاصله؛ اعتبارسنجی با debounce */
  SetupView.onBulkRowInput = function (el) {
    const b = SetupView._bulk;
    if (!b) return;
    const i = Number(el.dataset.bulkRow);
    const draft = b.drafts[i];
    if (!draft) return;

    const field = el.dataset.bulkField;
    if (field === 'rollCount') {
      const v = U.parseInt(el.value);
      draft.rollCount = v === null ? null : v;
    } else {
      draft[field] = el.value;
    }

    SetupView.renderBulkSummary();          // زنده — بلافاصله
    SetupView.updateBulkRowComputed(i);
    SetupView.scheduleBulkRevalidate();
  };

  /** سلول‌های محاسباتی ردیف‌ها (مجموع الگو / پرت عرض) */
  SetupView.updateBulkRowComputed = function (rowIdx = null) {
    const b = SetupView._bulk;
    if (!b) return;
    const rowsIdx = rowIdx === null ? b.drafts.map((_, i) => i) : [rowIdx];

    for (const i of rowsIdx) {
      const tr = document.querySelector(`[data-bulk-tr="${i}"]`);
      if (!tr) continue;
      const d = b.drafts[i];

      const parsed = Setups.parsePattern(d.patternText);
      const mother = U.parseNumber(d.motherToken);
      const sum = parsed.ok ? parsed.sum : null;
      const trim = parsed.ok && mother !== null ? mother - sum : null;

      tr.querySelector('[data-bulk-cell="sum"]').innerHTML =
        sum !== null ? U.faWidth(sum) : '<span class="muted">—</span>';
      tr.querySelector('[data-bulk-cell="trim"]').innerHTML =
        trim !== null && trim >= 0 ? U.faWidth(trim) : '<span class="muted">—</span>';
    }
  };

  /**
   * بازسازی گزینه‌های «متراژ استاندارد» با تغییر ضخامت سراسری —
   * مقدار رکوردها اگر در قوانین ضخامت جدید معتبر باشد حفظ می‌شود.
   */
  SetupView.rebuildBulkStandardOptions = function () {
    const b = SetupView._bulk;
    if (!b) return;
    const options = SetupView.bulkStandardOptions();
    const optionsStr = options.map(String);

    for (let i = 0; i < b.drafts.length; i++) {
      const sel = document.querySelector(`[data-bulk-field="standardLength"][data-bulk-row="${i}"]`);
      if (!sel) continue;
      const keep = optionsStr.includes(String(b.drafts[i].standardLength)) ? b.drafts[i].standardLength : '';
      b.drafts[i].standardLength = keep;
      sel.innerHTML = '<option value="">—</option>' +
        options.map((o) => `<option value="${o}" ${String(o) === String(keep) ? 'selected' : ''}>${U.faNum(o)}</option>`).join('');
    }

    const g = document.getElementById('bulk-g-standard');
    if (g) {
      g.innerHTML = '<option value="">— بدون تغییر —</option>' +
        options.map((o) => `<option value="${o}">${U.faNum(o)}</option>`).join('');
    }
  };

  /** اعتبارسنجی زنده با debounce (پس از توقف تایپ) */
  SetupView.scheduleBulkRevalidate = function () {
    clearTimeout(SetupView._bulkValidateTimer);
    SetupView._bulkValidateTimer = setTimeout(() => SetupView.revalidateBulk(), 350);
  };

  /** اعتبارسنجی زندهٔ پیش‌نمایش + به‌روزرسانی وضعیت ردیف‌ها و دکمهٔ Commit */
  SetupView.revalidateBulk = async function () {
    const b = SetupView._bulk;
    if (!b) return;
    const check = await Setups.validateBulkDraft(b.common, b.drafts, { allowedMap: b.allowedMap });
    SetupView.applyBulkCheck(check);
  };

  /** رندر پنل «کنترل تعداد مجاز عرض‌های مادر» (تغییر ۱) — از نتیجهٔ
      اعتبارسنجی زنده؛ با هر ویرایش/حذف/ادغام/تغییر متراژ به‌روز می‌شود.
      هر ردیف: عرض یکتای مادر · «تعداد مجاز» دیتای پیست‌شده (عرض × تکرار ×
      عدد انتهایی) · «تعداد مجاز» پیش‌نمایش (عرض × تعداد ست × تعداد) · وضعیت. */
  SetupView.renderBulkAllowedPanel = function (check) {
    const wrap = document.getElementById('bulk-allowed-panel');
    if (!wrap) return;

    const b = SetupView._bulk;
    const rows = (check && Array.isArray(check.allowedRows)) ? check.allowedRows : null;
    if (!b || !b.drafts.length || !rows || !rows.length) {
      wrap.innerHTML = '';
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    const STATUS = {
      ok:   '<span class="status-pill pill-ok" title="دو مقدار برابرند — کنترل پاس شد">✓ برابر</span>',
      less: '<span class="status-pill pill-bad" title="پیش‌نمایش کمتر از دیتای پیست‌شده است — تعداد کمتر از دیتای ستاپ است">✕ کمتر از دیتای ستاپ</span>',
      more: '<span class="status-pill pill-bad" title="پیش‌نمایش بیشتر از دیتای پیست‌شده است — تعداد رول‌های آن عرض بیشتر از دیتای ستاپ است">✕ بیشتر از دیتای ستاپ</span>',
    };

    const fmt = (n) => U.faNum(n);
    wrap.innerHTML = `
      <div class="bulk-allowed">
        <div class="bulk-allowed-head">
          <b>کنترل «تعداد مجاز» عرض‌های مادر:</b>
          <span class="muted">عرض × (تعداد تکرار در ردیف مادر × عدد انتهایی ردیف الگو) در دیتای پیست‌شده باید برابر عرض × (تعداد ست × تعداد رول) پیش‌نمایش باشد</span>
        </div>
        <div class="table-wrap">
          <table class="data-table bulk-allowed-table"><thead><tr>
            <th>عرض مادر</th>
            <th>تعداد مجاز (دیتای پیست‌شده)</th>
            <th>تعداد مجاز (پیش‌نمایش)</th>
            <th>وضعیت</th>
          </tr></thead><tbody>
            ${rows.map((r) => `<tr class="${r.status === 'ok' ? '' : 'bulk-allowed-bad'}">
              <td class="em-cell">${U.faWidth(r.width)}</td>
              <td title="Σ (تکرار × عدد انتهایی) = ${fmt(r.pastedCount)} × عرض ${U.faWidth(r.width)}">${fmt(r.pasted)}</td>
              <td title="Σ (تعداد ست × تعداد) = ${fmt(r.previewCount)} × عرض ${U.faWidth(r.width)}${r.previewCount === 0 ? ' — رکوردی با این عرض در پیش‌نمایش نیست' : ''}">${fmt(r.preview)}</td>
              <td>${STATUS[r.status] || ''}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>
      </div>`;
  };

  /** اعمال نتیجهٔ اعتبارسنجی روی UI پیش‌نمایش (خطاهای سراسری + وضعیت ردیف‌ها) */
  SetupView.applyBulkCheck = function (check) {
    SetupView._bulkCheck = check;
    const b = SetupView._bulk;
    if (!b) return;

    // خطاهای فیلدهای سراسری زیر ورودی‌های خودشان (نسخهٔ ۲٫۹: + خط تولید و سالن)
    const globalMap = {
      setupNumber: ['bulk-g-err-setup', 'bulk-g-setup'],
      productionLine: ['bulk-g-err-line', 'bulk-g-line'],
      hallNumber: ['bulk-g-err-hall', 'bulk-g-hall'],
      thickness: ['bulk-g-err-thickness', 'bulk-g-thickness'],
      setupDate: ['bulk-g-err-date', 'bulk-g-date'],
    };
    for (const [field, [errId, inputId]] of Object.entries(globalMap)) {
      const errEl = document.getElementById(errId);
      const inputEl = document.getElementById(inputId);
      const msg = check.globalErrors[field] || '';
      if (errEl) { errEl.textContent = msg; errEl.hidden = !msg; }
      if (inputEl) inputEl.classList.toggle('invalid', !!msg);
    }

    /* --- تاریخ ستاپ Batch (نسخهٔ ۲٫۸ → ۳٫۱ — تغییر ۱: کلید ۴فاکتوری) ---
       ارث‌بری هویت‌محور (ستاپ + خط + سالن + عدد سال از رکوردها) → قفل فیلد +
       راهنمای همان تاریخ؛ در غیر این صورت فیلد آزاد است و راهنمای آن را
       refreshBulkDateField/snapBulkDateToIdentity مدیریت می‌کنند (اینجا دست
       نمی‌خورد تا بازخوردهای آن دو بازنویسی نشود).
       نسخهٔ ۲٫۹: خطای کلید تکراری (شماره ستاپ تکراری) حتی روی تاریخِ ارث‌رسیده
       هم نمایش داده می‌شود (عدد سال، بخشی از کلید هویت است — تغییرش ممکن نیست،
       اصلاح از طریق شماره ستاپ/خط/سالن انجام می‌شود). --- */
    const gDate = document.getElementById('bulk-g-date');
    const gDateHint = document.getElementById('bulk-g-hint-date');
    if (gDate) {
      if (check.dateInherited && check.inheritedDateValue) {
        gDate.value = check.inheritedDateValue;
        b.common.setupDate = check.inheritedDateValue;   // تاریخ مؤثر Batch هم به‌روز شود (رفع پایداری مقدار در رندر مجدد)
        gDate.disabled = true;
        if (gDateHint) {
          gDateHint.textContent = check.dateSnapped
            ? `تاریخ واردشده به تاریخ ثبت‌شدهٔ همین کلید هویت تبدیل شد: ${U.faJalali(check.inheritedDateValue)} — یک هویت = یک تاریخ؛ فیلد قفل است و همان تاریخ برای همهٔ رکوردهای این Batch اعمال می‌شود.`
            : `تاریخ ${U.faJalali(check.inheritedDateValue)} برای کلید هویت این Batch (ستاپ + خط تولید + شماره سالن + عدد سال) ثبت شده و به‌صورت خودکار تعیین شد — قابل تغییر نیست؛ همان تاریخ برای همهٔ رکوردهای این Batch اعمال می‌شود.`;
          gDateHint.hidden = false;
        }
        const dateErr = document.getElementById('bulk-g-err-date');
        if (dateErr && !check.globalErrors.setupDate) { dateErr.textContent = ''; dateErr.hidden = true; }
        if (check.globalErrors.setupDate) gDate.classList.add('invalid');
      } else {
        gDate.disabled = false;
      }
    }

    // وضعیت هر ردیف
    b.drafts.forEach((d, i) => {
      const tr = document.querySelector(`[data-bulk-tr="${i}"]`);
      if (!tr) return;
      const cell = tr.querySelector('[data-bulk-cell="status"]');
      const rec = check.records[i];
      const errs = rec ? rec.errors : [];
      tr.classList.toggle('bulk-row-error', errs.length > 0);
      cell.innerHTML = errs.length
        ? `<span class="status-pill pill-bad">✕ خطا</span>
           <ul class="bulk-errors">${errs.map((e) => `<li>${U.escapeHtml(e)}</li>`).join('')}</ul>`
        : '<span class="status-pill pill-ok">✓ معتبر</span>';
    });

    /* --- آیکون ادغام ردیف‌های هم‌کلید (نسخهٔ ۲٫۹ — تغییر ۳ کاربر) ---
       دکمهٔ ادغام تک‌ردیفی در «هر شرایطی» نمایان است: هر ردیفی که ردیف
       دیگری با همان کلید یکتا در همین Batch داشته باشد (معتبر یا دارای
       هر خطایی — حتی خطای «شماره ستاپ تکراری است»)، دکمهٔ ادغام می‌گیرد.
       مقصد ادغام: اولین ردیف «معتبرِ» هم‌کلید؛ اگر نبود، اولین ردیف هم‌کلید. */
    const sameKeyIndex = new Map();    // uniqueKey → [اندیس‌های هم‌کلید]
    const validKeyIndex = new Map();   // uniqueKey → اندیس اولین ردیف معتبر
    b.drafts.forEach((d, i) => {
      const k = SetupView.bulkRowKey(d, b.common);
      if (!sameKeyIndex.has(k)) sameKeyIndex.set(k, []);
      sameKeyIndex.get(k).push(i);
      const rec = check.records[i];
      if (rec && !rec.errors.length && rec.record && !validKeyIndex.has(k)) {
        validKeyIndex.set(k, i);
      }
    });
    b.drafts.forEach((d, i) => {
      const tr = document.querySelector(`[data-bulk-tr="${i}"]`);
      if (!tr) return;
      const btn = tr.querySelector('[data-bulk-merge]');
      if (!btn) return;

      const k = SetupView.bulkRowKey(d, b.common);
      const peers = (sameKeyIndex.get(k) || []).filter((x) => x !== i);
      if (peers.length) {
        // مقصد: اولین ردیف معتبر هم‌کلید؛ وگرنه اولین هم‌کلید
        const target = validKeyIndex.has(k) && validKeyIndex.get(k) !== i
          ? validKeyIndex.get(k)
          : peers[0];
        btn.hidden = false;
        btn.dataset.mergeTarget = String(target);
        btn.title = `ادغام این ردیف (تعداد ${U.faNum(d.rollCount ?? 0)}) با ردیف ${U.faNum(target + 1)} هم‌کلید — تعداد رول جمع می‌شود (در هر شرایطی قابل ادغام است)`;
      } else {
        btn.hidden = true;
        delete btn.dataset.mergeTarget;
      }
    });

    const commitBtn = document.getElementById('btn-bulk-commit');
    const hasStructure = b.structureErrors.length > 0;
    // نسخهٔ ۲٫۶: با حذف همهٔ رکوردها، دکمهٔ Commit هم غیرفعال می‌ماند
    commitBtn.disabled = !(b.drafts.length > 0 && check.ok === true && !hasStructure);

    /* --- دکمهٔ سراسری «ادغام ردیف‌های تکراری» (نسخهٔ ۲٫۸ → ۲٫۹): فعال وقتی حداقل
           یک گروه هم‌کلید (عرض مادر + شماره ستاپ + متراژ استاندارد + دستگاه +
           الگوی برش + خط تولید + سالن + سال) بیش از یک ردیف داشته باشد. --- */
    const mergeAllBtn = document.getElementById('btn-bulk-merge-all');
    if (mergeAllBtn) {
      const keyCount = new Map();
      b.drafts.forEach((d) => {
        const k = SetupView.bulkRowKey(d, b.common);
        keyCount.set(k, (keyCount.get(k) || 0) + 1);
      });
      const dupGroups = [...keyCount.values()].filter((c) => c > 1).length;
      mergeAllBtn.disabled = dupGroups === 0;
      mergeAllBtn.title = dupGroups
        ? `${U.faNum(dupGroups)} گروه ردیف هم‌کلید (عرض مادر + شماره ستاپ + متراژ استاندارد + دستگاه + الگوی برش + خط تولید + سالن + سال) ادغام می‌شود — تعداد رول جمع می‌شود`
        : 'ردیف تکراری هم‌کلیدی در پیش‌نمایش نیست (کلید: عرض مادر + شماره ستاپ + متراژ استاندارد + دستگاه + الگوی برش + خط تولید + سالن + سال)';
    }

    /* --- پنل «کنترل تعداد مجاز» (تغییر ۱) + هشدار سراسری --- */
    SetupView.renderBulkAllowedPanel(check);
  };

  /** ادغام همهٔ ردیف‌های تکراری (نسخهٔ ۲٫۸ — دکمهٔ سراسری نوار ابزار Bulk).
      ردیف‌ها بر اساس کلید یکتا (عرض مادر + شماره ستاپ + متراژ استاندارد +
      دستگاه + الگوی برش) گروه‌بندی می‌شوند؛ هر گروه با بیش از یک ردیف در
      ردیف اولِ همان گروه ادغام می‌شود (تعداد رول جمع می‌شود) و بقیه حذف
      می‌شوند. خلاصه/اعتبارسنجی/دکمهٔ‌ها بلافاصله به‌روز می‌شوند.
      توجه: ردیفی که با رکورد ثبت‌شدهٔ پایگاه‌داده تکراری است با ادغامِ داخل
      Batch حل نمی‌شود و باید دستی اصلاح شود (پیام خطای خود را نگه می‌دارد). */
  SetupView.mergeAllBulkDuplicates = function () {
    const b = SetupView._bulk;
    if (!b || !b.drafts.length) {
      UI.toast('پیش‌نمایشی برای ادغام وجود ندارد — ابتدا «تحلیل و پیش‌نمایش» را بزنید.', 'info');
      return;
    }

    // گروه‌بندی ردیف‌ها بر اساس کلید یکتای ۵فاکتوری
    const groups = new Map();   // کلید → اندیس ردیف‌های هم‌کلید
    b.drafts.forEach((d, i) => {
      const k = SetupView.bulkRowKey(d, b.common);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });

    const mergeable = [...groups.values()].filter((idxs) => idxs.length > 1);
    if (!mergeable.length) {
      UI.toast('ردیف تکراری هم‌کلیدی یافت نشد — کلید ادغام: عرض مادر + شماره ستاپ + متراژ استاندارد + دستگاه + الگوی برش.', 'info');
      return;
    }

    // جمع تعداد رول در ردیف اول هر گروه + حذف بقیه (اندیس‌ها قبل از تغییر آرایه جمع می‌شوند)
    const toRemove = new Set();
    let removedRows = 0;
    for (const idxs of mergeable) {
      const first = b.drafts[idxs[0]];
      let sum = first.rollCount === null ? 0 : (first.rollCount || 0);
      for (let j = 1; j < idxs.length; j++) {
        const dup = b.drafts[idxs[j]];
        sum += dup.rollCount === null ? 0 : (dup.rollCount || 0);
        toRemove.add(idxs[j]);
        removedRows++;
      }
      first.rollCount = sum;
    }
    b.drafts = b.drafts.filter((_, i) => !toRemove.has(i));

    SetupView.renderBulkPreview();
    SetupView.renderBulkSummary();
    SetupView.revalidateBulk();

    UI.toast(
      `${U.faNum(mergeable.length)} گروه تکراری ادغام شد — ${U.faNum(removedRows)} ردیف حذف و تعداد رول در ردیف اول هر گروه جمع شد؛ ${U.faNum(b.drafts.length)} ردیف باقی است.`,
      'success',
      7000
    );
  };

  /** Commit نهایی — یک تراکنش واحد از وضعیت ویرایش‌شده؛ در صورت خطا هیچ رکوردی ثبت نمی‌شود */
  SetupView.commitBulk = async function () {
    const b = SetupView._bulk;
    if (!b || !b.drafts.length) return;

    const result = await Setups.commitBulkDraft(b.common, b.drafts, { allowedMap: b.allowedMap });

    if (!result.ok) {
      SetupView.applyBulkCheck(result);
      UI.toast('Batch ثبت نشد — خطاها را در پیش‌نمایش برطرف کنید (هیچ رکوردی ذخیره نشده است).', 'error', 6000);
      return;
    }

    UI.toast(
      `${U.faNum(result.count)} رکورد ستاپ در یک تراکنش واحد ثبت شد (Bulk Paste).`,
      'success',
      5000
    );
    SetupView.resetBulk();
    await RM.refreshAll();
    await SetupView.render();
  };

  /** پاک‌کردن ناحیهٔ Bulk */
  SetupView.resetBulk = function () {
    document.getElementById('bulk-text').value = '';
    SetupView._bulk = null;
    SetupView._bulkCheck = null;
    clearTimeout(SetupView._bulkValidateTimer);
    SetupView.renderBulkPreview();
    SetupView.renderBulkSummary();
  };

  /* ================================================================
     ۶) حذف‌ها (§70 — تأیید اجباری)
     ================================================================ */

  SetupView.removeRecord = async function (id) {
    const ok = await UI.confirm({
      title: 'حذف رکورد ستاپ',
      message: 'آیا از حذف این رکورد مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.',
      confirmText: 'بله، حذف کن',
      danger: true,
    });
    if (!ok) return;

    await Setups.remove(id);
    UI.toast('رکورد حذف شد.', 'success');
    await RM.refreshAll();
    await SetupView.render();
  };

  /* ================================================================
     ۶) رندر جدول گزارش ستاپ‌ها (§46-§51، §30، §45)
        + پنل مرتب‌سازی چندمرحله‌ای ماندگار + فیلتر ستون‌ها
     ================================================================ */

  /** کارت‌های الگوی برش (§30 + تغییر ۲ — نمایش کارت به ازای هر قطعه)
      هر قطعهٔ الگو یک کارت مستقل دارد؛ عرض‌های تکراری کارت تکراری می‌سازند
      (مثلاً الگوی 1100-1100 برای مادر 2200 → دو کارت 1100) و نشان «×تعداد»
      زیر عرض‌ها حذف شد. زیر کارت‌ها:
        - بدون پرت: خط «Σ مجموع قطعه‌ها · فرزند هر مادر: N رول»
          (N = تعداد قطعه‌ها × تعداد ست — جزئیات در Tooltip)
        - دارای پرت (مادر > Σ الگو): فقط «پرت عرض: X» نمایش داده می‌شود. */
  SetupView.renderPatternCards = function (setup) {
    const parsed = Setups.parsePattern(setup.cuttingPattern);
    if (!setup.cuttingPattern) return '<span class="muted">—</span>';
    if (!parsed.ok) return `<span class="film-bad">${U.escapeHtml(setup.cuttingPattern)}</span>`;

    /* تعداد ست از موتور محاسبه (تغییر ۱) — رکورد بی‌قانون = ۱ ست */
    const setCount = Number.isFinite(setup.setCount) && setup.setCount > 0 ? setup.setCount : 1;

    /* تغییر ۲: یک کارت برای هر قطعهٔ الگو (بدون تجمیع عرض‌های یکسان) */
    const cards = parsed.parts
      .map((w) => `<span class="pattern-card">${U.faWidth(w)}</span>`)
      .join('');

    const trim = setup.width - parsed.sum;
    const childPerMother = parsed.parts.length * setCount;

    /* زیر کارت‌ها — فقط مقدار پرت وقتی الگو نسبت به مادر پرت دارد */
    const caption = trim > 0
      ? `<span class="pattern-trim" title="عرض رول مادر ${U.faWidth(setup.width)} − Σ الگو ${U.faWidth(parsed.sum)} = ${U.faWidth(trim)}">پرت عرض: ${U.faWidth(trim)}</span>`
      : `Σ ${U.faWidth(parsed.sum)} · فرزند هر مادر: ${U.faNum(childPerMother)} رول`;

    return `
      <div class="pattern-cards">${cards}</div>
      <div class="pattern-sum" title="${U.faNum(parsed.parts.length)} قطعه × ${U.faNum(setCount)} ست = ${U.faNum(childPerMother)} رول فرزند از هر مادر · Σ الگو = ${U.faWidth(parsed.sum)}${setCount !== 1 ? ` (تعداد ست: ${U.faNum(setCount)})` : ''}">${caption}</div>`;
  };

  /* ---------------- پنل مرتب‌سازی گزارش ستاپ‌ها (ماندگار) ---------------- */

  /** ذخیرهٔ ماندگار ترتیب مرتب‌سازی (مثل رول‌های خام §38) */
  SetupView.saveSort = function () {
    RM.db.setSetting('setupReportSort', SetupView.sortPipeline);
  };

  SetupView.renderSortBuilder = function () {
    UI.sortPanel(
      document.getElementById('setup-sort-pipeline'),
      SetupView.sortPipeline,
      RM.config.SETUP_SORTABLE_FIELDS,
      {
        onDir: (i) => {
          SetupView.sortPipeline[i].direction =
            SetupView.sortPipeline[i].direction === 'asc' ? 'desc' : 'asc';
          SetupView.saveSort();
          SetupView.renderSortBuilder();
          SetupView.renderReportTable();
        },
        onRemove: (i) => {
          SetupView.sortPipeline.splice(i, 1);
          SetupView.saveSort();
          SetupView.renderSortBuilder();
          SetupView.renderReportTable();
        },
        onReorder: (from, to) => {
          const [moved] = SetupView.sortPipeline.splice(from, 1);
          SetupView.sortPipeline.splice(to, 0, moved);
          SetupView.saveSort();
          SetupView.renderSortBuilder();
          SetupView.renderReportTable();
        },
      }
    );
  };

  /** راه‌اندازی دکمه‌های افزودن/بازنشانی فیلد مرتب‌سازی */
  SetupView.initSortPanel = function () {
    const addSelect = document.getElementById('setup-sort-add-select');

    // گزینه‌ها از رجیستری مرکزی SETUP_SORTABLE_FIELDS
    addSelect.innerHTML = '<option value="">افزودن فیلد…</option>' +
      Object.entries(RM.config.SETUP_SORTABLE_FIELDS)
        .map(([k, v]) => `<option value="${k}">${U.escapeHtml(v.label)}</option>`)
        .join('');

    document.getElementById('setup-sort-add-btn').addEventListener('click', () => {
      const field = addSelect.value;
      if (!field) return;
      if (SetupView.sortPipeline.some((s) => s.field === field)) {
        UI.toast('این فیلد قبلاً به مرتب‌سازی اضافه شده است.', 'info');
        return;
      }
      SetupView.sortPipeline.push({ field, direction: 'asc' });
      SetupView.saveSort();
      SetupView.renderSortBuilder();
      SetupView.renderReportTable();
    });

    document.getElementById('setup-sort-reset-btn').addEventListener('click', () => {
      SetupView.sortPipeline = JSON.parse(JSON.stringify(RM.config.SETUP_DEFAULT_SORT));
      SetupView.saveSort();
      SetupView.renderSortBuilder();
      SetupView.renderReportTable();
      UI.toast('مرتب‌سازی گزارش ستاپ‌ها به حالت پیش‌فرض بازگشت.', 'info');
    });
  };

  /** اعمال مرتب‌سازی چندمرحله‌ای روی ردیف‌های گزارش (از آخرین اولویت به اولین)
      (۳٫۸: مرتب‌سازی همیشه برقرار است — اگر کاربر همهٔ مراحل را حذف کرده باشد،
       مرتب‌سازی پیش‌فرض «شماره ستاپ + عرض» اعمال می‌شود) */
  SetupView.applySetupSort = function (rows) {
    const pipeline = (SetupView.sortPipeline && SetupView.sortPipeline.length)
      ? SetupView.sortPipeline
      : RM.config.SETUP_DEFAULT_SORT;
    const sorted = [...rows];
    for (let i = pipeline.length - 1; i >= 0; i--) {
      const { field, direction } = pipeline[i];
      sorted.sort((a, b) => {
        if (field === 'cuttingPattern') {
          const ka = Setups.normalizePatternKey(a.cuttingPattern) || '';
          const kb = Setups.normalizePatternKey(b.cuttingPattern) || '';
          const r = ka.localeCompare(kb, 'fa', { numeric: true });
          return direction === 'desc' ? -r : r;
        }
        /* نسخهٔ ۲٫۸ — تاریخ ستاپ: مقایسهٔ لغوی «YYYY/MM/DD» با صفر پیشین = ترتیب زمانی؛
           مستقل از نمایش ستون کار می‌کند (حتی وقتی ستون مخفی است). رکوردهای بدون تاریخ آخر. */
        if (field === 'setupDate') {
          const da = a.setupDate || null;
          const dbv = b.setupDate || null;
          let r;
          if (da === null && dbv === null) r = 0;
          else if (da === null) r = 1;
          else if (dbv === null) r = -1;
          else r = da < dbv ? -1 : da > dbv ? 1 : 0;
          return direction === 'desc' ? -r : r;
        }
        /* نسخهٔ ۲٫۸ — وضعیت: «تمام شده» (۰) قبل از «باقی مانده» (۱)؛ نامشخص آخر */
        if (field === 'timeStatus') {
          const rank = (v) => (v === 'done' ? 0 : v === 'remaining' ? 1 : null);
          const ra = rank(a.timeStatus);
          const rb = rank(b.timeStatus);
          let r;
          if (ra === null && rb === null) r = 0;
          else if (ra === null) r = 1;
          else if (rb === null) r = -1;
          else r = ra - rb;
          return direction === 'desc' ? -r : r;
        }
        return U.compareNumeric(a[field], b[field], direction);
      });
    }
    return sorted;
  };
  /* ---------------- پنل‌های قابل مخفی/ظاهر + ترتیب ستون‌ها (نسخهٔ ۲٫۳) ---------------- */

  /** اعمال وضعیت نمایش/مخفی پنل مرتب‌سازی + پنل ترتیب ستون‌ها
      (۳٫۸: دکمه‌ها ریز و همیشه «مرتب‌سازی» / «ترتیب ستون‌ها» — باز بودن پنل
       با کلاس panel-on و رنگ روشن دکمه مشخص می‌شود) */
  SetupView.applyPanelVisibility = function () {
    /* ۳٫۹ — تغییر ۵: دکمه‌ها داخل نوار بالای جدول‌اند؛ builder ها مستقل از
       دکمه به‌روز می‌شوند تا در نبود جدول (حالت خالی) وضعیت پنل حفظ شود. */
    const sortBuilder = document.getElementById('setup-sort-builder');
    if (sortBuilder) sortBuilder.hidden = !SetupView.sortPanelVisible;
    const sortToggle = document.getElementById('setup-sort-toggle');
    if (sortToggle) {
      sortToggle.setAttribute('aria-expanded', String(SetupView.sortPanelVisible));
      sortToggle.classList.toggle('panel-on', SetupView.sortPanelVisible);
      sortToggle.title = SetupView.sortPanelVisible
        ? 'بستن پنل مرتب‌سازی (برای صرفه‌جویی در فضا)'
        : 'نمایش پنل مرتب‌سازی';
    }

    const colsBuilder = document.getElementById('setup-cols-builder');
    if (colsBuilder) colsBuilder.hidden = !SetupView.colsPanelVisible;
    const colsToggle = document.getElementById('setup-cols-toggle');
    if (colsToggle) {
      colsToggle.setAttribute('aria-expanded', String(SetupView.colsPanelVisible));
      colsToggle.classList.toggle('panel-on', SetupView.colsPanelVisible);
      colsToggle.title = SetupView.colsPanelVisible
        ? 'بستن پنل ترتیب ستون‌ها (برای صرفه‌جویی در فضا)'
        : 'نمایش پنل ترتیب ستون‌ها';
    }
  };

  /** رندر پنل «ترتیب ستون‌ها» — چیپ‌های کشیدنی + باکس عرض هر ستون (نسخهٔ ۲٫۴:
      بجای فلش‌های ↑/↓، کاربر عرض دلخواه هر ستون را در باکس عددی وارد می‌کند)
      نسخهٔ ۳٫۰ (تغییر ۳): دکمهٔ «چشم» هر چیپ، همان ستون را در جدول مخفی/نمایان
      می‌کند — ستون مخفی از جدول حذف می‌شود اما در پنل می‌ماند و با کلیک دوباره
      برمی‌گردد (ماندگار در appSettings: setupReportHiddenCols). */
  SetupView.renderColumnOrderPanel = function () {
    const all = SetupView.reportColumns();
    const widths = SetupView.columnWidths || {};
    const hiddenSet = new Set(SetupView.hiddenCols || []);
    const items = SetupView.columnOrder
      .map((key) => all[key])
      .filter(Boolean)
      .map((c) => ({ key: c.key, label: c.label, width: widths[c.key] ?? 0, hidden: hiddenSet.has(c.key) }));

    UI.orderPanel(document.getElementById('setup-cols-pipeline'), items, {
      onMove: async (from, to) => {
        const [moved] = SetupView.columnOrder.splice(from, 1);
        SetupView.columnOrder.splice(to, 0, moved);
        await RM.db.setSetting('setupColumnOrder', SetupView.columnOrder);
        SetupView.renderColumnOrderPanel();
        SetupView.renderReportTable();
      },
      // تغییر عرض یک ستون (px) — ماندگار + رندر مجدد جدول (نسخهٔ ۲٫۴)
      onWidth: async (key, w) => {
        SetupView.columnWidths = SetupView.columnWidths || {};
        SetupView.columnWidths[key] = w;
        await RM.db.setSetting('setupColumnWidths', SetupView.columnWidths);
        SetupView.renderReportTable();
      },
      /* --- نسخهٔ ۳٫۰ (تغییر ۳): نمایش/مخفی‌کردن هر ستون در جدول --- */
      onToggle: async (key, hidden) => {
        const set = new Set(SetupView.hiddenCols || []);
        if (hidden) set.add(key);
        else set.delete(key);
        SetupView.hiddenCols = [...set];
        await RM.db.setSetting('setupReportHiddenCols', SetupView.hiddenCols);
        SetupView.renderColumnOrderPanel();
        SetupView.renderReportTable();
        UI.toast(hidden
          ? `ستون «${U.escapeHtml((all[key] || {}).label || key)}» در جدول مخفی شد — از پنل ترتیب ستون‌ها (چشم) دوباره نمایش داده می‌شود.`
          : `ستون «${U.escapeHtml((all[key] || {}).label || key)}» دوباره نمایش داده شد.`, 'info');
      },
      emptyText: 'بدون ستون',
    });
  };

  /* ---------------- رجیستری ستون‌های گزارش (نسخهٔ ۲٫۳) ----------------
     هر ستون: render + tokens (متن‌های قابل‌جست‌وجو برای فیلتر «شامل بودن»).
     ترتیب نمایش از SetupView.columnOrder (قابل تغییر با پنل ترتیب ستون‌ها). */

  SetupView.reportColumns = function () {
    /* توکن‌های زمان (نسخهٔ ۲٫۴): نمایش [H]:mm + مقدار خام دقیقه + ساعت گرد */
    const durationTokens = (r, key) => {
      const v = r[key];
      return v === null
        ? ['بدون قانون']
        : [U.faHMM(v), String(v), String(Math.round(v / 60))];
    };
    const widths = SetupView.columnWidths || {};

    const registry = {
      setupNumber: {
        key: 'setupNumber', label: 'ستاپ', className: 'em-cell',
        render: (r) => U.faNum(r.setupNumber),
        tokens: (r) => [U.faNum(r.setupNumber), String(r.setupNumber ?? '')],
      },
      productionLine: {
        /* نسخهٔ ۲٫۹ — خط تولید هویت ستاپ (F=BOPP · K=CPP در شمارهٔ رول‌ها) */
        key: 'productionLine', label: 'خط تولید', className: 'line-cell',
        render: (r) => r.productionLine
          ? `<span class="line-badge line-${U.escapeHtml(String(r.productionLine).toLowerCase())}" title="خط تولید هویت ستاپ — از مولفه‌های کلید تطبیق (نسخهٔ ۲٫۹)">${U.escapeHtml(String(r.productionLine))}</span>`
          : '<span class="muted" title="رکورد قدیمی بدون خط تولید — با ویرایش تکمیل شود">—</span>',
        tokens: (r) => r.productionLine ? [String(r.productionLine)] : [],
      },
      hallNumber: {
        /* نسخهٔ ۲٫۹ — شماره سالن هویت ستاپ (رقم اول شمارهٔ رول‌ها) */
        key: 'hallNumber', label: 'سالن',
        render: (r) => r.hallNumber !== null && r.hallNumber !== undefined
          ? U.faNum(r.hallNumber)
          : '<span class="muted" title="رکورد قدیمی بدون شماره سالن — با ویرایش تکمیل شود">—</span>',
        tokens: (r) => (r.hallNumber !== null && r.hallNumber !== undefined) ? [U.faNum(r.hallNumber), String(r.hallNumber)] : [],
      },
      machineNumber: {
        key: 'machineNumber', label: 'دستگاه',
        render: (r) => U.faNum(r.machineNumber),
        tokens: (r) => [U.faNum(r.machineNumber), String(r.machineNumber ?? '')],
      },
      width: {
        key: 'width', label: 'عرض', className: 'em-cell',
        render: (r) => U.faWidth(r.width),
        tokens: (r) => [U.faWidth(r.width), String(r.width ?? '')],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت',
        render: (r) => r.thickness === null ? '<span class="muted">ناقص</span>' : U.faNum(r.thickness),
        tokens: (r) => r.thickness === null ? ['ناقص'] : [U.faNum(r.thickness), String(r.thickness)],
      },
      standardLength: {
        key: 'standardLength', label: 'متراژ استاندارد',
        render: (r) => r.standardLength === null ? '<span class="muted">ناقص</span>' : U.faNum(r.standardLength),
        tokens: (r) => r.standardLength === null ? ['ناقص'] : [U.faNum(r.standardLength), String(r.standardLength)],
      },
      setCount: {
        /* تغییر ۱ — تعداد ست: متراژ استاندارد ÷ کوچکترین استاندارد ضخامت */
        key: 'setCount', label: 'تعداد ست',
        render: (r) => r.setCount === null
          ? '<span class="muted" title="ضخامت/متراژ استاندارد این رکورد در قوانین متراژ تعریف نشده">—</span>'
          : `<span class="num-set" title="${U.faNum(r.standardLength)} ÷ ${U.faNum(r.setBase)} (کوچکترین استاندارد ضخامت ${U.faNum(r.thickness)}) = ${U.faNum(r.setCount)}">${U.faNum(r.setCount)}</span>`,
        tokens: (r) => r.setCount === null ? [] : [U.faNum(r.setCount), String(r.setCount)],
      },
      rollCount: {
        /* نسخهٔ ۳٫۳ — تغییر نام ستون «تعداد» به «تعداد در ستاپ» (درخواست کاربر) */
        key: 'rollCount', label: 'تعداد در ستاپ', className: 'count-cell',
        render: (r) => U.faNum(r.rollCount),
        tokens: (r) => [U.faNum(r.rollCount), String(r.rollCount ?? '')],
      },
      cuttingPattern: {
        key: 'cuttingPattern', label: 'الگوی برش',
        render: SetupView.renderPatternCards,
        tokens: (r) => [
          String(r.cuttingPattern ?? ''),
          Setups.normalizePatternKey(r.cuttingPattern) || '',
        ],
      },
      rawExisting: {
        key: 'rawExisting', label: 'خام موجود',
        render: (r) => `<span class="num-raw">${U.faNum(r.rawExisting)}</span>`,
        tokens: (r) => [U.faNum(r.rawExisting), String(r.rawExisting ?? '')],
      },
      metallized: {
        key: 'metallized', label: 'متالایز',
        render: (r) => `<span class="num-metal">${U.faNum(r.metallized)}</span>`,
        tokens: (r) => [U.faNum(r.metallized), String(r.metallized ?? '')],
      },
      uncut: {
        key: 'uncut', label: 'برش‌نشده',
        render: (r) => r.conflict > 0
          ? `<span class="num-uncut">${U.faNum(r.uncut)}</span><span class="conflict-badge" title="مغایرت ظرفیت — خام موجود + متالایز بیش از تعداد ستاپ است">⚠ ${U.faNum(r.conflict)}</span>`
          : `<span class="num-uncut">${U.faNum(r.uncut)}</span>`,
        tokens: (r) => [U.faNum(r.uncut), String(r.uncut ?? ''), String(r.conflict ?? '')],
      },
      setupDate: {
        /* نسخهٔ ۲٫۸ — تاریخ ستاپ شمسی؛ پیش‌فرض مخفی، از پنل ترتیب ستون‌ها (چشم) نمایش داده می‌شود.
           مرتب‌سازی با آن مستقل از نمایش ستون کار می‌کند (لغوی YYYY/MM/DD = ترتیب زمانی). */
        key: 'setupDate', label: 'تاریخ ستاپ', className: 'date-cell',
        render: (r) => r.setupDate
          ? `<span class="num-date">${U.faJalali(r.setupDate)}</span>`
          : '<span class="muted" title="رکورد قدیمی بدون تاریخ — با ویرایش، تاریخ ثبت و به همهٔ رکوردهای همین ستاپ اعمال می‌شود">—</span>',
        tokens: (r) => r.setupDate ? [r.setupDate, U.faJalali(r.setupDate)] : [],
      },
      timeStatus: {
        /* نسخهٔ ۳٫۰ (تغییر ۲) — وضعیت:
           «تمام شده» = مانده زمان ستاپ ۰ «و» مانده زمان موجودی ۰
           «باقی مانده» = هر کدام از دو مقدار مثبت باشد؛ بدون قانون زمان → نامشخص */
        key: 'timeStatus', label: 'وضعیت',
        render: (r) => r.timeStatus === 'done'
          ? '<span class="status-pill pill-ok" title="مانده زمان ستاپ = ۰ و مانده زمان موجودی = ۰">تمام شده</span>'
          : r.timeStatus === 'remaining'
            ? '<span class="status-pill pill-warn" title="مانده زمان ستاپ یا مانده زمان موجودی > ۰">باقی مانده</span>'
            : '<span class="muted" title="قانون زمان متالایز برای این رکورد تعریف نشده">—</span>',
        tokens: (r) => r.timeStatus === 'done'
          ? ['تمام شده', 'done']
          : r.timeStatus === 'remaining'
            ? ['باقی مانده', 'remaining']
            : [],
      },
      remainingSetupTime: {
        key: 'remainingSetupTime', label: 'مانده زمان ستاپ', className: 'time-cell',
        // نسخهٔ ۲٫۴: فرمت تایم [H]:mm (مثل 487:42)
        render: (r) => r.remainingSetupTime === null
          ? '<span class="muted" title="قانون زمان متالایز برای دستگاه + متراژ استاندارد این رکورد تعریف نشده">بدون قانون</span>'
          : `<span class="num-time" title="${U.faDuration(r.remainingSetupTime)}">${U.faHMM(r.remainingSetupTime)}</span>`,
        tokens: (r) => durationTokens(r, 'remainingSetupTime'),
      },
      remainingProducedTime: {
        key: 'remainingProducedTime', label: 'مانده زمان موجودی', className: 'time-cell',
        // نسخهٔ ۲٫۴: تغییر نام از «تولید شده» + فرمت تایم [H]:mm
        render: (r) => r.remainingProducedTime === null
          ? '<span class="muted" title="قانون زمان متالایز برای دستگاه + متراژ استاندارد این رکورد تعریف نشده">بدون قانون</span>'
          : `<span class="num-time time-produced" title="${U.faDuration(r.remainingProducedTime)}">${U.faHMM(r.remainingProducedTime)}</span>`,
        tokens: (r) => durationTokens(r, 'remainingProducedTime'),
      },
      actions: {
        key: 'actions', label: 'عملیات', filterable: false,
        render: (r) => `
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-audit="${r.id}" title="جزئیات محاسبه (Audit)" aria-label="جزئیات محاسبه">${UI.icons.audit}</button>
            <button type="button" class="btn btn-ghost btn-icon" data-edit="${r.id}" title="ویرایش" aria-label="ویرایش">${UI.icons.edit}</button>
            <button type="button" class="btn btn-icon" data-del="${r.id}" title="حذف" aria-label="حذف">${UI.icons.trash}</button>
          </div>`,
      },
    };

    /* عرض هر ستون از پنل ترتیب ستون‌ها (نسخهٔ ۲٫۴) — 0/خالی = خودکار */
    for (const col of Object.values(registry)) {
      const w = Number(widths[col.key]);
      col.width = Number.isFinite(w) && w > 0 ? w : undefined;
    }
    return registry;
  };

  /** رندر جدول گزارش (نسخهٔ ۲٫۳) — کامپوننت مشترک UI.filterTable:
      ارتفاع ۵۰ رکورد + فیلتر «شامل بودن» زیر سرستون‌ها + دکمهٔ «≠» +
      حفظ فوکوس + ترتیب ستون‌های قابل تغییر — از موتور محاسبه (§79) */
  SetupView.renderReportTable = async function () {
    const state = await RM.calcEngine.getState();
    const report = state.setupReport;
    const rows = SetupView.applySetupSort(report);

    const wrap = document.getElementById('setup-table-wrap');
    const all = SetupView.reportColumns();
    const hiddenSet = new Set(SetupView.hiddenCols || []);   // نسخهٔ ۳٫۰ — تغییر ۳
    const columns = (SetupView.columnOrder || RM.config.SETUP_DEFAULT_COLUMN_ORDER)
      .map((key) => all[key])
      .filter(Boolean)
      .filter((c) => !hiddenSet.has(c.key));   // ستون‌های مخفی از پنل ترتیب (چشم)

    UI.filterTable(wrap, columns, rows, {
      state: SetupView,                      // filters + visibleRows (ماندگار)
      visibleRows: RM.config.SETUP_VISIBLE_ROWS,
      rowHeight: 56,                         // ردیف‌های این جدول بلندترند (کارت‌های الگو)
      /* ۳٫۹ — تغییر ۵: دکمه‌های ابزار در نوار بالای جدول (کنار «پاک‌کردن همهٔ
         فیلترها») — وضعیت فشرده از state نما و کلیک از طریق onToolToggle */
      tools: [
        { id: 'setup-cols-toggle', label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: SetupView.colsPanelVisible },
        { id: 'setup-sort-toggle', label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: SetupView.sortPanelVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'setup-cols-toggle') {
          SetupView.colsPanelVisible = !SetupView.colsPanelVisible;
          RM.db.setSetting('setupColsPanelVisible', SetupView.colsPanelVisible);
          SetupView.applyPanelVisibility();
        } else if (toolId === 'setup-sort-toggle') {
          SetupView.sortPanelVisible = !SetupView.sortPanelVisible;
          RM.db.setSetting('setupSortPanelVisible', SetupView.sortPanelVisible);
          SetupView.applyPanelVisibility();
        }
      },
      tableClass: 'cut-table setup-table',
      emptyText: 'هنوز ستاپی ثبت نشده — از فرم «ثبت رول جدید برای ستاپ» اولین رکورد را وارد کنید.',
      filteredEmptyText: 'هیچ ردیفی با فیلترهای فعلی مطابقت ندارد — فیلترها را پاک کنید.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن (اعداد و متن‌ها) · دکمهٔ «≠» = شامل نشود · فوکوس حفظ می‌شود · زمان‌ها با فرمت [H]:mm · باکس‌های جمع پایین جدول با دیتای فیلترشده به‌روز می‌شوند',
      // باکس‌های جمع زیر ستون‌ها (نسخهٔ ۲٫۶) — با احترام به فیلترهای فعال
      sums: {
        rollCount:              { type: 'number' },   // تعداد
        rawExisting:            { type: 'number' },   // خام موجود
        metallized:             { type: 'number' },   // متالایز
        uncut:                  { type: 'number' },   // برش‌نشده
        remainingSetupTime:     { type: 'time' },     // مانده زمان ستاپ — [H]:mm
        remainingProducedTime:  { type: 'time' },     // مانده زمان موجودی — [H]:mm
      },
      // نسخهٔ ۲٫۴: باکس تعداد ردیف + ماندگاری مقدار
      onRowsChange: (n) => RM.db.setSetting('setupVisibleRows', n),
      // رویدادهای ردیف پس از هر رندر بدنه
      onRendered: () => {
        wrap.querySelectorAll('[data-edit]').forEach((btn) =>
          btn.addEventListener('click', () => SetupView.startEdit(Number(btn.dataset.edit)))
        );
        wrap.querySelectorAll('[data-del]').forEach((btn) =>
          btn.addEventListener('click', () => SetupView.removeRecord(Number(btn.dataset.del)))
        );
        wrap.querySelectorAll('[data-audit]').forEach((btn) =>
          btn.addEventListener('click', () => SetupView.showAudit(Number(btn.dataset.audit), state))
        );
      },
    });
  };

  /** رندر کامل نما (پنل مرتب‌سازی + جدول) — از موتور محاسبه
      (۳٫۸: چیپ‌های آماری بالای جدول حذف شدند — آمار هر ستون در ردیف جمع زیر جدول) */
  SetupView.render = async function () {
    const state = await RM.calcEngine.getState();
    // قوانین برای دراپ‌داون فرم (بارگذاری مجدد — پس از تغییر قوانین هم تازه است)
    SetupView.currentRules = await db.standardLengthRules.toArray();

    const report = state.setupReport;

    SetupView.renderSortBuilder();
    SetupView.renderColumnOrderPanel();
    await SetupView.renderReportTable();
  };

  /* ================================================================
     ۷) جزئیات Audit تخصیص (§45) — بازطراحی ۳٫۸:
     فقط دو خط توضیح (کلید تطبیق خام + کلید تطبیق متالایز همان رکورد)
     + دو لیست مجزا: رول‌های خام تخصیص‌یافته و رول‌های متالایز تخصیص‌یافته.
     ================================================================ */

  /** ساخت HTML جدول فشردهٔ رول‌های تخصیص‌یافته (شماره رول · عرض · متراژ · ضخامت · تاریخ تولید) */
  SetupView._allocTableHtml = function (records) {
    if (!records.length) {
      return '<p class="audit-list-empty">رولی تخصیص نیافته است.</p>';
    }
    const rows = records.map((r) => `
      <tr>
        <td class="ltr">${U.escapeHtml(r.rollNumber || '—')}</td>
        <td>${r.width === null || r.width === undefined ? '<span class="muted">—</span>' : U.faWidth(r.width)}</td>
        <td>${r.actualLength === null || r.actualLength === undefined ? '<span class="muted">—</span>' : U.faNum(r.actualLength)}</td>
        <td>${r.thickness === null || r.thickness === undefined ? '<span class="muted">—</span>' : U.faNum(r.thickness)}</td>
        <td>${U.escapeHtml(U.faDateTime(r.productionDate))}</td>
      </tr>`).join('');
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>شماره رول</th><th>عرض</th><th>متراژ</th><th>ضخامت</th><th>تاریخ تولید</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  SetupView.showAudit = async function (id, state) {
    const r = state.setupReport.find((x) => x.id === id);
    if (!r) return;

    /* --- دو خط کلید تطبیق (تنها توضیح‌های مودال) --- */
    const rawKeyHtml = r.audit.rawGroup
      ? `<code>${U.escapeHtml(r.audit.rawGroup.key)}</code>`
      : '<span class="muted">— بدون گروه منطبق (تخصیص خام ندارد)</span>';
    const metKeyHtml = r.audit.metGroup
      ? `<code>${U.escapeHtml(r.audit.metGroup.key)}</code>`
      : '<span class="muted">— بدون گروه منطبق (تخصیص متالایز ندارد)</span>';

    /* --- دو لیست رول‌های تخصیص‌یافته (شناسه‌ها از موتور محاسبه — ۳٫۸) --- */
    const rawIds = (r.audit.rawRollIds || []);
    const metIds = (r.audit.metRollIds || []);
    const [rawGot, metGot] = await Promise.all([
      rawIds.length ? db.rolls.bulkGet(rawIds) : Promise.resolve([]),
      metIds.length ? db.archivedRolls.bulkGet(metIds) : Promise.resolve([]),
    ]);
    const rawRecords = await RM.edits.applyToRecords('rolls', rawGot.filter(Boolean));
    const metRecords = await RM.edits.applyToRecords('archived', metGot.filter(Boolean));

    UI.infoModal(
      `جزئیات تخصیص — ستاپ ${U.faNum(r.setupNumber)} / دستگاه ${U.faNum(r.machineNumber)}`,
      `
      <div class="audit-keys">
        <div>کلید تطبیق خام: ${rawKeyHtml}</div>
        <div>کلید تطبیق متالایز: ${metKeyHtml}</div>
      </div>
      <div class="audit-list">
        <h4>رول‌های خام تخصیص‌یافته <span class="muted">(${U.faNum(rawRecords.length)} رول)</span></h4>
        ${SetupView._allocTableHtml(rawRecords)}
      </div>
      <div class="audit-list">
        <h4>رول‌های متالایز تخصیص‌یافته <span class="muted">(${U.faNum(metRecords.length)} رول)</span></h4>
        ${SetupView._allocTableHtml(metRecords)}
      </div>
      `
    );
  };

  RM.views = RM.views || {};
  RM.views.setup = SetupView;
})();
