/* =========================================================================
   machines.js — موتور قوانین زمان متالایز دستگاه‌ها (§ تنظیمات جدید)
   -------------------------------------------------------------------------
   برای هر دستگاه (۱/۲/۳) تعیین می‌شود که رول‌هایی با «متراژ استاندارد»
   مشخص را در هر شیفت چند عدد تولید (متالایز) می‌کند:

     { id, machineNumber, standardLength, rollsPerShift, durationMinutes }

   قوانین:
     - شماره دستگاه فقط از میان VALID_MACHINES (§21)
     - متراژ استاندارد فقط از میان متراژهای تعریف‌شدهٔ قوانین متراژ (§24)
     - تعداد در شیفت: عدد صحیح ≥ ۱
     - مدت زمان هر رول (دقیقه) = خودکار: ۷۲۰ ÷ تعداد در شیفت (شیفت ۱۲ ساعته)
       مثال: دستگاه ۲، ۲۰۰۰۰ متر، ۷ رول در شیفت → 720÷7 = ۱۰۲ دقیقه
     - کلید یکتا: شماره دستگاه + متراژ استاندارد

   ذخیره‌سازی: appSettings با کلید 'machineTimeRules' (آرایه) —
   به‌صورت خودکار در Backup/Restore و پاک‌سازی کامل پوشش داده می‌شود.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const R = RM.rulesEngine;
  const db = RM.db.db;

  const Machines = {};

  const SETTING_KEY = 'machineTimeRules';

  /* ---------------- محاسبات ---------------- */

  /**
   * مدت زمان متالایز هر رول (دقیقه) — خودکار:
   * طول شیفت (۷۲۰ دقیقه = ۱۲ ساعت) ÷ تعداد رول در شیفت (گرد به پایین).
   */
  Machines.computeDuration = function (rollsPerShift) {
    if (rollsPerShift === null || rollsPerShift < 1) return null;
    return Math.floor(RM.config.SHIFT_MINUTES / rollsPerShift);
  };

  /* ---------------- خواندن / ذخیرهٔ قوانین ---------------- */

  /** همهٔ قوانین زمان ذخیره‌شده (آرایه — مرتب بر اساس دستگاه سپس متراژ) */
  Machines.list = async function () {
    const rows = await RM.db.getSetting(SETTING_KEY, []);
    const rules = Array.isArray(rows) ? rows : [];
    return rules.sort((a, b) =>
      (a.machineNumber || 0) - (b.machineNumber || 0) ||
      (a.standardLength || 0) - (b.standardLength || 0)
    );
  };

  /* ---------------- اعتبارسنجی ---------------- */

  /**
   * اعتبارسنجی کامل ورودی قانون زمان.
   * @param {object} input        مقادیر خام فرم
   * @param {Array}  meterageRules قوانین متراژ استاندارد (برای بررسی تعریف‌بودن متراژ)
   * @param {Array}  existing     قوانین زمان موجود
   * @param {number|null} editId  شناسهٔ قانون در حال ویرایش (از یکتایی مستثنی)
   * خروجی: { ok, record } یا { ok:false, errors:{field:msg}, message }
   */
  Machines.validate = function (input, meterageRules, existing, editId = null) {
    const errors = {};

    const machineNumber = U.parseInt(input.machineNumber);
    if (!RM.config.VALID_MACHINES.includes(machineNumber)) {
      errors.machineNumber = 'شماره دستگاه باید ۱، ۲ یا ۳ باشد (دستگاه‌های متالایز).';
    }

    const standardLength = U.parseNumber(input.standardLength);
    if (standardLength === null) {
      errors.standardLength = 'متراژ استاندارد را انتخاب کنید.';
    } else if (!R.allStandardLengths(meterageRules).includes(standardLength)) {
      errors.standardLength = 'متراژ استاندارد انتخابی در هیچ قانون متراژی تعریف نشده است — ابتدا در بخش «تعریف قانون متراژ استاندارد جدید» آن را تعریف کنید.';
    }

    const rollsPerShift = U.parseInt(input.rollsPerShift);
    if (rollsPerShift === null || rollsPerShift < 1) {
      errors.rollsPerShift = 'تعداد رول در شیفت باید عدد صحیح و حداقل ۱ باشد.';
    }

    if (Object.keys(errors).length) {
      return { ok: false, errors, message: 'لطفاً خطاهای فرم را برطرف کنید.' };
    }

    const record = {
      machineNumber,
      standardLength,
      rollsPerShift,
      durationMinutes: Machines.computeDuration(rollsPerShift),
    };

    // کلید یکتا: دستگاه + متراژ استاندارد
    const duplicate = existing.find(
      (r) => (editId === null || r.id !== editId) &&
              r.machineNumber === machineNumber &&
              r.standardLength === standardLength
    );
    if (duplicate) {
      return {
        ok: false,
        errors: { standardLength: 'برای این دستگاه و متراژ استاندارد قبلاً قانون ثبت شده است.' },
        message:
          `قانون تکراری: دستگاه ${U.faNum(machineNumber)} با متراژ استاندارد ${U.faNum(standardLength)} ` +
          `(${U.faNum(duplicate.rollsPerShift)} رول در شیفت — ${U.faNum(duplicate.durationMinutes)} دقیقه) از قبل موجود است.`,
      };
    }

    return { ok: true, record };
  };

  /* ---------------- عملیات CRUD ---------------- */

  /** ایجاد قانون جدید */
  Machines.create = async function (input) {
    const [meterageRules, existing] = await Promise.all([
      db.standardLengthRules.toArray(),
      Machines.list(),
    ]);

    const check = Machines.validate(input, meterageRules, existing);
    if (!check.ok) return check;

    const rules = await Machines.list();
    const id = rules.length ? Math.max(...rules.map((r) => r.id || 0)) + 1 : 1;
    const record = { ...check.record, id, createdAt: Date.now() };

    await RM.db.setSetting(SETTING_KEY, [...rules, record]);
    return { ok: true, id };
  };

  /** ویرایش قانون */
  Machines.update = async function (id, input) {
    const [meterageRules, existing] = await Promise.all([
      db.standardLengthRules.toArray(),
      Machines.list(),
    ]);

    const check = Machines.validate(input, meterageRules, existing, id);
    if (!check.ok) return check;

    const rules = await Machines.list();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return { ok: false, message: 'قانون موردنظر یافت نشد.' };

    rules[idx] = { ...rules[idx], ...check.record, updatedAt: Date.now() };
    await RM.db.setSetting(SETTING_KEY, rules);
    return { ok: true, id };
  };

  /** حذف قانون (تأیید در UI) */
  Machines.remove = async function (id) {
    const rules = await Machines.list();
    await RM.db.setSetting(SETTING_KEY, rules.filter((r) => r.id !== id));
  };

  /* ---------------- موتیر تطبیق مدت زمان ---------------- */

  /**
   * مدت زمان متالایز یک رول (دقیقه) بر اساس دستگاه + متراژ استاندارد.
   * اگر قانونی تعریف نشده باشد → null (رکوردهای ستاپ بدون زمان گزارش می‌شوند).
   */
  Machines.resolveDuration = function (timeRules, machineNumber, standardLength) {
    if (machineNumber === null || standardLength === null) return null;
    const rule = timeRules.find(
      (r) => r.machineNumber === machineNumber && r.standardLength === standardLength
    );
    return rule ? rule.durationMinutes : null;
  };

  RM.machineTime = Machines;
})();
