// Promise-based modal dialogs in the planner's own look (ivory panel, serif
// heading, brass primary button) — replaces window.prompt/confirm/alert,
// which Electron does not implement and which look foreign on the web.
//
//   const name = await askText('Save layout', 'Layout 3', { label: 'Layout name' });
//   if (await confirmBox('Delete layout?', '“Garden” will be removed.')) …
//   const i = await messageBox('Blender not found', '…', { buttons: ['Download', 'Close'] });

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogOptions<T> {
  title: string;
  message?: string;
  detail?: string;
  /** custom content, placed after message/detail */
  body?: HTMLElement;
  buttons: DialogButton<T>[];
  /** value for Esc, backdrop click and the close path */
  cancelValue: T;
  /** Enter outside a button: return a value to close with, undefined to stay open */
  onEnter?: () => T | undefined;
  /** element to focus first (default: first input, else the primary button) */
  focus?: HTMLElement;
  /** px, default 420 */
  width?: number;
}

export interface DialogHandle<T> {
  result: Promise<T>;
  close(value: T): void;
  root: HTMLElement;
  /** the buttons, in the order given */
  buttons: HTMLButtonElement[];
}

const CSS = `
.wp-dlg-overlay{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(50,44,38,.45);animation:wp-dlg-fade .12s ease-out}
@keyframes wp-dlg-fade{from{opacity:0}to{opacity:1}}
.wp-dlg{width:420px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:var(--ivory,#faf6f0);
  color:var(--ink,#4a443d);border:1px solid var(--hairline,#e7dfd4);border-radius:var(--radius,10px);
  box-shadow:0 12px 48px rgba(40,34,28,.35);padding:18px 18px 14px;font-size:13px;line-height:1.45}
.wp-dlg h3{font-family:var(--serif,Georgia,serif);font-size:17px;font-weight:normal;margin:0 0 8px;
  padding-bottom:8px;border-bottom:1px solid var(--hairline,#e7dfd4)}
.wp-dlg-msg{white-space:pre-wrap;margin:10px 0 4px}
.wp-dlg-detail{font-size:12px;color:#8d8478;white-space:pre-wrap;margin-top:4px}
.wp-dlg-label{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8d8478;margin:12px 0 5px}
.wp-dlg input[type=text],.wp-dlg select{width:100%;font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--hairline,#e7dfd4);
  border-radius:7px;background:#fffdf8;color:var(--ink,#4a443d);outline:none}
.wp-dlg select{width:auto;font-size:13px;padding:5px 8px}
.wp-dlg input[type=text]:focus,.wp-dlg select:focus{border-color:var(--brass-soft,#c9ab7c);box-shadow:0 0 0 3px rgba(176,141,87,.18)}
.wp-dlg input[type=checkbox]{accent-color:var(--brass,#b08d57);width:15px;height:15px}
.wp-dlg-error{color:var(--brick,#b4655a);font-size:12px;min-height:16px;margin-top:5px}
.wp-dlg-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;
  border-top:1px solid var(--hairline,#e7dfd4)}
.wp-dlg-row:first-child{border-top:none}
.wp-dlg-row .wp-dlg-row-text{flex:1;min-width:0}
.wp-dlg-row .wp-dlg-row-text small{display:block;font-size:11.5px;color:#8d8478;overflow-wrap:anywhere}
.wp-dlg-foot{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:16px}
.wp-dlg .ui-btn.wp-dlg-btn{border:1px solid var(--hairline,#e7dfd4);padding:8px 14px;min-height:34px}
.wp-dlg .ui-btn.wp-dlg-btn.primary{background:var(--brass,#b08d57);border-color:var(--brass,#b08d57);color:#fffdf8;font-weight:600}
.wp-dlg .ui-btn.wp-dlg-btn.primary:hover{background:#a07f4c}
.wp-dlg .ui-btn.wp-dlg-btn.primary:disabled{opacity:.45;background:var(--brass,#b08d57)}
.wp-dlg .ui-btn.wp-dlg-btn.danger{color:var(--brick,#b4655a)}
.wp-dlg .ui-btn.wp-dlg-btn.danger.primary{background:var(--brick,#b4655a);border-color:var(--brick,#b4655a);color:#fffdf8}
.wp-dlg .ui-btn.wp-dlg-btn:focus-visible{outline:2px solid var(--brass-soft,#c9ab7c);outline-offset:1px}
`;

function ensureStyle(): void {
  if (document.getElementById('wp-dialog-style')) return;
  const style = document.createElement('style');
  style.id = 'wp-dialog-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

let seq = 0;
const FOCUSABLE = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

/** Open a modal; resolves with the chosen button's value (cancelValue on Esc). */
export function openDialog<T>(opts: DialogOptions<T>): DialogHandle<T> {
  ensureStyle();
  const prevFocus = document.activeElement as HTMLElement | null;
  const id = `wp-dlg-${++seq}`;

  const overlay = document.createElement('div');
  overlay.className = 'wp-dlg-overlay';
  const box = document.createElement('div');
  box.className = 'wp-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', `${id}-title`);
  if (opts.width) box.style.width = `${opts.width}px`;
  overlay.appendChild(box);

  const h = document.createElement('h3');
  h.id = `${id}-title`;
  h.textContent = opts.title;
  box.appendChild(h);
  if (opts.message) {
    const p = document.createElement('div');
    p.className = 'wp-dlg-msg';
    p.textContent = opts.message;
    box.appendChild(p);
  }
  if (opts.detail) {
    const d = document.createElement('div');
    d.className = 'wp-dlg-detail';
    d.textContent = opts.detail;
    box.appendChild(d);
  }
  if (opts.body) box.appendChild(opts.body);

  const foot = document.createElement('div');
  foot.className = 'wp-dlg-foot';
  box.appendChild(foot);

  let settle!: (v: T) => void;
  const result = new Promise<T>((r) => (settle = r));
  let done = false;
  const close = (value: T): void => {
    if (done) return;
    done = true;
    overlay.remove();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    settle(value);
  };

  const buttons = opts.buttons.map((b) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ui-btn wp-dlg-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
    el.textContent = b.label;
    el.addEventListener('click', () => close(b.value));
    foot.appendChild(el);
    return el;
  });

  // Backdrop: a press that starts and ends outside the panel cancels.
  let downOnBackdrop = false;
  overlay.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === overlay;
    if (downOnBackdrop) e.preventDefault(); // keep focus inside the dialog
  });
  overlay.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === overlay) close(opts.cancelValue);
    downOnBackdrop = false;
  });

  overlay.addEventListener('keydown', (e) => {
    // the planner's global shortcuts (Del, R, T, Ctrl+Z…) must not fire under a modal
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close(opts.cancelValue);
    } else if (e.key === 'Enter' && !e.isComposing) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.tagName === 'A') return; // native activation
      e.preventDefault();
      const v = opts.onEnter ? opts.onEnter() : undefined;
      if (v !== undefined) close(v);
      else if (!opts.onEnter) {
        const primary = buttons.find((b, i) => opts.buttons[i].primary && !b.disabled);
        primary?.click();
      }
    } else if (e.key === 'Tab') {
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  document.body.appendChild(overlay);
  const target =
    opts.focus ??
    box.querySelector<HTMLElement>('input,select') ??
    buttons.find((_, i) => opts.buttons[i].primary) ??
    buttons[buttons.length - 1];
  target?.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement && target.type === 'text') target.select();

  return { result, close, root: box, buttons };
}

export interface AskTextOptions {
  message?: string;
  label?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** return an error message to keep the dialog open */
  validate?: (value: string) => string | null;
  maxLength?: number;
}

/** Inline replacement for window.prompt(): resolves the trimmed text, or null. */
export function askText(title: string, initial = '', opts: AskTextOptions = {}): Promise<string | null> {
  const body = document.createElement('div');
  const inputId = `wp-dlg-in-${seq + 1}`;
  if (opts.label) {
    const label = document.createElement('label');
    label.className = 'wp-dlg-label';
    label.htmlFor = inputId;
    label.textContent = opts.label;
    body.appendChild(label);
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.value = initial;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.maxLength = opts.maxLength ?? 80;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  body.appendChild(input);
  const err = document.createElement('div');
  err.className = 'wp-dlg-error';
  body.appendChild(err);

  const check = (): string | null => {
    const v = input.value.trim();
    if (!v) return 'Please enter a name.';
    return opts.validate ? opts.validate(v) : null;
  };

  const OK = Symbol('ok');
  const handle = openDialog<typeof OK | null>({
    title,
    message: opts.message,
    body,
    focus: input,
    cancelValue: null,
    buttons: [
      { label: opts.cancelLabel ?? 'Cancel', value: null },
      { label: opts.okLabel ?? 'Save', value: OK, primary: true },
    ],
    onEnter: () => (check() ? undefined : OK),
  });
  const okBtn = handle.buttons[1];
  const refresh = (): void => {
    okBtn.disabled = !input.value.trim();
    err.textContent = '';
  };
  input.addEventListener('input', refresh);
  refresh();
  // a click on Save validates first
  okBtn.addEventListener(
    'click',
    (e) => {
      const msg = check();
      if (msg) {
        e.stopImmediatePropagation();
        err.textContent = msg;
        input.focus();
      }
    },
    { capture: true },
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const msg = check();
      if (msg) err.textContent = msg;
    }
  });
  return handle.result.then((v) => (v === OK ? input.value.trim() : null));
}

export interface ConfirmOptions {
  detail?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Inline replacement for window.confirm(). */
export function confirmBox(title: string, message = '', opts: ConfirmOptions = {}): Promise<boolean> {
  return openDialog<boolean>({
    title,
    message: message || undefined,
    detail: opts.detail,
    cancelValue: false,
    buttons: [
      { label: opts.cancelLabel ?? 'Cancel', value: false },
      { label: opts.okLabel ?? 'OK', value: true, primary: true, danger: opts.danger },
    ],
  }).result;
}

export interface MessageBoxOptions {
  detail?: string;
  /** labels, left → right; default ['OK'] */
  buttons?: string[];
  /** index of the highlighted (Enter) button; default last */
  defaultId?: number;
  /** index returned for Esc/backdrop; default -1 */
  cancelId?: number;
  body?: HTMLElement;
  width?: number;
}

/** Inline replacement for window.alert() with optional extra buttons; resolves the clicked index. */
export function messageBox(title: string, message = '', opts: MessageBoxOptions = {}): Promise<number> {
  const labels = opts.buttons?.length ? opts.buttons : ['OK'];
  const def = opts.defaultId ?? labels.length - 1;
  return openDialog<number>({
    title,
    message: message || undefined,
    detail: opts.detail,
    body: opts.body,
    width: opts.width,
    cancelValue: opts.cancelId ?? -1,
    buttons: labels.map((label, i) => ({ label, value: i, primary: i === def })),
  }).result;
}

/** true while one of these dialogs is open (keyboard/feature guards). */
export function dialogIsOpen(): boolean {
  return document.querySelector('.wp-dlg-overlay') !== null;
}
