/* =========================================================================
   ui.js — ابزارهای مشترک رابط کاربری
   -------------------------------------------------------------------------
   شامل: Toast، Modal تأیید (Promise-based)، Modal اطلاعاتی،
   مدیریت تب‌ها، رندر جدول صفحه‌بندی‌شده (§56) و Escape امن.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;

  const UI = {};

  /* ---------------- آیکون‌های SVG ---------------- */

  UI.icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    cross:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    alert:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    trash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    edit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    audit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    grip:    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    plus:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    /* ادغام ردیف تکراری پیش‌نمایش Bulk با همتای معتبر (تغییر ۲) */
    merge:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
    /* نمایش/مخفی‌کردن ستون در پنل ترتیب ستون‌ها (تغییر ۳) */
    eye:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
    /* ۳٫۳۱ — دکمهٔ «عملیات» ردیف‌های جدول ستاپ (منوی بازشونده) */
    dots:    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    /* ۳٫۳۱ — «انقضاء انتخاب شده‌ها» (ساعت منقضی) */
    expire:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="m2 2 20 20"/></svg>',
    /* ۳٫۳۱ — «لغو انتخاب‌ها» (چک‌باکس با ضربدر) */
    unselect:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
    /* ۳٫۳۱ — «حذف انتخاب شده‌ها» (سطل با علامت تأیید) */
    trashSel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="m9.5 13.5 2 2 3.5-3.5"/></svg>',
    /* ۳٫۳۲ — «خروج از انقضا» (بازیابی/برگرداندن — پیکان چرخشی) */
    unexpire:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="m9 12 2 2 4-4"/></svg>',
  };

  /* ---------------- Toast ---------------- */

  /** نمایش اعلان شناور؛ type ∈ success | error | warning | info */
  UI.toast = function (message, type = 'info', duration = 4200) {
    const stack = document.getElementById('toasts');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    // نسخهٔ ۲٫۷: ایزوله‌سازی ران‌های لاتین (شمارهٔ رول/نام فایل/…) داخل متن فارسی
    el.innerHTML = `${UI.icons[type] || UI.icons.info}<div>${U.bidi(message)}</div>`;
    stack.appendChild(el);

    const timer = setTimeout(dismiss, duration);
    function dismiss() {
      clearTimeout(timer);
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
    el.addEventListener('click', dismiss);
  };

  /* ---------------- Modal تأیید (Promise) ---------------- */

  let modalResolve = null;

  /**
   * نمایش پنجرهٔ تأیید و انتظار برای پاسخ.
   * options: { title, html, message, confirmText, danger }
   */
  UI.confirm = function (options) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal');
      const titleEl = document.getElementById('modal-title');
      const msgEl = document.getElementById('modal-msg');
      const btnOk = document.getElementById('modal-confirm');
      const btnCancel = document.getElementById('modal-cancel');

      titleEl.textContent = options.title || 'تأیید عملیات';
      // html اختیاری برای آمار تأیید (محتوای داخلی قابل اعتماد — UI خودمان می‌سازدش)
      msgEl.innerHTML = (options.html || '') + U.escapeHtml(options.message || '');
      btnOk.textContent = options.confirmText || 'بله، انجام بده';
      btnOk.classList.toggle('btn-danger', !!options.danger);
      btnOk.classList.toggle('btn-primary', !options.danger);

      overlay.hidden = false;
      btnOk.focus();

      function close(result) {
        overlay.hidden = true;
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        document.removeEventListener('keydown', onKey);
        modalResolve = null;
        resolve(result);
      }
      const onOk = () => close(true);
      const onCancel = () => close(false);
      const onOverlay = (e) => { if (e.target === overlay) close(false); };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      document.addEventListener('keydown', onKey);
    });
  };

  /* ---------------- Modal اطلاعاتی (Audit — §45) ---------------- */

  /** نمایش پنجرهٔ اطلاعات با محتوای ساختاریافته (ریشه قابل اعتماد)
   *  ۳٫۹ — تغییر ۶: opts.wide کادر مودال را برای جدول‌های دارای «ستون‌های
   *  جزئیات» عریض‌تر می‌کند (نمایش ستون‌های بیشتر بدون اسکرول افقی). */
  UI.infoModal = function (title, bodyHtml, opts = {}) {
    const overlay = document.getElementById('modal-info');
    const titleEl = document.getElementById('modal-info-title');
    const bodyEl = document.getElementById('modal-info-body');
    const btnClose = document.getElementById('modal-info-close');
    const card = overlay ? overlay.querySelector('.modal-card') : null;

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    if (card) card.classList.toggle('modal-wide', !!opts.wide);
    overlay.hidden = false;
    btnClose.focus();

    function close() {
      overlay.hidden = true;
      btnClose.removeEventListener('click', close);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    const onOverlay = (e) => { if (e.target === overlay) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    btnClose.addEventListener('click', close);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  };

  /* ---------------- آیکون راهنمای ریز کنار عناوین بخش‌ها (۳٫۸) ----------------
     دکمهٔ <button class="help-dot" data-help="کلید" data-help-title="عنوان">؟</button>
     محتوای هر پاپ‌آپ در <template id="help-کلید"> همان صفحه قرار دارد. */

  UI.initHelpDots = function () {
    if (UI._helpDotsBound) return;
    UI._helpDotsBound = true;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.help-dot[data-help]');
      if (!btn) return;

      const tpl = document.getElementById(`help-${btn.dataset.help}`);
      if (!tpl) return;

      const content = tpl.innerHTML || '';
      UI.infoModal(
        btn.dataset.helpTitle || 'راهنمای این بخش',
        `<div class="help-pop-body">${content}</div>`
      );
    });
  };

  /* ---------------- مدیریت تب‌ها (§71: دسترس‌پذیر) ---------------- */

  UI.initTabs = function () {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => UI.switchTab(btn.dataset.view));
    });
  };

  /* ---------------- اسکرول مستقل هر صفحه (نسخهٔ ۳٫۱ — تغییر ۲) ----------------
     موقعیت اسکرول هر صفحه (نما + زیرنمای فعال) مخصوص همان صفحه است و در
     حافظهٔ جلسه‌ای ذخیره می‌شود:
       · خروج از یک صفحه → ذخیرهٔ موقعیت فعلی زیر کلید همان صفحه
       · ورود به صفحه‌ای که قبلاً دیده شده → بازگردانی موقعیت ذخیره‌شده
       · ورود اول → اسکرول بالای صفحه (صفر)
     کلید صفحه = «نما» یا «نما:زیرنما» (مثل import:archived یا rolls:cut). */

  UI._scrollMemory = {};   // pageKey → scrollTop (حافظهٔ جلسه‌ای — بدون IndexedDB)

  /** کلید صفحهٔ فعالِ یک نما: «نما» یا «نما:زیرنما» (زیرنمای فعال از دکمهٔ subtab-btn فعلی خوانده می‌شود) */
  UI.pageKeyOf = function (viewEl) {
    if (!viewEl) return 'unknown';
    const view = String(viewEl.id || '').replace(/^view-/, '') || 'unknown';
    const subBtn = viewEl.querySelector('.subtab-btn.active');
    if (subBtn) {
      const sub = subBtn.dataset.ilsubview || subBtn.dataset.subview || '';
      if (sub) return `${view}:${sub}`;
    }
    return view;
  };

  /** ذخیرهٔ موقعیت اسکرول فعلی زیر کلید صفحهٔ فعال */
  UI.saveScrollPosition = function (pageKey) {
    if (!pageKey) return;
    UI._scrollMemory[pageKey] = window.scrollY || 0;
  };

  /** بازگردانی موقعیت اسکرول ذخیره‌شدهٔ یک کلید (پیش‌فرض: بالای صفحه) */
  UI.restoreScrollPosition = function (pageKey) {
    const top = Object.prototype.hasOwnProperty.call(UI._scrollMemory, pageKey)
      ? Number(UI._scrollMemory[pageKey]) || 0
      : 0;
    window.scrollTo({ top, behavior: 'auto' });
  };

  /** ذخیرهٔ اسکرول صفحهٔ فعالِ فعلی (پیش از ترک آن) — کلید از DOM خوانده می‌شود */
  UI.saveCurrentScroll = function () {
    UI.saveScrollPosition(UI.pageKeyOf(document.querySelector('.view.active')));
  };

  /** تعویض تب فعال (همراه با فراخوانی هوک نما در صورت وجود)
      نسخهٔ ۳٫۱ — تغییر ۲: اسکرولِ صفحهٔ ترک‌شده ذخیره و اسکرول صفحهٔ مقصد بازگردانی می‌شود */
  UI.switchTab = function (viewName) {
    // ۱) ذخیرهٔ موقعیت اسکرول صفحه‌ای که ترک می‌شود
    UI.saveCurrentScroll();

    // ۲) تعویض نماها
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const isActive = b.dataset.view === viewName;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.view').forEach((section) => {
      const isActive = section.id === `view-${viewName}`;
      section.classList.toggle('active', isActive);
      section.hidden = !isActive;
    });

    // ۳) بازگردانی موقعیت اسکرول مخصوص صفحهٔ مقصد (مستقل از سایر صفحات)
    UI.restoreScrollPosition(UI.pageKeyOf(document.querySelector('.view.active')));

    // هوک نمایش نما (مثلاً رندر با دادهٔ تازه هنگام باز شدن)
    const hook = RM.viewHooks && RM.viewHooks[viewName];
    if (typeof hook === 'function') hook();
  };

  /* ---------------- جدول صفحه‌بندی‌شده (§56) ---------------- */

  /**
   * رندر جدول صفحه‌بندی‌شده:
   * @param wrap       عنصر نگهدارندهٔ جدول
   * @param columns    [{key, label, render?, className?, sortable?}]
   * @param rows       داده‌ها
   * @param opts       { page, pageSize, emptyText, footerInfo, centered? (۳٫۱۳ — وسط‌چین مقادیر) }
   */
  UI.renderTable = function (wrap, columns, rows, opts = {}) {
    const pageSize = opts.pageSize || RM.config.PAGE_SIZE;
    const page = opts.page || 1;
    const emptyText = opts.emptyText || 'داده‌ای برای نمایش وجود ندارد.';

    if (!rows.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          ${UI.icons.alert}
          <p>${emptyText}</p>
        </div>`;
      return { page: 1, pages: 0 };
    }

    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(page, pages);
    const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

    /* ۳٫۹ — تغییر ۶: پشتیبانی عرض ستون (c.width) در جدول‌های صفحه‌بندی‌شده
       (جزئیات رکورد/Drill-down) — colgroup + table-layout:fixed مانند
       filterTable؛ ستون بدون عرض = خودکار. */
    const hasWidths = columns.some((c) => c.width);
    const colgroup = hasWidths
      ? `<colgroup>${columns.map((c) => `<col${c.width ? ` style="width:${Number(c.width)}px"` : ''}>`).join('')}</colgroup>`
      : '';

    const thead = '<thead><tr>' +
      columns.map((c) => `<th${c.width ? ` style="width:${Number(c.width)}px;min-width:${Number(c.width)}px"` : ''}>${c.label}</th>`).join('') +
      '</tr></thead>';

    const tbody = '<tbody>' + slice.map((row) => {
      const cells = columns.map((c) => {
        const content = c.render ? c.render(row) : U.escapeHtml(row[c.key] ?? '—');
        return `<td class="${c.className || ''}">${content}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('') + '</tbody>';

    // نوار صفحه‌بندی (اگر بیش از یک صفحه)
    const pager = pages > 1
      ? `<div class="pager" role="navigation" aria-label="صفحه‌بندی جدول">
           <button type="button" class="btn btn-ghost btn-sm" data-page="1" ${safePage === 1 ? 'disabled' : ''}>ابتدا</button>
           <button type="button" class="btn btn-ghost btn-sm" data-page="${safePage - 1}" ${safePage === 1 ? 'disabled' : ''}>قبلی</button>
           <span class="pager-info">صفحهٔ ${U.faNum(safePage)} از ${U.faNum(pages)} — ${U.faNum(rows.length)} ردیف</span>
           <button type="button" class="btn btn-ghost btn-sm" data-page="${safePage + 1}" ${safePage === pages ? 'disabled' : ''}>بعدی</button>
           <button type="button" class="btn btn-ghost btn-sm" data-page="${pages}" ${safePage === pages ? 'disabled' : ''}>انتها</button>
         </div>`
      : (opts.footerInfo ? `<div class="pager"><span class="pager-info">${opts.footerInfo(rows.length)}</span></div>` : '');

    wrap.innerHTML = `
      <div class="table-wrap table-scroll">
        <table class="data-table${hasWidths ? ' fixed-cols' : ''}${opts.centered ? ' center-table' : ''}">${colgroup}${thead}${tbody}</table>
      </div>
      ${pager}`;

    // رویداد صفحه‌بندی
    wrap.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (opts.onPageChange) opts.onPageChange(nextPage);
      });
    });

    return { page: safePage, pages };
  };

  /* ---------------- کمک‌های اعتبارسنجی فرم (§69) ---------------- */

  /** نمایش/پاک‌سازی خطای یک فیلد: حاشیهٔ قرمز + پیام زیر فیلد + فوکوس */
  UI.setFieldError = function (input, errEl, message) {
    if (!input) return;
    input.classList.toggle('invalid', !!message);
    if (errEl) {
      errEl.textContent = message || '';
      errEl.hidden = !message;
    }
  };

  /** پاک‌کردن همهٔ خطاهای یک فرم */
  UI.clearFormErrors = function (form) {
    form.querySelectorAll('.field-error').forEach((el) => {
      el.textContent = '';
      el.hidden = true;
    });
    form.querySelectorAll('input.invalid, select.invalid').forEach((el) => {
      el.classList.remove('invalid');
    });
  };

  /* ---------------- ستون‌های جزئیات رکورد با نام Mapping‌شده ---------------- */

  /**
   * ساخت ستون‌های جدول جزئیات رکورد (گروه رول / Drill-down کیفیت / Import).
   * نام هر ستون از Mapping کاربر خوانده می‌شود (اگر Dataset وارد شده باشد
   * نام واقعی ستون اکسل؛ وگرنه برچسب منطقی فارسی).
   * @param {string} sourceKey   'rolls' | 'archived'
   * @param {Array|null} selectedKeys  ترتیب/انتخاب ستون‌ها (null → تنظیم ذخیره‌شده)
   */
  UI.rollDetailColumns = async function (sourceKey, selectedKeys) {
    const labels = await RM.normalize.effectiveColumnLabels(sourceKey);

    /* ۳٫۸: فیلدهای هر منبع فقط از نگاشت همان منبع — برای «سابقه رول‌ها
       (آرشیو)» فیلد cutWidth (عرض برش) وجود ندارد و پیش‌تر با برچسب تکراری
       «عرض» و مقدار همیشگی «—» نمایش داده می‌شد. */
    const sourceFields = new Set(Object.keys(RM.config.COLUMN_MAP[sourceKey] || {}));

    /* ۳٫۹ — تغییر ۶: عرض ستون‌های جزئیات از تنظیم ماندگار کاربر
       (appSettings: rollDetailColumnWidths — { فیلد: px }) خوانده می‌شود؛
       صفر/نامعتبر = عرض خودکار. */
    const widthMap = (await RM.db.getSetting('rollDetailColumnWidths', {})) || {};

    const RENDERERS = {
      rollNumber:     (r) => U.escapeHtml(r.rollNumber || '—'),
      actualLength:   (r) => r.actualLength === null ? '<span class="muted">—</span>' : U.faNum(r.actualLength),
      productionDate: (r) => U.escapeHtml(U.faDateTime(r.productionDate)),
      netWeight:      (r) => r.netWeight === null ? '<span class="muted">—</span>' : U.faNum(r.netWeight),
      grade:          (r) => U.escapeHtml(r.grade || '—'),
      status:         (r) => U.escapeHtml(r.status || '—'),
      width:          (r) => r.width === null ? '<span class="muted">—</span>' : U.faWidth(r.width),
      cutWidth:       (r) => r.cutWidth === null ? '<span class="muted">—</span>' : U.faWidth(r.cutWidth),
      thickness:      (r) => r.thickness === null ? '<span class="muted">—</span>' : U.faNum(r.thickness),
      setupNumber:    (r) => r.setupNumber === null ? '<span class="muted">—</span>' : U.faNum(r.setupNumber),
      filmType:       (r) => U.escapeHtml(r.filmType || '—'),
      palletNumber:   (r) => U.escapeHtml(r.palletNumber || '—'),
    };

    let order = selectedKeys;
    if (!order || !order.length) {
      order = await RM.db.getSetting('rollDetailColumns', RM.config.DETAIL_DEFAULT_COLUMNS);
    }

    return (order || [])
      .filter((k) => RENDERERS[k] && sourceFields.has(k))
      .map((k) => ({
        key: k,
        label: U.escapeHtml(labels[k] || RM.config.FIELD_LABELS[k] || k),
        className: k === 'rollNumber' || k === 'grade' ? 'ltr' : '',
        render: RENDERERS[k],
        /* ۳٫۹ — تغییر ۶: عرض ماندگار ستون (در صورت تعیین) به ستون وصل می‌شود */
        width: Number(widthMap[k]) > 0 ? Number(widthMap[k]) : undefined,
      }));
  };

  /* ---------------- پنل شخصی‌سازی ستون‌های جزئیات (مشترک — نسخهٔ ۳٫۴) ----------------
     همان سازوکار «ستون‌های جزئیات (انتخاب و ترتیب — ذخیره می‌شود)» که در
     مودال گروه‌های رول خام استفاده می‌شد، اکنون به‌صورت ابزار مشترک در
     همهٔ مودال‌های Drill-down رکورد رول (داشبورد «مشاهدهٔ رکوردها»،
     هشدارهای ورود داده‌ها، کارت رول‌های خام، جزئیات رول‌های برش‌خورده
     و گروه‌های خام) در دسترس است. انتخاب و ترتیب در appSettings
     (rollDetailColumns) ذخیره می‌شود و بین همهٔ مودال‌ها مشترک است. */

  /** تغییر ترتیب/انتخاب ستون‌های جزئیات — منطق مشترک (خالص، بدون ذخیره) */
  UI.applyDetailColumnsChange = function (current, key, action) {
    const next = [...current];
    const i = next.indexOf(key);

    if (action === 'on' && i === -1) {
      next.push(key);
    } else if (action === 'off' && i !== -1) {
      next.splice(i, 1);
    } else if (action === 'up' && i > 0) {
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
    } else if (action === 'down' && i !== -1 && i < next.length - 1) {
      [next[i + 1], next[i]] = [next[i], next[i + 1]];
    }

    if (!next.length) next = [...RM.config.DETAIL_DEFAULT_COLUMNS];   // حداقل یک ستون
    return next;
  };

  /**
   * سوارکردن پنل شخصی‌سازی ستون‌های جزئیات روی یک عنصر نگهدارنده.
   * @param {HTMLElement} mountEl   عنصر مقصد (innerHTML آن ساخته می‌شود)
   * @param {string}       sourceKey 'rolls' | 'archived' — نام ستون‌ها از Mapping
   * @param {Function}     onChange  پس از هر تغییر (ذخیره‌شده) فراخوانی می‌شود
   */
  UI.mountDetailColsPicker = async function (mountEl, sourceKey, onChange) {
    if (!mountEl) return;

    const labels = await RM.normalize.effectiveColumnLabels(sourceKey);
    /* ۳٫۸: چیپ‌های فیلدهای هر منبع فقط از نگاشت همان منبع — cutWidth برای
       آرشیو معنا ندارد (ستون «عرض» تکراری با مقدار «—»). فهرست ذخیره‌شدهٔ
       کاربر دست‌نخورده می‌ماند و فقط نمایش/رندر فیلتر می‌شود. */
    const sourceFields = new Set(Object.keys(RM.config.COLUMN_MAP[sourceKey] || {}));
    const selected = await RM.db.getSetting('rollDetailColumns', RM.config.DETAIL_DEFAULT_COLUMNS)
      || [...RM.config.DETAIL_DEFAULT_COLUMNS];
    const selectedSet = new Set(selected);

    /* ۳٫۹ — تغییر ۶: عرض ماندگار ستون‌های جزئیات — باکس px روی هر چیپ روشن */
    const widthMap = (await RM.db.getSetting('rollDetailColumnWidths', {})) || {};

    // حفظ وضعیت باز/بستهٔ آکاردئون در رندرهای مجدد
    const prevDetails = mountEl.querySelector('details.detail-cols-picker');
    const prevOpen = !!(prevDetails && prevDetails.open);

    const chip = (k, on) => {
      const label = U.escapeHtml(labels[k] || RM.config.FIELD_LABELS[k] || k);
      const w = Number(widthMap[k]) > 0 ? Number(widthMap[k]) : '';
      return on
        ? `<span class="detail-chip on">
             <button type="button" data-col-up="${k}" title="انتقال به قبل" aria-label="انتقال به قبل">↑</button>
             <button type="button" data-col-down="${k}" title="انتقال به بعد" aria-label="انتقال به بعد">↓</button>
             <b>${label}</b>
             <label class="detail-width" title="عرض این ستون در جدول (پیکسل) — صفر یا خالی = خودکار">
               <input type="number" class="detail-width-input" data-col-width="${k}"
                      min="0" max="1200" step="1" inputmode="numeric"
                      aria-label="عرض ستون ${label}" value="${w}" placeholder="px">
             </label>
             <button type="button" data-col-off="${k}" title="حذف ستون" aria-label="حذف ستون">×</button>
           </span>`
        : `<span class="detail-chip">
             <button type="button" data-col-on="${k}" title="افزودن ستون" aria-label="افزودن ستون">+ ${label}</button>
           </span>`;
    };

    mountEl.innerHTML =
      `<details class="detail-cols-picker"${prevOpen ? ' open' : ''}>
         <summary>ستون‌های جزئیات (انتخاب و ترتیب — ذخیره می‌شود)</summary>
         <div class="detail-chips">
           ${selected.filter((k) => sourceFields.has(k)).map((k) => chip(k, true)).join('')}
           ${RM.config.DETAIL_FIELDS.filter((k) => sourceFields.has(k) && !selectedSet.has(k)).map((k) => chip(k, false)).join('')}
         </div>
       </details>`;

    // اعمال تغییر + ذخیرهٔ ماندگار + اطلاع به صداکننده
    const apply = async (key, action) => {
      const next = UI.applyDetailColumnsChange(selected, key, action);
      await RM.db.setSetting('rollDetailColumns', next);
      if (onChange) await onChange();
    };

    mountEl.querySelectorAll('[data-col-on]').forEach((btn) =>
      btn.addEventListener('click', () => apply(btn.dataset.colOn, 'on')));
    mountEl.querySelectorAll('[data-col-off]').forEach((btn) =>
      btn.addEventListener('click', () => apply(btn.dataset.colOff, 'off')));
    mountEl.querySelectorAll('[data-col-up]').forEach((btn) =>
      btn.addEventListener('click', () => apply(btn.dataset.colUp, 'up')));
    mountEl.querySelectorAll('[data-col-down]').forEach((btn) =>
      btn.addEventListener('click', () => apply(btn.dataset.colDown, 'down')));

    /* ۳٫۹ — تغییر ۶: باکس عرض هر ستون (px) — debounce؛ خالی/۰ = خودکار.
       مقدار در appSettings (rollDetailColumnWidths) ذخیره و جدول مودال با
       onChange با عرض‌های جدید بازسازی می‌شود (چیپ‌ها هم درجا دوباره ساخته
       می‌شوند — پس از مکث تایپ، بدون از دست دادن فوکوس فعال). */
    let widthTimer = null;
    mountEl.querySelectorAll('[data-col-width]').forEach((inp) => {
      inp.addEventListener('input', () => {
        clearTimeout(widthTimer);
        const key = inp.dataset.colWidth;
        widthTimer = setTimeout(async () => {
          const v = U.parseInt(inp.value);
          const px = v === null ? 0 : Math.min(Math.max(v, 0), 1200);
          const next = { ...((await RM.db.getSetting('rollDetailColumnWidths', {})) || {}) };
          if (px > 0) next[key] = px;
          else delete next[key];
          await RM.db.setSetting('rollDetailColumnWidths', next);
          if (onChange) await onChange();
        }, 340);
      });
    });
  };

  /* ---------------- مودال مشترک Drill-down رکوردها (§8/§9 اصلاحات) ---------------- */

  /**
   * نمایش رکوردهای عامل یک هشدار/مشکل در جدولی با ستون‌های Mapping‌شده.
   * مسیر کاربر: Summary → مشکل → رکوردهای عامل مشکل.
   * همهٔ رکوردها از طریق صفحه‌بندی قابل مشاهده‌اند (دکمه‌های ابتدا/قبلی/بعدی/انتها).
   * @param {string} title        عنوان مودال
   * @param {Array}  records      رکوردهای نرمال‌شدهٔ مدل داخلی
   * @param {object} opts         { source, subtitle }
   */
  UI.recordsDrillModal = async function (title, records, opts = {}) {
    const sourceKey = opts.source || 'rolls';

    /* ۳٫۹ — تغییر ۶: مودال عریض — جدول‌های دارای پنل «ستون‌های جزئیات»
       فضای بیشتری برای نمایش ستون‌های بیشتر دارند. */
    UI.infoModal(title, `
      <div class="drill-subtitle">
        ${opts.subtitle ? U.escapeHtml(opts.subtitle) : ''}
        <b>${U.faNum(records.length)}</b> رکورد
      </div>
      <div id="drill-cols-picker"></div>
      <div id="drill-table-wrap"></div>
    `, { wide: true });

    // رندر جدول با ستون‌های جاری (نسخهٔ ۳٫۴ — پس از هر تغییر پنل شخصی‌سازی دوباره صدا می‌شود)
    const renderTable = async () => {
      const columns = await UI.rollDetailColumns(sourceKey);
      const renderPage = (page) => {
        UI.renderTable(document.getElementById('drill-table-wrap'), columns, records, {
          page,
          pageSize: RM.config.PAGE_SIZE,
          emptyText: 'رکوردی برای نمایش یافت نشد.',
          onPageChange: (nextPage) => renderPage(nextPage),
        });
      };
      renderPage(1);
    };

    // پنل شخصی‌سازی ستون‌های جزئیات (نسخهٔ ۳٫۴) — مشترک با مودال گروه‌های خام؛
    // پس از هر تغییر، چیپ‌های پنل و جدول هر دو درجا بازسازی می‌شوند (مودال باز می‌ماند)
    const mountPicker = async () => {
      await UI.mountDetailColsPicker(
        document.getElementById('drill-cols-picker'),
        sourceKey,
        async () => {
          await mountPicker();
          await renderTable();
        }
      );
    };

    await mountPicker();
    await renderTable();
  };

  /* ---------------- پنل مرتب‌سازی مشترک (چیپ‌های کشیدنی — §36-§38) ---------------- */

  /**
   * رندر «پنل مرتب‌سازی» — چیپ‌های مراحل مرتب‌سازی با کشیدن‌ورها،
   * تغییر جهت و حذف. مولفهٔ مشترک رول‌های خام و گزارش ستاپ‌ها.
   * @param {HTMLElement} wrap       عنصر نگهدارندهٔ چیپ‌ها
   * @param {Array}        pipeline  [{field, direction}]
   * @param {object}       fields    رجیستری فیلدها ({label})
   * @param {object}       handlers  { onDir(i), onRemove(i), onReorder(from, to), emptyText? }
   */
  UI.sortPanel = function (wrap, pipeline, fields, handlers) {
    wrap.innerHTML = pipeline.map((step, i) => {
      const meta = fields[step.field] || { label: step.field };
      return `
        <div class="sort-chip" draggable="true" data-index="${i}" title="برای تغییر اولویت بکشید">
          <span class="grip">${UI.icons.grip}</span>
          <span class="sort-priority">${U.faNum(i + 1)}</span>
          <span class="sort-label">${U.escapeHtml(meta.label)}</span>
          <button type="button" class="sort-dir ${step.direction}" data-dir="${i}"
                  aria-label="تغییر جهت مرتب‌سازی" title="تغییر جهت">
            ${step.direction === 'asc' ? '↑' : '↓'}
          </button>
          <button type="button" class="sort-remove" data-remove="${i}"
                  aria-label="حذف از مرتب‌سازی" title="حذف">${UI.icons.cross}</button>
        </div>`;
    }).join('') ||
      `<span class="muted" style="font-size:.78rem">${U.escapeHtml(handlers.emptyText || 'مرتب‌سازی پیش‌فرض')}</span>`;

    // تغییر جهت
    wrap.querySelectorAll('[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => handlers.onDir(Number(btn.dataset.dir)));
    });

    // حذف مرحله
    wrap.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => handlers.onRemove(Number(btn.dataset.remove)));
    });

    // ---------- کشیدن و رها کردن برای تغییر ترتیب (§37) ----------
    let dragSrcIndex = null;

    wrap.querySelectorAll('.sort-chip').forEach((chip) => {
      chip.addEventListener('dragstart', (e) => {
        dragSrcIndex = Number(chip.dataset.index);
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragSrcIndex));
      });

      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        wrap.querySelectorAll('.sort-chip').forEach((c) => c.classList.remove('drag-over'));
        dragSrcIndex = null;
      });

      chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!chip.classList.contains('drag-over')) chip.classList.add('drag-over');
      });

      chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));

      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = dragSrcIndex;
        const to = Number(chip.dataset.index);
        if (from === null || from === to) return;
        handlers.onReorder(from, to);
      });
    });
  };

  /* ---------------- جدول بلند با فیلتر زیر سرستون‌ها (مشترک ۳ جدول) ---------------- */

  /**
   * نرمال‌سازی متن جست‌وجو — ارقام فارسی/عربی → لاتین + حذف جداکننده‌های
   * هزارگان و فاصله‌ها. هم روی «مقدار جست‌وجو» و هم روی «متن سلول» اعمال
   * می‌شود تا «۸» با 8 و «۲۳» با 23 هم‌ارزش شود.
   */
  UI.filterNormalize = function (text) {
    return U.toLatinDigits(String(text ?? ''))
      .replace(/[,\u066C\u2019\u066B\s]/g, '')
      .trim()
      .toLowerCase();
  };

  /**
   * منطق تطبیق «شامل بودن» (نسخهٔ ۲٫۳):
   *   - عدد و متن هر دو با «شامل بودن» فیلتر می‌شوند (نه تطابق دقیق)
   *   - invert = true → برعکس: «شامل نشود»
   * @param {string[]} tokens   متن‌های قابل‌جست‌وجوی سلول (نمایش + مقدار خام)
   * @param {string}   value    مقدار واردشده در باکس فیلتر
   * @param {boolean}  invert   منطق برعکس فعال است؟
   */
  UI.filterContains = function (tokens, value, invert) {
    const needle = UI.filterNormalize(value);
    if (needle === '') return true;      // فیلتر خالی → همه
    const hay = (tokens || [])
      .map((t) => UI.filterNormalize(t))
      .filter(Boolean)
      .join(' ');
    const contains = hay.includes(needle);
    return invert ? !contains : contains;
  };

  /** خواندن/ساخت وضعیت فیلتر یک ستون ({ value, invert }) از state */
  UI.filterStateOf = function (state, key) {
    if (!state.filters[key] || typeof state.filters[key] !== 'object') {
      state.filters[key] = { value: '', invert: false };
    }
    return state.filters[key];
  };

  /** آیکون «≠» دکمهٔ برعکس‌کردن منطق فیلتر */
  UI.icons.notContains = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.8" y1="18.2" x2="18.2" y2="5.8"/></svg>';

  /* قیف + ضربدر — دکمهٔ جمع‌وجور «پاک‌کردن همهٔ فیلترها» بالای جدول‌ها (نسخهٔ ۳٫۰ — تغییر ۵) */
  UI.icons.filterX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.013 3H4.887a2 2 0 0 0-1.771 2.936L7.5 12v6a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-6l4.384-6.064A2 2 0 0 0 15.113 3z"/><path d="m16 16 5 5"/><path d="m21 16-5 5"/></svg>';

  /**
   * جدول بلند (حداقل ۵۰ رکورد) + فیلتر پیشرفتهٔ زیر سرستون‌ها — مولفهٔ
   * مشترک جدول‌های «رول‌های برش‌خورده»، «رول‌های خام» و «گزارش ستاپ‌ها».
   *
   * منطق نسخهٔ ۲٫۳:
   *   - فیلتر همهٔ ستون‌ها (عدد و متن) با «شامل بودن» + ارقام فارسی/لاتین
   *   - دکمهٔ کوچک «≠» کنار هر باکس → سوییچ «شامل نشود»
   *   - فوکوس باکس فیلتر حفظ می‌شود (فقط tbody دوباره رندر می‌شود،
   *     سرستون/باکس‌ها بازسازی نمی‌شوند و فوکوس جابه‌جا نمی‌شود)
   *   - سرستون + ردیف فیلتر چسبان هنگام اسکرول عمودی
   *
   * منطق نسخهٔ ۲٫۴:
   *   - باکس «ردیف‌های قابل نمایش» در نوار پایین → ارتفاع جدول داینامیک
   *     (فقط استایل ارتفاع به‌روز می‌شود؛ جدول/فیلترها/فوکوس دست‌نخورده)
   *   - پشتیبانی عرض ستون (c.width → colgroup با table-layout:fixed)
   *
   * منطق نسخهٔ ۲٫۵:
   *   - Wrap Text هدرها: عنوان ستون‌ها با توجه به عرض ستون چندخط می‌شود؛
   *     ارتفاع ردیف سرستون اندازه‌گیری و در متغیر --ft-head-h ثبت می‌شود تا
   *     ردیف فیلتر چسبان دقیقاً زیر آن بنشیند (ResizeObserver → هم‌گام با تغییر عرض)
   *   - چیدمان باکس فیلتر: آیکون «≠» کوچک در سمت راست + باکس فیلتر در ادامه
   *     که عرضش با عرض ستون تنظیم می‌شود (min-width: 0 → هرگز ناقص نمی‌شود)
   *
   * منطق نسخهٔ ۳٫۳۰:
   *   - چیدمان جدید باکس فیلتر: باکس فیلتر «تمام‌عرض ستون» شد و دکمهٔ «≠»
   *     دیگر کنار باکس (جاگیر در عرض ستون) نیست — به‌صورت یک تاگل ریز «زیر
   *     باکس و سمت راست» نشسته است؛ غیرفعال = فقط آیکون کم‌رنگ، فعال = چیپ
   *     کهربایی جمع‌وجور با برچسب «شامل نشود» (وضعیت فیلتر همیشه بدیهی).
   *
   * منطق نسخهٔ ۲٫۶:
   *   - باکس‌های جمع (opts.sums): زیر ستون‌های عددی/زمانی، ردیف پایانی چسبان
   *     (tfoot) با جمع همان ستون — جمع همیشه با دیتای «فیلترشدهٔ» فعلی
   *     محاسبه می‌شود و با هر فیلتر/تغییر، به‌روز می‌شود.
   *
   * منطق جدید (لیست‌های بزرگ — تغییر ۳):
   *   - opts.maxDomRows: فیلترها روی «همهٔ» رکوردها اعمال می‌شوند اما فقط
   *     حداکثر N ردیف اولِ فیلترشده در DOM رندر می‌شوند (پاسخ‌گویی با دیتای
   *     چند هزار ردیفی) — وضعیت/جمع‌ها همیشه از کل دیتای فیلترشده محاسبه می‌شوند.
   *
   * @param {HTMLElement} wrap     نگهدارندهٔ جدول
   * @param {Array}  columns       [{key, label, render(row)→html, tokens(row)→string[],
   *                                className?, filterable? (پیش‌فرض true), width? (px — نسخهٔ ۲٫۴)}]
   * @param {Array}  rows          همهٔ رکوردها (مرتب‌شده توسط فراخوان)
   * @param {object} opts          { state: {filters:{}, visibleRows?} (ماندگار بین رندرها),
   *                                visibleRows, rowHeight, tableClass, emptyText,
   *                                filteredEmptyText, footerNote, rowsControl? (bool — باکس تعداد ردیف),
   *                                onRowsChange?(n) (ذخیرهٔ ماندگار),
   *                                fixedCols? (bool — table-layout:fixed برای عرض‌های ستون),
   *                                sums? ({ colKey: {type:'number'|'time'|'pair',
   *                                        weightOf?(row,key)→number } }) — نسخهٔ ۲٫۶,
   *                                sumsSkip? (row→boolean — ۳٫۳۲: ردیف‌های منطبق از همهٔ
   *                                        جمع‌ها و شمارندهٔ «بدون قانون» حذف می‌شوند؛
   *                                        مثل رکوردهای «منقضی شده»ٔ گزارش ستاپ‌ها),
   *                                maxDomRows? (number — سقف رندر DOM، فیلتر روی کل)،
   *                                onRendered(visibleRows),
   *                                tools? (آرایهٔ [{id,label,title,pressed}] — دکمه‌های ابزار
   *                                        «ترتیب ستون‌ها»/«مرتب‌سازی» در نوار بالای جدول — ۳٫۹ تغییر ۵)،
   *                                onToolToggle?(id, pressed, btnEl) — کلیک دکمهٔ ابزار,
   *                                leftBarHtml? (۳٫۳۱ — HTML نوار سمت چپِ بالای جدول، کنار آمار
   *                                        رکوردها؛ برای دکمه‌های عملیات گروهی نما مثل انتخاب‌ها),
   *                                onLeftBarMount?(wrap) (۳٫۳۱ — بایند رویدادهای همان نوار پس از ساخت) }
   */
  UI.filterTable = function (wrap, columns, rows, opts = {}) {
    if (!wrap) return;
    const state = opts.state || { filters: {} };
    state.filters = state.filters || {};
    // تعداد ردیف قابل نمایش (نسخهٔ ۲٫۴): اولویت با state کاربر (ماندگار)، بعد opts
    if (!Number.isFinite(Number(state.visibleRows)) || Number(state.visibleRows) <= 0) {
      state.visibleRows = opts.visibleRows || 50;
    }
    const rowHeight = opts.rowHeight || 42;
    const tableClass = opts.tableClass || 'cut-table';
    const filterableCols = columns.filter((c) => c.filterable !== false);

    /* ---------- تطبیق یک رکورد با همهٔ فیلترهای فعال ---------- */
    const rowMatches = (row) => filterableCols.every((c) => {
      const f = UI.filterStateOf(state, c.key);
      if (String(f.value ?? '').trim() === '') return true;
      return UI.filterContains(c.tokens ? c.tokens(row) : [String(row[c.key] ?? '')], f.value, f.invert);
    });

    /* ---------- ساخت سرستون + ردیف فیلتر (یک‌بار در هر رندر کامل) ---------- */
    const headRow = columns.map((c) => `<th${c.headerTitle ? ` title="${U.escapeHtml(c.headerTitle)}"` : ''}${c.width ? ` style="width:${Number(c.width)}px;min-width:${Number(c.width)}px"` : ''}>${c.label}</th>`).join('');
    const filterRow = columns.map((c) => {
      if (c.filterable === false) return '<th class="cut-filter-cell"></th>';
      const f = UI.filterStateOf(state, c.key);
      return `
      <th class="cut-filter-cell" aria-label="فیلتر ${U.escapeHtml(String(c.label))}">
        <div class="ft-filter-box">
          <input type="text" class="cut-filter-input" data-ft-filter="${U.escapeHtml(c.key)}"
                 value="${U.escapeHtml(f.value ?? '')}"
                 autocomplete="off" placeholder="فیلتر…" inputmode="text"
                 aria-label="فیلتر ستون ${U.escapeHtml(String(c.label))}">
          <button type="button" class="ft-invert${f.invert ? ' on' : ''}" data-ft-invert="${U.escapeHtml(c.key)}"
                  aria-pressed="${String(!!f.invert)}"
                  title="${f.invert ? 'منطق فعلی: شامل نشود — برای بازگشت به «شامل بودن» کلیک کنید' : 'برعکس‌کردن منطق: شامل نشود'}"
                  aria-label="برعکس‌کردن منطق فیلتر ستون ${U.escapeHtml(String(c.label))}">
            ${UI.icons.notContains}<span class="ft-invert-label">شامل نشود</span>
          </button>
        </div>
      </th>`;
    }).join('');

    /* ---------- باکس‌های جمع زیر ستون‌ها (نسخهٔ ۲٫۶) ----------
       opts.sums = { colKey: { type: 'number' | 'time' | 'pair',
                               weightOf?: (row, key) => number|null } }
       جمع همیشه از دیتای فیلترشدهٔ فعلی (visible) محاسبه می‌شود.
       ۳٫۳۲ — opts.sumsSkip?: (row) => boolean: ردیف‌های منطبق از «همهٔ»
       جمع‌ها (و از شمارندهٔ «بدون قانون» ستون‌های زمانی) حذف می‌شوند —
       مثلاً رکوردهای «منقضی شده»ٔ گزارش ستاپ‌ها که کلاً وجود ندارند. */
    const sumSpecs = opts.sums || null;
    const hasSums = !!(sumSpecs && Object.keys(sumSpecs).length);
    const sumSkipOf = typeof opts.sumsSkip === 'function' ? opts.sumsSkip : null;

    /** ساخت HTML یک باکس جمع بر اساس نوع ستون
        (نسخهٔ ۳٫۱ — تغییر ۴: علامت Σ حذف شد — جاگیر بود و نمای خوبی نداشت) */
    const sumBoxHtml = (spec, cnt, wt, skipped) => {
      if (spec.type === 'pair') {
        return `<span class="ft-sum-pair">
            <b class="ft-sum-val">${U.faNum(cnt)}</b>
            <span class="ft-sum-wgt">${U.faWeightDot(wt)}</span>
          </span>`;
      }
      const val = spec.type === 'time' ? U.faHMM(cnt) : U.faNum(cnt);
      return `<b class="ft-sum-val${spec.type === 'time' ? ' ft-sum-time' : ''}">${val}</b>`
        + (skipped ? `<sup class="ft-sum-skip" title="${U.faNum(skipped)} رکورد بدون قانون در جمع لحاظ نشد">*</sup>` : '');
    };

    /** به‌روزرسانی همهٔ باکس‌های جمع از ردیف‌های فیلترشده */
    const updateSums = (visible) => {
      if (!hasSums) return;
      /* ۳٫۳۲ — ردیف‌های «رد‌شده» (مثل منقضی‌شده‌ها) در هیچ جمعی نیستند */
      const sumRows = sumSkipOf ? visible.filter((row) => !sumSkipOf(row)) : visible;
      for (const c of columns) {
        const spec = sumSpecs[c.key];
        if (!spec) continue;
        const box = wrap.querySelector(`[data-ft-sum-box="${c.key}"]`);
        if (!box) continue;

        if (spec.type === 'pair') {
          let cnt = 0, wt = 0;
          for (const row of sumRows) {
            const v = Number(row[c.key]);
            if (Number.isFinite(v)) cnt += v;
            const w = spec.weightOf ? Number(spec.weightOf(row, c.key)) : NaN;
            if (Number.isFinite(w)) wt += w;
          }
          box.innerHTML = sumBoxHtml(spec, cnt, wt, 0);
          box.parentElement.title =
            `جمع ستون «${String(c.label)}» با دیتای فیلترشده — ردیف اول: جمع تعداد · ردیف دوم: جمع وزن`;
          continue;
        }

        let total = 0, counted = 0;
        for (const row of sumRows) {
          const v = row[c.key];
          if (v === null || v === undefined || v === '') continue;   // «بدون قانون» و تهی‌ها
          const n = Number(v);
          if (Number.isFinite(n)) { total += n; counted++; }
        }
        const skipped = spec.type === 'time' ? (sumRows.length - counted) : 0;
        box.innerHTML = sumBoxHtml(spec, total, 0, skipped);
        box.parentElement.title = `جمع ستون «${String(c.label)}» — با دیتای فیلترشدهٔ فعلی`
          + (spec.type === 'time' ? ` (${U.faNum(counted)} رکورد دارای قانون)` : '');
      }
    };

    /* ---------- رندر بدنه (ایزوله — سرستون دست‌نخورده می‌ماند) ---------- */
    /* سقف رندر DOM (تغییر ۳ — لیست‌های بزرگ): فیلتر روی «همهٔ» رکوردها اعمال
       می‌شود؛ فقط رندر tbody سقف دارد. وضعیت/جمع‌ها از کل فیلترشده می‌آیند. */
    const maxDom = Number(opts.maxDomRows) > 0 ? Number(opts.maxDomRows) : Infinity;

    /* ۳٫۱۷ (بسته‌بندی بند ۶): کلاس سفارشی هر ردیف — opts.rowClass(row)
       رشتهٔ کلاس CSS برمی‌گرداند (مثلاً هایلایت بسته‌های ترکیبی U+X) */
    const rowClassOf = typeof opts.rowClass === 'function' ? opts.rowClass : null;

    const renderBody = () => {
      const visible = rows.filter(rowMatches);
      const domRows = visible.length > maxDom ? visible.slice(0, maxDom) : visible;
      const tbody = wrap.querySelector('.ft-tbody');
      const statusEl = wrap.querySelector('.ft-status');
      if (!tbody) return visible;

      const activeCount = filterableCols.filter((c) =>
        String(UI.filterStateOf(state, c.key).value ?? '').trim() !== '').length;

      tbody.innerHTML = visible.length
        ? domRows.map((row) => {
            const cells = columns.map((c) => {
              const content = c.render ? c.render(row) : U.escapeHtml(row[c.key] ?? '—');
              return `<td class="${c.className || ''}">${content}</td>`;
            }).join('');
            const rowCls = rowClassOf ? String(rowClassOf(row) || '') : '';
            return `<tr${rowCls ? ` class="${U.escapeHtml(rowCls)}"` : ''}>${cells}</tr>`;
          }).join('')
        : `<tr><td colspan="${columns.length}" class="muted" style="text-align:center;padding:18px">${
            rows.length
              ? (opts.filteredEmptyText || 'هیچ رکوردی با فیلترهای فعلی مطابقت ندارد — فیلترها را پاک کنید.')
              : (opts.emptyText || 'داده‌ای برای نمایش وجود ندارد.')
          }</td></tr>`;

      if (statusEl) {
        statusEl.innerHTML = activeCount
          ? `<span class="chip chip-strong">${U.faNum(visible.length)} از ${U.faNum(rows.length)} رکورد (فیلترشده)</span>` +
            (domRows.length < visible.length
              ? ` <span class="chip" title="برای پاسخ‌گویی فقط ${U.faNum(domRows.length)} ردیف اولِ فیلترشده رندر شده — با فیلتر دقیق‌تر رکوردهای دلخواه را ببینید">نمایش ${U.faNum(domRows.length)} ردیف</span>`
              : '')
          : `<span class="chip">${U.faNum(rows.length)} رکورد</span>` +
            (domRows.length < visible.length ? ` <span class="chip">نمایش ${U.faNum(domRows.length)} ردیف اول</span>` : '');
      }

      /* دکمهٔ جمع‌وجور «پاک‌کردن همهٔ فیلترها» بالای جدول (نسخهٔ ۳٫۰ — تغییر ۵):
         شمارندهٔ فیلترهای فعال + غیرفعال‌شدن وقتی فعالی نیست. */
      const topClearBtn = wrap.querySelector('[data-ft-clear-top]');
      if (topClearBtn) {
        topClearBtn.disabled = activeCount === 0;
        const cntEl = topClearBtn.querySelector('[data-ft-clear-count]');
        if (cntEl) {
          cntEl.textContent = U.faNum(activeCount);
          cntEl.hidden = activeCount === 0;
        }
      }

      updateSums(visible);     // نسخهٔ ۲٫۶: جمع‌ها با دیتای فیلترشده به‌روز می‌شوند

      if (typeof opts.onRendered === 'function') opts.onRendered(visible, rows);
      return visible;
    };

    /* ---------- اسکلت جدول (یک‌بار) ---------- */
    if (!rows.length && !Object.values(state.filters).some((f) => f && String(f.value ?? '').trim() !== '')) {
      wrap.innerHTML = `
        <div class="empty-state">
          ${UI.icons.alert}
          <h4>رکوردی برای نمایش وجود ندارد</h4>
          <p>${opts.emptyText || 'داده‌ای برای نمایش وجود ندارد.'}</p>
        </div>`;
      if (typeof opts.onRendered === 'function') opts.onRendered([], rows);
      return;
    }

    const applyHeight = (scrollEl, n) => {
      scrollEl.style.height = `calc(${n} * ${rowHeight}px)`;
      scrollEl.style.maxHeight = `calc(${n} * ${rowHeight}px)`;
    };

    // colgroup عرض ستون‌ها (نسخهٔ ۲٫۴) + جدول fixed-cols در صورت وجود عرض
    const hasWidths = columns.some((c) => c.width);
    const colgroup = hasWidths
      ? `<colgroup>${columns.map((c) => `<col${c.width ? ` style="width:${Number(c.width)}px"` : ''}>`).join('')}</colgroup>`
      : '';

    const heightStyle = `height: calc(${state.visibleRows} * ${rowHeight}px); max-height: calc(${state.visibleRows} * ${rowHeight}px);`;
    /* ردیف جمع چسبان زیر جدول (نسخهٔ ۲٫۶) — sticky bottom، هم‌عرض ستون‌ها؛
       مقدار هر باکس در renderBody/updateSums با دیتای فیلترشده پر می‌شود. */
    const sumFoot = hasSums
      ? `<tfoot class="ft-sum-row"><tr>${columns.map((c) => {
          if (!sumSpecs[c.key]) return '<td class="ft-sum-cell"></td>';
          return `<td class="ft-sum-cell">
            <div class="ft-sum-box" data-ft-sum-box="${c.key}"><span class="muted">…</span></div>
          </td>`;
        }).join('')}</tr></tfoot>`
      : '';

    /* ---------- دکمه‌های ابزار جدول (۳٫۹ — تغییر ۵) ----------
       «ترتیب ستون‌ها» / «مرتب‌سازی» از سرتیتر پنل به نوار بالای جدول منتقل
       شدند — کنار دکمهٔ «پاک‌کردن همهٔ فیلترها»، هم‌قد و هم‌فونت با آن.
       دکمه‌ها داخل wrap رندر می‌شوند (بازسازی در هر رندر کامل)؛ وضعیت فشرده
       از state هر نما می‌آید و کلیک از طریق onToolToggle به نما برمی‌گردد. */
    const tools = Array.isArray(opts.tools) ? opts.tools.filter(Boolean) : [];
    const toolsHtml = tools.map((t) => `
      <button type="button" class="btn btn-ghost ft-tool${t.pressed ? ' panel-on' : ''}" id="${U.escapeHtml(String(t.id || ''))}"
              aria-pressed="${String(!!t.pressed)}" aria-expanded="${String(!!t.pressed)}"
              title="${U.escapeHtml(String(t.title || t.label || ''))}">
        ${U.escapeHtml(String(t.label || ''))}
      </button>`).join('');

    wrap.innerHTML = `
      <div class="ft-topbar">
        <div class="ft-topbar-actions">
          <button type="button" class="btn btn-ghost btn-sm ft-clear-top" data-ft-clear-top
                  title="پاک‌کردن همهٔ فیلترهای اعمال‌شدهٔ این جدول (متن فیلترها + منطق «شامل نشود»)"
                  aria-label="پاک‌کردن همهٔ فیلترهای این جدول">
            ${UI.icons.filterX}
            <span>پاک‌کردن همهٔ فیلترها</span>
            <span class="ft-clear-count" data-ft-clear-count hidden></span>
          </button>
          ${toolsHtml}
        </div>
        <!-- ۳٫۹ — تغییر ۷: آمار رکوردهای فیلترشده از پایین جدول به بالای آن
             (سمت چپ) منتقل شد تا همیشه در دید کاربر باشد.
             ۳٫۳۱ — نوار سمت چپ: دکمه‌های عملیات گروهی نما (مثل «حذف/انقضاء/
             لغو انتخاب شده‌ها»ی جدول ستاپ‌ها) کنار همین آمار قرار می‌گیرند —
             html از opts.leftBarHtml و بایند رویدادها با opts.onLeftBarMount. -->
        <div class="ft-topbar-side">
          ${opts.leftBarHtml ? `<div class="ft-bulk-bar">${opts.leftBarHtml}</div>` : ''}
          <span class="ft-status" aria-live="polite"></span>
        </div>
      </div>
      <div class="cut-table-scroll" style="${heightStyle}">
        <table class="data-table ${tableClass}${hasWidths ? ' fixed-cols' : ''}">
          ${colgroup}
          <thead>
            <tr class="cut-head-row">${headRow}</tr>
            <tr class="cut-filter-row">${filterRow}</tr>
          </thead>
          <tbody class="ft-tbody"></tbody>
          ${sumFoot}
        </table>
      </div>
      <div class="cut-filter-bar">
        <span class="muted" style="font-size:.7rem">${opts.footerNote || 'فیلتر هر ستون در زیر سرستون همان ستون · منطق: شامل بودن (عدد و متن)'}</span>
        ${opts.rowsControl === false ? '' : `
        <label class="ft-rows" title="تعداد ردیف قابل نمایش قبل از اسکرول — ارتفاع جدول طبق این عدد تغییر می‌کند">
          <span>ردیف‌های قابل نمایش:</span>
          <input type="number" class="ft-rows-input" data-ft-rows min="${RM.config.VISIBLE_ROWS_MIN}" max="${RM.config.VISIBLE_ROWS_MAX}" step="1" value="${state.visibleRows}" inputmode="numeric" aria-label="تعداد ردیف قابل نمایش">
        </label>`}
      </div>`;

    /* ---------- ارتفاع داینامیک سرستون (Wrap Text — نسخهٔ ۲٫۵) ----------
       عنوان ستون‌ها ممکن است با عرض کم ستون چندخط شود؛ ارتفاع واقعی ردیف
       سرستون اندازه‌گیری و در متغیر CSS --ft-head-h ثبت می‌شود تا ردیف فیلتر
       چسبان دقیقاً زیر آن بنشیند. ResizeObserver تغییر عرض (پنل عرض ستون‌ها /
       تغییر اندازهٔ پنجره) را دنبال می‌کند و مقدار را هم‌گام نگه می‌دارد. */
    const syncHeadHeight = () => {
      const headTr = wrap.querySelector('.cut-head-row');
      if (!headTr) return;
      const h = headTr.offsetHeight;
      if (h > 0) wrap.style.setProperty('--ft-head-h', `${h}px`);
    };
    syncHeadHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const headTr = wrap.querySelector('.cut-head-row');
      if (wrap._ftHeadRO) { try { wrap._ftHeadRO.disconnect(); } catch (e) { /* noop */ } }
      if (headTr) {
        wrap._ftHeadRO = new ResizeObserver(syncHeadHeight);
        wrap._ftHeadRO.observe(headTr);
      }
    }

    /* ---------- رویدادها ---------- */

    // ورود متن فیلتر → فقط tbody دوباره رندر می‌شود (فوکوس و caret حفظ می‌شود)
    let timer = null;
    wrap.querySelectorAll('[data-ft-filter]').forEach((el) => {
      el.addEventListener('input', () => {
        const f = UI.filterStateOf(state, el.dataset.ftFilter);
        f.value = el.value;
        clearTimeout(timer);
        timer = setTimeout(renderBody, 180);
      });
    });

    // دکمهٔ کوچک «≠» → سوییچ منطق شامل‌بودن/شامل‌نشدن
    wrap.querySelectorAll('[data-ft-invert]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = UI.filterStateOf(state, btn.dataset.ftInvert);
        f.invert = !f.invert;
        btn.classList.toggle('on', f.invert);
        btn.setAttribute('aria-pressed', String(f.invert));
        btn.title = f.invert
          ? 'منطق فعلی: شامل نشود — برای بازگشت به «شامل بودن» کلیک کنید'
          : 'برعکس‌کردن منطق: شامل نشود';
        renderBody();
      });
    });

    // پاک‌کردن همهٔ فیلترها — مشترک بین دکمهٔ بالای جدول (۳٫۰) و دکمهٔ نوار پایین
    const clearAllFilters = () => {
      for (const c of filterableCols) {
        const f = UI.filterStateOf(state, c.key);
        f.value = '';
        f.invert = false;
      }
      wrap.querySelectorAll('[data-ft-filter]').forEach((el) => { el.value = ''; });
      wrap.querySelectorAll('[data-ft-invert]').forEach((b) => {
        b.classList.remove('on');
        b.setAttribute('aria-pressed', 'false');
        b.title = 'برعکس‌کردن منطق: شامل نشود';
      });
      renderBody();
      UI.toast('همهٔ فیلترهای این جدول پاک شد.', 'info');
    };
    const topClear = wrap.querySelector('[data-ft-clear-top]');
    if (topClear) topClear.addEventListener('click', clearAllFilters);

    // دکمه‌های ابزار (۳٫۹ — تغییر ۵): تاگل پنل‌ها — کلاس/آریا همین‌جا فلیپ می‌شود
    // و منطق (فلیپ state + ذخیره + نمایش/مخفی پنل) به onToolToggle نما واگذار می‌گردد.
    if (tools.length && typeof opts.onToolToggle === 'function') {
      wrap.querySelectorAll('.ft-tool').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pressed = !btn.classList.contains('panel-on');
          btn.classList.toggle('panel-on', pressed);
          btn.setAttribute('aria-pressed', String(pressed));
          btn.setAttribute('aria-expanded', String(pressed));
          opts.onToolToggle(btn.id, pressed, btn);
        });
      });
    }

    // باکس «ردیف‌های قابل نمایش» (نسخهٔ ۲٫۴) — فقط ارتفاع اسکرول تغییر می‌کند؛
    // جدول/فیلترها/فوکوس دست‌نخورده می‌مانند. ماندگاری با onRowsChange.
    const rowsInput = wrap.querySelector('[data-ft-rows]');
    if (rowsInput) {
      let rowsTimer = null;
      rowsInput.addEventListener('input', () => {
        clearTimeout(rowsTimer);
        rowsTimer = setTimeout(() => {
          const n = Math.min(
            Math.max(U.parseInt(rowsInput.value) || RM.config.VISIBLE_ROWS_MIN, RM.config.VISIBLE_ROWS_MIN),
            RM.config.VISIBLE_ROWS_MAX
          );
          state.visibleRows = n;
          rowsInput.value = String(n);
          const scrollEl = wrap.querySelector('.cut-table-scroll');
          if (scrollEl) applyHeight(scrollEl, n);
          if (typeof opts.onRowsChange === 'function') opts.onRowsChange(n);
        }, 260);
      });
    }

    // ۳٫۳۱ — نوار سمت چپ (عملیات گروهی نما): پس از ساخت اسکلت، رویدادهای
    // دکمه‌های leftBarHtml به نما واگذار می‌شود (mount یک‌بار در هر رندر کامل).
    if (opts.leftBarHtml && typeof opts.onLeftBarMount === 'function') {
      opts.onLeftBarMount(wrap);
    }

    renderBody();
  };

  /* ---------------- پنل ترتیب ستون‌ها (مشترک — چیپ‌های کشیدنی + باکس عرض) ---------------- */

  /**
   * پنل «ترتیب ستون‌ها» — نسخهٔ ۲٫۴:
   *   - ترتیب با کشیدن‌ورها (drag) تغییر می‌کند (فلش‌های ↑/↓ حذف شدند)
   *   - بجای فلش‌ها، هر ستون یک باکس عددی «عرض (px)» دارد؛ کاربر عرض دلخواه
   *     هر ستون را وارد می‌کند (صفر یا خالی → عرض خودکار)
   * برای جدول «گزارش تولید ستاپ‌ها».
   * تغییر ۳ (جدید): اگر handlers.onToggle داده شود، هر چیپ یک دکمهٔ «چشم»
   *   هم دارد — نمایش/مخفی‌کردن همان ستون در جدول (ستون مخفی از جدول
   *   حذف می‌شود اما در پنل می‌ماند و با کلیک دوباره برمی‌گردد).
   * @param {HTMLElement} wrap      عنصر نگهدارندهٔ چیپ‌ها
   * @param {Array}        items    [{key, label, width, hidden?}] به ترتیب فعلی
   * @param {object}       handlers { onMove(from, to), onWidth(key, width),
   *                                  onToggle?(key, hidden) — اختیاری، emptyText? }
   */
  UI.orderPanel = function (wrap, items, handlers) {
    if (!wrap) return;
    wrap.innerHTML = items.map((it, i) => `
      <div class="sort-chip order-chip${it.hidden ? ' col-hidden' : ''}" draggable="true" data-index="${i}" title="برای تغییر ترتیب بکشید">
        <span class="grip">${UI.icons.grip}</span>
        <span class="sort-priority">${U.faNum(i + 1)}</span>
        <span class="sort-label">${U.escapeHtml(it.label)}</span>
        ${handlers.onToggle ? `
        <button type="button" class="order-vis${it.hidden ? '' : ' on'}" data-order-vis="${U.escapeHtml(it.key)}"
                aria-pressed="${String(!it.hidden)}"
                title="${it.hidden ? 'این ستون در جدول مخفی است — برای نمایش دوباره کلیک کنید' : 'مخفی‌کردن این ستون در جدول (از پنل دوباره نمایش داده می‌شود)'}"
                aria-label="نمایش/مخفی‌کردن ستون ${U.escapeHtml(it.label)}">
          ${it.hidden ? UI.icons.eyeOff : UI.icons.eye}
        </button>` : ''}
        <label class="order-width" title="عرض این ستون در جدول (پیکسل) — صفر یا خالی = خودکار">
          <span class="order-width-unit">px</span>
          <input type="number" class="order-width-input" data-order-width="${U.escapeHtml(it.key)}"
                 min="0" max="1200" step="1" inputmode="numeric" aria-label="عرض ستون ${U.escapeHtml(it.label)}"
                 value="${it.width != null ? Number(it.width) : ''}" placeholder="خودکار">
        </label>
      </div>`).join('') ||
      `<span class="muted" style="font-size:.78rem">${U.escapeHtml(handlers.emptyText || 'بدون ستون')}</span>`;

    // باکس عرض هر ستون (نسخهٔ ۲٫۴) — debounce سبک؛ خالی/۰ = عرض خودکار
    let widthTimer = null;
    wrap.querySelectorAll('[data-order-width]').forEach((inp) => {
      inp.addEventListener('input', () => {
        clearTimeout(widthTimer);
        const key = inp.dataset.orderWidth;
        widthTimer = setTimeout(() => {
          const v = U.parseInt(inp.value);
          handlers.onWidth(key, v === null ? 0 : Math.min(Math.max(v, 0), 1200));
        }, 320);
      });
    });

    // دکمهٔ «چشم» — نمایش/مخفی‌کردن ستون در جدول (تغییر ۳)
    if (handlers.onToggle) {
      wrap.querySelectorAll('[data-order-vis]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chip = btn.closest('.order-chip');
          const idx = chip ? Number(chip.dataset.index) : -1;
          const it = idx >= 0 ? items[idx] : null;
          if (it) handlers.onToggle(it.key, !it.hidden);
        });
      });
    }

    // کشیدن و رها کردن
    let dragSrcIndex = null;
    wrap.querySelectorAll('.order-chip').forEach((chip) => {
      chip.addEventListener('dragstart', (e) => {
        dragSrcIndex = Number(chip.dataset.index);
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragSrcIndex));
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        wrap.querySelectorAll('.order-chip').forEach((c) => c.classList.remove('drag-over'));
        dragSrcIndex = null;
      });
      chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!chip.classList.contains('drag-over')) chip.classList.add('drag-over');
      });
      chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = dragSrcIndex;
        const to = Number(chip.dataset.index);
        if (from === null || from === to) return;
        handlers.onMove(from, to);
      });
    });
  };

  RM.ui = UI;
})();
