/* =========================================================================
   views/packaging.js — نما/تب «بسته‌بندی» (نسخهٔ ۳٫۲۲)
   -------------------------------------------------------------------------
   رابط کاربری صفحهٔ بسته‌بندی — تمام محاسبات از موتور مرکزی
   (js/packaging.js — RM.packaging.buildPlan) مصرف می‌شود؛ این فایل
   فقط نمایش/تعامل است و هیچ منطق تخصیص/بهینه‌سازی مستقل ندارد.

   ساختار صفحه (۳٫۱۵):
     ۱) کارت Import فایل مدیریت پالت‌ها (drop-pallets — هدف 'pallets')
     ۲) خلاصهٔ برنامه (وسط‌چین) — پالت‌های «فروش» همیشه کنار (بند ۵)
     ۳) هشدارهای داده‌ای اختصاصی همین صفحه (§24 سند + دریل سالم)
     ۴) چهار زیرتب:
        · برنامهٔ بسته‌بندی — فقط بسته‌های «قابل اقدام» با شماره‌گذاری
          پیوسته (۳٫۱۴ بند ۱) + ستون‌های LTR پالت/رول (بند ۱۳) + آپشن
          تفکیک صادراتی‌ها (بند ۵) + خروجی اکسل استایل‌دار (بند ۳)
        · پالت‌ها
        · رول‌ها و ردیابی
        · نمایش گرافیکی — دو پنل تفکیک‌شده (۳٫۱۵ بند ۴): جدول «لیست
          بسته های قابل نمایش» با تمام امکانات سایر جدول‌ها + درگ ردیف
          + مودال ویرایش کامل هر بسته (بند ۳) و پنل «نمایش گرافیکی
          بسته‌بندی» با کارت‌های آزاد ۳٫۱۳ (۳٫۱۶: هم‌اندازهٔ محتوا،
          عرض کامل پنل، «ظرفیت n از m» در سربرگ، بدون نوار رزرو) +
          تنظیمات برگهٔ خروجی: جهت صفحه و تعداد ستون (۳٫۱۸ بند ۳)

   هر چهار جدول بلند: پنل‌های «ترتیب ستون‌ها» و «مرتب‌سازی» +
   فیلتر زیر سرستون همهٔ ستون‌ها + ماندگاری «ردیف‌های قابل نمایش».
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const db = RM.db.db;
  const PK = RM.packaging;

  const PackagingView = {
    state: {
      tables: {           // فیلترهای هر جدول (جلسه‌ای) — visibleRows از cfg هر جدول
        plan: { filters: {} },
        pallets: { filters: {} },
        rolls: { filters: {} },
        graph: { filters: {} },   // ۳٫۱۵ بند ۳ — جدول «لیست بسته های قابل نمایش»
      },
      /* ۳٫۱۴ بند ۷: انتخاب گراف به‌صورت «ترتیب نمایش» (آرایه) + حذفیات پالت */
      graphOrder: [],      // شمارهٔ بسته‌های انتخاب‌شده به ترتیب نمایش (ماندگار)
      graphRemoved: {},    // { [بسته]: [شماره پالت‌های حذف‌شده از نمایش] } (ماندگار)
      /* ۳٫۱۵ بند ۳ — ویرایش‌های نمایشی هر بسته (مودال ویرایش — ماندگار):
         spec:        { [بسته]: { filmType, width, thickness, grade, computedType } } (override نمایشی)
         rollRemoved: { [بسته]: [شماره رول‌های حذف‌شده از نمایش] }
         rollAdded:   { [بسته]: { [پالت]: [شماره رول‌های دستی‌افزوده] } }
         palletAdded: { [بسته]: [{ palletNo, rolls: [] }] } — پالت دستی حتی خارج از دیتای اصلی */
      graphEdits: { spec: {}, rollRemoved: {}, rollAdded: {}, palletAdded: {} },
      graphOrient: 'portrait', // جهت برگهٔ خروجی: 'portrait' | 'landscape' (ماندگار — ۳٫۱۸ بند ۳)
      graphCols: 2,            // تعداد ستون کارت‌ها در برگهٔ خروجی (ماندگار — ۳٫۱۸ بند ۳)
      separateExport: true, // تفکیک پالت‌های صادراتی (ماندگار — بند ۵)
    },
    ctls: {},             // کنترل جدول‌ها: { plan, pallets, rolls, graph }
    _records: null,
    _plan: null,
    _dragNo: null,        // بستهٔ در حال درگ در جدول لیست (۳٫۱۵ بند ۳)
  };

  /* ================================================================
     ۰) ثابت‌های نمایش گرافیکی
     ================================================================ */

  /** پالت رنگ‌های تفکیکی کارت‌ها (۳٫۱۳ — بازگشت در ۳٫۱۵ بند ۱: چرخشی،
      بدون آبی/نیلی؛ هر کارت رنگ متفاوت بر اساس موقعیت در ترتیب نمایش) */
  const GRAPH_COLORS = [
    '#047857', '#b45309', '#be123c', '#0d9488', '#ea580c',
    '#15803d', '#a16207', '#9333ea', '#db2777', '#65a30d',
    '#c2410c', '#0f766e', '#b91c1c', '#7e22ce', '#4d7c0f',
  ];

  /** ۳٫۱۸ بند ۳ — تنظیمات برگهٔ خروجی نمایش گرافیکی: «جهت صفحه»
      (عمودی/افقی) + «تعداد ستون» (عدد آزاد کاربر) — جایگزین «بسته در صفحه» */
  const GRAPH_COLS_MIN = 1;
  const GRAPH_COLS_MAX = 8;
  const GRAPH_COLS_DEFAULT = 2;

  /** ابعاد برگهٔ A4 در ۹۶dpi و پارامترهای چیدمان استیج خروجی (۳٫۱۸ بند ۳):
   *  کارت‌ها همیشه با «عرض طراحی استاندارد» رندر می‌شوند (GRAPH_CARD_W —
   *  همان عرض ستونِ چیدمان دوستونهٔ A4 عمودی)؛ اگر ستون‌های بیش از گنجایش
   *  برگه انتخاب شوند، در رندر نهایی کل برگه با حفظ کامل نسبت‌ها (فونت‌ها
   *  و کادرهای داخلی کارت) یکجا کوچک می‌شود — هرگز بزرگ‌نمایی نمی‌شود */
  const GRAPH_A4_W = 794;      // A4 عمودی — عرض (px در ۹۶dpi)
  const GRAPH_A4_H = 1123;     // A4 عمودی — ارتفاع
  const GRAPH_CARD_W = 367;    // عرض طراحی استاندارد کارت
  const GRAPH_GAP = 12;        // فاصلهٔ کارت‌ها در گرید (همان gap فعلی)
  const GRAPH_PAD_X = 24;      // حاشیهٔ افقی برگهٔ استیج (padding .pg-page)
  const GRAPH_PAD_Y = 20;      // حاشیهٔ عمودی برگهٔ استیج
  /* ۳٫۲۰ بند ۲ — چگالی رندر خروجی (PNG و PDF): ضریب ۳ یعنی برگهٔ A4 با
     ۲۸۸dpi معادل (۲۳۸۲×۳۳۷۰ برای عمودی) رندر می‌شود — متن‌ها و کادرها
     به‌مراتب واضح‌تر از ۲x؛ زمان رندر هر برگه اندازه‌گیری شد و در عتبهٔ
     قابل‌قبول (زیر ~۱٫۵ برابرِ حالت قبلی) باقی ماند، وگرنه به ۲.۵ یا ۲
     برمی‌گشت */
  const GRAPH_RENDER_X = 3;

  /** دو تم رنگی کارت‌ها، یک ردیف در میان (۳٫۱۷ بند ۳): هر «ردیف» از
      کارت‌ها (بر اساس ستون‌های واقعی گرید در لحظهٔ رندر) یکی از این دو
      تم را می‌گیرد — هر دو دقیقاً از میان همان پالت ۱۵رنگهٔ فعلی و با
      همان ویژگی‌های همیشگی (سربرگ کم‌رنگ + عنوان/ظرفیت پررنگ). تم‌ها:
      سبز زمردی (#047857 — GRAPH_COLORS[0]) و رز (#be123c — GRAPH_COLORS[2])
      ۳٫۱۸ بند ۲: تمِ کارت دیگر فقط همان دو رنگ تم است — کادر پالت‌ها و
      پس‌زمینهٔ آن‌ها و شمارهٔ ترتیب‌شان نیز از همین تمِ کارت رنگ می‌گیرند
      (rgba مستقیم در applyGraphAccents — سازگار با html2canvas) و هیچ
      رنگ دوم (نارنجی/سبز یک‌درمیان ۳٫۱۶) در کارت‌ها نیست. */
  const GRAPH_ROW_THEMES = ['#047857', '#be123c'];

  /** ۳٫۱۹ بند ۴ — آیکون مداد بولد و نمایان برای دکمهٔ ویرایش روی هر
   *  کارت (کنار ضربدر): مداد با قلم بولد (stroke ۲٫۵) که در همهٔ اندازه‌ها
   *  و هر دو تم تیز و خوانا می‌ماند (SVG درون‌خطی — سازگار با html2canvas) */
  const PG_PENCIL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
    + ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>'
    + '<path d="m15 5 4 4"></path></svg>';

  /** ذخیره/بازیابی موقعیت اسکرول جدول برنامه (۳٫۱۴ بند ۲): پس از هر
      بازسازی جدول، موقعیت قبلی (کانتینر جدول + پنجره) بازیابی می‌شود. */
  function snapshotScroll(wrap) {
    const ts = wrap ? wrap.querySelector('.cut-table-scroll') : null;
    return {
      t: ts ? ts.scrollTop : 0,
      l: ts ? ts.scrollLeft : 0,
      w: window.scrollY,
    };
  }
  function restoreScroll(wrap, snap) {
    const ts = wrap ? wrap.querySelector('.cut-table-scroll') : null;
    if (ts) { ts.scrollTop = snap.t; ts.scrollLeft = snap.l; }
    if (snap.w) window.scrollTo(window.scrollX, snap.w);
  }

  /* ================================================================
     ۰-ب) کمکی‌های بسته‌های ترکیبی U+X (۳٫۱۷ — بند ۶)
     ================================================================ */

  /** گرید نرمال‌شده (X/U/Q...) برای رنگ‌بندی و منطق */
  function gradeKeyOf(v) {
    return String(v ?? '').trim().toUpperCase();
  }

  /** برچسب گرید بسته برای ستون/چیپ: ترکیبی = «U + X» */
  function gradeLabelOf(pkg) {
    if (pkg.mixedGrid && Array.isArray(pkg.mixedGrades) && pkg.mixedGrades.length > 1) {
      return pkg.mixedGrades.join(' + ');
    }
    return pkg.grade || '';
  }

  /** ستون «گرید» بسته‌های ترکیبی (۳٫۱۷ بند ۶؛ ۳٫۱۸ بند ۱ بازنویسی شد):
   *  فقط گرید رول‌ها در «یک ستون» — هم‌ساختار و هم‌ترازِ کامل ستون
   *  «رول‌ها» (شمارهٔ پالت در رأس هر گروه + گرید هر رول زیر هم) تا گرید
   *  هر رول دقیقاً روبه‌روی شمارهٔ همان رول در ستون رول‌ها بنشیند؛ گرید
   *  پالت دیگر درج نمی‌شود. مقادیر فقط بولد و بدون کادر رنگی‌اند (کدهای
   *  رنگی گرید فقط در خروجی اکسل حفظ شده‌اند). pt.rolls در جدول برنامه
   *  رول‌ایجکت (r.pallet.grade) و در جدول لیست بسته‌ها {roll, grade} است
   *  — هر دو پشتیبانی می‌شود. */
  function mixedGradeListHtml(palletParts) {
    return '<div class="pk-rolls-list pk-grade-list">' + palletParts.map((pt, i) => {
      const rollGradeOf = (r) => gradeKeyOf(r.pallet ? r.pallet.grade : r.grade);
      return `<div class="pk-rolls-group" title="پالت ${i + 1}: ${U.escapeHtml(pt.palletNo)} — گرید رول‌های همین پالت، هم‌تراز ستون رول‌ها">` +
        `<span class="pk-pal-idx">${i + 1}.</span>` +
        '<span class="pk-rolls-col">' +
        pt.rolls.map((r) => `<span class="pk-roll pk-grade-txt">${U.escapeHtml(rollGradeOf(r) || '—')}</span>`).join('') +
        '</span></div>';
    }).join('') + '</div>';
  }

  /* ================================================================
     ۱) رجیستری ستون‌ها + پیکربندی ماندگار هر جدول (بند ۶)
     ================================================================
     الگوی گزارش ستاپ‌ها: هر جدول یک «کنترل» دارد با
       order   — ترتیب ستون‌ها (کشیدنی)
       widths  — عرض ستون‌ها (px)
       hidden  — ستون‌های مخفی (چشم)
       sort    — خط لولهٔ مرتب‌سازی چندمرحله‌ای
       sortVisible / colsVisible — باز/بسته بودن پنل‌ها
       visibleRows — «ردیف‌های قابل نمایش» (بند ۱ — ماندگار)
     همه در یک appSettings ذخیره می‌شود (packPlanCfg / packPalletsCfg / packRollsCfg). */

  const TABLE_DEFS = {
    plan: {
      settingKey: 'packPlanCfg',
      defaults: {
        order: ['no', 'pallets', 'rollsList', 'filmType', 'width', 'thickness', 'grade',
          'diameter', 'computedType', 'capacity', 'pkgType', 'reserve', 'moves', 'actions'],
        widths: {
          no: 52, pallets: 172, rollsList: 198, filmType: 92, width: 76, thickness: 80,
          grade: 70, diameter: 62, computedType: 104, capacity: 112, pkgType: 112,
          reserve: 84, moves: 88, actions: 178,
        },
        hidden: [],
        sort: [{ field: 'no', direction: 'asc' }],
        visibleRows: 50,
      },
      fields: {
        no:            { label: 'شمارهٔ بسته', numeric: true, valueOf: (p) => p.no },
        mainPalletNo:  { label: 'پالت اصلی', valueOf: (p) => p.mainPalletNo },
        palletCount:   { label: 'تعداد پالت بسته', numeric: true, valueOf: (p) => p.palletParts.length },
        rollCount:     { label: 'تعداد رول بسته', numeric: true, valueOf: (p) => p.finalCount },
        filmType:      { label: 'فیلم', valueOf: (p) => p.filmType },
        width:         { label: 'عرض', numeric: true, valueOf: (p) => p.width },
        thickness:     { label: 'ضخامت', numeric: true, valueOf: (p) => p.thickness },
        grade:         { label: 'گرید', valueOf: (p) => p.grade },
        diameter:      { label: 'قطر', numeric: true, valueOf: (p) => p.diameter },
        computedType:  { label: 'نوع بسته‌بندی', valueOf: (p) => p.computedType },
        finalCount:    { label: 'ظرفیت فعلی', numeric: true, valueOf: (p) => p.finalCount },
        stdCapacity:   { label: 'ظرفیت استاندارد', numeric: true, valueOf: (p) => p.stdCapacity },
        target:        { label: 'ظرفیت هدف', numeric: true, valueOf: (p) => p.target },
        pkgType:       { label: 'نوع بسته', valueOf: (p) => PK.PACKAGE_TYPE_LABELS[p.type] || p.type },
        mixed:         { label: 'ترکیبی', valueOf: (p) => (p.mixedGrid ? 'ترکیبی U+X' : 'عادی') },   // ۳٫۱۷ بند ۶
        reserveCount:  { label: 'تعداد رزرو', numeric: true, valueOf: (p) => p.reserveRolls.length },
        moves:         { label: 'جابه‌جایی', numeric: true, valueOf: (p) => p.moves },
      },
    },
    pallets: {
      settingKey: 'packPalletsCfg',
      defaults: {
        order: ['palletNo', 'palletId', 'filmType', 'line', 'width', 'thickness', 'grade',
          'diameter', 'packTypeExcel', 'computedType', 'rollCount', 'stdCapacity',
          'palletStatus', 'planState', 'warehouse', 'productionDate', 'actions'],
        widths: {
          palletNo: 140, palletId: 78, filmType: 90, line: 70, width: 74, thickness: 78,
          grade: 66, diameter: 62, packTypeExcel: 88, computedType: 94, rollCount: 70,
          stdCapacity: 92, palletStatus: 102, planState: 208, warehouse: 150,
          productionDate: 120, actions: 100,
        },
        hidden: [],
        sort: [{ field: 'palletNo', direction: 'asc' }],
        visibleRows: 50,
      },
      fields: {
        palletNo:       { label: 'شماره پالت', valueOf: (p) => p.palletNo },
        palletId:       { label: 'شناسه', valueOf: (p) => p.palletId },
        filmType:       { label: 'نوع فیلم', valueOf: (p) => p.filmType },
        line:           { label: 'خط تولید', valueOf: (p) => p.line },
        width:          { label: 'عرض', numeric: true, valueOf: (p) => p.width },
        thickness:      { label: 'ضخامت', numeric: true, valueOf: (p) => p.thickness },
        grade:          { label: 'گرید', valueOf: (p) => p.grade },
        diameter:       { label: 'قطر', numeric: true, valueOf: (p) => p.diameter },
        packTypeExcel:  { label: 'نوع اکسل', valueOf: (p) => p.packTypeExcel },
        computedType:   { label: 'نوع محاسبه‌شده', valueOf: (p) => p.computedType },
        rollCount:      { label: 'تعداد رول', numeric: true, valueOf: (p) => p.rollCount },
        stdCapacity:    { label: 'ظرفیت استاندارد', numeric: true, valueOf: (p) => p.stdCapacity },
        palletStatus:   { label: 'وضعیت پالت', valueOf: (p) => PK.PALLET_STATUS_LABELS[p.palletStatus] || p.palletStatus },
        planState:      { label: 'وضعیت در برنامه', valueOf: (p) => PK.PLAN_STATE_LABELS[p.planState] || p.planState },
        warehouse:      { label: 'انبار', valueOf: (p) => p.warehouse },
        productionDate: { label: 'تاریخ تولید', valueOf: (p) => p.record.productionDate },
      },
    },
    rolls: {
      settingKey: 'packRollsCfg',
      defaults: {
        order: ['roll', 'origin', 'filmType', 'width', 'thickness', 'grade', 'diameter',
          'packageNo', 'role', 'move', 'status'],
        widths: {
          roll: 158, origin: 140, filmType: 90, width: 72, thickness: 78, grade: 66,
          diameter: 60, packageNo: 70, role: 84, move: 148, status: 208,
        },
        hidden: [],
        sort: [{ field: 'origin', direction: 'asc' }, { field: 'roll', direction: 'asc' }],
        visibleRows: 50,
      },
      fields: {
        roll:        { label: 'شماره رول', valueOf: (r) => r.roll },
        origin:      { label: 'پالت مبدأ', valueOf: (r) => r.pallet.palletNo },
        filmType:    { label: 'نوع فیلم', valueOf: (r) => r.pallet.filmType },
        width:       { label: 'عرض', numeric: true, valueOf: (r) => r.pallet.width },
        thickness:   { label: 'ضخامت', numeric: true, valueOf: (r) => r.pallet.thickness },
        grade:       { label: 'گرید', valueOf: (r) => r.pallet.grade },
        diameter:    { label: 'قطر', numeric: true, valueOf: (r) => r.pallet.diameter },
        packageNo:   { label: 'بسته', numeric: true, valueOf: (r) => r.packageNo },
        role:        { label: 'نقش', valueOf: (r) => (r.role === 'main' ? 'اصلی' : r.role === 'complement' ? 'مکمل' : null) },
        move:        { label: 'انتقال', valueOf: (r) => r.movedToPalletNo },
        status:      { label: 'وضعیت نهایی', valueOf: (r) => PK.ROLL_STATUS_LABELS[r.status] || r.status },
      },
    },
    /* ۳٫۱۵ بند ۳ — جدول «لیست بسته های قابل نمایش» (نمایش گرافیکی):
       همان زیرساخت کامل سایر جدول‌ها: فیلتر ستونی + «ردیف‌های قابل نمایش»
       ماندگار + پنل‌های ترتیب ستون‌ها/مرتب‌سازی + درگ ردیف برای ترتیب نمایش */
    graph: {
      settingKey: 'packGraphCfg',
      defaults: {
        order: ['displayIdx', 'no', 'filmType', 'width', 'thickness', 'grade',
          'computedType', 'cap', 'pallets', 'rollsList', 'reserve', 'actions'],
        widths: {
          displayIdx: 92, no: 56, filmType: 88, width: 70, thickness: 76,
          grade: 64, computedType: 96, cap: 100, pallets: 150, rollsList: 190,
          reserve: 64, actions: 118,
        },
        hidden: [],
        sort: [{ field: 'displayIdx', direction: 'asc' }],
        visibleRows: 50,
      },
      fields: {
        displayIdx:  { label: 'ترتیب نمایش', numeric: true, valueOf: (r) => r.displayIdx },
        no:          { label: 'شمارهٔ بسته', numeric: true, valueOf: (r) => r.pkg.no },
        filmType:    { label: 'فیلم', valueOf: (r) => r.spec.filmType },
        width:       { label: 'عرض', numeric: true, valueOf: (r) => r.spec.width },
        thickness:   { label: 'ضخامت', numeric: true, valueOf: (r) => r.spec.thickness },
        grade:       { label: 'گرید', valueOf: (r) => r.spec.grade },
        computedType:{ label: 'بسته بندی', valueOf: (r) => r.spec.computedType },
        palletCount: { label: 'تعداد پالت نمایش', numeric: true, valueOf: (r) => r.parts.length },
        rollCount:   { label: 'تعداد رول نمایش', numeric: true, valueOf: (r) => r.parts.reduce((s, pt) => s + pt.rolls.length, 0) },
        stdCapacity: { label: 'ظرفیت استاندارد', numeric: true, valueOf: (r) => r.pkg.stdCapacity },
        reserveCount:{ label: 'تعداد رزرو', numeric: true, valueOf: (r) => r.pkg.reserveRolls.length },
      },
    },
  };

  /** مقایسه‌گر عمومی (عددی/متنی — تهی‌ها آخر) برای مرتب‌سازی چندمرحله‌ای */
  function cmpByField(meta, a, b, direction) {
    const va = meta.valueOf(a);
    const vb = meta.valueOf(b);
    let r;
    if (meta.numeric) {
      r = U.compareNumeric(va, vb, 'asc');
    } else {
      const sa = (va === null || va === undefined || va === '') ? null : String(va);
      const sb = (vb === null || vb === undefined || vb === '') ? null : String(vb);
      if (sa === null && sb === null) r = 0;
      else if (sa === null) r = 1;
      else if (sb === null) r = -1;
      else r = sa.localeCompare(sb, 'fa', { numeric: true });
    }
    return direction === 'desc' ? -r : r;
  }

  /** ساخت کنترل یک جدول (بارگذاری ماندگار + مرتب‌سازی + ستون‌ها) */
  function makeTableCtl(name) {
    const def = TABLE_DEFS[name];
    const ctl = {
      name,
      def,
      cfg: null,

      async load() {
        const saved = (await RM.db.getSetting(def.settingKey, null)) || {};
        const cfg = {
          order: Array.isArray(saved.order) && saved.order.length ? [...saved.order] : [...def.defaults.order],
          widths: Object.assign({}, def.defaults.widths, saved.widths || {}),
          hidden: Array.isArray(saved.hidden) ? [...saved.hidden] : [...def.defaults.hidden],
          sort: Array.isArray(saved.sort) && saved.sort.length
            ? saved.sort.map((s) => ({ field: s.field, direction: s.direction === 'desc' ? 'desc' : 'asc' }))
            : JSON.parse(JSON.stringify(def.defaults.sort)),
          sortVisible: saved.sortVisible !== false,
          colsVisible: saved.colsVisible !== false,
          visibleRows: Number(saved.visibleRows) > 0 ? Number(saved.visibleRows) : def.defaults.visibleRows,
        };
        /* مهاجرت نرم: کلیدهای جدیدِ ترتیب پیش‌فرض که در ذخیرهٔ قدیمی نیستند،
           بعد از ستونِ قبلیِ خود در ترتیب پیش‌فرض درج می‌شوند */
        const missing = def.defaults.order.filter((k) => !cfg.order.includes(k));
        for (const key of missing) {
          const prev = def.defaults.order[def.defaults.order.indexOf(key) - 1];
          const at = prev ? cfg.order.indexOf(prev) : -1;
          if (at !== -1) cfg.order.splice(at + 1, 0, key);
          else cfg.order.push(key);
        }
        ctl.cfg = cfg;
      },

      async save() {
        await RM.db.setSetting(def.settingKey, ctl.cfg);
      },

      /** اعمال عرض‌های ماندگار روی رجیستری ستون‌ها (0/خالی = خودکار) */
      applyWidths(registry) {
        for (const col of Object.values(registry)) {
          const w = Number(ctl.cfg.widths[col.key]);
          col.width = Number.isFinite(w) && w > 0 ? w : undefined;
        }
      },

      /** ستون‌های قابل نمایش به ترتیب کاربر (بدون مخفی‌شده‌ها) */
      visibleColumns(registry) {
        const hiddenSet = new Set(ctl.cfg.hidden);
        return ctl.cfg.order
          .map((k) => registry[k])
          .filter(Boolean)
          .filter((c) => !hiddenSet.has(c.key));
      },

      /** مرتب‌سازی چندمرحله‌ای (از آخرین اولویت به اولین — پایدار) */
      applySort(rows) {
        const pipeline = (ctl.cfg.sort && ctl.cfg.sort.length)
          ? ctl.cfg.sort
          : def.defaults.sort;
        const sorted = [...rows];
        for (let i = pipeline.length - 1; i >= 0; i--) {
          const { field, direction } = pipeline[i];
          const meta = def.fields[field];
          if (!meta) continue;
          sorted.sort((a, b) => cmpByField(meta, a, b, direction));
        }
        return sorted;
      },
    };
    return ctl;
  }

  /** همسان‌سازی منطق فیلتر با UI.filterTable (برای خروجی اکسل — بند ۱۱) */
  PackagingView.filterRows = function (rows, columns, state) {
    const filterable = columns.filter((c) => c.filterable !== false);
    return rows.filter((row) => filterable.every((c) => {
      const f = UI.filterStateOf(state, c.key);
      if (String(f.value ?? '').trim() === '') return true;
      return UI.filterContains(
        c.tokens ? c.tokens(row) : [String(row[c.key] ?? '')],
        f.value, f.invert
      );
    }));
  };

  /* ================================================================
     ۲) راه‌اندازی
     ================================================================ */

  PackagingView.init = async function () {
    /* --- بارگذاری پیکربندی ماندگار هر سه جدول (بند ۱ و ۶) --- */
    for (const name of Object.keys(TABLE_DEFS)) {
      PackagingView.ctls[name] = makeTableCtl(name);
      await PackagingView.ctls[name].load();
    }

    /* --- انتخاب ماندگار نمایش گرافیکی (۳٫۱۴ بند ۷: ترتیب + حذفیات پالت) ---
       مهاجرت نرم: انتخاب قدیمی (packGraphSelection از ۳٫۱۳) به ترتیب
       صعودی به «ترتیب نمایش» جدید تبدیل می‌شود. */
    const savedOrder = await RM.db.getSetting('packGraphOrder', null);
    if (Array.isArray(savedOrder) && savedOrder.length) {
      PackagingView.state.graphOrder = savedOrder.map(Number).filter(Number.isFinite);
    } else {
      const legacy = (await RM.db.getSetting('packGraphSelection', null)) || [];
      PackagingView.state.graphOrder = (Array.isArray(legacy) ? legacy : [])
        .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    }
    const savedRemoved = await RM.db.getSetting('packGraphRemoved', null);
    if (savedRemoved && typeof savedRemoved === 'object' && !Array.isArray(savedRemoved)) {
      const clean = {};
      for (const k of Object.keys(savedRemoved)) {
        const v = savedRemoved[k];
        const no = Number(k);
        if (Number.isFinite(no) && Array.isArray(v) && v.length) clean[no] = [...v];
      }
      PackagingView.state.graphRemoved = clean;
    }
    /* --- جهت صفحه + تعداد ستون برگهٔ خروجی (۳٫۱۸ بند ۳ — ماندگار) --- */
    const savedOrient = await RM.db.getSetting('packGraphOrient', null);
    PackagingView.state.graphOrient = savedOrient === 'landscape' ? 'landscape' : 'portrait';
    const savedCols = Number(await RM.db.getSetting('packGraphCols', 0));
    PackagingView.state.graphCols = Number.isFinite(savedCols)
      && savedCols >= GRAPH_COLS_MIN && savedCols <= GRAPH_COLS_MAX
      ? Math.round(savedCols) : GRAPH_COLS_DEFAULT;

    const orientSeg = document.getElementById('pack-graph-orient');
    if (orientSeg) {
      const syncOrientUi = () => {
        orientSeg.querySelectorAll('.seg-btn').forEach((b) => {
          const active = b.dataset.orient === PackagingView.state.graphOrient;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        });
      };
      syncOrientUi();
      orientSeg.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const v = btn.dataset.orient === 'landscape' ? 'landscape' : 'portrait';
          if (v === PackagingView.state.graphOrient) return;
          PackagingView.state.graphOrient = v;
          await RM.db.setSetting('packGraphOrient', v);
          syncOrientUi();
          UI.toast(`جهت برگهٔ خروجی «${v === 'landscape' ? 'افقی' : 'عمودی'}» شد — کارت‌ها هرگز در میانهٔ برگه نمی‌شکنند و مقیاسشان فقط در صورت نیاز کوچک می‌شود.`, 'info');
        });
      });
    }
    const colsInput = document.getElementById('pack-graph-cols');
    if (colsInput) {
      colsInput.value = String(PackagingView.state.graphCols);
      const applyCols = async () => {
        const v = Math.round(Number(colsInput.value));
        if (!Number.isFinite(v) || v < GRAPH_COLS_MIN || v > GRAPH_COLS_MAX) {
          colsInput.value = String(PackagingView.state.graphCols);
          UI.toast(`عدد «تعداد ستون» باید بین ${U.faNum(GRAPH_COLS_MIN)} و ${U.faNum(GRAPH_COLS_MAX)} باشد.`, 'warning');
          return;
        }
        if (v === PackagingView.state.graphCols) return;
        PackagingView.state.graphCols = v;
        await RM.db.setSetting('packGraphCols', v);
        UI.toast(`تعداد ستون کارت‌های برگهٔ خروجی به ${U.faNum(v)} تغییر کرد — در صورت نیاز، کل مقیاس صفحه با حفظ نسبت‌ها یکجا کوچک می‌شود.`, 'info');
      };
      colsInput.addEventListener('change', applyCols);
      colsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCols(); } });
    }

    /* --- ویرایش‌های نمایشی هر بسته (۳٫۱۵ بند ۳ — مودال ویرایش، ماندگار) --- */
    const savedEdits = await RM.db.getSetting('packGraphEdits', null);
    if (savedEdits && typeof savedEdits === 'object' && !Array.isArray(savedEdits)) {
      const e = savedEdits;
      const cleanObj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
      PackagingView.state.graphEdits = {
        spec: cleanObj(e.spec),
        rollRemoved: cleanObj(e.rollRemoved),
        rollAdded: cleanObj(e.rollAdded),
        palletAdded: cleanObj(e.palletAdded),
      };
    }

    /* --- آپشن تفکیک پالت‌های صادراتی (۳٫۱۴ بند ۵ — ماندگار) ---
       ۳٫۱۷ بند ۱: دکمه اکنون مانند یک کلید برقی عمل می‌کند — سوییچ کوچک
       داخل دکمه با فعال بودن روشن (سبز + چرخ‌به‌راست) و با غیرفعال بودن
       خاموش است و برچسب وضعیت (روشن/خاموش) هم به‌روز می‌شود. */
    const savedSep = await RM.db.getSetting('packSeparateExport', null);
    PackagingView.state.separateExport = savedSep === null ? true : !!savedSep;
    const expBtn = document.getElementById('pack-export-toggle');
    if (expBtn) {
      const syncExpBtn = () => {
        const on = PackagingView.state.separateExport;
        expBtn.classList.toggle('panel-on', on);
        expBtn.setAttribute('aria-pressed', String(on));
        const stateEl = expBtn.querySelector('.exp-state');
        if (stateEl) stateEl.textContent = on ? 'روشن' : 'خاموش';
        expBtn.title = on
          ? 'فعال (روشن): پالت‌های صادراتی (شمارهٔ پالت منتهی به E مانند FFG07013059E) فقط با پالت‌های صادراتی دیگر بسته‌بندی می‌شوند — برای ترکیب با معمولی‌ها کلیک کنید'
          : 'غیرفعال (خاموش): پالت‌های صادراتی با پالت‌های معمولی هم بسته‌بندی می‌شوند — برای تفکیک صادراتی‌ها کلیک کنید';
      };
      syncExpBtn();
      expBtn.addEventListener('click', async () => {
        PackagingView.state.separateExport = !PackagingView.state.separateExport;
        await RM.db.setSetting('packSeparateExport', PackagingView.state.separateExport);
        syncExpBtn();
        PackagingView.renderFromCache();
        const s = PackagingView._plan && PackagingView._plan.stats;
        if (PackagingView.state.separateExport && s) {
          UI.toast(`تفکیک صادراتی‌ها «روشن» شد — ${U.faNum(s.exportPalletsInScope)} پالت صادراتی در برنامه (${U.faNum(s.exportGroups)} گروه صادراتی جدا).`, 'info', 5500);
        } else if (!PackagingView.state.separateExport) {
          UI.toast('تفکیک صادراتی‌ها «خاموش» شد — صادراتی‌ها با معمولی‌ها بسته‌بندی می‌شوند.', 'info');
        }
      });
    }

    /* --- کارت Import فایل پالت‌ها (الگوی مشترک ورود داده‌ها) --- */
    const dropzone = document.getElementById('drop-pallets');
    const input = document.getElementById('file-pallets');
    if (dropzone && input) {
      dropzone.addEventListener('click', () => input.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          PackagingView.handleFile(input.files[0]);
          input.value = '';
        }
      });
      ['dragenter', 'dragover'].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });
      dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) PackagingView.handleFile(file);
      });
    }

    /* --- زیرتب‌ها (محدود به همین صفحه — الگوی lists.js) ---
       ۳٫۱۷ بند ۳: با فعال‌شدن زیرتب «نمایش گرافیکی»، تم‌های ردیفی کارت‌ها
       دوباره اعمال می‌شوند (رندر در حالت مخفی، ستون‌های گرید را صفر می‌خواند). */
    document.querySelectorAll('#view-packaging .subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-packaging .subtab-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        const target = btn.dataset.pksubview;
        document.querySelectorAll('#view-packaging .subview').forEach((el) => {
          const active = el.id === `pksubview-${target}`;
          el.classList.toggle('active', active);
          el.hidden = !active;
        });
        if (target === 'graph') {
          requestAnimationFrame(() => {
            const grid = document.querySelector('#pack-graph-wrap .pg-grid');
            if (grid) PackagingView.applyGraphAccents(grid);
          });
        }
        PackagingView.syncSubnavTop();
      });
    });

    /* --- ۳٫۱۷ بند ۲: فریز نوار زیرتب‌های بسته‌بندی زیر نوار اصلی ---
       ارتفاع سربرگ چسبانِ برنامه اندازه‌گیری و در متغیر CSS --pk-subnav-top
       ثبت می‌شود؛ نوار زیرتب‌ها با position: sticky دقیقاً زیر نوار اصلی
       فریز می‌شود و با بازگشت به موقعیت اصلی، به‌طور طبیعی رها می‌شود. */
    PackagingView.syncSubnavTop = function () {
      const header = document.querySelector('.app-header');
      if (!header) return;
      const h = Math.round(header.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--pk-subnav-top', `${h}px`);
      }
    };
    PackagingView.syncSubnavTop();
    let subnavResizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(subnavResizeTimer);
      subnavResizeTimer = setTimeout(() => {
        PackagingView.syncSubnavTop();
        const grid = document.querySelector('#pack-graph-wrap .pg-grid');
        if (grid) PackagingView.applyGraphAccents(grid);   // ۳٫۱۷ بند ۳ — ستون‌ها عوض شد
      }, 160);
    });
    window.addEventListener('load', () => PackagingView.syncSubnavTop());

    /* --- پنل‌های مرتب‌سازی/ترتیب ستون‌های هر سه جدول (بند ۶ — الگوی ستاپ‌ها) --- */
    for (const name of Object.keys(TABLE_DEFS)) {
      const ctl = PackagingView.ctls[name];

      const addSelect = document.getElementById(`pack-${name}-sort-add-select`);
      if (addSelect) {
        addSelect.innerHTML = '<option value="">افزودن فیلد…</option>' +
          Object.entries(TABLE_DEFS[name].fields)
            .map(([k, v]) => `<option value="${k}">${U.escapeHtml(v.label)}</option>`)
            .join('');
      }
      const addBtn = document.getElementById(`pack-${name}-sort-add-btn`);
      if (addBtn) addBtn.addEventListener('click', () => {
        const field = addSelect ? addSelect.value : '';
        if (!field) return;
        if (ctl.cfg.sort.some((s) => s.field === field)) {
          UI.toast('این فیلد قبلاً به مرتب‌سازی اضافه شده است.', 'info');
          return;
        }
        ctl.cfg.sort.push({ field, direction: 'asc' });
        ctl.save().then(() => PackagingView.rerenderTable(name));
      });
      const sortReset = document.getElementById(`pack-${name}-sort-reset-btn`);
      if (sortReset) sortReset.addEventListener('click', () => {
        ctl.cfg.sort = JSON.parse(JSON.stringify(TABLE_DEFS[name].defaults.sort));
        ctl.save().then(() => PackagingView.rerenderTable(name));
        UI.toast('مرتب‌سازی این جدول به حالت پیش‌فرض بازگشت.', 'info');
      });
      const colsReset = document.getElementById(`pack-${name}-cols-reset-btn`);
      if (colsReset) colsReset.addEventListener('click', () => {
        ctl.cfg.order = [...TABLE_DEFS[name].defaults.order];
        ctl.cfg.widths = { ...TABLE_DEFS[name].defaults.widths };
        ctl.cfg.hidden = [...TABLE_DEFS[name].defaults.hidden];
        ctl.save().then(() => PackagingView.rerenderTable(name));
        UI.toast('ترتیب، عرض و نمایش ستون‌های این جدول به حالت پیش‌فرض بازگشت.', 'info');
      });
    }

    /* --- دکمهٔ «خروجی اکسل» بالای جدول برنامه (بند ۱۱) --- */
    const excelBtn = document.getElementById('pack-excel-btn');
    if (excelBtn) excelBtn.addEventListener('click', () => PackagingView.exportPlanExcel());

    /* --- دکمه‌های نمایش گرافیکی (۳٫۱۴ — حذف همه از روی ترتیب) --- */
    const graphClear = document.getElementById('pack-graph-clear');
    if (graphClear) graphClear.addEventListener('click', () => {
      PackagingView.state.graphOrder = [];
      PackagingView.state.graphRemoved = {};
      PackagingView.state.graphEdits = { spec: {}, rollRemoved: {}, rollAdded: {}, palletAdded: {} };
      PackagingView.saveGraphPlan();
      PackagingView.renderGraphView(PackagingView._plan);
      PackagingView.renderPlanTable(PackagingView._plan);
      UI.toast('همهٔ بسته‌ها از نمایش گرافیکی حذف شدند.', 'info');
    });
    const graphPng = document.getElementById('pack-graph-png');
    if (graphPng) graphPng.addEventListener('click', () => PackagingView.exportGraphImage());
    const graphPdf = document.getElementById('pack-graph-pdf');
    if (graphPdf) graphPdf.addEventListener('click', () => PackagingView.exportGraphPdf());
  };

  /** هوک نمایش تب بسته‌بندی (۳٫۱۷): بازاندازه‌گیری ارتفاع نوار اصلی برای
   *  فریز زیرتب‌ها (بند ۲) + اعمال مجدد تم‌های ردیفی کارت‌ها در صورت
   *  فعال بودن زیرتب گراف (بند ۳ — رندر در حالت مخفی ستون‌ها را نمی‌داند). */
  PackagingView.onShown = function () {
    PackagingView.syncSubnavTop();
    requestAnimationFrame(() => {
      PackagingView.syncSubnavTop();
      const grid = document.querySelector('#pack-graph-wrap .pg-grid');
      if (grid) PackagingView.applyGraphAccents(grid);
    });
  };

  /** بازسازی کامل یک جدول + پنل‌های آن (پس از تغییر ترتیب/مرتب‌سازی/عرض) */
  PackagingView.rerenderTable = function (name) {
    const plan = PackagingView._plan;
    if (!plan) return;
    if (name === 'plan') PackagingView.renderPlanTable(plan);
    else if (name === 'pallets') PackagingView.renderPalletsTable(plan);
    else if (name === 'rolls') PackagingView.renderRollsTable(plan);
    else if (name === 'graph') PackagingView.renderGraphView(plan);
  };

  /** نمایش/مخفی پنل‌های سازندهٔ یک جدول بر اساس cfg */
  PackagingView.applyPanelsFor = function (name) {
    const ctl = PackagingView.ctls[name];
    if (!ctl || !ctl.cfg) return;
    const sortBuilder = document.getElementById(`pack-${name}-sort-builder`);
    if (sortBuilder) sortBuilder.hidden = !ctl.cfg.sortVisible;
    const colsBuilder = document.getElementById(`pack-${name}-cols-builder`);
    if (colsBuilder) colsBuilder.hidden = !ctl.cfg.colsVisible;
  };

  /** رندر پنل مرتب‌سازی یک جدول (چیپ‌های کشیدنی) */
  PackagingView.renderSortBuilderFor = function (name) {
    const ctl = PackagingView.ctls[name];
    const wrap = document.getElementById(`pack-${name}-sort-pipeline`);
    if (!ctl || !ctl.cfg || !wrap) return;
    UI.sortPanel(wrap, ctl.cfg.sort, TABLE_DEFS[name].fields, {
      onDir: (i) => {
        ctl.cfg.sort[i].direction = ctl.cfg.sort[i].direction === 'asc' ? 'desc' : 'asc';
        ctl.save().then(() => PackagingView.rerenderTable(name));
      },
      onRemove: (i) => {
        ctl.cfg.sort.splice(i, 1);
        ctl.save().then(() => PackagingView.rerenderTable(name));
      },
      onReorder: (from, to) => {
        const [moved] = ctl.cfg.sort.splice(from, 1);
        ctl.cfg.sort.splice(to, 0, moved);
        ctl.save().then(() => PackagingView.rerenderTable(name));
      },
      emptyText: 'مرتب‌سازی پیش‌فرض',
    });
  };

  /** رندر پنل ترتیب ستون‌های یک جدول (کشیدن + عرض + چشم) */
  PackagingView.renderColsBuilderFor = function (name, registry) {
    const ctl = PackagingView.ctls[name];
    const wrap = document.getElementById(`pack-${name}-cols-pipeline`);
    if (!ctl || !ctl.cfg || !wrap) return;
    const all = registry || {};
    const items = ctl.cfg.order
      .map((key) => all[key])
      .filter(Boolean)
      .map((c) => ({ key: c.key, label: c.label, width: ctl.cfg.widths[c.key] ?? 0, hidden: ctl.cfg.hidden.includes(c.key) }));

    UI.orderPanel(wrap, items, {
      onMove: async (from, to) => {
        const [moved] = ctl.cfg.order.splice(from, 1);
        ctl.cfg.order.splice(to, 0, moved);
        await ctl.save();
        PackagingView.rerenderTable(name);
      },
      onWidth: async (key, w) => {
        ctl.cfg.widths[key] = w;
        await ctl.save();
        PackagingView.rerenderTable(name);
      },
      onToggle: async (key, hidden) => {
        const set = new Set(ctl.cfg.hidden);
        if (hidden) set.add(key);
        else set.delete(key);
        ctl.cfg.hidden = [...set];
        await ctl.save();
        PackagingView.rerenderTable(name);
        UI.toast(hidden
          ? `ستون «${U.escapeHtml((all[key] || {}).label || key)}» در جدول مخفی شد — از پنل ترتیب ستون‌ها (چشم) دوباره نمایش داده می‌شود.`
          : `ستون «${U.escapeHtml((all[key] || {}).label || key)}» دوباره نمایش داده شد.`, 'info');
      },
      emptyText: 'بدون ستون',
    });
  };

  /* ================================================================
     ۳) Import فایل مدیریت پالت‌ها
     ================================================================ */

  PackagingView.handleFile = async function (file) {
    const dropzone = document.getElementById('drop-pallets');
    dropzone.classList.add('loading');
    try {
      const result = await RM.importEngine.run('pallets', file, { confirm: UI.confirm });
      if (result.cancelled) {
        UI.toast('عملیات Import لغو شد؛ داده‌های قبلی دست‌نخورده باقی ماند.', 'info');
        return;
      }
      const { parsed, datasetVersion, sameFileWarning } = result;
      UI.toast(
        `فایل «${U.escapeHtml(parsed.fileName)}» وارد شد — ${U.faNum(parsed.totalRecords)} پالت ` +
        `(Dataset #${U.faNum(datasetVersion)})`,
        'success'
      );
      if (sameFileWarning) {
        UI.toast('محتوای فایل با آخرین Import یکسان بود (هش یکسان).', 'warning', 6000);
      }
      await RM.refreshAll();
    } catch (err) {
      console.error('[Packaging Import]', err.message);
      UI.toast(U.escapeHtml(err.message || 'خطای ناشناخته هنگام خواندن فایل.'), 'error', 7000);
      const statusEl = document.getElementById('status-pallets');
      if (statusEl) {
        statusEl.className = 'import-status err';
        statusEl.innerHTML = `<div class="status-row"><span class="status-icon err">${UI.icons.cross}</span>
          <b>${U.escapeHtml(err.message)}</b></div>`;
      }
    } finally {
      dropzone.classList.remove('loading');
    }
  };

  /** رندر کارت وضعیت Import (گزارشنمای اختصاصی پالت‌ها) */
  PackagingView.renderStatus = async function () {
    const statusEl = document.getElementById('status-pallets');
    if (!statusEl) return;

    const entries = await db.importMetadata
      .where('target').equals('pallets')
      .reverse()
      .sortBy('importedAt');
    const info = entries[0];

    if (!info) {
      statusEl.className = 'import-status';
      statusEl.innerHTML = '<p class="status-empty">هنوز فایلی بارگذاری نشده است.</p>';
      return;
    }

    const issues = info.issues || {};
    const nonM = issues.nonM || 0;
    /* ۳٫۱۴ بند ۴: ردیف‌های هشداریِ قابل دریل (پالت بدون شماره/رول/عرض)
       با کلیک، فهرست همان دسته از رکوردهای ذخیره‌شده نمایش داده می‌شود؛
       «بدون M» ذخیره نمی‌شود و فقط شمرده می‌شود → لینک نیست. */
    const row = (label, value, drill) => drill
      ? `<button type="button" class="status-row status-row-link" data-pack-issue="${drill}"
             title="نمایش پالت‌های این دسته از رکوردهای ذخیره‌شده"><span class="status-icon err">${UI.icons.warning}</span>${label}: <b class="num-warn">${U.faNum(value)}</b><span class="drill-hint">مشاهده ←</span></button>`
      : `<div class="status-row"><span class="status-icon ${value ? 'err' : 'ok'}">${value ? UI.icons.warning : UI.icons.check}</span>${label}: <span class="${value ? 'num-warn' : 'num'}">${U.faNum(value)}</span></div>`;

    const gaps = Array.isArray(info.mappingGaps) ? info.mappingGaps : [];
    const gapsHtml = gaps.length
      ? `<div class="status-row"><span class="status-icon err">${UI.icons.warning}</span>
           <span class="num-warn">Mapping ناقص:</span>
           ${gaps.map((g) => RM.config.FIELD_LABELS[g.field] || g.field).join('، ')} — ستون در فایل یافت نشد
         </div>`
      : '';

    statusEl.className = 'import-status ok';
    statusEl.innerHTML = `
      <div class="status-row">
        <span class="status-icon ok">${UI.icons.check}</span>
        <b>${U.escapeHtml(info.fileName)}</b>
        <span class="chip">${RM.config.DATASET_LABELS.pallets}</span>
        <span class="chip">Dataset #${U.faNum(info.datasetVersion)}</span>
        <span class="chip chip-ok">وضعیت: ${info.status === 'ok' ? 'موفق' : (info.status || '—')}</span>
        ${info.fileHash ? `<span class="chip" title="هش فایل">#${U.escapeHtml(info.fileHash)}</span>` : ''}
      </div>
      <div class="report-grid">
        ${row('کل ردیف‌های فایل', (info.totalRecords || 0) + nonM, false)}
        ${row('ردیف بدون M (فقط شمرده شد)', nonM, false)}
        ${row('پالت‌های ذخیره‌شده', info.totalRecords || 0, false)}
        ${(issues.palletNo || 0) > 0 ? row('پالت بدون شماره', issues.palletNo, 'palletNo') : ''}
        ${(issues.noRolls || 0) > 0 ? row('پالت بدون رول (خالی)', issues.noRolls, 'noRolls') : ''}
        ${(issues.noWidth || 0) > 0 ? row('پالت بدون عرض', issues.noWidth, 'noWidth') : ''}
      </div>
      ${gapsHtml}
      <div class="status-row muted">تاریخ: ${U.faDate(info.importedAt)} · شییت: ${U.escapeHtml(info.sheetName || '—')}</div>
    `;

    /* ۳٫۱۴ بند ۴: اتصال دریل ردیف‌های هشداری (قبلاً لینک بی‌اثر بود) */
    statusEl.querySelectorAll('[data-pack-issue]').forEach((btn) => {
      btn.addEventListener('click', () => PackagingView.showIssueDrill(btn.dataset.packIssue));
    });
  };

  /** دریل ردیف‌های هشداری کارت وضعیت (۳٫۱۴ بند ۴) — بازتولید همان
   *  معیار Import روی رکوردهای ذخیره‌شده (normalize): بدون رول / بدون
   *  شماره / بدون عرض. */
  PackagingView.showIssueDrill = function (kind) {
    const titles = {
      palletNo: 'پالت‌های بدون شماره',
      noRolls: 'پالت‌های بدون رول (خالی)',
      noWidth: 'پالت‌های بدون عرض',
    };
    const records = PackagingView._records || [];
    const rows = records.filter((r) => (
      kind === 'noRolls' ? r.rolls.length === 0
        : kind === 'palletNo' ? r.palletNo === ''
          : r.width === null
    ));
    const columns = [
      {
        key: 'palletNo', label: 'شماره پالت', className: 'ltr',
        render: (r) => (r.palletNo ? `<b>${U.escapeHtml(r.palletNo)}</b>` : '<span class="num-warn">بدون شماره</span>'),
        tokens: (r) => [r.palletNo || ''],
      },
      { key: 'palletId', label: 'شناسه', render: (r) => U.escapeHtml(r.palletId || '—'), tokens: (r) => [r.palletId || ''] },
      { key: 'filmType', label: 'نوع فیلم', render: (r) => U.escapeHtml(r.filmType || '—'), tokens: (r) => [r.filmType || ''] },
      {
        key: 'width', label: 'عرض',
        render: (r) => r.width === null ? '<span class="num-warn">نامشخص</span>' : U.faWidth(r.width),
        tokens: (r) => (r.width === null ? [] : [U.faWidth(r.width), String(r.width)]),
      },
      {
        key: 'rolls', label: 'تعداد رول',
        render: (r) => r.rolls.length ? U.faNum(r.rolls.length) : '<span class="num-warn">۰</span>',
        tokens: (r) => [String(r.rolls.length)],
      },
      { key: 'warehouse', label: 'انبار', render: (r) => U.escapeHtml(r.warehouse || '—'), tokens: (r) => [r.warehouse || ''] },
    ];
    UI.infoModal(`${titles[kind] || kind} — ${U.faNum(rows.length)} پالت`, `
      <div class="drill-subtitle">فهرست همین دسته از رکوردهای ذخیره‌شدهٔ فایل مدیریت پالت‌ها (شمارش لحظهٔ Import با همین معیار ساخته شده است).</div>
      <div id="pack-issue-table"></div>
    `, { wide: true });
    UI.renderTable(document.getElementById('pack-issue-table'), columns, rows, {
      pageSize: RM.config.PAGE_SIZE,
      emptyText: 'پالتی در این دسته نیست.',
      centered: true,
    });
  };

  /* ================================================================
     ۴) رندر اصلی (از موتور مرکزی)
     ================================================================ */

  PackagingView.render = async function () {
    PackagingView._records = await db.pallets.toArray();
    await PackagingView.renderStatus();
    PackagingView.renderFromCache();
  };

  /** محاسبه/رندر برنامه از رکوردهای کش‌شده (بدون خواندن مجدد دیتابیس)
   *  ۳٫۱۳ — بدون scope: پالت‌های «فروش» همیشه کنار (بند ۵).
   *  ۳٫۱۴ بند ۵ — گزینهٔ «تفکیک صادراتی‌ها» به موتور پاس می‌شود. */
  PackagingView.renderFromCache = function () {
    const records = PackagingView._records;
    if (!records || !records.length) {
      PackagingView._plan = null;
      const statsEl = document.getElementById('pack-stats');
      if (statsEl) {
        statsEl.innerHTML = '<p class="status-empty">برای شروع، فایل مدیریت پالت‌ها را در کادر بالا وارد کنید.</p>';
      }
      document.getElementById('pack-warnings-panel').hidden = true;
      document.getElementById('pack-plan-count').textContent = U.faNum(0);
      document.getElementById('pack-plan-stats').textContent = '';
      document.getElementById('pack-pallets-stats').textContent = '';
      document.getElementById('pack-rolls-stats').textContent = '';
      document.getElementById('pack-graph-stats').textContent = '';
      const graphWrap = document.getElementById('pack-graph-wrap');
      if (graphWrap) graphWrap.innerHTML = '<div class="empty-state">' + UI.icons.alert +
        '<h4>بسته‌ای انتخاب نشده است</h4><p>از جدول «برنامهٔ بسته‌بندی» بسته‌های دلخواه را با دکمهٔ «+ نمایش» به این صفحه اضافه کنید.</p></div>';
      for (const name of Object.keys(TABLE_DEFS)) {
        UI.filterTable(document.getElementById(`pack-${name}-table`), [], [], {
          state: PackagingView.state.tables[name],
          emptyText: 'هنوز فایل پالت‌ها وارد نشده است.',
        });
      }
      return;
    }

    const plan = PK.buildPlan(records, { separateExport: PackagingView.state.separateExport });
    PackagingView._plan = plan;

    PackagingView.renderStats(plan);
    PackagingView.renderWarnings(plan);
    PackagingView.renderPlanTable(plan);
    PackagingView.renderPalletsTable(plan);
    PackagingView.renderRollsTable(plan);
    PackagingView.renderGraphView(plan);
  };

  /* ---------------- خلاصهٔ آماری (وسط‌چین — بند ۹) ---------------- */

  PackagingView.renderStats = function (plan) {
    const el = document.getElementById('pack-stats');
    const s = plan.stats;
    const item = (label, value, opts = {}) => `
      <div class="pack-stat${opts.cls ? ` ${opts.cls}` : ''}"${opts.title ? ` title="${U.escapeHtml(opts.title)}"` : ''}>
        <span class="pack-stat-label">${label}</span>
        <span class="pack-stat-value">${value}</span>
        ${opts.sub ? `<span class="pack-stat-sub">${opts.sub}</span>` : ''}
      </div>`;

    el.innerHTML = `
      ${item('پالت‌های فایل', U.faNum(s.palletsTotal), { sub: `${U.faNum(s.soldPallets)} فروخته‌شده (کنار)`, title: 'مجموع پالت‌های ذخیره‌شدهٔ دارای M — پالت‌های «فروش» همیشه از برنامه کنار گذاشته می‌شوند' })}
      ${item('پالت در برنامه', U.faNum(s.inScope), { sub: 'انبار + پای کار', title: 'همهٔ پالت‌های غیرفروش — چه در انبار، چه پای کار (سالن تولید)' })}
      ${item('پالت کامل', U.faNum(s.completePallets), { sub: 'بدون نیاز به اقدام', cls: 'ok' })}
      ${item('پالت ناقص', U.faNum(s.partial), { cls: s.partial ? 'warn' : '' })}
      ${item('پالت خالی', U.faNum(s.empty))}
      ${item('مستثنا (دادهٔ نامعتبر)', U.faNum(s.excluded), { cls: s.excluded ? 'warn' : '' })}
      ${item('گروه سازگار', U.faNum(s.groups), { title: 'گروه‌های پنج‌ویژگی: نوع فیلم + عرض + ضخامت + گرید + قطر بوبین' })}
      ${item('بستهٔ قابل اقدام', U.faNum(s.packagesActionable), { sub: `${U.faNum(s.packagesAssembled)} تشکیل جدید · ${U.faNum(s.packagesDowngraded)} تخلیهٔ مازاد`, cls: 'ok', title: `بسته‌هایی که نیاز به تغییر دارند و در جدول برنامه نمایش داده می‌شوند — ${U.faNum(s.packagesAsIs)} بستهٔ دیگر در ظرفیت هدف بدون امکان بهبودند و نمایش داده نمی‌شوند` })}
      ${s.packagesMixed ? item('بستهٔ ترکیبی U+X', U.faNum(s.packagesMixed), { sub: 'نیازمند تأیید QC', cls: 'warn', title: 'بسته‌های ترکیبی گرید U+X (۳٫۱۷ بند ۶): باقی‌مانده‌های U و X با مشخصه‌های یکسانِ دیگر در یک بسته ترکیب شده‌اند و پیش از ارسال باید توسط واحد کنترل کیفیت تأیید شوند — در جدول با ردیف نارنجی هایلایت می‌شوند' }) : ''}
      ${item('جابه‌جایی رول', U.faNum(s.movesTotal), { title: 'تعداد رول‌هایی که باید بین پالت‌ها جابه‌جا شوند' })}
      ${item('پالت نیازمند برگشت از انبار', U.faNum(s.recallPalletCount), { title: 'پالت‌های درگیر بسته‌ها که در انبارند و باید از انبار به ایستگاه بسته‌بندی برگردانده شوند (پالت‌های «پای کار» در سالن تولیدند و برگشتی نمی‌خواهند)' })}
      ${item('رول بسته‌بندی‌شده', U.faNum(s.rollsPacked), { sub: `از ${U.faNum(s.rollsInScope)} رول درون برنامه` })}
      ${item('رول رزرو', U.faNum(s.rollsReserve), { title: 'رول‌های باقی‌ماندهٔ هم‌ویژگی — جایگزین QC' })}
      ${item('رول باقی‌مانده', U.faNum(s.rollsLeftover))}
      ${item('پالت غیرقابل بسته‌بندی', U.faNum(s.unpackedPallets), { cls: s.unpackedPallets ? 'warn' : '' })}
    `;
  };

  /* ---------------- هشدارهای داده‌ای (§24) ---------------- */

  PackagingView.renderWarnings = function (plan) {
    const panel = document.getElementById('pack-warnings-panel');
    const wrap = document.getElementById('pack-warnings');
    if (!plan.warnings.length) {
      panel.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    panel.hidden = false;
    wrap.innerHTML = plan.warnings.map((w) => `
      <button type="button" class="status-row status-row-link" data-pack-warning="${w.key}"
        title="نمایش پالت‌ها و رول‌های درگیر">
        <span class="status-icon err">${UI.icons.warning}</span>
        <b>${U.escapeHtml(w.label)}:</b> <b class="num-warn">${U.faNum(w.pallets.length)}</b> پالت
        <span class="drill-hint">مشاهده ←</span>
      </button>`).join('');
    wrap.querySelectorAll('[data-pack-warning]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = plan.warnings.find((x) => x.key === btn.dataset.packWarning);
        if (w) PackagingView.showWarningDrill(w, plan);
      });
    });
  };

  /** دریل هشدار: پالت‌های درگیر + صفحه‌بندی سالم + وسط‌چین (بند ۱۳) */
  PackagingView.showWarningDrill = function (w, plan) {
    const titles = {
      mismatch: 'مغایرت نوع بسته‌بندی — پالت‌های درگیر',
      invalidPack: 'نوع بسته‌بندی نامعتبر — پالت‌های درگیر',
      noWidth: 'عرض نامشخص — پالت‌های درگیر',
      unknownLine: 'خط تولید نامشخص — پالت‌های درگیر',
    };
    const columns = [
      {
        key: 'palletNo', label: 'شماره پالت', className: 'ltr',
        render: (p) => `<b>${U.escapeHtml(p.palletNo || '—')}</b>`,
        tokens: (p) => [p.palletNo || ''],
      },
      { key: 'palletId', label: 'شناسه', render: (p) => U.escapeHtml(p.palletId || '—'), tokens: (p) => [p.palletId || ''] },
      { key: 'filmType', label: 'نوع فیلم', render: (p) => U.escapeHtml(p.filmType || '—'), tokens: (p) => [p.filmType || ''] },
      { key: 'width', label: 'عرض', render: (p) => p.width === null ? '<span class="muted">—</span>' : U.faWidth(p.width), tokens: (p) => p.width === null ? [] : [U.faWidth(p.width), String(p.width)] },
      { key: 'thickness', label: 'ضخامت', render: (p) => p.thickness === null ? '<span class="muted">—</span>' : U.faNum(p.thickness), tokens: (p) => p.thickness === null ? [] : [U.faNum(p.thickness), String(p.thickness)] },
      { key: 'grade', label: 'گرید', render: (p) => U.escapeHtml(p.grade || '—'), tokens: (p) => [p.grade || ''] },
      {
        key: 'excel', label: 'نوع اکسل',
        render: (p) => p.packTypeExcel ? U.escapeHtml(p.packTypeExcel) : '<span class="num-warn">خالی</span>',
        tokens: (p) => [p.packTypeExcel || ''],
      },
      {
        key: 'computed', label: 'محاسبه‌شده',
        render: (p) => p.computedType ? U.escapeHtml(p.computedType) : '<span class="muted">—</span>',
        tokens: (p) => [p.computedType || ''],
      },
      { key: 'rolls', label: 'رول‌ها', render: (p) => U.faNum(p.rollCount), tokens: (p) => [String(p.rollCount)] },
      { key: 'warehouse', label: 'انبار', render: (p) => U.escapeHtml(p.warehouse || '—'), tokens: (p) => [p.warehouse || ''] },
      {
        key: 'actions', label: 'عملیات', filterable: false,
        render: (p) => `<button type="button" class="btn btn-ghost btn-sm" data-pack-pal="${U.escapeHtml(p.palletNo)}">جزئیات</button>`,
      },
    ];

    UI.infoModal(`${titles[w.key] || w.label} — ${U.faNum(w.pallets.length)} پالت`, `
      <div class="drill-subtitle">
        ${w.key === 'mismatch'
          ? 'نوع بسته‌بندی محاسبه‌شدهٔ سامانه (قوانین خط تولید/عرض/قطر) با مقدار اکسل یکی نیست — پالت همچنان با قطر استخراج‌شده در برنامه است:'
          : 'قطر بوبین از مقدار اکسل قابل استخراج نیست یا دادهٔ لازم نقص دارد — پالت وارد برنامهٔ بسته‌بندی نشده:'}
      </div>
      <div id="pack-warn-table"></div>
    `, { wide: true });

    /* ۳٫۱۳ — بند ۱۳: صفحه‌بندی واقعی (ابتدا/قبلی/بعدی/انتها) + وسط‌چین */
    const tableEl = document.getElementById('pack-warn-table');
    const renderPage = (page) => {
      UI.renderTable(tableEl, columns, w.pallets, {
        page,
        pageSize: RM.config.PAGE_SIZE,
        emptyText: 'پالتی یافت نشد.',
        centered: true,
        onPageChange: (next) => renderPage(next),
      });
      tableEl.querySelectorAll('[data-pack-pal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = plan.pallets.find((x) => x.palletNo === btn.dataset.packPal);
          if (p) PackagingView.showPalletModal(p, plan);
        });
      });
    };
    renderPage(1);
  };

  /* ================================================================
     ۵) جدول برنامهٔ بسته‌بندی (بندهای ۱/۲/۳/۴/۷/۸/۱۱/۱۴)
     ================================================================ */

  /** رجیستری ستون‌های جدول برنامه (مشترک رندر و خروجی اکسل) */
  PackagingView.planColumns = function () {
    const registry = {
      no: {
        key: 'no', label: '#',
        render: (x) => U.faNum(x.no),
        tokens: (x) => [String(x.no)],
      },
      pallets: {
        key: 'pallets', label: 'پالت‌های هر بسته', className: 'pk-list-cell pk-ltr',
        headerTitle: 'همهٔ پالت‌های شرکت‌کننده در این بسته (اصلی + مکمل) — پالت «پای کار» (در سالن تولید) با رنگ کهربایی و کادر ظریف مشخص است (۳٫۱۴ بند ۱۳: ستون چپ‌نویس)',
        render: (x) => '<div class="pk-pal-list">' + x.palletParts.map((pt, i) =>
          `<div class="pk-pal-item${pt.atBase ? ' at-base' : ''}"` +
          ` title="${U.escapeHtml(pt.warehouse || '—')}${pt.atBase
            ? ' — پای کار: در سالن تولید است و نیازی به برگشت از انبار ندارد'
            : ' — در انبار: باید به ایستگاه بسته‌بندی برگردد'}">` +
          `<span class="pk-pal-idx">${i + 1}.</span>` +
          `<span class="ltr pk-pal-no">${U.escapeHtml(pt.palletNo)}</span>` +
          '</div>').join('') + '</div>',
        tokens: (x) => x.palletParts.flatMap((pt) => [pt.palletNo, pt.warehouse || '']),
      },
      rollsList: {
        key: 'rollsList', label: 'رول‌های هر بسته', className: 'pk-list-cell pk-ltr',
        headerTitle: 'رول‌های هر پالتِ این بسته — زیر شمارهٔ همان پالت (۳٫۱۴ بند ۱۳: ستون چپ‌نویس؛ رول‌های پالت «پای کار» کهربایی‌اند)',
        render: (x) => '<div class="pk-rolls-list">' + x.palletParts.map((pt, i) =>
          `<div class="pk-rolls-group${pt.atBase ? ' at-base' : ''}" title="پالت ${i + 1}: ${U.escapeHtml(pt.palletNo)}${pt.atBase ? ' — پای کار (سالن تولید)' : ''}">` +
          `<span class="pk-pal-idx">${i + 1}.</span>` +
          '<span class="pk-rolls-col">' +
          pt.rolls.map((r) => `<span class="pk-roll ltr${pt.atBase ? ' at-base' : ''}">${U.escapeHtml(r.roll)}</span>`).join('') +
          '</span></div>').join('') + '</div>',
        tokens: (x) => x.palletParts.flatMap((pt) => pt.rolls.map((r) => r.roll)),
      },
      filmType: {
        key: 'filmType', label: 'فیلم',
        render: (x) => U.escapeHtml(x.filmType),
        tokens: (x) => [x.filmType],
      },
      width: {
        key: 'width', label: 'عرض',
        render: (x) => U.faWidth(x.width),
        tokens: (x) => [U.faWidth(x.width), String(x.width)],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت',
        render: (x) => x.thickness === null ? '<span class="muted">—</span>' : U.faNum(x.thickness),
        tokens: (x) => x.thickness === null ? [] : [U.faNum(x.thickness), String(x.thickness)],
      },
      grade: {
        key: 'grade', label: 'گرید',
        headerTitle: 'گرید بسته — فقط متن بولد بدون کادر رنگی (۳٫۱۸ بند ۱)؛ بسته‌های ترکیبی U+X: گرید هر رول در یک ستون، دقیقاً هم‌تراز شمارهٔ همان رول در ستون «رول‌های هر بسته»',
        render: (x) => x.mixedGrid
          ? mixedGradeListHtml(x.palletParts)
          : `<b class="pk-grade-single">${U.escapeHtml(x.grade || '—')}</b>`,
        tokens: (x) => x.mixedGrid
          ? ['ترکیبی', 'U + X', ...x.palletParts.flatMap((pt) => [gradeKeyOf(pt.pallet && pt.pallet.grade), ...pt.rolls.map((r) => gradeKeyOf(r.pallet && r.pallet.grade))].filter(Boolean))]
          : [x.grade || ''],
      },
      diameter: {
        key: 'diameter', label: 'قطر',
        render: (x) => `${U.faNum(x.diameter)}″`,
        tokens: (x) => [String(x.diameter)],
      },
      computedType: {
        key: 'computedType', label: 'نوع بسته‌بندی',
        render: (x) => `<b>${U.escapeHtml(x.computedType)}</b>`,
        headerTitle: 'نوع بسته‌بندی محاسبه‌شدهٔ سامانه (جهت + قطر بوبین)',
        tokens: (x) => [x.computedType],
      },
      capacity: {
        key: 'capacity', label: 'ظرفیت نهایی',
        headerTitle: 'تعداد رول فعلی بسته از ظرفیت استاندارد پالت',
        render: (x) => `<b>${U.faNum(x.finalCount)}</b> <span class="muted">از ${U.faNum(x.stdCapacity)}</span>`,
        tokens: (x) => [String(x.finalCount), String(x.stdCapacity), `${x.finalCount} از ${x.stdCapacity}`],
      },
      pkgType: {
        key: 'pkgType', label: 'نوع بسته',
        render: (x) => `<span class="chip chip-pack-${x.type}">${PK.PACKAGE_TYPE_LABELS[x.type]}</span>` +
          (x.mixedGrid ? ` <span class="chip pk-chip-mixed" title="این بسته ترکیبی از گریدهای ${U.escapeHtml(gradeLabelOf(x))} است — پیش از ارسال باید توسط واحد کنترل کیفیت تأیید شود">ترکیبی ${U.escapeHtml(gradeLabelOf(x))} · تأیید QC</span>` : ''),
        tokens: (x) => [PK.PACKAGE_TYPE_LABELS[x.type], ...(x.mixedGrid ? ['ترکیبی', 'QC', 'تأیید'] : [])],
      },
      reserve: {
        key: 'reserve', label: 'رزرو',
        headerTitle: 'رول‌های باقی‌ماندهٔ هم‌ویژگی — جایگزین در صورت رد QC',
        render: (x) => x.reserveRolls.length
          ? `<b class="pack-reserve">${U.faNum(x.reserveRolls.length)}</b>`
          : '<span class="muted">—</span>',
        tokens: (x) => x.reserveRolls.map((r) => r.roll),
      },
      moves: {
        key: 'moves', label: 'جابه‌جایی',
        render: (x) => U.faNum(x.moves),
        tokens: (x) => [String(x.moves)],
      },
      actions: {
        key: 'actions', label: 'عملیات', filterable: false,
        render: (x) => {
          const inGraph = PackagingView.graphHas(x.no);
          return `<div class="row-actions pk-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-pack-pkg="${x.no}">جزئیات</button>
            <button type="button" class="btn btn-ghost pk-graph-toggle${inGraph ? ' panel-on' : ''}"
                    data-pack-graph="${x.no}" aria-pressed="${String(inGraph)}"
                    title="${inGraph ? 'حذف از نمایش گرافیکی' : 'افزودن به نمایش گرافیکی'}">
              ${inGraph ? '✓ نمایش' : '+ نمایش'}
            </button>
          </div>`;
        },
      },
    };
    return registry;
  };

  PackagingView.renderPlanTable = function (plan) {
    if (!plan) return;
    const ctl = PackagingView.ctls.plan;
    const s = plan.stats;

    /* بند ۷ — فقط بسته‌های «قابل اقدام»: پالت‌هایی که در یکی از ظرفیت‌های
       هدف‌اند و امکان بهبود اولویت ندارند، تغییری نمی‌خواهند و نمایش
       داده نمی‌شوند؛ بسته‌های تشکیل/تخلیهٔ مازاد نیاز به تغییر دارند. */
    const rows = ctl.applySort(plan.packages.filter((p) => p.type !== 'as-is'));

    document.getElementById('pack-plan-count').textContent = U.faNum(s.packagesActionable);
    document.getElementById('pack-plan-stats').textContent =
      `${U.faNum(s.packagesActionable)} بستهٔ قابل اقدام — ${U.faNum(s.packagesAssembled)} تشکیل جدید` +
      (s.packagesDowngraded ? ` · ${U.faNum(s.packagesDowngraded)} تخلیهٔ مازاد` : '') +
      (s.packagesMixed ? ` · ${U.faNum(s.packagesMixed)} ترکیبی U+X (تأیید QC)` : '') +
      ` · ${U.faNum(s.movesTotal)} جابه‌جایی` +
      (s.packagesAsIs ? ` · ${U.faNum(s.packagesAsIs)} بستهٔ در ظرفیت هدف بدون امکان بهبود (نمایش داده نمی‌شود)` : '');

    const registry = PackagingView.planColumns();
    ctl.applyWidths(registry);
    const columns = ctl.visibleColumns(registry);

    const wrap = document.getElementById('pack-plan-table');
    /* ۳٫۱۴ بند ۲: موقعیت اسکرول (کانتینر جدول + پنجره) پیش از بازسازی
       ذخیره و بلافاصله پس از رندر بازیابی می‌شود */
    const snap = snapshotScroll(wrap);
    /* بند ۱ — «ردیف‌های قابل نمایش» ماندگار: مقدار ذخیره‌شده به state
       جدول وصل می‌شود و تغییر کاربر از طریق onRowsChange ذخیره می‌شود */
    PackagingView.state.tables.plan.visibleRows = ctl.cfg.visibleRows;
    UI.filterTable(wrap, columns, rows, {
      state: PackagingView.state.tables.plan,
      tableClass: 'cut-table',
      maxDomRows: RM.config.PACK_MAX_DOM_ROWS,
      /* ۳٫۱۷ بند ۶: ردیف بسته‌های ترکیبی U+X با رنگ هایلایت */
      rowClass: (p) => (p.mixedGrid ? 'pk-mixed-row' : ''),
      emptyText: 'بسته‌ای برای اقدام نیست — پالت‌های ناقص یا کامل‌اند یا در ظرفیت هدف بدون امکان بهبودند.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن · دکمهٔ «≠» = شامل نشود · ستون «پالت‌های هر بسته» همهٔ پالت‌های بسته را فهرست می‌کند (پای کار = رنگ کهربایی و کادر ظریف) — شماره‌گذاری بسته‌ها پیوسته است (۳٫۱۴ بند ۱) — بسته‌های ترکیبی U+X با ردیف نارنجی هایلایت و نیازمند تأیید کنترل کیفیت‌اند (۳٫۱۷ بند ۶)',
      onRowsChange: (n) => { ctl.cfg.visibleRows = n; ctl.save(); },
      tools: [
        { id: `pack-plan-cols-toggle`, label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: ctl.cfg.colsVisible },
        { id: `pack-plan-sort-toggle`, label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: ctl.cfg.sortVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'pack-plan-cols-toggle') {
          ctl.cfg.colsVisible = !ctl.cfg.colsVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('plan'));
        } else if (toolId === 'pack-plan-sort-toggle') {
          ctl.cfg.sortVisible = !ctl.cfg.sortVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('plan'));
        }
      },
      /* بند ۱ — اتصال دکمه‌ها پس از «هر» رندر بدنه (فیلترها فقط tbody را
         بازسازی می‌کنند؛ رویدادها باید هر بار نو شوند) */
      onRendered: () => {
        wrap.querySelectorAll('[data-pack-pkg]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const pkg = plan.packages.find((x) => x.no === Number(btn.dataset.packPkg));
            if (pkg) PackagingView.showPackageModal(pkg, plan);
          });
        });
        wrap.querySelectorAll('[data-pack-graph]').forEach((btn) => {
          btn.addEventListener('click', () => {
            PackagingView.toggleGraphPackage(Number(btn.dataset.packGraph));
          });
        });
      },
    });

    PackagingView.renderSortBuilderFor('plan');
    PackagingView.renderColsBuilderFor('plan', registry);
    PackagingView.applyPanelsFor('plan');
    requestAnimationFrame(() => restoreScroll(wrap, snap));
  };

  /** آیا بسته‌ای در نمایش گرافیکی است؟ (۳٫۱۴ — از روی ترتیب نمایش) */
  PackagingView.graphHas = function (no) {
    return PackagingView.state.graphOrder.includes(no);
  };

  /** ذخیرهٔ ماندگار طرح نمایش گرافیکی (ترتیب + حذفیات پالت + ویرایش‌ها — بند ۷ و ۳٫۱۵ بند ۳) */
  PackagingView.saveGraphPlan = function () {
    RM.db.setSetting('packGraphOrder', [...PackagingView.state.graphOrder]);
    RM.db.setSetting('packGraphRemoved', JSON.parse(JSON.stringify(PackagingView.state.graphRemoved)));
    RM.db.setSetting('packGraphEdits', JSON.parse(JSON.stringify(PackagingView.state.graphEdits)));
  };

  /** حذف همهٔ ویرایش‌های نمایشی یک بسته (هنگام خارج‌شدن از نمایش) */
  PackagingView.graphClearEditsOf = function (no) {
    delete PackagingView.state.graphRemoved[no];
    const e = PackagingView.state.graphEdits;
    delete e.spec[no];
    delete e.rollRemoved[no];
    delete e.rollAdded[no];
    delete e.palletAdded[no];
  };

  /** به‌روزرسانی درجا دکمهٔ «+ نمایش» یک ردیف (۳٫۱۴ بند ۲ — بدون
   *  بازسازی جدول؛ موقعیت اسکرول کاملاً حفظ می‌شود) */
  PackagingView.syncGraphButton = function (no) {
    const btn = document.querySelector(`#pack-plan-table [data-pack-graph="${no}"]`);
    if (!btn) return;
    const inGraph = PackagingView.graphHas(no);
    btn.classList.toggle('panel-on', inGraph);
    btn.setAttribute('aria-pressed', String(inGraph));
    btn.title = inGraph ? 'حذف از نمایش گرافیکی' : 'افزودن به نمایش گرافیکی';
    btn.textContent = inGraph ? '✓ نمایش' : '+ نمایش';
  };

  /** افزودن/حذف بستهٔ نمایش گرافیکی (۳٫۱۴ بندهای ۲ و ۷) */
  PackagingView.toggleGraphPackage = function (no) {
    const order = PackagingView.state.graphOrder;
    const plan = PackagingView._plan;
    if (!plan) return;
    const pkg = plan.packages.find((x) => x.no === no);
    if (!pkg) return;
    const i = order.indexOf(no);
    if (i !== -1) {
      order.splice(i, 1);
      PackagingView.graphClearEditsOf(no);
      UI.toast(`بستهٔ ${U.faNum(no)} از نمایش گرافیکی حذف شد.`, 'info');
    } else {
      order.push(no);
      UI.toast(`بستهٔ ${U.faNum(no)} به نمایش گرافیکی اضافه شد (${U.faNum(pkg.palletParts.length)} پالت · ${U.faNum(pkg.finalCount)} رول).`, 'success');
    }
    PackagingView.saveGraphPlan();
    PackagingView.renderGraphView(plan);
    /* بند ۲ — جدول بازسازی نمی‌شود؛ فقط دکمهٔ همین ردیف به‌روز می‌شود */
    PackagingView.syncGraphButton(no);
  };

  /* ---------------- مودال جزئیات بسته (§19-§22 + بندهای ۱۲/۹) ---------------- */

  PackagingView.showPackageModal = function (pkg, plan) {
    const infoRow = (label, value) => `
      <div class="pack-info-item"><span>${label}</span><b>${value}</b></div>`;

    /* پالت‌های مشارکت‌کننده — از palletParts موتور (اصلی + مکمل) */
    const palletRows = pkg.palletParts.map((pt, i) => ({
      idx: U.faNum(i + 1),
      palletNo: pt.palletNo,
      role: pt.isMain ? 'اصلی' : 'مکمل',
      place: pt.atBase ? 'پای کار (سالن تولید)' : (pt.warehouse || '—'),
      kept: pt.isMain ? pt.rolls.length : null,
      given: pt.isMain ? null : pt.rolls.length,
    }));

    const palletCols = [
      { key: 'idx', label: '#', render: (r) => r.idx },
      { key: 'palletNo', label: 'شماره پالت', className: 'ltr', render: (r) => `<b>${U.escapeHtml(r.palletNo)}</b>` },
      { key: 'role', label: 'نقش', render: (r) => U.escapeHtml(r.role) },
      { key: 'place', label: 'موقعیت', render: (r) => U.escapeHtml(r.place) },
      { key: 'kept', label: 'رول نگه‌داشته', render: (r) => r.kept === null ? '<span class="muted">—</span>' : U.faNum(r.kept) },
      { key: 'given', label: 'رول داده', render: (r) => r.given === null ? '<span class="muted">—</span>' : U.faNum(r.given) },
    ];

    const rollCols = [
      { key: 'roll', label: 'شماره رول', className: 'ltr', render: (r) => `<b>${U.escapeHtml(r.roll)}</b>` },
      { key: 'origin', label: 'پالت مبدأ', className: 'ltr', render: (r) => U.escapeHtml(r.pallet.palletNo) },
      { key: 'role', label: 'نقش', render: (r) => (r.role === 'main' ? 'اصلی' : 'مکمل') },
      {
        key: 'move', label: 'جابه‌جایی', render: (r) => r.movedToPalletNo
          ? `→ <span class="ltr">${U.escapeHtml(r.movedToPalletNo)}</span>`
          : '<span class="muted">—</span>',
      },
    ];

    const allRolls = [...pkg.mainRolls, ...pkg.complementRolls];

    /* بند ۱۲ — رول‌های رزرو به‌همراه شمارهٔ پالت، گروه‌بندی‌شده بر اساس پالت */
    const reserveByPallet = new Map();
    for (const robj of pkg.reserveRolls) {
      if (!reserveByPallet.has(robj.pallet)) reserveByPallet.set(robj.pallet, []);
      reserveByPallet.get(robj.pallet).push(robj);
    }
    const reserveHtml = pkg.reserveRolls.length
      ? [...reserveByPallet.entries()]
        .sort((a, b) => (a[0].palletNo < b[0].palletNo ? -1 : 1))
        .map(([pallet, rolls]) => `
          <div class="pack-reserve-group">
            <div class="pack-reserve-pal">
              <span class="pk-pal-idx">▪</span>
              <b class="ltr">${U.escapeHtml(pallet.palletNo)}</b>
              <span class="muted">${U.faNum(rolls.length)} رول — ${U.escapeHtml(pallet.warehouse || '—')}</span>
            </div>
            <div class="pack-reserve-rolls">
              ${rolls.map((r) => `<span class="pack-recall-chip pack-reserve-chip ltr" title="روی پالت ${U.escapeHtml(pallet.palletNo)} — جایگزین در صورت رد QC">${U.escapeHtml(r.roll)}</span>`).join('')}
            </div>
          </div>`).join('')
      : '<p class="muted">رول باقی‌ماندهٔ هم‌ویژگی برای این بسته وجود ندارد.</p>';

    UI.infoModal(`بسته‌بندی شمارهٔ ${U.faNum(pkg.no)} — ${PK.PACKAGE_TYPE_LABELS[pkg.type]}`, `
      ${pkg.mixedGrid ? `
        <div class="pk-mixed-banner">
          <b>بستهٔ ترکیبی گرید ${U.escapeHtml(gradeLabelOf(pkg))}</b> — این بسته از باقی‌مانده‌های گریدهای U و X با مشخصه‌های یکسان (جز گرید) تشکیل شده است و
          <b>پیش از ارسال باید توسط واحد کنترل کیفیت تأیید شود</b>. گرید هر رول در ستون «گرید» جدول برنامه هم‌تراز شمارهٔ همان رول درج می‌شود.
        </div>` : ''}
      <div class="pack-info-grid">
        ${infoRow('نوع فیلم', U.escapeHtml(pkg.filmType))}
        ${infoRow('خط تولید', U.escapeHtml(pkg.line || '—'))}
        ${infoRow('عرض', U.faWidth(pkg.width))}
        ${infoRow('ضخامت', pkg.thickness === null ? '—' : U.faNum(pkg.thickness))}
        ${infoRow('گرید', pkg.mixedGrid
          ? `<b class="pk-grade-single">X</b> + <b class="pk-grade-single">U</b> <span class="muted">(ترکیبی — تأیید QC)</span>`
          : U.escapeHtml(pkg.grade || '—'))}
        ${infoRow('قطر بوبین', `${U.faNum(pkg.diameter)}″`)}
        ${infoRow('چیدمان مجاز', `${U.faNum(pkg.layers)} طبقه × ${U.faNum(pkg.rollsPerLayer)} رول (${pkg.direction})`)}
        ${infoRow('ظرفیت استاندارد', U.faNum(pkg.stdCapacity))}
        ${infoRow('ظرفیت هدف', U.faNum(pkg.target))}
        ${infoRow('نوع بسته‌بندی', U.escapeHtml(pkg.computedType))}
        ${infoRow('رول نهایی', `${U.faNum(pkg.finalCount)} از ${U.faNum(pkg.stdCapacity)} (${U.faNum(pkg.mainRolls.length)} اصلی + ${U.faNum(pkg.complementRolls.length)} مکمل)`)}
        ${infoRow('جابه‌جایی', U.faNum(pkg.moves))}
      </div>

      <h4 class="pack-modal-title">پالت‌های هر بسته (${U.faNum(palletRows.length)})</h4>
      <div id="pkg-pallets-wrap"></div>

      <h4 class="pack-modal-title">رول‌های بسته (${U.faNum(allRolls.length)})</h4>
      <div id="pkg-rolls-wrap"></div>

      <h4 class="pack-modal-title">رول‌های رزرو (${U.faNum(pkg.reserveRolls.length)}) — با پالت مبدأ</h4>
      ${reserveHtml}
    `, { wide: true });

    UI.renderTable(document.getElementById('pkg-pallets-wrap'), palletCols, palletRows, { pageSize: 10, centered: true });
    UI.renderTable(document.getElementById('pkg-rolls-wrap'), rollCols, allRolls, { pageSize: 10, centered: true });
  };

  /* ================================================================
     ۶) جدول پالت‌ها
     ================================================================ */

  PackagingView.palletsColumns = function (plan) {
    const pkgByMain = new Map(plan.packages.map((x) => [x.main, x]));
    return {
      palletNo: {
        key: 'palletNo', label: 'شماره پالت', className: 'ltr',
        render: (p) => `<b>${U.escapeHtml(p.palletNo || '—')}</b>`,
        tokens: (p) => [p.palletNo || ''],
      },
      palletId: {
        key: 'palletId', label: 'شناسه',
        render: (p) => U.escapeHtml(p.palletId || '—'),
        tokens: (p) => [p.palletId || ''],
      },
      filmType: {
        key: 'filmType', label: 'نوع فیلم',
        render: (p) => U.escapeHtml(p.filmType || '—'),
        tokens: (p) => [p.filmType || ''],
      },
      line: {
        key: 'line', label: 'خط',
        render: (p) => U.escapeHtml(p.line || '—'),
        tokens: (p) => [p.line || ''],
      },
      width: {
        key: 'width', label: 'عرض',
        render: (p) => p.width === null ? '<span class="num-warn">—</span>' : U.faWidth(p.width),
        tokens: (p) => p.width === null ? [] : [U.faWidth(p.width), String(p.width)],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت',
        render: (p) => p.thickness === null ? '<span class="muted">—</span>' : U.faNum(p.thickness),
        tokens: (p) => p.thickness === null ? [] : [U.faNum(p.thickness), String(p.thickness)],
      },
      grade: {
        key: 'grade', label: 'گرید',
        render: (p) => U.escapeHtml(p.grade || '—'),
        tokens: (p) => [p.grade || ''],
      },
      diameter: {
        key: 'diameter', label: 'قطر',
        render: (p) => p.diameter === null ? '<span class="muted">—</span>' : `${U.faNum(p.diameter)}″`,
        tokens: (p) => p.diameter === null ? [] : [String(p.diameter)],
      },
      packTypeExcel: {
        key: 'packTypeExcel', label: 'نوع اکسل',
        render: (p) => (p.packTypeExcel ? U.escapeHtml(p.packTypeExcel) : '<span class="num-warn">خالی</span>') +
          (p.packTypeMismatch ? ' <span class="pack-warn-star" title="مغایرت با نوع محاسبه‌شده">⚠</span>' : ''),
        tokens: (p) => [p.packTypeExcel || ''],
      },
      computedType: {
        key: 'computedType', label: 'محاسبه‌شده',
        render: (p) => p.computedType
          ? U.escapeHtml(p.computedType)
          : `<span class="num-warn">${p.excluded ? 'نامعتبر' : '—'}</span>`,
        headerTitle: 'نوع بسته‌بندی محاسبه‌شدهٔ سامانه (مستقل از اکسل)',
        tokens: (p) => [p.computedType || (p.excluded ? 'نامعتبر' : '')],
      },
      rollCount: {
        key: 'rollCount', label: 'رول‌ها',
        render: (p) => U.faNum(p.rollCount),
        tokens: (p) => [String(p.rollCount)],
      },
      stdCapacity: {
        key: 'stdCapacity', label: 'استاندارد',
        render: (p) => p.stdCapacity === null ? '<span class="muted">—</span>' : U.faNum(p.stdCapacity),
        headerTitle: 'ظرفیت استاندارد (تعداد طبقه × رول در طبقه)',
        tokens: (p) => p.stdCapacity === null ? [] : [String(p.stdCapacity)],
      },
      palletStatus: {
        key: 'palletStatus', label: 'وضعیت پالت',
        render: (p) => `<span class="chip">${PK.PALLET_STATUS_LABELS[p.palletStatus]}</span>`,
        tokens: (p) => [PK.PALLET_STATUS_LABELS[p.palletStatus]],
      },
      planState: {
        key: 'planState', label: 'وضعیت در برنامه',
        render: (p) => {
          const pkg = pkgByMain.get(p);
          const label = PK.PLAN_STATE_LABELS[p.planState] || '—';
          return pkg
            ? `${U.escapeHtml(label)} — <b>بستهٔ ${U.faNum(pkg.no)}</b>`
            : U.escapeHtml(label);
        },
        tokens: (p) => [PK.PLAN_STATE_LABELS[p.planState] || ''],
      },
      warehouse: {
        key: 'warehouse', label: 'انبار',
        render: (p) => U.escapeHtml(p.warehouse || '—'),
        tokens: (p) => [p.warehouse || ''],
      },
      productionDate: {
        key: 'productionDate', label: 'تاریخ تولید',
        render: (p) => U.escapeHtml(U.faDateTime(p.record.productionDate)),
        tokens: (p) => [String(p.record.productionDate ?? '')],
      },
      actions: {
        key: 'actions', label: 'عملیات', filterable: false, width: 100,
        render: (p) => `<button type="button" class="btn btn-ghost btn-sm" data-pack-pal2="${U.escapeHtml(p.palletNo)}">جزئیات</button>`,
      },
    };
  };

  PackagingView.renderPalletsTable = function (plan) {
    if (!plan) return;
    const ctl = PackagingView.ctls.pallets;
    const s = plan.stats;
    document.getElementById('pack-pallets-stats').textContent =
      `${U.faNum(s.inScope)} پالت در برنامه — ${U.faNum(s.completePallets)} کامل · ${U.faNum(s.partial)} ناقص · ` +
      `${U.faNum(s.empty)} خالی · ${U.faNum(s.excluded)} مستثنا · ${U.faNum(s.soldPallets)} فروخته‌شده (کنار)`;

    const rows = ctl.applySort(plan.pallets.filter((p) => p.inScope));

    const wrap = document.getElementById('pack-pallets-table');
    const registry = PackagingView.palletsColumns(plan);
    ctl.applyWidths(registry);
    const columns = ctl.visibleColumns(registry);
    PackagingView.state.tables.pallets.visibleRows = ctl.cfg.visibleRows;

    UI.filterTable(wrap, columns, rows, {
      state: PackagingView.state.tables.pallets,
      tableClass: 'cut-table',
      maxDomRows: RM.config.PACK_MAX_DOM_ROWS,
      emptyText: 'پالتی درون برنامه وجود ندارد.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن · دکمهٔ «≠» = شامل نشود · ستون «وضعیت در برنامه» نتیجهٔ بسته‌بندی همان پالت است',
      onRowsChange: (n) => { ctl.cfg.visibleRows = n; ctl.save(); },
      tools: [
        { id: 'pack-pallets-cols-toggle', label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: ctl.cfg.colsVisible },
        { id: 'pack-pallets-sort-toggle', label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: ctl.cfg.sortVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'pack-pallets-cols-toggle') {
          ctl.cfg.colsVisible = !ctl.cfg.colsVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('pallets'));
        } else if (toolId === 'pack-pallets-sort-toggle') {
          ctl.cfg.sortVisible = !ctl.cfg.sortVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('pallets'));
        }
      },
      onRendered: () => {
        wrap.querySelectorAll('[data-pack-pal2]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const p = plan.pallets.find((x) => x.palletNo === btn.dataset.packPal2);
            if (p) PackagingView.showPalletModal(p, plan);
          });
        });
      },
    });

    PackagingView.renderSortBuilderFor('pallets');
    PackagingView.renderColsBuilderFor('pallets', registry);
    PackagingView.applyPanelsFor('pallets');
  };

  /* ---------------- مودال جزئیات پالت (§23) ---------------- */

  PackagingView.showPalletModal = function (p, plan) {
    const infoRow = (label, value) => `
      <div class="pack-info-item"><span>${label}</span><b>${value}</b></div>`;

    const pkgByMain = new Map(plan.packages.map((x) => [x.main, x]));
    const pkg = pkgByMain.get(p);

    const rollCols = [
      { key: 'roll', label: 'شماره رول', className: 'ltr', render: (r) => `<b>${U.escapeHtml(r.roll)}</b>` },
      {
        key: 'status', label: 'وضعیت',
        render: (r) => {
          const label = PK.ROLL_STATUS_LABELS[r.status] || r.status;
          if (r.status === 'reserve') {
            return `<span class="pack-reserve">${U.escapeHtml(label)}</span>` +
              ` <span class="muted">برای بستهٔ ${r.reserveFor.map((n) => U.faNum(n)).join('، ')}</span>`;
          }
          if (r.status === 'packed') {
            return `${U.escapeHtml(label)}${r.onCompletePallet ? ' <span class="muted">(پالت کامل)</span>' : ''}`;
          }
          return `${U.escapeHtml(label)}${r.loose ? ' <span class="muted">(مازاد جدا‌شده)</span>' : ''}`;
        },
        tokens: (r) => [PK.ROLL_STATUS_LABELS[r.status] || ''],
      },
      {
        key: 'packageNo', label: 'بسته', render: (r) => r.packageNo ? U.faNum(r.packageNo) : '<span class="muted">—</span>',
        tokens: (r) => (r.packageNo ? [String(r.packageNo)] : []),
      },
      {
        key: 'role', label: 'نقش', render: (r) => (r.role === 'main' ? 'اصلی' : r.role === 'complement' ? 'مکمل' : '—'),
        tokens: (r) => (r.role === 'main' ? ['اصلی'] : r.role === 'complement' ? ['مکمل'] : []),
      },
      {
        key: 'move', label: 'جابه‌جایی', render: (r) => r.movedToPalletNo
          ? `→ <span class="ltr">${U.escapeHtml(r.movedToPalletNo)}</span>`
          : '<span class="muted">—</span>',
        tokens: (r) => (r.movedToPalletNo ? [r.movedToPalletNo] : []),
      },
    ];

    UI.infoModal(`پالت ${U.escapeHtml(p.palletNo || '—')} — ردیابی کامل`, `
      <div class="pack-info-grid">
        ${infoRow('شناسه پالت', U.escapeHtml(p.palletId || '—'))}
        ${infoRow('نوع فیلم', U.escapeHtml(p.filmType || '—'))}
        ${infoRow('خط تولید', U.escapeHtml(p.line || '—'))}
        ${infoRow('عرض', p.width === null ? '—' : U.faWidth(p.width))}
        ${infoRow('ضخامت', p.thickness === null ? '—' : U.faNum(p.thickness))}
        ${infoRow('گرید', U.escapeHtml(p.grade || '—'))}
        ${infoRow('قطر بوبین', p.diameter === null ? 'نامشخص' : `${U.faNum(p.diameter)}″`)}
        ${infoRow('نوع اکسل', p.packTypeExcel ? U.escapeHtml(p.packTypeExcel) : 'خالی')}
        ${infoRow('نوع محاسبه‌شده', p.computedType ? U.escapeHtml(p.computedType) : '—')}
        ${infoRow('چیدمان مجاز', p.stdCapacity === null ? '—' : `${U.faNum(p.layers)} طبقه × ${U.faNum(p.rollsPerLayer)} رول (${p.direction})`)}
        ${infoRow('ظرفیت استاندارد', p.stdCapacity === null ? '—' : U.faNum(p.stdCapacity))}
        ${infoRow('اهداف', p.targets ? p.targets.map((t) => U.faNum(t)).join(' → ') : '—')}
        ${infoRow('تعداد رول', `${U.faNum(p.rollCount)}${p.stdCapacity !== null && !p.excluded ? ` از ${U.faNum(p.stdCapacity)}` : ''}`)}
        ${infoRow('انبار', U.escapeHtml(p.warehouse || '—') + (p.atBase ? ' — پای کار (سالن تولید)' : ''))}
        ${infoRow('تاریخ تولید', U.escapeHtml(U.faDateTime(p.record.productionDate)))}
        ${infoRow('وزن خالص', p.record.netWeight === null ? '—' : U.faNum(p.record.netWeight))}
        ${infoRow('وضعیت پالت', PK.PALLET_STATUS_LABELS[p.palletStatus])}
        ${infoRow('وضعیت در برنامه', pkg ? `${PK.PLAN_STATE_LABELS[p.planState]} — بستهٔ ${U.faNum(pkg.no)}` : (PK.PLAN_STATE_LABELS[p.planState] || '—'))}
      </div>
      ${p.rollObjs && p.rollObjs.length ? `
        <h4 class="pack-modal-title">رول‌های این پالت (${U.faNum(p.rollObjs.length)})</h4>
        <div id="pal-rolls-wrap"></div>` : '<p class="muted">این پالت رولی ندارد (خالی).</p>'}
    `, { wide: true });

    if (p.rollObjs && p.rollObjs.length) {
      UI.renderTable(document.getElementById('pal-rolls-wrap'), rollCols, p.rollObjs, { pageSize: 10, centered: true });
    }
  };

  /* ================================================================
     ۷) جدول رول‌ها و ردیابی (§23 + بند ۱ — توکن‌های همهٔ ستون‌ها)
     ================================================================ */

  PackagingView.rollsColumns = function () {
    return {
      roll: {
        key: 'roll', label: 'شماره رول', className: 'ltr',
        render: (r) => `<b>${U.escapeHtml(r.roll)}</b>`,
        tokens: (r) => [r.roll],
      },
      origin: {
        key: 'origin', label: 'پالت مبدأ', className: 'ltr',
        render: (r) => U.escapeHtml(r.pallet.palletNo),
        tokens: (r) => [r.pallet.palletNo],
      },
      filmType: {
        key: 'filmType', label: 'نوع فیلم',
        render: (r) => U.escapeHtml(r.pallet.filmType || '—'),
        tokens: (r) => [r.pallet.filmType || ''],
      },
      width: {
        key: 'width', label: 'عرض',
        render: (r) => U.faWidth(r.pallet.width),
        tokens: (r) => r.pallet.width === null ? [] : [U.faWidth(r.pallet.width), String(r.pallet.width)],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت',
        render: (r) => r.pallet.thickness === null ? '<span class="muted">—</span>' : U.faNum(r.pallet.thickness),
        tokens: (r) => r.pallet.thickness === null ? [] : [U.faNum(r.pallet.thickness), String(r.pallet.thickness)],
      },
      grade: {
        key: 'grade', label: 'گرید',
        render: (r) => U.escapeHtml(r.pallet.grade || '—'),
        tokens: (r) => [r.pallet.grade || ''],
      },
      diameter: {
        key: 'diameter', label: 'قطر',
        render: (r) => `${U.faNum(r.pallet.diameter)}″`,
        tokens: (r) => [String(r.pallet.diameter)],
      },
      packageNo: {
        key: 'packageNo', label: 'بسته',
        render: (r) => r.packageNo ? U.faNum(r.packageNo) : '<span class="muted">—</span>',
        tokens: (r) => (r.packageNo ? [String(r.packageNo)] : []),
      },
      role: {
        key: 'role', label: 'نقش',
        render: (r) => (r.role === 'main' ? 'اصلی' : r.role === 'complement' ? 'مکمل' : '<span class="muted">—</span>'),
        tokens: (r) => (r.role === 'main' ? ['اصلی', 'main'] : r.role === 'complement' ? ['مکمل', 'complement'] : []),
      },
      move: {
        key: 'move', label: 'انتقال',
        render: (r) => r.movedToPalletNo
          ? `→ <span class="ltr">${U.escapeHtml(r.movedToPalletNo)}</span>`
          : '<span class="muted">—</span>',
        tokens: (r) => (r.movedToPalletNo ? [r.movedToPalletNo] : []),
      },
      status: {
        key: 'status', label: 'وضعیت نهایی',
        render: (r) => {
          if (r.status === 'reserve') {
            return `<span class="pack-reserve">رزرو</span> <span class="muted">برای بستهٔ ${r.reserveFor.map((n) => U.faNum(n)).join('، ')}</span>`;
          }
          const label = PK.ROLL_STATUS_LABELS[r.status] || r.status;
          if (r.status === 'packed') {
            return `${U.escapeHtml(label)}${r.onCompletePallet ? ' <span class="muted">(پالت کامل)</span>' : ''}`;
          }
          return `${U.escapeHtml(label)}${r.loose ? ' <span class="muted">(مازاد جدا‌شده)</span>' : ''}`;
        },
        tokens: (r) => [PK.ROLL_STATUS_LABELS[r.status] || '', ...(r.reserveFor || []).map(String)],
      },
    };
  };

  PackagingView.renderRollsTable = function (plan) {
    if (!plan) return;
    const ctl = PackagingView.ctls.rolls;
    const s = plan.stats;
    document.getElementById('pack-rolls-stats').textContent =
      `${U.faNum(s.rollsInScope)} رول درون برنامه — ${U.faNum(s.rollsPacked)} بسته‌بندی‌شده · ${U.faNum(s.rollsReserve)} رزرو · ` +
      `${U.faNum(s.rollsLeftover)} باقی‌مانده · ${U.faNum(s.rollsExcluded)} مستثنا`;

    const rows = ctl.applySort(plan.rollStates);

    const wrap = document.getElementById('pack-rolls-table');
    const registry = PackagingView.rollsColumns();
    ctl.applyWidths(registry);
    const columns = ctl.visibleColumns(registry);
    PackagingView.state.tables.rolls.visibleRows = ctl.cfg.visibleRows;

    UI.filterTable(wrap, columns, rows, {
      state: PackagingView.state.tables.rolls,
      tableClass: 'cut-table',
      maxDomRows: RM.config.PACK_MAX_DOM_ROWS,
      emptyText: 'رولی درون برنامه وجود ندارد.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن · دکمهٔ «≠» = شامل نشود · ردیف‌ها بر اساس پالت مبدأ مرتب‌اند',
      onRowsChange: (n) => { ctl.cfg.visibleRows = n; ctl.save(); },
      tools: [
        { id: 'pack-rolls-cols-toggle', label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: ctl.cfg.colsVisible },
        { id: 'pack-rolls-sort-toggle', label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: ctl.cfg.sortVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'pack-rolls-cols-toggle') {
          ctl.cfg.colsVisible = !ctl.cfg.colsVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('rolls'));
        } else if (toolId === 'pack-rolls-sort-toggle') {
          ctl.cfg.sortVisible = !ctl.cfg.sortVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('rolls'));
        }
      },
    });

    PackagingView.renderSortBuilderFor('rolls');
    PackagingView.renderColsBuilderFor('rolls', registry);
    PackagingView.applyPanelsFor('rolls');
  };

  /* ================================================================
     ۸) خروجی اکسل برنامهٔ بسته‌بندی (بند ۱۱ + ۳٫۱۴ بند ۳ — استایل‌دار)
     ================================================================
     ستون‌ها (به‌ترتیب): «لیست پالت و رول ها» (شمارهٔ هر پالت و زیر آن
     شمارهٔ رول‌های همان پالت — هرکدام در یک سلول) · «رول های رزرو» (زیر
     هم، هر رول یک سلول) · فیلم · عرض · ضخامت · گرید · قطر · ظرفیت نهایی.
     فقط بسته‌های قابل نمایش جدول (پس از فیلترهای فعال) صادر می‌شوند.

     ۳٫۱۴ بند ۳ — استایل (ExcelJS):
       · دور ردیف‌های هر بسته Thick Outside Border
       · رنگ یک‌درمیان بلوک‌ها: #DCE6F1 (آبی کم‌رنگ) و #EBF1DE (سبز کم‌رنگ)
       · همهٔ سلول‌ها: Middle Align + Center + جهت متن راست‌به‌چپ
       · فریز ردیف اول (هدر سرستون‌ها) + شیت راست‌به‌چپ

     ۳٫۱۷ بند ۵ — درشت‌نویسی و رنگ‌بندی گرید:
       · شمارهٔ پالت‌های ستون «لیست پالت و رول ها»: بولد و درشت‌تر (۱۲)
       · مقادیر ستون‌های فیلم/عرض/ضخامت/گرید/قطر/ظرفیت نهایی: بولد و درشت‌تر (۱۲)
       · رنگ سلول گرید بر اساس مقدار: X → #00B050 (سبز، متن سفید) ·
         U → #AFDC7E (سبز روشن) · Q → #FFC000 (کهربایی)
     ۳٫۱۷ بند ۶ — بسته‌های ترکیبی U+X:
       · سایر ستون‌ها (جز گرید) با رنگ هایلایت نارنجی #FDE9D9
       · ستون گرید به‌جای یک سلول ادغام‌شده، خط‌به‌خط هم‌تراز رول‌ها/
         شمارهٔ پالت‌ها درج می‌شود؛ هر سلول با رنگ کد گرید همان رول/پالت
     ۳٫۱۹ بند ۳ — ردیف عنوان با تاریخ شمسی بالای هدر:
       · ردیف ۱ = عنوان سند + «تاریخ: ۱۴۰۵/۰۶/۳۰، ۱۴:۳۰» (هجری شمسی)
         ادغام‌شده روی همهٔ ۸ ستون · هدر سرستون‌ها = ردیف ۲ (فریز ySplit:2)
         · نام فایل هم با مهر تاریخ شمسی
     ۳٫۱۹ بند ۲ — بوردرگذاری ضخیم در «مرحلهٔ آخر»:
       · پس از نوشتن همهٔ مقادیر/فونت‌ها/رنگ‌ها/ادغام‌ها، یک پاس نهایی دور
         کامل محدودهٔ هر بسته Thick Border می‌کشد — روی همهٔ سلول‌های لبه
         (بالا/پایین/چپ/راست، شامل سلول‌های ادغام‌شده) تا هیچ مرحله‌ای
         (ادغام/رنگ‌آمیزی گرید و…) نتواند آن را بازنشسته یا پاک کند */
  PackagingView.exportPlanExcel = async function () {
    const plan = PackagingView._plan;
    const btn = document.getElementById('pack-excel-btn');
    if (!plan || !plan.packages.length) {
      UI.toast('برنامه‌ای برای خروجی گرفتن نیست — ابتدا فایل مدیریت پالت‌ها را وارد کنید.', 'warning');
      return;
    }
    if (typeof ExcelJS === 'undefined' || !ExcelJS.Workbook) {
      UI.toast('کتابخانهٔ اکسل استایل‌دار (ExcelJS) بارگذاری نشده است.', 'error');
      return;
    }

    /* همان ردیف‌های قابل نمایش جدول: مرتب‌سازی کاربر + فیلترهای فعال */
    const ctl = PackagingView.ctls.plan;
    const registry = PackagingView.planColumns();
    const columns = ctl.visibleColumns(registry);
    const sorted = ctl.applySort(plan.packages.filter((p) => p.type !== 'as-is'));
    const visible = PackagingView.filterRows(sorted, columns, PackagingView.state.tables.plan);

    if (!visible.length) {
      UI.toast('با فیلترهای فعلی هیچ بسته‌ای قابل نمایش نیست — خروجی اکسل خالی می‌شد.', 'warning');
      return;
    }

    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'در حال ساخت اکسل…'; }
    try {
      /* --- ثابت‌های استایل (۳٫۱۴ بند ۳ + ۳٫۱۷ بندهای ۵/۶) --- */
      const FILL_BLUE = 'FFDCE6F1';    // آبی کم‌رنگ
      const FILL_GREEN = 'FFEBF1DE';   // سبز کم‌رنگ
      const FILL_MIXED = 'FFFDE9D9';   // ۳٫۱۷ بند ۶ — هایلایت نارنجی بسته‌های ترکیبی
      const HEAD_BG = 'FF134E4A';      // سربرگ — سبز-فیروزه‌ای تیرهٔ تم
      const THICK = { style: 'thick', color: { argb: 'FF000000' } };
      const ALIGN = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
      /* ۳٫۱۷ بند ۵ — رنگ سلول گرید بر اساس کد گرید + رنگ متن هر کدام */
      const GRADE_STYLE = {
        X: { fill: 'FF00B050', font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } } },
        U: { fill: 'FFAFDC7E', font: { bold: true, size: 12, color: { argb: 'FF1F2937' } } },
        Q: { fill: 'FFFFC000', font: { bold: true, size: 12, color: { argb: 'FF1F2937' } } },
      };
      const gradeStyleOf = (v) => GRADE_STYLE[gradeKeyOf(v)] || null;

      const wb = new ExcelJS.Workbook();
      wb.creator = 'سامانه مانیتورینگ متالایز';
      /* شیت راست‌به‌چپ + فریز عنوان و هدر (۳٫۱۹ بند ۳: عنوان ردیف ۱ +
         هدر ردیف ۲ — ySplit:2) */
      const ws = wb.addWorksheet('برنامه بسته‌بندی', {
        views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
      });
      /* ۳٫۱۹ بند ۳ — ردیف عنوان سند با تاریخ شمسی (ادغام روی همهٔ ستون‌ها) */
      const TITLE_ROW = 1;
      const HEAD_ROW = 2;
      const FIRST_DATA_ROW = 3;
      const titleCell = ws.getCell(TITLE_ROW, 1);
      titleCell.value = `برنامه بسته‌بندی — سامانه مانیتورینگ متالایز · تاریخ: ${U.faDate(Date.now())} (هجری شمسی)`;
      titleCell.font = { bold: true, size: 12, color: { argb: 'FF134E4A' } };
      titleCell.alignment = ALIGN;
      ws.getRow(TITLE_ROW).height = 22;
      ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, 8);
      ws.getRow(HEAD_ROW).values = [
        'لیست پالت و رول ها',
        'رول های رزرو',
        'فیلم',
        'عرض',
        'ضخامت',
        'گرید',
        'قطر',
        'ظرفیت نهایی',
      ];
      ws.columns = [
        { width: 28 },
        { width: 26 },
        { width: 12 },
        { width: 9 },
        { width: 10 },
        { width: 10 },
        { width: 8 },
        { width: 15 },
      ];

      /* --- بلوک هر بسته: ستون A/B ردیف‌به‌ردیف + مشخصات ادغام‌شده ---
         ۳٫۱۹ بند ۲: بوردر در همین حلقه زده نمی‌شود — همهٔ بوردرها در
         «پاس نهایی» پس از ادغام‌ها اعمال می‌شوند (مرحلهٔ آخر ساخت اکسل)
         تا هیچ مرحلهٔ بعدی نتواند آن‌ها را بازنشسته کند. */
      const blockRanges = [];   // محدودهٔ هر بسته برای پاس بوردر نهایی
      let r = FIRST_DATA_ROW;
      visible.forEach((pkg, bi) => {
        const startR = r;
        const mixed = !!pkg.mixedGrid;   // ۳٫۱۷ بند ۶ — بستهٔ ترکیبی U+X
        /* ستون A: شمارهٔ پالت (خط لاتین) + رول‌هایش زیر آن؛ هر خط با نوع و
           گریدِ خودش تا ستون گرید ترکیبی هم‌تراز همین خط‌ها درج شود */
        const listCol = [];
        for (const pt of pkg.palletParts) {
          listCol.push({ v: pt.palletNo, kind: 'pallet', grade: pt.pallet ? pt.pallet.grade : null });
          for (const robj of pt.rolls) {
            listCol.push({ v: robj.roll, kind: 'roll', grade: robj.pallet ? robj.pallet.grade : null });
          }
        }
        const reserveCol = pkg.reserveRolls.map((x) => x.roll);
        const blockH = Math.max(listCol.length, reserveCol.length, 1);

        for (let i = 0; i < blockH; i++) {
          const row = ws.getRow(r + i);
          const item = listCol[i];
          row.getCell(1).value = item ? item.v : '';
          /* ۳٫۱۷ بند ۵ — شمارهٔ پالت‌ها بولد و درشت‌تر از رول‌ها */
          row.getCell(1).font = (item && item.kind === 'pallet')
            ? { bold: true, size: 12 }
            : { size: 11 };
          row.getCell(2).value = reserveCol[i] ?? '';
          if (i === 0) {
            row.getCell(3).value = pkg.filmType || '';
            row.getCell(4).value = pkg.width === null ? '—' : pkg.width;
            row.getCell(5).value = pkg.thickness === null ? '—' : pkg.thickness;
            /* ۳٫۱۷ بند ۶ — بستهٔ ترکیبی: ستون گرید خط‌به‌خط (هم‌تراز ستون A)
               درج می‌شود؛ خط صفر = گرید پالت اصلی (نخستین خط ستون A) */
            row.getCell(6).value = mixed
              ? (gradeKeyOf(listCol[0] && listCol[0].grade) || gradeKeyOf(pkg.grade))
              : pkg.grade || '';
            row.getCell(7).value = pkg.diameter;
            row.getCell(8).value = `${pkg.finalCount} از ${pkg.stdCapacity}`;
            /* ۳٫۱۷ بند ۵ — مقادیر شش ستون مشخصات بولد و درشت‌تر */
            for (let cc = 3; cc <= 8; cc++) row.getCell(cc).font = { bold: true, size: 12 };
          }
          /* ۳٫۱۷ بند ۶ — بستهٔ ترکیبی: خط‌های بعدی ستون گرید = گرید رول/پالت
             هم‌تراز همان خط در ستون A (خط pallet = گرید پالت، خط roll = گرید رول) */
          if (mixed && i > 0) {
            row.getCell(6).value = item ? (gradeKeyOf(item.grade) || '') : '';
          }
        }
        r += blockH;
        const endR = r - 1;
        blockRanges.push({ startR, endR });

        /* استایل بلوک: رنگ یک‌درمیان (ترکیبی = نارنجی هایلایت) + وسط‌چین/مرکز/RTL
           (بوردر دور بلوک در «مرحلهٔ آخر» پس از ادغام‌ها زده می‌شود — ۳٫۱۹ بند ۲) */
        const blockFill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: mixed ? FILL_MIXED : (bi % 2 === 0 ? FILL_BLUE : FILL_GREEN) },
        };
        for (let rr = startR; rr <= endR; rr++) {
          for (let cc = 1; cc <= 8; cc++) {
            const cell = ws.getCell(rr, cc);
            /* ۳٫۱۷ بند ۵ — سلول گرید بسته‌های عادی با رنگ کد گرید رنگ می‌شود
               (ادغام‌شده — فقط سلول رأس کافی است) */
            if (cc === 6 && !mixed && rr === startR) {
              const gs = gradeStyleOf(pkg.grade);
              if (gs) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gs.fill } };
                cell.font = gs.font;
                cell.alignment = ALIGN;
                continue;
              }
            }
            cell.fill = blockFill;
            cell.alignment = ALIGN;
          }
          /* ۳٫۱۷ بند ۶ — بستهٔ ترکیبی: سلول گرید هر خط با رنگ کد گرید همان خط */
          if (mixed) {
            const item = listCol[rr - startR];
            const gs = gradeStyleOf(item ? item.grade : null);
            const gcell = ws.getCell(rr, 6);
            if (gs) {
              gcell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gs.fill } };
              gcell.font = gs.font;
            } else {
              gcell.fill = blockFill;
              gcell.font = { bold: true, size: 12 };
            }
          }
        }
        /* ادغام عمودی ستون‌های مشخصات روی بلوک این بسته — بستهٔ ترکیبی:
           ستون گرید (۶) ادغام نمی‌شود (خط‌به‌خط هم‌تراز رول‌هاست) */
        if (blockH > 1) {
          for (let cc = 3; cc <= 8; cc++) {
            if (mixed && cc === 6) continue;
            ws.mergeCells(startR, cc, endR, cc);
          }
        }
      });

      /* --- استایل هدر (ردیف ۲ — فریزشده) --- */
      const headRow = ws.getRow(HEAD_ROW);
      headRow.height = 24;
      headRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
        cell.alignment = ALIGN;
        cell.border = { bottom: THICK };
      });

      /* --- ۳٫۱۹ بند ۲ — پاس نهایی بوردر ضخیم: «مرحلهٔ آخر» ساخت اکسل ---
         همهٔ مقادیر/فونت‌ها/رنگ‌ها/ادغام‌ها نوشته شده‌اند؛ اکنون دور کامل
         محدودهٔ هر بسته Thick Border زده می‌شود — روی همهٔ سلول‌های لبه
         (بالا/پایین/چپ/راست). برای محدوده‌های ادغام‌شده، اکسل بوردرِ لبهٔ
         هر محدوده را از بوردر «سلول‌های واقعیِ همان لبه» می‌گیرد؛ پس بوردر
         روی تک‌تک سلول‌های لبه ست می‌شود (با حفظ بوردرهای قبلی همان سلول)
         و هیچ مرحلهٔ بعدی (ادغام/رنگ‌آمیزی گرید و…) نمی‌تواند آن را پاک کند. */
      const borderOf = (cell) => {
        const b = cell && cell.border;
        return (b && typeof b === 'object') ? { ...b } : {};
      };
      for (const { startR, endR } of blockRanges) {
        for (let cc = 1; cc <= 8; cc++) {
          const topCell = ws.getCell(startR, cc);
          topCell.border = { ...borderOf(topCell), top: THICK };
          const botCell = ws.getCell(endR, cc);
          botCell.border = { ...borderOf(botCell), bottom: THICK };
        }
        for (let rr = startR; rr <= endR; rr++) {
          const leftCell = ws.getCell(rr, 1);
          leftCell.border = { ...borderOf(leftCell), left: THICK };
          const rightCell = ws.getCell(rr, 8);
          rightCell.border = { ...borderOf(rightCell), right: THICK };
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      /* ۳٫۱۹ بند ۳ — مهر تاریخ شمسی در نام فایل (تاریخ روی سند هم در
         ردیف عنوان بالا به هجری شمسی درج شده است) */
      const stamp = PackagingView.graphJalaliStamp();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `برنامه-بسته-بندی_${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      UI.toast(
        `خروجی اکسل استایل‌دار ساخته شد — ${U.faNum(visible.length)} بسته (${U.faNum(r - FIRST_DATA_ROW)} ردیف) با بوردر ضخیم دور محدودهٔ هر بسته (پاس نهایی پس از ادغام‌ها)، عنوان و تاریخ شمسی، رنگ یک‌درمیان آبی/سبز (ترکیبی‌ها نارنجی ${U.faNum(visible.filter((p) => p.mixedGrid).length)} بسته)، پالت‌ها و مقادیر مشخصات بولد/درشت، رنگ‌بندی گرید X/U/Q، وسط‌چین RTL و هدر فریزشده.`,
        'success', 5200
      );
    } catch (err) {
      console.error('[PackExcel]', err);
      UI.toast(`ساخت فایل اکسل با خطا مواجه شد (${U.escapeHtml(String(err.message || err).slice(0, 90))}).`, 'error', 6500);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; btn.blur(); }
    }
  };

  /* ================================================================
     ۹) نمایش گرافیکی (۳٫۱۶ — چیدمان آزاد ۳٫۱۳)
     ================================================================
     مسیر داده (۳٫۱۴ بند ۷ / ۳٫۱۵ بند ۳): جدول «برنامهٔ بسته‌بندی» →
     جدول واسط قابل ویرایش «لیست بسته های قابل نمایش» (ترتیب / حذف بسته /
     حذف و بازگردانی پالت / ویرایش عمیق مودال) → کارت‌های این صفحه از
     همان طرح تغذیه می‌شوند و با هر ویرایش بلافاصله به‌روز می‌شوند.
     چیدمان (۳٫۱۶ بند ۱): آزاد مانند ۳٫۱۳ — گرید auto-fill با حداقل
     عرض ۳۴۰px، مستقیم در پنل؛ هر کارت هم‌اندازهٔ محتوای خودش است
     (بدون سلول ثابت، بدون جای خالی، بدون اسکرول داخلی) و صفحه، عرض
     کامل پنل را پر می‌کند (۳٫۱۶ بند ۴).
     کارت (۳٫۱۶ بندهای ۲/۳/۵): سربرگ = عنوان رنگی + «ظرفیت n از m» +
     «N پالت · M رول» (بج نوع بسته حذف شد)؛ نوار مشخصات ۵ چیپ؛ ردیف‌های
     پالت یک‌ردیف‌درمیان نارنجی/سبز با همان سبک کم‌رنگ/پررنگ؛ بدون نوار
     رزرو. تعداد بسته در هر صفحه: عدد آزاد کاربر (۳٫۱۵ بند ۲).
     خروجی: تصویر = صفحهٔ فعلی (عرض A4، ارتفاع کامل)؛ PDF = همهٔ صفحات
     با برش خودکار به برگه‌های A4 عمودی. */

  /** تبدیل رنگ hex به rgba — html2canvas نسخهٔ فعلی color-mix و گاهی
   *  hex-۸رقمی را پشتیبانی نمی‌کند؛ همهٔ رنگ‌های شفاف کارت با rgba ست می‌شوند */
  function pgRgba(hex, alpha) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** پالت‌های مؤثر نمایش یک بسته — همهٔ ویرایش‌های مودال اعمال می‌شود
   *  (۳٫۱۵ بند ۳): حذف پالت + حذف رول تکی + رول دستی‌افزوده + پالت دستی.
   *  هیچ‌کدام برنامهٔ واقعی بسته‌بندی را تغییر نمی‌دهند — فقط نمایش‌اند. */
  PackagingView.graphPartsOf = function (pkg) {
    const st = PackagingView.state;
    const removedPallets = new Set(st.graphRemoved[pkg.no] || []);
    const removedRolls = new Set((st.graphEdits.rollRemoved[pkg.no]) || []);
    const addedRolls = st.graphEdits.rollAdded[pkg.no] || {};
    const parts = pkg.palletParts
      .filter((pt) => !removedPallets.has(pt.palletNo))
      .map((pt) => ({
        palletNo: pt.palletNo,
        atBase: pt.atBase,
        warehouse: pt.warehouse,
        isMain: pt.isMain,
        grade: pt.pallet ? pt.pallet.grade : null,   // ۳٫۱۷ بند ۶ — گرید پالت برای ستون گرید ترکیبی
        manual: false,
        rolls: [
          ...pt.rolls.filter((robj) => !removedRolls.has(robj.roll))
            .map((robj) => ({ roll: robj.roll, manual: false, grade: robj.pallet ? robj.pallet.grade : null })),
          ...(addedRolls[pt.palletNo] || []).map((roll) => ({ roll, manual: true, grade: null })),
        ],
      }));
    for (const mp of (st.graphEdits.palletAdded[pkg.no] || [])) {
      parts.push({
        palletNo: mp.palletNo,
        atBase: false,
        warehouse: null,
        isMain: false,
        grade: null,
        manual: true,
        rolls: (mp.rolls || []).map((roll) => ({ roll, manual: true, grade: null })),
      });
    }
    return parts;
  };

  /** مشخصات نمایشی یک بسته (۳٫۱۵ بند ۳ — override مودال ویرایش) */
  PackagingView.graphSpecOf = function (pkg) {
    const o = (PackagingView.state.graphEdits.spec || {})[pkg.no] || {};
    const val = (k, fallback) => {
      const v = o[k];
      return (v === undefined || v === null || String(v).trim() === '') ? fallback : v;
    };
    return {
      filmType: val('filmType', pkg.filmType),
      width: val('width', pkg.width),
      thickness: val('thickness', pkg.thickness),
      /* ۳٫۱۷ بند ۶: بستهٔ ترکیبی — برچسب گرید = «U + X» (مگر آنکه کاربر
         در مودال ویرایش، override دستی گذاشته باشد) */
      grade: val('grade', pkg.mixedGrid && Array.isArray(pkg.mixedGrades) && pkg.mixedGrades.length > 1
        ? pkg.mixedGrades.join(' + ')
        : pkg.grade),
      computedType: val('computedType', pkg.computedType),
    };
  };

  /** ساخت HTML کارت یک بسته (مشترک نمایش و خروجی)
   *  ۳٫۱۶ — چیدمان آزاد: کارت هیچ اندازهٔ ثابتی ندارد و هم‌اندازهٔ
   *  محتوای خودش است — پالت‌ها/رول‌های زیاد فقط آن را بلندتر می‌کنند.
   *  سربرگ روشن با عنوان رنگی + «ظرفیت n از m» (۳٫۱۶ بند ۲ — جای بج
   *  «تشکیل جدید») + «N پالت · M رول» + عدد «عرض» بزرگ و بولد در سمت چپ
   *  نوار (۳٫۱۹ بند ۵ — جایگزین چیپ عرض نوار مشخصات) + دکمهٔ مداد ویرایش
   *  و × · نوار مشخصات با ۴ چیپ مستطیلی (فیلم/ضخامت/گرید/نوع بسته —
   *  ۳٫۱۹ بند ۵: عرض به سربرگ منتقل شد) · مینی‌کارت پالت با سرصفحهٔ
   *  شماره و شمارهٔ پالت و بج «انبار/⚡ پای کار/دستی» و «N رول» +
   *  رول‌های عمودی مونواسپیس.
   *  ۳٫۱۸ بند ۲ — تک‌رنگ شدن کارت: کادر پالت‌ها و پس‌زمینهٔ آن‌ها و شمارهٔ
   *  ترتیب از همان تم کارت رنگ می‌گیرند (rgba مستقیم در applyGraphAccents؛
   *  رنگ دوم نارنجی/سبز یک‌درمیان حذف شد) و فونت شمارهٔ رول‌ها دو درجه
   *  بزرگ‌تر و مشکی (هم‌رنگ شمارهٔ پالت) شد.
   *  ۳٫۱۷ بند ۳ — دو تم رنگی یک‌ردیف‌درمیان: رنگ هویتی کارت دیگر در
   *  HTML درج نمی‌شود؛ پس از چیدمان، applyGraphAccents تعداد ستون‌های
   *  واقعی گرید را می‌خواند و به هر «ردیف» از کارت‌ها یکی از دو تم
   *  GRAPH_ROW_THEMES را می‌دهد (همان ویژگی‌های همیشگی تم — سازگار با
   *  html2canvas با rgba مستقیم). چیپ گرید بستهٔ ترکیبی = «U + X» (۳٫۲۰
   *  بند ۳ — نشان «تأیید QC» فقط در نوار بالایی کارت باقی است و از چیپ
   *  گرید نوار مشخصات حذف شد). */
  PackagingView.graphCardHtml = function (pkg, globalIdx, opts = {}) {
    const removable = !opts.pdf;
    const spec = PackagingView.graphSpecOf(pkg);
    const parts = PackagingView.graphPartsOf(pkg);
    const rollsCount = parts.reduce((s, pt) => s + pt.rolls.length, 0);

    const palletsHtml = parts.map((pt, i) => {
      /* ۳٫۱۸ بند ۲: کادر هر پالت و پس‌زمینه‌اش دیگر رنگ دوم (نارنجی/سبز)
         ندارند — همه‌چیز از «تم همان کارت» رنگ می‌گیرد؛ رنگ‌ها پس از چیدمان
         در applyGraphAccents با rgba مستقیم (سازگار با html2canvas) ست
         می‌شوند تا با تم ردیفِ کارت (سبز زمردی / رز) هماهنگ بمانند */
      return `
      <div class="pg-pallet${pt.atBase ? ' at-base' : ''}">
        <div class="pg-pal-head">
          <span class="pg-pal-idx">${U.faNum(i + 1)}</span>
          <span class="pg-pal-no ltr" title="${U.escapeHtml(pt.palletNo)}${pt.manual ? ' — پالت دستی (فقط نمایش)' : pt.atBase ? ' — پای کار (سالن تولید)' : ` — ${U.escapeHtml(pt.warehouse || 'انبار')}`}">${U.escapeHtml(pt.palletNo)}</span>
          ${pt.manual
            ? '<span class="pg-wh-badge" title="پالت دستی‌افزوده — فقط برای نمایش">دستی</span>'
            : pt.atBase
              ? '<span class="pk-base-badge">⚡ پای کار</span>'
              : `<span class="pg-wh-badge" title="${U.escapeHtml(pt.warehouse || '—')}">انبار</span>`}
          <span class="pg-pal-count">${U.faNum(pt.rolls.length)} رول</span>
        </div>
        <div class="pg-rolls">
          ${pt.rolls.map((robj) => `<span class="pg-roll ltr"${robj.grade ? ` title="گرید ${U.escapeHtml(String(robj.grade))}"` : ''}>${U.escapeHtml(robj.roll)}</span>`).join('')}
        </div>
      </div>`;
    }).join('');

    /* ۳٫۱۹ بند ۵ — «عرض» از نوار مشخصات به نوار بالایی کارت منتقل شد:
       سمت چپ نوار (پس از فضای کشسان) با فونت بزرگ و بولد و رنگ تم کارت؛
       نوار مشخصات اکنون ۴ چیپ مستطیلی (فیلم/ضخامت/گرید/نوع بسته) دارد.
       ۳٫۱۹ بند ۴ — کنار ضربدر، دکمهٔ مداد بولد و نمایان: همان مودال
       ویرایش دکمهٔ «ویرایش» جدول لیست را باز می‌کند (فقط در نمایش). */
    return `
      <div class="pg-card" data-pg-card="${pkg.no}">
        <div class="pg-head">
          <span class="pg-title">بستهٔ ${U.faNum(pkg.no)}</span>
          <span class="pg-cap">ظرفیت ${U.faNum(rollsCount)} از ${U.faNum(pkg.stdCapacity)}</span>
          <span class="pg-meta">${U.faNum(parts.length)} پالت · ${U.faNum(rollsCount)} رول</span>
          ${pkg.mixedGrid ? '<span class="pg-mixed-badge" title="بستهٔ ترکیبی گرید U+X — پیش از ارسال باید توسط واحد کنترل کیفیت تأیید شود">ترکیبی · تأیید QC</span>' : ''}
          <span class="pg-width" title="عرض این بسته (میلی‌متر)"><i>عرض</i><b>${U.faWidth(spec.width)}</b></span>
          ${removable ? `<button type="button" class="pg-edit" data-pg-edit="${pkg.no}" title="ویرایش این بسته — همان پنجرهٔ ویرایش جدول «لیست بسته های قابل نمایش»: مشخصات، حذف/افزودن پالت و رول" aria-label="ویرایش بستهٔ ${U.faNum(pkg.no)}">${PG_PENCIL_SVG}</button>` : ''}
          ${removable ? `<button type="button" class="pg-remove" data-pg-remove="${pkg.no}" title="حذف از نمایش گرافیکی" aria-label="حذف بستهٔ ${U.faNum(pkg.no)} از نمایش">×</button>` : ''}
        </div>
        <div class="pg-specs">
          <span class="pg-spec"><i>فیلم</i><b>${U.escapeHtml(spec.filmType)}</b></span>
          <span class="pg-spec"><i>ضخامت</i><b>${spec.thickness === null || spec.thickness === undefined ? '—' : U.faNum(spec.thickness)}</b></span>
          <span class="pg-spec"><i>گرید</i><b>${U.escapeHtml(spec.grade || '—')}</b></span>
          <span class="pg-spec"><i>نوع بسته</i><b>${U.escapeHtml(spec.computedType)}</b></span>
        </div>
        <div class="pg-pallets">${palletsHtml}</div>
      </div>`;
  };

  /** اعمال دو تم رنگی یک‌ردیف‌درمیان روی کارت‌های یک گرید (۳٫۱۷ بند ۳).
   *  تعداد ستون‌های «واقعی» گرید auto-fill از استایل محاسبه خوانده می‌شود؛
   *  هر ردیف (⌊i/ستون‌ها⌋) یکی از دو تم GRAPH_ROW_THEMES را می‌گیرد. رنگ‌ها
   *  به‌صورت rgba مستقیم روی عناصر ست می‌شوند (سازگار با html2canvas) —
   *  همان ویژگی‌های تم همیشگی: سربرگ کم‌رنگ + عنوان/ظرفیت پررنگ + خط
   *  تأکیدی بالای کارت از طریق --pg-accent. اگر گرید مخفی باشد (نمای
   *  فعال نیست) کاری نمی‌کند تا هنگام نمایان شدن دوباره صدا شود. */
  PackagingView.applyGraphAccents = function (grid) {
    if (!grid || !grid.querySelectorAll) return false;
    const cards = [...grid.querySelectorAll('.pg-card')];
    if (!cards.length) return false;
    if (!grid.offsetParent && !grid.getClientRects().length) return false;   // مخفی است
    let cols = 1;
    try {
      const tpl = getComputedStyle(grid).gridTemplateColumns || '';
      const parts = tpl.split(' ').filter((x) => x && x !== 'none');
      if (parts.length) cols = Math.max(1, parts.length);
    } catch (e) { /* noop */ }
    cards.forEach((card, i) => {
      const accent = GRAPH_ROW_THEMES[Math.floor(i / cols) % GRAPH_ROW_THEMES.length];
      card.style.setProperty('--pg-accent', accent);
      const head = card.querySelector('.pg-head');
      if (head) {
        head.style.borderColor = pgRgba(accent, 0.35);
        head.style.background = pgRgba(accent, 0.06);
      }
      const title = card.querySelector('.pg-title');
      if (title) title.style.color = accent;
      const cap = card.querySelector('.pg-cap');
      if (cap) cap.style.color = accent;
      /* ۳٫۱۹ بند ۵ — عدد «عرض» در نوار بالایی کارت نیز از تم همان کارت
         رنگ می‌گیرد (بزرگ و بولد در سمت چپ نوار) */
      const widthB = card.querySelector('.pg-width b');
      if (widthB) widthB.style.color = accent;
      /* ۳٫۱۸ بند ۲: کادر پالت‌ها، پس‌زمینهٔ آن‌ها و شمارهٔ ترتیب‌شان نیز از
         «همان تم کارت» رنگ می‌گیرند — کارت تک‌رنگ است (rgba مستقیم،
         سازگار با html2canvas) */
      card.querySelectorAll('.pg-pallet').forEach((pal) => {
        pal.style.borderColor = pgRgba(accent, 0.4);
        pal.style.background = pgRgba(accent, 0.06);
      });
      card.querySelectorAll('.pg-pal-idx').forEach((idx) => {
        idx.style.color = accent;
        idx.style.background = pgRgba(accent, 0.12);
        idx.style.borderColor = pgRgba(accent, 0.45);
      });
    });
    return true;
  };

  /** رندر نمای نمایش گرافیکی (کارت‌ها — ۳٫۱۵: دو پنل تفکیک‌شده)
   *  ۳٫۱۶ بند ۱ و ۴: چیدمان آزاد ۳٫۱۳ — گرید auto-fill مستقیم در پنل؛
   *  صفحه عرض کامل پنل را پر می‌کند و هر کارت هم‌اندازهٔ محتوای خودش
   *  است (بدون سلول ثابت/جای خالی/اسکرول داخلی). ۳٫۱۸ بند ۳: صفحه‌بندی
   *  نمایش حذف شد — همهٔ بسته‌های انتخابی یکجا چیده می‌شوند و صفحه‌بندی
   *  فقط برای برگه‌های خروجی (جهت صفحه + تعداد ستون) محاسبه می‌شود. */
  PackagingView.renderGraphView = function (plan) {
    const wrap = document.getElementById('pack-graph-wrap');
    const statsEl = document.getElementById('pack-graph-stats');
    if (!wrap) return;

    /* ۳٫۱۵ بند ۴: جدول «لیست بسته های قابل نمایش» پنل خودش را دارد و
       همیشه (حتی خالی) رندر می‌شود تا فیلترها/پنل‌ها/ترتیب در دسترس بمانند */
    PackagingView.renderGraphList(plan);

    const emptyHtml = '<div class="empty-state">' + UI.icons.alert +
      '<h4>بسته‌ای انتخاب نشده است</h4><p>از جدول «برنامهٔ بسته‌بندی» بسته‌های دلخواه را با دکمهٔ «+ نمایش» به لیست بسته‌های قابل نمایش اضافه کنید.</p></div>';

    if (!plan) {
      if (statsEl) statsEl.textContent = '';
      wrap.innerHTML = emptyHtml;
      return;
    }

    /* حذف انتخاب‌های منقضی (بسته‌ای که دیگر وجود ندارد) + حذفیات نامعتبر */
    const pkgMap = new Map(plan.packages.map((x) => [x.no, x]));
    const seen = new Set();
    const validOrder = [];
    let stale = false;
    for (const no of PackagingView.state.graphOrder) {
      if (!pkgMap.has(no) || seen.has(no)) { stale = true; continue; }
      seen.add(no);
      validOrder.push(no);
    }
    if (validOrder.length !== PackagingView.state.graphOrder.length) stale = true;
    PackagingView.state.graphOrder = validOrder;
    const removedMap = PackagingView.state.graphRemoved;
    for (const key of Object.keys(removedMap)) {
      const pkg = pkgMap.get(Number(key));
      if (!pkg) { delete removedMap[key]; stale = true; continue; }
      const partNos = new Set(pkg.palletParts.map((pt) => pt.palletNo));
      const valid = (removedMap[key] || []).filter((pn) => partNos.has(pn));
      if (valid.length !== (removedMap[key] || []).length) { removedMap[key] = valid; stale = true; }
      if (!valid.length) { delete removedMap[key]; stale = true; }
    }
    /* پاک‌سازی ویرایش‌های نامعتبر (بستهٔ حذف‌شده از داده) */
    const ge = PackagingView.state.graphEdits;
    for (const store of [ge.rollAdded, ge.palletAdded, ge.spec, ge.rollRemoved]) {
      for (const key of Object.keys(store)) {
        if (!pkgMap.has(Number(key))) { delete store[key]; stale = true; }
      }
    }
    if (stale) PackagingView.saveGraphPlan();

    const pkgs = validOrder.map((no) => pkgMap.get(no));

    if (!pkgs.length) {
      if (statsEl) statsEl.textContent = '';
      wrap.innerHTML = emptyHtml;
      return;
    }

    /* ۳٫۱۸ بند ۳: صفحه‌بندی نمایش حذف شد (آپشن «بسته در صفحه» حذف شد) —
       همهٔ بسته‌های انتخابی یکجا در گرید آزاد چیده می‌شوند؛ صفحه‌بندیِ
       «خروجی» (PDF/تصویر) جداگانه در graphComputePages از روی جهت صفحه
       و تعداد ستون محاسبه می‌شود */
    if (statsEl) {
      statsEl.textContent = `${U.faNum(pkgs.length)} بستهٔ انتخاب‌شده`;
    }

    const cardsHtml = pkgs
      .map((pkg, i) => PackagingView.graphCardHtml(pkg, i, { removable: true }))
      .join('');

    /* ۳٫۱۶ بند ۱ و ۴: چیدمان آزاد ۳٫۱۳ — گرید مستقیم در پنل (بدون
       صفحهٔ A4 ثابت/viewport/جای خالی)؛ عرض کامل پنل پر می‌شود */
    wrap.innerHTML = `<div class="pg-grid">${cardsHtml}</div>`;

    /* ۳٫۱۷ بند ۳: دو تم رنگی یک‌ردیف‌درمیان — پس از چیدمان اعمال می‌شود
       (اگر زیرتب گراف مخفی است، هنگام فعال‌سازی/نمایش تب دوباره صدا می‌خورد) */
    const gridEl = wrap.querySelector('.pg-grid');
    if (gridEl && !PackagingView.applyGraphAccents(gridEl)) {
      requestAnimationFrame(() => PackagingView.applyGraphAccents(gridEl));
    }

    wrap.querySelectorAll('[data-pg-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        PackagingView.graphRemovePkg(Number(btn.dataset.pgRemove));
      });
    });
    /* ۳٫۱۹ بند ۴ — دکمهٔ مداد هر کارت: همان مودال ویرایش دکمهٔ «ویرایش»
       جدول لیست (مشخصات + پالت/رول) باز می‌شود؛ پس از «ذخیرهٔ تغییرات»
       موقعیت صفحه در همان‌جا حفظ می‌شود (بدون پرش) */
    wrap.querySelectorAll('[data-pg-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        PackagingView.showGraphEditModal(Number(btn.dataset.pgEdit));
      });
    });
  };

  /* ================================================================
     ۹-ب) جدول «لیست بسته های قابل نمایش» (۳٫۱۵ بند ۳ و ۴)
     ================================================================
     همان زیرساخت کامل سایر جدول‌های برنامه: فیلتر ستونی + «ردیف‌های قابل
     نمایش» ماندگار + پنل‌های «ترتیب ستون‌ها» و «مرتب‌سازی» با تمام
     قابلیت‌ها (چیپ کشیدنی، عرض px، چشم مخفی‌سازی، افزودن فیلد، بازنشانی،
     چندمرحله‌ای) — همهٔ بسته‌های انتخابی یکجا نمایش داده می‌شوند (بدون
     دکمه‌های تغییر صفحه) + درگ ردیف برای تغییر تقدم و تاخر + دکمهٔ
     «ویرایش» هر ردیف (مودال کامل) + ستون‌های تفکیک‌یافتهٔ مشخصات. */

  /** آیا مرتب‌سازی جدول لیست در حالت پیش‌فرض (ترتیب نمایش) است؟
      درگ و ▲▼ فقط در این حالت فعال‌اند — با مرتب‌سازی سفارشی، ترتیبِ
      زیرین جدول معنای نمایشی ندارد و تغییر آن گمراه‌کننده می‌شود. */
  PackagingView.graphSortIsDefault = function () {
    const s = PackagingView.ctls.graph && PackagingView.ctls.graph.cfg
      ? PackagingView.ctls.graph.cfg.sort : null;
    if (!s || !s.length) return true;
    return s.length === 1 && s[0].field === 'displayIdx' && s[0].direction === 'asc';
  };

  /** پرچم‌های «ویرایش دستی» پارامترهای یک بسته (۳٫۲۲ بند ۲) — مشتق از
   *  graphEdits/graphRemoved ماندگار (بدون ذخیره‌سازی جدید): هر پارامتری که
   *  کاربر در مودال ویرایش واقعاً تغییر داده باشد، در جدول لیست با نشان ریز
   *  «دستی» کنار همان پارامتر علامت می‌خورد؛ override خالی/برابر مقدار اصلی
   *  از قبل در مودال حذف می‌شود پس پرچم‌ها دقیقاً همان تغییرات واقعی‌اند */
  PackagingView.graphEditFlagsOf = function (pkg) {
    const st = PackagingView.state;
    const no = pkg.no;
    const spec = (st.graphEdits.spec || {})[no] || {};
    const hasRollEdits = ((st.graphEdits.rollRemoved[no] || []).length > 0) ||
      (Object.keys(st.graphEdits.rollAdded[no] || {}).length > 0);
    const hasPalletEdits = ((st.graphRemoved[no] || []).length > 0) ||
      ((st.graphEdits.palletAdded[no] || []).length > 0);
    return {
      filmType: spec.filmType !== undefined,
      width: spec.width !== undefined,
      thickness: spec.thickness !== undefined,
      grade: spec.grade !== undefined,
      computedType: spec.computedType !== undefined,
      pallets: hasPalletEdits,
      rollsList: hasRollEdits,
      cap: hasPalletEdits || hasRollEdits,
    };
  };

  /** نشان ریز «دستی» کنار پارامتر ویرایش‌شدهٔ دستی در جدول «لیست بسته های
   *  قابل نمایش» (۳٫۲۲ بند ۲) — خیلی کوچک و هم‌زبانِ بصری آیتم‌های دستی
   *  (فیروزه‌ای)؛ title = توضیح + مقدار اصلی برنامه */
  PackagingView.graphManualFlagHtml = function (title) {
    return `<span class="pge-manual-flag" title="${U.escapeHtml(title)}">دستی</span>`;
  };

  /** رجیستری ستون‌های جدول «لیست بسته های قابل نمایش» */
  PackagingView.graphListColumns = function () {
    return {
      displayIdx: {
        key: 'displayIdx', label: 'ترتیب', filterable: false, className: 'pge-ord-cell',
        headerTitle: 'ترتیب نمایش کارت‌ها — ردیف را بکشید (⠿) یا با ▲▼ جابه‌جا کنید؛ درگ فقط در مرتب‌سازی پیش‌فرض فعال است',
        render: (r) => `
          <div class="pge-ord">
            <span class="pge-drag" data-pge-row="${r.pkg.no}" title="بکشید تا ترتیب نمایش این بسته عوض شود">⠿</span>
            <span class="pge-idx">${U.faNum(r.displayIdx)}</span>
            <button type="button" class="pge-move" data-pge-up="${r.pkg.no}"${r.displayIdx === 1 ? ' disabled' : ''} title="انتقال به بالا" aria-label="انتقال بستهٔ ${U.faNum(r.pkg.no)} به بالا">▲</button>
            <button type="button" class="pge-move" data-pge-down="${r.pkg.no}"${r.displayIdx === r.total ? ' disabled' : ''} title="انتقال به پایین" aria-label="انتقال بستهٔ ${U.faNum(r.pkg.no)} به پایین">▼</button>
          </div>`,
      },
      no: {
        key: 'no', label: 'بسته',
        render: (r) => `<b>${U.faNum(r.pkg.no)}</b>`,
        tokens: (r) => [String(r.pkg.no)],
      },
      filmType: {
        key: 'filmType', label: 'فیلم',
        render: (r) => U.escapeHtml(r.spec.filmType) +
          (r.edited.filmType ? PackagingView.graphManualFlagHtml(`ویرایش دستی — مقدار اصلی برنامه: ${r.pkg.filmType ?? '—'}`) : ''),
        tokens: (r) => [r.spec.filmType],
      },
      width: {
        key: 'width', label: 'عرض',
        render: (r) => U.faWidth(r.spec.width) +
          (r.edited.width ? PackagingView.graphManualFlagHtml(`ویرایش دستی — مقدار اصلی برنامه: ${U.faWidth(r.pkg.width)}`) : ''),
        tokens: (r) => [U.faWidth(r.spec.width), String(r.spec.width)],
      },
      thickness: {
        key: 'thickness', label: 'ضخامت',
        render: (r) => ((r.spec.thickness === null || r.spec.thickness === undefined) ? '<span class="muted">—</span>' : U.faNum(r.spec.thickness)) +
          (r.edited.thickness ? PackagingView.graphManualFlagHtml(`ویرایش دستی — مقدار اصلی برنامه: ${r.pkg.thickness ?? '—'}`) : ''),
        tokens: (r) => (r.spec.thickness === null || r.spec.thickness === undefined) ? [] : [U.faNum(r.spec.thickness), String(r.spec.thickness)],
      },
      grade: {
        key: 'grade', label: 'گرید',
        headerTitle: 'گرید بسته — فقط متن بولد بدون کادر رنگی (۳٫۱۸ بند ۱)؛ بسته‌های ترکیبی U+X: گرید هر رول در یک ستون، دقیقاً هم‌تراز شمارهٔ همان رول در ستون «رول های نمایش»',
        render: (r) => (r.pkg.mixedGrid
          ? mixedGradeListHtml(r.parts)
          : (r.spec.grade
            ? `<b class="pk-grade-single">${U.escapeHtml(r.spec.grade)}</b>`
            : '<span class="muted">—</span>')) +
          (r.edited.grade ? PackagingView.graphManualFlagHtml(`ویرایش دستی گرید — مقدار اصلی برنامه: ${r.pkg.mixedGrid && Array.isArray(r.pkg.mixedGrades) && r.pkg.mixedGrades.length > 1 ? r.pkg.mixedGrades.join(' + ') : (r.pkg.grade ?? '—')}`) : ''),
        tokens: (r) => r.pkg.mixedGrid
          ? ['ترکیبی', 'U + X', ...r.parts.flatMap((pt) => [gradeKeyOf(pt.grade), ...pt.rolls.map((x) => gradeKeyOf(x.grade))].filter(Boolean))]
          : [r.spec.grade || ''],
      },
      computedType: {
        key: 'computedType', label: 'بسته بندی',
        render: (r) => U.escapeHtml(r.spec.computedType) +
          (r.edited.computedType ? PackagingView.graphManualFlagHtml(`ویرایش دستی — مقدار اصلی برنامه: ${r.pkg.computedType ?? '—'}`) : ''),
        tokens: (r) => [r.spec.computedType],
      },
      cap: {
        key: 'cap', label: 'ظرفیت نمایش',
        headerTitle: 'تعداد رولِ پالت‌های نمایش‌داده‌شده از ظرفیت استاندارد — با ویرایش‌های مودال به‌روز می‌شود',
        render: (r) => {
          const n = r.parts.reduce((s, pt) => s + pt.rolls.length, 0);
          return `<b>${U.faNum(n)}</b> <span class="muted">از ${U.faNum(r.pkg.stdCapacity)}</span>` +
            (r.edited.cap ? PackagingView.graphManualFlagHtml('پالت‌ها/رول‌های نمایش این بسته به‌صورت دستی ویرایش شده‌اند — شمار رولِ نمایش با برنامهٔ اصلی فرق دارد') : '');
        },
        tokens: (r) => [String(r.parts.reduce((s, pt) => s + pt.rolls.length, 0)), String(r.pkg.stdCapacity)],
      },
      pallets: {
        key: 'pallets', label: 'پالت‌های نمایش', className: 'pk-list-cell pk-ltr pge-pal-col',
        headerTitle: 'پالت‌های نمایش‌داده‌شده در کارت این بسته — ستونی زیر هم؛ کهربایی = پای کار، «دستی» = افزودهٔ مودال ویرایش (ویرایش فقط از دکمهٔ «ویرایش»)',
        render: (r) => '<div class="pge-pal-list">' + r.parts.map((pt) =>
          `<span class="pge-pal ltr${pt.atBase ? ' at-base' : ''}${pt.manual ? ' is-manual' : ''}" title="${U.escapeHtml(pt.palletNo)} — ${pt.manual ? 'پالت دستی (فقط نمایش)' : pt.atBase ? 'پای کار (سالن تولید)' : U.escapeHtml(pt.warehouse || 'انبار')}${!pt.manual && pt.isMain ? ' — پالت اصلی' : ''}">${U.escapeHtml(pt.palletNo)}</span>`).join('') +
          (r.edited.pallets ? PackagingView.graphManualFlagHtml('پالت‌های نمایش این بسته به‌صورت دستی ویرایش شده‌اند (حذف/افزودن پالت در پنجرهٔ ویرایش)') : '') + '</div>',
        tokens: (r) => r.parts.map((pt) => pt.palletNo),
      },
      rollsList: {
        key: 'rollsList', label: 'رول های نمایش', className: 'pk-list-cell pk-ltr',
        headerTitle: 'رول‌های نمایش‌داده‌شدهٔ این بسته — زیر شمارهٔ همان پالت (ارتباط هر رول با پالت خودش مشخص است)',
        render: (r) => '<div class="pk-rolls-list">' + r.parts.map((pt, i) =>
          `<div class="pk-rolls-group${pt.atBase ? ' at-base' : ''}${pt.manual ? ' is-manual' : ''}" title="پالت ${i + 1}: ${U.escapeHtml(pt.palletNo)}${pt.manual ? ' — دستی (فقط نمایش)' : pt.atBase ? ' — پای کار (سالن تولید)' : ''}">` +
          `<span class="pk-pal-idx">${i + 1}.</span>` +
          '<span class="pk-rolls-col">' +
          pt.rolls.map((robj) => `<span class="pk-roll ltr${robj.manual ? ' is-manual' : ''}"${robj.manual ? ' title="رول دستی‌افزوده — فقط نمایش"' : ''}>${U.escapeHtml(robj.roll)}</span>`).join('') +
          '</span></div>').join('') +
          (r.edited.rollsList ? PackagingView.graphManualFlagHtml('رول‌های نمایش این بسته به‌صورت دستی ویرایش شده‌اند (حذف/افزودن رول در پنجرهٔ ویرایش)') : '') + '</div>',
        tokens: (r) => r.parts.flatMap((pt) => pt.rolls.map((robj) => robj.roll)),
      },
      reserve: {
        key: 'reserve', label: 'رزرو',
        render: (r) => r.pkg.reserveRolls.length ? U.faNum(r.pkg.reserveRolls.length) : '<span class="muted">—</span>',
        tokens: (r) => [String(r.pkg.reserveRolls.length)],
      },
      actions: {
        key: 'actions', label: 'عملیات', filterable: false, className: 'pge-actions-cell',
        render: (r) => `
          <div class="pge-actions">
            <button type="button" class="btn btn-ghost btn-sm pge-btn" data-pge-edit="${r.pkg.no}" title="ویرایش کامل این بسته — مشخصات، حذف/بازگردانی پالت، حذف/افزودن رول (حتی رول خارج از دیتای اصلی)">ویرایش</button>
            <button type="button" class="btn btn-ghost btn-sm pge-btn pge-btn-del" data-pge-del="${r.pkg.no}" title="حذف این بسته از نمایش گرافیکی">حذف</button>
          </div>`,
      },
    };
  };

  /** رندر جدول «لیست بسته های قابل نمایش» (۳٫۱۵ بند ۳ — الگوی سایر جدول‌ها) */
  PackagingView.renderGraphList = function (plan) {
    const wrap = document.getElementById('pack-graph-list');
    if (!wrap) return;
    const ctl = PackagingView.ctls.graph;
    if (!ctl || !ctl.cfg) return;

    const pkgMap = plan ? new Map(plan.packages.map((x) => [x.no, x])) : new Map();
    const rows = PackagingView.state.graphOrder
      .map((no) => pkgMap.get(no))
      .filter(Boolean)
      .map((pkg, i) => ({
        displayIdx: i + 1,
        total: PackagingView.state.graphOrder.length,
        pkg,
        spec: PackagingView.graphSpecOf(pkg),
        parts: PackagingView.graphPartsOf(pkg),
        edited: PackagingView.graphEditFlagsOf(pkg),   // ۳٫۲۲ بند ۲ — پرچم ویرایش دستی هر پارامتر
      }));

    const listStats = document.getElementById('pack-graph-list-stats');
    if (listStats) {
      listStats.textContent = rows.length
        ? `${U.faNum(rows.length)} بسته در لیست قابل نمایش`
        : '';
    }

    const registry = PackagingView.graphListColumns();
    ctl.applyWidths(registry);
    const columns = ctl.visibleColumns(registry);

    const snap = snapshotScroll(wrap);
    PackagingView.state.tables.graph.visibleRows = ctl.cfg.visibleRows;
    UI.filterTable(wrap, columns, ctl.applySort(rows), {
      state: PackagingView.state.tables.graph,
      tableClass: 'cut-table',
      maxDomRows: RM.config.PACK_MAX_DOM_ROWS,
      /* ۳٫۱۷ بند ۶: ردیف بسته‌های ترکیبی U+X با رنگ هایلایت */
      rowClass: (r) => (r.pkg.mixedGrid ? 'pk-mixed-row' : ''),
      emptyText: 'بسته‌ای در لیست قابل نمایش نیست — از جدول «برنامهٔ بسته‌بندی» با دکمهٔ «+ نمایش» اضافه کنید.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن · دکمهٔ «≠» = شامل نشود · ردیف‌ها را با ⠿ بکشید تا ترتیب نمایش کارت‌ها عوض شود (درگ در مرتب‌سازی پیش‌فرض فعال است) · ویرایش هر بسته از دکمهٔ «ویرایش» · نشان ریز «دستی» کنار هر پارامتر = همان پارامتر به‌صورت دستی ویرایش شده است (۳٫۲۲)',
      onRowsChange: (n) => { ctl.cfg.visibleRows = n; ctl.save(); },
      tools: [
        { id: 'pack-graph-cols-toggle', label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: ctl.cfg.colsVisible },
        { id: 'pack-graph-sort-toggle', label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: ctl.cfg.sortVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === 'pack-graph-cols-toggle') {
          ctl.cfg.colsVisible = !ctl.cfg.colsVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('graph'));
        } else if (toolId === 'pack-graph-sort-toggle') {
          ctl.cfg.sortVisible = !ctl.cfg.sortVisible;
          ctl.save().then(() => PackagingView.applyPanelsFor('graph'));
        }
      },
      onRendered: () => {
        PackagingView.bindGraphListActions(wrap);
      },
    });

    PackagingView.renderSortBuilderFor('graph');
    PackagingView.renderColsBuilderFor('graph', registry);
    PackagingView.applyPanelsFor('graph');
    requestAnimationFrame(() => restoreScroll(wrap, snap));
  };

  /** اتصال عملیات جدول لیست: ▲▼ + ویرایش + حذف + درگ ردیف (۳٫۱۵ بند ۳) */
  PackagingView.bindGraphListActions = function (wrap) {
    wrap.querySelectorAll('[data-pge-up]').forEach((btn) => {
      btn.addEventListener('click', () => PackagingView.graphMove(Number(btn.dataset.pgeUp), -1));
    });
    wrap.querySelectorAll('[data-pge-down]').forEach((btn) => {
      btn.addEventListener('click', () => PackagingView.graphMove(Number(btn.dataset.pgeDown), 1));
    });
    wrap.querySelectorAll('[data-pge-edit]').forEach((btn) => {
      btn.addEventListener('click', () => PackagingView.showGraphEditModal(Number(btn.dataset.pgeEdit)));
    });
    wrap.querySelectorAll('[data-pge-del]').forEach((btn) => {
      btn.addEventListener('click', () => PackagingView.graphRemovePkg(Number(btn.dataset.pgeDel)));
    });

    /* درگ ردیف برای تغییر تقدم و تاخر — فقط با مرتب‌سازی پیش‌فرض */
    const dragAllowed = PackagingView.graphSortIsDefault();
    wrap.querySelectorAll('tbody tr').forEach((tr) => {
      const handle = tr.querySelector('[data-pge-row]');
      if (!handle) return;
      if (!dragAllowed) {
        handle.classList.add('pge-drag-off');
        handle.title = 'درگ غیرفعال است — مرتب‌سازی سفارشی فعال است؛ ابتدا از پنل مرتب‌سازی «بازنشانی» کنید';
        return;
      }
      tr.draggable = true;
      tr.classList.add('pge-row-draggable');
      tr.addEventListener('dragstart', (e) => {
        PackagingView._dragNo = Number(handle.dataset.pgeRow);
        tr.classList.add('pge-dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(PackagingView._dragNo));
        } catch (err) { /* noop */ }
      });
      tr.addEventListener('dragend', () => {
        tr.classList.remove('pge-dragging');
        wrap.querySelectorAll('.pge-drag-over').forEach((x) => x.classList.remove('pge-drag-over'));
      });
      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (PackagingView._dragNo !== null && Number(handle.dataset.pgeRow) !== PackagingView._dragNo) {
          tr.classList.add('pge-drag-over');
        }
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('pge-drag-over'));
      tr.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = Number(handle.dataset.pgeRow);
        tr.classList.remove('pge-drag-over');
        if (PackagingView._dragNo === null || PackagingView._dragNo === target) return;
        PackagingView.graphReorder(PackagingView._dragNo, target);
      });
    });
  };

  /** جابه‌جایی ترتیب نمایش یک بسته (▲▼ یا درگ) */
  PackagingView.graphMove = function (no, delta) {
    if (!PackagingView.graphSortIsDefault()) {
      UI.toast('برای تغییر ترتیب نمایش، ابتدا مرتب‌سازی جدول را از پنل «مرتب‌سازی» بازنشانی کنید.', 'warning');
      return;
    }
    const order = PackagingView.state.graphOrder;
    const i = order.indexOf(no);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    PackagingView.saveGraphPlan();
    PackagingView.renderGraphView(PackagingView._plan);
  };

  /** درگ: انتقال بستهٔ «from» به جای بستهٔ «to» در ترتیب نمایش (۳٫۱۵ بند ۳) */
  PackagingView.graphReorder = function (fromNo, toNo) {
    const order = PackagingView.state.graphOrder;
    const from = order.indexOf(fromNo);
    const to = order.indexOf(toNo);
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    PackagingView._dragNo = null;
    PackagingView.saveGraphPlan();
    PackagingView.renderGraphView(PackagingView._plan);
    UI.toast(`ترتیب نمایش بستهٔ ${U.faNum(fromNo)} به جایگاه ${U.faNum(to + 1)} منتقل شد.`, 'info');
  };

  /** حذف یک بسته از نمایش گرافیکی (دکمهٔ × کارت یا جدول لیست) */
  PackagingView.graphRemovePkg = function (no) {
    const order = PackagingView.state.graphOrder;
    const i = order.indexOf(no);
    if (i === -1) return;
    order.splice(i, 1);
    PackagingView.graphClearEditsOf(no);
    PackagingView.saveGraphPlan();
    PackagingView.renderGraphView(PackagingView._plan);
    PackagingView.syncGraphButton(no);
    UI.toast(`بستهٔ ${U.faNum(no)} از نمایش گرافیکی حذف شد.`, 'info');
  };

  /* ================================================================
     ۹-پ) مودال ویرایش کامل یک بسته (۳٫۱۵ بند ۳)
     ================================================================
     ویرایش نمایشیِ هر بسته در یک پنجره: مشخصات ۵گانه + حذف/بازگردانی
     پالت + حذف رول تکی + افزودن رول دستی به پالت موجود + افزودن پالت
     دستی با رول‌های دلخواه (حتی رول/پالتی که در دیتای اصلی نیست).
     هیچ تغییری در برنامهٔ واقعی بسته‌بندی ایجاد نمی‌شود — فقط نمایش. */
  PackagingView.showGraphEditModal = function (pkgNo) {
    const plan = PackagingView._plan;
    const pkg = plan && plan.packages.find((x) => x.no === pkgNo);
    if (!pkg) return;

    const st = PackagingView.state;
    /* پیش‌نویس از وضعیت فعلی — تا «ذخیره» کلیک شود، چیزی اعمال نمی‌شود */
    const draft = {
      removedPallets: [...(st.graphRemoved[pkgNo] || [])],
      removedRolls: [...(st.graphEdits.rollRemoved[pkgNo] || [])],
      addedRolls: JSON.parse(JSON.stringify(st.graphEdits.rollAdded[pkgNo] || {})),
      addedPallets: JSON.parse(JSON.stringify(st.graphEdits.palletAdded[pkgNo] || [])),
      spec: { ...(st.graphEdits.spec[pkgNo] || {}) },
    };

    const origSpec = {
      filmType: pkg.filmType,
      width: pkg.width,
      thickness: pkg.thickness,
      grade: pkg.grade,
      computedType: pkg.computedType,
    };
    const specOf = (k) => {
      const v = draft.spec[k];
      return (v === undefined || v === null || String(v).trim() === '') ? origSpec[k] : v;
    };

    /** پالت‌های مؤثرِ پیش‌نویس */
    const draftParts = () => {
      const rmP = new Set(draft.removedPallets);
      const rmR = new Set(draft.removedRolls);
      const parts = pkg.palletParts
        .filter((pt) => !rmP.has(pt.palletNo))
        .map((pt) => ({
          palletNo: pt.palletNo,
          atBase: pt.atBase,
          warehouse: pt.warehouse,
          isMain: pt.isMain,
          manual: false,
          rolls: [
            ...pt.rolls.filter((r) => !rmR.has(r.roll)).map((r) => ({ roll: r.roll, manual: false })),
            ...(draft.addedRolls[pt.palletNo] || []).map((roll) => ({ roll, manual: true })),
          ],
        }));
      for (const mp of draft.addedPallets) {
        parts.push({
          palletNo: mp.palletNo,
          atBase: false,
          warehouse: null,
          isMain: false,
          manual: true,
          rolls: (mp.rolls || []).map((roll) => ({ roll, manual: true })),
        });
      }
      return parts;
    };

    UI.infoModal(`ویرایش بستهٔ ${U.faNum(pkgNo)} — نمایش گرافیکی`, `
      <div class="drill-subtitle">ویرایش <b>نمایشی</b> این بسته پیش از خروجی گرفتن — برنامهٔ واقعی بسته‌بندی و داده‌ها تغییر نمی‌کنند. همهٔ تغییرات (حذف/افزودن پالت و رول، مشخصات) فقط کارت و جدول همین بسته را به‌روز می‌کنند و ماندگارند.</div>
      <div id="pge-modal-body"></div>
      <div class="pge-modal-actions">
        <button type="button" class="btn btn-primary" id="pge-modal-save">ذخیرهٔ تغییرات</button>
        <button type="button" class="btn btn-ghost" id="pge-modal-cancel">انصراف</button>
      </div>
    `, { wide: true });

    const bodyEl = () => document.getElementById('pge-modal-body');

    const renderBody = () => {
      const parts = draftParts();
      const rollsCount = parts.reduce((s, pt) => s + pt.rolls.length, 0);

      const specInputs = [
        { k: 'filmType', label: 'فیلم' },
        { k: 'width', label: 'عرض' },
        { k: 'thickness', label: 'ضخامت' },
        { k: 'grade', label: 'گرید' },
        { k: 'computedType', label: 'بسته بندی' },
      ].map((f) => `
        <label class="pge-field">
          <span>${f.label}</span>
          <input type="text" class="pge-input ltr" data-pge-spec="${f.k}"
                 value="${U.escapeHtml(String(specOf(f.k) ?? ''))}"
                 placeholder="${U.escapeHtml(String(origSpec[f.k] ?? '—'))}"
                 aria-label="${f.label} نمایشی این بسته">
        </label>`).join('');

      const palletSections = parts.map((pt) => {
        const rollsHtml = pt.rolls.map((robj) => `
          <span class="pge-roll ltr${robj.manual ? ' is-manual' : ''}" title="${robj.manual ? 'رول دستی‌افزوده — فقط نمایش' : 'رول اصلی این پالت'}">
            ${U.escapeHtml(robj.roll)}
            <button type="button" class="pge-rm-roll" data-pge-rmroll="${U.escapeHtml(pt.palletNo)}|${U.escapeHtml(robj.roll)}" title="حذف این رول از نمایش" aria-label="حذف رول ${U.escapeHtml(robj.roll)} از نمایش">×</button>
          </span>`).join('');
        return `
          <div class="pge-pallet-sec${pt.atBase ? ' at-base' : ''}${pt.manual ? ' is-manual' : ''}">
            <div class="pge-ps-head">
              <b class="ltr">${U.escapeHtml(pt.palletNo)}</b>
              ${pt.manual
                ? '<span class="pge-tag">دستی</span>'
                : pt.atBase
                  ? '<span class="pge-tag tag-base">پای کار</span>'
                  : `<span class="pge-tag" title="${U.escapeHtml(pt.warehouse || '—')}">انبار</span>`}
              <span class="pge-ps-count">${U.faNum(pt.rolls.length)} رول</span>
              <span class="tool-push-end" aria-hidden="true"></span>
              <button type="button" class="btn btn-ghost btn-sm pge-btn pge-btn-del" data-pge-rmpal2="${U.escapeHtml(pt.palletNo)}" title="حذف کامل این پالت از نمایش (همهٔ رول‌هایش)">حذف پالت</button>
            </div>
            <div class="pge-ps-rolls">${rollsHtml || '<span class="muted" style="font-size:.7rem">رولی نمایش داده نمی‌شود</span>'}</div>
            <div class="pge-ps-add">
              <input type="text" class="pge-input ltr" data-pge-addroll="${U.escapeHtml(pt.palletNo)}" placeholder="شمارهٔ رول برای افزودن دستی به همین پالت (حتی خارج از دیتای اصلی)" aria-label="افزودن رول دستی به پالت ${U.escapeHtml(pt.palletNo)}">
              <button type="button" class="btn btn-ghost btn-sm pge-btn" data-pge-addroll-btn="${U.escapeHtml(pt.palletNo)}">+ رول</button>
            </div>
          </div>`;
      }).join('');

      const removedPalletsHtml = draft.removedPallets.length ? `
        <div class="pge-removed-box">
          <b>پالت‌های حذف‌شده از نمایش:</b>
          ${draft.removedPallets.map((pn) => `
            <span class="pge-removed-item ltr">${U.escapeHtml(pn)}
              <button type="button" class="pge-restore" data-pge-unrmpal="${U.escapeHtml(pn)}" title="بازگرداندن این پالت به نمایش">↺</button>
            </span>`).join('')}
        </div>` : '';

      const removedRollsHtml = draft.removedRolls.length ? `
        <div class="pge-removed-box">
          <b>رول‌های حذف‌شده از نمایش:</b>
          ${draft.removedRolls.map((rn) => `
            <span class="pge-removed-item ltr">${U.escapeHtml(rn)}
              <button type="button" class="pge-restore" data-pge-unrmroll="${U.escapeHtml(rn)}" title="بازگرداندن این رول به نمایش">↺</button>
            </span>`).join('')}
        </div>` : '';

      bodyEl().innerHTML = `
        <div class="pge-modal-grid">
          <div class="pack-info-item"><span>بستهٔ</span><b>${U.faNum(pkgNo)}</b></div>
          <div class="pack-info-item"><span>ظرفیت نمایش</span><b>${U.faNum(rollsCount)} از ${U.faNum(pkg.stdCapacity)}</b></div>
          <div class="pack-info-item"><span>پالت‌های نمایش</span><b>${U.faNum(parts.length)}</b></div>
          <div class="pack-info-item"><span>رزرو</span><b>${U.faNum(pkg.reserveRolls.length)} رول</b></div>
        </div>
        <div class="pge-sec-title">مشخصات نمایشی <span class="muted">(خالی = مقدار اصلی)</span>
          <span class="tool-push-end" aria-hidden="true"></span>
          <button type="button" class="btn btn-ghost btn-sm pge-btn" id="pge-spec-reset" title="حذف override مشخصات و بازگشت به مقدار اصلی برنامه">بازنشانی مشخصات</button>
        </div>
        <div class="pge-spec-grid">${specInputs}</div>
        <div class="pge-sec-title">پالت‌ها و رول‌های نمایش</div>
        <div class="pge-pallets-wrap">${palletSections || '<div class="empty-state" style="padding:14px"><p>پالتی نمایش داده نمی‌شود — پالت دستی اضافه کنید یا پالت‌های حذف‌شده را بازگردانید.</p></div>'}</div>
        ${removedPalletsHtml}
        ${removedRollsHtml}
        <div class="pge-sec-title">افزودن پالت دستی <span class="muted">(حتی پالت خارج از دیتای اصلی — فقط نمایش)</span></div>
        <div class="pge-manual-add">
          <div class="pge-mf">
            <label class="pge-mf-title" for="pge-new-pal">شماره پالت دستی</label>
            <input type="text" class="pge-input ltr" id="pge-new-pal" placeholder="مثلاً FFG12345678E" aria-label="شمارهٔ پالت دستی">
            <div class="pge-mf-hint">شمارهٔ پالت (مثلاً FFG12345678E) — حتی خارج از دیتای اصلی، فقط در نمایش همین بسته اعمال می‌شود.</div>
          </div>
          <div class="pge-mf">
            <label class="pge-mf-title" for="pge-new-pal-rolls">شماره رول های دستی</label>
            <input type="text" class="pge-input ltr" id="pge-new-pal-rolls" placeholder="مثلاً F3501210001L3DM111, F3501210002L3DM111" aria-label="رول‌های پالت دستی">
            <div class="pge-mf-hint">رول‌های این پالت — با کاما جدا (مثلاً F3501210001L3DM111, F3501210002L3DM111)</div>
          </div>
          <div class="pge-mf pge-mf-btn">
            <button type="button" class="btn btn-ghost btn-sm pge-btn" id="pge-add-pal-btn">+ افزودن پالت</button>
          </div>
        </div>
      `;
      bindBody();
    };

    const addManualRoll = (palletNo, raw) => {
      const roll = String(raw || '').trim();
      if (!roll) {
        UI.toast('شمارهٔ رول را وارد کنید.', 'warning');
        return;
      }
      if (!draft.addedRolls[palletNo]) draft.addedRolls[palletNo] = [];
      if (draft.addedRolls[palletNo].includes(roll)) {
        UI.toast(`رول ${U.escapeHtml(roll)} قبلاً به پالت ${U.escapeHtml(palletNo)} اضافه شده است.`, 'info');
        return;
      }
      const part = draftParts().find((pt) => pt.palletNo === palletNo);
      if (part && part.rolls.some((r) => r.roll === roll)) {
        UI.toast(`رول ${U.escapeHtml(roll)} از قبل در پالت ${U.escapeHtml(palletNo)} هست.`, 'info');
        return;
      }
      draft.addedRolls[palletNo].push(roll);
      renderBody();
    };

    const bindBody = () => {
      const el = bodyEl();

      /* مشخصات نمایشی — به‌روزرسانی زندهٔ پیش‌نویس با هر تایپ تا
         re-renderهای مودال (حذف/افزودن رول و پالت) مقدار واردشده را از دست ندهد */
      el.querySelectorAll('[data-pge-spec]').forEach((input) => {
        input.addEventListener('input', () => {
          const k = input.dataset.pgeSpec;
          const v = String(input.value).trim();
          if (v === '' || v === String(origSpec[k] ?? '')) delete draft.spec[k];
          else draft.spec[k] = v;
        });
      });

      /* حذف رول تکی (اصلی → removedRolls؛ دستی → حذف از addedRolls) */
      el.querySelectorAll('[data-pge-rmroll]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [pal, roll] = btn.dataset.pgeRmroll.split('|');
          if (draft.addedRolls[pal] && draft.addedRolls[pal].includes(roll)) {
            draft.addedRolls[pal] = draft.addedRolls[pal].filter((r) => r !== roll);
            if (!draft.addedRolls[pal].length) delete draft.addedRolls[pal];
          } else {
            draft.removedRolls.push(roll);
          }
          renderBody();
        });
      });

      /* حذف کامل پالت (اصلی → removedPallets؛ دستی → حذف از addedPallets) */
      el.querySelectorAll('[data-pge-rmpal2]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pal = btn.dataset.pgeRmpal2;
          const ai = draft.addedPallets.findIndex((mp) => mp.palletNo === pal);
          if (ai !== -1) {
            draft.addedPallets.splice(ai, 1);
          } else {
            draft.removedPallets.push(pal);
            delete draft.addedRolls[pal];
          }
          renderBody();
        });
      });

      /* بازگردانی پالت/رول حذف‌شده */
      el.querySelectorAll('[data-pge-unrmpal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          draft.removedPallets = draft.removedPallets.filter((pn) => pn !== btn.dataset.pgeUnrmpal);
          renderBody();
        });
      });
      el.querySelectorAll('[data-pge-unrmroll]').forEach((btn) => {
        btn.addEventListener('click', () => {
          draft.removedRolls = draft.removedRolls.filter((rn) => rn !== btn.dataset.pgeUnrmroll);
          renderBody();
        });
      });

      /* افزودن رول دستی به هر پالت */
      el.querySelectorAll('[data-pge-addroll-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pal = btn.dataset.pgeAddrollBtn;
          const input = el.querySelector(`[data-pge-addroll="${CSS.escape(pal)}"]`);
          if (input) {
            addManualRoll(pal, input.value);
          }
        });
      });
      el.querySelectorAll('[data-pge-addroll]').forEach((input) => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addManualRoll(input.dataset.pgeAddroll, input.value);
          }
        });
      });

      /* افزودن پالت دستی */
      const addPalBtn = el.querySelector('#pge-add-pal-btn');
      if (addPalBtn) addPalBtn.addEventListener('click', () => {
        const palInput = el.querySelector('#pge-new-pal');
        const rollsInput = el.querySelector('#pge-new-pal-rolls');
        const palletNo = String(palInput ? palInput.value : '').trim();
        if (!palletNo) {
          UI.toast('شمارهٔ پالت دستی را وارد کنید.', 'warning');
          return;
        }
        if (pkg.palletParts.some((pt) => pt.palletNo === palletNo) ||
            draft.addedPallets.some((mp) => mp.palletNo === palletNo)) {
          UI.toast(`پالت ${U.escapeHtml(palletNo)} از قبل در این بسته هست.`, 'warning');
          return;
        }
        const rolls = String(rollsInput ? rollsInput.value : '')
          .split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
        draft.addedPallets.push({ palletNo, rolls });
        renderBody();
        UI.toast(`پالت دستی ${U.escapeHtml(palletNo)} با ${U.faNum(rolls.length)} رول به نمایش این بسته اضافه شد (فقط نمایش — با «ذخیرهٔ تغییرات» ماندگار می‌شود).`, 'success');
      });

      /* بازنشانی مشخصات */
      const specReset = el.querySelector('#pge-spec-reset');
      if (specReset) specReset.addEventListener('click', () => {
        draft.spec = {};
        renderBody();
      });
    };

    renderBody();

    /* ذخیره — اعمال پیش‌نویس روی state + ماندگاری + رندر مجدد */
    const saveBtn = document.getElementById('pge-modal-save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      /* خواندن مشخصات از ورودی‌ها (خالی = حذف override) */
      const body = bodyEl();
      body.querySelectorAll('[data-pge-spec]').forEach((input) => {
        const k = input.dataset.pgeSpec;
        const v = String(input.value).trim();
        if (v === '' || v === String(origSpec[k] ?? '')) delete draft.spec[k];
        else draft.spec[k] = v;
      });

      const ge = st.graphEdits;
      const setOrDelete = (obj, key, value) => {
        if (value === undefined || value === null ||
            (Array.isArray(value) && !value.length) ||
            (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
          delete obj[key];
        } else {
          obj[key] = value;
        }
      };
      setOrDelete(st.graphRemoved, pkgNo, draft.removedPallets.length ? [...draft.removedPallets] : undefined);
      setOrDelete(ge.rollRemoved, pkgNo, draft.removedRolls.length ? [...draft.removedRolls] : undefined);
      setOrDelete(ge.rollAdded, pkgNo, Object.keys(draft.addedRolls).length
        ? JSON.parse(JSON.stringify(draft.addedRolls)) : undefined);
      setOrDelete(ge.palletAdded, pkgNo, draft.addedPallets.length
        ? JSON.parse(JSON.stringify(draft.addedPallets)) : undefined);
      setOrDelete(ge.spec, pkgNo, Object.keys(draft.spec).length
        ? { ...draft.spec } : undefined);

      /* ۳٫۱۹ بند ۴ — بدون پرش موقعیت صفحه: موقعیت اسکرول پنجره پیش از
         بازسازی نمایش ثبت و پس از رندر مجدد (کاربر از روی کارت یا جدول
         ویرایش کرده — فرقی ندارد) دقیقاً به همان‌جا بازگردانده می‌شود */
      const savedY = window.scrollY;
      PackagingView.saveGraphPlan();
      PackagingView.renderGraphView(plan);
      document.getElementById('modal-info-close').click();
      requestAnimationFrame(() => {
        if (window.scrollY !== savedY) window.scrollTo(window.scrollX, savedY);
      });
      const parts = PackagingView.graphPartsOf(pkg);
      UI.toast(`ویرایش بستهٔ ${U.faNum(pkgNo)} ذخیره شد — ${U.faNum(parts.length)} پالت و ${U.faNum(parts.reduce((s, pt) => s + pt.rolls.length, 0))} رول در نمایش.`, 'success');
    });

    const cancelBtn = document.getElementById('pge-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      document.getElementById('modal-info-close').click();
    });
  };

  /** ساخت HTML یک برگهٔ استیج خروجی (۳٫۱۸ بند ۳ — بازنویسی کامل):
   *  برگه = A4 (عمودی/افقی) با ستون‌های هم‌عرضِ «عرض طراحی استاندارد»؛
   *  کارت‌ها ردیف‌به‌ردیف چیده می‌شوند و ردیف‌های هر برگه از قبل در
   *  graphComputePages محاسبه شده‌اند — ردیفی که به‌طور کامل جا نشده
   *  به‌طور کامل به برگهٔ بعد رفته است (هیچ کارتی نمی‌شکند). baseIdx =
   *  جایگاه برگه در ترتیب کلی برای پیوستگی تم ردیفی کارت‌ها. */
  PackagingView.graphStagePageHtml = function (cards, baseIdx, pageIdx, totalPages, layout) {
    const cardsHtml = cards.map((pkg, i) =>
      PackagingView.graphCardHtml(pkg, baseIdx + i, { pdf: true })).join('');
    /* ۳٫۱۹ بند ۳ — تاریخ شمسی روی هر برگهٔ خروجی (PDF و تصویر) درج
       می‌شود (تاریخ و ساعت به تقویم هجری شمسی) */
    return `
      <div class="pg-page" style="width:${layout.pw}px">
        <div class="pg-stage-head">
          <b>نمایش گرافیکی بسته‌بندی</b>
          <span>${U.faNum(layout.total)} بسته · A4 ${layout.orient === 'landscape' ? 'افقی' : 'عمودی'} · ${U.faNum(layout.cols)} ستون · برگهٔ ${U.faNum(pageIdx + 1)} از ${U.faNum(totalPages)} · تاریخ: ${PackagingView.graphJalaliOnPage()}</span>
        </div>
        <div class="pg-grid" style="grid-template-columns:repeat(${layout.cols},${GRAPH_CARD_W}px)">${cardsHtml}</div>
      </div>`;
  };

  /** محاسبهٔ چیدمان برگه‌های خروجی (۳٫۱۸ بند ۳): همهٔ کارت‌ها یک‌بار با
   *  «عرض طراحی استاندارد» در یک برگهٔ آزمایشیِ استیج رندر و اندازه‌گیری
   *  می‌شوند؛ سپس ردیف‌های ستونی به برگه‌ها تخصیص می‌یابند — هر ردیفی که
   *  به‌طور کامل در باقی‌ارتفاعِ برگه جا نشود به‌طور کامل به برگهٔ بعد
   *  می‌رود (کارت هرگز در میانهٔ برگه نمی‌شکند). اگر حتی یک ردیفِ تنهایی
   *  از ارتفاع برگه بلندتر باشد، در رندر نهایی (graphRenderPageToA4) کل
   *  همان برگه با حفظ کامل نسبت‌ها یکجا کوچک می‌شود. برگه هرگز از A4
   *  باریک‌تر نمی‌شود (ستون‌های کم → جای خالی سفید می‌ماند). */
  PackagingView.graphComputePages = async function (pkgs) {
    if (typeof window.html2canvas !== 'function') throw new Error('html2canvas not loaded');
    const orient = PackagingView.state.graphOrient === 'landscape' ? 'landscape' : 'portrait';
    const cols = Math.min(GRAPH_COLS_MAX, Math.max(GRAPH_COLS_MIN,
      Math.round(PackagingView.state.graphCols) || GRAPH_COLS_DEFAULT));
    const a4w = orient === 'portrait' ? GRAPH_A4_W : GRAPH_A4_H;
    const a4h = orient === 'portrait' ? GRAPH_A4_H : GRAPH_A4_W;
    const designW = cols * GRAPH_CARD_W + (cols - 1) * GRAPH_GAP + 2 * GRAPH_PAD_X;
    const pw = Math.max(designW, a4w);   // عرض برگه (واحد طراحی) — هرگز کمتر از A4
    const kw = a4w / pw;                 // ضریب مقیاس عرض (≤ ۱ — هرگز بزرگ‌نمایی نمی‌شود)

    /* گام ۱ — اندازه‌گیری: همهٔ کارت‌ها یکجا در یک برگهٔ آزمایشی */
    const stage = document.getElementById('pack-graph-stage');
    if (!stage) throw new Error('graph stage not found');
    stage.innerHTML = PackagingView.graphStagePageHtml(pkgs, 0, 0, 1, {
      orient, cols, pw, a4w, a4h, total: pkgs.length,
    });
    stage.hidden = false;
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* noop */ }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const pageEl = stage.querySelector('.pg-page');
    const gridEl = stage.querySelector('.pg-grid');
    if (!pageEl || !gridEl) throw new Error('graph stage layout failed');
    const pt = pageEl.getBoundingClientRect();
    const gt = gridEl.getBoundingClientRect();
    const chromeAboveGrid = gt.top - pt.top;   // حاشیهٔ بالای برگه + سربرگ
    const heights = [...gridEl.querySelectorAll('.pg-card')]
      .map((c) => c.getBoundingClientRect().height);
    if (heights.length !== pkgs.length) throw new Error('graph stage measure failed');
    /* بودجهٔ ارتفاع ردیف‌ها در «واحد طراحی»: ارتفاع برگه در این واحد
       (a4h/kw) منهای حاشیه‌ها و سربرگ */
    const availNat = a4h / kw - 2 * GRAPH_PAD_Y - chromeAboveGrid;

    /* گام ۲ — ردیف‌های ستونی + تخصیص به برگه‌ها (بدون شکستن کارت) */
    const rows = [];
    for (let i = 0; i < pkgs.length; i += cols) {
      const count = Math.min(cols, pkgs.length - i);
      rows.push({ from: i, count, h: Math.max(...heights.slice(i, i + count)) });
    }
    const pages = [];
    let curRows = [];
    let curH = 0;
    const flush = () => {
      if (!curRows.length) return;
      pages.push({
        rows: curRows,
        cards: curRows.flatMap((r) => pkgs.slice(r.from, r.from + r.count)),
        base: curRows[0].from,
      });
      curRows = [];
      curH = 0;
    };
    for (const row of rows) {
      const addH = (curRows.length ? GRAPH_GAP : 0) + row.h;
      if (curRows.length && curH + addH > availNat) flush();
      curRows.push(row);
      curH += (curRows.length > 1 ? GRAPH_GAP : 0) + row.h;
    }
    flush();

    return { orient, cols, pw, a4w, a4h, kw, pages, total: pkgs.length };
  };

  /** ساخت استیج نهایی خارج از دید + انتظار چیدمان/فونت/رندر (۳٫۱۸ بند ۳) */
  PackagingView.buildGraphStage = async function (layout) {
    const stage = document.getElementById('pack-graph-stage');
    if (!stage) throw new Error('graph stage not found');
    stage.innerHTML = layout.pages.map((pg, i) =>
      PackagingView.graphStagePageHtml(pg.cards, pg.base, i, layout.pages.length, layout)).join('');
    stage.hidden = false;
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* noop */ }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    /* ۳٫۱۷ بند ۳: تم‌های ردیفی پس از چیدمان نهایی استیج اعمال می‌شوند تا
       تعداد ستون‌های واقعی هر برگهٔ خروجی مبنای تقسیم ردیف‌ها باشد */
    stage.querySelectorAll('.pg-grid').forEach((g) => PackagingView.applyGraphAccents(g));
    return stage;
  };

  /** رندر یک برگهٔ استیج روی «بوم دقیق A4» (۳٫۱۸ بند ۳): برگه با ابعاد
   *  طراحی (عرض طراحی × ارتفاع طبیعی محتوا) رندر می‌شود و سپس یکنواخت —
   *  با حفظ کامل نسبت‌های کارت/فونت/کادرهای داخلی — روی بوم A4 با چگالی
   *  GRAPH_RENDER_X (۳٫۲۰ بند ۲ — ۲۸۸dpi معادل؛ قبلاً ۲x/۱۹۲dpi) نقش
   *  می‌بندد: مقیاس فقط کوچک می‌شود (هرگز بزرگ‌نمایی نمی‌شود)، از بالای
   *  برگه چسبیده و افقی وسط‌چین؛ قسمت بدون کارت سفید می‌ماند.
   *  اگر ردیفی تنهایی از ارتفاع برگه بلندتر باشد، همان ضریبِ ارتفاعیِ
   *  کوچک‌تر ملاک است و کل برگه یکجا کوچک می‌شود. */
  PackagingView.graphRenderPageToA4 = async function (pageEl, layout) {
    const rx = GRAPH_RENDER_X;
    const scale = Math.max(1, Math.min(rx, rx * layout.kw));
    const canvas = await window.html2canvas(pageEl, {
      scale,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });
    if (!canvas.width || !canvas.height) throw new Error('empty canvas');
    const targetW = Math.round(layout.a4w * rx);
    const targetH = Math.round(layout.a4h * rx);
    const k = Math.min(targetW / canvas.width, targetH / canvas.height);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    const dw = Math.round(canvas.width * k);
    const dh = Math.round(canvas.height * k);
    ctx.drawImage(canvas, Math.round((targetW - dw) / 2), 0, dw, dh);
    return out;
  };

  /** فهرست بسته‌های انتخابی به ترتیب نمایش (مشترک هر دو خروجی — ۳٫۱۴) */
  PackagingView.graphSelectedPkgs = function () {
    const plan = PackagingView._plan;
    if (!plan) return [];
    const pkgMap = new Map(plan.packages.map((x) => [x.no, x]));
    return PackagingView.state.graphOrder
      .map((no) => pkgMap.get(no))
      .filter(Boolean);
  };

  /** ۳٫۱۹ بند ۳ — تاریخ شمسی «روی» برگه‌های خروجی (PDF/تصویر): تاریخ و
   *  ساعت جاری به تقویم هجری شمسی (fa-IR). مهر لاتین‌رقم برای نام فایل‌ها
   *  هم جداگانه ساخته می‌شود (graphJalaliStamp) تا نام فایل‌ها هم شمسی
   *  باشند. */
  PackagingView.graphJalaliOnPage = function () {
    return U.faDate(Date.now());   // «۱۴۰۵/۰۶/۳۰، ۱۴:۳۰» (شمسی)
  };
  PackagingView.graphJalaliStamp = function () {
    const d = new Date();
    try {
      const date = d.toLocaleDateString('fa-IR-u-nu-latn', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).replace(/\//g, '-');   // «1405-06-30»
      const time = d.toLocaleTimeString('fa-IR-u-nu-latn', {
        hour: '2-digit', minute: '2-digit',
      }).replace(':', '-');      // «14-30»
      return `${date}_${time}`;
    } catch (e) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
    }
  };

  /** خروجی تصویر PNG (۳٫۱۹ بند ۱ — بازنویسی کامل): هر تصویر همیشه «یک
   *  برگهٔ کامل A4» (عمودی/افقی طبق تنظیمات — هرگز باریک‌تر یا کوتاه‌تر
   *  نمی‌شود)؛ کارت‌ها با مقیاس استاندارد (یا یکجا کوچک‌تر برای جا شدن)
   *  از بالای برگه چیده می‌شوند و قسمت بدون کارت سفید می‌ماند.
   *  ورودی «برگهٔ تصویر» کنار دکمه تعیین می‌کند کدام برگه‌ها خروجی شوند:
   *    · خالی (پیش‌فرض «همه») → همهٔ برگه‌ها، هر برگه یک PNG جدا با
   *      شمارهٔ برگه در نام فایل (دانلودهای پیاپی)
   *    · عدد ۱..N → فقط همان برگه (خارج از بازه = خطا و بدون خروجی)
   *  تاریخ خروجی به شمسی روی هر تصویر درج می‌شود (۳٫۱۹ بند ۳). */
  PackagingView.exportGraphImage = async function () {
    const plan = PackagingView._plan;
    const btn = document.getElementById('pack-graph-png');
    const pkgs = PackagingView.graphSelectedPkgs();
    if (!plan || !pkgs.length) {
      UI.toast('بسته‌ای برای خروجی تصویر انتخاب نشده است.', 'warning');
      return;
    }

    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'در حال ساخت تصویر…'; }
    try {
      const layout = await PackagingView.graphComputePages(pkgs);
      const stage = await PackagingView.buildGraphStage(layout);
      const pageEls = [...stage.querySelectorAll('.pg-page')];
      if (pageEls.length !== layout.pages.length) throw new Error('graph pages mismatch');
      const totalPages = pageEls.length;

      /* ۳٫۱۹ بند ۱ — برگهٔ هدف از ورودی «برگهٔ تصویر»: خالی = همهٔ برگه‌ها */
      const pageInput = document.getElementById('pack-graph-png-page');
      const rawPage = pageInput ? String(pageInput.value).trim() : '';
      let target = null;
      if (rawPage !== '') {
        const v = Math.round(Number(rawPage));
        if (!Number.isFinite(v) || v < 1 || v > totalPages) {
          UI.toast(
            `شمارهٔ «برگهٔ تصویر» باید بین ۱ و ${U.faNum(totalPages)} باشد — این تنظیمات ${U.faNum(totalPages)} برگه دارد. برای خروجی همهٔ برگه‌ها، ورودی را خالی کنید.`,
            'warning', 6000
          );
          return;
        }
        target = v;
      }
      const indices = target ? [target - 1] : pageEls.map((_, i) => i);

      const stamp = PackagingView.graphJalaliStamp();
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        const canvas = await PackagingView.graphRenderPageToA4(pageEls[idx], layout);
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `نمایش-گرافیکی-بسته-بندی_${stamp}_برگه-${idx + 1}-از-${totalPages}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        /* دانلودهای پیاپی: وقفهٔ کوتاه تا مرورگر هر فایل را جداگانه ثبت کند */
        if (indices.length > 1 && k < indices.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 420));
        }
      }

      UI.toast(
        target
          ? `خروجی تصویر ساخته شد — برگهٔ ${U.faNum(target)} از ${U.faNum(totalPages)} · برگهٔ کامل A4 ${layout.orient === 'landscape' ? 'افقی' : 'عمودی'} · ${U.faNum(layout.cols)} ستون · تاریخ شمسی روی تصویر درج شد.`
          : `خروجی تصویر ساخته شد — همهٔ ${U.faNum(totalPages)} برگه (هر برگه یک تصویر کامل A4 ${layout.orient === 'landscape' ? 'افقی' : 'عمودی'} · ${U.faNum(layout.cols)} ستون · تاریخ شمسی روی هر تصویر درج شد). برای تصویر یک برگهٔ خاص، شماره‌اش را در «برگهٔ تصویر» وارد کنید.`,
        'success', 6800
      );
    } catch (err) {
      console.error('[GraphPNG]', err);
      UI.toast(`ساخت تصویر با خطا مواجه شد (${U.escapeHtml(String(err.message || err).slice(0, 90))}).`, 'error', 6500);
    } finally {
      const st = document.getElementById('pack-graph-stage');
      if (st) { st.innerHTML = ''; st.hidden = true; }
      if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
    }
  };

  /** خروجی PDF همهٔ برگه‌ها (۳٫۱۸ بند ۳ — بازنویسی کامل): هر برگه =
   *  یک صفحهٔ «کامل A4» (عمودی/افقی) با تصویر تمام‌صفحه؛ چیدمان از قبل
   *  طوری محاسبه شده که هیچ کارتی در میانهٔ برگه نشکسته باشد و اگر
   *  ستون‌ها زیاد شده باشند کل مقیاس با حفظ نسبت‌ها کوچک شده است */
  PackagingView.exportGraphPdf = async function () {
    const plan = PackagingView._plan;
    const btn = document.getElementById('pack-graph-pdf');
    const pkgs = PackagingView.graphSelectedPkgs();
    if (!plan || !pkgs.length) {
      UI.toast('بسته‌ای برای خروجی PDF انتخاب نشده است.', 'warning');
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      UI.toast('کتابخانهٔ PDF (jspdf) بارگذاری نشده است.', 'error');
      return;
    }

    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'در حال ساخت PDF…'; }
    try {
      const layout = await PackagingView.graphComputePages(pkgs);
      const stage = await PackagingView.buildGraphStage(layout);

      const { jsPDF } = window.jspdf;
      const orient = layout.orient;                       // 'portrait' | 'landscape'
      const pdf = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
      const pwMm = orient === 'portrait' ? 210 : 297;     // ابعاد برگهٔ A4 (mm)
      const phMm = orient === 'portrait' ? 297 : 210;

      const pageEls = [...stage.querySelectorAll('.pg-page')];
      if (pageEls.length !== layout.pages.length) throw new Error('graph pages mismatch');
      let first = true;
      for (const pageEl of pageEls) {
        const canvas = await PackagingView.graphRenderPageToA4(pageEl, layout);
        if (!first) pdf.addPage('a4', orient);
        first = false;
        /* تصویر تمام‌صفحه — حاشیهٔ چاپی داخل خود تصویر (padding برگهٔ استیج) است؛
           ۳٫۲۰ بند ۲ — کیفیت JPEG از 0.92 به 0.95 افزایش یافت (آرتیفکت‌های
           اطراف متن‌ها کمتر؛ اندازهٔ فایل حدوداً همان حدود می‌ماند) */
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pwMm, phMm, undefined, 'FAST');
      }

      /* ۳٫۱۹ بند ۳ — مهر تاریخ شمسی در نام فایل PDF (تاریخ روی هر برگه
         هم در سربرگ استیج به شمسی درج شده است) */
      pdf.save(`نمایش-گرافیکی-بسته-بندی_${PackagingView.graphJalaliStamp()}.pdf`);
      UI.toast(
        `خروجی PDF ساخته شد — ${U.faNum(pkgs.length)} بسته در ${U.faNum(layout.pages.length)} برگهٔ کامل A4 (${orient === 'landscape' ? 'افقی' : 'عمودی'} · ${U.faNum(layout.cols)} ستون)؛ هیچ کارتی در میانهٔ برگه نشکسته است.`,
        'success', 6500
      );
    } catch (err) {
      console.error('[GraphPDF]', err);
      UI.toast(`ساخت PDF با خطا مواجه شد (${U.escapeHtml(String(err.message || err).slice(0, 90))}).`, 'error', 6500);
    } finally {
      const st = document.getElementById('pack-graph-stage');
      if (st) { st.innerHTML = ''; st.hidden = true; }
      if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
    }
  };

  RM.views = RM.views || {};
  RM.views.packaging = PackagingView;
})();
