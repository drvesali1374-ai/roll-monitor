/* =========================================================================
   rules.js — موتور قوانین متراژ استاندارد (§15-§19)
   -------------------------------------------------------------------------
   ساختار هر قانون:
     { id, thickness, minLength, maxLength, standardLength, createdAt }

   قوانین کسب‌وکار:
     - مرزهای بازه شامل‌اند (§16):  minLength <= actualLength <= maxLength
     - هم‌پوشانی قوانینِ یک ضخامت ممنوع (§18) — اعتبارسنجی مرکزی
     - بدون قانون منطبق → standardLength = null → عدم تطبیق (§17)
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const db = RM.db.db;

  const Rules = {};

  /* ---------------- اعتبارسنجی ساختاری یک قانون ---------------- */

  /**
   * اعتبارسنجی مقادیر خام فرم (قبل از ذخیره).
   * خروجی: { ok: true, rule }  یا  { ok: false, errors: {field: message} }
   */
  Rules.validateInput = function (input) {
    const errors = {};

    const thickness = U.parseNumber(input.thickness);
    const minLength = U.parseNumber(input.minLength);
    const maxLength = U.parseNumber(input.maxLength);
    const standardLength = U.parseNumber(input.standardLength);

    if (thickness === null || thickness <= 0) errors.thickness = 'ضخامت باید عددی مثبت (میکرون) باشد.';
    if (minLength === null || minLength <= 0) errors.minLength = 'حداقل متراژ باید عددی مثبت باشد.';
    if (maxLength === null || maxLength <= 0) errors.maxLength = 'حداکثر متراژ باید عددی مثبت باشد.';
    if (standardLength === null || standardLength <= 0) errors.standardLength = 'متراژ استاندارد باید عددی مثبت باشد.';

    if (minLength !== null && maxLength !== null && minLength > maxLength) {
      errors.maxLength = 'حداکثر متراژ نمی‌تواند کمتر از حداقل باشد.';
    }

    if (Object.keys(errors).length) return { ok: false, errors };

    return {
      ok: true,
      rule: { thickness, minLength, maxLength, standardLength },
    };
  };

  /* ---------------- اعتبارسنجی هم‌پوشانی (§18) — مرکزی ---------------- */

  /**
   * بررسی هم‌پوشانی قانون جدید/ویرایش‌شده با قوانین موجود همان ضخامت.
   * دو بازهٔ [aMin,aMax] و [bMin,bMax] هم‌پوشانند اگر:
   *    aMin <= bMax  &&  bMin <= aMax    (مرزها شامل‌اند — §16)
   * @param {object} rule        قانون در حال ذخیره
   * @param {Array}  existing    قوانین موجود همان ضخامت
   * @param {number|null} editId شناسهٔ قانون در حال ویرایش (از بررسی مستثنی)
   * @returns {object|null} قانونِ متعارض یا null
   */
  Rules.findOverlap = function (rule, existing, editId = null) {
    for (const other of existing) {
      if (editId !== null && other.id === editId) continue;
      if (other.thickness !== rule.thickness) continue;

      const overlaps =
        rule.minLength <= other.maxLength &&
        other.minLength <= rule.maxLength;

      if (overlaps) return other;
    }
    return null;
  };

  /**
   * اعتبارسنجی کامل پیش از ذخیره (ساختار + هم‌پوشانی).
   * خروجی: { ok } یا { ok:false, message, errors }
   */
  Rules.validateForSave = async function (input, editId = null) {
    // ۱) اعتبارسنجی ساختاری
    const structural = Rules.validateInput(input);
    if (!structural.ok) return { ok: false, errors: structural.errors, message: 'مقادیر قانون معتبر نیست.' };

    const rule = structural.rule;

    // ۲) اعتبارسنجی هم‌پوشانی — مرکزی و غیرقابل دور زدن (§18)
    const sameThickness = await db.standardLengthRules
      .where('thickness').equals(rule.thickness)
      .toArray();

    const overlap = Rules.findOverlap(rule, sameThickness, editId);
    if (overlap) {
      return {
        ok: false,
        message:
          `هم‌پوشانی بازه با قانون موجود (ضخامت ${U.faNum(overlap.thickness)}، ` +
          `${U.faNum(overlap.minLength)} تا ${U.faNum(overlap.maxLength)} → ${U.faNum(overlap.standardLength)})؛ ` +
          `بازه‌های یک ضخامت نباید هم‌پوشانی داشته باشند.`,
      };
    }

    return { ok: true, rule };
  };

  /* ---------------- عملیات CRUD ---------------- */

  /** ذخیرهٔ قانون جدید — تراکنشی (§14) */
  Rules.create = async function (input) {
    const check = await Rules.validateForSave(input);
    if (!check.ok) return check;

    const rule = {
      ...check.rule,
      createdAt: Date.now(),
    };
    const id = await db.transaction('rw', db.standardLengthRules, async () => {
      return db.standardLengthRules.add(rule);
    });
    return { ok: true, id };
  };

  /** ویرایش قانون — با اجرای مجدد تمام اعتبارسنجی‌ها */
  Rules.update = async function (id, input) {
    const check = await Rules.validateForSave(input, id);
    if (!check.ok) return check;

    await db.transaction('rw', db.standardLengthRules, async () => {
      await db.standardLengthRules.update(id, {
        ...check.rule,
        updatedAt: Date.now(),
      });
    });
    return { ok: true, id };
  };

  /** حذف قانون (رویداد UI باید تأیید بگیرد — §70) */
  Rules.remove = async function (id) {
    await db.transaction('rw', db.standardLengthRules, async () => {
      await db.standardLengthRules.delete(id);
    });
  };

  /* ---------------- موتور تطبیق متراژ استاندارد (§16-§17) ---------------- */

  /**
   * یافتن متراژ استاندارد یک رول بر اساس ضخامت + متراژ واقعی.
   * اگر هیچ قانونی پوشش ندهد → null (رول در تطبیق ستاپ شرکت نمی‌کند).
   */
  Rules.resolveStandardLength = function (rules, thickness, actualLength) {
    if (thickness === null || actualLength === null) return null;

    for (const rule of rules) {
      if (rule.thickness === thickness &&
          rule.minLength <= actualLength &&
          actualLength <= rule.maxLength) {
        return rule.standardLength;
      }
    }
    return null;
  };

  /** فهرست متراژهای استاندارد یکتای یک ضخامت (برای دراپ‌داون فرم ستاپ — §24) */
  Rules.standardLengthsFor = function (rules, thickness) {
    const set = new Set();
    for (const rule of rules) {
      if (rule.thickness === thickness) set.add(rule.standardLength);
    }
    return [...set].sort((a, b) => a - b);
  };

  /* ================================================================
     موتور «تعداد ست» (تغییر ۱ — نسخهٔ ۲٫۶)
     ----------------------------------------------------------------
     قانون کسب‌وکار (تعریف کاربر):
       در جدول «تعریف قانون متراژ استاندارد جدید» برای هر ضخامت چند
       متراژ استاندارد تعریف می‌شود؛ کوچکترین متراژ استاندارد هر ضخامت
       = متراژ رول «۱ ستی».

       تعداد ست هر رول = متراژ استاندارد رول ÷ متراژ استاندارد رول ۱ ستی

       مثال: ضخامت ۲۰ با استانداردهای ۲۰۰۰۰/۳۰۰۰۰/۴۰۰۰۰ →
         پایه = ۲۰۰۰۰ (رول ۱ ستی)
         رول ۳۰۰۰۰ → ۱٫۵ ست · رول ۴۰۰۰۰ → ۲ ست

       تعداد رول‌های الگوی برش (فرزند) هر رول مادر = تعداد ست مادر؛
       بنابراین هر قطعه الگو × تعداد ست × تعداد رول مادر شمرده می‌شود.
     ================================================================ */

  /**
   * کوچکترین متراژ استاندارد یک ضخامت = متراژ رول ۱ ستی.
   * خروجی: عدد یا null (ضخامت قانونی ندارد).
   */
  Rules.setBaseLength = function (rules, thickness) {
    if (thickness === null || thickness === undefined) return null;
    let min = null;
    for (const rule of rules) {
      if (rule.thickness === thickness &&
          Number.isFinite(rule.standardLength) &&
          (min === null || rule.standardLength < min)) {
        min = rule.standardLength;
      }
    }
    return min;
  };

  /**
   * تعداد ست یک رول از ضخامت + متراژ استاندارد آن.
   * خروجی: عدد (ممکن اعشاری مثل ۱٫۵) یا null (بدون قانون/پایه).
   */
  Rules.setCount = function (rules, thickness, standardLength) {
    const base = Rules.setBaseLength(rules, thickness);
    if (base === null || base <= 0) return null;
    if (standardLength === null || standardLength === undefined || standardLength <= 0) return null;
    return standardLength / base;
  };

  /* ================================================================
     قوانین زمان متالایز (هر دستگاه) — تغییرات جدید
     ----------------------------------------------------------------
     مدل هر قانون:
       { id, machineNumber(1|2|3), standardLength, qtyPerShift,
         durationMin (خودکار = ۷۲۰ ÷ تعداد در شیفت), createdAt, updatedAt }

     قوانین حاکم:
       - کلید یکتا: شماره دستگاه + متراژ استاندارد
       - متراژ استاندارد فقط از میان متراژهای تعریف‌شده در
         «تعریف قانون متراژ استاندارد جدید» (تمام ضخامت‌ها)
       - مدت زمان به دقیقه خودکار محاسبه می‌شود (شیفت = ۱۲ ساعت = ۷۲۰ دقیقه)
       - ذخیره‌سازی در appSettings با کلید machineTimeRules (Backup پوشش می‌دهد)
     ================================================================ */

  const TIME_RULES_KEY = 'machineTimeRules';

  /** خواندن همهٔ قوانین زمان (مقدار پیش‌فرض: آرایهٔ خالی) */
  Rules.getAllTimeRules = async function () {
    const row = await db.appSettings.get(TIME_RULES_KEY);
    return Array.isArray(row?.value) ? row.value : [];
  };

  /** ذخیرهٔ کل لیست قوانین زمان (تراکنشی) */
  Rules.putTimeRules = async function (list) {
    await db.transaction('rw', db.appSettings, async () => {
      await db.appSettings.put({ key: TIME_RULES_KEY, value: list });
    });
  };

  /** کلید یکتای قانون زمان: دستگاه + متراژ استاندارد */
  Rules.timeRuleKey = function (machineNumber, standardLength) {
    return `${machineNumber}-${standardLength}`;
  };

  /** مدت زمان متالایز هر رول (دقیقه) = طول شیفت ÷ تعداد در شیفت (گرد به پایین) */
  Rules.timeDurationMinutes = function (qtyPerShift) {
    return Math.floor(RM.config.SHIFT_MINUTES / qtyPerShift);
  };

  /** فهرست متراژهای استاندارد یکتا از تمام قوانین متراژ (گزینه‌های مجاز قانون زمان) */
  Rules.standardMetrageOptions = function (rules) {
    const set = new Set();
    for (const rule of rules) set.add(rule.standardLength);
    return [...set].sort((a, b) => a - b);
  };

  /**
   * اعتبارسنجی + ذخیرهٔ قانون زمان (ایجاد یا ویرایش).
   * ورودی خام فرم: { machineNumber, standardLength, qtyPerShift }
   * خروجی: { ok, rule } یا { ok:false, errors, message }
   */
  Rules.saveTimeRule = async function (input, editId = null) {
    const errors = {};

    const machineNumber = U.parseInt(input.machineNumber);
    if (!RM.config.VALID_MACHINES.includes(machineNumber)) {
      errors.machineNumber = 'شماره دستگاه باید ۱، ۲ یا ۳ باشد.';
    }

    const standardLength = U.parseNumber(input.standardLength);
    const allLengthRules = await db.standardLengthRules.toArray();
    const allowedMetrages = Rules.standardMetrageOptions(allLengthRules);
    if (standardLength === null) {
      errors.standardLength = 'متراژ استاندارد را انتخاب کنید.';
    } else if (!allowedMetrages.includes(standardLength)) {
      errors.standardLength = 'متراژ استاندارد انتخابی در قوانین متراژ تعریف نشده است.';
    }

    const qtyPerShift = U.parseInt(input.qtyPerShift);
    if (qtyPerShift === null || qtyPerShift < 1) {
      errors.qtyPerShift = 'تعداد در شیفت باید عدد صحیح و حداقل ۱ باشد.';
    }

    if (Object.keys(errors).length) {
      return { ok: false, errors, message: 'مقادیر قانون زمان معتبر نیست.' };
    }

    const existing = await Rules.getAllTimeRules();
    const key = Rules.timeRuleKey(machineNumber, standardLength);
    const duplicate = existing.find(
      (r) => r.key === key && (editId === null || r.id !== editId)
    );
    if (duplicate) {
      return {
        ok: false,
        errors: { standardLength: 'برای این دستگاه و متراژ استاندارد قبلاً قانون ثبت شده است.' },
        message:
          `ترکیب «دستگاه ${U.faNum(machineNumber)} + متراژ ${U.faNum(standardLength)}» تکراری است — ` +
          `هر ترکیب فقط یک قانون دارد.`,
      };
    }

    const durationMin = Rules.timeDurationMinutes(qtyPerShift);
    const now = Date.now();

    if (editId !== null) {
      const idx = existing.findIndex((r) => r.id === editId);
      if (idx === -1) return { ok: false, message: 'قانون موردنظر یافت نشد.' };
      existing[idx] = { ...existing[idx], machineNumber, standardLength, qtyPerShift, durationMin, updatedAt: now };
      await Rules.putTimeRules(existing);
      return { ok: true, rule: existing[idx] };
    }

    const rule = {
      id: now,
      key,
      machineNumber,
      standardLength,
      qtyPerShift,
      durationMin,
      createdAt: now,
      updatedAt: now,
    };
    await Rules.putTimeRules([...existing, rule]);
    return { ok: true, rule };
  };

  /** حذف قانون زمان (تأیید در UI) */
  Rules.removeTimeRule = async function (id) {
    const existing = await Rules.getAllTimeRules();
    await Rules.putTimeRules(existing.filter((r) => r.id !== id));
  };

  /**
   * یافتن قانون زمان مطابق دستگاه + متراژ استاندارد.
   * خروجی: قانون یا null — مبنای ستون‌های «مانده زمان» گزارش ستاپ‌ها.
   */
  Rules.findTimeRule = function (timeRules, machineNumber, standardLength) {
    if (machineNumber === null || standardLength === null) return null;
    const key = Rules.timeRuleKey(machineNumber, standardLength);
    return timeRules.find((r) => r.key === key) || null;
  };

  RM.rulesEngine = Rules;
})();
