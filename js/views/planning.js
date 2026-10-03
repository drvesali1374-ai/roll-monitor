/* =========================================================================
   views/planning.js — نما/پنل «برنامه‌ریزی» (نسخهٔ ۳٫۳)
   -------------------------------------------------------------------------
   ساختار صفحه:
     · سوییچر دستگاه (۱/۲/۳) — هر دستگاه برنامهٔ مستقل خودش را دارد
     · تنظیمات زمان‌بندی: تاریخ چارت (پیش‌فرض خودکار = امروز، قابل تغییر)،
       ساعت شروع (پیش‌فرض ۰۷:۰۰) و کلید نمایش خط «اکنون» (نسخهٔ ۳٫۳)
     · افزودن رول — همهٔ رکوردهای «باقی‌مانده»ٔ «گزارش تولید ستاپ‌ها» فارغ
       از دستگاه (نسخهٔ ۳٫۳)؛ فیلترهای پویای شماره ستاپ و عرض؛ فیلد تعداد
       با پیش‌فرض «خام موجود» قبل از افزودن قابل تنظیم است
     · افزودن لگ/توقف/تاخیر — عنوان مشخص + زمان مثبت
     · جدول اولویت‌بندی — کشیدن و رها + دکمه‌های ↑↓ + ویرایش درجا
       (تعداد رول / عنوان و دقیقهٔ لگ)
     · گانت چارت ریسپانسیو — محور عمودی چپ (عرض رول‌ها / عنوان لگ‌ها)،
       میله‌ها: رول = تعداد و زمان، لگ = زمان؛ شروع هر ردیف = پایان قبلی؛
       زوم + لیبل چسبان + نشانگر «اکنون» (قابل روشن/خاموش)
     · خلاصهٔ زمان‌بندی زیر هر چارت — چیپ‌های KPI + جدول زمان‌بندی کامل
       با تاریخ شمسی جلالی دقیق برای زمان‌های روزهای بعد (نسخهٔ ۳٫۳)
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;

  const PlanningView = {};

  /* آیکون زنجیر — دکمهٔ لینک تعداد با «خام موجود» (نسخهٔ ۳٫۴ — تغییر ۱) */
  PlanningView.LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  /* ================================================================
     وضعیت نما
     ================================================================ */

  PlanningView._board = null;        // Board کامل (۳ ماشین)
  PlanningView._state = null;        // آخرین خروجی موتور محاسبه
  PlanningView._machine = 1;         // دستگاه فعال
  PlanningView._zoom = { 1: 1, 2: 1, 3: 1 };   // ضریب زوم گانت (جلسه‌ای)
  PlanningView._ro = null;           // ResizeObserver
  PlanningView._inputTimer = null;   // debounce ویرایش درجا
  PlanningView._ganttTimer = null;   // debounce رندر گانت پس از تغییر اندازه
  PlanningView._filters = null;      // فیلترهای پویای لیست رول (نسخهٔ ۳٫۳ — جلسه‌ای، به تفکیک دستگاه)

  /** مقدار اولیهٔ فیلترهای هر دستگاه */
  PlanningView.defaultFilters = function () {
    const f = {};
    for (const m of RM.planning.MACHINES) f[m] = { setup: '', width: '' };
    return f;
  };

  /* ================================================================
     ۱) راه‌اندازی
     ================================================================ */

  PlanningView.init = async function () {
    PlanningView._board = await RM.planning.load();
    const saved = Number(await RM.db.getSetting(RM.planning.ACTIVE_KEY, 1));
    PlanningView._machine = RM.planning.MACHINES.includes(saved) ? saved : 1;
    PlanningView._filters = PlanningView.defaultFilters();
    PlanningView.renderMachineSeg();
  };

  /** ماشین فعال از Board (با ساخت خودکار) */
  PlanningView.machine = function () {
    const key = String(PlanningView._machine);
    if (!PlanningView._board.machines[key]) {
      PlanningView._board.machines[key] = RM.planning.emptyMachine();
    }
    return PlanningView._board.machines[key];
  };

  /** تعویض دستگاه فعال + ماندگاری */
  PlanningView.setMachine = async function (m) {
    if (!RM.planning.MACHINES.includes(m) || m === PlanningView._machine) return;
    PlanningView._machine = m;
    await RM.db.setSetting(RM.planning.ACTIVE_KEY, m);
    PlanningView.renderMachineSeg();
    PlanningView.renderMachine();
  };

  /* ================================================================
     ۲) سوییچر دستگاه‌ها (seg-control)
     ================================================================ */

  PlanningView.renderMachineSeg = function () {
    const wrap = document.getElementById('plan-machine-seg');
    if (!wrap || !PlanningView._board) return;

    wrap.innerHTML = RM.planning.MACHINES.map((m) => {
      const mach = PlanningView._board.machines[String(m)] || RM.planning.emptyMachine();
      const n = mach.items.length;
      const active = m === PlanningView._machine;
      return `
        <button type="button" class="seg-btn${active ? ' active' : ''}" data-machine="${m}"
                role="tab" aria-selected="${active}" aria-label="برنامه‌ریزی دستگاه ${U.faNum(m)}">
          دستگاه ${U.faNum(m)}${n ? ` <span class="plan-seg-count">${U.faNum(n)}</span>` : ''}
        </button>`;
    }).join('');

    wrap.querySelectorAll('[data-machine]').forEach((btn) => {
      btn.addEventListener('click', () => PlanningView.setMachine(Number(btn.dataset.machine)));
    });
  };

  /* ================================================================
     ۳) رندر اصلی
     ================================================================ */

  /** بازخوانی Board از پایگاه‌داده — پس از Restore/پاک‌سازی/تغییر داده لازم است */
  PlanningView.reloadBoard = async function () {
    PlanningView._board = await RM.planning.load();
  };

  /** از refreshAll — Board همیشه از پایگاه‌داده بازخوانی می‌شود (تغییرات
      خارجی مثل Restore/پاک‌سازی کامل همینه اعمال می‌شود)؛ رندر سنگین فقط
      وقتی نما نمایان است انجام می‌شود */
  PlanningView.render = async function (state) {
    PlanningView._state = state;
    if (!PlanningView._board) return;          // هنوز init نشده
    await PlanningView.reloadBoard();
    const viewEl = document.getElementById('view-planning');
    if (!viewEl || viewEl.hidden) return;
    PlanningView.renderMachine();
  };

  /** از viewHooks هنگام باز شدن تب — بازخوانی + رندر تازه (گانت در حالت
      مخفی عرض صفر دارد و باید با نمایان شدن بازسازی شود) */
  PlanningView.onShown = async function () {
    if (!PlanningView._state || !PlanningView._board) return;
    await PlanningView.reloadBoard();
    PlanningView.renderMachine();
  };

  /** رندر کامل پنل دستگاه فعال */
  PlanningView.renderMachine = function () {
    const body = document.getElementById('plan-body');
    if (!body || !PlanningView._board) return;

    const m = PlanningView._machine;
    const machine = PlanningView.machine();
    const schedule = RM.planning.buildSchedule(machine, PlanningView._state, m);

    body.innerHTML = `
      ${PlanningView.timingBoxHtml(machine)}
      ${PlanningView.addPanelHtml(machine)}
      ${PlanningView.itemsPanelHtml(schedule)}
      <div class="plan-gantt-panel">
        <header class="plan-gantt-head">
          <h4 class="plan-subtitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 16V9"/><path d="M11 16v-3"/><path d="M15 16V6"/><path d="M19 16v-8"/></svg>
            گانت چارت زمان‌بندی — دستگاه ${U.faNum(m)}
          </h4>
          <div class="panel-tools">
            <span class="chip" id="plan-gantt-when" aria-live="polite"></span>
            <div class="plan-zoom" role="group" aria-label="زوم گانت چارت">
              <button type="button" class="btn btn-ghost btn-sm" id="plan-zoom-out" title="کوچک‌نمایی (زوم کمتر)">−</button>
              <button type="button" class="btn btn-ghost btn-sm" id="plan-zoom-fit" title="اندازهٔ متناسب با عرض صفحه">متناسب</button>
              <button type="button" class="btn btn-ghost btn-sm" id="plan-zoom-in" title="بزرگ‌نمایی (زوم بیشتر)">+</button>
            </div>
            <button type="button" class="btn btn-ghost btn-sm plan-pdf-btn" id="plan-gantt-pdf"
                    title="خروجی PDF از گانت چارت و جدول خلاصهٔ زمان‌بندی این دستگاه — یک صفحهٔ A4 افقی">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              خروجی PDF
            </button>
          </div>
        </header>
        <div class="gantt-scroll" id="plan-gantt-scroll" dir="ltr">
          <div class="gantt-canvas" id="plan-gantt-canvas"></div>
        </div>
        <p class="plan-gantt-legend">
          <span class="lg-item"><span class="lg-swatch lg-roll" aria-hidden="true"></span> رول (تعداد و زمان روی میله)</span>
          <span class="lg-item"><span class="lg-swatch lg-lag" aria-hidden="true"></span> لگ / توقف (زمان روی میله)</span>
          <span class="lg-item" id="plan-legend-now"><span class="lg-swatch lg-now" aria-hidden="true"></span> لحظهٔ اکنون (امروز)</span>
        </p>
      </div>
      <div class="plan-summary-panel">
        <h4 class="plan-subtitle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
          خلاصهٔ زمان‌بندی دستگاه ${U.faNum(m)}
        </h4>
        <div class="plan-summary-chips" id="plan-summary-chips"></div>
        <div id="plan-sched-wrap"></div>
      </div>`;

    PlanningView.wireTiming(machine);
    PlanningView.wireAddPanel(machine);
    PlanningView.wireItemsTable(machine);
    PlanningView.wireZoom();

    // دکمهٔ «خروجی PDF» گانت (نسخهٔ ۳٫۴ — تغییر ۸)
    const pdfBtn = document.getElementById('plan-gantt-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', () => PlanningView.exportGanttPdf());

    // لِجند «اکنون» — همگام با کلید نمایش خط اکنون (نسخهٔ ۳٫۳)
    const legendNow = document.getElementById('plan-legend-now');
    if (legendNow) legendNow.hidden = machine.showNow === false;

    // بازمحاسبه + پرکردن سلول‌های زمان/شروع‌و‌پایان + گانت + خلاصه + شمارندهٔ سوییچر
    PlanningView.refreshComputed();

    // واکنش‌گرایی: رندر مجدد گانت هنگام تغییر عرض نما
    if (PlanningView._ro) PlanningView._ro.disconnect();
    const scrollEl = document.getElementById('plan-gantt-scroll');
    if (scrollEl && typeof ResizeObserver !== 'undefined') {
      PlanningView._ro = new ResizeObserver(() => {
        clearTimeout(PlanningView._ganttTimer);
        PlanningView._ganttTimer = setTimeout(() => PlanningView.renderGantt(), 120);
      });
      PlanningView._ro.observe(scrollEl);
    }
  };

  /* ================================================================
     ۴) تنظیمات زمان‌بندی — تاریخ چارت + ساعت شروع + کلید خط اکنون
        (نسخهٔ ۳٫۵ — تغییر ۵: عنوان «تنظیمات زمان‌بندی» حذف شد و دکمهٔ
        «امروز (خودکار)» به‌صورت دکمهٔ ریز داخل خانهٔ فیلد «تاریخ چارت»
        جابه‌جا شد؛ باکس فقط سه فیلد تمیز است)
        نسخهٔ ۳٫۶ — تغییر ۳: کادر سبز توضیح حالت تاریخ (خودکار/ثابت) حذف شد.
     ================================================================ */

  PlanningView.timingBoxHtml = function (machine) {
    const dateInfo = RM.planning.effectiveDate(machine);
    const startFa = U.toFaDigits(machine.startTime || RM.planning.DEFAULT_START);
    const showNow = machine.showNow !== false;
    return `
      <div class="plan-timing-box">
        <div class="plan-timing-fields">
          <div class="field plan-field">
            <label for="plan-date">تاریخ چارت</label>
            <div class="plan-date-wrap">
              <input type="text" id="plan-date" inputmode="numeric" autocomplete="off"
                     placeholder="۱۴۰۵/۰۶/۱۸" value="${U.faJalali(dateInfo.date)}">
              <button type="button" class="plan-date-today-mini" id="plan-date-today"
                      title="بازگشت تاریخ به حالت خودکار (همیشه امروز)" aria-label="امروز (خودکار)">امروز</button>
            </div>
            <p class="field-error" id="plan-date-err" hidden></p>
          </div>
          <div class="field plan-field">
            <label for="plan-start">ساعت شروع</label>
            <input type="text" id="plan-start" inputmode="numeric" autocomplete="off"
                   placeholder="۰۷:۰۰" value="${startFa}">
            <p class="field-error" id="plan-start-err" hidden></p>
          </div>
          <div class="field plan-field plan-now-field">
            <label id="plan-now-label">خط «اکنون»</label>
            <div class="plan-now-switch">
              <input type="checkbox" id="plan-now-switch" class="plan-switch-input" ${showNow ? 'checked' : ''}
                     aria-labelledby="plan-now-label" title="نمایش یا پنهان‌کردن خط عمودی قرمز «اکنون» در گانت چارت">
              <span class="plan-switch-track" aria-hidden="true"><span class="plan-switch-knob"></span></span>
              <span class="plan-now-state" id="plan-now-state" aria-live="polite">${showNow ? 'نمایش' : 'پنهان'}</span>
            </div>
          </div>
        </div>
      </div>`;
  };

  PlanningView.wireTiming = function (machine) {
    const dateInput = document.getElementById('plan-date');
    const dateErr = document.getElementById('plan-date-err');
    const startInput = document.getElementById('plan-start');
    const startErr = document.getElementById('plan-start-err');

    // تاریخ — تغییر به حالت ثابت با تاریخ معتبر
    dateInput.addEventListener('change', async () => {
      dateErr.hidden = true;
      const parsed = U.parseJalaliDate(dateInput.value);
      if (!parsed) {
        dateErr.textContent = 'تاریخ نامعتبر است — فرمت صحیح: ۱۴۰۵/۰۶/۱۸';
        dateErr.hidden = false;
        dateInput.value = U.faJalali(RM.planning.effectiveDate(machine).date);
        return;
      }
      machine.dateMode = 'fixed';
      machine.fixedDate = parsed.normalized;
      await PlanningView.persist();
      PlanningView.renderMachine();
      UI.toast(`تاریخ چارت دستگاه ${U.faNum(PlanningView._machine)} روی ${U.faJalali(parsed.normalized)} ثابت شد.`, 'success');
    });

    // بازگشت به حالت خودکار (همیشه امروز)
    document.getElementById('plan-date-today').addEventListener('click', async () => {
      machine.dateMode = 'auto';
      machine.fixedDate = null;
      await PlanningView.persist();
      PlanningView.renderMachine();
      UI.toast('تاریخ چارت به حالت خودکار بازگشت — هر روز به تاریخ روز بروزرسانی می‌شود.', 'info');
    });

    // ساعت شروع
    startInput.addEventListener('change', async () => {
      startErr.hidden = true;
      const parsed = RM.planning.parseClock(startInput.value);
      if (parsed === null) {
        startErr.textContent = 'ساعت نامعتبر است — مثال درست: ۰۷:۰۰ یا 7:30';
        startErr.hidden = false;
        startInput.value = U.toFaDigits(machine.startTime || RM.planning.DEFAULT_START);
        return;
      }
      machine.startTime = RM.planning.formatClock(parsed);
      await PlanningView.persist();
      PlanningView.renderMachine();
      UI.toast(`ساعت شروع چارت دستگاه ${U.faNum(PlanningView._machine)} روی ${RM.planning.faClock(parsed)} تنظیم شد.`, 'success');
    });

    // کلید نمایش/پنهان‌کردن خط «اکنون» در گانت (نسخهٔ ۳٫۳)
    const nowSwitch = document.getElementById('plan-now-switch');
    const nowState = document.getElementById('plan-now-state');
    nowSwitch.addEventListener('change', async () => {
      machine.showNow = nowSwitch.checked;
      await PlanningView.persist();
      nowState.textContent = machine.showNow ? 'نمایش' : 'پنهان';
      const legendNow = document.getElementById('plan-legend-now');
      if (legendNow) legendNow.hidden = !machine.showNow;
      PlanningView.renderGantt();
      UI.toast(machine.showNow
        ? 'خط «اکنون» در گانت چارت نمایان شد.'
        : 'خط «اکنون» از گانت چارت پنهان شد.', 'info', 2200);
    });
  };

  /* ================================================================
     ۵) پنل افزودن اقلام (رول / لگ) — نسخهٔ ۳٫۴ تغییر ۶: بازطراحی مرتب و
        فشرده؛ کادرهای راهنمای سبز حذف شدند (همه چیز با لیبل و Placeholder واضح است)
     ================================================================ */

  /** شناسهٔ رکوردهای رولِ افزوده‌شده در برنامهٔ «همهٔ» دستگاه‌ها (نسخهٔ ۳٫۳) */
  PlanningView.plannedRollIds = function () {
    const ids = new Set();
    if (!PlanningView._board) return ids;
    for (const mk of RM.planning.MACHINES) {
      const mach = PlanningView._board.machines[String(mk)];
      if (mach && Array.isArray(mach.items)) {
        mach.items.forEach((i) => { if (i.type === 'roll') ids.add(i.setupId); });
      }
    }
    return ids;
  };

  /** فیلترهای جاری دستگاه فعال */
  PlanningView.currentFilters = function () {
    if (!PlanningView._filters) PlanningView._filters = PlanningView.defaultFilters();
    return PlanningView._filters[PlanningView._machine] || { setup: '', width: '' };
  };

  /**
   * اعمال فیلترهای پویا (شماره ستاپ + عرض) روی رکوردهای باقی‌مانده —
   * تطبیق عددی دقیق؛ فیلد خالی = بدون محدودیت در همان بُعد (ترکیب AND).
   */
  PlanningView.applyRollFilters = function (eligible) {
    const f = PlanningView.currentFilters();
    const setupV = String(f.setup || '').trim() !== '' ? U.parseNumber(f.setup) : null;
    const widthV = String(f.width || '').trim() !== '' ? U.parseNumber(f.width) : null;
    return eligible.filter((r) =>
      (setupV === null || r.setupNumber === setupV)
      && (widthV === null || r.width === widthV));
  };

  /** گزینه‌های select رول — رکوردهای فیلترشده + وضعیت «قبلاً افزوده شده» سراسری */
  PlanningView.rollOptionsHtml = function () {
    const machine = PlanningView.machine();
    const eligible = RM.planning.eligibleRolls(PlanningView._state);
    const visible = PlanningView.applyRollFilters(eligible);
    const plannedIds = PlanningView.plannedRollIds();
    const ownIds = new Set(machine.items.filter((i) => i.type === 'roll').map((i) => i.setupId));

    let placeholder;
    if (!eligible.length) {
      placeholder = '<option value="">رکورد «باقی‌مانده‌ای» موجود نیست</option>';
    } else if (!visible.length) {
      placeholder = '<option value="">موردی مطابق فیلترها یافت نشود</option>';
    } else {
      const cnt = visible.length < eligible.length
        ? `${U.faNum(visible.length)} از ${U.faNum(eligible.length)}`
        : U.faNum(eligible.length);
      placeholder = `<option value="">— انتخاب رول (${cnt} رکورد باقی‌مانده) —</option>`;
    }

    const options = visible.map((r) => {
      const added = plannedIds.has(r.id);
      const own = ownIds.has(r.id);
      return `<option value="${r.id}"${own ? ' disabled' : ''}>${U.escapeHtml(RM.planning.rollOptionLabel(r))}${added ? ' — قبلاً افزوده شده' : ''}</option>`;
    }).join('');

    return { eligibleCount: eligible.length, visibleCount: visible.length, innerHtml: placeholder + options };
  };

  PlanningView.addPanelHtml = function () {
    const f = PlanningView.currentFilters();
    const opts = PlanningView.rollOptionsHtml();

    return `
      <div class="plan-add-grid">
        <div class="plan-add-card">
          <h4 class="plan-add-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            افزودن رول <span class="muted">— رکوردهای «باقی‌مانده» جدول ستاپ‌ها</span>
          </h4>
          <div class="plan-roll-filters">
            <div class="prf-item">
              <label for="plan-filter-setup">ستاپ</label>
              <input type="text" id="plan-filter-setup" inputmode="numeric" autocomplete="off"
                     placeholder="شماره" value="${U.escapeHtml(f.setup || '')}">
            </div>
            <div class="prf-item">
              <label for="plan-filter-width">عرض</label>
              <input type="text" id="plan-filter-width" inputmode="numeric" autocomplete="off"
                     placeholder="مثلاً ۲۰۱۰" value="${U.escapeHtml(f.width || '')}">
            </div>
            <span class="prf-count" id="plan-filter-count" aria-live="polite"></span>
          </div>
          <div class="plan-add-row">
            <select id="plan-roll-select" aria-label="انتخاب رول باقی‌مانده" ${opts.eligibleCount ? '' : 'disabled'}>
              ${opts.innerHtml}
            </select>
            <input type="text" id="plan-roll-qty" class="plan-qty-add-input" inputmode="numeric" autocomplete="off"
                   placeholder="تعداد" aria-label="تعداد رول — پیش‌فرض: خام موجود" disabled
                   title="پیش‌فرض = «خام موجود» رکورد انتخابی — قابل تغییر">
            <button type="button" class="btn btn-primary btn-sm" id="plan-roll-add" ${opts.eligibleCount ? '' : 'disabled'}>افزودن به برنامه</button>
          </div>
        </div>

        <div class="plan-add-card plan-add-lag">
          <h4 class="plan-add-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            افزودن لگ / توقف / تاخیر
          </h4>
          <div class="plan-add-row plan-add-row-lag">
            <input type="text" id="plan-lag-title" autocomplete="off" placeholder="عنوان (تعویض رول، استراحت، …)" aria-label="عنوان لگ">
            <input type="text" id="plan-lag-min" inputmode="numeric" autocomplete="off" placeholder="دقیقه" aria-label="مدت لگ به دقیقه">
            <button type="button" class="btn btn-primary btn-sm" id="plan-lag-add">افزودن</button>
          </div>
        </div>
      </div>`;
  };

  /** به‌روزرسانی درجا: گزینه‌های select + شمارندهٔ فیلتر + دکمهٔ افزودن (بدون رندر کل پنل) */
  PlanningView.refreshRollSelect = function (keepSelection) {
    const select = document.getElementById('plan-roll-select');
    const addBtn = document.getElementById('plan-roll-add');
    const countEl = document.getElementById('plan-filter-count');
    const qtyInput = document.getElementById('plan-roll-qty');
    if (!select) return;

    const prev = keepSelection ? select.value : '';
    const opts = PlanningView.rollOptionsHtml();

    select.innerHTML = opts.innerHtml;
    if (prev && opts.visibleCount > 0) {
      const still = Array.from(select.options).some((o) => o.value === prev);
      if (still) select.value = prev;
    }

    if (countEl) {
      countEl.textContent = opts.eligibleCount === 0
        ? ''
        : opts.visibleCount < opts.eligibleCount
          ? `${U.faNum(opts.visibleCount)} از ${U.faNum(opts.eligibleCount)} رکورد`
          : `${U.faNum(opts.eligibleCount)} رکورد`;
    }
    if (addBtn) addBtn.disabled = opts.visibleCount === 0;

    // همگام‌سازی فیلد تعداد با انتخاب جاری
    PlanningView.syncQtyToSelection();
  };

  /** فیلد تعداد = خام موجود رکورد انتخابی (صفر/نامعتبر → ۱) — خالی وقتی انتخابی نیست */
  PlanningView.syncQtyToSelection = function () {
    const select = document.getElementById('plan-roll-select');
    const qtyInput = document.getElementById('plan-roll-qty');
    if (!select || !qtyInput) return;

    const value = select.value;
    if (!value) {
      qtyInput.value = '';
      qtyInput.disabled = true;
      return;
    }

    const setup = (PlanningView._state && PlanningView._state.setupReport
      ? PlanningView._state.setupReport : []).find((r) => r.id === Number(value));
    if (!setup) return;

    const raw = U.parseInt(setup.rawExisting);
    const defaultQty = raw !== null && raw >= 1 ? raw : 1;
    qtyInput.value = U.toFaDigits(String(defaultQty));
    qtyInput.disabled = false;
  };

  PlanningView.wireAddPanel = function (machine) {
    const rollSelect = document.getElementById('plan-roll-select');
    const qtyInput = document.getElementById('plan-roll-qty');
    const setupFilter = document.getElementById('plan-filter-setup');
    const widthFilter = document.getElementById('plan-filter-width');

    /* --- فیلترهای پویا: هم‌زمان با تایپ، لیست بازسازی می‌شود (نسخهٔ ۳٫۳) --- */
    const onFilterInput = () => {
      const f = PlanningView.currentFilters();
      f.setup = setupFilter.value;
      f.width = widthFilter.value;
      PlanningView.refreshRollSelect(true);
    };
    setupFilter.addEventListener('input', onFilterInput);
    widthFilter.addEventListener('input', onFilterInput);

    /* --- انتخاب رول → فیلد تعداد با پیش‌فرض «خام موجود» پر می‌شود --- */
    rollSelect.addEventListener('change', () => PlanningView.syncQtyToSelection());

    /* --- افزودن رول با تعداد تعیین‌شده توسط کاربر --- */
    document.getElementById('plan-roll-add').addEventListener('click', async () => {
      const value = rollSelect.value;
      if (!value) {
        UI.toast('ابتدا یک رول از فهرست انتخاب کنید.', 'warning');
        return;
      }
      const setupId = Number(value);
      if (machine.items.some((i) => i.type === 'roll' && i.setupId === setupId)) {
        UI.toast('این رول از قبل در برنامهٔ همین دستگاه هست — تعدادش را در جدول ویرایش کنید.', 'warning');
        return;
      }
      const setup = (PlanningView._state && PlanningView._state.setupReport ? PlanningView._state.setupReport : []).find((r) => r.id === setupId);
      if (!setup) return;

      const qty = U.parseInt(qtyInput.value);
      if (qty === null || qty < 1) {
        UI.toast('تعداد باید عددی صحیح و حداقل ۱ باشد.', 'error');
        qtyInput.focus();
        return;
      }

      // هشدار: رول در برنامهٔ دستگاه دیگری هم هست (نسخهٔ ۳٫۳ — قابل افزودن، با اطلاع)
      const otherMachine = RM.planning.MACHINES.find((mk) => mk !== PlanningView._machine
        && (PlanningView._board.machines[String(mk)] || { items: [] }).items
          .some((i) => i.type === 'roll' && i.setupId === setupId));

      machine.items.push({
        id: RM.planning.makeItemId(),
        type: 'roll',
        setupId,
        quantity: qty,
      });
      await PlanningView.persist();
      PlanningView.renderMachineSeg();
      PlanningView.renderMachine();

      const rawExisting = U.parseInt(setup.rawExisting);
      let note = '';
      if (rawExisting === null || rawExisting < 1) note = ' (خام موجود صفر بود — پیش‌فرض ۱)';
      else if (qty !== rawExisting) note = ` (خام موجود: ${U.faNum(rawExisting)})`;
      if (otherMachine) note += ` — توجه: این رول در برنامهٔ دستگاه ${U.faNum(otherMachine)} هم هست.`;
      UI.toast(`رولِ ستاپ ${U.faNum(setup.setupNumber)} عرض ${U.faWidth(setup.width)} با تعداد ${U.faNum(qty)} به برنامهٔ دستگاه ${U.faNum(PlanningView._machine)} اضافه شد${note}.`, 'success', 4200);
    });

    const titleInput = document.getElementById('plan-lag-title');
    const minInput = document.getElementById('plan-lag-min');

    document.getElementById('plan-lag-add').addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const minutes = U.parseNumber(minInput.value);

      if (!title) {
        UI.toast('عنوان لگ را وارد کنید (مثلاً: تعویض رول).', 'warning');
        titleInput.focus();
        return;
      }
      if (minutes === null || !(minutes > 0)) {
        UI.toast('مقدار زمان لگ باید عددی مثبت باشد (حداقل ۱ دقیقه).', 'error');
        minInput.focus();
        return;
      }

      machine.items.push({
        id: RM.planning.makeItemId(),
        type: 'lag',
        title,
        minutes: Math.round(minutes * 100) / 100,
      });
      titleInput.value = '';
      minInput.value = '';
      await PlanningView.persist();
      PlanningView.renderMachineSeg();
      PlanningView.renderMachine();
      UI.toast(`لگ «${title}» با زمان ${U.faHMM(minutes)} به برنامه اضافه شد.`, 'success');
    });

    // مقدار اولیهٔ شمارندهٔ فیلتر + فیلد تعداد
    PlanningView.refreshRollSelect(false);
  };

  /* ================================================================
     ۶) جدول اولویت‌بندی اقلام
     ================================================================ */

  PlanningView.itemsPanelHtml = function (schedule) {
    const m = PlanningView._machine;
    return `
      <div class="plan-items-panel">
        <div class="sort-builder-head">
          <b>جدول اولویت‌بندی — دستگاه ${U.faNum(m)}:</b>
          <span class="muted" style="font-size:.72rem">ترتیب آرایه = ترتیب اجرا · با دستگیره بکشید یا با ↑↓ جابه‌جا کنید · تعداد رول‌ها و عنوان/دقیقهٔ لگ‌ها درجا قابل ویرایش است · هر قلم بلافاصله پس از پایان قلم قبلی شروع می‌شود</span>
        </div>
        <div class="plan-items-wrap" id="plan-items-wrap">${PlanningView.itemsTableHtml(schedule)}</div>
      </div>`;
  };

  PlanningView.itemsTableHtml = function (schedule) {
    if (!schedule.rows.length) {
      return `
        <div class="empty-state">
          ${UI.icons.alert}
          <p>هنوز قلمی برای دستگاه ${U.faNum(PlanningView._machine)} برنامه‌ریزی نشده — از پنل بالا رول یا لگ اضافه کنید.</p>
        </div>`;
    }

    const rows = schedule.rows.map((row) => {
      const idx = row.index;
      const pin = row.item;

      if (row.kind === 'roll') {
        const setup = row.setup;
        /* نسخهٔ ۳٫۴ — تغییر ۱: لیبل‌های «باقی مانده» و «دستگاه N» از ستون
           «مشخصات قلم» حذف شدند — فقط مشخصات فنی رکورد. */
        const desc = setup
          ? `<b>عرض ${U.faWidth(setup.width)}</b> · ستاپ ${U.faNum(setup.setupNumber)} · متراژ ${U.faNum(setup.standardLength)} · ضخامت ${U.faNum(setup.thickness)}`
          : `<span class="pi-deleted" title="این رکورد دیگر در «گزارش تولید ستاپ‌ها» وجود ندارد">${UI.icons.alert} رکورد حذف‌شده</span>`;

        /* دکمهٔ لینک تعداد با «خام موجود» (نسخهٔ ۳٫۴ — تغییر ۱): فعال → تعداد
           زنده از رکورد؛ غیرفعال → تعداد دستی ورودی کاربر. */
        const linked = row.linkedRaw === true;
        const qtyTitle = linked
          ? 'لینک فعال — تعداد به‌صورت زنده از ستون «خام موجود» همین رکورد خوانده می‌شود (برای ویرایش دستی، لینک را خاموش کنید)'
          : 'تعداد دستی — با دکمهٔ زنجیر کنار همین فیلد، تعداد به «خام موجود» همین رکورد لینک می‌شود';

        return `
          <tr class="plan-item kind-roll${row.valid ? '' : ' invalid'}" data-id="${pin.id}">
            <td class="pi-grip" draggable="true" title="برای تغییر اولویت بکشید">${UI.icons.grip}</td>
            <td class="pi-order">${U.faNum(idx + 1)}</td>
            <td class="pi-kind"><span class="kind-badge kb-roll">رول</span></td>
            <td class="pi-desc">${desc}</td>
            <td class="pi-qty">
              <div class="pi-qty-box">
                <input type="text" class="plan-qty-input" inputmode="numeric" value="${U.toFaDigits(String(row.quantity))}"
                       aria-label="تعداد این رول" title="${qtyTitle}"${linked ? ' disabled' : ''}>
                <button type="button" class="pi-link-btn${linked ? ' on' : ''}" data-link="${pin.id}" aria-pressed="${linked}"
                        title="${linked
                          ? 'لینک با «خام موجود» فعال است — کلیک کنید تا تعداد دستی کاربر ملاک شود'
                          : 'لینک کردن تعداد با «خام موجود» همین رکورد در جدول «گزارش تولید ستاپ‌ها»'}">
                  ${PlanningView.LINK_ICON}
                </button>
              </div>
              <span class="pi-qty-hint" data-cell="qtyhint"></span>
            </td>
            <td class="pi-time" data-cell="time"></td>
            <td class="pi-span" data-cell="span"></td>
            <td class="pi-actions">
              <button type="button" class="btn btn-ghost btn-icon btn-move" data-move="-1" aria-label="انتقال به بالا" title="یک پله بالا">↑</button>
              <button type="button" class="btn btn-ghost btn-icon btn-move" data-move="1" aria-label="انتقال به پایین" title="یک پله پایین">↓</button>
              <button type="button" class="btn btn-ghost btn-icon btn-remove" aria-label="حذف قلم" title="حذف از برنامه">${UI.icons.trash}</button>
            </td>
          </tr>`;
      }

      // لگ
      return `
        <tr class="plan-item kind-lag${row.valid ? '' : ' invalid'}" data-id="${pin.id}">
          <td class="pi-grip" draggable="true" title="برای تغییر اولویت بکشید">${UI.icons.grip}</td>
          <td class="pi-order">${U.faNum(idx + 1)}</td>
          <td class="pi-kind"><span class="kind-badge kb-lag">لگ</span></td>
          <td class="pi-desc">
            <input type="text" class="plan-lag-title-input" value="${U.escapeHtml(pin.title)}" placeholder="عنوان لگ" aria-label="عنوان لگ">
          </td>
          <td class="pi-qty pi-qty-lag">
            <input type="text" class="plan-lag-min-input" inputmode="numeric" value="${U.toFaDigits(String(pin.minutes))}" aria-label="مدت لگ به دقیقه" title="مدت (دقیقه) — باید مثبت باشد">
            <span class="pi-unit">دقیقه</span>
          </td>
          <td class="pi-time" data-cell="time"></td>
          <td class="pi-span" data-cell="span"></td>
          <td class="pi-actions">
            <button type="button" class="btn btn-ghost btn-icon btn-move" data-move="-1" aria-label="انتقال به بالا" title="یک پله بالا">↑</button>
            <button type="button" class="btn btn-ghost btn-icon btn-move" data-move="1" aria-label="انتقال به پایین" title="یک پله پایین">↓</button>
            <button type="button" class="btn btn-ghost btn-icon btn-remove" aria-label="حذف قلم" title="حذف از برنامه">${UI.icons.trash}</button>
          </td>
        </tr>`;
    }).join('');

    return `
      <table class="plan-items-table">
        <thead>
          <tr>
            <th class="th-grip" scope="col"><span class="sr-only">جابه‌جایی</span></th>
            <th scope="col">اولویت</th>
            <th scope="col">نوع</th>
            <th scope="col">مشخصات قلم</th>
            <th scope="col">تعداد / زمان لگ</th>
            <th scope="col">مدت</th>
            <th scope="col">شروع تا پایان</th>
            <th scope="col">عملیات</th>
          </tr>
        </thead>
        <tbody id="plan-items-body">${rows}</tbody>
      </table>`;
  };

  /** اتصال رویدادهای جدول (کشیدن، جابه‌جایی، حذف، ویرایش درجا) */
  PlanningView.wireItemsTable = function (machine) {
    const wrap = document.getElementById('plan-items-wrap');
    if (!wrap) return;

    // جابه‌جایی ↑↓ و حذف
    wrap.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr[data-id]');
        const id = tr.dataset.id;
        const idx = machine.items.findIndex((i) => i.id === id);
        if (idx === -1) return;
        const to = idx + Number(btn.dataset.move);
        if (to < 0 || to >= machine.items.length) return;
        const [it] = machine.items.splice(idx, 1);
        machine.items.splice(to, 0, it);
        await PlanningView.persist();
        PlanningView.renderMachine();
      });
    });

    wrap.querySelectorAll('.btn-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr[data-id]');
        const idx = machine.items.findIndex((i) => i.id === tr.dataset.id);
        if (idx === -1) return;
        const [removed] = machine.items.splice(idx, 1);
        await PlanningView.persist();
        PlanningView.renderMachineSeg();
        PlanningView.renderMachine();
        UI.toast(removed.type === 'roll'
          ? 'رول از برنامه حذف شد.'
          : `لگ «${removed.title}» از برنامه حذف شد.`, 'info', 2600);
      });
    });

    // ---------- دکمهٔ لینک تعداد با «خام موجود» (نسخهٔ ۳٫۴ — تغییر ۱) ----------
    wrap.querySelectorAll('.pi-link-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr[data-id]');
        const item = machine.items.find((i) => i.id === tr.dataset.id);
        if (!item || item.type !== 'roll') return;

        const setups = (PlanningView._state && PlanningView._state.setupReport) || [];
        const setup = setups.find((r) => r.id === item.setupId);
        const raw = U.parseInt(setup ? setup.rawExisting : null);

        if (item.linkedRaw === true) {
          // خاموش‌کردن لینک → تعداد دستی ورودی کاربر ملاک می‌شود
          item.linkedRaw = false;
          await PlanningView.persist();
          PlanningView.renderMachine();
          UI.toast('لینک برداشته شد — تعداد دستی ورودی کاربر ملاک زمان‌بندی است.', 'info');
          return;
        }

        // روشن‌کردن لینک — نیازمند خام موجود معتبر (≥ ۱)
        if (!setup) {
          UI.toast('رکورد این رول در «گزارش تولید ستاپ‌ها» موجود نیست — لینک ممکن نیست.', 'error');
          return;
        }
        if (raw === null || raw < 1) {
          UI.toast(`«خام موجود» این رکورد ${raw === null ? 'نامعتبر' : 'صفر'} است — لینک فعال نشد؛ تعداد دستی معتبر است.`, 'warning', 4200);
          return;
        }
        item.linkedRaw = true;
        await PlanningView.persist();
        PlanningView.renderMachine();
        UI.toast(`تعداد این رول به «خام موجود» لینک شد (${U.faNum(raw)} رول) — گانت و خلاصه به‌روز شدند.`, 'success', 3600);
      });
    });

    // ---------- کشیدن و رها کردن (فقط از دستگیره) ----------
    let dragId = null;
    wrap.querySelectorAll('tr.plan-item').forEach((tr) => {
      const grip = tr.querySelector('.pi-grip');

      grip.addEventListener('dragstart', (e) => {
        dragId = tr.dataset.id;
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragId));
      });
      grip.addEventListener('dragend', () => {
        tr.classList.remove('dragging');
        wrap.querySelectorAll('tr.plan-item').forEach((r) => r.classList.remove('drag-over'));
        dragId = null;
      });

      tr.addEventListener('dragover', (e) => {
        if (dragId === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!tr.classList.contains('drag-over')) tr.classList.add('drag-over');
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
      tr.addEventListener('drop', async (e) => {
        if (dragId === null) return;
        e.preventDefault();
        const from = machine.items.findIndex((i) => i.id === dragId);
        const to = machine.items.findIndex((i) => i.id === tr.dataset.id);
        if (from === -1 || to === -1 || from === to) return;
        const [it] = machine.items.splice(from, 1);
        machine.items.splice(to, 0, it);
        await PlanningView.persist();
        PlanningView.renderMachine();
      });
    });

    // ---------- ویرایش درجا (بدون رندر مجدد جدول — حفظ فوکوس) ----------
    const onInput = () => {
      clearTimeout(PlanningView._inputTimer);
      PlanningView._inputTimer = setTimeout(() => PlanningView.liveApply(), 260);
    };
    wrap.querySelectorAll('.plan-qty-input, .plan-lag-title-input, .plan-lag-min-input').forEach((input) => {
      input.addEventListener('input', onInput);
      input.addEventListener('change', () => { onInput(); PlanningView.persist(); });
    });
  };

  /** خواندن ورودی‌های جدول به Board + به‌روزرسانی سلول‌های محاسباتی و گانت */
  PlanningView.liveApply = function () {
    const machine = PlanningView.machine();
    const body = document.getElementById('plan-items-body');
    if (!body) return;

    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const item = machine.items.find((i) => i.id === tr.dataset.id);
      if (!item) return;
      if (item.type === 'roll') {
        const input = tr.querySelector('.plan-qty-input');
        // ورودیِ لینک‌شده (disabled) مقدار زندهٔ خام موجود را نشان می‌دهد —
        // مقدار دستی کاربر در Board دست‌نخورده می‌ماند (نسخهٔ ۳٫۴ — تغییر ۱)
        if (input && !input.disabled) {
          const q = U.parseInt(input.value);
          item.quantity = q === null ? 0 : q;
        }
      } else {
        const titleInput = tr.querySelector('.plan-lag-title-input');
        const minInput = tr.querySelector('.plan-lag-min-input');
        if (titleInput) item.title = titleInput.value;
        if (minInput) {
          const m = U.parseNumber(minInput.value);
          item.minutes = m === null ? 0 : m;
        }
      }
    });

    PlanningView.refreshComputed();
  };

  /** بازمحاسبهٔ زمان‌بندی + وصلهٔ سلول‌ها + گانت + خلاصه (بدون رندر ورودی‌ها) */
  PlanningView.refreshComputed = function () {
    const machine = PlanningView.machine();
    const schedule = RM.planning.buildSchedule(machine, PlanningView._state, PlanningView._machine);
    const body = document.getElementById('plan-items-body');
    if (body) {
      schedule.rows.forEach((row) => {
        const tr = body.querySelector(`tr[data-id="${row.item.id}"]`);
        if (!tr) return;

        tr.classList.toggle('invalid', !row.valid);

        const timeCell = tr.querySelector('[data-cell="time"]');
        const spanCell = tr.querySelector('[data-cell="span"]');
        const qtyHint = tr.querySelector('[data-cell="qtyhint"]');

        if (timeCell) {
          timeCell.innerHTML = row.valid
            ? `<span class="num-time" title="${U.faDuration(row.durationMin)}">${U.faHMM(row.durationMin)}</span>`
            : `<span class="pi-invalid-reason">${U.escapeHtml(row.invalidReason || 'نامعتبر')}</span>`;
        }
        if (spanCell) {
          spanCell.innerHTML = row.valid
            ? `<span class="pi-clock">${RM.planning.faStampWithDate(row.startMin, schedule.date)}</span> <span class="muted">تا</span> <span class="pi-clock">${PlanningView.faEndStamp(row.endMin, schedule.date)}</span>`
            : '<span class="muted">—</span>';
        }
        if (qtyHint && row.kind === 'roll' && row.setup) {
          qtyHint.innerHTML = row.linkedRaw
            ? `<span class="pi-link-hint" title="تعداد به‌صورت زنده از ستون «خام موجود» همین رکورد خوانده می‌شود">● لینک با خام موجود: ${U.faNum(row.setup.rawExisting)}</span>`
            : `خام موجود: ${U.faNum(row.setup.rawExisting)}`;
        }
      });
    }

    PlanningView.renderGantt();
    PlanningView.renderSummary();
    PlanningView.renderMachineSeg();
  };

  /**
   * مُهر پایان با تاریخ شمسی دقیق (نسخهٔ ۳٫۳): روزهای بعد با تاریخ جلالی
   * همان روز و تاکید رنگی (.sched-dt) نمایش داده می‌شوند — «۱۴۰۵/۰۶/۲۹ ۱۷:۳۵».
   */
  PlanningView.faEndStamp = function (minutes, baseJalaliDate) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const day = Math.floor(total / 1440);
    if (day > 0) {
      return `<span class="sched-dt" title="ادامهٔ برنامه در روز ${U.faNum(day + 1)} — تاریخ شمسی دقیق">${RM.planning.faStampWithDate(total, baseJalaliDate)}</span>`;
    }
    return RM.planning.faClock(total);
  };

  /* ================================================================
     ۷) گانت چارت
     ================================================================ */

  /* محدودهٔ زوم (نسخهٔ ۳٫۵ — تغییر ۱۰): قبلاً حداقل زوم ۱ بود و کاربر
     نمی‌توانست کوچک‌نماییِ بیش از «متناسب» انجام دهد؛ اکنون تا ۰٫۲۲
     (برنامه‌های بلند در یک نگاه با اسکرول افقی) زوم کم می‌شود. */
  PlanningView.ZOOM_MIN = 0.22;
  PlanningView.ZOOM_MAX = 8;

  PlanningView.wireZoom = function () {
    const m = PlanningView._machine;

    document.getElementById('plan-zoom-in').addEventListener('click', () => {
      PlanningView._zoom[m] = Math.min(PlanningView.ZOOM_MAX, (PlanningView._zoom[m] || 1) * 1.35);
      PlanningView.renderGantt();
    });
    document.getElementById('plan-zoom-out').addEventListener('click', () => {
      PlanningView._zoom[m] = Math.max(PlanningView.ZOOM_MIN, (PlanningView._zoom[m] || 1) / 1.35);
      PlanningView.renderGantt();
    });
    document.getElementById('plan-zoom-fit').addEventListener('click', () => {
      PlanningView._zoom[m] = 1;
      PlanningView.renderGantt();
    });
  };

  PlanningView.renderGantt = function () {
    const canvas = document.getElementById('plan-gantt-canvas');
    const scroll = document.getElementById('plan-gantt-scroll');
    const whenChip = document.getElementById('plan-gantt-when');
    if (!canvas || !scroll) return;

    const m = PlanningView._machine;
    const machine = PlanningView.machine();
    const schedule = RM.planning.buildSchedule(machine, PlanningView._state, m);

    // چیپ تاریخ/ساعت بالای چارت
    if (whenChip) {
      const today = RM.planning.todayJalali();
      const isToday = schedule.date === today;
      whenChip.innerHTML =
        `${U.faJalali(schedule.date)}${isToday ? ' (امروز)' : ' (ثابت)'} · شروع ${U.toFaDigits(machine.startTime)}` +
        (schedule.totalMin > 0 ? ` · پایان ${RM.planning.faStampWithDate(schedule.endMin, schedule.date)}` : '');
    }

    if (!schedule.rows.length || schedule.totalMin <= 0) {
      canvas.innerHTML = `
        <div class="gantt-empty" dir="rtl">
          ${UI.icons.alert}
          <p>${schedule.rows.length
            ? 'هیچ قلم معتبری برای زمان‌بندی نیست — اقلام نامعتبر را در جدول اولویت‌بندی اصلاح کنید.'
            : 'قلمی برنامه‌ریزی نشده — رول یا لگ اضافه کنید تا گانت چارت ساخته شود.'}</p>
        </div>`;
      return;
    }

    /* --- ابعاد صفحهٔ نمایش (گانت ریسپانسیو) --- */
    const mobile = window.matchMedia('(max-width: 640px)').matches;
    const LABEL_W = mobile ? 118 : 158;      // عرض ستون لیبل (محور عمودی چپ)
    const availW = Math.max(200, (scroll.clientWidth || 640) - LABEL_W - 44);
    const minPxH = mobile ? 44 : 56;          // حداقل پیکسل بر ساعت (پس از آن اسکرول افقی)

    canvas.innerHTML = PlanningView.ganttInnerHtml(schedule, machine, {
      availW,
      labelW: LABEL_W,
      minPxH,
      zoom: PlanningView._zoom[m] || 1,
    });
  };

  /**
   * سازندهٔ خالص محتوای گانت (نسخهٔ ۳٫۴ — رفکتور · نسخهٔ ۳٫۵ — تغییر ۷):
   * همین سازنده هم برای رندر صفحه (ابعاد واکنش‌گرا + زوم کاربر) و هم برای
   * خروجی PDF استفاده می‌شود. در PDF می‌توان با opts.winStart/winEnd یک
   * «پنجرهٔ زمانی» مشخص کرد تا محتوای هر صفحهٔ A4 فقط همان بازه را نشان
   * دهد (مرز صفحات روی ساعت، با برچسب لبه‌ها برای تطبیق صفحات) — میله‌های
   * بین دو صفحه در مرز بریده و در هر صفحه بخشِ قابل‌مشاهده نشان داده می‌شود.
   * خروجی: HTML داخلی canvas.
   */
  PlanningView.ganttInnerHtml = function (schedule, machine, opts) {
    const LABEL_W = opts.labelW || 158;      // عرض ستون لیبل (محور عمودی چپ)
    const RULER_H = 34;
    const totalHours = schedule.totalMin / 60;
    // عرض در دسترس برای خودِ خط زمان (بدون ستون لیبل و حاشیهٔ پایان)
    const availW = Math.max(200, Number(opts.availW) || 640);
    const minPxH = Math.max(10, Number(opts.minPxH) || 56);
    const fitPxH = Math.max(minPxH, availW / Math.max(0.5, totalHours));
    const zoom = Number(opts.zoom) || 1;
    const pxh = fitPxH * zoom;

    /* --- پنجرهٔ زمانی (نسخهٔ ۳٫۵ — تغییر ۷): پیش‌فرض = کل برنامه --- */
    const scheduleEnd = schedule.startMin + schedule.totalMin;
    const winStart = Number.isFinite(opts.winStart) ? opts.winStart : schedule.startMin;
    const winEnd = Number.isFinite(opts.winEnd) ? opts.winEnd : scheduleEnd;
    const winMin = Math.max(0, winEnd - winStart);
    const windowed = winStart > schedule.startMin + 0.01 || winEnd < scheduleEnd - 0.01;
    const totalPx = Math.ceil((winMin / 60) * pxh) + 34;   // + حاشیهٔ انتهای پنجره

    // گام ساعت محور: در زوم‌های کوچک هر ۲/۳/۶/۱۲ ساعت (نسخهٔ ۳٫۵ — تغییر ۱۰:
    // با آزادشدن زوم تا ۰٫۲۲، گام‌های درشت‌تر هم لازم شد تا تیک‌ها روی هم نیفتند)
    const hourStep = pxh >= 50 ? 1 : pxh >= 25 ? 2 : pxh >= 14 ? 3 : pxh >= 8 ? 6 : 12;

    /* --- خط‌های ساعت (محور افقی بالا) — نسبی از ابتدای پنجرهٔ فعال --- */
    const ticks = [];
    for (let h = 0; h * 60 <= winMin + 0.01; h += hourStep) {
      const x = Math.round((h * 60 / 60) * pxh);
      const minute = winStart + h * 60;
      const isEnd = Math.abs(h * 60 - winMin) < 0.01;
      if (x > totalPx - 26 && !(isEnd && windowed)) continue;
      ticks.push(`<div class="gtick${h === 0 ? ' gtick-zero' : ''}" style="left:${x}px"><span>${RM.planning.faClock(minute)}</span></div>`);
    }
    // برچسب لبهٔ پایان پنجره: در حالت صفحه‌بندی همیشه (مرز تطبیق صفحات)؛
    // در نماهای تک‌پنجره فقط وقتی پایان روی ساعت نقطه‌ای نباشد (رفتار قبلی)
    const endX = Math.round((winMin / 60) * pxh);
    const onHour = Math.abs(winMin % 60) < 0.01;
    if (windowed || !onHour) {
      ticks.push(`<div class="gtick gtick-end" style="left:${endX}px"><span>${RM.planning.faClock(winEnd)}</span></div>`);
    }

    /* --- ردیف‌ها --- */
    const gridBg = `repeating-linear-gradient(to right, var(--gantt-grid) 0 1px, transparent 1px ${pxh}px)`;
    const rowsHtml = schedule.rows.map((row) => {
      const order = row.index + 1;
      const mainLabel = row.kind === 'roll'
        ? `عرض ${U.faWidth(row.setup ? row.setup.width : null)}`
        : U.escapeHtml(row.label);
      const subLabel = U.escapeHtml(row.subLabel || '');

      const label = `
        <div class="glabel" style="width:${LABEL_W}px">
          <span class="glabel-order">${U.faNum(order)}</span>
          <span class="glabel-main" dir="rtl" title="${U.escapeHtml(row.kind === 'roll' ? mainLabel : row.label)}">${mainLabel}</span>
          <span class="glabel-sub" dir="rtl">${subLabel}</span>
        </div>`;

      if (!row.valid) {
        return `
          <div class="grow grow-invalid">
            ${label}
            <div class="gtrack" style="width:${totalPx}px;background-image:${gridBg}">
              <span class="ginvalid" dir="rtl" title="${U.escapeHtml(row.invalidReason || 'نامعتبر')}">نامعتبر — خارج از زمان‌بندی</span>
            </div>
          </div>`;
      }

      /* بخش قابل‌مشاهدهٔ میله در پنجرهٔ فعال (نسخهٔ ۳٫۵ — تغییر ۷: مرز صفحات PDF) */
      const barStart = Math.max(row.startMin, winStart);
      const barEnd = Math.min(row.endMin, winEnd);
      if (windowed && (barEnd <= winStart + 0.01 || barStart >= winEnd - 0.01)) {
        // میلهٔ این قلم کاملاً بیرون از پنجرهٔ صفحه است — ردیف با گرید خالی
        return `
          <div class="grow kind-${row.kind}-row">
            ${label}
            <div class="gtrack" style="width:${totalPx}px;background-image:${gridBg}"></div>
          </div>`;
      }

      const x = Math.round(((barStart - winStart) / 60) * pxh);
      const rawW = ((barEnd - barStart) / 60) * pxh;
      const w = Math.max(7, Math.round(rawW));

      // متن روی میله بر اساس عرض موجود (نسخهٔ ۳٫۵ — تغییر ۱۰: زیر ۳۴px متن حذف
      // می‌شود تا در زوم‌های خیلی کم از میله بیرون نزند؛ جزئیات در tooltip)
      let barMain = '';
      let showEdges = false;
      let compact = false;
      let noText = false;
      if (row.kind === 'roll') {
        barMain = `${U.faNum(row.quantity)} رول · ${U.faHMM(row.durationMin)}`;
      } else {
        barMain = `${U.escapeHtml(row.title)} · ${U.faHMM(row.durationMin)}`;
      }
      if (w >= 180) showEdges = true;
      else if (w < 34) noText = true;
      else if (w < 78) compact = true;

      const compactText = row.kind === 'roll'
        ? `×${U.faNum(row.quantity)}`
        : U.faHMM(row.durationMin);

      const barTitle = row.kind === 'roll'
        ? `ستاپ ${U.faNum(row.setup.setupNumber)} · عرض ${U.faWidth(row.setup.width)} · ${U.faNum(row.quantity)} رول × ${U.faNumPlain(row.perRollMin)} دقیقه = ${U.faHMM(row.durationMin)} · از ${RM.planning.faStampWithDate(row.startMin, schedule.date)} تا ${RM.planning.faStampWithDate(row.endMin, schedule.date)}`
        : `${row.title} · ${U.faHMM(row.durationMin)} · از ${RM.planning.faStampWithDate(row.startMin, schedule.date)} تا ${RM.planning.faStampWithDate(row.endMin, schedule.date)}`;

      return `
        <div class="grow kind-${row.kind}-row">
          ${label}
          <div class="gtrack" style="width:${totalPx}px;background-image:${gridBg}">
            <div class="gantt-bar ${row.kind === 'roll' ? 'bar-roll' : 'bar-lag'}" style="left:${x}px;width:${w}px" title="${U.escapeHtml(barTitle)}">
              ${noText ? '' : `<span class="gbar-main" dir="rtl">${compact ? compactText : barMain}</span>`}
              ${showEdges ? `
                <span class="gbar-edge gbar-start" dir="ltr">${RM.planning.faClock(row.startMin)}</span>
                <span class="gbar-edge gbar-end" dir="ltr">${RM.planning.faClock(row.endMin)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    /* --- نشانگر «اکنون» (فقط برای امروز، در محدودهٔ پنجرهٔ فعال و با کلید نمایش — نسخهٔ ۳٫۳) --- */
    let nowHtml = '';
    const today = RM.planning.todayJalali();
    if (machine.showNow !== false && schedule.date === today) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= winStart && nowMin <= winEnd) {
        const nx = Math.round((nowMin - winStart) / 60 * pxh);
        nowHtml = `
          <div class="gantt-now" style="left:${LABEL_W + nx}px" title="لحظهٔ اکنون">
            <span class="gnow-label" dir="rtl">اکنون ${RM.planning.faClock(nowMin)}</span>
          </div>`;
      }
    }

    return `
      <div class="gantt-ruler-row" style="height:${RULER_H}px">
        <div class="gantt-corner" style="width:${LABEL_W}px" dir="rtl">قلم برنامه</div>
        <div class="gantt-ruler" style="width:${totalPx}px;background-image:${gridBg}">
          ${ticks.join('')}
        </div>
      </div>
      <div class="gantt-rows">
        ${rowsHtml}
      </div>
      ${nowHtml}
    `;
  };

  /* ================================================================
     ۸) خلاصهٔ زمان‌بندی (زیر هر چارت) — سازنده‌های خالص مشترک صفحه/PDF (۳٫۴)
     ================================================================ */

  /** چیپ‌های خلاصهٔ زمان‌بندی — خالص (مشترک صفحه و PDF) */
  PlanningView.summaryChipsHtml = function (schedule) {
    const s = schedule.stats;
    const lagShare = schedule.totalMin > 0 ? Math.round((s.lagMin / schedule.totalMin) * 100) : 0;
    return `
      <span class="chip chip-strong">تاریخ: ${U.faJalali(schedule.date)}${schedule.dateMode === 'auto' ? ' (امروز — خودکار)' : ' (ثابت)'}</span>
      <span class="chip">شروع: ${RM.planning.faClock(schedule.startMin)}</span>
      <span class="chip chip-ok">پایان: ${RM.planning.faStampWithDate(schedule.endMin, schedule.date)}</span>
      <span class="chip chip-strong">زمان کل: ${U.faHMM(schedule.totalMin)}</span>
      <span class="chip">رول‌ها: ${U.faNum(s.rollItems)} قلم · ${U.faNum(s.rollQty)} عدد · ${U.faHMM(s.rollMin)}</span>
      <span class="chip chip-warn">لگ‌ها: ${U.faNum(s.lagItems)} قلم · ${U.faHMM(s.lagMin)} (${U.faNum(lagShare)}٪ از کل)</span>
      ${s.invalid ? `<span class="chip chip-warn" title="اقلام نامعتبر از زمان‌بندی کنار گذاشته شده‌اند">⚠ ${U.faNum(s.invalid)} قلم نامعتبر</span>` : ''}`;
  };

  /** جدول زمان‌بندی کامل هر قلم — خالص (مشترک صفحه و PDF — نسخهٔ ۳٫۳/۳٫۴)
   *  نسخهٔ ۳٫۵ — تغییر ۷: opts.rows = زیرمجموعهٔ ردیف‌ها (صفحه‌بندی جدول در PDF
   *  چندصفحه‌ای) و opts.isLastTable = نمایش ردیف جمع فقط در آخرین قسمت. */
  PlanningView.schedTableHtml = function (schedule, opts = {}) {
    const tableRows = Array.isArray(opts.rows) ? opts.rows : schedule.rows;
    const isLast = opts.isLastTable !== false;
    const rowsHtml = tableRows.map((row) => `
      <tr class="${row.valid ? '' : 'invalid'}">
        <td class="sched-ord">${U.faNum(row.index + 1)}</td>
        <td><span class="kind-badge ${row.kind === 'roll' ? 'kb-roll' : 'kb-lag'}">${row.kind === 'roll' ? 'رول' : 'لگ'}</span></td>
        <td class="sched-title">${row.kind === 'roll'
          ? (row.setup
              ? `عرض ${U.faWidth(row.setup.width)} — ستاپ ${U.faNum(row.setup.setupNumber)} (${U.faNum(row.setup.standardLength)} متر)`
              : 'رکورد حذف‌شده')
          : U.escapeHtml(row.label)}</td>
        <td>${row.kind === 'roll' && row.valid ? U.faNum(row.quantity) : '—'}</td>
        <td>${row.valid ? U.faHMM(row.durationMin) : `<span class="pi-invalid-reason">${U.escapeHtml(row.invalidReason || 'نامعتبر')}</span>`}</td>
        <td class="sched-start">${row.valid ? RM.planning.faStampWithDate(row.startMin, schedule.date) : '—'}</td>
        <td class="sched-end">${row.valid ? PlanningView.faEndStamp(row.endMin, schedule.date) : '—'}</td>
      </tr>`).join('');

    return `
      <table class="plan-sched-table cut-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">نوع</th>
            <th scope="col">عنوان / عرض</th>
            <th scope="col">تعداد</th>
            <th scope="col">مدت</th>
            <th scope="col">شروع</th>
            <th scope="col">پایان</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        ${isLast ? `
        <tfoot>
          <tr>
            <td colspan="4">جمع کل (اقلام معتبر: ${U.faNum(schedule.rows.length - schedule.invalidCount)} از ${U.faNum(schedule.rows.length)})</td>
            <td>${U.faHMM(schedule.totalMin)}</td>
            <td>${RM.planning.faClock(schedule.startMin)}</td>
            <td>${PlanningView.faEndStamp(schedule.endMin, schedule.date)}</td>
          </tr>
        </tfoot>` : ''}
      </table>${opts.pdf ? '' : `
      <p class="field-hint">هر قلم بلافاصله پس از پایان قلم قبلی شروع می‌شود (زنجیرهٔ پیوسته) · مدت رول‌ها = تعداد × مدت قانون زمان دستگاهِ رکورد · زمان‌های روزهای بعد با <b>تاریخ شمسی دقیق همان روز</b> (مثل ۱۴۰۵/۰۶/۲۹ ۱۷:۳۵) نمایش داده می‌شوند.</p>`}`;
  };

  PlanningView.renderSummary = function () {
    const chipsEl = document.getElementById('plan-summary-chips');
    const schedWrap = document.getElementById('plan-sched-wrap');
    if (!chipsEl || !schedWrap) return;

    const m = PlanningView._machine;
    const machine = PlanningView.machine();
    const schedule = RM.planning.buildSchedule(machine, PlanningView._state, m);

    if (!schedule.rows.length) {
      chipsEl.innerHTML = `<span class="chip">قلمی ثبت نشده</span>`;
      schedWrap.innerHTML = '';
      return;
    }

    chipsEl.innerHTML = PlanningView.summaryChipsHtml(schedule);
    schedWrap.innerHTML = PlanningView.schedTableHtml(schedule);
  };

  /* ================================================================
     ۹) خروجی PDF گانت چارت (نسخهٔ ۳٫۴ → بازطراحی کامل نسخهٔ ۳٫۵ — تغییر ۷ و ۸)
        دکمهٔ «خروجی PDF» در هدر هر گانت: چارت دستگاه + جدول خلاصهٔ زمان‌بندی
        در صفحات «A4 افقی استاندارد» با تم روشن ثابت و طراحی اختصاصی.

        سیاست نسخهٔ ۳٫۵ (جایگزین «همه‌چیز در یک صفحه با کوچک‌نمایی»):
          · مقیاس استاندارد و خوانا — حداقل ۴۶ پیکسل بر ساعت، بدون فشرده‌سازی
          · برنامهٔ کوتاه (تا ~۲۸٫۸ ساعت): یک صفحه با مقیاس فیت (مانند صفحهٔ نمایش)
          · برنامهٔ بلندتر → چند صفحهٔ استاندارد:
              - مرز صفحات روی ساعت‌های صحیح (پنجرهٔ زمانی هر صفحه)
              - برچسب ساعت در دو لبهٔ هر صفحه → تطبیق آسان صفحات کنار هم
              - تکرار ستون «قلم برنامه» (لیبل‌ها) در هر صفحه
              - میله‌های بین دو صفحه در مرز بریده و بخشِ قابل‌مشاهده نمایش داده می‌شود
              - نوار «ادامه» در صفحات میانی + بازهٔ زمانی هر صفحه
              - جدول خلاصه در صفحه(های) پایانی با تکرار سرستون‌ها
        رفع‌های نسخهٔ ۳٫۵ — تغییر ۸:
          · حذف letter-spacing در PDF (شکستن اتصال حروف فارسی در html2canvas)
          · استریپ لگ با SVG data-URI (repeating-linear-gradient پشتیبانی نمی‌شود)
          · برندینگ: «سامانه مانیتورینگ متالایز» + لوگوی پروژه
        مسیر: استیج مخفی (چند .pp-page با ارتفاع ثابت A4) → html2canvas هر صفحه
        → jsPDF → save.
     ================================================================ */

  /** ابعاد صفحهٔ PDF (px) — نسبت A4 افقی ۲۹۷:۲۱۰ */
  PlanningView.PDF_PAGE_W = 1580;
  PlanningView.PDF_PAGE_H = 1117;

  /* بودجه‌های چیدمان عمودی (px) — برآورد محافظه‌کارانه تا محتوا سرریز نشود */
  PlanningView.PDF_BUDGET = {
    head: 214,        // هدر برندینگ کامل (صفحهٔ اول)
    contStrip: 70,    // نوار «ادامه» (صفحات میانی)
    ganttPad: 30,     // padding بخش گانت + لِجند
    ruler: 36,
    row: 47,          // ارتفاع هر ردیف گانت (۴۶ + خط جداکننده)
    legend: 30,
    sumTitle: 34,
    chips: 48,
    tblHead: 32,
    tblRow: 38,
    tblFoot: 48,
    foot: 66,
  };

  /** عرض خط زمان در PDF (px) — مفید منهای لیبل و حاشیهٔ پایان */
  PlanningView.pdfAxisWidth = function () {
    return PlanningView.PDF_PAGE_W - 72 - 150 - 34;   // ۱۳۲۴
  };

  /** مقیاس استاندارد PDF (px بر ساعت): فیت تا حداقلِ خوانای ۴۶ — بدون فشرده‌سازی */
  PlanningView.pdfGanttPxH = function (schedule) {
    const axisW = PlanningView.pdfAxisWidth();
    return Math.max(46, axisW / Math.max(0.5, schedule.totalMin / 60));
  };

  /** پنجره‌های زمانی صفحات (نسخهٔ ۳٫۵ — تغییر ۷): مرز روی ساعت‌های صحیح */
  PlanningView.pdfTimeWindows = function (schedule, pxh) {
    const axisW = PlanningView.pdfAxisWidth();
    const start = schedule.startMin;
    const end = start + schedule.totalMin;
    const totalPx = (schedule.totalMin / 60) * pxh;
    if (totalPx <= axisW + 2) {
      return [{ from: start, to: end }];   // کل برنامه در یک صفحه (مقیاس فیت ≥ ۴۶)
    }
    const winMin = Math.max(1, Math.floor(axisW / pxh)) * 60;   // ≥ ۱ ساعت در هر صفحه (محافظ)
    const wins = [];
    for (let s = start; s < end - 0.01; s += winMin) {
      wins.push({ from: s, to: Math.min(s + winMin, end) });
    }
    return wins;
  };

  /** بخش‌بندی ردیف‌های گانت برای صفحات (صفحهٔ اول جای کمتری دارد) */
  PlanningView.pdfRowChunks = function (schedule) {
    const B = PlanningView.PDF_BUDGET;
    const pageH = PlanningView.PDF_PAGE_H;
    const n1 = Math.floor((pageH - B.head - B.ganttPad - B.ruler - B.legend - B.foot - 8) / B.row);
    const nc = Math.floor((pageH - B.contStrip - B.ganttPad - B.ruler - B.legend - B.foot - 8) / B.row);
    const rows = schedule.rows;
    if (!rows.length || rows.length <= n1) return [rows];
    const chunks = [];
    let rest = rows.slice();
    chunks.push(rest.slice(0, n1));
    rest = rest.slice(n1);
    while (rest.length) {
      chunks.push(rest.slice(0, nc));
      rest = rest.slice(nc);
    }
    return chunks;
  };

  /** آیا کل سند در یک صفحه جا می‌شود؟ (گانت + خلاصه + جدول با هم) */
  PlanningView.pdfFitsSinglePage = function (schedule, windows) {
    if (windows.length !== 1) return false;
    const B = PlanningView.PDF_BUDGET;
    const n = schedule.rows.length;
    const used = B.head + B.ganttPad + B.ruler + n * B.row + B.legend
      + B.sumTitle + B.chips + B.tblHead + n * B.tblRow + B.tblFoot + B.foot + 24;
    return used <= PlanningView.PDF_PAGE_H;
  };

  /** تکه‌های جدول خلاصه برای صفحات پایانی (با تکرار سرستون‌ها) */
  PlanningView.pdfTableChunks = function (schedule) {
    const B = PlanningView.PDF_BUDGET;
    const per = Math.floor(
      (PlanningView.PDF_PAGE_H - B.contStrip - B.sumTitle - B.chips - B.tblHead - B.tblFoot - B.foot - 28)
      / B.tblRow
    );
    const rows = schedule.rows;
    if (per <= 0 || rows.length <= per) return [rows];
    const chunks = [];
    for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per));
    return chunks;
  };

  /** برنامهٔ صفحات PDF: ترتیب و نوع صفحات + پنجره/ردیف‌های هر صفحه */
  PlanningView.pdfPagePlan = function (schedule) {
    const pxh = PlanningView.pdfGanttPxH(schedule);
    const windows = PlanningView.pdfTimeWindows(schedule, pxh);
    const rowChunks = PlanningView.pdfRowChunks(schedule);
    const pages = [];

    if (PlanningView.pdfFitsSinglePage(schedule, windows)) {
      pages.push({ kind: 'full', rows: schedule.rows, win: windows[0] });
      return { pages, pxh, windows };
    }

    // صفحات گانت: هر بخش ردیف × هر پنجرهٔ زمانی
    for (let ci = 0; ci < rowChunks.length; ci++) {
      for (let wi = 0; wi < windows.length; wi++) {
        pages.push({
          kind: (ci === 0 && wi === 0) ? 'first' : 'cont',
          rows: rowChunks[ci],
          win: windows[wi],
          wi,
          multiWin: windows.length > 1,
        });
      }
    }

    // صفحات خلاصه (چیپ‌ها فقط در اولین صفحهٔ خلاصه + جدول با تکرار سرستون)
    const tChunks = PlanningView.pdfTableChunks(schedule);
    for (let ti = 0; ti < tChunks.length; ti++) {
      pages.push({
        kind: 'summary',
        rows: tChunks[ti],
        withChips: ti === 0,
        isLastTable: ti === tChunks.length - 1,
      });
    }
    return { pages, pxh, windows };
  };

  /** برندینگ مشترک (نسخهٔ ۳٫۶ — تغییر ۴: لوگوی SVG به‌صورت data-URI ثابت)
   *
   *  ریشهٔ خطای «ساخت PDF با خطا مواجه شد» در نسخهٔ ۳٫۵ پیدا شد: در اجرای
   *  آفلاین ZIP (پروتکل file://) عامل‌ها:
   *    ۱) fetch('lib/logo.png') در file:// توسط مرورگر مسدود می‌شود →
   *       fallback به src نسبی می‌رفت؛
   *    ۲) رسم تصویر file:// روی canvas در Chrome باعث آلودگی (Taint) canvas
   *       می‌شود → canvas.toDataURL() با SecurityError شکست می‌خورد.
   *  راه‌حل: لوگوی SVG پروژه (monitor.svg) با ابعاد ذاتی، یک‌بار به base64
   *  تبدیل و به‌صورت ثابت داخل کد جاسازی شد — data-URI همیشه same-origin
   *  است، canvas را آلوده نمی‌کند و در http و file:// یکسان کار می‌کند؛
   *  بدون هیچ fetch یا وابستگی به فایل خارجی. */
  PlanningView.LOGO_DATA_URI =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTQ0IiBoZWlnaHQ9IjE0NCIgaWQ9ImU0ZTc2NGNkLTJlNzMtNDcyZi1iODhhLWJmOGJmYzJjMjk5NCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMTggMTgiPjxkZWZzPjxyYWRpYWxHcmFkaWVudCBpZD0iYWM4YjMyZGEtMzBjYS00YjkyLThkMGYtOGQyZDVlZjI3OGEwIiBjeD0iNS43MiIgY3k9IjcuNDUiIHI9IjguNDIiIGdyYWRpZW50VHJhbnNmb3JtPSJ0cmFuc2xhdGUoMy4yMyAxLjUxKSBzY2FsZSgxLjAxIDEuMDEpIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agb2Zmc2V0PSIwLjE4IiBzdG9wLWNvbG9yPSIjNWVhMGVmIi8+PHN0b3Agb2Zmc2V0PSIwLjU2IiBzdG9wLWNvbG9yPSIjNWM5ZmVlIi8+PHN0b3Agb2Zmc2V0PSIwLjY5IiBzdG9wLWNvbG9yPSIjNTU5Y2VkIi8+PHN0b3Agb2Zmc2V0PSIwLjc4IiBzdG9wLWNvbG9yPSIjNGE5N2U5Ii8+PHN0b3Agb2Zmc2V0PSIwLjg2IiBzdG9wLWNvbG9yPSIjMzk5MGU0Ii8+PHN0b3Agb2Zmc2V0PSIwLjkzIiBzdG9wLWNvbG9yPSIjMjM4N2RlIi8+PHN0b3Agb2Zmc2V0PSIwLjk5IiBzdG9wLWNvbG9yPSIjMDg3YmQ2Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDA3OGQ0Ii8+PC9yYWRpYWxHcmFkaWVudD48cmFkaWFsR3JhZGllbnQgaWQ9ImE5OTU0ODIwLWNiMzgtNDk0My05ODQyLWYwYTU2OGQyYjAxNSIgY3g9IjI4LjE4IiBjeT0iMjAyLjI5IiByPSIyLjciIGdyYWRpZW50VHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTE3Ljc3IC0xODUuMDEpIHNjYWxlKDAuOTUpIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agb2Zmc2V0PSIwLjE5IiBzdG9wLWNvbG9yPSIjOGM4ZTkwIi8+PHN0b3Agb2Zmc2V0PSIwLjM1IiBzdG9wLWNvbG9yPSIjODQ4Njg4Ii8+PHN0b3Agb2Zmc2V0PSIwLjYiIHN0b3AtY29sb3I9IiM2ZTcwNzEiLz48c3RvcCBvZmZzZXQ9IjAuOTEiIHN0b3AtY29sb3I9IiM0YTRiNGMiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMzZTNmM2YiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48dGl0bGU+SWNvbi1tYW5hZ2UtMzE3PC90aXRsZT48ZWxsaXBzZSBjeD0iOSIgY3k9IjkiIHJ4PSI4LjUiIHJ5PSI4LjQ3IiBmaWxsPSJ1cmwoI2FjOGIzMmRhLTMwY2EtNGI5Mi04ZDBmLThkMmQ1ZWYyNzhhMCkiLz48ZWxsaXBzZSBjeD0iOSIgY3k9IjkiIHJ4PSI3LjQiIHJ5PSI3LjM3IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTIuNzIsOS40NGE2LjI0LDYuMjQsMCwwLDAsMS44Miw0bDItMmEzLjUzLDMuNTMsMCwwLDEtMS0yWiIgZmlsbD0iIzljZWJmZiIvPjxwYXRoIGQ9Ik0xMy4xMyw0LjI3QTYuMjUsNi4yNSwwLDAsMCw5LjQ0LDIuNzRWNS41M2EzLjQxLDMuNDEsMCwwLDEsMS43MS43WiIgZmlsbD0iIzMyYmVkZCIvPjxwYXRoIGQ9Ik00Ljg3LDQuMjdsMiwyYTMuNDEsMy40MSwwLDAsMSwxLjcxLS43VjIuNzRBNi4yNSw2LjI1LDAsMCwwLDQuODcsNC4yN1oiIGZpbGw9IiMzMmJlZGQiLz48cGF0aCBkPSJNMTEuNzgsNi44NWEzLjYsMy42LDAsMCwxLC43MSwxLjcxaDIuNzlhNi4xNiw2LjE2LDAsMCwwLTEuNTMtMy42N1oiIGZpbGw9IiMzMmJlZGQiLz48cGF0aCBkPSJNNi4yMiw2Ljg1bC0yLTJBNi4xNiw2LjE2LDAsMCwwLDIuNzIsOC41Nkg1LjUxQTMuNiwzLjYsMCwwLDEsNi4yMiw2Ljg1WiIgZmlsbD0iIzUwZTZmZiIvPjxwYXRoIGQ9Ik0xNC4xNCw3YS40NS40NSwwLDAsMC0uNTctLjI1TDkuNDUsOC40MWwuMzIuODEsNC4xMi0xLjYzQS40NC40NCwwLDAsMCwxNC4xNCw3WiIgZmlsbD0iI2YwNDA0OSIvPjxlbGxpcHNlIGN4PSI5IiBjeT0iOSIgcng9IjEuMiIgcnk9IjEuMiIgZmlsbD0idXJsKCNhOTk1NDgyMC1jYjM4LTQ5NDMtOTg0Mi1mMGE1NjhkMmIwMTUpIi8+PC9zdmc+';

  PlanningView.logoDataUri = function () {
    return PlanningView.LOGO_DATA_URI;
  };

  /** ساخت HTML برندینگ با لوگوی data-URI (async به‌دلیل بارگذاری لوگو) */
  PlanningView.pdfBrandHtml = async function () {
    const logo = await PlanningView.logoDataUri();
    return `
      <div class="pp-brand">
        <span class="pp-logo" aria-hidden="true"><img src="${logo}" alt=""></span>
        <span class="pp-brand-text">سامانه مانیتورینگ متالایز <span class="pp-brand-sub">· برنامه‌ریزی زمان‌بندی</span></span>
      </div>`;
  };

  /** هدر کامل صفحهٔ اول */
  PlanningView.pdfHeadHtml = async function (schedule) {
    const m = PlanningView._machine;
    const s = schedule.stats;
    const dateLabel = `${U.faJalali(schedule.date)}${schedule.dateMode === 'auto' ? ' (امروز — خودکار)' : ' (ثابت)'}`;
    return `
      <header class="pp-head">
        <div class="pp-head-row">
          ${await PlanningView.pdfBrandHtml()}
          <span class="pp-gen">تولید: ${U.faDate(Date.now())}</span>
        </div>
        <h1 class="pp-title">گانت چارت زمان‌بندی — دستگاه ${U.faNum(m)}</h1>
        <div class="pp-meta">
          <span class="pp-meta-item">تاریخ چارت: <b>${dateLabel}</b></span>
          <span class="pp-meta-item">شروع: <b>${RM.planning.faClock(schedule.startMin)}</b></span>
          <span class="pp-meta-item">پایان: <b>${RM.planning.faStampWithDate(schedule.endMin, schedule.date)}</b></span>
          <span class="pp-meta-item">زمان کل: <b>${U.faHMM(schedule.totalMin)}</b></span>
          <span class="pp-meta-item">رول‌ها: <b>${U.faNum(s.rollItems)} قلم / ${U.faNum(s.rollQty)} عدد</b></span>
          <span class="pp-meta-item">لگ‌ها: <b>${U.faNum(s.lagItems)} قلم / ${U.faHMM(s.lagMin)}</b></span>
        </div>
      </header>`;
  };

  /** نوار فشردهٔ صفحات میانی/پایانی (برند + عنوان + بازهٔ صفحه) */
  PlanningView.pdfContStripHtml = async function (title, rangeHtml) {
    const logo = await PlanningView.logoDataUri();
    return `
      <div class="pp-cont">
        <img src="${logo}" class="pp-cont-logo" alt="">
        <b class="pp-cont-title">${title}</b>
        ${rangeHtml ? `<span class="pp-cont-range">${rangeHtml}</span>` : ''}
      </div>`;
  };

  /** بخش گانت یک صفحه (پنجرهٔ زمانی + زیرمجموعهٔ ردیف‌ها) */
  PlanningView.pdfGanttSectionHtml = function (schedule, machine, rows, win, pxh) {
    const subSchedule = rows === schedule.rows ? schedule : { ...schedule, rows };
    const ganttHtml = PlanningView.ganttInnerHtml(subSchedule, machine, {
      availW: PlanningView.pdfAxisWidth(),
      labelW: 150,
      minPxH: 46,          // مقیاس استاندارد — fitPxH همین مقدار یا فیتِ عرض صفحه
      zoom: 1,
      winStart: win.from,
      winEnd: win.to,
    });
    return `
      <section class="pp-gantt">
        <div class="gantt-scroll pp-gantt-scroll" dir="ltr">
          <div class="gantt-canvas">${ganttHtml}</div>
        </div>
        <p class="pp-legend">
          <span class="lg-item"><span class="lg-swatch lg-roll" aria-hidden="true"></span> رول (تعداد و زمان روی میله)</span>
          <span class="lg-item"><span class="lg-swatch lg-lag" aria-hidden="true"></span> لگ / توقف</span>
          ${machine.showNow !== false && schedule.date === RM.planning.todayJalali()
            ? '<span class="lg-item"><span class="lg-swatch lg-now" aria-hidden="true"></span> لحظهٔ اکنون</span>'
            : ''}
          <span class="lg-item"><span class="lg-swatch lg-boundary" aria-hidden="true"></span> مرز صفحه (ساعت لبه‌ها)</span>
        </p>
      </section>`;
  };

  /** فوتر مشترک همهٔ صفحات — برند + شمارهٔ صفحه (+ توضیح صفحه) */
  PlanningView.pdfFootHtml = function (pageNum, totalPages, note) {
    return `
      <footer class="pp-foot">
        <span>سامانه مانیتورینگ متالایز · نسخهٔ ۳٫۲۳</span>
        <span>${note ? `${note} · ` : ''}صفحهٔ ${U.faNum(pageNum)} از ${U.faNum(totalPages)}</span>
      </footer>`;
  };

  /** HTML کامل یک صفحهٔ PDF بر اساس برنامهٔ صفحه (تم روشن ثابت — مستقل از تم) */
  PlanningView.pdfPageHtml = async function (schedule, machine, page, pageNum, totalPages) {
    const m = PlanningView._machine;

    /* — صفحهٔ «همه‌چیز در یک صفحه» (برنامهٔ کوتاه) — */
    if (page.kind === 'full') {
      return `
        <div class="pp-page" dir="rtl">
          ${await PlanningView.pdfHeadHtml(schedule)}
          ${PlanningView.pdfGanttSectionHtml(schedule, machine, page.rows, page.win, null)}
          <section class="pp-summary">
            <h2 class="pp-sec-title">خلاصهٔ زمان‌بندی دستگاه ${U.faNum(m)}</h2>
            <div class="pp-chips">${PlanningView.summaryChipsHtml(schedule)}</div>
            ${PlanningView.schedTableHtml(schedule, { pdf: true })}
          </section>
          ${PlanningView.pdfFootHtml(pageNum, totalPages)}
        </div>`;
    }

    /* — صفحهٔ اولِ سند چندصفحه‌ای (هدر کامل + گانت پنجرهٔ ۱) — */
    if (page.kind === 'first') {
      const range = `بازهٔ این صفحه: ${RM.planning.faClock(page.win.from)} تا ${RM.planning.faStampWithDate(page.win.to, schedule.date)}`;
      return `
        <div class="pp-page" dir="rtl">
          ${await PlanningView.pdfHeadHtml(schedule)}
          ${PlanningView.pdfGanttSectionHtml(schedule, machine, page.rows, page.win, null)}
          ${PlanningView.pdfFootHtml(pageNum, totalPages, page.multiWin ? range : '')}
        </div>`;
    }

    /* — صفحهٔ ادامهٔ گانت (نوار فشرده + پنجرهٔ زمانی) — */
    if (page.kind === 'cont') {
      const range = `بازهٔ این صفحه: ${RM.planning.faClock(page.win.from)} تا ${RM.planning.faStampWithDate(page.win.to, schedule.date)}`;
      return `
        <div class="pp-page" dir="rtl">
          ${await PlanningView.pdfContStripHtml(`ادامهٔ گانت چارت زمان‌بندی — دستگاه ${U.faNum(m)}`, range)}
          ${PlanningView.pdfGanttSectionHtml(schedule, machine, page.rows, page.win, null)}
          ${PlanningView.pdfFootHtml(pageNum, totalPages, range)}
        </div>`;
    }

    /* — صفحهٔ خلاصه (چیپ‌ها + جدول با تکرار سرستون‌ها) — */
    return `
      <div class="pp-page" dir="rtl">
        ${await PlanningView.pdfContStripHtml(`خلاصهٔ زمان‌بندی — دستگاه ${U.faNum(m)}`, '')}
        <section class="pp-summary pp-summary-page">
          <h2 class="pp-sec-title">خلاصهٔ زمان‌بندی دستگاه ${U.faNum(m)}</h2>
          ${page.withChips ? `<div class="pp-chips">${PlanningView.summaryChipsHtml(schedule)}</div>` : ''}
          ${PlanningView.schedTableHtml(schedule, { pdf: true, rows: page.rows, isLastTable: page.isLastTable })}
          ${page.isLastTable ? '' : '<p class="pp-tbl-more">ادامهٔ جدول در صفحهٔ بعد ←</p>'}
        </section>
        ${PlanningView.pdfFootHtml(pageNum, totalPages, page.isLastTable ? '' : 'ادامهٔ جدول در صفحهٔ بعد')}
      </div>`;
  };

  /** ساخت و دانلود PDF گانت + خلاصهٔ زمان‌بندی دستگاه فعال
   *  (نسخهٔ ۳٫۵ — چندصفحه‌ای استاندارد A4 افقی) */
  PlanningView.exportGanttPdf = async function () {
    const machine = PlanningView.machine();
    const schedule = RM.planning.buildSchedule(machine, PlanningView._state, PlanningView._machine);

    if (!schedule.rows.length || schedule.totalMin <= 0) {
      UI.toast('برنامه‌ای برای خروجی گرفتن نیست — ابتدا رول یا لگ به دستگاه اضافه کنید.', 'warning');
      return;
    }

    const btn = document.getElementById('plan-gantt-pdf');
    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'در حال ساخت PDF…';
    }

    const stage = document.getElementById('plan-pdf-stage');
    try {
      if (!stage) throw new Error('pdf stage not found');
      if (typeof window.html2canvas !== 'function' || !window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('pdf libraries not loaded');
      }

      // برنامهٔ صفحات (تک‌صفحه‌ای یا چندصفحه‌ای با مرز ساعتی)
      const plan = PlanningView.pdfPagePlan(schedule);
      const totalPages = plan.pages.length;

      // ساخت استیج + انتظار برای چیدمان، فونت‌ها و لوگو
      const pagesHtml = [];
      for (let i = 0; i < plan.pages.length; i++) {
        pagesHtml.push(await PlanningView.pdfPageHtml(schedule, machine, plan.pages[i], i + 1, totalPages));
      }
      stage.innerHTML = pagesHtml.join('');
      stage.hidden = false;
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) { /* noop */ }
      }
      await Promise.all(
        [...stage.querySelectorAll('img')].map((img) =>
          img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; }))
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // رندر هر صفحه و افزودن به PDF (A4 افقی — تصویر تمام‌صفحه)
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const PAGE_W = 297;
      const PAGE_H = 210;
      const pages = [...stage.querySelectorAll('.pp-page')];

      for (let i = 0; i < pages.length; i++) {
        const canvas = await window.html2canvas(pages[i], {
          scale: 2,
          backgroundColor: '#ffffff',
          logging: false,
          useCORS: true,
        });
        if (!canvas.width || !canvas.height) throw new Error('empty canvas');
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const ratio = canvas.height / canvas.width;
        let w = PAGE_W;
        let h = PAGE_W * ratio;
        let x = 0;
        let y = 0;
        if (h > PAGE_H) {          // نگه‌داشتن نسبت A4 — تصویر تمام‌صفحه
          h = PAGE_H;
          w = PAGE_H / ratio;
          x = (PAGE_W - w) / 2;
        }
        if (i > 0) pdf.addPage('a4', 'landscape');
        pdf.addImage(imgData, 'JPEG', x, y, w, h, undefined, 'FAST');
      }

      const m = PlanningView._machine;
      const stamp = (schedule.date || '').replace(/\//g, '-');
      pdf.save(`برنامه-ریزی-دستگاه-${m}-${stamp}.pdf`);
      UI.toast(
        totalPages === 1
          ? `خروجی PDF دستگاه ${U.faNum(m)} ساخته شد — یک صفحهٔ A4 افقی (گانت + جدول خلاصه).`
          : `خروجی PDF دستگاه ${U.faNum(m)} ساخته شد — ${U.faNum(totalPages)} صفحهٔ A4 افقی استاندارد (مرز صفحات روی ساعت).`,
        'success', 4600
      );
    } catch (err) {
      console.error('[GanttPDF]', err);
      const reason = (err && err.message) ? String(err.message).slice(0, 90) : 'خطای ناشناخته';
      UI.toast(`ساخت PDF با خطا مواجه شد (${reason}) — صفحه را نوسازی کنید و دوباره تلاش کنید.`, 'error', 6500);
    } finally {
      if (stage) {
        stage.innerHTML = '';
        stage.hidden = true;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btnHtml;
      }
    }
  };

  /* ================================================================
     ۹) ذخیره‌سازی
     ================================================================ */

  PlanningView.persist = async function () {
    await RM.planning.save(PlanningView._board);
  };

  RM.views = RM.views || {};
  RM.views.planning = PlanningView;
})();
