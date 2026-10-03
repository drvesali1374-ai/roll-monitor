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

  SettingsView.initThemePicker = function () {
    const buttons = document.querySelectorAll('[data-theme-pick]');
    if (!buttons.length) return;

    const apply = (theme, { persist = true, notify = false } = {}) => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      if (persist) {
        try { localStorage.setItem(SettingsView.THEME_KEY, theme); } catch { /* حالت خصوصی */ }
      }
      // به‌روزرسانی وضعیت دکمه‌ها
      buttons.forEach((btn) => {
        const active = btn.dataset.themePick === theme;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-checked', String(active));
      });
      if (notify) {
        UI.toast(theme === 'dark' ? 'تم تاریک فعال شد.' : 'تم روشن فعال شد.', 'success');
      }
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
      UI.toast(
        `پشتیبان «${U.escapeHtml(fileName)}» ساخته شد — ` +
        `${U.faNum(counts.setupRolls)} ستاپ · ${U.faNum(counts.standardLengthRules)} قانون · ` +
        `${U.faNum(counts.rolls + counts.archivedRolls)} رکورد اکسل`,
        'success',
        6000
      );
    } catch (err) {
      console.error('[Backup]', err);
      UI.toast('خطا در ساخت فایل پشتیبان.', 'error');
    }
  };

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

      // تأیید بازیابی (§70 — عملیات خطرناک)
      const ok = await UI.confirm({
        title: 'تأیید بازیابی Backup',
        html: `<div class="confirm-stats">
          <div>ستاپ‌ها: <b>${U.faNum(c.setupRolls)}</b> · قوانین: <b>${U.faNum(c.standardLengthRules)}</b></div>
          <div>رکوردهای rolls: <b>${U.faNum(c.rolls)}</b> · آرشیو: <b>${U.faNum(c.archivedRolls)}</b></div>
          <div>تاریخ پشتیبان: <b>${U.faDate(payload.exportedAt)}</b></div>
        </div>`,
        message: 'تمام داده‌های فعلی برنامه با محتوای این فایل جایگزین خواهد شد. ادامه می‌دهید؟',
        confirmText: 'بله، بازیابی کن',
        danger: true,
      });
      if (!ok) return;

      const result = await Backup.restore(payload);
      if (!result.ok) {
        UI.toast(`بازیابی ناموفق: ${U.escapeHtml(result.errors[0] || '')}`, 'error');
        return;
      }

      UI.toast('بازیابی با موفقیت انجام شد — همهٔ محاسبات به‌روزرسانی گردید.', 'success');
      await RM.refreshAll();
      await SettingsView.renderAll();
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
     ۶) رندر کل نما
     ================================================================ */

  SettingsView.renderAll = async function () {
    await SettingsView.renderRules();
    await SettingsView.renderImportHistory();
    await SettingsView.renderMappingPanel();
    await SettingsView.renderMachineTimeRules();

    // به‌روزرسانی دراپ‌داون متراژ فرم زمان با قوانین تازه (§90)
    if (editingTimeRuleId === null) await SettingsView.refreshMachineTimeOptions();

    // به‌روزرسانی دراپ‌داون فرم ستاپ با قوانین تازه (§90 — تغییر قانون → فرم تازه)
    if (RM.views.setup && typeof RM.views.setup.refreshStandardLengthOptions === 'function') {
      RM.views.setup.currentRules = await db.standardLengthRules.toArray();
      RM.views.setup.refreshStandardLengthOptions();
    }
  };

  SettingsView.render = SettingsView.renderAll;

  RM.views = RM.views || {};
  RM.views.settings = SettingsView;
})();
