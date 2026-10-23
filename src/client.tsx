import en from '../locale/en.json';
import zh from '../locale/zh.json';

/** Browser-owned presentation only. All configuration traffic uses the native form service. */
declare const window: any;

window.__ModuleLoader__.load({
  id: 'dsh-gamedev',
  factory: (require: (id: string) => any) => {
    const React = require('react');
    const { Button, Switch } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const NS = 'gamedev';
    const ENTRY = 'gamedev-settings';
    const defaults: Record<string, any> = {
      enabled: false,
      projectRoot: '',
      godotExecutable: '',
      bridgeMode: 'stdio',
      bridgeExecutable: '',
      bridgeUrl: 'ws://127.0.0.1:19080',
      bridgeEndpoint: '',
      bridgeSecretRef: '',
      httpSecretRef: '',
      allowedOptionalTools: [],
      gdtoolkitExecutable: '',
      imagemagickExecutable: '',
      ffmpegExecutable: '',
      testFrameworkPreference: 'existing',
    };
    const fields = Object.keys(defaults);
    const toolRows = [
      { id: 'gdtoolkit', label: 'GDScript Toolkit', path: 'gdtoolkitExecutable' },
      { id: 'imagemagick', label: 'ImageMagick', path: 'imagemagickExecutable' },
      { id: 'ffmpeg', label: 'FFmpeg', path: 'ffmpegExecutable' },
    ];
    const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    const editable = (value: any) => Object.fromEntries(fields.map((key) => [
      key,
      Array.isArray(defaults[key])
        ? [...(Array.isArray(value?.[key]) ? value[key] : defaults[key])]
        : value?.[key] ?? defaults[key],
    ]));
    const absolutePath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
    function loopback(value: string, protocols: string[], needsPort = false) {
      try {
        const url = new URL(value);
        return protocols.includes(url.protocol)
          && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
          && !url.username && !url.password && !url.search && !url.hash
          && (!needsPort || !!url.port)
          && (!needsPort || url.pathname === '' || url.pathname === '/');
      } catch {
        return false;
      }
    }
    function validate(value: Record<string, any>) {
      const errors: Record<string, string> = {};
      for (const key of ['projectRoot', 'godotExecutable', 'bridgeExecutable', ...toolRows.map((row) => row.path)]) {
        if (value[key] && !absolutePath(value[key])) errors[key] = 'absolutePath';
      }
      for (const key of ['bridgeSecretRef', 'httpSecretRef']) {
        if (value[key] && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value[key])) errors[key] = 'envRef';
      }
      if (value.bridgeUrl && !loopback(value.bridgeUrl, ['ws:'], true)) errors.bridgeUrl = 'loopbackWs';
      if (value.bridgeEndpoint && !loopback(value.bridgeEndpoint, ['http:'])) errors.bridgeEndpoint = 'loopbackHttp';
      if (value.enabled) {
        const required = ['projectRoot', 'godotExecutable', ...(value.bridgeMode === 'stdio'
          ? ['bridgeExecutable', 'bridgeUrl', 'bridgeSecretRef'] : ['bridgeEndpoint'])];
        for (const key of required) if (!value[key]) errors[key] = 'required';
      }
      return errors;
    }
    /** JSON diagnostics are Host-owned; neither this field nor its contents are ever written. */
    function readHealth(value: any): any {
      const health = value?.health ?? value?.healthSummary;
      if (typeof health === 'object' && health !== null) return health;
      if (typeof health !== 'string' || !health) return null;
      try {
        const decoded = JSON.parse(health);
        return typeof decoded === 'object' && decoded !== null ? decoded : { reason: health };
      } catch {
        return { reason: health };
      }
    }
    const css = `
      .dsh-gamedev{display:grid;gap:24px;max-width:760px;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;padding:4px 0 24px}
      .dsh-gamedev *{box-sizing:border-box}
      .dsh-gamedev h2,.dsh-gamedev p{margin:0}
      .dsh-gamedev h2{font-size:18px;font-weight:600}
      .dsh-gamedev fieldset{display:grid;gap:20px;min-width:0;border:0;border-top:1px solid var(--dsw-alias-border-l2);padding:20px 0 0;margin:0}
      .dsh-gamedev legend{font-size:15px;font-weight:600;padding:0 12px 0 0}
      .dsh-gamedev .gd-field{display:grid;gap:6px;min-width:0}
      .dsh-gamedev .gd-label{font-size:14px;font-weight:500}
      .dsh-gamedev .gd-hint{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .dsh-gamedev .gd-input{display:block;width:100%;min-width:0;min-height:38px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px 10px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit}
      .dsh-gamedev .gd-input:focus-visible,.dsh-gamedev a:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:3px}
      .dsh-gamedev .gd-input:disabled{opacity:.5;cursor:not-allowed}
      .dsh-gamedev .gd-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,currentColor)}
      .dsh-gamedev .gd-error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-size:13px;overflow-wrap:anywhere}
      .dsh-gamedev .gd-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0}
      .dsh-gamedev .gd-row>div:first-child{min-width:0}
      .dsh-gamedev .gd-tool{display:grid;gap:12px;padding:0 0 20px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dsh-gamedev .gd-tool:last-of-type{padding-bottom:0;border-bottom:0}
      .dsh-gamedev .gd-status{display:grid;gap:8px;margin:0;min-width:0}
      .dsh-gamedev .gd-status>div{display:grid;grid-template-columns:minmax(130px,1fr) minmax(0,2fr);gap:16px}
      .dsh-gamedev dt{color:var(--dsw-alias-label-secondary)}
      .dsh-gamedev dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
      .dsh-gamedev .gd-notice{display:grid;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow-wrap:anywhere}
      .dsh-gamedev .gd-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
      .dsh-gamedev .gd-errors{margin:0;padding-left:20px}
      .dsh-gamedev .gd-errors a{color:var(--dsw-alias-link)}
      @media(max-width:520px){.dsh-gamedev .gd-status>div{grid-template-columns:1fr;gap:2px}.dsh-gamedev .gd-input{min-height:44px}.dsh-gamedev{font-size:14px}}
    `;

    function GameDevSettings({ t, form }: any) {
      const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form]);
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form]);
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const [draft, setDraft] = React.useState(() => editable(snapshot.value));
      const [baseline, setBaseline] = React.useState(() => editable(snapshot.value));
      const [revision, setRevision] = React.useState(snapshot.revision);
      const [touched, setTouched] = React.useState({} as Record<string, boolean>);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [failed, setFailed] = React.useState(false);
      const summary = React.useRef(null as HTMLDivElement | null);
      const initialized = React.useRef(snapshot.status === 'ready');
      const changedFields = fields.filter((key) => !equal(draft[key], baseline[key]));
      const dirty = changedFields.length > 0;
      const stale = dirty && !equal(revision, snapshot.revision);
      const errors = validate(draft);
      const disabled = !snapshot.writable || saving || snapshot.status !== 'ready';
      React.useEffect(() => {
        if (snapshot.status !== 'ready' || saving) return;
        if (!initialized.current || !dirty) {
          const next = editable(snapshot.value);
          initialized.current = true;
          setDraft(next);
          setBaseline(next);
          setRevision(snapshot.revision);
        }
      }, [snapshot, dirty, saving]);

      function edit(key: string, value: any) {
        setDraft((previous: any) => ({ ...previous, [key]: value }));
        setMessage('');
      }
      function reload(merge: boolean) {
        const next = editable(form.getSnapshot().value);
        if (merge) for (const key of changedFields) next[key] = draft[key];
        setBaseline(editable(form.getSnapshot().value));
        setDraft(next);
        setRevision(form.getSnapshot().revision);
        setTouched({});
        setMessage('');
        setFailed(false);
      }
      async function save(event?: any) {
        event?.preventDefault();
        if (disabled) return;
        if (Object.keys(errors).length) {
          setTouched(Object.fromEntries(fields.map((key) => [key, true])));
          setFailed(true);
          setMessage('invalidSummary');
          requestAnimationFrame(() => summary.current?.focus());
          return;
        }
        if (!dirty) return;
        setSaving(true);
        setFailed(false);
        try {
          const accepted = await form.mutate(changedFields.map((key) => ({ op: 'set', path: [key], value: draft[key] })), revision);
          if (accepted) {
            const current = form.getSnapshot();
            const next = editable(current.value);
            setBaseline(next);
            setDraft(next);
            setRevision(current.revision);
            setTouched({});
            setMessage('saved');
          } else {
            setFailed(true);
            setMessage('saveFailed');
            requestAnimationFrame(() => summary.current?.focus());
          }
        } catch {
          // Preserve the draft and do not echo network errors that may contain configuration.
          setFailed(true);
          setMessage('saveFailed');
          requestAnimationFrame(() => summary.current?.focus());
        } finally {
          setSaving(false);
        }
      }
      async function setEnabled(checked: boolean) {
        if (disabled || (checked && draft.bridgeMode !== 'stdio')) return;
        if (checked || !form.getSnapshot().value?.enabled) {
          edit('enabled', checked);
          return;
        }
        // Safe revocation is not held behind unrelated invalid or staged connection edits.
        const latest = form.getSnapshot();
        setSaving(true);
        setMessage('');
        setFailed(false);
        try {
          const accepted = await form.mutate([{ op: 'set', path: ['enabled'], value: false }], latest.revision);
          if (accepted) {
            const current = form.getSnapshot();
            const next = editable(current.value);
            const preserved = { ...next };
            for (const key of changedFields) if (key !== 'enabled') preserved[key] = draft[key];
            setBaseline(next);
            setDraft({ ...preserved, enabled: false });
            setRevision(current.revision);
            setMessage('revoked');
          } else {
            setFailed(true);
            setMessage('disableFailed');
          }
        } catch {
          setFailed(true);
          setMessage('disableFailed');
        } finally {
          setSaving(false);
        }
      }
      function field(key: string, label: string, hint: string, extra: any = {}) {
        const id = `gamedev-${key}`;
        const error = touched[key] && errors[key];
        return h('div', { className: 'gd-field', key },
          h('label', { htmlFor: id, className: 'gd-label' }, label),
          h('input', {
            id, className: 'gd-input', type: 'text', spellCheck: false, autoComplete: 'off',
            value: draft[key], disabled, 'aria-invalid': !!error,
            'aria-describedby': `${id}-hint${error ? ` ${id}-error` : ''}`,
            onChange: (event: any) => edit(key, event.target.value),
            onBlur: () => setTouched((previous: any) => ({ ...previous, [key]: true })),
            ...extra,
          }),
          h('p', { id: `${id}-hint`, className: 'gd-hint' }, hint),
          error && h('p', { id: `${id}-error`, className: 'gd-error' }, t(error)),
        );
      }
      const health = readHealth(snapshot.value);
      const optionalHealth = health?.optionalTools ?? health?.optional ?? {};
      const statusRow = (label: string, value: any) => value !== undefined && value !== null && value !== ''
        ? h('div', { key: label }, h('dt', null, label), h('dd', null, typeof value === 'object' ? JSON.stringify(value) : String(value))) : null;
      const visibleErrorFields = Object.keys(errors).filter((key) => touched[key]);
      const labels: Record<string, string> = Object.fromEntries(fields.map((key) => [key, t(key)]));
      for (const tool of toolRows) labels[tool.path] = `${tool.label} · ${t('optionalPath')}`;
      const activeConnectionFields = draft.bridgeMode === 'stdio'
        ? ['bridgeExecutable', 'bridgeUrl', 'bridgeSecretRef'] : ['bridgeEndpoint', 'httpSecretRef'];
      // Keep an invalid visible connection edit reachable until it is corrected.
      const modeBlocked = activeConnectionFields.some((key) => !!errors[key] && errors[key] !== 'required');

      return h('form', { className: 'dsh-gamedev', onSubmit: save, noValidate: true, 'aria-label': t('title') },
        h('header', { className: 'gd-field' }, h('h2', null, t('title')), h('p', { className: 'gd-hint' }, t('intro'))),
        snapshot.status !== 'ready' && h('p', { role: 'status' }, t(snapshot.status === 'loading' ? 'loading' : 'unavailable')),
        !snapshot.writable && snapshot.status === 'ready' && h('p', { role: 'status' }, t('readOnly')),
        (message || stale) && h('div', {
          className: `gd-notice${failed ? ' gd-error' : ''}`, role: failed ? 'alert' : 'status',
          ref: summary, tabIndex: -1,
        },
          h('p', null, t(message || 'changed')),
          message === 'invalidSummary' && h('ul', { className: 'gd-errors' }, visibleErrorFields.map((key) => h('li', { key },
            h('a', { href: `#gamedev-${key}`, onClick: (event: any) => { event.preventDefault(); document.getElementById(`gamedev-${key}`)?.focus(); } }, `${labels[key]}: ${t(errors[key])}`)))),
          (stale || message === 'saveFailed') && h('div', { className: 'gd-actions' },
            h(Button, { type: 'button', variant: 'outline', disabled, onClick: () => reload(true) }, t('merge')),
            h(Button, { type: 'button', variant: 'outline', disabled, onClick: () => reload(false) }, t('discard'))),
        ),
        h('fieldset', null, h('legend', null, t('project')),
          h('div', { className: 'gd-row' },
            h('div', { className: 'gd-field' }, h('span', { className: 'gd-label' }, t('enabled')), h('p', { className: 'gd-hint', id: 'gamedev-enabled-hint' }, t('enabledHint'))),
            h(Switch, { checked: !!draft.enabled, disabled: disabled || (!draft.enabled && draft.bridgeMode !== 'stdio'), label: t('enabled'), title: t(draft.bridgeMode === 'stdio' ? 'enabledHint' : 'httpUnavailable'), onChange: setEnabled })),
          field('projectRoot', t('projectRoot'), t('projectRootHint')),
          field('godotExecutable', t('godotExecutable'), t('godotExecutableHint')),
          h('div', { className: 'gd-field' },
            h('label', { className: 'gd-label', htmlFor: 'gamedev-bridgeMode' }, t('bridgeMode')),
            h('select', { id: 'gamedev-bridgeMode', className: 'gd-input', value: draft.bridgeMode, disabled: disabled || modeBlocked,
              onChange: (event: any) => edit('bridgeMode', event.target.value) },
              h('option', { value: 'stdio' }, t('stdio')), h('option', { value: 'existing-loopback-http', disabled: true }, t('http')))),
          draft.bridgeMode === 'stdio' ? h(React.Fragment, null,
            field('bridgeExecutable', t('bridgeExecutable'), t('bridgeExecutableHint')),
            field('bridgeUrl', t('bridgeUrl'), t('bridgeUrlHint')),
            field('bridgeSecretRef', t('bridgeSecretRef'), t('bridgeSecretRefHint')),
          ) : h(React.Fragment, null,
            h('p', { className: 'gd-hint', role: 'status' }, t('httpUnavailable')),
            field('bridgeEndpoint', t('bridgeEndpoint'), t('bridgeEndpointHint'), { readOnly: true }),
            field('httpSecretRef', t('httpSecretRef'), t('httpSecretRefHint'), { readOnly: true }))),
        h('fieldset', null, h('legend', null, t('optional')),
          h('p', { className: 'gd-hint' }, t('optionalHint')),
          ...toolRows.map((tool) => {
            const detected = optionalHealth[tool.id] ?? (Array.isArray(optionalHealth) ? optionalHealth.find((item: any) => item.id === tool.id) : null);
            const allowed = draft.allowedOptionalTools.includes(tool.id);
            const actualStatus = detected?.status ?? detected?.state;
            return h('div', { key: tool.id, className: 'gd-tool' },
              h('div', { className: 'gd-row' },
                h('div', { className: 'gd-field' }, h('span', { className: 'gd-label' }, tool.label), h('p', { className: 'gd-hint' }, t('cliType')), h('p', { className: 'gd-hint' }, t(`${tool.id}Purpose`))),
                h(Switch, { checked: allowed, disabled, label: `${tool.label} · ${t('allow')}`,
                  onChange: (checked: boolean) => edit('allowedOptionalTools', checked
                    ? [...draft.allowedOptionalTools.filter((item: string) => item !== tool.id), tool.id]
                    : draft.allowedOptionalTools.filter((item: string) => item !== tool.id)) })),
              field(tool.path, `${tool.label} · ${t('optionalPath')}`, t('optionalPathHint')),
              h('dl', { className: 'gd-status' },
                statusRow(t('status'), actualStatus ?? t(allowed ? 'allowedPending' : 'notAllowed')),
                statusRow(t('version'), detected?.version), statusRow(t('reason'), detected?.reason ?? detected?.missing)),
            );
          }),
          h('div', { className: 'gd-field' }, h('span', { id: 'gamedev-tests-label', className: 'gd-label' }, t('tests')),
            h('output', { id: 'gamedev-tests', 'aria-labelledby': 'gamedev-tests-label' }, draft.testFrameworkPreference === 'existing' ? t('existingTests') : draft.testFrameworkPreference),
            h('p', { className: 'gd-hint' }, t('testsHint'))),
          h('p', { className: 'gd-hint' }, t('candidates'))),
        h('div', { className: 'gd-actions' },
          h(Button, { type: 'submit', variant: 'primary', disabled: disabled || !dirty || stale }, t(saving ? 'saving' : 'save')),
          h(Button, { type: 'button', variant: 'outline', disabled: disabled || !dirty, onClick: () => reload(false) }, t('discard')),
          dirty && h('span', { className: 'gd-hint' }, t('unsaved'))),
        h('fieldset', null, h('legend', null, t('status')),
          h('dl', { className: 'gd-status' },
            statusRow(t('savedState'), t(snapshot.value?.enabled ? 'on' : 'off')),
            statusRow(t('status'), health?.status ?? health?.state), statusRow(t('reason'), health?.reason ?? health?.summary),
            statusRow(t('version'), health?.version), statusRow(t('godotVersion'), health?.godotVersion),
            statusRow(t('bridgeVersion'), health?.bridgeVersion), statusRow(t('projectRoot'), health?.projectRoot),
            statusRow(t('ownerSession'), health?.ownerSession), statusRow(t('appliedProject'), health?.appliedProject),
            statusRow(t('applied'), health?.appliedGeneration), statusRow(t('pending'), health?.savedGeneration ?? health?.configGeneration ?? health?.generation),
            statusRow(t('lastHealth'), health?.lastHealthAt), statusRow(t('lastEditor'), typeof health?.lastEditorConnected === 'boolean' ? t(health.lastEditorConnected ? 'connected' : 'disconnected') : undefined)),
          !health && h('p', { className: 'gd-hint' }, t('healthUnavailable')),
          h('p', { className: 'gd-hint' }, t('restart')), h('p', { className: 'gd-hint' }, t('boundary'))),
      );
    }

    function apply(ctx: any) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-gamedev: dictionaries');
      ctx.effect(() => {
        const id = 'dsh-gamedev-settings-style';
        if (document.getElementById(id)) return () => {};
        const style = document.createElement('style');
        style.id = id;
        style.dataset.plugin = 'dsh-gamedev';
        style.textContent = css;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'dsh-gamedev: native-theme settings style');
      ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'godot-2d', order: 45, label: () => t('title'), locale: NS,
        inject: () => ({ form: ctx.configForms.get(ENTRY) }),
      }, GameDevSettings))), 'dsh-gamedev: settings page');
    }
    return { apply, inject: ['slots', 'locale', 'configForms'] };
  },
});
