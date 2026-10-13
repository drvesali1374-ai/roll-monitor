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
    /* ۳٫۲۷ فیلد initialWidth (عرض اولیهٔ آرشیو) داشت؛ ۳٫۲۹ حذف شد — فایل
       «سابقه رول‌ها (آرشیو)» ستونی با نام «عرض اولیه» ندارد (اصلاحیهٔ کاربر). */
    actualLength:   'متراژ',
    thickness:      'ضخامت',
    filmType:       'نوع فیلم',
    palletNumber:   'شماره پالت',
    setupNumber:    'شماره ستاپ',
    productionDate: 'تاریخ تولید',
    deleteDate:    'تاریخ حذف',
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
      /* ۳٫۲۷ فیلد اختیاری initialWidth («عرض رول اولیه») داشت؛ ۳٫۲۹ حذف شد
         (اصلاحیهٔ کاربر): فایل «سابقه رول‌ها (آرشیو)» ستونی با نام «عرض اولیه»
         ندارد — این فایل فقط «عرض» دارد و در نگاشت آن فیلدی به نام «عرض اولیه»
         وجود ندارد. */
      actualLength:   { primary: 'متراژ اولیه', fallbacks: ['متراژ', 'متراجاولیه'] },
      thickness:      { primary: 'ضخامت',       fallbacks: ['ضخامتفیلم'] },
      filmType:       { primary: 'نوع فیلم',     fallbacks: ['نوعفیلم'] },
      palletNumber:   { primary: 'شماره پالت',   fallbacks: ['شمارهپالت'] },
      setupNumber:    { primary: 'شماره ستاپ',   fallbacks: ['شمارهستاپ'] },
      /* --- فیلدهای اختیاری --- */
      productionDate: { primary: 'تاریخ تولید', fallbacks: ['تاریخ تولید (شمسی)', 'تاریختولید'], optional: true },
      /* ۳٫۳۳ — «تاریخ حذف»: تاریخ و ساعت متالایز‌شدن رول آرشیو (مبنای تایم‌لاین
         رول‌های متالایز اخیر در داشبورد). اختیاری — اگر ستون در فایل نباشد،
         تایم‌لاین وضعیت خالی/راهنمای نگاشت نشان می‌دهد. */
      deleteDate:    { primary: 'تاریخ حذف',   fallbacks: ['تاریخحذف'], optional: true },
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
    'rollNumber', 'actualLength', 'productionDate', 'deleteDate', 'netWeight', 'grade',
    'status', 'width', 'cutWidth', 'thickness', 'setupNumber', 'filmType', 'palletNumber',
  ],

  /** پیش‌فرض ستون‌های جزئیات (حداقل ۵ فیلد موردنیاز) — «تاریخ حذف» (زمان
      متالایز آرشیو — بعد از «تاریخ تولید»)؛ در Datasetهای بدون این فیلد
      (رول‌های موجود) به‌صورت خودکار فیلتر می‌شود. */
  DETAIL_DEFAULT_COLUMNS: ['rollNumber', 'actualLength', 'productionDate', 'deleteDate', 'netWeight', 'grade'],

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
    timeStatus:           { label: 'وضعیت', numeric: false }, // ۳٫۳۲ — مرتب‌سازی الفبایی فارسی متن وضعیت: باقی مانده (ب) < تمام شده (ت) < منقضی شده (م)
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
      'palletNumber', 'setupNumber', 'productionDate', 'deleteDate', 'netWeight', 'grade', 'status',
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

  /** نسخهٔ فعلی برنامه — در فایل پشتیبان (appVersion) درج و در پنجرهٔ
      تأیید بازیابی نمایش داده می‌شود تا منشأ فایل پشتیبان معلوم باشد.
      ۳٫۳۳ — (۱) مرتب‌سازی ستون «وضعیت» گزارش ستاپ‌ها رتبه‌ای عددی شد
      (نامشخص ۰ · باقی مانده ۱ · تمام شده ۲ · منقضی ۳)؛ (۲) پاک‌سازی کامل
      شماره‌های نسخه از همهٔ متن‌های راهنما (بازنویسی طبق رفتار فعلی)؛
      (۳) فیلد اختیاری «تاریخ حذف» فایل «سابقه رول‌ها (آرشیو)» (زمان
      متالایز) + ستون آن در «لیست سابقه رول ها»/جدول‌های جزئیات/پیش‌نمایش
      Import + پنل جدید داشبورد «تایم‌لاین رول‌های متالایز اخیر» (تفکیک
      دستگاه × شیفت روز ۰۷–۱۹ / شب ۱۹–۰۷، تعداد شیفت قابل انتخاب و
      ماندگار). */
  APP_VERSION: '3.33',

  /* ---------------- کلیدهای تطبیق (نسخهٔ ۳٫۲۶) ----------------
     رجیستری مرکزی همهٔ کلیدهای تطبیق/هویت/گروه‌بندی پروژه. هر کلید دقیقاً
     یک نمونه دارد (قابل حذف نیست) و ترکیب پارامترهایش از طریق پنل
     «کلیدهای تطبیق» تنظیمات توسط کاربر قابل ویرایش است (appSettings:
     matchingKeys — فقط Overrideها ذخیره می‌شوند؛ نبودِ Override = پیش‌فرض).
     پارامترهای هر کلید فقط از میان فاکتورهایی انتخاب می‌شوند که در هر دو
     سمتِ همان تطبیق قابل محاسبه‌اند (ستون‌های شناسایی‌شدهٔ Mapping و
     فاکتورهای مشتق از ستون‌های Mapping) تا تطبیق هرگز خطا ندهد. */

  /** کاتالوگ فاکتورهای کلید — منبع مقدار هر فاکتور در سمت‌های مختلف */
  MATCH_KEY_PARAMS: {
    /* ۳٫۲۷ — شرح فاکتور عرض با پیش‌فرض جدید: سمت «رول‌های موجود» از ستون
       «عرض اولیه» می‌خواند (تا ۳٫۲۶ ستون «عرض» بود)؛ ستون نمایندهٔ هر فایل
       در هر کلید، در زیرمنوی همین پارامتر در کارت همان کلید قابل تغییر است
       (widthPolicy — تنظیمات ← کلیدهای تطبیق — ۳٫۲۸). */
    width:          { label: 'عرض',            desc: 'رول‌های موجود: ستون «عرض اولیه» (Mapping) · آرشیو: ستون «عرض» (Mapping) · ستاپ: فیلد عرض — ستون نمایندهٔ هر فایل در زیرمنوی همین پارامتر (در کارت هر کلید) قابل تنظیم است' },
    cutWidth:       { label: 'عرض برش',        desc: 'رول برش‌خورده: ستون «عرض» (Mapping) · سمت ستاپ: هر عرض الگوی برش' },
    standardLength: { label: 'متراژ استاندارد', desc: 'رول: حل از قوانین متراژ (ضخامت + متراژ واقعی) · ستاپ: فیلد متراژ استاندارد' },
    setupNumber:    { label: 'شماره ستاپ',      desc: 'ستون «شماره ستاپ» فایل‌های رول · فیلد شماره ستاپ' },
    thickness:      { label: 'ضخامت',          desc: 'ستون «ضخامت» (Mapping) در فایل رول / پالت · فیلد ضخامت ستاپ' },
    line:           { label: 'خط تولید',        desc: 'رول: حرف آغازین شمارهٔ رول (F=BOPP · K=CPP) · ستاپ: فیلد خط تولید' },
    hall:           { label: 'شماره سالن',      desc: 'رول: رقم اول بعد از حرف شمارهٔ رول · ستاپ: فیلد شمارهٔ سالن' },
    yearDigit:      { label: 'رقم سال',         desc: 'رول: رقم دوم بعد از حرف شمارهٔ رول (۱۴۰X) · ستاپ: رقم آخر سالِ تاریخ ستاپ' },
    machineNumber:  { label: 'شماره دستگاه',    desc: 'فیلد شماره دستگاه متالایز ستاپ (۱ تا ۳)' },
    cuttingPattern: { label: 'الگوی برش',       desc: 'فیلد الگوی برش ستاپ (ترتیب قطعات بی‌اثر — نرمال‌شده)' },
    filmType:       { label: 'نوع فیلم',        desc: 'ستون «نوع فیلم» (Mapping) — فایل پالت‌ها / رول‌ها' },
    grade:          { label: 'گرید',            desc: 'ستون «گرید» (Mapping)' },
    diameter:       { label: 'قطر بوبین',       desc: 'مشتق از ستون «نوع بسته‌بندی» فایل پالت‌ها (عدد انتهای عنوان)' },
  },

  /** کاتالوگ منابع ستون «عرض» (نسخهٔ ۳٫۲۷ · ۳٫۲۸ · اصلاح ۳٫۲۹) — ستون نمایندهٔ عرض در هر سمتِ فایل‌های رول‌ها
      (پایهٔ widthPolicy هر کلید). گزینه‌های هر سمت = فیلدهای عرض‌مانندِ نگاشت همان فایل:
        · raw (رول‌های موجود): width = ستون «عرض رول اولیه» (عرض اولیه) · cutWidth = ستون «عرض»
        · archived (سابقه رول‌ها): فقط width = ستون «عرض» — قفل‌شده (fixed)
      اصلاح ۳٫۲۹ (سند کاربر): فایل «سابقه رول‌ها (آرشیو)» ستونی با نام «عرض اولیه»
      ندارد → سمت آرشیو فقط همان یک پراپرتی «عرض» را دارد که نیاز به تنظیم توسط
      کاربر ندارد (fixed: true — Override از سوی موتور و UI پذیرفته نمی‌شود).
      ۳٫۲۸ — هر کلیدی که دادهٔ فایل‌ها در آن مشارکت دارد، سمت‌های همان فایل‌ها را
      جداگانه در زیرمنوی پارامتر عرض خود دارد؛ کلیدهای تک‌فایلی فقط سمت همان فایل. */
  WIDTH_SOURCE_FIELDS: {
    raw: {
      width:        { label: 'عرض اولیه', column: 'عرض رول اولیه' },
      cutWidth:     { label: 'عرض',       column: 'عرض' },
    },
    archived: {
      /* ۳٫۲۹ — قفل روی «عرض»: آرشیو «عرض اولیه» ندارد و تنظیمی ندارد */
      width:        { label: 'عرض', column: 'عرض', fixed: true },
    },
  },

  /** رجیستری کلیدهای تطبیق — defaults = ترکیب فعلی ۳٫۲۶+ (پیش‌فرض همیشه موجود)
      widthPolicy (۳٫۲۷ · ۳٫۲۸ · اصلاح ۳٫۲۹): سیاست ستون نمایندهٔ عرضِ هر کلید —
        · param: فاکتور هدف ('width' پیش‌فرض یا 'cutWidth')
        · sources: سمت‌های رول‌ای مشارکت‌کننده + فیلد پیش‌فرض هر سمت —
          اصلاح ۳٫۲۹ (سند کاربر): فقط در کلیدهایی که پارامتر «عرض» دارند و دیتای
          فایل «رول‌های موجود» در کلید مشارکت می‌کند، پارامتر عرض دو پراپرتی
          «عرض در فایل رول‌های موجود» (قابل تنظیم) و «عرض در فایل آرشیو» (قفل
          روی «عرض» — آرشیو «عرض اولیه» ندارد) دارد؛ لزوم مشارکت دیتای آرشیو
          حذف شد. کلیدهایی که فقط آرشیو در آن‌ها مشارکت دارد (متالایز) فقط پراپرتی
          «عرض در فایل آرشیو» (قفل‌شده) را دارند و کلیدهای تک‌فایلی رول‌های موجود
          (برش‌خورده) فقط پراپرتی همان فایل را.
        · setupOnly: عرض فقط از فیلد عرض ستاپ خوانده می‌شود (یادداشت در زیرمنو)
      کلیدهای پالت‌ها عمداً widthPolicy ندارند (خارج از دامنهٔ سند کاربر). */
  MATCH_KEYS: [
    {
      id: 'rawMatch',
      category: 'تطبیق رول‌ها با ستاپ‌ها',
      label: 'کلید تطبیق رول‌های خام با ستاپ‌ها',
      desc: 'گروه‌بندی رول‌های خام فایل «رول‌های موجود» و تطبیقشان با ستاپ‌ها (تخصیص ظرفیت‌محور، برش‌نشده، هشدار «بدون ستاپ» و گزارش ستاپ‌ها).',
      pool: ['width', 'standardLength', 'setupNumber', 'thickness', 'line', 'hall', 'yearDigit'],
      defaults: ['width', 'standardLength', 'setupNumber', 'line', 'hall', 'yearDigit'],
      /* ۳٫۲۷ — پیش‌فرض جدید: عرض رول‌های موجود در کلید = ستون «عرض اولیه»
         (فیلد width — تا ۳٫۲۶ ستون «عرض» cutWidth بود)؛ سمت ستاپ فیلد عرض.
         اصلاح ۳٫۲۹ — این کلید پارامتر «عرض» دارد و دیتای فایل «رول‌های موجود»
         در آن مشارکت می‌کند → پارامتر عرض دو پراپرتی دارد: «عرض در فایل
         رول‌های موجود» (قابل تنظیم بین «عرض اولیه» و «عرض») و «عرض در فایل
         آرشیو» (قفل روی «عرض» — فایل آرشیو ستون «عرض اولیه» ندارد و نیازی
         به تنظیم ندارد). */
      widthPolicy: { param: 'width', sources: { raw: 'width', archived: 'width' } },
    },
    {
      id: 'metMatch',
      category: 'تطبیق رول‌ها با ستاپ‌ها',
      label: 'کلید تطبیق متالایز (آرشیو) با ستاپ‌ها',
      desc: 'تطبیق رول‌های متالایزشدهٔ یکتای «سابقه رول‌ها» با ستاپ‌ها — ستون «مانده زمان متالایز»، مازاد متالایز و گروه‌های داشبورد.',
      pool: ['width', 'standardLength', 'setupNumber', 'thickness', 'line', 'hall', 'yearDigit'],
      defaults: ['width', 'standardLength', 'setupNumber', 'line', 'hall', 'yearDigit'],
      /* اصلاح ۳٫۲۹ — دیتای فایل «رول‌های موجود» در این کلید مشارکت ندارد (فقط
         آرشیو) → پارامتر عرض فقط پراپرتی «عرض در فایل آرشیو» را دارد که قفل
         روی «عرض» است (فایل آرشیو ستون «عرض اولیه» ندارد → تنظیمی ندارد).
         تا ۳٫۲۸ سمت رول‌های موجود هم در این کلید بود که حذف شد. */
      widthPolicy: { param: 'width', sources: { archived: 'width' } },
    },
    {
      id: 'metFive',
      category: 'تطبیق رول‌ها با ستاپ‌ها',
      label: 'کلید ۵فاکتوری هشدار «عرض تعریف‌نشده»',
      desc: 'هشدار مرکز کیفیت دادهٔ داشبورد: رول متالایزی که کلید بدون «عرض»اش با ستاپ منطبق است ولی با عرضِ ستاپ‌ها منطبق نیست.',
      pool: ['standardLength', 'setupNumber', 'thickness', 'line', 'hall', 'yearDigit'],
      defaults: ['standardLength', 'setupNumber', 'line', 'hall', 'yearDigit'],
    },
    {
      id: 'cutMatch',
      category: 'تطبیق رول‌ها با ستاپ‌ها',
      label: 'کلید تطبیق رول‌های برش‌خورده با ستاپ‌ها',
      desc: 'تطبیق رول‌های برش‌خوردهٔ موجود (دارای بازوی R/L) با رکوردهای حاصل از تنوع عرض‌های الگوی برش ستاپ‌ها — گزارش «رول‌های برش‌خورده».',
      pool: ['cutWidth', 'setupNumber', 'thickness', 'standardLength', 'line', 'hall', 'yearDigit'],
      defaults: ['cutWidth', 'setupNumber', 'line', 'hall', 'yearDigit'],
      /* ۳٫۲۷ — منبع «عرض برش» رول‌های برش‌خورده (فایل رول‌های موجود):
         پیش‌فرض ستون «عرض» (رفتار همیشگی)؛ ستون نماینده قابل تغییر است.
         ۳٫۲۸ — این کلید تک‌فایلی است (فقط رول‌های موجود مشارکت دارند):
         زیرمنوی پارامتر «عرض برش» فقط همین یک سمت را دارد. */
      widthPolicy: { param: 'cutWidth', sources: { raw: 'cutWidth' } },
    },
    {
      id: 'setupUnique',
      category: 'هویت و یکتایی ستاپ‌ها',
      label: 'کلید یکتایی رکورد ستاپ',
      desc: 'جلوگیری از ثبت رکورد ستاپِ تکراری در فرم ثبت/ویرایش و ردیف‌های ثبت گروهی (Bulk).',
      pool: ['width', 'setupNumber', 'standardLength', 'thickness', 'machineNumber', 'cuttingPattern', 'line', 'hall', 'yearDigit'],
      defaults: ['width', 'setupNumber', 'standardLength', 'machineNumber', 'cuttingPattern', 'line', 'hall', 'yearDigit'],
      /* ۳٫۲۷ — هر دو سمتِ این کلید رکورد ستاپ‌اند: عرض فقط از فیلد عرض ستاپ
         خوانده می‌شود و ستونی از فایل رول‌ها در آن مشارکت ندارد (یادداشت زیرمنو). */
      widthPolicy: { setupOnly: true },
    },
    {
      id: 'setupIdentity',
      category: 'هویت و یکتایی ستاپ‌ها',
      label: 'کلید هویت ستاپ در ثبت گروهی',
      desc: 'کنترل تکراری‌بودن هویت Batch هنگام ثبت گروهی — فقط فاکتورهای مشترک کل Batch (شماره ستاپ/تاریخ/خط/سالن/ضخامت).',
      pool: ['setupNumber', 'yearDigit', 'line', 'hall', 'thickness'],
      defaults: ['setupNumber', 'yearDigit', 'line', 'hall'],
    },
    {
      id: 'qualityIdentity',
      category: 'کنترل کیفیت داده',
      label: 'کلید هویت کنترل کیفیت ضخامت',
      desc: 'گروه‌بندی رول‌ها برای کنترل «یکسانی ضخامت در ستاپ» در کنترل‌های کیفیت دادهٔ لیست رول‌ها.',
      pool: ['setupNumber', 'line', 'hall', 'yearDigit'],
      defaults: ['setupNumber', 'line', 'hall', 'yearDigit'],
    },
    {
      id: 'palletGroup',
      category: 'بسته‌بندی (پالت‌ها)',
      label: 'کلید گروه‌بندی پالت‌ها (پنج‌ویژگی)',
      desc: 'گروه‌بندی پالت‌های سازگار برای بهینه‌سازی بسته‌بندی در صفحهٔ «بسته‌بندی».',
      pool: ['filmType', 'thickness', 'width', 'grade', 'diameter'],
      defaults: ['filmType', 'thickness', 'width', 'grade', 'diameter'],
    },
    {
      id: 'palletMix',
      category: 'بسته‌بندی (پالت‌ها)',
      label: 'کلید گروه ترکیبی U+X بسته‌بندی',
      desc: 'گروه‌بندی باقی‌مانده‌های گرید U و X در فاز ترکیبی بسته‌بندی (پیش‌فرض بدون گرید تا ترکیب ممکن شود).',
      pool: ['filmType', 'thickness', 'width', 'diameter', 'grade'],
      defaults: ['filmType', 'thickness', 'width', 'diameter'],
    },
  ],
};
