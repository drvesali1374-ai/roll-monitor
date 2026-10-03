/* =========================================================================
   setups.js — موتور مدیریت ستاپ‌ها (§20-§30، §89-§91)
   -------------------------------------------------------------------------
   مدل ستاپ (نسخهٔ ۲٫۹):
     { id, setupNumber, machineNumber(1|2|3), width, thickness,
       standardLength, rollCount, cuttingPattern,
       productionLine('BOPP'|'CPP'), hallNumber(1|2|3|4), setupDate(YYYY/MM/DD شمسی)،
       createdAt, updatedAt }

   قوانین حاکم:
     - کلید یکتا: عرض + شماره ستاپ + متراژ استاندارد + شماره دستگاه + الگو
       + خط تولید + شماره سالن + عدد سال (§25 + نسخهٔ ۲٫۹)
     - ارث‌بری ضخامت: رکورد جدیدِ «همان هویت ۴فاکتوری» → ضخامت قفل (§22 + نسخهٔ ۳٫۰)
     - ارث‌بری تاریخ ستاپ: رکورد جدیدِ «همان هویت ۴فاکتوری» → تاریخ قفل (نسخهٔ ۳٫۰)
     - خط تولید: پیش‌فرض = آخرین خطِ ثبت‌شدهٔ همان شماره ستاپ — قابل تغییر (نسخهٔ ۲٫۹)
     - شماره سالن: کلید (شماره ستاپ + خط تولید) → فقط «پیشنهاد»، قابل تغییر (نسخهٔ ۳٫۰)
     - عدد سال: از تاریخ ستاپ (رقم آخر سال ۱۴۰۵ → ۵) — فیلد جدا ندارد (نسخهٔ ۲٫۹)
     - تغییر ضخامت در ویرایش → آبشار تراکنشی (همان ستاپ + خط + سالن) با تأیید کاربر (§23)
     - متراژ استاندارد فقط از قوانینِ همان ضخامت (§24)
     - دستگاه فقط ۱/۲/۳ — دستگاه متالایز (§21)
     - الگوی برش: مجموع ≤ عرض مادر (§27-§28)
     - Bulk (نسخهٔ ۲٫۹): کلید هویت «شماره ستاپ + عدد سال + خط تولید + شماره سالن»
       نباید با رکوردهای ثبت‌شده تکراری باشد
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const N = RM.normalize;
  const R = RM.rulesEngine;
  const db = RM.db.db;

  const Setups = {};

  /* ---------------- ثابت‌های هویت (نسخهٔ ۲٫۹) ---------------- */

  /** خطوط تولید مجاز */
  Setups.PRODUCTION_LINES = ['BOPP', 'CPP'];

  /** شماره سالن‌های مجاز */
  Setups.VALID_HALLS = [1, 2, 3, 4];

  /* ---------------- الگوی برش (§27-§29) ---------------- */

  /**
   * تجزیهٔ الگوی برش: "1100-1170" → [1100, 1170]
   * ارقام فارسی/لاتین پذیرفته می‌شوند (§95).
   * خروجی: { ok, parts, sum, message }
   */
  Setups.parsePattern = function (patternText) {
    const raw = String(patternText ?? '').trim();
    if (raw === '') return { ok: true, parts: [], sum: 0, message: '' };   // الگو اختیاری است

    const tokens = raw.split('-');
    const parts = [];

    for (const token of tokens) {
      const trimmed = token.trim();
      const num = U.parseNumber(trimmed);
      if (trimmed === '' || num === null || num <= 0) {
        return {
          ok: false, parts: [], sum: null,
          message: `بخش «${U.escapeHtml(U.truncate(trimmed || 'خالی', 12))}» در الگوی برش عدد معتبر و مثبت نیست.`,
        };
      }
      parts.push(Math.round(num * 100) / 100);   // حذف خطای اعشار شناور
    }

    const sum = parts.reduce((a, b) => a + b, 0);
    return { ok: true, parts, sum, message: '' };
  };

  /**
   * اعتبارسنجی الگو نسبت به عرض مادر (§28).
   * قانون: PatternSum <= MotherWidth (کمتر مجاز — پرت عرض).
   */
  Setups.validatePattern = function (patternText, motherWidth) {
    const parsed = Setups.parsePattern(patternText);
    if (!parsed.ok) return parsed;
    if (!parsed.parts.length) return { ok: true, parts: [], sum: 0, message: '' };

    if (motherWidth === null || motherWidth === undefined || !(motherWidth > 0)) {
      return { ok: false, parts: parsed.parts, sum: parsed.sum, message: 'ابتدا عرض رول مادر را وارد کنید.' };
    }

    if (parsed.sum > motherWidth) {
      return {
        ok: false, parts: parsed.parts, sum: parsed.sum,
        message: `مجموع عرض الگوی برش (${U.faWidth(parsed.sum)}) بیشتر از عرض رول مادر (${U.faWidth(motherWidth)}) است.`,
      };
    }

    return { ok: true, parts: parsed.parts, sum: parsed.sum, message: '' };
  };

  /* ---------------- نرمال‌سازی الگو برای کلید یکتا (ترتیب‌آگنوستیک) ---------------- */

  /**
   * کلید نرمال‌شدهٔ الگوی برش — ترتیب قطعات در یکسان‌بودن الگوها بی‌اثر است
   * (مقایسه به‌صورت Multiset):
   *   "1200-1050" و "1050-1200" → "1050-1200"
   *   "800-930-930" ، "930-800-930" و "930-930-800" → "800-930-930"
   * الگوهای واقعاً متفاوت کلیدهای متفاوت می‌سازند.
   * الگوی خالی → "" (بدون الگو).
   */
  Setups.normalizePatternKey = function (patternText) {
    const parsed = Setups.parsePattern(patternText);
    if (!parsed.ok || !parsed.parts.length) return '';
    return [...parsed.parts].sort((a, b) => a - b).join('-');
  };

  /* ---------------- ساخت کلید یکتا (§25 + الگوی برش + هویت ۲٫۹) ---------------- */

  /**
   * کلید یکتای ستاپ: عرض + شماره ستاپ + متراژ استاندارد + شماره دستگاه
   * + الگوی نرمال‌شدهٔ برش (ترتیب قطعات مهم نیست)
   * + خط تولید + شماره سالن + عدد سال (از تاریخ ستاپ — نسخهٔ ۲٫۹).
   */
  Setups.uniqueKey = function (setup) {
    const patternKey = Setups.normalizePatternKey(setup.cuttingPattern);
    const id = N.setupIdentity(setup);
    return `${setup.width}-${setup.setupNumber}-${setup.standardLength}-${setup.machineNumber}-${patternKey}` +
      `-${id.line ?? '?'}-${id.hall ?? '?'}-${id.yearDigit ?? '?'}`;
  };

  /**
   * کلید هویت ستاپ (نسخهٔ ۲٫۹ — تغییر ۳ کاربر):
   *   شماره ستاپ + عدد سال (از تاریخ) + خط تولید + شماره سالن
   * برای بررسی تکراری‌بودن ستاپ در ثبت گروهی (Bulk) — این کلید نباید
   * با رکوردهای ثبت‌شده تکراری باشد.
   */
  Setups.identityKey = function (setupNumber, yearDigit, productionLine, hallNumber) {
    return `${setupNumber ?? '?'}|${yearDigit ?? '?'}|${productionLine ?? '?'}|${hallNumber ?? '?'}`;
  };

  /** کلید هویت یک رکورد ستاپ ثبت‌شده */
  Setups.identityKeyOf = function (setup) {
    const id = N.setupIdentity(setup);
    return Setups.identityKey(setup.setupNumber, id.yearDigit, id.line, id.hall);
  };

  /* ---------------- اعتبارسنجی کامل فرم (§26) ---------------- */

  /**
   * اعتبارسنجی کامل ورودی ستاپ (ایجاد و ویرایش).
   * @param {object} input        مقادیر خام فرم
   * @param {object} rules        قوانین متراژ موجود
   * @param {Array}  allSetups    تمام ستاپ‌های موجود
   * @param {number|null} editId  شناسهٔ رکورد در حال ویرایش (در بررسی یکتایی مستثنی)
   * @param {object}  options     { allowThicknessChange } — در ویرایش، تغییر ضخامت
   *                               با آبشار مجاز است (§23) و قفل ارث‌بری (§22) اعمال نمی‌شود
   * خروجی: { ok } یا { ok:false, errors:{field:msg}, message }
   */
  Setups.validate = function (input, rules, allSetups, editId = null, options = {}) {
    const errors = {};

    /* --- شماره ستاپ: عدد صحیح نامنفی (§96) --- */
    const setupNumber = U.parseInt(input.setupNumber);
    if (setupNumber === null || setupNumber < 0) {
      errors.setupNumber = 'شماره ستاپ باید عدد صحیح و نامنفی باشد.';
    }

    /* --- خط تولید: فقط BOPP/CPP (نسخهٔ ۲٫۹) --- */
    const productionLine = String(input.productionLine ?? '').trim().toUpperCase() || null;
    if (!Setups.PRODUCTION_LINES.includes(productionLine)) {
      errors.productionLine = 'خط تولید را انتخاب کنید (BOPP یا CPP).';
    }

    /* --- شماره سالن: فقط ۱/۲/۳/۴ (نسخهٔ ۲٫۹) ---
       نسخهٔ ۳٫۰ (تغییر ۱): سالنِ کلید «ستاپ + خط» فقط «پیشنهاد» است و کاربر
       می‌تواند آن را ویرایش کند؛ سالن متفاوت = هویت متفاوت (ستاپ جدید مجاز).
       بنابراین دیگر خطای یکسان‌بودن سالن وجود ندارد — فقط بازهٔ ۱ تا ۴ بررسی می‌شود. */
    const hallNumber = U.parseInt(input.hallNumber);
    if (!Setups.VALID_HALLS.includes(hallNumber)) {
      errors.hallNumber = 'شماره سالن باید ۱، ۲، ۳ یا ۴ باشد.';
    }

    /* --- شماره دستگاه: فقط ۱/۲/۳ (§21) --- */
    const machineNumber = U.parseInt(input.machineNumber);
    if (!RM.config.VALID_MACHINES.includes(machineNumber)) {
      errors.machineNumber = 'شماره دستگاه باید ۱، ۲ یا ۳ باشد (دستگاه‌های متالایز).';
    }

    /* --- عرض رول مادر: عدد مثبت --- */
    const width = U.parseNumber(input.width);
    if (width === null || width <= 0) {
      errors.width = 'عرض رول مادر باید عددی بزرگ‌تر از صفر باشد.';
    }

    /* --- ضخامت + ارث‌بری (§22 — کلید ۴فاکتوری نسخهٔ ۳٫۰ تغییر ۴) ---
       ارث‌بری ضخامت فقط در «همان هویت» (شماره ستاپ + خط تولید + شماره سالن +
       عدد سال) الزامی است؛ ستاپ‌هایی با شمارهٔ مشابه اما هویت متفاوت می‌توانند
       ضخامت مستقل داشته باشند. */
    const thickness = U.parseNumber(input.thickness);
    if (thickness === null || thickness <= 0) {
      errors.thickness = 'ضخامت باید عددی مثبت (میکرون) باشد.';
    } else if (!options.allowThicknessChange) {
      const hallForThickness = U.parseInt(input.hallNumber);
      const dateForThickness = U.parseJalaliDate(input.setupDate);
      const yearForThickness = dateForThickness
        ? N.yearDigitOfDate(dateForThickness.normalized) : null;
      if (productionLine && setupNumber !== null &&
          hallForThickness !== null && yearForThickness !== null) {
        const sameIdentity = allSetups.filter(
          (s) => s.setupNumber === setupNumber &&
                 s.productionLine === productionLine &&
                 s.hallNumber === hallForThickness &&
                 N.yearDigitOfDate(s.setupDate) === yearForThickness &&
                 s.thickness !== null && s.thickness !== undefined &&
                 (editId === null || s.id !== editId)
        );
        if (sameIdentity.length && sameIdentity.some((s) => s.thickness !== thickness)) {
          errors.thickness = `ضخامت ستاپ ${U.faNum(setupNumber)} (خط ${U.escapeHtml(productionLine)} · سالن ${U.faNum(hallForThickness)} · عدد سال ${U.faNumPlain(yearForThickness)}) قبلاً ${U.faNum(sameIdentity[0].thickness)} تعیین شده و باید یکسان باشد (ارث‌بری ضخامت با کلید هویت).`;
        }
      }
    }

    /* --- متراژ استاندارد: فقط از قوانین همان ضخامت (§24) --- */
    const standardLength = U.parseNumber(input.standardLength);
    if (standardLength === null) {
      errors.standardLength = 'متراژ استاندارد را انتخاب کنید.';
    } else if (thickness !== null && !R.standardLengthsFor(rules, thickness).includes(standardLength)) {
      const available = R.standardLengthsFor(rules, thickness);
      errors.standardLength = available.length
        ? 'متراژ استاندارد انتخابی در قوانین این ضخامت تعریف نشده است.'
        : 'برای این ضخامت هنوز قانون متراژی تعریف نشده — ابتدا در تنظیمات قانون تعریف کنید.';
    }

    /* --- تعداد رول: عدد صحیح ≥ ۱ (§49) --- */
    const rollCount = U.parseInt(input.rollCount);
    if (rollCount === null || rollCount < 1) {
      errors.rollCount = 'تعداد رول باید عدد صحیح و حداقل ۱ باشد.';
    }

    /* --- الگوی برش (§27-§28) --- */
    const patternResult = Setups.validatePattern(input.cuttingPattern, width);
    if (!patternResult.ok) {
      errors.cuttingPattern = patternResult.message;
    }

    /* --- تاریخ ستاپ (شمسی — نسخهٔ ۲٫۸): الزامی + ارث‌بری مانند ضخامت
       نسخهٔ ۳٫۰ (تغییر ۸): ارث‌بری/یکسان‌بودن تاریخ فقط در «همان هویت»
       (شماره ستاپ + خط تولید + شماره سالن + عدد سال) الزامی است. --- */
    const setupDateParsed = U.parseJalaliDate(input.setupDate);
    if (!setupDateParsed) {
      errors.setupDate = 'تاریخ ستاپ را با فرمت شمسی معتبر وارد کنید — مثال: 1405/06/18 (روزهای هر ماه و سال کبیسه بررسی می‌شود).';
    } else if (!options.allowDateChange) {
      const hallForDate = U.parseInt(input.hallNumber);
      if (productionLine && setupNumber !== null && hallForDate !== null) {
        const yearForDate = N.yearDigitOfDate(setupDateParsed.normalized);
        const sameIdentityD = allSetups.filter(
          (s) => s.setupNumber === setupNumber &&
                 s.productionLine === productionLine &&
                 s.hallNumber === hallForDate &&
                 s.setupDate &&
                 N.yearDigitOfDate(s.setupDate) === yearForDate &&
                 (editId === null || s.id !== editId)
        );
        if (sameIdentityD.length && sameIdentityD[0].setupDate !== setupDateParsed.normalized) {
          errors.setupDate = `تاریخ ستاپ این کلید هویت (ستاپ ${U.faNum(setupNumber)} + خط ${U.escapeHtml(productionLine)} + سالن ${U.faNum(hallForDate)} + عدد سال ${U.faNumPlain(yearForDate)}) قبلاً ${U.faJalali(sameIdentityD[0].setupDate)} ثبت شده و باید یکسان باشد (ارث‌بری تاریخ ستاپ).`;
        }
      }
    }

    if (Object.keys(errors).length) {
      return { ok: false, errors, message: 'لطفاً خطاهای فرم را برطرف کنید.' };
    }

    const record = {
      setupNumber,
      machineNumber,
      width,
      thickness,
      standardLength,
      rollCount,
      cuttingPattern: String(input.cuttingPattern ?? '').trim() || null,
      productionLine,                                            // نسخهٔ ۲٫۹ — BOPP | CPP
      hallNumber,                                               // نسخهٔ ۲٫۹ — ۱ تا ۴
      setupDate: setupDateParsed ? setupDateParsed.normalized : null,   // نسخهٔ ۲٫۸ — YYYY/MM/DD شمسی
    };

    /* --- کلید یکتا (§25 + الگو + هویت ۲٫۹) — الگو با ترتیب بی‌اثر --- */
    const duplicate = allSetups.find(
      (s) => (editId === null || s.id !== editId) && Setups.uniqueKey(s) === Setups.uniqueKey(record)
    );
    if (duplicate) {
      return {
        ok: false,
        errors: { machineNumber: 'ترکیب عرض + شماره ستاپ + متراژ استاندارد + دستگاه + الگوی برش + خط تولید + سالن + سال تکراری است.' },
        message:
          `کلید «${U.faWidth(width)}-${U.faNum(setupNumber)}-${U.faNum(standardLength)}-${U.faNum(machineNumber)}-${U.escapeHtml(Setups.normalizePatternKey(record.cuttingPattern) || 'بدون الگو')}-${U.escapeHtml(String(productionLine ?? '?'))}-${U.faNum(hallNumber ?? '?')}-${U.faNum(N.yearDigitOfDate(record.setupDate) ?? '?')}» ` +
          `قبلاً ثبت شده است (ترتیب قطعات الگو در یکتایی بی‌اثر است).`,
      };
    }

    return { ok: true, record };
  };

  /* ---------------- عملیات CRUD ---------------- */

  /** تاریخ ثبت‌شدهٔ اولین رکوردِ همان شماره ستاپ (ارث‌بری تاریخ — نسخهٔ ۲٫۸)
      دقیقاً مانند منطق ضخامت: یک تاریخ برای همهٔ رکوردهای همان شماره ستاپ. */
  Setups.findInheritedDate = async function (setupNumber) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return null;
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const withDate = existing.find((s) => s.setupDate);
    return withDate ? withDate.setupDate : null;
  };

  /** آخرین خط تولید ثبت‌شدهٔ همان شماره ستاپ (نسخهٔ ۲٫۹ — ارث‌بری خط تولید).
      «آخرین» = جدیدترین رکورد (بر اساس createdAt سپس id) — پیش‌فرضِ فیلد
      خط تولید در رکورد بعدی همان شماره ستاپ؛ کاربر می‌تواند تغییرش دهد. */
  Setups.findLastLine = async function (setupNumber) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return null;
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const withLine = existing
      .filter((s) => s.productionLine)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.id || 0) - (a.id || 0));
    return withLine.length ? withLine[0].productionLine : null;
  };

  /** سالن ثبت‌شدهٔ کلید «شماره ستاپ + خط تولید» (نسخهٔ ۲٫۹ — ارث‌بری سالن).
      نسخهٔ ۳٫۰ (تغییر ۱): نتیجه فقط «پیشنهاد» است — فرم آن را پر می‌کند اما
      کاربر می‌تواند سالن دیگری انتخاب کند (سالن متفاوت = هویت متفاوت). */
  Setups.findInheritedHall = async function (setupNumber, productionLine) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return null;
    if (!productionLine) return null;
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const withHall = existing.find(
      (s) => s.productionLine === productionLine &&
             s.hallNumber !== null && s.hallNumber !== undefined
    );
    return withHall ? withHall.hallNumber : null;
  };

  /** ضخامت ثبت‌شدهٔ کلید هویت کامل «شماره ستاپ + خط تولید + شماره سالن +
      عدد سال» (نسخهٔ ۳٫۰ — تغییر ۴). اگر رکوردی با همین هویت ضخامت ثبت‌شده
      داشته باشد برگردانده می‌شود (ارث‌بری + قفل فرم)؛ در غیر این صورت null
      (کاربر ضخامت را دستی وارد می‌کند). ستاپ‌هایی با شمارهٔ مشابه اما هویت
      متفاوت، ضخامت مستقل دارند. */
  Setups.findInheritedThickness = async function (setupNumber, productionLine, hallNumber, yearDigit) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return null;
    if (!productionLine) return null;
    if (hallNumber === null || hallNumber === undefined) return null;
    if (yearDigit === null || yearDigit === undefined) return null;
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const withThickness = existing.find(
      (s) => s.productionLine === productionLine &&
             s.hallNumber === hallNumber &&
             N.yearDigitOfDate(s.setupDate) === yearDigit &&
             s.thickness !== null && s.thickness !== undefined
    );
    return withThickness ? withThickness.thickness : null;
  };

  /** تاریخ‌های یکتای ثبت‌شدهٔ هویت «شماره ستاپ + خط تولید + شماره سالن»
      (نسخهٔ ۳٫۰ — تغییر ۸). عدد سال از خود تاریخ برمی‌خواهد و در جست‌وجوی
      تاریخ معلوم نیست؛ بنابراین با ۳ فاکتور اول جست‌وجو می‌کنیم:
        · یک تاریخ یکتا → همان تاریخ به ارث می‌رسد و قفل می‌شود
        · چند تاریخ (این ستاپ+خط+سالن در چند سال) → کاربر تاریخ را وارد می‌کند
          و با تکمیل کلید (رقم سال)، تاریخ ثبت‌شدهٔ همان کلید قفل می‌شود
        · هیچ → تاریخ جدید، دستی */
  Setups.findInheritedDatesByIdentity = async function (setupNumber, productionLine, hallNumber) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return [];
    if (!productionLine) return [];
    if (hallNumber === null || hallNumber === undefined) return [];
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const dates = new Set();
    for (const s of existing) {
      if (s.productionLine === productionLine &&
          s.hallNumber === hallNumber && s.setupDate) {
        dates.add(s.setupDate);
      }
    }
    return [...dates];
  };

  /** تاریخ ثبت‌شدهٔ کلید کامل هویت «ستاپ + خط + سالن + عدد سال» (نسخهٔ ۳٫۰ —
      تغییر ۸): اگر رکوردی با همین کلید تاریخ داشته باشد، همان تاریخ
      برگردانده می‌شود (یک هویت = یک تاریخ)؛ در غیر این صورت null. */
  Setups.findDateForKey = async function (setupNumber, productionLine, hallNumber, yearDigit) {
    if (setupNumber === null || setupNumber === undefined || setupNumber < 0) return null;
    if (!productionLine) return null;
    if (hallNumber === null || hallNumber === undefined) return null;
    if (yearDigit === null || yearDigit === undefined) return null;
    const existing = await db.setupRolls.where('setupNumber').equals(setupNumber).toArray();
    const withDate = existing.find(
      (s) => s.productionLine === productionLine &&
             s.hallNumber === hallNumber &&
             s.setupDate &&
             N.yearDigitOfDate(s.setupDate) === yearDigit
    );
    return withDate ? withDate.setupDate : null;
  };

  /** ایجاد رکورد جدید — تراکنشی (§14) */
  Setups.create = async function (input) {
    const [rules, allSetups] = await Promise.all([
      db.standardLengthRules.toArray(),
      db.setupRolls.toArray(),
    ]);

    const check = Setups.validate(input, rules, allSetups);
    if (!check.ok) return check;

    const record = { ...check.record, createdAt: Date.now(), updatedAt: Date.now() };
    const id = await db.transaction('rw', db.setupRolls, async () => {
      return db.setupRolls.add(record);
    });
    return { ok: true, id };
  };

  /**
   * ویرایش رکورد (§23، §26).
   * اگر ضخامت تغییر کند و رکوردهای دیگری با همین شماره ستاپ وجود داشته باشد،
   * کاربر باید تأیید کند (waterfall) — این تابع فقط پس از تأیید فراخوانی شود.
   * UI وظیفهٔ گرفتن تأیید و گزارش تعداد رکوردهای متأثر را دارد (cascadeInfo).
   */
  Setups.update = async function (id, input, options = {}) {
    const [rules, allSetups] = await Promise.all([
      db.standardLengthRules.toArray(),
      db.setupRolls.toArray(),
    ]);

    // در ویرایش، تغییر ضخامت (§23)، تاریخ (نسخهٔ ۲٫۸) و هویت خط/سالن
    // (نسخهٔ ۲٫۹ — بدون قفل ارث‌بری) مجاز است
    const check = Setups.validate(input, rules, allSetups, id, {
      allowThicknessChange: true,
      allowDateChange: true,
      allowIdentityChange: true,
    });
    if (!check.ok) return check;

    const existing = allSetups.find((s) => s.id === id);
    if (!existing) return { ok: false, message: 'رکورد موردنظر یافت نشد.' };

    const newRecord = { ...check.record, createdAt: existing.createdAt, updatedAt: Date.now() };

    // حذف پرچم قدیمی پس از تکمیل ویرایش
    if ('legacy' in newRecord) delete newRecord.legacy;

    await db.transaction('rw', db.setupRolls, async () => {
      await db.setupRolls.update(id, newRecord);

      // آبشار ضخامت و تاریخ به سایر رکوردهای همان هویت (§23 + نسخهٔ ۲٫۸)
      // نسخهٔ ۳٫۰ (تغییر ۴/۸): دامنهٔ آبشار = همان شماره ستاپ + خط تولید +
      // شماره سالن — دیگر ضخامت/تاریخ ستاپی به ستاپ‌های هم‌شماره با هویت
      // (خط/سالن) متفاوت سرریز نمی‌شود.
      const others = allSetups.filter(
        (s) => s.id !== id &&
               s.setupNumber === newRecord.setupNumber &&
               s.productionLine === newRecord.productionLine &&
               s.hallNumber === newRecord.hallNumber
      );
      for (const other of others) {
        const patched = { ...other };
        let changed = false;
        if (other.thickness !== newRecord.thickness) {
          patched.thickness = newRecord.thickness;
          changed = true;
        }
        if ((other.setupDate || null) !== (newRecord.setupDate || null)) {
          patched.setupDate = newRecord.setupDate;
          changed = true;
        }
        if (changed) {
          patched.updatedAt = Date.now();
          if ('legacy' in patched) delete patched.legacy;
          await db.setupRolls.update(other.id, patched);
        }
      }
    });

    return {
      ok: true, id,
      cascaded: options.cascadedCount || 0,
      cascadedDate: options.cascadedDateCount || 0,
    };
  };

  /** اطلاعات آبشار تغییر ضخامت و تاریخ: چند رکورد دیگر تغییر می‌کنند؟
      (برای پیام تأیید §23 + نسخهٔ ۲٫۸ — UI وظیفهٔ گرفتن تأیید را دارد) */
  Setups.cascadeInfo = function (id, newThickness, newDate) {
    return db.transaction('r', db.setupRolls, async () => {
      const all = await db.setupRolls.toArray();
      const target = all.find((s) => s.id === id);
      if (!target) return { affected: 0, affectedDate: 0, setupNumber: null };

      // نسخهٔ ۳٫۰: دامنهٔ آبشار = همان ستاپ + خط تولید + شماره سالن (تغییر ۴/۸)
      const others = all.filter(
        (s) => s.id !== id &&
               s.setupNumber === target.setupNumber &&
               s.productionLine === target.productionLine &&
               s.hallNumber === target.hallNumber
      );
      const affected = others.filter((s) => s.thickness !== newThickness).length;
      const affectedDate = others.filter((s) => (s.setupDate || null) !== (newDate || null)).length;
      return { affected, affectedDate, setupNumber: target.setupNumber };
    });
  };

  /** حذف رکورد (تأیید در UI — §70) */
  Setups.remove = async function (id) {
    await db.transaction('rw', db.setupRolls, async () => {
      await db.setupRolls.delete(id);
    });
  };

  /** مجموع تعداد رول‌های همهٔ ستاپ‌ها (§57) */
  Setups.totalRollCount = function (setups) {
    return setups.reduce((sum, s) => sum + (s.rollCount || 0), 0);
  };

  /* ================================================================
     ثبت گروهی از Clipboard — Bulk Paste (TSV)
     ----------------------------------------------------------------
     ساختار ورودی — هر «جفت خط» یک ست دست تولید می‌کند:

       خط فرد (الگو):   عرض‌های الگو ... [سلول‌های خالی] ... تعداد رول
       خط زوج (مادر):   عرض رول‌های مادر — هر سلول غیرخالی، گروه جدید
                        شروع می‌کند؛ سلول خالی یعنی ادامهٔ مادر قبلی.
                        هر قطعهٔ الگو به مادر متناظر خودش متصل می‌شود.

     الگوها می‌توانند یک‌تکه، دو‌تکه یا چندتکه باشند.

     جریان (قابل ویرایش پس از تحلیل):
       ۱) buildBulkDraft    — تجزیهٔ متن + تجمیع هم‌کلیدها → پیش‌نویس رکوردها
       ۲) پیش‌نمایش UI      — کاربر فیلدهای سراسری (شماره ستاپ/ضخامت) و
                              فیلدهای هر رکورد (دستگاه/متراژ استاندارد/
                              عرض مادر/الگو/تعداد) را ویرایش می‌کند
       ۳) validateBulkDraft — اعتبارسنجی با همان منطق ثبت دستی (§26)
       ۴) commitBulkDraft   — ثبت همهٔ رکوردها در یک تراکنش واحد
     ================================================================ */

  /**
   * تجزیهٔ متن Paste شده به رکوردهای ساختاری (بدون اعتبارسنجی منطقی).
   * خروجی: { pairs, structureErrors }
   *   pairs: [{ pairIndex, lineNos, rollCountToken, rollCount, groups: [{ motherToken, parts: [token] }] }]
   */
  Setups.parseBulkText = function (text) {
    const rawLines = String(text ?? '').replace(/\r/g, '').split('\n');
    const cells = rawLines.map((l) => l.split('\t'));

    // اندیس خطوط دارای محتوا (خط کاملاً خالی نادیده گرفته می‌شود)
    const contentIdx = [];
    cells.forEach((row, i) => {
      if (row.some((c) => String(c).trim() !== '')) contentIdx.push(i);
    });

    const pairs = [];
    const structureErrors = [];

    for (let p = 0; p < contentIdx.length; p += 2) {
      const patternLine = contentIdx[p];
      const motherLine = contentIdx[p + 1];          // undefined → خط مادر غایب
      const patternCells = cells[patternLine];
      const motherCells = motherLine !== undefined ? cells[motherLine] : [];
      const pairIndex = pairs.length + 1;

      // --- آخرین سلول غیرخالیِ خط الگو = تعداد رول ---
      let countIdx = -1;
      for (let i = patternCells.length - 1; i >= 0; i--) {
        if (String(patternCells[i] ?? '').trim() !== '') { countIdx = i; break; }
      }
      if (countIdx <= 0) {
        structureErrors.push({ pairIndex, message: `جفت ${U.faNum(pairIndex)}: خط الگو ساختار معتبری ندارد (عرض الگو یا تعداد رول یافت نشد).` });
        continue;
      }

      const rollCountToken = String(patternCells[countIdx]).trim();

      // --- سلول‌های مادر غیرخالی (فقط تا اندیس تعداد) — شروع گروه ---
      const motherStarts = new Map();   // اندیس ستون → توکن عرض مادر
      const limit = Math.min(motherCells.length, countIdx);
      for (let i = 0; i < limit; i++) {
        const t = String(motherCells[i] ?? '').trim();
        if (t !== '') motherStarts.set(i, t);
      }

      // --- گروه‌بندی قطعات الگو زیر مادر متناظر ---
      const groups = [];
      let current = null;
      let orphanParts = 0;

      for (let i = 0; i < countIdx; i++) {
        const t = String(patternCells[i] ?? '').trim();
        if (t === '') continue;

        if (motherStarts.has(i)) {
          current = { motherToken: motherStarts.get(i), parts: [] };
          groups.push(current);
        }
        if (current === null) {
          orphanParts++;
          continue;
        }
        current.parts.push(t);
      }

      /* --- نسخهٔ ۲٫۴: بدون ادغام گروه‌های یکسان — همهٔ عرض‌ها حتی تکراری
             به‌صورت رکورد جداگانه نمایش داده می‌شوند تا کاربر بتواند هر
             نسخه را به دستگاه/متراژ متفاوت تخصیص دهد (ادغام باعث از دست
             رفتن این امکان بود). تکراری‌بودنِ نهایی در اعتبارسنجی (§26)
             با کلید یکتا بررسی و رد می‌شود. --- */
      for (const g of groups) {
        if (g.occurrences == null) g.occurrences = 1;
      }
      const mergedGroups = groups;

      if (motherLine === undefined) {
        structureErrors.push({
          pairIndex,
          message: `جفت ${U.faNum(pairIndex)}: خط رول مادر متناظر برای خط الگو وجود ندارد.`,
        });
      }
      if (orphanParts > 0) {
        structureErrors.push({
          pairIndex,
          message: `جفت ${U.faNum(pairIndex)}: ${U.faNum(orphanParts)} قطعهٔ الگو در ابتدای خط مادر قرار ندارند و رول مادر متناظری ندارند.`,
        });
      }

      pairs.push({
        pairIndex,
        lineNos: { pattern: patternLine + 1, mother: motherLine !== undefined ? motherLine + 1 : null },
        rollCountToken,
        rollCount: U.parseInt(rollCountToken),
        /* همهٔ سلول‌های غیرخالی ردیف مادر (تا ستون تعداد) — مبنای مرجع
           «تعداد مجاز»: هر سلول = یک تکرار عرض در آن ردیف، حتی اگر سلول
           الگوی متناظرش خالی باشد و رکوردی نسازد (کنترل باید آن را گزارش کند). */
        motherCells: [...motherStarts.values()],
        groups: mergedGroups,
      });
    }

    return { pairs, structureErrors };
  };

  /** فیلدهای سراسری Batch — خطاهایشان یک‌بار در سطح Batch گزارش می‌شوند */
  Setups.BULK_GLOBAL_FIELDS = ['setupNumber', 'thickness', 'setupDate', 'productionLine', 'hallNumber'];

  /**
   * ساخت پیش‌نویس رکوردهای Bulk از متن Paste‌شده (بدون اعتبارسنجی منطقی).
   *
   * نسخهٔ ۲٫۴ — بدون تجمیع: هر گروه (مادر + الگو) در هر خط Paste، حتی با
   * عرض/الگوی مشابه، یک رکورد جداگانهٔ پیش‌نمایش می‌سازد؛ بنابراین کاربر
   * می‌تواند عرض تکراری ردیف ۱ را به دستگاه ۲ و عرض تکراری ردیف ۳ را به
   * دستگاه ۱ تخصیص دهد یا متراژ استاندارد متفاوت انتخاب کند. اگر در پایان
   * (عرض مادر + شماره ستاپ + متراژ استاندارد + دستگاه + الگوی برش نرمال)
   * تکراری بود، اعتبارسنجی (§26) ردیف را خطا می‌دهد و ثبت انجام نمی‌شود.
   *
   * commonInit: مقادیر اولیهٔ دستگاه/متراژ استاندارد ردیف‌ها (از فرم دستی).
   * خروجی: { drafts, structureErrors, allowedMap }
   *   drafts: [{ motherToken, patternText, rollCount, occurrences, pairs,
   *              machineNumber, standardLength }]
   *
   * allowedMap (کنترل «تعداد مجاز» — تغییر جدید):
   *   مرجعِ مقایسهٔ عرض‌های مادر دیتای پیست‌شده. برای هر عرض یکتای مادر:
   *     تعداد مجاز (دیتای پیست‌شده) = عرض × تعداد تکرار عرض در ردیف مادر
   *                                      × عدد انتهایی ردیف الگوی بالایی
   *   مقدار ذخیره‌شده در نقشه فقط Σ(تکرار × عدد انتهایی) است (بدون ضرب عرض)
   *   و عرض در لحظهٔ مقایسه/نمایش ضرب می‌شود (طبق تعریف کاربر:
   *   مثلاً 1180 → 1180×8 + 1180×2 = 11800).
   */
  Setups.buildBulkDraft = function (commonInit, bulkText) {
    const parsed = Setups.parseBulkText(bulkText);
    const initMachine = String(commonInit.machineNumber ?? '');
    const initStandard = String(commonInit.standardLength ?? '');

    const drafts = [];
    const allowedMap = {};    // "عرض(کلید عددی)" → Σ (تکرار × عدد انتهایی ردیف الگو)
    for (const pair of parsed.pairs) {
      const multiplier = pair.rollCount === null ? 0 : pair.rollCount;
      for (const group of pair.groups) {
        drafts.push({
          motherToken: group.motherToken,
          patternText: group.parts.join('-'),
          rollCount: pair.rollCount,
          occurrences: group.occurrences || 1,
          pairs: [pair.pairIndex],
          machineNumber: initMachine,      // قابل ویرایش در هر رکورد
          standardLength: initStandard,    // قابل ویرایش در هر رکورد
        });
      }

      /* --- مرجع تعداد مجاز عرض‌های مادر (دیتای پیست‌شده) —
           «همهٔ سلول‌های ردیف مادر» شمرده می‌شوند (هر سلول = یک تکرار
           عرض در همان ردیف × عدد انتهایی ردیف الگوی بالایی)، حتی اگر
           سلول الگوی متناظر خالی باشد و رکوردی نسازد — در آن صورت
           پیش‌نمایش آن عرض را ندارد و کنترل خطای «کمتر» می‌دهد. --- */
      for (const token of (pair.motherCells || [])) {
        const w = U.parseNumber(token);
        if (w !== null && w > 0) {
          const key = String(Math.round(w * 100) / 100);
          allowedMap[key] = (allowedMap[key] || 0) + multiplier;
        }
      }
    }

    return { drafts, structureErrors: parsed.structureErrors, allowedMap };
  };

  /**
   * اعتبارسنجی پیش‌نویس Bulk — دقیقاً همان منطق ثبت دستی (§26).
   * @param {object} common   { setupNumber, thickness, setupDate, productionLine,
   *                            hallNumber } — سراسری برای کل Batch (نسخهٔ ۲٫۹: + خط/سالن)
   * @param {Array}  drafts   پیش‌نویس‌های (احتمالاً ویرایش‌شدهٔ) رکوردها
   * @param {object} options  { allowedMap } — مرجع «تعداد مجاز» عرض‌های مادر
   *                          دیتای پیست‌شده (از buildBulkDraft — اختیاری)
   * خروجی: { ok, globalErrors, records, total, allowedRows, dupIdentity }
   *   globalErrors: خطاهای فیلدهای سراسری (یک‌بار)
   *   records[i]:   { ...draft, errors: [msgs], record? } — record وقتی معتبر
   *   dupIdentity:  اطلاعات کلید هویت تکراری (نسخهٔ ۲٫۹ — تغییر ۳) یا null
   *   allowedRows: ردیف‌های کنترل «تعداد مجاز» هر عرض یکتای مادر:
   *     { width, key, pastedCount, previewCount, pasted, preview, status }
   *     status ∈ 'ok' | 'less' | 'more' — عرض × (تعداد × ست) دو طرف باید برابر باشد.
   */
  Setups.validateBulkDraft = async function (common, drafts, options = {}) {
    const [rules, allSetups] = await Promise.all([
      db.standardLengthRules.toArray(),
      db.setupRolls.toArray(),
    ]);

    const working = [...allSetups];
    const globalErrors = {};
    const records = [];

    // کلیدهای موجود در DB و کلیدهای قبول‌شدهٔ همین Batch — برای پیغام خطای
    // دقیقِ «تکراری» (نسخهٔ ۲٫۴): تکراریِ داخل Batch یا تکراری با رکورد ثبت‌شده
    const dbKeys = new Set(allSetups.map((s) => Setups.uniqueKey(s)));
    const batchKeys = new Set();

    // ضخامت معتبر اما بدون قانون متراژ → خطای سراسری (نه تکرار در همهٔ ردیف‌ها)
    const commonThickness = U.parseNumber(common.thickness);
    if (commonThickness !== null && !R.standardLengthsFor(rules, commonThickness).length) {
      globalErrors.thickness = 'برای این ضخامت قانون متراژی تعریف نشده — ابتدا در تنظیمات قانون اضافه کنید.';
    }

    /* --- فیلدهای سراسری هویت (نسخهٔ ۲٫۹): خط تولید + شماره سالن --- */
    const commonLine = String(common.productionLine ?? '').trim().toUpperCase() || null;
    if (!Setups.PRODUCTION_LINES.includes(commonLine)) {
      globalErrors.productionLine = 'خط تولید (BOPP یا CPP) برای کل رکوردهای همین Batch الزامی است.';
    }
    const commonHall = U.parseInt(common.hallNumber);
    if (!Setups.VALID_HALLS.includes(commonHall)) {
      globalErrors.hallNumber = 'شماره سالن (۱ تا ۴) برای کل رکوردهای همین Batch الزامی است.';
    }

    /* --- تاریخ ستاپ Batch (نسخهٔ ۲٫۸ → ۳٫۱ — تغییر ۱: کلید هویت ۴فاکتوری) ---
       تعیین تاریخ بر اساس کلید «شماره ستاپ + خط تولید + شماره سالن + عدد سال»
       موجود در رکوردها (نه فقط شماره ستاپ):
         · یک تاریخ یکتا برای این ستاپ+خط+سالن → همان تاریخ به‌ارث می‌رسد و
           قفل است (تعیین خودکار — کاربر اجازهٔ تغییر ندارد)
         · چند تاریخ (این هویت در چند سال ثبت شده) → تاریخ دستی الزامی؛ اگر
           عدد سالِ تاریخ واردشده با یکی از سال‌های ثبت‌شده بخواند → همان
           تاریخ ثبت‌شدهٔ آن کلید (snap) + قفل
         · هیچ رکوردی با این هویت → تاریخ جدید، دستی و آزاد */
    const commonSetupNo = U.parseInt(common.setupNumber);
    let inheritedDate = null;   // تاریخ ثبت‌شدهٔ هویت (رشتهٔ نرمال‌شده) یا null
    let dateSnapped = false;    // نسخهٔ ۳٫۱: تاریخ دستیِ کاربر به تاریخ ثبت‌شدهٔ همان کلید snap شد
    if (
      commonSetupNo !== null &&
      Setups.PRODUCTION_LINES.includes(commonLine) &&
      Setups.VALID_HALLS.includes(commonHall)
    ) {
      const dates = new Set();
      for (const s of allSetups) {
        if (s.setupNumber === commonSetupNo &&
            s.productionLine === commonLine &&
            s.hallNumber === commonHall &&
            s.setupDate) {
          dates.add(s.setupDate);
        }
      }
      if (dates.size === 1) {
        inheritedDate = [...dates][0];
      } else if (dates.size > 1) {
        // ابهام چندساله — عدد سالِ تاریخِ واردشده کلید را کامل می‌کند
        const parsed = U.parseJalaliDate(common.setupDate || '');
        if (parsed) {
          const registered = await Setups.findDateForKey(
            commonSetupNo, commonLine, commonHall, N.yearDigitOfDate(parsed.normalized));
          if (registered) {
            inheritedDate = registered;
            dateSnapped = true;
          }
        }
      }
    }
    let batchDate = null;
    if (inheritedDate) {
      batchDate = U.parseJalaliDate(inheritedDate);
    } else {
      batchDate = U.parseJalaliDate(common.setupDate || '');
      if (!batchDate) {
        globalErrors.setupDate = 'تاریخ ستاپ (شمسی) برای کل رکوردهای همین Batch الزامی است — مثال: 1405/06/18.';
      }
    }
    const batchDateStr = batchDate ? batchDate.normalized : null;

    /* --- کنترل کلید هویت تکراری (نسخهٔ ۲٫۹ — تغییر ۳ کاربر) -------------------
       کلید «شماره ستاپ + عدد سال (از تاریخ ستاپ) + خط تولید + شماره سالن»
       نباید با رکوردهای ثبت‌شده تکراری باشد. اگر تکراری بود:
         · هر ۴ فیلد سراسری (شماره ستاپ/تاریخ/خط تولید/سالن) خطا می‌گیرند
         · خطای جداگانهٔ «شماره ستاپ تکراری است» به وضعیت «همهٔ» ردیف‌ها
           الصاق می‌شود (در ستون وضعیت به‌صورت جداگانه نمایش داده می‌شود). */
    let dupIdentity = null;
    const batchYearDigit = batchDateStr ? N.yearDigitOfDate(batchDateStr) : null;
    if (
      commonSetupNo !== null &&
      batchYearDigit !== null &&
      Setups.PRODUCTION_LINES.includes(commonLine) &&
      Setups.VALID_HALLS.includes(commonHall)
    ) {
      const batchIdKey = Setups.identityKey(commonSetupNo, batchYearDigit, commonLine, commonHall);
      const dupRecord = allSetups.find((s) => Setups.identityKeyOf(s) === batchIdKey) || null;
      if (dupRecord) {
        dupIdentity = {
          key: batchIdKey,
          setupNumber: commonSetupNo,
          yearDigit: batchYearDigit,
          line: commonLine,
          hall: commonHall,
          existingDate: dupRecord.setupDate || null,
        };
        const idTxt = `ستاپ ${U.faNum(commonSetupNo)} + سال ${U.faNumPlain(batchYearDigit)} (${U.faJalali(batchDateStr)}) + خط ${U.escapeHtml(commonLine)} + سالن ${U.faNum(commonHall)}`;
        globalErrors.setupNumber = `شماره ستاپ تکراری است — کلید هویت (${idTxt}) قبلاً در رکوردهای ثبت‌شده موجود است.`;
        globalErrors.setupDate = `عدد سال این تاریخ در کلید هویت تکراری است — (${idTxt}) قبلاً ثبت شده است.`;
        globalErrors.productionLine = `خط تولید در کلید هویت تکراری است — (${idTxt}) قبلاً ثبت شده است.`;
        globalErrors.hallNumber = `شماره سالن در کلید هویت تکراری است — (${idTxt}) قبلاً ثبت شده است.`;
      }
    }

    const dupRowError = dupIdentity
      ? `شماره ستاپ تکراری است — کلید «شماره ستاپ ${U.faNum(dupIdentity.setupNumber)} + عدد سال ${U.faNumPlain(dupIdentity.yearDigit)} + خط تولید ${U.escapeHtml(dupIdentity.line)} + شماره سالن ${U.faNum(dupIdentity.hall)}» قبلاً در رکوردهای ثبت‌شده موجود است.`
      : null;

    for (const draft of drafts) {
      const input = {
        setupNumber: common.setupNumber,
        machineNumber: draft.machineNumber,
        thickness: common.thickness,
        standardLength: draft.standardLength,
        width: draft.motherToken,
        rollCount: draft.rollCount === null ? '' : String(draft.rollCount),
        cuttingPattern: draft.patternText,
        productionLine: commonLine,                              // نسخهٔ ۲٫۹ — خط تولید کل Batch
        hallNumber: commonHall === null ? '' : String(commonHall), // نسخهٔ ۲٫۹ — سالن کل Batch
        setupDate: batchDateStr || common.setupDate || '',   // نسخهٔ ۲٫۸ — تاریخ کل Batch
      };

      // کلید یکتای این ردیف (نمایشی — ترتیب قطعات الگو بی‌اثر؛ هویت Batch هم
      // بخشی از کلید است — نسخهٔ ۲٫۹ — تا با کلیدهای DB هم‌قالب بماند)
      const rowKey = Setups.uniqueKey({
        width: U.parseNumber(draft.motherToken),
        setupNumber: U.parseInt(common.setupNumber),
        standardLength: U.parseNumber(draft.standardLength),
        machineNumber: U.parseInt(draft.machineNumber),
        cuttingPattern: draft.patternText,
        productionLine: commonLine,
        hallNumber: commonHall,
        setupDate: batchDateStr,
      });

      const check = Setups.validate(input, rules, working);
      const row = { ...draft, errors: [] };

      /* نسخهٔ ۲٫۹ — تغییر ۳: خطای «شماره ستاپ تکراری است» به‌صورت جداگانه
         در وضعیت همهٔ ردیف‌ها الصاق می‌شود (به‌علاوهٔ سایر خطاهای ردیف). */
      if (dupRowError) row.errors.push(dupRowError);

      if (check.ok) {
        working.push(check.record);
        batchKeys.add(rowKey);
        row.record = check.record;
      } else {
        const isDuplicate = /تکراری/.test(String(check.errors.machineNumber || ''));
        for (const [field, msg] of Object.entries(check.errors)) {
          if (Setups.BULK_GLOBAL_FIELDS.includes(field)) {
            if (!globalErrors[field]) globalErrors[field] = msg;   // یک‌بار در سطح Batch
          } else if (field === 'standardLength' && globalErrors.thickness) {
            // ریشهٔ خطای متراژ، ضخامت نامعتبر سراسری است — همان گزارش می‌شود
            continue;
          } else if (isDuplicate && field === 'machineNumber') {
            // پیغام دقیق تکراری (نسخهٔ ۲٫۴): تفکیک تکراریِ داخل Batch از ثبت‌شده
            row.errors.push(
              (batchKeys.has(rowKey) || dbKeys.has(rowKey))
                ? `ترکیب تکراری — «عرض مادر ${U.faWidth(U.parseNumber(draft.motherToken) ?? '?')} + شماره ستاپ ${U.faNum(U.parseInt(common.setupNumber) ?? '?')} + متراژ استاندارد ${U.faNum(U.parseNumber(draft.standardLength) ?? '?')} + دستگاه ${U.faNum(U.parseInt(draft.machineNumber) ?? '?')} + الگوی برش ${U.escapeHtml(Setups.normalizePatternKey(draft.patternText) || 'بدون الگو')}» ${dbKeys.has(rowKey) && !batchKeys.has(rowKey) ? 'قبلاً در پایگاه‌داده ثبت شده است' : 'در همین Batch تکراری است'} (ترتیب قطعات الگو بی‌اثر). ثبت مجدد مجاز نیست — دستگاه، متراژ استاندارد یا الگو را تغییر دهید.`
                : msg
            );
          } else {
            row.errors.push(msg);
          }
        }
      }
      records.push(row);
    }

    /* --- کنترل «تعداد مجاز» عرض‌های مادر (تغییر جدید — ۱) -------------------
       مرجع: دیتای پیست‌شده (allowedMap از buildBulkDraft)؛
       پیش‌نمایش: Σ (تعداد ست × تعداد رول) روی رکوردهای همان عرض.
       تعداد ست هر رکورد = متراژ استاندارد ÷ کوچکترین استاندارد ضخامت
       (موتور قوانین — رکورد بدون متراژ ۰ حساب می‌شود).
       دو مقدار باید برای هر عرض یکتا «برابر» باشد؛ در غیر این صورت خطا:
         پیش‌نمایش < پیست‌شده → «تعداد کمتر از دیتای ستاپ است»
         پیش‌نمایش > پیست‌شده → «تعداد رول‌های آن عرض بیشتر از دیتای ستاپ است»
       خطا روی «همهٔ» رکوردهای همان عرض نمایش داده می‌شود (عرض‌های تکراری).
       -------------------------------------------------------------------- */
    let allowedRows = null;
    const allowedMap = options.allowedMap || null;
    if (allowedMap && Object.keys(allowedMap).length) {
      const commonThickness = U.parseNumber(common.thickness);

      /* ۱) مجموع «تعداد × ست» رکوردهای پیش‌نمایش به تفکیک عرض مادر */
      const previewSums = new Map();   // کلید عددی → { width, sum }
      for (const row of records) {
        const w = U.parseNumber(row.motherToken);
        if (w === null || !(w > 0)) continue;
        const key = String(Math.round(w * 100) / 100);
        if (!previewSums.has(key)) previewSums.set(key, { width: w, sum: 0 });

        const std = U.parseNumber(row.standardLength);
        const sc = R.setCount(rules, commonThickness, std);
        const setCount = sc !== null && sc > 0 ? sc : 0;
        const count = row.rollCount === null ? 0 : (Number(row.rollCount) || 0);
        previewSums.get(key).sum += setCount * count;
      }

      /* ۲) ساخت ردیف‌های کنترل برای اجتماع عرض‌های دو طرف */
      const keys = new Set([...Object.keys(allowedMap), ...previewSums.keys()]);
      allowedRows = [];
      for (const key of keys) {
        const pastedCount = Number(allowedMap[key]) || 0;
        const pv = previewSums.get(key) || { width: Number(key), sum: 0 };
        allowedRows.push({
          key,
          width: pv.width,
          pastedCount,                                   // Σ (تکرار × عدد انتهایی)
          previewCount: pv.sum,                          // Σ (ست × تعداد)
          pasted: pastedCount * pv.width,                // «تعداد مجاز» کامل (× عرض)
          preview: pv.sum * pv.width,
          status: pv.sum === pastedCount ? 'ok' : (pv.sum < pastedCount ? 'less' : 'more'),
        });
      }
      allowedRows.sort((a, b) => a.width - b.width);

      /* ۳) الصاق خطا به همهٔ رکوردهای عرض‌های ناموفق */
      const failed = new Map(
        allowedRows.filter((r) => r.status !== 'ok').map((r) => [r.key, r])
      );
      if (failed.size) {
        for (const row of records) {
          const w = U.parseNumber(row.motherToken);
          if (w === null || !(w > 0)) continue;
          const info = failed.get(String(Math.round(w * 100) / 100));
          if (!info) continue;
          row.errors.push(
            info.status === 'less'
              ? `کنترل تعداد مجاز عرض ${U.faWidth(info.width)} — «تعداد مجاز» پیش‌نمایش ${U.faNum(info.preview)} کمتر از دیتای پیست‌شده ${U.faNum(info.pasted)} است — تعداد کمتر از دیتای ستاپ است.`
              : `کنترل تعداد مجاز عرض ${U.faWidth(info.width)} — «تعداد مجاز» پیش‌نمایش ${U.faNum(info.preview)} بیشتر از دیتای پیست‌شده ${U.faNum(info.pasted)} است — تعداد رول‌های آن عرض بیشتر از دیتای ستاپ است.`
          );
        }
        if (!globalErrors.allowed) {
          globalErrors.allowed =
            `کنترل «تعداد مجاز» برای ${U.faNum(failed.size)} عرض مادر پاس نشد — جزئیات در پنل «کنترل تعداد مجاز» و وضعیت ردیف‌ها.`;
        }
      }
    }

    const ok =
      records.length > 0 &&
      Object.keys(globalErrors).length === 0 &&
      records.every((r) => !r.errors.length && r.record);

    return {
      ok, globalErrors, records, total: records.length, allowedRows,
      dateInherited: !!inheritedDate,                          // نسخهٔ ۲٫۸ → ۳٫۱ — تاریخ از رکورد هم‌هویت (ستاپ+خط+سالن+سال) به‌ارث رسیده
      inheritedDateValue: inheritedDate || null,               // رشتهٔ تاریخ مؤثر (نرمال‌شده)
      dateSnapped,                                             // نسخهٔ ۳٫۱ — تغییر ۱: تاریخ دستی به تاریخ ثبت‌شدهٔ همان کلید snap شد
      batchDate: batchDateStr,                                 // تاریخ مؤثر کل Batch (نرمال‌شده)
      dupIdentity,                                             // نسخهٔ ۲٫۹ — کلید هویت تکراری (یا null)
    };
  };

  /**
   * Commit پیش‌نویس — همه یا هیچ: اگر حتی یک رکورد خطا داشته باشد
   * هیچ رکوردی ثبت نمی‌شود؛ در غیر این صورت همه در یک تراکنش واحد
   * ذخیره می‌شوند (بدون Batch نیمه‌کاره). options.allowedMap نیز مثل
   * validateBulkDraft به کنترل «تعداد مجاز» پاس داده می‌شود (تغییر جدید — ۱).
   */
  Setups.commitBulkDraft = async function (common, drafts, options = {}) {
    const check = await Setups.validateBulkDraft(common, drafts, options);
    if (!check.ok) return check;

    const now = Date.now();
    const ids = await db.transaction('rw', db.setupRolls, async () => {
      return db.setupRolls.bulkAdd(
        check.records.map((r) => ({ ...r.record, createdAt: now, updatedAt: now }))
      );
    });

    return { ok: true, ids, count: check.records.length, records: check.records };
  };

  RM.setupEngine = Setups;
})();
