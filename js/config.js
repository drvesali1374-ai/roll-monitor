/* =========================================================================
   config.js — ثابت‌ها و پیکربندی مرکزی سیستم
   -------------------------------------------------------------------------
   تمام ثابت‌های سیستم در این فایل تعریف می‌شود تا هیچ مقدار کاری
   در کدهای Business Logic به‌صورت Hardcode باقی نماند (§92-93).
   ========================================================================= */

'use strict';

/** فضای نام سراسری برنامه (سازگار با file:// — بدون ES Module) */
window.RM = window.RM || {};

RM.config = {

  /* ---------------- پیکربندی اهداف Import ---------------- */

  IMPORT_TARGETS: {
    rolls: {
      key: 'rolls',
      table: 'rolls',
      label: 'رول‌های موجود',
      expectedFile: 'rolls.xlsx',
      /** ستون‌های مورد نیاز این فایل (نقشه §8) */
      requiredColumns: ['شماره رول', 'عرض رول اولیه', 'متراژ', 'ضخامت', 'نوع فیلم', 'شماره پالت', 'شماره ستاپ'],
    },
    archived: {
      key: 'archived',
      table: 'archivedRolls',
      label: 'سابقه رول‌ها (آرشیو)',
      expectedFile: 'Archived Rolls.xlsx',
      requiredColumns: ['شماره رول', 'عرض', 'متراژ اولیه', 'ضخامت', 'نوع فیلم', 'شماره پالت', 'شماره ستاپ'],
    },
    /* نسخهٔ ۳٫۱۲ — فایل مدیریت پالت‌ها (خروجی نرم‌افزار مدیریت رول) برای صفحهٔ «بسته‌بندی».
       customUi: رابط Import این فایل در خود صفحهٔ «بسته‌بندی» است (نه تب «ورود داده‌ها»)؛
       Mapping آن مانند دو فایل دیگر از تنظیمات تعریف می‌شود. */
    pallets: {
      key: 'pallets',
      table: 'pallets',
      label: 'پالت‌ها (بسته‌بندی)',
      expectedFile: 'Pallet Data.xls',
      requiredColumns: ['شناسه پالت', 'شماره پالت', 'نوع فیلم', 'ضخامت', 'عرض', 'نوع بسته بندی', 'گرید', 'لیست شماره رول ها'],
      customUi: true,
      normalizer: 'pallets',
    },
  },

  /** عنوان‌های کاربرپسندهٔ Datasetها (نام فنی فقط برای Audit نمایش داده می‌شود) */
  DATASET_LABELS: {
    rolls: 'رول‌های موجود',
    archived: 'سابقه رول‌ها (آرشیو)',
    pallets: 'پالت‌ها (بسته‌بندی)',
  },

  /** برچسب منطقی فیلدها — برای پنل نگاشت ستون‌ها و عنوان ستون‌های جزئیات */
  FIELD_LABELS: {
    rollNumber:     'شماره رول',
    width:          'عرض',
    cutWidth:       'عرض',
    actualLength:   'متراژ',
    thickness:      'ضخامت',
    filmType:       'نوع فیلم',
    palletNumber:   'شماره پالت',
    setupNumber:    'شماره ستاپ',
    productionDate: 'تاریخ تولید',
    netWeight:      'وزن خالص',
    grade:          'گرید',
    status:         'وضعیت',
    /* فیلدهای فایل پالت‌ها (نسخهٔ ۳٫۱۲ — صفحهٔ بسته‌بندی) */
    palletId:       'شناسه پالت',
    palletNo:       'شماره پالت',
    packType:       'نوع بسته‌بندی',
    rollList:       'لیست شماره رول‌ها',
    warehouse:      'انبار',
    grossWeight:    'وزن ناخالص',
    customerCode:   'کد مشتری',
    techSpec:       'مشخصه فنی',
  },

  /** برچسب‌های اختصاصی هر Dataset (اولویت بر FIELD_LABELS)
      «رول‌های موجود»: فیلد width برچسب «عرض اولیه» دارد (محاسبات رول‌های خام)
      و فیلد جدید cutWidth برچسب «عرض» دارد (محاسبات رول‌های برش‌خورده). */
  SOURCE_FIELD_LABELS: {
    rolls: { width: 'عرض اولیه' },
  },

  /* ---------------- نقشه ستون‌های Excel → مدل داخلی (§8-§9) ----------------
     نام اصلی + نام‌های جایگزین برای مقاوم‌سازی در برابر تغییرات جزئی اکسل */

  /*  نگاشت پیش‌فرض ستون‌ها — قابل بازنویسی توسط کاربر در تنظیمات
      (تنظیم در appSettings با کلید columnMapping؛ مستقل برای هر Dataset).
      فیلدهای optional: true در صورت نبود ستون، خطا نیستند (فیلدهای
      نمایشی/جزئیات مثل تاریخ تولید، وزن خالص، گرید و وضعیت). */
  COLUMN_MAP: {
    rolls: {
      rollNumber:     { primary: 'شماره رول',     fallbacks: ['شمارهرول', 'Roll Number'] },
      /* عرض اولیه — نمایشی؛ مبنای محاسبات خام نیست (۳٫۹ — تغییر ۱: کلید
         گروه‌بندی/تطبیق ستاپ از فیلد «عرض» cutWidth خوانده می‌شود) */
      width:          { primary: 'عرض رول اولیه', fallbacks: ['عرض'] },
      /* عرض (جدید) — مبنای کلیدهای انطباق/تخصیص رول‌های خام (۳٫۹ — تغییر ۱)
         و محاسبات رول‌های برش‌خورده (فرزند).
         fallback «عرض رول اولیه»: فقط وقتی فایل اصلاً ستون «عرض» نداشته
         باشد، تطبیق با همان عرض اولیه ادامه می‌یابد (حفظ کارکرد فایل‌های
         قدیمی) — در غیر این صورت همیشه ستون «عرض» ملاک است. */
      cutWidth:       { primary: 'عرض',            fallbacks: ['عرض رول اولیه'], optional: true },
      actualLength:   { primary: 'متراژ',          fallbacks: ['متراز', 'Length'] },
      thickness:      { primary: 'ضخامت',          fallbacks: ['ضخامتفیلم'] },
      filmType:       { primary: 'نوع فیلم',       fallbacks: ['نوعفیلم'] },
      palletNumber:   { primary: 'شماره پالت',     fallbacks: ['شمارهپالت'] },
      setupNumber:    { primary: 'شماره ستاپ',     fallbacks: ['شمارهستاپ'] },
      /* --- فیلدهای اختیاری (جزئیات رکورد — § نگاشت قابل تنظیم) --- */
      productionDate: { primary: 'تاریخ تولید',   fallbacks: ['تاریختولید'], optional: true },
      netWeight:      { primary: 'وزن خالص',       fallbacks: ['وزنخالص'], optional: true },
      grade:          { primary: 'گرید',           fallbacks: [], optional: true },
      /* موقعیت فعلی («پای کار» و…) از فیلد وضعیت خوانده می‌شود */
      status:         { primary: 'وضعیت',          fallbacks: ['وضعیتفعلی', 'موقعیت فعلی', 'موقعیتفعلی'], optional: true },
    },
    archived: {
      rollNumber:     { primary: 'شماره رول',   fallbacks: ['شمارهرول'] },
      width:          { primary: 'عرض',          fallbacks: ['عرضرول'] },
      actualLength:   { primary: 'متراژ اولیه', fallbacks: ['متراژ', 'متراجاولیه'] },
      thickness:      { primary: 'ضخامت',       fallbacks: ['ضخامتفیلم'] },
      filmType:       { primary: 'نوع فیلم',     fallbacks: ['نوعفیلم'] },
      palletNumber:   { primary: 'شماره پالت',   fallbacks: ['شمارهپالت'] },
      setupNumber:    { primary: 'شماره ستاپ',   fallbacks: ['شمارهستاپ'] },
      /* --- فیلدهای اختیاری --- */
      productionDate: { primary: 'تاریخ تولید', fallbacks: ['تاریخ تولید (شمسی)', 'تاریختولید'], optional: true },
      netWeight:      { primary: 'وزن خالص',     fallbacks: ['وزنخالص'], optional: true },
      grade:          { primary: 'گرید',         fallbacks: [], optional: true },
      status:         { primary: 'وضعیت',        fallbacks: ['علت'], optional: true },
    },
    /* --- فایل مدیریت پالت‌ها (نسخهٔ ۳٫۱۲ — صفحهٔ «بسته‌بندی») ---
       نام‌های پیش‌فرض از فایل واقعی «Pallet Data.xls» (خروجی نرم‌افزار مدیریت رول).
       نام ستون «ست شماره رول‌ها» (عنوان سند) و «لیست شماره رول ها» (فایل واقعی)
       هر دو با هم نرمال می‌شوند (normalizeHeader فاصله/نیم‌فاصله را حذف می‌کند). */
    pallets: {
      palletId:       { primary: 'شناسه پالت',    fallbacks: ['شناسهپالت', 'Pallet ID'], optional: true },
      palletNo:       { primary: 'شماره پالت',    fallbacks: ['شمارهپالت', 'پالت'] },
      filmType:       { primary: 'نوع فیلم',      fallbacks: ['نوعفیلم'] },
      thickness:      { primary: 'ضخامت',         fallbacks: ['ضخامتفیلم'] },
      width:          { primary: 'عرض',           fallbacks: ['عرضورول'] },
      packType:       { primary: 'نوع بسته بندی', fallbacks: ['نوع بسته‌بندی', 'نوعبستهبندی'] },
      grade:          { primary: 'گرید',          fallbacks: [] },
      rollList:       { primary: 'لیست شماره رول ها', fallbacks: ['ست شماره رول‌ها', 'لیست شماره رول‌ها', 'ست شماره رول ها', 'لیست رول ها', 'شماره رول ها'] },
      /* --- فیلدهای اختیاری --- */
      warehouse:      { primary: 'انبار',         fallbacks: ['موقعیت انبار', 'انبارموقعیت'], optional: true },
      productionDate: { primary: 'تاریخ تولید',  fallbacks: ['تاریختولید'], optional: true },
      netWeight:      { primary: 'وزن خالص',      fallbacks: ['وزنخالص'], optional: true },
      grossWeight:    { primary: 'وزن ناخالص',    fallbacks: ['وزنناخالص'], optional: true },
      setupNumber:    { primary: 'شماره ستاپ',    fallbacks: ['شمارهستاپ'], optional: true },
      customerCode:   { primary: 'کد مشتری',      fallbacks: ['کدمشتری'], optional: true },
      techSpec:       { primary: 'مشخصه فنی',     fallbacks: ['مشخصه فنی'], optional: true },
    },
  },

  /* ---------------- قوانین کسب‌وکار صفحهٔ «بسته‌بندی» (نسخهٔ ۳٫۱۲) ----------------
     مستقل از UI — کل منطق در js/packaging.js این ثابت‌ها را مصرف می‌کند
     (قوانین قطعی سند بسته‌بندی؛ تغییر آستانه‌ها فقط از همین‌جا). */

  PALLET_RULES: {
    /** فقط ردیف‌هایی که «نوع فیلم» آنها شامل حرف M است وارد برنامه می‌شوند */
    FILM_METAL_LETTER: 'M',
    /** خط تولید از اولین کاراکتر نوع فیلم: F → BOPP · K → CPP */
    LINE_BY_FIRST_CHAR: { F: 'BOPP', K: 'CPP' },
    /** قطرهای بوبین دارای قانون ظرفیت (عدد انتهای «نوع بسته‌بندی» اکسل) */
    VALID_DIAMETERS: [3, 6],
    /** پیشوند وضعیت انبار برای دامنهٔ «موجود در انبار» (خروج از انبار = خارج از دامنه) */
    WAREHOUSE_PREFIX: 'انبار',
    /* آستانه‌های ظرفیت استاندارد (تعداد طبقه × تعداد رول در طبقه) */
    D3_WIDTH_LAYERS: 800,     // بوبین ۳: عرض >= ۸۰۰ → ۱ طبقه × ۴ · کمتر → ۲ طبقه × ۴
    BOPP_D6_WIDTH: 850,       // بوبین ۶ BOPP: عرض >= ۸۵۰ → H (۲×۱) · کمتر → V (۲×۱)
    CPP_D6_WIDTH: 600,        // بوبین ۶ CPP: عرض >= ۶۰۰ → H (۲×۱) · کمتر → H (۲×۲)
    /** ظرفیت‌های هدف به ترتیب اولویت (بوبین ۶ = فقط ظرفیت استاندارد) */
    TARGETS_D3_STD8: [8, 7, 4, 3],
    TARGETS_D3_STD4: [4, 3],
  },

  /** جدول‌های صفحهٔ بسته‌بندی — سقف رندر DOM (فیلتر روی کل داده) */
  PACK_MAX_DOM_ROWS: 2000,

  /* ---------------- ستون‌های جزئیات رکورد (گروه رول / Drill-down) ----------------
     ترتیب و انتخاب ستون‌ها توسط کاربر (appSettings: rollDetailColumns) تعیین
     می‌شود؛ نام ستون‌ها از Mapping کاربر خوانده می‌شود. */
  DETAIL_FIELDS: [
    'rollNumber', 'actualLength', 'productionDate', 'netWeight', 'grade',
    'status', 'width', 'cutWidth', 'thickness', 'setupNumber', 'filmType', 'palletNumber',
  ],

  /** پیش‌فرض ستون‌های جزئیات (حداقل ۵ فیلد موردنیاز) */
  DETAIL_DEFAULT_COLUMNS: ['rollNumber', 'actualLength', 'productionDate', 'netWeight', 'grade'],

  /* ---------------- محدودیت‌های دامنه کسب‌وکار ---------------- */

  /** شماره دستگاه تولید متالایز — تنها مقادیر مجاز (§21) */
  VALID_MACHINES: [1, 2, 3],

  /** فیلدهای مرتب‌سازی مجاز صفحه رول‌های خام (§36) + وضعیت تطبیق گروه
      نسخهٔ ۳٫۰ (تغییر ۶): هویت گروه — خط تولید/سالن/سال هم قابل مرتب‌سازی‌اند. */
  SORTABLE_FIELDS: {
    width:          { label: 'عرض',            numeric: true },
    thickness:      { label: 'ضخامت',          numeric: true },
    standardLength: { label: 'متراژ استاندارد', numeric: true },
    setupNumber:    { label: 'شماره ستاپ',      numeric: true },
    line:           { label: 'خط تولید',       numeric: false },  // نسخهٔ ۳٫۰ — هویت گروه
    hall:           { label: 'شماره سالن',      numeric: true },   // نسخهٔ ۳٫۰ — هویت گروه
    yearDigit:      { label: 'سال',            numeric: true },   // نسخهٔ ۳٫۰ — هویت گروه
    count:          { label: 'تعداد',           numeric: true },
    status:         { label: 'وضعیت',          numeric: false },
  },

  /** مرتب‌سازی پیش‌فرض صفحه رول‌های خام */
  DEFAULT_SORT: [
    { field: 'setupNumber', direction: 'asc' },
    { field: 'width', direction: 'asc' },
    { field: 'standardLength', direction: 'asc' },
  ],

  /* ---------------- پنل مرتب‌سازی گزارش تولید ستاپ‌ها ----------------
     همان سازوکار رول‌های خام — فیلدهای گزارش ستاپ + ماندگاری
     (appSettings: setupReportSort). */
  SETUP_SORTABLE_FIELDS: {
    setupNumber:          { label: 'شماره ستاپ',      numeric: true },
    productionLine:       { label: 'خط تولید',        numeric: false },  // نسخهٔ ۲٫۹ — هویت ستاپ
    hallNumber:           { label: 'شماره سالن',      numeric: true },   // نسخهٔ ۲٫۹ — هویت ستاپ
    machineNumber:        { label: 'شماره دستگاه',    numeric: true },
    setupDate:            { label: 'تاریخ ستاپ',      numeric: false },  // نسخهٔ ۲٫۸ — مرتب‌سازی لغوی YYYY/MM/DD = زمانی؛ مستقل از نمایش ستون
    width:                { label: 'عرض',            numeric: true },
    thickness:            { label: 'ضخامت',          numeric: true },
    standardLength:       { label: 'متراژ استاندارد', numeric: true },
    setCount:             { label: 'تعداد ست',        numeric: true },   // تغییر ۱
    rollCount:            { label: 'تعداد در ستاپ',   numeric: true },   // نسخهٔ ۳٫۳ — تغییر نام ستون «تعداد»
    rawExisting:          { label: 'خام موجود',       numeric: true },
    metallized:           { label: 'متالایز',         numeric: true },
    uncut:                { label: 'برش‌نشده',        numeric: true },
    cuttingPattern:       { label: 'الگوی برش',       numeric: false },
    remainingSetupTime:   { label: 'مانده زمان ستاپ', numeric: true },
    timeStatus:           { label: 'وضعیت (تمام/باقی)', numeric: true }, // نسخهٔ ۲٫۸ — بر مبنای مانده زمان ستاپ
    remainingProducedTime:{ label: 'مانده زمان موجودی', numeric: true },
  },

  /** مرتب‌سازی پیش‌فرض گزارش تولید ستاپ‌ها */
  SETUP_DEFAULT_SORT: [
    { field: 'setupNumber', direction: 'asc' },
    { field: 'width', direction: 'asc' },
  ],

  /* ---------------- ترتیب ستون‌های گزارش ستاپ‌ها (نسخهٔ ۲٫۳) ----------------
     ترتیب توسط کاربر در «پنل ترتیب ستون‌ها» (کشیدنی) تغییر می‌کند و
     به‌صورت ماندگار در appSettings: setupColumnOrder ذخیره می‌شود. */
  SETUP_DEFAULT_COLUMN_ORDER: [
    'setupNumber', 'productionLine', 'hallNumber', 'setupDate', 'machineNumber', 'width', 'thickness',
    'standardLength', 'setCount', 'rollCount', 'cuttingPattern', 'rawExisting', 'metallized', 'uncut',
    'remainingSetupTime', 'timeStatus', 'remainingProducedTime', 'actions',
  ],

  /* ستون‌های مخفی به‌صورت پیش‌فرض (نسخهٔ ۲٫۸) — «تاریخ» از پنل ترتیب ستون‌ها
     (چشم) به جدول اضافه می‌شود؛ مرتب‌سازی با آن مستقل از نمایش کار می‌کند. */
  SETUP_DEFAULT_HIDDEN_COLUMNS: ['setupDate'],

  /* ---------------- عرض پیش‌فرض ستون‌های گزارش ستاپ‌ها (نسخهٔ ۲٫۴) ----------------
     در «پنل ترتیب ستون‌ها» بجای فلش‌های بالا/پایین، یک باکس عددی برای عرض هر
     ستون (px) قرار دارد؛ مقادیر کاربر به‌صورت ماندگار در appSettings:
     setupColumnWidths ذخیره می‌شود. صفر یا خالی → عرض خودکار مرورگر. */
  SETUP_DEFAULT_COLUMN_WIDTHS: {
    setupNumber:           84,
    productionLine:        92,   // نسخهٔ ۲٫۹ — خط تولید هویت ستاپ
    hallNumber:            72,   // نسخهٔ ۲٫۹ — شماره سالن هویت ستاپ
    setupDate:             112,
    machineNumber:         84,
    width:                 96,
    thickness:             92,
    standardLength:        118,
    setCount:              92,
    rollCount:             112,  // نسخهٔ ۳٫۳ — عنوان بلندتر «تعداد در ستاپ»
    cuttingPattern:        236,
    rawExisting:           96,
    metallized:            92,
    uncut:                 104,
    remainingSetupTime:    128,
    timeStatus:            106,
    remainingProducedTime: 132,
    actions:               118,
  },

  /* ---------------- پنل مرتب‌سازی رول‌های برش‌خورده (فرزند) ----------------
     همان سازوکار رول‌های خام + ماندگاری (appSettings: cutRollsSort).
     مرتب‌سازی همیشه بر مبنای «تعداد» هر ستون است (وزن از تعداد مشتق می‌شود). */
  CUT_SORTABLE_FIELDS: {
    setupNumber:    { label: 'شماره ستاپ',      numeric: true },
    width:          { label: 'عرض',            numeric: true },
    line:           { label: 'خط تولید',       numeric: false },  // نسخهٔ ۳٫۰ — هویت رکورد
    hall:           { label: 'شماره سالن',      numeric: true },   // نسخهٔ ۳٫۰ — هویت رکورد
    yearDigit:      { label: 'سال',            numeric: true },   // نسخهٔ ۳٫۰ — هویت رکورد
    existingCount:  { label: 'مقدار موجود',     numeric: true },
    inSetupCount:   { label: 'مقدار در ستاپ',   numeric: true },
    uncutCount:     { label: 'مقدار برش‌نخورده', numeric: true },
    xCount:         { label: 'گرید X',         numeric: true },
    uCount:         { label: 'گرید U',         numeric: true },
    qCount:         { label: 'گرید Q',         numeric: true },
    tCount:         { label: 'گرید T',         numeric: true },
    endCount:       { label: 'پای کار',         numeric: true },
    palletCount:    { label: 'پالت شده',        numeric: true },
  },

  /** مرتب‌سازی پیش‌فرض جدول رول‌های برش‌خورده */
  CUT_DEFAULT_SORT: [
    { field: 'setupNumber', direction: 'asc' },
    { field: 'width', direction: 'asc' },
  ],

  /* ---------------- ترتیب ستون‌های «گروه‌بندی رول‌های خام» (نسخهٔ ۲٫۶) ----------------
     همان سازوکار گزارش ستاپ‌ها: ترتیب با «پنل ترتیب ستون‌ها» (کشیدنی) تغییر
     می‌کند و در appSettings: rawColumnOrder ذخیره می‌شود.
     نسخهٔ ۳٫۰ (تغییر ۶): ستون‌های هویت (خط تولید/سالن/سال) بعد از ستاپ. */
  RAW_DEFAULT_COLUMN_ORDER: [
    'width', 'thickness', 'standardLength', 'setupNumber',
    'line', 'hall', 'year',
    'count', 'status', 'details',
  ],

  /** عرض پیش‌فرض ستون‌های رول‌های خام — خالی = خودکار (کاربر از پنل عرض می‌دهد) */
  RAW_DEFAULT_COLUMN_WIDTHS: {},

  /* ---------------- ترتیب ستون‌های «رول‌های برش‌خورده» (نسخهٔ ۲٫۶) ----------------
     نسخهٔ ۳٫۰ (تغییر ۶): ستون‌های هویت (خط تولید/سالن/سال) بعد از ستاپ. */
  CUT_DEFAULT_COLUMN_ORDER: [
    'width', 'setupNumber', 'line', 'hall', 'year',
    'existingCount', 'inSetupCount', 'uncutCount',
    'xCount', 'uCount', 'qCount', 'tCount', 'endCount', 'palletCount',
    'details',
  ],

  /** عرض پیش‌فرض ستون‌های برش‌خورده — خالی = خودکار */
  CUT_DEFAULT_COLUMN_WIDTHS: {},

  /** تعداد حداقل رکوردهای قابل‌مشاهدهٔ جدول برش‌خورده (ارتفاع بلند + اسکرول)
      نسخهٔ ۲٫۴: مقدار اولیهٔ باکس «ردیف‌های قابل نمایش» — کاربر عدد دلخواه می‌دهد */
  CUT_VISIBLE_ROWS: 50,

  /** ارتفاع جدول رول‌های خام — همان طراحی برش‌خورده‌ها (نسخهٔ ۲٫۳)
      نسخهٔ ۲٫۴: مقدار اولیهٔ باکس «ردیف‌های قابل نمایش» */
  RAW_VISIBLE_ROWS: 50,

  /** ارتفاع جدول گزارش تولید ستاپ‌ها — همان طراحی برش‌خورده‌ها (نسخهٔ ۲٫۳)
      نسخهٔ ۲٫۴: مقدار اولیهٔ باکس «ردیف‌های قابل نمایش» */
  SETUP_VISIBLE_ROWS: 50,

  /** محدودهٔ مجاز باکس تعداد ردیف قابل نمایش (نسخهٔ ۲٫۴) */
  VISIBLE_ROWS_MIN: 5,
  VISIBLE_ROWS_MAX: 500,

  /* ---------------- رنگ ثابت دستگاه‌ها در دونات‌های داشبورد ----------------
     نسخهٔ ۲٫۶ (درخواست کاربر): رنگ‌های پررنگ‌تر و شفاف‌تر —
     دستگاه ۱ → سبز #82C836 · دستگاه ۲ → نارنجی #F09252 · دستگاه ۳ → آبی #00C1EE
     (فقط در دو دونات «مانده زمان ستاپ/موجودی» استفاده می‌شود) */
  MACHINE_COLORS: { 1: '#82C836', 2: '#F09252', 3: '#00C1EE' },

  /* ---------------- ثابت‌های کسب‌وکار رول‌های برش‌خورده ---------------- */

  /** وزن هر رول برش‌خورده = عرض × ضریب ثابت × تعداد (کیلوگرم) */
  CUT_WEIGHT_PER_MM: 0.362,

  /** حروف مجاز گرید (پیشوند لاتین ستون گرید) */
  GRADE_LETTERS: ['X', 'U', 'Q', 'T'],

  /** عبارت جست‌وجوی «پای کار» در ستون موقعیت فعلی (وضعیت) */
  END_OF_LINE_KEYWORD: 'پای کار',

  /* ---------------- قوانین زمان متالایز (هر دستگاه) ---------------- */

  /** طول شیفت تولید (دقیقه) — مدت زمان هر رول = ۷۲۰ ÷ تعداد در شیفت */
  SHIFT_MINUTES: 720,

  /* ---------------- لیست رول‌ها در صفحهٔ «ورود داده‌ها» (تغییر ۳) ----------------
     دو زبانهٔ «لیست رول های موجود» و «لیست سابقه رول ها» — هر کدام جدولی
     با همهٔ اطلاعات فایل مربوط به خود + فیلتر ستون‌ها + پنل مرتب‌سازی +
     پنل ترتیب ستون‌ها (با نمایش/مخفی‌کردن هر ستون) + ویرایش هر رکورد. */

  /** فیلدهای قابل نمایش/ویرایش لیست‌ها (فیلدهای مدل داخلی — همهٔ اطلاعات فایل) */
  LIST_SORTABLE_FIELDS: {
    rollNumber:     { label: 'شماره رول',     numeric: false },
    width:          { label: 'عرض',           numeric: true },
    cutWidth:       { label: 'عرض برش',       numeric: true },
    actualLength:   { label: 'متراژ',         numeric: true },
    thickness:      { label: 'ضخامت',         numeric: true },
    filmType:       { label: 'نوع فیلم',      numeric: false },
    palletNumber:   { label: 'شماره پالت',    numeric: false },
    setupNumber:    { label: 'شماره ستاپ',    numeric: true },
    productionDate: { label: 'تاریخ تولید',   numeric: false },
    netWeight:      { label: 'وزن خالص',      numeric: true },
    grade:          { label: 'گرید',          numeric: false },
    status:         { label: 'وضعیت',         numeric: false },
  },

  /** ترتیب پیش‌فرض ستون‌های هر لیست («رول‌های موجود» دارای عرض برش است) */
  LIST_DEFAULT_COLUMN_ORDER: {
    rolls: [
      'rollNumber', 'width', 'cutWidth', 'actualLength', 'thickness', 'filmType',
      'palletNumber', 'setupNumber', 'productionDate', 'netWeight', 'grade', 'status',
      'actions',
    ],
    archived: [
      'rollNumber', 'width', 'actualLength', 'thickness', 'filmType',
      'palletNumber', 'setupNumber', 'productionDate', 'netWeight', 'grade', 'status',
      'actions',
    ],
  },

  /** عرض پیش‌فرض ستون‌های لیست‌ها — خالی = خودکار (کاربر از پنل عرض می‌دهد) */
  LIST_DEFAULT_COLUMN_WIDTHS: {},

  /** مرتب‌سازی پیش‌فرض لیست‌ها */
  LIST_DEFAULT_SORT: [
    { field: 'setupNumber', direction: 'asc' },
    { field: 'rollNumber', direction: 'asc' },
  ],

  /** تعداد ردیف قابل نمایش لیست‌ها (مقدار اولیهٔ باکس «ردیف‌های قابل نمایش») */
  LIST_VISIBLE_ROWS: 50,

  /** حداکثر ردیف‌های رندرشده در DOM برای هر لیست (پاسخ‌گویی با دیتای بزرگ) */
  LIST_MAX_DOM_ROWS: 2000,

  /** فیلدهای عددی فرم ویرایش رکورد (متن‌ها باقی فیلدها) */
  LIST_NUMERIC_EDIT_FIELDS: ['width', 'cutWidth', 'actualLength', 'thickness', 'netWeight'],
  LIST_INT_EDIT_FIELDS: ['setupNumber'],

  /* ---------------- تنظیمات UI ---------------- */

  /** تعداد ردیف هر صفحه در جدول‌های صفحه‌بندی‌شده (§56) */
  PAGE_SIZE: 30,

  /** حداکثر رکورد پیش‌نمایش داده خام پس از Import */
  PREVIEW_ROWS: 20,

  /** نام برنامه برای فایل Backup */
  APP_NAME: 'RollMonitor',
};
