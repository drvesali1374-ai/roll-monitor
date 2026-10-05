/* =========================================================================
   keys.js — موتور کلیدهای تطبیق (نسخهٔ ۳٫۲۹) ⭐
   -------------------------------------------------------------------------
   تنها منبع ساخت کلیدهای تطبیق/هویت/گروه‌بندی کل سیستم (Single Source of
   Truth). رجیستری تعاریف در config.js است (MATCH_KEYS + MATCH_KEY_PARAMS +
   WIDTH_SOURCE_FIELDS)؛ این ماژول ترکیب فعلی هر کلید را از تنظیمات کاربر
   (appSettings: matchingKeys) و ستون نمایندهٔ «عرض» هر سمت رول‌ای را از
   appSettings: matchKeyWidthSources می‌خواند و رشتهٔ کلید را می‌سازد.

   قواعد (سند کاربر ۳٫۲۶):
     · از هر نوع کلید همیشه دقیقاً یک نمونه وجود دارد — کلید قابل حذف نیست
       (پنل تنظیمات دکمهٔ حذف ندارد؛ Override تهی = پیش‌فرض رجیستری).
     · هر کلید حداقل یک پارامتر دارد — کلید بدون پارامتر معنا ندارد
       (پاک‌سازی Override خالی/نامعتبر → بازگشت به پیش‌فرض).
     · پارامترها فقط از میان pool مجاز همان کلید (فاکتورهای قابل محاسبه در
       هر دو سمت تطبیق) انتخاب می‌شوند — مقدار نامعتبر → حذف از ترکیب.
     · Overrideها فقط اختلاف با پیش‌فرض را نگه می‌دارند و چون در appSettings
       ذخیره می‌شوند، خودکار در فایل پشتیبان ذخیره/بازیابی می‌شوند (۳٫۲۳).

   منابع ستون «عرض» (سند کاربر ۳٫۲۷ + ۳٫۲۸ + اصلاح ۳٫۲۹):
     · پارامتر «عرض» در هر کلید، به‌ازای هر فایل رول‌ای که در همان کلید مشارکت
       دارد، یک پراپرتی جداگانه دارد: «عرض در فایل رول‌های موجود» و «عرض در
       فایل آرشیو» — قابل تنظیم بین ستون‌های عرض‌مانند نگاشت همان فایل.
     · اصلاح ۳٫۲۹: فقط در کلیدهایی که پارامتر «عرض» دارند و دیتای فایل
       «رول‌های موجود» در کلید مشارکت می‌کند، پارامتر عرض دو پراپرتی دارد
       (خام rawMatch: «عرض در فایل رول‌های موجود» قابل تنظیم + «عرض در فایل
       آرشیو» قفل) — لزوم مشارکت دیتای آرشیو حذف شد. چون فایل «سابقه رول‌ها
       (آرشیو)» ستونی با نام «عرض اولیه» ندارد، سمت آرشیو فقط پراپرتی «عرض»
       را دارد که نیاز به تنظیم توسط کاربر ندارد (fixed در رجیستری —
       Override از سوی موتور و UI پذیرفته نمی‌شود).
     · کلید متالایز (metMatch): دیتای فایل «رول‌های موجود» در آن مشارکت
       ندارد → فقط پراپرتی «عرض در فایل آرشیو» (قفل‌شده) را دارد (۳٫۲۸ سمت
       raw هم داشت که حذف شد).
     · برش‌خورده (cutMatch: تک‌فایلی رول‌های موجود) فقط پراپرتی «عرض برش در
       فایل رول‌های موجود» (قابل تنظیم) را دارد.
     · پیش‌فرض سمت رول‌های موجود = ستون «عرض اولیه» (۳٫۲۷) در خام؛ برش‌خورده
       ستون «عرض»؛ سمت آرشیو همیشه ستون «عرض» (قفل).
     · ذخیره‌سازی per-کلید (matchKeyWidthSources — فقط اختلاف‌ها؛ نبودِ
       Override = پیش‌فرض widthPolicy همان کلید). Overrideهای قدیمیِ سمت‌های
       حذف‌شده/فیلدهای حذف‌شده (مثل archived:initialWidth یا metMatch.raw)
       خودکار پاک می‌شوند (خودشوافی ارتقا از ۳٫۲۷/۳٫۲۸).
     · کلیدهای پالت‌ها/بسته‌بندی عمداً منبع عرض قابل تنظیم ندارند (خارج از
       دامنهٔ سند) و کلید یکتایی ستاپ (setupUnique) عرض را فقط از فیلد
       عرض خودِ ستاپ می‌خواند (هر دو سمتش رکورد ستاپ‌اند — یادداشت زیرمنو).
   ========================================================================= */

'use strict';

(function () {
  const Keys = {
    /** Overrideهای کاربر: { [keyId]: [paramId, ...] } — از appSettings */
    _overrides: {},
    /** Overrideهای منبع عرض: { [keyId]: { [source]: fieldId } } — از appSettings */
    _widthOverrides: {},
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
   * پاک‌سازی Overrideهای ترکیب پارامترها (۳٫۲۶ — بدون تغییر).
   */
  function cleanParamsOverrides(stored) {
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
    return clean;
  }

  /**
   * پاک‌سازی Overrideهای منبع عرض (۳٫۲۷ · ۳٫۲۸ · اصلاح ۳٫۲۹):
   *   · فقط کلیدهای دارای widthPolicy.sources
   *   · فقط سمت‌های مشارکت‌کننده در همان کلید (اصلاح ۳٫۲۹: خام raw+archived ·
   *     متالایز فقط archived · برش‌خورده فقط raw)
   *   · فقط فیلدهای مجاز WIDTH_SOURCE_FIELDS همان سمت
   *   · سمت‌های fixed (آرشیو — اصلاح ۳٫۲۹) هرگز Override نمی‌گیرند
   *   · برابرِ پیش‌فرض → حذف (ذخیرهٔ صرفاً اختلاف‌ها)
   *   · خودشوافی ارتقا: Overrideهای قدیمیِ سمت/فیلد حذف‌شده (metMatch.raw یا
   *     archived:initialWidth از ۳٫۲۷/۳٫۲۸) خودکار دور ریخته می‌شوند.
   */
  function cleanWidthOverrides(stored) {
    const clean = {};
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return clean;
    for (const def of RM.config.MATCH_KEYS) {
      const policy = def.widthPolicy;
      if (!policy || !policy.sources) continue;            // تنظیم منبع عرض ندارد
      const raw = stored[def.id];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const srcClean = {};
      for (const [src, dflt] of Object.entries(policy.sources)) {
        const fields = RM.config.WIDTH_SOURCE_FIELDS[src];
        /* ۳٫۲۹ — سمت قفل (مثل آرشیو) و فیلد حذف‌شده: Override رد می‌شود */
        if (!fields || (fields[dflt] && fields[dflt].fixed)) continue;
        const v = raw[src];
        if (typeof v === 'string' &&
            Object.prototype.hasOwnProperty.call(fields, v) && v !== dflt) {
          srcClean[src] = v;
        }
      }
      if (Object.keys(srcClean).length) clean[def.id] = srcClean;
    }
    return clean;
  }

  /**
   * بارگذاری Overrideها از appSettings (matchingKeys + matchKeyWidthSources)
   * + پاک‌سازی. در شروع برنامه، پس از ذخیرهٔ پنل، و در ابتدای هر محاسبهٔ
   * مرکزی فراخوانی می‌شود (ارزان — دو خواندن همگام Dexie).
   * ۳٫۲۹ — خودشوافی ماندگار: اگر پاک‌سازی، مقدار ذخیره‌شده را تغییر داد
   * (Overrideهای قدیمی/نامعتبر مثل سمت‌های حذف‌شده یا archived:initialWidth)،
   * نسخهٔ پاک حاصل جایگزین appSettings می‌شود تا فایل پشتیبان هم تمیز بماند.
   */
  Keys.load = async function () {
    let stored = {};
    let storedWidth = {};
    try {
      [stored, storedWidth] = await Promise.all([
        RM.db.getSetting('matchingKeys', {}),
        RM.db.getSetting('matchKeyWidthSources', {}),
      ]);
    } catch (err) {
      console.warn('[MatchKeys:load]', err);
      stored = {};
      storedWidth = {};
    }

    const clean = cleanParamsOverrides(stored || {});
    const cleanWidth = cleanWidthOverrides(storedWidth);
    Keys._overrides = clean;
    Keys._widthOverrides = cleanWidth;
    Keys._loaded = true;

    /* ۳٫۲۹ — بازنویسی فقط در صورت تفاوت (بیدفاع: اجرای همزمان مقدار یکسان می‌نویسد) */
    try {
      if (JSON.stringify(clean) !== JSON.stringify(stored || {})) {
        await RM.db.setSetting('matchingKeys', clean);
      }
      if (JSON.stringify(cleanWidth) !== JSON.stringify(storedWidth || {})) {
        await RM.db.setSetting('matchKeyWidthSources', cleanWidth);
      }
    } catch (err) {
      console.warn('[MatchKeys:self-heal]', err);   // نوشتن نشد — مقادیر حافظه‌ای معتبرند
    }
    return Keys._overrides;
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

  /** آیا کلید با Override کاربر ویرایش شده است؟ (ترکیب پارامترها یا منبع عرض) */
  Keys.isModified = function (keyId) {
    const paramsMod = Array.isArray(Keys._overrides[keyId]) && Keys._overrides[keyId].length > 0;
    const widthMod = Keys._widthOverrides[keyId] &&
      typeof Keys._widthOverrides[keyId] === 'object' &&
      Object.keys(Keys._widthOverrides[keyId]).length > 0;
    return !!(paramsMod || widthMod);
  };

  /* ---------------- منابع ستون «عرض» (۳٫۲۷ · ۳٫۲۸) ---------------- */

  /** سیاست عرض یک کلید (widthPolicy رجیستری — یا null) */
  Keys.widthPolicyOf = function (keyId) {
    const def = Keys.defOf(keyId);
    return (def && def.widthPolicy) ? def.widthPolicy : null;
  };

  /** فاکتور هدفِ منبع عرض یک کلید ('width' پیش‌فرض یا 'cutWidth') */
  Keys.widthParamOf = function (keyId) {
    const policy = Keys.widthPolicyOf(keyId);
    return (policy && policy.param) ? policy.param : 'width';
  };

  /** فیلد نمایندهٔ فعلی عرض یک سمت در یک کلید — Override یا پیش‌فرض رجیستری
      (اصلاح ۳٫۲۹ — سمت‌های مجاز هر کلید از widthPolicy همان کلید: خام raw+
      archived · متالایز فقط archived · برش‌خورده فقط raw؛ سمت قفل‌شده (آرشیو)
      همیشه پیش‌فرض رجیستری است و Override نمی‌پذیرد) */
  Keys.widthSourceOf = function (keyId, source) {
    const def = Keys.defOf(keyId);
    if (!def || !def.widthPolicy || !def.widthPolicy.sources) return null;
    const dflt = def.widthPolicy.sources[source];
    if (dflt === undefined) return null;   // این سمت در این کلید مشارکت ندارد
    /* ۳٫۲۹ — سمت قفل (fixed): همیشه پیش‌فرض، فارغ از Override کهنه */
    const fields = RM.config.WIDTH_SOURCE_FIELDS[source];
    if (fields && fields[dflt] && fields[dflt].fixed) return dflt;
    const ov = Keys._widthOverrides[keyId];
    if (ov && typeof ov === 'object' && typeof ov[source] === 'string') return ov[source];
    return dflt;
  };

  /** آیا این سمتِ منبع عرض در این کلید قفل‌شده است؟ (۳٫۲۹ — آرشیو: فقط «عرض»
      و قابل تنظیم نیست؛ UI با همین پرچم سلکت را غیرفعال/قفل نشان می‌دهد) */
  Keys.isFixedWidthSource = function (keyId, source) {
    const def = Keys.defOf(keyId);
    if (!def || !def.widthPolicy || !def.widthPolicy.sources) return false;
    const dflt = def.widthPolicy.sources[source];
    if (dflt === undefined) return false;
    const fields = RM.config.WIDTH_SOURCE_FIELDS[source];
    return !!(fields && fields[dflt] && fields[dflt].fixed);
  };

  /** مقدار عرض یک رکورد رول بر اساس فیلد نمایندهٔ کلید/سمت فعلی (۳٫۲۷) */
  Keys.widthValue = function (keyId, source, record) {
    const field = Keys.widthSourceOf(keyId, source);
    if (!field) return null;
    const v = record ? record[field] : null;
    return (v === null || v === undefined) ? null : v;
  };

  /** آیا منبع عرض این کلید توسط کاربر تغییر کرده است؟ */
  Keys.widthSourceModified = function (keyId) {
    const ov = Keys._widthOverrides[keyId];
    return !!(ov && typeof ov === 'object' && Object.keys(ov).length > 0);
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
   * اعتبارسنجی منابع عرض یک کلید (گارد موتور — سند ۳٫۲۷ · اصلاح ۳٫۲۹).
   * @param {string} keyId
   * @param {object|undefined} widthSources  { [source]: fieldId } — فقط سمت‌های
   *   مشارکت‌کنندهٔ widthPolicy همان کلید پذیرفته می‌شوند؛ سمت‌های قفل‌شده
   *   (آرشیو — ۳٫۲۹) Override نمی‌پذیرند.
   * @returns {{ ok: boolean, error?: string, value?: object }} value = نگاشت
   *   پاک‌شده (فقط اختلاف با پیش‌فرض — برابر پیش‌فرض حذف می‌شود).
   */
  function validateWidthSources(keyId, widthSources) {
    const def = Keys.defOf(keyId);
    if (!def) return { ok: false, error: 'کلید شناسایی نشد.' };
    const policy = def.widthPolicy;
    if (!widthSources) return { ok: true, value: {} };   // بدون تغییر
    if (typeof widthSources !== 'object' || Array.isArray(widthSources)) {
      return { ok: false, error: 'منبع ستون «عرض» معتبر نیست.' };
    }
    if (!policy || !policy.sources) {
      return { ok: false, error: 'این کلید ستون نمایندهٔ «عرض» قابل تنظیم ندارد.' };
    }
    const clean = {};
    for (const [src, field] of Object.entries(widthSources)) {
      if (!(src in policy.sources)) {
        return { ok: false, error: `سمت «${String(src)}» در این کلید مشارکت ندارد.` };
      }
      const fields = RM.config.WIDTH_SOURCE_FIELDS[src];
      if (typeof field !== 'string' || !fields ||
          !Object.prototype.hasOwnProperty.call(fields, field)) {
        return { ok: false, error: `ستون «${String(field)}» برای منبع عرض این کلید مجاز نیست.` };
      }
      /* ۳٫۲۹ — سمت قفل‌شده (آرشیو): فقط مقدار پیش‌فرض پذیرفته می‌شود */
      const dflt = policy.sources[src];
      if (fields[dflt] && fields[dflt].fixed && field !== dflt) {
        return { ok: false, error: 'پراپرتی «عرض در فایل آرشیو» قابل تنظیم نیست — فایل آرشیو ستون «عرض اولیه» ندارد و همیشه از ستون «عرض» خوانده می‌شود.' };
      }
      if (field !== dflt) clean[src] = field;   // برابر پیش‌فرض → بدون Override
    }
    return { ok: true, value: clean };
  }

  /**
   * ذخیرهٔ ترکیب یک کلید + منابع عرض آن (اعتبارسنجی اینجا هم اجرا می‌شود —
   * گارد موتور). widthSources اختیاری است؛ undefined = بدون تغییر منابع عرض.
   * @returns {{ ok: boolean, error?: string, params?: Array, widthSources?: object }}
   */
  Keys.saveOverride = async function (keyId, params, widthSources) {
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

    /* ۳٫۲۷ — منابع عرض هم پیش از نوشتن اعتبارسنجی می‌شوند */
    const wCheck = validateWidthSources(keyId, widthSources);
    if (!wCheck.ok) return { ok: false, error: wCheck.error };

    const next = { ...Keys._overrides };
    const isDefault = clean.length === def.defaults.length &&
      clean.every((p, i) => p === def.defaults[i]);
    if (isDefault) delete next[keyId];   // برابر پیش‌فرض → بدون Override
    else next[keyId] = clean;

    /* ۳٫۲۷ — نوشتن هر دو تنظیم در یک تراکنش نه؛ دو put مجزا اما پشت‌سرهم */
    const nextWidth = { ...Keys._widthOverrides };
    if (Object.keys(wCheck.value).length) nextWidth[keyId] = wCheck.value;
    else delete nextWidth[keyId];

    await RM.db.setSetting('matchingKeys', next);
    await RM.db.setSetting('matchKeyWidthSources', nextWidth);
    await Keys.load();                   // بازخوانی قطعی از DB
    return { ok: true, params: clean, widthSources: wCheck.value };
  };

  /** حذف Override یک کلید (ترکیب + منابع عرض) → بازگشت به پیش‌فرض رجیستری
      (کلید حذف نمی‌شود) */
  Keys.resetOverride = async function (keyId) {
    const next = { ...Keys._overrides };
    delete next[keyId];
    const nextWidth = { ...Keys._widthOverrides };
    delete nextWidth[keyId];
    await RM.db.setSetting('matchingKeys', next);
    await RM.db.setSetting('matchKeyWidthSources', nextWidth);
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
