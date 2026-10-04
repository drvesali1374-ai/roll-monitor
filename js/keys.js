/* =========================================================================
   keys.js — موتور کلیدهای تطبیق (نسخهٔ ۳٫۲۶) ⭐
   -------------------------------------------------------------------------
   تنها منبع ساخت کلیدهای تطبیق/هویت/گروه‌بندی کل سیستم (Single Source of
   Truth). رجیستری تعاریف در config.js است (MATCH_KEYS + MATCH_KEY_PARAMS)؛
   این ماژول ترکیب فعلی هر کلید را از تنظیمات کاربر (appSettings:
   matchingKeys) می‌خواند و رشتهٔ کلید را می‌سازد.

   قواعد (سند کاربر ۳٫۲۶):
     · از هر نوع کلید همیشه دقیقاً یک نمونه وجود دارد — کلید قابل حذف نیست
       (پنل تنظیمات دکمهٔ حذف ندارد؛ Override تهی = پیش‌فرض رجیستری).
     · هر کلید حداقل یک پارامتر دارد — کلید بدون پارامتر معنا ندارد
       (پاک‌سازی Override خالی/نامعتبر → بازگشت به پیش‌فرض).
     · پارامترها فقط از میان pool مجاز همان کلید (فاکتورهای قابل محاسبه در
       هر دو سمت تطبیق) انتخاب می‌شوند — مقدار نامعتبر → حذف از ترکیب.
     · Overrideها فقط اختلاف با پیش‌فرض را نگه می‌دارند و چون در appSettings
       ذخیره می‌شوند، خودکار در فایل پشتیبان ذخیره/بازیابی می‌شوند (۳٫۲۳).
   ========================================================================= */

'use strict';

(function () {
  const Keys = {
    /** Overrideهای کاربر: { [keyId]: [paramId, ...] } — از appSettings */
    _overrides: {},
    /** آیا بارگذاری اولیه انجام شده است */
    _loaded: false,
  };

  /* ---------------- تعریف‌ها (از رجیستری config) ---------------- */

  /** شیء id → تعریف کلید */
  Keys.defs = function () {
    const map = {};
    for (const def of RM.config.MATCH_KEYS) map[def.id] = def;
    return map;
  };

  /** تعریف یک کلید (یا null) */
  Keys.defOf = function (keyId) {
    return RM.config.MATCH_KEYS.find((d) => d.id === keyId) || null;
  };

  /* ---------------- بارگذاری و پاک‌سازی ---------------- */

  /**
   * بارگذاری Overrideها از appSettings (کلید matchingKeys) + پاک‌سازی.
   * پاک‌سازی هر Override:
   *   · فقط فیلدهای شناخته‌شده (id در رجیستری)
   *   · فقط پارامترهای مجازِ pool همان کلید
   *   · حذف تکراری‌ها و حفظ ترتیب
   *   · آرایهٔ تهی/بی‌پارامتر → حذف Override (بازگشت به پیش‌فرض — کلید
   *     بدون پارامتر معنا ندارد)
   *   · ترکیبِ برابرِ پیش‌فرض → حذف Override (ذخیرهٔ صرفاً اختلاف‌ها)
   * در شروع برنامه، پس از ذخیرهٔ پنل، و در ابتدای هر محاسبهٔ مرکزی
   * فراخوانی می‌شود (ارزان — یک خواندن Dexie).
   */
  Keys.load = async function () {
    let stored = {};
    try {
      stored = await RM.db.getSetting('matchingKeys', {}) || {};
    } catch (err) {
      console.warn('[MatchKeys:load]', err);
      stored = {};
    }

    const clean = {};
    for (const def of RM.config.MATCH_KEYS) {
      const raw = stored[def.id];
      if (!Array.isArray(raw) || !raw.length) continue;   // تهی/نامعتبر → پیش‌فرض
      const seen = new Set();
      const params = [];
      for (const p of raw) {
        if (typeof p === 'string' && def.pool.includes(p) && !seen.has(p)) {
          seen.add(p);
          params.push(p);
        }
      }
      if (!params.length) continue;                       // بدون پارامتر → پیش‌فرض
      if (params.length === def.defaults.length &&
          params.every((p, i) => p === def.defaults[i])) continue;   // = پیش‌فرض
      clean[def.id] = params;
    }

    Keys._overrides = clean;
    Keys._loaded = true;
    return clean;
  };

  /** بارگذاری اطمینانی برای مصرف‌کننده‌های همگام (اگر هنوز بارگذاری نشده) */
  Keys.ensure = async function () {
    if (!Keys._loaded) await Keys.load();
    return Keys._overrides;
  };

  /* ---------------- خواندن ترکیب فعلی ---------------- */

  /** آرایهٔ پارامترهای فعلی یک کلید (ترتیب‌دار) — Override یا پیش‌فرض */
  Keys.paramsOf = function (keyId) {
    const def = Keys.defOf(keyId);
    if (!def) return [];
    const ov = Keys._overrides[keyId];
    if (Array.isArray(ov) && ov.length) return ov.slice();
    return def.defaults.slice();
  };

  /** آیا کلید با Override کاربر ویرایش شده است؟ */
  Keys.isModified = function (keyId) {
    return Array.isArray(Keys._overrides[keyId]) && Keys._overrides[keyId].length > 0;
  };

  /* ---------------- ساخت کلید ---------------- */

  /**
   * ساخت رشتهٔ کلید از مقدار فاکتورها.
   * @param {string} keyId   شناسهٔ کلید (رجیستری config.MATCH_KEYS)
   * @param {object} values  مقدار فاکتورها: { paramId: value }
   *   فاکتور غایب/null → 'null' (همان رفتار U.formatKey — رکوردهای ناقص
   *   هم‌کلیدِ «نامشخص» می‌شوند؛ گیت کامل‌بودن داده جداگانه محافظت می‌کند).
   * @returns {string} رشتهٔ کلید (اتصال با '-')
   */
  Keys.build = function (keyId, values) {
    const parts = Keys.paramsOf(keyId);
    if (!parts.length) return 'null';
    const v = values || {};
    return parts.map((p) => {
      const val = Object.prototype.hasOwnProperty.call(v, p) ? v[p] : null;
      return (val === null || val === undefined) ? 'null' : String(val);
    }).join('-');
  };

  /* ---------------- ذخیره / بازگردانی (پنل تنظیمات) ---------------- */

  /**
   * ذخیرهٔ ترکیب یک کلید (اعتبارسنجی اینجا هم اجرا می‌شود — گارد موتور).
   * @returns {{ ok: boolean, error?: string, params?: Array }}
   */
  Keys.saveOverride = async function (keyId, params) {
    const def = Keys.defOf(keyId);
    if (!def) return { ok: false, error: 'کلید شناسایی نشد.' };
    if (!Array.isArray(params) || !params.length) {
      return { ok: false, error: 'کلید بدون پارامتر معنا و کاربرد ندارد — حداقل یک پارامتر لازم است.' };
    }
    const seen = new Set();
    const clean = [];
    for (const p of params) {
      if (typeof p !== 'string' || !def.pool.includes(p)) {
        return { ok: false, error: `پارامتر «${String(p)}» برای این کلید مجاز نیست.` };
      }
      if (!seen.has(p)) { seen.add(p); clean.push(p); }
    }
    if (!clean.length) {
      return { ok: false, error: 'کلید بدون پارامتر معنا و کاربرد ندارد — حداقل یک پارامتر لازم است.' };
    }

    const next = { ...Keys._overrides };
    const isDefault = clean.length === def.defaults.length &&
      clean.every((p, i) => p === def.defaults[i]);
    if (isDefault) delete next[keyId];   // برابر پیش‌فرض → بدون Override
    else next[keyId] = clean;

    await RM.db.setSetting('matchingKeys', next);
    await Keys.load();                   // بازخوانی قطعی از DB
    return { ok: true, params: clean };
  };

  /** حذف Override یک کلید → بازگشت به پیش‌فرض رجیستری (کلید حذف نمی‌شود) */
  Keys.resetOverride = async function (keyId) {
    const next = { ...Keys._overrides };
    delete next[keyId];
    await RM.db.setSetting('matchingKeys', next);
    await Keys.load();
    return { ok: true };
  };

  /* ---------------- شرح فارسی (نمایش/تولتیپ) ---------------- */

  /** شرح فارسی ترکیب فعلی یک کلید: «عرض + شماره ستاپ + …» */
  Keys.describe = function (keyId) {
    const P = RM.config.MATCH_KEY_PARAMS;
    return Keys.paramsOf(keyId)
      .map((p) => (P[p] ? P[p].label : p))
      .join(' + ');
  };

  RM.keys = Keys;
})();
