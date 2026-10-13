/* =========================================================================
   views/settings.js — نما تنظیمات (§15-§18، §61-§63، §12، §60)
   -------------------------------------------------------------------------
   بخش‌ها:
     ۱) مدیریت قوانین متراژ استاندارد (CRUD + اعتبارسنجی هم‌پوشانی)
     ۲) پشتیبان‌گیری / بازیابی (Backup / Restore با تأیید §70)
     ۳) مدیریت داده‌ها (پاک‌سازی Datasetها)
     ۴) اطلاعات Importها (سابقه + نسخه‌بندی §60)
     ۵) مرتب‌سازی پیش‌فرض (اطلاع + بازنشانی)
     + هشدار مهم Backup (§62)
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const Rules = RM.rulesEngine;
  const Backup = RM.backupEngine;
  const db = RM.db.db;

  const SettingsView = {};

  /** تعداد رکوردهای پیش‌فرض سابقهٔ Import (قابل توسعه توسط کاربر) */
  const HISTORY_PAGE = 5;

  /* ================================================================
     ۱) راه‌اندازی
     ================================================================ */

  SettingsView.init = function () {
    // فرم قانون متراژ
    document.getElementById('rule-form').addEventListener('submit', (e) => {
      e.preventDefault();
      SettingsView.saveRule();
    });
    document.getElementById('rule-cancel-edit').addEventListener('click', () => {
      SettingsView.resetRuleForm();
    });

    // فرم قانون زمان متالایز (تغییرات جدید)
    document.getElementById('machine-time-form').addEventListener('submit', (e) => {
      e.preventDefault();
      SettingsView.saveTimeRule();
    });
    document.getElementById('mt-cancel-edit').addEventListener('click', () => {
      SettingsView.resetTimeRuleForm();
    });
    document.getElementById('mt-qty').addEventListener('input', () => SettingsView.updateDurationPreview());

    // Backup
    document.getElementById('btn-backup-export').addEventListener('click', SettingsView.exportBackup);
    document.getElementById('file-restore').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        SettingsView.restoreBackup(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('btn-restore-pick').addEventListener('click', () => {
      document.getElementById('file-restore').click();
    });

    // ۳٫۳۶ — اسکن داده‌های قدیمی (بازیابی هوشمند) + وضعیت پشتیبان خودکار
    const scanBtn = document.getElementById('btn-recovery-scan');
    if (scanBtn) scanBtn.addEventListener('click', () => { RM.recovery.rescan(); });

    // مدیریت داده‌ها (عناوین کاربرپسنده — نام فنی فقط برای Audit)
    document.getElementById('btn-clear-rolls').addEventListener('click', () =>
      SettingsView.clearDataset('rolls', 'رول‌های موجود', 'rolls'));
    document.getElementById('btn-clear-archived').addEventListener('click', () =>
      SettingsView.clearDataset('archived', 'سابقه رول‌ها (آرشیو)', 'archivedRolls'));

    document.getElementById('btn-clear-all').addEventListener('click', SettingsView.clearEverything);

    // انتخاب تم (روشن/تاریک) — بدون تغییر در تم روشن فعلی
    SettingsView.initThemePicker();

    // حداکثر فاصلهٔ مجاز بین تولید و برش (نسخهٔ ۳٫۵ — تغییر ۹)
    SettingsView.initAllowedCutHours();
  };

  /* ================================================================
     ۱-پ) حداکثر فاصلهٔ مجاز بین تولید و برش (نسخهٔ ۳٫۵ — تغییر ۹)
     یک عدد ساعت — بالای صفحهٔ تنظیمات کنار کادر تم. خالی = کنترل غیرفعال.
     مبنای هشدار «رول‌های متالایزشدهٔ برش‌نشده» در مرکز هشدار داشبورد.
     ================================================================ */

  SettingsView.initAllowedCutHours = async function () {
    const input = document.getElementById('allowed-cut-hours');
    const stateEl = document.getElementById('allowed-cut-hours-state');
    const errEl = document.getElementById('err-allowed-cut-hours');
    if (!input) return;

    const saved = await RM.db.getSetting('allowedProductionToCutHours', 24);
    const savedNum = Number(saved);
    input.value = (saved === null || saved === undefined || saved === '' || !Number.isFinite(savedNum))
      ? ''
      : U.toFaDigits(String(savedNum));

    const paintState = () => {
      const v = U.parseInt(input.value);
      if (input.value.trim() === '') {
        stateEl.textContent = 'خالی — کنترل مهلت تولید تا برش غیرفعال است.';
        stateEl.style.color = 'var(--text-faint)';
      } else if (v === null || v <= 0) {
        stateEl.textContent = 'عدد نامعتبر — فقط یک عدد صحیح مثبت (ساعت) مثلاً ۲۴.';
        stateEl.style.color = 'var(--danger-text, #b91c1c)';
      } else {
        stateEl.textContent = `فعال — رول‌های متالایزشدهٔ برش‌نشده پس از ${U.faNum(v)} ساعت از تولید، هشدار می‌گیرند.`;
        stateEl.style.color = 'var(--setup)';
      }
    };
    paintState();

    input.addEventListener('input', paintState);

    input.addEventListener('change', async () => {
      errEl.hidden = true;
      const raw = input.value.trim();
      if (raw === '') {
        await RM.db.setSetting('allowedProductionToCutHours', '');
        input.value = '';
        paintState();
        RM.calcEngine.invalidate();
        await RM.refreshAll();
        UI.toast('کنترل مهلت تولید تا برش غیرفعال شد (مقدار خالی).', 'info');
        return;
      }
      const v = U.parseInt(raw);
      if (v === null || v <= 0) {
        errEl.textContent = 'فقط یک عدد صحیح مثبت به ساعت وارد کنید — مثال: ۲۴';
        errEl.hidden = false;
        const cur = await RM.db.getSetting('allowedProductionToCutHours', 24);
        const curNum = Number(cur);
        input.value = Number.isFinite(curNum) && curNum > 0 ? U.toFaDigits(String(curNum)) : '';
        paintState();
        return;
      }
      await RM.db.setSetting('allowedProductionToCutHours', v);
      input.value = U.toFaDigits(String(v));
      paintState();
      RM.calcEngine.invalidate();
      await RM.refreshAll();
      UI.toast(`مهلت مجاز بین تولید و برش روی ${U.faNum(v)} ساعت تنظیم شد.`, 'success');
    });
  };

  /* ================================================================
     ۱-ب) انتخاب تم (روشن/تاریک) — ذخیره در localStorage همان مرورگر
     ================================================================ */

  SettingsView.THEME_KEY = 'rm-theme';

  /* ۳٫۲۳ بند ۱ — اعمال تم به‌صورت تابع مشترک (نه فقط داخل initThemePicker)
     تا مسیر «بازیابی پشتیبان» هم بتواند تم ذخیره‌شده در فایل را فوری اعمال کند */
  SettingsView.applyThemeValue = function (theme, { persist = true, notify = false } = {}) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (persist) {
      try { localStorage.setItem(SettingsView.THEME_KEY, theme === 'dark' ? 'dark' : 'light'); } catch { /* حالت خصوصی */ }
    }
    // به‌روزرسانی وضعیت دکمه‌ها
    document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
      const active = btn.dataset.themePick === theme;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    if (notify) {
      UI.toast(theme === 'dark' ? 'تم تاریک فعال شد.' : 'تم روشن فعال شد.', 'success');
    }
  };

  SettingsView.initThemePicker = function () {
    const buttons = document.querySelectorAll('[data-theme-pick]');
    if (!buttons.length) return;

    const apply = (theme, { persist = true, notify = false } = {}) => {
      SettingsView.applyThemeValue(theme, { persist, notify });
    };

    // مقدار ذخیره‌شده (پیش‌فرض: روشن)
    let current = 'light';
    try { current = localStorage.getItem(SettingsView.THEME_KEY) || 'light'; } catch { /* — */ }
    apply(current, { persist: false });

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => apply(btn.dataset.themePick));
    });
  };

  /* ================================================================
     ۲) قوانین متراژ استاندارد (§15-§18)
     ================================================================ */

  const ruleInput = () => ({
    thickness: document.getElementById('r-thickness').value,
    minLength: document.getElementById('r-min').value,
    maxLength: document.getElementById('r-max').value,
    standardLength: document.getElementById('r-standard').value,
  });

  let editingRuleId = null;

  SettingsView.saveRule = async function () {
    const form = document.getElementById('rule-form');
    UI.clearFormErrors(form);

    const input = ruleInput();
    const errMap = {
      thickness: document.getElementById('err-r-thickness'),
      minLength: document.getElementById('err-r-min'),
      maxLength: document.getElementById('err-r-max'),
      standardLength: document.getElementById('err-r-standard'),
    };

    const result = editingRuleId === null
      ? await Rules.create(input)
      : await Rules.update(editingRuleId, input);

    if (!result.ok) {
      // خطاهای Field-Level (§69)
      if (result.errors) {
        let first = null;
        for (const [field, errEl] of Object.entries(errMap)) {
          const msg = result.errors[field];
          const inputEl = document.getElementById(`r-${field === 'minLength' ? 'min' : field === 'maxLength' ? 'max' : field === 'standardLength' ? 'standard' : 'thickness'}`);
          UI.setFieldError(inputEl, errEl, msg);
          if (msg && !first) first = inputEl;
        }
        if (first) first.focus();
      }
      if (result.message) UI.toast(U.escapeHtml(result.message), 'error', 6500);
      return;
    }

    UI.toast(
      editingRuleId === null
        ? 'قانون متراژ استاندارد جدید ذخیره شد.'
        : 'قانون ویرایش شد.',
      'success'
    );

    SettingsView.resetRuleForm();
    await RM.refreshAll();       // تغییر قانون → محاسبات و گروه‌بندی تازه (§90)
    await SettingsView.renderRules();
  };

  SettingsView.startEditRule = async function (id) {
    const rule = await db.standardLengthRules.get(id);
    if (!rule) return;

    editingRuleId = id;
    document.getElementById('r-thickness').value = String(rule.thickness);
    document.getElementById('r-min').value = String(rule.minLength);
    document.getElementById('r-max').value = String(rule.maxLength);
    document.getElementById('r-standard').value = String(rule.standardLength);

    // ۳٫۹ — تغییر ۲: فقط متن داخل span (دکمهٔ راهنما دست‌نخورده می‌ماند)
    document.getElementById('rule-form-title-text').textContent = 'ویرایش قانون متراژ';
    document.getElementById('btn-rule-save').textContent = 'ذخیرهٔ تغییرات';
    document.getElementById('rule-cancel-edit').hidden = false;
    document.getElementById('r-thickness').focus();
  };

  SettingsView.resetRuleForm = function () {
    editingRuleId = null;
    const form = document.getElementById('rule-form');
    form.reset();
    UI.clearFormErrors(form);

    // ۳٫۹ — تغییر ۲: فقط متن داخل span (دکمهٔ راهنما دست‌نخورده می‌ماند)
    document.getElementById('rule-form-title-text').textContent = 'تعریف قانون متراژ استاندارد جدید';
    document.getElementById('btn-rule-save').textContent = 'ذخیره قانون';
    document.getElementById('rule-cancel-edit').hidden = true;
  };

  SettingsView.removeRule = async function (id) {
    const ok = await UI.confirm({
      title: 'حذف قانون متراژ',
      message: 'با حذف این قانون، رول‌های پوشش‌داده‌شده توسط آن قابل تطبیق با ستاپ‌ها نخواهند بود. ادامه می‌دهید؟',
      confirmText: 'بله، حذف کن',
      danger: true,
    });
    if (!ok) return;

    await Rules.remove(id);
    UI.toast('قانون حذف شد و محاسبات به‌روزرسانی گردید.', 'success');
    await RM.refreshAll();
    await SettingsView.renderRules();
  };

  /** رندر جدول قوانین (گروه‌بندی بر اساس ضخامت) */
  SettingsView.renderRules = async function () {
    const rules = await db.standardLengthRules.toArray();
    const wrap = document.getElementById('rules-table-wrap');

    if (!rules.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          ${UI.icons.alert}
          <p>هیچ قانونی تعریف نشده است.<br>
          بدون قوانین متراژ، رول‌ها استانداردسازی نمی‌شوند و تطبیقی انجام نمی‌شود (§17).</p>
        </div>`;
      return;
    }

    // مرتب‌سازی: ضخامت سپس حداقل
    rules.sort((a, b) => a.thickness - b.thickness || a.minLength - b.minLength);

    let html = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>ضخامت (μ)</th><th>حداقل متراژ</th><th>حداکثر متراژ</th><th>متراژ استاندارد</th><th>عملیات</th>' +
      '</tr></thead><tbody>';

    let prevThickness = null;
    for (const rule of rules) {
      const isBoundaryRow = prevThickness !== null && rule.thickness !== prevThickness;
      html += `<tr${isBoundaryRow ? ' class="group-boundary"' : ''}>
        <td class="thickness-cell">${U.faNum(rule.thickness)}</td>
        <td>${U.faNum(rule.minLength)}</td>
        <td>${U.faNum(rule.maxLength)}</td>
        <td class="count-cell">${U.faNum(rule.standardLength)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-rule-edit="${rule.id}" title="ویرایش" aria-label="ویرایش قانون">${UI.icons.edit}</button>
            <button type="button" class="btn btn-icon" data-rule-del="${rule.id}" title="حذف" aria-label="حذف قانون">${UI.icons.trash}</button>
          </div>
        </td>
      </tr>`;
      prevThickness = rule.thickness;
    }
    html += '</tbody></table></div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-rule-edit]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.startEditRule(Number(btn.dataset.ruleEdit)))
    );
    wrap.querySelectorAll('[data-rule-del]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.removeRule(Number(btn.dataset.ruleDel)))
    );
  };

  /* ================================================================
     ۲-ب) قوانین زمان متالایز (هر دستگاه) — تغییرات جدید
     ================================================================ */

  let editingTimeRuleId = null;

  const timeRuleInput = () => ({
    machineNumber: document.getElementById('mt-machine').value,
    standardLength: document.getElementById('mt-standard').value,
    qtyPerShift: document.getElementById('mt-qty').value,
  });

  /** به‌روزرسانی دراپ‌داون متراژ استاندارد از قوانین متراژ + نمایش مدت زمان خودکار */
  SettingsView.refreshMachineTimeOptions = async function (keepStandard = null) {
    const sel = document.getElementById('mt-standard');
    const hint = document.getElementById('hint-mt-standard');
    const rules = await db.standardLengthRules.toArray();
    const options = Rules.standardMetrageOptions(rules);

    let html = '<option value="">— انتخاب کنید —</option>';
    for (const opt of options) {
      html += `<option value="${opt}" ${String(opt) === String(keepStandard) ? 'selected' : ''}>${U.faNum(opt)}</option>`;
    }
    sel.innerHTML = html;

    if (!options.length) {
      hint.textContent = 'ابتدا در بخش «تعریف قانون متراژ استاندارد جدید» قانون متراژ تعریف کنید — متراژهای همان‌جا این‌جا قابل انتخاب‌اند.';
      hint.hidden = false;
    } else {
      hint.textContent = `گزینه‌ها از ${U.faNum(options.length)} متراژ استاندارد تعریف‌شده خوانده می‌شود.`;
      hint.hidden = false;
    }
  };

  /** محاسبهٔ زندهٔ مدت زمان هر رول = ۷۲۰ ÷ تعداد در شیفت */
  SettingsView.updateDurationPreview = function () {
    const el = document.getElementById('mt-duration');
    const qty = U.parseInt(document.getElementById('mt-qty').value);
    el.textContent = (qty !== null && qty >= 1)
      ? `${U.faNumPlain(Rules.timeDurationMinutes(qty))} دقیقه`
      : '—';
  };

  SettingsView.saveTimeRule = async function () {
    const form = document.getElementById('machine-time-form');
    UI.clearFormErrors(form);

    const input = timeRuleInput();
    const errMap = {
      machineNumber: [document.getElementById('mt-machine'), document.getElementById('err-mt-machine')],
      standardLength: [document.getElementById('mt-standard'), document.getElementById('err-mt-standard')],
      qtyPerShift: [document.getElementById('mt-qty'), document.getElementById('err-mt-qty')],
    };

    const result = await Rules.saveTimeRule(input, editingTimeRuleId);
    if (!result.ok) {
      if (result.errors) {
        let first = null;
        for (const [field, [inputEl, errEl]] of Object.entries(errMap)) {
          const msg = result.errors[field];
          UI.setFieldError(inputEl, errEl, msg);
          if (msg && !first) first = inputEl;
        }
        if (first) first.focus();
      }
      if (result.message) UI.toast(U.escapeHtml(result.message), 'error', 6500);
      return;
    }

    UI.toast(
      editingTimeRuleId === null
        ? `قانون زمان ذخیره شد — هر رول ${U.faNumPlain(result.rule.durationMin)} دقیقه.`
        : 'قانون زمان ویرایش شد.',
      'success'
    );

    SettingsView.resetTimeRuleForm();
    await RM.refreshAll();
    await SettingsView.renderMachineTimeRules();
  };

  SettingsView.startTimeRuleEdit = async function (id) {
    const rules = await Rules.getAllTimeRules();
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    editingTimeRuleId = id;
    await SettingsView.refreshMachineTimeOptions(rule.standardLength);
    document.getElementById('mt-machine').value = String(rule.machineNumber);
    document.getElementById('mt-standard').value = String(rule.standardLength);
    document.getElementById('mt-qty').value = String(rule.qtyPerShift);
    SettingsView.updateDurationPreview();

    // ۳٫۹ — تغییر ۲: فقط متن داخل span (دکمهٔ راهنما دست‌نخورده می‌ماند)
    document.getElementById('mt-form-title-text').textContent = 'ویرایش قانون زمان متالایز';
    document.getElementById('btn-mt-save').textContent = 'ذخیرهٔ تغییرات';
    document.getElementById('mt-cancel-edit').hidden = false;
    document.getElementById('mt-machine').focus();
  };

  SettingsView.resetTimeRuleForm = async function () {
    editingTimeRuleId = null;
    const form = document.getElementById('machine-time-form');
    form.reset();
    UI.clearFormErrors(form);

    await SettingsView.refreshMachineTimeOptions();
    SettingsView.updateDurationPreview();

    // ۳٫۹ — تغییر ۲: فقط متن داخل span (دکمهٔ راهنما دست‌نخورده می‌ماند)
    document.getElementById('mt-form-title-text').textContent = 'تعریف قانون زمان متالایز (هر دستگاه)';
    document.getElementById('btn-mt-save').textContent = 'ذخیره قانون';
    document.getElementById('mt-cancel-edit').hidden = true;
  };

  SettingsView.removeTimeRule = async function (id) {
    const rules = await Rules.getAllTimeRules();
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    const ok = await UI.confirm({
      title: 'حذف قانون زمان متالایز',
      html: `<div class="confirm-stats">
        <div>دستگاه <b>${U.faNum(rule.machineNumber)}</b> · متراژ استاندارد <b>${U.faNum(rule.standardLength)}</b></div>
        <div>تعداد در شیفت: <b>${U.faNum(rule.qtyPerShift)}</b> · مدت زمان هر رول: <b>${U.faNumPlain(rule.durationMin)} دقیقه</b></div>
      </div>`,
      message: 'با حذف این قانون، ستون‌های «مانده زمان» رکوردهای مطابق آن محاسبه نمی‌شوند. ادامه می‌دهید؟',
      confirmText: 'بله، حذف کن',
      danger: true,
    });
    if (!ok) return;

    await Rules.removeTimeRule(id);
    UI.toast('قانون زمان حذف شد و محاسبات به‌روزرسانی گردید.', 'success');
    await RM.refreshAll();
    await SettingsView.renderMachineTimeRules();
  };

  /** رندر جدول قوانین زمان */
  SettingsView.renderMachineTimeRules = async function () {
    const wrap = document.getElementById('machine-time-rules-wrap');
    const rules = await Rules.getAllTimeRules();

    if (!rules.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          ${UI.icons.alert}
          <p>هنوز قانون زمانی تعریف نشده است.<br>
          بدون قوانین زمان، ستون‌های «مانده زمان ستاپ/موجودی» و گزارش‌های زمانی داشبورد محاسبه نمی‌شوند.</p>
        </div>`;
      return;
    }

    rules.sort((a, b) => a.machineNumber - b.machineNumber || a.standardLength - b.standardLength);

    let html = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>شماره دستگاه</th><th>متراژ استاندارد</th><th>تعداد در شیفت (رول)</th><th>مدت زمان هر رول</th><th>عملیات</th>' +
      '</tr></thead><tbody>';

    let prevMachine = null;
    for (const rule of rules) {
      const isBoundary = prevMachine !== null && rule.machineNumber !== prevMachine;
      html += `<tr${isBoundary ? ' class="group-boundary"' : ''}>
        <td class="thickness-cell">دستگاه ${U.faNum(rule.machineNumber)}</td>
        <td>${U.faNum(rule.standardLength)}</td>
        <td class="count-cell">${U.faNum(rule.qtyPerShift)}</td>
        <td><b>${U.faNumPlain(rule.durationMin)}</b> دقیقه <span class="muted" style="font-size:.7rem">(۷۲۰÷${U.faNumPlain(rule.qtyPerShift)})</span></td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-mt-edit="${rule.id}" title="ویرایش" aria-label="ویرایش قانون زمان">${UI.icons.edit}</button>
            <button type="button" class="btn btn-icon" data-mt-del="${rule.id}" title="حذف" aria-label="حذف قانون زمان">${UI.icons.trash}</button>
          </div>
        </td>
      </tr>`;
      prevMachine = rule.machineNumber;
    }
    html += '</tbody></table></div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-mt-edit]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.startTimeRuleEdit(Number(btn.dataset.mtEdit)))
    );
    wrap.querySelectorAll('[data-mt-del]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.removeTimeRule(Number(btn.dataset.mtDel)))
    );
  };

  /* ================================================================
     ۳) Backup / Restore (§61-§62)
     ================================================================ */

  SettingsView.exportBackup = async function () {
    try {
      const { fileName, counts } = await Backup.exportFile();
      /* ۳٫۲۳ بند ۱ — شمارش تنظیمات/وضعیت‌ها در پیام (شفافیت محتوای فایل) */
      UI.toast(
        `پشتیبان «${U.escapeHtml(fileName)}» ساخته شد — ` +
        `${U.faNum(counts.setupRolls)} ستاپ · ${U.faNum(counts.standardLengthRules)} قانون · ` +
        `${U.faNum(counts.rolls + counts.archivedRolls)} رکورد اکسل · ` +
        `${U.faNum(counts.settings || 0)} تنظیم/وضعیت (شامل تم)`,
        'success',
        6000
      );
    } catch (err) {
      console.error('[Backup]', err);
      UI.toast('خطا در ساخت فایل پشتیبان.', 'error');
    }
  };

  /**
   * بازیابی Backup + بارگذاری مجدد برنامه (۳٫۲۴ بند ۱).
   * ریشه‌یابی ۳٫۲۴: فایل پشتیبان از قبل همهٔ تنظیمات/وضعیت‌ها را ذخیره می‌کرد،
   * اما نماها این وضعیت‌ها را فقط یک‌بار در init() (راه‌اندازی) از Dexie
   * می‌خوانند — پس با «refreshAll» جداول با وضعیت کهنهٔ حافظه رندر می‌شدند و
   * جزئیات (عرض ستون/پنهان‌سازی/مرتب‌سازی/…) اعمال نمی‌شد؛ بدتر: با اولین
   * تعامل، وضعیت کهنه روی فایل بازیابی‌شده بازنویسی می‌شد. راه‌حل قطعی:
   * پس از جایگزینی تراکنشی، برنامه یک‌بار دوباره بارگذاری می‌شود تا همهٔ
   * نماها دقیقاً از محتوای فایل ساخته شوند (فلگ rm-restore-reload در
   * sessionStorage → پس از راه‌اندازی: بازگشت به تب تنظیمات + پیام موفقیت).
   */
  SettingsView.restoreBackup = async function (file) {
    try {
      // خواندن و اعتبارسنجی ساختار (§72: Backup Corrupted)
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        UI.toast('فایل پشتیبان معتبر نیست (JSON نامعتبر).', 'error');
        return;
      }

      const check = Backup.validate(payload);
      if (!check.ok) {
        UI.toast(`فایل پشتیبان معتبر نیست: ${U.escapeHtml(check.errors[0] || '')}`, 'error', 7000);
        return;
      }

      const c = payload.counts;

      // تأیید بازیابی (§70 — عملیات خطرناک) + شمارش تنظیمات (۳٫۲۳ بند ۱) +
      // نسخهٔ سازندهٔ فایل و اطلاع‌رسانی بارگذاری مجدد (۳٫۲۴ بند ۱)
      const ok = await UI.confirm({
        title: 'تأیید بازیابی Backup',
        html: `<div class="confirm-stats">
          <div>ستاپ‌ها: <b>${U.faNum(c.setupRolls)}</b> · قوانین: <b>${U.faNum(c.standardLengthRules)}</b></div>
          <div>رکوردهای rolls: <b>${U.faNum(c.rolls)}</b> · آرشیو: <b>${U.faNum(c.archivedRolls)}</b></div>
          <div>تنظیمات و وضعیت‌ها: <b>${U.faNum(c.settings || 0)}</b> مورد · تم: <b>${payload.ui && payload.ui.theme === 'dark' ? 'تاریک' : 'روشن'}</b></div>
          ${payload.appVersion ? `<div>ساخته‌شده با نسخهٔ: <b>${U.faNum(Number(payload.appVersion))}</b></div>` : ''}
          <div>تاریخ پشتیبان: <b>${U.faDate(payload.exportedAt)}</b></div>
        </div>`,
        message: 'تمام داده‌های فعلی برنامه با محتوای این فایل جایگزین می‌شود و برای اعمال کامل همهٔ داده‌ها و تنظیمات (شامل جزئیات جداول)، برنامه یک‌بار دوباره بارگذاری خواهد شد. ادامه می‌دهید؟',
        confirmText: 'بله، بازیابی کن',
        danger: true,
      });
      if (!ok) return;

      const result = await Backup.restore(payload);
      if (!result.ok) {
        UI.toast(`بازیابی ناموفق: ${U.escapeHtml(result.errors[0] || '')}`, 'error');
        return;
      }

      /* ۳٫۲۳ بند ۱ — تم پشتیبان فوری اعمال می‌شود (فایل‌های قدیمی بدون بخش ui
         → تم فعلی دست‌نخورده می‌ماند) */
      if (payload.ui && (payload.ui.theme === 'dark' || payload.ui.theme === 'light')) {
        SettingsView.applyThemeValue(payload.ui.theme, { persist: true });
      }

      /* ۳٫۲۴ بند ۱ — بارگذاری مجدد خودکار: تنها راه قطعی اعمالِ «همهٔ»
         تنظیمات و وضعیت‌های ماندگار (عرض ستون‌ها، ترتیب/پنهان‌سازی،
         مرتب‌سازی‌ها، وضعیت چارت‌ها و…) که نماها فقط در init() می‌خوانند.
         فلگ جلسه‌ای → پس از راه‌اندازی: بازگشت به تب تنظیمات + پیام موفقیت. */
      try { sessionStorage.setItem('rm-restore-reload', '1'); } catch { /* حالت خصوصی */ }
      UI.toast(
        'بازیابی با موفقیت انجام شد — برنامه برای اعمال همهٔ داده‌ها و تنظیمات دوباره بارگذاری می‌شود…',
        'success',
        3200
      );
      setTimeout(() => {
        try { window.location.reload(); }
        catch (err) {   // fallback: بارگذاری نرم (مرورگرهای بسیار قدیمی)
          console.warn('[RestoreReload]', err);
          RM.refreshAll();
        }
      }, 1200);
    } catch (err) {
      console.error('[Restore]', err);
      UI.toast('خطا در خواندن فایل پشتیبان.', 'error');
    }
  };

  /* ================================================================
     ۴) مدیریت داده‌ها (§63)
     ================================================================ */

  SettingsView.clearDataset = async function (targetKey, fileLabel, table) {
    const count = await db[table].count();
    if (!count) {
      UI.toast('این جدول از قبل خالی است.', 'info');
      return;
    }

    const ok = await UI.confirm({
      title: 'پاک‌سازی Dataset',
      html: `<div class="confirm-stats"><div>رکوردهای ${U.escapeHtml(fileLabel)}: <b>${U.faNum(count)}</b> حذف خواهد شد.</div></div>`,
      message: 'برای بازگردانی، فایل اکسل را مجدداً Import کنید. ادامه می‌دهید؟',
      confirmText: 'بله، پاک کن',
      danger: true,
    });
    if (!ok) return;

    await db.transaction('rw', db[table], async () => {
      await db[table].clear();
    });
    UI.toast('Dataset پاک‌سازی شد.', 'success');
    await RM.refreshAll();
    await SettingsView.renderAll();
  };

  SettingsView.clearEverything = async function () {
    const ok = await UI.confirm({
      title: 'پاک‌سازی کامل برنامه',
      html: '<div class="confirm-warn">⚠ تمام داده‌ها (ستاپ‌ها، قوانین، Datasetها، ویرایش رول‌ها و تنظیمات) حذف می‌شوند.</div>',
      message: 'پیش از ادامه، در صورت نیاز Backup تهیه کنید. ادامه می‌دهید؟',
      confirmText: 'بله، همه‌چیز را پاک کن',
      danger: true,
    });
    if (!ok) return;

    await db.transaction(
      'rw',
      [db.setupRolls, db.standardLengthRules, db.appSettings, db.importMetadata, db.rolls, db.archivedRolls, db.rollEdits, db.pallets],
      async () => {
        await Promise.all([
          db.setupRolls.clear(),
          db.standardLengthRules.clear(),
          db.appSettings.clear(),
          db.importMetadata.clear(),
          db.rolls.clear(),
          db.archivedRolls.clear(),
          db.rollEdits.clear(),     // تغییر ۳: ویرایش‌های رول‌ها هم پاک می‌شوند
          db.pallets.clear(),       // نسخهٔ ۳٫۱۲ — پالت‌های فایل بسته‌بندی
        ]);
      }
    );

    UI.toast('برنامه به حالت اولیه بازگشت.', 'success');

    /* ۳٫۳۶ — پاک‌سازی کامل عمدی است: آینهٔ پشتیبان خودکار و پرچم‌های
       بازیابی هم پاک می‌شوند تا دادهٔ عمداً حذف‌شده در شروع بعدی
       دوباره خودکار برنگردد و پنل بازیابی هم در همین حالت نمایش داده نشود. */
    try {
      localStorage.removeItem('rm-autobackup-v1');
      localStorage.setItem('rm-recovery-dismissed', '1');
    } catch { /* حالت خصوصی */ }

    await RM.refreshAll();
    await SettingsView.renderAll();
  };

  /* ================================================================
     ۵) اطلاعات Importها (§12، §60 — C)
        محدود به آخرین Importها (پیش‌فرض ۵ مورد) + دکمهٔ نمایش همه
     ================================================================ */

  SettingsView._historyExpanded = false;

  /** پاک‌کردن همهٔ رکوردهای جدول سابقهٔ Importها (تغییر ۴) — Datasetها و
      رکوردهای رول‌ها دست‌نخورده می‌مانند؛ فقط متادیتای Importها (نسخه‌بندی)،
      نام فایل‌ها و هش‌ها حذف می‌شود و شماره‌گذاری نسخهٔ Dataset از ۱ شروع می‌شود. */
  SettingsView.clearImportHistory = async function () {
    const count = await db.importMetadata.count();
    if (!count) {
      UI.toast('سابقهٔ Importها خالی است.', 'info');
      return;
    }

    const ok = await UI.confirm({
      title: 'پاک‌کردن سابقهٔ Importها',
      html: `<div class="confirm-stats"><div>رکوردهای قابل حذف: <b>${U.faNum(count)}</b></div></div>
             <div class="confirm-warn">⚠ متادیتای Importها (نام فایل، تاریخ، هش و شمارهٔ Dataset) پاک می‌شود —
             خود Datasetها و رکوردهای رول‌ها <b>دست‌نخورده</b> می‌مانند؛ شماره‌گذاری نسخهٔ Dataset از ۱ شروع می‌شود.</div>`,
      message: 'این عمل بازگشت‌پذیر نیست (جز با Backup). ادامه می‌دهید؟',
      confirmText: 'بله، سابقه را پاک کن',
      danger: true,
    });
    if (!ok) return;

    await db.transaction('rw', db.importMetadata, async () => {
      await db.importMetadata.clear();
    });

    UI.toast('سابقهٔ Importها پاک شد — رکوردهای رول‌ها دست‌نخورده باقی ماند.', 'success', 6000);
    await RM.refreshAll();
    await SettingsView.renderAll();
  };

  SettingsView.renderImportHistory = async function () {
    const wrap = document.getElementById('import-history-wrap');
    const entries = await db.importMetadata.orderBy('importedAt').reverse().toArray();

    if (!entries.length) {
      wrap.innerHTML = '<p class="muted" style="font-size:.8rem">هنوز Importی انجام نشده است.</p>';
      return;
    }

    // محدودیت نمایش: پیش‌فرض آخرین موارد — جدول بلند نشود
    const shown = SettingsView._historyExpanded ? entries : entries.slice(0, HISTORY_PAGE);
    const total = entries.length;
    const hiddenCount = total - shown.length;

    const toggleBtn = hiddenCount > 0
      ? `<button type="button" class="btn btn-ghost btn-sm" data-history-toggle="expand">
           نمایش همه (${U.faNum(total)})
         </button>`
      : (SettingsView._historyExpanded && total > HISTORY_PAGE
        ? `<button type="button" class="btn btn-ghost btn-sm" data-history-toggle="collapse">
             نمایش ${U.faNum(HISTORY_PAGE)} مورد آخر
           </button>`
        : '');

    // عنوان کاربرپسنده + نام واقعی فایل برای Audit/Traceability
    wrap.innerHTML = `
      <div class="history-meta">
        <span class="chip">${U.faNum(total)} Import ثبت‌شده</span>
        ${SettingsView._historyExpanded ? '' : `<span class="muted" style="font-size:.7rem">نمایش ${U.faNum(shown.length)} مورد آخر</span>`}
        ${toggleBtn}
        <button type="button" class="btn btn-ghost btn-sm" data-history-clear title="پاک‌کردن همهٔ رکوردهای این جدول (تغییر ۴) — Datasetها دست‌نخورده می‌مانند">
          ${UI.icons.trash} پاک‌کردن سابقهٔ Importها
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>نسخه</th><th>Dataset</th><th>نام فایل</th><th>وضعیت</th><th>تاریخ</th><th>رکورد</th><th>خام/یونیک</th><th>هش</th>
        </tr></thead><tbody>
          ${shown.map((e) => `<tr>
            <td>#${U.faNum(e.datasetVersion)}</td>
            <td>${U.escapeHtml(RM.config.DATASET_LABELS[e.target] || e.target)}</td>
            <td><code>${U.escapeHtml(U.truncate(e.fileName, 24))}</code></td>
            <td>${e.status === 'ok' ? '<span class="status-pill pill-ok">موفق</span>' : '—'}</td>
            <td>${U.faDate(e.importedAt)}</td>
            <td>${U.faNum(e.totalRecords)}</td>
            <td>${U.faNum(e.rawRolls)}</td>
            <td class="ltr" style="font-size:.68rem;color:var(--text-faint)">${U.escapeHtml(e.fileHash || '—')}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>`;

    // تغییر حالت نمایش (باز/بسته)
    wrap.querySelectorAll('[data-history-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        SettingsView._historyExpanded = btn.dataset.historyToggle === 'expand';
        await SettingsView.renderImportHistory();
      });
    });

    // پاک‌کردن همهٔ رکوردهای سابقه (تغییر ۴)
    const clearBtn = wrap.querySelector('[data-history-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => SettingsView.clearImportHistory());
    }
  };

  /* ================================================================
     ۵) نگاشت ستون‌های اکسل (Mapping قابل تنظیم — §1 اصلاحات)
     ================================================================ */

  /** رندر پنل Mapping برای هر دو Dataset (مستقل از یکدیگر) */
  SettingsView.renderMappingPanel = async function () {
    const wrap = document.getElementById('mapping-editor');
    if (!wrap) return;

    const userMapping = await RM.normalize.getUserMapping();
    const N = RM.normalize;
    const html = [];

    for (const sourceKey of Object.keys(RM.config.COLUMN_MAP)) {
      const target = RM.config.IMPORT_TARGETS[sourceKey];
      const overrides = userMapping[sourceKey] || {};
      const headers = await N.getDatasetHeaders(sourceKey);
      const mapping = N.buildFieldMapping(sourceKey, headers, overrides);

      const fieldsHtml = Object.entries(RM.config.COLUMN_MAP[sourceKey]).map(([field, spec]) => {
        const labelTxt = N.fieldLabel(sourceKey, field);
        const isOptional = !!spec.optional;
        const current = typeof overrides[field] === 'string' && overrides[field].trim() !== ''
          ? overrides[field] : '';

        // رزولوشن خودکار فعلی برای راهنما
        const autoResolved = mapping[field];
        const hint = autoResolved
          ? `خودکار → «${U.escapeHtml(autoResolved)}»`
          : (isOptional ? 'خودکار → بدون ستون (اختیاری)' : 'خودکار → یافت نشد');

        const options = ['<option value="">خودکار (پیش‌فرض)</option>']
          .concat(headers.map((h) =>
            `<option value="${U.escapeHtml(h)}" ${h === current ? 'selected' : ''}>${U.escapeHtml(h)}</option>`
          ))
          .join('');

        return `
          <div class="field mapping-field">
            <label>${labelTxt} ${isOptional ? '<span class="unit">(اختیاری)</span>' : '<b class="req">*</b>'}</label>
            <select data-map-select="${field}" ${headers.length ? '' : 'disabled'}>
              ${current ? `<option value="${U.escapeHtml(current)}" selected>${U.escapeHtml(current)}</option>` : ''}
              ${options}
            </select>
            <p class="field-hint mapping-hint">${hint}</p>
            <p class="field-error" data-map-error="${field}" hidden></p>
          </div>`;
      }).join('');

      html.push(`
        <div class="mapping-section">
          <h4 class="mapping-section-title">
            ${U.escapeHtml(target.label)}
            ${headers.length
              ? `<span class="chip chip-ok">${U.faNum(headers.length)} ستون شناسایی‌شده</span>`
              : '<span class="chip">Dataset وارد نشده</span>'}
          </h4>
          ${headers.length ? '' : '<p class="muted" style="font-size:.72rem">برای انتخاب ستون‌ها ابتدا فایل مربوطه را در تب «ورود داده‌ها» Import کنید؛ تا آن زمان مقادیر پیش‌فرض اعمال می‌شود. نام واقعی فایل پس از Import در همان تب برای Audit نمایش داده می‌شود.</p>'}
          <div class="mapping-grid">${fieldsHtml}</div>
          <div class="field-actions">
            <button type="button" class="btn btn-primary btn-sm" data-map-save="${sourceKey}">ذخیرهٔ نگاشت این Dataset</button>
            <button type="button" class="btn btn-ghost btn-sm" data-map-reset="${sourceKey}">بازگردانی به پیش‌فرض</button>
          </div>
        </div>`);
    }

    wrap.innerHTML = html.join('');

    // رویدادها
    wrap.querySelectorAll('[data-map-save]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.saveMapping(btn.dataset.mapSave))
    );
    wrap.querySelectorAll('[data-map-reset]').forEach((btn) =>
      btn.addEventListener('click', () => SettingsView.resetMapping(btn.dataset.mapReset))
    );
  };

  /** جمع‌آوری Overrideهای کاربر از فرم یک Dataset */
  SettingsView.collectMapping = function (sourceKey) {
    const section = document.querySelector(`.mapping-section [data-map-save="${sourceKey}"]`).closest('.mapping-section');
    const overrides = {};
    section.querySelectorAll('[data-map-select]').forEach((sel) => {
      if (sel.value.trim() !== '') overrides[sel.dataset.mapSelect] = sel.value;
    });
    return { overrides, section };
  };

  /**
   * ذخیرهٔ Mapping یک Dataset:
   *  ۱) اعتبارسنجی: هر ستون انتخاب‌شده باید در Dataset فعلی وجود داشته باشد
   *  ۲) ذخیره در appSettings (columnMapping — مستقل برای هر Dataset)
   *  ۳) اگر Dataset موجود باشد: بازسازی تراکنشی رکوردها با Mapping جدید
   */
  SettingsView.saveMapping = async function (sourceKey) {
    const N = RM.normalize;
    const { overrides, section } = SettingsView.collectMapping(sourceKey);
    const headers = await N.getDatasetHeaders(sourceKey);
    const normalizedHeaders = new Set(headers.map((h) => U.normalizeHeader(h)));

    // پاک‌کردن خطاهای قبلی
    section.querySelectorAll('[data-map-error]').forEach((el) => {
      el.textContent = '';
      el.hidden = true;
    });
    section.querySelectorAll('select.invalid').forEach((el) => el.classList.remove('invalid'));

    // --- اعتبارسنجی ستون‌های انتخاب‌شده ---
    let hasError = false;
    let firstInvalid = null;
    for (const [field, header] of Object.entries(overrides)) {
      if (!normalizedHeaders.has(U.normalizeHeader(header))) {
        if (headers.length) {
          // Dataset موجود است اما ستون انتخاب‌شده در آن نیست
          const errEl = section.querySelector(`[data-map-error="${field}"]`);
          const sel = section.querySelector(`[data-map-select="${field}"]`);
          const labelTxt = N.fieldLabel(sourceKey, field);
          if (errEl) {
            errEl.textContent = `ستون «${header}» در Dataset فعلی «${RM.config.DATASET_LABELS[sourceKey]}» وجود ندارد.`;
            errEl.hidden = false;
          }
          if (sel) sel.classList.add('invalid');
          if (!firstInvalid) firstInvalid = sel;
          hasError = true;
        }
        // اگر Dataset وارد نشده باشد، اعتبارسنجی ممکن نیست — بعد از Import بررسی می‌شود
      }
    }

    if (hasError) {
      UI.toast('ذخیرهٔ Mapping انجام نشد — ستون‌های انتخابی را بررسی کنید.', 'error', 6000);
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    // --- ذخیره + بازسازی ---
    try {
      const userMapping = await N.getUserMapping();
      const nextMapping = { ...userMapping, [sourceKey]: overrides };
      const target = RM.config.IMPORT_TARGETS[sourceKey];
      const table = RM.db.db[target.table];
      const mapping = N.buildFieldMapping(sourceKey, headers, overrides);

      let rebuiltCount = 0;
      let recomputedIssues = null;

      await RM.db.db.transaction('rw', table, RM.db.db.appSettings, RM.db.db.importMetadata, async () => {
        // ذخیرهٔ تنظیمات
        await RM.db.db.appSettings.put({ key: 'columnMapping', value: nextMapping });

        // بازسازی تراکنشی رکوردهای Dataset با Mapping جدید
        const existing = await table.toArray();
        if (existing.length && existing.some((r) => r.raw)) {
          const fresh = existing.map((r) => {
            if (!r.raw) return r;   // رکورد بدون سطر خام — دست‌نخورده
            const { record } = N.normalizeRow(r.raw, sourceKey, mapping);
            return { ...record, id: r.id };
          });
          await table.clear();
          await table.bulkPut(fresh);
          rebuiltCount = fresh.length;

          // به‌روزرسانی Issues در متادیتای آخرین Import
          // نسخهٔ ۳٫۱۲ — Dataset پالت‌ها کلیدهای Issue مستقل دارد؛ شمارندهٔ
          // فایل (nonM) از متادیتای قبلی حفظ و شمارنده‌های رکوردی با
          // نرمال‌ساز پالت بازشماری می‌شوند.
          if (target.normalizer === 'pallets') {
            const prevMeta = await RM.db.getLatestImportMeta(sourceKey);
            const prevIssues = (prevMeta && prevMeta.issues) || {};
            const rawRows = existing.filter((r) => r.raw).map((r) => r.raw);
            const palCount = N.normalizePalletRows(rawRows, sourceKey, mapping);
            recomputedIssues = { ...palCount.issues, nonM: prevIssues.nonM || 0 };
          } else {
            const issues = { width: 0, length: 0, thickness: 0, setupNumber: 0, rollNumber: 0, filmType: 0 };
            for (const r of fresh) {
              if (r.width === null) issues.width++;
              if (r.actualLength === null) issues.length++;
              if (r.thickness === null) issues.thickness++;
              if (r.setupNumber === null) issues.setupNumber++;
              if (r.rollNumber === '') issues.rollNumber++;
              if (r.filmType === '') issues.filmType++;
            }
            recomputedIssues = issues;
          }
        }

        // به‌روزرسانی متادیتا (Issues + Mapping Gaps تازه)
        const meta = await RM.db.getLatestImportMeta(sourceKey);
        if (meta) {
          const patch = { issues: recomputedIssues || meta.issues, mappingGaps: mapping.__invalid || [] };
          await RM.db.db.importMetadata.update(meta.id, patch);
        }
      });

      UI.toast(
        rebuiltCount
          ? `Mapping ذخیره شد و ${U.faNum(rebuiltCount)} رکورد «${RM.config.DATASET_LABELS[sourceKey]}» با نگاشت جدید بازسازی شد.`
          : 'Mapping ذخیره شد.' + (headers.length ? '' : ' (Dataset وارد نشده — پس از Import اعمال می‌شود)'),
        'success',
        6000
      );

      await RM.refreshAll();
      await SettingsView.renderMappingPanel();
    } catch (err) {
      console.error('[SaveMapping]', err);
      UI.toast('خطا در ذخیرهٔ Mapping — تغییری اعمال نشد.', 'error');
    }
  };

  /** بازگردانی Mapping یک Dataset به پیش‌فرض (حذف Overrideهای کاربر) */
  SettingsView.resetMapping = async function (sourceKey) {
    const ok = await UI.confirm({
      title: 'بازگردانی Mapping به پیش‌فرض',
      message: `انتخاب‌های سفارشی شما برای «${RM.config.DATASET_LABELS[sourceKey]}» حذف و نگاشت پیش‌فرض اعمال می‌شود. رکوردهای Dataset با نگاشت پیش‌فرض بازسازی خواهند شد. ادامه می‌دهید؟`,
      confirmText: 'بله، بازگردانی کن',
    });
    if (!ok) return;

    const userMapping = await RM.normalize.getUserMapping();
    const nextMapping = { ...userMapping };
    delete nextMapping[sourceKey];

    try {
      const target = RM.config.IMPORT_TARGETS[sourceKey];
      const table = RM.db.db[target.table];
      const headers = await RM.normalize.getDatasetHeaders(sourceKey);
      const mapping = RM.normalize.buildFieldMapping(sourceKey, headers, {});

      await RM.db.db.transaction('rw', table, RM.db.db.appSettings, RM.db.db.importMetadata, async () => {
        await RM.db.db.appSettings.put({ key: 'columnMapping', value: nextMapping });

        const existing = await table.toArray();
        if (existing.length && existing.some((r) => r.raw)) {
          const fresh = existing.map((r) => {
            if (!r.raw) return r;
            const { record } = RM.normalize.normalizeRow(r.raw, sourceKey, mapping);
            return { ...record, id: r.id };
          });
          await table.clear();
          await table.bulkPut(fresh);
        }

        const meta = await RM.db.getLatestImportMeta(sourceKey);
        if (meta) {
          await RM.db.db.importMetadata.update(meta.id, { mappingGaps: [] });
        }
      });

      UI.toast('Mapping به پیش‌فرض بازگردانی شد.', 'success');
      await RM.refreshAll();
      await SettingsView.renderMappingPanel();
    } catch (err) {
      console.error('[ResetMapping]', err);
      UI.toast('خطا در بازگردانی Mapping.', 'error');
    }
  };

  /* ================================================================
     ۵-ب) پنل کلیدهای تطبیق (نسخهٔ ۳٫۲۶)
     -------------------------------------------------------------------------
     ساخت و ویرایش ترکیب همهٔ کلیدهای تطبیق پروژه (رجیستری
     RM.config.MATCH_KEYS — ۹ کلید). قواعد سند کاربر:
       · هر کلید دقیقاً یک نمونه دارد — دکمهٔ حذف کلید وجود ندارد
       · حداقل یک پارامتر همیشه باید بماند (× آخری غیرفعال + گارد ذخیره)
       · پارامترها فقط از pool مجاز همان کلید (دو سمتِ تطبیق قابل محاسبه)
       · ذخیره → appSettings: matchingKeys → بازمحاسبهٔ کل سیستم (refreshAll)
       · بازگردانی به پیش‌فرض = حذف Override همان کلید (کلید می‌ماند)
     ================================================================ */

  /**
   * HTML محتوای زیرمنوی ستون‌های نمایندهٔ «عرض» (۳٫۲۸ · اصلاح ۳٫۲۹) — درون ردیف
   * خودِ پارامتر عرض در کارت هر کلیدِ بخش رول‌ها که widthPolicy دارد:
   *   · اصلاح ۳٫۲۹: فقط در کلیدهایی که پارامتر «عرض» دارند و دیتای فایل
   *     «رول‌های موجود» در کلید مشارکت می‌کند (خام rawMatch)، پارامتر عرض دو
   *     پراپرتی دارد: «عرض در فایل رول‌های موجود» (قابل تنظیم بین «عرض» و
   *     «عرض اولیه») و «عرض در فایل آرشیو» (قفل روی «عرض» — فایل آرشیو ستون
   *     «عرض اولیه» ندارد و نیازی به تنظیم ندارد).
   *   · کلید متالایز (metMatch): فقط پراپرتی «عرض در فایل آرشیو» (قفل‌شده).
   *   · کلیدهای تک‌فایلی رول‌های موجود (برش‌خورده) → فقط پراپرتی همان فایل.
   *   · setupOnly (کلید یکتایی ستاپ) → یادداشت: عرض فقط از فیلد عرض ستاپ
   *   · کلیدهای پالت‌ها و کلیدهای بدون فاکتور عرض → بدون زیرمنو
   * subState: وضعیت لحظه‌ای زیرمنو هنگام بازسازی ردیف‌ها ({ open, vals } —
   * مقادیر ذخیره‌نشدهٔ سلکت‌ها حفظ می‌شوند)؛ null = رندر اولیه (open = ویرایش‌شده).
   */
  function mkWidthSubmenuHtml(def, ctx, subState, open) {
    const policy = def.widthPolicy;
    if (!policy) return '';
    const P = RM.config.MATCH_KEY_PARAMS;
    const param = policy.param || 'width';
    const paramLabel = (P[param] || { label: 'عرض' }).label;

    /* یادداشت کلیدهای دوسمتتی ستاپ (بدون ستون رولی) */
    if (policy.setupOnly) {
      return `
        <div class="mk-wsub mk-wsub-note" data-mk-wsub${open ? '' : ' hidden'}>
          <p>در این کلید، «${U.escapeHtml(paramLabel)}» فقط از <b>فیلد عرض خودِ ستاپ</b> خوانده می‌شود — هر دو سمتِ مقایسه رکورد ستاپ‌اند و ستونی از فایل‌های رول در آن مشارکت ندارد.</p>
        </div>`;
    }
    if (!policy.sources) return '';

    /* ۳٫۲۸ — نام پراپرتی هر سمت دقیقاً طبق سند: «عرض در فایل رول‌های موجود» / «عرض در فایل آرشیو» */
    const FILE_LABELS = { raw: 'فایل رول‌های موجود', archived: 'فایل آرشیو' };
    const rows = Object.keys(policy.sources).map((src) => {
      const current = (subState && subState.vals && Object.prototype.hasOwnProperty.call(subState.vals, src))
        ? subState.vals[src]
        : (RM.keys.widthSourceOf(def.id, src) || policy.sources[src]);
      const fields = RM.config.WIDTH_SOURCE_FIELDS[src] || {};
      /* ۳٫۲۹ — سمت قفل‌شده (آرشیو): سلکت غیرفعال با تنها گزینهٔ «عرض» + توضیح */
      const isFixed = RM.keys.isFixedWidthSource(def.id, src);
      const options = Object.entries(fields).map(([f, meta]) =>
        `<option value="${f}" ${f === current ? 'selected' : ''}>${U.escapeHtml(meta.label)} (ستون «${U.escapeHtml(meta.column)}»)</option>`
      ).join('');
      const sideName = `${paramLabel} در ${FILE_LABELS[src] || src}`;
      const lockNote = isFixed
        ? `<p class="mk-wsub-note-inline">🔒 قفل روی «${U.escapeHtml((fields[current] || {}).label || 'عرض')}» — فایل «سابقه رول‌ها (آرشیو)» ستونی با نام «عرض اولیه» ندارد؛ ${U.escapeHtml(paramLabel)} این فایل همیشه از ستون «${U.escapeHtml((fields[policy.sources[src]] || {}).column || 'عرض')}» خوانده می‌شود و نیازی به تنظیم ندارد.</p>`
        : '';
      return `
          <label class="mk-wsub-row${isFixed ? ' mk-wsub-row-fixed' : ''}" title="ستون نمایندهٔ «${U.escapeHtml(paramLabel)}» در نگاشت فایل «${FILE_LABELS[src] || src}»${isFixed ? ' — قفل‌شده' : ''}">
            <span class="mk-wsub-side">${U.escapeHtml(sideName)}${isFixed ? ' <span class="mk-wsub-lock">🔒 قفل</span>' : ''}</span>
            <select data-mk-width="${src}"${isFixed ? ' disabled' : ''} aria-label="«${U.escapeHtml(sideName)}» در ${U.escapeHtml(def.label)}"${isFixed ? ' — قفل‌شده' : ''}>${options}</select>
          </label>${lockNote}`;
    }).join('');

    return `
        <div class="mk-wsub" data-mk-wsub${open ? '' : ' hidden'}>
          ${rows}
        </div>`;
  }

  /** HTML ردیف یک پارامتر در کارت کلید — ۳٫۲۸: ردیفِ فاکتور عرض (عرض/عرض برش)
      کلیدهای دارای widthPolicy، دکمهٔ زیرمنو (▸/▾) و زیرمنوی ستون‌های نمایندهٔ
      عرض را درون خود ردیف می‌گیرد تا معلوم باشد این تنظیم فقط به همین پارامتر مربوط است */
  function mkParamRowHtml(paramId, idx, total, param, def, ctx, subState) {
    const canDelete = total > 1;   // حداقل ۱ پارامتر — × آخری غیرفعال
    const actionsHtml = `
          <button type="button" class="mk-mini" data-mk-up ${idx === 0 ? 'disabled' : ''} title="جابه‌جایی به بالا" aria-label="جابه‌جایی پارامتر ${U.escapeHtml(param.label)} به بالا">▲</button>
          <button type="button" class="mk-mini" data-mk-down ${idx === total - 1 ? 'disabled' : ''} title="جابه‌جایی به پایین" aria-label="جابه‌جایی پارامتر ${U.escapeHtml(param.label)} به پایین">▼</button>
          <button type="button" class="mk-mini mk-del" data-mk-del ${canDelete ? '' : 'disabled'}
            title="${canDelete ? `حذف «${U.escapeHtml(param.label)}» از این کلید` : 'کلید بدون پارامتر معنا و کاربرد ندارد — حداقل یک پارامتر باید بماند'}"
            aria-label="حذف پارامتر ${U.escapeHtml(param.label)}">✕</button>`;

    /* ۳٫۲۸ — زیرمنو فقط برای فاکتور هدفِ widthPolicy همان کلید (width یا cutWidth) */
    let wToggle = '';
    let submenu = '';
    if (def && def.widthPolicy && (def.widthPolicy.param || 'width') === paramId) {
      const open = subState ? !!subState.open : RM.keys.widthSourceModified(def.id);
      const custom = RM.keys.widthSourceModified(def.id);
      submenu = mkWidthSubmenuHtml(def, ctx, subState, open);
      wToggle = `<button type="button" class="mk-mini mk-wtoggle${custom ? ' mk-wtoggle-custom' : ''}" data-mk-wtoggle aria-expanded="${open ? 'true' : 'false'}"
            title="ستون‌های نمایندهٔ «${U.escapeHtml(param.label)}» در این کلید — به تفکیک هر فایل (سمت ستاپ همیشه فیلد عرض خودِ ستاپ است)${custom ? ' — شامل تنظیم سفارشی' : ''}"
            aria-label="تنظیم ستون‌های نمایندهٔ «${U.escapeHtml(param.label)}» در ${U.escapeHtml(def.label)}">${open ? '▾' : '▸'}</button>`;
    }

    const rowCore = `
        <span class="mk-param-idx">${U.faNum(idx + 1)}</span>
        <span class="mk-param-label" title="${U.escapeHtml(param.desc)}">${U.escapeHtml(param.label)}</span>
        ${wToggle}
        <span class="mk-param-actions">${actionsHtml}</span>`;

    if (!submenu) {
      return `
      <li class="mk-param" data-mk-param="${paramId}">${rowCore}
      </li>`;
    }
    return `
      <li class="mk-param mk-param-w" data-mk-param="${paramId}">
        <div class="mk-param-main">${rowCore}</div>
        ${submenu}
      </li>`;
  }

  /** HTML کارت یک کلید (لیست پارامترها + افزودن + ذخیره/بازگردانی — ۳٫۲۸: زیرمنوی
      ستون‌های نمایندهٔ عرض درون ردیف خودِ پارامتر عرض، نه بلوک جداگانه) */
  function mkKeyCardHtml(def, params, isModified, ctx) {
    const P = RM.config.MATCH_KEY_PARAMS;
    const paramsHtml = params
      .map((p, i) => mkParamRowHtml(p, i, params.length, P[p] || { label: p, desc: '' }, def, ctx, null))
      .join('');

    /* گزینه‌های افزودن: فقط پارامترهای مجاز pool که هنوز در کلید نیستند */
    const remaining = def.pool.filter((p) => !params.includes(p));
    const addOptions = remaining.length
      ? remaining.map((p) => `<option value="${p}">${U.escapeHtml(P[p].label)}</option>`).join('')
      : '<option value="">— همهٔ پارامترهای مجاز استفاده شده —</option>';

    return `
      <div class="mk-key" data-mk-id="${def.id}">
        <div class="mk-key-head">
          <h4 class="mk-key-title">${U.escapeHtml(def.label)}</h4>
          <span class="chip">${U.faNum(params.length)} پارامتر</span>
          ${isModified
            ? '<span class="chip chip-warn" title="ترکیب این کلید توسط شما ویرایش شده است">ویرایش‌شده</span>'
            : '<span class="chip chip-ok" title="ترکیب پیش‌فرض کارخانه‌ای">پیش‌فرض</span>'}
        </div>
        <p class="mk-key-desc">${U.escapeHtml(def.desc)}</p>
        <ul class="mk-params" data-mk-list>${paramsHtml}</ul>
        <div class="mk-add-row">
          <select data-mk-select aria-label="افزودن پارامتر به ${U.escapeHtml(def.label)}">${addOptions}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-mk-add ${remaining.length ? '' : 'disabled'}>افزودن پارامتر</button>
        </div>
        <div class="field-actions mk-actions">
          <button type="button" class="btn btn-primary btn-sm" data-mk-save>ذخیرهٔ این کلید</button>
          <button type="button" class="btn btn-ghost btn-sm" data-mk-reset ${isModified ? '' : 'disabled'}
            title="${isModified ? 'بازگردانی ترکیب کارخانه‌ای همین کلید (کلید حذف نمی‌شود)' : 'این کلید در ترکیب پیش‌فرض است'}">بازگردانی به پیش‌فرض</button>
        </div>
        <p class="mk-key-hint">ترکیب فعلی: ${U.escapeHtml(RM.keys.describe(def.id))}${mkWidthSummary(def, params)}</p>
      </div>`;
  }

  /** خلاصهٔ ستون‌های نمایندهٔ عرض فعلی یک کلید (۳٫۲۷ · اصلاح ۳٫۲۹) — پیوست ردیف «ترکیب فعلی» */
  function mkWidthSummary(def, params) {
    const policy = def.widthPolicy;
    if (!policy || !policy.sources) return '';
    const param = policy.param || 'width';
    if (!params.includes(param)) return '';
    const SIDE = { raw: 'رول‌های موجود', archived: 'آرشیو' };
    const parts = Object.keys(policy.sources).map((src) => {
      const fld = RM.keys.widthSourceOf(def.id, src) || policy.sources[src];
      const meta = (RM.config.WIDTH_SOURCE_FIELDS[src] || {})[fld];
      /* ۳٫۲۹ — سمت قفل‌شده (آرشیو) با نشان «ثابت» */
      const fixedTag = RM.keys.isFixedWidthSource(def.id, src) ? ' (ثابت)' : '';
      return `${SIDE[src] || src} ← «${meta ? meta.label : fld}»${fixedTag}`;
    });
    return ` · منبع «${U.escapeHtml((RM.config.MATCH_KEY_PARAMS[param] || { label: 'عرض' }).label)}»: ${parts.map(U.escapeHtml).join(' · ')}`;
  }

  /** رندر پنل کلیدهای تطبیق — ۹ کلید در ۴ دسته (دسته‌بندی از رجیستری) */
  SettingsView.renderMatchKeysPanel = async function () {
    const wrap = document.getElementById('matchkeys-editor');
    if (!wrap) return;
    await RM.keys.ensure();   // مصرف همگام مطمئن

    /* ۳٫۲۹ — ctx ساده شد: هشدار نگاشت «عرض رول اولیه» آرشیو حذف شد (فیلد
       initialWidth از نگاشت آرشیو حذف شد — فایل آرشیو چنین ستونی ندارد). */
    const ctx = {};

    /* گروه‌بندی کلیدها بر اساس دستهٔ رجیستری (ترتیب اعلان حفظ می‌شود) */
    const categories = [];
    const byCat = new Map();
    for (const def of RM.config.MATCH_KEYS) {
      if (!byCat.has(def.category)) {
        byCat.set(def.category, []);
        categories.push(def.category);
      }
      byCat.get(def.category).push(def);
    }

    const html = categories.map((cat) => `
      <div class="mapping-section mk-section">
        <h4 class="mapping-section-title">${U.escapeHtml(cat)}
          <span class="chip">${U.faNum(byCat.get(cat).length)} کلید</span>
        </h4>
        <div class="mk-keys-grid">
          ${byCat.get(cat).map((def) => mkKeyCardHtml(def, RM.keys.paramsOf(def.id), RM.keys.isModified(def.id), ctx)).join('')}
        </div>
      </div>`).join('');

    wrap.innerHTML = html;

    /* --- رویدادها (جابه‌جایی/حذف/افزودن — همه روی DOM کارت، پیش از ذخیره) --- */
    wrap.querySelectorAll('.mk-key').forEach((card) => {
      const list = card.querySelector('[data-mk-list]');

      const rerenderRows = () => {
        const def = RM.keys.defOf(card.dataset.mkId);
        /* ۳٫۲۸ — وضعیت زیرمنوهای عرض (باز/بسته + مقادیر ذخیره‌نشدهٔ سلکت‌ها)
           پیش از بازسازی ردیف‌ها جمع می‌شود تا چیزی از دست نرود */
        const subStates = {};
        list.querySelectorAll('li[data-mk-param]').forEach((li) => {
          const sub = li.querySelector('[data-mk-wsub]');
          if (!sub) return;
          const vals = {};
          sub.querySelectorAll('[data-mk-width]').forEach((sel) => { vals[sel.dataset.mkWidth] = sel.value; });
          subStates[li.dataset.mkParam] = { open: !sub.hidden, vals };
        });
        const params = [...list.querySelectorAll('[data-mk-param]')].map((li) => li.dataset.mkParam);
        list.innerHTML = params
          .map((p, i) => mkParamRowHtml(p, i, params.length, RM.config.MATCH_KEY_PARAMS[p] || { label: p, desc: '' }, def, ctx, subStates[p] || null))
          .join('');
        /* بازگرداندن رویدادها به دکمه‌های تازه */
        bindRowButtons();
        refreshAddRow(def, params);
      };

      const refreshAddRow = (def, params) => {
        const remaining = def.pool.filter((p) => !params.includes(p));
        const sel = card.querySelector('[data-mk-select]');
        const addBtn = card.querySelector('[data-mk-add]');
        sel.innerHTML = remaining.length
          ? remaining.map((p) => `<option value="${p}">${U.escapeHtml(RM.config.MATCH_KEY_PARAMS[p].label)}</option>`).join('')
          : '<option value="">— همهٔ پارامترهای مجاز استفاده شده —</option>';
        addBtn.disabled = !remaining.length;
      };

      const bindRowButtons = () => {
        list.querySelectorAll('[data-mk-param]').forEach((li, idx) => {
          li.querySelector('[data-mk-up]').addEventListener('click', () => {
            if (idx === 0) return;
            const rows = [...list.querySelectorAll('[data-mk-param]')];
            list.insertBefore(rows[idx], rows[idx - 1]);
            rerenderRows();
          });
          li.querySelector('[data-mk-down]').addEventListener('click', () => {
            const rows = [...list.querySelectorAll('[data-mk-param]')];
            if (idx === rows.length - 1) return;
            list.insertBefore(rows[idx + 1], rows[idx]);
            rerenderRows();
          });
          li.querySelector('[data-mk-del]').addEventListener('click', () => {
            const rows = list.querySelectorAll('[data-mk-param]');
            if (rows.length <= 1) return;   // گارد: حداقل ۱ پارامتر
            li.remove();
            rerenderRows();
          });
          /* ۳٫۲۸ — باز/بسته‌کردن زیرمنوی ستون‌های نمایندهٔ عرض همین پارامتر */
          const wToggle = li.querySelector('[data-mk-wtoggle]');
          if (wToggle) {
            wToggle.addEventListener('click', () => {
              const sub = li.querySelector('[data-mk-wsub]');
              if (!sub) return;
              const willOpen = sub.hidden;
              sub.hidden = !willOpen;
              wToggle.setAttribute('aria-expanded', String(willOpen));
              wToggle.textContent = willOpen ? '▾' : '▸';
            });
          }
        });
      };
      bindRowButtons();

      card.querySelector('[data-mk-add]').addEventListener('click', () => {
        const sel = card.querySelector('[data-mk-select]');
        const p = sel.value;
        if (!p) return;
        const def = RM.keys.defOf(card.dataset.mkId);
        if (!def.pool.includes(p)) return;
        const params = [...list.querySelectorAll('[data-mk-param]')].map((li) => li.dataset.mkParam);
        if (params.includes(p)) return;   // بدون تکرار
        const tmp = document.createElement('li');
        tmp.dataset.mkParam = p;
        list.appendChild(tmp);
        rerenderRows();
      });

      card.querySelector('[data-mk-save]').addEventListener('click', () => SettingsView.saveMatchKey(card.dataset.mkId));
      const resetBtn = card.querySelector('[data-mk-reset]');
      if (!resetBtn.disabled) {
        resetBtn.addEventListener('click', () => SettingsView.resetMatchKey(card.dataset.mkId));
      }
    });
  };

  /** ذخیرهٔ ترکیب یک کلید — خواندن ترتیب DOM + گارد حداقل ۱ پارامتر */
  SettingsView.saveMatchKey = async function (keyId) {
    const card = document.querySelector(`.mk-key[data-mk-id="${keyId}"]`);
    if (!card) return;
    const def = RM.keys.defOf(keyId);
    if (!def) return;

    const params = [...card.querySelectorAll('[data-mk-list] [data-mk-param]')]
      .map((li) => li.dataset.mkParam);

    if (!params.length) {
      UI.toast('کلید بدون پارامتر معنا و کاربرد ندارد — حداقل یک پارامتر لازم است.', 'error', 5000);
      return;
    }

    /* ۳٫۲۸ · ۳٫۲۹ — ستون‌های نمایندهٔ عرض همین کلید — سلکت‌های فعال خوانده
       می‌شوند؛ سمت‌های قفل‌شده (آرشیو — disabled) در جمع‌آوری نمی‌آیند چون
       مقدارشان همیشه پیش‌فرض رجیستری است و Override نمی‌پذیرند. */
    const widthSelects = [...card.querySelectorAll('[data-mk-width]')].filter((sel) => !sel.disabled);
    const widthSources = {};
    widthSelects.forEach((sel) => { widthSources[sel.dataset.mkWidth] = sel.value; });
    const hasWidthBlock = widthSelects.length > 0;

    try {
      const res = await RM.keys.saveOverride(keyId, params, hasWidthBlock ? widthSources : undefined);
      if (!res.ok) {
        UI.toast(res.error || 'ذخیرهٔ کلید ممکن نشد.', 'error', 5000);
        return;
      }

      /* بازمحاسبهٔ کل سیستم — اثر کلید تازه در همهٔ صفحات دیده می‌شود */
      RM.calcEngine.invalidate();
      await RM.refreshAll();

      const label = def.label;
      /* ۳٫۲۷ — خلاصهٔ منابع عرض در توست ذخیره (کارت‌های دارای بلوک عرض) */
      let srcTxt = '';
      if (hasWidthBlock) {
        const SIDE = { raw: 'رول‌های موجود', archived: 'آرشیو' };
        srcTxt = ' · منبع عرض: ' + Object.keys(widthSources).map((src) => {
          const meta = (RM.config.WIDTH_SOURCE_FIELDS[src] || {})[widthSources[src]];
          return `${SIDE[src] || src} ← «${meta ? meta.label : widthSources[src]}»`;
        }).join(' · ');
      }
      UI.toast(
        `کلید «${label}» با ${U.faNum(res.params.length)} پارامتر ذخیره شد${srcTxt} — محاسبات و جداول بازسازی شدند.`,
        'success',
        6000
      );
    } catch (err) {
      console.error('[SaveMatchKey]', err);
      UI.toast('خطا در ذخیرهٔ کلید — تغییری اعمال نشد.', 'error');
    }
  };

  /** بازگردانی یک کلید به پیش‌فرض (کلید حذف نمی‌شود — فقط Override پاک می‌شود) */
  SettingsView.resetMatchKey = async function (keyId) {
    const def = RM.keys.defOf(keyId);
    if (!def) return;
    const ok = await UI.confirm({
      title: 'بازگردانی کلید به پیش‌فرض',
      message: `ترکیب سفارشی شما برای «${def.label}» — شامل ستون‌های نمایندهٔ «عرض» در صورت تغییر — حذف و ترکیب پیش‌فرض (${RM.keys.describe(keyId)}) اعمال می‌شود. کلید حذف نمی‌شود و پس از تأیید، کل محاسبات و جداول بازسازی خواهند شد. ادامه می‌دهید؟`,
      confirmText: 'بله، بازگردانی کن',
    });
    if (!ok) return;

    try {
      await RM.keys.resetOverride(keyId);
      RM.calcEngine.invalidate();
      await RM.refreshAll();
      UI.toast(`کلید «${def.label}» به پیش‌فرض بازگردانی شد (ترکیب پارامترها و ستون نمایندهٔ عرض) و محاسبات بازسازی شد.`, 'success', 6000);
    } catch (err) {
      console.error('[ResetMatchKey]', err);
      UI.toast('خطا در بازگردانی کلید.', 'error');
    }
  };

  /* ================================================================
     ۶) رندر کل نما
     ================================================================ */

  SettingsView.renderAll = async function () {
    await SettingsView.renderRules();
    await SettingsView.renderImportHistory();
    await SettingsView.renderMappingPanel();
    await SettingsView.renderMatchKeysPanel();   // ۳٫۲۶ — پنل کلیدهای تطبیق
    await SettingsView.renderMachineTimeRules();
    SettingsView.renderAutosaveInfo();   // ۳٫۳۶ — وضعیت پشتیبان خودکار

    // به‌روزرسانی دراپ‌داون متراژ فرم زمان با قوانین تازه (§90)
    if (editingTimeRuleId === null) await SettingsView.refreshMachineTimeOptions();

    // به‌روزرسانی دراپ‌داون فرم ستاپ با قوانین تازه (§90 — تغییر قانون → فرم تازه)
    if (RM.views.setup && typeof RM.views.setup.refreshStandardLengthOptions === 'function') {
      RM.views.setup.currentRules = await db.standardLengthRules.toArray();
      RM.views.setup.refreshStandardLengthOptions();
    }
  };

  SettingsView.render = SettingsView.renderAll;

  /* ================================================================
     ۳٫۳۶ — وضعیت پشتیبان خودکار (آینهٔ localStorage)
     ================================================================ */
  SettingsView.renderAutosaveInfo = function () {
    const el = document.getElementById('autosave-info');
    if (!el) return;
    let mirror = null;
    try { mirror = RM.recovery ? RM.recovery.readAutosave() : null; } catch { /* حالت خصوصی */ }
    if (mirror && mirror.payload) {
      const c = mirror.payload.counts || {};
      const total = (c.rolls || 0) + (c.archivedRolls || 0) + (c.setupRolls || 0);
      el.innerHTML =
        `<b>پشتیبان خودکار:</b> فعال — آخرین آینه: ${U.faDate(mirror.payload.exportedAt || Date.now())}` +
        ` (${U.faNum(total)} رکورد — نسخهٔ فشرده بدون سطر خام اکسل)`;
    } else if (mirror && mirror.tooBig) {
      el.innerHTML =
        `<b>پشتیبان خودکار:</b> داده‌ها برای آینهٔ داخلی مرورگر حجیم‌تر از سهمیه‌اند — ` +
        `برای اطمینان کامل، از «ساخت فایل پشتیبان» استفاده کنید.`;
    } else {
      el.innerHTML =
        `<b>پشتیبان خودکار:</b> هنوز آینه‌ای ساخته نشده — پس از اولین تغییر داده خودکار ساخته می‌شود.`;
    }
  };

  RM.views = RM.views || {};
  RM.views.settings = SettingsView;
})();
