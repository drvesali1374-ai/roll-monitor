/* =========================================================================
   app.js — نقطهٔ شروع و هماهنگ‌کنندهٔ مرکزی برنامه
   -------------------------------------------------------------------------
   وظایف:
     ۱) بررسی سلامت کتابخانه‌های لوکال (§72)
     ۲) بازکردن پایگاه‌داده + اجرای مهاجرت‌ها (§76)
     ۳) راه‌اندازی نماها و تب‌ها
     ۴) refreshAll — به‌روزرسانی کل سیستم پس از هر تغییر داده (§55، §90-§91)

   نسخهٔ ۳٫۱۳ — خلاصهٔ تغییرات (پیاده‌سازی در packaging.js / views/packaging.js):
     · صفحهٔ جدید «بسته‌بندی» — ورود فایل مدیریت پالت‌ها (فقط ردیف‌های
       دارای M در نوع فیلم) با نگاشت ستون‌های قابل تعریف در تنظیمات
     · موتور مرکزی بسته‌بندی (js/packaging.js): استخراج قطر بوبین از
       «نوع بسته‌بندی» اکسل، تشخیص خط تولید (F=BOPP/K=CPP)، محاسبهٔ
       مستقل جهت/نوع بسته‌بندی و ظرفیت استاندارد (بوبین ۳/۶)، مقایسه با
       اکسل (هشدار مغایرت)، ظرفیت‌های هدف، گروه‌بندی پنج‌ویژگی و
       بهینه‌سازی ترکیب پالت‌ها (کمینه‌سازی پالت‌های مشارکت‌کننده و
       جابه‌جایی — Deterministic)
     · خروجی: برنامهٔ بسته‌بندی (پالت اصلی/مکمل + پالت‌های مرجوعی از
       انبار)، وضعیت هر پالت، ردیابی کامل هر رول و رول‌های رزرو
     · نسخهٔ ۳٫۱۱ (Allocation خام مرحله‌ای + آیکون ≠ بدون کادر) حفظ شد
   ========================================================================= */

'use strict';

(function () {
  const UI = RM.ui;

  /* ================================================================
     مرکز به‌روزرسانی (§55، §79)
     تنها مسیر اعمال تغییرات: بی‌اعتبارسازی Cache موتور محاسبه
     → محاسبهٔ مجدد → تغذیهٔ تمام نماها از همان نتیجه.
     تغییرات صرفاً UI (مثل مرتب‌سازی) محاسبات را تکرار نمی‌کنند.
     ================================================================ */

  RM.refreshAll = async function () {
    // نسخهٔ ۲٫۹ — مهاجرت هویت ستاپ‌های قدیمی (خط تولید/سالن/تاریخ) از رول‌ها؛
    // Idempotent و ارزان است (بدون رکورد ناقص → فقط یک شمارش). پس از
    // Import/Restore/شروع برنامه خودکار اجرا می‌شود.
    try {
      await RM.db.migrateSetupIdentity();
    } catch (err) {
      console.warn('[MigrateSetupIdentity]', err);
    }

    RM.calcEngine.invalidate();
    const state = await RM.calcEngine.getState();

    // همهٔ نماها از همان شیء وضعیت تغذیه می‌کنند (Single Source of Truth §105)
    await Promise.all([
      RM.views.dashboard.render(state),
      RM.views.importView.render(),
      RM.views.rolls.renderTable(),
      RM.views.cutrolls.renderTable(),
      RM.views.setup.render(),
      RM.views.planning.render(state),   // نسخهٔ ۳٫۲ به بعد — پنل برنامه‌ریزی + گانت + خروجی PDF چندصفحه‌ای (۳٫۵؛ لوگوی SVG ثابت در ۳٫۶)
      RM.views.packaging.render(),   // نسخهٔ ۳٫۱۳ — صفحهٔ بسته‌بندی (موتور مرکزی + چهار زیرتب + نمایش گرافیکی + اکسل)
      RM.views.settings.renderAll(),
      RM.views.lists.render(),      // زبانه‌های لیست رول‌ها + ویرایش‌شده‌ها (تغییر ۳)
    ]);

    return state;
  };

  /* ================================================================
     شروع برنامه
     ================================================================ */

  async function initApp() {
    const badgeDb = document.getElementById('badge-db');
    const badgeDbText = document.getElementById('badge-db-text');

    /* --- ۱) بررسی کتابخانه‌های لوکال (§72) --- */
    if (typeof Dexie === 'undefined' || typeof XLSX === 'undefined') {
      badgeDb.classList.add('err');
      badgeDbText.textContent = 'خطای کتابخانه‌ها';
      document.querySelector('.app-main').innerHTML = `
        <article class="panel panel-lib-error" style="margin-top:24px">
          <h3 class="section-title">خطای بارگذاری کتابخانه‌ها</h3>
          <p class="panel-desc" style="line-height:2.2">
            فایل‌های <code>lib/dexie.min.js</code> یا <code>lib/xlsx.full.min.js</code> کنار
            <code>index.html</code> یافت نشدند.<br>
            لطفاً مطابق راهنمای فایل <code>README.md</code> این دو فایل را در پوشهٔ <code>lib</code> قرار دهید.
          </p>
        </article>`;
      return;
    }

    try {
      /* --- ۲) بازکردن دیتابیس + مهاجرت امن (§76) --- */
      await RM.db.db.open();

      /* --- ۲-ب) ارتقای نرم رکوردهای قدیمی به مدل فعلی (فیلد عرض برش‌خورده) --- */
      await RM.db.ensureModelFields();

      /* --- ۲-پ) ۳٫۲۶ — بارگذاری کلیدهای تطبیق قابل تنظیم (پیش از هر محاسبه/
         نما؛ Overrideهای کاربر از appSettings — پاک‌سازی و اعتبارسنجی داخلی) --- */
      await RM.keys.load();

      badgeDb.classList.add('ok');
      badgeDbText.textContent = 'پایگاه‌داده آماده';

      /* --- ۳) راه‌اندازی نماها --- */
      UI.initTabs();
      UI.initHelpDots();   // آیکون‌های راهنمای ریز کنار عناوین بخش‌ها (۳٫۸)
      RM.views.importView.init();
      await RM.views.rolls.init();
      await RM.views.cutrolls.init();   // async — بارگذاری پنل مرتب‌سازی ماندگار
      await RM.views.setup.init();   // async — بارگذاری پنل مرتب‌سازی ماندگار
      await RM.views.lists.init();   // async — زبانه‌های لیست رول‌ها + ویرایش رکورد (تغییر ۳)
      await RM.views.planning.init();   // نسخهٔ ۳٫۲ به بعد — بارگذاری Board برنامه‌ریزی + دستگاه فعال
      await RM.views.packaging.init();   // نسخهٔ ۳٫۱۳ — صفحهٔ بسته‌بندی (پیکربندی ماندگار جدول‌ها + دراپ‌زون + زیرتب‌ها)
      RM.views.settings.init();

      // هوک‌های نمایش تب (رندر هنگام باز شدن — از Cache، بدون محاسبهٔ مجدد)
      RM.viewHooks = {
        dashboard: () => {
          // نمودارهای ECharts پس از نمایان شدن تب مقیاس/رندر می‌شوند (نسخهٔ ۲٫۳)
          if (RM.views.dashboard && typeof RM.views.dashboard.onShown === 'function') {
            RM.views.dashboard.onShown();
          }
        },
        rolls: () => {
          RM.views.rolls.renderTable();
          RM.views.cutrolls.renderTable();
        },
        // نسخهٔ ۳٫۲ به بعد — رندر مجدد پنل برنامه‌ریزی پس از نمایان شدن تب
        // (گانت چارت در حالت مخفی عرض صفر دارد و باید با نمایان شدن بازسازی شود)
        planning: () => {
          if (RM.views.planning && typeof RM.views.planning.onShown === 'function') {
            RM.views.planning.onShown();
          }
        },
        // ۳٫۱۷ — بسته‌بندی: بازاندازه‌گیری فریز نوار زیرتب‌ها (بند ۲) + تم‌های
        // ردیفی کارت‌های گراف (بند ۳ — رندر در حالت مخفی ستون‌های گرید را نمی‌داند)
        packaging: () => {
          if (RM.views.packaging && typeof RM.views.packaging.onShown === 'function') {
            RM.views.packaging.onShown();
          }
        },
      };

      /* --- ۴) محاسبهٔ اولیه + رندر همهٔ نماها --- */
      await RM.refreshAll();

      /* --- ۵) ۳٫۲۴ بند ۱ — پیام‌رسانی پس از بازیابی پشتیبان ---
         بازیابی، برنامه را یک‌بار دوباره بارگذاری می‌کند (تا همهٔ نماها
         تنظیمات/وضعیت‌های ماندگار را از فایل پشتیبان بخوانند — بند ۱)؛
         این‌جا: بازگشت به تب تنظیمات + پیام موفقیت تا کاربر مطمئن شود
         همهٔ داده‌ها و جزئیات جداول اعمال شده است. */
      try {
        if (sessionStorage.getItem('rm-restore-reload') === '1') {
          sessionStorage.removeItem('rm-restore-reload');
          UI.switchTab('settings');
          UI.toast(
            'بازیابی پشتیبان اعمال شد — همهٔ داده‌ها، تنظیمات و وضعیت جداول از فایل بازسازی گردید.',
            'success',
            5000
          );
        }
      } catch { /* حالت خصوصی — بدون فلج */ }

      console.info('✅ سامانهٔ مانیتورینگ رول‌ها آماده است — حالت کاملاً آفلاین');
    } catch (err) {
      console.error('[شروع برنامه]', err);
      badgeDb.classList.add('err');
      badgeDbText.textContent = 'خطای پایگاه‌داده';
      UI.toast(
        'اتصال به پایگاه‌دادهٔ محلی ممکن نشد. اگر مرورگر در حالت خصوصی است، از پنجرهٔ عادی استفاده کنید.',
        'error',
        8000
      );
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
